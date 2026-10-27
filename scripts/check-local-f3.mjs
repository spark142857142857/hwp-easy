/** Isolated shipped runner, real same-file saves, undo and every rendered page. */
import fs from 'node:fs';import path from 'node:path';import os from 'node:os';import assert from 'node:assert/strict';import {spawnSync} from 'node:child_process';
import {HwpDocument,initSync} from '@rhwp/core';
import {f3ClosureProfiles,f3ClosureFixture,f3OldText,f3NewText} from '../tests/local_f3_closure_fixtures.mjs';
import {digest} from '../src/one_hwp/local_file.mjs';
import {assertPlannedEdit} from './local-plan-proof.mjs';
import {openLocalRenderView} from '../src/one_hwp/local_render_view.mjs';
import {rasterizeLocalSvg} from '../src/one_hwp/local_preview_cache.mjs';
import {readHwp} from '../probes/sites-runtime/guard/container.mjs';
initSync({module:fs.readFileSync('node_modules/@rhwp/core/rhwp_bg.wasm')});
const out=path.resolve(process.argv[2]??'outputs/local-f3');assert.equal(fs.existsSync(out),false);fs.mkdirSync(out,{recursive:true});
const temp=fs.mkdtempSync(path.join(os.tmpdir(),'hwp-f3-package-')),pkg=path.join(temp,'package');fs.cpSync('outputs/plugin-package/hwp-easy',pkg,{recursive:true});const runner=path.join(pkg,'skills/edit-local-hwp/scripts/local-runner.mjs');
const call=request=>{const file=path.join(temp,'request.json');fs.writeFileSync(file,JSON.stringify(request));const p=spawnSync(process.execPath,[runner,'--request',file],{encoding:'utf8',windowsHide:true,timeout:65000,maxBuffer:12*1024*1024});assert.equal(p.status,0,p.stderr||p.stdout);return JSON.parse(p.stdout).result;};
const cases=[];
try{for(const profile of f3ClosureProfiles){
 const bytes=f3ClosureFixture(profile),source=path.join(temp,profile.name+'.hwp');fs.writeFileSync(source,bytes);const read=()=>call({action:'read',source,max_chars:64000,max_blocks:128}),history=()=>call({action:'history',source,expected_sha256:digest(fs.readFileSync(source))}),before=read(),selected=before.blocks.find(b=>b.text===f3OldText(profile));assert.ok(selected);
 const initialHistory=history(),beforePreview=call({action:'preview',source,expected_sha256:before.source_sha256}),beforeLayout=call({action:'layout',scope:'rendered',source,expected_sha256:before.source_sha256});assert.deepEqual(beforePreview.render_unadapted_tables,[]);assert.equal(digest(fs.readFileSync(source)),digest(bytes));assert.deepEqual(history(),initialHistory);
 const operations=[{type:'splice_text',target_id:selected.target_id,expected_old:selected.text,start:0,end:[...selected.text].length,new_text:f3NewText(profile)}],request={source,expected_sha256:before.source_sha256,operations,layout_policy:'reject_new_risk'},plan=call({action:'plan',...request});assert.equal(digest(fs.readFileSync(source)),digest(bytes));assert.deepEqual(history(),initialHistory);
 const saved=call({action:'edit',...request}),changed=fs.readFileSync(source),after=read(),plan_proof=assertPlannedEdit(plan,saved,profile.name);assert.equal(saved.saved_path,source);assert.equal(saved.preview_cache.status,'updated');
 const afterPreview=call({action:'preview',source,expected_sha256:after.source_sha256}),afterLayout=call({action:'layout',scope:'rendered',source,expected_sha256:after.source_sha256});assert.deepEqual(afterPreview.render_unadapted_tables,[]);assert.deepEqual(afterPreview.render_unadapted_cells,[]);assert.equal(afterLayout.layout_verified,false);
 assert.deepEqual(before.blocks.filter(b=>b!==selected).map(b=>b.text),after.blocks.filter(b=>b.text!==f3NewText(profile)).map(b=>b.text));assert.deepEqual(before.fields.map(f=>[f.name,f.guide,f.value]),after.fields.map(f=>[f.name,f.guide,f.value]));
 const raster=await rasterizeLocalSvg(afterPreview.svg);assert.equal(digest(raster.bytes),digest(readHwp(changed).streams.get('PrvImage')));
 const selectedAfter=after.blocks.find(b=>b.text===f3NewText(profile)),count=history().entries.length;assert.equal(call({action:'edit',source,expected_sha256:after.source_sha256,operations:[{type:'replace_text',target_id:selectedAfter.target_id,expected_old:selectedAfter.text,new_text:selectedAfter.text}]}).saved,false);assert.equal(history().entries.length,count);
 call({action:'restore',source,expected_sha256:after.source_sha256,backup_id:saved.backup_id});assert.equal(digest(fs.readFileSync(source)),digest(bytes));assert.ok(history().entries.some(e=>e.sha256===digest(changed)&&e.backup_verified));
 for(const [stage,data]of [['before',bytes],['after',changed],['restored',fs.readFileSync(source)]])fs.writeFileSync(path.join(out,`${profile.name}-${stage}.hwp`),data);
 for(const [stage,data,layout]of [['before',bytes,beforeLayout],['after',changed,afterLayout]]){
  const v=openLocalRenderView(HwpDocument,data);try{const runs=[];for(let page=0;page<v.document.pageCount();page++){
   const svg=v.document.renderPageSvg(page),file=path.join(out,`${profile.name}-${stage}-${page}`),preview=stage==='before'&&page===0?beforePreview:stage==='after'&&page===0?afterPreview:call({action:'preview',source:path.join(out,`${profile.name}-${stage}.hwp`),expected_sha256:digest(data),page});assert.equal(svg,preview.svg);
   fs.writeFileSync(file+'.svg',svg);fs.writeFileSync(file+'-geometry.json',JSON.stringify(JSON.parse(v.document.getPageControlLayout(page)).controls.map(c=>v.remap(c,page)),null,2));const image=await rasterizeLocalSvg(svg);fs.writeFileSync(file+'-preview.bmp',image.bytes);runs.push(...JSON.parse(v.document.getPageTextLayout(page)).runs.map(r=>({...v.remap(r,page),page})).filter(r=>!r.render_only_synthetic));
  }fs.writeFileSync(path.join(out,`${profile.name}-${stage}-runs.json`),JSON.stringify(runs,null,2));assert.equal(layout.page_count,v.document.pageCount());}finally{v.document.free();}
 }
 cases.push({name:profile.name,fixture:{...profile,mode:'cell',answer_text:f3NewText(profile),selected_path:selected.cell_path},before,after,operations,plan_proof,verification:saved,before_layout:beforeLayout,after_layout:afterLayout});console.log(JSON.stringify({case:profile.name,status:'PASS'}));
 }const summary={status:'PASS',cases:cases.length,same_file_save:true,exact_restore:true,source_and_packaged_svg_equal:true,all_pages_rendered:true,embedded_image_matches_explicit_preview:true,no_op_no_history:true,runner_sha256:digest(fs.readFileSync(runner)),layout_verified:false};fs.writeFileSync(path.join(out,'cases.json'),JSON.stringify(cases,null,2)+'\n');fs.writeFileSync(path.join(out,'summary.json'),JSON.stringify(summary,null,2)+'\n');console.log(JSON.stringify(summary));
}finally{const resolved=path.resolve(temp);assert.equal(path.dirname(resolved),path.resolve(os.tmpdir()));assert.ok(path.basename(resolved).startsWith('hwp-f3-package-'));fs.rmSync(resolved,{recursive:true,force:true});}
