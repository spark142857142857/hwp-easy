import test from 'node:test';import assert from 'node:assert/strict';
import fs from 'node:fs';import os from 'node:os';import path from 'node:path';
import {fixture} from './rhwp_fixtures.mjs';
import {initializeLocal,runLocal} from '../src/one_hwp/local_runner.mjs';
import {readHwp} from '../probes/sites-runtime/guard/container.mjs';
import {digest} from '../src/one_hwp/local_file.mjs';
initializeLocal(fs.readFileSync(new URL('../node_modules/@rhwp/core/rhwp_bg.wasm',import.meta.url)));
function workspace(t,bytes=fixture({table:false,paragraphs:['시작','둘 😀','셋','넷','끝']})){
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'hwp-easy-move-'));t.after(()=>{assert.equal(path.dirname(dir),os.tmpdir());assert.ok(path.basename(dir).startsWith('hwp-easy-move-'));fs.rmSync(dir,{recursive:true,force:true});});
 const source=path.join(dir,'이동 시험.hwp');fs.writeFileSync(source,bytes);return {dir,source,read:()=>runLocal({action:'read',source,max_chars:64000,max_blocks:128})};
}
const move=(b,a,type='move_paragraph')=>({type,target_id:b.target_id,expected_old:b.text,after_target_id:a.target_id,expected_after:a.text});
const edit=(source,s,operations,extra={})=>runLocal({action:'edit',source,expected_sha256:s.source_sha256,operations,...extra});
for(const [from,to,expected] of [[1,4,['시작','셋','넷','끝','둘 😀']],[4,0,['시작','끝','둘 😀','셋','넷']],[3,1,['시작','둘 😀','넷','셋','끝']]])test(`body group ${from} moves after ${to}, preserves content and restores exact bytes`,async t=>{
 const {source,read}=workspace(t),before=fs.readFileSync(source),s=await read(),operation=move(s.blocks[from],s.blocks[to]);
 const plan=await runLocal({action:'plan',source,expected_sha256:s.source_sha256,operations:[operation]});assert.equal(plan.saved,false);assert.deepEqual(fs.readFileSync(source),before);
 const saved=await edit(source,s,[operation]),after=await read();assert.equal(saved.saved,true);assert.equal(saved.paragraph_order_changed,true);assert.deepEqual(after.blocks.map(b=>b.text),expected);
 const a=readHwp(before),b=readHwp(fs.readFileSync(source));for(const [key,value] of a.streams)if(!key.startsWith('BodyText/')&&!['PrvText','PrvImage'].includes(key))assert.deepEqual(b.streams.get(key),value);
 await runLocal({action:'restore',source,expected_sha256:after.source_sha256,backup_id:saved.backup_id});assert.deepEqual(fs.readFileSync(source),before);
});
test('mixed character styles travel with the moved body paragraph',async t=>{
 const {source,read}=workspace(t),first=await read(),b=first.blocks[1];await edit(source,first,[{type:'format_text',target_id:b.target_id,expected_old:b.text,start:1,end:3,props:{bold:true,textColor:'#AA1122'}}]);
 const s=await read(),selected=s.blocks[1];await edit(source,s,[move(selected,s.blocks.at(-1))]);const after=await read();assert.deepEqual(after.blocks.at(-1).style,selected.style);
});
test('position changes keep both source and anchor original identities in one batch',async t=>{
 const {source,read}=workspace(t),s=await read(),[first,second,third,fourth,last]=s.blocks;
 const saved=await edit(source,s,[move(second,last),move(fourth,second),{type:'splice_text',target_id:second.target_id,expected_old:second.text,start:0,end:0,new_text:'옮긴 '},{type:'replace_text',target_id:third.target_id,expected_old:third.text,new_text:'보존 대상'}]);
 assert.equal(saved.atomic_batch,true);assert.deepEqual((await read()).blocks.map(b=>b.text),['시작','보존 대상','끝','옮긴 둘 😀','넷']);
});
for(const merged of [false,true])test(`whole ${merged?'merged':'plain'} table moves with all its cells and geometry`,async t=>{
 const {source,read}=workspace(t,fixture({merged,paragraphs:['시작','둘','끝']})),s=await read(),cell=s.blocks.find(b=>b.kind==='cell'),last=s.blocks.filter(b=>b.kind==='paragraph').at(-1),body=s.blocks.find(b=>b.kind==='paragraph'&&b.paragraph===cell.paragraph);
 await edit(source,s,[move(cell,last,'move_table')]);const after=await read(),table=after.tables[0];assert.equal(table.paragraph,after.blocks.filter(b=>b.kind==='paragraph').length-1);
 assert.deepEqual(table.dimensions,s.tables[0].dimensions);assert.deepEqual(table.properties,s.tables[0].properties);assert.deepEqual(after.blocks.filter(b=>b.kind==='cell').map(b=>b.text),s.blocks.filter(b=>b.kind==='cell').map(b=>b.text));assert.equal(after.blocks.filter(b=>b.kind==='paragraph').at(-1).text,body.text);
});
test('an originally selected cell remains selectable after moving its table in a batch',async t=>{
 const {source,read}=workspace(t,fixture({merged:true,paragraphs:['시작','둘','끝']})),s=await read(),cell=s.blocks.find(b=>b.kind==='cell'),last=s.blocks.filter(b=>b.kind==='paragraph').at(-1);
 await edit(source,s,[move(cell,last,'move_table'),{type:'splice_text',target_id:cell.target_id,expected_old:cell.text,start:0,end:0,new_text:'옮긴 표 '}]);assert.ok((await read()).blocks.some(b=>b.text==='옮긴 표 '+cell.text));
});
test('moving a table preserves an embedded cell picture and image streams',async t=>{
 const {source,read,dir}=workspace(t,fixture({paragraphs:['시작','둘','끝']})),s=await read(),cell=s.blocks.find(b=>b.kind==='cell');const png=Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=','base64'),image=path.join(dir,'synthetic.png');fs.writeFileSync(image,png);
 await edit(source,s,[{type:'insert_picture',target_id:cell.target_id,expected_old:cell.text,offset:0,width:7200,height:3600,image:{source:image,expected_sha256:digest(png)}}]);const current=await read(),picked=current.blocks.find(b=>b.id===cell.id),last=current.blocks.filter(b=>b.kind==='paragraph').at(-1),before=readHwp(fs.readFileSync(source));
 await edit(source,current,[move(picked,last,'move_table')]);const after=await read();assert.equal(after.pictures.length,1);assert.deepEqual(after.pictures[0].properties,current.pictures[0].properties);for(const [key,value] of before.streams)if(key.startsWith('BinData/'))assert.deepEqual(readHwp(fs.readFileSync(source)).streams.get(key),value);
});
test('already adjacent move leaves bytes, mtime and recovery directory unchanged',async t=>{
 const {source,read,dir}=workspace(t),s=await read(),before=fs.readFileSync(source),stamp=fs.statSync(source).mtimeMs,result=await edit(source,s,[move(s.blocks[2],s.blocks[1])]);
 assert.equal(result.saved,false);assert.equal(result.unchanged,true);assert.equal(result.no_change,true);assert.equal(result.backup_id,null);assert.equal(result.output_sha256,s.source_sha256);assert.deepEqual(fs.readFileSync(source),before);assert.equal(fs.statSync(source).mtimeMs,stamp);assert.equal(fs.existsSync(path.join(dir,'.hwp-easy-backups')),false);
});
test('an unchanged move still honors explicit Save As',async t=>{
 const {source,read,dir}=workspace(t),s=await read(),output=path.join(dir,'사본.hwp'),saved=await edit(source,s,[move(s.blocks[2],s.blocks[1])],{output});assert.equal(saved.saved,true);assert.equal(saved.save_mode,'save_as');assert.deepEqual(fs.readFileSync(output),fs.readFileSync(source));
});
for(const mode of ['first','self','cell-as-paragraph','body-as-table','cell-anchor','wrong-source','wrong-anchor','stale-anchor','extra-key'])test(`${mode} move is refused without writes`,async t=>{
 const {source,read,dir}=workspace(t,fixture()),s=await read(),body=s.blocks.find(b=>b.kind==='paragraph'&&b.paragraph===1),last=s.blocks.filter(b=>b.kind==='paragraph').at(-1),cell=s.blocks.find(b=>b.kind==='cell'),before=fs.readFileSync(source);let op=move(body,last);
 if(mode==='first')op=move(s.blocks[0],last);if(mode==='self')op=move(body,body);if(mode==='cell-as-paragraph')op=move(cell,last);if(mode==='body-as-table')op=move(body,last,'move_table');if(mode==='cell-anchor')op=move(body,cell);
 if(mode==='wrong-source')op.expected_old='wrong';if(mode==='wrong-anchor')op.expected_after='wrong';if(mode==='stale-anchor')op.after_target_id=op.after_target_id.replace(s.source_sha256,'0'.repeat(64));if(mode==='extra-key')op.unknown=true;
 await assert.rejects(edit(source,s,[op]),/MOVE_|TABLE_CELL_REQUIRED|EXPECTED_OLD_MISMATCH|VERSION_CONFLICT|INVALID_OPERATION/);assert.deepEqual(fs.readFileSync(source),before);assert.equal(fs.existsSync(path.join(dir,'.hwp-easy-backups')),false);
});
