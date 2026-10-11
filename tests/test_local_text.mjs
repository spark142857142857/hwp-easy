import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';import os from 'node:os';import path from 'node:path';
import {HwpDocument} from '@rhwp/core';
import {fixture} from './rhwp_fixtures.mjs';
import {createEngineApi} from '../src/one_hwp/rhwp_api.mjs';
import {structuralEdit} from '../src/one_hwp/local_structure.mjs';
import {runLocal} from '../src/one_hwp/local_runner.mjs';
import {digest} from '../src/one_hwp/local_file.mjs';
import {rewriteSyntheticBody} from '../probes/sites-runtime/tests/page-number-fixtures.mjs';
const api=createEngineApi(HwpDocument,{mixedStyleSameLength:true});
const inspect=bytes=>{const d=api.openDocument(bytes);try{return api.inspectDocument(d,bytes);}finally{d.free();}};
const edit=(bytes,b,op)=>structuralEdit(HwpDocument,bytes,digest(bytes),{target_id:`hwp5:${digest(bytes)}:${Buffer.from(b.id).toString('base64url')}`,expected_old:b.text,...op});
function mixed(kind){const source=fixture({paragraphs:['앞','가😀나 ABC','끝'],cells:[['질문','가😀나 ABC']]}),b=inspect(source).blocks.find(x=>x.kind===kind&&x.text==='가😀나 ABC');return edit(source,b,{type:'format_text',start:1,end:4,props:{bold:true,textColor:'#AABBCC'}}).bytes;}
for(const kind of ['paragraph','cell'])for(const spec of [
 {start:0,end:0,new_text:'앞😀'}, {start:2,end:2,new_text:'삽입'},
 {start:1,end:5,new_text:'긴 replacement😀'}, {start:7,end:7,new_text:'끝'},
 {start:1,end:4,new_text:''}, {start:0,end:7,new_text:''},
 {start:0,end:7,new_text:'전체 😀'}, {start:3,end:3,new_text:''},
])test(`${kind} mixed range splice ${JSON.stringify(spec)} preserves retained character styles`,()=>{
 const source=mixed(kind),before=inspect(source),b=before.blocks.find(x=>x.kind===kind&&x.text==='가😀나 ABC');
 const points=[...b.text],out=edit(source,b,{type:'splice_text',...spec}),after=inspect(out.bytes),saved=after.blocks.find(x=>x.id===b.id);
 assert.equal(saved.text,points.slice(0,spec.start).join('')+spec.new_text+points.slice(spec.end).join(''));
 assert.equal(out.raw_preservation_verified,true);assert.equal(out.structure_changed,false);assert.equal(out.text_range_changed,true);
 assert.deepEqual(after.blocks.filter(x=>x.id!==b.id),before.blocks.filter(x=>x.id!==b.id));
});
for(const kind of ['paragraph','cell'])test(`empty ${kind} insertion and same-file backup restoration`,async t=>{
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'hwp-easy-text-'));t.after(()=>{assert.equal(path.dirname(dir),os.tmpdir());assert.ok(path.basename(dir).startsWith('hwp-easy-text-'));fs.rmSync(dir,{recursive:true,force:true});});
 const source=path.join(dir,'same.hwp'),original=fixture({table:kind==='cell',paragraphs:['前','','後'],cells:[['A','']]});fs.writeFileSync(source,original);
 const state=await runLocal({action:'read',source}),b=state.blocks.find(x=>x.kind===kind&&x.text===''&&x.structural_editable),request={source,expected_sha256:state.source_sha256,operations:[{type:'splice_text',target_id:b.target_id,expected_old:'',start:0,end:0,new_text:'새 😀 문장'}]};
 const plan=await runLocal({action:'plan',...request});assert.equal(plan.saved,false);assert.deepEqual(fs.readFileSync(source),original);
 const saved=await runLocal({action:'edit',...request}),next=await runLocal({action:'read',source});assert.ok(next.blocks.some(x=>x.text==='새 😀 문장'));
 await runLocal({action:'restore',source,expected_sha256:next.source_sha256,backup_id:saved.backup_id});assert.deepEqual(fs.readFileSync(source),original);
});
for(const spec of [{start:-1,end:0,new_text:'x'},{start:1,end:0,new_text:'x'},{start:0,end:99,new_text:'x'},{start:0,end:0,new_text:'bad\rtext'},{start:0,end:0,new_text:'\ud800'}])test('invalid range is rejected '+JSON.stringify(spec),()=>{
 const source=mixed('paragraph'),b=inspect(source).blocks.find(x=>x.text==='가😀나 ABC');assert.throws(()=>edit(source,b,{type:'splice_text',...spec}),/INVALID_TEXT_RANGE/);
});

for(const kind of ['paragraph','cell'])for(const spec of [
 {start:0,end:0,new_text:'첫 😀\n다음'}, {start:0,end:0,new_text:'\n'},
 {start:2,end:2,new_text:'\n중간\n'}, {start:1,end:5,new_text:'새 답변\n😀 두 번째\n셋째'},
 {start:7,end:7,new_text:'\n'}, {start:7,end:7,new_text:'끝\n다음\n'},
 {start:0,end:7,new_text:'\n\n'}, {start:0,end:7,new_text:'새 답변\n둘째 😀'},
])test(`${kind} mixed multiline range preserves prefix/suffix styles and actual paragraph boundaries ${JSON.stringify(spec)}`,()=>{
 const source=mixed(kind),before=inspect(source),b=before.blocks.find(x=>x.kind===kind&&x.text==='가😀나 ABC'),index=before.blocks.indexOf(b),points=[...b.text];
 const out=edit(source,b,{type:'splice_text',...spec}),after=inspect(out.bytes),expected=(points.slice(0,spec.start).join('')+spec.new_text+points.slice(spec.end).join('')).split('\n'),saved=after.blocks.slice(index,index+expected.length);
 assert.deepEqual(saved.map(x=>x.text),expected);assert.equal(out.structure_changed,true);assert.equal(out.raw_preservation_verified,true);
 assert.deepEqual(after.blocks.slice(0,index).map(x=>x.text),before.blocks.slice(0,index).map(x=>x.text));assert.deepEqual(after.blocks.slice(index+expected.length).map(x=>x.text),before.blocks.slice(index+1).map(x=>x.text));
 if(kind==='cell')assert.ok(saved.every(x=>x.kind==='cell'&&x.cell===b.cell));
});

for(const kind of ['paragraph','cell'])test(`multiline insertion into empty ${kind} retains formatting and exactly restores the file`,async t=>{
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'hwp-easy-multiline-'));t.after(()=>{assert.equal(path.dirname(dir),os.tmpdir());assert.ok(path.basename(dir).startsWith('hwp-easy-multiline-'));fs.rmSync(dir,{recursive:true,force:true});});
 const source=path.join(dir,'same.hwp');fs.writeFileSync(source,fixture({table:kind==='cell',paragraphs:['前','','後'],cells:[['A','']]}));
 const before=fs.readFileSync(source),state=await runLocal({action:'read',source}),b=state.blocks.find(x=>x.kind===kind&&x.text===''&&x.structural_editable),request={source,expected_sha256:state.source_sha256,operations:[{type:'splice_text',target_id:b.target_id,expected_old:'',start:0,end:0,new_text:'첫 😀\n\n끝'}]};
 assert.equal((await runLocal({action:'plan',...request})).saved,false);assert.deepEqual(fs.readFileSync(source),before);const result=await runLocal({action:'edit',...request}),after=await runLocal({action:'read',source});assert.ok(after.blocks.some(x=>x.text==='첫 😀'));
 await runLocal({action:'restore',source,expected_sha256:after.source_sha256,backup_id:result.backup_id});assert.deepEqual(fs.readFileSync(source),before);
});

test('multiline expansion preserves later initial identities within an atomic batch',async t=>{
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'hwp-easy-multiline-batch-'));t.after(()=>{assert.equal(path.dirname(dir),os.tmpdir());assert.ok(path.basename(dir).startsWith('hwp-easy-multiline-batch-'));fs.rmSync(dir,{recursive:true,force:true});});
 const source=path.join(dir,'same.hwp');fs.writeFileSync(source,mixed('paragraph'));const state=await runLocal({action:'read',source,max_chars:64000}),body=state.blocks.find(x=>x.kind==='paragraph'&&x.text==='가😀나 ABC'),last=state.blocks.find(x=>x.text==='끝');
 const result=await runLocal({action:'edit',source,expected_sha256:state.source_sha256,operations:[{type:'splice_text',target_id:body.target_id,expected_old:body.text,start:1,end:3,new_text:'첫\n둘\n셋'},{type:'splice_text',target_id:last.target_id,expected_old:last.text,start:0,end:0,new_text:'이동 '}]}),after=await runLocal({action:'read',source});
 assert.equal(result.atomic_batch,true);assert.ok(after.blocks.some(x=>x.text==='이동 끝'));
});

for(const value of ['bad\tline\nnext','a\n'.repeat(100),'\ud800\n'])test('unsafe or over-count multiline insertion is unsaved',()=>{
 const source=mixed('paragraph'),b=inspect(source).blocks.find(x=>x.kind==='paragraph'&&x.text==='가😀나 ABC');assert.throws(()=>edit(source,b,{type:'splice_text',start:0,end:0,new_text:value}),/INVALID_TEXT_RANGE|INVALID_PARAGRAPH_COUNT/);
});
for(const kind of ['paragraph','cell'])for(const offset of [0,1,2,3,4,7])test(`${kind} mixed paragraph split at ${offset} and merge restores text and styles`,()=>{
 const source=mixed(kind),before=inspect(source),block=before.blocks.find(b=>b.kind===kind&&b.text==='가😀나 ABC'),split=edit(source,block,{type:'split_paragraph',offset});
 const model=inspect(split.bytes),first=model.blocks.find(b=>b.id===block.id),second=model.blocks.find(b=>b.kind===kind&&b.section===block.section
   &&(kind==='paragraph'?b.paragraph===block.paragraph+1:b.paragraph===block.paragraph&&b.cell===block.cell&&b.cell_paragraph===block.cell_paragraph+1));
 assert.equal(first.text,[...block.text].slice(0,offset).join(''));assert.equal(second.text,[...block.text].slice(offset).join(''));
 const merged=edit(split.bytes,second,{type:'merge_paragraph',previous_target_id:`hwp5:${digest(split.bytes)}:${Buffer.from(first.id).toString('base64url')}`,expected_previous:first.text});
 assert.deepEqual(inspect(merged.bytes).blocks,before.blocks);assert.equal(merged.raw_preservation_verified,true);
});
for(const kind of ['paragraph','cell'])test(`clearing a wholly formatted ${kind} keeps its empty insertion style`,()=>{
 let bytes=mixed(kind),b=inspect(bytes).blocks.find(b=>b.kind===kind&&b.text==='가😀나 ABC');bytes=edit(bytes,b,{type:'format_text',start:0,end:7,props:{bold:true,fontSize:1800}}).bytes;
 b=inspect(bytes).blocks.find(x=>x.id===b.id);const empty=edit(bytes,b,{type:'splice_text',start:0,end:7,new_text:''});
 const cleared=inspect(empty.bytes).blocks.find(x=>x.id===b.id);assert.equal(cleared.style.char.bold,true);assert.equal(cleared.style.char.fontSize,1800);
 const filled=edit(empty.bytes,cleared,{type:'splice_text',start:0,end:0,new_text:'다시 입력'});assert.equal(inspect(filled.bytes).blocks.find(x=>x.id===b.id).style.char.fontSize,1800);
});
test('split retains an existing paragraph instance and gives the new paragraph a zero instance',()=>{
 let source=mixed('paragraph');const order=inspect(source).blocks.findIndex(b=>b.kind==='paragraph'&&b.text==='가😀나 ABC');source=rewriteSyntheticBody(source,records=>{let ordinal=-1;return records.map(r=>{if(r.tag===66)ordinal++;if(r.tag===66&&ordinal===order){const payload=r.payload.slice();new DataView(payload.buffer).setUint32(18,0x80000015,true);return {...r,payload};}return r;});});
 const b=inspect(source).blocks.find(b=>b.kind==='paragraph'&&b.text==='가😀나 ABC');assert.equal(edit(source,b,{type:'split_paragraph',offset:2}).raw_preservation_verified,true);
});
for(const operation of [{type:'splice_text',start:1,end:1,new_text:'new'}, {type:'split_paragraph',offset:2}])test(`malformed raw style anchor is rejected before ${operation.type}`,()=>{
 const original=mixed('paragraph'),block=inspect(original).blocks.find(b=>b.kind==='paragraph'&&b.text==='가😀나 ABC');
 const order=inspect(original).blocks.findIndex(b=>b.id===block.id),source=rewriteSyntheticBody(original,records=>{let ordinal=-1;return records.map(r=>{if(r.tag===66)ordinal++;if(ordinal===order&&r.tag===68){const payload=r.payload.slice();new DataView(payload.buffer).setUint32(8,2,true);return {...r,payload};}return r;});});
 const b=inspect(source).blocks.find(b=>b.id===block.id);assert.throws(()=>edit(source,b,operation),/TEXT_RECORD_MISMATCH/);
});

for(const kind of ['paragraph','cell'])for(const value of ['','짧은 😀','가😀나 ABC'])test(`duplicate plain ${kind} retains full text and styles ${JSON.stringify(value)}`,()=>{
 let source=value==='가😀나 ABC'?mixed(kind):fixture({table:kind==='cell',paragraphs:['앞',value,'끝'],cells:[['질문',value]]});
 const before=inspect(source),b=before.blocks.find(x=>x.kind===kind&&x.text===value&&(kind==='cell'||x.paragraph>0)),at=before.blocks.indexOf(b);
 const out=edit(source,b,{type:'duplicate_paragraph'}),after=inspect(out.bytes);
 assert.deepEqual(after.blocks.slice(at,at+2).map(x=>x.text),[value,value]);
 assert.deepEqual(after.blocks[at].style,b.style);assert.deepEqual(after.blocks[at+1].style,b.style);
 assert.deepEqual(after.blocks.slice(0,at).map(x=>x.text),before.blocks.slice(0,at).map(x=>x.text));
 assert.deepEqual(after.blocks.slice(at+2).map(x=>x.text),before.blocks.slice(at+1).map(x=>x.text));
 assert.equal(out.content_verified,true);assert.equal(out.raw_preservation_verified,true);
});
for(const kind of ['paragraph','cell'])test(`duplicate ${kind} tracks original identities through atomic edits and recovery`,async t=>{
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'hwp-easy-duplicate-'));t.after(()=>{assert.equal(path.dirname(dir),os.tmpdir());assert.ok(path.basename(dir).startsWith('hwp-easy-duplicate-'));fs.rmSync(dir,{recursive:true,force:true});});
 const source=path.join(dir,'same.hwp'),original=Buffer.from(mixed(kind));fs.writeFileSync(source,original);const state=await runLocal({action:'read',source,max_chars:64000}),b=state.blocks.find(x=>x.kind===kind&&x.text==='가😀나 ABC'),last=state.blocks.find(x=>x.text==='끝');
 const request={source,expected_sha256:state.source_sha256,operations:[{type:'duplicate_paragraph',target_id:b.target_id,expected_old:b.text},{type:'splice_text',target_id:b.target_id,expected_old:b.text,start:0,end:0,new_text:'원본 '},{type:'splice_text',target_id:last.target_id,expected_old:last.text,start:0,end:0,new_text:'나중 '}]};
 assert.equal((await runLocal({action:'plan',...request})).saved,false);assert.deepEqual(fs.readFileSync(source),original);
 const saved=await runLocal({action:'edit',...request}),after=await runLocal({action:'read',source,max_chars:64000});assert.equal(saved.atomic_batch,true);
 assert.ok(after.blocks.some(x=>x.kind===kind&&x.text==='원본 가😀나 ABC'));assert.ok(after.blocks.some(x=>x.kind===kind&&x.text==='가😀나 ABC'));assert.ok(after.blocks.some(x=>x.text==='나중 끝'));
 await runLocal({action:'restore',source,expected_sha256:after.source_sha256,backup_id:saved.backup_id});assert.deepEqual(fs.readFileSync(source),original);
});
test('duplicating a section-control paragraph is refused before mutation',()=>{
 const source=fixture({table:false,paragraphs:['첫 문단','둘째']}),b=inspect(source).blocks[0];assert.throws(()=>edit(source,b,{type:'duplicate_paragraph'}),/PARAGRAPH_TARGET_HAS_CONTROLS/);
});
test('duplicate rejects unexpected operation fields and stale expected text',()=>{
 const source=mixed('paragraph'),b=inspect(source).blocks.find(x=>x.kind==='paragraph'&&x.text==='가😀나 ABC');
 assert.throws(()=>edit(source,b,{type:'duplicate_paragraph',offset:1}),/INVALID_OPERATION/);
 assert.throws(()=>edit(source,b,{type:'duplicate_paragraph',expected_old:'stale'}),/EXPECTED_OLD_MISMATCH/);
});
