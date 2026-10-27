/** Geometry of canonical line-split nested cells, without editing their HWP. */
import {inspectLocalComplex} from './local_complex.mjs';
import {view,fail} from './local_complex_records.mjs';
import {cellPads} from './local_inline_cell_flow.mjs';
const same=(a,b)=>JSON.stringify(a)===JSON.stringify(b);
const boxKey=f=>[f.x,f.y,f.w,f.h].map(n=>Number(n).toFixed(1)).join(':');
const number=(tag,key)=>Number(new RegExp(`\\b${key}="([^"]+)"`).exec(tag)?.[1]);
const set=(tag,key,value)=>tag.replace(new RegExp(`(\\b${key}=")[^"]*(")`),(_,a,b)=>`${a}${value}${b}`);

export function adaptPartialRenderGeometry(HwpDocument,bytes,document,remap){
 const state=inspectLocalComplex(HwpDocument,bytes,{includeDocumentInfo:false,verifyCharacterModel:false}),pages=[],byTable=new Map();
 for(let page=0;page<document.pageCount();page++){
  const info=JSON.parse(document.getPageInfo(page)),rawRuns=JSON.parse(document.getPageTextLayout(page)).runs,runs=rawRuns.map(r=>remap(r,page)),controls=JSON.parse(document.getPageControlLayout(page)).controls.map(r=>remap(r,page));
  pages.push({info,rawRuns,runs,controls});for(const c of controls.filter(c=>c.type==='table')){if(!byTable.has(c.table_id))byTable.set(c.table_id,[]);byTable.get(c.table_id).push({page,c});}
 }
 const roots=state.tables.filter(t=>!t.cell_path.length&&byTable.get(t.id)?.length>1);if(!roots.length)return null;
 if(state.tables.some(t=>(view(state.recordSets.get(t.section)[t.table_record].payload).getUint32(0,true)&4)&&t.cells.some(c=>view(state.recordSets.get(t.section)[c.start].payload).getUint32(4,true)&0x40000))||state.pictures.length||state.text_boxes.length||state.fields.length||state.tables.some(t=>t.dimensions.rowCount!==1||t.cells.some(c=>c.rowSpan!==1))||roots.some(t=>state.tables.some(n=>n.parent_id===state.blocks.find(b=>b.id===t.parent_id)?.id&&n!==t)))return null;
 for(const t of state.tables)for(const c of t.cells)if(state.tables.filter(n=>c.blocks.some(b=>b.id===n.parent_id)).length>1)return null;
 const expected=new Map(),notes=[];
 for(const root of roots){let remaining=root.properties.tableHeight/75;const entries=byTable.get(root.id),pad=cellPads(state.recordSets.get(root.section),root,root.cells[0]);
  for(const [index,{page,c}]of entries.entries()){
   const info=pages[page].info,bottom=info.height-info.marginBottom-info.marginFooter,repeat=pad[2]+pad[3],h=index===entries.length-1?remaining+(index?repeat:0):bottom-c.y-pad[3];
   if(!Number.isFinite(h)||h<=0||c.y+h>bottom+.5)return null;remaining-=h-(index?repeat:0);const fixed={...c,h,cells:c.cells.map(cell=>({...cell,h:h-.25}))};expected.set(`${page}:${root.id}`,fixed);notes.push({kind:'table_row_fragment',section:root.section,table_id:root.id,page,source_height:root.properties.tableHeight,fragment_height:h*75});
  }
 }
 for(const t of state.tables.filter(t=>t.cell_path.length).sort((a,b)=>a.cell_path.length-b.cell_path.length)){
  const entries=byTable.get(t.id);if(!entries)return null;const host=state.blocks.find(b=>b.id===t.parent_id),parent=state.tables.find(p=>p.cells.some(c=>c.blocks.includes(host))),sourceCell=parent?.cells.find(c=>c.blocks.includes(host));if(!parent||!sourceCell)return null;
  for(const [index,{page,c}]of entries.entries()){
   const pc=expected.get(`${page}:${parent.id}`);if(!pc)continue;const frame=pc.cells.find(f=>f.cellIdx===sourceCell.cell);if(!frame)return null;const pad=cellPads(state.recordSets.get(t.section),parent,sourceCell),ownPad=cellPads(state.recordSets.get(t.section),t,t.cells[0]),y=frame.y+pad[2]+(index===0?view(state.recordSets.get(t.section)[t.record_index].payload).getInt32(8,true)/75:0),h=entries.length===1?t.properties.tableHeight/75:frame.y+frame.h-pad[3]-(index<entries.length-1?ownPad[3]:0)-y;
   if(!Number.isFinite(y)||!Number.isFinite(h)||h<=0||y+h>frame.y+frame.h+.5)return null;expected.set(`${page}:${t.id}`,{...c,y,h,cells:c.cells.map(f=>({...f,y:y+(f.y-c.y),h:h-.25}))});
  }
 }
 for(const [page,p]of pages.entries()){
  const frames=[];for(const c of p.controls.filter(c=>c.type==='table')){const next=expected.get(`${page}:${c.table_id}`);if(next)for(let i=0;i<c.cells.length;i++)frames.push({old:c.cells[i],next:next.cells[i],table:state.tables.find(t=>t.id===c.table_id)});}
  const deltas=new Map();
  for(const f of frames){const visible=p.runs.filter(r=>!r.render_only_synthetic&&r.cellPath&&same(r.cellPath.slice(0,-1),f.table.cell_path)&&r.cellPath.at(-1).controlIndex===f.table.control&&r.cellPath.at(-1).cellIndex===f.old.cellIdx);if(visible.length){const cell=f.table.cells.find(c=>c.cell===f.old.cellIdx),pad=cellPads(state.recordSets.get(f.table.section),f.table,cell);deltas.set(f,{dy:Math.max(0,f.next.y+pad[2])-Math.min(...visible.map(r=>r.y)),dx:f.next.x+pad[0]-Math.min(...visible.map(r=>r.x))});}}
  p.glyphs=[];p.runs=p.runs.map((r,i)=>{
   const raw=p.rawRuns[i];let dy=0,dx=0;if(!r.render_only_synthetic&&r.cellPath){const f=frames.find(f=>same(r.cellPath.slice(0,-1),f.table.cell_path)&&r.cellPath.at(-1).controlIndex===f.table.control&&r.cellPath.at(-1).cellIndex===f.old.cellIdx);if(f){const delta=deltas.get(f);dy=delta?.dy??f.next.y-f.old.y;dx=delta?.dx??0;}}
   else if(!r.cellPath&&r.paraIdx<0xfffffff0){for(const root of roots){const entry=byTable.get(root.id).find(e=>e.page===page),fixed=expected.get(`${page}:${root.id}`);if(entry&&fixed&&r.paraIdx>root.paragraph)dy+=fixed.y+fixed.h-entry.c.y-entry.c.h;}}
   let scalar=0;for(const char of raw.text){p.glyphs.push({char,x:raw.x+(raw.charX?.[scalar]??0),y:raw.y+raw.h*.85,dy,dx,visible:!r.render_only_synthetic});scalar++;}
   return {...r,x:r.x+dx,y:r.y+dy};
  });
  if(p.glyphs.length>200000)fail('RENDERED_LAYOUT_ITEM_LIMIT');p.glyphIndex=new Map();for(const g of p.glyphs){const key=`${Math.round(g.x*10)}:${Math.round(g.y*10)}`;if(!p.glyphIndex.has(key))p.glyphIndex.set(key,[]);p.glyphIndex.get(key).push(g);}
  p.controls=p.controls.map(c=>expected.get(`${page}:${c.table_id}`)??c);p.frames=frames;p.tableFrames=p.controls.filter(c=>c.type==='table').map(c=>({old:byTable.get(c.table_id).find(e=>e.page===page).c,next:c,table:state.tables.find(t=>t.id===c.table_id)}));
 }
 function svg(page){const p=pages[page],source=document.renderPageSvg(page),clips=new Map();let cellClip;
  return source.replace(/<[^>]+>/g,tag=>{
   if(/^<clipPath\b/.test(tag)){cellClip=/\bid="([^"]+)"/.exec(tag)?.[1];return tag;}if(/^<\/clipPath/.test(tag)){cellClip=undefined;return tag;}
   if(cellClip&&/^<rect\b/.test(tag)){const found=p.frames.find(f=>Math.abs(number(tag,'x')-f.old.x)<.4&&Math.abs(number(tag,'y')-f.old.y)<.4&&Math.abs(number(tag,'width')-f.old.w)<.4&&Math.abs(number(tag,'height')-f.old.h)<.4);if(found){clips.set(cellClip,found);for(const [key,k]of[['x','x'],['y','y'],['width','w'],['height','h']])tag=set(tag,key,found.next[k]);}return tag;}
   if(/^<text\b/.test(tag)){const x=number(tag,'x'),y=number(tag,'y'),matches=[];for(let a=-3;a<=3;a++)for(let b=-3;b<=3;b++)for(const g of p.glyphIndex.get(`${Math.round(x*10)+a}:${Math.round(y*10)+b}`)??[])if(Math.abs(g.x-x)<.25&&Math.abs(g.y-y)<.25)matches.push(g);if(matches.length===1)return matches[0].visible?set(set(tag,'y',y+matches[0].dy),'x',x+matches[0].dx):tag.replace(/<text\b/,'<text visibility="hidden"');}
   if(/^<line\b/.test(tag)){let x1=number(tag,'x1'),x2=number(tag,'x2'),y1=number(tag,'y1'),y2=number(tag,'y2');const candidate=[...p.tableFrames,...p.frames].sort((a,b)=>b.table.cell_path.length-a.table.cell_path.length).find(f=>[x1,x2].every(x=>x>=f.old.x-.5&&x<=f.old.x+f.old.w+.5)&&[y1,y2].every(y=>y>=f.old.y-.5&&y<=f.old.y+f.old.h+.5)&&([y1,y2].every(y=>Math.abs(y-f.old.y)<.5)||[y1,y2].every(y=>Math.abs(y-f.old.y-f.old.h)<.5)||Math.abs(x1-x2)<.01));if(candidate){const f=candidate,map=y=>Math.abs(y-f.old.y)<.5?f.next.y:Math.abs(y-f.old.y-f.old.h)<.5?f.next.y+f.next.h:y+f.next.y-f.old.y;tag=set(set(tag,'y1',map(y1)),'y2',map(y2));}return tag;}
   return tag;
  });
 }
 const facade={pageCount:()=>pages.length,getDocumentInfo:()=>document.getDocumentInfo(),getPageInfo:p=>JSON.stringify(pages[p].info),getPositionOfPage:p=>document.getPositionOfPage(p),getParagraphLength:(...a)=>document.getParagraphLength(...a),getTextRange:(...a)=>document.getTextRange(...a),getPageTextLayout:p=>JSON.stringify({runs:pages[p].runs.filter(r=>!r.render_only_synthetic)}),getPageControlLayout:p=>JSON.stringify({controls:pages[p].controls}),renderPageSvg:svg,free:()=>document.free()};
 return {document:facade,notes};
}
