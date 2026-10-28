import {assertPlannedEdit} from '../../lib/local-plan-proof.mjs';
/** Portable packaged checks; every HWP and image is synthetic. */
import fs from 'node:fs';import path from 'node:path';import os from 'node:os';import assert from 'node:assert/strict';import {spawnSync} from 'node:child_process';
import {HwpDocument,initSync} from '@rhwp/core';import {fixture} from '../../../tests/rhwp_fixtures.mjs';import {fieldFixture,nestedFixture,groupFixture,checkedExport} from '../../../tests/local_complex_fixtures.mjs';import {baselineJpeg} from '../../../tests/local_image_fixtures.mjs';import {digest} from '../../../src/one_hwp/local_file.mjs';
initSync({module:fs.readFileSync('node_modules/@rhwp/core/rhwp_bg.wasm')});
const out=path.resolve(process.argv[2]??'outputs/local-complex-editing-check');assert.equal(fs.existsSync(out),false);fs.mkdirSync(out,{recursive:true});
const temp=fs.mkdtempSync(path.join(os.tmpdir(),'hwp-complex-editing-')),plugin=path.join(temp,'plugin');fs.cpSync('outputs/plugin-package/hwp-easy',plugin,{recursive:true});const runner=path.join(plugin,'skills/edit-local-hwp/scripts/local-runner.mjs'),requestFile=path.join(temp,'request.json'),source=path.join(temp,'selected.hwp'),imagePath=path.join(out,'synthetic.jpg');fs.writeFileSync(imagePath,baselineJpeg);const image={source:imagePath,expected_sha256:digest(baselineJpeg)},cases=[];
function call(request){fs.writeFileSync(requestFile,JSON.stringify(request));const r=spawnSync(process.execPath,[runner,'--request',requestFile],{encoding:'utf8',timeout:65000,windowsHide:true,maxBuffer:8*1024*1024});assert.equal(r.error,undefined);assert.equal(r.stderr,'');const parsed=JSON.parse(r.stdout);assert.equal(parsed.ok,true,JSON.stringify(parsed));return parsed.result;}
const read=()=>call({action:'read',source,max_chars:64000,max_blocks:128});
function trial(name,bytes,choose){
 fs.writeFileSync(source,bytes);const before=read(),operations=choose(before),request={source,expected_sha256:before.source_sha256,operations};fs.writeFileSync(path.join(out,name+'-before.hwp'),bytes);
 const plan=call({action:'plan',...request});assert.equal(plan.saved,false);assert.deepEqual(fs.readFileSync(source),Buffer.from(bytes));
 const saved=call({action:'edit',...request}),after=read(),result=fs.readFileSync(source);assert.equal(saved.saved_path,source);assertPlannedEdit(plan,saved,'check-local-complex-editing');assert.equal(saved.raw_preservation_verified,true);fs.writeFileSync(path.join(out,name+'-after.hwp'),result);
 call({action:'restore',source,expected_sha256:after.source_sha256,backup_id:saved.backup_id});assert.deepEqual(fs.readFileSync(source),Buffer.from(bytes));fs.writeFileSync(path.join(out,name+'-restored.hwp'),bytes);
 cases.push({name,before,after,operations,preview_cache:saved.preview_cache});return result;
}
try{
 for(const depth of [0,2,3]){
  const bytes=depth===0?fixture():depth===2?nestedFixture():nestedFixture(nestedFixture(),{inside_nested:true});
  const created=trial('field-create-'+depth,bytes,s=>{const b=s.blocks.find(b=>(b.cell_path?.length??(b.kind==='cell'?1:0))===depth&&b.text.length>6);return [{type:'insert_field',target_id:b.target_id,expected_old:b.text,offset:3,name:'synthetic-answer',guide:'합성 안내',value:'새 값 😀\n두 번째 줄'}];});
  trial('field-delete-'+depth,created,s=>[{type:'delete_field',target_id:s.fields[0].target_id,expected_old:s.fields[0].value}]);
 }
 for(const depth of [2,3])for(const axis of ['row','column']){
  const bytes=depth===2?nestedFixture():nestedFixture(nestedFixture(),{inside_nested:true}),name='nested-'+depth+'-'+axis;
  const added=trial(name+'-insert',bytes,s=>{const b=s.blocks.find(b=>b.cell_path.length===depth&&b.text==='inner answer 😀');return [{type:'insert_table_'+axis,target_id:b.target_id,expected_old:b.text,index:0,texts:axis==='row'?['new label','new answer 😀']:['new column 😀']}];});
  trial(name+'-delete',added,s=>{const b=s.blocks.find(b=>b.cell_path.length===depth&&b.text==='inner answer 😀'),table=s.tables.find(t=>t.cell_path.length===depth-1),removed=table.cells.filter(c=>c[axis==='row'?'row':'col']===0).map(c=>c.paragraph_ids.map(id=>s.blocks.find(b=>b.id===id).text));return [{type:'delete_table_'+axis,target_id:b.target_id,expected_old:b.text,index:0,expected_cells:removed}];});
 }
 fs.writeFileSync(source,fixture());const initial=read(),cell=initial.blocks.find(b=>b.kind==='cell');call({action:'edit',source,expected_sha256:initial.source_sha256,operations:[{type:'insert_picture',target_id:cell.target_id,expected_old:cell.text,offset:0,image,width:2400,height:1500}]});const pictures=fs.readFileSync(source);
 trial('picture-table-row',pictures,s=>{const p=s.pictures[0],b=s.blocks.find(b=>b.target_id===p.target_id);return [{type:'insert_table_row',target_id:b.target_id,expected_old:b.text,index:0,texts:['new question','new answer']},{type:'update_picture',target_id:b.target_id,expected_old:b.text,picture_index:0,expected_properties:p.properties,props:{cropLeft:75}}];});
 for(const nesting of [false,true]){
  let bytes=groupFixture();if(nesting){const d=new HwpDocument(groupFixture({source:bytes,paragraph:2}));try{assert.equal(JSON.parse(d.groupShapes(JSON.stringify({sectionIdx:0,targets:[{paraIdx:1,controlIdx:0},{paraIdx:2,controlIdx:0}]}))).ok,true);bytes=checkedExport(d);}finally{d.free();}}
  trial('group-leaf-'+nesting,bytes,s=>{const g=s.picture_groups[0],b=s.blocks.find(b=>b.id===g.block_id),{picture_index,...props}=g.pictures[1];return [{type:'replace_group_picture',target_id:g.target_id,expected_old:b.text,picture_index,expected_properties:props,image},{type:'rotate_group_picture',target_id:g.target_id,expected_old:b.text,picture_index,expected_properties:{...props,cropLeft:0,cropTop:0,cropRight:0,cropBottom:0},props:{rotationAngle:90}}].slice(0,nesting?1:2);});
 }
 fs.writeFileSync(path.join(out,'cases.json'),JSON.stringify(cases,null,2)+'\n');const summary={status:'PASS',cases:cases.length,scope:'isolated packaged synthetic complex edits',same_file_save:true,plan_matches_verified_edit_sha256:true,exact_restore:true,runner_sha256:digest(fs.readFileSync(runner)),layout_verified:false};fs.writeFileSync(path.join(out,'summary.json'),JSON.stringify(summary,null,2)+'\n');console.log(JSON.stringify(summary));
}finally{assert.equal(path.dirname(temp),os.tmpdir());assert.ok(path.basename(temp).startsWith('hwp-complex-editing-'));fs.rmSync(temp,{recursive:true,force:true});}
