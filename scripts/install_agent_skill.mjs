/** Install a verified standalone HWP Easy skill; never change host settings or overwrite a skill. */
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import {fileURLToPath} from 'node:url';
import {createHash,randomUUID} from 'node:crypto';
import {constants} from 'node:fs';

const clients={'claude-code':'.claude',cursor:'.cursor'};
const sha=bytes=>createHash('sha256').update(bytes).digest('hex');
export async function inspectSkill(directory,client) {
 if(!Object.hasOwn(clients,client))throw Error('Unknown client');
 const root=path.resolve(directory);
 if((await fs.lstat(root)).isSymbolicLink())throw Error('Skill package root must not be a symlink');
 const manifest=JSON.parse(await fs.readFile(path.join(root,'build-manifest.json'),'utf8'));
 if(!/^\d+\.\d+\.\d+$/.test(manifest.version))throw Error('Invalid package version');
 if(manifest.package!=='hwp-easy'||manifest.distribution?.type!=='agent_skill'||manifest.distribution.client!==client
  ||manifest.distribution.skill_name!=='hwp-easy'||manifest.distribution.explicit_only!==true)throw Error('Skill package identity or invocation policy mismatch');
 const names=Object.keys(manifest.files||{});
 if(names.length<5||names.length>64)throw Error('Invalid package file list');
 for(const required of ['SKILL.md','agents/openai.yaml','references/requests.md','references/editing.md','scripts/local-runner.mjs','scripts/rhwp_bg.wasm'])if(!names.includes(required))throw Error('Required package resource missing');
 const actual=[];
 let total=0;
 async function walk(prefix='') {
  for(const entry of await fs.readdir(path.join(root,prefix),{withFileTypes:true})) {
   const name=path.posix.join(prefix,entry.name);
   if(entry.isSymbolicLink())throw Error('Package symlinks are not allowed');
   if(entry.isDirectory())await walk(name);else if(name!=='build-manifest.json')actual.push(name);
  }
 }
 await walk();
 if(actual.sort().join('\n')!==names.sort().join('\n'))throw Error('Package has extra or missing files');
 for(const name of names) {
  if(name.includes('\\')||name.includes(':')||name.split('/').some(part=>!part||part==='.'||part==='..')||path.isAbsolute(name))throw Error('Unsafe package path');
  if(/(?:^|\/)(?:mcp\.json|\.mcp\.json|hooks\.json|settings\.json|\.env)$/.test(name)||name.startsWith('hooks/'))throw Error('Standalone skills cannot configure servers or hooks');
  const bytes=await fs.readFile(path.join(root,name));total+=bytes.length;
  if(bytes.length>16*1024*1024||total>32*1024*1024)throw Error('Package size limit exceeded');
  if(sha(bytes)!==manifest.files[name])throw Error('Package file hash mismatch');
 }
 if(manifest.files['scripts/local-runner.mjs']!==manifest.runner_sha256||manifest.files['scripts/rhwp_bg.wasm']!==manifest.wasm_sha256)throw Error('Shared runtime hash mismatch');
 const prompt=await fs.readFile(path.join(root,'SKILL.md'));
 const front=prompt.toString('utf8').match(/^---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)/)?.[1];
 if(prompt.length>8000||!front||!/^name: hwp-easy\s*$/m.test(front)||!/^disable-model-invocation: true\s*$/m.test(front))throw Error('Explicit-only skill frontmatter required within prompt limit');
 if(!/^\s+allow_implicit_invocation: false\s*$/m.test(await fs.readFile(path.join(root,'agents/openai.yaml'),'utf8')))throw Error('Codex explicit-only policy must be retained');
 return manifest;
}

export async function installSkill(directory,client,skillsRoot) {
 const manifest=await inspectSkill(directory,client);
 const parent=path.resolve(skillsRoot||path.join(os.homedir(),clients[client],'skills'));
 await fs.mkdir(parent,{recursive:true});
 const target=path.join(parent,'hwp-easy');
 // Exclusive mkdir preserves any existing installation, including a symlink.
 await fs.mkdir(target);
 // Copy individual files into our exclusively created directory. Node 22's
 // recursive cp rejects an existing directory with errorOnExist on Linux.
 for(const name of [...Object.keys(manifest.files),'build-manifest.json']) {
  const destination=path.join(target,name);
  await fs.mkdir(path.dirname(destination),{recursive:true});
  await fs.copyFile(path.join(path.resolve(directory),name),destination,constants.COPYFILE_EXCL);
 }
 await inspectSkill(target,client);
 return {status:'INSTALLED',client,version:manifest.version,skill_path:target,invocation:'/hwp-easy',explicit_only:true,
  runner_sha256:manifest.runner_sha256,wasm_sha256:manifest.wasm_sha256,host_settings_changed:false,server_registered:false};
}

export async function updateSkill(directory,client,skillsRoot){
 const manifest=await inspectSkill(directory,client),parent=path.resolve(skillsRoot||path.join(os.homedir(),clients[client],'skills')),target=path.join(parent,'hwp-easy');
 if(path.resolve(directory)===target)throw Error('Use a separate update package');
 async function checkedDirectory(value){let current=path.parse(value).root;for(const part of value.slice(current.length).split(path.sep)){if(!part)continue;current=path.join(current,part);const stat=await fs.lstat(current);if(stat.isSymbolicLink()||!stat.isDirectory())throw Error('Linked installation directories are not allowed');}}
 try{await checkedDirectory(target);}catch(error){if(error.code==='ENOENT')return installSkill(directory,client,parent);throw error;}
 const prior=JSON.parse(await fs.readFile(path.join(target,'build-manifest.json'),'utf8'));
 if(prior.package!=='hwp-easy'||prior.distribution?.client!==client||!/^\d+\.\d+\.\d+$/.test(prior.version))throw Error('Existing directory is not this client installation');
 const compare=(a,b)=>{const x=a.split('.').map(Number),y=b.split('.').map(Number);for(let i=0;i<3;i++)if(x[i]!==y[i])return Math.sign(x[i]-y[i]);return 0;};
 if(compare(manifest.version,prior.version)<0)throw Error('Update cannot downgrade an installed version');
 if(compare(manifest.version,prior.version)===0&&JSON.stringify(manifest.files)===JSON.stringify(prior.files)){
  try{await inspectSkill(target,client);return {status:'UNCHANGED',client,version:prior.version,skill_path:target,explicit_only:true,host_settings_changed:false,server_registered:false};}catch{ /* Preserve user modifications in the backup before replacement. */ }
 }
 // Outside the discovery directory, so preserved versions cannot appear as
 // duplicate active skills. Both resolved paths stay in this client directory.
 const backupRoot=path.resolve(parent,'..','hwp-easy-install-backups');await fs.mkdir(backupRoot,{recursive:true});await checkedDirectory(backupRoot);
 const token=randomUUID(),stage=path.join(backupRoot,`.staging-${token}`),backup=path.join(backupRoot,`hwp-easy-${prior.version}-${token}`),lockPath=path.join(backupRoot,'update.lock');
 if(path.dirname(stage)!==backupRoot||path.dirname(backup)!==backupRoot||path.dirname(target)!==parent)throw Error('Invalid update paths');
 const lock=await fs.open(lockPath,'wx');
 try{
  const staged=await installSkill(directory,client,stage);await checkedDirectory(target);
  await fs.rename(target,backup);
  try{await fs.rename(staged.skill_path,target);}catch(error){try{await fs.lstat(target);}catch(missing){if(missing.code==='ENOENT')await fs.rename(backup,target);}throw error;}
  await fs.rmdir(stage);await inspectSkill(target,client);
  return {status:'UPDATED',client,version:manifest.version,previous_version:prior.version,skill_path:target,previous_installation:backup,explicit_only:true,runner_sha256:manifest.runner_sha256,wasm_sha256:manifest.wasm_sha256,host_settings_changed:false,server_registered:false};
 }finally{await lock.close();await fs.unlink(lockPath);}
}

if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url)) {
 try {
  const args=process.argv.slice(2),values={};
  if(args.length%2)throw Error('Use --client <claude-code|cursor> --package <skill-folder> [--skills-root <folder>] [--mode <install|update>]');
  for(let i=0;i<args.length;i+=2){if(!['--client','--package','--skills-root','--mode'].includes(args[i])||Object.hasOwn(values,args[i]))throw Error('Invalid arguments');values[args[i]]=args[i+1];}
  if(!values['--package']||!values['--client'])throw Error('A package and client are required');
  if(values['--mode']&&!['install','update'].includes(values['--mode']))throw Error('Invalid install mode');
  console.log(JSON.stringify(await (values['--mode']==='update'?updateSkill:installSkill)(values['--package'],values['--client'],values['--skills-root'])));
 }catch(error){console.error(error.message);process.exitCode=1;}
}
