/** Selected automatic flow settings; raw content and opaque controls stay intact. */
import {deflateRawSync} from 'node:zlib';
import {parseRecords} from './guard/records.mjs';
import {inspectLocalComplex} from './local_complex.mjs';
import {standardBlockId} from './local_complex_table.mjs';
import {definitionBytes} from './local_complex_format.mjs';
import {patchLocalPackedStreams} from './local_container_write.mjs';
import {fail,view,equal,equalBytes,encodeRecords} from './local_complex_records.mjs';
import {objectFlow} from './local_flow_records.mjs';
import {cellContainer} from './local_layout.mjs';
import {invalidateSectionLayout} from './local_layout_cache.mjs';
export {invalidateSectionLayout} from './local_layout_cache.mjs';

export function reflowLocal(HwpDocument,source,version,op){
 const object=op.type==='reflow_object',keys=['type','target_id','expected_old',object?'expected_flow':'expected_properties',...(object?['expected_properties']:[]),...(Object.hasOwn(op,'picture_index')?['picture_index']:[])];
 if(!['reflow_object','reflow_paragraph'].includes(op.type)||!equal(Object.keys(op).sort(),keys.sort())||!object&&Object.hasOwn(op,'picture_index'))fail('INVALID_OPERATION');
 if(typeof op.target_id!=='string'||!op.target_id.startsWith(`hwp5:${version}:`))fail('VERSION_CONFLICT');const encoded=op.target_id.slice(70),id=Buffer.from(encoded,'base64url').toString('utf8');if(!id||Buffer.from(id).toString('base64url')!==encoded)fail('INVALID_TARGET');
 const state=inspectLocalComplex(HwpDocument,source,{includeDocumentInfo:false,verifyCharacterModel:false}),group=state.groups.find(g=>g.id===id),b=state.blocks.find(b=>b.id===(group?.block_id??id)||standardBlockId(b)===id);
 if(!b?.text_mapping_verified)fail('TARGET_NOT_EDITABLE');if(op.expected_old!==b.text)fail('EXPECTED_OLD_MISMATCH');let records=state.recordSets.get(b.section),docInfo=state.raw.streams.get('DocInfo');
 const container=cellContainer(state,b);if(container&&(view(records[container.cell.start].payload).getUint32(4,true)&7)!==0)fail('REFLOW_VERTICAL_LIST_UNSUPPORTED');
 if(object){
  if(group&&Object.hasOwn(op,'picture_index'))fail('INVALID_OPERATION');const candidates=state.pictures.filter(p=>p.block_id===b.id),selected=group??(Object.hasOwn(op,'picture_index')?candidates.find(p=>p.picture_index===op.picture_index):candidates.length===1?candidates[0]:null);
  if(!selected||Object.hasOwn(op,'picture_index')&&!Number.isSafeInteger(op.picture_index))fail('PICTURE_INDEX_REQUIRED');
  if(!equal(op.expected_properties,selected.properties)||!equal(op.expected_flow,objectFlow(records[selected.record_index])))fail('EXPECTED_OBJECT_FLOW_MISMATCH');
  const payload=records[selected.record_index].payload.slice(),p=view(payload),flow=objectFlow(records[selected.record_index]);if(flow.widthRelTo!==4||flow.heightRelTo!==2)fail('ABSOLUTE_OBJECT_REQUIRED');
  const page=records.find(r=>r.tag===73);if(!page||page.payload.length<40||view(page.payload).getUint32(36,true)!==0)fail('REFLOW_PAGE_PROFILE_UNSUPPORTED');
  if(!container&&records.some(r=>r.tag===71&&Buffer.from(r.payload.subarray(0,4)).toString('ascii')==='dloc'&&(r.payload.length<6||((view(r.payload).getUint16(4,true)>>>2)&255)!==1)))fail('REFLOW_MULTI_COLUMN_PROFILE_UNSUPPORTED');
  // A whole floating object cannot split across pages. Do not silently scale it.
  const v=view(page.payload),parent=cellContainer(state,b),width=parent?.width??v.getUint32(0,true)-v.getUint32(8,true)-v.getUint32(12,true)-v.getUint32(32,true),height=v.getUint32(4,true)-v.getUint32(16,true)-v.getUint32(20,true)-v.getUint32(24,true)-v.getUint32(28,true);
  const props=selected.properties,w=props.width,h=props.height;
  if(width<=0||height<=0||w+flow.marginLeft+flow.marginRight>width||h+flow.marginTop+flow.marginBottom>height)fail('OBJECT_TOO_LARGE_FOR_FLOW');
  // Inline consumes real line height and moves with its anchor across pages.
  // Native top/bottom floating groups can hide their own anchor paragraph.
  const mask=1|4|(3<<3)|(7<<5)|(3<<8)|(7<<10)|(1<<13)|(1<<14)|(7<<21)|(3<<24);
  p.setUint32(4,((p.getUint32(4,true)&~mask)|1|4|(2<<3)|(2<<8)|(1<<13)|(3<<21))>>>0,true);p.setInt32(8,0,true);p.setInt32(12,0,true);
  records=records.map((r,i)=>i===selected.record_index?{...r,payload}:r);
 }else{
  if(group||!b.paragraph_format_editable||!equal(op.expected_properties,b.paragraph_properties))fail('EXPECTED_PARAGRAPH_PROPERTIES_MISMATCH');
  const defs=[...parseRecords(docInfo)],shapes=defs.filter(r=>r.tag===25),maps=defs.filter(r=>r.tag===17),old=shapes[b.paragraph_properties.paraShapeId];
  if(maps.length!==1||maps[0].payload.length<56||view(maps[0].payload).getUint32(52,true)!==shapes.length||shapes.length>=65535)fail('FORMAT_DEFINITION_MISMATCH');
  const wanted=old.payload.slice(),p=view(wanted),spacing=b.paragraph_properties.lineSpacingType===0?Math.max(100,Math.min(1000,b.paragraph_properties.lineSpacing)):160;
  if(p.getUint32(42,true)&0x1c0)fail('REFLOW_LEGACY_BREAK_PROFILE_UNSUPPORTED');
  p.setUint32(0,((p.getUint32(0,true)&~(3|(1<<17)|(1<<18)))|(1<<16)|(1<<22))>>>0,true);p.setInt32(24,spacing,true);
  if(wanted.length>=54){p.setUint32(46,p.getUint32(46,true)&~31,true);p.setInt32(50,spacing,true);}
  let shapeId=shapes.findIndex(r=>equalBytes(r.payload,wanted));if(shapeId<0){shapeId=shapes.length;const map=maps[0].payload.slice();view(map).setUint32(52,shapes.length+1,true);docInfo=definitionBytes(docInfo,defs,new Map([[maps[0].index,map]]),new Map([[shapes.at(-1).index,[{tag:25,level:shapes.at(-1).level,payload:wanted}]]]));}
  const payload=records[b.record_index].payload.slice();view(payload).setUint16(8,shapeId,true);records=records.map((r,i)=>i===b.record_index?{...r,payload}:r);
 }
 records=invalidateSectionLayout(records,state.blocks.filter(x=>x.section===b.section));const name=`BodyText/Section${b.section}`,body=encodeRecords(records),compressed=Boolean(view(state.raw.streams.get('FileHeader')).getUint32(36,true)&1),changes=new Map();
 for(const [key,wanted] of [[name,body],['DocInfo',docInfo]])if(!equalBytes(wanted,state.raw.streams.get(key)))changes.set(key,compressed?deflateRawSync(wanted,{level:9}):wanted);
 if(!changes.size)return {bytes:source,content_verified:true,raw_preservation_verified:true,unchanged:true,layout_verified:false};
 const bytes=patchLocalPackedStreams(source,changes),after=inspectLocalComplex(HwpDocument,bytes,{includeDocumentInfo:false,verifyCharacterModel:false});
 for(const [key,old] of state.raw.streams)if(!equalBytes(after.raw.streams.get(key),key===name?body:key==='DocInfo'?docInfo:old))fail('REFLOW_PRESERVATION_MISMATCH');
 if(!equal(state.blocks.map(b=>[b.id,b.text]),after.blocks.map(b=>[b.id,b.text]))||!equal(state.fields,after.fields))fail('REFLOW_CONTENT_MISMATCH');
 return {bytes,content_verified:true,raw_preservation_verified:true,raw_preservation_scope:'selected_flow_settings_and_mapped_section_line_caches; text_character_styles_images_other_controls_and_other_streams_exact',flow_changed:true,...(object?{object_flow:'inline; size_and_anchor_text_order_preserved'}:{}),paragraph_formatting_changed:!object,picture_changed:object&&!group,picture_group_changed:object&&Boolean(group),layout_verified:false,pagination:'recomputed_by_reader; explicit_page_breaks_preserved'};
}
