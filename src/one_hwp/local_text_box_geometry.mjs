/** Explicit geometry edits for verified, unrotated plain rectangle text boxes. */
import {GuardError} from '../../probes/sites-runtime/guard/records.mjs';
import {fail,view,equal} from './local_complex_records.mjs';
import {groupGeometry} from './local_complex_group.mjs';
import {sameProperties} from './local_page_state.mjs';
import {invalidateSectionLayout} from './local_layout_cache.mjs';
import {publishVerifiedPatch} from './local_verified_patch.mjs';

export function textBoxGeometry(state,box){
 if(box.nested_object)return null;const f=box.flow,p=box.properties;
 if(f.treatAsChar||f.widthRelTo!==4||f.heightRelTo!==2||f.horzAlign!==0||f.vertAlign!==0||p.width<1||p.height<1)return null;
 const rs=state.recordSets.get(box.section),shape=rs[box.record_index+1],rects=rs.slice(box.record_index+1,box.records_end).filter(r=>r.tag===79);
 if(rects.length!==1||rects[0].payload.length!==33)return null;
 try{
  const g=groupGeometry(shape),{v,base}=g;
  if(g.count!==1||g.width!==p.width||g.height!==p.height||v.getUint32(base+20,true)!==p.width||v.getUint32(base+24,true)!==p.height||v.getUint16(base+8,true)!==0||v.getInt16(base+32,true)!==0||(v.getUint32(base+28,true)&3)!==0||g.combined.some((n,i)=>Math.abs(n-[1,0,0,0,1,0][i])>1e-9))return null;
  const corners=[0,0,p.width,0,p.width,p.height,0,p.height],rv=view(rects[0].payload);
  if(corners.some((n,i)=>rv.getInt32(1+i*4,true)!==n))return null;
  return {base,shape_index:box.record_index+1,rectangle_index:rs.indexOf(rects[0])};
 }catch(error){if(!(error instanceof GuardError))throw error;return null;}
}

export function transformTextBox(state,source,version,op){
 if(!equal(Object.keys(op).sort(),['type','target_id','expected_old','expected_properties','expected_flow','props'].sort()))fail('INVALID_OPERATION');
 if(typeof op.target_id!=='string'||!op.target_id.startsWith(`hwp5:${version}:`))fail('VERSION_CONFLICT');
 const encoded=op.target_id.slice(70),id=Buffer.from(encoded,'base64url').toString();if(!id||Buffer.from(id).toString('base64url')!==encoded)fail('INVALID_TARGET');
 const box=state.text_boxes.find(b=>b.id===id),host=state.blocks.find(b=>b.id===box?.block_id);if(!box||!host)fail('TEXT_BOX_TARGET_REQUIRED');
 if(op.expected_old!==host.text)fail('EXPECTED_OLD_MISMATCH');
 if(!sameProperties(op.expected_properties,box.properties)||!sameProperties(op.expected_flow,box.flow))fail('EXPECTED_TEXT_BOX_MISMATCH');
 if(!op.props||Object.getPrototypeOf(op.props)!==Object.prototype||!Object.keys(op.props).length||Object.entries(op.props).some(([k,n])=>!['width','height','horzOffset','vertOffset'].includes(k)||!Number.isSafeInteger(n)||Math.abs(n)>720000||['width','height'].includes(k)&&n<1))fail('INVALID_TEXT_BOX_PROPERTIES');
 const geometry=textBoxGeometry(state,box);if(!geometry)fail('TEXT_BOX_GEOMETRY_PROFILE_UNSUPPORTED');
 const wanted={...box.properties,...op.props};
 if(sameProperties(wanted,box.properties))return {bytes:source,content_verified:true,raw_preservation_verified:true,unchanged:true,layout_verified:false};
 const rs=state.recordSets.get(box.section),records=rs.map((r,i)=>[box.record_index,geometry.shape_index,geometry.rectangle_index].includes(i)?{...r,payload:r.payload.slice()}:r),common=view(records[box.record_index].payload);
 common.setInt32(12,wanted.horzOffset,true);common.setInt32(8,wanted.vertOffset,true);common.setUint32(16,wanted.width,true);common.setUint32(20,wanted.height,true);
 const shape=view(records[geometry.shape_index].payload),rect=view(records[geometry.rectangle_index].payload);
 for(const at of [12,20])shape.setUint32(geometry.base+at,wanted.width,true);
 for(const at of [16,24])shape.setUint32(geometry.base+at,wanted.height,true);
 [0,0,wanted.width,0,wanted.width,wanted.height,0,wanted.height].forEach((n,i)=>rect.setInt32(1+i*4,n,true));
 const invalidated=invalidateSectionLayout(records,[...state.blocks.filter(b=>b.section===box.section),...box.paragraphs]),bytes=publishVerifiedPatch(source,state,box.section,invalidated);
 return {bytes,content_verified:true,raw_preservation_verified:true,text_box_changed:true,text_box_geometry_changed:true,raw_preservation_scope:'selected_plain_rectangle_frame_dimensions_offsets_corners_and_mapped_line_caches; text_styles_anchors_wrap_tables_other_controls_and_streams_exact',layout_verified:false};
}
