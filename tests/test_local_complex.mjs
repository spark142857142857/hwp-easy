import test from 'node:test';import assert from 'node:assert/strict';import fs from 'node:fs';import os from 'node:os';import path from 'node:path';
import {HwpDocument} from '@rhwp/core';
import {initializeLocal,runLocal} from '../src/one_hwp/local_runner.mjs';
import {fieldFixture,nestedFixture,groupFixture,checkedExport} from './local_complex_fixtures.mjs';
import {readHwp} from '../src/one_hwp/guard/container.mjs';import {parseRecords} from '../src/one_hwp/guard/records.mjs';
initializeLocal(fs.readFileSync(new URL('../node_modules/@rhwp/core/rhwp_bg.wasm',import.meta.url)));
function workspace(t,bytes){const dir=fs.mkdtempSync(path.join(os.tmpdir(),'hwp-complex-'));t.after(()=>{assert.equal(path.dirname(dir),os.tmpdir());assert.ok(path.basename(dir).startsWith('hwp-complex-'));fs.rmSync(dir,{recursive:true,force:true});});const source=path.join(dir,'synthetic.hwp');fs.writeFileSync(source,bytes);return {source,dir};}
const read=source=>runLocal({action:'read',source,max_chars:64000});
const edit=(source,state,op)=>runLocal({action:'edit',source,expected_sha256:state.source_sha256,operations:[op]});
for(const cell of [false,true])for(const mixed of [false,true])test(`named field value in ${cell?'cell':'body'}, mixed=${mixed}: exact anchors and recovery`,async t=>{
 const {source}=workspace(t,fieldFixture({cell,mixed,multiple:true})),original=fs.readFileSync(source),state=await read(source);assert.equal(state.fields.length,2);
 const f=state.fields[0];assert.equal(f.editable,true);const op={type:'set_field',target_id:f.target_id,expected_old:f.value,new_text:'새 답변 🚀 longer'};
 const plan=await runLocal({action:'plan',source,expected_sha256:state.source_sha256,operations:[op]});assert.equal(plan.saved,false);assert.deepEqual(fs.readFileSync(source),original);
 const saved=await edit(source,state,op),after=await read(source);assert.equal(saved.selected_file_updated,true);assert.equal(after.fields[0].value,op.new_text);assert.deepEqual(after.fields[1],{...state.fields[1],target_id:after.fields[1].target_id});
 const old=readHwp(original),now=readHwp(fs.readFileSync(source));for(const [n,v] of old.streams)if(!n.startsWith('BodyText/')&&!['PrvText','PrvImage'].includes(n))assert.deepEqual(now.streams.get(n),v);
 const controlRecords=raw=>[...parseRecords(raw.streams.get('BodyText/Section0'))].filter(r=>![66,67,68,69].includes(r.tag)).map(r=>({tag:r.tag,level:r.level,payload:r.payload}));assert.deepEqual(controlRecords(now),controlRecords(old));
 await runLocal({action:'restore',source,expected_sha256:after.source_sha256,backup_id:saved.backup_id});assert.deepEqual(fs.readFileSync(source),original);
});
for(const value of ['','😀','가'.repeat(6000)])test(`field clearing and variable-length value: ${value.length} UTF-16 units`,async t=>{
 const {source}=workspace(t,fieldFixture()),state=await read(source),f=state.fields[0];await edit(source,state,{type:'set_field',target_id:f.target_id,expected_old:f.value,new_text:value});const after=await read(source);assert.equal(after.fields[0].value,value);assert.equal(after.fields[0].editable,true);
});
test('recursive nested cells are fully mapped, searched and edited without touching table headers',async t=>{
 const {source}=workspace(t,nestedFixture()),state=await read(source);assert.equal(state.target_mapping_verified,true);const b=state.blocks.find(b=>b.kind==='nested_cell'&&b.text==='inner answer 😀');assert.equal(b.cell_path.length,2);assert.equal(b.text_range_editable,true);
 const search=await runLocal({action:'find',source,expected_sha256:state.source_sha256,query:'answer'});assert.equal(search.matches.length,1);assert.deepEqual(search.matches[0].cell_path,b.cell_path);
 const original=fs.readFileSync(source),saved=await edit(source,state,{type:'splice_text',target_id:b.target_id,expected_old:b.text,start:6,end:12,new_text:'response 🚀'}),after=await read(source);assert.equal(after.blocks.find(x=>x.id===b.id).text,'inner response 🚀 😀');
 const tables=bytes=>[...parseRecords(readHwp(bytes).streams.get('BodyText/Section0'))].filter(r=>[71,72,77].includes(r.tag)).map(r=>({tag:r.tag,level:r.level,payload:r.payload}));assert.deepEqual(tables(fs.readFileSync(source)),tables(original));
 await runLocal({action:'restore',source,expected_sha256:after.source_sha256,backup_id:saved.backup_id});assert.deepEqual(fs.readFileSync(source),original);
});
test('field inside nested cell selects its exact field boundary',async t=>{
 const doc=new HwpDocument(nestedFixture());let bytes;try{const p=JSON.stringify([{controlIndex:0,cellIndex:0,cellParaIndex:0},{controlIndex:0,cellIndex:1,cellParaIndex:0}]);const f=JSON.parse(doc.insertClickHereFieldByPath(0,1,p,6,'nested guide','memo','nested',true));doc.setFieldValue(f.fieldId,'nested value');bytes=checkedExport(doc);}finally{doc.free();}
 const {source}=workspace(t,bytes),state=await read(source),f=state.fields[0];assert.equal(f.cell_path.length,2);assert.equal(f.editable,true);await edit(source,state,{type:'set_field',target_id:f.target_id,expected_old:f.value,new_text:'변경 😀'});assert.equal((await read(source)).fields[0].value,'변경 😀');
});
test('three table levels distinguish duplicate answers by full recursive path',async t=>{
 const {source}=workspace(t,nestedFixture(nestedFixture(),{inside_nested:true})),state=await read(source),b=state.blocks.find(b=>b.cell_path.length===3&&b.text==='inner answer 😀');assert.ok(b);
 await edit(source,state,{type:'replace_text',target_id:b.target_id,expected_old:b.text,new_text:'deep answer'});const after=await read(source);assert.equal(after.blocks.find(x=>x.id===b.id).text,'deep answer');assert.ok(after.blocks.some(x=>x.cell_path.length===2&&x.text==='inner answer 😀'));
});
test('nested drawing groups crop one of four leaves without flattening either group',async t=>{
 const first=groupFixture(),second=groupFixture({source:first,paragraph:2}),d=new HwpDocument(second);let bytes;
 try{assert.equal(JSON.parse(d.groupShapes(JSON.stringify({sectionIdx:0,targets:[{paraIdx:1,controlIdx:0},{paraIdx:2,controlIdx:0}]}))).ok,true);bytes=checkedExport(d);}finally{d.free();}
 const {source}=workspace(t,bytes),state=await read(source),g=state.picture_groups[0];assert.equal(g.pictures.length,4);const {picture_index,...p}=g.pictures[2];
 const original=fs.readFileSync(source);await edit(source,state,{type:'crop_group_picture',target_id:g.target_id,expected_old:state.blocks.find(b=>b.id===g.block_id).text,picture_index,expected_properties:p,props:{cropRight:150}});
 assert.equal((await read(source)).picture_groups[0].pictures[2].cropRight,150);
 const components=bytes=>[...parseRecords(readHwp(bytes).streams.get('BodyText/Section0'))].filter(r=>r.tag===76).map(r=>({level:r.level,payload:r.payload}));assert.deepEqual(components(fs.readFileSync(source)),components(original));
});
test('two grouped JPEGs retain child transforms and bytes through group move and selected crop',async t=>{
 const {source}=workspace(t,groupFixture()),state=await read(source),g=state.picture_groups[0];assert.equal(g.pictures.length,2);
 const original=fs.readFileSync(source),saved=await edit(source,state,{type:'move_picture_group',target_id:g.target_id,expected_old:state.blocks.find(b=>b.id===g.block_id).text,expected_properties:g.properties,props:{horzOffset:500,vertOffset:200}}),moved=await read(source),group=moved.picture_groups[0];assert.equal(group.properties.horzOffset,500);assert.deepEqual(group.pictures,g.pictures);
 const {picture_index,...props}=group.pictures[1];await edit(source,moved,{type:'crop_group_picture',target_id:group.target_id,expected_old:moved.blocks.find(b=>b.id===g.block_id).text,picture_index,expected_properties:props,props:{cropLeft:75,cropBottom:150}});
 const after=await read(source);assert.equal(after.picture_groups[0].pictures[1].cropLeft,75);assert.deepEqual(after.picture_groups[0].pictures[0],g.pictures[0]);
 const old=readHwp(original),now=readHwp(fs.readFileSync(source));for(const [n,v] of old.streams)if(!n.startsWith('BodyText/')&&!['PrvText','PrvImage'].includes(n))assert.deepEqual(now.streams.get(n),v);
 const shapes=raw=>[...parseRecords(raw.streams.get('BodyText/Section0'))].filter(r=>r.tag===76).map(r=>r.payload);assert.deepEqual(shapes(now),shapes(old));
 await runLocal({action:'restore',source,expected_sha256:after.source_sha256,backup_id:saved.backup_id});assert.deepEqual(fs.readFileSync(source),original);
});
test('complex batch publishes once; stale final field prevents all writes and backups',async t=>{
 const {source,dir}=workspace(t,fieldFixture({multiple:true})),state=await read(source),original=fs.readFileSync(source),f=state.fields[0],other=state.fields[1];const operations=[{type:'set_field',target_id:f.target_id,expected_old:f.value,new_text:'changed'},{type:'set_field',target_id:other.target_id,expected_old:'stale',new_text:'reject'}];
 await assert.rejects(runLocal({action:'edit',source,expected_sha256:state.source_sha256,operations}),/EXPECTED_OLD_MISMATCH/);assert.deepEqual(fs.readFileSync(source),original);assert.equal(fs.existsSync(path.join(dir,'.hwp-easy-backups')),false);
 operations[1].expected_old=other.value;const result=await runLocal({action:'edit',source,expected_sha256:state.source_sha256,operations});assert.equal(result.atomic_batch,true);assert.equal(result.operation_count,2);assert.deepEqual((await read(source)).fields.map(f=>f.value),['changed','reject']);
});
test('field anchors cannot be crossed through a plain text operation',async t=>{
 const {source}=workspace(t,fieldFixture()),state=await read(source),b=state.blocks[0],original=fs.readFileSync(source);
 await assert.rejects(edit(source,state,{type:'replace_text',target_id:b.target_id,expected_old:b.text,new_text:'erase all'}),/TEXT_RANGE_CROSSES_CONTROL/);assert.deepEqual(fs.readFileSync(source),original);
 for(const value of ['line\rbreak','tab\tvalue','\u0000','\ud800'])await assert.rejects(edit(source,state,{type:'set_field',target_id:state.fields[0].target_id,expected_old:state.fields[0].value,new_text:value}),/INVALID_EDIT_TEXT/);
 assert.deepEqual(fs.readFileSync(source),original);
});

for(const cell of [false,true])for(const mixed of [false,true])test(`field line breaks keep one paragraph and all surrounding anchors: cell=${cell}, mixed=${mixed}`,async t=>{
 const {source}=workspace(t,fieldFixture({cell,mixed,multiple:true})),original=fs.readFileSync(source),before=await read(source),f=before.fields[0];
 const value='지원 동기 😀\n경험과 결과\n향후 계획';
 const result=await edit(source,before,{type:'set_field',target_id:f.target_id,expected_old:f.value,new_text:value}),after=await read(source);
 assert.equal(after.fields[0].value,value);assert.equal(after.fields[0].editable,true);assert.equal(after.blocks.length,before.blocks.length);assert.equal(result.paragraph_count_changed,false);assert.equal(result.line_break_mode,'hwp_character_10_within_same_paragraph');assert.equal(after.fields[1].value,before.fields[1].value);
 const group=b=>[...parseRecords(readHwp(b).streams.get('BodyText/Section0'))];const old=group(original),now=group(fs.readFileSync(source));assert.equal(old.filter(r=>r.tag===66).length,now.filter(r=>r.tag===66).length);
 const unchanged=rs=>rs.filter(r=>![66,67,68,69].includes(r.tag)).map(r=>({tag:r.tag,level:r.level,payload:r.payload}));assert.deepEqual(unchanged(old),unchanged(now));
 const host=after.blocks.findIndex(b=>b.id===f.block_id),header=now.filter(r=>r.tag===66)[host];assert.equal(new DataView(header.payload.buffer,header.payload.byteOffset).getUint32(4,true)&1024,1024);
 await runLocal({action:'restore',source,expected_sha256:after.source_sha256,backup_id:result.backup_id});assert.deepEqual(fs.readFileSync(source),original);
});

for(const depth of [2,3])test(`nested cell line breaks retain all table levels and text outside selected cell: depth=${depth}`,async t=>{
 const bytes=depth===2?nestedFixture():nestedFixture(nestedFixture(),{inside_nested:true});const {source}=workspace(t,bytes),before=await read(source),b=before.blocks.find(b=>b.cell_path.length===depth&&b.text==='inner answer 😀');
 await edit(source,before,{type:'splice_text',target_id:b.target_id,expected_old:b.text,start:6,end:12,new_text:'첫 줄\n둘째 😀\n셋째'});const after=await read(source);assert.equal(after.blocks.length,before.blocks.length);assert.equal(after.blocks.find(x=>x.id===b.id).text,'inner 첫 줄\n둘째 😀\n셋째 😀');assert.deepEqual(after.blocks.find(x=>x.id===b.id).cell_path,b.cell_path);
 for(const old of before.blocks)if(old.id!==b.id)assert.equal(after.blocks.find(x=>x.id===old.id).text,old.text);
 const tables=b=>[...parseRecords(readHwp(b).streams.get('BodyText/Section0'))].filter(r=>[71,72,77].includes(r.tag)).map(r=>({tag:r.tag,level:r.level,payload:r.payload}));assert.deepEqual(tables(fs.readFileSync(source)),tables(bytes));
});

for(const value of ['\n','\nfirst\n\nlast\n',Array(100).fill('line').join('\n')])test(`field empty and boundary lines remain readable: ${value.split('\n').length} lines`,async t=>{
 const {source}=workspace(t,fieldFixture()),before=await read(source),f=before.fields[0];await edit(source,before,{type:'set_field',target_id:f.target_id,expected_old:f.value,new_text:value});const after=await read(source);assert.equal(after.fields[0].value,value);assert.equal(after.fields[0].editable,true);
 const unchanged=fs.readFileSync(source);await assert.rejects(edit(source,after,{type:'set_field',target_id:after.fields[0].target_id,expected_old:value,new_text:Array(101).fill('x').join('\n')}),/INVALID_LINE_COUNT/);assert.deepEqual(fs.readFileSync(source),unchanged);
});

test('clearing a field removes its LF mask only when no other line break remains',async t=>{
 const d=new HwpDocument(fieldFixture());let bytes;try{const f=JSON.parse(d.getFieldList())[0];d.setFieldValue(f.fieldId,'line A\nline B');bytes=checkedExport(d);}finally{d.free();}
 const {source}=workspace(t,bytes);let before=await read(source),f=before.fields[0];await edit(source,before,{type:'set_field',target_id:f.target_id,expected_old:f.value,new_text:''});let after=await read(source);assert.equal(after.fields[0].value,'');const mask=b=>{const h=[...parseRecords(readHwp(b).streams.get('BodyText/Section0'))].find(r=>r.tag===66);return new DataView(h.payload.buffer,h.payload.byteOffset).getUint32(4,true);};assert.equal(mask(fs.readFileSync(source)),mask(bytes)&~1024);
 const outside=new HwpDocument(bytes);try{outside.insertText(0,0,0,'outside\n');fs.writeFileSync(source,checkedExport(outside));}finally{outside.free();}
 before=await read(source);f=before.fields[0];await edit(source,before,{type:'set_field',target_id:f.target_id,expected_old:f.value,new_text:'one line'});after=await read(source);assert.equal(after.fields[0].value,'one line');assert.ok(after.blocks[0].text.startsWith('outside\n'));assert.equal(mask(fs.readFileSync(source))&1024,1024);
});
test('editing prefix and suffix next to a field preserves both boundaries and field value',async t=>{
 const {source}=workspace(t,fieldFixture());let state=await read(source),b=state.blocks[0],f=state.fields[0];await edit(source,state,{type:'splice_text',target_id:b.target_id,expected_old:b.text,start:0,end:f.start,new_text:'new prefix '});
 state=await read(source);assert.equal(state.fields[0].value,f.value);assert.equal(state.fields[0].start,11);b=state.blocks[0];f=state.fields[0];await edit(source,state,{type:'splice_text',target_id:b.target_id,expected_old:b.text,start:f.end,end:[...b.text].length,new_text:' new suffix'});assert.equal((await read(source)).fields[0].value,f.value);
});
test('unchanged field value leaves bytes, timestamps and recovery directory unchanged',async t=>{
 const {source,dir}=workspace(t,fieldFixture()),state=await read(source),f=state.fields[0],before=fs.statSync(source),bytes=fs.readFileSync(source);
 const result=await edit(source,state,{type:'set_field',target_id:f.target_id,expected_old:f.value,new_text:f.value});assert.equal(result.saved,false);assert.equal(result.unchanged,true);assert.equal(fs.statSync(source).mtimeMs,before.mtimeMs);assert.deepEqual(fs.readFileSync(source),bytes);assert.equal(fs.existsSync(path.join(dir,'.hwp-easy-backups')),false);
});
test('complex read/search cursors preserve recursive identities and reject stale or invalid positions',async t=>{
 const {source}=workspace(t,nestedFixture()),whole=await read(source);let cursor,fragments=[];
 do{const page=await runLocal({action:'read',source,max_chars:3,max_blocks:2,...(cursor?{cursor}:{})});fragments.push(...page.blocks);cursor=page.next_cursor;}while(cursor);
 for(const b of whole.blocks)assert.equal(fragments.filter(f=>f.id===b.id).map(f=>f.text).join(''),b.text);
 const state=await runLocal({action:'read',source,max_chars:3,max_blocks:2});for(const cursor of [{...state.next_cursor,offset:-1},{...state.next_cursor,block_index:9999},{...state.next_cursor,extra:true}])await assert.rejects(runLocal({action:'read',source,cursor}),/INVALID_CURSOR/);
 await assert.rejects(runLocal({action:'read',source,cursor:{...state.next_cursor,sha256:'0'.repeat(64)}}),/CURSOR_VERSION_CONFLICT/);
});
test('group bounds, stale properties and unknown changes cannot alter a file',async t=>{
 const {source}=workspace(t,groupFixture()),state=await read(source),g=state.picture_groups[0],original=fs.readFileSync(source),b=state.blocks.find(b=>b.id===g.block_id),{picture_index,...p}=g.pictures[0];
 for(const props of [{cropLeft:p.sourceWidth},{cropTop:-1},{rotationAngle:90}])await assert.rejects(edit(source,state,{type:'crop_group_picture',target_id:g.target_id,expected_old:b.text,picture_index,expected_properties:p,props}),/INVALID_PICTURE_CROP/);
 await assert.rejects(edit(source,state,{type:'move_picture_group',target_id:g.target_id,expected_old:b.text,expected_properties:{...g.properties,width:1},props:{horzOffset:10}}),/EXPECTED_GROUP_MISMATCH/);assert.deepEqual(fs.readFileSync(source),original);
});
