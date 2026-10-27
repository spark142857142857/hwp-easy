/** Trusted generated drawing trees; no personal documents or installed engines. */
import {HwpDocument} from '@rhwp/core';
import {fixture} from './rhwp_fixtures.mjs';
import {checkedExport,nestedFixture,fieldFixture,nestedGroupFixture} from './local_complex_fixtures.mjs';
import {progressiveJpeg} from './local_image_fixtures.mjs';
import {readHwp} from '../probes/sites-runtime/guard/container.mjs';
import {parseRecords} from '../probes/sites-runtime/guard/records.mjs';
import {view,encodeRecords} from '../src/one_hwp/local_complex_records.mjs';
import {packLocalBodyRewrite} from '../src/one_hwp/local_body_write.mjs';
import {groupGeometry} from '../src/one_hwp/local_complex_group.mjs';
import {inspectLocalComplex} from '../src/one_hwp/local_complex.mjs';
const cid=r=>Buffer.from(r.payload.subarray(0,4)).toString();
const extent=(rs,at)=>{let end=at+1;while(end<rs.length&&rs[end].level>rs[at].level)end++;return end;};
export const f4Inspect=bytes=>inspectLocalComplex(HwpDocument,bytes,{includeDocumentInfo:false,verifyCharacterModel:false});
export function f4Patch(bytes,fn){const raw=readHwp(bytes),rs=[...parseRecords(raw.streams.get('BodyText/Section0'))].map(r=>({...r,payload:r.payload.slice()}));fn(rs);return packLocalBodyRewrite(bytes,raw,new Map([['BodyText/Section0',encodeRecords(rs)]]));}
export function f4GroupFixture({nested=false,field=false,empty=false,paragraphs=false,duplicate=false}={}){
 const d=new HwpDocument(fixture({table:false,paragraphs:['HEAD','GROUP HOST','SECOND HOST','THIRD HOST','FOURTH HOST','TAIL','END']}));let bytes;
 try{for(let i=0;i<(nested?4:2);i++){
  const o=JSON.parse(d.createShapeControl(JSON.stringify({sectionIdx:0,paraIdx:i+1,charOffset:0,width:10000,height:7000,horzOffset:2000+i%2*12000,vertOffset:20000+Math.floor(i/2)*10000,treatAsChar:false,textWrap:'InFrontOfText',shapeType:'rectangle'})));d.setTextBoxAt(o.paraIdx,o.controlIdx,true);const list=JSON.parse(d.getCursorModel()).lists.find(l=>!l.isCell&&l.hostPara===i+1);if(!empty)d.insertTextAtCursor(list.listId,0,0,duplicate?'SAME VALUE':i===0?'FIRST VALUE':i===1?'SECOND VALUE':i===2?'THIRD VALUE':'FOURTH VALUE');
  if(field&&i===0){const result=JSON.parse(d.insertClickHereFieldByPath(0,o.paraIdx,JSON.stringify([{controlIndex:o.controlIdx,cellIndex:0,cellParaIndex:0}]),2,'입력 안내','메모','동일 이름',true));if(!result.ok)throw Error('Fixture field');d.setFieldValue(result.fieldId,'FIELD VALUE');}
 }
 const group=(a,b)=>{if(!JSON.parse(d.groupShapes(JSON.stringify({sectionIdx:0,targets:[{paraIdx:a,controlIdx:0},{paraIdx:b,controlIdx:0}]}))).ok)throw Error('Fixture group');};group(1,2);if(nested){group(3,4);group(1,3);}bytes=checkedExport(d);
 }finally{d.free();}
 return f4Patch(bytes,rs=>{if(nested){const siblings=rs.map((r,i)=>r.tag===76&&r.level===3&&cid(r)==='noc$'?i:-1).filter(i=>i>=0),at=siblings[1];for(let i=at+1;i<extent(rs,at);i++)if(rs[i].tag===76){const g=groupGeometry(rs[i]);g.v.setFloat64(g.base+84,g.matrix(44)[5]+10000,true);}}if(paragraphs){const at=rs.findIndex(r=>r.tag===72&&r.payload.length===33),head=rs.findIndex((r,i)=>i>at&&r.tag===66&&r.level===rs[at].level),end=extent(rs,head),copy=rs.slice(head,end).map(r=>({...r,payload:r.payload.slice()}));view(rs[at].payload).setUint16(0,2,true);view(rs[head].payload).setUint32(0,view(rs[head].payload).getUint32(0,true)&0x7fffffff,true);rs.splice(end,0,...copy);}for(const r of rs)if(r.tag===76&&cid(r)==='cer$'){const g=groupGeometry(r);g.v.setUint32(g.base+28,0x010b0000,true);}});
}
export function f4Transplant(hostBytes,hostBlock,donorBytes){
 const state=f4Inspect(hostBytes),b=hostBlock(state),donor=f4Inspect(donorBytes),group=donor.drawing_tree.nodes.find(n=>!n.parent_id),drs=donor.recordSets.get(0),addition=drs.slice(group.record_index,group.records_end).map(r=>({...r,level:r.level+b.raw_level,payload:r.payload.slice()}));
 return f4Patch(hostBytes,rs=>{for(const r of addition)if(r.tag===68)for(let i=4;i<r.payload.length;i+=8)view(r.payload).setUint32(i,0,true);const a=Buffer.alloc(16);a.writeUInt16LE(11);a.write(' osg',2);a.writeUInt16LE(11,14);rs[b.text_record].payload=Buffer.concat([rs[b.text_record].payload.subarray(0,-2),a,Buffer.from('\r','utf16le')]);const v=view(rs[b.record_index].payload);v.setUint32(0,((v.getUint32(0,true)&0x80000000)|rs[b.text_record].payload.length/2)>>>0,true);v.setUint32(4,v.getUint32(4,true)|1<<11,true);v.setUint16(16,0,true);rs.splice(b.records_end,0,...addition);for(let i=b.records_end-1;i>b.record_index;i--)if(rs[i].tag===69&&rs[i].level===b.raw_level+1)rs.splice(i,1);});
}
export function f4CellFixture(depth=1,options={}){return f4Transplant(depth===1?fixture():nestedFixture(),s=>s.blocks.find(b=>b.cell_path.length===depth),f4GroupFixture(options));}
export function f4NestedBoxFixture(){
 // A direct shape is the donor, retained inside the first grouped text list.
 const donor=new HwpDocument(fixture({table:false,paragraphs:['DONOR']}));let bytes;try{const o=JSON.parse(donor.createShapeControl(JSON.stringify({sectionIdx:0,paraIdx:0,charOffset:0,width:6000,height:3000,horzOffset:1000,vertOffset:3000,treatAsChar:false,textWrap:'InFrontOfText'})));donor.setTextBoxAt(0,o.controlIdx,true);const l=JSON.parse(donor.getCursorModel()).lists.find(l=>!l.isCell);donor.insertTextAtCursor(l.listId,0,0,'INNER BOX');bytes=checkedExport(donor);}finally{donor.free();}
 bytes=f4Patch(bytes,rs=>{const g=groupGeometry(rs.find(r=>r.tag===76));g.v.setUint32(g.base+28,0x010b0000,true);});return f4Transplant(f4GroupFixture(),s=>s.text_boxes[0].paragraphs[0],bytes);
}
export function f4FieldFixture(kind='hyperlink',cell=false){const ids={hyperlink:'klh%',bookmark:'kmb%',date:'etd%',docdate:'tdd%',path:'tap%',mailmerge:'gmm%',crossref:'frx%',formula:'umf%',summary:'rms%',userinfo:'rsu%',memo:'em%%',privateinfo:'rpc%',toc:'cot%',unknown:'knu%'};return f4Patch(fieldFixture({cell,mixed:true}),rs=>{for(const r of rs){if(r.tag===71&&cid(r)==='klc%')Buffer.from(ids[kind]).copy(r.payload,0);if(r.tag===67){const v=view(r.payload);for(let i=0;i+16<=r.payload.length;i+=2)if([3,4].includes(v.getUint16(i,true))&&Buffer.from(r.payload.subarray(i+2,i+6)).toString()==='klc%')Buffer.from(ids[kind]).copy(r.payload,i+2);}}});}
export const f4Target=(id,sha)=>`hwp5:${sha}:${Buffer.from(id).toString('base64url')}`;

export function f4PictureGroupsFixture(){return f4Patch(nestedGroupFixture(),rs=>{const r=rs.find(r=>r.tag===71&&cid(r)===' osg'),v=view(r.payload);v.setInt32(8,20000,true);v.setInt32(12,2000,true);v.setUint32(4,(v.getUint32(4,true)&~(7<<21))|(3<<21),true);});}
export function f4MixedGroupFixture(){const d=new HwpDocument(f4GroupFixture());let bytes;try{const o=JSON.parse(d.insertPicture(0,3,0,'[]',progressiveJpeg,3600,3600,64,40,'jpg','synthetic image'));d.setPictureProperties(0,o.paraIdx,o.controlIdx,JSON.stringify({treatAsChar:false,horzOffset:2000,vertOffset:33000}));if(!JSON.parse(d.groupShapes(JSON.stringify({sectionIdx:0,targets:[{paraIdx:1,controlIdx:0},{paraIdx:3,controlIdx:o.controlIdx}]}))).ok)throw Error('Mixed fixture group');bytes=checkedExport(d);}finally{d.free();}return bytes;}
