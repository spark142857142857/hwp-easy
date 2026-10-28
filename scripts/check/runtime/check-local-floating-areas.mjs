import {assertPlannedEdit} from '../../lib/local-plan-proof.mjs';
/** Exercise the shipped runner outside the checkout, using synthetic HWP only. */
import fs from 'node:fs';import path from 'node:path';import os from 'node:os';import assert from 'node:assert/strict';import {spawnSync} from 'node:child_process';
import {HwpDocument,initSync} from '@rhwp/core';import {floatingAreaFixture} from '../../../tests/local_floating_fixtures.mjs';import {floatingFixture} from '../../../tests/local_reflow_fixtures.mjs';import {opaqueGroupFixture} from '../../../tests/local_placement_fixtures.mjs';import {fixture} from '../../../tests/rhwp_fixtures.mjs';import {checkedExport} from '../../../tests/local_complex_fixtures.mjs';import {progressiveJpeg} from '../../../tests/local_image_fixtures.mjs';import {digest} from '../../../src/one_hwp/local_file.mjs';
initSync({module:fs.readFileSync('node_modules/@rhwp/core/rhwp_bg.wasm')});
const out=path.resolve(process.argv[2]??'outputs/local-floating-areas');assert.equal(fs.existsSync(out),false);fs.mkdirSync(out,{recursive:true});
const temp=fs.mkdtempSync(path.join(os.tmpdir(),'hwp-floating-package-')),packageDir=path.join(temp,'package');fs.cpSync('outputs/plugin-package/hwp-easy',packageDir,{recursive:true});const runner=path.join(packageDir,'skills/edit-local-hwp/scripts/local-runner.mjs'),source=path.join(temp,'한글 공백.hwp'),requestFile=path.join(temp,'request.json'),cases=[];
assert.equal(digest(fs.readFileSync(runner)),JSON.parse(fs.readFileSync(path.join(packageDir,'build-manifest.json'))).runner_sha256);
let refusals=0;
function invoke(request){fs.writeFileSync(requestFile,JSON.stringify(request));const r=spawnSync(process.execPath,[runner,'--request',requestFile],{cwd:temp,encoding:'utf8',timeout:65000,windowsHide:true,maxBuffer:8*1024*1024});assert.equal(r.error,undefined);assert.equal(r.stderr,'');return JSON.parse(r.stdout);}
function call(request){const value=invoke(request);assert.equal(value.ok,true,JSON.stringify(value));return value.result;}
const read=()=>call({action:'read',source,max_chars:64000,max_blocks:128});
function operation(s,extra={}){const object=s.text_boxes?.[0]??s.picture_groups?.[0]??s.opaque_drawings?.[0]??s.pictures[0],host=s.blocks.find(b=>b.id===object.block_id||b.target_id===object.target_id);return {type:'reposition_floating_object',target_id:object.target_id,expected_old:host.text,expected_properties:object.properties,expected_flow:object.flow,...extra};}
function pageFixture(bytes){const doc=new HwpDocument(bytes);try{doc.insertPageBreak(0,doc.getParagraphCount(0)-1,0);return checkedExport(doc);}finally{doc.free();}}
function trial(name,bytes,extra){fs.writeFileSync(source,bytes);const before=read(),operations=[operation(before,extra(before))],request={source,expected_sha256:before.source_sha256,operations};fs.writeFileSync(path.join(out,name+'-before.hwp'),bytes);
 const plan=call({action:'plan',...request});assert.equal(plan.saved,false);assert.ok(fs.readFileSync(source).equals(Buffer.from(bytes)));const saved=call({action:'edit',...request}),after=read(),result=fs.readFileSync(source);assert.equal(saved.saved,true);assert.equal(saved.saved_path,source);assertPlannedEdit(plan,saved,'check-local-floating-areas');assert.equal(saved.floating_state_preserved,true);fs.writeFileSync(path.join(out,name+'-after.hwp'),result);
 call({action:'restore',source,expected_sha256:after.source_sha256,backup_id:saved.backup_id});assert.ok(fs.readFileSync(source).equals(Buffer.from(bytes)));fs.writeFileSync(path.join(out,name+'-restored.hwp'),bytes);cases.push({name,before,after,operations,verification:saved});
}
const page=s=>({destination_target_id:s.blocks.filter(b=>!b.cell_path?.length).at(-1).target_id,expected_destination:s.blocks.filter(b=>!b.cell_path?.length).at(-1).text});
try{
 for(const columns of [2,3])trial('column-'+columns,floatingAreaFixture({columns,mixed:true}),()=>({destination_column:columns-1}));
 trial('page-box',floatingAreaFixture({pageBreak:true,mixed:true}),page);
 trial('page-column',floatingAreaFixture({columns:2,pageBreak:true}),s=>({...page(s),destination_column:1}));
 trial('cell-false',floatingAreaFixture({cell:true}),()=>({}));
 trial('page-group',pageFixture(floatingFixture()),page);
 trial('page-opaque',pageFixture(opaqueGroupFixture()),page);
 const doc=new HwpDocument(fixture({table:false,paragraphs:['PICTURE HOST','MIDDLE','DESTINATION']}));let picture;try{const at=JSON.parse(doc.insertPicture(0,0,0,'[]',progressiveJpeg,7200,3600,64,40,'jpg','synthetic'));doc.setPictureProperties(0,at.paraIdx,at.controlIdx,JSON.stringify({treatAsChar:false}));picture=checkedExport(doc);}finally{doc.free();}
 trial('page-picture',pageFixture(picture),page);
 trial('nested-cell',floatingAreaFixture({cell:true,nested:true}),()=>({clearance:150}));
 fs.writeFileSync(path.join(out,'cases.json'),JSON.stringify(cases,null,2)+'\n');const summary={status:'PASS',cases:cases.length,refusals_before_save:refusals,same_file_save:true,plan_matches_verified_edit_sha256:true,exact_restore:true,runner_sha256:digest(fs.readFileSync(runner)),layout_verified:false};fs.writeFileSync(path.join(out,'summary.json'),JSON.stringify(summary,null,2)+'\n');console.log(JSON.stringify(summary));
}finally{assert.equal(path.dirname(temp),os.tmpdir());assert.ok(path.basename(temp).startsWith('hwp-floating-package-'));fs.rmSync(temp,{recursive:true,force:true});}
