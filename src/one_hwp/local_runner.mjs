/** A packaged skill's fixed JSON-file entrypoint; Node/WASM only, no Python setup. */
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import { HwpDocument as UpstreamHwpDocument, initSync } from '@rhwp/core';
import { createDocumentEngine } from '../../probes/sites-runtime/engine/document.mjs';
import {createLocalEngineApi as createEngineApi} from './local_api.mjs';
import { preservableStructuralProfile,recordsByBlock } from './local_structure.mjs';
import {localPictures} from './local_picture.mjs';
import {editLocalBatch} from './local_batch.mjs';
import { readHwp } from '../../probes/sites-runtime/guard/container.mjs';
import { readLocal, saveLocal, restoreLocal, localHistory, digest } from './local_file.mjs';
import { GuardError } from '../../probes/sites-runtime/guard/records.mjs';
import {textControlBytes} from '../../probes/sites-runtime/guard/preservation.mjs';
import {findLocalDocument,validateFind} from './local_find.mjs';
import {hasLocalComplexContent,createLocalComplexSnapshot} from './local_complex.mjs';
import {refreshLocalPreview,renderPreviewWorker} from './local_preview_cache.mjs';
import {createLocalDocumentClass} from './local_container_write.mjs';
const HwpDocument=createLocalDocumentClass(UpstreamHwpDocument);

let initialized = false;
export function initializeLocal(wasmBytes) { if (!initialized) { initSync({module:wasmBytes}); initialized=true; } }
const fail = code => { throw new GuardError(code); };
function rangeEligibleBlocks(document,version,raw,structural) {
  let model=structural;
  if(!model){
    const blocks=[];let cursor;
    do{const page=document.read({expected_sha256:version,max_chars:64000,max_blocks:128,...(cursor?{cursor}:{})});
      for(const block of page.blocks){if(blocks.at(-1)?.id===block.id)blocks.at(-1).text+=block.text;else blocks.push({...block});}
      cursor=page.next_cursor;
    }while(cursor);
    model={blocks};
  }
  const eligible=new Set();
  let mapped;
  try{mapped=recordsByBlock(raw,model);}catch(error){if(error instanceof GuardError&&error.code==='TARGET_MAPPING_UNVERIFIED')return eligible;throw error;}
  for(const [id,records] of mapped){
    if(records.some(r=>![66,67,68,69,72].includes(r.tag)))continue;
    if(records.filter(r=>r.tag===67).some(r=>{const c=textControlBytes(r.payload);return c.length!==2||c[0]!==13||c[1]!==0;}))continue;
    eligible.add(id);
  }
  return eligible;
}
function object(value, keys, required) {
  if (!value || Object.getPrototypeOf(value)!==Object.prototype || Object.keys(value).some(k=>!keys.includes(k))
    || required.some(k=>!Object.hasOwn(value,k))) fail('INVALID_ARGUMENTS');
}
export async function runLocal(request) {
  const schemas={
    capabilities: ['action'],
    read: ['action','source','expected_sha256','cursor','max_chars','max_blocks'],
    preview: ['action','source','expected_sha256','page'],
    plan: ['action','source','expected_sha256','operations'],
    edit: ['action','source','expected_sha256','operations','output','expected_output_sha256'],
    restore: ['action','source','expected_sha256','backup_id'],
    history: ['action','source','expected_sha256','limit'],
    find: ['action','source','expected_sha256','query','max_matches','cursor'],
  };
  const schema=schemas[request?.action];
  if(!schema)fail('INVALID_ACTION');
  object(request,schema,request.action==='capabilities'?['action']:request.action==='read'?['action','source']:['action','source','expected_sha256']);
  if(request.action==='capabilities')return {engine:'@rhwp/core',engine_version:'0.8.6',transport:'local_execution',
    save_default:'same_file',selected_file_updated:true,file_location:'current_execution_environment',uploads_required:false,web_browser_required:false,
    read:true,preview:true,edit:true,restore:true,find:true,local_recovery_history:true,new_paragraphs:true,multiline_body_and_cells:true,new_simple_tables:true,
    delete_paragraphs:true,merge_adjacent_paragraphs:true,split_paragraph:true,splice_text:true,mixed_style_multiline_insertion:true,
    move_body_paragraphs:true,move_complete_tables:true,duplicate_plain_body_and_cell_paragraphs:true,
    insert_delete_table_rows_columns:true,
    insert_delete_merged_table_rows_columns:true,font_family_change:true,
    split_merge_table_cells:true,format_text:true,format_paragraph:true,
    resize_table_columns_rows:true,format_cell_layout:true,format_table_padding:true,
    atomic_operation_batches:true,max_operations:100,batch_target_ids:'initial_read; stable identity through verified position changes',
    complex_local:{recursive_table_cell_text:true,max_cell_depth:8,clickhere_field_values:true,character_formatting:['bold','italic','underline','strikethrough','fontSize','textColor','fontFamily'],paragraph_formatting:['alignment','lineSpacing','marginLeft','marginRight','indent','spacingBefore','spacingAfter'],opaque_lists_preserved:true,field_format_offsets:'relative to explicit field value, Unicode code points',line_breaks:'HWP character 10 within same paragraph; up to 100 lines per inserted value',duplicate_field_names:'explicit field target ID',picture_groups:'move whole group; crop a selected PNG/JPEG child; preserve transforms',complex_structure_changes:false},
    pictures:{insert:'local PNG/JPEG, body paragraph or top-level table cell',replace:'local PNG/JPEG, retain frame size and position',update:'size, position, four-edge crop and integer-degree rotation',multiple_per_paragraph:32,picture_index_required_when_multiple:true,delete:true,delete_cleans_unused_embedded_data:false},
    edit_profiles:{existing_text:'guarded paragraph/cell replacement; selected range insertion/deletion/replacement preserves retained mixed character styles',
      structure:'uniform-style targets; paragraphs, simple or merged table rows/columns and verified cell split/merge; opaque page numbers and supported pictures preserved',
      formatting:'selected plain character ranges; font family/size/color/decorations and paragraph alignment/spacing; exact raw definition patches',
      table_layout:'plain or merged tables: column widths, stored row heights, cell padding/vertical alignment and table padding/spacing; text and pictures preserved',
      pictures:'up to 32 supported pictures per plain body paragraph or top-level cell paragraph; selected local PNG/JPEG insertion/replacement, size/position/crop/rotation/removal'},
    embedded_preview_refresh:{text:'bounded UTF-16 excerpt',image:'first-page BMP',on:'verified changed edit, before publication',font_substitution_possible:true},
    layout_verified:false,requires:'Node.js 22 or newer with local file permissions',max_input_bytes:4194304};
  const snapshot=readLocal(request.source,request.expected_sha256);
  if(request.action==='history')return localHistory(snapshot,request.limit);
  if(request.action==='find')validateFind(request,snapshot.sha256);
  const engine=createDocumentEngine(HwpDocument,{includeTableMetadata:request.action!=='find',plainStyleInspection:true});
  const complex=hasLocalComplexContent(readHwp(snapshot.bytes));
  let document,complexReadFailure;
  try {
    document=complex&&!['preview','restore'].includes(request.action)?createLocalComplexSnapshot(HwpDocument,snapshot.bytes,snapshot.sha256):await engine.open(snapshot.bytes);
  } catch(error) {
    // Unsupported lists or drawings must not hide every readable body block.
    // This fallback is exclusively read-only: never reuse its targets to edit.
    const readOnlyFailures=['COMPLEX_LIST_UNSUPPORTED','COMPLEX_LIST_UNVERIFIED','TARGET_MAPPING_UNVERIFIED','GROUP_PROFILE_UNSUPPORTED','GROUP_IMAGE_UNVERIFIED'];
    if(request.action!=='read'||!(error instanceof GuardError)||!readOnlyFailures.includes(error.code))throw error;
    complexReadFailure=error.code;
    document=await engine.open(snapshot.bytes);
  }
  const version=document.source_sha256;
  if(request.action==='find')return {...findLocalDocument(document,request),source:snapshot.source};
  if(request.action==='read') {
    const result=document.read({expected_sha256:version,...Object.fromEntries(['cursor','max_chars','max_blocks'].filter(k=>Object.hasOwn(request,k)).map(k=>[k,request[k]]))});
    if(complexReadFailure)return {...result,
      blocks:result.blocks.map(block=>({...block,target_id:null,editable:false,structural_editable:false,text_range_editable:false,character_format_editable:false})),
      fields:[],picture_groups:[],complex_profile:true,partial_read_only:true,partial_read_reason:complexReadFailure,
      target_mapping_verified:false,all_content_supported:false,content_complete:false,
      unsupported:[...result.unsupported,{kind:'complex_read_only_fallback',reason:complexReadFailure}],
      notice:'확인 가능한 본문과 표 셀만 읽기 전용으로 표시합니다. 머리말·글상자 등 다른 개체의 내용은 빠질 수 있으며 이 조회 결과로는 편집할 수 없습니다.',
      source:snapshot.source,persistence:'local_file',saved:false};
    if(complex)return {...result,source:snapshot.source,persistence:'local_file',saved:false};
    let structural;
    if(!result.all_content_supported || result.blocks.some(b=>!b.editable||b.style.profile==='existing_line_breaks_not_editable')) {
      const api=createEngineApi(HwpDocument,{existingLineBreaksEditable:true,mixedStyleSameLength:true}),opened=api.openDocument(snapshot.bytes);
      try {structural=api.inspectDocument(opened,snapshot.bytes);}finally{opened.free();}
    }
    const profileSupported=structural?preservableStructuralProfile(readHwp(snapshot.bytes),structural):result.all_content_supported;
    const ranges=rangeEligibleBlocks(document,version,readHwp(snapshot.bytes),structural);
    result.blocks=result.blocks.map(block=>{const local=structural?.blocks.find(b=>b.id===block.id)??block;return {...block,
      structural_editable:profileSupported&&Boolean(local.editable)&&local.style.char_shape_ids?.length===1,
      text_range_editable:profileSupported&&Boolean(local.editable)&&ranges.has(block.id)&&!/[\u0000-\u001f]/.test(local.text)};});
    let pictures=[],picture_profile_supported=true;
    try{pictures=localPictures(HwpDocument,snapshot.bytes,version);}catch(error){if(!(error instanceof GuardError))throw error;picture_profile_supported=false;}
    return {...result,pictures,picture_profile_supported,source:snapshot.source,persistence:'local_file',saved:false};
  }
  if(request.action==='preview')return {...document.preview({expected_sha256:version,page:request.page??0}),preview_source:'current_document_render',embedded_preview_cache:'not_used',source:snapshot.source,saved:false};
  if(request.action==='restore') {
    const recovery=restoreLocal(snapshot,request.backup_id);
    await engine.open(recovery.bytes);
    return {...recovery.publish(),restored:true};
  }
  if(!Array.isArray(request.operations)||!request.operations.length||request.operations.length>100)fail('INVALID_OPERATIONS');
  const structural=complex||readHwp(snapshot.bytes).profile.unsupported.some(x=>[76,85].includes(x.record_tag))||request.operations.some(op=>op?.type!=='replace_text'
    || typeof op?.new_text==='string'&&op.new_text.includes('\n')
    || typeof op?.expected_old==='string'&&op.expected_old.includes('\n'));
  let candidate;
  if(structural) {
    candidate=await editLocalBatch(HwpDocument,snapshot.bytes,version,request.operations);
  } else {
    const operations=request.operations.map(op=>{
      object(op,['type','target_id','expected_old','new_text'],['type','target_id','expected_old','new_text']);
      const {type,...replacement}=op;return replacement;
    });
    candidate=await document.edit({expected_sha256:version,operations});
  }
  let {bytes,...verification}=candidate;
  // The candidate above still validates every target and expected value. An
  // identical text request must not save serializer/container normalization.
  if(request.operations.every(op=>op.type==='replace_text'&&op.expected_old===op.new_text)){
    bytes=snapshot.bytes;verification.output_sha256=snapshot.sha256;
  }
  if(!Buffer.from(bytes).equals(Buffer.from(snapshot.bytes))){
    const preview=await refreshLocalPreview(HwpDocument,bytes);bytes=preview.bytes;verification.preview_cache=preview.preview_cache;
  }else verification.preview_cache={status:'unchanged',document_streams_preserved:true};
  verification.output_sha256=digest(bytes);
  if(request.action==='plan')return {...verification,source:snapshot.source,source_sha256:version,valid:true,serialization_checked:true,saved:false};
  return {...verification,...saveLocal(snapshot,bytes,{output:request.output,expected_output_sha256:request.expected_output_sha256})};
}

async function main() {
  const [mode,requestFile]=process.argv.slice(2);
  if(mode==='--preview-worker'&&process.argv.length===3){const bytes=fs.readFileSync(0);if(bytes.length>4194304)fail('INPUT_LIMIT_EXCEEDED');process.stdout.write(JSON.stringify(await renderPreviewWorker(bytes)));return;}
  if(!['--request','--worker'].includes(mode)||!requestFile||process.argv.length!==4)fail('INVALID_ARGUMENTS');
  if(mode==='--request') {
    const result=spawnSync(process.execPath,['--max-old-space-size=256',fileURLToPath(import.meta.url),'--worker',requestFile],
      {encoding:'utf8',timeout:60000,maxBuffer:8*1024*1024,windowsHide:true});
    if(result.error||result.signal)fail('ENGINE_TIMEOUT_OR_RESOURCE_LIMIT');
    // The child writes only fixed errors or JSON results, never upstream stderr.
    const parsed=JSON.parse(result.stdout);process.stdout.write(JSON.stringify(parsed));process.exitCode=result.status??1;return;
  }
  if(fs.statSync(requestFile).size>1200000)fail('REQUEST_LIMIT_EXCEEDED');
  const request=JSON.parse(fs.readFileSync(requestFile,'utf8').replace(/^\uFEFF/,''));
  const bundledWasm=new URL('./rhwp_bg.wasm',import.meta.url);
  initializeLocal(fs.readFileSync(fs.existsSync(bundledWasm)?bundledWasm:new URL('../../node_modules/@rhwp/core/rhwp_bg.wasm',import.meta.url)));
  process.stdout.write(JSON.stringify({ok:true,result:await runLocal(request)}));
}
if(process.argv[1]&&fileURLToPath(import.meta.url)===process.argv[1]) {
  console.error=()=>{};
  try {await main();} catch(error) {
    const code=error instanceof GuardError&&/^[A-Z_]{1,80}$/.test(error.code)?error.code:'LOCAL_OPERATION_FAILED';
    process.stdout.write(JSON.stringify({ok:false,error:code,save_confirmed:false}));process.exitCode=1;
  }
}
