/** Generated footer paragraphs, inline table and automatic page-number controls. */
import {HwpDocument} from '@rhwp/core';
import {fixture} from './rhwp_fixtures.mjs';
import {checkedExport} from './local_complex_fixtures.mjs';
import {inspectLocalComplex} from '../src/one_hwp/local_complex.mjs';
import {view} from '../src/one_hwp/local_complex_records.mjs';
import {publishVerifiedPatch} from '../src/one_hwp/local_verified_patch.mjs';

export function complexFooterFixture(source,{table=false,number=false,variant=0}={}){
 const doc=new HwpDocument(source);let bytes;
 try{
  doc.createHeaderFooter(0,false,variant);doc.insertTextInHeaderFooter(0,false,variant,0,0,'FOOTER TITLE');
  doc.splitParagraphInHeaderFooter(0,false,variant,0,12);doc.insertTextInHeaderFooter(0,false,variant,1,0,'FOOTER SECOND LINE');
  doc.applyCharFormatInHeaderFooter(0,false,variant,0,0,0,6,JSON.stringify({bold:true}));bytes=checkedExport(doc);
  if(variant===1){const last=doc.getParagraphCount(0)-1;doc.insertText(0,last,0,Array(65).fill('FOOTER VARIANT REFERENCE').join('\n')+'\n');bytes=checkedExport(doc);}
 }finally{doc.free();}
 const state=inspectLocalComplex(HwpDocument,bytes,{includeDocumentInfo:false,verifyCharacterModel:false}),rs=state.recordSets.get(0).map(r=>({...r,payload:r.payload.slice()}));
 const start=rs.findIndex(r=>r.tag===71&&Buffer.from(r.payload.subarray(0,4)).toString()==='toof');let end=start+1;while(end<rs.length&&rs[end].level>1)end++;
 const head=rs.findIndex((r,i)=>i>start&&r.tag===66&&r.level===2),text=head+1;
 if(table||number){
  const donor=new HwpDocument(fixture({table:false,paragraphs:['DONOR']}));let db;
  try{if(table){const at=JSON.parse(donor.createTableEx(JSON.stringify({sectionIdx:0,paraIdx:0,charOffset:5,rowCount:1,colCount:2,colWidths:[12000,12000],treatAsChar:true})));for(let c=0;c<2;c++)donor.insertTextInCell(0,at.paraIdx,at.controlIdx,c,0,0,'FOOTER CELL '+c);}
   else donor.insertAutoNumberAtCursor(0,0,5,'page');db=checkedExport(donor);
  }finally{donor.free();}
  const ds=inspectLocalComplex(HwpDocument,db,{includeDocumentInfo:false,verifyCharacterModel:false}).recordSets.get(0),at=ds.findIndex(r=>r.tag===71&&Buffer.from(r.payload.subarray(0,4)).toString()===(table?' lbt':'onta'));if(at<0)throw Error('Missing synthetic footer control');let stop=at+1;while(stop<ds.length&&ds[stop].level>ds[at].level)stop++;
  const control=ds.slice(at,stop).map(r=>({...r,level:r.level+2,payload:r.payload.slice()}));for(const r of control)if(r.tag===68)for(let i=4;i<r.payload.length;i+=8)view(r.payload).setUint32(i,0,true);
  const anchor=Buffer.alloc(16);anchor.writeUInt16LE(table?11:18);anchor.write(table?' lbt':'onta',2,'ascii');anchor.writeUInt16LE(table?11:18,14);
  rs[text].payload=Buffer.concat([rs[text].payload.subarray(0,-2),anchor,Buffer.from('\r','utf16le')]);const p=view(rs[head].payload);p.setUint32(0,((p.getUint32(0,true)&0x80000000)|rs[text].payload.length/2)>>>0,true);p.setUint32(4,p.getUint32(4,true)|(1<<(table?11:18)),true);
  let insertion=head+1;while(insertion<end&&rs[insertion].level>2)insertion++;rs.splice(insertion,0,...control);
 }
 // Room for the complete original complex footer on a generated A4 page.
 view(rs.find(r=>r.tag===73).payload).setUint32(28,10000,true);
 return publishVerifiedPatch(bytes,state,0,rs);
}
