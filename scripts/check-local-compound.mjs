/** Atomic mixed edits on pinned public copies, using source mode or a bundle. */
import fs from 'node:fs';import path from 'node:path';import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';import {createHash} from 'node:crypto';
import {initializeLocal,runLocal} from '../src/one_hwp/local_runner.mjs';
import {baselineJpeg} from '../tests/local_image_fixtures.mjs';
const [corpusArgument,outArgument,runnerArgument,shortArgument]=process.argv.slice(2);
const shortAnswers=new Set((shortArgument??'').replace(/^--short-answers=/,'').split(',').filter(Boolean).map(Number));
assert.ok(!shortArgument||/^--short-answers=\d+(,\d+)*$/.test(shortArgument));
assert.ok(corpusArgument&&outArgument,'Usage: node check-local-compound.mjs <pinned-corpus> <fresh-output> [runner|--source]');
const corpus=path.resolve(corpusArgument),out=path.resolve(outArgument),sourceMode=runnerArgument==='--source',runner=path.resolve(runnerArgument&&!sourceMode?runnerArgument:'outputs/plugin-package/hwp-easy/skills/edit-local-hwp/scripts/local-runner.mjs');
assert.equal(fs.existsSync(out),false);fs.mkdirSync(out,{recursive:true});
if(sourceMode)initializeLocal(fs.readFileSync('node_modules/@rhwp/core/rhwp_bg.wasm'));
const hash=b=>createHash('sha256').update(b).digest('hex'),imagePath=path.join(out,'synthetic-signature.jpg');fs.writeFileSync(imagePath,baselineJpeg);const image={source:imagePath,expected_sha256:hash(baselineJpeg)};
const catalog=JSON.parse(fs.readFileSync(path.join(corpus,'sources.json')));assert.equal(catalog.upstream_commit,'1a76570e833917d15817415a53c09ad61ab3203f');
const call=async request=>{if(sourceMode){try{return {ok:true,result:await runLocal(request)};}catch(e){return {ok:false,error:e.code??String(e),save_confirmed:false};}}
 const file=path.join(out,'request.json');fs.writeFileSync(file,JSON.stringify(request));const r=spawnSync(process.execPath,[runner,'--request',file],{encoding:'utf8',timeout:65000,windowsHide:true,maxBuffer:8*1024*1024});assert.equal(r.error,undefined);assert.equal(r.stderr,'');return JSON.parse(r.stdout);};
const read=async source=>{let cursor,state,blocks=[];do{const r=await call({action:'read',source,max_chars:64000,max_blocks:128,...(cursor?{cursor,expected_sha256:state.source_sha256}:{})});assert.equal(r.ok,true,JSON.stringify(r));state=r.result;blocks.push(...state.blocks);cursor=state.next_cursor;}while(cursor);return {...state,blocks};};
const report=[];
for(const entry of catalog.entries){
 assert.ok(/^[\w.-]+\.hwp$/i.test(entry.file));const originalPath=path.join(corpus,entry.file),original=fs.readFileSync(originalPath);assert.equal(hash(original),entry.sha256);
 const directory=path.join(out,String(entry.id));fs.mkdirSync(directory);const source=path.join(directory,'selected.hwp');fs.writeFileSync(source,original);fs.writeFileSync(path.join(directory,'before.hwp'),original);
 const before=await read(source),operations=[],wanted=new Map(before.blocks.map(b=>[b.id,b.text])),changed=[],fieldValues=new Map(before.fields?.map(f=>[f.id,f.value])??[]);
 for(const f of (before.fields??[]).filter(f=>f.editable).slice(0,2)){
  const value=['회사명','작성자','부서명','전화번호','이메일'].includes(f.name)?`합성 입력 ${entry.id}`:Array.from({length:6},(_,i)=>`복합 검증 ${entry.id} 답변 ${i+1}: 경험과 결과, 다음 계획을 구체적으로 작성했습니다. 😀`).join('\n');
  operations.push({type:'set_field',target_id:f.target_id,expected_old:f.value,new_text:value});const old=wanted.get(f.block_id);wanted.set(f.block_id,[...old].slice(0,f.start).join('')+value+[...old].slice(f.end).join(''));fieldValues.set(f.id,value);changed.push({id:f.block_id,field:f,start:0,end:Math.min([...value].length,20),value});
 }
 for(const blockId of new Set(changed.map(c=>c.id))){let text=before.blocks.find(b=>b.id===blockId).text;for(const item of changed.filter(c=>c.id===blockId).sort((a,b)=>b.field.start-a.field.start))text=[...text].slice(0,item.field.start).join('')+item.value+[...text].slice(item.field.end).join('');wanted.set(blockId,text);}
 if(!changed.length){
  const candidates=before.blocks.filter(b=>b.text_range_editable).sort((a,b)=>b.cell_path.length-a.cell_path.length).slice(0,2);
  for(const b of candidates){const value=shortAnswers.has(entry.id)?`\n합성 입력 ${entry.id}`:Array.from({length:6},(_,i)=>`\n복합 검증 ${entry.id} ${i+1}: 여러 칸과 문단 서식, 그림을 함께 변경하는 합성 답변입니다. 😀`).join('');
   const at=[...b.text].length;operations.push({type:'splice_text',target_id:b.target_id,expected_old:b.text,start:at,end:at,new_text:value});wanted.set(b.id,b.text+value);changed.push({id:b.id,start:at+1,end:at+1+Math.min(20,[...value].length-1),value:b.text+value});}
 }
 assert.ok(changed.length);const selected=changed[0],block=before.blocks.find(b=>b.id===selected.id),target=selected.field??block;
 operations.push({type:'format_text',target_id:target.target_id,expected_old:selected.field?fieldValues.get(target.id):wanted.get(block.id),start:selected.start,end:selected.end,props:{bold:true,fontSize:1250,textColor:'#245A83'}});
 operations.push({type:'format_paragraph',target_id:block.target_id,expected_old:wanted.get(block.id),props:{alignment:'left',lineSpacing:175,spacingAfter:120}});
 operations.push({type:'insert_picture',target_id:block.target_id,expected_old:wanted.get(block.id),offset:[...wanted.get(block.id)].length,image,width:2400,height:1500});
 const bad=await call({action:'edit',source,expected_sha256:before.source_sha256,operations:[...operations,{type:'replace_text',target_id:block.target_id,expected_old:'synthetic stale value',new_text:'reject'}]});assert.equal(bad.ok,false);assert.deepEqual(fs.readFileSync(source),original);assert.equal(fs.existsSync(path.join(directory,'.hwp-easy-backups')),false);
 const request={source,expected_sha256:before.source_sha256,operations},plan=await call({action:'plan',...request});assert.deepEqual(fs.readFileSync(source),original);
 if(!plan.ok){const failure={id:entry.id,status:'FAILED',phase:'plan',error:plan.error};report.push(failure);console.log(JSON.stringify(failure));fs.writeFileSync(path.join(directory,'case.json'),JSON.stringify({before,operations,wanted:[...wanted],error:plan.error}));continue;}
 assert.equal(bad.error,'EXPECTED_OLD_MISMATCH');assert.equal(plan.result.saved,false);const edit=await call({action:'edit',...request});assert.equal(edit.ok,true,JSON.stringify(edit));assert.equal(edit.result.atomic_batch,true);assert.equal(edit.result.saved_path,source);assert.equal(edit.result.output_sha256,plan.result.output_sha256);const backups=fs.readdirSync(path.join(directory,'.hwp-easy-backups')).filter(n=>n.endsWith('.hwp'));assert.equal(backups.length,1);
 const after=await read(source);assert.equal(after.blocks.length,before.blocks.length);for(const b of after.blocks)assert.equal(b.text,wanted.get(b.id));for(const f of after.fields??[])assert.equal(f.value,fieldValues.get(f.id));assert.equal(after.pictures.length,(before.pictures?.length??0)+1);
 fs.writeFileSync(path.join(directory,'after.hwp'),fs.readFileSync(source));fs.writeFileSync(path.join(directory,'case.json'),JSON.stringify({before,after,operations,wanted:[...wanted],changed,preview_cache:edit.result.preview_cache,edited_sha256:edit.result.output_sha256},null,2));
 const stale=await call({action:'edit',...request});assert.equal(stale.ok,false);assert.equal(stale.error,'VERSION_CONFLICT');const restore=await call({action:'restore',source,expected_sha256:after.source_sha256,backup_id:edit.result.backup_id});assert.equal(restore.ok,true);assert.deepEqual(fs.readFileSync(source),original);fs.writeFileSync(path.join(directory,'restored.hwp'),fs.readFileSync(source));
 assert.equal(hash(fs.readFileSync(originalPath)),entry.sha256);const result={id:entry.id,status:'PASS',operations:operations.length,text_targets:changed.length,same_file_saved:true,final_failure_saved_nothing:true,restore_exact:true};report.push(result);console.log(JSON.stringify(result));
}
const summary={scope:sourceMode?'development source; not packaged runtime':'isolated bundled runtime',short_answer_ids:[...shortAnswers],runner_sha256:sourceMode?null:hash(fs.readFileSync(runner)),documents:report,layout_verified:false};
fs.writeFileSync(path.join(out,'results.json'),JSON.stringify(summary,null,2)+'\n');if(report.some(r=>r.status!=='PASS'))process.exitCode=1;
