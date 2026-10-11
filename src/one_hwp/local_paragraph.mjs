/** Plain paragraph boundaries that retain mixed character runs. */
import {GuardError} from '../../probes/sites-runtime/guard/records.mjs';
import {canonicalRecord,textControlBytes} from '../../probes/sites-runtime/guard/preservation.mjs';
import {verifyPlainCharacterRuns} from './local_text.mjs';
import {MAX_MIXED_STYLE_RUNS} from './mixed_style.mjs';
import {modelCharacterIds,verifyModelCharacterIds} from './local_character_runs.mjs';
const fail=code=>{throw new GuardError(code);};
const equal=(a,b)=>JSON.stringify(a)===JSON.stringify(b);
const bytesEqual=(a,b)=>a.length===b.length&&a.every((v,i)=>v===b[i]);
const view=b=>new DataView(b.buffer,b.byteOffset,b.byteLength);
function charAt(doc,b,offset){return JSON.parse(b.kind==='paragraph'?doc.getCharPropertiesAt(b.section,b.paragraph,offset)
  :doc.getCellCharPropertiesAt(b.section,b.paragraph,b.control,b.cell,b.cell_paragraph,offset));}
function plain(block,records){
  if(/[\u0000-\u001f]/.test(block.text)||records.some(r=>![66,67,68,69,72].includes(r.tag))
    ||records.filter(r=>r.tag===67).some(r=>{const c=textControlBytes(r.payload);return c.length!==2||view(c).getUint16(0,true)!==13;}))fail('PARAGRAPH_TARGET_HAS_CONTROLS');
}
function restore(doc,b,ids,emptyId){
  const checked=r=>{if(!JSON.parse(r).ok)fail('ENGINE_OPERATION_FAILED');};
  for(let from=0;from<Math.max(1,ids.length);){let to=from+1;while(to<ids.length&&ids[to]===ids[from])to++;
    const end=ids.length?to:0,id=ids[from]??emptyId;
    checked(b.kind==='paragraph'?doc.setCharShapeId(b.section,b.paragraph,from,end,id)
      :doc.setCharShapeIdInCell(b.section,b.paragraph,b.control,b.cell,b.cell_paragraph,from,end,id));from=to;
  }
}
export function prepareParagraphChange(doc,block,operation,records,previous){
  plain(block,records.get(block.id));
  const duplicating=operation.type==='duplicate_paragraph',splitting=operation.type==='split_paragraph'||duplicating,points=[...block.text],ids=modelCharacterIds(block,'PARAGRAPH_STYLE_MISMATCH');
  if(duplicating&&block.text.length>100000)fail('EDIT_LIMIT_EXCEEDED');
  verifyPlainCharacterRuns(records.get(block.id),block.text,ids,charAt(doc,block,0).charShapeId);
  let specifications;
  if(splitting){
    const offset=duplicating?points.length:operation.offset;if(!Number.isSafeInteger(offset)||offset<0||offset>points.length)fail('INVALID_PARAGRAPH_OFFSET');
    const first={block,text:points.slice(0,offset).join(''),ids:ids.slice(0,offset),emptyId:ids[Math.max(0,offset-1)]??charAt(doc,block,0).charShapeId};
    const secondBlock=structuredClone(block);if(block.kind==='paragraph')secondBlock.paragraph++;else secondBlock.cell_paragraph++;
    secondBlock.id=`s${secondBlock.section}:p${secondBlock.paragraph}`+(block.kind==='cell'?`:t${block.control}:c${block.cell}:p${secondBlock.cell_paragraph}`:'');
    specifications=[first,{block:secondBlock,text:duplicating?block.text:points.slice(offset).join(''),ids:duplicating?ids.slice():ids.slice(offset),emptyId:duplicating?first.emptyId:ids[offset]??ids.at(-1)??first.emptyId}];
  }else{
    plain(previous,records.get(previous.id));
    const prior=modelCharacterIds(previous,'PARAGRAPH_STYLE_MISMATCH');
    verifyPlainCharacterRuns(records.get(previous.id),previous.text,prior,charAt(doc,previous,0).charShapeId);
    if(previous.text.length+block.text.length>100000)fail('EDIT_LIMIT_EXCEEDED');
    specifications=[{block:previous,text:previous.text+block.text,ids:prior.concat(ids),emptyId:charAt(doc,previous,0).charShapeId}];
    if(specifications[0].ids.filter((id,i,a)=>!i||id!==a[i-1]).length>MAX_MIXED_STYLE_RUNS)fail('MIXED_STYLE_RUN_LIMIT_EXCEEDED');
  }
  const checked=r=>{if(!JSON.parse(r).ok)fail('ENGINE_OPERATION_FAILED');};
  function apply(){
    if(splitting){
      const offset=duplicating?points.length:operation.offset;
      checked(block.kind==='paragraph'?doc.splitParagraph(block.section,block.paragraph,offset)
        :doc.splitParagraphInCell(block.section,block.paragraph,block.control,block.cell,block.cell_paragraph,offset));
      if(duplicating&&block.text){const b=specifications[1].block;checked(b.kind==='paragraph'?doc.insertText(b.section,b.paragraph,0,block.text)
        :doc.insertTextInCell(b.section,b.paragraph,b.control,b.cell,b.cell_paragraph,0,block.text));}
    }
    else checked(block.kind==='paragraph'?doc.mergeParagraph(block.section,block.paragraph)
      :doc.mergeParagraphInCell(block.section,block.paragraph,block.control,block.cell,block.cell_paragraph));
    for(const s of specifications)restore(doc,s.block,s.ids,s.emptyId);
  }
  function verifyBlock(saved,reopened,index=0){
    const s=specifications[index],old=structuredClone(s.block),now=structuredClone(saved);old.text=s.text;
    delete old.style;delete now.style;delete old.editable;delete now.editable;
    if(!equal(old,now)||!equal(s.block.style.paragraph,saved.style.paragraph))fail('PARAGRAPH_CONTENT_MISMATCH');
    verifyModelCharacterIds(saved,s.ids,s.emptyId,'PARAGRAPH_STYLE_MISMATCH');
  }
  function verifyRecords(left,right,index=0){
    const s=specifications[index],normalize=(list,original=false)=>list.filter(r=>![67,68,69,72].includes(r.tag)).map(r=>{
      const c=canonicalRecord(r,0,new Set([0]));if(r.tag===66){c.payload=c.payload.slice();view(c.payload).setUint32(0,0,true);
        // A newly created paragraph uses the engine's zero instance ID. The
        // original paragraph's instance and every other opaque byte stay exact.
        if(original&&index===1)view(c.payload).setUint32(18,0,true);
      }return c;
    }),a=normalize(left,true),b=normalize(right);
    if(a.length!==b.length||a.some((r,i)=>r.tag!==b[i].tag||r.level!==b[i].level||!bytesEqual(r.payload,b[i].payload)))fail('PARAGRAPH_RECORD_MISMATCH');
    const text=right.filter(r=>r.tag===67);if(text.length>1)fail('PARAGRAPH_RECORD_MISMATCH');
    const controls=text.length?textControlBytes(text[0].payload):new Uint8Array([13,0]);
    if(controls.length!==2||view(controls).getUint16(0,true)!==13)fail('PARAGRAPH_RECORD_MISMATCH');
    verifyPlainCharacterRuns(right,s.text,s.ids,s.emptyId);
  }
  return {apply,verifyBlock,verifyRecords,specifications};
}
