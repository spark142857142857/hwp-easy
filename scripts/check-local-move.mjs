/** Real isolated package saves, raw artifacts and exact restoration for block moves. */
import fs from 'node:fs';import path from 'node:path';import os from 'node:os';import assert from 'node:assert/strict';import {spawnSync} from 'node:child_process';
import {fixture} from '../tests/rhwp_fixtures.mjs';import {digest} from '../src/one_hwp/local_file.mjs';
const root=process.cwd(),out=process.argv[2]?path.resolve(process.argv[2]):path.join(root,'outputs/local-move-20261011');fs.mkdirSync(out,{recursive:true});
const temporary=fs.mkdtempSync(path.join(os.tmpdir(),'hwp-easy-move-package-')),cases=[];
try{
 const installed=path.join(temporary,'isolated package');fs.cpSync(path.join(root,'outputs/plugin-package/hwp-easy'),installed,{recursive:true});assert.equal(fs.existsSync(path.join(temporary,'node_modules')),false);const runner=path.join(installed,'skills/edit-local-hwp/scripts/local-runner.mjs');
 const call=request=>{const file=path.join(temporary,'request.json');fs.writeFileSync(file,JSON.stringify(request));const r=spawnSync(process.execPath,[runner,'--request',file],{cwd:temporary,encoding:'utf8',timeout:65000,windowsHide:true,maxBuffer:8*1024*1024,env:{...process.env,NODE_PATH:''}});assert.equal(r.status,0,r.stdout);assert.equal(r.stderr,'');const response=JSON.parse(r.stdout);assert.equal(response.ok,true);return response.result;};
 const read=source=>call({action:'read',source,max_chars:64000,max_blocks:128});
 for(const spec of [
  {label:'body_to_end',table:false,from:1,to:4},{label:'body_to_front',table:false,from:4,to:0},{label:'body_middle',table:false,from:3,to:1},{label:'mixed_body',table:false,from:1,to:4,mixed:true},
  {label:'plain_table',table:true},{label:'merged_table',table:true,merged:true},{label:'picture_table',table:true,picture:true},{label:'two_tables',table:true,second:true},
 ]){
  const source=path.join(temporary,spec.label+'.hwp');fs.writeFileSync(source,fixture({table:spec.table,merged:spec.merged,paragraphs:['시작','둘 😀 문장','셋','넷','끝'],cells:[['A','B'],['C','D']]}));let s=read(source);
  const setup=[];if(spec.mixed){const b=s.blocks.find(b=>b.text==='둘 😀 문장');setup.push({type:'format_text',target_id:b.target_id,expected_old:b.text,start:1,end:4,props:{bold:true,textColor:'#AA2255'}});}
  if(spec.picture){const b=s.blocks.find(b=>b.kind==='cell'&&b.text==='A'),image=path.join(temporary,'synthetic.png'),png=Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=','base64');fs.writeFileSync(image,png);setup.push({type:'insert_picture',target_id:b.target_id,expected_old:b.text,offset:0,width:7200,height:3600,image:{source:image,expected_sha256:digest(png)}});}
  if(spec.second){const b=s.blocks.filter(b=>b.kind==='paragraph').at(-2);setup.push({type:'create_table',target_id:b.target_id,expected_old:b.text,cells:[['second','table']]});}
  if(setup.length){call({action:'edit',source,expected_sha256:s.source_sha256,operations:setup});s=read(source);}
  const bodies=s.blocks.filter(b=>b.kind==='paragraph'),b=spec.table?s.blocks.find(b=>b.kind==='cell'):bodies[spec.from],a=spec.table?bodies.at(-1):bodies[spec.to],before=fs.readFileSync(source),operation={type:spec.table?'move_table':'move_paragraph',target_id:b.target_id,expected_old:b.text,after_target_id:a.target_id,expected_after:a.text},request={source,expected_sha256:s.source_sha256,operations:[operation]};
  assert.equal(call({action:'plan',...request}).saved,false);assert.deepEqual(fs.readFileSync(source),before);const saved=call({action:'edit',...request});assert.equal(saved.saved_path,source);assert.equal(saved.saved,true);assert.equal(saved.paragraph_order_changed,true);assert.equal(saved.raw_preservation_verified,true);
  const name='case-'+String(cases.length+1).padStart(3,'0');fs.writeFileSync(path.join(out,name+'-before.hwp'),before);fs.writeFileSync(path.join(out,name+'-after.hwp'),fs.readFileSync(source));cases.push({name,label:spec.label,type:operation.type,from:b.paragraph,after:a.paragraph});
  const after=read(source);call({action:'restore',source,expected_sha256:after.source_sha256,backup_id:saved.backup_id});assert.deepEqual(fs.readFileSync(source),before);
 }
 const report={status:'PASS',cases:cases.length,same_file_saved:true,plan_unsaved:true,restore_exact:true,isolated_package_without_node_modules:true,network_used:false,layout_verified:false};fs.writeFileSync(path.join(out,'cases.json'),JSON.stringify({cases},null,2)+'\n');fs.writeFileSync(path.join(out,'verification.json'),JSON.stringify(report,null,2)+'\n');console.log(JSON.stringify(report));
}finally{assert.equal(path.dirname(temporary),os.tmpdir());assert.ok(path.basename(temporary).startsWith('hwp-easy-move-package-'));fs.rmSync(temporary,{recursive:true,force:true});}
