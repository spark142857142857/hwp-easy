/** Opt-in, bounded WASM layout diagnostics. Host fonts and native layout can differ. */
import {fail} from './local_complex_records.mjs';
const intersects=(a,b)=>Math.min(a.x+a.w,b.x+b.w)-Math.max(a.x,b.x)>.5&&Math.min(a.y+a.h,b.y+b.h)-Math.max(a.y,b.y)>.5;
export function analyzeRenderedLayout(HwpDocument,bytes){
 const doc=new HwpDocument(bytes);try{
  const count=doc.pageCount();if(count>32)fail('RENDERED_LAYOUT_PAGE_LIMIT');const issues=[],pages=[];let checks=0,total=0;
  for(let page=0;page<count;page++){
   const info=JSON.parse(doc.getPageInfo(page)),runs=JSON.parse(doc.getPageTextLayout(page)).runs,controls=JSON.parse(doc.getPageControlLayout(page)).controls;
   total+=runs.length+controls.length;if(total>20000)fail('RENDERED_LAYOUT_ITEM_LIMIT');
   const body={x:info.bodyLeft,y:info.marginTop+info.marginHeader,w:info.bodyRight-info.bodyLeft,h:info.height-info.marginTop-info.marginHeader-info.marginBottom-info.marginFooter};
   const floats=controls.filter(c=>['group','image','picture','shape'].includes(c.type)&&c.plane!==0);
   const tick=()=>{if(++checks>200000)fail('RENDERED_LAYOUT_CHECK_LIMIT');};
   const add=(code,c,other)=>{if(issues.length>=2000)fail('RENDERED_LAYOUT_ISSUE_LIMIT');issues.push({code,page,section:c.secIdx,paragraph:c.paraIdx,control:c.controlIdx,certainty:'engine_render',bounds:{x:c.x,y:c.y,width:c.w,height:c.h},...(other?{other_section:other.secIdx,other_paragraph:other.paraIdx,other_control:other.controlIdx}:{} )});};
   for(const c of floats){tick();if(c.x<body.x-.5||c.y<body.y-.5||c.x+c.w>body.x+body.w+.5||c.y+c.h>body.y+body.h+.5)add('FLOATING_OBJECT_OUTSIDE_BODY',c);
    for(const r of runs){tick();if(intersects(c,r)){add('FLOATING_OBJECT_TEXT_INTERSECTION',c,r);break;}}
   }
   for(let i=0;i<floats.length;i++)for(let j=i+1;j<floats.length;j++){tick();if(intersects(floats[i],floats[j]))add('FLOATING_OBJECT_INTERSECTION',floats[i],floats[j]);}
   // Different paragraph lines, excluding intentional runs within the same line.
   const sorted=runs.filter(r=>r.parentParaIdx==null&&r.cellIdx==null).sort((a,b)=>a.y-b.y);
   for(let i=0;i<sorted.length;i++)for(let j=i+1;j<sorted.length&&sorted[j].y<sorted[i].y+sorted[i].h-.5;j++){const a=sorted[i],b=sorted[j];tick();if((a.secIdx!==b.secIdx||a.paraIdx!==b.paraIdx||a.charStart!==b.charStart)&&Math.abs(a.y-b.y)>.5&&intersects(a,b))add('TEXT_LINE_INTERSECTION',a,b);}
   for(const r of sorted){tick();if(r.y+r.h>body.y+body.h+.5)add('TEXT_EXCEEDS_BODY_HEIGHT',r);}
   pages.push({page,body,text_runs:runs.length,floating_objects:floats.length});
  }
  return {status:issues.length?'issues_detected':'no_checked_rendered_overlap',checks,issues,pages,page_count:count,layout_verified:false,scope:'current WASM rendered bounding boxes; up to 32 pages and 20000 text/control items',not_checked:['native Hancom layout','font substitution','opaque drawing outlines','unmapped header/footer objects','intentional overlap versus accidental overlap'],font_substitution_possible:true};
 }finally{doc.free();}
}
