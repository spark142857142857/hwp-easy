/** Bind each pinned-renderer fragment to raw paths and row/grid identities.
 * Page-local cell ordinals are never document cell identities. */
export const renderTableKey=(c,page)=>JSON.stringify([page,c.stableIndex,c.x,c.y,c.w,c.h]);
const shape=(c,t,host)=>c.secIdx===t.section&&c.stableIndex?.length===(t.cell_path.length?6+t.cell_path.length*3:3)&&c.paraIdx===(t.cell_path.length?host.cell_paragraph:t.paragraph)&&c.controlIdx===t.control&&c.rowCount===t.dimensions.rowCount&&c.colCount===t.dimensions.colCount&&Math.abs(c.w-t.properties.tableWidth/75)<=.2;
const cellMap=(c,t)=>c.cells.map(v=>t.cells.find(x=>['row','col','rowSpan','colSpan'].every(k=>v[k]===x[k])&&Math.abs(v.w-x.width/75)<.3&&Math.abs(v.h-x.height/75)<.3));
export function bindRenderTables(document,state){
 const result=new Map(),byTable=new Map(),fragments=new Map(),roots=state.tables.filter(t=>!t.cell_path.length),seen=new Map(),count=document.pageCount();if(count>32)return null;
 const add=(c,t,page,cells)=>{const key=renderTableKey(c,page);if(result.has(key))return false;result.set(key,t);fragments.set(key,cells);byTable.set(t,Object.fromEntries(['stableIndex','secIdx','paraIdx','controlIdx'].map(k=>[k,c[k]])));return true;};
 for(let page=0;page<count;page++){
  const controls=JSON.parse(document.getPageControlLayout(page)).controls.filter(c=>c.type==='table');let at=0;
  while(at<controls.length){
   const c=controls[at++],t=roots.find(t=>shape(c,t,state.blocks.find(b=>b.id===t.parent_id)));if(!t)return null;const cells=cellMap(c,t);if(!cells.length||cells.some(v=>!v))return null;
   if(cells.length!==t.cells.length&&(new DataView(state.recordSets.get(t.section)[t.table_record].payload.buffer,state.recordSets.get(t.section)[t.table_record].payload.byteOffset).getUint32(0,true)&3)!==1)return null;
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
 result.byTable=byTable;result.fragments=fragments;return result;
}
