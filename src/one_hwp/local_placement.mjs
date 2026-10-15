/** Selected floating placement and section-bottom protection, without flattening. */
import {parseRecords} from '../../probes/sites-runtime/guard/records.mjs';
import {inspectLocalComplex} from './local_complex.mjs';
import {standardBlockId} from './local_complex_table.mjs';
import {fail,view,equalBytes,textTokens} from './local_complex_records.mjs';
import {objectFlow} from './local_flow_records.mjs';
import {captureRenderedLayout,contains,intersects} from './local_rendered_layout.mjs';
import {pageProperties,sameProperties} from './local_page_state.mjs';
import {definitionBytes} from './local_complex_format.mjs';
import {publishVerifiedPatch} from './local_verified_patch.mjs';
import {invalidateSectionLayout} from './local_reflow.mjs';

const outcome=(bytes,extra={})=>({bytes,content_verified:true,raw_preservation_verified:true,layout_verified:false,...extra});
function decode(target,version){if(typeof target!=='string'||!target.startsWith(`hwp5:${version}:`))fail('VERSION_CONFLICT');const x=target.slice(70),id=Buffer.from(x,'base64url').toString();if(!id||Buffer.from(id).toString('base64url')!==x)fail('INVALID_TARGET');return id;}
function targetObject(state,id,pictureIndex){
 const group=state.groups.find(g=>g.id===id),box=state.text_boxes.find(g=>g.id===id),b=state.blocks.find(b=>b.id===(group?.block_id??box?.block_id??id)||standardBlockId(b)===id);if(!b?.text_mapping_verified||b.cell_path.length)fail('BODY_FLOATING_OBJECT_REQUIRED');
 const pics=state.pictures.filter(p=>p.block_id===b.id),selected=group??box??(pictureIndex!==undefined?pics.find(p=>p.picture_index===pictureIndex):pics.length===1?pics[0]:null);if(!selected)fail('FLOATING_OBJECT_TARGET_REQUIRED');
 if((group||box)&&pictureIndex!==undefined||pictureIndex!==undefined&&!Number.isSafeInteger(pictureIndex))fail('INVALID_OPERATION');
 const records=state.recordSets.get(b.section),flow=objectFlow(records[selected.record_index]);if(flow.treatAsChar||flow.widthRelTo!==4||flow.heightRelTo!==2||flow.vertAlign!==0||flow.horzAlign!==0||flow.vertRelTo>2)fail('FLOATING_ANCHOR_PROFILE_UNSUPPORTED');
 const control_index=records.slice(b.record_index+1,selected.record_index+1).filter(r=>r.tag===71&&r.level===b.raw_level+1).length-1;
 return {selected,b,flow,control_index};
}
const matches=(c,t)=>c.secIdx===t.b.section&&c.paraIdx===t.b.paragraph&&c.controlIdx===t.control_index;
function located(snapshot,t){const found=snapshot.pages.flatMap(p=>p.controls.filter(c=>matches(c,t)).map(c=>({page:p,rect:c})));if(found.length!==1)fail('FLOATING_LAYOUT_IDENTITY_UNVERIFIED');const {rect}=found[0];if(Math.abs(rect.w-t.selected.properties.width/75)>2||Math.abs(rect.h-t.selected.properties.height/75)>2)fail('FLOATING_FRAME_UNVERIFIED');return found[0];}
function lineBoxes(runs){const result=new Map();for(const r of runs){const key=JSON.stringify([r.secIdx,r.paraIdx,r.parentParaIdx,r.controlIdx,r.cellIdx,r.cellParaIdx,r.cellPath,Math.round(r.y*10)]),old=result.get(key);if(!old)result.set(key,{x:r.x,y:r.y,w:r.w,h:r.h});else{const right=Math.max(old.x+old.w,r.x+r.w),bottom=Math.max(old.y+old.h,r.y+r.h);old.x=Math.min(old.x,r.x);old.y=Math.min(old.y,r.y);old.w=right-old.x;old.h=bottom-old.y;}}return [...result.values()];}
function obstacles(page,t){const runs=page.body_runs.filter(r=>!(r.secIdx===t.b.section&&r.parentParaIdx===t.b.paragraph&&r.controlIdx===t.control_index)),rects=[...lineBoxes(runs),...lineBoxes(page.fixed_runs),...page.controls.filter(c=>!matches(c,t))];if(rects.length>512)fail('PLACEMENT_OBSTACLE_LIMIT');return rects;}
const free=(rect,body,others,gap)=>contains({x:body.x+gap,y:body.y+gap,w:body.w-gap*2,h:body.h-gap*2},rect)&&!others.some(o=>intersects(rect,o,gap));
export function placementLocal(HwpDocument,source,version,op){
 const state=inspectLocalComplex(HwpDocument,source,{includeDocumentInfo:false,verifyCharacterModel:false});
 if(op.type==='protect_page_bottom')return protectBottom(HwpDocument,source,version,state,op);
 const allowed=['type','target_id','expected_old','expected_properties','expected_flow','picture_index','clearance'];if(op.type!=='reposition_floating_object'||Object.keys(op).some(k=>!allowed.includes(k))||['type','target_id','expected_old','expected_properties','expected_flow'].some(k=>!Object.hasOwn(op,k)))fail('INVALID_OPERATION');
 const t=targetObject(state,decode(op.target_id,version),op.picture_index);if(t.b.text!==op.expected_old)fail('EXPECTED_OLD_MISMATCH');if(!sameProperties(op.expected_properties,t.selected.properties)||!sameProperties(op.expected_flow,t.flow))fail('EXPECTED_OBJECT_FLOW_MISMATCH');
 const clearance=op.clearance??900;if(!Number.isSafeInteger(clearance)||clearance<0||clearance>7200)fail('INVALID_CLEARANCE');const gap=clearance/75;
 const before=captureRenderedLayout(HwpDocument,source),at=located(before,t);if(at.page.limitations.length)fail('PLACEMENT_PAGINATION_UNVERIFIED');
 const rs=state.recordSets.get(t.b.section),defs=rs.filter(r=>r.tag===73);if(defs.length!==1||pageProperties(defs[0]).attributes!==0)fail('PLACEMENT_PAGE_PROFILE_UNSUPPORTED');if(rs.some(r=>r.tag===71&&Buffer.from(r.payload.subarray(0,4)).toString()==='dloc'&&(r.payload.length<6||((view(r.payload).getUint16(4,true)>>>2)&255)!==1)))fail('PLACEMENT_MULTI_COLUMN_UNSUPPORTED');
 const padding={l:t.flow.marginLeft/75,r:t.flow.marginRight/75,top:t.flow.marginTop/75,bottom:t.flow.marginBottom/75},original={x:at.rect.x-padding.l,y:at.rect.y-padding.top,w:at.rect.w+padding.l+padding.r,h:at.rect.h+padding.top+padding.bottom},others=obstacles(at.page,t),body=at.page.body;
 if(free(original,body,others,gap))return outcome(source,{unchanged:true,floating_state_preserved:true});
 const axis=(values,from,lo,hi)=>[...new Set(values.filter(Number.isFinite).map(v=>Math.max(lo,Math.min(hi,v))))].sort((a,b)=>Math.abs(a-from)-Math.abs(b-from)).slice(0,24);
 if(original.w+2*gap>body.w||original.h+2*gap>body.h)fail('NO_FLOATING_PLACEMENT_SPACE');
 const xs=axis([original.x,body.x+gap,body.x+body.w-original.w-gap,...others.flatMap(o=>[o.x+o.w+gap,o.x-original.w-gap])],original.x,body.x+gap,body.x+body.w-original.w-gap),ys=axis([original.y,body.y+gap,body.y+body.h-original.h-gap,...others.flatMap(o=>[o.y+o.h+gap,o.y-original.h-gap])],original.y,body.y+gap,body.y+body.h-original.h-gap),candidates=xs.flatMap(x=>ys.map(y=>({...original,x,y}))).filter(r=>free(r,body,others,gap)).sort((a,b)=>Math.hypot(a.x-original.x,a.y-original.y)-Math.hypot(b.x-original.x,b.y-original.y));
 for(const candidate of candidates.slice(0,8)){
  const dx=Math.round((candidate.x-original.x)*75),dy=Math.round((candidate.y-original.y)*75),props={...t.selected.properties,horzOffset:t.selected.properties.horzOffset+dx,vertOffset:t.selected.properties.vertOffset+dy};if(Math.abs(props.horzOffset)>720000||Math.abs(props.vertOffset)>720000)continue;
  const payload=rs[t.selected.record_index].payload.slice();view(payload).setInt32(12,props.horzOffset,true);view(payload).setInt32(8,props.vertOffset,true);let records=rs.map((r,i)=>i===t.selected.record_index?{...r,payload}:r);records=invalidateSectionLayout(records,state.blocks.filter(b=>b.section===t.b.section));
  const bytes=publishVerifiedPatch(source,state,t.b.section,records),after=captureRenderedLayout(HwpDocument,bytes);let moved;try{moved=located(after,t);}catch(e){if(!e.code)throw e;continue;}
  const rect={x:moved.rect.x-padding.l,y:moved.rect.y-padding.top,w:moved.rect.w+padding.l+padding.r,h:moved.rect.h+padding.top+padding.bottom};
  if(moved.page.page!==at.page.page||moved.page.limitations.length||!free(rect,moved.page.body,obstacles(moved.page,t),gap))continue;
  return outcome(bytes,{floating_state_preserved:true,picture_group_changed:Boolean(t.selected.pictures),picture_changed:!t.selected.pictures&&!t.selected.paragraphs,text_box_changed:Boolean(t.selected.paragraphs),placement:{page:at.page.page,clearance,before:{x:at.rect.x,y:at.rect.y},after:{x:moved.rect.x,y:moved.rect.y},properties:props,engine_checked:true,native_layout_verified:false},raw_preservation_scope:'selected_floating_offsets_and_mapped_section_line_caches; anchor_wrap_size_images_matrices_controls_and_other_streams_exact'});
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
 let protectedRects=[];if(selected.length){const snapshot=captureRenderedLayout(HwpDocument,source);for(const value of selected){const t=targetObject(state,decode(value,version));if(t.b.section!==b.section||t.flow.vertRelTo>1||t.flow.restrictInPage)fail('PAGE_FIXED_OBJECT_REQUIRED');const at=located(snapshot,t);if(at.page.limitations.some(l=>l.code!=='FIXED_FOOTER_SPACING_NOT_MODELED'))fail('PLACEMENT_PAGINATION_UNVERIFIED');wanted=Math.max(wanted,Math.ceil(page.height-page.marginBottom-at.rect.y*75+clearance));protectedRects.push({target:t,page:at.page.page,rect:at.rect});}}
 wanted=Math.max(page.marginFooter,wanted);if(wanted===page.marginFooter)return outcome(source,{unchanged:true,footer_position_preserved:true});if(page.height-page.marginTop-page.marginHeader-page.marginBottom-wanted<7200)fail('FOOTER_RESERVE_TOO_LARGE');
 const delta=wanted-page.marginFooter,rawRecords=rs.map(r=>r===pages[0]?{...r,payload:r.payload.slice()}:r);view(rawRecords[rs.indexOf(pages[0])].payload).setUint32(28,wanted,true);
 const compensated=footerCompensation(state,rawRecords,delta),mapped=compensated.records;
 // Footer cache removal changes record indices: remap body header identities before clearing.
 const bodyBlocks=state.blocks.filter(x=>x.section===b.section).map(x=>{const original=rs[x.record_index],at=mapped.findIndex(r=>r===original);if(at<0)fail('PAGE_BODY_MAPPING_UNVERIFIED');let stop=at+1;while(stop<mapped.length&&mapped[stop].level>mapped[at].level)stop++;return {...x,record_index:at,records_end:stop};});
 const records=invalidateSectionLayout(mapped,bodyBlocks),bytes=publishVerifiedPatch(source,state,b.section,records,compensated.docInfo);
 if(protectedRects.length){const after=captureRenderedLayout(HwpDocument,bytes);for(const old of protectedRects){const at=located(after,old.target);if(at.page.page!==old.page||['x','y','w','h'].some(k=>Math.abs(at.rect[k]-old.rect[k])>.5))fail('FIXED_OBJECT_POSITION_CHANGED');}}
 return outcome(bytes,{page_layout_changed:true,footer_position_preserved:true,footer_compensation_count:compensated.footers,page_protection:{section:b.section,previous_footer_height:page.marginFooter,footer_height:wanted,protected_objects:selected.length,body_height:page.height-page.marginTop-page.marginHeader-page.marginBottom-wanted},raw_preservation_scope:'page_footer_reserve_compensating_footer_spacing_and_line_caches; footer_text_character_styles_fixed_object_geometry_and_other_streams_exact'});
}
