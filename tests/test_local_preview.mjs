import test from 'node:test';import assert from 'node:assert/strict';import fs from 'node:fs';import os from 'node:os';import path from 'node:path';
import {fixture} from './rhwp_fixtures.mjs';import {runLocal} from '../src/one_hwp/local_runner.mjs';import {readCfb} from '../probes/sites-runtime/guard/container.mjs';import {bitmap24,localPreviewText} from '../src/one_hwp/local_preview_cache.mjs';import {digest} from '../src/one_hwp/local_file.mjs';
import childProcess from 'node:child_process';import {syncBuiltinESMExports} from 'node:module';
import {patchLocalPackedStreams} from '../src/one_hwp/local_container_write.mjs';

test('empty CFB streams remain valid across a subsequent allocation rewrite',()=>{
 const original=fixture(),empty=patchLocalPackedStreams(original,new Map([['PrvImage',Buffer.alloc(0)],['PrvText',Buffer.alloc(0)]]));
 const streams=readCfb(empty);assert.equal(streams.get('PrvImage').length,0);assert.equal(streams.get('PrvText').length,0);
 const again=patchLocalPackedStreams(empty,new Map([['PrvText',Buffer.from('new preview','utf16le')]]));
 for(const [name,value]of streams)if(name!=='PrvText')assert.equal(digest(readCfb(again).get(name)),digest(value),name);
});

test('a renderer timeout clears stale image, keeps a valid edited HWP and predicts its exact saved hash',async t=>{
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'hwp-preview-failure-'));t.after(()=>{assert.equal(path.dirname(dir),os.tmpdir());assert.ok(path.basename(dir).startsWith('hwp-preview-failure-'));fs.rmSync(dir,{recursive:true,force:true});});
 const source=path.join(dir,'synthetic.hwp'),original=fixture();fs.writeFileSync(source,original);
 const state=await runLocal({action:'read',source}),b=state.blocks.find(x=>x.text==='중간 합성 문단'),request={source,expected_sha256:state.source_sha256,operations:[{type:'replace_text',target_id:b.target_id,expected_old:b.text,new_text:'renderer failure still saves verified content'}]};
 const spawn=childProcess.spawnSync;let saved;
 childProcess.spawnSync=()=>({status:null,error:Object.assign(Error('injected timeout'),{code:'ETIMEDOUT'})});syncBuiltinESMExports();
 try{
  const plan=await runLocal({action:'plan',...request});assert.equal(digest(fs.readFileSync(source)),digest(original));
  saved=await runLocal({action:'edit',...request});assert.equal(plan.output_sha256,saved.output_sha256);
 }finally{childProcess.spawnSync=spawn;syncBuiltinESMExports();}
 assert.equal(saved.preview_cache.status,'text_updated_image_unavailable');assert.equal(saved.preview_cache.image_failure,'RENDER_TIMEOUT');
 const streams=readCfb(fs.readFileSync(source));assert.equal(streams.get('PrvImage').length,0);assert.ok(Buffer.from(streams.get('PrvText')).toString('utf16le').includes(request.operations[0].new_text));
 const after=await runLocal({action:'read',source});assert.ok(after.blocks.some(x=>x.text===request.operations[0].new_text));
 await runLocal({action:'restore',source,expected_sha256:after.source_sha256,backup_id:saved.backup_id});assert.equal(digest(fs.readFileSync(source)),digest(original));
});
test('derived BMP has independent Windows bitmap row order, BGR channels and padded stride',()=>{
 const b=bitmap24(Uint8Array.from([255,0,0,255,0,255,0,255,0,0,255,255,255,255,255,255]),2,2);
 assert.equal(b.readUInt32LE(2),70);assert.equal(b.readUInt32LE(10),54);assert.equal(b.readUInt16LE(28),24);assert.equal(b.readUInt32LE(30),0);
 assert.deepEqual([...b.subarray(54,62)],[255,0,0,255,255,255,0,0]);assert.deepEqual([...b.subarray(62)],[0,0,255,0,255,0,0,0]);
});
test('preview text truncation keeps UTF-16 surrogate pairs intact',()=>{const text=localPreviewText(fixture({table:false,paragraphs:['가'.repeat(4095)+'😀','끝']}));assert.ok(text.length<=4096);assert.equal(text.isWellFormed(),true);assert.equal(text.endsWith('\uD83D'),false);});
test('two same-file saves after regenerated BMP preserve scripts, options, metadata and exact recovery',async t=>{
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'hwp-preview-test-'));t.after(()=>{assert.equal(path.dirname(dir),os.tmpdir());assert.ok(path.basename(dir).startsWith('hwp-preview-test-'));fs.rmSync(dir,{recursive:true,force:true});});
 const source=path.join(dir,'synthetic.hwp'),original=fixture();fs.writeFileSync(source,original);let state=await runLocal({action:'read',source}),b=state.blocks.find(x=>x.text==='중간 합성 문단');
 const first=await runLocal({action:'edit',source,expected_sha256:state.source_sha256,operations:[{type:'replace_text',target_id:b.target_id,expected_old:b.text,new_text:'새 한국어 본문'}]});assert.equal(first.preview_cache.status,'updated');
 state=await runLocal({action:'read',source});b=state.blocks.find(x=>x.text==='새 한국어 본문');const second=await runLocal({action:'edit',source,expected_sha256:state.source_sha256,operations:[{type:'insert_paragraphs',target_id:b.target_id,expected_old:b.text,paragraphs:['두 번째 저장']}]}),streams=readCfb(fs.readFileSync(source));
 assert.equal(second.preview_cache.status,'updated');for(const [name,value]of readCfb(original))if(!name.startsWith('BodyText/')&&!['DocInfo','PrvText','PrvImage'].includes(name))assert.equal(digest(streams.get(name)),digest(value),name);
 assert.ok(Buffer.from(streams.get('PrvText')).toString('utf16le').includes('두 번째 저장'));const bmp=Buffer.from(streams.get('PrvImage'));assert.equal(bmp.subarray(0,2).toString(),'BM');assert.ok(bmp.readInt32LE(18)<=180&&bmp.readInt32LE(22)<=180);
 const reread=await runLocal({action:'read',source}),target=reread.blocks.find(x=>x.text==='새 한국어 본문'),unchanged=await runLocal({action:'edit',source,expected_sha256:reread.source_sha256,operations:[{type:'replace_text',target_id:target.target_id,expected_old:target.text,new_text:target.text}]});assert.equal(unchanged.saved,false);assert.equal(digest(fs.readFileSync(source)),second.output_sha256);assert.equal(unchanged.preview_cache.status,'unchanged');
 await runLocal({action:'restore',source,expected_sha256:second.output_sha256,backup_id:first.backup_id});assert.equal(digest(fs.readFileSync(source)),digest(original));
});
