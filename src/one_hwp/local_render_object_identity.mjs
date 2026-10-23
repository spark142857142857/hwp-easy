/** Bind supported inline drawings and their text to original raw identities. */
import {renderTableKey} from './local_render_table_identity.mjs';
const stable=(b,o)=>[b.section,b.paragraph,...b.cell_path.flatMap(p=>[p.controlIndex,p.cellIndex,p.cellParaIndex]),o.control_index];
export const renderRunKey=(r,page)=>JSON.stringify([page,r.secIdx,r.paraIdx,r.parentParaIdx,r.cellPath,r.x,r.y,r.charStart,r.text]);
export function bindRenderObjects(document,state,objects){
 const controls=new Map(),runs=new Map(),seen=new Set();
 if(!objects.size)return {controls,runs};
 for(let page=0;page<document.pageCount();page++){
  const cs=JSON.parse(document.getPageControlLayout(page)).controls,rs=JSON.parse(document.getPageTextLayout(page)).runs;
  for(const [b,value]of objects){
   const o=value.object,expected=stable(b,o),found=cs.filter(c=>JSON.stringify(c.stableIndex)===JSON.stringify(expected)&&c.type===(value.kind==='picture'?'image':'shape'));
   if(!found.length)continue;if(found.length!==1||seen.has(o))return null;const c=found[0];
   if(Math.abs(c.w-o.properties.width/75)>.2||Math.abs(c.h-o.properties.height/75)>.2)return null;
   controls.set(renderTableKey(c,page),{block:b,object:o,stableIndex:expected});seen.add(o);
   if(value.kind==='text_box'){
    const paragraph=o.paragraphs[0],inside=r=>r.x>=c.x-.2&&r.y>=c.y-.2&&r.x+r.w<=c.x+c.w+.2&&r.y+r.h<=c.y+c.h+.2;
    const text=rs.filter(r=>r.text&&inside(r)&&r.text===paragraph.text.slice(r.charStart,r.charStart+r.text.length)).sort((a,b)=>a.charStart-b.charStart);
    if(text.map(r=>r.text).join('')!==paragraph.text)return null;
    for(const r of text){const key=renderRunKey(r,page);if(runs.has(key))return null;runs.set(key,{block:b,object:o,paragraph});}
   }
  }
 }
 if(seen.size!==objects.size)return null;
 return {controls,runs};
}
