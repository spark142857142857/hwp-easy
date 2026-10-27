/** Edit structurally addressed object lists without flattening their host document. */
import {inspectParagraphFields} from './local_field_records.mjs';
import {standardBlockId} from './local_complex_table.mjs';
import {inspectLocalComplex} from './local_complex.mjs';
import {fail,equal,spliceRawParagraph} from './local_complex_records.mjs';
import {publishVerifiedPatch} from './local_verified_patch.mjs';
import {prepareComplexCharacterFormat} from './local_complex_format.mjs';
import {prepareComplexParagraphFormat} from './local_complex_paragraph.mjs';
import {prepareComplexBoundary} from './local_complex_boundary.mjs';
import {prepareObjectField} from './local_object_fields.mjs';
import {prepareDrawingTransform} from './local_drawing_transform.mjs';
const inspect=(Doc,bytes)=>inspectLocalComplex(Doc,bytes,{includeDocumentInfo:false,verifyCharacterModel:false});
const fieldsOf=s=>{const raw=s.blocks.flatMap(b=>inspectParagraphFields(s.recordSets.get(b.section),b));return [...s.fields.map(f=>({...f,...raw.find(x=>x.id===f.id),editable:f.editable,...(f.read_only_reason?{read_only_reason:f.read_only_reason}:{})})),...s.additional_fields,...s.object_fields];};
const entities=s=>[...s.blocks,...fieldsOf(s),...s.groups,...s.pictures,...s.text_boxes,...s.text_boxes.flatMap(b=>b.paragraphs),...s.drawing_tree.nodes,...s.opaque_drawings];
function entityRecord(e){return e.shape_record!=null&&(e.address||e.paragraphs)?e.shape_record:e.record_index;}
export function editObjectTarget(Doc,source,version,op){
 if(typeof op.target_id!=='string'||!op.target_id.startsWith(`hwp5:${version}:`))fail('VERSION_CONFLICT');const encoded=op.target_id.slice(70),id=Buffer.from(encoded,'base64url').toString();if(!id||Buffer.from(id).toString('base64url')!==encoded)fail('INVALID_TARGET');
 const isObject=id.includes(':tb')||id.includes(':dg:'),fieldType=['set_field','insert_field','delete_field','update_field'].includes(op.type);if(!isObject&&!fieldType&&!/:f[0-9]+$/.test(id))return null;
 if(!['transform_drawing_group','set_field','insert_field','delete_field','update_field','format_text','format_paragraph','split_paragraph','merge_paragraph','insert_paragraphs','duplicate_paragraph','delete_paragraph','splice_text','replace_text'].includes(op.type))return null;
 const state=inspect(Doc,source),allFields=fieldsOf(state),field=allFields.find(f=>f.id===id),box=state.text_boxes.find(b=>b.paragraphs.some(p=>p.id===(field?.block_id??id))),paragraph=box?.paragraphs.find(p=>p.id===(field?.block_id??id)),node=state.drawing_tree.groups.find(n=>n.id===id),selectedBlock=paragraph??state.blocks.find(b=>b.id===(field?.block_id??id)||standardBlockId(b)===id);
 if(field?.read_only_reason==='FIELD_ID_AMBIGUOUS')fail('FIELD_ID_AMBIGUOUS');
 let block=selectedBlock;
 // Keep the established body/cell ClickHere route and legacy target aliases.
 if(!isObject&&!Object.hasOwn(op,'field_type')&&op.type!=='update_field'&&(!field||field.field_type==='clickhere'))return null;
 if(node){if(op.type!=='transform_drawing_group')fail('DRAWING_GROUP_OPERATION_REQUIRED');if(op.expected_old!==state.blocks.find(b=>b.id===node.block_id)?.text)fail('EXPECTED_OLD_MISMATCH');}
 else{if(!block)fail('INVALID_TARGET');if(!block.text_range_editable)fail('TARGET_NOT_EDITABLE');if(op.expected_old!==(field?.value??block.text))fail('EXPECTED_OLD_MISMATCH');}
 const section=node?.section??block.section,rs=state.recordSets.get(section).map((r,i)=>({...r,_origin:i}));let patch,structure=false;if(block&&block.text_record==null&&!['split_paragraph','merge_paragraph','insert_paragraphs','duplicate_paragraph','delete_paragraph'].includes(op.type)){const at=block.record_index+1;rs.splice(at,0,{tag:67,level:block.raw_level+1,payload:Buffer.from('\r','utf16le')});block={...block,text_record:at,shape_record:block.shape_record+1,records_end:block.records_end+1,text_mapping_verified:true,text_range_editable:true};}
 if(node)patch=prepareDrawingTransform(state,rs,node,op);
 else if(['insert_field','delete_field','update_field'].includes(op.type))patch=prepareObjectField(state,rs,block,field,op);
 else if(op.type==='set_field'){
  if(!field?.editable||!equal(Object.keys(op).sort(),['type','target_id','expected_old','new_text'].sort()))fail('FIELD_TARGET_REQUIRED');patch=spliceRawParagraph(rs,block,field.start,field.end,op.new_text,field);
 }else if(op.type==='format_text'){
  if(!equal(Object.keys(op).sort(),['type','target_id','expected_old','start','end','props'].sort()))fail('INVALID_OPERATION');patch=prepareComplexCharacterFormat(state.raw,rs,block,field,op);
 }else if(op.type==='format_paragraph'){
  if(field||!equal(Object.keys(op).sort(),['type','target_id','expected_old','props'].sort()))fail('INVALID_OPERATION');patch=prepareComplexParagraphFormat(state.raw,rs,block,op);
 }else if(['split_paragraph','merge_paragraph','insert_paragraphs','duplicate_paragraph','delete_paragraph'].includes(op.type)){
  if(field||!box)fail('TEXT_BOX_TARGET_REQUIRED');const paragraphs=box.paragraphs.map(p=>({...p,kind:'cell',text_record:p.text_record??undefined,list_id:box.id,paragraph:0,cell_path:[{controlIndex:0,cellIndex:0,cellParaIndex:p.paragraph}]})),p=paragraphs.find(p=>p.id===id),pseudo={...state,recordSets:new Map(state.recordSets).set(section,rs),blocks:paragraphs,fields:box.paragraphs.flatMap(p=>p.fields??[]),tables:[{cells:[{start:box.list_record,blocks:paragraphs}]}]};patch=prepareComplexBoundary(pseudo,p,op,version);structure=true;
 }else if(['splice_text','replace_text'].includes(op.type)){
  if(field||!paragraph)fail('TEXT_BOX_TARGET_REQUIRED');const replace=op.type==='replace_text',schema=['type','target_id','expected_old','new_text',...(replace?[]:['start','end'])];if(!equal(Object.keys(op).sort(),schema.sort()))fail('INVALID_OPERATION');patch=spliceRawParagraph(rs,block,replace?0:op.start,replace?[...block.text].length:op.end,op.new_text);
 }else return null;
 if(patch.unchanged||patch.wanted===block?.text&&['set_field','splice_text','replace_text'].includes(op.type))return {bytes:source,content_verified:true,raw_preservation_verified:true,unchanged:true,layout_verified:false};
 const bytes=publishVerifiedPatch(source,state,section,patch.records,patch.docInfo),after=inspect(Doc,bytes),remap={};
 const afterEntities=entities(after),afterFields=fieldsOf(after),origins=new Map();patch.records.forEach((r,i)=>{const origin=r.originHeader?r.originHeader._origin:r._origin;if(origin!=null&&origin>=0){if(origins.has(origin))fail('OBJECT_IDENTITY_AMBIGUOUS');origins.set(origin,i);}});
 for(const old of entities(state)){const record=entityRecord(old),next=old.section===section?origins.get(record):record,candidates=afterEntities.filter(n=>n.section===old.section&&entityRecord(n)===next&&((n.address!=null)===(old.address!=null))&&((n.tokens!=null)===(old.tokens!=null))&&((n.field_id!=null)===(old.field_id!=null))&&((n.paragraphs!=null)===(old.paragraphs!=null))&&((n.pictures!=null)===(old.pictures!=null))&&((n.contents_read_only!=null)===(old.contents_read_only!=null)));const same=candidates.find(n=>n.id===old.id)??(candidates.length===1?candidates[0]:null);remap[old.id]=same?.id??null;}
 for(const old of state.blocks)remap[standardBlockId(old)]=remap[old.id];
 for(const old of allFields){if(remap[old.id])continue;const candidates=afterFields.filter(f=>f.field_id===old.field_id&&f.block_id===(remap[old.block_id]??old.block_id));if(candidates.length===1)remap[old.id]=candidates[0].id;}
 const nowBlock=block?[...after.blocks,...after.text_boxes.flatMap(b=>b.paragraphs)].find(p=>p.id===remap[block.id]):null;
 if(typeof patch.wanted==='string'&&nowBlock?.text!==patch.wanted)fail('OBJECT_CONTENT_MISMATCH');
 if(op.type==='set_field'){const now=afterFields.find(f=>f.id===remap[field.id]);if(!now||now.value!==op.new_text)fail('FIELD_CONTENT_MISMATCH');}
 if(op.type==='format_text'&&!equal(nowBlock?.unit_styles,patch.ids))fail('OBJECT_STYLE_MISMATCH');
 if(op.type==='format_paragraph'&&!equal(nowBlock?.paragraph_properties,patch.props))fail('OBJECT_PARAGRAPH_MISMATCH');
 if(op.type==='insert_field'){const now=afterFields.find(f=>f.field_id===patch.fieldId);if(!now||now.value!==op.value||now.name!==op.name||now.guide!==op.guide)fail('FIELD_CONTENT_MISMATCH');}
 if(op.type==='delete_field'&&afterFields.some(f=>f.field_id===patch.fieldId))fail('FIELD_CONTENT_MISMATCH');
 if(op.type==='update_field'){const now=afterFields.find(f=>f.id===remap[field.id]);if(!now||!Object.entries(patch.wanted).every(([k,v])=>now[k]===v)||now.value!==field.value)fail('FIELD_METADATA_MISMATCH');}
 if(structure){const nextBox=after.text_boxes.find(b=>b.id===remap[box.id]);if(!nextBox||nextBox.paragraphs.length!==box.paragraphs.length+patch.delta)fail('OBJECT_PARAGRAPH_COUNT_MISMATCH');}
 if(node){const next=after.drawing_tree.groups.find(n=>n.id===remap[node.id]);if(!next)fail('DRAWING_TRANSFORM_UNVERIFIED');if(patch.wantedMatrix&&next.relative.some((n,i)=>Math.abs(n-patch.wantedMatrix[i])>1e-6))fail('DRAWING_TRANSFORM_UNVERIFIED');}
 if(patch.normalization){const norm=patch.normalization,root=state.drawing_tree.groups.find(n=>n.id===norm.root_id),nowRoot=after.drawing_tree.groups.find(n=>n.id===remap[root.id]);if(!nowRoot||!equal(nowRoot.properties,norm.properties))fail('DRAWING_FRAME_NORMALIZATION_UNVERIFIED');for(const prior of state.drawing_tree.nodes.filter(n=>n.section===root.section&&n.shape_record>root.shape_record&&n.shape_record<root.records_end&&(n.shape_record<node.shape_record||n.shape_record>=node.records_end))){const now=after.drawing_tree.nodes.find(n=>n.id===remap[prior.id]);if(!now||prior.geometry.combined.some((v,i)=>Math.abs(v+([2,5].includes(i)?root.properties[i===2?'horzOffset':'vertOffset']:0)-now.geometry.combined[i]-([2,5].includes(i)?nowRoot.properties[i===2?'horzOffset':'vertOffset']:0))>1e-6))fail('DRAWING_SIBLING_PHYSICAL_TRANSFORM_MISMATCH');}}
 return {bytes,content_verified:true,raw_preservation_verified:true,raw_preservation_scope:patch.normalization?'selected_subgroup_transform_and_verified_root_coordinate_rebase; nonselected_physical_transforms_and_other_streams_preserved':'selected_object_text_list_field_or_subgroup_records_and_explicit_new_definitions; other_streams_exact',...(patch.normalization?{drawing_frame_normalization:patch.normalization}:{}),text_box_changed:Boolean(box),field_changed:fieldType,drawing_group_changed:Boolean(node),formatting_changed:op.type.startsWith('format_'),structure_changed:structure||['insert_field','delete_field'].includes(op.type),paragraph_count_changed:structure,text_range_changed:['set_field','splice_text','replace_text'].includes(op.type),_target_remap:remap,layout_verified:false};
}
