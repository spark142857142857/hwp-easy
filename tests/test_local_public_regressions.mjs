import {assertPlannedEdit} from '../scripts/local-plan-proof.mjs';
import test from 'node:test';import assert from 'node:assert/strict';import fs from 'node:fs';import os from 'node:os';import path from 'node:path';
import {HwpDocument} from '@rhwp/core';
import {initializeLocal,runLocal} from '../src/one_hwp/local_runner.mjs';
import {cellBoxFixture,placementFixture,opaqueGroupFixture} from './local_placement_fixtures.mjs';import {nestedFixture} from './local_complex_fixtures.mjs';
import {fixture} from './rhwp_fixtures.mjs';import {checkedExport} from './local_complex_fixtures.mjs';
import {readHwp} from '../probes/sites-runtime/guard/container.mjs';import {parseRecords} from '../probes/sites-runtime/guard/records.mjs';
import {view,encodeRecords} from '../src/one_hwp/local_complex_records.mjs';
import {patchLocalPackedStreams} from '../src/one_hwp/local_container_write.mjs';
import {deflateRawSync} from 'node:zlib';
import {analyzeRenderedLayout} from '../src/one_hwp/local_rendered_layout.mjs';
initializeLocal(fs.readFileSync(new URL('../node_modules/@rhwp/core/rhwp_bg.wasm',import.meta.url)));
const read=source=>runLocal({action:'read',source,max_chars:64000,max_blocks:128});
function workspace(t,bytes){const dir=fs.mkdtempSync(path.join(os.tmpdir(),'hwp-public-'));t.after(()=>{assert.equal(path.dirname(dir),os.tmpdir());assert.ok(path.basename(dir).startsWith('hwp-public-'));fs.rmSync(dir,{recursive:true,force:true});});const source=path.join(dir,'selected.hwp');fs.writeFileSync(source,bytes);return {source,bytes};}
const records=b=>[...parseRecords(readHwp(b).streams.get('BodyText/Section0'))];
for(const nested of [false,true])for(const empty of [false,true])test(`plain cell text box edit/save/restore nested=${nested} empty=${empty}`,async t=>{
 const w=workspace(t,cellBoxFixture({nested,empty})),s=await read(w.source),box=s.text_boxes[0],p=box.paragraphs[0];assert.equal(box.cell_path.length,nested?2:1);assert.equal(box.profile,'cell_rectangle_plain_paragraphs');
 const op={type:'splice_text_box',target_id:p.target_id,expected_old:p.text,expected_properties:box.properties,start:0,end:[...p.text].length,new_text:'셀 글상자 😀\n두 번째 줄'},noop=await runLocal({action:'edit',source:w.source,expected_sha256:s.source_sha256,operations:[{...op,new_text:p.text}]});assert.equal(noop.saved,false);
 const plan=await runLocal({action:'plan',source:w.source,expected_sha256:s.source_sha256,operations:[op]});assert.deepEqual(fs.readFileSync(w.source),Buffer.from(w.bytes));
 const saved=await runLocal({action:'edit',source:w.source,expected_sha256:s.source_sha256,operations:[op]});assert.equal(saved.saved_path,w.source);assertPlannedEdit(plan,saved,'test_local_public_regressions');const after=await read(w.source);assert.equal(after.text_boxes[0].paragraphs[0].text,op.new_text);assert.deepEqual(after.text_boxes[0].properties,box.properties);assert.deepEqual(after.blocks.map(b=>b.text),s.blocks.map(b=>b.text));
 for(const tag of [71,72,76,77,79])assert.deepEqual(records(fs.readFileSync(w.source)).filter(r=>r.tag===tag).map(r=>r.payload),records(w.bytes).filter(r=>r.tag===tag).map(r=>r.payload));
 await runLocal({action:'restore',source:w.source,expected_sha256:after.source_sha256,backup_id:saved.backup_id});assert.deepEqual(fs.readFileSync(w.source),Buffer.from(w.bytes));
});

test('nested long answer warns and strict risk policy rejects the entire batch before backup',async t=>{
 const w=workspace(t,nestedFixture()),s=await read(w.source),b=s.blocks.find(b=>b.cell_path.length===2),body=s.blocks.find(b=>!b.cell_path.length&&b.text_range_editable),operations=[{type:'splice_text',target_id:body.target_id,expected_old:body.text,start:0,end:0,new_text:'earlier edit '},{type:'splice_text',target_id:b.target_id,expected_old:b.text,start:0,end:0,new_text:('긴 답변을 작성합니다. '.repeat(10)+'\n').repeat(30)}];
 const plan=await runLocal({action:'plan',source:w.source,expected_sha256:s.source_sha256,operations});assert.ok(plan.layout_diagnostics.new_issues.some(i=>i.code==='NESTED_TABLE_MAY_EXCEED_PAGE_HEIGHT'&&i.certainty==='font_estimate'));
 await assert.rejects(runLocal({action:'edit',source:w.source,expected_sha256:s.source_sha256,operations,layout_policy:'reject_new_risk'}),/NEW_LAYOUT_RISK/);assert.deepEqual(fs.readFileSync(w.source),Buffer.from(w.bytes));assert.equal((await runLocal({action:'history',source:w.source,expected_sha256:s.source_sha256})).entries.length,0);
 const small=[{...operations[1],new_text:'짧은 답변'}],saved=await runLocal({action:'edit',source:w.source,expected_sha256:s.source_sha256,operations:small,layout_policy:'reject_new_risk'});assert.equal(saved.saved,true);await runLocal({action:'restore',source:w.source,expected_sha256:(await read(w.source)).source_sha256,backup_id:saved.backup_id});assert.deepEqual(fs.readFileSync(w.source),Buffer.from(w.bytes));
});

test('nested table clean bounding boxes still disclose unverified native pagination',()=>{
 const result=analyzeRenderedLayout(HwpDocument,nestedFixture());assert.equal(result.diagnostics_complete,false);assert.ok(result.engine_limitations.some(l=>l.code==='NESTED_TABLE_PAGINATION_UNVERIFIED'));assert.equal(result.layout_verified,false);
});

for(const inserted of [false,true])test(`opaque vector group outer placement preserves all children, remapped=${inserted}`,async t=>{
 const w=workspace(t,opaqueGroupFixture()),s=await read(w.source),g=s.opaque_drawings[0],b=s.blocks.find(b=>b.id===g.block_id);assert.equal(g.contents_read_only,true);assert.equal(s.picture_groups.length,0);
 const ops=[...(inserted?[{type:'insert_paragraphs',target_id:s.blocks[0].target_id,expected_old:s.blocks[0].text,paragraphs:['ADDED PREFIX']}]:[]),{type:'reposition_floating_object',target_id:g.target_id,expected_old:b.text,expected_properties:g.properties,expected_flow:g.flow}];
 const saved=await runLocal({action:'edit',source:w.source,expected_sha256:s.source_sha256,operations:ops});assert.equal(saved.saved_path,w.source);const a=await read(w.source),now=a.opaque_drawings[0];assert.deepEqual(now.flow,g.flow);assert.equal(now.properties.width,g.properties.width);assert.equal(now.properties.height,g.properties.height);
 for(const tag of [76,79])assert.deepEqual(records(fs.readFileSync(w.source)).filter(r=>r.tag===tag).map(r=>r.payload),records(w.bytes).filter(r=>r.tag===tag).map(r=>r.payload));
 const layout=await runLocal({action:'layout',source:w.source,expected_sha256:a.source_sha256,scope:'rendered'});assert.equal(layout.issues.some(i=>i.code.startsWith('FLOATING_OBJECT')),false);
 await runLocal({action:'restore',source:w.source,expected_sha256:a.source_sha256,backup_id:saved.backup_id});assert.deepEqual(fs.readFileSync(w.source),Buffer.from(w.bytes));
});

test('unmodeled footer spacing still refuses floating relocation without saving',async t=>{
 const w=workspace(t,placementFixture({box:true,footer:true})),s=await read(w.source);await runLocal({action:'edit',source:w.source,expected_sha256:s.source_sha256,operations:[{type:'protect_page_bottom',target_id:s.blocks[0].target_id,expected_old:s.blocks[0].text,expected_page:s.page_definitions[0].properties,minimum_footer_height:10000}]});
 const protectedBytes=fs.readFileSync(w.source),raw=readHwp(protectedBytes),rs=[...parseRecords(raw.streams.get('BodyText/Section0'))],defs=[...parseRecords(raw.streams.get('DocInfo'))],footer=rs.findIndex(r=>r.tag===71&&Buffer.from(r.payload.subarray(0,4)).toString()==='toof'),head=rs.find((r,i)=>i>footer&&r.tag===66),shape=defs.filter(r=>r.tag===25)[view(head.payload).getUint16(8,true)];view(shape.payload).setUint32(0,(view(shape.payload).getUint32(0,true)&~3)|1,true);view(shape.payload).setInt32(24,3200,true);if(shape.payload.length>=54){view(shape.payload).setUint32(46,1,true);view(shape.payload).setInt32(50,3200,true);}fs.writeFileSync(w.source,patchLocalPackedStreams(protectedBytes,new Map([['DocInfo',deflateRawSync(encodeRecords(defs),{level:9})]])));
 const a=await read(w.source),box=a.text_boxes[0],b=a.blocks.find(b=>b.id===box.block_id),prior=fs.readFileSync(w.source);
 await assert.rejects(runLocal({action:'edit',source:w.source,expected_sha256:a.source_sha256,operations:[{type:'reposition_floating_object',target_id:box.target_id,expected_old:b.text,expected_properties:box.properties,expected_flow:box.flow}]}),/PLACEMENT_PAGINATION_UNVERIFIED/);assert.deepEqual(fs.readFileSync(w.source),prior);
});

test('inline raw identity prevents a render plane from inventing floating collisions',()=>{
 const doc=new HwpDocument(fixture({table:false,paragraphs:['header','host']}));let source;try{doc.createTableEx(JSON.stringify({sectionIdx:0,paraIdx:1,charOffset:0,rowCount:1,colCount:1,colWidths:[10000],treatAsChar:true}));source=checkedExport(doc);}finally{doc.free();}class Inline{pageCount(){return 1;}getPositionOfPage(){return '{"ok":true,"sec":0,"para":0,"charOffset":0}';}getPageInfo(){return JSON.stringify({sectionIndex:0,bodyLeft:0,bodyRight:100,height:100,marginTop:0,marginHeader:0,marginBottom:0,marginFooter:0});}getPageTextLayout(){return '{"runs":[]}';}getPageControlLayout(){return '{"controls":[{"type":"group","x":0,"y":0,"w":10,"h":10,"secIdx":0,"paraIdx":1,"controlIdx":0,"plane":2}]}';}free(){}}
 // Synthetic source's root table is inline; its control identity remains authoritative.
 const r=analyzeRenderedLayout(Inline,source);assert.equal(r.pages[0].floating_objects,0);assert.ok(r.engine_limitations.some(l=>l.code==='INLINE_CONTROL_RENDER_PLANE_DISAGREEMENT'));
});
