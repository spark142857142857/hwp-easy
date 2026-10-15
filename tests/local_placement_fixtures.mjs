/** Reproducible synthetic floating frames, fixed footers and body text lists. */
import {HwpDocument} from '@rhwp/core';
import {fixture} from './rhwp_fixtures.mjs';
import {checkedExport} from './local_complex_fixtures.mjs';
import {readHwp} from '../probes/sites-runtime/guard/container.mjs';
import {parseRecords} from '../probes/sites-runtime/guard/records.mjs';
import {encodeRecords,view} from '../src/one_hwp/local_complex_records.mjs';
import {packLocalBodyRewrite} from '../src/one_hwp/local_body_write.mjs';
import {nestedFixture} from './local_complex_fixtures.mjs';
import {inspectLocalComplex} from '../src/one_hwp/local_complex.mjs';

export function placementFixture({box=false,empty=false,mixed=false,fixed=false,footer=false,table=false,lines=55,boxWidth=18000,boxOffset=15000}={}){
 const paragraphs=footer?['BODY TOP',...Array.from({length:lines},(_,i)=>`BODY ROW ${String(i+1).padStart(3,'0')} abc`),'LAST BODY']:['BODY TOP','BODY TAIL'];
 const doc=new HwpDocument(fixture({table:false,paragraphs}));let bytes,control;
 try{
  if(footer){doc.createHeaderFooter(0,false,0);doc.insertTextInHeaderFooter(0,false,0,0,0,'FIXED FOOTER CONTENT');}
  if(box){const at=JSON.parse(doc.createShapeControl(JSON.stringify({sectionIdx:0,paraIdx:0,charOffset:8,width:boxWidth,height:4000,horzOffset:boxOffset,vertOffset:fixed?69000:10000,treatAsChar:false,textWrap:'InFrontOfText'})));control=at.controlIdx;doc.setTextBoxAt(0,control,true);
   const list=JSON.parse(doc.getCursorModel()).lists.find(l=>!l.isCell&&l.controlIndex===control);
   if(!empty)doc.insertTextAtCursor(list.listId,0,0,'TEXTBOX LABEL 😀');
   if(mixed)doc.applyCharFormatInCell(0,0,control,0,0,8,13,JSON.stringify({bold:true}));
  }
  if(table){const at=JSON.parse(doc.createTableEx(JSON.stringify({sectionIdx:0,paraIdx:1,charOffset:0,rowCount:24,colCount:2,colWidths:[17000,17000],treatAsChar:true})));
   for(let r=0;r<24;r++)for(let c=0;c<2;c++)doc.insertTextInCell(0,at.paraIdx,at.controlIdx,r*2+c,0,0,`TABLE ROW ${String(r+1).padStart(3,'0')} COL ${c+1}`);
  }
  bytes=checkedExport(doc);
 }finally{doc.free();}
 if(box){
  const raw=readHwp(bytes),rs=[...parseRecords(raw.streams.get('BodyText/Section0'))];
  // Core's newly attached text list retains non-text-box drawing flags, rejected
  // by Hancom 2020. Use the observed flags of a trusted native plain rectangle.
  // This repairs only this synthetic generator; product edits preserve flags.
  view(rs.find(r=>r.tag===76).payload).setUint32(36,0x010b0000,true);
  if(fixed){const r=rs.find(r=>r.tag===71&&r.level===1&&Buffer.from(r.payload.subarray(0,4)).toString()===' osg'),p=view(r.payload);p.setUint32(4,(p.getUint32(4,true)&~((3<<3)|(7<<5)|(3<<8)|(7<<10)|8192))>>>0,true);}
  bytes=packLocalBodyRewrite(bytes,raw,new Map([['BodyText/Section0',encodeRecords(rs)]]));
 }
 return bytes;
}

export function cellBoxFixture({nested=false,empty=false,mixed=false}={}){
 const source=nested?nestedFixture():fixture(),s=inspectLocalComplex(HwpDocument,source,{includeDocumentInfo:false,verifyCharacterModel:false}),b=s.blocks.find(b=>b.cell_path.length===(nested?2:1)),rs=s.recordSets.get(0);
 const donor=placementFixture({box:true,empty,mixed,boxWidth:nested?3000:6000,boxOffset:0}),drs=[...parseRecords(readHwp(donor).streams.get('BodyText/Section0'))],at=drs.findIndex(r=>r.tag===71&&Buffer.from(r.payload.subarray(0,4)).toString()===' osg');let stop=at+1;while(stop<drs.length&&drs[stop].level>drs[at].level)stop++;
 const subtree=drs.slice(at,stop).map(r=>({...r,level:r.level+b.raw_level,payload:r.payload.slice()}));
 // Reuse valid source definitions; this fixture asserts mixed spans separately.
 for(const r of subtree)if(r.tag===68)for(let i=4;i<r.payload.length;i+=8)view(r.payload).setUint32(i,view(rs[b.shape_record].payload).getUint32(4,true),true);
 const anchor=Buffer.alloc(16);anchor.writeUInt16LE(11);anchor.write(' osg',2,'ascii');anchor.writeUInt16LE(11,14);
 const text=Buffer.concat([rs[b.text_record].payload.subarray(0,-2),anchor,Buffer.from('\r','utf16le')]),header=rs[b.record_index].payload.slice(),v=view(header);v.setUint32(0,((v.getUint32(0,true)&0x80000000)|text.length/2)>>>0,true);v.setUint32(4,v.getUint32(4,true)|(1<<11),true);v.setUint16(16,0,true);
 const records=rs.flatMap((r,i)=>i===b.record_index?[{...r,payload:header}]:i===b.text_record?[{...r,payload:text}]:r.tag===69&&i>b.record_index&&i<b.records_end&&r.level===b.raw_level+1?[]:[r]);
 const end=records.indexOf(rs[b.records_end])<0?records.length:records.indexOf(rs[b.records_end]);records.splice(end,0,...subtree);
 return packLocalBodyRewrite(source,s.raw,new Map([['BodyText/Section0',encodeRecords(records)]]));
}

export function opaqueGroupFixture(){
 const doc=new HwpDocument(fixture({table:false,paragraphs:['PREFIX','GROUP HOST','BODY TAIL','END']}));
 try{const targets=[];for(let i=0;i<2;i++)targets.push(JSON.parse(doc.createShapeControl(JSON.stringify({sectionIdx:0,paraIdx:1,charOffset:0,width:6000,height:3000,horzOffset:i*7000,vertOffset:0,treatAsChar:false,textWrap:'InFrontOfText'}))));
  const group=JSON.parse(doc.groupShapes(JSON.stringify({sectionIdx:0,targets:targets.map(t=>({paraIdx:t.paraIdx,controlIdx:t.controlIdx}))})));if(!group.ok)throw Error('Synthetic vector grouping failed');return checkedExport(doc);
 }finally{doc.free();}
}
