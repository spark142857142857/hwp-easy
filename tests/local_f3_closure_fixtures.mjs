/** Reproducible, synthetic F3 acceptance corpus. No user document contents. */
import {HwpDocument} from '@rhwp/core';
import {parseRecords} from '../src/one_hwp/guard/records.mjs';
import {nestedRenderFixture} from './local_nested_render_fixtures.mjs';
import {cellWrapRenderFixture,cellWrapBefore} from './local_cell_wrap_render_fixtures.mjs';
import {mixedRenderFixture} from './local_nested_mixed_fixtures.mjs';
import {complexFooterFixture} from './local_footer_fixtures.mjs';
import {tableReflowFixture,tableAnswer} from './local_table_reflow_fixtures.mjs';
import {inspectLocalComplex,editLocalComplex} from '../src/one_hwp/local_complex.mjs';
import {tableReflowContexts,reflowTableLocal} from '../src/one_hwp/local_table_reflow.mjs';
import {view,encodeRecords} from '../src/one_hwp/local_complex_records.mjs';
import {publishVerifiedPatch} from '../src/one_hwp/local_verified_patch.mjs';
import {digest} from '../src/one_hwp/local_file.mjs';
const inspect=b=>inspectLocalComplex(HwpDocument,b,{includeDocumentInfo:false,verifyCharacterModel:false});
const target=(bytes,b)=>`hwp5:${digest(bytes)}:${Buffer.from(b.id).toString('base64url')}`;
const edit=(bytes,b,op)=>editLocalComplex(HwpDocument,bytes,digest(bytes),{...op,target_id:target(bytes,b),expected_old:b.text}).bytes;
export const f3ClosureProfiles=[
 {name:'daily-punctuation',kind:'text',text:'신청서: Hello, world! (검토) 2026.10.',rows:['신청서: ','Hello, ','world! ','(검토) ','2026.10.']},
 {name:'italic-words',kind:'text',text:'Hello World 한글 문서입니다.',italic:true,rows:['Hello ','World ','한글 문','서입니','다.']},
 {name:'canonical-combining',kind:'text',text:'한글 Café 문서입니다.',rows:['한글 ','Café 문','서입니','다.']},
 {name:'korean-brackets',kind:'text',text:'신청(검토), 완료. 다음 문장! [안내]',rows:['신청(검','토), 완','료. 다음 ','문장! ','[안내]']},
 {name:'ratio-spacing',kind:'text',text:'한글 문서 ABC 2026, 확인.',italic:true,ratio:95,spacing:5,rows:['한글 문','서 ABC ','2026, 확','인.']},
 {name:'multiple-paragraphs',kind:'text',text:'한글 문서 ABC, 확인.',paragraphs:true},
 ...[0,1,2].map(alignment=>({name:`empty-guide-${alignment}`,kind:'fields',alignment,lines:12})),
 {name:'continued-40',kind:'pages',lines:40},
 {name:'continued-65',kind:'pages',lines:65},
 {name:'continued-85',kind:'pages',lines:85},
 {name:'continued-deep',kind:'pages',depth:3,lines:65},
 {name:'continued-middle',kind:'pages',alignment:1,lines:65},
 {name:'continued-bottom',kind:'pages',alignment:2,lines:65},
 {name:'continued-rows',kind:'pages',rows:3,lines:65},
 {name:'continued-merged',kind:'pages',verticalMerge:true,lines:65},
 {name:'continued-nested-merged',kind:'pages',verticalMerge:'nested',lines:65},
 ...[2,3,4].map(count=>({name:`automatic-${count}`,kind:'columns',count,lines:65})),
 {name:'automatic-two-pages',kind:'columns',count:2,lines:85},
 {name:'distributed-columns',kind:'columns',count:2,distribute:true,lines:65},
 {name:'column-rule-border',kind:'columns',count:2,rule:true,lines:65},
 {name:'footer-paragraphs',kind:'footer',before:4000,lines:12},
 {name:'footer-inline-table',kind:'footer',before:4000,table:true,lines:12},
 {name:'footer-large-spacing',kind:'footer',before:8000,table:true,lines:12},
 {name:'footer-page-number',kind:'footer',before:4000,number:true,lines:65}
];
export const f3OldText=p=>p.kind==='text'?cellWrapBefore:tableAnswer(8);
export const f3NewText=p=>p.kind==='text'?p.text:tableAnswer(p.lines??12);
export function f3Reflow(bytes){const s=inspect(bytes),h=digest(bytes),c=tableReflowContexts(s,h)[0];return reflowTableLocal(HwpDocument,bytes,h,{type:'reflow_table',...Object.fromEntries(['target_id','expected_old','expected_tables'].map(k=>[k,c[k]]))}).bytes;}
export function f3ClosureFixture(p,after=false){
 let bytes;
 if(p.kind==='text'){
  bytes=cellWrapRenderFixture({alignment:0,depth:p.depth??2});let s=inspect(bytes),b=s.blocks.find(b=>b.text===cellWrapBefore);
  if(p.italic){bytes=edit(bytes,b,{type:'format_text',start:0,end:[...b.text].length,props:{italic:true}});s=inspect(bytes);b=s.blocks.find(b=>b.text===cellWrapBefore);}
  if(p.ratio||p.spacing){const definitions=[...parseRecords(s.raw.streams.get('DocInfo'))].map(r=>({...r,payload:r.payload.slice()})),shape=definitions.filter(r=>r.tag===21)[b.unit_styles[0]];if(p.ratio)shape.payload.fill(p.ratio,14,21);if(p.spacing)shape.payload.fill(p.spacing,21,28);bytes=publishVerifiedPatch(bytes,s,0,s.recordSets.get(0),encodeRecords(definitions));}
  if(p.paragraphs){s=inspect(bytes);b=s.blocks.find(b=>b.text===cellWrapBefore);bytes=edit(bytes,b,{type:'insert_paragraphs',paragraphs:['','두 번째 문단입니다.']});}
 }else if(p.kind==='fields')bytes=mixedRenderFixture({kind:'fields',empty:true,alignment:p.alignment});
 else if(p.kind==='pages'&&(p.rows||p.verticalMerge)){
  bytes=tableReflowFixture({depth:p.depth??2,lines:8,rows:p.rows??1,verticalMerge:p.verticalMerge??false});
  for(const old of ['inner label','inner answer 😀']){const s=inspect(bytes),b=s.blocks.find(b=>b.text===old);if(b)bytes=edit(bytes,b,{type:'replace_text',new_text:old==='inner label'?'IN':'PEER'});}bytes=f3Reflow(bytes);
 }else if(p.kind==='columns'){
  bytes=mixedRenderFixture({kind:'columns',columnCount:p.count,column:0,alignment:0,lines:8});let s=inspect(bytes),rs=s.recordSets.get(0).map(r=>({...r,payload:r.payload.slice()})),col=rs.find(r=>r.tag===71&&Buffer.from(r.payload.subarray(0,4)).toString()==='dloc');if(p.count===4){const root=s.tables[0],q=view(rs[root.cells[1].start].payload);q.setUint32(4,q.getUint32(4,true)|0x10000,true);q.setUint16(24,0,true);q.setUint16(26,0,true);q.setUint16(28,141,true);q.setUint16(30,141,true);}view(col.payload).setUint16(4,0x1000|(p.count<<2)|(p.distribute?1:0),true);
  if(p.rule){col.payload[10]=1;col.payload[11]=2;const border=rs.find(r=>r.tag===75);view(border.payload).setUint16(12,3,true);}
  bytes=f3Reflow(publishVerifiedPatch(bytes,s,0,rs));
 }else bytes=nestedRenderFixture({depth:p.depth??2,alignment:p.alignment??0,lines:8,room:0});
 if(p.kind==='footer'){
  bytes=complexFooterFixture(bytes,{table:p.table,number:p.number});const s=inspect(bytes),rs=s.recordSets.get(0).map(r=>({...r,payload:r.payload.slice()})),definitions=[...parseRecords(s.raw.streams.get('DocInfo'))].map(r=>({...r,payload:r.payload.slice()})),shapes=definitions.filter(r=>r.tag===25),footer=rs.findIndex(r=>r.tag===71&&Buffer.from(r.payload.subarray(0,4)).toString()==='toof'),head=rs.find((r,i)=>i>footer&&r.tag===66),shape=shapes[view(head.payload).getUint16(8,true)].payload.slice();view(shape).setInt32(16,p.before,true);view(head.payload).setUint16(8,shapes.length,true);view(definitions.find(r=>r.tag===17).payload).setUint32(52,shapes.length+1,true);definitions.splice(definitions.indexOf(shapes.at(-1))+1,0,{tag:25,level:shapes[0].level,payload:shape});bytes=publishVerifiedPatch(bytes,s,0,rs,encodeRecords(definitions));
 }
 if(after){const s=inspect(bytes),b=s.blocks.find(b=>b.text===f3OldText(p));bytes=edit(bytes,b,{type:'replace_text',new_text:f3NewText(p)});if(p.kind!=='text')bytes=f3Reflow(bytes);}
 return bytes;
}
