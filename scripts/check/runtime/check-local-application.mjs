/** End-to-end application form editing, through the file request interface. */
import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import {fileURLToPath} from 'node:url';
import {initializeLocal,runLocal} from '../../../src/one_hwp/local_runner.mjs';
import {digest} from '../../../src/one_hwp/local_file.mjs';
import {applicationFixture,applicationQuestions,applicationAnswers,applicationIdentity,applicationPlaceholder} from '../../../tests/local_application_fixture.mjs';
import {assertPlannedEdit} from '../../lib/local-plan-proof.mjs';

export async function checkApplication(out,call=runLocal){
 out=path.resolve(out);assert.equal(fs.existsSync(out),false);fs.mkdirSync(out,{recursive:true});
 const source=path.join(out,'자기소개서 편집 검증.hwp'),original=applicationFixture();fs.writeFileSync(source,original);
 const read=()=>call({action:'read',source,max_blocks:128,max_chars:64000});
 const replace=(b,new_text)=>({type:'splice_text',target_id:b.target_id,expected_old:b.text,start:0,end:[...b.text].length,new_text});
 // Context discovery includes descriptive fields that are not operation inputs.
 const flow=s=>{const {target_id,expected_old,expected_tables}=s.table_reflow[0];return {type:'reflow_table',target_id,expected_old,expected_tables};};
 const states=[],checks=[];
 const record=async(stage,s)=>{const bytes=fs.readFileSync(source);fs.writeFileSync(path.join(out,stage+'.hwp'),bytes);fs.writeFileSync(path.join(out,stage+'-read.json'),JSON.stringify(s,null,2));const layout=await call({action:'layout',source,scope:'rendered',expected_sha256:s.source_sha256});fs.writeFileSync(path.join(out,stage+'-layout.json'),JSON.stringify(layout,null,2));for(let page=0;page<layout.page_count;page++){const p=await call({action:'preview',source,page,expected_sha256:s.source_sha256});fs.writeFileSync(path.join(out,stage+'-'+page+'.svg'),p.svg);}states.push({stage,sha256:digest(bytes),pages:layout.page_count});};
 const initial=await read();assert.equal(initial.tables[0].dimensions.cellCount,16);await record('blank',initial);
 const ids=['[성명]','[직무]','[전공]','[이메일]'].map(t=>initial.blocks.find(b=>b.text===t));
 const targets=initial.blocks.filter(b=>b.text===applicationPlaceholder);assert.equal(targets.length,4);assert.equal(new Set(targets.map(b=>b.target_id)).size,4);
 const operations=[...ids.map((b,i)=>replace(b,applicationIdentity[i])),...targets.map((b,i)=>replace(b,applicationAnswers[i])),flow(initial)];
 const request={source,expected_sha256:initial.source_sha256,operations},plan=await call({action:'plan',...request});assert.deepEqual(fs.readFileSync(source),Buffer.from(original));
 const first=await call({action:'edit',...request});assert.equal(first.saved,true);assert.equal(first.saved_path,source);assertPlannedEdit(plan,first,'application-fill');
 let s=await read();for(const q of applicationQuestions)assert.ok(s.blocks.some(b=>b.text===q));for(const a of applicationAnswers)assert.ok(s.blocks.some(b=>b.text===a));await record('filled',s);
 const firstBytes=fs.readFileSync(source);checks.push({name:'fill',saved:true,same_file:true,answers:4,answer_characters:applicationAnswers.map(a=>[...a].length),backup_id:first.backup_id});
 await assert.rejects(call({action:'edit',...request}),/VERSION_CONFLICT/);assert.deepEqual(fs.readFileSync(source),firstBytes);
 const answer=s.blocks.find(b=>b.text===applicationAnswers[2]),long=Array.from({length:80},(_,i)=>`사례${String(i+1).padStart(3,'0')} 기록을 비교하고 원인을 확인한 뒤 수정 결과를 동료와 검증했습니다.`).join('\n');
 const second=await call({action:'edit',source,expected_sha256:s.source_sha256,operations:[replace(answer,long)]});assert.equal(second.saved,true);assert.equal(second.table_auto_sync.length,1);s=await read();await record('long',s);
 checks.push({name:'long_answer',saved:true,automatic_table_sync:true,lines:80,backup_id:second.backup_id});
 const current=s.blocks.find(b=>b.text===long),third=await call({action:'edit',source,expected_sha256:s.source_sha256,operations:[replace(current,applicationAnswers[2]),{...flow(s),row_height_policy:'content_fit'}]});s=await read();await record('revised',s);
 assert.ok(s.blocks.some(b=>b.text===applicationAnswers[2]));checks.push({name:'shrink',saved:true,explicit_content_fit:true,backup_id:third.backup_id});
 const beforeNoop=digest(fs.readFileSync(source)),noopBlock=s.blocks.find(b=>b.text===applicationAnswers[0]);const noop=await call({action:'edit',source,expected_sha256:s.source_sha256,operations:[replace(noopBlock,noopBlock.text)]});assert.equal(noop.saved,false);assert.equal(digest(fs.readFileSync(source)),beforeNoop);
 const invalid={source,expected_sha256:s.source_sha256,operations:[replace(noopBlock,'temporary'),{...replace(noopBlock,'bad'),expected_old:'stale'}]};await assert.rejects(call({action:'edit',...invalid}));assert.equal(digest(fs.readFileSync(source)),beforeNoop);
 const history=await call({action:'history',source,expected_sha256:s.source_sha256});assert.equal(history.entries.length,3);
 await call({action:'restore',source,expected_sha256:s.source_sha256,backup_id:second.backup_id});assert.deepEqual(fs.readFileSync(source),firstBytes);s=await read();await record('restored-filled',s);
 await call({action:'restore',source,expected_sha256:s.source_sha256,backup_id:first.backup_id});assert.deepEqual(fs.readFileSync(source),Buffer.from(original));s=await read();await record('restored-blank',s);
 const result={status:'PASS',states,checks,questions_preserved:true,duplicate_placeholders_targeted_by_id:true,same_file_save:true,stale_rejected:true,failed_batch_atomic:true,no_op_no_history:true,exact_intermediate_restore:true,exact_original_restore:true,layout_verified:false};
 fs.writeFileSync(path.join(out,'summary.json'),JSON.stringify(result,null,2)+'\n');return result;
}
if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url)){
 initializeLocal(fs.readFileSync(new URL('../../../node_modules/@rhwp/core/rhwp_bg.wasm',import.meta.url)));
 console.log(JSON.stringify(await checkApplication(process.argv[2]??'outputs/application-check')));
}
