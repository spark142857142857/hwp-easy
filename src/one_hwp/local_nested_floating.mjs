/** Place nested rectangles in HWP reference coordinates, preserving raw flow. */
import {fail,view} from './local_complex_records.mjs';
import {nestedFloatingObject} from './local_nested_object.mjs';
import {captureRenderedLayout,contains} from './local_rendered_layout.mjs';
import {reanchorFloating} from './local_floating_anchor.mjs';
import {publishVerifiedPatch} from './local_verified_patch.mjs';
import {invalidateSectionLayout} from './local_layout_cache.mjs';
import {textBoxHeightEstimator,textHeight} from './local_layout.mjs';
import {projectNestedAnchor,nestedTextBand} from './local_nested_anchor.mjs';
import {padded,placementFree,placementCandidates} from './local_floating_space.mjs';

export function placeNestedFloating(HwpDocument,source,state,t,clearance,preserveOverlap=false){
 const box=nestedFloatingObject(state,t.selected),rs=state.recordSets.get(t.b.section),f=t.flow;
 if(box.paragraphs){const list=rs[box.record_index+2];if(list?.tag!==72||list.payload.length!==33||list.payload.subarray(8).some(n=>n)||textBoxHeightEstimator(state)(box)>box.properties.height)fail('PLACEMENT_CELL_CONTENT_FRAME_UNVERIFIED');}
 const root=state.blocks.find(b=>b.section===box.section&&b.paragraph===box.paragraph&&!b.cell_path.length);
 const siblings=[...state.text_boxes,...state.groups,...state.pictures].filter(b=>b!==t.selected&&b.section===box.section&&state.blocks.find(p=>p.id===b.block_id)?.paragraph===box.paragraph).map(b=>nestedFloatingObject(state,b));
 if(rs.slice(root.record_index,root.records_end).filter(r=>r.tag===71&&Buffer.from(r.payload.subarray(0,4)).toString()===' osg').length!==siblings.length+1)fail('NESTED_PLACEMENT_OTHER_FLOATING_OBJECT_UNVERIFIED');
 const stripped=reanchorFloating(state,t,null),baseline=captureRenderedLayout(HwpDocument,publishVerifiedPatch(source,state,t.b.section,stripped.records)),projection=projectNestedAnchor(state,box,baseline),band=nestedTextBand(state,box,projection,textHeight,new Set([box,...siblings].map(o=>o.record_index))),page=baseline.pages[projection.page],padding={l:f.marginLeft/75,r:f.marginRight/75,top:f.marginTop/75,bottom:f.marginBottom/75},original=padded(projection.rect,padding),gap=clearance/75;
 const siblingRects=siblings.map(b=>{if(!b.cell_path.length)fail('NESTED_PLACEMENT_OTHER_FLOATING_OBJECT_UNVERIFIED');const p=projectNestedAnchor(state,b,baseline);if(p.page!==projection.page)fail('NESTED_PLACEMENT_OTHER_FLOATING_OBJECT_UNVERIFIED');return padded(p.rect,{l:b.flow.marginLeft/75,r:b.flow.marginRight/75,top:b.flow.marginTop/75,bottom:b.flow.marginBottom/75});});
 const ancestors=projection.composed_frames??new Set(projection.lineage.map(l=>l.frame)),others=[...(band.h?[band]:[]),...siblingRects,...page.body_runs.filter(r=>r.text?.trim()&&r.parentParaIdx==null&&r.cellIdx==null),...page.fixed_runs,...page.controls.filter(c=>!ancestors.has(c)&&c.cellIdx==null)];if(others.length>512)fail('PLACEMENT_OBSTACLE_LIMIT');
 const result=(bytes,extra={})=>({bytes,content_verified:true,raw_preservation_verified:true,layout_verified:false,floating_state_preserved:true,...extra});
 if(preserveOverlap&&contains(projection.frame,original))return result(source,{unchanged:true,existing_overlap_preserved:true});
 if(placementFree(original,projection.frame,others,gap))return result(source,{unchanged:true});
 for(const candidate of placementCandidates(original,[projection.frame],others,gap).slice(0,8)){
  const props={...box.properties,horzOffset:Math.round((candidate.x+padding.l-projection.anchor.x)*75),vertOffset:Math.round((candidate.y+padding.top-projection.anchor.y)*75)};if(Math.abs(props.horzOffset)>720000||Math.abs(props.vertOffset)>720000)continue;
  const payload=rs[box.record_index].payload.slice();view(payload).setInt32(12,props.horzOffset,true);view(payload).setInt32(8,props.vertOffset,true);const records=invalidateSectionLayout(rs.map((r,i)=>i===box.record_index?{...r,payload}:r),state.blocks.filter(b=>b.section===box.section)),bytes=publishVerifiedPatch(source,state,box.section,records);
  // Only offsets and mapped caches changed. In-front-of-text floating content
  // does not participate in native table height. Core's cell-local plane does,
  // so establish both raw-reference rectangles on the stripped baseline.
  const after=projectNestedAnchor(state,{...box,properties:props},baseline);
  if(after.page!==projection.page||!contains(projection.cell,after.cell,1)||!contains(after.cell,projection.cell,1)||!placementFree(padded(after.rect,padding),after.frame,others,gap))continue;
  return result(bytes,{text_box_changed:Boolean(box.paragraphs),picture_group_changed:Boolean(box.pictures),picture_changed:box.picture_index!==undefined,placement:{page:after.page,cell_bounds_basis:'layout_without_selected_object',cell_path:box.cell_path,clearance,before:projection.rect,after:after.rect,properties:props,coordinate_basis:'hwp_column_and_root_paragraph_reference',projected_cell:after.cell,projected_frame:after.frame,inline_prefix_tolerance:after.prefix_tolerance,engine_checked:false,raw_hierarchy_checked:true,native_layout_verified:false,engine_limitations:['NESTED_FLOATING_RENDER_ORIGIN_DISAGREEMENT']},raw_preservation_scope:'selected_nested_floating_offsets_and_mapped_line_caches; raw_anchor_flow_cell_table_geometry_text_styles_images_matrices_other_controls_and_streams_exact'});
 }
 fail('NO_FLOATING_PLACEMENT_SPACE');
}
