/** Local-only fields, recursive table text and grouped-picture preservation. */
import {readHwp,inflateBoundedRaw} from '../../probes/sites-runtime/guard/container.mjs';
import {parseRecords,GuardError} from '../../probes/sites-runtime/guard/records.mjs';
import {enforceRawTextBudget} from '../../probes/sites-runtime/guard/text-budget.mjs';
import {imageSize} from './local_image.mjs';
import {fail,view,equal,equalBytes,textTokens,rawShapes,spliceRawParagraph,publishRawBody,verifyRawOutput} from './local_complex_records.mjs';
import {prepareComplexCharacterFormat,publishComplexCharacterFormat,verifyComplexCharacterFormat} from './local_complex_format.mjs';
import {mapComplexBlocks} from './local_complex_mapping.mjs';
import {complexParagraphProperties,prepareComplexParagraphFormat} from './local_complex_paragraph.mjs';
const idTarget=(id,version)=>`hwp5:${version}:${Buffer.from(id).toString('base64url')}`;
export function hasLocalComplexContent(raw){
 for(const {section} of raw.profile.sections)for(const r of parseRecords(raw.streams.get(`BodyText/Section${section}`)))
  if(r.tag===66&&(r.level>=4||r.level%2===1)||r.tag===87||r.tag===71&&['daeh','toof','  nf','  ne'].includes(Buffer.from(r.payload.subarray(0,4)).toString('ascii'))||r.tag===76&&Buffer.from(r.payload.subarray(0,4)).toString('ascii')==='noc$')return true;
 return false;
}
const quiet=fn=>{const prior=console.error;try{console.error=()=>{};return fn();}catch(e){if(e instanceof GuardError)throw e;fail('ENGINE_OPERATION_FAILED');}finally{console.error=prior;}};
function inspection(HwpDocument,bytes){return quiet(()=>{
 const raw=readHwp(bytes);enforceRawTextBudget(raw);const doc=new HwpDocument(new Uint8Array(bytes));
 try{
 const cursor=JSON.parse(doc.getCursorModel()),allFields=JSON.parse(doc.getFieldList()),blocks=[];
  if(cursor.lists.length>4096||allFields.length>4096||doc.getSectionCount()>64)fail('COMPLEX_LIST_UNSUPPORTED');
  const definitions=[...parseRecords(raw.streams.get('DocInfo'))].filter(r=>r.tag===21).length;
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
    const tokens=text.length?textTokens(records[text[0]].payload):[],visible=tokens.map(t=>t.text).join(''),textVerified=visible===b.text;
    if((total+=b.text.length)>2000000)fail('EDIT_LIMIT_EXCEEDED');
    Object.assign(b,{id:`s${section}:r${i}`,raw_level:records[at].level,record_index:at,records_end:end,text_record:text[0],shape_record:shapes[0],tokens,text_mapping_verified:textVerified});
    try{if(!textVerified)fail('TARGET_MAPPING_UNVERIFIED');if(!text.length||(view(records[at].payload).getUint32(0,true)&0x7fffffff)!==records[text[0]].payload.length/2)fail('COMPLEX_STYLE_UNVERIFIED');if(Boolean(view(records[at].payload).getUint32(4,true)&(1<<10))!==tokens.some(t=>t.code===10))fail('COMPLEX_TEXT_UNVERIFIED');b.unit_styles=rawShapes(records[at],records[shapes[0]],records[text[0]].payload,definitions);b.text_range_editable=b.text.length<=100000;
     if(tokens.some(t=>t.text&&t.length===2&&b.unit_styles[t.unit]!==b.unit_styles[t.unit+1]))fail('COMPLEX_STYLE_UNVERIFIED');
     // Compare model shapes at every run boundary and midpoint. Exact raw runs
     // and definitions remain authoritative and are preserved across publication.
     const visibleTokens=tokens.filter(t=>t.text),ids=visibleTokens.map(t=>b.unit_styles[t.unit]);b.character_runs=[];
     for(let start=0;start<ids.length;){let end=start+1;while(end<ids.length&&ids[end]===ids[start])end++;for(const pos of new Set([start,Math.floor((start+end-1)/2),end-1])){
      const props=JSON.parse(b.cell_path.length?doc.getCellCharPropertiesAtByPath(section,b.paragraph,JSON.stringify(b.cell_path),pos):doc.getCharPropertiesAt(section,b.paragraph,pos));if(props.charShapeId!==ids[pos])fail('COMPLEX_STYLE_UNVERIFIED');if(pos===start)b.character_runs.push({start,end,properties:props});}start=end;}
    }catch(e){if(!(e instanceof GuardError))throw e;b.text_range_editable=false;delete b.unit_styles;delete b.character_runs;}
    try{b.paragraph_properties=complexParagraphProperties(raw,records,b);b.paragraph_format_editable=b.text_mapping_verified;}catch(error){if(!(error instanceof GuardError))throw error;b.paragraph_format_editable=false;}
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
  const groups=[];let unhandledGroups=0;
  for(const b of blocks){if(!b.text_mapping_verified)continue;const records=recordSets.get(b.section);let index=0;
   for(let i=b.record_index+1;i<b.records_end;i++){const r=records[i];if(r.tag!==71||r.level!==b.raw_level+1||Buffer.from(r.payload.subarray(0,4)).toString('ascii')!==' osg')continue;
    if(records[i+1]?.tag!==76||Buffer.from(records[i+1].payload.subarray(0,4)).toString('ascii')!=='noc$')continue;
    try{
    let end=i+1;while(end<records.length&&records[end].level>r.level)end++;
    if(r.payload.length<44||records[i+1].level!==r.level+1)fail('GROUP_PROFILE_UNSUPPORTED');
    const children=[];for(let k=i+2;k<end;k++){const c=records[k];if(c.tag===85){const shape=records[k-1];if(shape?.tag!==76||c.level!==shape.level+1||c.payload.length!==91||Buffer.from(shape.payload.subarray(0,4)).toString('ascii')!=='cip$')fail('GROUP_PROFILE_UNSUPPORTED');
      const p=view(c.payload),bin=p.getUint16(71,true),name=[...raw.streams.keys()].find(n=>new RegExp(`^BinData/BIN${bin.toString(16).padStart(4,'0')}\\.(png|jpe?g)$`,'i').test(n));if(!name)fail('GROUP_IMAGE_UNVERIFIED');
      let data=raw.streams.get(name),size;try{size=imageSize(data);}catch{data=inflateBoundedRaw(data,1048576);size=imageSize(data);}const sourceWidth=size.width*75,sourceHeight=size.height*75;
      const cropLeft=p.getInt32(44,true),cropTop=p.getInt32(48,true),cropRight=sourceWidth-p.getInt32(52,true),cropBottom=sourceHeight-p.getInt32(56,true);
      if([cropLeft,cropTop,cropRight,cropBottom].some(n=>n<0)||cropLeft+cropRight>=sourceWidth||cropTop+cropBottom>=sourceHeight)fail('GROUP_IMAGE_UNVERIFIED');
      children.push({picture_index:children.length,record_index:k,sourceWidth,sourceHeight,cropLeft,cropTop,cropRight,cropBottom});}
    }
    if(!children.length||children.length>32)fail('GROUP_PROFILE_UNSUPPORTED');const p=view(r.payload);
    groups.push({id:`${b.id}:g${index++}`,block_id:b.id,section:b.section,record_index:i,properties:{width:p.getUint32(16,true),height:p.getUint32(20,true),horzOffset:p.getInt32(12,true),vertOffset:p.getInt32(8,true)},pictures:children,editable:true});
    }catch(error){if(!(error instanceof GuardError)||!['GROUP_PROFILE_UNSUPPORTED','GROUP_IMAGE_UNVERIFIED','INVALID_IMAGE_FILE'].includes(error.code))throw error;unhandledGroups++;}
   }
  }
  const opaqueParagraphs=[...recordSets.values()].reduce((n,records)=>n+records.filter(r=>r.tag===66).length,0)-blocks.length;
  return {raw,blocks,fields,groups,recordSets,unhandled_fields:allFields.length-fields.length,unhandled_groups:unhandledGroups,opaque_paragraphs:opaqueParagraphs,info:JSON.parse(doc.getDocumentInfo())};
 }finally{doc.free();}
});}
export function createLocalComplexSnapshot(HwpDocument,bytes,version){
 const state=inspection(HwpDocument,bytes),publicBlock=b=>{const {tokens,unit_styles,character_runs,record_index,records_end,text_record,shape_record,raw_level,...rest}=b;return {...rest,target_id:b.text_mapping_verified?idTarget(b.id,version):null,editable:b.text_range_editable&&tokens.every(t=>t.text||t.code===13),character_format_editable:b.text_range_editable,structural_editable:false,...(!b.text_mapping_verified?{read_only_reason:'TARGET_TEXT_UNVERIFIED'}:{}),style:{profile:'complex_raw_preservation',character_runs:character_runs??[]}};};
 const publicFields=state.fields.map(f=>{const {from,to,...rest}=f;return {...rest,target_id:idTarget(f.id,version)};}),publicGroups=state.groups.map(g=>{const {record_index,...rest}=g;return {...rest,target_id:idTarget(g.id,version),pictures:g.pictures.map(p=>{const {record_index,...rest}=p;return rest;})};});
 return {source_sha256:version,read(options){
  if(options.expected_sha256!==version)fail('VERSION_CONFLICT');let {max_chars=8000,max_blocks=128,cursor}=options;
  if(!Number.isSafeInteger(max_chars)||max_chars<1||max_chars>64000||!Number.isSafeInteger(max_blocks)||max_blocks<1||max_blocks>128)fail('INVALID_LIMIT');
  let index=0,offset=0;if(cursor!=null){if(!cursor||Object.getPrototypeOf(cursor)!==Object.prototype||!equal(Object.keys(cursor).sort(),['block_index','offset','sha256']))fail('INVALID_CURSOR');if(cursor.sha256!==version)fail('CURSOR_VERSION_CONFLICT');index=cursor.block_index;offset=cursor.offset;if(!Number.isSafeInteger(index)||!state.blocks[index]||!Number.isSafeInteger(offset)||offset<0||offset>[...state.blocks[index].text].length)fail('INVALID_CURSOR');}
  const fragments=[],start={block_index:index,offset};while(index<state.blocks.length&&fragments.length<max_blocks){const b=state.blocks[index],points=[...b.text];if(points.length&&!max_chars)break;const end=Math.min(points.length,offset+max_chars);fragments.push({...publicBlock(b),text:points.slice(offset,end).join(''),start_offset:offset,end_offset:end,total_chars:points.length,fragment_complete:end===points.length});max_chars-=end-offset;if(end<points.length){offset=end;break;}index++;offset=0;}
  const complete=index===state.blocks.length;return {source_sha256:version,blocks:fragments,fields:publicFields,picture_groups:publicGroups,complex_profile:true,target_mapping_verified:true,all_content_supported:false,content_complete:false,complete,next_cursor:complete?null:{sha256:version,block_index:index,offset},page_starts_at:start,offsets:'unicode_code_points',supported_blocks:state.blocks.length,section_count:state.info.sectionCount,page_count:state.info.pageCount,
   unsupported:[{kind:'complex_objects',reason:'Mapped body/cell text and ClickHere field values can be edited; other controls and unmapped paragraph lists are retained as opaque bytes',unhandled_fields:state.unhandled_fields,unhandled_groups:state.unhandled_groups,opaque_paragraphs:state.opaque_paragraphs}],layout_verified:false};
 }};
}
export function editLocalComplex(HwpDocument,source,version,op){
 const schemas={splice_text:['start','end','new_text'],replace_text:['new_text'],set_field:['new_text'],format_text:['start','end','props'],format_paragraph:['props'],move_picture_group:['expected_properties','props'],crop_group_picture:['picture_index','expected_properties','props']};
 if(!schemas[op.type]||!equal(Object.keys(op).sort(),['type','target_id','expected_old',...schemas[op.type]].sort()))fail('COMPLEX_OPERATION_UNSUPPORTED');
 if(typeof op.target_id!=='string'||!op.target_id.startsWith(`hwp5:${version}:`))fail('VERSION_CONFLICT');const encoded=op.target_id.slice(70),id=Buffer.from(encoded,'base64url').toString();if(Buffer.from(id).toString('base64url')!==encoded)fail('INVALID_TARGET');
 const before=inspection(HwpDocument,source),field=before.fields.find(f=>f.id===id),group=before.groups.find(g=>g.id===id),b=before.blocks.find(b=>b.id===(field?.block_id??group?.block_id??id));if(!b)fail('INVALID_TARGET');
 const expected=field?field.value:b.text;if(expected!==op.expected_old)fail('EXPECTED_OLD_MISMATCH');let records=before.recordSets.get(b.section),wanted=b.text;
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
