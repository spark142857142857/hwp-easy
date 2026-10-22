import {assertPlannedEdit} from './local-plan-proof.mjs';
/** Isolated package checks for cell text-box risks, strict refusal and recovery. */
import fs from 'node:fs';import path from 'node:path';import os from 'node:os';import assert from 'node:assert/strict';import {spawnSync} from 'node:child_process';import {createHash} from 'node:crypto';import {initSync} from '@rhwp/core';
import {cellBoxFixture} from '../tests/local_placement_fixtures.mjs';
initSync({module:fs.readFileSync('node_modules/@rhwp/core/rhwp_bg.wasm')});
const out=path.resolve(process.argv[2]??'outputs/local-cell-text-boxes');assert.equal(fs.existsSync(out),false);fs.mkdirSync(out,{recursive:true});
const temp=fs.mkdtempSync(path.join(os.tmpdir(),'hwp-cell-box-package-')),pkg=path.join(temp,'package');fs.cpSync('outputs/plugin-package/hwp-easy',pkg,{recursive:true});
const runner=path.join(pkg,'skills/edit-local-hwp/scripts/local-runner.mjs'),hash=b=>createHash('sha256').update(b).digest('hex'),manifest=JSON.parse(fs.readFileSync(path.join(pkg,'build-manifest.json'))),cases=[];let sequence=0,strictRefusals=0;
assert.equal(hash(fs.readFileSync(runner)),manifest.runner_sha256);
function invoke(request){const file=path.join(out,`request-${++sequence}.json`);fs.writeFileSync(file,JSON.stringify(request));const r=spawnSync(process.execPath,[runner,'--request',file],{cwd:temp,windowsHide:true,encoding:'utf8',timeout:65000,maxBuffer:8*1024*1024});assert.equal(r.error,undefined);assert.equal(r.stderr,'');const response=JSON.parse(r.stdout);fs.writeFileSync(path.join(out,`response-${sequence}.json`),JSON.stringify(response,null,2)+'\n');return response;}
const good=req=>{const r=invoke(req);assert.equal(r.ok,true,JSON.stringify(r));return r.result;},read=source=>good({action:'read',source,max_chars:64000,max_blocks:128});
const splice=(s,text)=>{const b=s.text_boxes[0],p=b.paragraphs[0];return {type:'splice_text_box',target_id:p.target_id,expected_old:p.text,expected_properties:b.properties,start:0,end:[...p.text].length,new_text:text};};
const transform=(s,props)=>{const b=s.text_boxes[0];return {type:'transform_text_box',target_id:b.target_id,expected_old:s.blocks.find(x=>x.id===b.block_id).text,expected_properties:b.properties,expected_flow:b.flow,props};};
const long=Array.from({length:20},(_,i)=>`줄 ${i+1} 내용 😀`).join('\n');
function trial(name,options,makeOperation,expectedCodes,{strict=false,safe=false,inconclusive=false}={}){
 const dir=path.join(temp,name);fs.mkdirSync(dir);const source=path.join(dir,'셀 글상자 검사.hwp'),original=Buffer.from(cellBoxFixture({cellRelative:true,empty:true,...options}));fs.writeFileSync(source,original);
 const before=read(source),operations=[makeOperation(before)],request={source,expected_sha256:before.source_sha256,operations},plan=good({action:'plan',...request});assert.equal(plan.saved,false);assert.deepEqual(fs.readFileSync(source),original);
 for(const code of expectedCodes)assert.ok(plan.layout_diagnostics.new_issues.some(i=>i.code===code),name+' missing '+code);
 if(inconclusive)assert.equal(plan.layout_diagnostics.cell_text_boxes.status,'inconclusive');
 if(strict){for(const action of ['plan','edit']){const refused=invoke({action,...request,layout_policy:'reject_new_risk'});assert.equal(refused.ok,false);assert.equal(refused.error,'NEW_LAYOUT_RISK');strictRefusals++;}assert.deepEqual(fs.readFileSync(source),original);assert.equal(good({action:'history',source,expected_sha256:before.source_sha256}).entries.length,0);}
 const saved=good({action:'edit',...request,...(safe?{layout_policy:'reject_new_risk'}:{})}),after=read(source),edited=fs.readFileSync(source);assert.equal(saved.saved_path,source);assertPlannedEdit(plan,saved,'check-local-cell-text-boxes');if(safe)assert.deepEqual(saved.layout_diagnostics.new_issues,[]);
 const rendered=good({action:'layout',source,expected_sha256:after.source_sha256,scope:'rendered'});assert.equal(rendered.layout_verified,false);if(inconclusive)assert.equal(rendered.diagnostics_complete,false);
 fs.writeFileSync(path.join(out,name+'-before.hwp'),original);fs.writeFileSync(path.join(out,name+'-after.hwp'),edited);
 good({action:'restore',source,expected_sha256:after.source_sha256,backup_id:saved.backup_id});assert.deepEqual(fs.readFileSync(source),original);fs.copyFileSync(source,path.join(out,name+'-restored.hwp'));
 assert.ok(good({action:'history',source,expected_sha256:hash(original)}).entries.some(e=>e.sha256===hash(edited)&&e.backup_verified));
 cases.push({name,before,after,operations,verification:saved,rendered,exact_restore:true,edited_version_retained:true});
}
try{
 for(const nested of [false,true]){
  trial('cell-safe-'+nested,{nested},s=>splice(s,'OK 😀'),[],{safe:true,inconclusive:nested});
  trial('cell-long-'+nested,{nested},s=>splice(s,long),['CELL_TEXT_BOX_CONTENT_MAY_EXCEED_FRAME_HEIGHT','CELL_TEXT_BOX_CONTENT_MAY_OVERLAP_BODY_TEXT'],{strict:true,inconclusive:nested});
  trial('cell-top-'+nested,{nested},s=>transform(s,{vertOffset:-1500}),['CELL_TEXT_BOX_EXCEEDS_RENDERED_CELL_TOP'],{strict:true,inconclusive:nested});
  trial('cell-down-'+nested,{nested},s=>transform(s,{vertOffset:10000}),['CELL_TEXT_BOX_MAY_EXCEED_FLOW_CELL_HEIGHT',...(nested?['CELL_TEXT_BOX_MAY_OVERLAP_FLOW_BODY_TEXT']:[])],{strict:true,inconclusive:nested});
  trial('cell-large-'+nested,{nested},s=>transform(s,{height:6000,vertOffset:1200}),['CELL_TEXT_BOX_MAY_EXCEED_FLOW_CELL_HEIGHT',...(!nested?['CELL_TEXT_BOX_MAY_OVERLAP_FLOW_BODY_TEXT']:[])],{strict:true,inconclusive:nested});
 }
 trial('paper-anchor-long',{cellRelative:false},s=>splice(s,long),['CELL_TEXT_BOX_CONTENT_MAY_EXCEED_FRAME_HEIGHT'],{strict:true,inconclusive:true});
 fs.writeFileSync(path.join(out,'cases.json'),JSON.stringify(cases,null,2)+'\n');const summary={status:'PASS',cases:cases.length,strict_refusals_before_save:strictRefusals,same_file_save:true,plan_matches_verified_edit_sha256:true,exact_restore:true,runner_sha256:hash(fs.readFileSync(runner)),layout_verified:false};fs.writeFileSync(path.join(out,'summary.json'),JSON.stringify(summary,null,2)+'\n');console.log(JSON.stringify(summary));
}finally{assert.equal(path.dirname(temp),os.tmpdir());assert.ok(path.basename(temp).startsWith('hwp-cell-box-package-'));fs.rmSync(temp,{recursive:true,force:true});}
