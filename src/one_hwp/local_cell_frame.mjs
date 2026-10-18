/** Unique raw/rendered cell hierarchy; ambiguous truncated paths stay unresolved. */
import {contains} from './local_rendered_layout.mjs';
const same=(a,b)=>JSON.stringify(a)===JSON.stringify(b);
const finite=r=>r&&['x','y','w','h'].every(k=>Number.isFinite(r[k]))&&r.w>0&&r.h>0;
const dimensions=(c,t)=>c.rowCount===t.dimensions.rowCount&&c.colCount===t.dimensions.colCount&&Math.abs(c.w-t.properties.tableWidth/75)<2;

export function locateCell(state,box,snapshot,tick){
 const path=box.cell_path,root=state.tables.find(t=>t.section===box.section&&t.paragraph===box.paragraph&&!t.cell_path.length&&t.control===path[0].controlIndex);
 if(!root)return null;
 const roots=snapshot.pages.flatMap(page=>page.controls.filter(c=>{tick();return c.type==='table'&&same(c.stableIndex,[box.section,box.paragraph,root.control])&&dimensions(c,root);}).map(table=>({page,table})));
 if(roots.length!==1)return null;
 const {page}=roots[0];let frame=roots[0].table,rawTable=root;const lineage=[];
 for(let depth=0;depth<path.length;depth++){
  const cells=frame.cells?.filter(c=>c.cellIdx===path[depth].cellIndex)??[];if(cells.length!==1||!finite(cells[0]))return null;
  const cell=cells[0];lineage.push({table:rawTable,frame,cell});if(depth===path.length-1)return {page,cell,root_table:root,root_frame:roots[0].table,lineage};
  const prefix=path.slice(0,depth+1),next=state.tables.find(t=>t.section===box.section&&t.paragraph===box.paragraph&&same(t.cell_path,prefix)&&t.control===path[depth+1].controlIndex);if(!next)return null;
  // Core currently truncates some nested identities. Only a unique matching
  // raw table and contained rendered frame may resolve that missing path.
  const peers=state.tables.filter(t=>t.section===box.section&&t.paragraph===box.paragraph&&same(t.cell_path,prefix)&&t.dimensions.rowCount===next.dimensions.rowCount&&t.dimensions.colCount===next.dimensions.colCount&&t.properties.tableWidth===next.properties.tableWidth);
  if(peers.length!==1)return null;
  const frames=page.controls.filter(c=>{tick();return c.type==='table'&&c!==frame&&dimensions(c,next)&&contains(cell,c,2);});if(frames.length!==1)return null;frame=frames[0];rawTable=next;
 }
 return null;
}
