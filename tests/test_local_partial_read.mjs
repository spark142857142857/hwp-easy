import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {HwpDocument} from '@rhwp/core';
import {initializeLocal,runLocal} from '../src/one_hwp/local_runner.mjs';
import {fieldFixture,checkedExport} from './local_complex_fixtures.mjs';
initializeLocal(fs.readFileSync(new URL('../node_modules/@rhwp/core/rhwp_bg.wasm',import.meta.url)));
function headerFixture(){
 const doc=new HwpDocument(fieldFixture());
 try{assert.equal(JSON.parse(doc.createHeaderFooter(0,true,0)).ok,true);doc.insertTextInHeaderFooter(0,true,0,0,0,'synthetic header');return checkedExport(doc);}finally{doc.free();}
}
function workspace(t,bytes=headerFixture()){
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'hwp-partial-read-'));
 t.after(()=>{assert.equal(path.dirname(dir),os.tmpdir());assert.ok(path.basename(dir).startsWith('hwp-partial-read-'));fs.rmSync(dir,{recursive:true,force:true});});
 const source=path.join(dir,'synthetic.hwp');fs.writeFileSync(source,bytes);return {source,dir,bytes};
}
test('a field document with an unsupported header exposes only read-only body blocks',async t=>{
 const {source,dir,bytes}=workspace(t),before=fs.statSync(source),result=await runLocal({action:'read',source,max_chars:64000});
 assert.equal(result.partial_read_only,true);assert.equal(result.partial_read_reason,'TARGET_MAPPING_UNVERIFIED');
 assert.equal(result.all_content_supported,false);assert.equal(result.content_complete,false);assert.equal(result.target_mapping_verified,false);
 assert.ok(result.blocks.some(b=>b.text==='untouched'));assert.ok(result.blocks.every(b=>b.target_id===null&&b.editable===false&&b.character_format_editable===false&&b.text_range_editable===false));
 assert.deepEqual(result.fields,[]);assert.deepEqual(result.picture_groups,[]);assert.match(result.notice,/읽기 전용/);
 assert.deepEqual(fs.readFileSync(source),Buffer.from(bytes));assert.equal(fs.statSync(source).mtimeMs,before.mtimeMs);assert.equal(fs.existsSync(path.join(dir,'.hwp-easy-backups')),false);
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
