import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {HwpDocument} from '@rhwp/core';
import {initializeLocal,runLocal} from '../src/one_hwp/local_runner.mjs';
import {createLocalComplexSnapshot,editLocalComplex} from '../src/one_hwp/local_complex.mjs';
import {nestedFixture,fieldFixture,groupFixture,checkedExport} from './local_complex_fixtures.mjs';
import {readHwp} from '../probes/sites-runtime/guard/container.mjs';
import {parseRecords} from '../probes/sites-runtime/guard/records.mjs';
import {packLocalBodyRewrite} from '../probes/sites-runtime/engine/structural-body-repair.mjs';
import {encodeRecords} from '../src/one_hwp/local_complex_records.mjs';
import {createHash} from 'node:crypto';
initializeLocal(fs.readFileSync(new URL('../node_modules/@rhwp/core/rhwp_bg.wasm',import.meta.url)));
const hash=b=>createHash('sha256').update(b).digest('hex');
function workspace(t,bytes){const dir=fs.mkdtempSync(path.join(os.tmpdir(),'hwp-complex-map-'));t.after(()=>{assert.equal(path.dirname(dir),os.tmpdir());assert.ok(path.basename(dir).startsWith('hwp-complex-map-'));fs.rmSync(dir,{recursive:true,force:true});});const source=path.join(dir,'synthetic.hwp');fs.writeFileSync(source,bytes);return source;}
const read=source=>runLocal({action:'read',source,max_chars:64000,max_blocks:128});

for(const isHeader of [true,false])test(`opaque header/footer and repeated text do not shift a nested cell target: header=${isHeader}`,async t=>{
 const doc=new HwpDocument(nestedFixture());let bytes;try{assert.equal(JSON.parse(doc.createHeaderFooter(0,isHeader,0)).ok,true);doc.insertTextInHeaderFooter(0,isHeader,0,0,0,'inner answer 😀');bytes=checkedExport(doc);}finally{doc.free();}
 const source=workspace(t,bytes),before=await read(source),b=before.blocks.find(b=>b.kind==='nested_cell'&&b.text==='inner answer 😀');assert.ok(b?.text_range_editable);assert.equal(before.blocks.filter(b=>b.text==='inner answer 😀').length,1);
 const saved=await runLocal({action:'edit',source,expected_sha256:before.source_sha256,operations:[{type:'replace_text',target_id:b.target_id,expected_old:b.text,new_text:'only selected nested cell'}]});
 const after=await read(source);assert.equal(after.blocks.find(x=>x.id===b.id).text,'only selected nested cell');
 const opaque=raw=>{const rs=[...parseRecords(readHwp(raw).streams.get('BodyText/Section0'))],id=isHeader?'daeh':'toof',at=rs.findIndex(r=>r.tag===71&&Buffer.from(r.payload.subarray(0,4)).toString()===id);assert.ok(at>=0);let end=at+1;while(end<rs.length&&rs[end].level>rs[at].level)end++;return encodeRecords(rs.slice(at,end));};
 assert.deepEqual(opaque(fs.readFileSync(source)),opaque(bytes));await runLocal({action:'restore',source,expected_sha256:after.source_sha256,backup_id:saved.backup_id});assert.deepEqual(fs.readFileSync(source),Buffer.from(bytes));
});

test('unsupported picture-group payload is retained while unrelated body text is edited',async t=>{
 const original=groupFixture(),raw=readHwp(original),records=[...parseRecords(raw.streams.get('BodyText/Section0'))].map(r=>({...r,payload:r.payload.slice()})),picture=records.find(r=>r.tag===85);picture.payload=Buffer.concat([picture.payload,Buffer.from([123])]);
 const bytes=packLocalBodyRewrite(original,raw,new Map([['BodyText/Section0',encodeRecords(records)]])),source=workspace(t,bytes),before=await read(source);
 assert.equal(before.partial_read_only,undefined);assert.deepEqual(before.picture_groups,[]);assert.equal(before.unsupported[0].unhandled_groups,1);
 const b=before.blocks.find(b=>b.text==='end');assert.ok(b.text_range_editable);
 const saved=await runLocal({action:'edit',source,expected_sha256:before.source_sha256,operations:[{type:'replace_text',target_id:b.target_id,expected_old:b.text,new_text:'edited around opaque group'}]});
 const drawings=value=>[...parseRecords(readHwp(value).streams.get('BodyText/Section0'))].filter(r=>[71,76,85].includes(r.tag)).map(r=>({tag:r.tag,level:r.level,payload:r.payload}));assert.deepEqual(drawings(fs.readFileSync(source)),drawings(bytes));
 const after=await read(source);await runLocal({action:'restore',source,expected_sha256:after.source_sha256,backup_id:saved.backup_id});assert.deepEqual(fs.readFileSync(source),Buffer.from(bytes));
});

test('upstream text mismatch exposes no target and cannot be used to bypass checks',()=>{
 class MismatchDocument extends HwpDocument{getTextRange(section,paragraph,start,end){const result=super.getTextRange(section,paragraph,start,end);return paragraph===0?result+'?':result;}}
 const bytes=fieldFixture(),version=hash(bytes),state=createLocalComplexSnapshot(MismatchDocument,bytes,version).read({expected_sha256:version,max_chars:64000}),b=state.blocks[0];
 assert.equal(b.text_mapping_verified,false);assert.equal(b.target_id,null);assert.equal(b.text_range_editable,false);assert.equal(b.read_only_reason,'TARGET_TEXT_UNVERIFIED');assert.ok(state.blocks.find(b=>b.text==='untouched').text_range_editable);
 const forged=`hwp5:${version}:${Buffer.from(b.id).toString('base64url')}`;
 assert.throws(()=>editLocalComplex(MismatchDocument,bytes,version,{type:'replace_text',target_id:forged,expected_old:b.text,new_text:'must refuse'}),/TARGET_NOT_EDITABLE/);
});

for(const depth of [0,2,3])test(`paragraph formatting changes only the selected definition reference and keeps recovery exact: depth=${depth}`,async t=>{
 const bytes=depth===0?fieldFixture({mixed:true}):depth===2?nestedFixture():nestedFixture(nestedFixture(),{inside_nested:true}),source=workspace(t,bytes),before=await read(source),b=before.blocks.find(b=>b.cell_path.length===depth&&(depth===0?b.kind==='paragraph':b.text==='inner answer 😀'));
 assert.ok(b.paragraph_format_editable);const props={alignment:'center',lineSpacing:180,marginLeft:300,marginRight:450,indent:-150,spacingBefore:75,spacingAfter:150},op={type:'format_paragraph',target_id:b.target_id,expected_old:b.text,props};
 const plan=await runLocal({action:'plan',source,expected_sha256:before.source_sha256,operations:[op]});assert.equal(plan.saved,false);assert.deepEqual(fs.readFileSync(source),Buffer.from(bytes));
 const result=await runLocal({action:'edit',source,expected_sha256:before.source_sha256,operations:[op]}),after=await read(source),selected=after.blocks.find(x=>x.id===b.id);assert.equal(result.paragraph_formatting_changed,true);
 assert.deepEqual(after.blocks.map(x=>x.text),before.blocks.map(x=>x.text));for(const [key,value]of Object.entries(props))assert.equal(selected.paragraph_properties[key],value);
 for(const old of before.blocks)if(old.id!==b.id)assert.deepEqual(after.blocks.find(x=>x.id===old.id).paragraph_properties,old.paragraph_properties);
 const rawBefore=readHwp(bytes),rawAfter=readHwp(fs.readFileSync(source));for(const [name,value]of rawBefore.streams)if(!['DocInfo','PrvText','PrvImage'].includes(name)&&!name.startsWith('BodyText/'))assert.deepEqual(rawAfter.streams.get(name),value);
 const defs=raw=>[...parseRecords(raw.streams.get('DocInfo'))].filter(r=>r.tag!==17).map(r=>({tag:r.tag,level:r.level,payload:r.payload})),oldDefs=defs(rawBefore),newDefs=defs(rawAfter);let index=0;for(const record of oldDefs){const found=newDefs.findIndex((x,i)=>i>=index&&x.tag===record.tag&&x.level===record.level&&Buffer.from(x.payload).equals(Buffer.from(record.payload)));assert.ok(found>=index);index=found+1;}
 const controls=raw=>[...parseRecords(raw.streams.get('BodyText/Section0'))].filter(r=>![66,69].includes(r.tag)).map(r=>({tag:r.tag,level:r.level,payload:r.payload}));assert.deepEqual(controls(rawAfter),controls(rawBefore));
 const changed=fs.readFileSync(source),backupCount=fs.readdirSync(path.join(path.dirname(source),'.hwp-easy-backups')).length;
 const noOp=await runLocal({action:'edit',source,expected_sha256:after.source_sha256,operations:[{...op,target_id:selected.target_id}]});assert.equal(noOp.saved,false);assert.deepEqual(fs.readFileSync(source),changed);assert.equal(fs.readdirSync(path.join(path.dirname(source),'.hwp-easy-backups')).length,backupCount);
 await runLocal({action:'restore',source,expected_sha256:after.source_sha256,backup_id:result.backup_id});assert.deepEqual(fs.readFileSync(source),Buffer.from(bytes));
});

test('invalid or stale paragraph formatting batches leave the file and backup directory unchanged',async t=>{
 const bytes=nestedFixture(),source=workspace(t,bytes),before=await read(source),b=before.blocks.find(b=>b.kind==='nested_cell');
 for(const props of [{alignment:'unknown'},{lineSpacing:0},{indent:-72001},{fontSize:1200}])await assert.rejects(runLocal({action:'edit',source,expected_sha256:before.source_sha256,operations:[{type:'format_paragraph',target_id:b.target_id,expected_old:b.text,props}]}),/INVALID_FORMAT_PROPERTIES/);
 await assert.rejects(runLocal({action:'edit',source,expected_sha256:before.source_sha256,operations:[{type:'format_paragraph',target_id:b.target_id,expected_old:b.text,props:{alignment:'right'}},{type:'replace_text',target_id:b.target_id,expected_old:'stale',new_text:'refuse'}]}),/EXPECTED_OLD_MISMATCH/);
 assert.deepEqual(fs.readFileSync(source),Buffer.from(bytes));assert.equal(fs.existsSync(path.join(path.dirname(source),'.hwp-easy-backups')),false);
});
