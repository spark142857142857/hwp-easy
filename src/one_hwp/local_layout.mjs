/** Bounded geometry checks. Font estimates are warnings, never a pagination certificate. */
import {createHash} from 'node:crypto';
import {fail,view} from './local_complex_records.mjs';
function padding(state,table,cell){const v=view(state.recordSets.get(table.section)[cell.start].payload);return (v.getUint32(4,true)&0x10000)?[24,26,28,30].map(at=>v.getUint16(at,true)):['paddingLeft','paddingRight','paddingTop','paddingBottom'].map(k=>table.properties[k]);}
export function cellContainer(state,block){
 const parent=state.tables.flatMap(t=>t.cells.map(c=>({table:t,cell:c}))).find(({cell})=>cell.blocks.some(b=>b.id===block.id));
 if(!parent)return null;const pads=padding(state,parent.table,parent.cell);
 return {...parent,width:parent.cell.width-pads[0]-pads[1],height:parent.cell.height-pads[2]-pads[3]};
}
export function minimumGlyphWidth(block){
 let width=0;const points=[...block.text];for(const run of block.character_runs??[]){const p=run.properties,size=p.fontSize;if(!Number.isFinite(size))continue;
  for(const ch of points.slice(run.start,run.end)){if(/\s/u.test(ch))continue;const cjk=/[\p{Script=Hangul}\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}]/u.test(ch),ratio=p.ratios?.[cjk?0:1]??100,relative=p.relativeSizes?.[cjk?0:1]??100;width=Math.max(width,Math.ceil(size*ratio/100*relative/100*(cjk?1:.5)));}
 }return width;
}
/** Font-based risk estimate, never a native line-height or pagination proof. */
function textHeight(block,width){
 if(width<=0)return 0;const points=[...block.text],runs=block.character_runs??[];let x=0,h=0,line=0,run=0;
 const spacing=block.paragraph_properties?.lineSpacingType===0?Math.max(100,block.paragraph_properties.lineSpacing??160)/100:1.6;
 for(let i=0;i<points.length;i++){
  while(run+1<runs.length&&i>=runs[run].end)run++;const props=runs[run]?.properties,size=props?.fontSize??1000;
  const ch=points[i],wide=/[\p{Script=Hangul}\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}]/u.test(ch),script=wide?0:1;
  const w=size*(props?.ratios?.[script]??100)/100*(props?.relativeSizes?.[script]??100)/100*(wide?1:.5);
  if(ch==='\n'||x>0&&x+w>width){h+=line||size*spacing;x=0;line=0;if(ch==='\n')continue;}
  x+=w;line=Math.max(line,size*spacing);
 }return Math.ceil(h+line);
}
function cellPageRisks(state,add){
 if(!state.recordSets)return;const memo=new Map();
 const bodyHeight=section=>{const p=state.recordSets.get(section)?.find(r=>r.tag===73&&r.payload.length>=40);if(!p)return null;const v=view(p.payload);return v.getUint32(4,true)-[16,20,24,28].reduce((n,at)=>n+v.getUint32(at,true),0);};
 const tableHeight=t=>{if(memo.has(t.id))return memo.get(t.id);if(t.dimensions.rowCount>512)fail('LAYOUT_TABLE_LIMIT');memo.set(t.id,0);const rows=Array(t.dimensions.rowCount).fill(0);
  for(const c of t.cells){const pads=padding(state,t,c),width=c.width-pads[0]-pads[1];let height=pads[2]+pads[3];
   for(const b of c.blocks){height+=textHeight(b,width);for(const child of state.tables.filter(x=>x.parent_id===b.id))height+=tableHeight(child);}
   height=Math.max(c.height,height);for(let i=c.row;i<c.row+c.rowSpan&&i<rows.length;i++)rows[i]=Math.max(rows[i],height/c.rowSpan);
  }const height=Math.ceil(rows.reduce((a,b)=>a+b,0));memo.set(t.id,height);return height;};
 for(const t of state.tables){if(!t.cell_path?.length)continue;const height=tableHeight(t),available=bodyHeight(t.section),host=state.blocks.find(b=>b.id===t.parent_id);
  if(host&&available>0&&height>available)add('NESTED_TABLE_MAY_EXCEED_PAGE_HEIGHT',host,height,available,'font_estimate',{table_id:t.id,advice:'shorten the answer or explicitly restructure the nested table; automatic nested-table page splitting is unverified'});
 }
}
export function analyzeLocalLayout(state){
 const issues=[];let checks=0;const add=(code,b,size,available,certainty='geometry',extra={})=>{issues.push({code,block_id:b.id,section:b.section,cell_path:b.cell_path,size,available,certainty,...extra,signature:createHash('sha256').update(JSON.stringify([code,b.section,size,available])).digest('hex')});};
 for(const b of state.blocks){const parent=cellContainer(state,b);if(!parent)continue;checks++;
  if(parent.width<=0)add('CELL_PADDING_EXCEEDS_WIDTH',b,parent.cell.width-parent.width,parent.cell.width);
  const glyph=minimumGlyphWidth(b);if(glyph&&parent.width>0&&glyph>parent.width)add('CELL_SINGLE_GLYPH_MAY_CLIP',b,glyph,parent.width,'font_estimate');
  for(const t of state.tables.filter(t=>t.parent_id===b.id)){checks++;if(t.properties.tableWidth>parent.width)add('NESTED_TABLE_EXCEEDS_CELL_WIDTH',b,t.properties.tableWidth,parent.width,'geometry',{table_id:t.id});}
  for(const p of state.pictures.filter(p=>p.block_id===b.id)){checks++;const props=p.properties,theta=props.rotationAngle*Math.PI/180,boundWidth=Math.abs(Math.cos(theta))*props.width+Math.abs(Math.sin(theta))*props.height;
   const extent=Math.ceil(boundWidth+Math.max(0,props.horzOffset)-1e-7);if(extent>parent.width)add('PICTURE_EXCEEDS_CELL_WIDTH',b,extent,parent.width,'geometry',{picture_index:p.picture_index});}
  for(const g of state.groups.filter(g=>g.block_id===b.id)){checks++;const p=g.properties,extent=p.width+Math.max(0,p.horzOffset);if(extent>parent.width)add('GROUP_EXCEEDS_CELL_WIDTH',b,extent,parent.width,'geometry',{group_id:g.id});}
 }
 cellPageRisks(state,add);
 return {status:issues.length?'issues_detected':'no_checked_geometry_overflow',checks,issues,geometry_overflows:issues.filter(x=>x.certainty==='geometry').length,font_warnings:issues.filter(x=>x.certainty==='font_estimate').length,layout_verified:false,scope:'mapped cell geometry and font-based nested-table height risks',not_checked:['native page pagination','stored minimum row height versus actual reflow','exact multi-line text height','floating-object overlap','font substitution','arbitrary shape transforms']};
}
export function newLayoutIssues(before,after,remap={}){const key=(i,id)=>JSON.stringify([id,i.code,i.section,i.size,i.available]),counts=new Map();for(const i of before.issues){const id=Object.hasOwn(remap,i.block_id)?remap[i.block_id]:i.block_id;if(id===null)continue;const k=key(i,id);counts.set(k,(counts.get(k)??0)+1);}return after.issues.filter(i=>{const k=key(i,i.block_id),n=counts.get(k)??0;if(n){counts.set(k,n-1);return false;}return true;});}
export function fitNestedTable(state,b,op){
 if(Object.keys(op).sort().join(',')!==['type','target_id','expected_old','expected_dimensions','expected_properties'].sort().join(','))fail('INVALID_OPERATION');
 const table=state.tables.find(t=>t.cells.some(c=>c.blocks.some(x=>x.id===b.id))),host=state.blocks.find(x=>x.id===table?.parent_id),parent=host&&cellContainer(state,host);
 if(!table?.layout_editable||!parent||parent.width<=0)fail('NESTED_TABLE_CONTAINER_REQUIRED');
 if(JSON.stringify(op.expected_dimensions)!==JSON.stringify(table.dimensions)||JSON.stringify(op.expected_properties)!==JSON.stringify(table.properties))fail('EXPECTED_TABLE_MISMATCH');
 if(table.properties.tableWidth<=parent.width)return null;
 const count=table.dimensions.colCount,boundaries=Array(count+1).fill(null);boundaries[0]=0;
 for(let round=0;round<=count;round++)for(const c of table.cells){if(boundaries[c.col]!==null)boundaries[c.col+c.colSpan]=boundaries[c.col]+c.width;if(boundaries[c.col+c.colSpan]!==null)boundaries[c.col]=boundaries[c.col+c.colSpan]-c.width;}
 if(boundaries.some(x=>x===null)||boundaries[count]!==table.properties.tableWidth||table.cells.some(c=>boundaries[c.col+c.colSpan]-boundaries[c.col]!==c.width))fail('TABLE_TRACKS_UNVERIFIED');
 const widths=boundaries.slice(1).map((x,i)=>Math.max(1,Math.floor((x-boundaries[i])*parent.width/boundaries[count])));widths[count-1]+=parent.width-widths.reduce((a,z)=>a+z,0);
 if(widths.some(x=>x<=0))fail('LAYOUT_CANNOT_FIT_WITHOUT_REFLOW');
 for(const c of table.cells){const pads=padding(state,table,c),available=widths.slice(c.col,c.col+c.colSpan).reduce((a,z)=>a+z,0)-pads[0]-pads[1];if(c.blocks.some(x=>minimumGlyphWidth(x)>available))fail('LAYOUT_CANNOT_FIT_WITHOUT_REFLOW');}
 return {type:'resize_table_columns',target_id:op.target_id,expected_old:op.expected_old,widths};
}
