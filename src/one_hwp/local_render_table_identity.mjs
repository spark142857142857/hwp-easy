/** Bind each pinned-renderer fragment to raw paths and row/grid identities.
 * Page-local cell ordinals are never document cell identities. */
export const renderTableKey=(c,page)=>JSON.stringify([page,c.stableIndex,c.x,c.y,c.w,c.h]);
const shape=(c,t,host)=>c.secIdx===t.section&&c.stableIndex?.length===(t.cell_path.length?6+t.cell_path.length*3:3)&&c.paraIdx===(t.cell_path.length?host.cell_paragraph:t.paragraph)&&c.controlIdx===t.control&&c.rowCount===t.dimensions.rowCount&&c.colCount===t.dimensions.colCount&&Math.abs(c.w-t.properties.tableWidth/75)<=.2;
const cellMap=(c,t)=>c.cells.map(v=>t.cells.find(x=>['row','col','rowSpan','colSpan'].every(k=>v[k]===x[k])&&Math.abs(v.w-x.width/75)<.3&&Math.abs(v.h-x.height/75)<.3));
export function fixedTableRegion(document,state,c,page){
 const info=JSON.parse(document.getPageInfo(page)),rs=state.recordSets.get(info.sectionIndex);if(!rs)return null;
 // An authored body table can overflow into a footer band. Its complete raw
 // identity takes precedence over a same-width fixed-region candidate.
 if(state.tables.some(t=>!t.cell_path.length&&shape(c,t,state.blocks.find(b=>b.id===t.parent_id))&&JSON.stringify(c.stableIndex)===JSON.stringify([t.section,t.paragraph,t.control])))return null;
 for(let i=0;i<rs.length;i++){const h=rs[i],kind=h.tag===71?Buffer.from(h.payload.subarray(0,4)).toString():'';if(!['toof','daeh'].includes(kind))continue;for(let j=i+1;j<rs.length&&rs[j].level>h.level;j++){const r=rs[j];if(r.tag!==71||Buffer.from(r.payload.subarray(0,4)).toString()!==' lbt'||r.payload.length<24)continue;const w=new DataView(r.payload.buffer,r.payload.byteOffset).getUint32(16,true)/75;if(Math.abs(w-c.w)<.3&&(kind==='toof'?c.y>=info.footerArea.y-.5:c.y+c.h<=info.marginTop+info.marginHeader+.5))return kind==='toof'?'footer':'header';}}
 return null;
}
function renderedBodyTables(document,state,page,fixed){return JSON.parse(document.getPageControlLayout(page)).controls.filter(c=>{if(c.type!=='table')return false;const region=fixedTableRegion(document,state,c,page);if(region){fixed.set(renderTableKey(c,page),region);return false;}return true;});}
export function bindRenderTables(document,state,{partialRows=false,pathAliases=false}={}){
 if(partialRows){const full=bindRenderTables(document,state);if(full){const frames=new Map();for(let p=0;p<document.pageCount();p++)for(const c of JSON.parse(document.getPageControlLayout(p)).controls.filter(c=>c.type==='table'))frames.set(renderTableKey(c,p),c.cells);for(const [key,cells]of full.fragments)full.fragments.set(key,cells.map((cell,i)=>({cell,frame:frames.get(key)[i]})));full.partialRows=false;return full;}return bindPartialRenderTables(document,state,pathAliases);}
 const fixed=new Map(),result=new Map(),byTable=new Map(),fragments=new Map(),roots=state.tables.filter(t=>!t.cell_path.length),seen=new Map(),count=document.pageCount();if(count>32)return null;
 const add=(c,t,page,cells)=>{const key=renderTableKey(c,page);if(result.has(key))return false;result.set(key,t);fragments.set(key,cells);byTable.set(t,Object.fromEntries(['stableIndex','secIdx','paraIdx','controlIdx'].map(k=>[k,c[k]])));return true;};
 for(let page=0;page<count;page++){
  const controls=renderedBodyTables(document,state,page,fixed);let at=0;
  while(at<controls.length){
   const c=controls[at++],t=roots.find(t=>shape(c,t,state.blocks.find(b=>b.id===t.parent_id)));if(!t)return null;const cells=cellMap(c,t);if(!cells.length||cells.some(v=>!v))return null;
   if(cells.length!==t.cells.length&&(new DataView(state.recordSets.get(t.section)[t.table_record].payload.buffer,state.recordSets.get(t.section)[t.table_record].payload.byteOffset).getUint32(0,true)&3)!==1&&(new DataView(state.recordSets.get(t.section)[t.table_record].payload.buffer,state.recordSets.get(t.section)[t.table_record].payload.byteOffset).getUint32(0,true)&3)!==2)return null;
   // Complete cells must cover every source row exactly once; line-split
   // (pageBreak:2) membership is a separate, unverified font/layout problem.
   const rows=[...new Set(cells.flatMap(c=>Array.from({length:c.rowSpan},(_,i)=>c.row+i)))];if(rows.some((r,i)=>i&&r!==rows[i-1]+1))return null;
   const prior=seen.get(t)??[];if(cells.some(c=>prior.includes(c)))return null;seen.set(t,[...prior,...cells]);
   if(Math.abs(c.h-(Math.max(...c.cells.map(c=>c.y+c.h))-c.y))>.5||!add(c,t,page,cells))return null;
   const nested=state.tables.filter(n=>n.section===t.section&&n.record_index>t.record_index&&n.end<=t.end&&cells.some(c=>c.cell===n.cell_path[0]?.cellIndex)).sort((a,b)=>a.record_index-b.record_index);
   for(const child of nested){const value=controls[at++],host=state.blocks.find(b=>b.id===child.parent_id);if(!value||!shape(value,child,host)||Math.abs(value.h-child.properties.tableHeight/75)>.3||value.cells.length!==child.cells.length)return null;const mapped=cellMap(value,child);if(mapped.some(c=>!c)||!add(value,child,page,mapped))return null;}
  }
 }
 if(roots.some(t=>seen.get(t)?.length!==t.cells.length)||state.tables.some(t=>!byTable.has(t)))return null;
 result.byTable=byTable;result.fragments=fragments;result.fixed=fixed;return result;
}

/** Source grid membership survives repeated cells in line-split fragments. */
function bindPartialRenderTables(document,state,pathAliases){
 const fixed=new Map(),result=new Map(),byTable=new Map(),fragments=new Map(),seen=new Map(),count=document.pageCount();if(count>32)return null;let partial=false,rootBinding;
 for(let page=0;page<count;page++)for(const c of renderedBodyTables(document,state,page,fixed)){
  const candidates=state.tables.filter(t=>{if(!shape(c,t,state.blocks.find(b=>b.id===t.parent_id)))return false;if(!t.cell_path.length)return true;const prefix=[t.section,t.paragraph,...t.cell_path.flatMap(p=>[p.controlIndex,p.cellIndex,p.cellParaIndex])];return (!rootBinding||t.record_index>rootBinding.record_index&&t.end<=rootBinding.end)&&prefix.every((v,i)=>c.stableIndex[i]===v||pathAliases&&i===1)&&c.stableIndex.at(-1)===t.control;});
  if(candidates.length!==1)return null;const t=candidates[0];if(!t.cell_path.length)rootBinding=t;const flags=new DataView(state.recordSets.get(t.section)[t.table_record].payload.buffer,state.recordSets.get(t.section)[t.table_record].payload.byteOffset).getUint32(0,true),cells=[];
  for(const f of c.cells){const matches=t.cells.filter(x=>['row','col','rowSpan','colSpan'].every(k=>f[k]===x[k])&&Math.abs(f.w-x.width/75)<.3&&f.h>0&&f.h<=x.height/75+.5);if(matches.length!==1)return null;const cell=matches[0],prior=seen.get(cell)??[];if(prior.includes(page)||prior.length&&page!==prior.at(-1)+1)return null;if(prior.length||Math.abs(f.h-cell.height/75)>.5){if((flags&3)!==2)return null;partial=true;}prior.push(page);seen.set(cell,prior);cells.push({cell,frame:f});}
  if(!cells.length)return null;const k=renderTableKey(c,page);if(result.has(k))return null;result.set(k,t);fragments.set(k,cells);byTable.set(t,Object.fromEntries(['stableIndex','secIdx','paraIdx','controlIdx'].map(k=>[k,c[k]])));
 }
 if(state.tables.some(t=>!byTable.has(t)||t.cells.some(c=>!seen.has(c))))return null;
 result.byTable=byTable;result.fragments=fragments;result.partialRows=partial;result.fixed=fixed;return result;
}
