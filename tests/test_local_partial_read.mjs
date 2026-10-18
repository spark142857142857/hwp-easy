import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {HwpDocument} from '@rhwp/core';
import {initializeLocal,runLocal} from '../src/one_hwp/local_runner.mjs';
import {fieldFixture,checkedExport} from './local_complex_fixtures.mjs';
import {readHwp} from '../probes/sites-runtime/guard/container.mjs';
import {parseRecords} from '../probes/sites-runtime/guard/records.mjs';
import {packLocalBodyRewrite} from '../probes/sites-runtime/engine/structural-body-repair.mjs';
import {encodeRecords,view} from '../src/one_hwp/local_complex_records.mjs';
initializeLocal(fs.readFileSync(new URL('../node_modules/@rhwp/core/rhwp_bg.wasm',import.meta.url)));
function headerFixture(){
 const doc=new HwpDocument(fieldFixture());
 try{assert.equal(JSON.parse(doc.createHeaderFooter(0,true,0)).ok,true);doc.insertTextInHeaderFooter(0,true,0,0,0,'synthetic header');return checkedExport(doc);}finally{doc.free();}
}
function invalidTableFixture(){
 const source=fieldFixture({cell:true}),raw=readHwp(source),records=[...parseRecords(raw.streams.get('BodyText/Section0'))].map(r=>({...r,payload:r.payload.slice()}));
 const cell=records.find(r=>r.tag===72&&r.level===2);view(cell.payload).setUint16(14,0,true);
 return packLocalBodyRewrite(source,raw,new Map([['BodyText/Section0',encodeRecords(records)]]));
}
function workspace(t,bytes=invalidTableFixture()){
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'hwp-partial-read-'));
 t.after(()=>{assert.equal(path.dirname(dir),os.tmpdir());assert.ok(path.basename(dir).startsWith('hwp-partial-read-'));fs.rmSync(dir,{recursive:true,force:true});});
 const source=path.join(dir,'synthetic.hwp');fs.writeFileSync(source,bytes);return {source,dir,bytes};
}

test('rendered layout remains available with explicit uncertainty when raw mapping fails',async t=>{
 const {source,bytes}=workspace(t),read=await runLocal({action:'read',source,max_chars:64000}),layout=await runLocal({action:'layout',source,expected_sha256:read.source_sha256,scope:'rendered'});
 assert.equal(layout.cell_text_boxes.status,'inconclusive');assert.equal(layout.diagnostics_complete,false);assert.ok(layout.engine_limitations.some(l=>l.code==='CELL_TEXT_BOX_MAPPING_UNVERIFIED'));assert.equal(layout.layout_verified,false);assert.deepEqual(fs.readFileSync(source),Buffer.from(bytes));
});
test('a field document with unverified table geometry exposes only read-only body blocks',async t=>{
 const {source,dir,bytes}=workspace(t),before=fs.statSync(source),result=await runLocal({action:'read',source,max_chars:64000});
 assert.equal(result.partial_read_only,true);assert.equal(result.partial_read_reason,'TARGET_MAPPING_UNVERIFIED');
 assert.equal(result.all_content_supported,false);assert.equal(result.content_complete,false);assert.equal(result.target_mapping_verified,false);
 assert.ok(result.blocks.some(b=>b.text==='untouched'));assert.ok(result.blocks.every(b=>b.target_id===null&&b.editable===false&&b.character_format_editable===false&&b.text_range_editable===false));
 assert.deepEqual(result.fields,[]);assert.deepEqual(result.picture_groups,[]);assert.match(result.notice,/읽기 전용/);
 assert.deepEqual(fs.readFileSync(source),Buffer.from(bytes));assert.equal(fs.statSync(source).mtimeMs,before.mtimeMs);assert.equal(fs.existsSync(path.join(dir,'.hwp-easy-backups')),false);
});

test('a header no longer prevents verified body field editing; header bytes remain exact',async t=>{
 const {source,bytes}=workspace(t,headerFixture()),before=await runLocal({action:'read',source,max_chars:64000});
 assert.equal(before.partial_read_only,undefined);assert.equal(before.target_mapping_verified,true);assert.equal(before.content_complete,false);
 assert.ok(before.unsupported[0].opaque_paragraphs>0);assert.ok(!before.blocks.some(b=>b.text==='synthetic header'));
 const f=before.fields[0];assert.equal(f.editable,true);
 const saved=await runLocal({action:'edit',source,expected_sha256:before.source_sha256,operations:[{type:'set_field',target_id:f.target_id,expected_old:f.value,new_text:'supported body field 😀'}]});
 const old=readHwp(bytes),now=readHwp(fs.readFileSync(source)),extract=raw=>{
  const records=[...parseRecords(raw.streams.get('BodyText/Section0'))],at=records.findIndex(r=>r.tag===71&&Buffer.from(r.payload.subarray(0,4)).toString()==='daeh');let end=at+1;while(end<records.length&&records[end].level>records[at].level)end++;
  return encodeRecords(records.slice(at,end));
 };assert.deepEqual(extract(now),extract(old));
 const after=await runLocal({action:'read',source});assert.equal(after.fields[0].value,'supported body field 😀');
 await runLocal({action:'restore',source,expected_sha256:after.source_sha256,backup_id:saved.backup_id});assert.deepEqual(fs.readFileSync(source),Buffer.from(bytes));
});
test('partial-read cursor pages assemble the same body and never imply complete document coverage',async t=>{
 const {source}=workspace(t),whole=await runLocal({action:'read',source,max_chars:64000}),fragments=[];let cursor;
 do{const page=await runLocal({action:'read',source,max_chars:3,max_blocks:2,...(cursor?{cursor,expected_sha256:whole.source_sha256}:{})});assert.equal(page.partial_read_only,true);assert.equal(page.content_complete,false);fragments.push(...page.blocks);cursor=page.next_cursor;}while(cursor);
 for(const block of whole.blocks)assert.equal(fragments.filter(f=>f.id===block.id).map(f=>f.text).join(''),block.text);
});
test('partial reads cannot authorize plans, saving, or coordinate-based search',async t=>{
 const {source,dir,bytes}=workspace(t),state=await runLocal({action:'read',source});
 for(const action of ['plan','edit'])await assert.rejects(runLocal({action,source,expected_sha256:state.source_sha256,operations:[{type:'replace_text',target_id:state.blocks[0].target_id,expected_old:state.blocks[0].text,new_text:'refused'}]}),/TARGET_MAPPING_UNVERIFIED/);
 await assert.rejects(runLocal({action:'find',source,expected_sha256:state.source_sha256,query:'untouched'}),/TARGET_MAPPING_UNVERIFIED/);
 assert.deepEqual(fs.readFileSync(source),Buffer.from(bytes));assert.equal(fs.existsSync(path.join(dir,'.hwp-easy-backups')),false);
});
test('read-only fallback retains stale-hash and cursor validation',async t=>{
 const {source}=workspace(t),page=await runLocal({action:'read',source,max_chars:3});
 await assert.rejects(runLocal({action:'read',source,expected_sha256:'0'.repeat(64)}),/VERSION_CONFLICT/);
 await assert.rejects(runLocal({action:'read',source,cursor:{...page.next_cursor,offset:-1}}),/INVALID_CURSOR/);
 await assert.rejects(runLocal({action:'read',source,cursor:{...page.next_cursor,sha256:'0'.repeat(64)}}),/CURSOR_VERSION_CONFLICT/);
});
test('corrupt HWP input is not converted into a successful partial read',async t=>{
 const {source}=workspace(t,new Uint8Array(100));await assert.rejects(runLocal({action:'read',source}));
});
