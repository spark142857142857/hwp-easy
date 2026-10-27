import test from 'node:test';import assert from 'node:assert/strict';import fs from 'node:fs';
import {HwpDocument} from '@rhwp/core';
import {initializeLocal} from '../src/one_hwp/local_runner.mjs';
import {cellWrapRenderFixture,cellWrapRenderProfiles} from './local_cell_wrap_render_fixtures.mjs';
import {openLocalRenderView,renderLocalPreview} from '../src/one_hwp/local_render_view.mjs';
import {captureRenderedLayout,analyzeRenderedLayout} from '../src/one_hwp/local_rendered_layout.mjs';
import {inspectLocalComplex,editLocalComplex} from '../src/one_hwp/local_complex.mjs';
import {view,encodeRecords} from '../src/one_hwp/local_complex_records.mjs';
import {parseRecords} from '../probes/sites-runtime/guard/records.mjs';
import {publishVerifiedPatch} from '../src/one_hwp/local_verified_patch.mjs';
import {mixedRenderFixture} from './local_nested_mixed_fixtures.mjs';
import {tableAnswer} from './local_table_reflow_fixtures.mjs';
import {digest} from '../src/one_hwp/local_file.mjs';
initializeLocal(fs.readFileSync(new URL('../node_modules/@rhwp/core/rhwp_bg.wasm',import.meta.url)));
const inspect=bytes=>inspectLocalComplex(HwpDocument,bytes,{includeDocumentInfo:false,verifyCharacterModel:false});
for(const p of cellWrapRenderProfiles)test(`narrow cell rows, padding and original offsets: ${p.name}`,()=>{
 const bytes=cellWrapRenderFixture(p,true),hash=digest(bytes),state=inspect(bytes),selected=state.blocks.find(b=>b.text===p.text),v=openLocalRenderView(HwpDocument,bytes);
 try{
  assert.equal(v.cell_wraps.length,1);assert.deepEqual(v.unadapted_cells,[]);assert.deepEqual(v.unadapted_tables,[]);
  const runs=JSON.parse(v.document.getPageTextLayout(0)).runs.map(r=>v.remap(r,0)).filter(r=>JSON.stringify(r.cellPath)===JSON.stringify(selected.cell_path));
  assert.deepEqual(runs.map(r=>r.text),p.rows);assert.equal(v.cell_wraps[0].render_lines,p.rows.length);
  const table=JSON.parse(v.document.getPageControlLayout(0)).controls.map(c=>v.remap(c,0)).find(c=>c.type==='table'&&JSON.stringify(c.cellPath??[])===JSON.stringify(selected.cell_path.slice(0,-1))),cell=table.cells.find(c=>c.cellIdx===selected.cell_path.at(-1).cellIndex);
  for(const r of runs){assert.equal(selected.text.slice(r.charStart,r.charStart+r.text.length),r.text);assert.equal(r.paraShapeId,selected.paragraph_properties.paraShapeId);assert.ok(Math.abs(r.x-cell.x-6.8)<.2);assert.ok(r.y>=cell.y&&r.y+r.h<=cell.y+cell.h);}
  assert.ok(v.document.renderPageSvg(0).startsWith('<svg'));
 }finally{v.document.free();}
 const preview=renderLocalPreview(HwpDocument,bytes,0),snapshot=captureRenderedLayout(HwpDocument,bytes),report=analyzeRenderedLayout(HwpDocument,bytes);
 assert.deepEqual(preview.render_cell_wraps,snapshot.render_cell_wraps);assert.deepEqual(report.render_cell_wraps,preview.render_cell_wraps);assert.equal(report.layout_verified,false);assert.equal(report.diagnostics_complete,false);assert.ok(report.engine_limitations.some(l=>l.code==='CELL_WRAP_RENDER_ADAPTED'));assert.equal(digest(bytes),hash);assert.deepEqual(inspect(bytes).blocks.map(b=>[b.text,b.unit_styles]),state.blocks.map(b=>[b.text,b.unit_styles]));
});
for(const variant of ['bold','mixed-size','unsupported-character','word-break','spacing','private-offset-mismatch','font-trace-missing','font-trace-ambiguous','font-metric-fallback'])test(`unverified cell wrapping stays explicit: ${variant}`,()=>{
 let bytes=cellWrapRenderFixture(cellWrapRenderProfiles[0],true),s=inspect(bytes),b=s.blocks.find(b=>b.text===cellWrapRenderProfiles[0].text),Engine=HwpDocument;
 if(['bold','mixed-size','unsupported-character'].includes(variant)){
  const hash=digest(bytes),op=variant==='unsupported-character'?{type:'splice_text',start:0,end:b.text.length,new_text:b.text+'!'}:{type:'format_text',start:0,end:variant==='bold'?b.text.length:1,props:variant==='bold'?{bold:true}:{fontSize:1100}};
  bytes=editLocalComplex(HwpDocument,bytes,hash,{...op,target_id:`hwp5:${hash}:${Buffer.from(b.id).toString('base64url')}`,expected_old:b.text}).bytes;
 }
 if(variant==='word-break'){
  const definitions=[...parseRecords(s.raw.streams.get('DocInfo'))].map(r=>({...r,payload:r.payload.slice()})),shape=definitions.filter(r=>r.tag===25)[b.paragraph_properties.paraShapeId];view(shape.payload).setUint32(0,view(shape.payload).getUint32(0,true)^32,true);
  bytes=publishVerifiedPatch(bytes,s,0,s.recordSets.get(0),encodeRecords(definitions));
 }
 if(variant==='spacing'){
  const definitions=[...parseRecords(s.raw.streams.get('DocInfo'))].map(r=>({...r,payload:r.payload.slice()})),shape=definitions.filter(r=>r.tag===21)[b.unit_styles[0]];shape.payload[21]=1;
  bytes=publishVerifiedPatch(bytes,s,0,s.recordSets.get(0),encodeRecords(definitions));
 }
 if(variant==='private-offset-mismatch')Engine=class extends HwpDocument{getPageTextLayout(...args){const t=JSON.parse(super.getPageTextLayout(...args));for(const r of t.runs)r.charStart=999;return JSON.stringify(t);}};
 if(variant.startsWith('font-'))Engine=class extends HwpDocument{getFontDecisionTrace(...args){const t=JSON.parse(super.getFontDecisionTrace(...args));if(variant==='font-trace-missing')t.records=[];if(variant==='font-trace-ambiguous')t.records.push(...t.records);if(variant==='font-metric-fallback')for(const r of t.records)r.layoutMetric.widthSource='heuristic';return JSON.stringify(t);}};
 const v=openLocalRenderView(Engine,bytes);try{assert.deepEqual(v.cell_wraps,[]);assert.ok(v.unadapted_cells.length||v.unadapted_tables.length);}finally{v.document.free();}
});

for(const columnCount of [2,4])test(`column cell wrap metadata uses original source identity: ${columnCount}`,()=>{
 let bytes=mixedRenderFixture({kind:'columns',column:columnCount-1,columnCount,alignment:0}),s=inspect(bytes),b=s.blocks.find(b=>b.text===tableAnswer(8)),hash=digest(bytes),text=cellWrapRenderProfiles[1].text;
 bytes=editLocalComplex(HwpDocument,bytes,hash,{type:'splice_text',target_id:`hwp5:${hash}:${Buffer.from(b.id).toString('base64url')}`,expected_old:b.text,start:0,end:b.text.length,new_text:text}).bytes;
 const v=openLocalRenderView(HwpDocument,bytes);try{assert.equal(v.cell_wraps.length,1);assert.equal(v.cell_wraps[0].column,columnCount-1);assert.equal(v.cell_wraps[0].block_id,b.id);assert.deepEqual(v.cell_wraps[0].cell_path,b.cell_path);assert.equal(v.cell_wraps[0].paragraph,b.paragraph);assert.ok(v.document.renderPageSvg(0).includes('column-'));const runs=JSON.parse(v.document.getPageTextLayout(0)).runs.filter(r=>r.parentParaIdx===b.paragraph&&JSON.stringify(r.cellPath)===JSON.stringify(b.cell_path));assert.equal(runs.map(r=>r.text).join(''),text);for(const r of runs)assert.equal(text.slice(r.charStart,r.charStart+r.text.length),r.text);}finally{v.document.free();}
});
