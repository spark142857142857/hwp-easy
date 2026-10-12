import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import {createHash} from 'node:crypto';
import {inspectSkill,installSkill} from '../scripts/install_agent_skill.mjs';

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
