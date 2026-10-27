import test from 'node:test';import assert from 'node:assert/strict';import fs from 'node:fs';
import {HwpDocument,initSync} from '@rhwp/core';
import {sourceFontProfiles,sourceFontFixture} from './local_source_font_fixtures.mjs';
import {createNaturalTextMeasurer} from '../src/one_hwp/local_font_measure.mjs';
import {inspectLocalComplex} from '../src/one_hwp/local_complex.mjs';
import {openLocalRenderView} from '../src/one_hwp/local_render_view.mjs';
import {digest} from '../src/one_hwp/local_file.mjs';
initSync({module:fs.readFileSync(new URL('../node_modules/@rhwp/core/rhwp_bg.wasm',import.meta.url))});
const state=bytes=>inspectLocalComplex(HwpDocument,bytes,{includeDocumentInfo:false});
for(const p of sourceFontProfiles)test(`source-bound mixed font rows and original styles: ${p.name}`,()=>{
 const bytes=sourceFontFixture(p,true),prior=digest(bytes),s=state(bytes),b=s.blocks.find(b=>b.text===p.text),measure=createNaturalTextMeasurer(HwpDocument,bytes),widths=measure(b.text,b.character_runs),v=openLocalRenderView(HwpDocument,bytes);
 try{assert.equal(widths.length,b.text.replaceAll('\n','').length);assert.ok(widths.every(w=>w>0&&Number.isFinite(w)));assert.equal(v.cell_wraps.length,1);assert.deepEqual(v.unadapted_cells,[]);assert.deepEqual(v.unadapted_tables,[]);
  const runs=JSON.parse(v.document.getPageTextLayout(0)).runs.map(r=>v.remap(r,0)).filter(r=>JSON.stringify(r.cellPath)===JSON.stringify(b.cell_path)),rows=[];
  for(const r of runs){assert.equal(b.text.slice(r.charStart,r.charStart+r.text.length),r.text);assert.ok(b.unit_styles.slice(r.charStart,r.charStart+r.text.length).every(id=>id===r.charShapeId));if(!rows.length||Math.abs(rows.at(-1).y-r.y)>.2)rows.push({y:r.y,text:r.text});else rows.at(-1).text+=r.text;}
  assert.deepEqual(rows.map(r=>r.text),p.rows);assert.equal(v.cell_wraps[0].render_lines,p.rows.length);assert.ok(v.document.renderPageSvg(0).startsWith('<svg'));assert.equal(digest(bytes),prior);
 }finally{v.document.free();}
});
test('original Hamchorom metrics replace generic empty-document Latin widths',()=>{
 const bytes=sourceFontFixture(sourceFontProfiles[0],true),s=state(bytes),b=s.blocks.find(b=>b.text===sourceFontProfiles[0].text),m=createNaturalTextMeasurer(HwpDocument,bytes,{prefixProof:true}),w=m(b.text,b.character_runs);assert.ok(Math.abs(w[0]-706/75)<.1);assert.equal(m.isExact(b.text,b.character_runs),true);assert.equal(m(b.text,b.character_runs),w);assert.equal(Object.isFrozen(w),true);
});
for(const variant of ['shape','size','coverage','family','bold'])test(`source font identity rejects mismatched ${variant}`,()=>{
 const bytes=sourceFontFixture(sourceFontProfiles[0],true),s=state(bytes),b=s.blocks.find(b=>b.text===sourceFontProfiles[0].text),runs=structuredClone(b.character_runs);if(variant==='shape')runs[0].properties.charShapeId=65534;if(variant==='size')runs[0].properties.fontSize++;if(variant==='coverage')runs[0].start=1;if(variant==='family')runs[0].properties.fontFamilies[0]='unverified';if(variant==='bold')runs[0].properties.bold=true;
 const hash=digest(bytes);assert.throws(()=>createNaturalTextMeasurer(HwpDocument,bytes)(b.text,runs),/NESTED_PLACEMENT_FONT_UNVERIFIED/);assert.equal(digest(bytes),hash);
});
test('source is required lazily and resources are freed on a page limit failure',()=>{
 const bytes=sourceFontFixture(sourceFontProfiles[0],true),b=state(bytes).blocks.find(b=>b.text===sourceFontProfiles[0].text);assert.throws(()=>createNaturalTextMeasurer(HwpDocument)('A',[]),/TEXT_MEASURE_SOURCE_REQUIRED/);let freed=0;class TooManyPages extends HwpDocument{pageCount(){return 33;}free(){freed++;super.free();}}assert.throws(()=>createNaturalTextMeasurer(TooManyPages,bytes)(b.text,b.character_runs),/NESTED_PLACEMENT_CHECK_LIMIT/);assert.equal(freed,1);
});

for(const variant of ['missing','invalid','throws'])test(`optional exact-width proof stays conservative: ${variant}`,()=>{
 const bytes=sourceFontFixture(sourceFontProfiles[0],true),b=state(bytes).blocks.find(b=>b.text===sourceFontProfiles[0].text);class WithoutTrace extends HwpDocument{getFontDecisionTrace(){if(variant==='throws')throw new Error('unavailable');return JSON.stringify({schemaVersion:1});}}if(variant==='missing')WithoutTrace.prototype.getFontDecisionTrace=undefined;const m=createNaturalTextMeasurer(WithoutTrace,bytes,{prefixProof:true});assert.equal(m(b.text,b.character_runs).length,b.text.length);assert.equal(m.isExact(b.text,b.character_runs),false);
});
