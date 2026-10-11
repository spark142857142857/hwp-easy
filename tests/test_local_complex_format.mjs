import test from 'node:test';import assert from 'node:assert/strict';import fs from 'node:fs';import os from 'node:os';import path from 'node:path';
import CFB from '../probes/sites-runtime/node_modules/cfb/cfb.js';
import {HwpDocument} from '@rhwp/core';
import {initializeLocal,runLocal} from '../src/one_hwp/local_runner.mjs';
import {fieldFixture,nestedFixture,groupFixture,checkedExport} from './local_complex_fixtures.mjs';
import {readHwp,readCfb} from '../probes/sites-runtime/guard/container.mjs';
import {parseRecords} from '../probes/sites-runtime/guard/records.mjs';
import {encodeRecords,view} from '../src/one_hwp/local_complex_records.mjs';
initializeLocal(fs.readFileSync(new URL('../node_modules/@rhwp/core/rhwp_bg.wasm',import.meta.url)));
function workspace(t,bytes){const dir=fs.mkdtempSync(path.join(os.tmpdir(),'hwp-complex-format-'));t.after(()=>{assert.equal(path.dirname(dir),os.tmpdir());assert.ok(path.basename(dir).startsWith('hwp-complex-format-'));fs.rmSync(dir,{recursive:true,force:true});});const source=path.join(dir,'synthetic.hwp');fs.writeFileSync(source,bytes);return {source,dir};}
const read=source=>runLocal({action:'read',source,max_chars:64000});
const format=(target,props,start=0,end=[...(target.value??target.text)].length)=>({type:'format_text',target_id:target.target_id,expected_old:target.value??target.text,start,end,props});
const edit=(source,state,operations)=>runLocal({action:'edit',source,expected_sha256:state.source_sha256,operations});
function preserved(a,z){const old=readCfb(a),now=readCfb(z);assert.deepEqual([...now.keys()].sort(),[...old.keys()].sort());for(const [name,value] of old)if(name!=='DocInfo'&&!name.startsWith('BodyText/'))assert.deepEqual(now.get(name),value);
 const defs=bytes=>[...parseRecords(readHwp(bytes).streams.get('DocInfo'))];const before=defs(a),after=defs(z);
 for(const r of before.filter(r=>![17,19,21].includes(r.tag)))assert.ok(after.some(s=>s.tag===r.tag&&s.level===r.level&&Buffer.from(s.payload).equals(Buffer.from(r.payload))));
 const controls=bytes=>[...parseRecords(readHwp(bytes).streams.get('BodyText/Section0'))].filter(r=>![66,68,69].includes(r.tag)).map(r=>({tag:r.tag,level:r.level,payload:r.payload}));assert.deepEqual(controls(z),controls(a));
}
for(const cell of [false,true])for(const mixed of [false,true])test(`field character formatting retains mixed definitions and field anchors: cell=${cell}, mixed=${mixed}`,async t=>{
 const {source}=workspace(t,fieldFixture({cell,mixed,multiple:true})),original=fs.readFileSync(source),state=await read(source),f=state.fields[0];
 const props={italic:true,underline:true,strikethrough:true,fontSize:1250,textColor:'#123456',fontFamily:'Synthetic Font'};
 const op=format(f,props),plan=await runLocal({action:'plan',source,expected_sha256:state.source_sha256,operations:[op]});assert.equal(plan.saved,false);assert.deepEqual(fs.readFileSync(source),original);
 const saved=await edit(source,state,[op]),after=await read(source),b=after.blocks.find(b=>b.id===f.block_id);assert.equal(saved.formatting_changed,true);assert.equal(after.fields[0].value,f.value);assert.equal(after.fields[1].value,state.fields[1].value);
 const runs=b.style.character_runs.filter(r=>r.start<f.end&&r.end>f.start);assert.equal(runs.length,mixed?(cell?3:2):1);
 for(const r of runs){for(const [k,v] of Object.entries(props))if(k==='fontFamily')assert.deepEqual(r.properties.fontFamilies,Array(7).fill(v));else assert.equal(r.properties[k],v);}
 assert.equal(runs.some(r=>r.properties.bold),mixed);assert.equal(runs.at(-1).properties.bold,false);preserved(original,fs.readFileSync(source));
 await runLocal({action:'restore',source,expected_sha256:after.source_sha256,backup_id:saved.backup_id});assert.deepEqual(fs.readFileSync(source),original);
});
for(const depth of [2,3])test(`format nested cell at depth ${depth}; preserve sibling cells and table topology`,async t=>{
 const {source}=workspace(t,depth===2?nestedFixture():nestedFixture(nestedFixture(),{inside_nested:true})),original=fs.readFileSync(source),state=await read(source),b=state.blocks.find(b=>b.cell_path.length===depth&&b.text==='inner answer 😀');
 await edit(source,state,[format(b,{bold:true,fontSize:1600},6,14)]);const after=await read(source),saved=after.blocks.find(x=>x.id===b.id);assert.equal(saved.character_format_editable,true);assert.equal(saved.style.character_runs.at(-1).properties.bold,true);assert.deepEqual(saved.cell_path,b.cell_path);
 for(const other of state.blocks)if(other.id!==b.id)assert.deepEqual(after.blocks.find(x=>x.id===other.id).style,other.style);preserved(original,fs.readFileSync(source));
});
test('format body text in a grouped-picture document preserves every group transform and JPEG',async t=>{
 const {source}=workspace(t,groupFixture()),original=fs.readFileSync(source),state=await read(source),b=state.blocks.find(b=>b.text==='group host');await edit(source,state,[format(b,{textColor:'#AABBCC'},1,5)]);const after=await read(source);
 assert.deepEqual(after.picture_groups.map(g=>({...g,target_id:null})),state.picture_groups.map(g=>({...g,target_id:null})));assert.equal(after.blocks[0].style.character_runs.find(r=>r.start===1).properties.textColor,'#aabbcc');preserved(original,fs.readFileSync(source));
});
test('set a multiline field, format an emoji/line-break range and edit again in one atomic save',async t=>{
 const {source}=workspace(t,fieldFixture({multiple:true})),original=fs.readFileSync(source),state=await read(source),f=state.fields[0],other=state.fields[1],new_text='앞😀\n\n뒤';
 const result=await edit(source,state,[{type:'set_field',target_id:f.target_id,expected_old:f.value,new_text},format({...f,value:new_text},{bold:true,fontSize:1400},1,4),{type:'set_field',target_id:other.target_id,expected_old:other.value,new_text:'second answer'}]);
 assert.equal(result.atomic_batch,true);assert.equal(result.formatting_changed,true);const after=await read(source);assert.equal(after.fields[0].value,new_text);const b=after.blocks.find(b=>b.id===f.block_id),run=b.style.character_runs.find(r=>r.start===f.start+1);assert.equal(run.end,f.start+4);assert.equal(run.properties.bold,true);
 await runLocal({action:'restore',source,expected_sha256:after.source_sha256,backup_id:result.backup_id});assert.deepEqual(fs.readFileSync(source),original);
});
test('field in a nested cell formats by its own relative offsets',async t=>{
 const doc=new HwpDocument(nestedFixture());let bytes;try{const p=JSON.stringify([{controlIndex:0,cellIndex:0,cellParaIndex:0},{controlIndex:0,cellIndex:1,cellParaIndex:0}]),f=JSON.parse(doc.insertClickHereFieldByPath(0,1,p,6,'guide','memo','nested',true));doc.setFieldValue(f.fieldId,'nested 😀');bytes=checkedExport(doc);}finally{doc.free();}
 const {source}=workspace(t,bytes),state=await read(source),f=state.fields[0];await edit(source,state,[format(f,{underline:true},7,8)]);const after=await read(source),b=after.blocks.find(b=>b.id===f.block_id);assert.equal(b.style.character_runs.find(r=>r.start===f.start+7).properties.underline,true);preserved(bytes,fs.readFileSync(source));
});
test('repeated formatting is byte-exact no-op; clearing flags reuses original definitions',async t=>{
 const {source,dir}=workspace(t,fieldFixture()),state=await read(source),f=state.fields[0];await edit(source,state,[format(f,{bold:true,italic:true,underline:true,strikethrough:true})]);let after=await read(source);const bytes=fs.readFileSync(source),backups=fs.readdirSync(path.join(dir,'.hwp-easy-backups'));
 const result=await edit(source,after,[format(after.fields[0],{bold:true,italic:true,underline:true,strikethrough:true})]);assert.equal(result.saved,false);assert.deepEqual(fs.readFileSync(source),bytes);assert.deepEqual(fs.readdirSync(path.join(dir,'.hwp-easy-backups')),backups);
 await edit(source,after,[format(after.fields[0],{bold:false,italic:false,underline:false,strikethrough:false})]);after=await read(source);const b=after.blocks.find(b=>b.id===f.block_id);assert.ok(b.style.character_runs.every(r=>!r.properties.bold&&!r.properties.italic&&!r.properties.underline&&!r.properties.strikethrough));
});
test('stale last operation after formatting prevents writes and recovery artifacts',async t=>{
 const {source,dir}=workspace(t,fieldFixture({multiple:true})),state=await read(source),bytes=fs.readFileSync(source);await assert.rejects(edit(source,state,[format(state.fields[0],{fontFamily:'Synthetic New'}),{type:'set_field',target_id:state.fields[1].target_id,expected_old:'stale',new_text:'reject'}]),/EXPECTED_OLD_MISMATCH/);assert.deepEqual(fs.readFileSync(source),bytes);assert.equal(fs.existsSync(path.join(dir,'.hwp-easy-backups')),false);
});
for(const [label,props,start,end,error] of [
 ['empty properties',{},0,1,'INVALID_FORMAT_PROPERTIES'],['unknown property',{border:true},0,1,'INVALID_FORMAT_PROPERTIES'],['string boolean',{bold:'true'},0,1,'INVALID_FORMAT_PROPERTIES'],['too small font',{fontSize:99},0,1,'INVALID_FORMAT_PROPERTIES'],['bad color',{textColor:'red'},0,1,'INVALID_FORMAT_PROPERTIES'],['bad font list',{fontFamily:'Arial, serif'},0,1,'INVALID_FORMAT_PROPERTIES'],['empty range',{bold:true},0,0,'INVALID_FORMAT_RANGE'],['negative range',{bold:true},-1,1,'INVALID_FORMAT_RANGE'],['out of range',{bold:true},0,999,'INVALID_FORMAT_RANGE']
])test(`invalid ${label} never changes the file`,async t=>{
 const {source,dir}=workspace(t,fieldFixture()),state=await read(source),bytes=fs.readFileSync(source);await assert.rejects(edit(source,state,[format(state.fields[0],props,start,end)]),new RegExp(error));assert.deepEqual(fs.readFileSync(source),bytes);assert.equal(fs.existsSync(path.join(dir,'.hwp-easy-backups')),false);
});
test('ordinary block formatting cannot cross field/control anchors',async t=>{
 const {source}=workspace(t,fieldFixture()),state=await read(source),bytes=fs.readFileSync(source);await assert.rejects(edit(source,state,[format(state.blocks[0],{bold:true})]),/TEXT_RANGE_CROSSES_CONTROL/);assert.deepEqual(fs.readFileSync(source),bytes);
});
test('existing font name reuses all language definitions; repeated font is exact no-op',async t=>{
 const {source}=workspace(t,fieldFixture()),state=await read(source),f=state.fields[0],raw=readHwp(fs.readFileSync(source)),fonts=[...parseRecords(raw.streams.get('DocInfo'))].filter(r=>r.tag===19),name=Buffer.from(fonts[1].payload.subarray(3,3+view(fonts[1].payload).getUint16(1,true)*2)).toString('utf16le');
 const oldCount=fonts.length;await edit(source,state,[format(f,{fontFamily:name,bold:true})]);const after=await read(source),bytes=fs.readFileSync(source);assert.equal([...parseRecords(readHwp(bytes).streams.get('DocInfo'))].filter(r=>r.tag===19).length,oldCount);
 const result=await edit(source,after,[format(after.fields[0],{fontFamily:name,bold:true})]);assert.equal(result.unchanged,true);assert.deepEqual(fs.readFileSync(source),bytes);
});
test('tabs are controls and cannot be selected for character formatting',async t=>{
 const d=new HwpDocument(fieldFixture());let bytes;try{d.setFieldValue(JSON.parse(d.getFieldList())[0].fieldId,'a\tb');bytes=checkedExport(d);}finally{d.free();}
 const {source}=workspace(t,bytes),state=await read(source);await assert.rejects(edit(source,state,[format(state.fields[0],{bold:true},1,2)]),/FORMAT_TARGET_HAS_CONTROLS/);assert.deepEqual(fs.readFileSync(source),Buffer.from(bytes));
});
test('uncompressed DocInfo grows past mini-stream boundary and preserves opaque streams',async t=>{
 const input=fieldFixture(),raw=readHwp(input),packed=readCfb(input),tree=CFB.read(Buffer.from(input),{type:'buffer'});
 for(const [name,value] of raw.streams){const entry=CFB.find(tree,'/'+name);entry.content=Buffer.from(value);entry.size=value.length;}
 const header=CFB.find(tree,'/FileHeader').content;header.writeUInt32LE(header.readUInt32LE(36)&~1,36);
 const defs=[...parseRecords(raw.streams.get('DocInfo'))].filter(r=>r.tag!==32),extra={tag:94,level:0,payload:Buffer.alloc(3980-encodeRecords(defs).length-4,37)};const info=CFB.find(tree,'/DocInfo');info.content=encodeRecords([...defs,extra]);info.size=info.content.length;
 CFB.utils.cfb_add(tree,'Opaque/private',Buffer.alloc(8700,63));CFB.utils.cfb_add(tree,'Opaque/empty',Buffer.alloc(0)).start=-2;const bytes=new Uint8Array(CFB.write(tree,{type:'buffer'}));assert.ok(readCfb(bytes).get('DocInfo').length<4096);
 const {source}=workspace(t,bytes),state=await read(source);await edit(source,state,[format(state.fields[0],{fontFamily:'Synthetic font '+ 'x'.repeat(70),fontSize:1200})]);assert.ok(readCfb(fs.readFileSync(source)).get('DocInfo').length>=4096);preserved(bytes,fs.readFileSync(source));assert.ok(packed.size>0);
});
