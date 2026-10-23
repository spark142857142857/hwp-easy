/** Trusted normalized field/object hosts and bounded column frames. */
import {HwpDocument} from '@rhwp/core';
import {tableControlFixture} from './local_table_control_fixtures.mjs';
import {nestedRenderFixture} from './local_nested_render_fixtures.mjs';
import {inspectLocalComplex,editLocalComplex} from '../src/one_hwp/local_complex.mjs';
import {tableReflowContexts,reflowTableLocal} from '../src/one_hwp/local_table_reflow.mjs';
import {publishVerifiedPatch} from '../src/one_hwp/local_verified_patch.mjs';
import {view} from '../src/one_hwp/local_complex_records.mjs';
import {digest} from '../src/one_hwp/local_file.mjs';
const inspect=bytes=>inspectLocalComplex(HwpDocument,bytes,{includeDocumentInfo:false,verifyCharacterModel:false});
export const mixedRenderProfiles=[
 ...[0,1,2].map(alignment=>({name:`fields-${alignment}`,kind:'fields',alignment})),
 ...[0,1,2].map(alignment=>({name:`objects-${alignment}`,kind:'objects',alignment})),
 {name:'mixed-controls',kind:'mixed',alignment:1},
 {name:'mixed-later',kind:'mixed',alignment:1,columns:true,column:1},
 {name:'equal-first',kind:'columns',alignment:0,column:0},
 {name:'equal-later',kind:'columns',alignment:1,column:1},
 {name:'unequal-later',kind:'columns',alignment:2,column:1,unequal:true},
 {name:'three-later',kind:'columns',alignment:1,column:2,columnCount:3},
 {name:'four-later',kind:'columns',alignment:2,column:3,columnCount:4}
];
export function mixedRenderFixture({kind='fields',columns=kind==='columns',alignment=0,column=0,columnCount=2,unequal=false,lines=8,empty=false}={}){
 let bytes=kind==='columns'?nestedRenderFixture({alignment,lines,room:3000}):tableControlFixture({lines,fields:kind==='objects'?[]:['prefix','between','suffix'],objects:['objects','mixed'].includes(kind)?['picture','box']:[],mixed:kind!=='objects'&&!empty,empty});
 if(kind!=='columns'){
  let s=inspect(bytes),hash=digest(bytes),c=tableReflowContexts(s,hash)[0];
  bytes=reflowTableLocal(HwpDocument,bytes,hash,{type:'reflow_table',target_id:c.target_id,expected_old:c.expected_old,expected_tables:c.expected_tables}).bytes;
  for(const [from,to]of [['inner answer 😀','PEER'],['PEER 1 TABLE','SIB'],['PREFIX NOTE','PREFIX'],['BETWEEN NOTE','BETWEEN'],['SUFFIX NOTE','SUFFIX']])for(;;){
   s=inspect(bytes);const b=s.blocks.find(b=>b.text.includes(from));if(!b)break;hash=digest(bytes);const start=[...b.text.slice(0,b.text.indexOf(from))].length;
   bytes=editLocalComplex(HwpDocument,bytes,hash,{type:'splice_text',target_id:`hwp5:${hash}:${Buffer.from(b.id).toString('base64url')}`,expected_old:b.text,start,end:start+[...from].length,new_text:to}).bytes;
  }
  for(let i=0;i<3;i++){s=inspect(bytes);const f=s.fields.find(f=>f.name===`field-${i}`);if(!f||!f.value)continue;hash=digest(bytes);bytes=editLocalComplex(HwpDocument,bytes,hash,{type:'set_field',target_id:`hwp5:${hash}:${Buffer.from(f.id).toString('base64url')}`,expected_old:f.value,new_text:`F${i}`}).bytes;}
 }
 if(columnCount>2){const s=inspect(bytes),b=s.blocks.find(b=>b.text==='SIDE'),hash=digest(bytes);bytes=editLocalComplex(HwpDocument,bytes,hash,{type:'splice_text',target_id:`hwp5:${hash}:${Buffer.from(b.id).toString('base64url')}`,expected_old:b.text,start:0,end:4,new_text:'S'}).bytes;}
 const s=inspect(bytes),rs=s.recordSets.get(0).map(r=>({...r,payload:r.payload.slice()})),root=s.tables[0];
 // Extra stored height makes all three ancestor alignments observable.
 if(kind!=='columns'){for(const c of root.cells){const p=view(rs[c.start].payload);p.setUint32(4,(p.getUint32(4,true)&~0x60)|(alignment<<5),true);p.setUint32(20,c.height+6000,true);}view(rs[root.record_index].payload).setUint32(20,root.properties.tableHeight+6000,true);}
 if(columns){
  const def=rs.find(r=>r.tag===71&&Buffer.from(r.payload.subarray(0,4)).toString()==='dloc');
  if(unequal){const p=new Uint8Array(22);p.set(def.payload.subarray(0,4));const v=view(p);v.setUint16(4,8,true);[11000,2000,19768,0].forEach((n,i)=>v.setInt16(8+i*2,n,true));def.payload=p;}
  else{view(def.payload).setUint16(4,0x1000|(columnCount<<2),true);view(def.payload).setUint16(6,1800,true);}
  const widths=columnCount===4?[7620,1200]:columnCount===3?[10500,2400]:[15000,4000];for(const c of root.cells)view(rs[c.start].payload).setUint32(16,widths[c.cell],true);view(rs[root.record_index].payload).setUint32(16,widths.reduce((a,b)=>a+b,0),true);
  const height=kind==='columns'?30000:50000;for(const c of root.cells)view(rs[c.start].payload).setUint32(20,height,true);view(rs[root.record_index].payload).setUint32(20,height,true);view(rs[root.table_record].payload).setUint32(0,(view(rs[root.table_record].payload).getUint32(0,true)&~3)|1,true);
  const t=s.tables[1],childWidth=columnCount===4?6600:columnCount===3?8400:10000;for(const c of t.cells){view(rs[c.start].payload).setUint32(20,22000,true);view(rs[c.start].payload).setUint32(16,childWidth/2,true);}view(rs[t.record_index].payload).setUint32(20,22000,true);view(rs[t.record_index].payload).setUint32(16,childWidth,true);
  if(column)rs[s.blocks.find(b=>b.id===root.parent_id).record_index].payload[11]|=8;
  if(column>1){const first=s.blocks.find(b=>!b.cell_path.length),head=rs[first.record_index],shape=rs[first.shape_record],extra=[];for(let i=1;i<column;i++){const h={...head,payload:head.payload.slice()},p=view(h.payload);p.setUint32(0,3,true);p.setUint32(4,0,true);p.setUint8(11,8);p.setUint16(12,1,true);p.setUint16(16,0,true);extra.push(h,{tag:67,level:1,payload:Buffer.from(`C${i}\r`,'utf16le')},{...shape,payload:shape.payload.slice()});}rs.splice(s.blocks.find(b=>b.id===root.parent_id).record_index,0,...extra);}
 }
 return publishVerifiedPatch(bytes,s,0,rs);
}
