/** Exercise an installed client bundle, never the source entrypoint. */
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {spawnSync} from 'node:child_process';
import {fixture} from '../../../tests/rhwp_fixtures.mjs';

const [pluginArgument,reportArgument,nodeArgument]=process.argv.slice(2);
assert.ok(pluginArgument&&reportArgument,'Usage: node check-installed-plugin.mjs <installed-plugin> <report-dir> [node-executable]');
const plugin=path.resolve(pluginArgument),reportDir=path.resolve(reportArgument),node=nodeArgument||process.execPath;
const manifest=JSON.parse(fs.readFileSync(path.join(plugin,'build-manifest.json'),'utf8'));
const standalone=manifest.distribution?.type==='agent_skill';
const metadata=standalone?{name:manifest.package,version:manifest.version}:JSON.parse(fs.readFileSync(path.join(plugin,'plugin.json'),'utf8'));
const directoryPackage=!standalone&&manifest.distribution?.type==='openai_directory'&&manifest.distribution?.source_package==='hwp-easy';
assert.equal(metadata.name,directoryPackage?'hwp-easy-local':'hwp-easy');assert.equal(manifest.package,metadata.name);assert.equal(manifest.version,metadata.version);
if(!standalone)assert.equal(metadata.extensions['com.openai'].interface.displayName,'HWP Easy');
const skill=standalone?plugin:path.join(plugin,'skills/edit-local-hwp');
if(standalone) {
 const {inspectSkill}=await import('../../install/install_agent_skill.mjs');
 await inspectSkill(plugin,manifest.distribution.client);
}
assert.match(fs.readFileSync(path.join(skill,'agents/openai.yaml'),'utf8'),/allow_implicit_invocation: false/);
assert.equal(fs.existsSync(path.join(plugin,'node_modules')),false);
assert.equal(fs.existsSync(path.join(plugin,'mcp.json')),false);
assert.equal(fs.existsSync(path.join(plugin,'.mcp.json')),false);
const hash=bytes=>createHash('sha256').update(bytes).digest('hex');
const runner=path.join(skill,'scripts/local-runner.mjs');
assert.equal(hash(fs.readFileSync(runner)),manifest.runner_sha256);
assert.equal(hash(fs.readFileSync(path.join(skill,'scripts/rhwp_bg.wasm'))),manifest.wasm_sha256);
const temporary=fs.mkdtempSync(path.join(os.tmpdir(),'hwp-easy-installed-'));
fs.mkdirSync(reportDir,{recursive:true});
try {
 const source=path.join(temporary,'설치 검증 문서 with spaces.hwp'),original=fixture();fs.writeFileSync(source,original);
 const backups=path.join(temporary,'.hwp-easy-backups');
 const countBackups=()=>fs.existsSync(backups)?fs.readdirSync(backups).filter(name=>name.endsWith('.hwp')).length:0;
 const call=(request,error)=>{
  const requestFile=path.join(temporary,'request.json');fs.writeFileSync(requestFile,JSON.stringify(request));
  const result=spawnSync(node,[runner,'--request',requestFile],{cwd:temporary,encoding:'utf8',timeout:65000,windowsHide:true,env:{...process.env,NODE_PATH:''}});
  assert.equal(result.stderr,'');assert.equal(result.error,undefined);const response=JSON.parse(result.stdout);
  if(error){assert.equal(result.status,1);assert.equal(response.ok,false);assert.equal(response.error,error);assert.equal(response.save_confirmed,false);return response;}
  assert.equal(result.status,0,JSON.stringify(response));assert.equal(response.ok,true);return response.result;
 };
 const read=()=>{let state,cursor,blocks=[];do{const page=call({action:'read',source,max_chars:64000,max_blocks:128,...(cursor?{cursor,expected_sha256:state.source_sha256}:{})});state=page;blocks.push(...page.blocks);cursor=page.next_cursor;}while(cursor);return {...state,blocks};};
 const capabilities=call({action:'capabilities'});assert.equal(capabilities.uploads_required,false);assert.equal(capabilities.save_default,'same_file');
 const before=read(),body=before.blocks.find(block=>block.text==='중간 합성 문단'),cell=before.blocks.find(block=>block.text==='합성 답변 원문');assert.ok(body&&cell);
 const operations=[{type:'replace_text',target_id:body.target_id,expected_old:body.text,new_text:'설치된 HWP Easy로 수정한 본문'},
  {type:'replace_text',target_id:cell.target_id,expected_old:cell.text,new_text:'첫째 답변\n둘째 답변 😀'}];
 const request={source,expected_sha256:before.source_sha256,operations};
 assert.equal(call({action:'plan',...request}).saved,false);assert.deepEqual(fs.readFileSync(source),original);assert.equal(countBackups(),0);
 const edited=call({action:'edit',...request});assert.equal(edited.saved_path,source);assert.equal(edited.save_mode,'same_file');assert.equal(edited.selected_file_updated,true);assert.ok(edited.backup_id);assert.equal(countBackups(),1);
 const editedBytes=fs.readFileSync(source),after=read();assert.equal(hash(editedBytes),edited.output_sha256);assert.equal(after.source_sha256,edited.output_sha256);
 assert.ok(after.blocks.some(block=>block.text==='설치된 HWP Easy로 수정한 본문'));
 assert.ok(after.blocks.some(block=>block.kind==='cell'&&block.text==='첫째 답변'));
 assert.ok(after.blocks.some(block=>block.kind==='cell'&&block.text==='둘째 답변 😀'));
 for(const retained of ['첫 합성 문단','마지막 합성 문단','문항','반복 문구'])assert.ok(after.blocks.some(block=>block.text===retained));
 call({action:'edit',...request},'VERSION_CONFLICT');assert.deepEqual(fs.readFileSync(source),editedBytes);assert.equal(countBackups(),1);
 const currentBody=after.blocks.find(block=>block.text==='설치된 HWP Easy로 수정한 본문');
 const unchanged=call({action:'edit',source,expected_sha256:after.source_sha256,operations:[{type:'replace_text',target_id:currentBody.target_id,expected_old:currentBody.text,new_text:currentBody.text}]});
 assert.equal(unchanged.saved,false);assert.equal(countBackups(),1);
 const history=call({action:'history',source,expected_sha256:after.source_sha256,limit:50});
 assert.equal(history.saved,false);assert.ok(history.entries.some(entry=>entry.backup_id===edited.backup_id&&entry.sha256===hash(original)&&entry.backup_verified));
 assert.ok(call({action:'preview',source,expected_sha256:after.source_sha256,page:0}).svg.startsWith('<svg'));
 const restored=call({action:'restore',source,expected_sha256:after.source_sha256,backup_id:edited.backup_id});
 assert.equal(restored.saved_path,source);assert.equal(restored.restored,true);assert.deepEqual(fs.readFileSync(source),original);assert.equal(countBackups(),2);
 const restoredState=read();assert.equal(restoredState.source_sha256,hash(original));assert.ok(restoredState.blocks.some(block=>block.text==='합성 답변 원문'));
 const finalHistory=call({action:'history',source,expected_sha256:restoredState.source_sha256,limit:50});
 assert.ok(finalHistory.entries.some(entry=>entry.sha256===hash(editedBytes)&&entry.backup_verified));
 // Recovery itself retains the edited version, which can be recovered in turn.
 const recoveredEdit=call({action:'restore',source,expected_sha256:restoredState.source_sha256,backup_id:restored.backup_id});
 assert.deepEqual(fs.readFileSync(source),editedBytes);assert.equal(recoveredEdit.output_sha256,hash(editedBytes));
 const finalRestore=call({action:'restore',source,expected_sha256:hash(editedBytes),backup_id:edited.backup_id});
 assert.equal(finalRestore.restored,true);assert.deepEqual(fs.readFileSync(source),original);
 for(const [name,bytes]of [['synthetic-original.hwp',original],['synthetic-edited.hwp',editedBytes],['synthetic-restored.hwp',fs.readFileSync(source)]])fs.writeFileSync(path.join(reportDir,name),bytes);
 const report={status:'PASS',scope:`${directoryPackage?'Extracted directory package':`Installed ${standalone?manifest.distribution.client:'codex'}`} runtime on ${process.platform}; synthetic HWP only`,
  client:standalone?manifest.distribution.client:'codex',
  plugin:metadata.name,version:metadata.version,installed_plugin_path:plugin,node_executable:node,
  runner_sha256:manifest.runner_sha256,wasm_sha256:manifest.wasm_sha256,
  explicit_only_skill:true,no_remote_mcp:true,no_node_modules_at_execution:true,plan_did_not_save:true,
  body_and_multiline_cell_edit_saved_same_file:true,saved_hash_and_reopened_content_verified:true,
  unrelated_text_preserved:true,stale_save_refused_without_write:true,no_op_did_not_save_or_backup:true,
  history_contains_verified_original:true,svg_preview:true,restore_exact_original_bytes:true,
  restoration_keeps_edited_version:true,recover_edited_version_then_original:true,
  original_sha256:hash(original),edited_sha256:hash(editedBytes),restored_sha256:hash(fs.readFileSync(source)),
  backup_count:countBackups(),external_viewer_layout_verified:false,
  fresh_chat_skill_selection_verified:false,public_directory_publication:'NOT_DONE'};
 fs.writeFileSync(path.join(reportDir,'verification.json'),JSON.stringify(report,null,2)+'\n');console.log(JSON.stringify(report));
} finally {
 assert.equal(path.dirname(temporary),os.tmpdir());assert.ok(path.basename(temporary).startsWith('hwp-easy-installed-'));
 fs.rmSync(temporary,{recursive:true,force:true});
}
