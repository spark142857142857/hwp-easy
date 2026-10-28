/** Explicit whole-root table flow. Never infer clipping freedom from WASM pages. */
import {contentFitRows} from './local_table_row_heights.mjs';
import {inspectLocalComplex,hasLocalComplexContent} from './local_complex.mjs';
import {standardBlockId,trackPositions} from './local_complex_table.mjs';
import {objectFlow as commonObjectFlow,validObjectHeader} from './local_flow_records.mjs';
import {view,equal,equalBytes,fail} from './local_complex_records.mjs';
import {publishVerifiedPatch} from './local_verified_patch.mjs';
import {invalidateSectionLayout} from './local_layout_cache.mjs';
import {createNaturalTextMeasurer} from './local_font_measure.mjs';
import {tableParagraphHeight as paragraphHeight} from './local_table_text_metrics.mjs';
import {tableHostParagraphHeight,inlineTableHostObject} from './local_table_host_controls.mjs';
import {GuardError} from './guard/records.mjs';
import {flowTableFloating,bodyFloatingObjects} from './local_table_floating.mjs';
import {hostRoots,rootForest,normalizeTableHosts} from './local_table_hosts.mjs';
import {digest as digestForHost} from './local_file.mjs';

const objectFlow=r=>{if(r.payload.length>=44)return commonObjectFlow(r);if(r.payload.length!==42)fail('TABLE_REFLOW_HEADER_UNSUPPORTED');const p=new Uint8Array(44);p.set(r.payload);return commonObjectFlow({...r,payload:p});};
const tableHeader=p=>p.length>=42&&(p.length===42+2*view(p).getUint16(40,true)||validObjectHeader(p));
const prevention=p=>validObjectHeader(p)?view(p).getUint32(40,true):null;
const target=(id,version)=>`hwp5:${version}:${Buffer.from(id).toString('base64url')}`;
export function tableFlowDescriptor(state,t){
 const rs=state.recordSets.get(t.section);if(!tableHeader(rs[t.record_index].payload))fail('TABLE_REFLOW_HEADER_UNSUPPORTED');const p=view(rs[t.record_index].payload),flags=view(rs[t.table_record].payload).getUint32(0,true);
 return {id:t.id,dimensions:t.dimensions,properties:t.properties,flow:objectFlow(rs[t.record_index]),pagination:{pageBreak:flags&3,repeatHeader:Boolean(flags&4),sizeProtected:Boolean(p.getUint32(4,true)&(1<<20)),preventPageBreak:prevention(rs[t.record_index].payload)}};
}
export function tableReflowContexts(state,version){
 return state.tables.filter(t=>!t.cell_path.length).filter((t,i,all)=>all.findIndex(r=>r.section===t.section&&r.parent_id===t.parent_id)===i).map(root=>{try{
  const first=root.cells[0]?.blocks[0];if(!first?.text_mapping_verified)fail('TABLE_REFLOW_ROOT_UNVERIFIED');if(first.text.length>10000)fail('TABLE_REFLOW_PARAGRAPH_PROFILE_UNSUPPORTED');
  const roots=hostRoots(state,root);return {root_table_id:root.id,...(roots.length>1?{root_table_ids:roots.map(t=>t.id)}:{}),scope:roots.length>1?'whole_body_host_forest':'whole_root_tree',target_id:target(first.id,version),expected_old:first.text,
   expected_tables:rootForest(state,roots).map(t=>tableFlowDescriptor(state,t))};
 }catch(error){if(!(error instanceof GuardError))throw error;return {root_table_id:root.id,read_only_reason:error.code};}});
}
function pads(state,t,c){const p=view(state.recordSets.get(t.section)[c.start].payload);return p.getUint32(4,true)&0x10000?[24,26,28,30].map(i=>p.getUint16(i,true)):['paddingLeft','paddingRight','paddingTop','paddingBottom'].map(k=>t.properties[k]);}
export function tablePaginationEnabled(state,t){
 if(!t)return false;
 const host=state.blocks.find(b=>b.id===t.parent_id),parent=host&&state.tables.find(p=>p.cells.some(c=>c.blocks.some(b=>b.id===host.id))),rs=state.recordSets.get(t.section),p=rs[t.record_index]?.payload;
 if(!p||!tableHeader(p))return false;const f=objectFlow(rs[t.record_index]),v=view(p),flags=view(rs[t.table_record].payload).getUint32(0,true);
 return !f.treatAsChar&&f.textWrap===0&&[0,1].includes(f.textFlow)&&f.vertRelTo===2&&f.horzRelTo===2&&!f.vertAlign&&!f.horzAlign&&!(v.getUint32(4,true)&(1<<20))&&!prevention(p)&&(flags&3)===2&&(!t.cell_path.length||Boolean(parent&&tablePaginationEnabled(state,parent)));
}
function reflowSingle(HwpDocument,source,version,op,blockFlow=false,selectedRoots=[],deferFloating=false){
 if(op.type!=='reflow_table'||!equal(Object.keys(op).sort(),['type','target_id','expected_old','expected_tables',...['floating_page_breaks','row_height_policy'].filter(k=>Object.hasOwn(op,k))].sort()))fail('INVALID_OPERATION');
 if(Object.hasOwn(op,'floating_page_breaks')&&!['preserve','recompute_managed'].includes(op.floating_page_breaks))fail('INVALID_OPERATION');
 if(Object.hasOwn(op,'row_height_policy')&&!['preserve','content_fit'].includes(op.row_height_policy))fail('INVALID_OPERATION');
 if(typeof op.target_id!=='string'||!op.target_id.startsWith(`hwp5:${version}:`))fail('VERSION_CONFLICT');const encoded=op.target_id.slice(70),id=Buffer.from(encoded,'base64url').toString();if(!id||Buffer.from(id).toString('base64url')!==encoded)fail('INVALID_TARGET');
 const state=inspectLocalComplex(HwpDocument,source,{includeDocumentInfo:false}),b=state.blocks.find(b=>b.id===id||standardBlockId(b)===id);if(!b?.text_mapping_verified||!b.cell_path.length)fail('TABLE_CELL_REQUIRED');if(b.text!==op.expected_old)fail('EXPECTED_OLD_MISMATCH');
 const root=state.tables.find(t=>!t.cell_path.length&&t.section===b.section&&t.record_index<b.record_index&&t.end>b.record_index);if(!root)fail('TABLE_REFLOW_ROOT_UNVERIFIED');
 const tables=state.tables.filter(t=>t.section===root.section&&t.record_index>=root.record_index&&t.end<=root.end);if(!equal(op.expected_tables,tables.map(t=>tableFlowDescriptor(state,t))))fail('EXPECTED_TABLE_FLOW_MISMATCH');
 if(tables.length>16||tables.some(t=>t.cell_path.length>2||!t.layout_editable||t.dimensions.rowCount>32||t.dimensions.colCount>16||t.properties.cellSpacing))fail('TABLE_REFLOW_PROFILE_UNSUPPORTED');
 if(tables.flatMap(t=>t.cells.flatMap(c=>c.blocks)).reduce((n,b)=>n+b.text.length,0)>100000)fail('TABLE_REFLOW_TEXT_LIMIT');
 const rs=state.recordSets.get(b.section),pages=rs.filter(r=>r.tag===73),cols=rs.filter(r=>r.tag===71&&Buffer.from(r.payload.subarray(0,4)).toString()==='dloc');
 if(pages.length!==1||pages[0].payload.length!==40||view(pages[0].payload).getUint32(36,true)!==0||cols.length!==1||cols[0].payload.length<8)fail('TABLE_REFLOW_PAGE_PROFILE_UNSUPPORTED');
 const page=view(pages[0].payload),columnFlags=view(cols[0].payload).getUint16(4,true),columnCount=(columnFlags>>>2)&255;let bodyWidth=page.getUint32(0,true)-[8,12,32].reduce((n,i)=>n+page.getUint32(i,true),0),bodyHeight=page.getUint32(4,true)-[16,20,24,28].reduce((n,i)=>n+page.getUint32(i,true),0);
 if(columnCount!==1){if(columnCount<2||columnCount>4||!(columnFlags&4096)||(columnFlags&~0x13fd)||bodyFloatingObjects(state,b.section).length)fail('TABLE_REFLOW_PAGE_PROFILE_UNSUPPORTED');bodyWidth=(bodyWidth-view(cols[0].payload).getUint16(6,true)*(columnCount-1))/columnCount;}
 if(bodyWidth<=0||bodyHeight<7200||root.properties.tableWidth>bodyWidth)fail('TABLE_REFLOW_PAGE_PROFILE_UNSUPPORTED');
 // A body host still selects one root. Nested hosts may contain several tables;
 // explicit reflow stacks them below the prefix in their original anchor order.
 const hosts=new Map(tables.map(t=>[t.id,state.blocks.find(b=>b.id===t.parent_id)]));
 const patches=new Map(),heights=new Map(),changes=[],measure=createNaturalTextMeasurer(HwpDocument,source),hostPeers=new Map();
 const rootHost=hosts.get(root.id);if(!rootHost?.unit_styles||!Array.isArray(rootHost.character_runs)||rootHost.text.includes('\n')||rootHost.text.length>120||measure(rootHost.text,rootHost.character_runs).reduce((n,w)=>n+w*75,0)>bodyWidth*.9)fail('TABLE_REFLOW_ROOT_PREFIX_UNVERIFIED');
 for(const other of state.tables.filter(t=>t.section===root.section&&!t.cell_path.length&&t!==root))if(!objectFlow(rs[other.record_index]).treatAsChar&&!selectedRoots.includes(other.id)&&!tablePaginationEnabled(state,other))fail('TABLE_REFLOW_OTHER_FLOATING_TABLE_UNSUPPORTED');
 const patch=i=>{if(!patches.has(i))patches.set(i,rs[i].payload.slice());return view(patches.get(i));};
 const floatingCandidates=bodyFloatingObjects(state,b.section);
 for(const t of [...tables].reverse()){
  const xs=trackPositions(t,'col');if(xs.at(-1)!==t.properties.tableWidth||t.cells.some(c=>xs[c.col]===null||xs[c.col+c.colSpan]===null||xs[c.col+c.colSpan]-xs[c.col]!==c.width))fail('TABLE_REFLOW_COLUMN_GEOMETRY_UNVERIFIED');
  const host=hosts.get(t.id),h=rs[t.record_index].payload;if(!host?.text_mapping_verified||!tableHeader(h))fail('TABLE_REFLOW_ANCHOR_UNVERIFIED');const old=objectFlow(rs[t.record_index]);if(old.widthRelTo!==4||old.heightRelTo!==2)fail('TABLE_REFLOW_PROFILE_UNSUPPORTED');
  const anchors=host.tokens.filter(x=>x.code===11),peers=state.tables.filter(x=>x.parent_id===host.id).sort((a,b)=>a.record_index-b.record_index),controls=rs.slice(host.record_index+1,host.records_end).filter(r=>r.tag===71&&r.level===host.raw_level+1&&(t.cell_path.length||!['dces','dloc'].includes(Buffer.from(r.payload.subarray(0,4)).toString())));
  if(!anchors.length||anchors.length!==peers.length||controls.length!==peers.length||controls.some((r,i)=>r!==rs[peers[i].record_index])||anchors.some(x=>Buffer.from(rs[host.text_record].payload.subarray(x.unit*2+2,x.unit*2+6)).toString()!==' lbt')||host.tokens.some(x=>x.unit>anchors[0].unit&&x.text)||host.tokens.some(x=>!x.text&&![2,11,13].includes(x.code))||!t.cell_path.length&&peers.length!==1)fail('TABLE_REFLOW_ANCHOR_UNVERIFIED');
  hostPeers.set(host.id,peers);
  // A merged cell constrains the sum of its rows, not each row separately.
  // By default retain recoverable tracks and satisfy shorter spans first.
  // Assigning only the deficit to the final row preserves earlier boundaries
  // and makes a second synchronization byte-for-byte idempotent.
  let oldRows;try{const ys=trackPositions(t,'row');if(ys.every(n=>n!==null))oldRows=ys.slice(1).map((n,i)=>n-ys[i]);}catch(error){if(!(error instanceof GuardError))throw error;}
  if(oldRows?.some(n=>n<=0))fail('TABLE_REFLOW_ROW_GEOMETRY_UNVERIFIED');
  const compact=op.row_height_policy==='content_fit',constraints=[];let rows=oldRows??Array(t.dimensions.rowCount).fill(1);
  for(const c of t.cells){
   const flags=view(rs[c.start].payload).getUint32(4,true),padding=pads(state,t,c),width=c.width-padding[0]-padding[1];if((flags&0x1f)!==0||((flags>>>5)&3)>2||width<=0)fail('TABLE_REFLOW_CELL_PROFILE_UNSUPPORTED');
   let needed=padding[2]+padding[3];
   for(const paragraph of c.blocks){
    const child=tables.filter(x=>x.parent_id===paragraph.id);
    needed+=tableHostParagraphHeight(state,paragraph,width,measure,paragraphHeight);
    for(let at=paragraph.record_index+1;at<paragraph.records_end;at++)if(rs[at].tag===71&&rs[at].level===paragraph.raw_level+1&&Buffer.from(rs[at].payload.subarray(0,4)).toString()===' osg'){const p=patch(at);p.setUint32(4,p.getUint32(4,true)|4,true);}
    for(const ch of child){const f=objectFlow(rs[ch.record_index]);if(ch.properties.tableWidth+f.marginLeft+f.marginRight>width)fail('TABLE_REFLOW_CHILD_WIDTH_UNSUPPORTED');needed+=heights.get(ch.id)+f.marginTop+f.marginBottom;}
   }
   needed=Math.max(compact?100:c.height,Math.ceil(needed));if(needed>720000)fail('TABLE_REFLOW_HEIGHT_LIMIT');
   constraints.push({row:c.row,span:c.rowSpan,needed});
  }
  if(compact)rows=contentFitRows(t.dimensions.rowCount,constraints);
  else for(const c of constraints.sort((a,b)=>a.span-b.span||a.row-b.row)){
   const current=rows.slice(c.row,c.row+c.span).reduce((n,h)=>n+h,0);
   rows[c.row+c.span-1]+=Math.max(0,c.needed-current);
  }
  const height=rows.reduce((a,n)=>a+n,0);if(height>720000||height/bodyHeight>12)fail('TABLE_REFLOW_HEIGHT_LIMIT');heights.set(t.id,height);
  for(const c of t.cells)patch(c.start).setUint32(20,rows.slice(c.row,c.row+c.rowSpan).reduce((n,h)=>n+h,0),true);
  const p=patch(t.record_index),mask=1|4|(3<<3)|(7<<5)|(3<<8)|(7<<10)|(1<<13)|(1<<14)|(1<<20)|(7<<21)|(3<<24);
  p.setUint32(4,((p.getUint32(4,true)&~mask)|(2<<3)|(2<<8)|8192|((blockFlow||floatingCandidates.length||old.textFlow===1?1:0)<<24))>>>0,true);p.setInt32(12,0,true);p.setUint32(20,height,true);if(validObjectHeader(h))p.setUint32(40,0,true);
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
 const flowHeights=new Map(state.tables.filter(t=>!t.cell_path.length&&t.section===b.section&&(heights.has(t.id)||tablePaginationEnabled(state,t))).map(t=>[t.id,heights.get(t.id)??t.properties.tableHeight]));
 const floatingFlow=deferFloating?{objects:[],docInfo:state.raw.streams.get('DocInfo')}:flowTableFloating(state,b.section,bodyWidth,bodyHeight,patch,flowHeights,measure,paragraphHeight,op.floating_page_breaks==='recompute_managed'),floating=floatingFlow.objects,floatingIndices=new Set((deferFloating?floatingCandidates:floating).map(o=>o.record_index));
 // Verified inline objects occupy separate paragraphs. Independent floating
 // groups/opaque drawings still require a protected fixed region.
 for(const object of [...state.text_boxes,...state.pictures,...state.groups,...state.opaque_drawings]){
  if(object.section!==b.section||floatingIndices.has(object.record_index))continue;const f=object.flow;const host=state.blocks.find(b=>b.id===object.block_id);if(f.treatAsChar){const inline=inlineTableHostObject(state,host,object.record_index),container=state.tables.flatMap(t=>t.cells.map(c=>({t,c}))).find(({c})=>c.blocks.includes(host)),padding=container?pads(state,container.t,container.c):[],available=container?container.c.width-padding[0]-padding[1]:bodyWidth;if((!f.affectLineSpacing&&!((patches.has(object.record_index)?view(patches.get(object.record_index)).getUint32(4,true):0)&4))||inline.width>available||inline.height+1000>bodyHeight||host.text||host.tokens.filter(t=>t.code===11).length!==1)fail('TABLE_HOST_OBJECT_FLOW_UNVERIFIED');continue;}if((object.cell_path??host?.cell_path??[]).length||f.vertRelTo>1)fail('TABLE_REFLOW_FLOATING_CONTROL_UNSUPPORTED');
  const p=object.properties,bottom=p.vertOffset+Math.max(p.height,0)+f.marginBottom,bodyBottom=page.getUint32(4,true)-page.getUint32(20,true)-page.getUint32(28,true),bodyTop=page.getUint32(16,true)+page.getUint32(24,true);
  if(f.vertRelTo!==0||f.vertAlign!==0||!(p.vertOffset-f.marginTop>=bodyBottom||bottom<=bodyTop))fail('TABLE_REFLOW_FIXED_REGION_UNPROTECTED');
 }
 const changed=[...patches].some(([i,p])=>!equalBytes(rs[i].payload,p));if(!changed)return {bytes:source,content_verified:true,raw_preservation_verified:true,unchanged:true,layout_verified:false};
 const records=invalidateSectionLayout(rs.map((r,i)=>patches.has(i)?{...r,payload:patches.get(i)}:r),state.blocks.filter(b=>b.section===root.section)),bytes=publishVerifiedPatch(source,state,b.section,records,floatingFlow.docInfo),after=inspectLocalComplex(HwpDocument,bytes,{includeDocumentInfo:false,verifyCharacterModel:false});
 if(!equal(state.blocks.map(b=>[b.id,b.text,b.unit_styles]),after.blocks.map(b=>[b.id,b.text,b.unit_styles]))||!equal(state.fields,after.fields)||tables.some(t=>!tablePaginationEnabled(after,after.tables.find(n=>n.id===t.id))))fail('TABLE_REFLOW_PRESERVATION_MISMATCH');
 return {bytes,content_verified:true,raw_preservation_verified:true,raw_preservation_scope:'selected_table_flow_heights_inline_spacing_floating_common_flags_offsets_and_own_host_paragraph_shapes_with_page_isolation; original_definitions_text_character_styles_widths_margins_borders_binary_data_other_controls_and_streams_preserved',flow_changed:true,table_formatting_changed:true,table_reflow:{root_table_id:root.id,tables:changes.reverse(),pagination:'reader_recomputed_line_split',stored_heights:op.row_height_policy==='content_fit'?'explicit_content_fit':'conservative_growing_minima',cell_alignment:'preserved',nested_host_layout:'anchor_order_vertical_stack_below_prefix',floating_objects:floating,floating_layout:'separate_empty_body_anchor_top_bottom_reserved_fixed_line; reuse_conservative_page_space_or_start_new_page; floating_state_preserved',native_layout_verified:false},layout_verified:false};
}
/** Normalize interleaved hosts only after validating the complete caller scope.
 * All intermediate bytes remain in memory until the caller's one guarded save. */
export function reflowTableLocal(HwpDocument,source,version,op){
 if(op.type!=='reflow_table'||!equal(Object.keys(op).sort(),['type','target_id','expected_old','expected_tables',...['floating_page_breaks','row_height_policy'].filter(k=>Object.hasOwn(op,k))].sort()))fail('INVALID_OPERATION');
 if(Object.hasOwn(op,'floating_page_breaks')&&!['preserve','recompute_managed'].includes(op.floating_page_breaks))fail('INVALID_OPERATION');
 if(Object.hasOwn(op,'row_height_policy')&&!['preserve','content_fit'].includes(op.row_height_policy))fail('INVALID_OPERATION');
 if(typeof op.target_id!=='string'||!op.target_id.startsWith(`hwp5:${version}:`))fail('VERSION_CONFLICT');const encoded=op.target_id.slice(70),id=Buffer.from(encoded,'base64url').toString();if(Buffer.from(id).toString('base64url')!==encoded)fail('INVALID_TARGET');
 const state=inspectLocalComplex(HwpDocument,source,{includeDocumentInfo:false}),b=state.blocks.find(b=>b.id===id||standardBlockId(b)===id);if(!b?.cell_path.length)fail('TABLE_CELL_REQUIRED');if(b.text!==op.expected_old)fail('EXPECTED_OLD_MISMATCH');const root=state.tables.find(t=>!t.cell_path.length&&t.section===b.section&&t.record_index<b.record_index&&t.end>b.record_index);if(!root)fail('TABLE_REFLOW_ROOT_UNVERIFIED');
 const roots=hostRoots(state,root),forest=rootForest(state,roots);if(!equal(op.expected_tables,forest.map(t=>tableFlowDescriptor(state,t))))fail('EXPECTED_TABLE_FLOW_MISMATCH');if(forest.length>16)fail('TABLE_REFLOW_PROFILE_UNSUPPORTED');if(forest.flatMap(t=>t.cells.flatMap(c=>c.blocks)).reduce((n,b)=>n+b.text.length,0)>100000)fail('TABLE_REFLOW_TEXT_LIMIT');
 if(new Set(roots.map(t=>Buffer.from(state.recordSets.get(t.section)[t.record_index].payload.subarray(36,40)).toString('hex'))).size!==roots.length)fail('TABLE_AUTO_SYNC_IDENTITY_UNVERIFIED');
 const prepared=normalizeTableHosts(HwpDocument,source,state,roots);if(!prepared.normalized.length)return reflowSingle(HwpDocument,source,version,op);
 let bytes=prepared.bytes,current=prepared.state;const results=[];
 for(const [rootIndex,rootId] of prepared.root_ids.entries()){const version=digestForHost(bytes),context=tableReflowContexts(current,version).find(c=>c.root_table_id===rootId);if(!context?.target_id)fail('TABLE_HOST_CONTEXT_UNVERIFIED');const result=reflowSingle(HwpDocument,bytes,version,{type:'reflow_table',target_id:context.target_id,expected_old:context.expected_old,expected_tables:context.expected_tables,...Object.fromEntries(['floating_page_breaks','row_height_policy'].filter(k=>Object.hasOwn(op,k)).map(k=>[k,op[k]]))},true,prepared.root_ids,rootIndex<prepared.root_ids.length-1);bytes=result.bytes;results.push(result);current=inspectLocalComplex(HwpDocument,bytes,{includeDocumentInfo:false,verifyCharacterModel:false});}
 const remap={...prepared.remap};if(!hasLocalComplexContent(current.raw))for(const [old,id]of Object.entries(remap)){const block=current.blocks.find(b=>b.id===id);if(block)remap[old]=standardBlockId(block);}
 return {bytes,content_verified:true,raw_preservation_verified:true,raw_preservation_scope:'explicit_host_paragraph_partition_retaining_text_anchor_units_styles_fields_and_control_order_with_inline_line_spacing_then_verified_table_flow',structure_changed:true,paragraph_count_changed:true,flow_changed:true,table_formatting_changed:true,table_reflow:{root_table_id:prepared.root_ids[0],root_table_ids:prepared.root_ids,tables:results.flatMap(r=>r.table_reflow?.tables??[]),host_normalization:'paragraph_segments_around_table_anchors',floating_objects:results.flatMap(r=>r.table_reflow?.floating_objects??[]),inline_object_layout:'own_paragraph_with_line_spacing_influence',field_ranges_remapped:true,normalized_hosts:prepared.normalized,pagination:'reader_recomputed_line_split',stored_heights:op.row_height_policy==='content_fit'?'explicit_content_fit':'conservative_growing_minima',native_layout_verified:false},_target_remap:remap,layout_verified:false};
}
