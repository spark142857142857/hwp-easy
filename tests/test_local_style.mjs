import test from 'node:test';import assert from 'node:assert/strict';import fs from 'node:fs';
import {HwpDocument} from '@rhwp/core';import {fixture,corpus} from './rhwp_fixtures.mjs';
import {createEngineApi} from '../src/one_hwp/rhwp_api.mjs';import {createLocalEngineApi,localPlainStyleProofs} from '../src/one_hwp/local_api.mjs';
import {structuralEdit} from '../src/one_hwp/local_structure.mjs';import {digest} from '../src/one_hwp/local_file.mjs';
import {readHwp} from '../probes/sites-runtime/guard/container.mjs';import {parseRecords} from '../probes/sites-runtime/guard/records.mjs';
import {createDocumentEngine,mapRawTargets} from '../probes/sites-runtime/engine/document.mjs';import {rawPlainStyleProofs} from '../probes/sites-runtime/engine/plain-style.mjs';
import {encodeRecords} from '../probes/sites-runtime/tests/page-number-fixtures.mjs';import {profileSyntheticEngine} from '../probes/sites-runtime/scripts/synthetic-engine-profile.mjs';
const inspect=(api,bytes)=>{const d=api.openDocument(bytes);try{return api.inspectDocument(d,bytes);}finally{d.free();}},full=createEngineApi(HwpDocument,{mixedStyleSameLength:true}),fast=createLocalEngineApi(HwpDocument,{mixedStyleSameLength:true});
function mixed(){const bytes=fixture({paragraphs:['시작','가😀e\u0301'.repeat(1200),'끝'],cells:[['A','가😀e\u0301'.repeat(1200)]]}),m=inspect(full,bytes);let output=bytes;
 for(const b of m.blocks.filter(b=>b.text.length>2048)){const operation={type:'format_text',target_id:`hwp5:${digest(output)}:${Buffer.from(b.id).toString('base64url')}`,expected_old:b.text,start:17,end:1300,props:{bold:true,textColor:'#AA2255'}};output=structuralEdit(HwpDocument,output,digest(output),operation).bytes;}return output;
}
test('local raw mixed-run proofs return the exact full scanned model with bounded engine queries',()=>{
 const bytes=mixed(),tracked=profileSyntheticEngine(HwpDocument);tracked.setPhase('read');const model=inspect(createLocalEngineApi(tracked.Document,{mixedStyleSameLength:true}),bytes);
 assert.deepEqual(model,inspect(full,bytes));assert.ok(tracked.report().read.inspection_queries.calls<150);assert.ok(model.blocks.filter(b=>b.text.length>2048).every(b=>b.style.char_runs.length===3));
});
test('local opt-in and conservative engine keep identical public reads on the existing corpus',async()=>{
 for(const spec of corpus){const bytes=fixture(spec),a=await createDocumentEngine(HwpDocument,{plainStyleInspection:true,includeTableMetadata:true}).open(bytes),b=await createDocumentEngine(HwpDocument,{includeTableMetadata:true}).open(bytes);assert.deepEqual(a.read({expected_sha256:a.source_sha256,max_chars:64000}),b.read({expected_sha256:b.source_sha256,max_chars:64000}));}
});
test('plain mixed proof rejects malformed envelopes, surrogate split anchors and mismatched text',()=>{
 const bytes=mixed(),raw=readHwp(bytes),blocks=inspect(full,bytes).blocks,mapping=mapRawTargets(raw,blocks),target=blocks.find(b=>b.kind==='paragraph'&&b.text.length>2048);assert.equal(rawPlainStyleProofs(raw,blocks,mapping).get(target.id).length,3);
 for(const variant of ['duplicate_shape','duplicate_anchor','nonzero_start','surrogate_anchor','terminal_anchor','header_count','control_mask','extra_record','text_difference']){
  const list=[...parseRecords(raw.streams.get('BodyText/Section0'))].map(r=>({...r,payload:r.payload.slice()}));let seen=-1,start;
  for(const [i,r] of list.entries())if(r.tag===66&&++seen===mapping.get(target.id).record_index){start=i;break;}
  const header=list[start],shapeIndex=list.findIndex((r,i)=>i>start&&r.tag===68),shape=list[shapeIndex],sv=new DataView(shape.payload.buffer),hv=new DataView(header.payload.buffer);
  if(variant==='duplicate_shape')list.splice(shapeIndex,0,{...shape,payload:shape.payload.slice()});if(variant==='duplicate_anchor')sv.setUint32(8,0,true);if(variant==='nonzero_start')sv.setUint32(0,1,true);
  if(variant==='surrogate_anchor')sv.setUint32(8,2,true);if(variant==='terminal_anchor')sv.setUint32(16,target.text.length,true);if(variant==='header_count')hv.setUint16(12,1,true);if(variant==='control_mask')hv.setUint32(4,1,true);
  if(variant==='extra_record')list.splice(shapeIndex,0,{tag:70,level:1,payload:new Uint8Array(12)});if(variant==='text_difference')new DataView(list[start+1].payload.buffer).setUint16(0,0xB098,true);
  const decoded={...raw,streams:new Map(raw.streams)};decoded.streams.set('BodyText/Section0',encodeRecords(list));assert.equal(rawPlainStyleProofs(decoded,blocks,mapping).has(target.id),false,variant);
 }
});
test('sample disagreement falls back to full style scan',()=>{
 const bytes=mixed(),paragraph=inspect(full,bytes).blocks.find(b=>b.kind==='paragraph'&&b.text.length>2048).paragraph;let calls=0;const Type=new Proxy(HwpDocument,{construct(Target,args){const d=Reflect.construct(Target,args,Target);return new Proxy(d,{get(o,key){const value=Reflect.get(o,key,o);if(typeof value!=='function')return value;return (...a)=>{const result=Reflect.apply(value,o,a);if(key!=='getCharPropertiesAt'||a[1]!==paragraph)return result;calls++;if(a[2]!==17)return result;const p=JSON.parse(result);p.charShapeId+=10000;return JSON.stringify(p);};}});}});
 assert.deepEqual(inspect(createLocalEngineApi(Type,{mixedStyleSameLength:true}),bytes),inspect(createEngineApi(Type,{mixedStyleSameLength:true}),bytes));assert.ok(calls>5000);
});
test('plain proof provider receives detached data and preserves the original style budget',()=>{
 const fake={getDocumentInfo:()=>'{"sectionCount":1,"pageCount":1}',getCursorModel:()=>'{"lists":[]}',getControls:()=> '[]',getSectionCount:()=>1,getParagraphCount:()=>9,getParagraphLength:()=>100000,getTextRange:()=> '가'.repeat(100000),getParaPropertiesAt:()=> '{}',getCharPropertiesAt:()=>'{"charShapeId":0}',getValidationWarnings:()=>'{"count":0}'};
 const bytes=Uint8Array.of(1,2,3),a=createEngineApi(HwpDocument,{plainStyleProofs(copy,blocks){copy.fill(0);const map=new Map(blocks.map(b=>[b.id,[{start:0,end:100000,char_shape_id:0}]]));blocks[0].text='changed';return map;}}).inspectDocument(fake,bytes);
 assert.equal(a.blocks[0].text.length,100000);assert.deepEqual(bytes,Uint8Array.of(1,2,3));assert.equal(a.blocks[8].style.profile,'style_scan_limit_exceeded');
 assert.throws(()=>createEngineApi(HwpDocument,{plainStyleProofs:true}),/Invalid plain/);assert.throws(()=>createEngineApi(HwpDocument,{plainStyleProofs:()=>({})}).inspectDocument(fake,bytes),/Invalid plain/);
});
