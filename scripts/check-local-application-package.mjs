/** Run the synthetic form through only the built, standalone runtime. */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
import {initializeLocal} from '../src/one_hwp/local_runner.mjs';
import {checkApplication} from './check-local-application.mjs';
import {f4GroupFixture,f4Inspect,f4Target,f4Patch} from '../tests/local_f4_fixtures.mjs';
import {editLocalBatch} from '../src/one_hwp/local_batch.mjs';
import {HwpDocument} from '@rhwp/core';
import {digest} from '../src/one_hwp/local_file.mjs';
import {view} from '../src/one_hwp/local_complex_records.mjs';
initializeLocal(fs.readFileSync(new URL('../node_modules/@rhwp/core/rhwp_bg.wasm',import.meta.url)));
const out=path.resolve(process.argv[2]??'outputs/application-package'),temp=fs.mkdtempSync(path.join(os.tmpdir(),'hwp-application-package-')),pkg=path.join(temp,'package');
try{
 fs.cpSync('outputs/plugin-package/hwp-easy',pkg,{recursive:true});const runner=path.join(pkg,'skills/edit-local-hwp/scripts/local-runner.mjs');
 const call=async request=>{const file=path.join(temp,'request.json');fs.writeFileSync(file,JSON.stringify(request));const p=spawnSync(process.execPath,[runner,'--request',file],{cwd:temp,encoding:'utf8',windowsHide:true,timeout:65000,maxBuffer:12*1024*1024,env:{...process.env,NODE_PATH:''}});let value;try{value=JSON.parse(p.stdout);}catch{throw Error(p.stderr||p.stdout);}if(p.status!==0||value.ok!==true)throw Error(JSON.stringify(value));return value.result;};
 const summary=await checkApplication(out,call);
 // Confirm the regression guards survive bundling; source code creates inputs only.
 let bytes=f4GroupFixture({field:true}),state=f4Inspect(bytes),p=state.text_boxes[0].paragraphs[0];
 bytes=(await editLocalBatch(HwpDocument,bytes,digest(bytes),[{type:'insert_field',target_id:f4Target(p.id,digest(bytes)),expected_old:p.text,offset:[...p.text].length,name:'second',guide:'guide',value:'FIELD VALUE'}])).bytes;
 bytes=f4Patch(bytes,rs=>{let id;for(const r of rs)if(r.tag===71&&Buffer.from(r.payload.subarray(0,4)).toString()==='klc%'){const v=view(r.payload),at=11+v.getUint16(9,true)*2;id??=v.getUint32(at,true);v.setUint32(at,id,true);}});
 const source=path.join(temp,'duplicates.hwp');fs.writeFileSync(source,bytes);const read=await call({action:'read',source});assert.ok(read.fields.every(f=>!f.editable&&f.read_only_reason==='FIELD_ID_AMBIGUOUS'));const f=read.fields.at(-1);await assert.rejects(call({action:'edit',source,expected_sha256:read.source_sha256,operations:[{type:'set_field',target_id:f.target_id,expected_old:f.value,new_text:'NO'}]}),/FIELD_ID_AMBIGUOUS/);assert.deepEqual(fs.readFileSync(source),Buffer.from(bytes));
 bytes=f4GroupFixture({nested:true,field:true});fs.writeFileSync(source,bytes);const before=await call({action:'read',source}),g=before.drawing_groups.find(g=>g.parent_id),host=before.blocks.find(b=>b.id===g.block_id),saved=await call({action:'edit',source,expected_sha256:before.source_sha256,operations:[{type:'transform_drawing_group',target_id:g.target_id,expected_old:host.text,expected_properties:g.properties,expected_rotation_angle:0,props:{width:16000,height:5000,horzOffset:2000,vertOffset:2000,rotationAngle:10}}]});assert.equal(saved.preview_cache.status,"updated");assert.notEqual(saved.preview_cache.image_content_complete,false);const after=await call({action:'read',source}),preview=await call({action:'preview',source,expected_sha256:after.source_sha256});assert.deepEqual(preview.render_unadapted_drawings,[]);assert.notEqual(preview.render_content_complete,false);assert.ok(preview.svg.includes("data-hwp-drawing-text"));await call({action:'restore',source,expected_sha256:after.source_sha256,backup_id:saved.backup_id});assert.deepEqual(fs.readFileSync(source),Buffer.from(bytes));
 const result={...summary,isolated_bundle:true,duplicate_field_guard:true,rotated_text_display:true,runner_sha256:digest(fs.readFileSync(runner))};fs.writeFileSync(path.join(out,'package-summary.json'),JSON.stringify(result,null,2)+'\n');console.log(JSON.stringify(result));
}finally{assert.equal(path.dirname(temp),os.tmpdir());assert.ok(path.basename(temp).startsWith('hwp-application-package-'));fs.rmSync(temp,{recursive:true,force:true});}
