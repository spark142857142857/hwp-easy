/** Isolated packaged range/boundary edits with independent-reader artifacts. */
import fs from 'node:fs';import path from 'node:path';import os from 'node:os';
import assert from 'node:assert/strict';import {spawnSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {fixture} from '../tests/rhwp_fixtures.mjs';
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const out=process.argv[2]?path.resolve(process.argv[2]):path.join(root,'outputs/local-text-20261011');fs.mkdirSync(out,{recursive:true});
const temporary=fs.mkdtempSync(path.join(os.tmpdir(),'hwp-easy-text-package-'));
const cases=[];
try{
 const packageDir=path.join(temporary,'isolated package');fs.cpSync(path.join(root,'outputs/local-plugin-20261011/hwp-easy-local'),packageDir,{recursive:true});
 const runner=path.join(packageDir,'skills/edit-local-hwp/scripts/local-runner.mjs'),source=path.join(temporary,'selected.hwp');
 const call=request=>{const file=path.join(temporary,'request.json');fs.writeFileSync(file,JSON.stringify(request));const response=spawnSync(process.execPath,[runner,'--request',file],{cwd:temporary,encoding:'utf8',windowsHide:true,timeout:65000,env:{...process.env,NODE_PATH:''}});assert.equal(response.status,0,response.stdout);assert.equal(response.stderr,'');const r=JSON.parse(response.stdout);assert.equal(r.ok,true);return r.result;};
 const read=()=>{let cursor,version,blocks=[];do{const r=call({action:'read',source,max_chars:64000,max_blocks:128,...(cursor?{cursor,expected_sha256:version}:{})});version=r.source_sha256;blocks.push(...r.blocks);cursor=r.next_cursor;}while(cursor);return {source_sha256:version,blocks};};
 const perform=(kind,type,extra,stage='range')=>{const before=fs.readFileSync(source),state=read(),block=state.blocks.find(b=>b.kind===kind&&b.text==='가😀나 ABC');assert.ok(block);const request={source,expected_sha256:state.source_sha256,operations:[{type,target_id:block.target_id,expected_old:block.text,...extra}]};
   assert.equal(call({action:'plan',...request}).saved,false);assert.deepEqual(fs.readFileSync(source),before);
   const saved=call({action:'edit',...request});assert.equal(saved.saved_path,source);assert.equal(saved.raw_preservation_verified,true);
   const name=`case-${String(cases.length+1).padStart(3,'0')}`;fs.writeFileSync(path.join(out,name+'-before.hwp'),before);fs.writeFileSync(path.join(out,name+'-after.hwp'),fs.readFileSync(source));
   cases.push({name,type,kind,target_raw_index:state.blocks.indexOf(block),...extra});
   if(type==='split_paragraph'){const splitState=read(),first=splitState.blocks.find(b=>b.id===block.id),at=splitState.blocks.indexOf(first),second=splitState.blocks[at+1];assert.ok(second);const merged=call({action:'edit',source,expected_sha256:splitState.source_sha256,operations:[{type:'merge_paragraph',target_id:second.target_id,expected_old:second.text,previous_target_id:first.target_id,expected_previous:first.text}]});assert.equal(merged.raw_preservation_verified,true);
     fs.writeFileSync(path.join(out,name+'-merge.hwp'),fs.readFileSync(source));cases.at(-1).merged_file=name+'-merge.hwp';
   }
   const final=read();call({action:'restore',source,expected_sha256:final.source_sha256,backup_id:saved.backup_id});assert.deepEqual(fs.readFileSync(source),before);
 };
 for(const kind of ['paragraph','cell']){
   fs.writeFileSync(source,fixture({paragraphs:['앞','가😀나 ABC','끝'],cells:[['질문','가😀나 ABC']]}));let state=read(),b=state.blocks.find(b=>b.kind===kind&&b.text==='가😀나 ABC');
   call({action:'edit',source,expected_sha256:state.source_sha256,operations:[{type:'format_text',target_id:b.target_id,expected_old:b.text,start:1,end:4,props:{bold:true,textColor:'#AABBCC',fontSize:1400}}]});
   for(const spec of [{start:0,end:0,new_text:'앞😀'},{start:2,end:2,new_text:'중간 삽입'},{start:1,end:5,new_text:'긴 replacement😀'},{start:7,end:7,new_text:'끝'},{start:1,end:4,new_text:''},{start:0,end:7,new_text:''},{start:0,end:7,new_text:'전체 😀'}])perform(kind,'splice_text',spec);
   for(const offset of [0,1,2,3,4,7])perform(kind,'split_paragraph',{offset});
   perform(kind,'duplicate_paragraph',{});
   for(const spec of [{start:0,end:0,new_text:'\n'},{start:2,end:2,new_text:'\n중간\n'},{start:1,end:5,new_text:'새 답변\n😀 두 번째\n셋째'},{start:7,end:7,new_text:'\n'},{start:0,end:7,new_text:'\n\n'},{start:0,end:7,new_text:'새 답변\n둘째 😀'}])perform(kind,'splice_text',spec);
 }
 fs.writeFileSync(path.join(out,'cases.json'),JSON.stringify({cases},null,2)+'\n');
 const report={status:'PASS',cases:cases.length,split_merge_checks:cases.filter(c=>c.merged_file).length,packaged_process:true,plan_unsaved:true,same_file_saved:true,restored_bytes_exact:true,layout_verified:false};fs.writeFileSync(path.join(out,'verification.json'),JSON.stringify(report,null,2)+'\n');console.log(JSON.stringify(report));
}finally{assert.equal(path.dirname(temporary),os.tmpdir());assert.ok(path.basename(temporary).startsWith('hwp-easy-text-package-'));fs.rmSync(temporary,{recursive:true,force:true});}
