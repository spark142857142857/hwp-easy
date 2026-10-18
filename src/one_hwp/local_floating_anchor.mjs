/** Move a selected drawing anchor; never round-trip its retained subtree. */
import {fail,view,textTokens,equal} from './local_complex_records.mjs';
import {standardBlockId} from './local_complex_table.mjs';

export function reanchorFloating(state,t,destination){
 const rs=state.recordSets.get(t.b.section),b=t.b;
 if(destination?.id===b.id)return {records:rs,selected_record:rs[t.selected.record_index],remap:null};
 if(destination&&(!destination.text_mapping_verified||!Number.isSafeInteger(destination.text_record)&&!destination.empty_text_materialization||!destination.unit_styles))fail('PLACEMENT_DESTINATION_UNVERIFIED');
 if(!b.unit_styles)fail('COMPLEX_STYLE_UNVERIFIED');
 const drawings=[];for(let i=b.record_index+1;i<=t.selected.record_index;i++)if(rs[i].tag===71&&rs[i].level===b.raw_level+1&&Buffer.from(rs[i].payload.subarray(0,4)).toString()===' osg')drawings.push(i);
 const anchors=b.tokens.filter(a=>a.code===11&&Buffer.from(rs[b.text_record].payload.subarray(a.unit*2+2,a.unit*2+6)).toString()===' osg');
 if(anchors.length!==rs.slice(b.record_index+1,b.records_end).filter(r=>r.tag===71&&r.level===b.raw_level+1&&Buffer.from(r.payload.subarray(0,4)).toString()===' osg').length)fail('PLACEMENT_ANCHOR_UNVERIFIED');
 const anchor=anchors[drawings.length-1];if(!anchor)fail('PLACEMENT_ANCHOR_UNVERIFIED');
 let end=t.selected.record_index+1;while(end<rs.length&&rs[end].level>rs[t.selected.record_index].level)end++;
 const originals=rs.slice(t.selected.record_index,end),delta=destination?destination.raw_level-b.raw_level:0,subtree=originals.map(r=>delta?{...r,level:r.level+delta}:r),replacements=new Map(),insertions=new Map();
 if(subtree.some(r=>r.level<0||r.level>1023))fail('PLACEMENT_ANCHOR_PROFILE_UNSUPPORTED');
 function patch(host,from,count,insert,ids){
  const rs=state.recordSets.get(host.section);
  if(rs.slice(host.record_index+1,host.records_end).some(r=>r.level===host.raw_level+1&&![67,68,69,71].includes(r.tag)))fail('PLACEMENT_ANCHOR_PROFILE_UNSUPPORTED');
  const old=rs[host.text_record]?.payload??Buffer.from('\r','utf16le'),text=Buffer.concat([old.subarray(0,from*2),insert,old.subarray((from+count)*2)]),styles=host.unit_styles.slice(0,from).concat(ids,host.unit_styles.slice(from+count)),runs=[];
  styles.forEach((id,unit)=>{if(!unit||id!==styles[unit-1])runs.push({id,unit});});if(runs.length>32)fail('COMPLEX_STYLE_LIMIT');
  const shape=Buffer.alloc(runs.length*8);runs.forEach((r,i)=>{shape.writeUInt32LE(r.unit,i*8);shape.writeUInt32LE(r.id,i*8+4);});
  const header=rs[host.record_index].payload.slice(),v=view(header);v.setUint32(0,((v.getUint32(0,true)&0x80000000)|text.length/2)>>>0,true);
  v.setUint32(4,((v.getUint32(4,true)&~(1<<11))|(textTokens(text).some(a=>a.code===11)?1<<11:0))>>>0,true);v.setUint16(12,runs.length,true);v.setUint16(16,0,true);
  for(const [at,payload]of [[host.record_index,header],[host.shape_record,shape]])replacements.set(rs[at],{...rs[at],payload});
  if(host.text_record!==undefined)replacements.set(rs[host.text_record],{...rs[host.text_record],payload:text});else insertions.set(rs[host.shape_record],{tag:67,level:host.raw_level+1,payload:text});
 }
 const inserted=rs[b.text_record].payload.slice(anchor.unit*2,(anchor.unit+8)*2);
 patch(b,anchor.unit,8,Buffer.alloc(0),[]);
 if(destination){const at=destination.tokens.at(-1).unit;patch(destination,at,0,inserted,Array(8).fill(destination.unit_styles[at]));}
 const recordSets=new Map(),origins=new Map();for(const section of new Set([b.section,...(destination?[destination.section]:[])])){
  const input=state.recordSets.get(section);let records=input.flatMap((r,i)=>[...(section===destination?.section&&i===destination.records_end?subtree:[]),...(section===b.section&&i>=t.selected.record_index&&i<end?[]:[...(insertions.has(r)?[insertions.get(r)]:[]),replacements.get(r)??r])]);
  if(section===destination?.section&&destination.records_end===input.length)records.push(...subtree);for(const r of input)origins.set(r,replacements.get(r)??r);
  // Both source and destination can reflow after anchor removal/insertion.
  // In particular, clearing only the destination leaves stale source LineSeg
  // records behind during a cross-section transfer. Box-internal caches and
  // every non-cache byte remain exact. Track cloned headers for ID remapping.
  const positions=new Map(records.map((r,i)=>[r,i])),headers=new Map(),remove=new Set();
  for(const host of state.blocks.filter(p=>p.section===section)){
   const original=input[host.record_index],head=origins.get(original),at=positions.get(head);if(at===undefined)fail('PLACEMENT_IDENTITY_REMAP_UNVERIFIED');
   const payload=head.payload.slice();view(payload).setUint16(16,0,true);const replacement={...head,payload};headers.set(at,replacement);origins.set(original,replacement);
   for(let i=at+1;i<records.length&&records[i].level>host.raw_level;i++)if(records[i].tag===69&&records[i].level===host.raw_level+1)remove.add(i);
  }
  records=records.flatMap((r,i)=>remove.has(i)?[]:[headers.get(i)??r]);recordSets.set(section,records);
 }
 originals.forEach((r,i)=>origins.set(r,subtree[i]));
 return {records:recordSets.get(b.section),recordSets,selected_record:subtree[0],remap:true,origins};
}

/** Track every public identity by its raw record, including shifted siblings. */
export function floatingTargetRemap(before,after,records,originalRecords,selected,selectedRecord,origins=new Map()){
 const result={},sets=records instanceof Map?records:new Map([[selected.section,records]]),oldSets=originalRecords instanceof Map?originalRecords:new Map([[selected.section,originalRecords]]),positions=new Map([...sets].flatMap(([section,rs])=>rs.map((r,i)=>[r,{section,index:i}])));
 const visibleStyles=b=>b.unit_styles?b.tokens.filter(t=>t.text).flatMap(t=>b.unit_styles.slice(t.unit,t.unit+t.length)):null;
 const position=old=>{const record=oldSets.get(old.section)?.[old.record_index];return positions.get(origins.get(record)??record)??(!sets.has(old.section)?{section:old.section,index:old.record_index}:null);};
 for(const b of before.blocks){const at=position(b),now=after.blocks.find(n=>n.section===at?.section&&n.record_index===at.index);if(!now||now.text!==b.text||!equal(visibleStyles(b),visibleStyles(now)))fail('PLACEMENT_CONTENT_MISMATCH');result[b.id]=now.id;const standard=standardBlockId(b);if(standard)result[standard]=standardBlockId(now);}
 for(const key of ['text_boxes','groups','pictures','opaque_drawings','tables'])for(const old of before[key]??[]){
  const at=old===selected?positions.get(selectedRecord):position(old),now=after[key].find(n=>n.section===at?.section&&n.record_index===at.index);
  if(!now)fail('PLACEMENT_IDENTITY_REMAP_UNVERIFIED');if(old.id)result[old.id]=now.id;
  if(old.paragraphs)for(const p of old.paragraphs)result[p.id]=now.paragraphs[p.paragraph]?.id??null;
 }
 for(const old of before.fields){const now=after.fields.find(n=>n.section===old.section&&n.field_id===old.field_id&&n.block_id===result[old.block_id]);if(!now||now.value!==old.value||now.name!==old.name||now.guide!==old.guide)fail('PLACEMENT_CONTENT_MISMATCH');result[old.id]=now.id;}
 return result;
}
