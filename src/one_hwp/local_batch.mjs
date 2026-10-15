/** Verified in-memory operation sequence; the caller publishes only the final bytes. */
import {GuardError} from '../../probes/sites-runtime/guard/records.mjs';
import {readHwp} from '../../probes/sites-runtime/guard/container.mjs';
import {createDocumentEngine} from '../../probes/sites-runtime/engine/document.mjs';
import {digest} from './local_file.mjs';
import {structuralEdit} from './local_structure.mjs';
import {pictureEdit} from './local_picture.mjs';
import {tableFormatEdit} from './local_table_format.mjs';
import {moveLocalBlock} from './local_move.mjs';
import {hasLocalComplexContent,editLocalComplex,inspectLocalComplex} from './local_complex.mjs';
import {reflowLocal} from './local_reflow.mjs';
import {placementLocal} from './local_placement.mjs';
import {editTextBox} from './local_text_boxes.mjs';

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
  if(['reposition_floating_object','protect_page_bottom'].includes(operation.type))return placementLocal(HwpDocument,bytes,version,operation);
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
  const identities=new Map(),keys=['target_id','previous_target_id','after_target_id'];
  const references=op=>{const refs=keys.filter(k=>k==='target_id'||Object.hasOwn(op,k)).map(key=>({key,value:op[key]}));if(Object.hasOwn(op,'protected_objects')){if(!Array.isArray(op.protected_objects)||op.protected_objects.length>16)fail('INVALID_PROTECTED_OBJECTS');op.protected_objects.forEach((value,index)=>refs.push({key:'protected_objects',index,value}));}return refs;};
  // Every target belongs to the caller's initial read, even when it moves in
  // an earlier step. Text and picture conditions refer to each step's state.
  for(const op of operations){
    if(!op||Object.getPrototypeOf(op)!==Object.prototype)fail('INVALID_OPERATION');
    for(const {value} of references(op)){
      const id=rawTarget(value,initialVersion);identities.set(id,id);
    }
  }
  let bytes=source,last,layoutRemap=null;const outcomes=[];
  for(const [index,op] of operations.entries()){
    const currentVersion=digest(bytes),operation=structuredClone(op);
    for(const {key,index,value} of references(op)){
      const identity=rawTarget(value,initialVersion),current=identities.get(identity);
      if(current===null)fail('BATCH_TARGET_REMOVED');
      if(index===undefined)operation[key]=target(current,currentVersion);else operation[key][index]=target(current,currentVersion);
    }
    const result=await applyLocalOperation(HwpDocument,bytes,currentVersion,operation);
    if(result.content_verified!==true||result.raw_preservation_verified!==true)fail('BATCH_VERIFICATION_FAILED');
    const {_target_remap,bytes:next,...verification}=result;
    if(_target_remap){
      if([...identities.values()].some(id=>id?.includes(':tb'))){
        const old=inspectLocalComplex(HwpDocument,bytes,{includeDocumentInfo:false,verifyCharacterModel:false}),after=inspectLocalComplex(HwpDocument,next,{includeDocumentInfo:false,verifyCharacterModel:false});
        for(const box of old.text_boxes){const candidates=after.text_boxes.filter(b=>b.section===box.section&&b.subtree_sha256===box.subtree_sha256);if(candidates.length!==1)continue;const now=candidates[0];_target_remap[box.id]=now.id;for(const p of box.paragraphs)_target_remap[p.id]=now.paragraphs[p.paragraph]?.id??null;}
      }
      if([...identities.values()].some(id=>id?.includes(':od'))){
        const old=inspectLocalComplex(HwpDocument,bytes,{includeDocumentInfo:false,verifyCharacterModel:false}),after=inspectLocalComplex(HwpDocument,next,{includeDocumentInfo:false,verifyCharacterModel:false});
        for(const d of old.opaque_drawings){const matches=after.opaque_drawings.filter(n=>n.section===d.section&&n.subtree_sha256===d.subtree_sha256);if(matches.length===1)_target_remap[d.id]=matches[0].id;}
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
  }
  if(operations.length===1)return {bytes,...last,_layout_target_remap:layoutRemap};
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
    flow_changed:outcomes.some(o=>o.flow_changed===true),
    layout_verified:false,operations:outcomes,_layout_target_remap:layoutRemap};
}
