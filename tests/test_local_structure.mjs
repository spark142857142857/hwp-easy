import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { HwpDocument } from '@rhwp/core';
import { fixture } from './rhwp_fixtures.mjs';
import { openDocument, inspectDocument } from '../src/one_hwp/rhwp_bridge.mjs';
import { structuralEdit } from '../src/one_hwp/local_structure.mjs';
import CFB from '../probes/sites-runtime/node_modules/cfb/cfb.js';
const inspect = bytes => { const doc=openDocument(bytes); try{return inspectDocument(doc);}finally{doc.free();} };
const target = (bytes,block) => `hwp5:${createHash('sha256').update(bytes).digest('hex')}:${Buffer.from(block.id).toString('base64url')}`;
function edit(bytes,block,operation) {
  return structuralEdit(HwpDocument,bytes,createHash('sha256').update(bytes).digest('hex'),
    {target_id:target(bytes,block),expected_old:block.text,...operation});
}
test('body multiline replacement preserves surrounding content and existing table',()=>{
 const bytes=fixture(),before=inspect(bytes),block=before.blocks.find(b=>b.text==='중간 합성 문단');
 const out=edit(bytes,block,{type:'replace_text',new_text:'첫줄\n둘째줄 😀\n'});
 assert.deepEqual(inspect(out.bytes).blocks.filter(b=>b.kind==='paragraph').slice(-4).map(b=>b.text),['첫줄','둘째줄 😀','','마지막 합성 문단']);
 assert.equal(out.content_verified,true);
});
test('cell multiline replacement adds cell paragraphs while other cells stay unchanged',()=>{
 const bytes=fixture(),before=inspect(bytes),block=before.blocks.find(b=>b.kind==='cell'&&b.text==='합성 답변 원문');
 const out=edit(bytes,block,{type:'replace_text',new_text:'답변1\n답변2'}),after=inspect(out.bytes);
 assert.deepEqual(after.blocks.filter(b=>b.kind==='cell'&&b.cell===block.cell).map(b=>b.text),['답변1','답변2']);
 assert.deepEqual(after.blocks.filter(b=>b.kind==='cell'&&b.cell!==block.cell).map(b=>b.text),before.blocks.filter(b=>b.kind==='cell'&&b.cell!==block.cell).map(b=>b.text));
});
test('fill a genuinely empty cell with a multiline answer',()=>{
 const bytes=fixture({cells:[['질문',''],['보존','답변']]}),block=inspect(bytes).blocks.find(b=>b.kind==='cell'&&b.text==='');
 const out=edit(bytes,block,{type:'replace_text',new_text:'첫 답변\n둘째 답변'});
 assert.deepEqual(inspect(out.bytes).blocks.filter(b=>b.kind==='cell'&&b.cell===block.cell).map(b=>b.text),['첫 답변','둘째 답변']);
});
test('insert new paragraph before an existing table and preserve shifted table coordinates',()=>{
 const bytes=fixture({paragraphs:['첫 문단','중간 문단','끝']}),block=inspect(bytes).blocks.find(b=>b.kind==='paragraph'&&b.text==='끝');
 const out=edit(bytes,block,{type:'insert_paragraphs',paragraphs:['English new paragraph 😀']});
 assert.ok(inspect(out.bytes).blocks.some(b=>b.text==='English new paragraph 😀'));
});
test('add paragraphs with inherited bold style',()=>{
 const bytes=fixture({table:false,bold:true,paragraphs:['굵게','중간','끝']}),block=inspect(bytes).blocks[0];
 const out=edit(bytes,block,{type:'replace_text',new_text:'English line\n한글 둘째줄'});
 assert.equal(inspect(out.bytes).blocks[0].text,'English line');
 assert.equal(inspect(out.bytes).blocks[1].style.char.bold,true);
});
test('insert paragraphs after middle body paragraph preserves following paragraph',()=>{
 const bytes=fixture({table:false}),block=inspect(bytes).blocks[1];
 const out=edit(bytes,block,{type:'insert_paragraphs',paragraphs:['새 문단','두번째 😀']});
 assert.deepEqual(inspect(out.bytes).blocks.map(b=>b.text),['첫 합성 문단','중간 합성 문단','새 문단','두번째 😀','마지막 합성 문단']);
});
for(const position of [0,1,2])test(`create a 2 by 2 table after paragraph ${position}`,()=>{
 const bytes=fixture({table:false}),block=inspect(bytes).blocks[position];
 const out=edit(bytes,block,{type:'create_table',cells:[['이름','합성 이름'],['내용','합성 답변']]}),after=inspect(out.bytes);
 assert.equal(after.tables.length,1);assert.deepEqual(after.blocks.filter(b=>b.kind==='cell').map(b=>b.text),['이름','합성 이름','내용','합성 답변']);
 assert.deepEqual(after.blocks.filter(b=>b.kind==='paragraph'&&b.text).map(b=>b.text),['첫 합성 문단','중간 합성 문단','마지막 합성 문단']);
});
test('replace first paragraph with new paragraphs without copying section controls',()=>{
 const bytes=fixture({table:false}),block=inspect(bytes).blocks[0];
 const out=edit(bytes,block,{type:'replace_text',new_text:'새 첫문단\n두번째'});
 assert.deepEqual(inspect(out.bytes).blocks.map(b=>b.text),['새 첫문단','두번째','중간 합성 문단','마지막 합성 문단']);
});
test('replace existing forced line breaks with real paragraphs',()=>{
 const bytes=fixture({table:false,paragraphs:['시작','기존\n줄바꿈','끝']}),block=inspect(bytes).blocks[1];
 const out=edit(bytes,block,{type:'replace_text',new_text:'첫 답변\n둘째 답변'});
 assert.deepEqual(inspect(out.bytes).blocks.map(b=>b.text),['시작','첫 답변','둘째 답변','끝']);
});
test('stale old text and unknown operation fail before export',()=>{
 const bytes=fixture({table:false}),block=inspect(bytes).blocks[1];
 assert.throws(()=>edit(bytes,block,{type:'insert_paragraphs',paragraphs:['새 문단'],expected_old:'stale'}));
 assert.throws(()=>edit(bytes,block,{type:'run_code',code:'exit()'}));
});
for(const corruption of ['content','file_header'])test(`structural export rejects unintended ${corruption} changes`,()=>{
 const bytes=fixture({table:false}),hash=createHash('sha256').update(bytes).digest('hex'),block=inspect(bytes).blocks[1];
 class TamperingDocument {
   constructor(input) {
     const doc=new HwpDocument(input);
     return new Proxy(doc,{get(target,property){
       if(property==='exportHwpWithReport')return ()=>{
         if(corruption==='content')target.replaceText(0,2,0,target.getParagraphLength(0,2),'unrequested change');
         const result=target.exportHwpWithReport();
         if(corruption!=='file_header')return result;
         return {contentLoss:()=>result.contentLoss(),free:()=>result.free(),takeBytes:()=>{
           const container=CFB.read(result.takeBytes(),{type:'array'});const header=CFB.find(container,'FileHeader');
           header.content[40]^=1;return new Uint8Array(CFB.write(container,{type:'array'}));
         }};
       };
       const value=target[property];return typeof value==='function'?value.bind(target):value;
     }});
   }
 }
 assert.throws(()=>structuralEdit(TamperingDocument,bytes,hash,{type:'insert_paragraphs',target_id:target(bytes,block),expected_old:block.text,paragraphs:['authorized paragraph']}));
 assert.equal(createHash('sha256').update(bytes).digest('hex'),hash);
});
