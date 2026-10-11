import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { fixture } from './rhwp_fixtures.mjs';
import { initializeLocal, runLocal } from '../src/one_hwp/local_runner.mjs';
import { readLocal, saveLocal, digest } from '../src/one_hwp/local_file.mjs';
import { withPageNumber } from '../probes/sites-runtime/tests/page-number-fixtures.mjs';
initializeLocal(fs.readFileSync(new URL('../node_modules/@rhwp/core/rhwp_bg.wasm',import.meta.url)));
function workspace(t) {
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'hwp-easy-local-test-'));
 t.after(()=>{assert.equal(path.dirname(dir),os.tmpdir());assert.ok(path.basename(dir).startsWith('hwp-easy-local-test-'));fs.rmSync(dir,{recursive:true,force:true});});
 const source=path.join(dir,'합성 문서 with spaces.hwp');fs.writeFileSync(source,fixture());return {dir,source};
}
function replacement(read,old,new_text) {
 const block=read.blocks.find(b=>b.text===old);assert.ok(block);
 return {type:'replace_text',target_id:block.target_id,expected_old:block.text,new_text};
}
test('local edit overwrites selected path, preserves recovery and restores exact bytes',async t=>{
 const {source}=workspace(t),original=fs.readFileSync(source),read=await runLocal({action:'read',source,max_chars:64000});
 const operations=[replacement(read,'중간 합성 문단','로컬 저장 확인'),replacement(read,'합성 답변 원문','직접 수정한 답변')];
 const plan=await runLocal({action:'plan',source,expected_sha256:read.source_sha256,operations});
 assert.equal(plan.saved,false);assert.deepEqual(fs.readFileSync(source),original);
 assert.equal(fs.existsSync(path.join(path.dirname(source),'.hwp-easy-backups')),false);
 const saved=await runLocal({action:'edit',source,expected_sha256:read.source_sha256,operations});
 assert.equal(saved.saved_path,source);assert.equal(saved.selected_file_updated,true);assert.notDeepEqual(fs.readFileSync(source),original);
 const after=await runLocal({action:'read',source,expected_sha256:saved.output_sha256,max_chars:64000});
 assert.ok(after.blocks.some(b=>b.text==='직접 수정한 답변'));
 const restored=await runLocal({action:'restore',source,expected_sha256:saved.output_sha256,backup_id:saved.backup_id});
 assert.deepEqual(fs.readFileSync(source),original);assert.notEqual(restored.backup_id,saved.backup_id);
});
test('multiline cell answer is saved to original path and rereads as real paragraphs',async t=>{
 const {source}=workspace(t),read=await runLocal({action:'read',source,max_chars:64000});
 const saved=await runLocal({action:'edit',source,expected_sha256:read.source_sha256,
   operations:[replacement(read,'합성 답변 원문','첫 답변\n둘째 답변\n')]}),after=await runLocal({action:'read',source,expected_sha256:saved.output_sha256,max_chars:64000});
 assert.deepEqual(after.blocks.filter(b=>b.kind==='cell'&&b.cell===1).map(b=>b.text),['첫 답변','둘째 답변','']);
});
test('an existing LF target advertises structural eligibility and can become a single paragraph',async t=>{
 const {source}=workspace(t);fs.writeFileSync(source,fixture({table:false,paragraphs:['시작','기존\n줄바꿈','끝']}));
 const read=await runLocal({action:'read',source,max_chars:64000}),target=read.blocks.find(b=>b.text==='기존\n줄바꿈');
 assert.equal(target.editable,false);assert.equal(target.structural_editable,true);
 const saved=await runLocal({action:'edit',source,expected_sha256:read.source_sha256,
   operations:[replacement(read,'기존\n줄바꿈','한 문단 답변')]}),after=await runLocal({action:'read',source,max_chars:64000});
 assert.equal(saved.selected_file_updated,true);assert.deepEqual(after.blocks.map(b=>b.text),['시작','한 문단 답변','끝']);
});
test('opaque page numbers retain partial-reading status while allowing verified structural candidates',async t=>{
 const {source}=workspace(t),original=withPageNumber(fixture(),{paragraph:0});fs.writeFileSync(source,original);
 const read=await runLocal({action:'read',source,max_chars:64000}),block=read.blocks.find(b=>b.text==='중간 합성 문단');
 assert.equal(read.all_content_supported,false);assert.equal(block.structural_editable,true);
 const saved=await runLocal({action:'edit',source,expected_sha256:read.source_sha256,operations:[{type:'insert_paragraphs',target_id:block.target_id,expected_old:block.text,paragraphs:['新 문단']}]});
 const after=await runLocal({action:'read',source,max_chars:64000});assert.equal(after.all_content_supported,false);assert.ok(after.blocks.some(b=>b.text==='新 문단'));
 await runLocal({action:'restore',source,expected_sha256:after.source_sha256,backup_id:saved.backup_id});assert.deepEqual(fs.readFileSync(source),Buffer.from(original));
});
test('stale document and invalid edit batch leave the current file unchanged',async t=>{
 const {source}=workspace(t),read=await runLocal({action:'read',source,max_chars:64000});
 const operations=[replacement(read,'중간 합성 문단','바뀐 값'),replacement(read,'합성 답변 원문','invalid\u0000text')];
 await assert.rejects(runLocal({action:'edit',source,expected_sha256:read.source_sha256,operations}));
 assert.equal(digest(fs.readFileSync(source)),read.source_sha256);
 const other=fixture({paragraphs:['외부 수정','둘','셋']});fs.writeFileSync(source,other);
 await assert.rejects(runLocal({action:'edit',source,expected_sha256:read.source_sha256,operations}),/VERSION_CONFLICT/);
 assert.deepEqual(fs.readFileSync(source),other);
});
test('explicit Save As preserves source and refuses unguarded existing destination',async t=>{
 const {dir,source}=workspace(t),original=fs.readFileSync(source),read=await runLocal({action:'read',source,max_chars:64000});
 const operations=[replacement(read,'합성 답변 원문','별도 저장 답변')],output=path.join(dir,'요청한 사본.hwp');
 const saved=await runLocal({action:'edit',source,expected_sha256:read.source_sha256,operations,output});
 assert.deepEqual(fs.readFileSync(source),original);assert.equal(saved.selected_file_updated,false);
 await assert.rejects(runLocal({action:'edit',source,expected_sha256:read.source_sha256,operations,output}),/VERSION_CONFLICT/);
});
test('backup cannot be restored to a different selected document',async t=>{
 const {dir,source}=workspace(t),read=await runLocal({action:'read',source,max_chars:64000});
 const saved=await runLocal({action:'edit',source,expected_sha256:read.source_sha256,operations:[replacement(read,'중간 합성 문단','새 값')]});
 const other=path.join(dir,'다른 문서.hwp');fs.writeFileSync(other,fixture());const hash=digest(fs.readFileSync(other));
 await assert.rejects(runLocal({action:'restore',source:other,expected_sha256:hash,backup_id:saved.backup_id}),/BACKUP_INVALID/);
 assert.equal(digest(fs.readFileSync(other)),hash);
});
test('same-file publication failure preserves source and verified recovery',t=>{
 const {source}=workspace(t),snapshot=readLocal(source),original=Buffer.from(snapshot.bytes),rename=fs.renameSync;
 try {fs.renameSync=()=>{const error=new Error('test failure');error.code='EACCES';throw error;};
   assert.throws(()=>saveLocal(snapshot,fixture({table:false})));}
 finally {fs.renameSync=rename;}
 assert.deepEqual(fs.readFileSync(source),original);
 const backups=fs.readdirSync(path.join(path.dirname(source),'.hwp-easy-backups'));
 assert.equal(backups.filter(n=>n.endsWith('.hwp')).length,1);assert.equal(backups.some(n=>n.endsWith('.lock')),false);
});
test('linked file aliases cannot bypass selected-file checks',t=>{
 const {dir,source}=workspace(t),alias=path.join(dir,'alias.hwp');fs.linkSync(source,alias);
 assert.throws(()=>readLocal(alias),/LINKED_PATH_NOT_ALLOWED/);
});
test('pagination is version bound across independent runner calls',async t=>{
 const {source}=workspace(t),first=await runLocal({action:'read',source,max_chars:3,max_blocks:2});assert.ok(first.next_cursor);
 const next=await runLocal({action:'read',source,expected_sha256:first.source_sha256,cursor:first.next_cursor,max_chars:3});
 assert.deepEqual(next.page_starts_at,{block_index:first.next_cursor.block_index,offset:first.next_cursor.offset});
 await assert.rejects(runLocal({action:'read',source,cursor:{...first.next_cursor,sha256:'0'.repeat(64)}}),/CURSOR_VERSION_CONFLICT/);
});
