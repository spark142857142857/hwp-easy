import test from 'node:test';import assert from 'node:assert/strict';import fs from 'node:fs';import os from 'node:os';import path from 'node:path';
import {initializeLocal,runLocal} from '../src/one_hwp/local_runner.mjs';
import {fieldFixture,nestedFixture} from './local_complex_fixtures.mjs';
import {progressiveJpeg} from './local_image_fixtures.mjs';
import {readHwp,readCfb} from '../probes/sites-runtime/guard/container.mjs';
import {parseRecords} from '../probes/sites-runtime/guard/records.mjs';
import {digest} from '../src/one_hwp/local_file.mjs';
initializeLocal(fs.readFileSync(new URL('../node_modules/@rhwp/core/rhwp_bg.wasm',import.meta.url)));
const png=Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=','base64');
function workspace(t,bytes){const dir=fs.mkdtempSync(path.join(os.tmpdir(),'hwp-complex-pic-'));t.after(()=>{assert.equal(path.dirname(dir),os.tmpdir());assert.ok(path.basename(dir).startsWith('hwp-complex-pic-'));fs.rmSync(dir,{recursive:true,force:true});});const source=path.join(dir,'synthetic.hwp');fs.writeFileSync(source,bytes);const images=[['first.jpg',progressiveJpeg],['second.png',png]].map(([name,bytes])=>{const source=path.join(dir,name);fs.writeFileSync(source,bytes);return {source,expected_sha256:digest(bytes)};});return {source,images,dir};}
const read=source=>runLocal({action:'read',source,max_chars:64000,max_blocks:128});
const controls=bytes=>[...parseRecords(readHwp(bytes).streams.get('BodyText/Section0'))].filter(r=>[71,72,76,77,85,87].includes(r.tag)).map(r=>({tag:r.tag,level:r.level,payload:Buffer.from(r.payload)}));

for(const depth of [0,1,2,3])test(`complex pictures keep fields, nested paths and exact recovery: depth=${depth}`,async t=>{
 const original=depth===0?fieldFixture({multiple:true,mixed:true}):depth===3?nestedFixture(nestedFixture(),{inside_nested:true}):nestedFixture(),{source,images}=workspace(t,original);let state=await read(source);const block=state.blocks.find(b=>b.cell_path.length===depth&&(depth===0?b.kind==='paragraph':depth===1?b.kind==='cell':b.text==='inner answer 😀'));
 const fields=state.fields.map(f=>[f.name,f.guide,f.value]),texts=state.blocks.map(b=>[b.id,b.text]);let first;
 const edit=async op=>{state=await read(source);const b=state.blocks.find(b=>b.id===block.id),request={source,expected_sha256:state.source_sha256,operations:[{type:op.type,target_id:b.target_id,expected_old:b.text,...op}]};const prior=fs.readFileSync(source);assert.equal((await runLocal({action:'plan',...request})).saved,false);assert.deepEqual(fs.readFileSync(source),prior);const saved=await runLocal({action:'edit',...request});first??=saved;state=await read(source);assert.deepEqual(state.blocks.map(b=>[b.id,b.text]),texts);assert.deepEqual(state.fields.map(f=>[f.name,f.guide,f.value]),fields);return saved;};
 await edit({type:'insert_picture',offset:[...block.text].length,image:images[0],width:3600,height:1800});assert.equal(state.pictures.length,1);
 const initial=state.pictures[0];assert.equal(initial.properties.treatAsChar,true);assert.equal(initial.cell_path.length,depth);
 const preview=await runLocal({action:'preview',source,expected_sha256:state.source_sha256,page:0});assert.match(preview.svg,/data:image\/jpeg;base64,/);
 await edit({type:'update_picture',picture_index:0,expected_properties:initial.properties,props:{cropLeft:75,rotationAngle:90}});assert.equal(state.pictures[0].properties.rotationAngle,90);assert.equal(state.pictures[0].properties.cropLeft,75);
 await edit({type:'replace_picture',picture_index:0,expected_properties:state.pictures[0].properties,image:images[1]});assert.equal(state.pictures[0].properties.sourceWidth,75);assert.equal(state.pictures[0].properties.cropLeft,0);
 await edit({type:'insert_picture',offset:0,image:images[0],width:1800,height:900});assert.equal(state.pictures.length,2);
 const untouched=state.pictures[0];await edit({type:'delete_picture',picture_index:1,expected_properties:state.pictures[1].properties});assert.equal(state.pictures.length,1);assert.deepEqual(state.pictures[0].properties,untouched.properties);
 const old=readCfb(original),now=readCfb(fs.readFileSync(source));for(const [name,value]of old)if(!['DocInfo','BodyText/Section0','PrvText','PrvImage'].includes(name))assert.deepEqual(now.get(name),value);
 await runLocal({action:'restore',source,expected_sha256:state.source_sha256,backup_id:first.backup_id});assert.deepEqual(fs.readFileSync(source),Buffer.from(original));assert.deepEqual(controls(fs.readFileSync(source)),controls(original));
});

test('invalid final operation after picture insertion publishes neither candidate nor backup',async t=>{
 const original=fieldFixture(),{source,images,dir}=workspace(t,original),before=await read(source),b=before.blocks[1];
 const operations=[{type:'insert_picture',target_id:b.target_id,expected_old:b.text,offset:0,image:images[0],width:3600,height:1800},{type:'replace_text',target_id:b.target_id,expected_old:'stale',new_text:'reject'}];
 await assert.rejects(runLocal({action:'edit',source,expected_sha256:before.source_sha256,operations}),/EXPECTED_OLD_MISMATCH/);assert.deepEqual(fs.readFileSync(source),Buffer.from(original));assert.equal(fs.existsSync(path.join(dir,'.hwp-easy-backups')),false);
});
