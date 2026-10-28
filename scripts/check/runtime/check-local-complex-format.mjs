/** Isolated formatting checks; optional testdocs stay private and read-only. */
import fs from 'node:fs';import path from 'node:path';import os from 'node:os';import assert from 'node:assert/strict';import {spawnSync} from 'node:child_process';import {fileURLToPath} from 'node:url';
import {HwpDocument,initSync} from '@rhwp/core';
import {fieldFixture,nestedFixture,groupFixture,checkedExport} from '../../../tests/local_complex_fixtures.mjs';
import {digest} from '../../../src/one_hwp/local_file.mjs';
initSync({module:fs.readFileSync(new URL('../../../node_modules/@rhwp/core/rhwp_bg.wasm',import.meta.url))});
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'../../..'),report=path.resolve(process.argv[2]??path.join(root,'outputs','local-complex-format-check'));
const real=process.argv[3]==='--testdocs',originals=real?fs.readdirSync(path.join(root,'testdocs')).filter(n=>n.endsWith('.hwp')).map(n=>({file:path.join(root,'testdocs',n),bytes:fs.readFileSync(path.join(root,'testdocs',n))})):[];
const temporary=fs.mkdtempSync(path.join(os.tmpdir(),'hwp-format-package-')),runner=path.join(temporary,'plugin','skills/edit-local-hwp','scripts','local-runner.mjs'),source=path.join(temporary,'selected.hwp'),request=path.join(temporary,'request.json'),cases=[];
fs.mkdirSync(report,{recursive:true});fs.cpSync(path.join(root,'outputs/plugin-package','hwp-easy'),path.join(temporary,'plugin'),{recursive:true});
function call(input){fs.writeFileSync(request,JSON.stringify(input));const result=spawnSync(process.execPath,[runner,'--request',request],{cwd:temporary,env:{...process.env,NODE_PATH:''},encoding:'utf8',timeout:65000,windowsHide:true});assert.equal(result.status,0,'Packaged formatting failed');assert.equal(result.stderr,'');const answer=JSON.parse(result.stdout);assert.equal(answer.ok,true);return answer.result;}
function read(){let cursor,first,blocks=[];do{const page=call({action:'read',source,max_chars:64000,max_blocks:128,...(cursor?{cursor}:{})});first??=page;blocks.push(...page.blocks);cursor=page.next_cursor;}while(cursor);assert.ok(blocks.every(b=>b.start_offset===0&&b.fragment_complete));return {...first,blocks};}
function trial(bytes,choose,props,{start=0,end}={}){
 fs.writeFileSync(source,bytes);const before=read(),target=choose(before);assert.ok(target);const field=Object.hasOwn(target,'field_id'),block=before.blocks.find(b=>b.id===(target.block_id??target.id)),text=field?target.value:block.text;end??=[...text].length;
 const op={type:'format_text',target_id:target.target_id,expected_old:text,start,end,props},name=`case-${String(cases.length+1).padStart(3,'0')}`;
 fs.writeFileSync(path.join(report,`${name}-before.hwp`),bytes);const plan=call({action:'plan',source,expected_sha256:before.source_sha256,operations:[op]});assert.equal(plan.saved,false);assert.deepEqual(fs.readFileSync(source),Buffer.from(bytes));
 const result=call({action:'edit',source,expected_sha256:before.source_sha256,operations:[op]});assert.equal(result.saved,true);assert.equal(result.formatting_changed,true);const after=read(),saved=fs.readFileSync(source);assert.equal(after.blocks.find(b=>b.id===block.id).text,block.text);
 fs.writeFileSync(path.join(report,`${name}-after.hwp`),saved);const noop=call({action:'edit',source,expected_sha256:after.source_sha256,operations:[{...op,target_id:(field?after.fields:after.blocks).find(t=>t.id===target.id).target_id}]});assert.equal(noop.saved,false);assert.equal(noop.unchanged,true);assert.deepEqual(fs.readFileSync(source),saved);
 call({action:'restore',source,expected_sha256:after.source_sha256,backup_id:result.backup_id});assert.deepEqual(fs.readFileSync(source),Buffer.from(bytes));
 cases.push({name,target_raw_index:before.blocks.findIndex(b=>b.id===block.id),section:block.section,start:start+(field?target.start:0),end:end+(field?target.start:0),props,field_target:field});
}
function multiline(bytes){const d=new HwpDocument(bytes);try{const f=JSON.parse(d.getFieldList())[0];d.setFieldValue(f.fieldId,'합성 지원 동기 😀\n\n경험과 계획');return checkedExport(d);}finally{d.free();}}
try{
 const props={italic:true,underline:true,strikethrough:true,fontSize:1250,textColor:'#123456',fontFamily:'Synthetic Font'};
 if(!real){
  for(const cell of [false,true])for(const mixed of [false,true]){const bytes=fieldFixture({cell,mixed,multiple:true});trial(bytes,s=>s.fields[0],props);trial(multiline(bytes),s=>s.fields[0],{bold:true,fontSize:1400},{start:2,end:13});}
  for(const depth of [2,3])trial(depth===2?nestedFixture():nestedFixture(nestedFixture(),{inside_nested:true}),s=>s.blocks.find(b=>b.cell_path.length===depth&&b.text==='inner answer 😀'),props,{start:6,end:14});
  trial(groupFixture(),s=>s.blocks.find(b=>b.text==='group host'),{bold:true,fontSize:1500,textColor:'#abcdef'},{start:0,end:5});
 }else for(const input of originals){
  const d=new HwpDocument(input.bytes);let fieldBytes,hasTable;try{hasTable=JSON.parse(d.getCursorModel()).lists.some(l=>l.isCell);const f=JSON.parse(d.insertClickHereField(0,1,0,'Synthetic','Synthetic','Synthetic',true));d.setFieldValue(f.fieldId,'synthetic value 😀');d.applyCharFormat(0,1,1,4,JSON.stringify({bold:true}));fieldBytes=checkedExport(d);}finally{d.free();}
  trial(fieldBytes,s=>s.fields[0],props);trial(multiline(fieldBytes),s=>s.fields[0],{bold:true,fontSize:1400,textColor:'#778899'},{start:2,end:13});
  trial(fieldBytes,s=>s.blocks.find(b=>b.kind==='paragraph'&&b.text.length>=4&&b.text_range_editable),{italic:true,fontSize:1500},{start:0,end:3});
  if(hasTable)for(const depth of [2,3]){const nested=nestedFixture(input.bytes),bytes=depth===2?nested:nestedFixture(nested,{inside_nested:true});trial(bytes,s=>s.blocks.find(b=>b.cell_path.length===depth&&b.text==='inner answer 😀'),props,{start:6,end:14});}
  trial(groupFixture({source:input.bytes,paragraph:1}),s=>s.blocks.find(b=>b.kind==='paragraph'&&b.text.length>=4&&b.text_range_editable),{bold:true,fontSize:1600,textColor:'#445566'},{start:0,end:3});
 }
 assert.ok(originals.every(o=>digest(fs.readFileSync(o.file))===digest(o.bytes)));
 fs.writeFileSync(path.join(report,'cases.json'),JSON.stringify(cases,null,2)+'\n');const summary={status:'PASS',cases:cases.length,real_document_copies:real,synthetic_complex_objects_added:real,originals_unchanged:true,same_file_save:true,plan_read_only:true,exact_restore:true,repeat_noop:true,isolated_package:true,native_ui_used:false};fs.writeFileSync(path.join(report,'summary.json'),JSON.stringify(summary,null,2)+'\n');console.log(JSON.stringify(summary));
}finally{assert.equal(path.dirname(temporary),os.tmpdir());assert.ok(path.basename(temporary).startsWith('hwp-format-package-'));fs.rmSync(temporary,{recursive:true,force:true});}
