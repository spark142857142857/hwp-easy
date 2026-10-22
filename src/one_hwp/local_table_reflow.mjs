/** Explicit whole-root table flow. Never infer clipping freedom from WASM pages. */
import {inspectLocalComplex} from './local_complex.mjs';
import {standardBlockId,trackPositions} from './local_complex_table.mjs';
import {objectFlow as commonObjectFlow,validObjectHeader} from './local_flow_records.mjs';
import {view,equal,equalBytes,fail} from './local_complex_records.mjs';
import {publishVerifiedPatch} from './local_verified_patch.mjs';
import {invalidateSectionLayout} from './local_layout_cache.mjs';
import {createNaturalTextMeasurer} from './local_rendered_layout.mjs';
import {GuardError} from '../../probes/sites-runtime/guard/records.mjs';

const objectFlow=r=>{if(r.payload.length>=44)return commonObjectFlow(r);if(r.payload.length!==42)fail('TABLE_REFLOW_HEADER_UNSUPPORTED');const p=new Uint8Array(44);p.set(r.payload);return commonObjectFlow({...r,payload:p});};
const tableHeader=p=>p.length>=42&&(p.length===42+2*view(p).getUint16(40,true)||validObjectHeader(p));
const prevention=p=>validObjectHeader(p)?view(p).getUint32(40,true):null;
const target=(id,version)=>`hwp5:${version}:${Buffer.from(id).toString('base64url')}`;
export function tableFlowDescriptor(state,t){
 const rs=state.recordSets.get(t.section);if(!tableHeader(rs[t.record_index].payload))fail('TABLE_REFLOW_HEADER_UNSUPPORTED');const p=view(rs[t.record_index].payload),flags=view(rs[t.table_record].payload).getUint32(0,true);
 return {id:t.id,dimensions:t.dimensions,properties:t.properties,flow:objectFlow(rs[t.record_index]),pagination:{pageBreak:flags&3,repeatHeader:Boolean(flags&4),sizeProtected:Boolean(p.getUint32(4,true)&(1<<20)),preventPageBreak:prevention(rs[t.record_index].payload)}};
}
export function tableReflowContexts(state,version){
 return state.tables.filter(t=>!t.cell_path.length).map(root=>{try{
  const first=root.cells[0]?.blocks[0];if(!first?.text_mapping_verified)fail('TABLE_REFLOW_ROOT_UNVERIFIED');if(first.text.length>10000)fail('TABLE_REFLOW_PARAGRAPH_PROFILE_UNSUPPORTED');
  return {root_table_id:root.id,scope:'whole_root_tree',target_id:target(first.id,version),expected_old:first.text,
   expected_tables:state.tables.filter(t=>t.section===root.section&&t.record_index>=root.record_index&&t.end<=root.end).map(t=>tableFlowDescriptor(state,t))};
 }catch(error){if(!(error instanceof GuardError))throw error;return {root_table_id:root.id,read_only_reason:error.code};}});
}
function pads(state,t,c){const p=view(state.recordSets.get(t.section)[c.start].payload);return p.getUint32(4,true)&0x10000?[24,26,28,30].map(i=>p.getUint16(i,true)):['paddingLeft','paddingRight','paddingTop','paddingBottom'].map(k=>t.properties[k]);}
export function tablePaginationEnabled(state,t){
 if(!t)return false;
 const host=state.blocks.find(b=>b.id===t.parent_id),parent=host&&state.tables.find(p=>p.cells.some(c=>c.blocks.some(b=>b.id===host.id))),rs=state.recordSets.get(t.section),p=rs[t.record_index]?.payload;
 if(!p||!tableHeader(p))return false;const f=objectFlow(rs[t.record_index]),v=view(p),flags=view(rs[t.table_record].payload).getUint32(0,true);
 return !f.treatAsChar&&f.textWrap===0&&f.vertRelTo===2&&f.horzRelTo===2&&!f.vertAlign&&!f.horzAlign&&!(v.getUint32(4,true)&(1<<20))&&!prevention(p)&&(flags&3)===2&&(!t.cell_path.length||Boolean(parent&&tablePaginationEnabled(state,parent)));
}
function paragraphHeight(b,width,measure){
 const p=b.paragraph_properties;if(!b.text_mapping_verified||!b.unit_styles||!p||p.lineSpacingType!==0||p.lineSpacing<100||p.lineSpacing>300||p.keepLines||p.keepWithNext||p.marginLeft||p.marginRight||p.indent||p.spacingBefore||p.spacingAfter||p.pageBreakBefore||b.text.length>10000)fail('TABLE_REFLOW_PARAGRAPH_PROFILE_UNSUPPORTED');
 if(b.character_runs.some(r=>r.properties.ratios.some(n=>n!==100)||r.properties.relativeSizes.some(n=>n!==100)))fail('TABLE_REFLOW_FONT_PROFILE_UNSUPPORTED');
 // Stored heights are minima. Reserve additional room for reader font metrics;
 // widths/page breaks are still recomputed by the user's HWP reader.
 const sizes=new Set(b.character_runs.map(r=>r.properties.fontSize));if(sizes.size>1)fail('TABLE_REFLOW_FONT_PROFILE_UNSUPPORTED');const size=[...sizes][0]??1000;if(b.text&&width<size*2)fail('TABLE_REFLOW_NARROW_CELL_UNVERIFIED');const points=[...b.text],widths=measure(b.text,b.character_runs);let index=0,x=0,lines=1,word=[];
 const put=w=>{if(w>width*.96)fail('TABLE_REFLOW_GLYPH_WIDTH_UNSUPPORTED');if(x>0&&x+w>width*.96){lines++;x=0;}x+=w;};
 const flush=()=>{const total=word.reduce((n,w)=>n+w,0);if(total<=width*.96)put(total);else for(const w of word)put(w);word=[];};
 for(const ch of points){if(!/^[A-Za-z0-9]$/.test(ch))flush();if(ch==='\n'){lines++;x=0;continue;}const w=widths[index++]*75*1.04;if(!Number.isFinite(w)||w<0)fail('TABLE_REFLOW_FONT_PROFILE_UNSUPPORTED');if(/^[A-Za-z0-9]$/.test(ch))word.push(w);else put(w);}flush();
 return Math.max(1600,Math.ceil(lines*size*p.lineSpacing/100*1.08));
}
export function reflowTableLocal(HwpDocument,source,version,op){
 if(op.type!=='reflow_table'||!equal(Object.keys(op).sort(),['type','target_id','expected_old','expected_tables'].sort()))fail('INVALID_OPERATION');
 if(typeof op.target_id!=='string'||!op.target_id.startsWith(`hwp5:${version}:`))fail('VERSION_CONFLICT');const encoded=op.target_id.slice(70),id=Buffer.from(encoded,'base64url').toString();if(!id||Buffer.from(id).toString('base64url')!==encoded)fail('INVALID_TARGET');
 const state=inspectLocalComplex(HwpDocument,source,{includeDocumentInfo:false}),b=state.blocks.find(b=>b.id===id||standardBlockId(b)===id);if(!b?.text_mapping_verified||!b.cell_path.length)fail('TABLE_CELL_REQUIRED');if(b.text!==op.expected_old)fail('EXPECTED_OLD_MISMATCH');
 const root=state.tables.find(t=>!t.cell_path.length&&t.section===b.section&&t.record_index<b.record_index&&t.end>b.record_index);if(!root)fail('TABLE_REFLOW_ROOT_UNVERIFIED');
 const tables=state.tables.filter(t=>t.section===root.section&&t.record_index>=root.record_index&&t.end<=root.end);if(!equal(op.expected_tables,tables.map(t=>tableFlowDescriptor(state,t))))fail('EXPECTED_TABLE_FLOW_MISMATCH');
 if(tables.length>16||tables.some(t=>t.cell_path.length>2||!t.layout_editable||t.dimensions.rowCount>32||t.dimensions.colCount>16||t.properties.cellSpacing))fail('TABLE_REFLOW_PROFILE_UNSUPPORTED');
 if(tables.flatMap(t=>t.cells.flatMap(c=>c.blocks)).reduce((n,b)=>n+b.text.length,0)>100000)fail('TABLE_REFLOW_TEXT_LIMIT');
 const rs=state.recordSets.get(b.section),pages=rs.filter(r=>r.tag===73),cols=rs.filter(r=>r.tag===71&&Buffer.from(r.payload.subarray(0,4)).toString()==='dloc');
 if(pages.length!==1||pages[0].payload.length!==40||view(pages[0].payload).getUint32(36,true)!==0||cols.length!==1||cols[0].payload.length<8||((view(cols[0].payload).getUint16(4,true)>>>2)&255)!==1)fail('TABLE_REFLOW_PAGE_PROFILE_UNSUPPORTED');
 const page=view(pages[0].payload),bodyWidth=page.getUint32(0,true)-[8,12,32].reduce((n,i)=>n+page.getUint32(i,true),0),bodyHeight=page.getUint32(4,true)-[16,20,24,28].reduce((n,i)=>n+page.getUint32(i,true),0);
 if(bodyWidth<=0||bodyHeight<7200||root.properties.tableWidth>bodyWidth)fail('TABLE_REFLOW_PAGE_PROFILE_UNSUPPORTED');
 // A body host still selects one root. Nested hosts may contain several tables;
 // explicit reflow stacks them below the prefix in their original anchor order.
 const hosts=new Map(tables.map(t=>[t.id,state.blocks.find(b=>b.id===t.parent_id)]));
 const patches=new Map(),heights=new Map(),changes=[],measure=createNaturalTextMeasurer(HwpDocument),hostPeers=new Map();
 const rootHost=hosts.get(root.id);if(!rootHost?.unit_styles||!Array.isArray(rootHost.character_runs)||rootHost.text.includes('\n')||rootHost.text.length>120||measure(rootHost.text,rootHost.character_runs).reduce((n,w)=>n+w*75,0)>bodyWidth*.9)fail('TABLE_REFLOW_ROOT_PREFIX_UNVERIFIED');
 for(const other of state.tables.filter(t=>t.section===root.section&&!t.cell_path.length&&t!==root))if(!objectFlow(rs[other.record_index]).treatAsChar)fail('TABLE_REFLOW_OTHER_FLOATING_TABLE_UNSUPPORTED');
 const patch=i=>{if(!patches.has(i))patches.set(i,rs[i].payload.slice());return view(patches.get(i));};
 for(const t of [...tables].reverse()){
  const xs=trackPositions(t,'col');if(xs.at(-1)!==t.properties.tableWidth||t.cells.some(c=>xs[c.col]===null||xs[c.col+c.colSpan]===null||xs[c.col+c.colSpan]-xs[c.col]!==c.width))fail('TABLE_REFLOW_COLUMN_GEOMETRY_UNVERIFIED');
  const host=hosts.get(t.id),h=rs[t.record_index].payload;if(!host?.text_mapping_verified||!tableHeader(h))fail('TABLE_REFLOW_ANCHOR_UNVERIFIED');const old=objectFlow(rs[t.record_index]);if(old.widthRelTo!==4||old.heightRelTo!==2)fail('TABLE_REFLOW_PROFILE_UNSUPPORTED');
  const anchors=host.tokens.filter(x=>x.code===11),peers=state.tables.filter(x=>x.parent_id===host.id).sort((a,b)=>a.record_index-b.record_index),controls=rs.slice(host.record_index+1,host.records_end).filter(r=>r.tag===71&&r.level===host.raw_level+1&&(t.cell_path.length||!['dces','dloc'].includes(Buffer.from(r.payload.subarray(0,4)).toString())));
  if(!anchors.length||anchors.length!==peers.length||controls.length!==peers.length||controls.some((r,i)=>r!==rs[peers[i].record_index])||anchors.some(x=>Buffer.from(rs[host.text_record].payload.subarray(x.unit*2+2,x.unit*2+6)).toString()!==' lbt')||host.tokens.some(x=>x.unit>anchors[0].unit&&x.text)||host.tokens.some(x=>!x.text&&![2,11,13].includes(x.code))||!t.cell_path.length&&peers.length!==1)fail('TABLE_REFLOW_ANCHOR_UNVERIFIED');
  hostPeers.set(host.id,peers);
  // A merged cell constrains the sum of its rows, not each row separately.
  // Start with recoverable existing tracks, then satisfy shorter spans first.
  // Assigning only the deficit to the final row preserves earlier boundaries
  // and makes a second synchronization byte-for-byte idempotent.
  let oldRows;try{const ys=trackPositions(t,'row');if(ys.every(n=>n!==null))oldRows=ys.slice(1).map((n,i)=>n-ys[i]);}catch(error){if(!(error instanceof GuardError))throw error;}
  if(oldRows?.some(n=>n<=0))fail('TABLE_REFLOW_ROW_GEOMETRY_UNVERIFIED');
  const rows=oldRows??Array(t.dimensions.rowCount).fill(1),constraints=[];
  for(const c of t.cells){
   const flags=view(rs[c.start].payload).getUint32(4,true),padding=pads(state,t,c),width=c.width-padding[0]-padding[1];if((flags&0x1f)!==0||((flags>>>5)&3)>2||width<=0)fail('TABLE_REFLOW_CELL_PROFILE_UNSUPPORTED');
   let needed=padding[2]+padding[3];
   for(const paragraph of c.blocks){
    const child=tables.filter(x=>x.parent_id===paragraph.id);
    if(rs.slice(paragraph.record_index+1,paragraph.records_end).some(r=>r.tag===71&&r.level===paragraph.raw_level+1&&Buffer.from(r.payload.subarray(0,4)).toString()!==' lbt'))fail('TABLE_REFLOW_CELL_CONTROL_UNSUPPORTED');
    needed+=paragraphHeight(paragraph,width,measure);
    for(const ch of child){const f=objectFlow(rs[ch.record_index]);if(ch.properties.tableWidth+f.marginLeft+f.marginRight>width)fail('TABLE_REFLOW_CHILD_WIDTH_UNSUPPORTED');needed+=heights.get(ch.id)+f.marginTop+f.marginBottom;}
   }
   needed=Math.max(c.height,Math.ceil(needed));if(needed>720000)fail('TABLE_REFLOW_HEIGHT_LIMIT');
   constraints.push({row:c.row,span:c.rowSpan,needed});
  }
  for(const c of constraints.sort((a,b)=>a.span-b.span||a.row-b.row)){
   const current=rows.slice(c.row,c.row+c.span).reduce((n,h)=>n+h,0);
   rows[c.row+c.span-1]+=Math.max(0,c.needed-current);
  }
  const height=rows.reduce((a,n)=>a+n,0);if(height>720000||height/bodyHeight>12)fail('TABLE_REFLOW_HEIGHT_LIMIT');heights.set(t.id,height);
  for(const c of t.cells)patch(c.start).setUint32(20,rows.slice(c.row,c.row+c.rowSpan).reduce((n,h)=>n+h,0),true);
  const p=patch(t.record_index),mask=1|4|(3<<3)|(7<<5)|(3<<8)|(7<<10)|(1<<13)|(1<<14)|(1<<20)|(7<<21)|(3<<24);
  p.setUint32(4,((p.getUint32(4,true)&~mask)|(2<<3)|(2<<8)|8192)>>>0,true);p.setInt32(12,0,true);p.setUint32(20,height,true);if(validObjectHeader(h))p.setUint32(40,0,true);
  const data=patch(t.table_record);data.setUint32(0,(data.getUint32(0,true)&~3)|2,true);
  changes.push({table_id:t.id,stored_height_before:t.properties.tableHeight,stored_height_after:height,rows});
 }
 // Heights are now known for every sibling. Assign offsets in a separate pass:
 // reverse bottom-up height evaluation must not read an unmeasured earlier peer.
 for(const t of tables){
  const host=hosts.get(t.id),parent=t.cell_path.length?tables.find(p=>p.cells.some(c=>c.blocks.some(b=>b.id===host.id))):null,cell=parent?.cells.find(c=>c.blocks.some(b=>b.id===host.id)),padding=cell?pads(state,parent,cell):[];
  let offset=cell?paragraphHeight(host,cell.width-padding[0]-padding[1],measure):0;
  if(cell)for(const peer of hostPeers.get(host.id)){if(peer===t)break;const f=objectFlow(rs[peer.record_index]);offset+=heights.get(peer.id)+f.marginTop+f.marginBottom;}
  patch(t.record_index).setInt32(8,offset,true);changes.find(c=>c.table_id===t.id).vertOffset=offset;
 }
 // Other drawings are safe only when fixed to paper/page; paragraph drawings
 // can change pages or collide with the growing table and remain explicit work.
 for(const object of [...state.text_boxes,...state.pictures,...state.groups,...state.opaque_drawings]){
  if(object.section!==b.section)continue;const f=object.flow;if(object.cell_path.length||f.treatAsChar||f.vertRelTo>1)fail('TABLE_REFLOW_FLOATING_CONTROL_UNSUPPORTED');
  const p=object.properties,bottom=p.vertOffset+Math.max(p.height,0)+f.marginBottom,bodyBottom=page.getUint32(4,true)-page.getUint32(20,true)-page.getUint32(28,true),bodyTop=page.getUint32(16,true)+page.getUint32(24,true);
  if(f.vertRelTo!==0||f.vertAlign!==0||!(p.vertOffset-f.marginTop>=bodyBottom||bottom<=bodyTop))fail('TABLE_REFLOW_FIXED_REGION_UNPROTECTED');
 }
 const changed=[...patches].some(([i,p])=>!equalBytes(rs[i].payload,p));if(!changed)return {bytes:source,content_verified:true,raw_preservation_verified:true,unchanged:true,layout_verified:false};
 const records=invalidateSectionLayout(rs.map((r,i)=>patches.has(i)?{...r,payload:patches.get(i)}:r),state.blocks.filter(b=>b.section===root.section)),bytes=publishVerifiedPatch(source,state,b.section,records),after=inspectLocalComplex(HwpDocument,bytes,{includeDocumentInfo:false,verifyCharacterModel:false});
 if(!equal(state.blocks.map(b=>[b.id,b.text,b.unit_styles]),after.blocks.map(b=>[b.id,b.text,b.unit_styles]))||!equal(state.fields,after.fields)||tables.some(t=>!tablePaginationEnabled(after,after.tables.find(n=>n.id===t.id))))fail('TABLE_REFLOW_PRESERVATION_MISMATCH');
 return {bytes,content_verified:true,raw_preservation_verified:true,raw_preservation_scope:'selected_root_tree_table_flow_height_pagination_and_section_line_caches; text_styles_widths_margins_borders_other_controls_and_streams_exact',flow_changed:true,table_formatting_changed:true,table_reflow:{root_table_id:root.id,tables:changes.reverse(),pagination:'reader_recomputed_line_split',stored_heights:'conservative_growing_minima',cell_alignment:'preserved',nested_host_layout:'anchor_order_vertical_stack_below_prefix',native_layout_verified:false},layout_verified:false};
}
