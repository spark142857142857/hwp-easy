import {assertPlannedEdit} from '../scripts/lib/local-plan-proof.mjs';
import test from 'node:test';import assert from 'node:assert/strict';import fs from 'node:fs';import path from 'node:path';import os from 'node:os';
import {initializeLocal,runLocal} from '../src/one_hwp/local_runner.mjs';
import {inlineCellFixture,inlineCellProfiles} from './local_inline_cell_fixtures.mjs';
import {HwpDocument} from '@rhwp/core';import {inspectLocalComplex} from '../src/one_hwp/local_complex.mjs';import {placeNestedFloating} from '../src/one_hwp/local_nested_floating.mjs';
initializeLocal(fs.readFileSync(new URL('../node_modules/@rhwp/core/rhwp_bg.wasm',import.meta.url)));
const read=source=>runLocal({action:'read',source,max_chars:64000,max_blocks:128});
const move=s=>{const b=s.text_boxes[0];return {type:'reposition_floating_object',target_id:b.target_id,expected_old:s.blocks.find(p=>p.id===b.block_id).text,expected_properties:b.properties,expected_flow:b.flow,clearance:150};};
function workspace(t,bytes){const dir=fs.mkdtempSync(path.join(os.tmpdir(),'hwp-inline-flow-'));t.after(()=>{assert.equal(path.dirname(dir),os.tmpdir());assert.ok(path.basename(dir).startsWith('hwp-inline-flow-'));fs.rmSync(dir,{recursive:true,force:true});});const source=path.join(dir,'여러 표와 문단.hwp');fs.writeFileSync(source,bytes);return {source,bytes};}
for(const [index,options]of [...inlineCellProfiles,{prefix:'문'.repeat(27),wide:true}].entries())test(`raw inline flow ${index}: same-file checked save, no-op and byte-exact recovery`,async t=>{
 const w=workspace(t,inlineCellFixture(options)),before=await read(w.source),request={source:w.source,expected_sha256:before.source_sha256,operations:[move(before)],layout_policy:'reject_new_risk'};
 const plan=await runLocal({action:'plan',...request});assert.equal(plan.saved,false);assert.ok(fs.readFileSync(w.source).equals(Buffer.from(w.bytes)));
 const saved=await runLocal({action:'edit',...request}),after=await read(w.source);assert.equal(saved.saved_path,w.source);assertPlannedEdit(plan,saved,'test_local_inline_cell_flow');assert.deepEqual(saved.layout_diagnostics.new_issues,[]);assert.equal(saved.floating_state_preserved,true);
 assert.deepEqual(after.text_boxes[0].cell_path,before.text_boxes[0].cell_path);assert.deepEqual(after.text_boxes[0].flow,before.text_boxes[0].flow);assert.deepEqual(after.blocks.map(b=>b.text),before.blocks.map(b=>b.text));assert.deepEqual(after.tables,before.tables.map(t=>({...t,cells:t.cells.map(c=>({...c,target_id:after.tables.find(a=>a.id===t.id).cells.find(a=>a.cell===c.cell).target_id,subtree_sha256:after.tables.find(a=>a.id===t.id).cells.find(a=>a.cell===c.cell).subtree_sha256}))})));
 assert.equal((await runLocal({action:'edit',source:w.source,expected_sha256:after.source_sha256,operations:[move(after)],layout_policy:'reject_new_risk'})).saved,false);
 await runLocal({action:'restore',source:w.source,expected_sha256:after.source_sha256,backup_id:saved.backup_id});assert.ok(fs.readFileSync(w.source).equals(Buffer.from(w.bytes)));
});
test('ambiguous wrap decisions reject an entire batch before saving or history',async t=>{
 const w=workspace(t,inlineCellFixture({prefix:'문'.repeat(27),wide:true,rootWidth:41000})),s=await read(w.source),operations=[{type:'insert_paragraphs',target_id:s.blocks[0].target_id,expected_old:s.blocks[0].text,paragraphs:['earlier insertion']},move(s)];
 for(const action of ['plan','edit'])await assert.rejects(runLocal({action,source:w.source,expected_sha256:s.source_sha256,operations}),/NESTED_PLACEMENT_WRAP_UNVERIFIED/);
 assert.ok(fs.readFileSync(w.source).equals(Buffer.from(w.bytes)));assert.deepEqual((await runLocal({action:'history',source:w.source,expected_sha256:s.source_sha256})).entries,[]);
});
test('identical second table remains the target after an earlier paragraph insertion',async t=>{
 const w=workspace(t,inlineCellFixture({duplicate:true,selected:1})),s=await read(w.source),operations=[{type:'insert_paragraphs',target_id:s.blocks[0].target_id,expected_old:s.blocks[0].text,paragraphs:['earlier insertion']},move(s)],saved=await runLocal({action:'edit',source:w.source,expected_sha256:s.source_sha256,operations,layout_policy:'reject_new_risk'}),a=await read(w.source);
 assert.equal(a.text_boxes[0].cell_path.at(-1).controlIndex,1);assert.equal(a.blocks.filter(b=>b.text==='inner label').length,2);assert.deepEqual(a.text_boxes[0].flow,s.text_boxes[0].flow);await runLocal({action:'restore',source:w.source,expected_sha256:a.source_sha256,backup_id:saved.backup_id});assert.ok(fs.readFileSync(w.source).equals(Buffer.from(w.bytes)));
});
test('an unrelated body table remains a placement obstacle for composed cell flow',()=>{
 const bytes=inlineCellFixture({duplicate:true,selected:1}),state=inspectLocalComplex(HwpDocument,bytes),box=state.text_boxes[0],host=state.blocks.find(b=>b.id===box.block_id);
 // Model an additional observed body table covering this cell. It has its own
 // body identity, so it must remain an obstacle even with a nested-table root.
 class WithOtherBodyTable extends HwpDocument{getPageControlLayout(page){const result=JSON.parse(super.getPageControlLayout(page)),root=result.controls.find(c=>c.type==='table'&&c.stableIndex.length===3);result.controls.push({...root,paraIdx:99,stableIndex:[0,99,0]});return JSON.stringify(result);}}
 assert.throws(()=>placeNestedFloating(WithOtherBodyTable,bytes,state,{selected:box,b:host,flow:box.flow},150),/NO_FLOATING_PLACEMENT_SPACE/);
});
