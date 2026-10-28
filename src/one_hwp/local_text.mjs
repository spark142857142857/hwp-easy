/** Range insertion/deletion with explicit preservation of every retained style. */
import {GuardError} from './guard/records.mjs';
import {canonicalRecord,textControlBytes} from './guard/preservation.mjs';
import {modelCharacterIds,verifyModelCharacterIds} from './local_character_runs.mjs';
const fail=code=>{throw new GuardError(code);};
const equal=(a,b)=>JSON.stringify(a)===JSON.stringify(b);
const bytesEqual=(a,b)=>a.length===b.length&&a.every((v,i)=>v===b[i]);
const view=b=>new DataView(b.buffer,b.byteOffset,b.byteLength);
export function verifyPlainCharacterRuns(records,text,ids,emptyShape){
  const runs=records.filter(r=>r.tag===68),header=records.find(r=>r.tag===66);
  if(runs.length!==1||runs[0].payload.length%8||!header||view(header.payload).getUint16(12,true)!==runs[0].payload.length/8)fail('TEXT_RECORD_MISMATCH');
  const v=view(runs[0].payload),anchors=[];
  for(let i=0;i<runs[0].payload.length;i+=8)anchors.push({position:v.getUint32(i,true),shape:v.getUint32(i+4,true)});
  if(!anchors.length||anchors[0].position!==0||anchors.some((a,i)=>i&&a.position<=anchors[i-1].position))fail('TEXT_RECORD_MISMATCH');
  let offset=0,point=0,at=0;for(const ch of text){for(let unit=0;unit<ch.length;unit++){while(at+1<anchors.length&&anchors[at+1].position<=offset+unit)at++;if(anchors[at].shape!==ids[point])fail('TEXT_RECORD_MISMATCH');}offset+=ch.length;point++;}
  if(anchors.some(a=>a.position>offset)||!ids.length&&anchors.some(a=>a.shape!==emptyShape))fail('TEXT_RECORD_MISMATCH');
}
export function prepareTextSplice(doc,block,operation,records) {
  const points=[...block.text],{start,end,new_text:value}=operation;
  if(!Number.isSafeInteger(start)||!Number.isSafeInteger(end)||start<0||end<start||end>points.length
    ||typeof value!=='string'||!value.isWellFormed()||/[\u0000-\u001f]/.test(value)
    ||value.length>100000||/[\u0000-\u001f]/.test(block.text))fail('INVALID_TEXT_RANGE');
  const wanted=points.slice(0,start).join('')+value+points.slice(end).join('');
  if(wanted.length>100000)fail('EDIT_LIMIT_EXCEEDED');
  if(records.some(r=>![66,67,68,69,72].includes(r.tag))
    ||records.filter(r=>r.tag===67).some(r=>{const c=textControlBytes(r.payload);return c.length!==2||view(c).getUint16(0,true)!==13;}))fail('TEXT_TARGET_HAS_CONTROLS');
  const charAt=(document,offset)=>JSON.parse(block.kind==='paragraph'
    ?document.getCharPropertiesAt(block.section,block.paragraph,offset)
    :document.getCellCharPropertiesAt(block.section,block.paragraph,block.control,block.cell,block.cell_paragraph,offset));
  const prior=modelCharacterIds(block),emptyShape=charAt(doc,0).charShapeId;
  verifyPlainCharacterRuns(records,block.text,prior,emptyShape);
  // Replacement inherits the first removed character. Pure insertion inherits
  // the left neighbour, or the first character at the beginning of a paragraph.
  const inherited=start<end?prior[start]:prior[Math.max(0,start-1)]??emptyShape;
  const expected=prior.slice(0,start).concat(Array([...value].length).fill(inherited),prior.slice(end));
  const checked=result=>{if(JSON.parse(result).ok!==true)fail('ENGINE_OPERATION_FAILED');};
  function apply(){
    if(end>start)checked(block.kind==='paragraph'?doc.deleteText(block.section,block.paragraph,start,end-start)
      :doc.deleteTextInCell(block.section,block.paragraph,block.control,block.cell,block.cell_paragraph,start,end-start));
    if(value)checked(block.kind==='paragraph'?doc.insertText(block.section,block.paragraph,start,value)
      :doc.insertTextInCell(block.section,block.paragraph,block.control,block.cell,block.cell_paragraph,start,value));
    // Engine run shifting is not the proof. Restore each expected run and check
    // the reopened model and raw UTF-16 anchors independently below.
    for(let from=0;from<expected.length;){let to=from+1;while(to<expected.length&&expected[to]===expected[from])to++;
      checked(block.kind==='paragraph'?doc.setCharShapeId(block.section,block.paragraph,from,to,expected[from])
        :doc.setCharShapeIdInCell(block.section,block.paragraph,block.control,block.cell,block.cell_paragraph,from,to,expected[from]));from=to;
    }
    if(!expected.length)checked(block.kind==='paragraph'?doc.setCharShapeId(block.section,block.paragraph,0,0,emptyShape)
      :doc.setCharShapeIdInCell(block.section,block.paragraph,block.control,block.cell,block.cell_paragraph,0,0,emptyShape));
  }
  function verifyBlock(saved,reopened){
    const old=structuredClone(block),now=structuredClone(saved);old.text=wanted;
    delete old.style;delete now.style;delete old.editable;delete now.editable;
    if(!equal(old,now)||!equal(block.style.paragraph,saved.style.paragraph))fail('TEXT_CONTENT_MISMATCH');
    verifyModelCharacterIds(saved,expected,emptyShape);
  }
  function verifyRecords(left,right){
    const controls=list=>{const r=list.filter(r=>r.tag===67);if(r.length>1)fail('TEXT_RECORD_MISMATCH');return r.length?textControlBytes(r[0].payload):new Uint8Array([13,0]);};
    if(!bytesEqual(controls(left),controls(right)))fail('TEXT_RECORD_MISMATCH');
    const normalize=list=>list.filter(r=>![67,68,69,72].includes(r.tag)).map(r=>canonicalRecord(r,0,new Set([0])));
    const a=normalize(left),b=normalize(right);
    if(a.length!==b.length||a.some((r,i)=>r.tag!==b[i].tag||r.level!==b[i].level||!bytesEqual(r.payload,b[i].payload)))fail('TEXT_RECORD_MISMATCH');
    verifyPlainCharacterRuns(right,wanted,expected,emptyShape);
  }
  return {apply,verifyBlock,verifyRecords};
}
