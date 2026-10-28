import {assertPlannedEdit} from '../scripts/lib/local-plan-proof.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import {initializeLocal,runLocal} from '../src/one_hwp/local_runner.mjs';
import {readHwp} from '../src/one_hwp/guard/container.mjs';
import {parseRecords} from '../src/one_hwp/guard/records.mjs';
import {encodeRecords,view} from '../src/one_hwp/local_complex_records.mjs';
import {packLocalBodyRewrite} from '../src/one_hwp/local_body_write.mjs';
import {placementFixture,cellBoxFixture} from './local_placement_fixtures.mjs';

initializeLocal(fs.readFileSync(new URL('../node_modules/@rhwp/core/rhwp_bg.wasm',import.meta.url)));
function workspace(t,bytes){
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'hwp-box-geometry-')),source=path.join(dir,'글상자 편집.hwp');fs.writeFileSync(source,bytes);
 t.after(()=>{assert.equal(path.dirname(dir),os.tmpdir());assert.ok(path.basename(dir).startsWith('hwp-box-geometry-'));fs.rmSync(dir,{recursive:true,force:true});});return {source,bytes:Buffer.from(bytes)};
}
const read=source=>runLocal({action:'read',source,max_chars:64000,max_blocks:128});
const records=bytes=>[...parseRecords(readHwp(bytes).streams.get('BodyText/Section0'))];
const move=(s,props,box=s.text_boxes[0])=>({type:'transform_text_box',target_id:box.target_id,expected_old:s.blocks.find(b=>b.id===box.block_id).text,expected_properties:box.properties,expected_flow:box.flow,props});
const fixtures={body:options=>placementFixture({box:true,...options}),cell:options=>cellBoxFixture({...options,cellRelative:true}),nested:options=>cellBoxFixture({...options,nested:true,cellRelative:true})};

for(const [name,fixture] of Object.entries(fixtures))for(const empty of [false,true])test(`explicit rectangle move/resize and exact recovery: ${name}, empty=${empty}`,async t=>{
 const w=workspace(t,fixture({empty,mixed:!empty})),s=await read(w.source),box=s.text_boxes[0];assert.equal(box.geometry_editable,true);
 const props={width:box.properties.width+400,height:6000,horzOffset:box.properties.horzOffset+250,vertOffset:box.properties.vertOffset+1200},operations=[move(s,props)],request={source:w.source,expected_sha256:s.source_sha256,operations,layout_policy:'reject_new_overflow'};
 const plan=await runLocal({action:'plan',...request});assert.equal(plan.saved,false);assert.deepEqual(fs.readFileSync(w.source),w.bytes);
 const saved=await runLocal({action:'edit',...request});assert.equal(saved.saved_path,w.source);assertPlannedEdit(plan,saved,'test_local_text_boxes');assert.equal(saved.text_box_geometry_changed,true);
 const after=await read(w.source),now=after.text_boxes[0];assert.deepEqual(now.properties,props);assert.equal(now.geometry_editable,true);assert.deepEqual(now.flow,box.flow);assert.deepEqual(now.paragraphs.map(p=>p.text),box.paragraphs.map(p=>p.text));assert.deepEqual(after.blocks.map(b=>b.text),s.blocks.map(b=>b.text));
 const old=records(w.bytes),changed=records(fs.readFileSync(w.source));for(const tag of [67,68,72,77])assert.deepEqual(changed.filter(r=>r.tag===tag).map(r=>r.payload),old.filter(r=>r.tag===tag).map(r=>r.payload));
 const beforeStreams=readHwp(w.bytes).streams,afterStreams=readHwp(fs.readFileSync(w.source)).streams;for(const [name,bytes] of beforeStreams)if(!['BodyText/Section0','PrvText','PrvImage'].includes(name))assert.ok(Buffer.from(afterStreams.get(name)).equals(Buffer.from(bytes)),`unrelated stream changed: ${name}`);
 const noop=await runLocal({action:'edit',source:w.source,expected_sha256:after.source_sha256,operations:[move(after,props)]});assert.equal(noop.saved,false);assert.equal((await runLocal({action:'history',source:w.source,expected_sha256:after.source_sha256})).entries.length,1);
 await runLocal({action:'restore',source:w.source,expected_sha256:after.source_sha256,backup_id:saved.backup_id});assert.deepEqual(fs.readFileSync(w.source),w.bytes);
});

for(const nested of [false,true])test(`cell-relative rectangle overflow rejects before any write: nested=${nested}`,async t=>{
 const w=workspace(t,cellBoxFixture({nested,cellRelative:true})),s=await read(w.source),operations=[move(s,{width:100000})],request={source:w.source,expected_sha256:s.source_sha256,operations};
 const plan=await runLocal({action:'plan',...request});assert.ok(plan.layout_diagnostics.new_issues.some(i=>i.code==='TEXT_BOX_EXCEEDS_CELL_WIDTH'&&i.text_box_id===s.text_boxes[0].id));
 for(const action of ['plan','edit'])await assert.rejects(runLocal({action,...request,layout_policy:'reject_new_overflow'}),/NEW_LAYOUT_OVERFLOW/);
 assert.deepEqual(fs.readFileSync(w.source),w.bytes);assert.equal((await runLocal({action:'history',source:w.source,expected_sha256:s.source_sha256})).entries.length,0);
});

test('rectangle geometry, text and structural edits compose in one atomic batch',async t=>{
 const w=workspace(t,placementFixture({box:true,mixed:true})),s=await read(w.source),box=s.text_boxes[0],p=box.paragraphs[0],props={width:12000,height:5000,horzOffset:17000,vertOffset:12000};
 const operations=[move(s,props),{type:'insert_paragraphs',target_id:s.blocks[1].target_id,expected_old:s.blocks[1].text,paragraphs:['NEW AFTER BOX']},{type:'splice_text_box',target_id:p.target_id,expected_old:p.text,expected_properties:props,start:8,end:13,new_text:'수정문'}];
 const saved=await runLocal({action:'edit',source:w.source,expected_sha256:s.source_sha256,operations});assert.equal(saved.atomic_batch,true);assert.equal(saved.text_box_geometry_changed,true);
 const after=await read(w.source);assert.equal(after.text_boxes[0].paragraphs[0].text,'TEXTBOX 수정문 😀');assert.deepEqual(after.text_boxes[0].properties,props);
 await runLocal({action:'restore',source:w.source,expected_sha256:after.source_sha256,backup_id:saved.backup_id});assert.deepEqual(fs.readFileSync(w.source),w.bytes);
});

for(const nested of [false,true])test(`geometry target follows a shifted table host: nested=${nested}`,async t=>{
 const w=workspace(t,cellBoxFixture({nested,cellRelative:true})),s=await read(w.source),box=s.text_boxes[0],p=box.paragraphs[0],props={...box.properties,width:box.properties.width+200};
 const operations=[{type:'insert_paragraphs',target_id:s.blocks[0].target_id,expected_old:s.blocks[0].text,paragraphs:['PREFIX INSERTED BEFORE TABLE']},move(s,{width:props.width}),{type:'splice_text_box',target_id:p.target_id,expected_old:p.text,expected_properties:props,start:0,end:[...p.text].length,new_text:'옮긴 표 안의 글상자 😀'}];
 const saved=await runLocal({action:'edit',source:w.source,expected_sha256:s.source_sha256,operations}),after=await read(w.source);assert.equal(after.text_boxes[0].paragraph,box.paragraph+1);assert.equal(after.text_boxes[0].paragraphs[0].text,'옮긴 표 안의 글상자 😀');assert.deepEqual(after.text_boxes[0].properties,props);
 await runLocal({action:'restore',source:w.source,expected_sha256:after.source_sha256,backup_id:saved.backup_id});assert.deepEqual(fs.readFileSync(w.source),w.bytes);
});

test('invalid or stale rectangle geometry never saves a partial batch',async t=>{
 const w=workspace(t,placementFixture({box:true})),s=await read(w.source),op=move(s,{width:12000});
 const bad=[{...op,expected_old:'STALE'},{...op,expected_properties:{...op.expected_properties,height:999}},{...op,expected_flow:{...op.expected_flow,textWrap:7}},...[{},{width:0},{height:-1},{width:720001},{horzOffset:1.5},{width:true},{rotationAngle:30}].map(props=>({...op,props}))];
 for(const invalid of bad)await assert.rejects(runLocal({action:'edit',source:w.source,expected_sha256:s.source_sha256,operations:[op,invalid]}),/EXPECTED_OLD_MISMATCH|EXPECTED_TEXT_BOX_MISMATCH|INVALID_TEXT_BOX_PROPERTIES/);
 assert.deepEqual(fs.readFileSync(w.source),w.bytes);assert.equal((await runLocal({action:'history',source:w.source,expected_sha256:s.source_sha256})).entries.length,0);
});

test('cell-relative left crossing is strict; page-relative offsets do not imply cell bounds',async t=>{
 for(const cellRelative of [false,true]){
  const w=workspace(t,cellBoxFixture({cellRelative})),s=await read(w.source),request={source:w.source,expected_sha256:s.source_sha256,operations:[move(s,{horzOffset:-500})]},plan=await runLocal({action:'plan',...request});
  assert.equal(plan.layout_diagnostics.new_issues.some(i=>i.code==='TEXT_BOX_EXCEEDS_CELL_LEFT_BOUNDARY'),cellRelative);
  if(cellRelative)await assert.rejects(runLocal({action:'edit',...request,layout_policy:'reject_new_overflow'}),/NEW_LAYOUT_OVERFLOW/);
  assert.deepEqual(fs.readFileSync(w.source),w.bytes);
 }
});

test('rotated or scaled rectangle remains text-editable but geometry is refused',async t=>{
 for(const scaled of [false,true]){
  const source=placementFixture({box:true}),raw=readHwp(source),rs=records(source),shape=rs.find(r=>r.tag===76),v=view(shape.payload);if(scaled)v.setFloat64(96,2,true);else v.setInt16(40,15,true);
  const bytes=packLocalBodyRewrite(source,raw,new Map([['BodyText/Section0',encodeRecords(rs)]])),w=workspace(t,bytes),s=await read(w.source);assert.equal(s.text_boxes[0].geometry_editable,false);assert.equal(s.text_boxes[0].paragraphs[0].editable,true);
  await assert.rejects(runLocal({action:'edit',source:w.source,expected_sha256:s.source_sha256,operations:[move(s,{width:12000})]}),/TEXT_BOX_GEOMETRY_PROFILE_UNSUPPORTED/);assert.deepEqual(fs.readFileSync(w.source),Buffer.from(bytes));
 }
});
