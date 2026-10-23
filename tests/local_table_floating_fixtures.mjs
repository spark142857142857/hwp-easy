/** Independent floating frames after a growing table; no user documents. */
import {HwpDocument} from '@rhwp/core';
import {tableReflowFixture} from './local_table_reflow_fixtures.mjs';
import {checkedExport} from './local_complex_fixtures.mjs';
import {progressiveJpeg} from './local_image_fixtures.mjs';
import {inspectLocalComplex} from '../src/one_hwp/local_complex.mjs';
import {view} from '../src/one_hwp/local_complex_records.mjs';
import {publishVerifiedPatch} from '../src/one_hwp/local_verified_patch.mjs';
import {editLocalComplex} from '../src/one_hwp/local_complex.mjs';
import {digest} from '../src/one_hwp/local_file.mjs';
import {parseRecords} from '../probes/sites-runtime/guard/records.mjs';
import {definitionBytes} from '../src/one_hwp/local_complex_format.mjs';
export const floatingProfiles=[{name:'floating-picture',objects:['picture']},{name:'floating-box',objects:['box']},{name:'floating-both',objects:['picture','box']},{name:'deep-floating',depth:3,objects:['box','picture']},{name:'floating-footer',footer:true,objects:['picture','box']},{name:'floating-page-boundary',lines:36,objects:['box','picture']},{name:'floating-page-packing',lines:8,objects:['picture','picture','picture','picture'],pictureHeight:22000}];
export const samePageProfiles=[{name:'space-short-picture',lines:8,objects:['picture'],samePage:true},{name:'space-short-both',lines:8,samePage:true},{name:'space-deep-both',depth:3,lines:8,samePage:true},{name:'space-medium',lines:20,samePage:true},{name:'space-footer',lines:16,footer:true,samePage:true},{name:'space-body-prefix',lines:8,prefixLines:10,samePage:true},{name:'space-too-full',lines:30},{name:'space-explicit-break',lines:8,explicitBreak:true}];
export function tableFloatingFixture({depth=1,lines=65,objects=['picture','box'],footer=false,offset=0,pictureHeight=3000,prefixLines=0,explicitBreak=false,source}={}){
 let bytes=source??tableReflowFixture({depth,lines,footer}),d=new HwpDocument(bytes);
 try{for(const [i,kind] of objects.entries()){
  const s=inspectLocalComplex(HwpDocument,checkedExport(d),{includeDocumentInfo:false}),tail=s.blocks.find(b=>b.text==='TAIL');d.splitParagraph(0,tail.paragraph,0);
  if(kind==='picture')d.insertPicture(0,tail.paragraph,0,'[]',progressiveJpeg,4800,pictureHeight,64,40,'jpg','synthetic floating image');
  else{const c=JSON.parse(d.createShapeControl(JSON.stringify({sectionIdx:0,paraIdx:tail.paragraph,charOffset:0,width:7200,height:4000,treatAsChar:false})));d.setTextBoxAt(tail.paragraph,c.controlIdx,true);const list=JSON.parse(d.getCursorModel()).lists.find(l=>!l.isCell&&l.hostPara===tail.paragraph&&l.controlIndex===c.controlIdx);d.insertTextAtCursor(list.listId,0,0,'BOX');}
 }bytes=checkedExport(d);}finally{d.free();}
 const state=inspectLocalComplex(HwpDocument,bytes,{includeDocumentInfo:false}),rs=state.recordSets.get(0).map(r=>({...r,payload:r.payload.slice()}));
 for(const object of [...state.pictures,...state.text_boxes]){const p=view(rs[object.record_index].payload),mask=1|4|(3<<3)|(7<<5)|(3<<8)|(7<<10)|8192|(7<<21)|(3<<24);p.setUint32(4,((p.getUint32(4,true)&~mask)|(2<<8)|(5<<21)|16384)>>>0,true);p.setInt32(8,19000,true);p.setInt32(12,offset,true);if(object.paragraphs)view(rs[object.record_index+1].payload).setUint32(36,0x010b0000,true);}
 let docInfo=state.raw.streams.get('DocInfo');
 if(explicitBreak){const first=[...state.pictures,...state.text_boxes].sort((a,b)=>a.record_index-b.record_index)[0],b=state.blocks.find(b=>b.id===first.block_id),defs=[...parseRecords(docInfo)],shapes=defs.filter(r=>r.tag===25),map=defs.find(r=>r.tag===17),payload=shapes[b.paragraph_properties.paraShapeId].payload.slice();view(payload).setUint32(0,view(payload).getUint32(0,true)|(1<<19),true);const counts=map.payload.slice();view(counts).setUint32(52,shapes.length+1,true);docInfo=definitionBytes(docInfo,defs,new Map([[map.index,counts]]),new Map([[shapes.at(-1).index,[{tag:25,level:shapes.at(-1).level,payload}]]]));view(rs[b.record_index].payload).setUint16(8,shapes.length,true);}
 bytes=publishVerifiedPatch(bytes,state,0,rs,docInfo);
 if(prefixLines){const s=inspectLocalComplex(HwpDocument,bytes,{includeDocumentInfo:false}),b=s.blocks.find(b=>b.text==='HEAD'),v=digest(bytes);bytes=editLocalComplex(HwpDocument,bytes,v,{type:'splice_text',target_id:`hwp5:${v}:${Buffer.from(b.id).toString('base64url')}`,expected_old:b.text,start:0,end:4,new_text:Array.from({length:prefixLines},(_,i)=>`HEAD ${i}`).join('\n')}).bytes;}
 return bytes;
}
