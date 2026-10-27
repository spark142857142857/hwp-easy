import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import {randomUUID} from 'node:crypto';
import {checkedDirectory,sha256} from './plugin.mjs';
import {createAgentPackage} from './agent-package.mjs';
import {inspectSkill,installSkill} from './agent-skill.mjs';

const folders={'claude-code':'.claude',cursor:'.cursor'};
const digest=manifest=>sha256(JSON.stringify({version:manifest.version,client:manifest.distribution.client,files:manifest.files}));
const exists=async value=>{try{await fs.lstat(value);return true;}catch(e){if(e.code==='ENOENT')return false;throw e;}};
const compare=(a,b)=>{const x=a.split('.').map(Number),y=b.split('.').map(Number);for(let i=0;i<3;i++)if(x[i]!==y[i])return Math.sign(x[i]-y[i]);return 0;};

export async function manageAgentInstallation({command='install',client,payload,skillsRoot,dataDir}) {
  if(!Object.hasOwn(folders,client)) throw Error('Unknown skill client');
  if(!['install','update','rollback','status'].includes(command)) throw Error('Unknown command');
  const parent=path.resolve(skillsRoot||path.join(os.homedir(),folders[client],'skills')),target=path.join(parent,'hwp-easy');
  const inspectCurrent=async()=>{
    if(!await exists(parent))return null;
    await checkedDirectory(parent);
    return await exists(target)?await inspectSkill(target,client):null;
  };
  const previous=await inspectCurrent();
  if(command==='status')return {status:previous?'INSTALLED':'NOT_INSTALLED',client,version:previous?.version||null,skill_path:previous?target:null};
  const backups=path.resolve(parent,'..','hwp-easy-install-backups');
  const base=path.resolve(dataDir||path.join(process.env.LOCALAPPDATA||path.join(os.homedir(),'.local/share'),'HWP Easy','installer'));
  const data=path.join(base,client,sha256(parent).slice(0,16));
  await checkedDirectory(data,true);
  const lockPath=path.join(data,'install.lock'),lock=await fs.open(lockPath,'wx',0o600),statePath=path.join(data,'state.json');
  let backup,staged,selected,selectedSource,stageRoot,ownedStage=false;
  try {
    const rechecked=await inspectCurrent();
    if((previous?digest(previous):null)!==(rechecked?digest(rechecked):null))throw Error('Skill changed during installation');
    await checkedDirectory(backups,true);
    const token=randomUUID();stageRoot=path.join(backups,'.staging-'+token);
    await fs.mkdir(stageRoot);ownedStage=true;
    if(command==='rollback') {
      const state=JSON.parse(await fs.readFile(statePath,'utf8'));
      selectedSource=path.resolve(state.previous?.path||'');
      if(state.client!==client||state.skills_root!==parent||path.dirname(selectedSource)!==backups)throw Error('No preserved installation for this client');
      selected=await inspectSkill(selectedSource,client);
      if(digest(selected)!==state.previous.digest)throw Error('Preserved skill hash mismatch');
      staged=(await installSkill(selectedSource,client,stageRoot)).skill_path;
    } else {
      staged=path.join(stageRoot,'hwp-easy');
      selected=await createAgentPackage(payload,client,staged);
    }
    if(previous&&digest(previous)===digest(selected))return {status:'UNCHANGED',client,version:previous.version,skill_path:target};
    if(command==='install'&&previous)throw Error('HWP Easy is already installed. Use update to preserve the previous installation.');
    if(command==='update'&&previous&&compare(selected.version,previous.version)<0)throw Error('Update cannot downgrade a skill; use rollback');
    await checkedDirectory(parent,true);
    const beforeReplacement=await inspectCurrent();
    if((previous?digest(previous):null)!==(beforeReplacement?digest(beforeReplacement):null))throw Error('Skill changed before replacement');
    backup=previous?path.join(backups,'hwp-easy-'+previous.version+'-'+token):null;
    const state={client,skills_root:parent,current:{version:selected.version,digest:digest(selected)},
      previous:backup?{path:backup,version:previous.version,digest:digest(previous)}:null};
    const journal=statePath+'.'+token;
    await fs.writeFile(journal,JSON.stringify(state,null,2)+'\n',{flag:'wx',mode:0o600});
    let moved=false,published=false;
    try {
      if(backup){await fs.rename(target,backup);moved=true;}
      // A directory created by another process must never be replaced.
      if(await exists(target))throw Error('A concurrent installation appeared');
      await fs.rename(staged,target);published=true;
      if(digest(await inspectSkill(target,client))!==digest(selected))throw Error('Installed skill hash mismatch');
      await fs.rename(journal,statePath);
    } catch(error) {
      try {
        if(published&&await exists(target)) {
          if(digest(await inspectSkill(target,client))!==digest(selected))throw Error('Concurrent skill changes retained');
          await fs.rename(target,path.join(backups,'failed-'+token));
        }
        if(moved) {
          if(await exists(target))throw Error('Concurrent installation retained');
          await fs.rename(backup,target);
        }
      } catch(recovery) {throw Error(error.message+'; recovery failed: '+recovery.message+'; preserved installation: '+backup);}
      throw Error(error.message+'; previous skill installation restored');
    }
    return {status:command==='rollback'?'ROLLED_BACK':previous?'UPDATED':'INSTALLED',client,version:selected.version,
      previous_version:previous?.version||null,skill_path:target,previous_installation:backup,explicit_only:true,
      runner_sha256:selected.runner_sha256,wasm_sha256:selected.wasm_sha256,server_registered:false,host_settings_changed:false,restart_required:true};
  } finally {
    // Remove only this operation's exclusively-created staging directory.
    // A prior installation or failed published candidate stays in backups.
    try {
      if(ownedStage&&path.dirname(path.resolve(stageRoot))===backups&&/^\.staging-[0-9a-f-]{36}$/.test(path.basename(stageRoot))) {
        await checkedDirectory(backups);
        const stat=await fs.lstat(stageRoot);
        if(stat.isDirectory()&&!stat.isSymbolicLink())await fs.rm(stageRoot,{recursive:true});
      }
    } finally {await lock.close();await fs.unlink(lockPath);}
  }
}
