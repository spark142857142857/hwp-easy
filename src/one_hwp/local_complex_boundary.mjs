/** Paragraph boundaries without serializing retained fields, drawings or table subtrees. */
import {fail,view,equal,textTokens} from './local_complex_records.mjs';
import {standardBlockId} from './local_complex_table.mjs';
import {tableHostFields,inlineTableHostObject} from './local_table_host_controls.mjs';
const ctrl=r=>Buffer.from(r.payload.subarray(0,4)).toString('ascii');
const text=value=>{if(typeof value!=='string'||!value.isWellFormed()||value.length>100000||/[\u0000-\u0009\u000b-\u001f]/.test(value)||value.split('\n').length>100)fail('INVALID_EDIT_TEXT');return value;};
function parts(records,b){
 if(!b.text_range_editable||!b.unit_styles)fail('PARAGRAPH_BOUNDARY_UNVERIFIED');
 const controls=[];
 for(let i=b.record_index+1;i<b.records_end;){const r=records[i];if(r.level!==b.raw_level+1)fail('PARAGRAPH_BOUNDARY_UNVERIFIED');
  if(r.tag===71){let end=i+1;while(end<b.records_end&&records[end].level>r.level)end++;controls.push(records.slice(i,end));i=end;}
  else {if(![67,68,69].includes(r.tag))fail('PARAGRAPH_BOUNDARY_UNVERIFIED');i++;}
 }
 const payload=b.text_record===undefined?Buffer.from('\r','utf16le'):records[b.text_record].payload;
 const anchors=b.tokens.filter(t=>t.length===8&&![4,9].includes(t.code));
 if(anchors.length!==controls.length)fail('PARAGRAPH_CONTROL_MAPPING_UNVERIFIED');
 const assigned=new Set();for(const a of anchors){const id=Buffer.from(payload.subarray(a.unit*2+2,a.unit*2+6)).toString('ascii'),matches=controls.filter(c=>ctrl(c[0])===id&&!assigned.has(c));if(!matches.length)fail('PARAGRAPH_CONTROL_MAPPING_UNVERIFIED');a.control=matches[0];assigned.add(a.control);}
 return {payload,anchors,controls};
}
function paragraph(original,payload,ids,controls,last,originHeader){
 const tokens=textTokens(payload),runs=[];ids.forEach((id,unit)=>{if(!unit||id!==ids[unit-1])runs.push({id,unit});});if(runs.length>32)fail('COMPLEX_STYLE_LIMIT');
 const shape=Buffer.alloc(runs.length*8);runs.forEach((r,i)=>{shape.writeUInt32LE(r.unit,i*8);shape.writeUInt32LE(r.id,i*8+4);});
 const header=original.payload.slice(),v=view(header);v.setUint32(0,((last?0x80000000:0)|payload.length/2)>>>0,true);
 let mask=0;for(const t of tokens)if(t.code<32&&t.code!==13)mask|=1<<t.code;
 v.setUint32(4,mask>>>0,true);v.setUint16(12,runs.length,true);v.setUint16(14,0,true);v.setUint16(16,0,true);if(!originHeader){v.setUint32(18,0,true);v.setUint8(11,0);}
 const level=original.level,empty=tokens.length===1;
 return [{...original,payload:header,_origin:originHeader?original._origin:undefined,...(originHeader?{originHeader}:{})},...(!empty?[{tag:67,level:level+1,payload}]:[]),{tag:68,level:level+1,payload:shape},...controls.flat()];
}
export function boundaryEligible(records,b){try{parts(records,b);return true;}catch{return false;}}
/** Explicit block flow: retain every text/anchor unit and its style, inserting
 * paragraph terminators around table anchors instead of moving text past them. */
export function partitionTableHost(before,b){
 if(b.tokens.filter(t=>t.length===8&&![4,9].includes(t.code)).length>64)fail('TABLE_HOST_CONTROL_LIMIT');
 const records=before.recordSets.get(b.section),p=parts(records,b);
 const fields=tableHostFields(before,b);
 if(fields.length>32||p.anchors.filter(a=>ctrl(a.control[0])===' osg').length>16)fail('TABLE_HOST_CONTROL_LIMIT');
 if(p.anchors.some((a,i)=>a.control!==p.controls[i]||![2,3,11].includes(a.code)||a.code===3&&ctrl(a.control[0])!=='klc%')||b.tokens.some(t=>!t.text&&![2,3,4,11,13].includes(t.code)))fail('TABLE_HOST_CONTROL_UNSUPPORTED');
 for(const a of p.anchors.filter(a=>a.code===11)){const id=ctrl(a.control[0]);if(id!==' lbt'){if(id!==' osg')fail('TABLE_HOST_CONTROL_UNSUPPORTED');inlineTableHostObject(before,b,records.indexOf(a.control[0]));}}
 const cuts=[0];for(const a of p.anchors.filter(a=>a.code===11))cuts.push(a.unit,a.unit+a.length);cuts.push(p.payload.length/2-1);
 if(cuts.some(c=>fields.some(f=>c>f.from-8&&c<f.to+8)))fail('TABLE_HOST_PARTITION_CROSSES_FIELD');
 const ranges=cuts.slice(1).map((end,i)=>[cuts[i],end]).filter(([a,z])=>a<z);if(ranges.length<2)fail('TABLE_HOST_PARTITION_UNVERIFIED');
 const last=Boolean(view(records[b.record_index].payload).getUint32(0,true)&0x80000000),replacement=[],heads=[],fragments=[];
 for(const [i,[from,to]]of ranges.entries()){
  const controls=p.anchors.filter(a=>a.unit>=from&&a.unit<to).map(a=>{if(ctrl(a.control[0])!==' osg')return a.control;const r=a.control[0],payload=r.payload.slice();view(payload).setUint32(4,view(payload).getUint32(4,true)|4,true);return [{...r,payload,originControl:r},...a.control.slice(1)];}),payload=Buffer.concat([p.payload.subarray(from*2,to*2),Buffer.from('\r','utf16le')]),ids=[...b.unit_styles.slice(from,to),b.unit_styles[i===ranges.length-1?b.unit_styles.length-1:Math.max(from,to-1)]];
  const part=paragraph(records[b.record_index],payload,ids,controls,last&&i===ranges.length-1,i===0?records[b.record_index]:null);heads.push(part[0]);fragments.push({head:part[0],from,to,visible_from:b.tokens.filter(t=>t.unit<from&&t.text).length,text:textTokens(payload).map(t=>t.text).join(''),unit_styles:ids});replacement.push(...part);
 }
 // Independent segment concatenation, including raw controls and UTF-16 styles.
 if(!equal([...Buffer.concat(ranges.map(([a,z])=>p.payload.subarray(a*2,z*2)))],[...p.payload.subarray(0,-2)])||!equal(ranges.flatMap(([a,z])=>b.unit_styles.slice(a,z)),b.unit_styles.slice(0,-1)))fail('TABLE_HOST_CONTENT_MISMATCH');
 let out=[...records.slice(0,b.record_index),...replacement,...records.slice(b.records_end)];
 if(b.cell_path.length){const owner=before.tables.flatMap(t=>t.cells).find(c=>c.blocks.includes(b));if(!owner)fail('PARAGRAPH_LIST_UNVERIFIED');const original=records[owner.start],header=original.payload.slice(),v=view(header),count=v.getUint16(0,true)+ranges.length-1;if(count>4096)fail('PARAGRAPH_LIST_UNVERIFIED');v.setUint16(0,count,true);out=out.map(r=>r===original?{...r,payload:header}:r);}
 return {records:out,heads,fragments,delta:ranges.length-1};
}
export function prepareComplexBoundary(before,b,op,version){
 const schema={split_paragraph:['offset'],merge_paragraph:['previous_target_id','expected_previous'],insert_paragraphs:['paragraphs'],duplicate_paragraph:[],delete_paragraph:[]}[op.type];
 if(!schema||!equal(Object.keys(op).sort(),['type','target_id','expected_old',...schema].sort()))fail('INVALID_OPERATION');
 const records=before.recordSets.get(b.section),p=parts(records,b),sameList=x=>x.section===b.section&&x.list_id===b.list_id&&(b.cell_path.length?x.paragraph===b.paragraph:x.kind==='paragraph'),siblings=before.blocks.filter(sameList).sort((a,z)=>a.record_index-z.record_index),position=siblings.indexOf(b),last=Boolean(view(records[b.record_index].payload).getUint32(0,true)&0x80000000);
 let start=b.record_index,end=b.records_end,replacement,delta=0;const expected=new Map(before.blocks.map(x=>[x.id,x.text])),fresh=[];
 if(op.type==='split_paragraph'){
  if(!Number.isSafeInteger(op.offset)||op.offset<0||op.offset>[...b.text].length)fail('INVALID_TEXT_RANGE');
  // A field is indivisible across paragraph boundaries, including an empty value.
  let fieldDepth=0,cut=b.tokens.at(-1).unit;for(const t of b.tokens){if(t.code===2)continue;if(t.visible>=op.offset&&fieldDepth===0){cut=t.unit;break;}if(t.code===3)fieldDepth++;if(t.code===4)fieldDepth--;if(t.visible>=op.offset&&fieldDepth>0)fail('PARAGRAPH_BOUNDARY_CROSSES_FIELD');}
  if(before.fields.some(f=>f.block_id===b.id&&f.start<op.offset&&f.end>op.offset))fail('PARAGRAPH_BOUNDARY_CROSSES_FIELD');
  const left=p.controls.filter(c=>p.anchors.find(a=>a.control===c).unit<cut),right=p.controls.filter(c=>!left.includes(c));
  if(right.some(c=>['dces','dloc','daeh','toof'].includes(ctrl(c[0]))))fail('PARAGRAPH_BOUNDARY_MOVES_SECTION_CONTROL');
  const inherited=b.unit_styles[Math.max(0,cut-1)]??b.unit_styles[0],leftText=Buffer.concat([p.payload.subarray(0,cut*2),Buffer.from('\r','utf16le')]),rightText=p.payload.subarray(cut*2);
  replacement=[...paragraph(records[start],leftText,[...b.unit_styles.slice(0,cut),inherited],left,false,records[start]),...paragraph(records[start],rightText,b.unit_styles.slice(cut),right,last)];
  expected.set(b.id,[...b.text].slice(0,op.offset).join(''));fresh.push({header:replacement.find((r,i)=>i>0&&r.tag===66&&r.level===b.raw_level),text:[...b.text].slice(op.offset).join('')});delta=1;
 }else if(op.type==='merge_paragraph'){
  const previous=siblings[position-1],id=typeof op.previous_target_id==='string'&&op.previous_target_id.startsWith(`hwp5:${version}:`)?Buffer.from(op.previous_target_id.slice(70),'base64url').toString():null;
  if(!previous||![previous.id,standardBlockId(previous)].includes(id)||previous.text!==op.expected_previous)fail('PARAGRAPH_ADJACENCY_MISMATCH');
  if(!equal(previous.paragraph_properties,b.paragraph_properties)||records[previous.record_index].payload[10]!==records[start].payload[10]||records[start].payload[11]!==0)fail('PARAGRAPH_FORMAT_MISMATCH');
  const q=parts(records,previous);if(p.controls.some(c=>['dces','dloc','daeh','toof'].includes(ctrl(c[0]))))fail('PARAGRAPH_BOUNDARY_MOVES_SECTION_CONTROL');
  start=previous.record_index;replacement=paragraph(records[start],Buffer.concat([q.payload.subarray(0,-2),p.payload]),[...previous.unit_styles.slice(0,-1),...b.unit_styles],[...q.controls,...p.controls],last,records[start]);expected.set(previous.id,previous.text+b.text);expected.delete(b.id);delta=-1;
 }else if(op.type==='delete_paragraph'){
  if(p.controls.length)fail('PARAGRAPH_DELETE_CONTAINS_CONTROL');if(siblings.length<=1)fail('LAST_PARAGRAPH_REQUIRED');replacement=[];expected.delete(b.id);delta=-1;
 }else{
  if(op.type==='duplicate_paragraph'&&p.controls.length)fail('PARAGRAPH_DUPLICATE_CONTAINS_CONTROL');
  const values=op.type==='duplicate_paragraph'?[b.text]:op.paragraphs;if(!Array.isArray(values)||values.length<1||values.length>100)fail('INVALID_PARAGRAPHS');values.forEach(text);
  replacement=[...paragraph(records[start],p.payload,b.unit_styles,p.controls,false,records[start])];
  for(const [i,value]of values.entries()){const payload=Buffer.from(value+'\r','utf16le'),ids=op.type==='duplicate_paragraph'?b.unit_styles:Array(payload.length/2).fill(b.unit_styles[0]),newRecords=paragraph(records[start],payload,ids,[],last&&i===values.length-1);fresh.push({header:newRecords[0],text:value});replacement.push(...newRecords);}delta=values.length;
 }
 let out=[...records.slice(0,start),...replacement,...records.slice(end)];
 if(b.cell_path.length){const owner=before.tables.flatMap(t=>t.cells).find(c=>c.blocks.includes(b));if(!owner)fail('PARAGRAPH_LIST_UNVERIFIED');const header=records[owner.start].payload.slice(),v=view(header),count=v.getUint16(0,true)+delta;if(count<1||count>4096)fail('PARAGRAPH_LIST_UNVERIFIED');v.setUint16(0,count,true);out=out.map(r=>r===records[owner.start]?{...r,payload:header}:r);}
 if(op.type==='delete_paragraph'&&last){const previous=siblings[position-1],header=records[previous.record_index].payload.slice(),v=view(header);v.setUint32(0,(v.getUint32(0,true)|0x80000000)>>>0,true);out=out.map(r=>r===records[previous.record_index]?{...r,payload:header,originHeader:r}:r);}
 const ordinals=new Map();let ordinal=0;for(const r of out)if(r.tag===66)ordinals.set(r.originHeader??r,`s${b.section}:r${ordinal++}`);
 const remap={};for(const old of before.blocks)remap[old.id]=old.section===b.section?ordinals.get(records[old.record_index])??null:old.id;
 return {records:out,remap,expected,fresh:fresh.map(f=>({id:ordinals.get(f.header),text:f.text})),delta};
}
