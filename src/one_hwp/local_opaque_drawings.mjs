/** Only outer geometry is editable; unhandled group contents stay opaque. */
import {createHash} from 'node:crypto';
import {objectFlow,validObjectHeader} from './local_flow_records.mjs';
import {view,encodeRecords} from './local_complex_records.mjs';
export function inspectOpaqueDrawings(recordSets,blocks,groups){
 const drawings=[];
 for(const b of blocks){if(b.cell_path.length||!b.text_mapping_verified)continue;const rs=recordSets.get(b.section);let index=0;
  for(let i=b.record_index+1;i<b.records_end;i++){
   const r=rs[i],shape=rs[i+1];if(r.tag!==71||r.level!==1||Buffer.from(r.payload.subarray(0,4)).toString()!==' osg'||!validObjectHeader(r.payload)||shape?.tag!==76||Buffer.from(shape.payload.subarray(0,4)).toString()!=='noc$'||groups.some(g=>g.section===b.section&&g.record_index===i))continue;
   let end=i+1;while(end<b.records_end&&rs[end].level>r.level)end++;const v=view(r.payload),properties={width:v.getUint32(16,true),height:v.getUint32(20,true),horzOffset:v.getInt32(12,true),vertOffset:v.getInt32(8,true)};
   drawings.push({id:`${b.id}:od${index++}`,block_id:b.id,section:b.section,record_index:i,properties,flow:objectFlow(r),subtree_sha256:createHash('sha256').update(encodeRecords(rs.slice(i,end))).digest('hex'),contents_read_only:true});
  }
 }return drawings;
}
export function publicOpaqueDrawings(state,version){return state.opaque_drawings.map(({record_index,...d})=>({...d,target_id:`hwp5:${version}:${Buffer.from(d.id).toString('base64url')}`,profile:'opaque_body_drawing_group',supported_operations:['reposition_floating_object','protect_page_bottom']}));}
