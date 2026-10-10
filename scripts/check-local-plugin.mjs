/** Real packaged CLI round trip in a dependency-free, synthetic temporary folder. */
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';
import { fixture } from '../tests/rhwp_fixtures.mjs';
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const built=path.join(root,'outputs/local-plugin-20261011/hwp-easy-local');
const temporary=fs.mkdtempSync(path.join(os.tmpdir(),'hwp-easy-package-test-'));
const reportDir=path.join(root,'outputs/local-plugin-20261011');
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
 const preview=call({action:'preview',source,expected_sha256:state.source_sha256,page:0});assert.ok(preview.svg.startsWith('<svg'));
 const restored=call({action:'restore',source,expected_sha256:state.source_sha256,backup_id:edited.backup_id});
 assert.deepEqual(fs.readFileSync(source),original);fs.writeFileSync(path.join(reportDir,'synthetic-original.hwp'),original);
 const report={status:'PASS',environment:process.platform,node:process.version,isolated_package_without_node_modules:true,
   local_path_with_korean_and_spaces:true,external_browser_opened:false,network_transfer_used:false,
   plan_did_not_save:true,edit_saved_same_selected_path:true,multiline_cell_saved_and_reopened:true,
   new_body_paragraphs_saved_and_reopened:true,new_table_saved_and_reopened:true,passive_svg_preview:true,
   restore_exact_original_bytes:true,backup_count:fs.readdirSync(path.join(temporary,'.hwp-easy-backups')).filter(p=>p.endsWith('.hwp')).length,
   original_sha256:hash(original),multiline_sha256:hash(multiline),structure_sha256:hash(withTable),layout_verified:false,
   publication:'NOT_DONE',global_codex_configuration_changed:false};
 fs.writeFileSync(path.join(reportDir,'verification-summary.json'),JSON.stringify(report,null,2)+'\n');console.log(JSON.stringify(report));
}finally {
 assert.equal(path.dirname(temporary),os.tmpdir());assert.ok(path.basename(temporary).startsWith('hwp-easy-package-test-'));
 fs.rmSync(temporary,{recursive:true,force:true});
}
