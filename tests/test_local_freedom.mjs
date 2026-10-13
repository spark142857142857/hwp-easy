import test from 'node:test';import assert from 'node:assert/strict';import fs from 'node:fs';import path from 'node:path';import os from 'node:os';
import {HwpDocument} from '@rhwp/core';import {initializeLocal,runLocal} from '../src/one_hwp/local_runner.mjs';
import {groupFixture,fieldFixture,nestedFixture,checkedExport} from './local_complex_fixtures.mjs';
import {progressiveJpeg} from './local_image_fixtures.mjs';import {digest} from '../src/one_hwp/local_file.mjs';
import {inspectLocalComplex} from '../src/one_hwp/local_complex.mjs';
initializeLocal(fs.readFileSync(new URL('../node_modules/@rhwp/core/rhwp_bg.wasm',import.meta.url)));
const read=source=>runLocal({action:'read',source,max_chars:64000,max_blocks:128});
function workspace(t,bytes){const dir=fs.mkdtempSync(path.join(os.tmpdir(),'hwp-freedom-'));t.after(()=>{assert.equal(path.dirname(dir),os.tmpdir());assert.ok(path.basename(dir).startsWith('hwp-freedom-'));fs.rmSync(dir,{recursive:true,force:true});});const source=path.join(dir,'test.hwp');fs.writeFileSync(source,bytes);return {source,bytes};}
async function saveRestore(w,before,operations,check){const plan=await runLocal({action:'plan',source:w.source,expected_sha256:before.source_sha256,operations});assert.equal(plan.saved,false);assert.deepEqual(fs.readFileSync(w.source),Buffer.from(w.bytes));const result=await runLocal({action:'edit',source:w.source,expected_sha256:before.source_sha256,operations});assert.equal(result.saved,true);const after=await read(w.source);await check(after,result);await runLocal({action:'restore',source:w.source,expected_sha256:(await read(w.source)).source_sha256,backup_id:result.backup_id});assert.deepEqual(fs.readFileSync(w.source),Buffer.from(w.bytes));}
for(const offset of [3,7,14,18])test(`field paragraph split outside its value preserves wrappers and Unicode: ${offset}`,async t=>{
 const w=workspace(t,fieldFixture({mixed:true})),before=await read(w.source),b=before.blocks[0];assert.equal(b.structural_editable,true);
 await saveRestore(w,before,[{type:'split_paragraph',target_id:b.target_id,expected_old:b.text,offset}],after=>{assert.equal(after.blocks[0].text,[...b.text].slice(0,offset).join(''));assert.equal(after.blocks[1].text,[...b.text].slice(offset).join(''));assert.equal(after.fields[0].value,before.fields[0].value);assert.equal(after.fields[0].name,before.fields[0].name);});
});
test('split inside a ClickHere value rejects atomically',async t=>{const w=workspace(t,fieldFixture()),b=(await read(w.source)).blocks[0];await assert.rejects(runLocal({action:'edit',source:w.source,expected_sha256:(await read(w.source)).source_sha256,operations:[{type:'split_paragraph',target_id:b.target_id,expected_old:b.text,offset:9}]}),/PARAGRAPH_BOUNDARY_CROSSES_FIELD/);assert.deepEqual(fs.readFileSync(w.source),Buffer.from(w.bytes));});
for(const depth of [2,3])test(`nested cell split and merge retain mixed styles and list count: depth ${depth}`,async t=>{
 const bytes=depth===2?nestedFixture():nestedFixture(nestedFixture(),{inside_nested:true});
 const w=workspace(t,bytes),before=await read(w.source),b=before.blocks.find(x=>x.cell_path.length===depth&&x.text==='inner answer 😀');
 await saveRestore(w,before,[{type:'format_text',target_id:b.target_id,expected_old:b.text,start:2,end:6,props:{bold:true}},{type:'split_paragraph',target_id:b.target_id,expected_old:b.text,offset:7}],async after=>{
  const a=after.blocks.find(x=>x.id===b.id),z=after.blocks[after.blocks.indexOf(a)+1];assert.equal(a.text,'inner a');assert.equal(z.text,'nswer 😀');assert.equal(a.cell_path.length,depth);
  const merged=await runLocal({action:'edit',source:w.source,expected_sha256:after.source_sha256,operations:[{type:'merge_paragraph',target_id:z.target_id,expected_old:z.text,previous_target_id:a.target_id,expected_previous:a.text}]});assert.equal(merged.saved,true);assert.equal((await read(w.source)).blocks.find(x=>x.id===b.id).text,b.text);
 });
});
test('split moves an intact nested table subtree and remaps initial batch targets',async t=>{
 const w=workspace(t,nestedFixture()),before=await read(w.source),host=before.blocks.find(x=>x.cell_path.length===1&&x.text==='문항'),child=before.blocks.find(x=>x.cell_path.length===2&&x.text==='inner label');
 await saveRestore(w,before,[{type:'split_paragraph',target_id:host.target_id,expected_old:host.text,offset:1},{type:'replace_text',target_id:child.target_id,expected_old:child.text,new_text:'nested kept'}],after=>{assert.ok(after.blocks.some(x=>x.text==='nested kept'&&x.cell_path.length===2));assert.deepEqual(after.tables.map(x=>x.dimensions),before.tables.map(x=>x.dimensions));});
});
test('insert duplicate and delete paragraphs inside depth-three cells',async t=>{
 const w=workspace(t,nestedFixture(nestedFixture(),{inside_nested:true})),before=await read(w.source),b=before.blocks.find(x=>x.cell_path.length===3&&x.text==='inner label');
 await saveRestore(w,before,[{type:'insert_paragraphs',target_id:b.target_id,expected_old:b.text,paragraphs:['added 😀','']},{type:'duplicate_paragraph',target_id:b.target_id,expected_old:b.text},{type:'delete_paragraph',target_id:b.target_id,expected_old:b.text}],after=>{const values=after.blocks.filter(x=>x.cell_path.length===3).map(x=>x.text);assert.equal(values.filter(x=>x==='inner label').length,1);assert.ok(values.includes('added 😀'));assert.ok(values.includes(''));});
});
test('whole nested picture group rotation and resizing preserve every leaf',async t=>{
 const doc=new HwpDocument(groupFixture({source:groupFixture(),paragraph:2}));let bytes;try{doc.groupShapes(JSON.stringify({sectionIdx:0,targets:[{paraIdx:1,controlIdx:0},{paraIdx:2,controlIdx:0}]}));bytes=checkedExport(doc);}finally{doc.free();}
 const w=workspace(t,bytes),before=await read(w.source),g=before.picture_groups[0],b=before.blocks.find(b=>b.id===g.block_id);
 await saveRestore(w,before,[{type:'transform_picture_group',target_id:g.target_id,expected_old:b.text,expected_properties:g.properties,expected_rotation_angle:g.rotationAngle,props:{width:g.properties.width*2,height:g.properties.height*2,rotationAngle:90}}],after=>{assert.equal(after.picture_groups[0].rotationAngle,90);assert.equal(after.picture_groups[0].properties.width,g.properties.height*2);assert.deepEqual(after.picture_groups[0].pictures,g.pictures);});
});
test('strict geometry policy prevents new cell overflow before saving; fitting retains column ratios',async t=>{
 const w=workspace(t,nestedFixture()),before=await read(w.source),table=before.tables.find(t=>t.cell_path.length===1),b=before.blocks.find(x=>x.id===table.cells[0].paragraph_ids[0]),op={type:'resize_table_columns',target_id:b.target_id,expected_old:b.text,widths:[20000,20000]};
 await assert.rejects(runLocal({action:'edit',source:w.source,expected_sha256:before.source_sha256,operations:[op],layout_policy:'reject_new_overflow'}),/NEW_LAYOUT_OVERFLOW/);assert.deepEqual(fs.readFileSync(w.source),Buffer.from(w.bytes));
 const grown=await runLocal({action:'edit',source:w.source,expected_sha256:before.source_sha256,operations:[op]}),after=await read(w.source),now=after.tables.find(t=>t.cell_path.length===1),target=after.blocks.find(x=>x.id===now.cells[0].paragraph_ids[0]);assert.ok(grown.layout_diagnostics.issues.some(x=>x.code==='NESTED_TABLE_EXCEEDS_CELL_WIDTH'));
 const fit=await runLocal({action:'edit',source:w.source,expected_sha256:after.source_sha256,operations:[{type:'fit_table_to_cell',target_id:target.target_id,expected_old:target.text,expected_dimensions:now.dimensions,expected_properties:now.properties}],layout_policy:'reject_new_overflow'});assert.equal(fit.layout_diagnostics.issues.some(x=>x.code==='NESTED_TABLE_EXCEEDS_CELL_WIDTH'),false);assert.ok(Math.abs((await read(w.source)).tables.find(t=>t.cell_path.length===1).cells[0].properties.width-(await read(w.source)).tables.find(t=>t.cell_path.length===1).cells[1].properties.width)<=1);
 const final=await read(w.source);await runLocal({action:'restore',source:w.source,expected_sha256:final.source_sha256,backup_id:grown.backup_id});assert.deepEqual(fs.readFileSync(w.source),Buffer.from(w.bytes));
});
test('fitting an already-contained nested table is a true no-op',async t=>{
 const w=workspace(t,nestedFixture()),s=await read(w.source),table=s.tables.find(t=>t.cell_path.length===1),b=s.blocks.find(x=>x.id===table.cells[0].paragraph_ids[0]),prior=fs.statSync(w.source).mtimeMs;
 const result=await runLocal({action:'edit',source:w.source,expected_sha256:s.source_sha256,operations:[{type:'fit_table_to_cell',target_id:b.target_id,expected_old:b.text,expected_dimensions:table.dimensions,expected_properties:table.properties}]});assert.equal(result.saved,false);assert.equal(result.unchanged,true);assert.equal(fs.statSync(w.source).mtimeMs,prior);assert.deepEqual(fs.readFileSync(w.source),Buffer.from(w.bytes));
});
test('fitting refuses a container narrower than content without changing text or saving',async t=>{
 const w=workspace(t,nestedFixture()),s=await read(w.source),host=s.blocks.find(b=>b.cell_path.length===1&&b.text==='문항');
 await runLocal({action:'edit',source:w.source,expected_sha256:s.source_sha256,operations:[{type:'format_cell',target_id:host.target_id,expected_old:host.text,props:{paddingLeft:10000,paddingRight:10000,applyInnerMargin:true}}]});const before=await read(w.source),table=before.tables.find(t=>t.cell_path.length===1),b=before.blocks.find(x=>x.id===table.cells[0].paragraph_ids[0]),prior=fs.readFileSync(w.source),history=await runLocal({action:'history',source:w.source,expected_sha256:before.source_sha256});
 await assert.rejects(runLocal({action:'edit',source:w.source,expected_sha256:before.source_sha256,operations:[{type:'fit_table_to_cell',target_id:b.target_id,expected_old:b.text,expected_dimensions:table.dimensions,expected_properties:table.properties}]}),/LAYOUT_CANNOT_FIT_WITHOUT_REFLOW/);assert.deepEqual(fs.readFileSync(w.source),prior);assert.deepEqual(await runLocal({action:'history',source:w.source,expected_sha256:before.source_sha256}),history);
});
test('field-bearing paragraphs cannot be duplicated or deleted implicitly',async t=>{
 const w=workspace(t,fieldFixture()),s=await read(w.source),b=s.blocks[0];for(const type of ['duplicate_paragraph','delete_paragraph'])await assert.rejects(runLocal({action:'edit',source:w.source,expected_sha256:s.source_sha256,operations:[{type,target_id:b.target_id,expected_old:b.text}]}),/PARAGRAPH_(DUPLICATE|DELETE)_CONTAINS_CONTROL/);assert.deepEqual(fs.readFileSync(w.source),Buffer.from(w.bytes));
});
async function overflowingPicture(t){const w=workspace(t,nestedFixture()),s=await read(w.source),b=s.blocks.find(b=>b.cell_path.length===1&&b.text==='문항'),imagePath=path.join(path.dirname(w.source),'image.jpg');fs.writeFileSync(imagePath,progressiveJpeg);const image={source:imagePath,expected_sha256:digest(progressiveJpeg)};await runLocal({action:'edit',source:w.source,expected_sha256:s.source_sha256,operations:[{type:'insert_picture',target_id:b.target_id,expected_old:b.text,offset:0,image,width:30000,height:1800}]});return {w,image,s:await read(w.source)};}
test('strict overflow matching follows paragraph identities through boundary shifts',async t=>{
 const {w,s}=await overflowingPicture(t),b=s.blocks[0];const saved=await runLocal({action:'edit',source:w.source,expected_sha256:s.source_sha256,operations:[{type:'insert_paragraphs',target_id:b.target_id,expected_old:b.text,paragraphs:['before shifted table']}],layout_policy:'reject_new_overflow'});assert.equal(saved.saved,true);assert.equal(saved.layout_diagnostics.new_issues.filter(i=>i.certainty==='geometry').length,0);assert.ok(saved.layout_diagnostics.issues.some(i=>i.code==='PICTURE_EXCEEDS_CELL_WIDTH'));
});
test('fixing one overflow does not hide an equal new overflow in another cell',async t=>{
 const {w,image,s}=await overflowingPicture(t),picture=s.pictures[0],old=s.blocks.find(b=>b.id===picture.block_id),other=s.blocks.find(b=>b.cell_path.length===1&&b.text==='합성 답변 원문'),prior=fs.readFileSync(w.source);
 await assert.rejects(runLocal({action:'edit',source:w.source,expected_sha256:s.source_sha256,operations:[{type:'delete_picture',target_id:old.target_id,expected_old:old.text,expected_properties:picture.properties},{type:'insert_picture',target_id:other.target_id,expected_old:other.text,offset:0,image,width:30000,height:1800}],layout_policy:'reject_new_overflow'}),/NEW_LAYOUT_OVERFLOW/);assert.deepEqual(fs.readFileSync(w.source),prior);
});
test('geometry inspection verifies mapped cells without requesting whole-document pagination',()=>{
 class NoPagination extends HwpDocument{getDocumentInfo(){throw new Error('Pagination is outside geometry scope');}getCharPropertiesAt(){throw new Error('Font rendering is outside geometry scope');}getCellCharPropertiesAtByPath(){throw new Error('Font rendering is outside geometry scope');}}
 const state=inspectLocalComplex(NoPagination,nestedFixture(),{includeDocumentInfo:false,verifyCharacterModel:false});assert.equal(state.tables.length,2);assert.equal(state.blocks.some(b=>b.text==='inner answer 😀'&&b.text_mapping_verified&&b.character_runs?.[0]?.properties.fontSize===1000),true);assert.equal(Object.hasOwn(state,'info'),false);
});
