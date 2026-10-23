import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {HwpDocument} from '@rhwp/core';
import {initializeLocal} from '../src/one_hwp/local_runner.mjs';
import {mixedRenderFixture,mixedRenderProfiles} from './local_nested_mixed_fixtures.mjs';
import {captureRenderedLayout} from '../src/one_hwp/local_rendered_layout.mjs';
import {openLocalRenderView,renderLocalPreview} from '../src/one_hwp/local_render_view.mjs';
import {inspectLocalComplex} from '../src/one_hwp/local_complex.mjs';
import {publishVerifiedPatch} from '../src/one_hwp/local_verified_patch.mjs';
import {view} from '../src/one_hwp/local_complex_records.mjs';
import {digest} from '../src/one_hwp/local_file.mjs';
initializeLocal(fs.readFileSync(new URL('../node_modules/@rhwp/core/rhwp_bg.wasm',import.meta.url)));
const inspect=b=>inspectLocalComplex(HwpDocument,b,{includeDocumentInfo:false,verifyCharacterModel:false});
for(const profile of mixedRenderProfiles)test(`mixed/column render binds original identities: ${profile.name}`,()=>{
 const bytes=mixedRenderFixture(profile),hash=digest(bytes),state=inspect(bytes),s=captureRenderedLayout(HwpDocument,bytes),page=s.pages[0];
 assert.equal(s.render_nested_tables.length,state.tables.filter(t=>t.cell_path.length).length);assert.deepEqual(s.render_unadapted_tables,[]);assert.equal(s.page_count,1);
 for(const c of page.controls){
  if(c.type==='table'){const t=state.tables.find(t=>t.id===c.table_id);assert.ok(t);for(const cell of c.cells)assert.equal(cell.cellIdx,t.cells.find(o=>o.row===cell.row&&o.col===cell.col).cell);}
  else{const o=[...state.pictures,...state.text_boxes].find(o=>JSON.stringify(o.cell_path)===JSON.stringify(c.cellPath)&&o.control_index===c.controlIdx);assert.ok(o);assert.deepEqual(c.stableIndex,[0,1,...o.cell_path.flatMap(p=>[p.controlIndex,p.cellIndex,p.cellParaIndex]),o.control_index]);}
 }
 for(const r of page.body_runs){
  assert.equal(r.render_only_synthetic,undefined);
  if(r.text_box_id){const o=state.text_boxes.find(o=>o.id===r.text_box_id);assert.ok(o);assert.equal(r.text_box_paragraph,0);assert.ok(o.paragraphs[0].text.includes(r.text));assert.deepEqual(r.cellPath,o.cell_path);}
  else{const b=state.blocks.find(b=>b.paragraph===(r.parentParaIdx??r.paraIdx)&&JSON.stringify(b.cell_path)===JSON.stringify(r.cellPath??[]));assert.ok(b,JSON.stringify(r));assert.ok(b.text.includes(r.text));}
 }
 assert.equal(digest(bytes),hash);
 if(profile.kind==='columns'||profile.columns){
  const root=page.controls.find(c=>c.type==='table'&&!c.cellPath),frame=page.info.columns[profile.column];assert.ok(Math.abs(root.x-frame.x)<.2);assert.ok(root.x+root.w<=frame.x+frame.width+.2);assert.ok(Math.abs(root.y-(profile.column?132.3:153.6))<.2);
  assert.equal(page.body_runs.find(r=>r.text==='HEAD').x,113.4);assert.ok(page.body_runs.filter(r=>r.text==='TAIL'||r.text==='END').every(r=>Math.abs(r.x-frame.x)<.2));
  const v=openLocalRenderView(HwpDocument,bytes);try{assert.equal(v.document.exportHwp,undefined);assert.equal(v.document.exportHwpWithReport,undefined);assert.ok(v.document.renderPageSvg(0).includes('column-'));assert.throws(()=>v.document.renderPageSvg(1),/Invalid page/);}finally{v.document.free();}
 }
});
test('inline object advance contributes to ancestor alignment and following table origin',()=>{
 const ys=[0,1,2].map(alignment=>captureRenderedLayout(HwpDocument,mixedRenderFixture({kind:'objects',alignment})).pages[0].controls.filter(c=>c.type==='table').map(c=>c.y));
 for(const [i,expected]of [[0,[153.6,199.9,470.7]],[1,[153.6,274.4,545.3]],[2,[153.6,349,619.8]]])for(let n=0;n<3;n++)assert.ok(Math.abs(ys[i][n]-expected[n])<.2);
});
test('single-column rendering never constructs a column candidate document',async()=>{
 const {openColumnRenderView}=await import('../src/one_hwp/local_column_render_view.mjs');const bytes=mixedRenderFixture();
 class NoColumnEngine{constructor(){throw Error('Unexpected column candidate');}}
 assert.equal(openColumnRenderView(NoColumnEngine,bytes,()=>{throw Error('Unexpected single-column decomposition');}),null);
});
test('column page limits precede page observations and always free the candidate',async()=>{
 const {openColumnRenderView}=await import('../src/one_hwp/local_column_render_view.mjs');let freed=false;const bytes=mixedRenderFixture({kind:'columns'});
 class TooManyPages{pageCount(){return 33;}getPageInfo(){throw Error('Must not observe pages beyond the limit');}free(){freed=true;}}
 assert.throws(()=>openColumnRenderView(TooManyPages,bytes,()=>{throw Error('Must not split oversized input');}),/RENDERED_LAYOUT_PAGE_LIMIT/);assert.equal(freed,true);
});
for(const kind of ['empty-field','rotation','line-spacing','object-margin','extra-object-text','column-weight','column-overflow','column-reverse','column-rule','column-border','page-break'])test(`ambiguous mixed/column view remains explicit: ${kind}`,()=>{
 let bytes=mixedRenderFixture({kind:kind.startsWith('column')||kind==='page-break'?'columns':kind==='empty-field'?'fields':'objects',column:1,unequal:kind==='column-weight',empty:kind==='empty-field'});const state=inspect(bytes),rs=state.recordSets.get(0).map(r=>({...r,payload:r.payload.slice()}));
 if(kind==='rotation'){const o=state.pictures[0];view(rs[o.record_index+1].payload).setInt16(40,15,true);}
 if(kind==='line-spacing'){const o=state.pictures[0],p=view(rs[o.record_index].payload);p.setUint32(4,p.getUint32(4,true)&~4,true);}
 if(kind==='object-margin')view(rs[state.pictures[0].record_index].payload).setUint16(28,100,true);
 if(kind==='extra-object-text'){const b=state.blocks.find(b=>b.id===state.pictures[0].block_id);rs[b.text_record].payload=Buffer.concat([Buffer.from('X','utf16le'),rs[b.text_record].payload]);view(rs[b.record_index].payload).setUint32(0,rs[b.text_record].payload.length/2,true);}
 const col=rs.find(r=>r.tag===71&&Buffer.from(r.payload.subarray(0,4)).toString()==='dloc');if(kind==='column-weight')view(col.payload).setInt16(8,11001,true);if(kind==='column-reverse')view(col.payload).setUint16(4,view(col.payload).getUint16(4,true)|1024,true);if(kind==='column-rule')col.payload[col.payload.length-1]=1;if(kind==='column-border')view(rs.find(r=>r.tag===75).payload).setUint16(12,3,true);if(kind==='column-overflow')view(rs[state.tables[0].record_index].payload).setUint32(16,40000,true);if(kind==='page-break')rs[state.blocks.find(b=>b.id===state.tables[0].parent_id).record_index].payload[11]=12;
 bytes=publishVerifiedPatch(bytes,state,0,rs);const hash=digest(bytes),preview=renderLocalPreview(HwpDocument,bytes,0);assert.equal(preview.render_nested_tables.length,0);assert.ok(preview.render_unadapted_tables.length);assert.equal(preview.layout_verified,false);assert.equal(digest(bytes),hash);
});
