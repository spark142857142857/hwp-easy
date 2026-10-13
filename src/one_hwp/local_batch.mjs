/** Verified in-memory operation sequence; the caller publishes only the final bytes. */
import {GuardError} from '../../probes/sites-runtime/guard/records.mjs';
import {readHwp} from '../../probes/sites-runtime/guard/container.mjs';
import {createDocumentEngine} from '../../probes/sites-runtime/engine/document.mjs';
import {digest} from './local_file.mjs';
import {structuralEdit} from './local_structure.mjs';
import {pictureEdit} from './local_picture.mjs';
import {tableFormatEdit} from './local_table_format.mjs';
import {moveLocalBlock} from './local_move.mjs';
import {hasLocalComplexContent,editLocalComplex} from './local_complex.mjs';

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
  // Every target belongs to the caller's initial read, even when it moves in
  // an earlier step. Text and picture conditions refer to each step's state.
  for(const op of operations){
    if(!op||Object.getPrototypeOf(op)!==Object.prototype)fail('INVALID_OPERATION');
    for(const key of keys)if(key==='target_id'||Object.hasOwn(op,key)){
      const id=rawTarget(op[key],initialVersion);identities.set(id,id);
    }
  }
  let bytes=source,last,layoutRemap=null;const outcomes=[];
  for(const [index,op] of operations.entries()){
    const currentVersion=digest(bytes),operation=structuredClone(op);
    for(const key of keys)if(key==='target_id'||Object.hasOwn(op,key)){
      const identity=rawTarget(op[key],initialVersion),current=identities.get(identity);
      if(current===null)fail('BATCH_TARGET_REMOVED');
      operation[key]=target(current,currentVersion);
    }
    const result=await applyLocalOperation(HwpDocument,bytes,currentVersion,operation);
    if(result.content_verified!==true||result.raw_preservation_verified!==true)fail('BATCH_VERIFICATION_FAILED');
    const {_target_remap,bytes:next,...verification}=result;
    if(_target_remap){
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
    layout_verified:false,operations:outcomes,_layout_target_remap:layoutRemap};
}
