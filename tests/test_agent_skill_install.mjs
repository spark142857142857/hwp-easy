import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import {createHash} from 'node:crypto';
import {inspectSkill,installSkill,updateSkill} from '../scripts/install_agent_skill.mjs';

const sha=value=>createHash('sha256').update(value).digest('hex');
async function fixture(t) {
 const directory=await fs.mkdtemp(path.join(os.tmpdir(),'hwp-easy-skill-test-'));
 t.after(async()=>{assert.equal(path.dirname(directory),os.tmpdir());assert.ok(path.basename(directory).startsWith('hwp-easy-skill-test-'));await fs.rm(directory,{recursive:true,force:true});});
 const source=path.join(directory,'package');await fs.mkdir(source);
 const files={'SKILL.md':'---\nname: hwp-easy\ndescription: synthetic\ndisable-model-invocation: true\n---\nRead references.\n',
  'agents/openai.yaml':'policy:\n  allow_implicit_invocation: false\n','references/requests.md':'request contract','references/editing.md':'recovery contract',
  'scripts/local-runner.mjs':'synthetic JS','scripts/rhwp_bg.wasm':'synthetic WASM'};
 const manifest={package:'hwp-easy',version:'0.2.18',distribution:{type:'agent_skill',client:'cursor',skill_name:'hwp-easy',explicit_only:true},files:{}};
 async function update(name,value) {await fs.mkdir(path.dirname(path.join(source,name)),{recursive:true});await fs.writeFile(path.join(source,name),value);manifest.files[name]=sha(value);}
 for(const [name,value]of Object.entries(files))await update(name,value);
 manifest.runner_sha256=manifest.files['scripts/local-runner.mjs'];manifest.wasm_sha256=manifest.files['scripts/rhwp_bg.wasm'];
 const save=()=>fs.writeFile(path.join(source,'build-manifest.json'),JSON.stringify(manifest));await save();
 return {source,parent:path.join(directory,'skills'),manifest,update,save};
}
test('installs checked files into the client skill location without changing settings',async t=>{
 const f=await fixture(t),result=await installSkill(f.source,'cursor',f.parent);
 assert.equal(result.skill_path,path.join(f.parent,'hwp-easy'));assert.equal(result.host_settings_changed,false);assert.equal(result.server_registered,false);
 assert.equal(await fs.readFile(path.join(result.skill_path,'scripts/local-runner.mjs'),'utf8'),'synthetic JS');
});
test('preserves an existing skill and its user content',async t=>{
 const f=await fixture(t),existing=path.join(f.parent,'hwp-easy');await fs.mkdir(existing,{recursive:true});await fs.writeFile(path.join(existing,'keep.txt'),'keep');
 await assert.rejects(installSkill(f.source,'cursor',f.parent),{code:'EEXIST'});assert.equal(await fs.readFile(path.join(existing,'keep.txt'),'utf8'),'keep');
});
test('rejects a package for a different host before creating a destination',async t=>{
 const f=await fixture(t);await assert.rejects(installSkill(f.source,'claude-code',f.parent),/identity/);await assert.rejects(fs.stat(f.parent),{code:'ENOENT'});
});
test('rejects runtime byte changes before installing',async t=>{
 const f=await fixture(t);await fs.writeFile(path.join(f.source,'scripts/local-runner.mjs'),'changed');
 await assert.rejects(installSkill(f.source,'cursor',f.parent),/hash mismatch/);await assert.rejects(fs.stat(f.parent),{code:'ENOENT'});
});
test('rejects automatic invocation even when the package hashes are consistent',async t=>{
 const f=await fixture(t);await f.update('SKILL.md','---\nname: hwp-easy\ndisable-model-invocation: false\n---\n');await f.save();
 await assert.rejects(installSkill(f.source,'cursor',f.parent),/Explicit-only/);await assert.rejects(fs.stat(f.parent),{code:'ENOENT'});
});
test('retains explicit-only Codex policy for the personal skill',async t=>{
 const f=await fixture(t);await f.update('agents/openai.yaml','policy:\n  allow_implicit_invocation: true\n');await f.save();
 await assert.rejects(inspectSkill(f.source,'cursor'),/Codex explicit-only/);
});
test('rejects a missing recovery reference',async t=>{
 const f=await fixture(t);await fs.unlink(path.join(f.source,'references/editing.md'));delete f.manifest.files['references/editing.md'];await f.save();
 await assert.rejects(installSkill(f.source,'cursor',f.parent),/Required package resource/);
});
test('rejects a server configuration instead of silently registering it',async t=>{
 const f=await fixture(t);await f.update('.mcp.json','{}');await f.save();await assert.rejects(inspectSkill(f.source,'cursor'),/cannot configure servers/);
});
test('rejects an unlisted executable',async t=>{
 const f=await fixture(t);await fs.writeFile(path.join(f.source,'extra.mjs'),'unlisted');await assert.rejects(inspectSkill(f.source,'cursor'),/extra or missing/);
});
test('rejects unsafe manifest paths without reading outside the package',async t=>{
 const f=await fixture(t);f.manifest.files['../outside.txt']=sha('outside');await f.save();await assert.rejects(inspectSkill(f.source,'cursor'),/extra or missing|Unsafe/);
});

test('a checked update retains the entire prior installation outside skill discovery',async t=>{
 const f=await fixture(t);await installSkill(f.source,'cursor',f.parent);await fs.writeFile(path.join(f.parent,'hwp-easy','personal-note.txt'),'keep');f.manifest.version='0.2.19';await f.save();
 const result=await updateSkill(f.source,'cursor',f.parent);assert.equal(result.status,'UPDATED');assert.equal(result.previous_version,'0.2.18');assert.equal(result.version,'0.2.19');
 assert.equal(await fs.readFile(path.join(result.previous_installation,'personal-note.txt'),'utf8'),'keep');assert.equal(path.dirname(result.previous_installation),path.resolve(f.parent,'..','hwp-easy-install-backups'));
 assert.deepEqual(await fs.readdir(f.parent),['hwp-easy']);assert.equal((await inspectSkill(result.skill_path,'cursor')).version,'0.2.19');
});
test('a byte-identical update does not create a backup or duplicate skill',async t=>{const f=await fixture(t);await installSkill(f.source,'cursor',f.parent);const result=await updateSkill(f.source,'cursor',f.parent);assert.equal(result.status,'UNCHANGED');await assert.rejects(fs.stat(path.resolve(f.parent,'..','hwp-easy-install-backups')),{code:'ENOENT'});});
test('update rejects a downgrade and preserves the current runtime',async t=>{const f=await fixture(t);await installSkill(f.source,'cursor',f.parent);f.manifest.version='0.2.17';await f.save();await assert.rejects(updateSkill(f.source,'cursor',f.parent),/downgrade/);assert.equal((await inspectSkill(path.join(f.parent,'hwp-easy'),'cursor')).version,'0.2.18');});
test('a corrupt update fails before moving the installed skill',async t=>{const f=await fixture(t);await installSkill(f.source,'cursor',f.parent);await fs.writeFile(path.join(f.source,'scripts/rhwp_bg.wasm'),'bad');await assert.rejects(updateSkill(f.source,'cursor',f.parent),/hash mismatch/);assert.equal((await inspectSkill(path.join(f.parent,'hwp-easy'),'cursor')).version,'0.2.18');});
test('update installs into an empty client directory',async t=>{const f=await fixture(t);const result=await updateSkill(f.source,'cursor',f.parent);assert.equal(result.status,'INSTALLED');});

test('a failed update publication restores the prior installation and user files',async t=>{
 const f=await fixture(t);await installSkill(f.source,'cursor',f.parent);const target=path.join(f.parent,'hwp-easy');
 await fs.writeFile(path.join(target,'personal-note.txt'),'keep');f.manifest.version='0.2.19';await f.save();
 const rename=fs.rename;fs.rename=async(from,to)=>{if(from.includes('.staging-')&&to===target)throw Object.assign(Error('injected publish failure'),{code:'EACCES'});return rename(from,to);};
 try{await assert.rejects(updateSkill(f.source,'cursor',f.parent),/injected publish failure/);}finally{fs.rename=rename;}
 assert.equal(JSON.parse(await fs.readFile(path.join(target,'build-manifest.json'),'utf8')).version,'0.2.18');
 assert.equal(await fs.readFile(path.join(target,'personal-note.txt'),'utf8'),'keep');
 assert.equal(await fs.readFile(path.join(target,'scripts/local-runner.mjs'),'utf8'),await fs.readFile(path.join(f.source,'scripts/local-runner.mjs'),'utf8'));
});

test('a concurrent replacement is retained without overwriting it during rollback',async t=>{
 const f=await fixture(t);await installSkill(f.source,'cursor',f.parent);const target=path.join(f.parent,'hwp-easy');f.manifest.version='0.2.19';await f.save();
 const rename=fs.rename;fs.rename=async(from,to)=>{if(from.includes('.staging-')&&to===target){await fs.mkdir(target);await fs.writeFile(path.join(target,'concurrent.txt'),'keep concurrent');throw Object.assign(Error('injected concurrent replacement'),{code:'EEXIST'});}return rename(from,to);};
 try{await assert.rejects(updateSkill(f.source,'cursor',f.parent),/injected concurrent replacement/);}finally{fs.rename=rename;}
 assert.equal(await fs.readFile(path.join(target,'concurrent.txt'),'utf8'),'keep concurrent');
 const root=path.resolve(f.parent,'..','hwp-easy-install-backups'),prior=(await fs.readdir(root)).find(n=>n.startsWith('hwp-easy-0.2.18-'));
 assert.ok(prior);assert.equal((await inspectSkill(path.join(root,prior),'cursor')).version,'0.2.18');
});
