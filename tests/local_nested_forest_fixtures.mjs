/** Canonical forests, normalized hosts and complete-row root fragments. */
import {HwpDocument} from '@rhwp/core';
import {hostTablesFixture,tableReflowFixture} from './local_table_reflow_fixtures.mjs';
import {tableTextFlowFixture} from './local_table_text_flow_fixtures.mjs';
import {inspectLocalComplex,editLocalComplex} from '../src/one_hwp/local_complex.mjs';
import {tableReflowContexts,reflowTableLocal} from '../src/one_hwp/local_table_reflow.mjs';
import {publishVerifiedPatch} from '../src/one_hwp/local_verified_patch.mjs';
import {view} from '../src/one_hwp/local_complex_records.mjs';
import {digest} from '../src/one_hwp/local_file.mjs';
const inspect=b=>inspectLocalComplex(HwpDocument,b,{includeDocumentInfo:false,verifyCharacterModel:false});
export const forestRenderProfiles=[
 {name:'siblings-top',kind:'siblings',alignment:0,count:3},
 {name:'siblings-bottom',kind:'siblings',alignment:2,count:3,selected:2},
 {name:'deep-siblings-middle',kind:'siblings',depth:3,alignment:1,count:2,selected:1},
 ...[0,1,2].map(alignment=>({name:`host-${alignment}`,kind:'host',alignment,count:2})),
 {name:'body-roots',kind:'body',alignment:1,count:2},
 {name:'rows-first',kind:'rows',alignment:1,row:0},
 {name:'rows-later',kind:'rows',alignment:2,row:3}
];
export function forestRenderFixture({kind='siblings',depth=2,alignment=0,count=2,selected=0,lines=8,row=0}={}){
 let bytes=kind==='siblings'?hostTablesFixture({depth,count,selected,lines,alignment:Array(depth).fill(alignment),room:6000}):kind==='rows'?tableReflowFixture({depth,lines,rows:6,alignment:Array(depth).fill(alignment)}):tableTextFlowFixture({body:kind==='body',depth,count,selected,lines,alignment:Array(depth).fill(alignment),prefix:'PREFIX',between:'BETWEEN',suffix:'SUFFIX'});
 for(const [from,to]of [['PEER 0 TABLE','SIB0'],['inner label','IN'],['inner answer 😀','PEER'],['PEER 1 TABLE','SIB1'],['PEER 2 TABLE','SIB2']]){
  for(;;){const s=inspect(bytes),b=s.blocks.find(b=>b.text===from);if(!b)break;const hash=digest(bytes);bytes=editLocalComplex(HwpDocument,bytes,hash,{type:'splice_text',target_id:`hwp5:${hash}:${Buffer.from(b.id).toString('base64url')}`,expected_old:b.text,start:0,end:[...b.text].length,new_text:to}).bytes;}
 }
 if(kind==='rows'){
  const s=inspect(bytes),rs=s.recordSets.get(0).map(r=>({...r,payload:r.payload.slice()})),root=s.tables[0];let out=rs;
  if(row){const a=root.cells[0].blocks[0],b=root.cells.find(c=>c.row===row&&c.col===0).blocks[0];out=[...rs.slice(0,a.record_index),...rs.slice(b.record_index,b.records_end),...rs.slice(a.records_end,b.record_index),...rs.slice(a.record_index,a.records_end),...rs.slice(b.records_end)];}
  for(const c of root.cells)view(rs[c.start].payload).setUint32(20,30000,true);view(rs[root.record_index].payload).setUint32(20,180000,true);for(const t of s.tables.filter(t=>t.cell_path.length)){for(const c of t.cells)view(rs[c.start].payload).setUint32(20,22000,true);view(rs[t.record_index].payload).setUint32(20,22000,true);}
  bytes=publishVerifiedPatch(bytes,s,0,out);
 }
 let s=inspect(bytes);const v=digest(bytes),c=tableReflowContexts(s,v)[0];bytes=reflowTableLocal(HwpDocument,bytes,v,{type:'reflow_table',target_id:c.target_id,expected_old:c.expected_old,expected_tables:c.expected_tables}).bytes;
 if(kind==='rows'){s=inspect(bytes);const rs=s.recordSets.get(0).map(r=>({...r,payload:r.payload.slice()})),p=view(rs[s.tables[0].table_record].payload);p.setUint32(0,(p.getUint32(0,true)&~3)|1,true);const remove=new Set(s.blocks.filter(b=>!b.cell_path.length&&b.record_index>s.tables[0].end&&!b.text).flatMap(b=>Array.from({length:b.records_end-b.record_index},(_,i)=>b.record_index+i)));bytes=publishVerifiedPatch(bytes,s,0,rs.filter((r,i)=>!remove.has(i)));}
 return bytes;
}
