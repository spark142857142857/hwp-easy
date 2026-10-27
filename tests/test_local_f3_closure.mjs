import test from 'node:test';import assert from 'node:assert/strict';import fs from 'node:fs';
import {HwpDocument} from '@rhwp/core';
import {initializeLocal} from '../src/one_hwp/local_runner.mjs';
import {f3ClosureProfiles,f3ClosureFixture,f3NewText} from './local_f3_closure_fixtures.mjs';
import {openLocalRenderView} from '../src/one_hwp/local_render_view.mjs';
import {captureRenderedLayout} from '../src/one_hwp/local_rendered_layout.mjs';
import {inspectLocalComplex} from '../src/one_hwp/local_complex.mjs';
import {digest} from '../src/one_hwp/local_file.mjs';
import {textBoxInsets} from '../src/one_hwp/local_text_box_metrics.mjs';
import {cellBoxFixture} from './local_placement_fixtures.mjs';
import {view} from '../src/one_hwp/local_complex_records.mjs';
import {checkedExport} from './local_complex_fixtures.mjs';
import {openPaginatedTableView} from '../src/one_hwp/local_paginated_table_view.mjs';
import {createFooterBodyInput} from '../src/one_hwp/local_fixed_render_view.mjs';
import {publishVerifiedPatch} from '../src/one_hwp/local_verified_patch.mjs';
initializeLocal(fs.readFileSync(new URL('../node_modules/@rhwp/core/rhwp_bg.wasm',import.meta.url)));
const inspect=bytes=>inspectLocalComplex(HwpDocument,bytes,{includeDocumentInfo:false,verifyCharacterModel:false});
for(const p of f3ClosureProfiles)test(`F3 acceptance: ${p.name}`,()=>{
 const bytes=f3ClosureFixture(p,true),hash=digest(bytes),s=inspect(bytes),v=openLocalRenderView(HwpDocument,bytes);
 try{
  assert.deepEqual(v.unadapted_tables,[],p.name);assert.deepEqual(v.unadapted_cells,[],p.name);assert.ok(v.document.pageCount()>=1&&v.document.pageCount()<=3);
  const selected=s.blocks.find(b=>b.text===f3NewText(p)),rows=[],allControls=[];assert.ok(selected);
  for(let page=0;page<v.document.pageCount();page++){
   const info=JSON.parse(v.document.getPageInfo(page)),controls=JSON.parse(v.document.getPageControlLayout(page)).controls.map(c=>v.remap(c,page)),runs=JSON.parse(v.document.getPageTextLayout(page)).runs.map(r=>v.remap(r,page)).filter(r=>!r.render_only_synthetic);allControls.push(...controls);
   for(const r of runs){if(r.render_fixed_region||r.paraIdx>=0xfffffff0||r.render_virtual_field_guide)continue;const b=s.blocks.find(b=>b.section===r.secIdx&&b.paragraph===(r.parentParaIdx??r.paraIdx)&&JSON.stringify(b.cell_path)===JSON.stringify(r.cellPath??[]));assert.ok(b,JSON.stringify(r));assert.equal(b.text.slice(r.charStart,r.charStart+r.text.length),r.text);assert.ok(r.y>=info.marginTop+info.marginHeader-.5&&r.y+r.h<=info.height-info.marginBottom-info.marginFooter+.5,`${p.name}: text outside body`);}
   for(const r of runs.filter(r=>r.parentParaIdx===selected.paragraph&&JSON.stringify(r.cellPath)===JSON.stringify(selected.cell_path))){const old=rows.at(-1);if(old&&old.page===page&&Math.abs(old.y-r.y)<.3)old.text+=r.text;else rows.push({page,y:r.y,text:r.text});}
   assert.ok(v.document.renderPageSvg(page).startsWith('<svg'));
  }
  assert.equal(rows.map(r=>r.text).join(''),selected.text.replaceAll('\n',''));
  if(Array.isArray(p.rows))assert.deepEqual(rows.map(r=>r.text),p.rows);
  if(p.kind==='pages'){assert.equal(v.document.pageCount(),p.lines===85?3:2);const starts=rows.filter((r,i)=>i===0||r.page!==rows[i-1].page).map(r=>r.text);assert.deepEqual(starts,p.lines===85?['L000','L038','L078']:p.depth===3?['L000','L037']:['L000','L038']);}
  if(p.kind==='columns'){assert.ok(v.flow_adaptations.some(a=>a.kind==='automatic_columns'));assert.equal(v.document.pageCount(),p.lines===85?2:1);}
  if(p.kind==='footer'){assert.ok(v.flow_adaptations.some(a=>a.kind==='fixed_footer_flow'));assert.ok(allControls.filter(c=>c.render_fixed_region).every(c=>c.render_fixed_region==='footer'));}
  if(p.kind==='fields'){const snap=captureRenderedLayout(HwpDocument,bytes);const guides=snap.pages.flatMap(p=>p.body_runs).filter(r=>r.render_virtual_field_guide);assert.equal(guides.length,3);assert.ok(guides.every(r=>r.text==='guide'&&r.source_field_ids.length===1));assert.ok(s.fields.every(f=>f.value===''));}
  if(['pages','columns','footer'].includes(p.kind)){assert.equal(v.document.exportHwp,undefined);assert.equal(v.document.exportHwpWithReport,undefined);}
 }finally{v.document.free();}
 assert.equal(digest(bytes),hash);assert.deepEqual(inspect(bytes).blocks.map(b=>[b.text,b.unit_styles]),s.blocks.map(b=>[b.text,b.unit_styles]));
});

test('text-box insets accept horizontal bounded metrics and reject unknown tails/directions',()=>{
 const bytes=cellBoxFixture({cellRelative:true,empty:true}),s=inspect(bytes),box=s.text_boxes[0],rs=s.recordSets.get(0),payload=rs[box.record_index+2].payload;
 assert.ok(textBoxInsets(s,box));for(const [at,n]of [[8,200],[10,300],[12,400],[14,500]])view(payload).setInt16(at,n,true);const inset=textBoxInsets(s,box);assert.equal(inset.width,box.properties.width-500);assert.equal(inset.height,box.properties.height-900);
 payload[32]=1;assert.equal(textBoxInsets(s,box),null);payload[32]=0;view(payload).setUint32(4,1,true);assert.equal(textBoxInsets(s,box),null);
});

test('footer projection retains an independent original header',()=>{
 const original=f3ClosureFixture(f3ClosureProfiles.find(p=>p.name==='footer-inline-table')),doc=new HwpDocument(original);let bytes;
 try{doc.createHeaderFooter(0,true,0);doc.insertTextInHeaderFooter(0,true,0,0,0,'HEADER KEEP');bytes=checkedExport(doc);}finally{doc.free();}
 const hash=digest(bytes),v=openLocalRenderView(HwpDocument,bytes);try{const runs=JSON.parse(v.document.getPageTextLayout(0)).runs.map(r=>v.remap(r,0));assert.ok(runs.some(r=>r.text==='HEADER KEEP'));assert.ok(runs.some(r=>r.text==='FOOTER TITLE'||r.text==='FOOTER'));assert.ok(v.flow_adaptations.some(a=>a.kind==='fixed_footer_flow'));}finally{v.document.free();}assert.equal(digest(bytes),hash);
});

test('a huge footer style start never expands a disposable style array',()=>{
 const bytes=f3ClosureFixture(f3ClosureProfiles.find(p=>p.name==='footer-paragraphs')),s=inspect(bytes),rs=s.recordSets.get(0).map(r=>({...r,payload:r.payload.slice()})),at=rs.findIndex(r=>r.tag===71&&Buffer.from(r.payload.subarray(0,4)).toString()==='toof'),style=rs.find((r,i)=>i>at&&r.tag===68);view(style.payload).setUint32(8,0xffffffff,true);const malformed=publishVerifiedPatch(bytes,s,0,rs);assert.equal(createFooterBodyInput(malformed,0,1),null);
});

test('pagination page limits precede observations and free the candidate',()=>{
 let freed=false;class Limit{pageCount(){return 33;}getPageInfo(){throw Error('Unexpected observation');}free(){freed=true;}}
 const bytes=f3ClosureFixture(f3ClosureProfiles.find(p=>p.name==='continued-65'),true);assert.throws(()=>openPaginatedTableView(Limit,bytes),/RENDERED_LAYOUT_PAGE_LIMIT/);assert.equal(freed,true);
});

test('repeated title text stays outside the verified partial-row compositor',()=>{
 const bytes=f3ClosureFixture(f3ClosureProfiles.find(p=>p.name==='continued-65'),true),s=inspect(bytes),rs=s.recordSets.get(0).map(r=>({...r,payload:r.payload.slice()}));for(const c of s.tables[0].cells){const p=view(rs[c.start].payload);p.setUint32(4,p.getUint32(4,true)|0x40000,true);}const changed=publishVerifiedPatch(bytes,s,0,rs),v=openLocalRenderView(HwpDocument,changed);try{assert.ok(v.unadapted_tables.length);assert.ok(!v.flow_adaptations.some(a=>a.kind==='table_row_pagination'));}finally{v.document.free();}
});
