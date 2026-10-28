/** ClickHere wrappers: borrow one engine-generated control, retain the raw host. */
import {readHwp} from './guard/container.mjs';
import {HwpDocument as TemplateDocument} from '@rhwp/core';
import {parseRecords} from './guard/records.mjs';
import {fail,view,equal,textTokens} from './local_complex_records.mjs';
const controlId=r=>Buffer.from(r.payload.subarray(0,4)).toString('ascii');
const anchor=code=>Buffer.from([code,0,107,108,99,37,0,0,0,0,0,0,0,0,code,0]);
const text=value=>{if(typeof value!=='string'||!value.isWellFormed()||/[\u0000-\u0009\u000b-\u001f]/.test(value)||value.length>100000||value.split('\n').length>100)fail('INVALID_FIELD_TEXT');return value;};
export function prepareComplexField(source,before,block,field,op){
 const inserting=op.type==='insert_field',schema=['type','target_id','expected_old',...(inserting?['offset','name','guide','value']:[])];
 if(!equal(Object.keys(op).sort(),schema.sort())||!block.text_range_editable||inserting&&field||!inserting&&!field?.editable)fail('FIELD_TARGET_REQUIRED');
 const records=before.recordSets.get(block.section),out=records.map(r=>({...r,payload:r.payload.slice()})),old=records[block.text_record].payload;
 let from,to,value,controlRecords=[],insertAt,removedId;
 const controls=[];for(let i=block.record_index+1;i<block.records_end;i++)if(records[i].tag===71&&records[i].level===block.raw_level+1)controls.push(i);
 const kinds=new Set(controls.map(i=>controlId(records[i]))),anchorId=t=>Buffer.from(old.subarray(t.unit*2+2,t.unit*2+6)).toString('ascii');
 const anchors=block.tokens.filter(t=>t.length===8&&t.code!==4&&kinds.has(anchorId(t)));
 if(anchors.length!==controls.length||anchors.some((t,i)=>anchorId(t)!==controlId(records[controls[i]])))fail('FIELD_ANCHOR_PROFILE_UNSUPPORTED');
 if(inserting){
  if(!Number.isSafeInteger(op.offset)||op.offset<0||op.offset>[...block.text].length||before.fields.some(f=>f.block_id===block.id&&op.offset>=f.start&&op.offset<=f.end))fail('INVALID_FIELD_OFFSET');
  if(typeof op.name!=='string'||typeof op.guide!=='string'||!op.name.length||op.name.length>128||op.guide.length>512||/[\r\n]/.test(op.name+op.guide))fail('INVALID_FIELD_METADATA');text(op.name);text(op.guide);text(op.value);
  from=block.tokens.find(t=>t.text&&t.visible>=op.offset)?.unit??block.tokens.at(-1).unit;to=from;
  insertAt=controls[anchors.filter(t=>t.unit<from).length]??block.records_end;
  // This temporary export is only a donor for the new field's two records.
  // Source publication below never uses its document or container bytes.
  const doc=new TemplateDocument(new Uint8Array(source));
  try{
   const result=JSON.parse(block.cell_path.length?doc.insertClickHereFieldByPath(block.section,block.paragraph,JSON.stringify(block.cell_path),op.offset,op.guide,'',op.name,true):doc.insertClickHereField(block.section,block.paragraph,op.offset,op.guide,'',op.name,true));
   if(result.ok!==true||!Number.isSafeInteger(result.fieldId)||before.fields.some(f=>f.field_id===result.fieldId))fail('FIELD_DEFINITION_UNVERIFIED');
   const exported=doc.exportHwpWithReport();let raw;try{raw=readHwp(exported.takeBytes());}finally{exported.free();}
   const generated=[...parseRecords(raw.streams.get(`BodyText/Section${block.section}`))],matches=generated.map((r,i)=>r.tag===71&&controlId(r)==='klc%'&&r.payload.length>=8&&view(r.payload).getUint32(r.payload.length-8,true)===result.fieldId?i:-1).filter(i=>i>=0);
   if(matches.length!==1)fail('FIELD_DEFINITION_UNVERIFIED');const at=matches[0],r=generated[at],next=generated[at+1];
   if(next?.tag!==87||next.level!==r.level+1||generated[at+2]?.level>r.level)fail('FIELD_DEFINITION_UNVERIFIED');
   controlRecords=[r,next].map((r,i)=>({...r,level:block.raw_level+1+i,payload:r.payload.slice()}));removedId=result.fieldId;
  }finally{doc.free();}
  value=Buffer.concat([anchor(3),Buffer.from(op.value,'utf16le'),anchor(4)]);out.splice(insertAt,0,...controlRecords);
 }else{
  const starts=block.tokens.filter(t=>t.code===3),at=controls[anchors.indexOf(starts.find(t=>t.unit+8===field.from))];
  if(at==null||controlId(records[at])!=='klc%'||view(records[at].payload).getUint32(records[at].payload.length-8,true)!==field.field_id||records[at+1]?.tag!==87||records[at+1].level!==block.raw_level+2||records[at+2]?.level>block.raw_level+1)fail('FIELD_DEFINITION_UNVERIFIED');
  from=field.from-8;to=field.to+8;value=old.subarray(field.from*2,field.to*2);out.splice(at,2);removedId=field.field_id;
 }
 const payload=Buffer.concat([old.subarray(0,from*2),value,old.subarray(to*2)]);if(textTokens(payload).map(t=>t.text).join('').length>100000)fail('EDIT_LIMIT_EXCEEDED');const inherited=block.unit_styles[Math.max(0,from-1)],inserted=inserting?Array(value.length/2).fill(inherited):block.unit_styles.slice(field.from,field.to),ids=block.unit_styles.slice(0,from).concat(inserted,block.unit_styles.slice(to)),runs=[];
 ids.forEach((id,unit)=>{if(!unit||id!==ids[unit-1])runs.push({id,unit});});if(runs.length>32)fail('COMPLEX_STYLE_LIMIT');
 const shapes=Buffer.alloc(runs.length*8);runs.forEach((r,i)=>{shapes.writeUInt32LE(r.unit,i*8);shapes.writeUInt32LE(r.id,i*8+4);});out[block.text_record].payload=payload;out[block.shape_record].payload=shapes;
 const h=view(out[block.record_index].payload);h.setUint32(0,((h.getUint32(0,true)&0x80000000)|payload.length/2)>>>0,true);h.setUint16(12,runs.length,true);h.setUint16(16,0,true);
 const tokens=textTokens(payload);let mask=h.getUint32(4,true);for(const code of [3,4,10])mask=tokens.some(t=>t.code===code)?mask|1<<code:mask&~(1<<code);h.setUint32(4,mask,true);
 const head=out[block.record_index];let end=block.record_index+1;while(end<out.length&&out[end].level>head.level)end++;
 return {records:out.filter((r,i)=>!(i>block.record_index&&i<end&&r.tag===69&&r.level===head.level+1)),fieldId:removedId,inserting,wanted:tokens.map(t=>t.text).join('')};
}
