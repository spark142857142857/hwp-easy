/** Whole-body flow for independent, bounded floating pictures/plain boxes. */
import {fail,view,equalBytes} from './local_complex_records.mjs';
import {parseRecords} from './guard/records.mjs';
import {definitionBytes} from './local_complex_format.mjs';
import {inlineTableHostObject} from './local_table_host_controls.mjs';
import {tablePageSpace} from './local_table_page_space.mjs';

export function bodyFloatingObjects(state,section){
 const rs=state.recordSets.get(section),page=view(rs.find(r=>r.tag===73).payload),top=page.getUint32(16,true)+page.getUint32(24,true),bottom=page.getUint32(4,true)-page.getUint32(20,true)-page.getUint32(28,true);
 return [...state.pictures,...state.text_boxes].filter(o=>o.section===section&&!o.flow.treatAsChar).filter(o=>!(o.flow.vertRelTo===0&&!o.flow.vertAlign&&(o.properties.vertOffset-o.flow.marginTop>=bottom||o.properties.vertOffset+o.properties.height+o.flow.marginBottom<=top))).sort((a,b)=>a.record_index-b.record_index);
}
export function flowTableFloating(state,section,bodyWidth,bodyHeight,patch,rootHeights,measure,plainHeight,recompute=false){
 const moved=[],rs=state.recordSets.get(section),roots=state.tables.filter(t=>t.section===section&&!t.cell_path.length),stream=state.raw.streams.get('DocInfo'),defs=[...parseRecords(stream)],shapes=defs.filter(r=>r.tag===25),maps=defs.filter(r=>r.tag===17),added=[],space=tablePageSpace(state,section,bodyWidth,bodyHeight,rootHeights,measure,plainHeight);
 for(const object of bodyFloatingObjects(state,section)){
  if(object.section!==section||object.flow.treatAsChar)continue;
  const b=state.blocks.find(b=>b.id===object.block_id),f=object.flow,p=object.properties;
  // Paper-fixed header/footer frames are protected by the caller, never moved.
  const page=view(rs.find(r=>r.tag===73).payload),top=page.getUint32(16,true)+page.getUint32(24,true),bottom=page.getUint32(4,true)-page.getUint32(20,true)-page.getUint32(28,true);
  if(f.vertRelTo===0&&!f.vertAlign&&(p.vertOffset-f.marginTop>=bottom||p.vertOffset+p.height+f.marginBottom<=top))continue;
  if(!b?.text_mapping_verified||b.cell_path.length||b.text||b.tokens.some(t=>![11,13].includes(t.code))||b.tokens.filter(t=>t.code===11).length!==1||!roots.some(t=>t.end<=b.record_index)||f.horzRelTo!==2||f.vertRelTo>2||f.horzAlign||f.vertAlign||p.horzOffset<f.marginLeft||p.horzOffset+p.width+f.marginRight>bodyWidth||p.height+f.marginTop+f.marginBottom+2000>bodyHeight)fail('TABLE_FLOATING_FLOW_PROFILE_UNSUPPORTED');
  const controls=rs.slice(b.record_index+1,b.records_end).filter(r=>r.tag===71&&r.level===b.raw_level+1);
  if(controls.length!==1||controls[0]!==rs[object.record_index])fail('TABLE_FLOATING_FLOW_PROFILE_UNSUPPORTED');
  // Reuse the verified picture/plain box geometry and internal text bounds.
  const key=object.paragraphs?'text_boxes':'pictures',clone={...object,flow:{...f,treatAsChar:true},properties:{...p,horzOffset:0,vertOffset:0}};
  inlineTableHostObject({...state,[key]:state[key].map(o=>o===object?clone:o)},b,object.record_index);
  if(rs[b.record_index].payload[11])fail('TABLE_FLOATING_HOST_UNVERIFIED');
  const props=b.paragraph_properties,reserve=Math.max(p.height+f.marginTop+f.marginBottom+2000,...b.character_runs.map(r=>Math.ceil(r.properties.fontSize*1.8)));if(reserve>bodyHeight-3600||![0,1].includes(props.lineSpacingType)||props.lineSpacingType===0&&(props.lineSpacing<100||props.lineSpacing>300)||props.keepLines||props.keepWithNext||props.fontLineHeight||['marginLeft','marginRight','indent','spacingBefore','spacingAfter'].some(k=>props[k]))fail('TABLE_FLOATING_HOST_UNVERIFIED');
  // Only explicitly requested recomputation may remove an existing break on
  // an exact managed empty-anchor profile. Ordinary authored breaks remain.
  const mask=1|4|(3<<3)|(7<<5)|(3<<8)|(7<<10)|8192|16384|(7<<21)|(3<<24),canonical=(2<<3)|(2<<8)|8192|(3<<21)|(1<<24),managed=props.lineSpacingType===1&&props.lineSpacing===reserve*2&&(view(rs[object.record_index].payload).getUint32(4,true)&mask)===canonical&&p.vertOffset===0;
  space.before(b);const placement=space.reserve(reserve,props.pageBreakBefore&&!(recompute&&managed)),newPage=placement.newPage;
  const wanted=shapes[props.paraShapeId].payload.slice(),shape=view(wanted);shape.setUint32(0,((shape.getUint32(0,true)&~(3|(1<<19)))|1|(newPage?1<<19:0))>>>0,true);shape.setInt32(24,reserve*2,true);if(wanted.length>=54){shape.setUint32(46,(shape.getUint32(46,true)&~31)|1,true);shape.setInt32(50,reserve*2,true);}
  let shapeId=[...shapes.map(r=>r.payload),...added].findIndex(p=>equalBytes(p,wanted));if(shapeId<0){shapeId=shapes.length+added.length;if(shapeId>=65535)fail('FORMAT_DEFINITION_MISMATCH');added.push(wanted);}patch(b.record_index).setUint16(8,shapeId,true);
  const v=patch(object.record_index),before={flags:v.getUint32(4,true),vertOffset:v.getInt32(8,true)};
  v.setUint32(4,((before.flags&~mask)|(2<<3)|(2<<8)|8192|(3<<21)|(1<<24))>>>0,true);v.setInt32(8,0,true);
  moved.push({block_id:b.id,kind:key==='pictures'?'picture':'text_box',record_index:object.record_index,reserved_height:reserve,page_break_before:newPage,existing_break_recomputed:Boolean(recompute&&managed&&props.pageBreakBefore&&!newPage),placement_space:placement,before,after:{flags:v.getUint32(4,true),vertOffset:0}});
 }
 if(moved.length>16)fail('TABLE_FLOATING_FLOW_LIMIT');
 if(maps.length!==1||maps[0].payload.length<56||view(maps[0].payload).getUint32(52,true)!==shapes.length)fail('FORMAT_DEFINITION_MISMATCH');
 let docInfo=stream;if(added.length){const payload=maps[0].payload.slice();view(payload).setUint32(52,shapes.length+added.length,true);docInfo=definitionBytes(stream,defs,new Map([[maps[0].index,payload]]),new Map([[shapes.at(-1).index,added.map(payload=>({tag:25,level:shapes.at(-1).level,payload}))]]));}
 return {objects:moved,docInfo};
}
