/** Cell display bounds are observations, never stored minimum-height clipping proof. */
import {GuardError} from '../../probes/sites-runtime/guard/records.mjs';
import {view,fail} from './local_complex_records.mjs';
import {layoutObjectIdentity} from './local_layout_identity.mjs';
import {textBoxGeometry} from './local_text_box_geometry.mjs';
import {captureRenderedLayout,contains,intersects} from './local_rendered_layout.mjs';
import {projectNestedAnchor,nestedTextBand} from './local_nested_anchor.mjs';
import {locateCell} from './local_cell_frame.mjs';
export {locateCell} from './local_cell_frame.mjs';
const same=(a,b)=>JSON.stringify(a)===JSON.stringify(b);

export function diagnoseCellTextBoxes(state,{HwpDocument,bytes,snapshot:provided,estimateHeight,estimateParagraphHeight,estimateCellHeight,estimateTableHeight,getContainer},add){
 const boxes=(state.text_boxes??[]).filter(b=>b.cell_path.length),limitations=[];let checks=0,checked=0;
 const result=()=>({status:!boxes.length?'not_applicable':limitations.length?'inconclusive':'checked_supported_profiles',checks,checked_boxes:checked,total_boxes:boxes.length,limitations,native_layout_verified:false});
 if(!boxes.length)return result();
 const limit=(code,box)=>{limitations.push({code,...(box?{text_box_id:box.id,section:box.section,cell_path:box.cell_path}:{})});};
 if(boxes.length>128){limit('CELL_TEXT_BOX_DIAGNOSTIC_LIMIT');return result();}
 let snapshot;try{snapshot=provided??(HwpDocument&&bytes?captureRenderedLayout(HwpDocument,bytes):null);}catch(error){if(!(error instanceof GuardError))throw error;limit(error.code);return result();}
 if(!snapshot){limit('CELL_TEXT_BOX_RENDER_NOT_AVAILABLE');return result();}
 const tick=()=>{if(++checks>200000)fail('CELL_TEXT_BOX_DIAGNOSTIC_LIMIT');};
 try{for(const box of boxes){
  const host=state.blocks.find(b=>b.id===box.block_id),container=host&&getContainer(host),f=box.flow,p=box.properties,identity=layoutObjectIdentity(state,box),rs=state.recordSets.get(box.section);
  const issue=(code,size,available,certainty,extra={})=>add(code,host,size,available,certainty,{text_box_id:box.id,object_identity:identity,...extra});
  if(!host||!container) {limit('CELL_TEXT_BOX_CONTAINER_UNVERIFIED',box);continue;}
  const list=rs[box.record_index+2],plainMetrics=list?.tag===72&&list.payload.length===33&&list.payload.subarray(8).every(n=>n===0),estimate=plainMetrics?estimateHeight(box):p.height;
  if(!plainMetrics)limit('CELL_TEXT_BOX_INTERNAL_METRICS_UNVERIFIED',box);
  if(estimate>p.height)issue('CELL_TEXT_BOX_CONTENT_MAY_EXCEED_FRAME_HEIGHT',estimate,p.height,'font_estimate');
  const cellFlags=view(rs[container.cell.start].payload).getUint32(4,true);
  if(!textBoxGeometry(state,box)||f.vertRelTo!==2||f.horzRelTo!==2||(cellFlags&7)!==0){limit('CELL_TEXT_BOX_ANCHOR_OR_FRAME_UNVERIFIED',box);continue;}
  {let projected,band;try{projected=projectNestedAnchor(state,box,snapshot);if(estimateParagraphHeight)band=nestedTextBand(state,box,projected,estimateParagraphHeight);}catch(error){if(!(error instanceof GuardError))throw error;projected=null;limit(error.code,box);}
   if(projected){checked++;limit('NESTED_FLOATING_RENDER_ORIGIN_DISAGREEMENT',box);const rect={...projected.rect,h:Math.max(projected.rect.h,estimate/75)},frame=projected.frame,extra={page:projected.page,basis:'hwp_column_and_root_paragraph_reference_with_measured_inline_prefix'};
    for(const [code,amount]of [['LEFT',frame.x-rect.x],['RIGHT',rect.x+rect.w-frame.x-frame.w],['TOP',frame.y-rect.y],['BOTTOM',rect.y+rect.h-frame.y-frame.h]])if(amount>.5)issue('CELL_TEXT_BOX_PROJECTED_'+code+'_BOUNDARY',Math.ceil(amount*75),0,'font_estimate',extra);
    if(band?.h&&intersects(rect,band))issue('CELL_TEXT_BOX_PROJECTED_CELL_TEXT_INTERSECTION',Math.ceil((Math.min(rect.y+rect.h,band.y+band.h)-Math.max(rect.y,band.y))*75),0,'font_estimate',extra);
    continue;
   }
  }
  if(box.cell_path.at(-1).cellParaIndex!==0){limit('CELL_TEXT_BOX_ANCHOR_OR_FRAME_UNVERIFIED',box);continue;}
  const at=locateCell(state,box,snapshot,tick);if(!at){limit('CELL_TEXT_BOX_RENDER_IDENTITY_UNVERIFIED',box);continue;}
  for(const l of at.page.limitations)if(!limitations.some(x=>x.code===l.code&&x.page===l.page))limitations.push(l);
  const paddingX=(container.cell.width-container.width)/75,paddingY=(container.cell.height-container.height)/75;
  // A first paragraph's top/left anchored rectangle must remain uniquely
  // attributable even when the renderer omits its recursive stableIndex.
  const full=[box.section,box.paragraph,...box.cell_path.flatMap(s=>[s.controlIndex,s.cellIndex,s.cellParaIndex]),box.control_index];
  const candidates=at.page.controls.filter(c=>{tick();return c.type==='shape'&&c.controlIdx===box.control_index&&Math.abs(c.w-p.width/75)<2&&Math.abs(c.h-p.height/75)<2&&(same(c.stableIndex,full)||c.x>=at.cell.x+Math.min(0,p.horzOffset/75)-2&&c.x<=at.cell.x+paddingX+p.horzOffset/75+2&&Math.abs(c.y-at.cell.y-p.vertOffset/75)<=paddingY+2);});
  if(candidates.length!==1){limit('CELL_TEXT_BOX_RENDER_IDENTITY_UNVERIFIED',box);continue;}
  const frame=candidates[0],effective={...frame,h:Math.max(frame.h,estimate/75)},below=Math.max(0,frame.y+frame.h-(at.cell.y+at.cell.h)),above=Math.max(0,at.cell.y-frame.y);
  checked++;
  if(below>.5)issue('CELL_TEXT_BOX_EXCEEDS_RENDERED_CELL_BOTTOM',Math.ceil(below*75),0,'engine_render',{page:at.page.page});
  if(above>.5)issue('CELL_TEXT_BOX_EXCEEDS_RENDERED_CELL_TOP',Math.ceil(above*75),0,'engine_render',{page:at.page.page});
  // The renderer may enlarge a cell around an out-of-flow shape while Hancom
  // leaves it floating. Compare with normal text/nested-table flow as a risk
  // estimate too; never equate the stored minimum row height with clipping.
  const flowHeight=estimateCellHeight(container),flowExtent=Math.ceil((effective.y-at.cell.y+effective.h)*75);
  if(flowHeight>0&&flowExtent>flowHeight+38)issue('CELL_TEXT_BOX_MAY_EXCEED_FLOW_CELL_HEIGHT',flowExtent,flowHeight,'font_estimate',{page:at.page.page,basis:'font_estimated_normal_cell_content_excluding_floating_boxes'});
  if(effective.h>frame.h&&effective.y+effective.h>at.cell.y+at.cell.h+.5)issue('CELL_TEXT_BOX_CONTENT_MAY_EXCEED_CELL_HEIGHT',Math.ceil((effective.y+effective.h-at.cell.y)*75),Math.ceil(at.cell.h*75),'font_estimate',{page:at.page.page});
  const flowDelta=Math.max(0,at.root_frame.h-estimateTableHeight(at.root_table)/75);
  const seen=new Set();for(const r of at.page.body_runs){tick();if(r.parentParaIdx!=null||r.cellIdx!=null||!r.text?.trim())continue;
   // If only the engine grows the floating object's table, following body
   // lines may be lifted in another viewer. This is a font-based risk model,
   // not a reconstructed native coordinate or a verified intersection.
   const current=intersects(effective,r),projected=!current&&flowDelta>.5&&r.secIdx===box.section&&r.paraIdx>box.paragraph&&r.y>=at.root_frame.y+at.root_frame.h-.5?{...r,y:r.y-flowDelta}:null,otherRect=current?r:projected;
   if(!otherRect||!intersects(effective,otherRect))continue;
   const other=state.blocks.find(b=>b.section===r.secIdx&&b.paragraph===r.paraIdx&&!b.cell_path.length);if(!other||seen.has(other.id))continue;seen.add(other.id);
   const actual=current&&intersects(frame,r),height=Math.min(effective.y+effective.h,otherRect.y+otherRect.h)-Math.max(effective.y,otherRect.y);
   issue(projected?'CELL_TEXT_BOX_MAY_OVERLAP_FLOW_BODY_TEXT':actual?'CELL_TEXT_BOX_BODY_TEXT_INTERSECTION':'CELL_TEXT_BOX_CONTENT_MAY_OVERLAP_BODY_TEXT',Math.ceil(height*75),0,actual?'engine_render':'font_estimate',{page:at.page.page,related_block_id:other.id,other_section:r.secIdx,other_paragraph:r.paraIdx,...(projected?{basis:'font_estimated_normal_table_flow_not_native_coordinates'}:{})});
  }
 }}catch(error){if(!(error instanceof GuardError))throw error;limit(error.code);}
 return result();
}
