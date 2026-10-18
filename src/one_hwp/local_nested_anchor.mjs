/** HWP column/host-paragraph origins, distinct from core's cell-local renderer. */
import {view,equal,fail} from './local_complex_records.mjs';
import {locateCell} from './local_cell_frame.mjs';
import {contains} from './local_rendered_layout.mjs';

const plain=p=>p&&['left','justify'].includes(p.alignment)&&['marginLeft','marginRight','indent','spacingBefore','spacingAfter'].every(k=>p[k]===0)&&p.lineSpacingType===0&&p.lineSpacing>=100&&!p.pageBreakBefore;
const tableFlow=r=>{if(r?.tag!==71||r.payload.length<36)fail('NESTED_PLACEMENT_TABLE_PROFILE_UNSUPPORTED');const v=view(r.payload),f=v.getUint32(4,true);return {treatAsChar:Boolean(f&1),widthRelTo:(f>>>15)&7,heightRelTo:(f>>>18)&3,vertRelTo:(f>>>3)&3,horzRelTo:(f>>>8)&3,vertAlign:(f>>>5)&7,horzAlign:(f>>>10)&7,vertOffset:v.getInt32(8,true),horzOffset:v.getInt32(12,true),marginLeft:v.getUint16(28,true),marginTop:v.getUint16(32,true)};};
function pads(rs,table,cell){const v=view(rs[cell.start].payload);return (v.getUint32(4,true)&0x10000)?[24,26,28,30].map(at=>v.getUint16(at,true)/75):['Left','Right','Top','Bottom'].map(k=>table.properties['padding'+k]/75);}
function cellBox(rs,table,cell,origin){
 if(cell.row!==0||cell.rowSpan!==1||cell.colSpan!==1||(view(rs[cell.start].payload).getUint32(4,true)&0x67)!==0)fail('NESTED_PLACEMENT_CELL_PROFILE_UNSUPPORTED');
 const first=table.cells.filter(c=>c.row===0).sort((a,b)=>a.col-b.col);if(first.length!==table.dimensions.colCount||first.some((c,i)=>c.col!==i||c.rowSpan!==1||c.colSpan!==1)||first.reduce((n,c)=>n+c.width,0)!==table.properties.tableWidth||table.properties.cellSpacing!==0)fail('NESTED_PLACEMENT_GRID_UNVERIFIED');
 return {x:origin.x+first.slice(0,cell.col).reduce((n,c)=>n+c.width/75,0),y:origin.y,w:cell.width/75,h:cell.height/75};
}
function inlinePrefix(state,snapshot,table){
 const host=state.blocks.find(b=>b.id===table.parent_id),rs=state.recordSets.get(table.section);if(!host?.unit_styles||host.cell_path.at(-1)?.cellParaIndex!==0||!plain(host.paragraph_properties))fail('NESTED_PLACEMENT_PARAGRAPH_UNVERIFIED');
 const anchors=host.tokens.filter(t=>t.code===11),controls=rs.slice(host.record_index+1,host.records_end).filter(r=>r.tag===71&&r.level===host.raw_level+1);
 if(controls.length!==1||rs[table.record_index]!==controls[0]||anchors.length!==1||host.tokens.some(t=>!t.text&&t!==anchors[0]&&t.code!==13)||host.tokens.some(t=>t.text&&t.unit>anchors[0].unit))fail('NESTED_PLACEMENT_INLINE_PREFIX_UNVERIFIED');
 if(!host.text)return {width:0,error:0};
 const runs=snapshot.pages.flatMap(p=>p.body_runs.filter(r=>r.secIdx===host.section&&r.parentParaIdx===host.paragraph&&equal(r.cellPath,host.cell_path)&&r.text)).sort((a,b)=>a.charStart-b.charStart);
 if(runs.map(r=>r.text).join('')!==host.text||runs.some(r=>Math.abs(r.y-runs[0].y)>.5||!Array.isArray(r.charX)||!r.charX.length||r.charX.some(n=>!Number.isFinite(n))))fail('NESTED_PLACEMENT_INLINE_PREFIX_UNVERIFIED');
 const width=runs.reduce((n,r)=>n+r.charX.at(-1)-r.charX[0],0);if(!Number.isFinite(width)||width<0||width>1000)fail('NESTED_PLACEMENT_INLINE_PREFIX_UNVERIFIED');
 // Font substitution remains uncertain. Keep the rectangle inside the
 // intersection of cells shifted by this measured-prefix tolerance.
 return {width,error:Math.max(1,width*.04)};
}

export function projectNestedAnchor(state,box,snapshot){
 if(box.cell_path.length<2||box.cell_path.length>3)fail('NESTED_PLACEMENT_DEPTH_UNSUPPORTED');
 if(box.cell_path.some(p=>p.cellParaIndex!==0))fail('NESTED_PLACEMENT_PARAGRAPH_UNVERIFIED');
 let checks=0;const at=locateCell(state,box,snapshot,()=>{if(++checks>200000)fail('NESTED_PLACEMENT_CHECK_LIMIT');}),rs=state.recordSets.get(box.section),root=at?.root_table,host=state.blocks.find(b=>b.id===root?.parent_id);
 if(!at||!host||host.text!==''||!plain(host.paragraph_properties)||at.page.info.columns?.length!==1||!contains(at.page.body,at.root_frame)||at.page.limitations.some(l=>!['NESTED_TABLE_PAGINATION_UNVERIFIED','INLINE_CONTROL_RENDER_PLANE_DISAGREEMENT'].includes(l.code)))fail('NESTED_PLACEMENT_ROOT_UNVERIFIED');
 if(rs.slice(host.record_index+1,host.records_end).some(r=>r.tag===71&&r.level===host.raw_level+1&&r!==rs[root.record_index]&&!['dces','dloc'].includes(Buffer.from(r.payload.subarray(0,4)).toString())))fail('NESTED_PLACEMENT_ROOT_UNVERIFIED');
 const ancestors=new Set(at.lineage.map(l=>l.table));if(state.tables.some(t=>t.section===box.section&&t.paragraph===box.paragraph&&!ancestors.has(t)))fail('NESTED_PLACEMENT_OTHER_TABLE_UNVERIFIED');
 const rootFlow=tableFlow(rs[root.record_index]);if(rootFlow.widthRelTo!==4||rootFlow.heightRelTo!==2||!rootFlow.treatAsChar&&(rootFlow.vertRelTo!==2||![2,3].includes(rootFlow.horzRelTo)||rootFlow.vertAlign!==0||rootFlow.horzAlign!==0||rootFlow.vertOffset!==0||rootFlow.horzOffset!==0))fail('NESTED_PLACEMENT_ROOT_UNVERIFIED');
 let origin={x:at.root_frame.x+rootFlow.marginLeft/75,y:at.root_frame.y+rootFlow.marginTop/75},cell,uncertainty=0;const frames=[];
 for(const [depth,entry]of at.lineage.entries()){
  const table=entry.table,rawCell=table.cells.find(c=>c.cell===box.cell_path[depth].cellIndex);if(!rawCell)fail('NESTED_PLACEMENT_GRID_UNVERIFIED');
  if(depth){const parent=at.lineage[depth-1],parentCell=parent.table.cells.find(c=>c.cell===box.cell_path[depth-1].cellIndex),p=pads(rs,parent.table,parentCell),prefix=inlinePrefix(state,snapshot,table),flow=tableFlow(rs[table.record_index]);
   if(!flow.treatAsChar||flow.widthRelTo!==4||flow.heightRelTo!==2)fail('NESTED_PLACEMENT_TABLE_PROFILE_UNSUPPORTED');
   origin={x:cell.x+p[0]+prefix.width+flow.marginLeft/75,y:cell.y+p[2]+flow.marginTop/75};uncertainty+=prefix.error;
   if(origin.x-uncertainty<cell.x||origin.x+uncertainty+table.properties.tableWidth/75>cell.x+cell.w+.5)fail('NESTED_PLACEMENT_TABLE_BOUNDS_UNVERIFIED');
  }
  cell=cellBox(rs,table,rawCell,origin);frames.push({table_id:table.id,...origin,w:table.properties.tableWidth/75,h:rawCell.height/75});
 }
 const table=at.lineage.at(-1).table,rawCell=table.cells.find(c=>c.cell===box.cell_path.at(-1).cellIndex),p=pads(rs,table,rawCell),frame={x:cell.x+p[0]+uncertainty,y:cell.y+p[2],w:cell.w-p[0]-p[1]-uncertainty*2,h:cell.h-p[2]-p[3]};
 if(frame.w<=0||frame.h<=0||box.properties.width/75>frame.w||box.properties.height/75>frame.h)fail('NESTED_PLACEMENT_FRAME_TOO_SMALL');
 const refs=at.page.body_runs.filter(r=>r.secIdx===box.section&&r.paraIdx===box.paragraph&&r.parentParaIdx==null&&r.cellIdx==null&&r.charStart===0);if(refs.length!==1||Math.abs(refs[0].y-at.root_frame.y)>2)fail('NESTED_PLACEMENT_PARAGRAPH_ORIGIN_UNVERIFIED');
 const anchor={x:at.page.info.columns[0].x,y:refs[0].y},rect={x:anchor.x+box.properties.horzOffset/75,y:anchor.y+box.properties.vertOffset/75,w:box.properties.width/75,h:box.properties.height/75};
 return {page:at.page.page,anchor,cell,frame,rect,frames,prefix_tolerance:uncertainty,lineage:at.lineage,raw_cell:rawCell,table,host:state.blocks.find(b=>b.id===box.block_id)};
}

export function nestedTextBand(state,box,projection,estimate){
 const rs=state.recordSets.get(box.section),blocks=projection.raw_cell.blocks;
 if(blocks.length>16||blocks.some(b=>!b.unit_styles||!plain(b.paragraph_properties)||rs.slice(b.record_index+1,b.records_end).some((r,i)=>r.tag===71&&r.level===b.raw_level+1&&b.record_index+1+i!==box.record_index)))fail('NESTED_PLACEMENT_CONTENT_UNVERIFIED');
 const height=blocks.reduce((n,b)=>n+estimate(b,projection.frame.w*75),0)/75;
 return {...projection.frame,h:height};
}
