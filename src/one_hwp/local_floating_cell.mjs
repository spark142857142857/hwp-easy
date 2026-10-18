/** Cell placement against an in-memory layout with the selected box omitted. */
import {fail,view,equal} from './local_complex_records.mjs';
import {locateCell} from './local_cell_text_box_layout.mjs';
import {textBoxGeometry} from './local_text_box_geometry.mjs';
import {captureRenderedLayout,contains} from './local_rendered_layout.mjs';
import {publishVerifiedPatch} from './local_verified_patch.mjs';
import {invalidateSectionLayout} from './local_layout_cache.mjs';
import {reanchorFloating} from './local_floating_anchor.mjs';
import {padded,placementFree,placementCandidates} from './local_floating_space.mjs';
import {textBoxHeightEstimator} from './local_layout.mjs';

export function placeCellFloating(HwpDocument,source,state,t,clearance){
 const box=t.selected,path=t.b.cell_path,rs=state.recordSets.get(t.b.section);
 if(path.length!==1)fail('PLACEMENT_CELL_NESTED_ANCHOR_UNVERIFIED');
 if(!box.paragraphs||!textBoxGeometry(state,box)||t.flow.vertRelTo!==2||t.flow.horzRelTo!==2||path.at(-1).cellParaIndex!==0||t.flow.textWrap!==3)fail('PLACEMENT_CELL_PROFILE_UNSUPPORTED');
 const list=rs[box.record_index+2];if(list?.tag!==72||list.payload.length!==33||list.payload.subarray(8).some(n=>n!==0)||textBoxHeightEstimator(state)(box)>box.properties.height)fail('PLACEMENT_CELL_CONTENT_FRAME_UNVERIFIED');
 const table=state.tables.find(a=>a.section===t.b.section&&a.paragraph===t.b.paragraph&&equal(a.cell_path,path.slice(0,-1))&&a.control===path.at(-1).controlIndex),cell=table?.cells.find(c=>c.cell===path.at(-1).cellIndex);
 if(!cell||cell.rowSpan!==1||cell.colSpan!==1||(view(rs[cell.start].payload).getUint32(4,true)&0x67)!==0)fail('PLACEMENT_CELL_PROFILE_UNSUPPORTED');
 const stripped=reanchorFloating(state,t,null),baseline=captureRenderedLayout(HwpDocument,publishVerifiedPatch(source,state,t.b.section,stripped.records)),actual=captureRenderedLayout(HwpDocument,source);
 let checks=0;const tick=()=>{if(++checks>200000)fail('PLACEMENT_OBSTACLE_LIMIT');},base=locateCell(state,box,baseline,tick),current=locateCell(state,box,actual,tick);
 if(!base||!current||base.page.page!==current.page.page||!contains(base.page.body,base.root_frame)||base.page.limitations.some(l=>!['INLINE_CONTROL_RENDER_PLANE_DISAGREEMENT','NESTED_TABLE_PAGINATION_UNVERIFIED'].includes(l.code)))fail('PLACEMENT_CELL_LAYOUT_UNVERIFIED');
 const full=[box.section,box.paragraph,...path.flatMap(p=>[p.controlIndex,p.cellIndex,p.cellParaIndex]),t.control_index];
 const locate=(at)=>{const candidates=at.page.controls.filter(c=>c.type==='shape'&&c.controlIdx===t.control_index&&Math.abs(c.w-box.properties.width/75)<2&&Math.abs(c.h-box.properties.height/75)<2&&(equal(c.stableIndex,full)||contains(at.cell,c,2)));if(candidates.length!==1)fail('FLOATING_LAYOUT_IDENTITY_UNVERIFIED');return candidates[0];};
 const old=locate(current),hp=view(rs[cell.start].payload),pads=['Left','Right','Top','Bottom'].map((k,i)=>Math.max(table.properties['padding'+k],hp.getUint16(24+i*2,true))/75),frame={x:base.cell.x+pads[0],y:base.cell.y+pads[2],w:base.cell.w-pads[0]-pads[1],h:base.cell.h-pads[2]-pads[3]},padding={l:t.flow.marginLeft/75,r:t.flow.marginRight/75,top:t.flow.marginTop/75,bottom:t.flow.marginBottom/75},original=padded(old,padding),gap=clearance/75;
 const others=[...base.page.body_runs.filter(r=>r.text?.trim()),...base.page.fixed_runs,...base.page.controls.filter(c=>c!==base.root_frame)];if(others.length>512)fail('PLACEMENT_OBSTACLE_LIMIT');
 if(placementFree(original,frame,others,gap))return {bytes:source,content_verified:true,raw_preservation_verified:true,unchanged:true,floating_state_preserved:true,layout_verified:false};
 for(const candidate of placementCandidates(original,[frame],others,gap).slice(0,8)){
  const props={...box.properties,horzOffset:box.properties.horzOffset+Math.round((candidate.x-original.x)*75),vertOffset:box.properties.vertOffset+Math.round((candidate.y-original.y)*75)};if(Math.abs(props.horzOffset)>720000||Math.abs(props.vertOffset)>720000)continue;
  const payload=rs[box.record_index].payload.slice();view(payload).setInt32(12,props.horzOffset,true);view(payload).setInt32(8,props.vertOffset,true);
  const records=invalidateSectionLayout(rs.map((r,i)=>i===box.record_index?{...r,payload}:r),state.blocks.filter(b=>b.section===t.b.section)),bytes=publishVerifiedPatch(source,state,t.b.section,records),after=captureRenderedLayout(HwpDocument,bytes),at=locateCell(state,box,after,tick);if(!at||at.page.page!==base.page.page||!contains(base.cell,at.cell,2)||!contains(at.cell,base.cell,2))continue;
  let moved;try{moved=locate(at);}catch(error){if(!error.code)throw error;continue;}
  if(!placementFree(padded(moved,padding),frame,others,gap))continue;
  return {bytes,content_verified:true,raw_preservation_verified:true,layout_verified:false,text_box_changed:true,floating_state_preserved:true,placement:{page:at.page.page,cell_path:path,clearance,before:{x:old.x,y:old.y},after:{x:moved.x,y:moved.y},properties:props,engine_checked:true,cell_bounds_basis:'layout_without_selected_object',native_layout_verified:false},raw_preservation_scope:'selected_floating_offsets_and_mapped_line_caches; cell_geometry_anchor_flow_text_styles_subtree_and_other_streams_exact'};
 }
 fail('NO_FLOATING_PLACEMENT_SPACE');
}
