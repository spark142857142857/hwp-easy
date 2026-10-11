/** A packaged skill's fixed JSON-file entrypoint; Node/WASM only, no Python setup. */
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import { HwpDocument, initSync } from '@rhwp/core';
import { createDocumentEngine } from '../../probes/sites-runtime/engine/document.mjs';
import { createEngineApi } from './rhwp_api.mjs';
import { preservableStructuralProfile } from './local_structure.mjs';
import {localPictures} from './local_picture.mjs';
import {editLocalBatch} from './local_batch.mjs';
import { readHwp } from '../../probes/sites-runtime/guard/container.mjs';
import { readLocal, saveLocal, restoreLocal } from './local_file.mjs';
import { GuardError } from '../../probes/sites-runtime/guard/records.mjs';

let initialized = false;
export function initializeLocal(wasmBytes) { if (!initialized) { initSync({module:wasmBytes}); initialized=true; } }
const fail = code => { throw new GuardError(code); };
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
  };
  const schema=schemas[request?.action];
  if(!schema)fail('INVALID_ACTION');
  object(request,schema,request.action==='capabilities'?['action']:request.action==='read'?['action','source']:['action','source','expected_sha256']);
  if(request.action==='capabilities')return {engine:'@rhwp/core',engine_version:'0.8.6',transport:'local_execution',
    save_default:'same_file',selected_file_updated:true,file_location:'current_execution_environment',uploads_required:false,web_browser_required:false,
    read:true,preview:true,edit:true,restore:true,new_paragraphs:true,multiline_body_and_cells:true,new_simple_tables:true,
    delete_paragraphs:true,merge_adjacent_paragraphs:true,split_paragraph:true,splice_text:true,mixed_style_multiline_insertion:true,
    insert_delete_table_rows_columns:true,
    insert_delete_merged_table_rows_columns:true,font_family_change:true,
    split_merge_table_cells:true,format_text:true,format_paragraph:true,
    resize_table_columns_rows:true,format_cell_layout:true,format_table_padding:true,
    atomic_operation_batches:true,max_operations:100,batch_target_ids:'initial_read; stable identity through verified position changes',
    pictures:{insert:'local PNG/JPEG, body paragraph or top-level table cell',replace:'local PNG/JPEG, retain frame size and position',update:'size, position, four-edge crop and integer-degree rotation',multiple_per_paragraph:32,picture_index_required_when_multiple:true,delete:true,delete_cleans_unused_embedded_data:false},
    edit_profiles:{existing_text:'guarded paragraph/cell replacement; selected range insertion/deletion/replacement preserves retained mixed character styles',
      structure:'uniform-style targets; paragraphs, simple or merged table rows/columns and verified cell split/merge; opaque page numbers and supported pictures preserved',
      formatting:'selected plain character ranges; font family/size/color/decorations and paragraph alignment/spacing; exact raw definition patches',
      table_layout:'plain or merged tables: column widths, stored row heights, cell padding/vertical alignment and table padding/spacing; text and pictures preserved',
      pictures:'up to 32 supported pictures per plain body paragraph or top-level cell paragraph; selected local PNG/JPEG insertion/replacement, size/position/crop/rotation/removal'},
    layout_verified:false,requires:'Node.js 22 or newer with local file permissions',max_input_bytes:4194304};
  const snapshot=readLocal(request.source,request.expected_sha256),engine=createDocumentEngine(HwpDocument,{includeTableMetadata:true});
  const document=await engine.open(snapshot.bytes),version=document.source_sha256;
  if(request.action==='read') {
    const result=document.read({expected_sha256:version,...Object.fromEntries(['cursor','max_chars','max_blocks'].filter(k=>Object.hasOwn(request,k)).map(k=>[k,request[k]]))});
    let structural;
    if(!result.all_content_supported || result.blocks.some(b=>!b.editable||b.style.profile==='existing_line_breaks_not_editable')) {
      const api=createEngineApi(HwpDocument,{existingLineBreaksEditable:true,mixedStyleSameLength:true}),opened=api.openDocument(snapshot.bytes);
      try {structural=api.inspectDocument(opened,snapshot.bytes);}finally{opened.free();}
    }
    const profileSupported=structural?preservableStructuralProfile(readHwp(snapshot.bytes),structural):result.all_content_supported;
    result.blocks=result.blocks.map(block=>{const local=structural?.blocks.find(b=>b.id===block.id)??block;return {...block,
      structural_editable:profileSupported&&Boolean(local.editable)&&local.style.char_shape_ids?.length===1,
      text_range_editable:profileSupported&&Boolean(local.editable)&&!/[\u0000-\u001f]/.test(local.text)};});
    let pictures=[],picture_profile_supported=true;
    try{pictures=localPictures(HwpDocument,snapshot.bytes,version);}catch(error){if(!(error instanceof GuardError))throw error;picture_profile_supported=false;}
    return {...result,pictures,picture_profile_supported,source:snapshot.source,persistence:'local_file',saved:false};
  }
  if(request.action==='preview')return {...document.preview({expected_sha256:version,page:request.page??0}),source:snapshot.source,saved:false};
  if(request.action==='restore') {
    const recovery=restoreLocal(snapshot,request.backup_id);
    await engine.open(recovery.bytes);
    return {...recovery.publish(),restored:true};
  }
  if(!Array.isArray(request.operations)||!request.operations.length||request.operations.length>100)fail('INVALID_OPERATIONS');
  const structural=readHwp(snapshot.bytes).profile.unsupported.some(x=>[76,85].includes(x.record_tag))||request.operations.some(op=>op?.type!=='replace_text'
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
  const {bytes,...verification}=candidate;
  if(request.action==='plan')return {...verification,source:snapshot.source,source_sha256:version,valid:true,serialization_checked:true,saved:false};
  return {...verification,...saveLocal(snapshot,bytes,{output:request.output,expected_output_sha256:request.expected_output_sha256})};
}

async function main() {
  const [mode,requestFile]=process.argv.slice(2);
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
