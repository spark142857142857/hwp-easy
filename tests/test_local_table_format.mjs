import test from 'node:test';import assert from 'node:assert/strict';
import {HwpDocument} from '@rhwp/core';import {fixture} from './rhwp_fixtures.mjs';
import {createEngineApi} from '../src/one_hwp/rhwp_api.mjs';import {tableFormatEdit} from '../src/one_hwp/local_table_format.mjs';import {digest} from '../src/one_hwp/local_file.mjs';
import {pictureEdit} from '../src/one_hwp/local_picture.mjs';import fs from 'node:fs';import path from 'node:path';import os from 'node:os';
const api=createEngineApi(HwpDocument,{mixedStyleSameLength:true});
const inspect=bytes=>{const d=api.openDocument(bytes);try{return api.inspectDocument(d,bytes);}finally{d.free();}};
const target=(bytes,b)=>`hwp5:${digest(bytes)}:${Buffer.from(b.id).toString('base64url')}`;
const edit=(bytes,b,operation)=>tableFormatEdit(HwpDocument,bytes,digest(bytes),{target_id:target(bytes,b),expected_old:b.text,...operation});
for(const merged of [false,true])for(const columns of [false,true])test(`resize ${merged?'merged':'plain'} table ${columns?'columns':'rows'} preserves all text and styles`,()=>{
 const source=fixture({merged,mixed:true}),before=inspect(source),b=before.blocks.find(b=>b.kind==='cell'),size=columns?[12000,30000]:[3000,4500];
 const out=edit(source,b,columns?{type:'resize_table_columns',widths:size}:{type:'resize_table_rows',heights:size}),after=inspect(out.bytes);
 assert.deepEqual(before.blocks,after.blocks);assert.equal(out.raw_preservation_verified,true);assert.equal(after.tables[0].properties[columns?'tableWidth':'tableHeight'],size.reduce((a,b)=>a+b,0));
 for(const c of after.tables[0].cells)assert.equal(c.properties[columns?'width':'height'],size.slice(columns?c.col:c.row,(columns?c.col:c.row)+(columns?c.colSpan:c.rowSpan)).reduce((a,b)=>a+b,0));
});
for(const merged of [false,true])for(const verticalAlign of [0,1,2])test(`cell padding and vertical alignment ${verticalAlign}, merged=${merged}`,()=>{
 const source=fixture({merged}),before=inspect(source),b=before.blocks.find(b=>b.kind==='cell'),props={paddingLeft:900,paddingRight:800,paddingTop:400,paddingBottom:350,applyInnerMargin:true,verticalAlign};
 const after=inspect(edit(source,b,{type:'format_cell',props}).bytes);assert.deepEqual(before.blocks,after.blocks);
 for(const c of after.tables[0].cells)assert.deepEqual(c.properties,c.cell===b.cell?{...before.tables[0].cells.find(x=>x.cell===c.cell).properties,...props}:before.tables[0].cells.find(x=>x.cell===c.cell).properties);
});
test('table margins and cell spacing preserve individual cell overrides',()=>{
 const source=fixture(),before=inspect(source),b=before.blocks.find(b=>b.kind==='cell'),props={paddingLeft:750,paddingRight:850,paddingTop:300,paddingBottom:400,cellSpacing:70};
 const after=inspect(edit(source,b,{type:'format_table',props}).bytes);assert.deepEqual(after.tables[0].properties,{...before.tables[0].properties,...props});assert.deepEqual(after.tables[0].cells,before.tables[0].cells);
});
for(const op of [{type:'resize_table_columns',widths:[1,2]},{type:'resize_table_columns',widths:[2000]},{type:'resize_table_rows',heights:[400000,400000]},{type:'format_cell',props:{verticalAlign:3}},{type:'format_cell',props:{paddingLeft:65536}},{type:'format_cell',props:{applyInnerMargin:1}},{type:'format_table',props:{arbitrary:true}}])test(`invalid table metadata request ${JSON.stringify(op)}`,()=>{
 const source=fixture(),b=inspect(source).blocks.find(b=>b.kind==='cell');assert.throws(()=>edit(source,b,op),/INVALID_/);
});
test('table metadata edits retain cell pictures and their embedded bytes',t=>{
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'hwp-easy-table-format-'));t.after(()=>{assert.equal(path.dirname(dir),os.tmpdir());assert.ok(path.basename(dir).startsWith('hwp-easy-table-format-'));fs.rmSync(dir,{recursive:true,force:true});});
 const image=path.join(dir,'synthetic.png'),png=Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=','base64');fs.writeFileSync(image,png);
 let source=fixture({merged:true}),b=inspect(source).blocks.find(b=>b.kind==='cell');source=pictureEdit(HwpDocument,source,digest(source),{type:'insert_picture',target_id:target(source,b),expected_old:b.text,offset:0,width:7200,height:3600,image:{source:image,expected_sha256:digest(png)}}).bytes;
 b=inspect(source).blocks.find(x=>x.id===b.id);const resized=edit(source,b,{type:'resize_table_columns',widths:[16000,26000]});assert.equal(resized.raw_preservation_verified,true);
 const formatted=edit(resized.bytes,inspect(resized.bytes).blocks.find(x=>x.id===b.id),{type:'format_cell',props:{verticalAlign:0,paddingLeft:1000,applyInnerMargin:true}});assert.equal(formatted.raw_preservation_verified,true);
});
