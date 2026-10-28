/** Isolated runtime exercise; real inputs are opt-in, read-only and anonymized. */
import fs from 'node:fs';import path from 'node:path';import os from 'node:os';import assert from 'node:assert/strict';import {spawnSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {HwpDocument,initSync} from '@rhwp/core';
import {fieldFixture,nestedFixture,groupFixture,checkedExport} from '../../../tests/local_complex_fixtures.mjs';
import {fixture} from '../../../tests/rhwp_fixtures.mjs';
import {digest} from '../../../src/one_hwp/local_file.mjs';
initSync({module:fs.readFileSync(new URL('../../../node_modules/@rhwp/core/rhwp_bg.wasm',import.meta.url))});
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'../../..');
const report=path.resolve(process.argv[2]??path.join(root,'outputs','local-complex-check'));
const real=process.argv[3]=== '--testdocs',originals=real?fs.readdirSync(path.join(root,'testdocs')).filter(n=>n.endsWith('.hwp')).map(n=>({file:path.join(root,'testdocs',n),bytes:fs.readFileSync(path.join(root,'testdocs',n))})):[];
const temporary=fs.mkdtempSync(path.join(os.tmpdir(),'hwp-complex-package-')),runner=path.join(temporary,'plugin','skills','edit-local-hwp','scripts','local-runner.mjs');
fs.mkdirSync(report,{recursive:true});fs.cpSync(path.join(root,'outputs','plugin-package','hwp-easy'),path.join(temporary,'plugin'),{recursive:true});
const source=path.join(temporary,'selected.hwp'),request=path.join(temporary,'request.json'),cases=[];
function call(input){fs.writeFileSync(request,JSON.stringify(input));const result=spawnSync(process.execPath,[runner,'--request',request],{encoding:'utf8',timeout:65000,windowsHide:true});assert.equal(result.status,0,'Packaged operation failed');const answer=JSON.parse(result.stdout);assert.equal(answer.ok,true);return answer.result;}
function read(){let cursor,first,blocks=[];do{const page=call({action:'read',source,max_chars:64000,max_blocks:128,...(cursor?{cursor}:{})});first??=page;blocks.push(...page.blocks);cursor=page.next_cursor;}while(cursor);assert.ok(blocks.every(b=>b.start_offset===0&&b.fragment_complete));return {...first,blocks};}
function trial(bytes,choose,operation){fs.writeFileSync(source,bytes);const before=read(),target=choose(before),op=operation(before,target),name=`case-${String(cases.length+1).padStart(3,'0')}`;assert.ok(target);fs.writeFileSync(path.join(report,`${name}-before.hwp`),bytes);
 const plan=call({action:'plan',source,expected_sha256:before.source_sha256,operations:[op]});assert.equal(plan.saved,false);assert.deepEqual(fs.readFileSync(source),Buffer.from(bytes));
 const result=call({action:'edit',source,expected_sha256:before.source_sha256,operations:[op]});assert.equal(result.selected_file_updated,true);assert.equal(result.raw_preservation_verified,true);const after=read(),saved=fs.readFileSync(source);fs.writeFileSync(path.join(report,`${name}-after.hwp`),saved);
 const blockId=target.block_id??target.id,block=before.blocks.find(b=>b.id===blockId),index=before.blocks.findIndex(b=>b.id===blockId);
 const meta={name,type:op.type,target_raw_index:index,expected_old:op.expected_old,...Object.fromEntries(['start','end','new_text','picture_index','props'].filter(k=>Object.hasOwn(op,k)).map(k=>[k,op[k]]))};
 if(target.field_id){meta.start=target.start;meta.end=target.end;assert.equal(after.fields.find(f=>f.id===target.id).value,op.new_text);}
 else if(op.type==='splice_text'){assert.equal(after.blocks[index].text,[...block.text].slice(0,op.start).join('')+op.new_text+[...block.text].slice(op.end).join(''));const query=op.new_text.split('\n').find(Boolean);if(query){const found=call({action:'find',source,expected_sha256:after.source_sha256,query});assert.ok(found.matches.some(m=>m.target_id===after.blocks[index].target_id));}}
 const restored=call({action:'restore',source,expected_sha256:after.source_sha256,backup_id:result.backup_id});assert.deepEqual(fs.readFileSync(source),Buffer.from(bytes));assert.equal(restored.restored,true);cases.push(meta);
}
try{
 if(!real){
  for(const cell of [false,true])for(const mixed of [false,true])for(const new_text of ['changed 🚀','','first line\n\nsecond 😀\n'])trial(fieldFixture({cell,mixed,multiple:true}),s=>s.fields[0],(s,f)=>({type:'set_field',target_id:f.target_id,expected_old:f.value,new_text}));
  const nested=nestedFixture();trial(nested,s=>s.blocks.find(b=>b.kind==='nested_cell'&&b.text==='inner answer 😀'),(s,b)=>({type:'splice_text',target_id:b.target_id,expected_old:b.text,start:6,end:12,new_text:'변경 🚀'}));
  trial(nested,s=>s.blocks.find(b=>b.kind==='nested_cell'&&b.text==='inner answer 😀'),(s,b)=>({type:'splice_text',target_id:b.target_id,expected_old:b.text,start:6,end:12,new_text:'변경\n다음 😀\n'}));
  for(const type of ['move_picture_group','crop_group_picture'])trial(groupFixture(),s=>s.picture_groups[0],(s,g)=>type==='move_picture_group'?{type,target_id:g.target_id,expected_old:s.blocks.find(b=>b.id===g.block_id).text,expected_properties:g.properties,props:{horzOffset:500,vertOffset:200}}:{type,target_id:g.target_id,expected_old:s.blocks.find(b=>b.id===g.block_id).text,picture_index:1,expected_properties:Object.fromEntries(Object.entries(g.pictures[1]).filter(([k])=>k!=='picture_index')),props:{cropLeft:75,cropBottom:150}});
 }else for(const [document,input] of originals.entries()){
  // Synthetic fields/pictures supplement these real forms, whose original
  // corpus contains no complex objects. The originals are never written.
  const doc=new HwpDocument(input.bytes);let fieldBytes,groupBytes,hasTable;
  try{const info=JSON.parse(doc.getCursorModel());hasTable=info.lists.some(l=>l.isCell);const p=1;assert.ok(doc.getParagraphCount(0)>p);const f=JSON.parse(doc.insertClickHereField(0,p,0,'Synthetic guide','Synthetic memo','synthetic field',true));doc.setFieldValue(f.fieldId,'synthetic value');fieldBytes=checkedExport(doc);}finally{doc.free();}
  for(const new_text of ['변경 🚀','','합성 지원 동기\n\n합성 경험 😀\n'])trial(fieldBytes,s=>s.fields[0],(s,f)=>({type:'set_field',target_id:f.target_id,expected_old:f.value,new_text}));
  if(hasTable)trial(nestedFixture(input.bytes),s=>s.blocks.find(b=>b.kind==='nested_cell'&&b.text==='inner answer 😀'),(s,b)=>({type:'splice_text',target_id:b.target_id,expected_old:b.text,start:6,end:12,new_text:'변경 🚀'}));
  if(hasTable)trial(nestedFixture(input.bytes),s=>s.blocks.find(b=>b.kind==='nested_cell'&&b.text==='inner answer 😀'),(s,b)=>({type:'splice_text',target_id:b.target_id,expected_old:b.text,start:6,end:12,new_text:'변경\n합성 계획 😀'}));
  groupBytes=groupFixture({source:input.bytes,paragraph:1});
  for(const type of ['move_picture_group','crop_group_picture'])trial(groupBytes,s=>s.picture_groups[0],(s,g)=>type==='move_picture_group'?{type,target_id:g.target_id,expected_old:s.blocks.find(b=>b.id===g.block_id).text,expected_properties:g.properties,props:{horzOffset:500,vertOffset:200}}:{type,target_id:g.target_id,expected_old:s.blocks.find(b=>b.id===g.block_id).text,picture_index:1,expected_properties:Object.fromEntries(Object.entries(g.pictures[1]).filter(([k])=>k!=='picture_index')),props:{cropLeft:75,cropBottom:150}});
 }
 assert.ok(originals.every(o=>digest(fs.readFileSync(o.file))===digest(o.bytes)));
 fs.writeFileSync(path.join(report,'cases.json'),JSON.stringify(cases,null,2)+'\n');const summary={status:'PASS',cases:cases.length,real_document_copies:real,synthetic_complex_objects_added:real,originals_unchanged:true,same_file_save:true,plan_read_only:true,exact_restore:true,isolated_package:true};fs.writeFileSync(path.join(report,'summary.json'),JSON.stringify(summary,null,2)+'\n');console.log(JSON.stringify(summary));
}finally{assert.equal(path.dirname(temporary),os.tmpdir());assert.ok(path.basename(temporary).startsWith('hwp-complex-package-'));fs.rmSync(temporary,{recursive:true,force:true});}
