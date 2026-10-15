/** Local-only fields, recursive table text and grouped-picture preservation. */
import {readHwp,inflateBoundedRaw} from '../../probes/sites-runtime/guard/container.mjs';
import {inspectTextBoxes,publicTextBoxes} from './local_text_boxes.mjs';
import {sectionPages} from './local_page_state.mjs';
import {objectFlow} from './local_flow_records.mjs';
import {inspectOpaqueDrawings,publicOpaqueDrawings} from './local_opaque_drawings.mjs';
import {parseRecords,GuardError} from '../../probes/sites-runtime/guard/records.mjs';
import {enforceRawTextBudget} from '../../probes/sites-runtime/guard/text-budget.mjs';
import {imageSize} from './local_image.mjs';
import {fail,view,equal,equalBytes,textTokens,rawShapes,spliceRawParagraph,publishRawBody,verifyRawOutput} from './local_complex_records.mjs';
import {prepareComplexCharacterFormat,publishComplexCharacterFormat,verifyComplexCharacterFormat} from './local_complex_format.mjs';
import {mapComplexBlocks} from './local_complex_mapping.mjs';
import {complexParagraphProperties,prepareComplexParagraphFormat} from './local_complex_paragraph.mjs';
import {complexPictures,complexPictureProperties,prepareComplexPicture,publishComplexPicture} from './local_complex_picture.mjs';
import {complexTables,prepareComplexTable,standardBlockId,complexCellProperties} from './local_complex_table.mjs';
import {prepareComplexGroup,groupFrame} from './local_complex_group.mjs';
import {prepareComplexField} from './local_complex_field.mjs';
import {boundaryEligible,prepareComplexBoundary} from './local_complex_boundary.mjs';
import {fitNestedTable} from './local_layout.mjs';
const idTarget=(id,version)=>`hwp5:${version}:${Buffer.from(id).toString('base64url')}`;
export function hasLocalComplexContent(raw){
 for(const {section} of raw.profile.sections)for(const r of parseRecords(raw.streams.get(`BodyText/Section${section}`)))
  if(r.tag===66&&(r.level>=4||r.level%2===1)||r.tag===87||r.tag===71&&['daeh','toof','  nf','  ne'].includes(Buffer.from(r.payload.subarray(0,4)).toString('ascii'))||r.tag===76&&Buffer.from(r.payload.subarray(0,4)).toString('ascii')==='noc$')return true;
 return false;
}
const quiet=fn=>{const prior=console.error;try{console.error=()=>{};return fn();}catch(e){if(e instanceof GuardError)throw e;fail('ENGINE_OPERATION_FAILED');}finally{console.error=prior;}};
function inspection(HwpDocument,bytes,{includeDocumentInfo=true,verifyCharacterModel=true}={}){return quiet(()=>{
 const raw=readHwp(bytes);enforceRawTextBudget(raw);const doc=new HwpDocument(new Uint8Array(bytes));
 try{
 const cursor=JSON.parse(doc.getCursorModel()),allFields=JSON.parse(doc.getFieldList()),blocks=[];
  if(cursor.lists.length>4096||allFields.length>4096||doc.getSectionCount()>64)fail('COMPLEX_LIST_UNSUPPORTED');
  const definitionRecords=[...parseRecords(raw.streams.get('DocInfo'))].filter(r=>r.tag===21),definitions=definitionRecords.length;
  let total=0;const visited=new Set();
  function children(section,rootParagraph,hostListId,hostPara,path){
   const lists=cursor.lists.filter(l=>l.isCell&&l.sectionIndex===section&&l.hostListId===hostListId&&l.hostPara===hostPara);
   for(const l of lists){if(visited.has(l.listId)||path.length>=8)fail('COMPLEX_LIST_UNVERIFIED');visited.add(l.listId);
    for(let p=0;p<l.paraCount;p++){const cell_path=[...path,{controlIndex:l.controlIndex,cellIndex:l.cellIndex,cellParaIndex:p}],json=JSON.stringify(cell_path),length=doc.getCellParagraphLengthByPath(section,rootParagraph,json);
     const block={kind:cell_path.length>1?'nested_cell':'cell',section,paragraph:rootParagraph,list_id:l.listId,cell_paragraph:p,cell_path,row:l.row,column:l.col,row_span:l.rowSpan,column_span:l.colSpan,text:doc.getTextInCellByPath(section,rootParagraph,json,0,length)};
     blocks.push(block);children(section,rootParagraph,l.listId,p,cell_path);}
   }
  }
  for(let section=0;section<doc.getSectionCount();section++)for(let p=0;p<doc.getParagraphCount(section);p++){
   blocks.push({kind:'paragraph',section,paragraph:p,list_id:0,cell_path:[],text:doc.getTextRange(section,p,0,doc.getParagraphLength(section,p))});children(section,p,0,p,[]);
  }
  if(blocks.length>4096)fail('COMPLEX_LIST_UNVERIFIED');
  const recordSets=new Map();
  for(const {section}of raw.profile.sections)recordSets.set(section,[...parseRecords(raw.streams.get(`BodyText/Section${section}`))]);
  const mapped=mapComplexBlocks(recordSets,blocks,cursor);
  for(const [section,records]of recordSets){const selected=blocks.filter(b=>b.section===section);
   selected.forEach(b=>{const {start:at,end,ordinal:i}=mapped.get(b),own=records.slice(at,end),text=own.map((r,k)=>r.tag===67&&r.level===records[at].level+1?at+k:-1).filter(k=>k>=0),shapes=own.map((r,k)=>r.tag===68&&r.level===records[at].level+1?at+k:-1).filter(k=>k>=0);
    if(records[at].level!==b.cell_path.length*2||text.length>1||shapes.length!==1||!text.length&&b.text!=='')fail('TARGET_MAPPING_UNVERIFIED');
    const empty=!text.length&&b.text===''&&records[at].payload.length>=22&&(view(records[at].payload).getUint32(0,true)&0x7fffffff)<=1&&view(records[at].payload).getUint32(4,true)===0&&own.every(r=>[66,68,69].includes(r.tag));const virtual=Buffer.from('\r','utf16le'),tokens=text.length?textTokens(records[text[0]].payload):empty?textTokens(virtual):[],visible=tokens.map(t=>t.text).join(''),textVerified=visible===b.text;
    if((total+=b.text.length)>2000000)fail('EDIT_LIMIT_EXCEEDED');
    Object.assign(b,{id:`s${section}:r${i}`,raw_level:records[at].level,record_index:at,records_end:end,text_record:text[0],shape_record:shapes[0],tokens,text_mapping_verified:textVerified,empty_text_materialization:empty});
    try{if(!textVerified)fail('TARGET_MAPPING_UNVERIFIED');if(!text.length&&!empty||text.length&&(view(records[at].payload).getUint32(0,true)&0x7fffffff)!==records[text[0]].payload.length/2)fail('COMPLEX_STYLE_UNVERIFIED');if(Boolean(view(records[at].payload).getUint32(4,true)&(1<<10))!==tokens.some(t=>t.code===10))fail('COMPLEX_TEXT_UNVERIFIED');b.unit_styles=rawShapes(records[at],records[shapes[0]],text.length?records[text[0]].payload:virtual,definitions);b.text_range_editable=b.text.length<=100000;
     if(tokens.some(t=>t.text&&t.length===2&&b.unit_styles[t.unit]!==b.unit_styles[t.unit+1]))fail('COMPLEX_STYLE_UNVERIFIED');
     // Compare model shapes at every run boundary and midpoint. Exact raw runs
     // and definitions remain authoritative and are preserved across publication.
     const visibleTokens=tokens.filter(t=>t.text),ids=visibleTokens.map(t=>b.unit_styles[t.unit]);b.character_runs=[];
     for(let start=0;start<ids.length;){let end=start+1;while(end<ids.length&&ids[end]===ids[start])end++;
      if(!verifyCharacterModel){const payload=definitionRecords[ids[start]].payload;if(payload.length<46)fail('COMPLEX_STYLE_UNVERIFIED');b.character_runs.push({start,end,properties:{charShapeId:ids[start],fontSize:view(payload).getUint32(42,true),ratios:[...payload.subarray(14,21)],relativeSizes:[...payload.subarray(28,35)]}});}
      else for(const pos of new Set([start,Math.floor((start+end-1)/2),end-1])){const props=JSON.parse(b.cell_path.length?doc.getCellCharPropertiesAtByPath(section,b.paragraph,JSON.stringify(b.cell_path),pos):doc.getCharPropertiesAt(section,b.paragraph,pos));if(props.charShapeId!==ids[pos])fail('COMPLEX_STYLE_UNVERIFIED');if(pos===start)b.character_runs.push({start,end,properties:props});}start=end;}
    }catch(e){if(!(e instanceof GuardError))throw e;b.text_range_editable=false;delete b.unit_styles;delete b.character_runs;}
    try{b.paragraph_properties=complexParagraphProperties(raw,records,b);b.paragraph_format_editable=b.text_mapping_verified;}catch(error){if(!(error instanceof GuardError))throw error;b.paragraph_format_editable=false;}
    b.structural_editable=boundaryEligible(records,b);
   });
  }
  const fields=[];
  for(const f of allFields){const b=blocks.find(b=>b.list_id===f.listId&&(b.kind==='paragraph'?b.section===f.location?.sectionIndex&&b.paragraph===f.paraInList:b.cell_paragraph===f.paraInList));
   if(!b||!b.text_mapping_verified||f.cellField||f.fieldType!=='clickhere')continue;
   const starts=b.tokens.filter(t=>t.code===3&&t.visible===f.startCharIdx),ends=b.tokens.filter(t=>t.code===4&&t.visible===f.endCharIdx);
   if(starts.length!==1||ends.length!==1||ends[0].unit<starts[0].unit+8)continue;
   const from=starts[0].unit+8,to=ends[0].unit,range=b.tokens.filter(t=>t.unit>=from&&t.unit<to);
   const value=range.map(t=>t.text).join('');if(value!==f.value)continue;
   fields.push({id:`${b.id}:f${f.fieldId}`,block_id:b.id,field_id:f.fieldId,name:f.name,guide:f.guide,value:f.value,field_type:f.fieldType,editable:b.text_range_editable&&range.every(t=>t.text),section:b.section,cell_path:b.cell_path,start:f.startCharIdx,end:f.endCharIdx,from,to});
  }
  const pictures=blocks.filter(b=>b.text_mapping_verified).flatMap(b=>complexPictures(raw,recordSets.get(b.section),b).map(p=>({...p,flow:objectFlow(recordSets.get(b.section)[p.record_index]),block_id:b.id,section:b.section,cell_path:b.cell_path})));
  const groups=[];let unhandledGroups=0;
  for(const b of blocks){if(!b.text_mapping_verified)continue;const records=recordSets.get(b.section);let index=0;
   for(let i=b.record_index+1;i<b.records_end;i++){const r=records[i];if(r.tag!==71||r.level!==b.raw_level+1||Buffer.from(r.payload.subarray(0,4)).toString('ascii')!==' osg')continue;
    if(records[i+1]?.tag!==76||Buffer.from(records[i+1].payload.subarray(0,4)).toString('ascii')!=='noc$')continue;
    try{
    let end=i+1;while(end<records.length&&records[end].level>r.level)end++;
    if(r.payload.length<44||records[i+1].level!==r.level+1)fail('GROUP_PROFILE_UNSUPPORTED');
    const children=[];for(let k=i+2;k<end;k++){const c=records[k];if(c.tag===85){const shape=records[k-1];if(shape?.tag!==76||shape.payload.length<38||c.level!==shape.level+1||c.payload.length!==91||Buffer.from(shape.payload.subarray(0,4)).toString('ascii')!=='cip$')fail('GROUP_PROFILE_UNSUPPORTED');
      const p=view(c.payload),bin=p.getUint16(71,true),name=[...raw.streams.keys()].find(n=>new RegExp(`^BinData/BIN${bin.toString(16).padStart(4,'0')}\\.(png|jpe?g)$`,'i').test(n));if(!name)fail('GROUP_IMAGE_UNVERIFIED');
      let data=raw.streams.get(name),size;try{size=imageSize(data);}catch{data=inflateBoundedRaw(data,1048576);size=imageSize(data);}const sourceWidth=size.width*75,sourceHeight=size.height*75;
      const cropLeft=p.getInt32(44,true),cropTop=p.getInt32(48,true),cropRight=sourceWidth-p.getInt32(52,true),cropBottom=sourceHeight-p.getInt32(56,true);
      if([cropLeft,cropTop,cropRight,cropBottom].some(n=>n<0)||cropLeft+cropRight>=sourceWidth||cropTop+cropBottom>=sourceHeight)fail('GROUP_IMAGE_UNVERIFIED');
      children.push({picture_index:children.length,record_index:k,rotationAngle:view(shape.payload).getInt16(Buffer.from(shape.payload.subarray(0,8)).toString('ascii')==='cip$cip$'?40:36,true),sourceWidth,sourceHeight,cropLeft,cropTop,cropRight,cropBottom});}
    }
    if(!children.length||children.length>32)fail('GROUP_PROFILE_UNSUPPORTED');const p=view(r.payload);
    const properties={width:p.getUint32(16,true),height:p.getUint32(20,true),horzOffset:p.getInt32(12,true),vertOffset:p.getInt32(8,true)},geometry=groupFrame(records[i+1],properties);
    groups.push({id:`${b.id}:g${index++}`,block_id:b.id,section:b.section,record_index:i,rotationAngle:geometry.v.getInt16(geometry.base+32,true),frame_size:geometry.frame_size,properties,flow:objectFlow(r),pictures:children,editable:true});
    }catch(error){if(!(error instanceof GuardError)||!['GROUP_PROFILE_UNSUPPORTED','GROUP_IMAGE_UNVERIFIED','INVALID_IMAGE_FILE','GROUP_TRANSFORM_PROFILE_UNSUPPORTED'].includes(error.code))throw error;unhandledGroups++;}
   }
  }
  const opaqueParagraphs=[...recordSets.values()].reduce((n,records)=>n+records.filter(r=>r.tag===66).length,0)-blocks.length;
  const text_boxes=inspectTextBoxes(doc,raw,recordSets,blocks,definitions),opaque_drawings=inspectOpaqueDrawings(recordSets,blocks,groups);
  return {raw,blocks,fields,groups,pictures,text_boxes,opaque_drawings,character_definition_count:definitions,tables:complexTables(recordSets,blocks),recordSets,unhandled_fields:allFields.length-fields.length,unhandled_groups:unhandledGroups,opaque_paragraphs:opaqueParagraphs,...(includeDocumentInfo?{info:JSON.parse(doc.getDocumentInfo())}:{})};
 }finally{doc.free();}
});}
export {inspection as inspectLocalComplex};
export function createLocalComplexSnapshot(HwpDocument,bytes,version){
 const state=inspection(HwpDocument,bytes),publicBlock=b=>{const {tokens,unit_styles,character_runs,record_index,records_end,text_record,shape_record,raw_level,...rest}=b;return {...rest,target_id:b.text_mapping_verified?idTarget(b.id,version):null,editable:b.text_range_editable&&tokens.every(t=>t.text||t.code===13),character_format_editable:b.text_range_editable,structural_editable:b.structural_editable,...(!b.text_mapping_verified?{read_only_reason:'TARGET_TEXT_UNVERIFIED'}:{}),style:{profile:'complex_raw_preservation',character_runs:character_runs??[]}};};
 const publicFields=state.fields.map(f=>{const {from,to,...rest}=f;return {...rest,target_id:idTarget(f.id,version)};}),publicGroups=state.groups.map(g=>{const {record_index,...rest}=g;return {...rest,target_id:idTarget(g.id,version),pictures:g.pictures.map(p=>{const {record_index,...rest}=p;return rest;})};});
 return {source_sha256:version,read(options){
  if(options.expected_sha256!==version)fail('VERSION_CONFLICT');let {max_chars=8000,max_blocks=128,cursor}=options;
  if(!Number.isSafeInteger(max_chars)||max_chars<1||max_chars>64000||!Number.isSafeInteger(max_blocks)||max_blocks<1||max_blocks>128)fail('INVALID_LIMIT');
  let index=0,offset=0;if(cursor!=null){if(!cursor||Object.getPrototypeOf(cursor)!==Object.prototype||!equal(Object.keys(cursor).sort(),['block_index','offset','sha256']))fail('INVALID_CURSOR');if(cursor.sha256!==version)fail('CURSOR_VERSION_CONFLICT');index=cursor.block_index;offset=cursor.offset;if(!Number.isSafeInteger(index)||!state.blocks[index]||!Number.isSafeInteger(offset)||offset<0||offset>[...state.blocks[index].text].length)fail('INVALID_CURSOR');}
  const fragments=[],start={block_index:index,offset};while(index<state.blocks.length&&fragments.length<max_blocks){const b=state.blocks[index],points=[...b.text];if(points.length&&!max_chars)break;const end=Math.min(points.length,offset+max_chars);fragments.push({...publicBlock(b),text:points.slice(offset,end).join(''),start_offset:offset,end_offset:end,total_chars:points.length,fragment_complete:end===points.length});max_chars-=end-offset;if(end<points.length){offset=end;break;}index++;offset=0;}
  const complete=index===state.blocks.length;return {source_sha256:version,blocks:fragments,fields:publicFields,picture_groups:publicGroups,text_boxes:publicTextBoxes(state,version),opaque_drawings:publicOpaqueDrawings(state,version),page_definitions:sectionPages(state),tables:state.tables.map(t=>({id:t.id,section:t.section,paragraph:t.paragraph,cell_path:t.cell_path,control:t.control,dimensions:t.dimensions,properties:t.properties,axis_editable:t.axis_editable,layout_editable:t.layout_editable,read_only_reason:t.read_only_reason,cells:t.cells.map(c=>({cell:c.cell,row:c.row,col:c.col,rowSpan:c.rowSpan,colSpan:c.colSpan,properties:complexCellProperties(state.recordSets.get(t.section),c),subtree_sha256:c.subtree_sha256,paragraph_ids:c.blocks.map(b=>b.id),target_id:c.blocks[0]?idTarget(c.blocks[0].id,version):null}))})),pictures:state.pictures.map(p=>{const {record_index,bin_id,...rest}=p;return {...rest,target_id:idTarget(p.block_id,version),editable:true,format:p.cell_path.length?'complex_cell_picture':'complex_body_picture'};}),complex_profile:true,target_mapping_verified:true,all_content_supported:false,content_complete:false,complete,next_cursor:complete?null:{sha256:version,block_index:index,offset},page_starts_at:start,offsets:'unicode_code_points',supported_blocks:state.blocks.length,section_count:state.info.sectionCount,page_count:state.info.pageCount,
   unsupported:[{kind:'complex_objects',reason:'Mapped body/cell text and ClickHere field values can be edited; other controls and unmapped paragraph lists are retained as opaque bytes',unhandled_fields:state.unhandled_fields,unhandled_groups:state.unhandled_groups,opaque_paragraphs:state.opaque_paragraphs}],layout_verified:false};
 }};
}
export function editLocalComplex(HwpDocument,source,version,op){
 const schemas={splice_text:['start','end','new_text'],replace_text:['new_text'],set_field:['new_text'],format_text:['start','end','props'],format_paragraph:['props'],move_picture_group:['expected_properties','props'],crop_group_picture:['picture_index','expected_properties','props']};
 const groupOperation=['replace_group_picture','rotate_group_picture','transform_picture_group'].includes(op.type);
 const boundaryOperation=['split_paragraph','merge_paragraph','insert_paragraphs','duplicate_paragraph','delete_paragraph'].includes(op.type);
 const pictureOperation=['insert_picture','update_picture','replace_picture','delete_picture'].includes(op.type);
 const fieldOperation=['insert_field','delete_field'].includes(op.type);
 const tableOperation=['insert_table_row','delete_table_row','insert_table_column','delete_table_column','merge_table_cells','split_table_cell','resize_table_columns','resize_table_rows','format_cell','format_table','fit_table_to_cell'].includes(op.type);
 if(!pictureOperation&&!tableOperation&&!fieldOperation&&!groupOperation&&!boundaryOperation&&(!schemas[op.type]||!equal(Object.keys(op).sort(),['type','target_id','expected_old',...schemas[op.type]].sort())))fail('COMPLEX_OPERATION_UNSUPPORTED');
 if(typeof op.target_id!=='string'||!op.target_id.startsWith(`hwp5:${version}:`))fail('VERSION_CONFLICT');const encoded=op.target_id.slice(70),id=Buffer.from(encoded,'base64url').toString();if(Buffer.from(id).toString('base64url')!==encoded)fail('INVALID_TARGET');
 const before=inspection(HwpDocument,source),field=before.fields.find(f=>f.id===id),group=before.groups.find(g=>g.id===id),b=before.blocks.find(b=>b.id===(field?.block_id??group?.block_id??id)||(tableOperation||fieldOperation||boundaryOperation)&&standardBlockId(b)===id);if(!b)fail('INVALID_TARGET');
 const expected=field?field.value:b.text;if(expected!==op.expected_old)fail('EXPECTED_OLD_MISMATCH');let records=before.recordSets.get(b.section),wanted=b.text;
 if(b.empty_text_materialization&&['splice_text','replace_text','insert_picture','insert_field'].includes(op.type)){
  if(['splice_text','replace_text'].includes(op.type)&&op.new_text===''){
   if(op.type==='splice_text'&&(op.start!==0||op.end!==0))fail('INVALID_TEXT_RANGE');
   return {bytes:source,content_verified:true,raw_preservation_verified:true,raw_preservation_scope:'unchanged_source',layout_verified:false};
  }
  const materialized=records.slice(),header=records[b.record_index].payload.slice();view(header).setUint32(0,((view(header).getUint32(0,true)&0x80000000)|1)>>>0,true);
  materialized[b.record_index]={...records[b.record_index],payload:header};materialized.splice(b.shape_record,0,{tag:67,level:b.raw_level+1,payload:Buffer.from('\r','utf16le')});
  const staged=publishRawBody(source,before.raw,b.section,materialized);
  return editLocalComplex(HwpDocument,staged.bytes,version,op);
 }
 if(boundaryOperation){
  if(field||group)fail('PARAGRAPH_TARGET_REQUIRED');const patch=prepareComplexBoundary(before,b,op,version),written=publishRawBody(source,before.raw,b.section,patch.records),after=inspection(HwpDocument,written.bytes);verifyRawOutput(before.raw,after.raw,written.name,written.expected);
  for(const old of before.blocks){const name=patch.remap[old.id],now=after.blocks.find(x=>x.id===name);if(name!==null&&(!now||now.text!==patch.expected.get(old.id)))fail('PARAGRAPH_CONTENT_MISMATCH');}
  if(after.blocks.length!==before.blocks.length+patch.delta||patch.fresh.some(f=>after.blocks.find(x=>x.id===f.id)?.text!==f.text))fail('PARAGRAPH_CONTENT_MISMATCH');
  if(after.fields.length!==before.fields.length||before.fields.some(f=>{const now=after.fields.find(x=>x.field_id===f.field_id);return !now||now.value!==f.value||now.name!==f.name||now.guide!==f.guide;}))fail('FIELD_PRESERVATION_MISMATCH');
  if(after.groups.length!==before.groups.length||after.pictures.length!==before.pictures.length)fail('PICTURE_CONTENT_MISMATCH');
  const complexAfter=hasLocalComplexContent(after.raw),remap={};for(const old of before.blocks){const now=after.blocks.find(x=>x.id===patch.remap[old.id]),name=now?(complexAfter?now.id:standardBlockId(now)):null;remap[old.id]=name;const alias=standardBlockId(old);if(alias)remap[alias]=name;}
  for(const f of before.fields)remap[f.id]=after.fields.find(x=>x.field_id===f.field_id)?.id??null;
  for(const g of before.groups){const at=g.section===b.section?patch.records.indexOf(records[g.record_index]):g.record_index,now=after.groups.find(x=>x.section===g.section&&x.record_index===at);if(!now||!equal(now.properties,g.properties)||!equal(now.pictures.map(({record_index,...p})=>p),g.pictures.map(({record_index,...p})=>p)))fail('GROUP_PRESERVATION_MISMATCH');remap[g.id]=now.id;}
  return {bytes:written.bytes,content_verified:true,raw_preservation_verified:true,raw_preservation_scope:'paragraph_text_style_runs_boundaries_and_cell_list_count; retained_control_subtrees_and_other_streams_exact',structure_changed:true,paragraph_count_changed:true,_target_remap:remap,layout_verified:false};
 }
 if(groupOperation){
  if(!group)fail('GROUP_PICTURE_REQUIRED');const patch=prepareComplexGroup(before.raw,records,group,op);if(patch.unchanged)return {bytes:source,content_verified:true,raw_preservation_verified:true,raw_preservation_scope:'unchanged_source',layout_verified:false};
  const bytes=publishComplexPicture(source,before.raw,b.section,patch.records,patch.image),after=inspection(HwpDocument,bytes),now=after.groups.find(g=>g.id===group.id);
  if(!now||!equal(now.properties,patch.wantedGroup??group.properties)||now.rotationAngle!==(patch.wantedAngle??group.rotationAngle)||now.pictures.length!==group.pictures.length)fail('GROUP_PRESERVATION_MISMATCH');
  for(const child of group.pictures){const {record_index,picture_index,...props}=now.pictures[child.picture_index]??{};if(!equal(props,child.picture_index===patch.child?.picture_index?patch.wanted:(({record_index,picture_index,...props})=>props)(child)))fail('GROUP_PRESERVATION_MISMATCH');}
  if(before.blocks.length!==after.blocks.length||before.blocks.some((old,i)=>old.id!==after.blocks[i].id||old.text!==after.blocks[i].text)||!equal(before.fields,after.fields))fail('COMPLEX_CONTENT_MISMATCH');
  return {bytes,content_verified:true,raw_preservation_verified:true,raw_preservation_scope:op.type==='transform_picture_group'?'group_bounding_frame_and_first_rotation_pair_of_each_component; hierarchy_images_translation_scale_and_later_pairs_exact':'selected_group_picture_binary_or_leaf_rotation_matrix_and_metadata; parent_and_sibling_records_retained',picture_group_changed:true,retained_unused_image_data:Boolean(patch.image),layout_verified:false};
 }
 if(fieldOperation){
  if(group)fail('FIELD_TARGET_REQUIRED');const patch=prepareComplexField(source,before,b,field,op),written=publishRawBody(source,before.raw,b.section,patch.records),after=inspection(HwpDocument,written.bytes);verifyRawOutput(before.raw,after.raw,written.name,written.expected);
  if(before.blocks.length!==after.blocks.length||before.blocks.some((old,i)=>old.id!==after.blocks[i].id||after.blocks[i].text!==(old.id===b.id?patch.wanted:old.text)))fail('FIELD_CONTENT_MISMATCH');
  const created=after.fields.find(f=>f.field_id===patch.fieldId);if(patch.inserting?(!created||created.block_id!==b.id||created.name!==op.name||created.guide!==op.guide||created.value!==op.value):Boolean(created))fail('FIELD_CONTENT_MISMATCH');
  if(after.fields.length!==before.fields.length+(patch.inserting?1:-1))fail('FIELD_CONTENT_MISMATCH');
  for(const old of before.fields){if(!patch.inserting&&old.field_id===patch.fieldId)continue;const now=after.fields.find(f=>f.field_id===old.field_id),shift=patch.inserting&&old.block_id===b.id&&old.start>op.offset?[...op.value].length:0;if(!now||now.block_id!==old.block_id||now.value!==old.value||now.name!==old.name||now.guide!==old.guide||now.start!==old.start+shift||now.end!==old.end+shift)fail('FIELD_PRESERVATION_MISMATCH');}
  const complexAfter=hasLocalComplexContent(after.raw),remap={};for(const old of before.blocks){const now=after.blocks.find(x=>x.id===old.id),name=complexAfter?now.id:standardBlockId(now);remap[old.id]=name;const alias=standardBlockId(old);if(alias)remap[alias]=name;}
  for(const f of before.fields)remap[f.id]=after.fields.find(n=>n.field_id===f.field_id)?.id??null;for(const g of before.groups)remap[g.id]=g.id;
  return {bytes:written.bytes,content_verified:true,raw_preservation_verified:true,raw_preservation_scope:'selected_ClickHere_wrapper_text_runs_and_line_cache; all_other_controls_and_streams_exact',field_changed:true,structure_changed:true,deleted_field_retains_value:!patch.inserting,_target_remap:remap,layout_verified:false};
 }
 if(tableOperation){
  if(field||group)fail('TABLE_CELL_REQUIRED');const effective=op.type==='fit_table_to_cell'?fitNestedTable(before,b,op):op,patch=effective?prepareComplexTable(before,b,effective):{unchanged:true};if(patch.unchanged)return {bytes:source,content_verified:true,raw_preservation_verified:true,raw_preservation_scope:'unchanged_source',layout_verified:false};const written=publishRawBody(source,before.raw,b.section,patch.records),after=inspection(HwpDocument,written.bytes);verifyRawOutput(before.raw,after.raw,written.name,written.expected);
  const saved=after.tables.find(t=>t.id===patch.table.id);if(!saved||!equal(saved.dimensions,{rowCount:patch.newRows,colCount:patch.newCols,cellCount:patch.cellCount})||saved.properties.tableWidth!==patch.width||saved.properties.tableHeight!==patch.height)fail('TABLE_CONTENT_MISMATCH');
  if(!equal(saved.cells.map(c=>({row:c.row,col:c.col,rowSpan:c.rowSpan,colSpan:c.colSpan,width:c.width,height:c.height})),patch.expectedCells))fail('TABLE_GEOMETRY_MISMATCH');
  if(patch.expectedProperties&&!equal(saved.properties,patch.expectedProperties))fail('TABLE_FORMAT_PROPERTIES_MISMATCH');
  if(patch.expectedCellProperties){const {cell,props}=patch.expectedCellProperties,now=complexCellProperties(after.recordSets.get(b.section),saved.cells[cell]);for(const [k,v]of Object.entries(props))if(now[k]!==v)fail('TABLE_FORMAT_PROPERTIES_MISMATCH');}
  for(const old of before.blocks){const mapped=patch.remap[old.id];if(mapped===null)continue;const now=after.blocks.find(x=>x.id===mapped);if(!now||now.text!==old.text)fail('TABLE_CONTENT_MISMATCH');}
  if(after.blocks.length!==before.blocks.filter(old=>patch.remap[old.id]!==null).length+patch.added.length)fail('TABLE_CONTENT_MISMATCH');
  for(const f of before.fields){if(patch.remap[f.block_id]===null)continue;const now=after.fields.find(n=>n.field_id===f.field_id);if(!now||now.block_id!==patch.remap[f.block_id]||now.value!==f.value||now.name!==f.name||now.guide!==f.guide||now.start!==f.start||now.end!==f.end)fail('FIELD_PRESERVATION_MISMATCH');}
  if(after.fields.length!==before.fields.filter(f=>patch.remap[f.block_id]!==null).length)fail('FIELD_PRESERVATION_MISMATCH');
  for(const g of before.groups){if(patch.remap[g.block_id]===null)continue;const now=after.groups.find(n=>n.id===g.id.replace(g.block_id,patch.remap[g.block_id]));if(!now||!equal(now.properties,g.properties)||!equal(now.pictures.map(({record_index,...p})=>p),g.pictures.map(({record_index,...p})=>p)))fail('GROUP_PRESERVATION_MISMATCH');}
  if(after.groups.length!==before.groups.filter(g=>patch.remap[g.block_id]!==null).length)fail('GROUP_PRESERVATION_MISMATCH');
  for(const p of before.pictures){if(patch.remap[p.block_id]===null)continue;const now=after.pictures.find(n=>n.block_id===patch.remap[p.block_id]&&n.picture_index===p.picture_index);if(!now||!equal(now.properties,p.properties)||now.bin_id!==p.bin_id)fail('PICTURE_CONTENT_MISMATCH');}
  if(after.pictures.length!==before.pictures.filter(p=>patch.remap[p.block_id]!==null).length)fail('PICTURE_CONTENT_MISMATCH');
  for(const fresh of patch.added){const cell=saved.cells.find(c=>c.row===fresh.row&&c.col===fresh.col);if(cell?.blocks.length!==1||cell.blocks[0].text!==fresh.text)fail('TABLE_CONTENT_MISMATCH');}
  const complexAfter=hasLocalComplexContent(after.raw),remap={};for(const old of before.blocks){const now=after.blocks.find(x=>x.id===patch.remap[old.id]),name=now?(complexAfter?now.id:standardBlockId(now)):null;remap[old.id]=name;const alias=standardBlockId(old);if(alias)remap[alias]=name;}
  for(const f of before.fields)remap[f.id]=patch.remap[f.block_id]===null?null:`${patch.remap[f.block_id]}:f${f.field_id}`;for(const g of before.groups)remap[g.id]=patch.remap[g.block_id]===null?null:g.id.replace(g.block_id,patch.remap[g.block_id]);
  return {bytes:written.bytes,content_verified:true,raw_preservation_verified:true,raw_preservation_scope:'table_axes_and_cell_geometry; retained_child_records_and_all_other_streams_exact',structure_changed:!patch.layoutFormatting,table_structure_changed:!patch.layoutFormatting,table_formatting_changed:Boolean(patch.layoutFormatting),column_sizing:patch.layoutFormatting?'explicit_dimensions':'retain_table_width_and_track_ratios',_target_remap:remap,layout_verified:false};
 }
 if(pictureOperation){
  if(field||group)fail('PICTURE_TARGET_REQUIRED');const patch=prepareComplexPicture(before.raw,records,b,op);
  if(patch.unchanged)return {bytes:source,content_verified:true,raw_preservation_verified:true,raw_preservation_scope:'unchanged_source',picture_changed:false,layout_verified:false};
  const bytes=publishComplexPicture(source,before.raw,b.section,patch.records,patch.image),after=inspection(HwpDocument,bytes);
  if(before.blocks.length!==after.blocks.length||before.blocks.some((old,i)=>old.id!==after.blocks[i].id||old.text!==after.blocks[i].text||!equal(old.paragraph_properties,after.blocks[i].paragraph_properties)))fail('PICTURE_CONTENT_MISMATCH');
  const semantics=f=>({id:f.id,block_id:f.block_id,value:f.value,name:f.name,guide:f.guide,start:f.start,end:f.end});if(!equal(before.fields.map(semantics),after.fields.map(semantics)))fail('FIELD_PRESERVATION_MISMATCH');
  const selected=after.blocks.find(x=>x.id===b.id),savedPictures=complexPictures(after.raw,after.recordSets.get(b.section),selected);
  if(savedPictures.length!==patch.expected_picture_count)fail('PICTURE_CONTENT_MISMATCH');
  if(patch.wanted&&!equal(savedPictures.find(p=>p.picture_index===patch.selected.picture_index)?.properties,patch.wanted))fail('PICTURE_CONTENT_MISMATCH');
  if(patch.image){const found=savedPictures.find(p=>p.bin_id===patch.image.binId);if(!found||!equalBytes(complexPictureProperties(after.raw,after.recordSets.get(b.section).slice(found.record_index,found.record_index+3)).bytes,patch.image.bytes))fail('PICTURE_BINARY_MISMATCH');}
  return {bytes,content_verified:true,raw_preservation_verified:true,raw_preservation_scope:'selected_picture_and_paragraph_anchor_new_binary_definition_only; every_opaque_record_retained',picture_changed:true,structure_changed:patch.inserting||patch.deleting,retained_unused_image_data:!patch.inserting,layout_verified:false};
 }
 if(op.type==='format_paragraph'){
  if(field||group||!b.paragraph_format_editable)fail('TARGET_NOT_EDITABLE');const patch=prepareComplexParagraphFormat(before.raw,records,b,op);
  if(patch.unchanged)return {bytes:source,content_verified:true,raw_preservation_verified:true,raw_preservation_scope:'unchanged_source',formatting_changed:false,layout_verified:false};
  const bytes=publishComplexCharacterFormat(source,before.raw,b.section,patch),after=inspection(HwpDocument,bytes),saved=after.blocks.find(x=>x.id===b.id);
  if(!saved||!equal(saved.paragraph_properties,patch.props)||before.blocks.length!==after.blocks.length||before.blocks.some((x,i)=>x.id!==after.blocks[i].id||x.text!==after.blocks[i].text))fail('FORMAT_CONTENT_MISMATCH');
  return {bytes,content_verified:true,raw_preservation_verified:true,raw_preservation_scope:'existing_streams_and_definitions_except_selected_paragraph_shape_reference_new_definition_count_and_line_cache',formatting_changed:true,paragraph_formatting_changed:true,paragraph_count_changed:false,layout_verified:false};
 }
 if(op.type==='format_text'){
  if(group)fail('TARGET_NOT_EDITABLE');const patch=prepareComplexCharacterFormat(before.raw,records,b,field,op);
  if(patch.unchanged)return {bytes:source,content_verified:true,raw_preservation_verified:true,raw_preservation_scope:'unchanged_source',formatting_changed:false,layout_verified:false};
  const bytes=publishComplexCharacterFormat(source,before.raw,b.section,patch),after=inspection(HwpDocument,bytes);verifyComplexCharacterFormat(before,after,b,patch);
  return {bytes,content_verified:true,raw_preservation_verified:true,raw_preservation_scope:'exact_all_other_packed_streams_and_existing_definitions_except_requested_font_counts_and_selected_character_runs_line_cache',formatting_changed:true,text_range_changed:false,paragraph_count_changed:false,layout_verified:false};
 }
 if(op.type==='set_field'||op.type==='splice_text'||op.type==='replace_text'){
  if(!b.text_range_editable||op.type==='set_field'&&!field?.editable||op.type!=='set_field'&&(field||group))fail('TARGET_NOT_EDITABLE');
  const start=field?.start??(op.type==='replace_text'?0:op.start),end=field?.end??(op.type==='replace_text'?[...b.text].length:op.end);
  const result=spliceRawParagraph(records,b,start,end,op.new_text,field);records=result.records;wanted=result.wanted;
  if(wanted===b.text)return {bytes:source,content_verified:true,raw_preservation_verified:true,raw_preservation_scope:'unchanged_source',layout_verified:false};
 }else{
  if(!group||!op.props||Object.getPrototypeOf(op.props)!==Object.prototype||!Object.keys(op.props).length)fail('INVALID_GROUP_PROPERTIES');
  records=records.map(r=>({...r,payload:r.payload.slice()}));
  if(op.type==='move_picture_group'){
   if(!equal(op.expected_properties,group.properties))fail('EXPECTED_GROUP_MISMATCH');if(Object.entries(op.props).some(([k,v])=>!['horzOffset','vertOffset'].includes(k)||!Number.isSafeInteger(v)||Math.abs(v)>720000))fail('INVALID_GROUP_PROPERTIES');
   const p=view(records[group.record_index].payload);for(const [key,offset] of [['horzOffset',12],['vertOffset',8]])if(Object.hasOwn(op.props,key))p.setInt32(offset,op.props[key],true);
  }else{
   const child=group.pictures[op.picture_index];if(!Number.isSafeInteger(op.picture_index)||!child)fail('GROUP_PICTURE_REQUIRED');const {record_index,picture_index,...prior}=child;if(!equal(op.expected_properties,prior))fail('EXPECTED_PICTURE_MISMATCH');
   if(Object.entries(op.props).some(([k,v])=>!['cropLeft','cropTop','cropRight','cropBottom'].includes(k)||!Number.isSafeInteger(v)||v<0))fail('INVALID_PICTURE_CROP');const props={...prior,...op.props};if(props.cropLeft+props.cropRight>=props.sourceWidth||props.cropTop+props.cropBottom>=props.sourceHeight)fail('INVALID_PICTURE_CROP');
   const p=view(records[record_index].payload);p.setInt32(44,props.cropLeft,true);p.setInt32(48,props.cropTop,true);p.setInt32(52,props.sourceWidth-props.cropRight,true);p.setInt32(56,props.sourceHeight-props.cropBottom,true);
  }
 }
 const result=publishRawBody(source,before.raw,b.section,records),after=inspection(HwpDocument,result.bytes);verifyRawOutput(before.raw,after.raw,result.name,result.expected);
 if(before.blocks.length!==after.blocks.length||before.blocks.some((old,i)=>old.id!==after.blocks[i].id||after.blocks[i].text!==(old.id===b.id?wanted:old.text)))fail('COMPLEX_CONTENT_MISMATCH');
 if(field){const f=after.fields.find(f=>f.id===field.id);if(!f||f.value!==op.new_text||f.name!==field.name||f.guide!==field.guide)fail('FIELD_PRESERVATION_MISMATCH');}
 return {bytes:equalBytes(source,result.bytes)?source:result.bytes,content_verified:true,raw_preservation_verified:true,raw_preservation_scope:'exact_all_streams_and_records_except_selected_text_runs_line_break_mask_line_cache_or_group_offsets_crop',text_range_changed:['splice_text','replace_text','set_field'].includes(op.type),field_changed:op.type==='set_field',picture_group_changed:Boolean(group),line_break_mode:'hwp_character_10_within_same_paragraph',paragraph_count_changed:false,layout_verified:false};
}
