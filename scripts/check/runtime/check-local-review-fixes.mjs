/** Verify crash recovery and review regressions against a copied shipped runner. */
import fs from 'node:fs';import path from 'node:path';import os from 'node:os';import assert from 'node:assert/strict';import {spawnSync} from 'node:child_process';import {createHash} from 'node:crypto';import {initSync} from '@rhwp/core';
import {fixture} from '../../../tests/rhwp_fixtures.mjs';import {nestedFixture} from '../../../tests/local_complex_fixtures.mjs';import {placementFixture} from '../../../tests/local_placement_fixtures.mjs';import {progressiveJpeg} from '../../../tests/local_image_fixtures.mjs';
initSync({module:fs.readFileSync('node_modules/@rhwp/core/rhwp_bg.wasm')});
const out=path.resolve(process.argv[2]??'outputs/local-review-fixes');assert.equal(fs.existsSync(out),false);fs.mkdirSync(out,{recursive:true});
const temp=fs.mkdtempSync(path.join(os.tmpdir(),'hwp-reviewed-package-')),pkg=path.join(temp,'package');fs.cpSync('outputs/plugin-package/hwp-easy',pkg,{recursive:true});
const scripts=path.join(pkg,'skills/edit-local-hwp/scripts'),runner=path.join(scripts,'local-runner.mjs'),manifest=JSON.parse(fs.readFileSync(path.join(pkg,'build-manifest.json'))),hash=b=>createHash('sha256').update(b).digest('hex'),cases=[];let sequence=0;
assert.equal(hash(fs.readFileSync(runner)),manifest.runner_sha256);
function invoke(request,entry=runner){const file=path.join(out,`request-${++sequence}.json`);fs.writeFileSync(file,JSON.stringify(request));const r=spawnSync(process.execPath,[entry,'--request',file],{cwd:temp,windowsHide:true,encoding:'utf8',timeout:65000,maxBuffer:8*1024*1024});assert.equal(r.error,undefined);assert.equal(r.stderr,'');const response=JSON.parse(r.stdout);fs.writeFileSync(path.join(out,`response-${sequence}.json`),JSON.stringify(response,null,2)+'\n');return response;}
const good=req=>{const r=invoke(req);assert.equal(r.ok,true,JSON.stringify(r));return r.result;},read=source=>good({action:'read',source,max_chars:64000,max_blocks:128});
const count=source=>fs.existsSync(path.join(path.dirname(source),'.hwp-easy-backups'))?fs.readdirSync(path.join(path.dirname(source),'.hwp-easy-backups')).filter(n=>n.endsWith('.hwp')).length:0;
const select=(name,bytes)=>{const dir=path.join(temp,name);fs.mkdirSync(dir);const source=path.join(dir,'선택 문서.hwp');fs.writeFileSync(source,bytes);return source;};
const bodyOp=(s,text)=>{const b=s.blocks.find(b=>b.text==='중간 합성 문단');return {type:'replace_text',target_id:b.target_id,expected_old:b.text,new_text:text};};
function keep(name,source,before,operations,saved,original){
 const after=read(source),edited=fs.readFileSync(source);assert.equal(saved.saved_path,source);assert.equal(saved.output_sha256,hash(edited));
 fs.writeFileSync(path.join(out,name+'-before.hwp'),original);fs.writeFileSync(path.join(out,name+'-after.hwp'),edited);
 const restored=good({action:'restore',source,expected_sha256:after.source_sha256,backup_id:saved.backup_id});assert.equal(restored.saved_path,source);assert.deepEqual(fs.readFileSync(source),Buffer.from(original));
 const history=good({action:'history',source,expected_sha256:hash(original),limit:50});assert.ok(history.entries.some(e=>e.sha256===hash(edited)&&e.backup_verified));
 fs.copyFileSync(source,path.join(out,name+'-restored.hwp'));cases.push({name,before,after,operations,verification:saved,exact_restore:true,edited_version_retained:true});
}
try{
 for(const published of [false,true]){
  const name='crash-'+(published?'after':'before')+'-publication',original=fixture(),source=select(name,original),before=read(source),operations=[bodyOp(before,'종료 후 확인한 편집')],crash=path.join(scripts,'crash-'+published+'.mjs');
  // Only this disposable copy is instrumented; subsequent calls use the exact
  // shipped bytes. The worker is terminated at the selected HWP rename.
  const prelude=`import crashFs from 'node:fs';const crashRename=crashFs.renameSync;crashFs.renameSync=(a,b)=>{if(b!==${JSON.stringify(source)})return crashRename(a,b);${published?'crashRename(a,b);':''}process.exit(91);};\n`;
  fs.writeFileSync(crash,prelude+fs.readFileSync(runner,'utf8'));const failed=invoke({action:'edit',source,expected_sha256:before.source_sha256,operations},crash);assert.equal(failed.ok,false);assert.equal(failed.save_confirmed,false);
  let saved;if(published){const current=read(source),history=good({action:'history',source,expected_sha256:current.source_sha256}),entry=history.entries.find(e=>e.sha256===hash(original)&&e.backup_verified);assert.ok(entry);saved={saved:true,saved_path:source,output_sha256:current.source_sha256,backup_id:entry.backup_id};}
  else{assert.deepEqual(fs.readFileSync(source),Buffer.from(original));saved=good({action:'edit',source,expected_sha256:before.source_sha256,operations});assert.equal(saved.abandoned_lock_recovered,true);}
  keep(name,source,before,operations,saved,original);
 }
 {
  const name='picture-risk-identity',source=select(name,nestedFixture()),imagePath=path.join(temp,'signature.jpg');fs.writeFileSync(imagePath,progressiveJpeg);const image={source:imagePath,expected_sha256:hash(progressiveJpeg)};
  for(const width of [30000,1800]){const s=read(source),b=s.blocks.find(b=>b.cell_path.length===1&&b.text==='문항');good({action:'edit',source,expected_sha256:s.source_sha256,operations:[{type:'insert_picture',target_id:b.target_id,expected_old:b.text,offset:[...b.text].length,image,width,height:1800}]});}
  const before=read(source),original=fs.readFileSync(source),b=before.blocks.find(b=>b.cell_path.length===1&&b.text==='문항'),pictures=before.pictures.filter(p=>p.block_id===b.id),n=count(source),operations=pictures.map(p=>({type:'update_picture',target_id:b.target_id,expected_old:b.text,picture_index:p.picture_index,expected_properties:p.properties,props:{width:p.properties.width===30000?1800:30000}}));
  for(const action of ['plan','edit']){const r=invoke({action,source,expected_sha256:before.source_sha256,operations,layout_policy:'reject_new_overflow'});assert.equal(r.error,'NEW_LAYOUT_OVERFLOW');assert.deepEqual(fs.readFileSync(source),original);assert.equal(count(source),n);}
  const valid=[operations.find(o=>o.props.width===1800)],saved=good({action:'edit',source,expected_sha256:before.source_sha256,operations:valid,layout_policy:'reject_new_overflow'});assert.deepEqual(saved.layout_diagnostics.issues,[]);keep(name,source,before,valid,saved,original);
 }
 {
  const name='fixed-text-box-risk',original=placementFixture({box:true,fixed:true}),source=select(name,original),before=read(source),box=before.text_boxes[0],p=box.paragraphs[0],op={type:'splice_text_box',target_id:p.target_id,expected_old:p.text,expected_properties:box.properties,start:0,end:[...p.text].length,new_text:Array.from({length:20},(_,i)=>`글상자 ${i+1} 줄의 합성 답변`).join('\n')};
  for(const action of ['plan','edit']){const r=invoke({action,source,expected_sha256:before.source_sha256,operations:[op],layout_policy:'reject_new_risk'});assert.equal(r.error,'NEW_LAYOUT_RISK');assert.deepEqual(fs.readFileSync(source),Buffer.from(original));assert.equal(count(source),0);}
  const plan=good({action:'plan',source,expected_sha256:before.source_sha256,operations:[op]});assert.ok(plan.layout_diagnostics.new_issues.some(i=>i.code==='FIXED_TEXT_BOX_MAY_EXCEED_PAGE_HEIGHT'));assert.equal(count(source),0);
  const valid=[{...op,new_text:'짧은 안내 😀'}],saved=good({action:'edit',source,expected_sha256:before.source_sha256,operations:valid,layout_policy:'reject_new_risk'});assert.deepEqual(saved.layout_diagnostics.new_issues,[]);keep(name,source,before,valid,saved,original);
 }
 assert.equal(hash(fs.readFileSync(runner)),manifest.runner_sha256);fs.writeFileSync(path.join(out,'cases.json'),JSON.stringify(cases,null,2)+'\n');
 const report={status:'PASS',version:manifest.version,cases:cases.length,shipped_runner_sha256:manifest.runner_sha256,crash_before_and_after_publication:true,strict_picture_risk_refused:true,strict_fixed_box_risk_refused:true,refusals_leave_source_and_backups_unchanged:true,same_file_save:true,exact_restore:true,edited_versions_retained:true,layout_verified:false};fs.writeFileSync(path.join(out,'summary.json'),JSON.stringify(report,null,2)+'\n');console.log(JSON.stringify(report));
}finally{assert.equal(path.dirname(temp),os.tmpdir());assert.ok(path.basename(temp).startsWith('hwp-reviewed-package-'));fs.rmSync(temp,{recursive:true,force:true});}
