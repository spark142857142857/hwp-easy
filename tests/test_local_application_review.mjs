import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {HwpDocument} from '@rhwp/core';
import {initializeLocal,runLocal} from '../src/one_hwp/local_runner.mjs';
import {editLocalBatch} from '../src/one_hwp/local_batch.mjs';
import {digest} from '../src/one_hwp/local_file.mjs';
import {view} from '../src/one_hwp/local_complex_records.mjs';
import {f4GroupFixture,f4Inspect,f4Target,f4Patch} from './local_f4_fixtures.mjs';
import {fieldFixture} from './local_complex_fixtures.mjs';
import {checkApplication} from '../scripts/check-local-application.mjs';
import {applicationFixture} from './local_application_fixture.mjs';
import {checkedExport} from './local_complex_fixtures.mjs';
import {prepareSetupFontRender} from '../src/one_hwp/local_setup_font_render.mjs';
import {openLocalRenderView} from '../src/one_hwp/local_render_view.mjs';
import {readHwp} from '../probes/sites-runtime/guard/container.mjs';
import {parseRecords} from '../probes/sites-runtime/guard/records.mjs';
initializeLocal(fs.readFileSync(new URL('../node_modules/@rhwp/core/rhwp_bg.wasm',import.meta.url)));

function workspace(t){const dir=fs.mkdtempSync(path.join(os.tmpdir(),'hwp-application-review-'));t.after(()=>{assert.equal(path.dirname(dir),os.tmpdir());assert.ok(path.basename(dir).startsWith('hwp-application-review-'));fs.rmSync(dir,{recursive:true,force:true});});return dir;}
function duplicateIds(bytes){return f4Patch(bytes,rows=>{let id;for(const r of rows)if(r.tag===71&&Buffer.from(r.payload.subarray(0,4)).toString()==='klc%'){const p=view(r.payload),at=11+p.getUint16(9,true)*2;id??=p.getUint32(at,true);p.setUint32(at,id,true);}});}
for(const profile of ['body','group','other_box'])test(`duplicate field definitions stay readable and cannot select the wrong value: ${profile}`,async t=>{
 let bytes=profile==='body'?fieldFixture():f4GroupFixture({field:true}),s=f4Inspect(bytes),p=profile==='body'?s.blocks.find(b=>b.id===s.fields[0].block_id):s.text_boxes[profile==='other_box'?1:0].paragraphs[0];
 bytes=(await editLocalBatch(HwpDocument,bytes,digest(bytes),[{type:'insert_field',target_id:f4Target(p.id,digest(bytes)),expected_old:p.text,offset:[...p.text].length,name:'second field',guide:'guide',value:s.fields[0]?.value??s.object_fields[0].value}])).bytes;
 bytes=duplicateIds(bytes);const source=path.join(workspace(t),'duplicate.hwp');fs.writeFileSync(source,bytes);const read=await runLocal({action:'read',source});assert.equal(read.fields.length,2);assert.ok(read.fields.every(f=>!f.editable&&f.read_only_reason==='FIELD_ID_AMBIGUOUS'));
 if(profile!=='body')assert.ok(read.text_boxes.flatMap(b=>b.paragraphs.flatMap(p=>p.fields)).every(f=>!f.editable));
 const f=read.fields.at(-1),operations=[{type:'set_field',new_text:'DO NOT CHANGE'},{type:'update_field',expected_metadata:{name:f.name,guide:f.guide,command:f.command},props:{name:'NO'}},{type:'delete_field'},{type:'format_text',start:0,end:1,props:{bold:true}}];
 for(const operation of operations)for(const action of ['plan','edit'])await assert.rejects(runLocal({action,source,expected_sha256:read.source_sha256,operations:[{...operation,target_id:f.target_id,expected_old:f.value}]}),/FIELD_ID_AMBIGUOUS/);
 assert.deepEqual(fs.readFileSync(source),Buffer.from(bytes));assert.equal((await runLocal({action:'history',source,expected_sha256:read.source_sha256})).entries.length,0);
});

test('rotated grouped text omissions are explicit in preview, diagnostics and saved thumbnail metadata',async t=>{
 const bytes=f4GroupFixture({nested:true,field:true}),source=path.join(workspace(t),'rotated.hwp');fs.writeFileSync(source,bytes);const before=await runLocal({action:'read',source});
 assert.deepEqual((await runLocal({action:'preview',source,expected_sha256:digest(fs.readFileSync(source))})).render_unadapted_drawings,[]);
 const node=before.drawing_groups.find(n=>n.parent_id),host=before.blocks.find(b=>b.id===node.block_id),saved=await runLocal({action:'edit',source,expected_sha256:before.source_sha256,operations:[{type:'transform_drawing_group',target_id:node.target_id,expected_old:host.text,expected_properties:node.properties,expected_rotation_angle:0,props:{width:16000,height:5000,horzOffset:2000,vertOffset:2000,rotationAngle:10}}]});
 const after=await runLocal({action:'read',source}),preview=await runLocal({action:'preview',source,expected_sha256:digest(fs.readFileSync(source))}),layout=await runLocal({action:'layout',source,scope:'rendered',expected_sha256:digest(fs.readFileSync(source))});
 assert.equal(preview.render_unadapted_drawings.length,2);assert.ok(preview.render_unadapted_drawings.every(d=>d.reason==='rotated_group_rectangle_text_not_rendered'&&d.text_characters>0));assert.equal(preview.render_content_complete,false);assert.ok(preview.warnings.some(w=>w.includes('누락')));
 assert.deepEqual(saved.preview_cache.render_unadapted_drawings,preview.render_unadapted_drawings);assert.equal(saved.preview_cache.image_content_complete,false);assert.equal(layout.diagnostics_complete,false);assert.ok(layout.engine_limitations.some(l=>l.code==='DRAWING_TEXT_RENDER_UNVERIFIED'));
 assert.deepEqual(after.text_boxes.map(b=>b.paragraphs.map(p=>p.text)),before.text_boxes.map(b=>b.paragraphs.map(p=>p.text)));
 await runLocal({action:'restore',source,expected_sha256:after.source_sha256,backup_id:saved.backup_id});assert.deepEqual(fs.readFileSync(source),Buffer.from(bytes));
});
test('application form fill, long-answer pagination, shortening and exact two-stage recovery',async t=>{
 const result=await checkApplication(path.join(workspace(t),'form'));assert.equal(result.status,'PASS');assert.deepEqual(result.states.map(s=>s.pages),[1,2,4,2,2,1]);assert.equal(result.exact_original_restore,true);
});
test('large first title uses its visible font for private line height; setup controls and saved bytes are preserved',()=>{
 const bytes=f4Patch(applicationFixture(),rs=>{let end=1;while(end<rs.length&&rs[end].level>0)end++;view(rs[0].payload).setUint16(16,0,true);for(let i=end-1;i>0;i--)if(rs[i].tag===69&&rs[i].level===1)rs.splice(i,1);}),hash=digest(bytes),prepared=prepareSetupFontRender(bytes);assert.equal(prepared.notes.length,1);assert.equal(prepared.notes[0].kind,'setup_anchor_font');
 const raw=readHwp(bytes),after=readHwp(prepared.bytes);assert.deepEqual(after.streams.get('DocInfo'),raw.streams.get('DocInfo'));
 const beforeRecords=[...parseRecords(raw.streams.get('BodyText/Section0'))],afterRecords=[...parseRecords(after.streams.get('BodyText/Section0'))];
 for(const tag of [67,71,72,73,74,75,77])assert.deepEqual(afterRecords.filter(r=>r.tag===tag).map(r=>r.payload),beforeRecords.filter(r=>r.tag===tag).map(r=>r.payload));
 const original=new HwpDocument(bytes),render=openLocalRenderView(HwpDocument,bytes);try{
  const title=JSON.parse(render.document.getPageTextLayout(0)).runs.find(r=>r.paraIdx===0&&r.text);assert.equal(title.h,24);
  const oldTitle=JSON.parse(original.getPageTextLayout(0)).runs.find(r=>r.paraIdx===0&&r.text);assert.ok(title.h>oldTitle.h+10);assert.equal(digest(bytes),hash);
 }finally{original.free();render.document.free();}
 const mixed=new HwpDocument(bytes);try{mixed.applyCharFormat(0,0,0,1,JSON.stringify({fontSize:2000}));assert.deepEqual(prepareSetupFontRender(checkedExport(mixed)).notes,[]);}finally{mixed.free();}
});
