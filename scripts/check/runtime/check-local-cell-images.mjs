import {assertPlannedEdit} from '../../lib/local-plan-proof.mjs';
/** Isolated shipped runner: cell picture/group projection, strict saving and recovery. */
import fs from 'node:fs';import path from 'node:path';import os from 'node:os';import assert from 'node:assert/strict';import {spawnSync} from 'node:child_process';import {initSync} from '@rhwp/core';
import {cellImageFixture,cellImageProfiles} from '../../../tests/local_cell_image_fixtures.mjs';import {digest} from '../../../src/one_hwp/local_file.mjs';
initSync({module:fs.readFileSync('node_modules/@rhwp/core/rhwp_bg.wasm')});
const out=path.resolve(process.argv[2]??'outputs/local-cell-images');assert.equal(fs.existsSync(out),false);fs.mkdirSync(out,{recursive:true});
const temp=fs.mkdtempSync(path.join(os.tmpdir(),'hwp-cell-images-package-')),pkg=path.join(temp,'package');fs.cpSync('outputs/plugin-package/hwp-easy',pkg,{recursive:true});const runner=path.join(pkg,'skills/edit-local-hwp/scripts/local-runner.mjs'),manifest=JSON.parse(fs.readFileSync(path.join(pkg,'build-manifest.json'))),cases=[];let sequence=0,refusals=0;
assert.equal(digest(fs.readFileSync(runner)),manifest.runner_sha256);
function invoke(request){const file=path.join(out,`request-${++sequence}.json`);fs.writeFileSync(file,JSON.stringify(request));const r=spawnSync(process.execPath,[runner,'--request',file],{cwd:temp,encoding:'utf8',timeout:65000,windowsHide:true,maxBuffer:8*1024*1024});assert.equal(r.error,undefined);assert.equal(r.stderr,'');const value=JSON.parse(r.stdout);fs.writeFileSync(path.join(out,`response-${sequence}.json`),JSON.stringify(value,null,2)+'\n');return value;}
const call=req=>{const r=invoke(req);assert.equal(r.ok,true,JSON.stringify(r));return r.result;},read=source=>call({action:'read',source,max_chars:64000,max_blocks:128});
const selected=(s,options)=>options.group?s.picture_groups[0]:s.pictures[0];
const move=(s,options,transfer=false)=>{const o=selected(s,options),host=s.blocks.find(b=>b.id===o.block_id),dest=s.blocks.find(b=>b.cell_path.length===2);return {type:'reposition_floating_object',target_id:options.group?o.target_id:host.target_id,expected_old:host.text,expected_properties:o.properties,expected_flow:o.flow,clearance:150,...(transfer?{destination_target_id:dest.target_id,expected_destination:dest.text}:{})};};

try{
 for(const [index,options]of cellImageProfiles.entries()){
  const name='cell-image-'+index,source=path.join(temp,name+'.hwp'),bytes=Buffer.from(cellImageFixture(options));fs.writeFileSync(source,bytes);const before=read(source),operations=[move(before,options,options.bodySource)],request={source,expected_sha256:before.source_sha256,operations,layout_policy:'reject_new_risk'},plan=call({action:'plan',...request});assert.equal(plan.saved,false);assert.ok(fs.readFileSync(source).equals(bytes));
  const saved=call({action:'edit',...request}),after=read(source);assert.equal(saved.saved_path,source);assertPlannedEdit(plan,saved,'check-local-cell-images');assert.equal(saved.floating_state_preserved,true);assert.deepEqual(saved.layout_diagnostics.new_issues,[]);assert.deepEqual(selected(after,options).flow,selected(before,options).flow);fs.writeFileSync(path.join(out,name+'-before.hwp'),bytes);fs.copyFileSync(source,path.join(out,name+'-after.hwp'));
  const noop=call({action:'edit',source,expected_sha256:after.source_sha256,operations:[move(after,options)],layout_policy:'reject_new_risk'});assert.equal(noop.saved,false);
  call({action:'restore',source,expected_sha256:after.source_sha256,backup_id:saved.backup_id});assert.ok(fs.readFileSync(source).equals(bytes));fs.copyFileSync(source,path.join(out,name+'-restored.hwp'));cases.push({name,options,before,after,operations,verification:saved});
 }
 fs.writeFileSync(path.join(out,'cases.json'),JSON.stringify(cases,null,2)+'\n');const summary={status:'PASS',cases:cases.length,strict_same_file_save:true,plan_matches_verified_edit_sha256:true,exact_restore:true,no_op_no_save:true,refusals_before_save:refusals,runner_sha256:manifest.runner_sha256,layout_verified:false};fs.writeFileSync(path.join(out,'summary.json'),JSON.stringify(summary,null,2)+'\n');console.log(JSON.stringify(summary));
}finally{assert.equal(path.dirname(temp),os.tmpdir());assert.ok(path.basename(temp).startsWith('hwp-cell-images-package-'));fs.rmSync(temp,{recursive:true,force:true});}
