/** Source or isolated packaged same-file acceptance and render provenance. */
import fs from 'node:fs';import path from 'node:path';import os from 'node:os';import assert from 'node:assert/strict';import {spawnSync} from 'node:child_process';
import {HwpDocument} from '@rhwp/core';
import {initializeLocal,runLocal} from '../src/one_hwp/local_runner.mjs';
import {openLocalRenderView} from '../src/one_hwp/local_render_view.mjs';
import {digest} from '../src/one_hwp/local_file.mjs';
import {drawingRenderProfiles,drawingRenderFixture,drawingRenderOperations} from '../tests/local_drawing_render_fixtures.mjs';
import {assertPlannedEdit} from './local-plan-proof.mjs';
initializeLocal(fs.readFileSync('node_modules/@rhwp/core/rhwp_bg.wasm'));
const out=path.resolve(process.argv[2]??'outputs/drawing-render'),packaged=process.argv.includes('--package');assert.equal(fs.existsSync(out),false);fs.mkdirSync(out,{recursive:true});
const temp=fs.mkdtempSync(path.join(os.tmpdir(),'hwp-drawing-render-'));let runner;
if(packaged){fs.cpSync('outputs/plugin-package/hwp-easy',path.join(temp,'package'),{recursive:true});runner=path.join(temp,'package/skills/edit-local-hwp/scripts/local-runner.mjs');}
const call=async req=>{if(!packaged)return runLocal(req);const f=path.join(temp,'request.json');fs.writeFileSync(f,JSON.stringify(req));const p=spawnSync(process.execPath,[runner,'--request',f],{cwd:temp,encoding:'utf8',windowsHide:true,timeout:65000,maxBuffer:16*1024*1024,env:{...process.env,NODE_PATH:''}});const v=JSON.parse(p.stdout);if(p.status!==0||v.ok!==true)throw Error(p.stdout||p.stderr);return v.result;};
const cases=[];
try{for(const profile of drawingRenderProfiles){
 const source=path.join(temp,profile.name+' 한글.hwp'),bytes=await drawingRenderFixture(profile);fs.writeFileSync(source,bytes);const read=()=>call({action:'read',source,max_blocks:128,max_chars:64000}),before=await read(),operations=drawingRenderOperations(before,profile),req={source,expected_sha256:before.source_sha256,operations},plan=await call({action:'plan',...req});assert.deepEqual(fs.readFileSync(source),Buffer.from(bytes));const saved=await call({action:'edit',...req}),after=await read(),changed=fs.readFileSync(source);assert.equal(saved.saved_path,source);assert.equal(saved.preview_cache.status,"updated");assert.deepEqual(saved.preview_cache.render_unadapted_drawings,[]);assertPlannedEdit(plan,saved,profile.name);
 const p=after.text_boxes.flatMap(b=>b.paragraphs).find(p=>!p.fields.length),noop=await call({action:'edit',source,expected_sha256:after.source_sha256,operations:[{type:'splice_text',target_id:p.target_id,expected_old:p.text,start:0,end:[...p.text].length,new_text:p.text}]});assert.equal(noop.saved,false);assert.equal((await call({action:'history',source,expected_sha256:after.source_sha256})).entries.length,1);
 await call({action:'restore',source,expected_sha256:after.source_sha256,backup_id:saved.backup_id});assert.deepEqual(fs.readFileSync(source),Buffer.from(bytes));
 const rendered=[];for(const [stage,data,state]of [['before',bytes,before],['after',changed,after],['restored',fs.readFileSync(source),before]]){
  const file=path.join(out,`${profile.name}-${stage}.hwp`);fs.writeFileSync(file,data);const view=openLocalRenderView(HwpDocument,data),runs=[];try{for(let page=0;page<view.document.pageCount();page++){
   const preview=await call({action:'preview',source:file,expected_sha256:digest(data),page}),svg=view.document.renderPageSvg(page);assert.equal(preview.svg,svg);if(stage==='after')assert.deepEqual(preview.render_unadapted_drawings,[],profile.name+': '+JSON.stringify(preview.render_unadapted_drawings));
   const values=JSON.parse(view.document.getPageTextLayout(page)).runs;runs.push(...values.map(r=>({...r,page})));fs.writeFileSync(path.join(out,`${profile.name}-${stage}-${page}.svg`),svg);fs.writeFileSync(path.join(out,`${profile.name}-${stage}-${page}-runs.json`),JSON.stringify(values,null,2));
  }
  if(stage==='after'){for(const box of state.text_boxes)for(const p of box.paragraphs){const visible=runs.filter(r=>r.source_paragraph_id===p.id).map(r=>r.text).join('');assert.equal(visible,p.text.replaceAll('\n',''),profile.name+' '+p.id);}}
  rendered.push({stage,pages:view.document.pageCount(),runs:runs.filter(r=>r.render_drawing_text)});
  }finally{view.document.free();}
 }
 cases.push({name:profile.name,profile,before,after,operations,saved,verification:saved,rendered});fs.writeFileSync(path.join(out,'cases.json'),JSON.stringify(cases,null,2)+'\n');console.log(JSON.stringify({case:profile.name,status:'PASS'}));
}const result={status:'PASS',cases:cases.length,isolated_bundle:packaged,same_file_save:true,exact_restore:true,no_op_no_history:true,all_group_paragraphs_visible:true,request_view_svg_equal:true,source_packaged_svg_equal:packaged?true:null,layout_verified:false};fs.writeFileSync(path.join(out,'cases.json'),JSON.stringify(cases,null,2)+'\n');fs.writeFileSync(path.join(out,'summary.json'),JSON.stringify(result,null,2)+'\n');console.log(JSON.stringify(result));
}finally{assert.equal(path.dirname(temp),os.tmpdir());assert.ok(path.basename(temp).startsWith('hwp-drawing-render-'));fs.rmSync(temp,{recursive:true,force:true});}
