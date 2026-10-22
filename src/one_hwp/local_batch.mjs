/** Verified in-memory operation sequence; the caller publishes only the final bytes. */
import {GuardError,parseRecords} from '../../probes/sites-runtime/guard/records.mjs';
import {readHwp} from '../../probes/sites-runtime/guard/container.mjs';
import {createDocumentEngine} from '../../probes/sites-runtime/engine/document.mjs';
import {digest} from './local_file.mjs';
import {structuralEdit} from './local_structure.mjs';
import {pictureEdit} from './local_picture.mjs';
import {tableFormatEdit} from './local_table_format.mjs';
import {moveLocalBlock} from './local_move.mjs';
import {hasLocalComplexContent,editLocalComplex,inspectLocalComplex} from './local_complex.mjs';
import {reflowLocal} from './local_reflow.mjs';
import {reflowTableLocal,tablePaginationEnabled,tableReflowContexts} from './local_table_reflow.mjs';
import {placementLocal} from './local_placement.mjs';
import {editTextBox} from './local_text_boxes.mjs';
import {transformTextBox} from './local_text_box_geometry.mjs';
import {layoutObjectIdentity} from './local_layout_identity.mjs';
import {standardBlockId} from './local_complex_table.mjs';

const fail=code=>{throw new GuardError(code);};
const pictureTypes=new Set(['insert_picture','update_picture','delete_picture','replace_picture']);
const tableTypes=new Set(['resize_table_columns','resize_table_rows','format_cell','format_table']);
function rawTarget(value,version){
  if(typeof value!=='string'||!value.startsWith(`hwp5:${version}:`))fail('VERSION_CONFLICT');
  const encoded=value.slice(70),id=Buffer.from(encoded,'base64url').toString('utf8');
  if(!id||Buffer.from(id).toString('base64url')!==encoded)fail('INVALID_TARGET');
  return id;
}
const target=(id,version)=>`hwp5:${version}:${Buffer.from(id).toString('base64url')}`;

export async function applyLocalOperation(HwpDocument,bytes,version,operation){
  if(operation.type==='reflow_table')return reflowTableLocal(HwpDocument,bytes,version,operation);
  if(['reposition_floating_object','protect_page_bottom'].includes(operation.type))return placementLocal(HwpDocument,bytes,version,operation);
  if(operation.type==='transform_text_box'){
    const state=inspectLocalComplex(HwpDocument,bytes,{includeDocumentInfo:false,verifyCharacterModel:false}),result=transformTextBox(state,bytes,version,operation);
    if(result.bytes!==bytes){
      const after=inspectLocalComplex(HwpDocument,result.bytes,{includeDocumentInfo:false,verifyCharacterModel:false}),id=rawTarget(operation.target_id,version),old=state.text_boxes.find(b=>b.id===id),now=after.text_boxes.find(b=>b.id===id);
      if(!now||JSON.stringify(now.properties)!==JSON.stringify({...old.properties,...operation.props})||JSON.stringify(now.flow)!==JSON.stringify(old.flow)||JSON.stringify(now.paragraphs.map(p=>[p.text,p.unit_styles]))!==JSON.stringify(old.paragraphs.map(p=>[p.text,p.unit_styles])))fail('TEXT_BOX_GEOMETRY_MISMATCH');
    }return result;
  }
  if(operation.type==='splice_text_box'){
    const state=inspectLocalComplex(HwpDocument,bytes,{includeDocumentInfo:false,verifyCharacterModel:false}),result=editTextBox(state,bytes,version,operation);
    if(result.bytes!==bytes){const after=inspectLocalComplex(HwpDocument,result.bytes,{includeDocumentInfo:false,verifyCharacterModel:false}),id=rawTarget(operation.target_id,version),old=state.text_boxes.flatMap(b=>b.paragraphs).find(p=>p.id===id),now=after.text_boxes.flatMap(b=>b.paragraphs).find(p=>p.id===id),wanted=[...old.text].slice(0,operation.start).join('')+operation.new_text+[...old.text].slice(operation.end).join('');if(!now||now.text!==wanted)fail('TEXT_BOX_CONTENT_MISMATCH');}return result;
  }
  if(['reflow_paragraph','reflow_object'].includes(operation.type))return reflowLocal(HwpDocument,bytes,version,operation);
  if(['insert_field','delete_field'].includes(operation.type)||Object.hasOwn(operation,'expected_cell_sha256'))return editLocalComplex(HwpDocument,bytes,version,operation);
  if(hasLocalComplexContent(readHwp(bytes)))return editLocalComplex(HwpDocument,bytes,version,operation);
  if(['insert_table_row','delete_table_row','insert_table_column','delete_table_column'].includes(operation.type)&&readHwp(bytes).profile.unsupported.some(x=>[76,85].includes(x.record_tag)))return editLocalComplex(HwpDocument,bytes,version,operation);
  if(['move_paragraph','move_table'].includes(operation.type))return moveLocalBlock(HwpDocument,bytes,version,operation);
  if(tableTypes.has(operation.type))return tableFormatEdit(HwpDocument,bytes,version,operation);
  if(pictureTypes.has(operation.type))return pictureEdit(HwpDocument,bytes,version,operation);
  if(operation.type==='replace_text'&&!readHwp(bytes).profile.unsupported.some(x=>[76,85].includes(x.record_tag))
    &&![operation.new_text,operation.expected_old].some(value=>typeof value==='string'&&value.includes('\n'))){
    if(Object.keys(operation).some(k=>!['type','target_id','expected_old','new_text'].includes(k)))fail('INVALID_ARGUMENTS');
    const document=await createDocumentEngine(HwpDocument,{plainStyleInspection:true}).open(bytes),{type,...replacement}=operation;
    return document.edit({expected_sha256:version,operations:[replacement]});
  }
  return structuralEdit(HwpDocument,bytes,version,operation);
}

export async function editLocalBatch(HwpDocument,source,initialVersion,operations){
  // Recognize the standard flow profile established by reflow_table. No
  // private stream or external session state is needed after reopening a file.
  const synchronized=new Map();
  const rootKey=(state,root)=>`${root.section}:${Buffer.from(state.recordSets.get(root.section)[root.record_index].payload.subarray(36,40)).toString('hex')}`;
  const remember=bytes=>{
    const raw=readHwp(bytes);let found=false;
    for(const {section} of raw.profile.sections)for(const r of parseRecords(raw.streams.get(`BodyText/Section${section}`)))if(r.tag===71&&r.payload.length>=42&&Buffer.from(r.payload.subarray(0,4)).toString()===' lbt'){
      const flags=new DataView(r.payload.buffer,r.payload.byteOffset,r.payload.byteLength).getUint32(4,true);
      if((flags&(1|(3<<3)|(3<<8)|(1<<20)))===((2<<3)|(2<<8)))found=true;
    }
    if(!found)return;
    const state=inspectLocalComplex(HwpDocument,bytes,{includeDocumentInfo:false,verifyCharacterModel:false});
    for(const root of state.tables.filter(t=>!t.cell_path.length&&tablePaginationEnabled(state,t))){
      const tree=state.tables.filter(t=>t.section===root.section&&t.record_index>=root.record_index&&t.end<=root.end);
      // A later explicit reflow must retain other roots' original baselines:
      // their earlier edits may still be waiting for final synchronization.
      const key=rootKey(state,root);if(tree.every(t=>tablePaginationEnabled(state,t))&&!synchronized.has(key))synchronized.set(key,signature(state,root));
    }
  };
  const blockShape=b=>b&&[b.text,b.unit_styles,b.paragraph_properties,b.character_runs];
  const signature=(state,root)=>JSON.stringify({inline_objects:[state.pictures.filter(p=>p.section===root.section&&p.flow.treatAsChar).map(p=>p.properties),state.text_boxes.filter(p=>p.section===root.section&&p.flow.treatAsChar).map(p=>[p.properties,p.paragraphs.map(p=>[p.text,p.unit_styles])])],host:blockShape(state.blocks.find(b=>b.id===root.parent_id)),page:state.recordSets.get(root.section).filter(r=>r.tag===73).map(r=>[...r.payload]),tables:state.tables.filter(t=>t.section===root.section&&t.record_index>=root.record_index&&t.end<=root.end).map(t=>({properties:t.properties,cells:t.cells.map(c=>({row:c.row,col:c.col,rowSpan:c.rowSpan,colSpan:c.colSpan,width:c.width,height:c.height,header:Buffer.from(state.recordSets.get(t.section)[c.start].payload).toString('base64'),blocks:c.blocks.map(blockShape)}))}))});
  remember(source);
  const identities=new Map(),keys=['target_id','previous_target_id','after_target_id','destination_target_id'];
  const references=op=>{const refs=keys.filter(k=>k==='target_id'||Object.hasOwn(op,k)).map(key=>({key,value:op[key]}));if(Object.hasOwn(op,'protected_objects')){if(!Array.isArray(op.protected_objects)||op.protected_objects.length>16)fail('INVALID_PROTECTED_OBJECTS');op.protected_objects.forEach((value,index)=>refs.push({key:'protected_objects',index,value}));}return refs;};
  // Every target belongs to the caller's initial read, even when it moves in
  // an earlier step. Text and picture conditions refer to each step's state.
  for(const op of operations){
    if(!op||Object.getPrototypeOf(op)!==Object.prototype)fail('INVALID_OPERATION');
    for(const {value} of references(op)){
      const id=rawTarget(value,initialVersion);identities.set(id,id);
    }
  }
  let bytes=source,last,layoutRemap=null;const outcomes=[],removedObjects=new Set(),relocatedPictureHosts=new Set();
  for(const [index,op] of operations.entries()){
    const currentVersion=digest(bytes),operation=structuredClone(op);
    if((pictureTypes.has(op.type)||op.type==='reposition_floating_object')&&relocatedPictureHosts.has(rawTarget(op.target_id,initialVersion)))fail('BATCH_RELOCATED_PICTURE_REQUIRES_READ');
    for(const {key,index,value} of references(op)){
      const identity=rawTarget(value,initialVersion),current=identities.get(identity);
      if(current===null)fail('BATCH_TARGET_REMOVED');
      if(index===undefined)operation[key]=target(current,currentVersion);else operation[key][index]=target(current,currentVersion);
    }
    let removed;
    if(operation.type==='delete_picture'){
      const state=inspectLocalComplex(HwpDocument,bytes,{includeDocumentInfo:false,verifyCharacterModel:false}),id=rawTarget(operation.target_id,currentVersion),b=state.blocks.find(b=>b.id===id||standardBlockId(b)===id),pictures=state.pictures.filter(p=>p.block_id===b?.id),p=pictures.find(p=>p.picture_index===(operation.picture_index??0));
      if(p)removed=layoutObjectIdentity(state,p);
    }
    let result;
    if(synchronized.size&&['replace_text','splice_text','format_text','format_paragraph','split_paragraph','merge_paragraph','insert_paragraphs','duplicate_paragraph','delete_paragraph'].includes(operation.type)){
      const state=inspectLocalComplex(HwpDocument,bytes,{includeDocumentInfo:false,verifyCharacterModel:false}),id=rawTarget(operation.target_id,currentVersion),block=state.blocks.find(b=>b.id===id||standardBlockId(b)===id);
      const root=block?.cell_path.length?state.tables.find(t=>!t.cell_path.length&&t.section===block.section&&t.record_index<block.record_index&&t.end>block.record_index):null;
      // A flowing root can contain HWP line-break characters even without any
      // nested controls. Keep those paragraphs on the verified raw edit path.
      if(root&&synchronized.has(rootKey(state,root))||block&&!block.cell_path.length&&state.tables.some(t=>t.section===block.section&&!t.cell_path.length&&synchronized.has(rootKey(state,t)))){
        const actual={...operation,target_id:target(block.id,currentVersion)};
        if(actual.previous_target_id){const previous=rawTarget(actual.previous_target_id,currentVersion),raw=state.blocks.find(b=>b.id===previous||standardBlockId(b)===previous);if(!raw)fail('INVALID_TARGET');actual.previous_target_id=target(raw.id,currentVersion);}
        result=editLocalComplex(HwpDocument,bytes,currentVersion,actual);
      }
    }
    result??=await applyLocalOperation(HwpDocument,bytes,currentVersion,operation);
    if(removed)removedObjects.add(removed);
    if(result.content_verified!==true||result.raw_preservation_verified!==true)fail('BATCH_VERIFICATION_FAILED');
    const {_target_remap,_relocated_picture_hosts,bytes:next,...verification}=result;
    if(_relocated_picture_hosts)for(const [initial,current] of identities)if(_relocated_picture_hosts.includes(current))relocatedPictureHosts.add(initial);
    if(_target_remap){
      if([...identities.values()].some(id=>id?.includes(':tb'))){
        const old=inspectLocalComplex(HwpDocument,bytes,{includeDocumentInfo:false,verifyCharacterModel:false}),after=inspectLocalComplex(HwpDocument,next,{includeDocumentInfo:false,verifyCharacterModel:false});
        for(const box of old.text_boxes){if(Object.hasOwn(_target_remap,box.id))continue;const candidates=after.text_boxes.filter(b=>b.section===box.section&&b.subtree_sha256===box.subtree_sha256);if(candidates.length!==1)continue;const now=candidates[0];_target_remap[box.id]=now.id;for(const p of box.paragraphs)_target_remap[p.id]=now.paragraphs[p.paragraph]?.id??null;}
      }
      if([...identities.values()].some(id=>id?.includes(':od'))){
        const old=inspectLocalComplex(HwpDocument,bytes,{includeDocumentInfo:false,verifyCharacterModel:false}),after=inspectLocalComplex(HwpDocument,next,{includeDocumentInfo:false,verifyCharacterModel:false});
        for(const d of old.opaque_drawings){if(Object.hasOwn(_target_remap,d.id))continue;const matches=after.opaque_drawings.filter(n=>n.section===d.section&&n.subtree_sha256===d.subtree_sha256);if(matches.length===1)_target_remap[d.id]=matches[0].id;}
      }
      if(layoutRemap===null)layoutRemap={..._target_remap};
      else for(const [initial,current] of Object.entries(layoutRemap))if(current!==null)layoutRemap[initial]=Object.hasOwn(_target_remap,current)?_target_remap[current]:null;
      for(const [initial,current] of identities){
        if(current===null)continue;
        if(!Object.hasOwn(_target_remap,current))fail('INVALID_TARGET');
        identities.set(initial,_target_remap[current]);
      }
    }
    outcomes.push({index,type:op.type,...verification});bytes=next;last=verification;
    if(op.type==='reflow_table')remember(bytes);
  }
  const automatic=[];
  if(synchronized.size){
    let state=inspectLocalComplex(HwpDocument,bytes,{includeDocumentInfo:false,verifyCharacterModel:false});
    for(const [key,old] of synchronized){
      const candidates=state.tables.filter(t=>!t.cell_path.length&&rootKey(state,t)===key);if(candidates.length>1)fail('TABLE_AUTO_SYNC_IDENTITY_UNVERIFIED');const root=candidates[0];
      if(!root||!tablePaginationEnabled(state,root)||signature(state,root)===old)continue;
      const version=digest(bytes),context=tableReflowContexts(state,version).find(c=>c.root_table_id===root.id);
      if(!context?.target_id)fail('TABLE_AUTO_SYNC_UNVERIFIED');
      const result=reflowTableLocal(HwpDocument,bytes,version,{type:'reflow_table',target_id:context.target_id,expected_old:context.expected_old,expected_tables:context.expected_tables});
      if(result._target_remap){if(layoutRemap===null)layoutRemap={...result._target_remap};else for(const [initial,current]of Object.entries(layoutRemap))if(current!==null)layoutRemap[initial]=result._target_remap[current]??null;}
      bytes=result.bytes;automatic.push({root_table_id:root.id,changed:!result.unchanged,...(result.structure_changed?{structure_changed:true,normalized_hosts:result.table_reflow.normalized_hosts}:{})});state=inspectLocalComplex(HwpDocument,bytes,{includeDocumentInfo:false,verifyCharacterModel:false});
    }
  }
  const sync=automatic.length?{table_auto_sync:automatic,...(automatic.some(t=>t.structure_changed)?{structure_changed:true,paragraph_count_changed:true}:{}),...(automatic.some(t=>t.changed)?{table_formatting_changed:true,flow_changed:true,raw_preservation_scope:'requested_operations_and_verified_automatic_table_height_flow_sync; retained_text_styles_widths_borders_and_other_streams_exact'}:{})}:{};
  if(operations.length===1)return {bytes,...last,...sync,_layout_target_remap:layoutRemap,_layout_removed_objects:[...removedObjects]};
  return {bytes,content_verified:true,raw_preservation_verified:true,
    raw_preservation_scope:'each_operation_verified_before_one_final_save',
    operation_count:operations.length,atomic_batch:true,
    structure_changed:outcomes.some(o=>o.structure_changed===true),
    formatting_changed:outcomes.some(o=>o.formatting_changed===true),
    table_formatting_changed:outcomes.some(o=>o.table_formatting_changed===true),
    text_range_changed:outcomes.some(o=>o.text_range_changed===true),
    picture_changed:outcomes.some(o=>o.picture_changed===true),
    picture_group_changed:outcomes.some(o=>o.picture_group_changed===true),
    page_layout_changed:outcomes.some(o=>o.page_layout_changed===true),
    text_box_changed:outcomes.some(o=>o.text_box_changed===true),
    text_box_geometry_changed:outcomes.some(o=>o.text_box_geometry_changed===true),
    flow_changed:outcomes.some(o=>o.flow_changed===true),
    ...sync,layout_verified:false,operations:outcomes,_layout_target_remap:layoutRemap,_layout_removed_objects:[...removedObjects]};
}
