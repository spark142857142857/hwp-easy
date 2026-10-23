import test from 'node:test';import assert from 'node:assert/strict';import fs from 'node:fs';import os from 'node:os';import path from 'node:path';
import {HwpDocument} from '@rhwp/core';import {initializeLocal,runLocal} from '../src/one_hwp/local_runner.mjs';
import {renderViewFixture,renderViewProfiles} from './local_render_view_fixtures.mjs';import {floatingFixture} from './local_reflow_fixtures.mjs';
import {captureRenderedLayout,analyzeRenderedLayout,intersects} from '../src/one_hwp/local_rendered_layout.mjs';
import {renderLocalPreview,adaptEmptyFloatingAnchors} from '../src/one_hwp/local_render_view.mjs';
import {inspectLocalComplex} from '../src/one_hwp/local_complex.mjs';import {view} from '../src/one_hwp/local_complex_records.mjs';import {publishVerifiedPatch} from '../src/one_hwp/local_verified_patch.mjs';import {digest} from '../src/one_hwp/local_file.mjs';import {assertPlannedEdit} from '../scripts/local-plan-proof.mjs';
initializeLocal(fs.readFileSync(new URL('../node_modules/@rhwp/core/rhwp_bg.wasm',import.meta.url)));
for(const profile of renderViewProfiles)test(`private render view honors empty floating anchor heights: ${profile.name}`,()=>{
 const bytes=renderViewFixture(profile),before=Buffer.from(bytes),raw=new HwpDocument(bytes);try{const first=JSON.parse(raw.getPageControlLayout(0)).controls.filter(c=>['image','shape'].includes(c.type));if(first.length>1)assert.ok(intersects(first[0],first[1]));}finally{raw.free();}
 const snapshot=captureRenderedLayout(HwpDocument,bytes),report=analyzeRenderedLayout(HwpDocument,bytes),preview=renderLocalPreview(HwpDocument,bytes,0);
 assert.equal(snapshot.render_adaptations.length,profile.objects.length);assert.deepEqual(snapshot.render_unadapted_anchors,[]);assert.equal(report.issues.some(i=>i.code.startsWith('FLOATING_OBJECT')),false);
 assert.equal(report.status,'inconclusive');assert.equal(report.diagnostics_complete,false);assert.equal(report.layout_verified,false);assert.ok(report.engine_limitations.some(l=>l.code==='EMPTY_FLOATING_ANCHOR_RENDER_ADAPTED'));
 assert.deepEqual(preview.render_adaptations,snapshot.render_adaptations);assert.ok(preview.svg.startsWith('<svg'));assert.equal(preview.layout_verified,false);
 for(const page of snapshot.pages){const objects=page.controls.filter(c=>['image','shape'].includes(c.type));for(let i=0;i<objects.length;i++)for(let j=i+1;j<objects.length;j++)assert.equal(intersects(objects[i],objects[j]),false);for(const a of snapshot.render_adaptations)assert.equal(page.body_runs.some(r=>r.secIdx===a.section&&r.paraIdx===a.paragraph),false);}
 assert.ok(Buffer.from(bytes).equals(before));const reopened=inspectLocalComplex(HwpDocument,bytes,{includeDocumentInfo:false,verifyCharacterModel:false});for(const o of [...reopened.pictures,...reopened.text_boxes])assert.equal(reopened.blocks.find(b=>b.id===o.block_id).text,'');
});
for(const variant of ['too-short','offset','rotation','mixed-spacing','columns'])test(`unknown render-anchor profile stays observable: ${variant}`,()=>{
 const bytes=renderViewFixture({objects:['picture','box']}),s=inspectLocalComplex(HwpDocument,bytes,{includeDocumentInfo:false,verifyCharacterModel:false}),rs=s.recordSets.get(0).map(r=>({...r,payload:r.payload.slice()})),pic=s.pictures[0];
 if(variant==='too-short')view(rs[pic.record_index].payload).setUint32(20,10000,true);
 if(variant==='offset')view(rs[pic.record_index].payload).setInt32(8,100,true);
 if(variant==='rotation')view(rs[pic.record_index+1].payload).setInt16(40,90,true);
 if(variant==='mixed-spacing')view(rs[pic.record_index].payload).setUint32(4,view(rs[pic.record_index].payload).getUint32(4,true)|4,true);
 if(variant==='columns'){const col=rs.find(r=>r.tag===71&&Buffer.from(r.payload.subarray(0,4)).toString()==='dloc');view(col.payload).setUint16(4,(view(col.payload).getUint16(4,true)&~1020)|(2<<2),true);}
 const changed=publishVerifiedPatch(bytes,s,0,rs),prior=Buffer.from(changed),report=analyzeRenderedLayout(HwpDocument,changed),preview=renderLocalPreview(HwpDocument,changed,0);
 assert.ok(report.render_unadapted_anchors.length);assert.ok(report.engine_limitations.some(l=>l.code==='EMPTY_FLOATING_ANCHOR_RENDER_UNVERIFIED'));assert.equal(report.diagnostics_complete,false);assert.ok(preview.render_unadapted_anchors.length);assert.ok(Buffer.from(changed).equals(prior));
 if(variant==='too-short')assert.ok(report.issues.some(i=>i.code==='FLOATING_OBJECT_INTERSECTION'||i.code==='FLOATING_OBJECT_TEXT_INTERSECTION'));
});
test('ordinary floating collisions and visible host text are not normalized',()=>{
 const bytes=floatingFixture(),r=analyzeRenderedLayout(HwpDocument,bytes);assert.deepEqual(r.render_adaptations,[]);assert.ok(r.issues.some(i=>i.code==='FLOATING_OBJECT_TEXT_INTERSECTION'));assert.deepEqual(renderLocalPreview(HwpDocument,bytes,0).render_adaptations,[]);
});
test('render-view mutation cannot reach source bytes or export, including exceptions',()=>{
 const bytes=renderViewFixture(),copy=Buffer.from(bytes),doc=new HwpDocument(bytes);doc.exportHwpWithReport=()=>{throw Error('Render view must never export HWP');};
 try{const result=adaptEmptyFloatingAnchors(doc,bytes);assert.equal(result.anchors.length,2);assert.equal(doc.getTextRange(0,result.anchors[0].paragraph,0,1),' ');}finally{doc.free();}
 assert.throws(()=>renderLocalPreview(HwpDocument,bytes,-1),/Invalid page/);assert.ok(Buffer.from(bytes).equals(copy));
});
test('preview and diagnosis stay read only; edited thumbnail, same-file save and exact restore agree',async t=>{
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'hwp-render-view-'));t.after(()=>{assert.equal(path.dirname(dir),os.tmpdir());assert.ok(path.basename(dir).startsWith('hwp-render-view-'));fs.rmSync(dir,{recursive:true,force:true});});
 const source=path.join(dir,'공백 경로 문서.hwp'),bytes=renderViewFixture({footer:true});fs.writeFileSync(source,bytes);const read=()=>runLocal({action:'read',source,max_chars:64000,max_blocks:128}),before=await read(),box=before.text_boxes[0],request={source,expected_sha256:before.source_sha256,operations:[{type:'splice_text_box',target_id:box.paragraphs[0].target_id,expected_old:'BOX',expected_properties:box.properties,start:0,end:3,new_text:'NEW'}]};
 for(const action of ['preview','layout']){const r=await runLocal({action,source,expected_sha256:before.source_sha256,...(action==='layout'?{scope:'rendered'}:{})});assert.equal(r.saved,false);assert.equal(r.render_adaptations.length,2);assert.equal(r.source_sha256,digest(bytes));}
 const plan=await runLocal({action:'plan',...request});assert.deepEqual(fs.readFileSync(source),Buffer.from(bytes));assert.equal(fs.existsSync(path.join(dir,'.hwp-easy-backups')),false);
 const saved=await runLocal({action:'edit',...request});assertPlannedEdit(plan,saved,'render-view');assert.equal(saved.saved_path,source);assert.equal(saved.preview_cache.status,'updated');assert.equal(saved.preview_cache.render_adaptations.length,2);const after=await read();assert.equal(after.text_boxes[0].paragraphs[0].text,'NEW');for(const o of [...after.pictures,...after.text_boxes])assert.equal(after.blocks.find(b=>b.id===o.block_id).text,'');
 const edited=fs.readFileSync(source),p=await runLocal({action:'preview',source,expected_sha256:after.source_sha256});assert.equal(p.render_adaptations.length,2);await runLocal({action:'restore',source,expected_sha256:after.source_sha256,backup_id:saved.backup_id});assert.deepEqual(fs.readFileSync(source),Buffer.from(bytes));assert.notEqual(digest(edited),digest(bytes));const history=await runLocal({action:'history',source,expected_sha256:digest(bytes)});assert.ok(history.entries.some(e=>e.sha256===digest(edited)&&e.backup_verified));
});
