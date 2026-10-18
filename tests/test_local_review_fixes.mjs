import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import {spawn,spawnSync} from 'node:child_process';
import {initializeLocal,runLocal} from '../src/one_hwp/local_runner.mjs';
import {readLocal,saveLocal,digest} from '../src/one_hwp/local_file.mjs';
import {fixture} from './rhwp_fixtures.mjs';
import {nestedFixture} from './local_complex_fixtures.mjs';
import {placementFixture} from './local_placement_fixtures.mjs';
import {progressiveJpeg} from './local_image_fixtures.mjs';
initializeLocal(fs.readFileSync(new URL('../node_modules/@rhwp/core/rhwp_bg.wasm',import.meta.url)));
const storage=new URL('../src/one_hwp/local_file.mjs',import.meta.url).href,locking=new URL('../src/one_hwp/local_lock.mjs',import.meta.url).href;
function workspace(t,bytes=fixture()){
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'hwp-reviewed-fix-')),source=path.join(dir,'선택 문서.hwp');fs.writeFileSync(source,bytes);
  t.after(()=>{assert.equal(path.dirname(dir),os.tmpdir());assert.ok(path.basename(dir).startsWith('hwp-reviewed-fix-'));fs.rmSync(dir,{recursive:true,force:true});});return {dir,source,bytes:Buffer.from(bytes)};
}
const read=source=>runLocal({action:'read',source,max_chars:64000,max_blocks:128});
const history=s=>runLocal({action:'history',source:s.source,expected_sha256:digest(fs.readFileSync(s.source))});
const lockPath=w=>path.join(w.dir,'.hwp-easy-backups',digest(Buffer.from(process.platform==='win32'?w.source.toLowerCase():w.source))+'.lock');
function crash(w,after=false){
  const desired=path.join(w.dir,'desired.hwp');fs.writeFileSync(desired,fixture({table:false,paragraphs:['first','interrupted','last']}));
  const code=`import fs from 'node:fs';import {saveLocal,readLocal} from ${JSON.stringify(storage)};const [source,desired]=process.argv.slice(1),rename=fs.renameSync;fs.renameSync=(a,b)=>{if(b!==source)return rename(a,b);${after?'rename(a,b);':''}process.exit(91);};saveLocal(readLocal(source),fs.readFileSync(desired));`;
  const r=spawnSync(process.execPath,['--input-type=module','-e',code,w.source,desired],{windowsHide:true,encoding:'utf8',timeout:10000});assert.equal(r.status,91,r.stderr);assert.equal(fs.statSync(lockPath(w)+'.owner').isDirectory(),true);
}
for(const after of [false,true])test(`terminated save recovers its lock and retains exact versions, published=${after}`,async t=>{
  const w=workspace(t);crash(w,after);if(!after)assert.deepEqual(fs.readFileSync(w.source),w.bytes);
  const h=await history(w),backup=h.entries.find(e=>e.sha256===digest(w.bytes));assert.ok(backup?.backup_verified);
  if(after){const edited=fs.readFileSync(w.source),restored=await runLocal({action:'restore',source:w.source,expected_sha256:digest(edited),backup_id:backup.backup_id});assert.equal(restored.abandoned_lock_recovered,true);assert.deepEqual(fs.readFileSync(w.source),w.bytes);assert.ok((await history(w)).entries.some(e=>e.sha256===digest(edited)));}
  else{const s=await read(w.source),b=s.blocks.find(b=>b.text==='중간 합성 문단'),saved=await runLocal({action:'edit',source:w.source,expected_sha256:s.source_sha256,operations:[{type:'replace_text',target_id:b.target_id,expected_old:b.text,new_text:'종료 후 다시 저장'}]});assert.equal(saved.abandoned_lock_recovered,true);await runLocal({action:'restore',source:w.source,expected_sha256:saved.output_sha256,backup_id:saved.backup_id});assert.deepEqual(fs.readFileSync(w.source),w.bytes);}
  assert.equal(fs.existsSync(lockPath(w)),false);
});
test('a live child owns its lock even if metadata has an old time',async t=>{
  const w=workspace(t),folder=lockPath(w);fs.mkdirSync(path.dirname(folder));
  const code=`import {acquireLocalLock} from ${JSON.stringify(locking)};const lock=acquireLocalLock(process.argv[1]);process.stdout.write('ready\\n');setInterval(()=>{},1000);`;
  const child=spawn(process.execPath,['--input-type=module','-e',code,folder],{windowsHide:true,stdio:['ignore','pipe','pipe']});
  try{
    await new Promise((resolve,reject)=>{child.stdout.once('data',resolve);child.once('error',reject);child.once('exit',()=>reject(Error('owner exited before ready')));});
    const owner=path.join(folder+'.owner',fs.readdirSync(folder+'.owner')[0]);fs.writeFileSync(owner,'old metadata does not revoke a live owner');
    assert.throws(()=>saveLocal(readLocal(w.source),fixture({table:false})),/DOCUMENT_BUSY/);assert.deepEqual(fs.readFileSync(w.source),w.bytes);assert.equal(fs.existsSync(owner),true);
  }finally{if(child.exitCode===null&&child.signalCode===null){const exited=new Promise(r=>child.once('exit',r));child.kill();await exited;}}
  const saved=saveLocal(readLocal(w.source),fixture({table:false}));assert.equal(saved.abandoned_lock_recovered,true);
});
test('unknown legacy and foreign locks are retained rather than guessed stale',t=>{
  const w=workspace(t),folder=lockPath(w);fs.mkdirSync(path.dirname(folder));fs.writeFileSync(folder,'HWP Easy local save\n');
  assert.throws(()=>saveLocal(readLocal(w.source),fixture({table:false})),/DOCUMENT_BUSY/);assert.equal(fs.readFileSync(folder,'utf8'),'HWP Easy local save\n');fs.unlinkSync(folder);
  fs.mkdirSync(folder+'.owner');const owner=path.join(folder+'.owner','000000000000000000000000-2147483647-00000000-0000-4000-8000-000000000000.owner');fs.writeFileSync(owner,'foreign');
  assert.throws(()=>saveLocal(readLocal(w.source),fixture({table:false})),/DOCUMENT_BUSY/);assert.equal(fs.readFileSync(owner,'utf8'),'foreign');assert.deepEqual(fs.readFileSync(w.source),w.bytes);
});
test('a crash between complete guard publication and alias cleanup is recoverable',t=>{
  const w=workspace(t),desired=path.join(w.dir,'desired.hwp');fs.writeFileSync(desired,fixture({table:false}));
  const code=`import fs from 'node:fs';import {saveLocal,readLocal} from ${JSON.stringify(storage)};const unlink=fs.unlinkSync;fs.unlinkSync=p=>{if(p.includes('.guard-'))process.exit(93);return unlink(p);};saveLocal(readLocal(process.argv[1]),fs.readFileSync(process.argv[2]));`;
  const r=spawnSync(process.execPath,['--input-type=module','-e',code,w.source,desired],{windowsHide:true,timeout:10000});assert.equal(r.status,93);assert.equal(fs.statSync(lockPath(w)).nlink,2);
  const saved=saveLocal(readLocal(w.source),fs.readFileSync(desired));assert.equal(saved.abandoned_lock_recovered,true);assert.deepEqual(fs.readFileSync(w.source),fs.readFileSync(desired));assert.equal(fs.existsSync(lockPath(w)),false);
});
test('an unexpected file at the owner-directory path is not replaced',t=>{
  const w=workspace(t),owner=lockPath(w)+'.owner';fs.mkdirSync(path.dirname(owner));fs.writeFileSync(owner,'keep this unknown file');
  assert.throws(()=>saveLocal(readLocal(w.source),fixture({table:false})),/DOCUMENT_BUSY/);assert.equal(fs.readFileSync(owner,'utf8'),'keep this unknown file');assert.deepEqual(fs.readFileSync(w.source),w.bytes);
});
test('competing dead-owner reapers never publish concurrently',async t=>{
  const w=workspace(t);crash(w);const expected=digest(w.bytes),marker=path.join(w.dir,'publishing');
  const code=`import fs from 'node:fs';import {saveLocal,readLocal} from ${JSON.stringify(storage)};const [source,expected,marker]=process.argv.slice(1),rename=fs.renameSync;fs.renameSync=(a,b)=>{if(b!==source)return rename(a,b);const fd=fs.openSync(marker,'wx');Atomics.wait(new Int32Array(new SharedArrayBuffer(4)),0,0,80);try{return rename(a,b);}finally{fs.closeSync(fd);fs.unlinkSync(marker);}};try{const s=readLocal(source,expected);saveLocal(s,fs.readFileSync(process.argv[4]));process.stdout.write('saved');}catch(e){if(!['DOCUMENT_BUSY','VERSION_CONFLICT'].includes(e.code))throw e;process.stdout.write(e.code);}`;
  const desired=path.join(w.dir,'desired.hwp');
  const results=await Promise.all(Array.from({length:5},()=>new Promise((resolve,reject)=>{const c=spawn(process.execPath,['--input-type=module','-e',code,w.source,expected,marker,desired],{windowsHide:true});let out='',err='';c.stdout.on('data',b=>out+=b);c.stderr.on('data',b=>err+=b);c.on('error',reject);c.on('exit',status=>status===0?resolve(out):reject(Error(err)));})));
  assert.equal(results.filter(r=>r==='saved').length,1);assert.deepEqual(fs.readFileSync(w.source),fs.readFileSync(desired));assert.equal(fs.existsSync(lockPath(w)),false);
});
async function pictures(t,{smallFirst=false,onlyLarge=false}={}){
  const w=workspace(t,nestedFixture()),imagePath=path.join(w.dir,'image.jpg');fs.writeFileSync(imagePath,progressiveJpeg);const image={source:imagePath,expected_sha256:digest(progressiveJpeg)};
  for(const width of onlyLarge?[30000]:smallFirst?[1800,30000]:[30000,1800]){const s=await read(w.source),b=s.blocks.find(b=>b.cell_path.length===1&&b.text==='문항');await runLocal({action:'edit',source:w.source,expected_sha256:s.source_sha256,operations:[{type:'insert_picture',target_id:b.target_id,expected_old:b.text,offset:[...b.text].length,image,width,height:1800}]});}
  const s=await read(w.source),b=s.blocks.find(b=>b.cell_path.length===1&&b.text==='문항'),p=s.pictures.filter(p=>p.block_id===b.id);return {...w,s,b,image,p,before:fs.readFileSync(w.source)};
}
test('strict policy rejects moving equal overflow to a different picture in one paragraph',async t=>{
  const w=await pictures(t),large=w.p.find(p=>p.properties.width===30000),small=w.p.find(p=>p.properties.width===1800),operations=[large,small].map((p,i)=>({type:'update_picture',target_id:w.b.target_id,expected_old:w.b.text,picture_index:p.picture_index,expected_properties:p.properties,props:{width:i?30000:1800}})),count=(await history(w)).entries.length;
  for(const action of ['plan','edit'])await assert.rejects(runLocal({action,source:w.source,expected_sha256:w.s.source_sha256,operations,layout_policy:'reject_new_overflow'}),/NEW_LAYOUT_OVERFLOW/);
  assert.deepEqual(fs.readFileSync(w.source),w.before);assert.equal((await history(w)).entries.length,count);
});
for(const kind of ['insert','delete'])test(`existing picture risk survives ${kind} changing its picture index`,async t=>{
  const w=await pictures(t,{smallFirst:true}),small=w.p.find(p=>p.properties.width===1800),op=kind==='insert'?{type:'insert_picture',target_id:w.b.target_id,expected_old:w.b.text,offset:0,image:w.image,width:900,height:900}:{type:'delete_picture',target_id:w.b.target_id,expected_old:w.b.text,picture_index:small.picture_index,expected_properties:small.properties};
  const saved=await runLocal({action:'edit',source:w.source,expected_sha256:w.s.source_sha256,operations:[op],layout_policy:'reject_new_overflow'});assert.equal(saved.saved,true);assert.deepEqual(saved.layout_diagnostics.new_issues,[]);
  await runLocal({action:'restore',source:w.source,expected_sha256:saved.output_sha256,backup_id:saved.backup_id});assert.deepEqual(fs.readFileSync(w.source),w.before);
});
test('deleting and recreating a picture cannot reuse an old risk identity',async t=>{
  const w=await pictures(t,{onlyLarge:true}),p=w.p[0],operations=[{type:'delete_picture',target_id:w.b.target_id,expected_old:w.b.text,expected_properties:p.properties},{type:'insert_picture',target_id:w.b.target_id,expected_old:w.b.text,offset:0,image:w.image,width:30000,height:1800}];
  const plan=await runLocal({action:'plan',source:w.source,expected_sha256:w.s.source_sha256,operations});assert.equal(plan.layout_diagnostics.new_issues.filter(i=>i.code==='PICTURE_EXCEEDS_CELL_WIDTH').length,1);
  await assert.rejects(runLocal({action:'edit',source:w.source,expected_sha256:w.s.source_sha256,operations,layout_policy:'reject_new_overflow'}),/NEW_LAYOUT_OVERFLOW/);assert.deepEqual(fs.readFileSync(w.source),w.before);
});
const boxOp=(box,text)=>({type:'splice_text_box',target_id:box.paragraphs[0].target_id,expected_old:box.paragraphs[0].text,expected_properties:box.properties,start:0,end:[...box.paragraphs[0].text].length,new_text:text});
const longText=Array.from({length:20},(_,i)=>`글상자 ${i+1} 줄의 합성 답변 😀`).join('\n');
test('strict box risk rejects an atomic batch before source or backup changes',async t=>{
  const w=workspace(t,placementFixture({box:true,fixed:true})),s=await read(w.source),b=s.blocks[1],operations=[{type:'replace_text',target_id:b.target_id,expected_old:b.text,new_text:'must not save'},boxOp(s.text_boxes[0],longText)];
  for(const action of ['plan','edit'])await assert.rejects(runLocal({action,source:w.source,expected_sha256:s.source_sha256,operations,layout_policy:'reject_new_risk'}),/NEW_LAYOUT_RISK/);
  assert.deepEqual(fs.readFileSync(w.source),w.bytes);assert.equal((await history(w)).entries.length,0);
});
test('reported fixed-box risk preserves text and geometry, with exact same-file restore',async t=>{
  const w=workspace(t,placementFixture({box:true,fixed:true})),s=await read(w.source),box=s.text_boxes[0],saved=await runLocal({action:'edit',source:w.source,expected_sha256:s.source_sha256,operations:[boxOp(box,longText)]});
  assert.equal(saved.saved_path,w.source);assert.ok(saved.layout_diagnostics.new_issues.some(i=>i.code==='FIXED_TEXT_BOX_MAY_EXCEED_PAGE_HEIGHT'&&i.certainty==='font_estimate'));
  const after=await read(w.source);assert.equal(after.text_boxes[0].paragraphs[0].text,longText);assert.deepEqual(after.text_boxes[0].properties,box.properties);assert.deepEqual(after.text_boxes[0].flow,box.flow);
  const noop=await runLocal({action:'edit',source:w.source,expected_sha256:after.source_sha256,operations:[boxOp(after.text_boxes[0],longText)],layout_policy:'reject_new_risk'});assert.equal(noop.saved,false);
  await runLocal({action:'restore',source:w.source,expected_sha256:saved.output_sha256,backup_id:saved.backup_id});assert.deepEqual(fs.readFileSync(w.source),w.bytes);assert.ok((await history(w)).entries.some(e=>e.sha256===saved.output_sha256));
});
for(const fixed of [false,true])test(`safe text-box edits are not refused, bottom-fixed=${fixed}`,async t=>{
  const w=workspace(t,placementFixture({box:true,fixed})),s=await read(w.source),saved=await runLocal({action:'edit',source:w.source,expected_sha256:s.source_sha256,operations:[boxOp(s.text_boxes[0],fixed?'짧은 안내 😀':longText)],layout_policy:'reject_new_risk'});
  assert.equal(saved.saved,true);assert.deepEqual(saved.layout_diagnostics.new_issues,[]);await runLocal({action:'restore',source:w.source,expected_sha256:saved.output_sha256,backup_id:saved.backup_id});assert.deepEqual(fs.readFileSync(w.source),w.bytes);
});
