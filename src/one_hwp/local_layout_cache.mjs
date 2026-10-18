/** Invalidate only mapped paragraph line caches after explicit geometry changes. */
import {view} from './local_complex_records.mjs';

export function invalidateSectionLayout(records,blocks){
 const replacements=new Map(),remove=new Set();for(const b of blocks){const head=records[b.record_index].payload.slice();view(head).setUint16(16,0,true);replacements.set(b.record_index,head);
  for(let i=b.record_index+1;i<b.records_end;i++)if(records[i].tag===69&&records[i].level===b.raw_level+1)remove.add(i);
 }return records.flatMap((r,i)=>remove.has(i)?[]:[replacements.has(i)?{...r,payload:replacements.get(i)}:r]);
}
