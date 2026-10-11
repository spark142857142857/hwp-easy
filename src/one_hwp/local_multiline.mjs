/** Insert actual paragraph breaks into a plain mixed-style text range. */
import {GuardError} from '../../probes/sites-runtime/guard/records.mjs';
import {canonicalRecord,textControlBytes} from '../../probes/sites-runtime/guard/preservation.mjs';
import {verifyPlainCharacterRuns} from './local_text.mjs';
const fail=code=>{throw new GuardError(code);},equal=(a,b)=>JSON.stringify(a)===JSON.stringify(b);
const bytesEqual=(a,b)=>a.length===b.length&&a.every((v,i)=>v===b[i]),view=b=>new DataView(b.buffer,b.byteOffset,b.byteLength);
export function prepareMultilineSplice(doc,block,op,records){
 const points=[...block.text],{start,end,new_text:value}=op;
 if(!Number.isSafeInteger(start)||!Number.isSafeInteger(end)||start<0||end<start||end>points.length||typeof value!=='string'||!value.isWellFormed()
   ||/[\u0000-\u0009\u000b-\u001f]/.test(value)||/[\u0000-\u001f]/.test(block.text))fail('INVALID_TEXT_RANGE');
 const parts=value.split('\n');if(parts.length<2||parts.length>100)fail('INVALID_PARAGRAPH_COUNT');
 if(points.slice(0,start).join('').length+value.length+points.slice(end).join('').length>100000)fail('EDIT_LIMIT_EXCEEDED');
 if(records.some(r=>![66,67,68,69,72].includes(r.tag))||records.filter(r=>r.tag===67).some(r=>{const c=textControlBytes(r.payload);return c.length!==2||view(c).getUint16(0,true)!==13;}))fail('TEXT_TARGET_HAS_CONTROLS');
 const properties=(document,b,offset)=>JSON.parse(b.kind==='paragraph'?document.getCharPropertiesAt(b.section,b.paragraph,offset)
   :document.getCellCharPropertiesAt(b.section,b.paragraph,b.control,b.cell,b.cell_paragraph,offset));
 const prior=points.map((_,i)=>properties(doc,block,i).charShapeId),emptyId=properties(doc,block,0).charShapeId;
 verifyPlainCharacterRuns(records,block.text,prior,emptyId);
 const inherited=start<end?prior[start]:prior[Math.max(0,start-1)]??emptyId;
 const specifications=parts.map((part,index)=>{
  const b=structuredClone(block);if(b.kind==='paragraph')b.paragraph+=index;else b.cell_paragraph+=index;
  b.id=`s${b.section}:p${b.paragraph}`+(b.kind==='cell'?`:t${b.control}:c${b.cell}:p${b.cell_paragraph}`:'');
  return {block:b,text:(index===0?points.slice(0,start).join(''):'')+part+(index===parts.length-1?points.slice(end).join(''):''),
   ids:(index===0?prior.slice(0,start):[]).concat(Array([...part].length).fill(inherited),index===parts.length-1?prior.slice(end):[]),emptyId:inherited};
 });
 const checked=r=>{if(JSON.parse(r).ok!==true)fail('ENGINE_OPERATION_FAILED');};
 const insert=(b,offset,text)=>{if(text)checked(b.kind==='paragraph'?doc.insertText(b.section,b.paragraph,offset,text):doc.insertTextInCell(b.section,b.paragraph,b.control,b.cell,b.cell_paragraph,offset,text));};
 const split=(b,offset)=>checked(b.kind==='paragraph'?doc.splitParagraph(b.section,b.paragraph,offset):doc.splitParagraphInCell(b.section,b.paragraph,b.control,b.cell,b.cell_paragraph,offset));
 function apply(){
  if(end>start)checked(block.kind==='paragraph'?doc.deleteText(block.section,block.paragraph,start,end-start):doc.deleteTextInCell(block.section,block.paragraph,block.control,block.cell,block.cell_paragraph,start,end-start));
  insert(block,start,parts[0]);split(block,start+[...parts[0]].length);
  for(let i=1;i<parts.length;i++){insert(specifications[i].block,0,parts[i]);if(i<parts.length-1)split(specifications[i].block,[...parts[i]].length);}
  for(const s of specifications){
   for(let from=0;from<Math.max(1,s.ids.length);){let to=from+1;while(to<s.ids.length&&s.ids[to]===s.ids[from])to++;
    const stop=s.ids.length?to:0,id=s.ids[from]??s.emptyId,b=s.block;
    checked(b.kind==='paragraph'?doc.setCharShapeId(b.section,b.paragraph,from,stop,id):doc.setCharShapeIdInCell(b.section,b.paragraph,b.control,b.cell,b.cell_paragraph,from,stop,id));from=to;
   }
  }
 }
 function verifyBlock(saved,reopened,index=0){
  const s=specifications[index],old=structuredClone(s.block),now=structuredClone(saved);old.text=s.text;
  delete old.style;delete now.style;delete old.editable;delete now.editable;
  if(!equal(old,now)||!equal(s.block.style.paragraph,saved.style.paragraph))fail('TEXT_CONTENT_MISMATCH');
  if(!s.ids.length&&properties(reopened,saved,0).charShapeId!==s.emptyId)fail('TEXT_STYLE_MISMATCH');
  for(let i=0;i<s.ids.length;i++)if(properties(reopened,saved,i).charShapeId!==s.ids[i])fail('TEXT_STYLE_MISMATCH');
 }
 function verifyRecords(left,right,index=0){
  const s=specifications[index],normalize=(list,original=false)=>list.filter(r=>![67,68,69,72].includes(r.tag)).map(r=>{
   const c=canonicalRecord(r,0,new Set([0]));if(r.tag===66){c.payload=c.payload.slice();view(c.payload).setUint32(0,0,true);if(original&&index>0)view(c.payload).setUint32(18,0,true);}return c;
  }),a=normalize(left,true),b=normalize(right);
  if(a.length!==b.length||a.some((r,i)=>r.tag!==b[i].tag||r.level!==b[i].level||!bytesEqual(r.payload,b[i].payload)))fail('TEXT_RECORD_MISMATCH');
  const text=right.filter(r=>r.tag===67);if(text.length>1)fail('TEXT_RECORD_MISMATCH');const controls=text.length?textControlBytes(text[0].payload):new Uint8Array([13,0]);
  if(controls.length!==2||view(controls).getUint16(0,true)!==13)fail('TEXT_RECORD_MISMATCH');
  verifyPlainCharacterRuns(right,s.text,s.ids,s.emptyId);
 }
 return {apply,verifyBlock,verifyRecords,specifications,added:parts.length-1};
}
