/** Real packaged CLI round trip in a dependency-free, synthetic temporary folder. */
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';
import { fixture } from '../../../tests/rhwp_fixtures.mjs';
import {deflateSync} from 'node:zlib';
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'../../..');
const built=path.join(root,'outputs/plugin-package/hwp-easy');
const temporary=fs.mkdtempSync(path.join(os.tmpdir(),'hwp-easy-package-test-'));
const reportDir=path.join(root,'outputs/local-plugin-20261011');
fs.mkdirSync(reportDir,{recursive:true});
const hash=bytes=>createHash('sha256').update(bytes).digest('hex');
try {
 const packageDir=path.join(temporary,'installed package');fs.cpSync(built,packageDir,{recursive:true});
 const runner=path.join(packageDir,'skills/edit-local-hwp/scripts/local-runner.mjs');
 const source=path.join(temporary,'합성 실제 로컬 파일.hwp'),original=fixture();fs.writeFileSync(source,original);
 const call=request=>{
   const file=path.join(temporary,'request.json');fs.writeFileSync(file,JSON.stringify(request));
   const result=spawnSync(process.execPath,[runner,'--request',file],{cwd:temporary,encoding:'utf8',timeout:65000,windowsHide:true,
     env:{...process.env,NODE_PATH:''}});
   assert.equal(result.status,0,`packaged call failed: ${result.stdout}`);assert.equal(result.stderr,'');
   const response=JSON.parse(result.stdout);assert.equal(response.ok,true);return response.result;
 };
 const capabilities=call({action:'capabilities'});assert.equal(capabilities.web_browser_required,false);
 const read=()=>call({action:'read',source,max_chars:64000,max_blocks:128});
 const requestFor=(state,operation)=>({source,expected_sha256:state.source_sha256,operations:[operation]});
 let state=read(),target=state.blocks.find(b=>b.text==='합성 답변 원문');
 const replace={type:'replace_text',target_id:target.target_id,expected_old:target.text,new_text:'첫 답변\n둘째 답변 😀'};
 const plan=call({action:'plan',...requestFor(state,replace)});assert.equal(plan.saved,false);assert.deepEqual(fs.readFileSync(source),original);
 const edited=call({action:'edit',...requestFor(state,replace)});assert.equal(edited.saved_path,source);assert.equal(edited.selected_file_updated,true);
 state=read();assert.ok(state.blocks.some(b=>b.text==='둘째 답변 😀'));
 const multiline=fs.readFileSync(source);fs.writeFileSync(path.join(reportDir,'synthetic-multiline.hwp'),multiline);
 target=state.blocks.find(b=>b.text==='중간 합성 문단');
 const paragraphs=call({action:'edit',...requestFor(state,{type:'insert_paragraphs',target_id:target.target_id,expected_old:target.text,paragraphs:['추가한 문단','다음 문단']})});
 state=read();assert.ok(state.blocks.some(b=>b.text==='추가한 문단'));target=state.blocks.find(b=>b.text==='마지막 합성 문단');
 const table=call({action:'edit',...requestFor(state,{type:'create_table',target_id:target.target_id,expected_old:target.text,cells:[['제목','새 표'],['내용','표 내용']]})});
 state=read();assert.equal(state.table_count,2);assert.ok(state.blocks.some(b=>b.kind==='cell'&&b.text==='표 내용'));
 const withTable=fs.readFileSync(source);fs.writeFileSync(path.join(reportDir,'synthetic-structure.hwp'),withTable);
 const apply=(find,type,extra={})=>{
  state=read();const block=state.blocks.find(find);assert.ok(block);
  return call({action:'edit',...requestFor(state,{type,target_id:block.target_id,expected_old:block.text,...extra})});
 };
 const tableCell=b=>b.kind==='cell'&&b.text==='제목';
 apply(tableCell,'insert_table_row',{index:1,texts:['새 행 1','새 행 2']});
 apply(tableCell,'insert_table_column',{index:1,texts:['새 열 1','새 열 2','새 열 3']});
 apply(tableCell,'delete_table_row',{index:1,expected_cells:[['새 행 1'],['새 열 2'],['새 행 2']]});
 apply(tableCell,'delete_table_column',{index:1,expected_cells:[['새 열 1'],['새 열 3']]});
 state=read();let previous=state.blocks.find(b=>b.text==='추가한 문단');
 apply(b=>b.kind==='paragraph'&&b.text==='다음 문단','merge_paragraph',{previous_target_id:previous.target_id,expected_previous:previous.text});
 apply(b=>b.kind==='paragraph'&&b.text==='추가한 문단다음 문단','delete_paragraph');
 state=read();previous=state.blocks.find(b=>b.kind==='cell'&&b.text==='첫 답변');
 apply(b=>b.kind==='cell'&&b.text==='둘째 답변 😀','merge_paragraph',{previous_target_id:previous.target_id,expected_previous:previous.text});
 state=read();assert.ok(state.blocks.some(b=>b.kind==='cell'&&b.text==='첫 답변둘째 답변 😀'));
 fs.writeFileSync(path.join(reportDir,'synthetic-restructured.hwp'),fs.readFileSync(source));
 fs.writeFileSync(path.join(reportDir,'synthetic-advanced-before.hwp'),fs.readFileSync(source));
 const answer=b=>b.kind==='cell'&&b.text==='첫 답변둘째 답변 😀';
 apply(answer,'format_text',{start:0,end:2,props:{bold:true,fontSize:1400,textColor:'#123456'}});
 fs.writeFileSync(path.join(reportDir,'synthetic-format-text.hwp'),fs.readFileSync(source));
 apply(answer,'format_text',{start:0,end:[...'첫 답변둘째 답변 😀'].length,props:{italic:true}});
 fs.writeFileSync(path.join(reportDir,'synthetic-format-runs.hwp'),fs.readFileSync(source));
 apply(answer,'format_paragraph',{props:{alignment:'center',lineSpacing:190}});
 fs.writeFileSync(path.join(reportDir,'synthetic-format-paragraph.hwp'),fs.readFileSync(source));
 apply(tableCell,'merge_table_cells',{range:{top:0,left:0,bottom:0,right:1},expected_cells:[['제목'],['새 표']]});
 fs.writeFileSync(path.join(reportDir,'synthetic-merge-cells.hwp'),fs.readFileSync(source));
 apply(tableCell,'split_table_cell',{expected_cells:[['제목','새 표']]});
 fs.writeFileSync(path.join(reportDir,'synthetic-split-cell.hwp'),fs.readFileSync(source));
 const image=path.join(temporary,'합성 PNG.png'),png=Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=','base64');fs.writeFileSync(image,png);
 fs.writeFileSync(path.join(reportDir,'synthetic-image.png'),png);
 apply(b=>b.kind==='paragraph'&&b.text==='중간 합성 문단','insert_picture',{offset:1,width:7200,height:3600,image:{source:image,expected_sha256:hash(png)}});
 fs.writeFileSync(path.join(reportDir,'synthetic-insert-picture.hwp'),fs.readFileSync(source));
 state=read();let picture=state.pictures[0];assert.ok(picture);
 apply(b=>b.kind==='paragraph'&&b.text==='중간 합성 문단','update_picture',{expected_properties:picture.properties,props:{width:10000,height:5000,horzOffset:200,vertOffset:100}});
 fs.writeFileSync(path.join(reportDir,'synthetic-update-picture.hwp'),fs.readFileSync(source));
 state=read();picture=state.pictures[0];
 const removed=apply(b=>b.kind==='paragraph'&&b.text==='중간 합성 문단','delete_picture',{expected_properties:picture.properties});assert.equal(removed.retained_unused_image_data,true);
 fs.writeFileSync(path.join(reportDir,'synthetic-delete-picture.hwp'),fs.readFileSync(source));state=read();assert.equal(state.pictures.length,0);
 apply(answer,'format_text',{start:0,end:2,props:{fontFamily:'맑은 고딕'}});
 fs.writeFileSync(path.join(reportDir,'synthetic-font-family.hwp'),fs.readFileSync(source));
 apply(tableCell,'merge_table_cells',{range:{top:0,left:0,bottom:0,right:1},expected_cells:[['제목','새 표'],['']]});
 fs.writeFileSync(path.join(reportDir,'synthetic-merged-axis-before.hwp'),fs.readFileSync(source));
 for(const [type,index] of [['insert_table_row',1],['insert_table_column',1],['delete_table_row',1],['delete_table_column',1]]){
  state=read();const anchor=state.blocks.find(tableCell),cells=state.blocks.filter(b=>b.kind==='cell'&&b.paragraph===anchor.paragraph&&b.control===anchor.control),rowAxis=type.endsWith('_row'),adding=type.startsWith('insert_');
  const grouped=[];for(const b of cells){let c=grouped.find(c=>c.cell===b.cell);if(!c){c={...b,texts:[]};grouped.push(c);}c.texts.push(b.text);}
  const rows=Math.max(...grouped.map(c=>c.row+c.row_span)),cols=Math.max(...grouped.map(c=>c.column+c.column_span));
  const extra=adding?{texts:Array(rowAxis?cols:rows).fill('')}:{expected_cells:grouped.filter(c=>rowAxis?c.row<=index&&index<c.row+c.row_span:c.column<=index&&index<c.column+c.column_span).map(c=>c.texts)};
  apply(tableCell,type,{index,...extra});fs.writeFileSync(path.join(reportDir,`synthetic-merged-${type}.hwp`),fs.readFileSync(source));
 }
 apply(tableCell,'insert_picture',{offset:1,width:7200,height:3600,image:{source:image,expected_sha256:hash(png)}});
 fs.writeFileSync(path.join(reportDir,'synthetic-cell-picture.hwp'),fs.readFileSync(source));state=read();picture=state.pictures[0];assert.equal(picture.format,'cell_picture');assert.equal(picture.properties.treatAsChar,true);
 const chunk=(name,data)=>{const b=Buffer.alloc(12+data.length);b.writeUInt32BE(data.length);b.write(name,4);data.copy(b,8);let crc=0xffffffff;for(const n of b.subarray(4,-4)){crc^=n;for(let i=0;i<8;i++)crc=crc>>>1^((crc&1)?0xedb88320:0);}b.writeUInt32BE((crc^0xffffffff)>>>0,b.length-4);return b;},ihdr=Buffer.alloc(13);ihdr.writeUInt32BE(2);ihdr.writeUInt32BE(3,4);ihdr[8]=8;ihdr[9]=6;
 const replacement=Buffer.concat([Buffer.from([137,80,78,71,13,10,26,10]),chunk('IHDR',ihdr),chunk('IDAT',deflateSync(Buffer.alloc(27))),chunk('IEND',Buffer.alloc(0))]),replacementFile=path.join(temporary,'replacement.png');fs.writeFileSync(replacementFile,replacement);fs.writeFileSync(path.join(reportDir,'synthetic-replacement.png'),replacement);
 apply(tableCell,'replace_picture',{expected_properties:picture.properties,image:{source:replacementFile,expected_sha256:hash(replacement)}});
 fs.writeFileSync(path.join(reportDir,'synthetic-cell-replaced.hwp'),fs.readFileSync(source));state=read();picture=state.pictures[0];
 apply(tableCell,'update_picture',{expected_properties:picture.properties,props:{width:6000,height:3000}});
 fs.writeFileSync(path.join(reportDir,'synthetic-cell-resized.hwp'),fs.readFileSync(source));state=read();picture=state.pictures[0];
 apply(tableCell,'delete_picture',{expected_properties:picture.properties});
 fs.writeFileSync(path.join(reportDir,'synthetic-cell-removed.hwp'),fs.readFileSync(source));state=read();assert.equal(state.pictures.length,0);
 const preview=call({action:'preview',source,expected_sha256:state.source_sha256,page:0});assert.ok(preview.svg.startsWith('<svg'));
 const history=call({action:'history',source,expected_sha256:state.source_sha256,limit:50});assert.equal(history.saved,false);
 assert.ok(history.entries.some(e=>e.backup_id===edited.backup_id&&e.sha256===hash(original)&&e.backup_verified));
 assert.ok(history.entries.every(e=>e.size_bytes>0&&typeof e.created_at==='string'));
 const restored=call({action:'restore',source,expected_sha256:state.source_sha256,backup_id:edited.backup_id});
 assert.deepEqual(fs.readFileSync(source),original);fs.writeFileSync(path.join(reportDir,'synthetic-original.hwp'),original);
 const report={status:'PASS',environment:process.platform,node:process.version,isolated_package_without_node_modules:true,
   local_path_with_korean_and_spaces:true,external_browser_opened:false,network_transfer_used:false,
   plan_did_not_save:true,edit_saved_same_selected_path:true,multiline_cell_saved_and_reopened:true,
   new_body_paragraphs_saved_and_reopened:true,new_table_saved_and_reopened:true,passive_svg_preview:true,
   paragraph_merge_and_delete_saved_and_reopened:true,table_row_column_insert_and_delete_saved_and_reopened:true,
   format_text_and_paragraph_saved_and_reopened:true,merged_cell_split_merge_saved_and_reopened:true,
   body_png_insert_resize_move_delete_saved_and_reopened:true,
   merged_rows_columns_saved_and_reopened:true,font_family_saved_and_reopened:true,
   cell_png_insert_replace_resize_delete_saved_and_reopened:true,
   restore_exact_original_bytes:true,backup_count:fs.readdirSync(path.join(temporary,'.hwp-easy-backups')).filter(p=>p.endsWith('.hwp')).length,
   original_sha256:hash(original),multiline_sha256:hash(multiline),structure_sha256:hash(withTable),layout_verified:false,
   publication:'NOT_DONE',global_codex_configuration_changed:false};
 fs.writeFileSync(path.join(reportDir,'verification-summary.json'),JSON.stringify(report,null,2)+'\n');console.log(JSON.stringify(report));
}finally {
 assert.equal(path.dirname(temporary),os.tmpdir());assert.ok(path.basename(temporary).startsWith('hwp-easy-package-test-'));
 fs.rmSync(temporary,{recursive:true,force:true});
}
