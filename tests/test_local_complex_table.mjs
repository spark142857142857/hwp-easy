import test from 'node:test';import assert from 'node:assert/strict';import fs from 'node:fs';import os from 'node:os';import path from 'node:path';
import {initializeLocal,runLocal} from '../src/one_hwp/local_runner.mjs';import {nestedFixture} from './local_complex_fixtures.mjs';import {fixture} from './rhwp_fixtures.mjs';import {progressiveJpeg} from './local_image_fixtures.mjs';import {digest} from '../src/one_hwp/local_file.mjs';
initializeLocal(fs.readFileSync(new URL('../node_modules/@rhwp/core/rhwp_bg.wasm',import.meta.url)));
function workspace(t,bytes){const dir=fs.mkdtempSync(path.join(os.tmpdir(),'hwp-complex-axis-'));t.after(()=>{assert.equal(path.dirname(dir),os.tmpdir());assert.ok(path.basename(dir).startsWith('hwp-complex-axis-'));fs.rmSync(dir,{recursive:true,force:true});});const source=path.join(dir,'synthetic.hwp');fs.writeFileSync(source,bytes);return {dir,source};}
const read=source=>runLocal({action:'read',source,max_chars:64000,max_blocks:128});
for(const depth of [2,3])for(const axis of ['row','column'])test(`nested ${axis} insert and delete keep old targets through a formatting batch: depth=${depth}`,async t=>{
 const bytes=depth===2?nestedFixture():nestedFixture(nestedFixture(),{inside_nested:true}),{source}=workspace(t,bytes),before=await read(source),b=before.blocks.find(b=>b.cell_path.length===depth&&b.text==='inner answer 😀'),table=before.tables.find(t=>t.cell_path.length===depth-1);
 assert.equal(table.axis_editable,true);const index=axis==='row'?0:1,texts=axis==='row'?['new label','new answer 😀\nsecond line']:['new column 😀'];
 const operations=[{type:'insert_table_'+axis,target_id:b.target_id,expected_old:b.text,index,texts},{type:'format_paragraph',target_id:b.target_id,expected_old:b.text,props:{alignment:'right',spacingAfter:120}}],request={source,expected_sha256:before.source_sha256,operations};
 assert.equal((await runLocal({action:'plan',...request})).saved,false);assert.deepEqual(fs.readFileSync(source),Buffer.from(bytes));const saved=await runLocal({action:'edit',...request}),after=await read(source),changed=after.blocks.find(x=>x.cell_path.length===depth&&x.text===b.text);
 assert.equal(changed.paragraph_properties.alignment,'right');for(const old of before.blocks)assert.ok(after.blocks.some(n=>n.text===old.text&&n.cell_path.length===old.cell_path.length));
 const now=after.tables.find(t=>t.id===table.id);assert.equal(now.dimensions[axis==='row'?'rowCount':'colCount'],table.dimensions[axis==='row'?'rowCount':'colCount']+1);assert.equal(now.properties.tableWidth,table.properties.tableWidth);assert.equal(now.axis_editable,true);
 const removed=now.cells.filter(c=>c[axis==='row'?'row':'col']===index).map(c=>c.paragraph_ids.map(id=>after.blocks.find(b=>b.id===id).text));
 await runLocal({action:'edit',source,expected_sha256:after.source_sha256,operations:[{type:'delete_table_'+axis,target_id:changed.target_id,expected_old:changed.text,index,expected_cells:removed}]});const final=await read(source);assert.equal(final.tables.find(t=>t.id===table.id).dimensions[axis==='row'?'rowCount':'colCount'],table.dimensions[axis==='row'?'rowCount':'colCount']);
 await runLocal({action:'restore',source,expected_sha256:final.source_sha256,backup_id:saved.backup_id});assert.deepEqual(fs.readFileSync(source),Buffer.from(bytes));
});

test('a table with an inline picture retains that picture across row insertion and later batch crop',async t=>{
 const {source,dir}=workspace(t,fixture()),imagePath=path.join(dir,'test.jpg');fs.writeFileSync(imagePath,progressiveJpeg);let state=await read(source);let b=state.blocks.find(x=>x.text==='합성 답변 원문');
 await runLocal({action:'edit',source,expected_sha256:state.source_sha256,operations:[{type:'insert_picture',target_id:b.target_id,expected_old:b.text,offset:0,image:{source:imagePath,expected_sha256:digest(progressiveJpeg)},width:2400,height:1500}]});const original=fs.readFileSync(source);state=await read(source);b=state.blocks.find(x=>x.id===b.id);const picture=state.pictures[0];
 const saved=await runLocal({action:'edit',source,expected_sha256:state.source_sha256,operations:[{type:'insert_table_row',target_id:b.target_id,expected_old:b.text,index:0,texts:['new question','new answer']},{type:'update_picture',target_id:b.target_id,expected_old:b.text,picture_index:0,expected_properties:picture.properties,props:{cropLeft:75}}]});
 const after=await read(source);assert.equal(after.pictures.length,1);assert.equal(after.pictures[0].properties.cropLeft,75);assert.ok(after.blocks.some(x=>x.text==='new answer'));assert.equal(after.tables[0].dimensions.rowCount,state.tables[0].dimensions.rowCount+1);
 await runLocal({action:'restore',source,expected_sha256:after.source_sha256,backup_id:saved.backup_id});assert.deepEqual(fs.readFileSync(source),original);
});

test('deleted targets in a structural batch and unacknowledged controlled cells cannot publish',async t=>{
 const bytes=nestedFixture(),{source,dir}=workspace(t,bytes),before=await read(source),b=before.blocks.find(x=>x.kind==='nested_cell'&&x.text==='inner answer 😀');
 const operations=[{type:'insert_table_row',target_id:b.target_id,expected_old:b.text,index:0,texts:['new label','new value']},{type:'delete_table_row',target_id:b.target_id,expected_old:b.text,index:1,expected_cells:[['inner label'],['inner answer 😀']]},{type:'format_paragraph',target_id:b.target_id,expected_old:b.text,props:{alignment:'right'}}];
 await assert.rejects(runLocal({action:'edit',source,expected_sha256:before.source_sha256,operations}),/BATCH_TARGET_REMOVED/);assert.deepEqual(fs.readFileSync(source),Buffer.from(bytes));assert.equal(fs.existsSync(path.join(dir,'.hwp-easy-backups')),false);
 const outer=before.blocks.find(x=>x.kind==='cell');await assert.rejects(runLocal({action:'edit',source,expected_sha256:before.source_sha256,operations:[{type:'delete_table_row',target_id:outer.target_id,expected_old:outer.text,index:0,expected_cells:[['문항'],['합성 답변 원문']]}]}),/TABLE_REMOVED_CELL_HAS_CONTROLS|EXPECTED_TABLE_CELLS_MISMATCH/);assert.deepEqual(fs.readFileSync(source),Buffer.from(bytes));
});

test('a retained nested-cell field stays addressable after row insertion and cannot be deleted through visible text confirmation',async t=>{
 const {source}=workspace(t,nestedFixture());let state=await read(source),b=state.blocks.find(b=>b.kind==='nested_cell'&&b.text==='inner answer 😀');
 await runLocal({action:'edit',source,expected_sha256:state.source_sha256,operations:[{type:'insert_field',target_id:b.target_id,expected_old:b.text,offset:2,name:'synthetic',guide:'guide',value:'old value'}]});state=await read(source);const f=state.fields[0];b=state.blocks.find(b=>b.id===f.block_id);const original=fs.readFileSync(source);
 const saved=await runLocal({action:'edit',source,expected_sha256:state.source_sha256,operations:[{type:'insert_table_row',target_id:b.target_id,expected_old:b.text,index:0,texts:['new label','new answer']},{type:'set_field',target_id:f.target_id,expected_old:f.value,new_text:'new value 😀'}]}),after=await read(source),now=after.fields[0],table=after.tables.find(t=>t.id.endsWith(':t0')&&t.cell_path.length===1),host=after.blocks.find(b=>b.id===now.block_id);
 assert.equal(now.field_id,f.field_id);assert.equal(now.value,'new value 😀');assert.equal(now.name,f.name);const current=fs.readFileSync(source),removed=table.cells.filter(c=>c.row===1).map(c=>c.paragraph_ids.map(id=>after.blocks.find(b=>b.id===id).text));
 await assert.rejects(runLocal({action:'edit',source,expected_sha256:after.source_sha256,operations:[{type:'delete_table_row',target_id:host.target_id,expected_old:host.text,index:1,expected_cells:removed}]}),/TABLE_REMOVED_CELL_HAS_CONTROLS/);assert.deepEqual(fs.readFileSync(source),current);
 await runLocal({action:'restore',source,expected_sha256:after.source_sha256,backup_id:saved.backup_id});assert.deepEqual(fs.readFileSync(source),original);
});
