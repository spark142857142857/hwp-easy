/** Conservative single-page budget; unknown pagination never becomes a guess. */
import {GuardError} from '../../probes/sites-runtime/guard/records.mjs';
import {view} from './local_complex_records.mjs';
import {tableHostParagraphHeight} from './local_table_host_controls.mjs';

export function tablePageSpace(state,section,width,height,rootHeights,measure,plainHeight){
 const rs=state.recordSets.get(section),body=state.blocks.filter(b=>b.section===section&&!b.cell_path.length);
 // Later sections can continue on a partly filled page. Their origin is not
 // proven by a section-local height sum; wait for an explicit fresh-page bound.
 let next=0,used=0,known=section===0,reason=section===0?'document_start':'section_origin_unverified';
 function paragraph(b){
  if(rs[b.record_index].payload[11]&&!(b===body[0]&&rs[b.record_index].payload[11]===3))throw new GuardError('TABLE_FLOATING_BODY_BREAK_UNVERIFIED');
  if(b.paragraph_properties.pageBreakBefore){used=0;known=true;reason='explicit_body_page_break';}
  const copy={...b,paragraph_properties:{...b.paragraph_properties,pageBreakBefore:false}},controls=[];
  for(let i=b.record_index+1;i<b.records_end;i++)if(rs[i].tag===71&&rs[i].level===b.raw_level+1)controls.push(Buffer.from(rs[i].payload.subarray(0,4)).toString());
  let value;
  if(controls.every(c=>[' lbt','dces','dloc','toof','daeh'].includes(c))&&b.tokens.every(t=>t.text||[2,11,13,16].includes(t.code)))value=plainHeight(copy,width,measure);
  else value=tableHostParagraphHeight(state,copy,width,measure,plainHeight);
  const tables=state.tables.filter(t=>t.section===section&&t.parent_id===b.id);
  for(const table of tables){
   const stored=rootHeights.get(table.id);if(!Number.isFinite(stored))throw new GuardError('TABLE_FLOATING_BODY_TABLE_UNVERIFIED');
   const p=view(rs[table.record_index].payload);value+=stored+p.getUint16(32,true)+p.getUint16(34,true)+2000;
  }
  used+=value;
  if(used>height-3600){known=false;reason='preceding_flow_may_span_pages';}
 }
 return {
  before(block){
   const at=body.indexOf(block);
   for(;next<at;next++)try{paragraph(body[next]);}catch(error){if(!(error instanceof GuardError))throw error;known=false;reason=error.code;}
   next=at+1;return {known,used:known?used:null,reason};
  },
  reserve(size,explicitBreak){
   const before={known,used:known?used:null,reason},newPage=explicitBreak||!known||used+size>height-3600;
   if(newPage){used=0;known=true;}
   used+=size;reason=newPage?'reserved_page_start':'conservative_same_page_budget';
   return {newPage,before,reused_current_page:!newPage,reserved_end:used,body_height:height,tail_room:3600};
  }
 };
}
