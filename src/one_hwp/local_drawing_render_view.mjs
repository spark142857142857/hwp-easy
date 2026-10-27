/** Reflow grouped rectangle text horizontally in its transformed bounds.
 * This facade has no authoring/export methods. Source records stay immutable.
 */
import {GuardError} from '../../probes/sites-runtime/guard/records.mjs';
import {inspectLocalComplex} from './local_complex.mjs';
import {view,fail} from './local_complex_records.mjs';
import {composeAffine as mul,affineBounds} from './local_drawing_tree.mjs';
import {drawingRenderLimits} from './local_drawing_render_limits.mjs';
import {projectDrawingText} from './local_drawing_text_projection.mjs';
import {parseEngineSvg,drawingSvgPoints,svgPoint,svgMatrix,inverseAffine} from './local_svg_scene.mjs';
import {svgNamespace} from './local_svg_geometry.mjs';

const same=(a,b)=>JSON.stringify(a)===JSON.stringify(b);
const rotated=m=>Math.abs(m[1])>1e-6||Math.abs(m[3])>1e-6;
const corners=(m,w,h)=>[[0,0],[w,0],[w,h],[0,h]].map(([x,y])=>svgPoint(m,x,y));
const close=(a,b)=>a.every((p,i)=>p.every((v,j)=>Math.abs(v-b[i][j])<.16));
const stable=b=>[b.section,b.paragraph,...b.cell_path.flatMap(p=>[p.controlIndex,p.cellIndex,p.cellParaIndex])];
function oldOrigin(node,root,state){let p=state.drawing_tree.nodes.find(n=>n.id===node.parent_id);while(p?.parent_id){if(rotated(p.geometry.combined))return false;p=state.drawing_tree.nodes.find(n=>n.id===p.parent_id);}return true;}
function outerClip(node){let clip;for(let p=node.parent;p?.parent;p=p.parent)if(p.attrs['clip-path']||p.name==='svg')clip=p;return clip;}
function rootUnion(root){const boxes=root.children.map(n=>affineBounds(n.geometry.combined,n.geometry.width,n.geometry.height));if(!boxes.length)fail('DRAWING_RENDER_ROOT_UNVERIFIED');const x=Math.min(...boxes.map(b=>b.horzOffset)),y=Math.min(...boxes.map(b=>b.vertOffset)),w=Math.max(...boxes.map(b=>b.horzOffset+b.width))-x,h=Math.max(...boxes.map(b=>b.vertOffset+b.height))-y;if(w<1||h<1||![x,y,w,h].every(Number.isFinite))fail('DRAWING_RENDER_ROOT_UNVERIFIED');return {x,y,w,h};}
function projectedRuns(projection,box,root,m){return projection.runs.map(r=>{const p=box.paragraphs[r.cellParaIdx],quad=corners(m,r.w,r.h).map(([x,y])=>[x+m[0]*r.x+m[1]*r.y,y+m[3]*r.x+m[4]*r.y]),xs=quad.map(p=>p[0]),ys=quad.map(p=>p[1]);return {...r,x:Math.min(...xs),y:Math.min(...ys),w:Math.max(...xs)-Math.min(...xs),h:Math.max(...ys)-Math.min(...ys),secIdx:box.section,paraIdx:p.paragraph,parentParaIdx:root.paragraph,controlIdx:root.control_index,cellPath:box.cell_path,cellIdx:undefined,cellParaIdx:undefined,text_box_id:box.id,text_box_paragraph:p.paragraph,source_paragraph_id:p.id,drawing_node_id:box.drawing_node_id,render_drawing_text:true,drawing_transform:m,intrinsic_bounds:{x:r.x,y:r.y,w:r.w,h:r.h},quadrilateral:quad};});}

export function adaptDrawingRenderView(Doc,bytes,renderState){
 const limits=drawingRenderLimits(bytes);if(!limits.length)return {...renderState,unadapted_drawings:[],drawing_adaptations:[]};
 const base=renderState.document,pages=new Map(),notes=[],handled=new Set(),reasons=new Map();let state;
 if(base.pageCount()>32)fail('RENDER_DRAWING_PAGE_LIMIT');
 try{state=inspectLocalComplex(Doc,bytes,{includeDocumentInfo:false,verifyCharacterModel:false});}
 catch(error){if(!(error instanceof GuardError)||error.code.includes('LIMIT'))throw error;return {...renderState,unadapted_drawings:limits.map(l=>({...l,adaptation_reason:error.code})),drawing_adaptations:[]};}
 const roots=state.drawing_tree.groups.filter(n=>!n.parent_id&&!n.owner_box_id),projectionCache=new Map();let totalBytes=0;
 for(let page=0;page<base.pageCount();page++){
  const sourceControls=JSON.parse(base.getPageControlLayout(page)).controls,rawRuns=JSON.parse(base.getPageTextLayout(page)).runs,observed=sourceControls.map(c=>({raw:c,source:renderState.remap(c,page)})),rootInfos=[];
  for(const {raw,source:c}of observed.filter(c=>c.source.type==='group')){
   const exact=roots.filter(n=>{const b=state.blocks.find(b=>b.id===n.block_id);return same(c.stableIndex,[...stable(b),n.control_index]);});
   const candidates=exact.length?exact:roots.filter(n=>n.section===c.secIdx&&view(state.recordSets.get(n.section)[n.root.control_record].payload).getUint32(24,true)===c.zOrder&&Math.abs(n.root.properties.width/75-c.w)<.2&&Math.abs(n.root.properties.height/75-c.h)<.2);
   if(candidates.length!==1)continue;const root=candidates[0];if(rootInfos.some(r=>r.root===root))continue;
   const all=state.drawing_tree.nodes.filter(n=>n.section===root.section&&n.root.control_record===root.root.control_record&&!n.owner_box_id),selected=limits.filter(l=>l.section===root.section&&all.some(n=>n.shape_record===l.shape_record));
   if(!selected.length)continue;const f=root.root.flow,p=root.root.properties,destination={...c};
   if(f.vertRelTo===0&&f.vertAlign===0)destination.y=p.vertOffset/75;
   if(f.horzRelTo===0&&f.horzAlign===0)destination.x=p.horzOffset/75;
   destination.secIdx=root.section;destination.paraIdx=root.paragraph;destination.controlIdx=root.control_index;destination.stableIndex=[...stable(state.blocks.find(b=>b.id===root.block_id)),root.control_index];destination.render_drawing_control=true;
   rootInfos.push({root,raw,frame:c,destination,all,selected});
  }
  if(!rootInfos.length)continue;
  let svg,nodes;
  try{svg=base.renderPageSvg(page);nodes=parseEngineSvg(svg);}catch(error){if(!(error instanceof GuardError)||error.code.includes('LIMIT'))throw error;continue;}
  const candidates=nodes.map(node=>({node,points:drawingSvgPoints(node)})).filter(n=>n.points),bindings=[];
  // Bind every sibling rectangle in an affected root. Coincident frames are
  // assigned only when the complete candidate multiplicity agrees, in the
  // pinned renderer's control/child paint order; extra paths remain uncertain.
  for(const info of rootInfos)for(const node of info.all.filter(n=>n.kind==='cer$')){
   const g=node.geometry,useRoot=oldOrigin(node,info.root,state),kind=rotated(g.combined)?'path':'rect',matches=candidates.filter(({node:c,points})=>{
    if(c.name!==kind)return false;const origin=useRoot?svgPoint(inverseAffine(c.parentMatrix),info.frame.x,info.frame.y):[0,0],m=g.combined,expected=corners([m[0],m[1],0,m[3],m[4],0],g.width,g.height).map(([x,y])=>[origin[0]+Math.trunc(x+m[2])/75,origin[1]+Math.trunc(y+m[5])/75]);
    if(kind==='rect'){const x=Math.min(...expected.map(p=>p[0])),y=Math.min(...expected.map(p=>p[1])),w=Math.max(...expected.map(p=>p[0]))-x,h=Math.max(...expected.map(p=>p[1]))-y;return close(points,[[x,y],[x+w,y],[x+w,y+h],[x,y+h]]);}return close(points,expected);
   });bindings.push({info,node,matches});
  }
  const groups=new Map();for(const b of bindings){const key=JSON.stringify(b.matches.map(n=>n.node.start));if(!groups.has(key))groups.set(key,[]);groups.get(key).push(b);}
  for(const group of groups.values())if(group[0].matches.length===group.length)group.forEach((b,i)=>b.match=b.matches[i]);
  const replacements=[],added=[],removed=[],controlChanges=new Map();
  for(const info of rootInfos){
   try{
    if(info.root.read_only_reason||info.all.some(n=>n.text_box_id&&n.kind!=='cer$')||state.text_boxes.some(b=>b.owner_box_id&&b.section===info.root.section&&b.record_index>info.root.shape_record&&b.record_index<info.root.records_end))fail('DRAWING_TEXT_ROOT_PROFILE_UNVERIFIED');
    if(info.root.cell_path.length&&(info.root.root.flow.vertRelTo!==0||info.root.root.flow.horzRelTo!==0))fail('DRAWING_CELL_REFERENCE_UNVERIFIED');
    const union=rootUnion(info.root),sx=info.destination.w*75/union.w,sy=info.destination.h*75/union.h,patches=[],runs=[],oldRects=[],lifted=new Map();
    for(const binding of bindings.filter(b=>b.info===info)){
     const {node,match}=binding;if(!match)fail('DRAWING_SVG_IDENTITY_UNVERIFIED');const box=state.text_boxes.find(b=>b.id===node.text_box_id);if(!box&&limits.some(l=>l.section===node.section&&l.shape_record===node.shape_record))fail('DRAWING_TEXT_SOURCE_UNVERIFIED');
     const lift=outerClip(match.node);if(lift&&(info.root.root.flow.vertRelTo!==0||info.root.root.flow.horzRelTo!==0||info.frame.wrap!=='inFrontOfText'||info.all.some(n=>!['cer$','noc$'].includes(n.kind))))fail('DRAWING_CLIP_PROFILE_UNVERIFIED');
     const parentMatrix=lift?lift.parentMatrix:match.node.parentMatrix;
     const g=node.geometry,m=g.combined,global=[sx*m[0],sx*m[1],info.destination.x+sx*(m[2]-union.x)/75,sy*m[3],sy*m[4],info.destination.y+sy*(m[5]-union.y)/75],local=mul(inverseAffine(parentMatrix),global),points=corners(local,g.width/75,g.height/75),d=`M${points[0].join(' ')} ${points.slice(1).map(p=>'L'+p.join(' ')).join(' ')} Z`;
     let tag=svg.slice(match.node.start,match.node.end);if(match.node.name==='rect')tag=tag.replace(/^<rect\b/,'<path').replace(/\s(?:x|y|width|height|rx|ry)="[^"]*"/g,'').replace(/\/?>$/,` d="${d}"/>`);else tag=tag.replace(/\bd="[^"]*"/,`d="${d}"`);
     let stop=match.node.end;
     if(box){
      const bb=affineBounds(global,g.width/75,g.height/75),display={x:bb.horzOffset,y:bb.vertOffset,w:bb.width,h:bb.height},cacheKey=JSON.stringify([box.id,Math.round(display.w*75),Math.round(display.h*75)]);
      if(!projectionCache.has(cacheKey))projectionCache.set(cacheKey,projectDrawingText(Doc,bytes,state,node,box,display));const projection=projectionCache.get(cacheKey);
      const siblings=match.node.parent?.children??nodes.filter(n=>!n.parent),next=siblings[siblings.indexOf(match.node)+1];
      if(match.node.name==='rect'){
       if(next?.name!=='g'||!/#[-\w]*textbox-clip-/.test(next.attrs['clip-path']??''))fail('DRAWING_TEXT_CLIP_UNVERIFIED');
       if(svg.slice(stop,next.start).trim())fail('DRAWING_TEXT_CLIP_UNVERIFIED');stop=next.end;
       const old=match.points,x=Math.min(...old.map(p=>p[0])),y=Math.min(...old.map(p=>p[1])),w=Math.max(...old.map(p=>p[0]))-x,h=Math.max(...old.map(p=>p[1]))-y;
       oldRects.push({x,y,w,h,matrix:match.node.parentMatrix,box});
      }
      const fragment=svgNamespace(projection.fragment,`drawing-${page}-${node.section}-${node.shape_record}-`);totalBytes+=Buffer.byteLength(fragment);if(totalBytes>6*1024*1024)fail('RENDER_DRAWING_SVG_LIMIT');
      const textMatrix=[1,0,display.x,0,1,display.y];
      tag+=`<g data-hwp-drawing-text="${node.section}:${node.shape_record}" transform="${svgMatrix(mul(inverseAffine(parentMatrix),textMatrix))}">${fragment}</g>`;runs.push(...projectedRuns(projection,box,info.root,textMatrix));
     }
     patches.push({start:match.node.start,end:stop,text:lift?'':tag});
     if(lift)lifted.set(lift.end,(lifted.get(lift.end)??'')+tag);
    }
    for(const r of rawRuns){if(r.parentParaIdx==null||r.secIdx!==info.raw.secIdx||r.parentParaIdx!==info.raw.paraIdx||r.controlIdx!==info.raw.controlIdx)continue;
     const hit=oldRects.some(o=>{const [x,y]=svgPoint(inverseAffine(o.matrix),r.x,r.y);return x>=o.x-1&&x<o.x+o.w+1&&y>=o.y-1&&y<o.y+o.h+1&&o.box.paragraphs.some(p=>p.text.replaceAll('\n','').includes(r.text));});if(hit)removed.push(r);
    }
    replacements.push(...patches,...[...lifted].map(([at,text])=>({start:at,end:at,text})));added.push(...runs);controlChanges.set(info.raw,info.destination);for(const l of info.selected)handled.add(`${l.section}:${l.shape_record}`);
    notes.push({kind:'drawing_group_horizontal_text',page,section:info.root.section,root_id:info.root.id,rectangles:patches.length,text_boxes:info.all.filter(n=>n.text_box_id).length,source:'raw_text_lists_reflowed_in_transformed_horizontal_bounds',native_layout_verified:false});
   }catch(error){if(!(error instanceof GuardError)||error.code.includes('LIMIT'))throw error;for(const l of info.selected)reasons.set(`${l.section}:${l.shape_record}`,error.code);}
  }
  if(!replacements.length)continue;replacements.sort((a,b)=>a.start-b.start);if(replacements.some((r,i)=>i&&r.start<replacements[i-1].end))fail('DRAWING_SVG_IDENTITY_UNVERIFIED');
  for(const p of replacements.slice().reverse())svg=svg.slice(0,p.start)+p.text+svg.slice(p.end);
  if(Buffer.byteLength(svg)>8*1024*1024)fail('RENDER_DRAWING_SVG_LIMIT');pages.set(page,{svg,runs:[...rawRuns.filter(r=>!removed.includes(r)),...added],controls:sourceControls.map(c=>controlChanges.get(c)??c)});
 }
 const unadapted=limits.filter(l=>!handled.has(`${l.section}:${l.shape_record}`)||reasons.has(`${l.section}:${l.shape_record}`)).map(l=>({...l,...(reasons.has(`${l.section}:${l.shape_record}`)?{adaptation_reason:reasons.get(`${l.section}:${l.shape_record}`)}:{})}));
 if(!pages.size)return {...renderState,unadapted_drawings:unadapted,drawing_adaptations:[]};
 const document={pageCount:()=>base.pageCount(),getDocumentInfo:()=>base.getDocumentInfo(),getPageInfo:p=>base.getPageInfo(p),getPositionOfPage:p=>base.getPositionOfPage(p),getParagraphLength:(...a)=>base.getParagraphLength(...a),getTextRange:(...a)=>base.getTextRange(...a),getPageControlLayout:p=>pages.has(p)?JSON.stringify({controls:pages.get(p).controls}):base.getPageControlLayout(p),getPageTextLayout:p=>pages.has(p)?JSON.stringify({runs:pages.get(p).runs}):base.getPageTextLayout(p),renderPageSvg:p=>pages.get(p)?.svg??base.renderPageSvg(p),free:()=>base.free()};
 return {...renderState,document,unadapted_drawings:unadapted,drawing_adaptations:notes,flow_adaptations:[...(renderState.flow_adaptations??[]),...notes],remap:(r,page)=>r.render_drawing_text||r.render_drawing_control?r:renderState.remap(r,page)};
}
