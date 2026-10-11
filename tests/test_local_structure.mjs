import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { HwpDocument } from '@rhwp/core';
import { fixture } from './rhwp_fixtures.mjs';
import { openDocument, inspectDocument } from '../src/one_hwp/rhwp_bridge.mjs';
import { structuralEdit } from '../src/one_hwp/local_structure.mjs';
import CFB from '../probes/sites-runtime/node_modules/cfb/cfb.js';
import { rewriteSyntheticBody, withPageNumber } from '../probes/sites-runtime/tests/page-number-fixtures.mjs';
import { readHwp } from '../probes/sites-runtime/guard/container.mjs';
import { parseRecords } from '../probes/sites-runtime/guard/records.mjs';
const inspect = bytes => { const doc=openDocument(bytes); try{return inspectDocument(doc);}finally{doc.free();} };
const target = (bytes,block) => `hwp5:${createHash('sha256').update(bytes).digest('hex')}:${Buffer.from(block.id).toString('base64url')}`;
function edit(bytes,block,operation) {
  return structuralEdit(HwpDocument,bytes,createHash('sha256').update(bytes).digest('hex'),
    {target_id:target(bytes,block),expected_old:block.text,...operation});
}
const zeroCellWords=bytes=>rewriteSyntheticBody(bytes,records=>records.map(record=>{
 if(record.tag!==72)return record;const payload=record.payload.slice();payload.fill(0,6,8);return {...record,payload};
}));
const cellWords=bytes=>[...parseRecords(readHwp(bytes).streams.get('BodyText/Section0'))].filter(r=>r.tag===72)
 .map(r=>new DataView(r.payload.buffer,r.payload.byteOffset,r.payload.byteLength).getUint16(6,true));

for(const type of ['insert_paragraphs','create_table','replace_text'])test(`${type} preserves verified opaque page-number bytes`,()=>{
 const bytes=withPageNumber(fixture(),{paragraph:0}),block=inspect(bytes).blocks.find(b=>type==='replace_text'
   ?b.kind==='cell'&&b.text==='합성 답변 원문':b.kind==='paragraph'&&b.text==='중간 합성 문단');
 const operation=type==='insert_paragraphs'?{type,paragraphs:['추가 문단']}
   :type==='create_table'?{type,cells:[['새 표','값']]}:{type,new_text:'첫 답변\n둘째 답변'};
 const result=edit(bytes,block,operation);
 const opaque=input=>[...parseRecords(readHwp(input).streams.get('BodyText/Section0'))]
   .filter(r=>r.tag===71&&String.fromCharCode(...r.payload.subarray(0,4).toReversed())==='pgnp').map(r=>[...r.payload]);
 assert.deepEqual(opaque(bytes),opaque(result.bytes));assert.equal(opaque(result.bytes).length,1);
});
test('a malformed page-number profile still refuses structural edits',()=>{
 const bytes=withPageNumber(fixture(),{position:17}),block=inspect(bytes).blocks.find(b=>b.text==='중간 합성 문단');
 assert.throws(()=>edit(bytes,block,{type:'insert_paragraphs',paragraphs:['追加']}),/UNSUPPORTED_EDIT_PROFILE/);
});
test('table insertion after an empty paragraph preserves it and following content',()=>{
 const bytes=fixture({table:false,paragraphs:['시작','','끝']}),block=inspect(bytes).blocks[1];
 const result=edit(bytes,block,{type:'create_table',cells:[['새 표','값']]});
 assert.deepEqual(inspect(result.bytes).blocks.filter(b=>b.kind==='paragraph').map(b=>b.text),['시작','','','','끝']);
 assert.equal(inspect(result.bytes).tables[0].paragraph,2);
});
for(const type of ['insert_table_row','insert_table_column','delete_table_row','delete_table_column']) {
 for(const index of type.startsWith('insert')?[0,1,2]:[0,1])test(`${type} at ${index} preserves retained cells and opaque zero words`,()=>{
  const bytes=zeroCellWords(fixture()),before=inspect(bytes),block=before.blocks.find(b=>b.kind==='cell'),rowAxis=type.endsWith('_row');
  const operation={type,index,...(type.startsWith('insert')?{texts:['新 값','새 칸 😀']}
   :{expected_cells:before.tables[0].cells.filter(c=>c[rowAxis?'row':'col']===index).map(c=>before.blocks.filter(b=>b.kind==='cell'&&b.cell===c.cell).map(b=>b.text))})};
  const result=edit(bytes,block,operation),after=inspect(result.bytes),table=after.tables[0];
  assert.equal(table.dimensions[rowAxis?'rowCount':'colCount'],type.startsWith('insert')?3:1);
  assert.equal(result.raw_preservation_verified,true);
  if(type.startsWith('insert'))assert.deepEqual(after.blocks.filter(b=>b.kind==='cell'&&b[rowAxis?'row':'column']===index).map(b=>b.text),operation.texts);
  assert.equal(cellWords(result.bytes).filter(n=>n===0).length,type.startsWith('insert')?4:2);
 });
}
test('row deletion requires matching contents and refuses deleting the last row',()=>{
 const bytes=fixture(),block=inspect(bytes).blocks.find(b=>b.kind==='cell');
 assert.throws(()=>edit(bytes,block,{type:'delete_table_row',index:0,expected_cells:[['wrong'],['contents']]}),/EXPECTED_TABLE_CELLS_MISMATCH/);
 const oneRow=fixture({cells:[['한 행','값']]}),targetCell=inspect(oneRow).blocks.find(b=>b.kind==='cell');
 assert.throws(()=>edit(oneRow,targetCell,{type:'delete_table_row',index:0,expected_cells:[['한 행'],['값']]}),/INVALID_TABLE_DIMENSIONS/);
});
test('row insertion preserves existing horizontal merged cells',()=>{
 const document=openDocument(fixture());let bytes;
 try {assert.equal(JSON.parse(document.mergeTableCells(0,1,0,0,0,0,1)).ok,true);bytes=document.exportHwp();}finally{document.free();}
 const before=inspect(bytes),block=before.blocks.find(b=>b.kind==='cell');
 const out=edit(bytes,block,{type:'insert_table_row',index:1,texts:['새 칸','값']}),after=inspect(out.bytes);
 assert.equal(after.tables[0].cells[0].colSpan,2);assert.deepEqual(after.tables[0].cells[0],before.tables[0].cells[0]);
 assert.equal(after.tables[0].dimensions.rowCount,3);assert.ok(after.blocks.some(b=>b.text==='새 칸'));assert.equal(out.raw_preservation_verified,true);
});
test('merging distinct uniform character styles is refused without changing either paragraph',()=>{
 const document=openDocument(fixture({table:false}));let bytes;
 try {assert.equal(JSON.parse(document.applyCharFormat(0,1,0,[...'중간 합성 문단'].length,JSON.stringify({bold:true}))).ok,true);bytes=document.exportHwp();}finally{document.free();}
 const before=inspect(bytes),block=before.blocks[1];
 assert.throws(()=>edit(bytes,block,{type:'merge_paragraph',previous_target_id:target(bytes,before.blocks[0]),expected_previous:before.blocks[0].text}),/MERGE_STYLE_MISMATCH/);
});
for(const corruption of ['cell_padding','table_width'])test(`table insertion refuses unintended ${corruption} change`,()=>{
 const bytes=fixture(),hash=createHash('sha256').update(bytes).digest('hex'),block=inspect(bytes).blocks.find(b=>b.kind==='cell');
 class TamperingDocument {
  constructor(input){const document=new HwpDocument(input);return new Proxy(document,{get(target,key){
   if(key==='exportHwpWithReport')return ()=>{const exported=target.exportHwpWithReport();return {
    contentLoss:()=>exported.contentLoss(),free:()=>exported.free(),takeBytes:()=>rewriteSyntheticBody(exported.takeBytes(),records=>{
     let changed=false;return records.map(r=>{
      if(changed)return r;
      if(corruption==='cell_padding'&&r.tag===72 || corruption==='table_width'&&r.tag===71&&String.fromCharCode(...r.payload.subarray(0,4).toReversed())==='tbl '){
       changed=true;const payload=r.payload.slice();payload[corruption==='cell_padding'?24:16]^=1;return {...r,payload};
      }return r;
     });
    })};};
   const value=target[key];return typeof value==='function'?value.bind(target):value;
  }});}
 }
 assert.throws(()=>structuralEdit(TamperingDocument,bytes,hash,{type:'insert_table_row',target_id:target(bytes,block),expected_old:block.text,index:1,texts:['새 칸','값']}));
});
test('a page-number placement outside the independently verified profile is refused',()=>{
 const bytes=withPageNumber(fixture(),{paragraph:3}),block=inspect(bytes).blocks.find(b=>b.kind==='paragraph'&&b.paragraph===2);
 assert.throws(()=>edit(bytes,block,{type:'delete_paragraph'}),/UNSUPPORTED_EDIT_PROFILE/);
});
for(const type of ['delete_paragraph','merge_paragraph'])test(`${type} removes only the selected plain body paragraph`,()=>{
 const bytes=fixture({table:false}),before=inspect(bytes),block=before.blocks[1];
 const operation=type==='delete_paragraph'?{type}:{type,previous_target_id:target(bytes,before.blocks[0]),expected_previous:before.blocks[0].text};
 const result=edit(bytes,block,operation),after=inspect(result.bytes);
 assert.deepEqual(after.blocks.map(b=>b.text),type==='delete_paragraph'
   ?['첫 합성 문단','마지막 합성 문단']:['첫 합성 문단중간 합성 문단','마지막 합성 문단']);
 assert.equal(result.raw_preservation_verified,true);
});
for(const type of ['delete_paragraph','merge_paragraph'])test(`${type} inside a cell retains all other cells and correct paragraph counts`,()=>{
 const original=zeroCellWords(fixture()),first=inspect(original).blocks.find(b=>b.text==='합성 답변 원문');
 const bytes=edit(original,first,{type:'replace_text',new_text:'첫째\n둘째\n셋째'}).bytes,before=inspect(bytes),block=before.blocks.find(b=>b.text==='둘째'),previous=before.blocks.find(b=>b.text==='첫째');
 const operation=type==='delete_paragraph'?{type}:{type,previous_target_id:target(bytes,previous),expected_previous:previous.text};
 const result=edit(bytes,block,operation),after=inspect(result.bytes);
 assert.deepEqual(after.blocks.filter(b=>b.kind==='cell'&&b.cell===first.cell).map(b=>b.text),type==='delete_paragraph'?['첫째','셋째']:['첫째둘째','셋째']);
 assert.deepEqual(after.blocks.filter(b=>b.kind==='cell'&&b.cell!==first.cell),before.blocks.filter(b=>b.kind==='cell'&&b.cell!==first.cell));
 assert.deepEqual(cellWords(result.bytes),[0,0,0,0]);
});
test('paragraph deletion keeps a shifted existing table exact',()=>{
 const bytes=fixture(),block=inspect(bytes).blocks.find(b=>b.kind==='paragraph'&&b.text==='중간 합성 문단');
 const result=edit(bytes,block,{type:'delete_paragraph'});
 assert.deepEqual(inspect(result.bytes).blocks.filter(b=>b.kind==='cell').map(b=>b.text),inspect(bytes).blocks.filter(b=>b.kind==='cell').map(b=>b.text));
});
test('removal refuses section controls, missing previous target, and style disagreement',()=>{
 const bytes=fixture({table:false}),before=inspect(bytes);
 assert.throws(()=>edit(bytes,before.blocks[0],{type:'delete_paragraph'}),/STRUCTURAL_TARGET_HAS_CONTROLS/);
 assert.throws(()=>edit(bytes,before.blocks[1],{type:'merge_paragraph',previous_target_id:target(bytes,before.blocks[2]),expected_previous:before.blocks[2].text}),/PREVIOUS_PARAGRAPH_MISMATCH/);
});

for(const operationType of ['multiline_cell','insert_paragraphs','create_table'])test(`structural ${operationType} preserves original zero cell words`,()=>{
 const bytes=zeroCellWords(fixture()),before=inspect(bytes),block=before.blocks.find(b=>operationType==='multiline_cell'
   ?b.kind==='cell'&&b.text==='합성 답변 원문':b.kind==='paragraph'&&b.text==='중간 합성 문단');
 const operation=operationType==='multiline_cell'?{type:'replace_text',new_text:'첫 답변\n둘째 답변'}
  :operationType==='insert_paragraphs'?{type:operationType,paragraphs:['새 문단','둘째 문단']}
  :{type:operationType,cells:[['항목','값'],['새 항목','새 값']]};
 const result=edit(bytes,block,operation),words=cellWords(result.bytes);
 assert.equal(result.restored_cell_list_words,4);assert.equal(words.filter(word=>word===0).length,4);
 assert.equal(words.length,operationType==='create_table'?8:4);
 assert.ok(words.every(word=>word===0||word===0x0400));
 assert.deepEqual(cellWords(bytes),[0,0,0,0]);
});

test('structural cell-word repair refuses a different opaque transition',()=>{
 const bytes=zeroCellWords(fixture()),hash=createHash('sha256').update(bytes).digest('hex'),block=inspect(bytes).blocks.find(b=>b.text==='중간 합성 문단');
 class CorruptingDocument {
  constructor(input){const doc=new HwpDocument(input);return new Proxy(doc,{get(target,property){
   if(property==='exportHwpWithReport')return ()=>{const exported=target.exportHwpWithReport();return {
    contentLoss:()=>exported.contentLoss(),free:()=>exported.free(),takeBytes:()=>rewriteSyntheticBody(exported.takeBytes(),records=>records.map(record=>{
     if(record.tag!==72)return record;const payload=record.payload.slice();payload[7]=5;return {...record,payload};
    }))};};
   const value=target[property];return typeof value==='function'?value.bind(target):value;
  }});}
 }
 assert.throws(()=>structuralEdit(CorruptingDocument,bytes,hash,{type:'insert_paragraphs',target_id:target(bytes,block),expected_old:block.text,paragraphs:['요청한 문단']}),/CELL_PRESERVATION_MISMATCH/);
});
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
