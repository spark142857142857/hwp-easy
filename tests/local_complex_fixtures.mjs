/** Reproducible complex objects. Only synthetic data; never user documents. */
import {HwpDocument} from '@rhwp/core';
import {fixture} from './rhwp_fixtures.mjs';
import {progressiveJpeg} from './local_image_fixtures.mjs';
import {readHwp,readCfb} from '../probes/sites-runtime/guard/container.mjs';
import {parseRecords} from '../probes/sites-runtime/guard/records.mjs';
import CFB from '../probes/sites-runtime/node_modules/cfb/cfb.js';
import {deflateRawSync} from 'node:zlib';
import {encodeRecords,view} from '../src/one_hwp/local_complex_records.mjs';
export function checkedExport(doc){const e=doc.exportHwpWithReport();try{if(JSON.parse(e.contentLoss()).count)throw new Error('Fixture export loss');return new Uint8Array(e.takeBytes());}finally{e.free();}}
export function fieldFixture({cell=false,multiple=false,mixed=false}={}){
 const doc=new HwpDocument(fixture({table:cell,paragraphs:['prefix suffix','untouched','end']}));
 try{
  const at=cell?JSON.parse(doc.getCursorModel()).lists[1]:null;
  const created=JSON.parse(cell?doc.insertClickHereFieldInCell(0,at.hostPara,at.controlIndex,at.cellIndex,0,1,false,'guide','memo','same-name',true):doc.insertClickHereField(0,0,7,'guide','memo','same-name',true));
  doc.setFieldValue(created.fieldId,'first 😀');
  if(mixed){if(cell)doc.applyCharFormatInCell(0,at.hostPara,at.controlIndex,at.cellIndex,0,2,4,JSON.stringify({bold:true}));else doc.applyCharFormat(0,0,7,9,JSON.stringify({bold:true}));}
  if(multiple){const next=JSON.parse(doc.insertClickHereField(0,cell?3:1,0,'second guide','memo','same-name',true));doc.setFieldValue(next.fieldId,'second');}
  return checkedExport(doc);
 }finally{doc.free();}
}
export function nestedFixture(source=fixture(),{inside_nested=false}={}){
 const raw=readHwp(source),records=[...parseRecords(raw.streams.get('BodyText/Section0'))].map(r=>({...r,payload:r.payload.slice()}));
 const donor=new HwpDocument(fixture({table:false,paragraphs:['donor']}));let donorBytes;
 try{const at=JSON.parse(donor.createTableEx(JSON.stringify({sectionIdx:0,paraIdx:0,charOffset:5,rowCount:1,colCount:2,colWidths:[5000,5000],treatAsChar:true})));donor.insertTextInCell(0,at.paraIdx,at.controlIdx,0,0,0,'inner label');donor.insertTextInCell(0,at.paraIdx,at.controlIdx,1,0,0,'inner answer 😀');donor.applyCharFormatInCell(0,at.paraIdx,at.controlIdx,1,0,0,5,JSON.stringify({bold:true}));donorBytes=checkedExport(donor);}finally{donor.free();}
 // Use only existing source style IDs. Synthetic bold is applied separately
 // after transplant when needed, since definitions are never copied blindly.
 const rs=[...parseRecords(readHwp(donorBytes).streams.get('BodyText/Section0'))],start=rs.findIndex(r=>r.tag===71&&Buffer.from(r.payload.subarray(0,4)).toString()===' lbt');
 const stop=rs.findIndex((r,i)=>i>start&&r.tag===66&&r.level===0),addition=rs.slice(start,stop<0?rs.length:stop).map(r=>({...r,level:r.level+2,payload:r.payload.slice()}));
 for(const r of addition)if(r.tag===68)for(let p=4;p<r.payload.length;p+=8)view(r.payload).setUint32(p,0,true);
 const level=inside_nested?Math.max(...records.filter(r=>r.tag===66).map(r=>r.level)):2;
 if(inside_nested)for(const r of addition)r.level+=level-2;
 const para=records.findIndex(r=>r.tag===66&&r.level===level),text=records.findIndex((r,i)=>i>para&&r.tag===67&&r.level===level+1),next=records.findIndex((r,i)=>i>para&&r.tag===72&&r.level===level);
 if(para<0||text<0||next<0)throw new Error('Fixture requires a source table');
 const anchor=Uint8Array.from([11,0,32,108,98,116,0,0,0,0,0,0,0,0,11,0]);records[text].payload=Buffer.concat([records[text].payload.subarray(0,-2),anchor,records[text].payload.subarray(-2)]);
 const h=view(records[para].payload);h.setUint32(0,((h.getUint32(0,true)&0x80000000)|records[text].payload.length/2)>>>0,true);h.setUint32(4,h.getUint32(4,true)|1<<11,true);
 // Fixture construction alone uses a full CFB writer. Runtime publication
 // still uses the bounded writer and independently preserves every stream.
 records.splice(next,0,...addition);const packed=readCfb(source),body=encodeRecords(records),compressed=view(raw.streams.get('FileHeader')).getUint32(36,true)&1;
 packed.set('BodyText/Section0',compressed?deflateRawSync(body,{level:9}):body);const cfb=CFB.utils.cfb_new();for(const [name,value] of packed)CFB.utils.cfb_add(cfb,name,Buffer.from(value));
 return new Uint8Array(CFB.write(cfb,{type:'buffer',fileType:'cfb'}));
}
export function groupFixture({source=fixture({table:false,paragraphs:['group host','untouched','end']}),paragraph=1}={}){
 const doc=new HwpDocument(source);
 try{const a=JSON.parse(doc.insertPicture(0,paragraph,0,'[]',progressiveJpeg,7200,3600,64,40,'jpg','synthetic one'));
  const b=JSON.parse(doc.insertPicture(0,paragraph,0,'[]',progressiveJpeg,3600,3600,64,40,'jpg','synthetic two'));
  doc.setPictureProperties(0,b.paraIdx,b.controlIdx,JSON.stringify({horzOffset:8000}));
  const group=JSON.parse(doc.groupShapes(JSON.stringify({sectionIdx:0,targets:[{paraIdx:a.paraIdx,controlIdx:a.controlIdx},{paraIdx:b.paraIdx,controlIdx:b.controlIdx}]})));if(!group.ok)throw new Error('Grouping failed');return checkedExport(doc);
 }finally{doc.free();}
}
