/** Reproducible synthetic floating frames, fixed footers and body text lists. */
import {HwpDocument} from '@rhwp/core';
import {fixture} from './rhwp_fixtures.mjs';
import {checkedExport} from './local_complex_fixtures.mjs';
import {readHwp} from '../probes/sites-runtime/guard/container.mjs';
import {parseRecords} from '../probes/sites-runtime/guard/records.mjs';
import {encodeRecords,view} from '../src/one_hwp/local_complex_records.mjs';
import {packLocalBodyRewrite} from '../src/one_hwp/local_body_write.mjs';

export function placementFixture({box=false,empty=false,mixed=false,fixed=false,footer=false,table=false,lines=55}={}){
 const paragraphs=footer?['BODY TOP',...Array.from({length:lines},(_,i)=>`BODY ROW ${String(i+1).padStart(3,'0')} abc`),'LAST BODY']:['BODY TOP','BODY TAIL'];
 const doc=new HwpDocument(fixture({table:false,paragraphs}));let bytes,control;
 try{
  if(footer){doc.createHeaderFooter(0,false,0);doc.insertTextInHeaderFooter(0,false,0,0,0,'FIXED FOOTER CONTENT');}
  if(box){const at=JSON.parse(doc.createShapeControl(JSON.stringify({sectionIdx:0,paraIdx:0,charOffset:8,width:18000,height:4000,horzOffset:15000,vertOffset:fixed?69000:10000,treatAsChar:false,textWrap:'InFrontOfText'})));control=at.controlIdx;doc.setTextBoxAt(0,control,true);
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
