/** Trusted multi-column/page/cell profiles for floating placement. */
import {HwpDocument} from '@rhwp/core';
import {placementFixture,cellBoxFixture} from './local_placement_fixtures.mjs';
import {checkedExport} from './local_complex_fixtures.mjs';
import {inspectLocalComplex} from '../src/one_hwp/local_complex.mjs';
import {view,spliceRawParagraph,encodeRecords} from '../src/one_hwp/local_complex_records.mjs';
import {packLocalBodyRewrite} from '../src/one_hwp/local_body_write.mjs';
import {invalidateSectionLayout} from '../src/one_hwp/local_layout_cache.mjs';
import {fixture} from './rhwp_fixtures.mjs';
import {progressiveJpeg} from './local_image_fixtures.mjs';

export function floatingPicturePageFixture(){
 const doc=new HwpDocument(fixture({table:false,paragraphs:['PICTURE HOST','MIDDLE','DESTINATION']}));try{const at=JSON.parse(doc.insertPicture(0,0,0,'[]',progressiveJpeg,7200,3600,64,40,'jpg','synthetic'));doc.setPictureProperties(0,at.paraIdx,at.controlIdx,JSON.stringify({treatAsChar:false}));doc.insertPageBreak(0,2,0);return checkedExport(doc);}finally{doc.free();}
}

export function duplicateFloatingPageFixture(){
 const bytes=floatingAreaFixture({pageBreak:true}),state=inspectLocalComplex(HwpDocument,bytes,{includeDocumentInfo:false,verifyCharacterModel:false}),box=state.text_boxes[0],b=state.blocks.find(b=>b.id===box.block_id),rs=state.recordSets.get(0),a=b.tokens.find(t=>t.code===11),raw=rs[b.text_record].payload,anchor=raw.slice(a.unit*2,(a.unit+8)*2),text=Buffer.concat([raw.subarray(0,-2),anchor,Buffer.from('\r','utf16le')]),head=rs[b.record_index].payload.slice(),subtree=rs.slice(box.record_index,box.records_end).map(r=>({...r,payload:r.payload.slice()}));
 view(head).setUint32(0,((view(head).getUint32(0,true)&0x80000000)|text.length/2)>>>0,true);
 const records=rs.flatMap((r,i)=>[...(i===b.records_end?subtree:[]),i===b.record_index?{...r,payload:head}:i===b.text_record?{...r,payload:text}:r]);
 return packLocalBodyRewrite(bytes,state.raw,new Map([['BodyText/Section0',encodeRecords(records)]]));
}

export function floatingAreaFixture({columns=1,pageBreak=false,cell=false,nested=false,mixed=false}={}){
 let bytes=cell?cellBoxFixture({nested,cellRelative:true}):placementFixture({box:true,mixed,boxWidth:6000,boxOffset:0});
 if(pageBreak){const doc=new HwpDocument(bytes);try{doc.insertPageBreak(0,1,0);bytes=checkedExport(doc);}finally{doc.free();}}
 let state=inspectLocalComplex(HwpDocument,bytes,{includeDocumentInfo:false,verifyCharacterModel:false}),rs=state.recordSets.get(0).map(r=>({...r,payload:r.payload.slice()}));
 if(columns>1){const col=rs.find(r=>r.tag===71&&Buffer.from(r.payload.subarray(0,4)).toString()==='dloc');view(col.payload).setUint16(4,(columns<<2)|0x1000,true);view(col.payload).setUint16(6,1800,true);}
 if(cell){for(const table of state.tables){for(const c of table.cells){const p=view(rs[c.start].payload);p.setUint32(4,p.getUint32(4,true)&~0x60,true);p.setUint32(20,table.cell_path.length?12000:18000,true);}view(rs[table.record_index].payload).setUint32(20,table.dimensions.rowCount*(table.cell_path.length?12000:18000),true);}
  const p=state.text_boxes[0].paragraphs[0];rs=spliceRawParagraph(rs,p,0,[...p.text].length,'BOX').records;
 }
 bytes=packLocalBodyRewrite(bytes,state.raw,new Map([['BodyText/Section0',encodeRecords(rs)]]));
 state=inspectLocalComplex(HwpDocument,bytes,{includeDocumentInfo:false,verifyCharacterModel:false});
 return packLocalBodyRewrite(bytes,state.raw,new Map([['BodyText/Section0',encodeRecords(invalidateSectionLayout(state.recordSets.get(0),state.blocks))]]));
}
