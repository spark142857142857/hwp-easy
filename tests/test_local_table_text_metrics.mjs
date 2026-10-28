import test from 'node:test';import assert from 'node:assert/strict';import fs from 'node:fs';import os from 'node:os';import path from 'node:path';
import {initializeLocal,runLocal} from '../src/one_hwp/local_runner.mjs';
import {metricsProfiles,tableMetricsFixture} from './local_table_metrics_fixtures.mjs';
import {tableTextLines} from '../src/one_hwp/local_table_text_metrics.mjs';
import {assertPlannedEdit} from '../scripts/lib/local-plan-proof.mjs';
initializeLocal(fs.readFileSync(new URL('../node_modules/@rhwp/core/rhwp_bg.wasm',import.meta.url)));
const read=source=>runLocal({action:'read',source,max_chars:64000,max_blocks:128}),flow=s=>({type:'reflow_table',...Object.fromEntries(['target_id','expected_old','expected_tables'].map(k=>[k,s.table_reflow[0][k]]))});
function workspace(t,bytes){const dir=fs.mkdtempSync(path.join(os.tmpdir(),'hwp-table-metrics-'));t.after(()=>{assert.equal(path.dirname(dir),os.tmpdir());assert.ok(path.basename(dir).startsWith('hwp-table-metrics-'));fs.rmSync(dir,{recursive:true,force:true});});const source=path.join(dir,'selected.hwp');fs.writeFileSync(source,bytes);return source;}
for(const profile of metricsProfiles)test(`styled text flow ${profile.name}: same-file plan, no-op, exact recovery`,async t=>{
 const f=tableMetricsFixture(profile),source=workspace(t,f.bytes);let s=await read(source);
 if(profile.sync){await runLocal({action:'edit',source,expected_sha256:s.source_sha256,operations:[flow(s)]});s=await read(source);}
 const bytes=fs.readFileSync(source),b=s.blocks.find(b=>b.text===f.text),operations=profile.sync?[{type:'format_text',target_id:b.target_id,expected_old:b.text,start:2,end:4,props:{fontSize:2200}}]:[flow(s)],request={source,expected_sha256:s.source_sha256,operations,layout_policy:'reject_new_risk'};
 const plan=await runLocal({action:'plan',...request});assert.deepEqual(fs.readFileSync(source),bytes);const saved=await runLocal({action:'edit',...request});assert.equal(saved.saved_path,source);assertPlannedEdit(plan,saved,profile.name);if(profile.sync)assert.equal(saved.table_auto_sync.length,1);
 const a=await read(source);assert.deepEqual(a.blocks.map(b=>b.text),s.blocks.map(b=>b.text));if(!profile.sync)assert.deepEqual(a.blocks.find(b=>b.text===f.text).style.character_runs,b.style.character_runs);
 assert.equal((await runLocal({action:'edit',source,expected_sha256:a.source_sha256,operations:[flow(a)]})).saved,false);await runLocal({action:'restore',source,expected_sha256:a.source_sha256,backup_id:saved.backup_id});assert.deepEqual(fs.readFileSync(source),bytes);
});
for(const [name,text] of [['rtl','العربية'],['indic','हिन्दी'],['emoji-zwj','👩‍💻'],['orphan-mark','\u0301a'],['stacked-marks','a\u0301\u0300\u0302']])test(`unverified shaping ${name} refuses before backup`,async t=>{
 const f=tableMetricsFixture({depth:2,lines:1}),source=workspace(t,f.bytes),s=await read(source),b=s.blocks.find(b=>b.text==='L000'),ops=[{type:'splice_text',target_id:b.target_id,expected_old:b.text,start:0,end:4,new_text:text},flow(s)];await assert.rejects(runLocal({action:'edit',source,expected_sha256:s.source_sha256,operations:ops}),/TABLE_REFLOW_SHAPING_UNVERIFIED/);assert.deepEqual(fs.readFileSync(source),Buffer.from(f.bytes));assert.equal((await runLocal({action:'history',source,expected_sha256:s.source_sha256})).entries.length,0);
});
test('grapheme widths cannot be split to fit an impossibly narrow cell',()=>{
 const b={text:'e\u0301',text_mapping_verified:true,unit_styles:[0,0],paragraph_properties:{lineSpacingType:0,lineSpacing:160},character_runs:[{start:0,end:2,properties:{fontSize:1000}}]};assert.throws(()=>tableTextLines(b,700,()=>[8,4]),/TABLE_REFLOW_GLYPH_WIDTH_UNSUPPORTED/);
 b.character_runs=[{start:0,end:1,properties:{fontSize:1000}},{start:1,end:2,properties:{fontSize:1400}}];assert.throws(()=>tableTextLines(b,2000,()=>[8,4]),/TABLE_REFLOW_SHAPING_UNVERIFIED/);
 b.character_runs[1].properties={fontSize:1000,bold:true};assert.throws(()=>tableTextLines(b,2000,()=>[8,4]),/TABLE_REFLOW_SHAPING_UNVERIFIED/);
});
