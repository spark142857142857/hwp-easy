import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {HwpDocument} from '@rhwp/core';
import {initializeLocal} from '../src/one_hwp/local_runner.mjs';
import {editLocalBatch} from '../src/one_hwp/local_batch.mjs';
import {openLocalRenderView} from '../src/one_hwp/local_render_view.mjs';
import {adaptDrawingRenderView} from '../src/one_hwp/local_drawing_render_view.mjs';
import {parseEngineSvg,drawingSvgPoints,svgPoint} from '../src/one_hwp/local_svg_scene.mjs';
import {projectCellLines} from '../src/one_hwp/local_cell_render_wrap.mjs';
import {digest} from '../src/one_hwp/local_file.mjs';
import {view} from '../src/one_hwp/local_complex_records.mjs';
import {createLocalComplexSnapshot} from '../src/one_hwp/local_complex.mjs';
import {f4Inspect,f4Patch} from './local_f4_fixtures.mjs';
import {drawingRenderProfiles,drawingRenderFixture,drawingRenderOperations} from './local_drawing_render_fixtures.mjs';
initializeLocal(fs.readFileSync(new URL('../node_modules/@rhwp/core/rhwp_bg.wasm',import.meta.url)));

// Use the same public source identities as the request interface without disk IO.
async function rotated(profile){const bytes=await drawingRenderFixture(profile),state=createLocalComplexSnapshot(HwpDocument,bytes,digest(bytes)).read({expected_sha256:digest(bytes),max_blocks:128,max_chars:64000}),result=await editLocalBatch(HwpDocument,bytes,digest(bytes),drawingRenderOperations(state,profile));return result.bytes;}
for(const profile of drawingRenderProfiles)test(`I3 source identities and complete horizontal group text: ${profile.name}`,async()=>{
 const bytes=await rotated(profile),hash=digest(bytes),raw=f4Inspect(bytes),render=openLocalRenderView(HwpDocument,bytes);
 try{
  assert.deepEqual(render.unadapted_drawings,[]);assert.ok(render.drawing_adaptations.length);assert.equal(render.document.exportHwp,undefined);assert.equal(render.document.applyCharFormat,undefined);
  const runs=[];for(let p=0;p<render.document.pageCount();p++){
   const svg=render.document.renderPageSvg(p),nodes=parseEngineSvg(svg);runs.push(...JSON.parse(render.document.getPageTextLayout(p)).runs);
   for(const n of nodes.filter(n=>n.attrs['data-hwp-drawing-text']))for(let a=n.parent;a;a=a.parent)assert.equal(a.attrs['clip-path'],undefined,'floating paper-relative text cannot inherit cell/body clips');
  }
  for(const box of raw.text_boxes)for(const p of box.paragraphs){const actual=runs.filter(r=>r.source_paragraph_id===p.id);assert.equal(actual.map(r=>r.text).join(''),p.text.replaceAll('\n',''));for(const r of actual){assert.equal(p.text.slice(r.charStart,r.charStart+r.text.length),r.text);assert.equal(r.text_box_id,box.id);assert.deepEqual(r.cellPath,box.cell_path);assert.equal(r.drawing_transform[0],1);assert.equal(r.drawing_transform[4],1);assert.equal(r.drawing_transform[1],0);}}
  assert.equal(digest(bytes),hash);
 }finally{render.document.free();}
});

test('unsupported rotated text profile preserves the original view and warning',async()=>{
 let bytes=await rotated(drawingRenderProfiles[0]);const raw=f4Inspect(bytes),box=raw.text_boxes[0];
 bytes=f4Patch(bytes,rs=>{view(rs[box.list_record].payload).setInt16(8,30000,true);});
 const render=openLocalRenderView(HwpDocument,bytes);try{assert.ok(render.unadapted_drawings.length);assert.ok(render.unadapted_drawings.some(d=>d.adaptation_reason));assert.equal(render.drawing_adaptations.length,0);}finally{render.document.free();}
});

test('extra coincident SVG candidate refuses identity assignment without partial replacement',async()=>{
 const bytes=await rotated(drawingRenderProfiles[0]),base=openLocalRenderView(HwpDocument,bytes,true,false),doc=base.document,original=doc.renderPageSvg(0),node=parseEngineSvg(original).find(n=>n.name==='path'&&drawingSvgPoints(n));assert.ok(node);
 const svg=original.slice(0,node.end)+original.slice(node.start,node.end)+original.slice(node.end),fake=new Proxy(doc,{get(target,key){if(key==='renderPageSvg')return()=>svg;const value=target[key];return typeof value==='function'?value.bind(target):value;}});
 try{const adapted=adaptDrawingRenderView(HwpDocument,bytes,{...base,document:fake});assert.equal(adapted.drawing_adaptations.length,0);assert.ok(adapted.unadapted_drawings.some(d=>d.adaptation_reason==='DRAWING_SVG_IDENTITY_UNVERIFIED'));assert.equal(adapted.document.renderPageSvg(0),svg);}finally{doc.free();}
});

test('field word boundaries wrap independently without changing text offsets',()=>{
 const p=projectCellLines('FIEDIT VALUERST VALUE',Array(20).fill(1),13,new Set([2,12]));assert.equal(p.text.replaceAll('\n',''),'FIEDIT VALUERST VALUE');assert.equal(p.text,'FIEDIT VALUE\nRST VALUE');
 for(let i=0;i<p.text.length;i++)if(!p.synthetic.has(i))assert.equal(p.text[i],'FIEDIT VALUERST VALUE'[p.offsets[i]]);
});

test('bounded SVG parser accounts for transforms and nested viewports, excludes defs and invalid transforms',()=>{
 const nodes=parseEngineSvg('<svg><defs><rect width="10" height="20"/></defs><g transform="translate(10 20)"><svg x="5" y="6" width="100" height="50" viewBox="0 0 20 10"><rect width="2" height="3"/></svg></g><g transform="translate(1 bogus 2)"><rect width="2" height="3"/></g></svg>');
 const rects=nodes.filter(n=>n.name==='rect');assert.equal(drawingSvgPoints(rects[0]),null);assert.deepEqual(svgPoint(rects[1].matrix,2,3),[25,41]);assert.equal(drawingSvgPoints(rects[2]),null);
 assert.throws(()=>parseEngineSvg('<svg><g></svg>'),/DRAWING_SVG_STRUCTURE_UNVERIFIED/);
 assert.throws(()=>parseEngineSvg('<svg>'+'<g>'.repeat(130)),/RENDER_DRAWING_SVG_LIMIT/);
 assert.equal(drawingSvgPoints(parseEngineSvg('<svg><rect width="2" height="3"></rect></svg>')[1]),null);
});
