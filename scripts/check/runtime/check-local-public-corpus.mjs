/** Check pinned public documents on copies; leave downloaded originals untouched. */
import fs from 'node:fs';import path from 'node:path';import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';import {createHash} from 'node:crypto';
const [corpusArgument,outArgument,runnerArgument]=process.argv.slice(2);
assert.ok(corpusArgument&&outArgument,'Usage: node check-local-public-corpus.mjs <verified-public-corpus> <fresh-output-directory> [runner]');
const corpus=path.resolve(corpusArgument),out=path.resolve(outArgument),runner=path.resolve(runnerArgument??'outputs/plugin-package/hwp-easy/skills/edit-local-hwp/scripts/local-runner.mjs');
assert.equal(fs.existsSync(out),false,'Use a fresh output directory to preserve earlier evidence');
const catalog=JSON.parse(fs.readFileSync(path.join(corpus,'sources.json'))),commit='1a76570e833917d15817415a53c09ad61ab3203f';assert.equal(catalog.upstream_commit,commit);
fs.mkdirSync(out,{recursive:true});const hash=b=>createHash('sha256').update(b).digest('hex');
const call=req=>{const request=path.join(out,'request.json');fs.writeFileSync(request,JSON.stringify(req));const result=spawnSync(process.execPath,[runner,'--request',request],{encoding:'utf8',timeout:65000,windowsHide:true});assert.equal(result.error,undefined);return JSON.parse(result.stdout);};
const read=source=>{let state,cursor,blocks=[];do{const r=call({action:'read',source,max_chars:64000,max_blocks:128,...(cursor?{cursor,expected_sha256:state.source_sha256}:{})});assert.equal(r.ok,true,JSON.stringify(r));state=r.result;blocks.push(...state.blocks);cursor=state.next_cursor;}while(cursor);return {...state,blocks};};
const summary=[];
for(const entry of catalog.entries){
 assert.ok(/^[\w.-]+\.hwp$/i.test(entry.file));assert.equal(entry.url,`https://raw.githubusercontent.com/edwardkim/rhwp/${commit}/${entry.upstream_path}`);
 const originalPath=path.join(corpus,entry.file),original=fs.readFileSync(originalPath);assert.equal(hash(original),entry.sha256);
 const directory=path.join(out,String(entry.id));fs.mkdirSync(directory);const source=path.join(directory,'selected.hwp');fs.writeFileSync(source,original);fs.writeFileSync(path.join(directory,'before.hwp'),original);
 const state=read(source),field=state.fields?.find(f=>f.editable),block=state.blocks.find(b=>b.kind==='nested_cell'&&b.text_range_editable)??state.blocks.find(b=>b.text_range_editable);
 const result={id:entry.id,upstream_path:entry.upstream_path,read:true,partial_read_only:state.partial_read_only??false,mapped_blocks:state.blocks.filter(b=>b.target_id).length,unverified_text_blocks:state.blocks.filter(b=>b.text_mapping_verified===false).length,opaque_paragraphs:state.unsupported?.find(x=>x.kind==='complex_objects')?.opaque_paragraphs??0};
 const new_text='공개 양식 편집 검증 😀\n둘째 줄',operation=field?{type:'set_field',target_id:field.target_id,expected_old:field.value,new_text}:block?{type:'replace_text',target_id:block.target_id,expected_old:block.text,new_text}:null;
 if(!operation)result.edit='NO_SUPPORTED_TARGET';else{
  const request={source,expected_sha256:state.source_sha256,operations:[operation]},plan=call({action:'plan',...request});assert.equal(hash(fs.readFileSync(source)),entry.sha256);
  if(!plan.ok)result.edit=plan.error;else{
   const edit=call({action:'edit',...request});assert.equal(edit.ok,true,JSON.stringify(edit));const after=read(source);fs.writeFileSync(path.join(directory,'after.hwp'),fs.readFileSync(source));
   const hostBlock=field?state.blocks.find(b=>b.id===field.block_id):block,wanted=field?[...hostBlock.text].slice(0,field.start).join('')+new_text+[...hostBlock.text].slice(field.end).join(''):new_text;
   assert.equal(after.blocks.find(b=>b.id===hostBlock.id).text,wanted);for(const old of state.blocks)if(old.id!==hostBlock.id)assert.equal(after.blocks.find(b=>b.id===old.id).text,old.text);
   fs.writeFileSync(path.join(directory,'case.json'),JSON.stringify({before_target:hostBlock,field:field??null,operation,wanted,source_sha256:entry.sha256,edited_sha256:edit.result.output_sha256,preview_cache:edit.result.preview_cache},null,2));
   const restore=call({action:'restore',source,expected_sha256:after.source_sha256,backup_id:edit.result.backup_id});assert.equal(restore.ok,true);assert.deepEqual(fs.readFileSync(source),original);fs.writeFileSync(path.join(directory,'restored.hwp'),fs.readFileSync(source));result.edit='PASS';result.restore_exact_original=true;result.raw_preservation_verified=edit.result.raw_preservation_verified;result.preview_cache=edit.result.preview_cache;
  }
 }
 assert.equal(hash(fs.readFileSync(originalPath)),entry.sha256);summary.push(result);console.log(JSON.stringify(result));
}
fs.writeFileSync(path.join(out,'results.json'),JSON.stringify({upstream_commit:commit,runner_sha256:hash(fs.readFileSync(runner)),documents:summary,scope:'One verified text/field target per public document; not every object or layout'},null,2));
