/** Move a selected body drawing anchor; never round-trip the drawing subtree. */
import {fail,view,textTokens,equal} from './local_complex_records.mjs';
import {standardBlockId} from './local_complex_table.mjs';

export function reanchorFloating(state,t,destination){
 const rs=state.recordSets.get(t.b.section),b=t.b;
 if(destination?.id===b.id)return {records:rs,selected_record:rs[t.selected.record_index],remap:null};
 // Cell moves need recursive control-index remapping, including table paths.
 // Keep cell placement in its existing host until that mapping is verified.
 if(destination&&(b.cell_path.length||destination.cell_path.length))fail('PLACEMENT_REANCHOR_BODY_REQUIRED');
 if(destination&&destination.section!==b.section)fail('PLACEMENT_SECTION_UNSUPPORTED');
 if(destination&&(!destination.text_mapping_verified||!Number.isSafeInteger(destination.text_record)||!destination.unit_styles))fail('PLACEMENT_DESTINATION_UNVERIFIED');
 if(!b.unit_styles)fail('COMPLEX_STYLE_UNVERIFIED');
 const drawings=[];for(let i=b.record_index+1;i<=t.selected.record_index;i++)if(rs[i].tag===71&&rs[i].level===b.raw_level+1&&Buffer.from(rs[i].payload.subarray(0,4)).toString()===' osg')drawings.push(i);
 const anchors=b.tokens.filter(a=>a.code===11&&Buffer.from(rs[b.text_record].payload.subarray(a.unit*2+2,a.unit*2+6)).toString()===' osg');
 if(anchors.length!==rs.slice(b.record_index+1,b.records_end).filter(r=>r.tag===71&&r.level===b.raw_level+1&&Buffer.from(r.payload.subarray(0,4)).toString()===' osg').length)fail('PLACEMENT_ANCHOR_UNVERIFIED');
 const anchor=anchors[drawings.length-1];if(!anchor)fail('PLACEMENT_ANCHOR_UNVERIFIED');
 let end=t.selected.record_index+1;while(end<rs.length&&rs[end].level>rs[t.selected.record_index].level)end++;
 const subtree=rs.slice(t.selected.record_index,end),replacements=new Map();
 function patch(host,from,count,insert,ids){
  if(rs.slice(host.record_index+1,host.records_end).some(r=>r.level===host.raw_level+1&&![67,68,69,71].includes(r.tag)))fail('PLACEMENT_ANCHOR_PROFILE_UNSUPPORTED');
  const old=rs[host.text_record].payload,text=Buffer.concat([old.subarray(0,from*2),insert,old.subarray((from+count)*2)]),styles=host.unit_styles.slice(0,from).concat(ids,host.unit_styles.slice(from+count)),runs=[];
  styles.forEach((id,unit)=>{if(!unit||id!==styles[unit-1])runs.push({id,unit});});if(runs.length>32)fail('COMPLEX_STYLE_LIMIT');
  const shape=Buffer.alloc(runs.length*8);runs.forEach((r,i)=>{shape.writeUInt32LE(r.unit,i*8);shape.writeUInt32LE(r.id,i*8+4);});
  const header=rs[host.record_index].payload.slice(),v=view(header);v.setUint32(0,((v.getUint32(0,true)&0x80000000)|text.length/2)>>>0,true);
  v.setUint32(4,((v.getUint32(4,true)&~(1<<11))|(textTokens(text).some(a=>a.code===11)?1<<11:0))>>>0,true);v.setUint16(12,runs.length,true);v.setUint16(16,0,true);
  for(const [at,payload]of [[host.record_index,header],[host.text_record,text],[host.shape_record,shape]])replacements.set(at,{...rs[at],payload});
 }
 const inserted=rs[b.text_record].payload.slice(anchor.unit*2,(anchor.unit+8)*2);
 patch(b,anchor.unit,8,Buffer.alloc(0),[]);
 if(destination){const at=destination.tokens.at(-1).unit;patch(destination,at,0,inserted,Array(8).fill(destination.unit_styles[at]));}
 const records=rs.flatMap((r,i)=>[...(i===destination?.records_end?subtree:[]),...(i>=t.selected.record_index&&i<end?[]:[replacements.get(i)??r])]);if(destination?.records_end===rs.length)records.push(...subtree);
 return {records,selected_record:subtree[0],remap:true};
}

/** Track every public identity by its raw record, including shifted siblings. */
export function floatingTargetRemap(before,after,records,originalRecords,selected,selectedRecord){
 const result={},positions=new Map(records.map((r,i)=>[r,i]));
 const visibleStyles=b=>b.unit_styles?b.tokens.filter(t=>t.text).flatMap(t=>b.unit_styles.slice(t.unit,t.unit+t.length)):null;
 for(const b of before.blocks){const now=after.blocks.find(n=>n.section===b.section&&n.paragraph===b.paragraph&&equal(n.cell_path,b.cell_path));if(!now||now.text!==b.text||!equal(visibleStyles(b),visibleStyles(now)))fail('PLACEMENT_CONTENT_MISMATCH');result[b.id]=now.id;const standard=standardBlockId(b);if(standard)result[standard]=standardBlockId(now);}
 for(const key of ['text_boxes','groups','pictures','opaque_drawings','tables'])for(const old of before[key]??[]){
  const record=old===selected?selectedRecord:originalRecords[old.record_index],at=positions.get(record),now=after[key].find(n=>n.section===old.section&&(old.section===selected.section?n.record_index===at:n.record_index===old.record_index));
  if(!now)fail('PLACEMENT_IDENTITY_REMAP_UNVERIFIED');if(old.id)result[old.id]=now.id;
  if(old.paragraphs)for(const p of old.paragraphs)result[p.id]=now.paragraphs[p.paragraph]?.id??null;
 }
 for(const old of before.fields){const now=after.fields.find(n=>n.section===old.section&&n.field_id===old.field_id&&n.block_id===result[old.block_id]);if(!now||now.value!==old.value||now.name!==old.name||now.guide!==old.guide)fail('PLACEMENT_CONTENT_MISMATCH');result[old.id]=now.id;}
 return result;
}
