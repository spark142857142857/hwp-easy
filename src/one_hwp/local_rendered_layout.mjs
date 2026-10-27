import {createNaturalTextMeasurer} from './local_font_measure.mjs';
/** Bounded WASM observations. Pagination disagreement is not native clipping proof. */
import {fail} from './local_complex_records.mjs';
import {readHwp} from '../../probes/sites-runtime/guard/container.mjs';
import {parseRecords} from '../../probes/sites-runtime/guard/records.mjs';
import {view} from './local_complex_records.mjs';
import {openLocalRenderView} from './local_render_view.mjs';
export const intersects=(a,b,gap=0)=>Math.min(a.x+a.w+gap,b.x+b.w)-Math.max(a.x-gap,b.x)>.5&&Math.min(a.y+a.h+gap,b.y+b.h)-Math.max(a.y-gap,b.y)>.5;
export const contains=(outer,b,epsilon=.5)=>b.x>=outer.x-epsilon&&b.y>=outer.y-epsilon&&b.x+b.w<=outer.x+outer.w+epsilon&&b.y+b.h<=outer.y+outer.h+epsilon;
const rootRun=r=>r.parentParaIdx==null&&r.cellIdx==null;
const finiteBox=r=>['x','y','w','h'].every(k=>Number.isFinite(r[k]))&&r.w>=0&&r.h>=0;
function footerSpacingSections(bytes){
 const raw=readHwp(bytes),shapes=[...parseRecords(raw.streams.get('DocInfo'))].filter(r=>r.tag===25),sections=new Set();
 for(const [name,value]of raw.streams){if(!/^BodyText\/Section\d+$/.test(name))continue;const rs=[...parseRecords(value)];for(let i=0;i<rs.length;i++){const r=rs[i];if(r.tag!==71||Buffer.from(r.payload.subarray(0,4)).toString()!=='toof')continue;for(let j=i+1;j<rs.length&&rs[j].level>r.level;j++){const h=rs[j];if(h.tag!==66)continue;const shape=shapes[view(h.payload).getUint16(8,true)];if(shape&&shape.payload.length>=20&&view(shape.payload).getInt32(16,true)!==0)sections.add(Number(name.slice(16)));break;}}}return sections;
}
function rawLayoutProfiles(bytes){
 const raw=readHwp(bytes),inline=new Set(),nested=new Set();
 for(const [name,value]of raw.streams){if(!/^BodyText\/Section\d+$/.test(name))continue;const section=Number(name.slice(16));let paragraph=-1,control=0;
  for(const r of parseRecords(value)){if(r.tag===66&&r.level===0){paragraph++;control=0;}if(r.tag!==71)continue;
   const id=Buffer.from(r.payload.subarray(0,4)).toString();if(id===' lbt'&&r.level>1)nested.add(section);
   if(r.level===1){if([' lbt',' osg'].includes(id)&&r.payload.length>=8&&(view(r.payload).getUint32(4,true)&1))inline.add(`${section}:${paragraph}:${control}`);control++;}
  }
 }return {inline,nested};
}
export function captureRenderedLayout(HwpDocument,bytes){
 const renderView=openLocalRenderView(HwpDocument,bytes),doc=renderView.document;try{
  const count=doc.pageCount();if(count>32)fail('RENDERED_LAYOUT_PAGE_LIMIT');const spacedFooters=footerSpacingSections(bytes),profiles=rawLayoutProfiles(bytes),starts=Array.from({length:count},(_,p)=>JSON.parse(doc.getPositionOfPage(p))),pages=[];let total=0;
  for(let page=0;page<count;page++){
   const info=JSON.parse(doc.getPageInfo(page)),runs=JSON.parse(doc.getPageTextLayout(page)).runs.map(r=>renderView.remap(r,page)).filter(r=>!r.render_only_synthetic),controls=JSON.parse(doc.getPageControlLayout(page)).controls.map(r=>renderView.remap(r,page));
   total+=runs.length+controls.length;if(total>20000)fail('RENDERED_LAYOUT_ITEM_LIMIT');if([...runs,...controls].some(r=>!finiteBox(r)))fail('RENDERED_LAYOUT_PROFILE_UNSUPPORTED');
   const body={x:info.bodyLeft,y:info.marginTop+info.marginHeader,w:info.bodyRight-info.bodyLeft,h:info.height-info.marginTop-info.marginHeader-info.marginBottom-info.marginFooter},fixed_runs=[],body_runs=[],limitations=[];let suppressed=0,synthetic=0;
   for(const r of runs){
    if(rootRun(r)&&r.text===' '&&r.charStart===0&&renderView.anchors.some(a=>a.section===r.secIdx&&a.paragraph===r.paraIdx)){synthetic++;continue;}
    // UINT32_MAX identities belong to fixed header/footer text, not body paragraphs.
    if(!Number.isSafeInteger(r.paraIdx)||r.paraIdx>=0xfffffff0){fixed_runs.push(r);continue;}
    if(rootRun(r)){
     let owner=0;for(let p=1;p<starts.length;p++){const s=starts[p];if(s.ok&&s.sec===r.secIdx&&(s.para<r.paraIdx||s.para===r.paraIdx&&s.charOffset<=(r.charStart??0)))owner=p;}
     if(owner>page){suppressed++;continue;}
    }
    body_runs.push(r);
   }
   if(suppressed)limitations.push({code:'PAGINATION_RENDER_MEMBERSHIP_DISAGREEMENT',page,suppressed_runs:suppressed});
   if(profiles.nested.has(info.sectionIndex))limitations.push({code:'NESTED_TABLE_PAGINATION_UNVERIFIED',page,section:info.sectionIndex});
   const inlineControls=new Set();for(const c of controls)if(c.cellPath==null&&c.parentParaIdx==null&&profiles.inline.has(`${c.secIdx}:${c.paraIdx}:${c.controlIdx}`))inlineControls.add(c);
   const mismatched=[...inlineControls].filter(c=>c.plane!==0);if(mismatched.length)limitations.push({code:'INLINE_CONTROL_RENDER_PLANE_DISAGREEMENT',page,controls:mismatched.length});
   if(spacedFooters.has(info.sectionIndex)&&fixed_runs.length&&!renderView.flow_adaptations?.some(a=>a.kind==='fixed_footer_flow'&&a.page===page))limitations.push({code:'FIXED_FOOTER_SPACING_NOT_MODELED',page,section:info.sectionIndex});
   for(const [items,code] of [[renderView.anchors,'EMPTY_FLOATING_ANCHOR_RENDER_ADAPTED'],[renderView.unadapted,'EMPTY_FLOATING_ANCHOR_RENDER_UNVERIFIED']]){const selected=items.filter(a=>a.section===info.sectionIndex);if(selected.length)limitations.push({code,page,section:info.sectionIndex,anchors:selected});}
   if(renderView.cell_wraps.length)limitations.push({code:'CELL_WRAP_RENDER_ADAPTED',page,cells:renderView.cell_wraps});
   if(renderView.nested_tables.length)limitations.push({code:'NESTED_TABLE_RENDER_ADAPTED',page,tables:renderView.nested_tables});
   const drawings=renderView.drawing_adaptations?.filter(a=>a.page===page)??[];
   if(drawings.length)limitations.push({code:'DRAWING_TEXT_RENDER_ADAPTED',page,drawings});
   const uncertain=new Set();for(const r of body_runs){
    if(!rootRun(r)||contains(body,r))continue;const key=`${r.secIdx}:${r.paraIdx}`;if(uncertain.has(key))continue;
    const text=doc.getTextRange(r.secIdx,r.paraIdx,0,doc.getParagraphLength(r.secIdx,r.paraIdx));
    if(text.includes('\n')){uncertain.add(key);limitations.push({code:'MULTILINE_PARAGRAPH_PAGINATION_UNVERIFIED',page,section:r.secIdx,paragraph:r.paraIdx});}
   }
   pages.push({page,info,body,body_runs,fixed_runs,controls,inline_controls:inlineControls,limitations,uncertain_paragraphs:uncertain,text_runs:runs.length-synthetic});
 }return {pages,page_count:count,render_unadapted_drawings:renderView.unadapted_drawings,render_flow_adaptations:renderView.flow_adaptations??[],render_adaptations:renderView.anchors,render_unadapted_anchors:renderView.unadapted,render_nested_tables:renderView.nested_tables,render_unadapted_tables:renderView.unadapted_tables,render_cell_wraps:renderView.cell_wraps,render_unadapted_cells:renderView.unadapted_cells,measureInlineText:createNaturalTextMeasurer(HwpDocument,bytes,{prefixProof:true})};
 }finally{doc.free();}
}
export {createNaturalTextMeasurer} from './local_font_measure.mjs';
export function analyzeRenderedLayout(HwpDocument,bytes){
 const snapshot=captureRenderedLayout(HwpDocument,bytes),issues=[],pages=[],limitations=[];let checks=0;
 // An unchanged unsupported render profile adds reporting uncertainty. It
 // must not invalidate the independent raw-grid proof used by F1 placement.
 // Adapted views still carry a per-page limitation and are refused by F1.
 if(snapshot.render_unadapted_drawings.length)limitations.push({code:'DRAWING_TEXT_RENDER_UNVERIFIED',drawings:snapshot.render_unadapted_drawings});
 if(snapshot.render_unadapted_tables.length)limitations.push({code:'NESTED_TABLE_RENDER_UNVERIFIED',tables:snapshot.render_unadapted_tables});
 if(snapshot.render_unadapted_cells.length)limitations.push({code:'CELL_WRAP_RENDER_UNVERIFIED',cells:snapshot.render_unadapted_cells});
 const tick=()=>{if(++checks>200000)fail('RENDERED_LAYOUT_CHECK_LIMIT');};
 for(const p of snapshot.pages){const {page,body,body_runs:runs,controls,fixed_runs}=p;limitations.push(...p.limitations);
  const floats=controls.filter(c=>['group','image','picture','shape'].includes(c.type)&&c.plane!==0&&!p.inline_controls.has(c));
  const add=(code,c,other)=>{if(issues.length>=2000)fail('RENDERED_LAYOUT_ISSUE_LIMIT');issues.push({code,page,section:c.secIdx,paragraph:c.paraIdx,control:c.controlIdx,certainty:'engine_render',bounds:{x:c.x,y:c.y,width:c.w,height:c.h},...(other?{other_section:other.secIdx,other_paragraph:other.paraIdx,other_control:other.controlIdx}:{} )});};
  for(const c of floats){tick();if(!contains(body,c))add('FLOATING_OBJECT_OUTSIDE_BODY',c);
   for(const r of runs){if(r.parentParaIdx===c.paraIdx&&r.controlIdx===c.controlIdx&&r.secIdx===c.secIdx)continue;tick();if(intersects(c,r)){add('FLOATING_OBJECT_TEXT_INTERSECTION',c,r);break;}}
   for(const f of fixed_runs){tick();if(intersects(c,f)){add('FLOATING_OBJECT_FIXED_TEXT_INTERSECTION',c,f);break;}}
  }
  for(let i=0;i<floats.length;i++)for(let j=i+1;j<floats.length;j++){tick();if(intersects(floats[i],floats[j]))add('FLOATING_OBJECT_INTERSECTION',floats[i],floats[j]);}
  const sorted=runs.filter(rootRun).filter(r=>!p.uncertain_paragraphs.has(`${r.secIdx}:${r.paraIdx}`)).sort((a,b)=>a.y-b.y);
  for(let i=0;i<sorted.length;i++)for(let j=i+1;j<sorted.length&&sorted[j].y<sorted[i].y+sorted[i].h-.5;j++){const a=sorted[i],b=sorted[j];tick();if((a.secIdx!==b.secIdx||a.paraIdx!==b.paraIdx||a.charStart!==b.charStart)&&Math.abs(a.y-b.y)>.5&&intersects(a,b))add('TEXT_LINE_INTERSECTION',a,b);}
  for(const r of sorted){tick();if(r.y+r.h>body.y+body.h+.5)add('TEXT_EXCEEDS_BODY_HEIGHT',r);for(const f of fixed_runs){tick();if(intersects(r,f)){add('BODY_FIXED_TEXT_INTERSECTION',r,f);break;}}}
  const clippedCells=runs.filter(r=>!rootRun(r)&&!contains(body,r));if(clippedCells.length)limitations.push({code:'CELL_TEXT_OUTSIDE_BODY_PAGINATION_UNVERIFIED',page,runs:clippedCells.length});
  pages.push({page,section:p.info.sectionIndex,body,text_runs:p.text_runs,floating_objects:floats.length,fixed_regions:fixed_runs.map(r=>({kind:'header_footer_text',x:r.x,y:r.y,width:r.w,height:r.h}))});
 }
 return {status:issues.length?'issues_detected':limitations.length?'inconclusive':'no_checked_rendered_overlap',checks,issues,pages,page_count:snapshot.page_count,render_unadapted_drawings:snapshot.render_unadapted_drawings,render_flow_adaptations:snapshot.render_flow_adaptations,render_adaptations:snapshot.render_adaptations,render_unadapted_anchors:snapshot.render_unadapted_anchors,render_nested_tables:snapshot.render_nested_tables,render_unadapted_tables:snapshot.render_unadapted_tables,render_cell_wraps:snapshot.render_cell_wraps,render_unadapted_cells:snapshot.render_unadapted_cells,engine_limitations:limitations,diagnostics_complete:limitations.length===0,layout_verified:false,scope:'current disposable WASM render view with bounded nested-table origins and empty floating-anchor line heights, separate fixed text and pagination uncertainty; up to 32 pages and 20000 items',not_checked:['native Hancom layout','font substitution','opaque drawing outlines','intentional overlap versus accidental overlap'],font_substitution_possible:true};
}
