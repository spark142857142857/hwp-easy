/** Independent floating frames after a growing table; no user documents. */
import {HwpDocument} from '@rhwp/core';
import {tableReflowFixture} from './local_table_reflow_fixtures.mjs';
import {checkedExport} from './local_complex_fixtures.mjs';
import {progressiveJpeg} from './local_image_fixtures.mjs';
import {inspectLocalComplex} from '../src/one_hwp/local_complex.mjs';
import {view} from '../src/one_hwp/local_complex_records.mjs';
import {publishVerifiedPatch} from '../src/one_hwp/local_verified_patch.mjs';
export const floatingProfiles=[{name:'floating-picture',objects:['picture']},{name:'floating-box',objects:['box']},{name:'floating-both',objects:['picture','box']},{name:'deep-floating',depth:3,objects:['box','picture']},{name:'floating-footer',footer:true,objects:['picture','box']},{name:'floating-page-boundary',lines:36,objects:['box','picture']},{name:'floating-page-packing',lines:8,objects:['picture','picture','picture','picture'],pictureHeight:22000}];
export function tableFloatingFixture({depth=1,lines=65,objects=['picture','box'],footer=false,offset=0,pictureHeight=3000}={}){
 let bytes=tableReflowFixture({depth,lines,footer}),d=new HwpDocument(bytes);
 try{for(const [i,kind] of objects.entries()){
  const s=inspectLocalComplex(HwpDocument,checkedExport(d),{includeDocumentInfo:false}),tail=s.blocks.find(b=>b.text==='TAIL');d.splitParagraph(0,tail.paragraph,0);
  if(kind==='picture')d.insertPicture(0,tail.paragraph,0,'[]',progressiveJpeg,4800,pictureHeight,64,40,'jpg','synthetic floating image');
  else{const c=JSON.parse(d.createShapeControl(JSON.stringify({sectionIdx:0,paraIdx:tail.paragraph,charOffset:0,width:7200,height:4000,treatAsChar:false})));d.setTextBoxAt(tail.paragraph,c.controlIdx,true);const list=JSON.parse(d.getCursorModel()).lists.find(l=>!l.isCell&&l.hostPara===tail.paragraph&&l.controlIndex===c.controlIdx);d.insertTextAtCursor(list.listId,0,0,'BOX');}
 }bytes=checkedExport(d);}finally{d.free();}
 const state=inspectLocalComplex(HwpDocument,bytes,{includeDocumentInfo:false}),rs=state.recordSets.get(0).map(r=>({...r,payload:r.payload.slice()}));
 for(const object of [...state.pictures,...state.text_boxes]){const p=view(rs[object.record_index].payload),mask=1|4|(3<<3)|(7<<5)|(3<<8)|(7<<10)|8192|(7<<21)|(3<<24);p.setUint32(4,((p.getUint32(4,true)&~mask)|(2<<8)|(5<<21)|16384)>>>0,true);p.setInt32(8,19000,true);p.setInt32(12,offset,true);if(object.paragraphs)view(rs[object.record_index+1].payload).setUint32(36,0x010b0000,true);}
 return publishVerifiedPatch(bytes,state,0,rs);
}
