/** Isolated shipped runtime: plan, same-file edit, no-op, exact restore and every page. */
import fs from 'node:fs';import path from 'node:path';import os from 'node:os';import assert from 'node:assert/strict';import {spawnSync} from 'node:child_process';
import {HwpDocument,initSync} from '@rhwp/core';
import {f4ClosureProfiles} from '../../../tests/local_f4_closure_fixtures.mjs';
import {digest} from '../../../src/one_hwp/local_file.mjs';
import {openLocalRenderView} from '../../../src/one_hwp/local_render_view.mjs';
import {rasterizeLocalSvg} from '../../../src/one_hwp/local_preview_cache.mjs';
import {readHwp} from '../../../src/one_hwp/guard/container.mjs';
import {assertPlannedEdit} from '../../lib/local-plan-proof.mjs';
initSync({module:fs.readFileSync('node_modules/@rhwp/core/rhwp_bg.wasm')});
const out=path.resolve(process.argv[2]??'outputs/f4-package');assert.equal(fs.existsSync(out),false);fs.mkdirSync(out,{recursive:true});
const temp=fs.mkdtempSync(path.join(os.tmpdir(),'hwp-f4-package-')),pkg=path.join(temp,'package');fs.cpSync('outputs/plugin-package/hwp-easy',pkg,{recursive:true});const runner=path.join(pkg,'skills/edit-local-hwp/scripts/local-runner.mjs'),cases=[];
const call=request=>{const file=path.join(temp,'request.json');fs.writeFileSync(file,JSON.stringify(request));const p=spawnSync(process.execPath,[runner,'--request',file],{cwd:temp,encoding:'utf8',windowsHide:true,timeout:65000,maxBuffer:12*1024*1024,env:{...process.env,NODE_PATH:''}});assert.equal(p.status,0,p.stderr||p.stdout);return JSON.parse(p.stdout).result;};
try{for(const profile of f4ClosureProfiles){
 const bytes=profile.fixture(),source=path.join(temp,profile.name+' 한국어.hwp');fs.writeFileSync(source,bytes);const read=()=>call({action:'read',source,max_chars:64000,max_blocks:128}),before=read(),operations=profile.operations(before),request={source,expected_sha256:before.source_sha256,operations},plan=call({action:'plan',...request});assert.equal(plan.saved,false);assert.equal(digest(fs.readFileSync(source)),digest(bytes));
 const saved=call({action:'edit',...request}),after=read(),changed=fs.readFileSync(source),plan_proof=assertPlannedEdit(plan,saved,profile.name);assert.equal(saved.saved_path,source);assert.equal(saved.preview_cache.status,'updated');
 const f=after.fields?.find(f=>f.editable),p=after.text_boxes?.flatMap(b=>b.paragraphs).find(p=>!p.fields.length)??after.blocks.find(b=>b.editable),noopOperation=f?{type:'set_field',target_id:f.target_id,expected_old:f.value,new_text:f.value}:{type:'replace_text',target_id:p.target_id,expected_old:p.text,new_text:p.text},noop=call({action:'edit',source,expected_sha256:after.source_sha256,operations:[noopOperation]});assert.equal(noop.saved,false);assert.equal(call({action:'history',source,expected_sha256:after.source_sha256}).entries.length,1);
 call({action:'restore',source,expected_sha256:after.source_sha256,backup_id:saved.backup_id});assert.equal(digest(fs.readFileSync(source)),digest(bytes));
 for(const [stage,data]of [['before',bytes],['after',changed],['restored',fs.readFileSync(source)]]){
  fs.writeFileSync(path.join(out,`${profile.name}-${stage}.hwp`),data);if(stage==='restored')continue;const view=openLocalRenderView(HwpDocument,data);try{for(let page=0;page<view.document.pageCount();page++){
   const svg=view.document.renderPageSvg(page),preview=call({action:'preview',source:path.join(out,`${profile.name}-${stage}.hwp`),expected_sha256:digest(data),page});assert.equal(svg,preview.svg);fs.writeFileSync(path.join(out,`${profile.name}-${stage}-${page}.svg`),svg);fs.writeFileSync(path.join(out,`${profile.name}-${stage}-${page}-runs.json`),view.document.getPageTextLayout(page));fs.writeFileSync(path.join(out,`${profile.name}-${stage}-${page}-controls.json`),view.document.getPageControlLayout(page));if(stage==='after'&&page===0){const image=await rasterizeLocalSvg(svg);assert.equal(digest(image.bytes),digest(readHwp(data).streams.get('PrvImage')));}
  }}finally{view.document.free();}
 }
 cases.push({name:profile.name,before,after,operations,plan_proof,verification:saved});console.log(JSON.stringify({case:profile.name,status:'PASS'}));
 }const summary={status:'PASS',cases:cases.length,same_file_save:true,exact_restore:true,no_op_no_history:true,source_packaged_svg_equal:true,all_pages_rendered:true,embedded_preview_matches:true,runner_sha256:digest(fs.readFileSync(runner)),layout_verified:false};fs.writeFileSync(path.join(out,'cases.json'),JSON.stringify(cases,null,2)+'\n');fs.writeFileSync(path.join(out,'summary.json'),JSON.stringify(summary,null,2)+'\n');console.log(JSON.stringify(summary));
}finally{assert.equal(path.dirname(path.resolve(temp)),path.resolve(os.tmpdir()));assert.ok(path.basename(temp).startsWith('hwp-f4-package-'));fs.rmSync(temp,{recursive:true,force:true});}
