import {assertPlannedEdit} from './local-plan-proof.mjs';
/** Portable isolated-package checks for merged and controlled table editing. */
import fs from 'node:fs';import path from 'node:path';import os from 'node:os';import assert from 'node:assert/strict';import {spawnSync} from 'node:child_process';
import {initSync} from '@rhwp/core';import {nestedFixture} from '../tests/local_complex_fixtures.mjs';import {progressiveJpeg} from '../tests/local_image_fixtures.mjs';import {digest} from '../src/one_hwp/local_file.mjs';
initSync({module:fs.readFileSync('node_modules/@rhwp/core/rhwp_bg.wasm')});
const out=path.resolve(process.argv[2]??'outputs/local-flexible-tables-check');assert.equal(fs.existsSync(out),false);fs.mkdirSync(out,{recursive:true});
const temp=fs.mkdtempSync(path.join(os.tmpdir(),'hwp-flexible-tables-')),plugin=path.join(temp,'plugin');fs.cpSync('outputs/plugin-package/hwp-easy',plugin,{recursive:true});
const runner=path.join(plugin,'skills/edit-local-hwp/scripts/local-runner.mjs'),requestFile=path.join(temp,'request.json'),source=path.join(temp,'selected.hwp'),imagePath=path.join(temp,'synthetic.jpg');fs.writeFileSync(imagePath,progressiveJpeg);const image={source:imagePath,expected_sha256:digest(progressiveJpeg)},cases=[];
function call(request){fs.writeFileSync(requestFile,JSON.stringify(request));const r=spawnSync(process.execPath,[runner,'--request',requestFile],{encoding:'utf8',timeout:65000,windowsHide:true,maxBuffer:8*1024*1024});assert.equal(r.error,undefined);assert.equal(r.stderr,'');const parsed=JSON.parse(r.stdout);assert.equal(parsed.ok,true,JSON.stringify(parsed));return parsed.result;}
const read=()=>call({action:'read',source,max_chars:64000,max_blocks:128});
const texts=(s,cells)=>cells.map(c=>c.paragraph_ids.map(id=>s.blocks.find(b=>b.id===id).text));
function trial(name,bytes,choose){
 fs.writeFileSync(source,bytes);const before=read(),{table,operations}=choose(before),request={source,expected_sha256:before.source_sha256,operations};fs.writeFileSync(path.join(out,name+'-before.hwp'),bytes);
 const plan=call({action:'plan',...request});assert.equal(plan.saved,false);assert.deepEqual(fs.readFileSync(source),Buffer.from(bytes));
 const saved=call({action:'edit',...request}),after=read(),result=fs.readFileSync(source);assert.equal(saved.saved_path,source);assertPlannedEdit(plan,saved,'check-local-flexible-tables');assert.equal(saved.raw_preservation_verified,true);fs.writeFileSync(path.join(out,name+'-after.hwp'),result);
 call({action:'restore',source,expected_sha256:after.source_sha256,backup_id:saved.backup_id});assert.deepEqual(fs.readFileSync(source),Buffer.from(bytes));fs.writeFileSync(path.join(out,name+'-restored.hwp'),bytes);
 cases.push({name,selected_table:table,before,after,operations,preview_cache:saved.preview_cache});return result;
}
const selected=(s,depth=2)=>{const table=s.tables.find(t=>t.cell_path.length===depth-1),b=s.blocks.find(b=>b.id===table.cells[0].paragraph_ids[0]);return {table,b,base:{target_id:b.target_id,expected_old:b.text}};};
try{
 for(const depth of [2,3])for(const axis of ['row','column']){
  const options={rows:3,cols:3,merge:axis==='row'?[0,0,1,0]:[0,0,0,1]},first=nestedFixture(undefined,options),bytes=depth===2?first:nestedFixture(first,{...options,inside_nested:true}),name=`merged-${depth}-${axis}`;
  const added=trial(name+'-insert',bytes,s=>{const {table,base}=selected(s,depth);return {table,operations:[{...base,type:'insert_table_'+axis,index:1,texts:['','합성 새 칸 😀','합성 두 번째 칸']}]};});
  trial(name+'-delete',added,s=>{const {table,base}=selected(s,depth),key=axis==='row'?'row':'col',affected=table.cells.filter(c=>c[key]<=1&&1<c[key]+c[key+'Span']);return {table,operations:[{...base,type:'delete_table_'+axis,index:1,expected_cells:texts(s,affected)}]};});
 }
 fs.writeFileSync(source,nestedFixture(undefined,{rows:2,cols:2}));let s=read(),b=s.blocks.find(b=>b.text==='inner answer 😀');
 call({action:'edit',source,expected_sha256:s.source_sha256,operations:[{type:'insert_picture',target_id:b.target_id,expected_old:b.text,offset:0,image,width:1500,height:1000},{type:'insert_field',target_id:b.target_id,expected_old:b.text,offset:2,name:'keep',guide:'guide',value:'field 😀'}]});const controlled=fs.readFileSync(source);
 const merged=trial('controlled-merge',controlled,s=>{const {table,base}=selected(s);return {table,operations:[{...base,type:'merge_table_cells',range:{top:0,left:0,bottom:0,right:1},expected_cells:texts(s,table.cells.filter(c=>c.row===0))}]};});
 trial('controlled-split',merged,s=>{const {table,base}=selected(s);return {table,operations:[{...base,type:'split_table_cell',expected_cells:texts(s,[table.cells[0]])}]};});
 trial('controlled-delete',controlled,s=>{const {table,base}=selected(s),affected=table.cells.filter(c=>c.row===0);return {table,operations:[{...base,type:'delete_table_row',index:0,expected_cells:texts(s,affected),expected_cell_sha256:affected.map(c=>c.subtree_sha256)}]};});
 trial('nested-subtree-delete',controlled,s=>{const {table,base}=selected(s,1),affected=table.cells.filter(c=>c.row===0);return {table,operations:[{...base,type:'delete_table_row',index:0,expected_cells:texts(s,affected),expected_cell_sha256:affected.map(c=>c.subtree_sha256)}]};});
 trial('controlled-layout',controlled,s=>{const {table}=selected(s),b=s.blocks.find(b=>b.id===table.cells[1].paragraph_ids[0]),base={target_id:b.target_id,expected_old:b.text};return {table,operations:[{...base,type:'resize_table_columns',widths:[4500,5500]},{...base,type:'resize_table_rows',heights:[2200,3000]},{...base,type:'format_cell',props:{paddingLeft:150,paddingRight:170,verticalAlign:2,applyInnerMargin:true}},{...base,type:'format_table',props:{paddingTop:80,cellSpacing:10}}]};});
 trial('full-merge-split',nestedFixture(undefined,{rows:2,cols:2,merge:[0,0,1,1]}),s=>{const {table,base}=selected(s),h=table.cells[0].properties.height;return {table,operations:[{...base,type:'split_table_cell',expected_cells:texts(s,table.cells),widths:[5000,5000],heights:[Math.floor(h/2),Math.ceil(h/2)]}]};});
 fs.writeFileSync(path.join(out,'cases.json'),JSON.stringify(cases,null,2)+'\n');const summary={status:'PASS',cases:cases.length,scope:'isolated packaged synthetic merged/controlled table edits',same_file_save:true,plan_matches_verified_edit_sha256:true,exact_restore:true,runner_sha256:digest(fs.readFileSync(runner)),layout_verified:false};fs.writeFileSync(path.join(out,'summary.json'),JSON.stringify(summary,null,2)+'\n');console.log(JSON.stringify(summary));
}finally{assert.equal(path.dirname(temp),os.tmpdir());assert.ok(path.basename(temp).startsWith('hwp-flexible-tables-'));fs.rmSync(temp,{recursive:true,force:true});}
