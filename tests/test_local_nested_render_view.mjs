import test from 'node:test';import assert from 'node:assert/strict';import fs from 'node:fs';
import {HwpDocument} from '@rhwp/core';import {initializeLocal} from '../src/one_hwp/local_runner.mjs';
import {nestedRenderFixture,nestedRenderProfiles} from './local_nested_render_fixtures.mjs';
import {captureRenderedLayout,analyzeRenderedLayout} from '../src/one_hwp/local_rendered_layout.mjs';
import {renderLocalPreview,openLocalRenderView} from '../src/one_hwp/local_render_view.mjs';
import {inspectLocalComplex} from '../src/one_hwp/local_complex.mjs';
import {publishVerifiedPatch} from '../src/one_hwp/local_verified_patch.mjs';
import {view} from '../src/one_hwp/local_complex_records.mjs';
import {digest} from '../src/one_hwp/local_file.mjs';
initializeLocal(fs.readFileSync(new URL('../node_modules/@rhwp/core/rhwp_bg.wasm',import.meta.url)));
for(const p of nestedRenderProfiles)test(`nested render origin, prefix, alignment and source identity: ${p.name}`,()=>{
 const bytes=nestedRenderFixture(p),prior=digest(bytes),before=inspectLocalComplex(HwpDocument,bytes,{includeDocumentInfo:false,verifyCharacterModel:false}),raw=new HwpDocument(bytes);let identities;try{identities=JSON.parse(raw.getPageControlLayout(0)).controls.filter(c=>c.type==='table').map(c=>c.stableIndex);}finally{raw.free();}
 const s=captureRenderedLayout(HwpDocument,bytes),report=analyzeRenderedLayout(HwpDocument,bytes),preview=renderLocalPreview(HwpDocument,bytes,0),page=s.pages[0],tables=page.controls.filter(c=>c.type==='table');
 assert.equal(s.render_nested_tables.length,p.depth-1);assert.deepEqual(s.render_unadapted_tables,[]);assert.deepEqual(tables.map(c=>c.stableIndex),identities);
 for(let i=1;i<tables.length;i++){assert.ok(Math.abs(tables[i].x-(tables[i-1].x+6.8))<.2);assert.ok(Math.abs(tables[i].y-(tables[i-1].y+1.88+1728/75))<.2);}
 const outer=page.body_runs.find(r=>r.text==='OUTER');assert.ok(outer);assert.ok(outer.y+outer.h<tables[1].y);assert.ok(Math.abs(outer.y-(tables[0].y+1.88))<.2);
 for(const r of page.body_runs.filter(r=>r.cellPath))assert.ok(before.blocks.some(b=>b.cell_path.length===r.cellPath.length&&JSON.stringify(b.cell_path)===JSON.stringify(r.cellPath)&&b.text.includes(r.text)),r.text);
 assert.ok(report.engine_limitations.some(l=>l.code==='NESTED_TABLE_RENDER_ADAPTED'));assert.equal(report.layout_verified,false);assert.equal(report.diagnostics_complete,false);assert.deepEqual(preview.render_nested_tables,s.render_nested_tables);assert.equal(digest(bytes),prior);
 assert.ok(s.render_nested_tables.every(t=>t.ancestor_alignment===p.alignment));
 const after=inspectLocalComplex(HwpDocument,bytes,{includeDocumentInfo:false,verifyCharacterModel:false});assert.deepEqual(after.tables.map(t=>t.properties),before.tables.map(t=>t.properties));
});
for(const variant of ['inline','offset','columns','margins','cell-direction','height'])test(`unknown nested render profile remains explicit: ${variant}`,()=>{
 const bytes=nestedRenderFixture(),s=inspectLocalComplex(HwpDocument,bytes,{includeDocumentInfo:false,verifyCharacterModel:false}),rs=s.recordSets.get(0).map(r=>({...r,payload:r.payload.slice()})),child=s.tables[1],p=view(rs[child.record_index].payload);
 if(variant==='inline')p.setUint32(4,p.getUint32(4,true)|1,true);
 if(variant==='offset')p.setInt32(12,100,true);
 if(variant==='margins')p.setUint16(28,100,true);
 if(variant==='cell-direction'){const q=view(rs[s.tables[0].cells[0].start].payload);q.setUint32(4,q.getUint32(4,true)|1,true);}
 if(variant==='columns'){const col=rs.find(r=>r.tag===71&&Buffer.from(r.payload.subarray(0,4)).toString()==='dloc');view(col.payload).setUint16(4,(view(col.payload).getUint16(4,true)&~1020)|(2<<2),true);}
 if(variant==='height')for(const c of s.tables[0].cells)view(rs[c.start].payload).setUint32(20,c.height+100,true);
 const changed=publishVerifiedPatch(bytes,s,0,rs),hash=digest(changed),r=renderLocalPreview(HwpDocument,changed,0);assert.equal(r.render_nested_tables.length,0);assert.ok(r.render_unadapted_tables.length);assert.equal(r.layout_verified,false);assert.equal(digest(changed),hash);
});
test('nested render views never export or alter original targets',()=>{
 const bytes=nestedRenderFixture({depth:3,floating:true}),prior=digest(bytes),v=openLocalRenderView(HwpDocument,bytes);
 v.document.exportHwpWithReport=()=>{throw Error('Private render document cannot export');};try{assert.equal(v.nested_tables.length,2);assert.ok(v.document.renderPageSvg(0).startsWith('<svg'));}finally{v.document.free();}
 assert.equal(digest(bytes),prior);assert.throws(()=>renderLocalPreview(HwpDocument,bytes,-1),/Invalid page/);
});
