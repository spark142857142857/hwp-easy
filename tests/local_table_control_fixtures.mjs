/** Trusted fields and inline objects between/after synthetic table anchors. */
import {HwpDocument} from '@rhwp/core';
import {tableTextFlowFixture} from './local_table_text_flow_fixtures.mjs';
import {checkedExport} from './local_complex_fixtures.mjs';
import {progressiveJpeg} from './local_image_fixtures.mjs';
import {inspectLocalComplex,editLocalComplex} from '../src/one_hwp/local_complex.mjs';
import {digest} from '../src/one_hwp/local_file.mjs';
import {view,textTokens} from '../src/one_hwp/local_complex_records.mjs';
import {publishVerifiedPatch} from '../src/one_hwp/local_verified_patch.mjs';
const inspect=bytes=>inspectLocalComplex(HwpDocument,bytes,{includeDocumentInfo:false});
const host=s=>s.blocks.find(b=>b.text.includes('PREFIX NOTE')&&b.text.includes('SUFFIX NOTE'));
function replacePayload(rs,b,payload,ids){
 const runs=[];ids.forEach((id,unit)=>{if(!unit||id!==ids[unit-1])runs.push([unit,id]);});const shape=Buffer.alloc(runs.length*8);runs.forEach(([u,id],i)=>{shape.writeUInt32LE(u,i*8);shape.writeUInt32LE(id,i*8+4);});
 const h=view(rs[b.record_index].payload);h.setUint32(0,((h.getUint32(0,true)&0x80000000)|payload.length/2)>>>0,true);let mask=0;for(const t of textTokens(payload))if(t.code<32&&t.code!==13)mask|=1<<t.code;h.setUint32(4,mask>>>0,true);h.setUint16(12,runs.length,true);rs[b.text_record].payload=payload;rs[b.shape_record].payload=shape;
}
export const controlProfiles=[{name:'nested-fields',depth:2,fields:['prefix','between','suffix'],mixed:true},{name:'body-fields',body:true,depth:1},{name:'body-nested-fields',body:true,depth:2,mixed:true},{name:'deep-picture',depth:3,objects:['picture']},{name:'nested-picture-box',depth:2,objects:['picture','box']},{name:'body-box-picture',body:true,depth:1,objects:['box','picture']},{name:'empty-fields',depth:2,empty:true},{name:'body-picture',body:true,depth:2,objects:['picture']}];
export function tableControlFixture({body=false,depth=2,lines=65,fields=['between','suffix'],objects=[],empty=false,mixed=false,prefix='PREFIX NOTE',guide='guide'}={}){
 let bytes=tableTextFlowFixture({body,depth,lines,prefix});
 for(const [n,kind] of objects.entries()){
  let s=inspect(bytes),tail=s.blocks.find(b=>b.text==='TAIL'),d=new HwpDocument(bytes),created;
  try{if(kind==='picture')created=JSON.parse(d.insertPicture(0,tail.paragraph,0,'[]',progressiveJpeg,2400,1800,64,40,'jpg','synthetic inline image'));
   else{created=JSON.parse(d.createShapeControl(JSON.stringify({sectionIdx:0,paraIdx:tail.paragraph,charOffset:0,width:7200,height:4000,treatAsChar:true})));d.setTextBoxAt(tail.paragraph,created.controlIdx,true);const list=JSON.parse(d.getCursorModel()).lists.find(l=>!l.isCell&&l.hostPara===tail.paragraph&&l.controlIndex===created.controlIdx);d.insertTextAtCursor(list.listId,0,0,'BOX');}
   bytes=checkedExport(d);
  }finally{d.free();}
  s=inspect(bytes);tail=s.blocks.find(b=>b.text==='TAIL');const b=host(s),object=(kind==='picture'?s.pictures:s.text_boxes).find(p=>p.block_id===tail.id),rs=s.recordSets.get(0).map(r=>({...r,payload:r.payload.slice()}));let end=object.record_index+1;while(end<rs.length&&rs[end].level>rs[object.record_index].level)end++;
  const original=s.recordSets.get(0),sub=rs.slice(object.record_index,end).map(r=>({...r,level:r.level+b.raw_level-tail.raw_level}));const f=view(sub[0].payload);f.setUint32(4,(f.getUint32(4,true)|1)&~4,true);f.setInt32(8,0,true);f.setInt32(12,0,true);if(kind==='box')view(sub[1].payload).setUint32(36,0x010b0000,true);
  const token=tail.tokens.find(t=>t.code===11),anchor=rs[tail.text_record].payload.subarray(token.unit*2,(token.unit+8)*2);const oldTail=rs[tail.text_record].payload;replacePayload(rs,tail,Buffer.concat([oldTail.subarray(0,token.unit*2),oldTail.subarray((token.unit+8)*2)]),[...tail.unit_styles.slice(0,token.unit),...tail.unit_styles.slice(token.unit+8)]);
  const offset=[...b.text.slice(0,b.text.indexOf(n%2?'SUFFIX NOTE':'BETWEEN NOTE'))].length,from=b.tokens.find(t=>t.text&&t.visible===offset).unit,old=rs[b.text_record].payload;replacePayload(rs,b,Buffer.concat([old.subarray(0,from*2),anchor,old.subarray(from*2)]),[...b.unit_styles.slice(0,from),...Array(8).fill(b.unit_styles[from]),...b.unit_styles.slice(from)]);
  const controls=[];for(let i=b.record_index+1;i<b.records_end;i++)if(rs[i].tag===71&&rs[i].level===b.raw_level+1)controls.push(i);const ordinal=b.tokens.filter(t=>t.length===8&&![4,9].includes(t.code)&&t.unit<from).length,insert=controls[ordinal]??b.records_end,insertRef=rs[insert];let out=rs.filter((r,i)=>i<object.record_index||i>=end);out.splice(out.indexOf(insertRef),0,...sub);out=out.filter(r=>r.tag!==69);for(const r of out)if(r.tag===66)view(r.payload).setUint16(16,0,true);bytes=publishVerifiedPatch(bytes,s,0,out);
 }
 for(const [i,slot] of fields.entries()){
  const s=inspect(bytes),b=host(s),label=slot==='prefix'?'PREFIX NOTE':slot==='between'?'BETWEEN NOTE':'SUFFIX NOTE',offset=[...b.text.slice(0,b.text.indexOf(label))].length;
  bytes=editLocalComplex(HwpDocument,bytes,digest(bytes),{type:'insert_field',target_id:`hwp5:${digest(bytes)}:${Buffer.from(b.id).toString('base64url')}`,expected_old:b.text,offset,name:'field-'+i,guide,value:empty?'':`FIELD${i} VALUE`}).bytes;
 }
 if(mixed){const s=inspect(bytes),f=s.fields[0];bytes=editLocalComplex(HwpDocument,bytes,digest(bytes),{type:'format_text',target_id:`hwp5:${digest(bytes)}:${Buffer.from(f.id).toString('base64url')}`,expected_old:f.value,start:0,end:Math.min(3,[...f.value].length),props:{bold:true}}).bytes;}
 return bytes;
}
