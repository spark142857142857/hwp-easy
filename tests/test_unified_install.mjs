import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {pluginFiles,sha256} from '../packages/hwp-easy/lib/plugin.mjs';
import {createAgentPackage} from '../packages/hwp-easy/lib/agent-package.mjs';
import {inspectSkill,installSkill} from '../packages/hwp-easy/lib/agent-skill.mjs';
import {manageInstallation} from '../packages/hwp-easy/lib/install.mjs';

async function fixture(t,client='cursor') {
 const root=await fs.mkdtemp(path.join(os.tmpdir(),'hwp-easy-unified-test-'));
 t.after(async()=>{assert.equal(path.dirname(root),os.tmpdir());assert.match(path.basename(root),/^hwp-easy-unified-test-/);await fs.rm(root,{recursive:true,force:true});});
 async function plugin(version){
  const output=path.join(root,'plugin-'+version);await fs.mkdir(output);
  for(const name of pluginFiles){await fs.mkdir(path.dirname(path.join(output,name)),{recursive:true});await fs.writeFile(path.join(output,name),'synthetic '+name);}
  await fs.writeFile(path.join(output,'plugin.json'),JSON.stringify({name:'hwp-easy',version,extensions:{'com.openai':{requires_local_executor:true}}}));
  await fs.writeFile(path.join(output,'skills/edit-local-hwp/SKILL.md'),'---\nname: edit-local-hwp\ndescription: synthetic\n---\nRead references before editing.\n');
  await fs.writeFile(path.join(output,'skills/edit-local-hwp/agents/openai.yaml'),'policy:\n  allow_implicit_invocation: false\n');
  const hash=async name=>sha256(await fs.readFile(path.join(output,'skills/edit-local-hwp/scripts',name)));
  await fs.writeFile(path.join(output,'build-manifest.json'),JSON.stringify({package:'hwp-easy',version,
   runner_sha256:await hash('local-runner.mjs'),wasm_sha256:await hash('rhwp_bg.wasm'),
   local_preview:{renderer:{wasm_sha256:await hash('resvg_bg.wasm')},font:{sha256:await hash('NanumGothic-Regular.ttf')}}}));
  return output;
 }
 const payload=await plugin('0.5.1'),skillsRoot=path.join(root,'client '+client,'skills'),dataDir=path.join(root,'data');
 const options={payload,client,skillsRoot,dataDir,run:async()=>{throw Error('Codex must not run for this client');}};
 async function old(){const source=path.join(root,'old-skill');await createAgentPackage(await plugin('0.2.19'),client,source);return installSkill(source,client,skillsRoot);}
 return {root,payload,skillsRoot,dataDir,options,old,target:path.join(skillsRoot,'hwp-easy'),backups:path.resolve(skillsRoot,'..','hwp-easy-install-backups')};
}

test('both app clients install without Codex and retain explicit invocation and identical engine bytes',async t=>{
 for(const client of ['claude-code','cursor']) {
  const f=await fixture(t,client),result=await manageInstallation(f.options);
  assert.equal(result.status,'INSTALLED');assert.equal(result.client,client);assert.equal(result.version,'0.5.1');
  const manifest=await inspectSkill(result.skill_path,client);
  assert.equal(manifest.runner_sha256,sha256(await fs.readFile(path.join(f.payload,'skills/edit-local-hwp/scripts/local-runner.mjs'))));
  assert.match(await fs.readFile(path.join(result.skill_path,'SKILL.md'),'utf8'),/disable-model-invocation: true/);
  assert.equal((await manageInstallation(f.options)).status,'UNCHANGED');
  assert.equal((await manageInstallation({...f.options,command:'status'})).version,'0.5.1');
  assert.deepEqual((await fs.readdir(f.backups)).filter(n=>n.startsWith('.staging-')),[]);
 }
});

test('both clients update old packages and restore each previous version without duplicate discovery',async t=>{
 for(const client of ['claude-code','cursor']) {
  const f=await fixture(t,client);await f.old();
  const updated=await manageInstallation({...f.options,command:'update'});
  assert.equal(updated.previous_version,'0.2.19');assert.equal(updated.version,'0.5.1');
  assert.equal((await manageInstallation({...f.options,command:'rollback'})).version,'0.2.19');
  assert.equal((await manageInstallation({...f.options,command:'rollback'})).version,'0.5.1');
  assert.deepEqual(await fs.readdir(f.skillsRoot),['hwp-easy']);
 }
});

test('publication failure restores old skill and leaves unrelated settings and skills intact',async t=>{
 const f=await fixture(t);await f.old();const sibling=path.join(f.skillsRoot,'unrelated');await fs.mkdir(sibling);await fs.writeFile(path.join(sibling,'keep.txt'),'keep');
 const rename=fs.rename;let fail=true;
 fs.rename=async(from,to)=>{if(fail&&from.includes('.staging-')&&to===f.target){fail=false;throw Error('injected replacement failure');}return rename(from,to);};
 try{await assert.rejects(manageInstallation({...f.options,command:'update'}),/previous skill installation restored/);}finally{fs.rename=rename;}
 assert.equal((await inspectSkill(f.target,'cursor')).version,'0.2.19');assert.equal(await fs.readFile(path.join(sibling,'keep.txt'),'utf8'),'keep');
});

test('journal failure after replacement also restores the previous skill',async t=>{
 const f=await fixture(t);await f.old();const rename=fs.rename;let fail=true;
 fs.rename=async(from,to)=>{if(fail&&to.endsWith('state.json')){fail=false;throw Error('injected journal failure');}return rename(from,to);};
 try{await assert.rejects(manageInstallation({...f.options,command:'update'}),/previous skill installation restored/);}finally{fs.rename=rename;}
 assert.equal((await inspectSkill(f.target,'cursor')).version,'0.2.19');
 assert.ok((await fs.readdir(f.backups)).some(n=>n.startsWith('failed-')));
});

test('concurrent target survives recovery and the previous installation remains preserved',async t=>{
 const f=await fixture(t);await f.old();const rename=fs.rename;
 fs.rename=async(from,to)=>{if(from.includes('.staging-')&&to===f.target){await fs.mkdir(to);await fs.writeFile(path.join(to,'concurrent.txt'),'keep');throw Error('concurrent install');}return rename(from,to);};
 try{await assert.rejects(manageInstallation({...f.options,command:'update'}),/recovery failed/);}finally{fs.rename=rename;}
 assert.equal(await fs.readFile(path.join(f.target,'concurrent.txt'),'utf8'),'keep');
 const saved=(await fs.readdir(f.backups)).find(n=>n.startsWith('hwp-easy-0.2.19-'));assert.ok(saved);
 assert.equal((await inspectSkill(path.join(f.backups,saved),'cursor')).version,'0.2.19');
});

test('changed backups and linked roots are refused without replacing an installed skill',async t=>{
 const f=await fixture(t);await f.old();const updated=await manageInstallation({...f.options,command:'update'});
 await fs.writeFile(path.join(updated.previous_installation,'scripts/local-runner.mjs'),'bad');
 await assert.rejects(manageInstallation({...f.options,command:'rollback'}),/hash mismatch/);
 assert.equal((await inspectSkill(f.target,'cursor')).version,'0.5.1');
 const linked=path.join(f.root,'linked-skills');await fs.symlink(f.skillsRoot,linked,process.platform==='win32'?'junction':'dir');
 await assert.rejects(manageInstallation({...f.options,skillsRoot:linked,command:'update'}),/Linked/);
});

test('unknown app, implicit invocation and changed engine are rejected',async t=>{
 const f=await fixture(t);
 await assert.rejects(manageInstallation({...f.options,client:'unknown'}),/Unknown/);
 await fs.writeFile(path.join(f.payload,'skills/edit-local-hwp/agents/openai.yaml'),'policy:\n  allow_implicit_invocation: true\n');
 await assert.rejects(manageInstallation(f.options),/Explicit-only/);
 await fs.writeFile(path.join(f.payload,'skills/edit-local-hwp/agents/openai.yaml'),'policy:\n  allow_implicit_invocation: false\n');
 await fs.writeFile(path.join(f.payload,'skills/edit-local-hwp/scripts/local-runner.mjs'),'changed');
 await assert.rejects(manageInstallation(f.options),/hash mismatch/);
 assert.equal((await manageInstallation({...f.options,command:'status'})).status,'NOT_INSTALLED');
});
