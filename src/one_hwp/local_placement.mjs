/** Selected floating placement and section-bottom protection, without flattening. */
import {parseRecords} from '../../probes/sites-runtime/guard/records.mjs';
import {inspectLocalComplex} from './local_complex.mjs';
import {standardBlockId} from './local_complex_table.mjs';
import {fail,view,equalBytes,textTokens} from './local_complex_records.mjs';
import {objectFlow} from './local_flow_records.mjs';
import {captureRenderedLayout,contains} from './local_rendered_layout.mjs';
import {pageProperties,sameProperties} from './local_page_state.mjs';
import {definitionBytes} from './local_complex_format.mjs';
import {publishVerifiedPatch,publishVerifiedSections} from './local_verified_patch.mjs';
import {invalidateSectionLayout} from './local_reflow.mjs';
import {reanchorFloating,floatingTargetRemap} from './local_floating_anchor.mjs';
import {placeCellFloating} from './local_floating_cell.mjs';
import {padded,placementFree,placementCandidates} from './local_floating_space.mjs';

const outcome=(bytes,extra={})=>({bytes,content_verified:true,raw_preservation_verified:true,layout_verified:false,...extra});
const paginationUncertain=l=>!['INLINE_CONTROL_RENDER_PLANE_DISAGREEMENT','NESTED_TABLE_PAGINATION_UNVERIFIED'].includes(l.code);
const bottomPaginationUncertain=l=>!['INLINE_CONTROL_RENDER_PLANE_DISAGREEMENT','FIXED_FOOTER_SPACING_NOT_MODELED'].includes(l.code);
function decode(target,version){if(typeof target!=='string'||!target.startsWith(`hwp5:${version}:`))fail('VERSION_CONFLICT');const x=target.slice(70),id=Buffer.from(x,'base64url').toString();if(!id||Buffer.from(id).toString('base64url')!==x)fail('INVALID_TARGET');return id;}
function targetObject(state,id,pictureIndex,allowCell=false){
 const group=state.groups.find(g=>g.id===id),box=state.text_boxes.find(g=>g.id===id),opaque=state.opaque_drawings.find(g=>g.id===id),b=state.blocks.find(b=>b.id===(group?.block_id??box?.block_id??opaque?.block_id??id)||standardBlockId(b)===id);if(!b?.text_mapping_verified||b.cell_path.length&&!allowCell)fail('BODY_FLOATING_OBJECT_REQUIRED');
 const pics=state.pictures.filter(p=>p.block_id===b.id),selected=group??box??opaque??(pictureIndex!==undefined?pics.find(p=>p.picture_index===pictureIndex):pics.length===1?pics[0]:null);if(!selected)fail('FLOATING_OBJECT_TARGET_REQUIRED');
 if((group||box||opaque)&&pictureIndex!==undefined||pictureIndex!==undefined&&!Number.isSafeInteger(pictureIndex))fail('INVALID_OPERATION');
 const records=state.recordSets.get(b.section),flow=objectFlow(records[selected.record_index]);if(flow.treatAsChar||flow.widthRelTo!==4||flow.heightRelTo!==2||flow.vertAlign!==0||flow.horzAlign!==0||flow.vertRelTo>2)fail('FLOATING_ANCHOR_PROFILE_UNSUPPORTED');
 const control_index=records.slice(b.record_index+1,selected.record_index+1).filter(r=>r.tag===71&&r.level===b.raw_level+1).length-1;
 return {selected,b,flow,control_index};
}
const matches=(c,t)=>c.secIdx===t.b.section&&c.paraIdx===t.b.paragraph&&c.controlIdx===t.control_index&&c.cellIdx==null&&c.parentParaIdx==null;
function located(snapshot,t){const found=snapshot.pages.flatMap(p=>p.controls.filter(c=>matches(c,t)).map(c=>({page:p,rect:c})));if(found.length!==1)fail('FLOATING_LAYOUT_IDENTITY_UNVERIFIED');const {rect}=found[0];if(Math.abs(rect.w-t.selected.properties.width/75)>2||Math.abs(rect.h-t.selected.properties.height/75)>2)fail('FLOATING_FRAME_UNVERIFIED');return found[0];}
function lineBoxes(runs){const result=new Map();for(const r of runs){const key=JSON.stringify([r.secIdx,r.paraIdx,r.parentParaIdx,r.controlIdx,r.cellIdx,r.cellParaIdx,r.cellPath,Math.round(r.y*10)]),old=result.get(key);if(!old)result.set(key,{x:r.x,y:r.y,w:r.w,h:r.h});else{const right=Math.max(old.x+old.w,r.x+r.w),bottom=Math.max(old.y+old.h,r.y+r.h);old.x=Math.min(old.x,r.x);old.y=Math.min(old.y,r.y);old.w=right-old.x;old.h=bottom-old.y;}}return [...result.values()];}
function obstacles(page,t){const runs=page.body_runs.filter(r=>!(r.secIdx===t.b.section&&r.parentParaIdx===t.b.paragraph&&r.controlIdx===t.control_index)),rects=[...lineBoxes(runs),...lineBoxes(page.fixed_runs),...page.controls.filter(c=>!matches(c,t))];if(rects.length>512)fail('PLACEMENT_OBSTACLE_LIMIT');return rects;}
function columnFrames(state,t,page,column){
 const rs=state.recordSets.get(t.b.section),defs=rs.filter(r=>r.tag===71&&Buffer.from(r.payload.subarray(0,4)).toString()==='dloc');
 if(defs.length!==1||defs[0].payload.length<8)fail('PLACEMENT_COLUMN_PROFILE_UNSUPPORTED');
 const flags=view(defs[0].payload).getUint16(4,true),count=(flags>>>2)&255,cols=page.info.columns;
 if(!count||count>8||(flags&0xc03)!==0||!Array.isArray(cols)||cols.length!==count)fail('PLACEMENT_COLUMN_LAYOUT_UNVERIFIED');
 if(column!==undefined&&(!Number.isSafeInteger(column)||column<0||column>=count))fail('INVALID_PLACEMENT_COLUMN');
 const frames=cols.map(c=>({x:c.x,y:page.body.y,w:c.width,h:page.body.h}));
 if(frames.some((f,i)=>!Number.isFinite(f.x)||!Number.isFinite(f.w)||f.w<=0||!contains(page.body,f)||i&&frames[i-1].x+frames[i-1].w>f.x+.5))fail('PLACEMENT_COLUMN_LAYOUT_UNVERIFIED');
 if(flags&0x1000){const spacing=view(defs[0].payload).getUint16(6,true)/75,width=(page.body.w-spacing*(count-1))/count;if(frames.some((f,i)=>Math.abs(f.w-width)>1||Math.abs(f.x-(page.body.x+i*(width+spacing)))>1))fail('PLACEMENT_COLUMN_LAYOUT_UNVERIFIED');}
 else{
  const raw=defs[0].payload;if(count<2||raw.length!==14+count*4)fail('PLACEMENT_COLUMN_LAYOUT_UNVERIFIED');const v=view(raw),weights=Array.from({length:count},(_,i)=>({w:v.getInt16(8+i*4,true),gap:v.getInt16(10+i*4,true)}));
  if(weights.some(c=>c.w<=0||c.gap<0)||weights.at(-1).gap!==0||weights.reduce((n,c)=>n+c.w+c.gap,0)!==32768)fail('PLACEMENT_COLUMN_LAYOUT_UNVERIFIED');
  let x=page.body.x;for(const [i,c]of weights.entries()){if(Math.abs(frames[i].x-x)>1||Math.abs(frames[i].w-page.body.w*c.w/32768)>1)fail('PLACEMENT_COLUMN_LAYOUT_UNVERIFIED');x+=page.body.w*(c.w+c.gap)/32768;}
 }
 return column===undefined?frames:[frames[column]];
}
export function placementLocal(HwpDocument,source,version,op){
 const state=inspectLocalComplex(HwpDocument,source,{includeDocumentInfo:false,verifyCharacterModel:false});
 if(op.type==='protect_page_bottom')return protectBottom(HwpDocument,source,version,state,op);
 const allowed=['type','target_id','expected_old','expected_properties','expected_flow','picture_index','clearance','destination_target_id','expected_destination','destination_column','overlap_policy'];if(op.type!=='reposition_floating_object'||Object.keys(op).some(k=>!allowed.includes(k))||['type','target_id','expected_old','expected_properties','expected_flow'].some(k=>!Object.hasOwn(op,k))||Object.hasOwn(op,'destination_target_id')!==Object.hasOwn(op,'expected_destination'))fail('INVALID_OPERATION');
 if(op.overlap_policy!==undefined&&!['avoid','preserve_existing'].includes(op.overlap_policy))fail('INVALID_OVERLAP_POLICY');const preserveOverlap=op.overlap_policy==='preserve_existing';
 const t=targetObject(state,decode(op.target_id,version),op.picture_index,true);if(t.b.text!==op.expected_old)fail('EXPECTED_OLD_MISMATCH');if(!sameProperties(op.expected_properties,t.selected.properties)||!sameProperties(op.expected_flow,t.flow))fail('EXPECTED_OBJECT_FLOW_MISMATCH');
 const clearance=op.clearance??900;if(!Number.isSafeInteger(clearance)||clearance<0||clearance>7200)fail('INVALID_CLEARANCE');const gap=clearance/75;
 const destination=op.destination_target_id===undefined?t.b:state.blocks.find(b=>b.id===decode(op.destination_target_id,version)||standardBlockId(b)===decode(op.destination_target_id,version));
 if(!destination?.text_mapping_verified)fail('PLACEMENT_DESTINATION_UNVERIFIED');if(op.destination_target_id!==undefined&&destination.text!==op.expected_destination)fail('EXPECTED_DESTINATION_MISMATCH');
 if(preserveOverlap&&destination.id!==t.b.id)fail('PLACEMENT_OVERLAP_PRESERVATION_REQUIRES_SAME_ANCHOR');
 if(destination.cell_path.length&&op.destination_column!==undefined)fail('INVALID_PLACEMENT_COLUMN');
 if(t.b.cell_path.length&&destination.id===t.b.id)return placeCellFloating(HwpDocument,source,state,t,clearance,preserveOverlap);
 const before=captureRenderedLayout(HwpDocument,source),originalAt=t.b.cell_path.length?null:located(before,t),rs=state.recordSets.get(t.b.section),defs=rs.filter(r=>r.tag===73);if(defs.length!==1||pageProperties(defs[0]).attributes!==0)fail('PLACEMENT_PAGE_PROFILE_UNSUPPORTED');
 const anchored=reanchorFloating(state,t,destination),reanchored=Boolean(anchored.remap);let baseSource=source,baseState=state,baseT=t,baseRecords=rs;
 if(reanchored){baseSource=publishVerifiedSections(source,state,anchored.recordSets);baseState=inspectLocalComplex(HwpDocument,baseSource,{includeDocumentInfo:false,verifyCharacterModel:false});baseRecords=baseState.recordSets.get(destination.section);const index=anchored.recordSets.get(destination.section).indexOf(anchored.selected_record),key=t.selected.paragraphs?'text_boxes':t.selected.pictures?'groups':t.selected.contents_read_only?'opaque_drawings':'pictures',selected=baseState[key].find(o=>o.section===destination.section&&o.record_index===index);if(!selected)fail('PLACEMENT_IDENTITY_REMAP_UNVERIFIED');baseT=targetObject(baseState,selected.id??selected.block_id,selected.picture_index,true);const pages=baseRecords.filter(r=>r.tag===73);if(pages.length!==1||pageProperties(pages[0]).attributes!==0)fail('PLACEMENT_PAGE_PROFILE_UNSUPPORTED');}
 const remap=reanchored?floatingTargetRemap(state,baseState,anchored.recordSets,state.recordSets,t.selected,anchored.selected_record,anchored.origins):null;
 if(baseT.b.cell_path.length){const result=placeCellFloating(HwpDocument,baseSource,baseState,baseT,clearance);return {...result,unchanged:false,structure_changed:true,_target_remap:remap,raw_preservation_scope:'selected_floating_offsets_anchor_and_subtree_levels_host_text_style_indices_and_line_caches; visible_text_styles_flow_geometry_other_controls_and_streams_exact'};}
 const at=located(reanchored?captureRenderedLayout(HwpDocument,baseSource):before,baseT);if(at.page.limitations.some(paginationUncertain))fail('PLACEMENT_PAGINATION_UNVERIFIED');
 const frames=columnFrames(baseState,baseT,at.page,op.destination_column),padding={l:t.flow.marginLeft/75,r:t.flow.marginRight/75,top:t.flow.marginTop/75,bottom:t.flow.marginBottom/75},original=padded(at.rect,padding),others=obstacles(at.page,baseT);
 if(preserveOverlap&&frames.some(frame=>contains(frame,original)))return outcome(source,{unchanged:true,floating_state_preserved:true,existing_overlap_preserved:true});
 const alreadyFree=frames.some(frame=>placementFree(original,frame,others,gap));if(alreadyFree&&!reanchored)return outcome(source,{unchanged:true,floating_state_preserved:true});
 const candidates=alreadyFree?[original]:placementCandidates(original,frames,others,gap);
 for(const candidate of candidates.slice(0,8)){
  const props={...t.selected.properties,horzOffset:t.selected.properties.horzOffset+Math.round((candidate.x-original.x)*75),vertOffset:t.selected.properties.vertOffset+Math.round((candidate.y-original.y)*75)};if(Math.abs(props.horzOffset)>720000||Math.abs(props.vertOffset)>720000)continue;
  const payload=baseRecords[baseT.selected.record_index].payload.slice();view(payload).setInt32(12,props.horzOffset,true);view(payload).setInt32(8,props.vertOffset,true);const selectedRecord={...baseRecords[baseT.selected.record_index],payload},records=invalidateSectionLayout(baseRecords.map((r,i)=>i===baseT.selected.record_index?selectedRecord:r),baseState.blocks.filter(b=>b.section===baseT.b.section));
  const bytes=publishVerifiedPatch(baseSource,baseState,baseT.b.section,records),after=captureRenderedLayout(HwpDocument,bytes);let moved;try{moved=located(after,baseT);}catch(e){if(!e.code)throw e;continue;}
  if(moved.page.page!==at.page.page||moved.page.limitations.some(paginationUncertain)||!columnFrames(baseState,baseT,moved.page,op.destination_column).some(frame=>placementFree(padded(moved.rect,padding),frame,obstacles(moved.page,baseT),gap)))continue;
  return outcome(bytes,{...(remap?{_target_remap:remap,structure_changed:true,...(!t.selected.id?{_relocated_picture_hosts:[t.b.id,standardBlockId(t.b)]}:{} )}:{}),floating_state_preserved:true,picture_group_changed:Boolean(t.selected.pictures),picture_changed:!t.selected.contents_read_only&&!t.selected.pictures&&!t.selected.paragraphs,opaque_drawing_moved:Boolean(t.selected.contents_read_only),text_box_changed:Boolean(t.selected.paragraphs),placement:{page:at.page.page,previous_page:originalAt?.page.page??null,clearance,...(op.destination_column!==undefined?{column:op.destination_column}:{}),before:originalAt?{x:originalAt.rect.x,y:originalAt.rect.y}:null,after:{x:moved.rect.x,y:moved.rect.y},properties:props,engine_checked:true,engine_limitations:at.page.limitations.map(l=>l.code),native_layout_verified:false},raw_preservation_scope:'selected_floating_offsets_optional_anchor_subtree_levels_host_text_style_indices_and_mapped_line_caches; flow_size_images_matrices_other_controls_and_streams_exact'});
 }
 fail('NO_FLOATING_PLACEMENT_SPACE');
}

function footerCompensation(state,rs,delta){
 const stream=state.raw.streams.get('DocInfo'),defs=[...parseRecords(stream)],shapes=defs.filter(r=>r.tag===25),maps=defs.filter(r=>r.tag===17),replacements=new Map(),additions=new Map(),newShapes=[],headerChanges=new Map(),remove=new Set();let footers=0;
 if(maps.length!==1||maps[0].payload.length<56||view(maps[0].payload).getUint32(52,true)!==shapes.length)fail('FORMAT_DEFINITION_MISMATCH');
 for(let i=0;i<rs.length;i++){
  const r=rs[i];if(r.tag!==71||r.level!==1||Buffer.from(r.payload.subarray(0,4)).toString()!=='toof')continue;footers++;let end=i+1;while(end<rs.length&&rs[end].level>r.level)end++;
  const inside=rs.slice(i+1,end),heads=inside.filter(x=>x.tag===66);if(!heads.length||inside.some(x=>![66,67,68,69,72].includes(x.tag))||inside.filter(x=>x.tag===72).some(x=>x.payload.length<8||(view(x.payload).getUint32(4,true)&7)!==0))fail('FOOTER_COMPENSATION_PROFILE_UNSUPPORTED');
  for(const h of heads){if(h.payload.length<22||h.payload[11]!==0||view(h.payload).getUint16(14,true)!==0)fail('FOOTER_COMPENSATION_PROFILE_UNSUPPORTED');const at=rs.indexOf(h);let stop=at+1;while(stop<end&&rs[stop].level>h.level)stop++;
   for(let j=at+1;j<stop;j++){if(rs[j].tag===67&&textTokens(rs[j].payload).some(t=>!t.text&&t.code!==13))fail('FOOTER_COMPENSATION_PROFILE_UNSUPPORTED');if(rs[j].tag===69)remove.add(j);}
   const bytes=h.payload.slice();view(bytes).setUint16(16,0,true);headerChanges.set(at,bytes);
  }
  const first=heads[0],old=shapes[view(first.payload).getUint16(8,true)];if(!old||![46,54,58].includes(old.payload.length)||(view(old.payload).getUint32(0,true)&((1<<19)|(1<<29))))fail('FOOTER_COMPENSATION_PROFILE_UNSUPPORTED');
  const wanted=old.payload.slice(),value=view(wanted).getInt32(16,true)+delta*2;if(value<0||value>720000)fail('FOOTER_COMPENSATION_PROFILE_UNSUPPORTED');view(wanted).setInt32(16,value,true);
  let id=[...shapes.map(r=>r.payload),...newShapes].findIndex(p=>equalBytes(p,wanted));if(id<0){id=shapes.length+newShapes.length;if(id>=65535)fail('FORMAT_DEFINITION_MISMATCH');newShapes.push(wanted);}
  view(headerChanges.get(rs.indexOf(first))).setUint16(8,id,true);i=end-1;
 }
 if(newShapes.length){const map=maps[0].payload.slice();view(map).setUint32(52,shapes.length+newShapes.length,true);replacements.set(maps[0].index,map);additions.set(shapes.at(-1).index,newShapes.map(payload=>({tag:25,level:shapes.at(-1).level,payload})));}
 return {docInfo:definitionBytes(stream,defs,replacements,additions),records:rs.flatMap((r,i)=>remove.has(i)?[]:[headerChanges.has(i)?{...r,payload:headerChanges.get(i)}:r]),footers};
}
function protectBottom(HwpDocument,source,version,state,op){
 const allowed=['type','target_id','expected_old','expected_page','minimum_footer_height','protected_objects','clearance'];if(Object.keys(op).some(k=>!allowed.includes(k))||['type','target_id','expected_old','expected_page'].some(k=>!Object.hasOwn(op,k)))fail('INVALID_OPERATION');
 const id=decode(op.target_id,version),b=state.blocks.find(b=>b.id===id||standardBlockId(b)===id);if(!b?.text_mapping_verified)fail('PARAGRAPH_TARGET_REQUIRED');if(b.text!==op.expected_old)fail('EXPECTED_OLD_MISMATCH');const rs=state.recordSets.get(b.section),pages=rs.filter(r=>r.tag===73);if(pages.length!==1)fail('PAGE_PROFILE_UNSUPPORTED');const page=pageProperties(pages[0]);if(!sameProperties(op.expected_page,page))fail('EXPECTED_PAGE_MISMATCH');if(page.attributes!==0)fail('PAGE_PROFILE_UNSUPPORTED');
 let wanted=op.minimum_footer_height??page.marginFooter;if(!Number.isSafeInteger(wanted)||wanted<0||wanted>720000)fail('INVALID_FOOTER_HEIGHT');
 const selected=op.protected_objects??[];if(!Array.isArray(selected)||selected.length>16||new Set(selected).size!==selected.length||!selected.length&&!Object.hasOwn(op,'minimum_footer_height'))fail('INVALID_PROTECTED_OBJECTS');const clearance=op.clearance??900;if(!Number.isSafeInteger(clearance)||clearance<0||clearance>7200)fail('INVALID_CLEARANCE');
 let protectedRects=[];if(selected.length){const snapshot=captureRenderedLayout(HwpDocument,source);for(const value of selected){const t=targetObject(state,decode(value,version));if(t.b.section!==b.section||t.flow.vertRelTo>1||t.flow.restrictInPage)fail('PAGE_FIXED_OBJECT_REQUIRED');const at=located(snapshot,t);if(at.page.limitations.some(bottomPaginationUncertain))fail('PLACEMENT_PAGINATION_UNVERIFIED');wanted=Math.max(wanted,Math.ceil(page.height-page.marginBottom-at.rect.y*75+clearance));protectedRects.push({target:t,page:at.page.page,rect:at.rect});}}
 wanted=Math.max(page.marginFooter,wanted);if(wanted===page.marginFooter)return outcome(source,{unchanged:true,footer_position_preserved:true});if(page.height-page.marginTop-page.marginHeader-page.marginBottom-wanted<7200)fail('FOOTER_RESERVE_TOO_LARGE');
 const delta=wanted-page.marginFooter,rawRecords=rs.map(r=>r===pages[0]?{...r,payload:r.payload.slice()}:r);view(rawRecords[rs.indexOf(pages[0])].payload).setUint32(28,wanted,true);
 const compensated=footerCompensation(state,rawRecords,delta),mapped=compensated.records;
 // Footer cache removal changes record indices: remap body header identities before clearing.
 const bodyBlocks=state.blocks.filter(x=>x.section===b.section).map(x=>{const original=rs[x.record_index],at=mapped.findIndex(r=>r===original);if(at<0)fail('PAGE_BODY_MAPPING_UNVERIFIED');let stop=at+1;while(stop<mapped.length&&mapped[stop].level>mapped[at].level)stop++;return {...x,record_index:at,records_end:stop};});
 const records=invalidateSectionLayout(mapped,bodyBlocks),bytes=publishVerifiedPatch(source,state,b.section,records,compensated.docInfo);
 if(protectedRects.length){const after=captureRenderedLayout(HwpDocument,bytes);for(const old of protectedRects){const at=located(after,old.target);if(at.page.page!==old.page||['x','y','w','h'].some(k=>Math.abs(at.rect[k]-old.rect[k])>.5))fail('FIXED_OBJECT_POSITION_CHANGED');}}
 return outcome(bytes,{page_layout_changed:true,footer_position_preserved:true,footer_compensation_count:compensated.footers,page_protection:{section:b.section,previous_footer_height:page.marginFooter,footer_height:wanted,protected_objects:selected.length,body_height:page.height-page.marginTop-page.marginHeader-page.marginBottom-wanted},raw_preservation_scope:'page_footer_reserve_compensating_footer_spacing_and_line_caches; footer_text_character_styles_fixed_object_geometry_and_other_streams_exact'});
}
