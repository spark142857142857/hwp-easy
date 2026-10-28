/** Opt-in local corpus coverage. Never prints/uploads names, text or hashes. */
import fs from 'node:fs';import path from 'node:path';import os from 'node:os';import assert from 'node:assert/strict';
import {fileURLToPath} from 'node:url';
import {initializeLocal,runLocal} from '../../../src/one_hwp/local_runner.mjs';
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'../../..');
if(process.argv[3]!=='--testdocs')throw Error('Explicit --testdocs is required');
const out=path.resolve(process.argv[2]??path.join(root,'outputs','common-forms-check'));
assert.ok(out.startsWith(path.join(root,'outputs')+path.sep),'Private report must stay in ignored outputs');
fs.mkdirSync(out,{recursive:true});
const originals=fs.readdirSync(path.join(root,'testdocs')).filter(n=>n.toLowerCase().endsWith('.hwp')).map(n=>({file:path.join(root,'testdocs',n),bytes:fs.readFileSync(path.join(root,'testdocs',n))}));
assert.ok(originals.length,'No selected local corpus');
const temporary=fs.mkdtempSync(path.join(os.tmpdir(),'hwp-common-forms-')),source=path.join(temporary,'selected.hwp');
console.error=()=>{};initializeLocal(fs.readFileSync(path.join(root,'node_modules','@rhwp/core','rhwp_bg.wasm')));
const cases=[],documents=[];
async function read(){let first,cursor,blocks=[];do{const page=await runLocal({action:'read',source,max_chars:64000,max_blocks:128,...(cursor?{cursor}:{})});first??=page;
 for(const b of page.blocks){if(blocks.at(-1)?.id===b.id)blocks.at(-1).text+=b.text;else blocks.push({...b});}cursor=page.next_cursor;
}while(cursor);return {...first,blocks};}
const new_text=['합성 지원 동기: 자료를 검토하고 문제를 해결했습니다.','합성 경험 😀: 역할을 조정하고 결과를 검증했습니다.','합성 계획: 피드백을 반영하겠습니다.'].join('\n');
try{
 for(const [index,input] of originals.entries()){
  fs.writeFileSync(source,input.bytes);const before=await read();assert.ok(!before.complex_profile,'Complex corpus uses check-local-complex');
  const profiles=new Map();before.blocks.forEach((b,position)=>{
   const key=JSON.stringify({kind:b.kind,empty:!b.text.length,lf:b.text.includes('\n'),tab:b.text.includes('\t'),shapes:b.style.char_shape_ids,paragraph:b.style.paragraph,profile:b.style.profile,span:[b.row_span,b.column_span],eligible:b.text_range_editable});
   const prior=profiles.get(key);if(!prior||b.text.length>prior.b.text.length)profiles.set(key,{b,position,count:(prior?.count??0)+1});else prior.count++;
  });
  const report={document:index+1,paragraph_records:before.blocks.length,profile_groups:profiles.size,saved_profiles:0,excluded_profiles:0,anchored_titles_saved:0};
  for(const {b,position,count} of profiles.values()){
   if(!b.text_range_editable){report.excluded_profiles++;continue;}
   const op={type:'splice_text',target_id:b.target_id,expected_old:b.text,start:0,end:[...b.text].length,new_text};
   const plan=await runLocal({action:'plan',source,expected_sha256:before.source_sha256,operations:[op]});assert.equal(plan.saved,false);assert.ok(fs.readFileSync(source).equals(input.bytes),'Plan changed selected copy');
   const saved=await runLocal({action:'edit',source,expected_sha256:before.source_sha256,operations:[op]});assert.equal(saved.selected_file_updated,true);assert.equal(saved.raw_preservation_verified,true);
   const after=await read();assert.ok(JSON.stringify(after.blocks.map(x=>x.text))===JSON.stringify([...before.blocks.slice(0,position).map(x=>x.text),...new_text.split('\n'),...before.blocks.slice(position+1).map(x=>x.text)]),'Saved text sequence mismatch');
   const name=`case-${String(cases.length+1).padStart(3,'0')}`;fs.writeFileSync(path.join(out,name+'-before.hwp'),input.bytes);fs.writeFileSync(path.join(out,name+'-after.hwp'),fs.readFileSync(source));
   cases.push({name,type:op.type,target_raw_index:position,start:0,end:op.end,new_text,covered_positions:count,document:index+1});report.saved_profiles++;
   await runLocal({action:'restore',source,expected_sha256:after.source_sha256,backup_id:saved.backup_id});assert.ok(fs.readFileSync(source).equals(input.bytes),'Recovery byte mismatch');
   fs.writeFileSync(path.join(out,'progress.json'),JSON.stringify({documents:[...documents,report],cases:cases.length},null,2)+'\n');
  }
  const title=before.blocks[0];if(title.editable&&!title.text_range_editable){
   const saved=await runLocal({action:'edit',source,expected_sha256:before.source_sha256,operations:[{type:'replace_text',target_id:title.target_id,expected_old:title.text,new_text:'합성 제목 수정'}]});
   const after=await read();assert.ok(JSON.stringify(after.blocks.map(x=>x.text))===JSON.stringify(['합성 제목 수정',...before.blocks.slice(1).map(x=>x.text)]),'Saved title sequence mismatch');
   await runLocal({action:'restore',source,expected_sha256:after.source_sha256,backup_id:saved.backup_id});assert.ok(fs.readFileSync(source).equals(input.bytes),'Title recovery byte mismatch');report.anchored_titles_saved++;
  }
  documents.push(report);
 }
 assert.ok(originals.every(o=>fs.readFileSync(o.file).equals(o.bytes)));
 fs.writeFileSync(path.join(out,'cases.json'),JSON.stringify({cases},null,2)+'\n');
 const summary={status:'PASS',documents,cases:cases.length,originals_unchanged:true,same_file_save:true,full_reread:true,exact_restore:true,visual_layout_verified:false};
 fs.writeFileSync(path.join(out,'summary.json'),JSON.stringify(summary,null,2)+'\n');console.log(JSON.stringify(summary));
}finally{assert.equal(path.dirname(temporary),os.tmpdir());assert.ok(path.basename(temporary).startsWith('hwp-common-forms-'));fs.rmSync(temporary,{recursive:true,force:true});}
