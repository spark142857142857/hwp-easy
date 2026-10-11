import test from 'node:test';import assert from 'node:assert/strict';
import fs from 'node:fs';import path from 'node:path';import os from 'node:os';
import {fixture} from './rhwp_fixtures.mjs';
import {initializeLocal,runLocal} from '../src/one_hwp/local_runner.mjs';
import {digest} from '../src/one_hwp/local_file.mjs';
import {readHwp} from '../probes/sites-runtime/guard/container.mjs';
initializeLocal(fs.readFileSync(new URL('../node_modules/@rhwp/core/rhwp_bg.wasm',import.meta.url)));
function workspace(t,bytes=fixture()){
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'hwp-easy-batch-'));
 t.after(()=>{assert.equal(path.dirname(dir),os.tmpdir());assert.ok(path.basename(dir).startsWith('hwp-easy-batch-'));fs.rmSync(dir,{recursive:true,force:true});});
 const source=path.join(dir,'합성 여러 작업.hwp');fs.writeFileSync(source,bytes);
 return {dir,source,read:()=>runLocal({action:'read',source,max_chars:64000,max_blocks:128})};
}
const op=(b,type,extra)=>({type,target_id:b.target_id,expected_old:b.text,...extra});
const batch=(source,state,operations,action='edit',extra={})=>runLocal({action,source,expected_sha256:state.source_sha256,operations,...extra});

for(const merged of [false,true])test(`moved ${merged?'merged':'plain'} table keeps picture identity through geometry, rotation and another-cell editing`,async t=>{
 const {source,read,dir}=workspace(t,fixture({merged,paragraphs:['시작','중간','끝']})),initial=await read(),firstCell=initial.blocks.find(b=>b.kind==='cell');
 const png=Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=','base64'),image=path.join(dir,'synthetic.png');fs.writeFileSync(image,png);
 for(let i=0;i<2;i++){const current=await read(),cell=current.blocks.find(b=>b.id===firstCell.id);await batch(source,current,[op(cell,'insert_picture',{offset:0,width:7200,height:3600,image:{source:image,expected_sha256:digest(png)}})]);}
 const state=await read(),cell=state.blocks.find(b=>b.id===firstCell.id),other=state.blocks.find(b=>b.kind==='cell'&&b.cell!==cell.cell),last=state.blocks.filter(b=>b.kind==='paragraph').at(-1),picked=state.pictures.find(p=>p.picture_index===1),before=fs.readFileSync(source),raw=readHwp(before),originalPicture=state.pictures.find(p=>p.picture_index===0),backupDir=path.join(dir,'.hwp-easy-backups'),backups=fs.readdirSync(backupDir).length;
 const operations=[op(cell,'resize_table_columns',{widths:[16000,26000]}),op(cell,'move_table',{after_target_id:last.target_id,expected_after:last.text}),op(cell,'update_picture',{picture_index:1,expected_properties:picked.properties,props:{rotationAngle:90}}),op(cell,'format_cell',{props:{paddingLeft:400,applyInnerMargin:true,verticalAlign:0}}),op(other,'splice_text',{start:0,end:0,new_text:'옮긴 칸 '})];
 assert.equal((await batch(source,state,operations,'plan')).saved,false);assert.deepEqual(fs.readFileSync(source),before);assert.equal(fs.readdirSync(backupDir).length,backups);
 const saved=await batch(source,state,operations),after=await read(),afterRaw=readHwp(fs.readFileSync(source));assert.equal(saved.atomic_batch,true);assert.equal(saved.operation_count,5);assert.equal(fs.readdirSync(backupDir).length,backups+2);
 assert.equal(after.tables[0].properties.tableWidth,42000);assert.equal(after.tables[0].cells.find(c=>c.cell===cell.cell).properties.paddingLeft,400);assert.ok(after.blocks.some(b=>b.text==='옮긴 칸 '+other.text));
 assert.equal(after.pictures.length,2);assert.deepEqual(after.pictures.find(p=>p.picture_index===0).properties,originalPicture.properties);assert.equal(after.pictures.find(p=>p.picture_index===1).properties.rotationAngle,90);
 for(const [key,value]of raw.streams)if(key.startsWith('BinData/'))assert.deepEqual(afterRaw.streams.get(key),value);
 const moved=after.blocks.find(b=>b.target_id===after.pictures.find(p=>p.picture_index===1).target_id),now=fs.readFileSync(source),newBackups=fs.readdirSync(backupDir).length;
 await assert.rejects(batch(source,after,[op(moved,'format_table',{props:{paddingLeft:200}}),op(moved,'update_picture',{picture_index:1,expected_properties:picked.properties,props:{rotationAngle:0}})]),/EXPECTED_PICTURE_MISMATCH/);assert.deepEqual(fs.readFileSync(source),now);assert.equal(fs.readdirSync(backupDir).length,newBackups);
 await runLocal({action:'restore',source,expected_sha256:after.source_sha256,backup_id:saved.backup_id});assert.deepEqual(fs.readFileSync(source),before);
});

test('range, formatting, paragraph split and shifted table edits save once and restore exactly',async t=>{
 const {source,read,dir}=workspace(t),before=fs.readFileSync(source),state=await read(),body=state.blocks.find(b=>b.text==='중간 합성 문단'),cell=state.blocks.find(b=>b.text==='합성 답변 원문');
 const newText=body.text.slice(0,2)+' 새로운 답변'+body.text.slice(3);
 const operations=[op(body,'format_text',{start:1,end:4,props:{bold:true,textColor:'#334455'}}),
   op(body,'splice_text',{start:2,end:3,new_text:' 새로운 답변'}),op(body,'split_paragraph',{expected_old:newText,offset:2}),
   op(cell,'format_paragraph',{props:{alignment:'center'}}),op(cell,'resize_table_columns',{widths:[12000,30000]}),
   op(cell,'format_cell',{props:{verticalAlign:2,paddingLeft:300,applyInnerMargin:true}})];
 const plan=await batch(source,state,operations,'plan');assert.equal(plan.saved,false);assert.equal(plan.atomic_batch,true);assert.equal(plan.operation_count,6);
 assert.deepEqual(fs.readFileSync(source),before);assert.equal(fs.existsSync(path.join(dir,'.hwp-easy-backups')),false);
 const saved=await batch(source,state,operations),after=await read();assert.equal(saved.saved_path,source);assert.equal(saved.operations.length,6);assert.equal(saved.raw_preservation_verified,true);
 assert.equal(after.blocks.find(b=>b.text===cell.text).style.paragraph.alignment,'center');assert.equal(after.tables[0].properties.tableWidth,42000);
 assert.equal(after.tables[0].cells.find(c=>c.cell===cell.cell).properties.verticalAlign,2);
 assert.ok(after.blocks.some(b=>b.text===newText.slice(2)));
 const backups=fs.readdirSync(path.join(dir,'.hwp-easy-backups')).filter(n=>n.endsWith('.hwp'));assert.equal(backups.length,1);
 await runLocal({action:'restore',source,expected_sha256:after.source_sha256,backup_id:saved.backup_id});assert.deepEqual(fs.readFileSync(source),before);
});

for(const type of ['insert_paragraphs','create_table','delete_paragraph'])test(`${type} keeps original later body/cell identities`,async t=>{
 const {source,read}=workspace(t),state=await read(),body=state.blocks.find(b=>b.text==='중간 합성 문단'),later=state.blocks.filter(b=>b.kind==='paragraph'&&b.text).at(-1),cell=state.blocks.find(b=>b.text==='합성 답변 원문');
 const first=type==='insert_paragraphs'?{paragraphs:['추가 A','추가 B']}:type==='create_table'?{cells:[['A','B']]}:{};
 const saved=await batch(source,state,[op(body,type,first),op(later,'splice_text',{start:0,end:0,new_text:'후속 '}),op(cell,'replace_text',{new_text:'같은 칸의 새 답변'})]),after=await read();
 assert.equal(saved.atomic_batch,true);assert.ok(after.blocks.some(b=>b.text==='후속 '+later.text));assert.equal(after.blocks.filter(b=>b.text==='같은 칸의 새 답변').length,1);
});

for(const merged of [false,true])for(const type of ['insert_table_row','insert_table_column'])test(`${type} translates original ${merged?'merged':'plain'} cell identity`,async t=>{
 const {source,read}=workspace(t,fixture({merged})),state=await read(),cell=state.blocks.find(b=>b.kind==='cell'&&b.row===1&&b.column===1),anchor=state.blocks.find(b=>b.kind==='cell');
 const saved=await batch(source,state,[op(anchor,type,{index:0,texts:type==='insert_table_row'?['','']:['','',''].slice(0,state.tables[0].dimensions.rowCount)}),op(cell,'splice_text',{start:0,end:0,new_text:'후속 '})]),after=await read();
 assert.equal(saved.atomic_batch,true);const edited=after.blocks.find(b=>b.text==='후속 '+cell.text);assert.ok(edited);
 assert.equal(edited.row,cell.row+(type==='insert_table_row'?1:0));assert.equal(edited.column,cell.column+(type==='insert_table_column'?1:0));
});

test('splitting a cell paragraph shifts a later paragraph in the same cell',async t=>{
 const {source,read}=workspace(t),first=await read(),cell=first.blocks.find(b=>b.text==='합성 답변 원문');
 await batch(source,first,[op(cell,'replace_text',{new_text:'처음 답변\n둘째 답변'})]);
 const state=await read(),one=state.blocks.find(b=>b.text==='처음 답변'),two=state.blocks.find(b=>b.text==='둘째 답변');
 await batch(source,state,[op(one,'split_paragraph',{offset:2}),op(two,'splice_text',{start:0,end:0,new_text:'유지 '})]);
 const after=await read();assert.deepEqual(after.blocks.filter(b=>b.kind==='cell'&&b.cell===cell.cell).map(b=>b.text),['처음',' 답변','유지 둘째 답변']);
});

test('adjacent merge remaps following body targets and retains the previous identity',async t=>{
 const {source,read}=workspace(t,fixture({table:false,paragraphs:['첫','둘','셋','넷']})),state=await read(),[first,second,third,last]=state.blocks;
 await batch(source,state,[op(third,'merge_paragraph',{previous_target_id:second.target_id,expected_previous:second.text}),op(second,'splice_text',{expected_old:'둘셋',start:1,end:1,new_text:'과'}),op(last,'replace_text',{new_text:'마지막'})]);
 assert.deepEqual((await read()).blocks.map(b=>b.text),['첫','둘과셋','마지막']);
});

for(const mode of ['wrong-old','removed-target','stale-version','unknown-operation'])test(`late ${mode} fails without saving or recovery writes`,async t=>{
 const {source,read,dir}=workspace(t),state=await read(),before=fs.readFileSync(source),body=state.blocks.find(b=>b.text==='중간 합성 문단'),cell=state.blocks.find(b=>b.text==='합성 답변 원문');
 const operations=[op(body,mode==='removed-target'?'delete_paragraph':'format_text',mode==='removed-target'?{}:{start:0,end:2,props:{bold:true}}),
   mode==='removed-target'?op(body,'replace_text',{new_text:'지워진 대상'}):op(cell,mode==='unknown-operation'?'unknown':'replace_text',{new_text:'새 답변',...(mode==='wrong-old'?{expected_old:'다른 값'}:{}),...(mode==='stale-version'?{target_id:cell.target_id.replace(state.source_sha256,'0'.repeat(64))}:{})})];
 await assert.rejects(batch(source,state,operations),mode==='removed-target'?/BATCH_TARGET_REMOVED/:mode==='stale-version'?/VERSION_CONFLICT/:mode==='wrong-old'?/EXPECTED_OLD_MISMATCH/:/INVALID_OPERATION/);
 assert.deepEqual(fs.readFileSync(source),before);assert.equal(fs.existsSync(path.join(dir,'.hwp-easy-backups')),false);
});

test('deleting a table axis marks removed cells instead of targeting a neighbour',async t=>{
 const {source,read,dir}=workspace(t),state=await read(),before=fs.readFileSync(source),anchor=state.blocks.find(b=>b.kind==='cell'),removed=state.blocks.find(b=>b.kind==='cell'&&b.row===1);
 const expected_cells=state.tables[0].cells.filter(c=>c.row===1).map(c=>state.blocks.filter(b=>c.paragraph_ids.includes(b.id)).map(b=>b.text));
 await assert.rejects(batch(source,state,[op(anchor,'delete_table_row',{index:1,expected_cells}),op(removed,'format_paragraph',{props:{alignment:'center'}})]),/BATCH_TARGET_REMOVED/);
 assert.deepEqual(fs.readFileSync(source),before);assert.equal(fs.existsSync(path.join(dir,'.hwp-easy-backups')),false);
});

test('table layout and picture insertion can share one final save',async t=>{
 const {source,read,dir}=workspace(t),state=await read(),cell=state.blocks.find(b=>b.text==='합성 답변 원문');
 const png=Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=','base64'),image=path.join(dir,'synthetic.png');fs.writeFileSync(image,png);
 const saved=await batch(source,state,[op(cell,'format_cell',{props:{verticalAlign:0,paddingLeft:400,applyInnerMargin:true}}),op(cell,'insert_picture',{offset:0,width:7200,height:3600,image:{source:image,expected_sha256:digest(png)}})]),after=await read();
 assert.equal(saved.atomic_batch,true);assert.equal(after.pictures.length,1);assert.equal(after.tables[0].cells.find(c=>c.cell===cell.cell).properties.paddingLeft,400);
});

test('batch Save As publishes one result and guards an existing output',async t=>{
 const {source,read,dir}=workspace(t),state=await read(),before=fs.readFileSync(source),body=state.blocks.find(b=>b.text==='중간 합성 문단'),cell=state.blocks.find(b=>b.text==='합성 답변 원문'),output=path.join(dir,'요청한 사본.hwp');
 const operations=[op(body,'insert_paragraphs',{paragraphs:['새 문단']}),op(cell,'replace_text',{new_text:'새 답변'})];
 const saved=await batch(source,state,operations,'edit',{output});assert.equal(saved.selected_file_updated,false);assert.equal(saved.saved_path,output);assert.deepEqual(fs.readFileSync(source),before);
 const result=fs.readFileSync(output);await assert.rejects(batch(source,state,operations,'edit',{output}),/VERSION_CONFLICT/);assert.deepEqual(fs.readFileSync(output),result);
});

test('a later operation uses the earlier step text condition on the same original identity',async t=>{
 const {source,read}=workspace(t),state=await read(),body=state.blocks.find(b=>b.text==='중간 합성 문단');
 await batch(source,state,[op(body,'splice_text',{start:0,end:2,new_text:'바뀐'}),op(body,'format_text',{expected_old:'바뀐'+body.text.slice(2),start:0,end:2,props:{bold:true}})]);
 assert.equal((await read()).blocks.find(b=>b.id===body.id).text,'바뀐'+body.text.slice(2));
});

test('merged cell paragraphs retain their identity after moving into the first cell',async t=>{
 const {source,read}=workspace(t,fixture({cells:[['左','右'],['下 A','下 B']]})),state=await read(),left=state.blocks.find(b=>b.text==='左'),right=state.blocks.find(b=>b.text==='右'),last=state.blocks.find(b=>b.text==='下 B');
 await batch(source,state,[op(left,'merge_table_cells',{range:{top:0,left:0,bottom:0,right:1},expected_cells:[['左'],['右']]}),op(right,'splice_text',{start:0,end:0,new_text:'保持 '}),op(last,'replace_text',{new_text:'最后'})]);
 const after=await read(),kept=after.blocks.find(b=>b.text==='保持 右');assert.equal(kept.cell,0);assert.equal(kept.cell_paragraph,1);assert.ok(after.blocks.some(b=>b.text==='最后'));
});

test('splitting a merged cell remaps the later cells without selecting new empty cells',async t=>{
 const {source,read}=workspace(t,fixture({merged:true,cells:[['上 A','上 B'],['下 A','下 B']]})),state=await read(),merged=state.blocks.find(b=>b.kind==='cell'&&b.row===0),last=state.blocks.find(b=>b.text==='下 B');
 const expected_cells=[state.blocks.filter(b=>b.kind==='cell'&&b.cell===merged.cell).map(b=>b.text)];
 await batch(source,state,[op(merged,'split_table_cell',{expected_cells}),op(last,'splice_text',{start:0,end:0,new_text:'保持 '})]);
 const kept=(await read()).blocks.find(b=>b.text==='保持 下 B');assert.equal(kept.row,1);assert.equal(kept.column,1);assert.equal(kept.cell,3);
});
