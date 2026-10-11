import test from 'node:test';
import assert from 'node:assert/strict';
import {HwpDocument} from '@rhwp/core';
import {fixture} from './rhwp_fixtures.mjs';
import {openDocument} from '../src/one_hwp/rhwp_bridge.mjs';
import {createEngineApi} from '../src/one_hwp/rhwp_api.mjs';
import {structuralEdit} from '../src/one_hwp/local_structure.mjs';
import {digest} from '../src/one_hwp/local_file.mjs';
import fs from 'node:fs';import os from 'node:os';import path from 'node:path';import {deflateSync} from 'node:zlib';
import {runLocal} from '../src/one_hwp/local_runner.mjs';
const api=createEngineApi(HwpDocument,{mixedStyleSameLength:true,existingLineBreaksEditable:true});
const inspect=bytes=>{const d=api.openDocument(bytes);try{return api.inspectDocument(d,bytes);}finally{d.free();}};
const edit=(bytes,b,op)=>structuralEdit(HwpDocument,bytes,digest(bytes),{target_id:`hwp5:${digest(bytes)}:${Buffer.from(b.id).toString('base64url')}`,expected_old:b.text,...op});
for(const kind of ['paragraph','cell'])test(`new and reused font families in ${kind} keep other definitions and styles`,()=>{
 const bytes=fixture({paragraphs:['앞','가😀A中','끝'],cells:[['질문','가😀A中']]}),b=inspect(bytes).blocks.find(b=>b.kind===kind&&b.text==='가😀A中');
 const out=edit(bytes,b,{type:'format_text',start:1,end:4,props:{fontFamily:'맑은 고딕',bold:true}});assert.equal(out.raw_preservation_verified,true);
 const next=inspect(out.bytes).blocks.find(x=>x.id===b.id);assert.equal(next.text,b.text);assert.equal(edit(out.bytes,next,{type:'format_text',start:0,end:4,props:{fontFamily:'맑은 고딕'}}).raw_preservation_verified,true);
 assert.equal(edit(bytes,b,{type:'format_text',start:0,end:4,props:{fontFamily:'Synthetic font'}}).raw_preservation_verified,true);
});
function png(width,height){const chunk=(name,data)=>{const b=Buffer.alloc(12+data.length);b.writeUInt32BE(data.length);b.write(name,4);data.copy(b,8);let crc=0xffffffff;for(const n of b.subarray(4,-4)){crc^=n;for(let i=0;i<8;i++)crc=crc>>>1^((crc&1)?0xedb88320:0);}b.writeUInt32BE((crc^0xffffffff)>>>0,b.length-4);return b;};const ihdr=Buffer.alloc(13);ihdr.writeUInt32BE(width);ihdr.writeUInt32BE(height,4);ihdr[8]=8;ihdr[9]=6;return Buffer.concat([Buffer.from([137,80,78,71,13,10,26,10]),chunk('IHDR',ihdr),chunk('IDAT',deflateSync(Buffer.alloc((1+width*4)*height))),chunk('IEND',Buffer.alloc(0))]);}
for(const kind of ['paragraph','cell'])for(const empty of [false,true])test(`${kind} PNG insert/replacement/update/delete with same-file recovery empty=${empty}`,async t=>{
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'hwp-easy-extended-'));t.after(()=>{assert.equal(path.dirname(dir),os.tmpdir());assert.ok(path.basename(dir).startsWith('hwp-easy-extended-'));fs.rmSync(dir,{recursive:true,force:true});});
 const source=path.join(dir,'form.hwp'),image=path.join(dir,'first.png'),replacement=path.join(dir,'second.png'),one=png(1,1),two=png(2,3);fs.writeFileSync(image,one);fs.writeFileSync(replacement,two);const original=fixture({table:kind==='cell',paragraphs:['앞',empty?'':'그림 😀 위치','끝'],cells:[['질문',empty?'':'그림 😀 위치']]});fs.writeFileSync(source,original);
 const read=()=>runLocal({action:'read',source,max_chars:64000});let state=await read(),b=state.blocks.find(b=>b.kind===kind&&b.text===(empty?'':'그림 😀 위치'));
 const first=await runLocal({action:'edit',source,expected_sha256:state.source_sha256,operations:[{type:'insert_picture',target_id:b.target_id,expected_old:b.text,offset:empty?0:3,width:7200,height:3600,image:{source:image,expected_sha256:digest(one)}}]});state=await read();assert.equal(state.pictures.length,1);assert.equal(state.pictures[0].format,kind==='cell'?'cell_picture':'body_picture');b=state.blocks.find(b=>b.target_id===state.pictures[0].target_id);
 const plan=await runLocal({action:'plan',source,expected_sha256:state.source_sha256,operations:[{type:'replace_picture',target_id:b.target_id,expected_old:b.text,expected_properties:state.pictures[0].properties,image:{source:replacement,expected_sha256:digest(two)}}]});assert.equal(plan.saved,false);
 await runLocal({action:'edit',source,expected_sha256:state.source_sha256,operations:[{type:'replace_picture',target_id:b.target_id,expected_old:b.text,expected_properties:state.pictures[0].properties,image:{source:replacement,expected_sha256:digest(two)}}]});state=await read();b=state.blocks.find(b=>b.target_id===state.pictures[0].target_id);assert.equal(state.pictures[0].properties.width,7200);
 await runLocal({action:'edit',source,expected_sha256:state.source_sha256,operations:[{type:'update_picture',target_id:b.target_id,expected_old:b.text,expected_properties:state.pictures[0].properties,props:{width:6000,height:3000}}]});state=await read();b=state.blocks.find(b=>b.target_id===state.pictures[0].target_id);
 await runLocal({action:'edit',source,expected_sha256:state.source_sha256,operations:[{type:'delete_picture',target_id:b.target_id,expected_old:b.text,expected_properties:state.pictures[0].properties}]});state=await read();assert.equal(state.pictures.length,0);await runLocal({action:'restore',source,expected_sha256:state.source_sha256,backup_id:first.backup_id});assert.deepEqual(fs.readFileSync(source),original);
});
for(const axis of ['row','column'])for(const adding of [true,false])for(const index of adding?[0,1,2,3]:[0,1,2])test(`merged ${adding?'insert':'delete'} ${axis} at ${index}`,()=>{
 const d=openDocument(fixture({cells:[['A','B','C'],['D','E','F'],['G','H','I']]}));d.mergeTableCells(0,1,0,0,0,1,1);const bytes=d.exportHwp();d.free();const model=inspect(bytes),b=model.blocks.find(x=>x.kind==='cell'),table=model.tables[0],a=axis==='row'?'row':'col',s=axis==='row'?'rowSpan':'colSpan';
 const expected=table.cells.filter(c=>c[a]<=index&&index<c[a]+c[s]).map(c=>model.blocks.filter(x=>x.kind==='cell'&&x.cell===c.cell).map(x=>x.text));
 const op={type:`${adding?'insert':'delete'}_table_${axis}`,index,...(adding?{texts:['','','']}:{expected_cells:expected})},out=edit(bytes,b,op);assert.equal(out.raw_preservation_verified,true);const saved=inspect(out.bytes);
 const retained=table.cells.filter(c=>adding||!(c[a]===index&&c[s]===1));assert.deepEqual(saved.blocks.filter(x=>x.kind==='cell'&&!adding?true:x.kind==='cell'&&x.text!=='').map(x=>x.text).sort(),model.blocks.filter(x=>x.kind==='cell'&&retained.some(c=>c.cell===x.cell)).map(x=>x.text).sort());
});
test('insertion cannot hide requested text inside a crossing merged cell and deletion confirms its retained text',()=>{
 const d=openDocument(fixture({cells:[['A','B'],['C','D'],['E','F']]}));d.mergeTableCells(0,1,0,0,0,1,0);const bytes=d.exportHwp();d.free();const model=inspect(bytes),b=model.blocks.find(b=>b.kind==='cell');
 assert.throws(()=>edit(bytes,b,{type:'insert_table_row',index:1,texts:['would be hidden','new cell']}),/MERGED_INSERT_TEXT_REQUIRES_EMPTY_SLOT/);
 assert.throws(()=>edit(bytes,b,{type:'delete_table_row',index:1,expected_cells:[['wrong retained merge'],['D']]}),/EXPECTED_TABLE_CELLS_MISMATCH/);
 const out=edit(bytes,b,{type:'insert_table_row',index:1,texts:['','new cell']});assert.ok(inspect(out.bytes).blocks.some(b=>b.text==='new cell'));
});
