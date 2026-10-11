import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import {deflateSync} from 'node:zlib';
import {HwpDocument} from '@rhwp/core';
import {fixture} from './rhwp_fixtures.mjs';
import {openDocument} from '../src/one_hwp/rhwp_bridge.mjs';
import {createEngineApi} from '../src/one_hwp/rhwp_api.mjs';
import {structuralEdit} from '../src/one_hwp/local_structure.mjs';
import {pictureEdit,localPictures} from '../src/one_hwp/local_picture.mjs';
import {runLocal} from '../src/one_hwp/local_runner.mjs';
import {digest} from '../src/one_hwp/local_file.mjs';
import {readHwp} from '../probes/sites-runtime/guard/container.mjs';
import {parseRecords} from '../probes/sites-runtime/guard/records.mjs';
import {rewriteSyntheticBody} from '../probes/sites-runtime/tests/page-number-fixtures.mjs';
const api=createEngineApi(HwpDocument,{mixedStyleSameLength:true,existingLineBreaksEditable:true});
const inspect=bytes=>{const d=api.openDocument(bytes);try{return api.inspectDocument(d,bytes);}finally{d.free();}};
const target=(bytes,b)=>`hwp5:${digest(bytes)}:${Buffer.from(b.id).toString('base64url')}`;
const edit=(bytes,b,op)=>structuralEdit(HwpDocument,bytes,digest(bytes),{target_id:target(bytes,b),expected_old:b.text,...op});
const png=Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=','base64');
function workspace(t){const dir=fs.mkdtempSync(path.join(os.tmpdir(),'hwp-easy-advanced-'));
 t.after(()=>{assert.equal(path.dirname(dir),os.tmpdir());assert.ok(path.basename(dir).startsWith('hwp-easy-advanced-'));fs.rmSync(dir,{recursive:true,force:true});});
 const source=path.join(dir,'문서 with spaces.hwp'),image=path.join(dir,'합성.png');fs.writeFileSync(source,fixture());fs.writeFileSync(image,png);return {dir,source,image};
}
for(const kind of ['paragraph','cell'])test(`format selected ${kind} range including surrogate pair and then remove decorations`,()=>{
 const bytes=fixture({paragraphs:['앞','가😀나 ABC','끝'],cells:[['질문','가😀나 ABC']]}),before=inspect(bytes),block=before.blocks.find(b=>b.kind===kind&&b.text==='가😀나 ABC');
 const props={bold:true,italic:true,underline:true,strikethrough:true,fontSize:1450,textColor:'#AABBCC'};
 const first=edit(bytes,block,{type:'format_text',start:1,end:4,props});assert.equal(first.formatting_changed,true);assert.equal(first.structure_changed,false);assert.equal(props.textColor,'#AABBCC');
 const after=inspect(first.bytes),b=after.blocks.find(b=>b.id===block.id);assert.deepEqual(after.blocks.filter(b=>b.id!==block.id),before.blocks.filter(b=>b.id!==block.id));
 assert.equal(b.text,block.text);assert.deepEqual(b.style.char_runs.map(r=>[r.start,r.end]),[[0,1],[1,4],[4,7]]);
 const second=edit(first.bytes,b,{type:'format_text',start:1,end:4,props:{bold:false,italic:false,underline:false,strikethrough:false}});
 assert.equal(second.raw_preservation_verified,true);
 const mixed=inspect(second.bytes).blocks.find(b=>b.id===block.id);
 assert.equal(edit(second.bytes,mixed,{type:'format_text',start:0,end:7,props:{italic:true}}).raw_preservation_verified,true);
});
for(const kind of ['paragraph','cell'])test(`paragraph formatting changes exact raw properties in ${kind} without changing text`,()=>{
 const bytes=fixture(),before=inspect(bytes),block=before.blocks.find(b=>b.kind===kind&&b.editable);
 const out=edit(bytes,block,{type:'format_paragraph',props:{alignment:'right',lineSpacing:190,marginLeft:150,marginRight:300,indent:-150,spacingBefore:75,spacingAfter:150}});
 const b=inspect(out.bytes).blocks.find(b=>b.id===block.id);assert.equal(b.text,block.text);assert.equal(b.style.paragraph.marginLeft,1);assert.equal(b.style.paragraph.spacingAfter,2);
 assert.equal(b.style.paragraph.alignment,'right');assert.equal(out.raw_preservation_verified,true);
});
for(const extra of [{start:0,end:100,props:{bold:true}},{start:0,end:1,props:{fontFamily:'Bad\nfont'}},{start:0,end:1,props:{fontSize:0}},{start:0,end:1,props:{bold:'true'}}])test(`invalid format request ${JSON.stringify(extra)} remains unsaved`,()=>{
 const bytes=fixture(),block=inspect(bytes).blocks.find(b=>b.text==='中간'||b.text==='중간 합성 문단');assert.throws(()=>edit(bytes,block,{type:'format_text',...extra}),/INVALID_FORMAT/);
});
for(const rows of [1,2])test(`split and merge ${rows}x2 preserves selected cell paragraphs and exact rectangle size`,()=>{
 const original=fixture({cells:[['A','B'],['C','D']]}),d=openDocument(original);d.mergeTableCells(0,1,0,0,0,rows-1,1);const bytes=d.exportHwp();d.free();
 const before=inspect(bytes),t=before.tables[0],b=before.blocks.find(b=>b.kind==='cell'),contents=before.blocks.filter(x=>x.kind==='cell'&&x.cell===b.cell).map(x=>x.text);
 const split=edit(bytes,b,{type:'split_table_cell',expected_cells:[contents]}),model=inspect(split.bytes),cells=model.tables[0].cells.filter(c=>c.row<rows),first=model.blocks.find(b=>b.kind==='cell');
 assert.equal(model.tables[0].dimensions.cellCount,4);assert.deepEqual(model.blocks.filter(b=>b.kind==='cell'&&b.cell===0).map(b=>b.text),contents);
 const merged=edit(split.bytes,first,{type:'merge_table_cells',range:{top:0,left:0,bottom:rows-1,right:1},expected_cells:cells.map(c=>model.blocks.filter(b=>b.kind==='cell'&&b.cell===c.cell).map(b=>b.text))});
 assert.deepEqual(inspect(merged.bytes).blocks.filter(b=>b.kind==='cell'&&b.cell===0).map(b=>b.text),contents);
 assert.deepEqual(inspect(merged.bytes).tables[0],t);
});
test('merge combines nonempty cells as separate paragraphs and confirms every old cell',()=>{
 const bytes=fixture({cells:[['A','B']]}),model=inspect(bytes),b=model.blocks.find(b=>b.kind==='cell');
 assert.throws(()=>edit(bytes,b,{type:'merge_table_cells',range:{top:0,left:0,bottom:0,right:1},expected_cells:[['A'],['wrong']]}),/EXPECTED_TABLE_CELLS_MISMATCH/);
 const out=edit(bytes,b,{type:'merge_table_cells',range:{top:0,left:0,bottom:0,right:1},expected_cells:[['A'],['B']]});
 assert.deepEqual(inspect(out.bytes).blocks.filter(b=>b.kind==='cell').map(b=>b.text),['A','B']);
});
test('split preserves a width remainder and an opaque zero cell word',()=>{
 const d=openDocument(fixture({cells:[['A','B']]}));d.mergeTableCells(0,1,0,0,0,0,1);let bytes=d.exportHwp();d.free();
 bytes=rewriteSyntheticBody(bytes,records=>records.map(r=>{if(r.tag!==72)return r;const payload=r.payload.slice(),v=new DataView(payload.buffer);v.setUint32(16,v.getUint32(16,true)+1,true);v.setUint32(34,v.getUint32(34,true)+1,true);v.setUint16(6,0,true);return {...r,payload};}));
 const before=inspect(bytes),b=before.blocks.find(b=>b.kind==='cell'),out=edit(bytes,b,{type:'split_table_cell',expected_cells:[['A','B']]});
 assert.equal(inspect(out.bytes).tables[0].cells.reduce((n,c)=>n+c.properties.width,0),before.tables[0].cells[0].properties.width);
 const words=[...parseRecords(readHwp(out.bytes).streams.get('BodyText/Section0'))].filter(r=>r.tag===72).map(r=>new DataView(r.payload.buffer,r.payload.byteOffset).getUint16(6,true));assert.deepEqual(words,[0,0]);
});
test('a merge range cutting through an existing merged cell is rejected',()=>{
 const d=openDocument(fixture());d.mergeTableCells(0,1,0,0,0,0,1);const bytes=d.exportHwp();d.free();const b=inspect(bytes).blocks.find(b=>b.kind==='cell');
 assert.throws(()=>edit(bytes,b,{type:'merge_table_cells',range:{top:0,left:0,bottom:1,right:0},expected_cells:[]}),/CELL_RANGE_CROSSES_MERGE/);
});
for(const empty of [false,true])test(`local PNG insert, resize/move, delete, reread and byte restore (empty=${empty})`,async t=>{
 const {source,image}=workspace(t);if(empty)fs.writeFileSync(source,fixture({table:false,paragraphs:['앞','','끝']}));
 const original=fs.readFileSync(source),read=()=>runLocal({action:'read',source,max_chars:64000});let state=await read(),b=state.blocks.find(b=>b.kind==='paragraph'&&(empty?b.text==='':b.text==='중간 합성 문단'));
 const operation={type:'insert_picture',target_id:b.target_id,expected_old:b.text,offset:empty?0:1,width:7200,height:3600,image:{source:image,expected_sha256:digest(png)}};
 const plan=await runLocal({action:'plan',source,expected_sha256:state.source_sha256,operations:[operation]});assert.equal(plan.saved,false);assert.deepEqual(fs.readFileSync(source),original);
 const saved=await runLocal({action:'edit',source,expected_sha256:state.source_sha256,operations:[operation]});state=await read();assert.equal(state.pictures.length,1);
 b=state.blocks.find(b=>b.target_id===state.pictures[0].target_id);
 const update=await runLocal({action:'edit',source,expected_sha256:state.source_sha256,operations:[{type:'update_picture',target_id:b.target_id,expected_old:b.text,expected_properties:state.pictures[0].properties,props:{width:10000,height:5000,horzOffset:-100,vertOffset:200}}]});
 state=await read();assert.equal(state.pictures[0].properties.horzOffset,-100);assert.equal(update.saved_path,source);b=state.blocks.find(b=>b.target_id===state.pictures[0].target_id);
 const removed=await runLocal({action:'edit',source,expected_sha256:state.source_sha256,operations:[{type:'delete_picture',target_id:b.target_id,expected_old:b.text,expected_properties:state.pictures[0].properties}]});
 assert.equal(removed.retained_unused_image_data,true);state=await read();assert.equal(state.pictures.length,0);
 await runLocal({action:'restore',source,expected_sha256:state.source_sha256,backup_id:saved.backup_id});assert.deepEqual(fs.readFileSync(source),original);
});
test('text and paragraph changes in another block preserve the complete existing picture and image stream',async t=>{
 const {source,image}=workspace(t);let state=await runLocal({action:'read',source,max_chars:64000}),b=state.blocks.find(b=>b.text==='중간 합성 문단');
 await runLocal({action:'edit',source,expected_sha256:state.source_sha256,operations:[{type:'insert_picture',target_id:b.target_id,expected_old:b.text,offset:0,width:7200,height:3600,image:{source:image,expected_sha256:digest(png)}}]});
 for(const op of [{type:'replace_text',new_text:'그림 보존 답변'},{type:'format_paragraph',props:{alignment:'center'}}]){state=await runLocal({action:'read',source,max_chars:64000});b=state.blocks.find(b=>b.kind==='cell'&&b.cell===1);
  const saved=await runLocal({action:'edit',source,expected_sha256:state.source_sha256,operations:[{target_id:b.target_id,expected_old:b.text,...op}]});assert.equal(saved.raw_preservation_verified,true);
 }
});
test('invalid PNG CRC, stale image hash and linked image path are refused before saving',async t=>{
 const {source,image,dir}=workspace(t),state=await runLocal({action:'read',source,max_chars:64000}),b=state.blocks.find(b=>b.text==='중간 합성 문단');
 const request=(file,hash)=>({action:'edit',source,expected_sha256:state.source_sha256,operations:[{type:'insert_picture',target_id:b.target_id,expected_old:b.text,offset:0,width:7200,height:3600,image:{source:file,expected_sha256:hash}}]});
 await assert.rejects(runLocal(request(image,'0'.repeat(64))),/VERSION_CONFLICT/);const broken=Buffer.from(png);broken[20]^=1;fs.writeFileSync(image,broken);await assert.rejects(runLocal(request(image,digest(broken))),/INVALID_PNG/);
 const linked=path.join(dir,'linked.png');fs.linkSync(image,linked);await assert.rejects(runLocal(request(linked,digest(broken))),/LINKED_PATH_NOT_ALLOWED/);assert.equal(digest(fs.readFileSync(source)),state.source_sha256);
});
for(const damage of ['paragraph_style','cell_padding'])test(`formatting refuses unrelated ${damage} raw changes`,()=>{
 const bytes=fixture(),b=inspect(bytes).blocks.find(b=>b.text==='중간 합성 문단');let changed=false;
 class DamagedDocument {constructor(input){const d=new HwpDocument(input);return new Proxy(d,{get(target,key){
  if(key==='exportHwpWithReport')return ()=>{const exported=target.exportHwpWithReport();return {contentLoss:()=>exported.contentLoss(),free:()=>exported.free(),takeBytes:()=>rewriteSyntheticBody(exported.takeBytes(),records=>records.map(r=>{
   if(changed||!(damage==='cell_padding'?r.tag===72:r.tag===66))return r;changed=true;const payload=r.payload.slice();payload[damage==='cell_padding'?24:8]^=1;return {...r,payload};
  }))};};const value=target[key];return typeof value==='function'?value.bind(target):value;
 }});}}
 assert.throws(()=>structuralEdit(DamagedDocument,bytes,digest(bytes),{type:'format_text',target_id:target(bytes,b),expected_old:b.text,start:1,end:3,props:{bold:true}}),/MISMATCH/);assert.equal(changed,true);
});
test('PNG insertion refuses an altered raw picture effect',t=>{
 const {image}=workspace(t),bytes=fixture(),b=inspect(bytes).blocks.find(b=>b.text==='중간 합성 문단');let changed=false;
 class DamagedDocument {constructor(input){const d=new HwpDocument(input);return new Proxy(d,{get(target,key){
  if(key==='exportHwpWithReport')return ()=>{const exported=target.exportHwpWithReport();return {contentLoss:()=>exported.contentLoss(),free:()=>exported.free(),takeBytes:()=>rewriteSyntheticBody(exported.takeBytes(),records=>records.map(r=>{
   if(r.tag!==85)return r;changed=true;const payload=r.payload.slice();payload[70]^=1;return {...r,payload};
  }))};};const value=target[key];return typeof value==='function'?value.bind(target):value;
 }});}}
 assert.throws(()=>pictureEdit(DamagedDocument,bytes,digest(bytes),{type:'insert_picture',target_id:target(bytes,b),expected_old:b.text,offset:0,width:7200,height:3600,image:{source:image,expected_sha256:digest(png)}}),/PICTURE_RECORD_MISMATCH/);assert.equal(changed,true);
});
test('a non-square PNG keeps independent natural dimensions and arbitrary display size',t=>{
 const {image}=workspace(t),chunk=(tag,data)=>{const name=Buffer.from(tag),body=Buffer.concat([name,data]);let crc=0xffffffff;
  for(const n of body){crc^=n;for(let i=0;i<8;i++)crc=crc>>>1^((crc&1)?0xedb88320:0);}const size=Buffer.alloc(4),sum=Buffer.alloc(4);size.writeUInt32BE(data.length);sum.writeUInt32BE((crc^0xffffffff)>>>0);return Buffer.concat([size,body,sum]);};
 const ihdr=Buffer.alloc(13);ihdr.writeUInt32BE(2,0);ihdr.writeUInt32BE(3,4);ihdr[8]=8;ihdr[9]=6;
 const generated=Buffer.concat([png.subarray(0,8),chunk('IHDR',ihdr),chunk('IDAT',deflateSync(Buffer.alloc(27))),chunk('IEND',Buffer.alloc(0))]);fs.writeFileSync(image,generated);
 const bytes=fixture(),b=inspect(bytes).blocks.find(b=>b.text==='중간 합성 문단');
 const out=pictureEdit(HwpDocument,bytes,digest(bytes),{type:'insert_picture',target_id:target(bytes,b),expected_old:b.text,offset:2,width:12345,height:6789,image:{source:image,expected_sha256:digest(generated)}});
 assert.equal(out.raw_preservation_verified,true);assert.equal(localPictures(HwpDocument,out.bytes,digest(out.bytes))[0].properties.width,12345);
});
