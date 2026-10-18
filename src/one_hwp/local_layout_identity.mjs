/** Keep risk matching on an object, rather than its changing paragraph ordinal. */
import {createHash} from 'node:crypto';
import {view,encodeRecords} from './local_complex_records.mjs';
const cache=new WeakMap();
export function layoutObjectIdentity(state,object){
  let sections=cache.get(state);if(!sections){sections=new Map();cache.set(state,sections);}
  if(!sections.has(object.section)){
    const rs=state.recordSets?.get(object.section)??[],items=[],ids=new Map(),hashes=new Map();
    for(let at=0;at<rs.length;at++){
      const r=rs[at];if(r.tag!==71||r.payload.length<40||![' osg',' lbt'].includes(Buffer.from(r.payload.subarray(0,4)).toString()))continue;
      const frame=[r];if(rs[at+1]?.tag===76)frame.push(rs[at+1]);
      // HWP5 common-object header: z-order at 24, margins at 28..35,
      // document instance ID at 36 (Hancom revision 1.3, table 69).
      const instance=view(r.payload).getUint32(36,true),hash=createHash('sha256').update(encodeRecords(frame.map((r,i)=>({...r,level:i})))).digest('hex');
      items.push({at,instance,hash});ids.set(instance,(ids.get(instance)??0)+1);hashes.set(hash,(hashes.get(hash)??0)+1);
    }
    sections.set(object.section,new Map(items.map(o=>[o.at,o.instance&&ids.get(o.instance)===1?`s${object.section}:instance:${o.instance}`:`unverified:s${object.section}:raw:${o.hash}`+(hashes.get(o.hash)>1?`:record:${o.at}`:'')])));
  }
  return sections.get(object.section).get(object.record_index)??`unverified:s${object.section}:${object.block_id??object.parent_id}:${object.picture_index??object.id}`;
}
