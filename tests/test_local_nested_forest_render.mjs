import test from 'node:test';import assert from 'node:assert/strict';import fs from 'node:fs';
import {HwpDocument} from '@rhwp/core';import {initializeLocal} from '../src/one_hwp/local_runner.mjs';
import {forestRenderFixture,forestRenderProfiles} from './local_nested_forest_fixtures.mjs';
import {nestedRenderFixture} from './local_nested_render_fixtures.mjs';
import {captureRenderedLayout} from '../src/one_hwp/local_rendered_layout.mjs';
import {inspectLocalComplex} from '../src/one_hwp/local_complex.mjs';
import {prepareNestedRenderInput} from '../src/one_hwp/local_nested_render_view.mjs';
import {publishVerifiedPatch} from '../src/one_hwp/local_verified_patch.mjs';
import {view} from '../src/one_hwp/local_complex_records.mjs';import {digest} from '../src/one_hwp/local_file.mjs';
initializeLocal(fs.readFileSync(new URL('../node_modules/@rhwp/core/rhwp_bg.wasm',import.meta.url)));
for(const profile of forestRenderProfiles)test(`forest render preserves exact source identities: ${profile.name}`,()=>{
 const bytes=forestRenderFixture(profile),hash=digest(bytes),before=inspectLocalComplex(HwpDocument,bytes,{includeDocumentInfo:false,verifyCharacterModel:false}),s=captureRenderedLayout(HwpDocument,bytes);
 assert.equal(s.render_nested_tables.length,before.tables.filter(t=>t.cell_path.length).length);assert.deepEqual(s.render_unadapted_tables,[]);
 const seen=new Set();for(const page of s.pages){for(const c of page.controls.filter(c=>c.type==='table')){const original=before.tables.find(t=>t.id===c.table_id);assert.ok(original);seen.add(original.id);for(const cell of c.cells){assert.equal(cell.cellIdx,original.cells.find(v=>v.row===cell.row&&v.col===cell.col).cell);}}
  for(const r of page.body_runs.filter(r=>r.cellPath)){assert.equal(r.render_only_synthetic,undefined);const b=before.blocks.find(b=>b.paragraph===r.parentParaIdx&&JSON.stringify(b.cell_path)===JSON.stringify(r.cellPath));assert.ok(b,r.text);assert.equal(r.cellIdx,b.cell_path[0].cellIndex);assert.equal(r.cellParaIdx,b.cell_path[0].cellParaIndex);assert.equal(r.paraIdx,b.cell_paragraph);assert.ok(b.text.includes(r.text));}}
 assert.equal(seen.size,before.tables.length);assert.equal(digest(bytes),hash);
 if(profile.kind==='rows'){assert.equal(s.page_count,3);assert.equal(s.pages.find(p=>p.body_runs.some(r=>r.text==='L000')).page,profile.row?1:0);const rows=s.pages.flatMap(p=>p.controls.filter(c=>c.type==='table'&&c.table_id===before.tables[0].id).flatMap(c=>c.cells.map(c=>c.row)));assert.equal(rows.length,12);assert.equal(new Set(rows).size,6);}
});
test('same-sized siblings receive distinct original table IDs, paths and control ordinals',()=>{const s=captureRenderedLayout(HwpDocument,forestRenderFixture({count:3})),cs=s.pages[0].controls.filter(c=>c.type==='table');assert.equal(new Set(cs.map(c=>c.table_id)).size,4);assert.deepEqual(cs.slice(1).map(c=>c.controlIdx),[0,1,2]);assert.deepEqual(cs.slice(1).map(c=>c.x),[120.2,120.2,120.2]);});
test('normalized multi-paragraph alignment uses bounded natural flow',()=>{const ys=[0,1,2].map(alignment=>captureRenderedLayout(HwpDocument,forestRenderFixture({kind:'host',alignment})).pages[0].controls.filter(c=>c.type==='table')[1].y);assert.ok(ys[0]<ys[1]&&ys[1]<ys[2]);assert.ok(ys[2]-ys[0]<30);});
for(const variant of ['offset','duplicate-row','multiline-host'])test(`ambiguous forest remains original: ${variant}`,()=>{const bytes=variant==='multiline-host'?nestedRenderFixture({prefix:'A\nB'}):forestRenderFixture({kind:variant==='duplicate-row'?'rows':'siblings'}),s=inspectLocalComplex(HwpDocument,bytes,{includeDocumentInfo:false,verifyCharacterModel:false}),rs=s.recordSets.get(0).map(r=>({...r,payload:r.payload.slice()}));if(variant==='offset'){const p=view(rs[s.tables.at(-1).record_index].payload);p.setInt32(8,p.getInt32(8,true)+1,true);}if(variant==='duplicate-row')view(rs[s.tables[0].cells.at(-1).start].payload).setUint16(10,0,true);const changed=publishVerifiedPatch(bytes,s,0,rs);const out=prepareNestedRenderInput(HwpDocument,changed);assert.equal(out.tables.length,0);assert.ok(out.unadapted.length);assert.equal(digest(out.bytes),digest(changed));});

test('line-split roots retain complete-row source identities',()=>{const bytes=forestRenderFixture({kind:'rows'}),s=inspectLocalComplex(HwpDocument,bytes,{includeDocumentInfo:false,verifyCharacterModel:false}),rs=s.recordSets.get(0).map(r=>({...r,payload:r.payload.slice()})),p=view(rs[s.tables[0].table_record].payload);p.setUint32(0,(p.getUint32(0,true)&~3)|2,true);const changed=publishVerifiedPatch(bytes,s,0,rs),out=prepareNestedRenderInput(HwpDocument,changed);assert.equal(out.tables.length,1);assert.deepEqual(out.unadapted,[]);const snapshot=captureRenderedLayout(HwpDocument,changed);assert.equal(snapshot.pages.length,3);assert.ok(snapshot.pages.every(p=>p.controls.some(c=>c.type==='table'&&c.table_id===s.tables[0].id)));assert.equal(digest(changed),digest(publishVerifiedPatch(bytes,s,0,rs)));});
test('cell-boundary page fragments preserve native ancestor alignment',()=>{for(const [row,alignment,page,y]of [[0,1,0,218.5],[3,2,1,637.1]]){const s=captureRenderedLayout(HwpDocument,forestRenderFixture({kind:'rows',row,alignment})),child=s.pages[page].controls.find(c=>c.type==='table'&&c.cellPath);assert.ok(child);assert.ok(Math.abs(child.y-y)<.3);}});

test('a nested table at the root subtree end retains its last-cell identity',()=>{
 const bytes=nestedRenderFixture(),s=inspectLocalComplex(HwpDocument,bytes,{includeDocumentInfo:false,verifyCharacterModel:false}),rs=s.recordSets.get(0).map(r=>({...r,payload:r.payload.slice()})),[a,b]=s.tables[0].cells;
 view(rs[a.start].payload).setUint16(8,1,true);view(rs[b.start].payload).setUint16(8,0,true);
 const out=[...rs.slice(0,a.start),...rs.slice(b.start,b.end),...rs.slice(a.start,a.end),...rs.slice(b.end)],changed=publishVerifiedPatch(bytes,s,0,out),snapshot=captureRenderedLayout(HwpDocument,changed),tables=snapshot.pages[0].controls.filter(c=>c.type==='table');
 assert.equal(snapshot.render_nested_tables.length,1);assert.equal(tables[1].cellPath[0].cellIndex,1);assert.ok(Math.abs(tables[1].x-tables[0].x-tables[0].cells[0].w-6.8)<.3);
});
