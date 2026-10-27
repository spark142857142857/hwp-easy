import {assertPlannedEdit} from '../scripts/local-plan-proof.mjs';
import test from 'node:test';import assert from 'node:assert/strict';import fs from 'node:fs';import os from 'node:os';import path from 'node:path';
import {HwpDocument} from '@rhwp/core';import {initializeLocal,runLocal} from '../src/one_hwp/local_runner.mjs';
import {cellBoxFixture} from './local_placement_fixtures.mjs';import {inspectLocalComplex} from '../src/one_hwp/local_complex.mjs';
import {analyzeLocalLayout,newLayoutIssues} from '../src/one_hwp/local_layout.mjs';import {captureRenderedLayout} from '../src/one_hwp/local_rendered_layout.mjs';
import {layoutObjectIdentity} from '../src/one_hwp/local_layout_identity.mjs';import {view} from '../src/one_hwp/local_complex_records.mjs';
initializeLocal(fs.readFileSync(new URL('../node_modules/@rhwp/core/rhwp_bg.wasm',import.meta.url)));
function workspace(t,options={}){const dir=fs.mkdtempSync(path.join(os.tmpdir(),'hwp-cell-box-risk-')),source=path.join(dir,'셀 글상자 진단.hwp'),bytes=Buffer.from(cellBoxFixture({empty:true,cellRelative:true,...options}));fs.writeFileSync(source,bytes);t.after(()=>{assert.equal(path.dirname(dir),os.tmpdir());assert.ok(path.basename(dir).startsWith('hwp-cell-box-risk-'));fs.rmSync(dir,{recursive:true,force:true});});return {source,bytes};}
const read=source=>runLocal({action:'read',source,max_chars:64000,max_blocks:128});
const splice=(s,text)=>{const box=s.text_boxes[0],p=box.paragraphs[0];return {type:'splice_text_box',target_id:p.target_id,expected_old:p.text,expected_properties:box.properties,start:0,end:[...p.text].length,new_text:text};};
const move=(s,props)=>{const box=s.text_boxes[0];return {type:'transform_text_box',target_id:box.target_id,expected_old:s.blocks.find(b=>b.id===box.block_id).text,expected_properties:box.properties,expected_flow:box.flow,props};};
const long=Array.from({length:20},(_,i)=>`줄 ${i+1} 내용 😀`).join('\n');

for(const nested of [false,true])test(`cell box long text reports frame/cell/body risks and strict batch never saves: nested=${nested}`,async t=>{
 const w=workspace(t,{nested}),s=await read(w.source),body=s.blocks.find(b=>!b.cell_path.length&&b.text==='중간 합성 문단'),operations=[{type:'replace_text',target_id:body.target_id,expected_old:body.text,new_text:'UNSAVED FIRST CHANGE'},splice(s,long)],request={source:w.source,expected_sha256:s.source_sha256,operations};
 const plan=await runLocal({action:'plan',...request}),codes=plan.layout_diagnostics.new_issues.map(i=>i.code);assert.ok(codes.includes('CELL_TEXT_BOX_CONTENT_MAY_EXCEED_FRAME_HEIGHT'));assert.ok(codes.includes('CELL_TEXT_BOX_MAY_EXCEED_FLOW_CELL_HEIGHT'));assert.ok(codes.includes('CELL_TEXT_BOX_CONTENT_MAY_OVERLAP_BODY_TEXT'));
 for(const action of ['plan','edit'])await assert.rejects(runLocal({action,...request,layout_policy:'reject_new_risk'}),/NEW_LAYOUT_RISK/);
 assert.deepEqual(fs.readFileSync(w.source),w.bytes);assert.equal((await runLocal({action:'history',source:w.source,expected_sha256:s.source_sha256})).entries.length,0);
 const saved=await runLocal({action:'edit',...request}),after=await read(w.source);assert.equal(saved.saved_path,w.source);assertPlannedEdit(plan,saved,'test_local_cell_text_box_layout');assert.equal(after.text_boxes[0].paragraphs[0].text,long);
 const noOp=await runLocal({action:'edit',source:w.source,expected_sha256:after.source_sha256,operations:[splice(after,long)],layout_policy:'reject_new_risk'});assert.equal(noOp.saved,false);
 await runLocal({action:'restore',source:w.source,expected_sha256:after.source_sha256,backup_id:saved.backup_id});assert.deepEqual(fs.readFileSync(w.source),w.bytes);
});

for(const nested of [false,true])test(`cell box observed top/bottom and real body intersections: nested=${nested}`,async t=>{
 const w=workspace(t,{nested}),s=await read(w.source),request={action:'plan',source:w.source,expected_sha256:s.source_sha256};
 const top=await runLocal({...request,operations:[move(s,{vertOffset:-1500})]});assert.ok(top.layout_diagnostics.new_issues.some(i=>i.code==='CELL_TEXT_BOX_EXCEEDS_RENDERED_CELL_TOP'&&i.certainty==='engine_render'));
 const bottom=await runLocal({...request,operations:[move(s,{vertOffset:10000})]});assert.ok(bottom.layout_diagnostics.new_issues.some(i=>i.code==='CELL_TEXT_BOX_MAY_EXCEED_FLOW_CELL_HEIGHT'));
 if(!nested)assert.ok(top.layout_diagnostics.new_issues.some(i=>i.code==='CELL_TEXT_BOX_BODY_TEXT_INTERSECTION'&&s.blocks.some(b=>b.id===i.related_block_id&&b.text.trim())));
 if(nested)assert.ok(bottom.layout_diagnostics.new_issues.some(i=>i.code==='CELL_TEXT_BOX_MAY_OVERLAP_FLOW_BODY_TEXT'&&i.certainty==='font_estimate'&&i.basis==='font_estimated_normal_table_flow_not_native_coordinates'));
 assert.equal(bottom.layout_diagnostics.cell_text_boxes.checked_boxes,1);if(nested)assert.ok(bottom.layout_diagnostics.cell_text_boxes.limitations.some(l=>l.code==='NESTED_TABLE_PAGINATION_UNVERIFIED'));
 await assert.rejects(runLocal({...request,action:'edit',operations:[move(s,{vertOffset:10000})],layout_policy:'reject_new_risk'}),/NEW_LAYOUT_RISK/);assert.deepEqual(fs.readFileSync(w.source),w.bytes);
});

for(const nested of [false,true])test(`short safe cell edit and shifted host save and restore under strict risk policy: nested=${nested}`,async t=>{
 const w=workspace(t,{nested}),s=await read(w.source),operations=[{type:'insert_paragraphs',target_id:s.blocks[0].target_id,expected_old:s.blocks[0].text,paragraphs:['NEW PREFIX']},splice(s,'OK 😀')],saved=await runLocal({action:'edit',source:w.source,expected_sha256:s.source_sha256,operations,layout_policy:'reject_new_risk'});
 assert.equal(saved.saved,true);assert.deepEqual(saved.layout_diagnostics.new_issues,[]);const after=await read(w.source);assert.equal(after.text_boxes[0].paragraph,s.text_boxes[0].paragraph+1);
 const layout=await runLocal({action:'layout',source:w.source,expected_sha256:after.source_sha256,scope:'rendered'});assert.equal(layout.cell_text_boxes.checked_boxes,1);assert.equal(layout.issues.some(i=>i.code.startsWith('CELL_TEXT_BOX_')&&i.code.includes('BODY_TEXT')),false);
 await runLocal({action:'restore',source:w.source,expected_sha256:after.source_sha256,backup_id:saved.backup_id});assert.deepEqual(fs.readFileSync(w.source),w.bytes);
});

test('paper cell anchor is inconclusive rather than a paragraph-coordinate diagnosis',async t=>{
 const w=workspace(t,{cellRelative:false}),s=await read(w.source),layout=await runLocal({action:'layout',source:w.source,expected_sha256:s.source_sha256});assert.equal(layout.cell_text_boxes.status,'inconclusive');assert.equal(layout.cell_text_boxes.checked_boxes,1);assert.ok(layout.cell_text_boxes.limitations.some(l=>l.code==='CELL_TEXT_BOX_ABSOLUTE_REFERENCE_RENDER_ONLY'));assert.equal(layout.native_layout_verified,undefined);
 const plan=await runLocal({action:'plan',source:w.source,expected_sha256:s.source_sha256,operations:[splice(s,long)]});assert.ok(plan.layout_diagnostics.new_issues.some(i=>i.code==='CELL_TEXT_BOX_CONTENT_MAY_EXCEED_FRAME_HEIGHT'));assert.ok(plan.layout_diagnostics.issues.filter(i=>i.code==='CELL_TEXT_BOX_BODY_TEXT_INTERSECTION').every(i=>i.certainty==='engine_render'));assert.ok(plan.layout_diagnostics.cell_text_boxes.limitations.some(l=>l.code==='CELL_TEXT_BOX_ABSOLUTE_REFERENCE_RENDER_ONLY'));
});

test('ambiguous rendered cells and shapes are never attributed to a selected box',()=>{
 const bytes=cellBoxFixture({cellRelative:true,empty:true}),state=inspectLocalComplex(HwpDocument,bytes,{includeDocumentInfo:false,verifyCharacterModel:false});
 for(const type of ['table','shape']){const snapshot=captureRenderedLayout(HwpDocument,bytes),c=snapshot.pages[0].controls.find(c=>c.type===type);snapshot.pages[0].controls.push(structuredClone(c));const d=analyzeLocalLayout(state,{snapshot});assert.equal(d.cell_text_boxes.checked_boxes,0);assert.ok(d.cell_text_boxes.limitations.some(l=>l.code==='CELL_TEXT_BOX_RENDER_IDENTITY_UNVERIFIED'));}
});

test('observed bottom crossing remains a risk when a renderer does not grow the cell',()=>{
 const bytes=cellBoxFixture({cellRelative:true,empty:true}),state=inspectLocalComplex(HwpDocument,bytes,{includeDocumentInfo:false,verifyCharacterModel:false}),snapshot=captureRenderedLayout(HwpDocument,bytes),cell=snapshot.pages[0].controls.find(c=>c.type==='table').cells[0];cell.h=20;
 const d=analyzeLocalLayout(state,{snapshot});assert.ok(d.issues.some(i=>i.code==='CELL_TEXT_BOX_EXCEEDS_RENDERED_CELL_BOTTOM'&&i.certainty==='engine_render'));
});

test('actual model instance ID identifies the box independently of z-order',()=>{
 const bytes=cellBoxFixture({cellRelative:true}),state=inspectLocalComplex(HwpDocument,bytes,{includeDocumentInfo:false,verifyCharacterModel:false}),box=state.text_boxes[0],doc=new HwpDocument(bytes);
 try{const props=JSON.parse(doc.getCellShapePropertiesByPath(box.section,box.paragraph,JSON.stringify(box.cell_path),box.control_index));assert.ok(props.instanceId>0);assert.equal(layoutObjectIdentity(state,box),`s0:instance:${props.instanceId}`);
  const rs=state.recordSets.get(0).map(r=>({...r,payload:r.payload.slice()}));view(rs[box.record_index].payload).setUint32(24,123456,true);assert.equal(layoutObjectIdentity({...state,recordSets:new Map([[0,rs]])},box),`s0:instance:${props.instanceId}`);
 }finally{doc.free();}
});

test('zero and duplicate actual instance IDs stay unverified despite distinct z-orders',()=>{
 const bytes=cellBoxFixture({cellRelative:true}),state=inspectLocalComplex(HwpDocument,bytes,{includeDocumentInfo:false,verifyCharacterModel:false}),box=state.text_boxes[0];
 for(const duplicate of [false,true]){const rs=state.recordSets.get(0).map(r=>({...r,payload:r.payload.slice()})),header=rs[box.record_index];view(header.payload).setUint32(24,50,true);
  if(duplicate){const copy={...header,payload:header.payload.slice()};view(copy.payload).setUint32(24,51,true);rs.push(copy);}else view(header.payload).setUint32(36,0,true);
  assert.ok(layoutObjectIdentity({...state,recordSets:new Map([[0,rs]])},box).startsWith('unverified:'));
 }
});

test('smaller cell risks are improvements; changing the overlapped paragraph remains new',()=>{
 const issue={code:'CELL_TEXT_BOX_BODY_TEXT_INTERSECTION',block_id:'box-host',object_identity:'s0:instance:7',section:0,related_block_id:'body-a',size:1000,available:0},before={issues:[issue]};
 assert.deepEqual(newLayoutIssues(before,{issues:[{...issue,size:500}]}),[]);
 assert.equal(newLayoutIssues(before,{issues:[{...issue,related_block_id:'body-b'}]}).length,1);
 assert.equal(newLayoutIssues(before,{issues:[{...issue,size:1200}]}).length,1);
 assert.deepEqual(newLayoutIssues(before,{issues:[{...issue,block_id:'moved-box',related_block_id:'moved-body',size:500}]},{'box-host':'moved-box','body-a':'moved-body'}),[]);
 assert.equal(newLayoutIssues(before,{issues:[issue,issue]}).length,1);
});
