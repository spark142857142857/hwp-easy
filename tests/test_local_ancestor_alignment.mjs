import test from 'node:test';import assert from 'node:assert/strict';import fs from 'node:fs';
import {HwpDocument} from '@rhwp/core';
import {initializeLocal} from '../src/one_hwp/local_runner.mjs';
import {ancestorAlignmentFixture,ancestorAlignmentProfiles} from './local_ancestor_alignment_fixtures.mjs';
import {openLocalRenderView,renderLocalPreview} from '../src/one_hwp/local_render_view.mjs';
import {captureRenderedLayout} from '../src/one_hwp/local_rendered_layout.mjs';
import {inspectLocalComplex} from '../src/one_hwp/local_complex.mjs';
import {view} from '../src/one_hwp/local_complex_records.mjs';
import {publishVerifiedPatch} from '../src/one_hwp/local_verified_patch.mjs';
import {digest} from '../src/one_hwp/local_file.mjs';
initializeLocal(fs.readFileSync(new URL('../node_modules/@rhwp/core/rhwp_bg.wasm',import.meta.url)));
for(const p of ancestorAlignmentProfiles)test(`single host ancestor origin matches native frames: ${p.name}`,()=>{
 const bytes=ancestorAlignmentFixture(p),hash=digest(bytes),before=inspectLocalComplex(HwpDocument,bytes,{includeDocumentInfo:false,verifyCharacterModel:false}),v=openLocalRenderView(HwpDocument,bytes);
 try{
  assert.deepEqual(v.unadapted_tables,[]);assert.equal(v.nested_tables.length,(p.depth??2)-1);
  const tables=JSON.parse(v.document.getPageControlLayout(0)).controls.map(c=>v.remap(c,0)).filter(c=>c.type==='table');assert.equal(tables.length,p.native_y.length);
  tables.forEach((t,i)=>assert.ok(Math.abs(t.y-p.native_y[i])<.2,`${t.y} versus native ${p.native_y[i]}`));
  for(const t of v.nested_tables){assert.equal(t.ancestor_alignment,p.ancestorAlignment);assert.equal(t.ancestor_alignment_shift_hwpunit===0,p.ancestorAlignment===0);}
  const runs=JSON.parse(v.document.getPageTextLayout(0)).runs.map(r=>v.remap(r,0));
  if(p.prefix!==''){const prefix=runs.find(r=>r.text===(p.prefix??'OUTER'));assert.ok(prefix);assert.ok(prefix.y+prefix.h<tables[1].y);assert.ok(Math.abs(tables[1].y-prefix.y-1728/75)<.2);}
  for(const r of runs.filter(r=>r.cellPath&&!r.render_only_synthetic)){const b=before.blocks.find(b=>b.paragraph===r.parentParaIdx&&JSON.stringify(b.cell_path)===JSON.stringify(r.cellPath));assert.ok(b);assert.equal(b.text.slice(r.charStart??0,(r.charStart??0)+r.text.length),r.text);}
 }finally{v.document.free();}
 const preview=renderLocalPreview(HwpDocument,bytes,0),s=captureRenderedLayout(HwpDocument,bytes);assert.deepEqual(preview.render_nested_tables,s.render_nested_tables);assert.equal(digest(bytes),hash);assert.deepEqual(inspectLocalComplex(HwpDocument,bytes,{includeDocumentInfo:false,verifyCharacterModel:false}).tables.map(t=>t.properties),before.tables.map(t=>t.properties));
});

for(const variant of ['unknown-alignment','unverified-prefix-width'])test(`unsupported ancestor profile stays explicit: ${variant}`,()=>{
 let bytes=ancestorAlignmentFixture({...ancestorAlignmentProfiles[1],...(variant==='unverified-prefix-width'?{prefix:'OUTER'.repeat(7)}:{})});
 if(variant==='unknown-alignment'){
  const state=inspectLocalComplex(HwpDocument,bytes,{includeDocumentInfo:false,verifyCharacterModel:false}),rs=state.recordSets.get(0).map(r=>({...r,payload:r.payload.slice()})),cell=state.tables[0].cells[0],p=view(rs[cell.start].payload);p.setUint32(4,p.getUint32(4,true)|96,true);bytes=publishVerifiedPatch(bytes,state,0,rs);
 }
 const hash=digest(bytes),preview=renderLocalPreview(HwpDocument,bytes,0);assert.deepEqual(preview.render_nested_tables,[]);assert.ok(preview.render_unadapted_tables.length);assert.equal(preview.layout_verified,false);assert.equal(digest(bytes),hash);
});

test('invalid host character reference returns the original render view',()=>{
 const original=ancestorAlignmentFixture(ancestorAlignmentProfiles[1]),state=inspectLocalComplex(HwpDocument,original,{includeDocumentInfo:false,verifyCharacterModel:false}),rs=state.recordSets.get(0).map(r=>({...r,payload:r.payload.slice()})),host=state.blocks.find(b=>b.text==='OUTER');view(rs[host.shape_record].payload).setUint32(4,65535,true);
 const bytes=publishVerifiedPatch(original,state,0,rs),hash=digest(bytes),preview=renderLocalPreview(HwpDocument,bytes,0);assert.deepEqual(preview.render_nested_tables,[]);assert.ok(preview.render_unadapted_tables.some(t=>t.reason==='nested_host_style_unverified'));assert.ok(preview.svg.startsWith('<svg'));assert.equal(digest(bytes),hash);
});
