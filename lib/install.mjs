import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import {randomUUID} from 'node:crypto';
import {spawn} from 'node:child_process';
import {checkedDirectory, inspectPlugin, writeMarketplace,sameDirectory} from './plugin.mjs';
import {manageAgentInstallation} from './agent-install.mjs';

const missing = error => error.code === 'ENOENT';
async function exists(file) { try { await fs.lstat(file); return true; } catch(e) { if (missing(e)) return false; throw e; } }
const compare = (a,b) => { const x=a.split('.').map(Number), y=b.split('.').map(Number); for(let i=0;i<3;i++) if(x[i]!==y[i]) return Math.sign(x[i]-y[i]); return 0; };

export async function findCodex(explicit) {
  const candidates = explicit ? [path.resolve(explicit)] : [];
  if (!explicit) {
    for (const folder of (process.env.PATH || '').split(path.delimiter).filter(Boolean)) {
      candidates.push(path.join(folder, process.platform === 'win32' ? 'codex.exe' : 'codex'));
      // npm's Windows .cmd shim cannot be spawned safely without a shell. Run
      // the official JavaScript entrypoint with Node instead.
      candidates.push(path.join(folder, 'node_modules/@openai/codex/bin/codex.js'));
    }
    if (process.platform === 'win32' && process.env.LOCALAPPDATA)
      candidates.push(path.join(process.env.LOCALAPPDATA, 'Programs/OpenAI/Codex/bin/codex.exe'));
  }
  for (const file of candidates) if (await exists(file)) {
    if (process.platform === 'win32' && !/\.(?:exe|m?js)$/i.test(file)) continue;
    if ((await fs.stat(file)).isFile()) return file;
  }
  throw Error('Codex CLI를 찾을 수 없습니다. Codex를 설치하거나 --codex <실행 파일 경로>를 지정하세요.');
}

export function codexRunner(executable, home) {
  return async args => {
    const javascript = /\.m?js$/i.test(executable);
    const result = await new Promise((resolve, reject) => {
      const child = spawn(javascript ? process.execPath : executable, javascript ? [executable,...args] : args, {
        shell:false, windowsHide:true, env:{...process.env, CODEX_HOME:home}, stdio:['ignore','pipe','pipe']
      });
      let stdout='', stderr='';
      const timer=setTimeout(() => { child.kill(); reject(Error('Codex command timed out')); }, 90000);
      child.stdout.on('data', chunk => { stdout+=chunk; if(stdout.length>4*1024*1024) child.kill(); });
      child.stderr.on('data', chunk => { stderr+=chunk; if(stderr.length>4*1024*1024) child.kill(); });
      child.on('error', error => { clearTimeout(timer); reject(error); });
      child.on('close', code => { clearTimeout(timer); resolve({code,stdout,stderr}); });
    });
    if (result.code !== 0) throw Error('Codex '+args.slice(0,3).join(' ')+' failed: '+result.stderr.trim());
    try { return JSON.parse(result.stdout); } catch { throw Error('Codex CLI JSON output is unavailable. Update Codex first.'); }
  };
}

async function current(run) {
  const sources = await run(['plugin','marketplace','list','--json']);
  if (!Array.isArray(sources.marketplaces)) throw Error('Unsupported Codex marketplace response');
  const source = sources.marketplaces.find(item => item.name === 'hwp-easy');
  if (!source) return null;
  const listing = await run(['plugin','list','--marketplace','hwp-easy','--json']);
  const installed = listing.installed?.find(item => item.pluginId === 'hwp-easy@hwp-easy' && item.installed);
  const root = await checkedDirectory(source.root);
  const catalog = JSON.parse(await fs.readFile(path.join(root,'.agents/plugins/marketplace.json'),'utf8'));
  if(catalog.name !== 'hwp-easy' || catalog.plugins?.length !== 1
      || catalog.plugins[0].name !== 'hwp-easy' || catalog.plugins[0].source?.path !== './plugins/hwp-easy')
    throw Error('Existing marketplace is not the supported HWP Easy catalog; preserve it and manage it manually.');
  const plugin = path.join(root,'plugins/hwp-easy');
  return {root, plugin, installed:!!installed, enabled:installed?.enabled, ...await inspectPlugin(plugin)};
}

async function activate(run, destination, wasConfigured, install=true) {
  if (wasConfigured) await run(['plugin','marketplace','remove','hwp-easy','--json']);
  await run(['plugin','marketplace','add',destination,'--json']);
  if (install) await run(['plugin','add','hwp-easy@hwp-easy','--json']);
}

async function verifyInstalled(home, expected) {
  const plugin = path.join(home,'plugins/cache/hwp-easy/hwp-easy',expected.version);
  if ((await inspectPlugin(plugin)).digest !== expected.digest) throw Error('Installed Codex cache does not match the verified package');
  return plugin;
}

export async function manageInstallation({command='install', client='codex', skillsRoot, payload, dataDir, codexHome, codex, run:customRun}) {
  if(client!=='codex')return manageAgentInstallation({command,client,skillsRoot,payload,dataDir});
  if (!['install','update','rollback','status'].includes(command)) throw Error('Unknown command');
  const home=path.resolve(codexHome || process.env.CODEX_HOME || path.join(os.homedir(),'.codex'));
  const data=path.resolve(dataDir || path.join(process.env.LOCALAPPDATA || path.join(os.homedir(),'.local/share'),'HWP Easy','installer'));
  const run=customRun || codexRunner(await findCodex(codex),home);
  if(command!=='status')await checkedDirectory(home,true);
  const previous=await current(run);
  if(command==='status') return {status:previous?.installed?'INSTALLED':'NOT_INSTALLED', version:previous?.version || null,
    marketplace:previous?.root || null, codex_home:home, data_directory:data};
  const wanted = command==='rollback' ? null : await inspectPlugin(payload);
  if(previous?.installed && previous.enabled === false) throw Error('HWP Easy is disabled. Enable it in Codex before changing this installation.');
  if(command==='install' && previous?.installed) {
    if(previous.digest!==wanted.digest) throw Error('HWP Easy가 이미 설치되어 있습니다. 기존 설치를 보관하려면 update를 사용하세요.');
    const cache=await verifyInstalled(home,wanted);
    return {status:'UNCHANGED',version:wanted.version,installed_path:cache};
  }
  if(command==='update' && previous && compare(wanted.version,previous.version)<0) throw Error('Update cannot downgrade HWP Easy. Use rollback for a preserved installation.');
  await checkedDirectory(data,true);
  const lockPath=path.join(data,'install.lock'), lock=await fs.open(lockPath,'wx',0o600);
  const statePath=path.join(data,'state.json');
  try {
    // Recheck after acquiring our own installer lock. Other Codex processes
    // may still run; only HWP Easy is changed through official CLI commands.
    const rechecked=await current(run);
    if(JSON.stringify([previous?.root,previous?.digest,previous?.installed])!==JSON.stringify([rechecked?.root,rechecked?.digest,rechecked?.installed]))
      throw Error('HWP Easy changed during installation; retry after the other operation completes.');
    let restoreState;
    if(command==='rollback') {
      restoreState=JSON.parse(await fs.readFile(statePath,'utf8'));
      if(restoreState.codex_home!==home || !restoreState.previous?.marketplace) throw Error('No preserved installation for this Codex home');
      const backup=path.resolve(restoreState.previous.marketplace);
      if(path.dirname(backup)!==path.join(data,'backups')) throw Error('Invalid preserved installation path');
      const inspected=await inspectPlugin(path.join(backup,'plugins/hwp-easy'));
      if(inspected.digest!==restoreState.previous.digest) throw Error('Preserved installation hash mismatch');
      payload=path.join(backup,'plugins/hwp-easy');
    }
    const selected=await inspectPlugin(payload);
    if(previous?.installed && previous.digest===selected.digest) {
      return {status:'UNCHANGED',version:selected.version,installed_path:await verifyInstalled(home,selected)};
    }
    // Keep the previous package outside every skill and plugin discovery root.
    let saved;
    if(previous) {
      const backups=await checkedDirectory(path.join(data,'backups'),true);
      const destination=path.join(backups,previous.version+'-'+randomUUID());
      await writeMarketplace(previous.plugin,destination);
      saved={marketplace:destination,version:previous.version,digest:previous.digest,installed:previous.installed};
    }
    const packages=await checkedDirectory(path.join(data,'packages'),true);
    const destination=path.join(packages,selected.version+'-'+selected.digest.slice(0,16));
    if(await exists(destination)) {
      if((await inspectPlugin(path.join(destination,'plugins/hwp-easy'))).digest!==selected.digest) throw Error('Existing installer package was modified');
    } else {
      const staging=path.join(packages,'.staging-'+randomUUID());
      await writeMarketplace(payload,staging);
      await fs.rename(staging,destination);
    }
    const state={codex_home:home,current:{marketplace:destination,version:selected.version,digest:selected.digest},previous:saved || null};
    const stateStage=statePath+'.'+randomUUID();
    await fs.writeFile(stateStage,JSON.stringify(state,null,2)+'\n',{flag:'wx',mode:0o600});
    let installedPath;
    try {
      await activate(run,destination,!!previous);
      installedPath=await verifyInstalled(home,selected);
      const active=await current(run);
      if(!active?.installed || !await sameDirectory(active.root,destination) || active.digest!==selected.digest) throw Error('Codex did not activate the selected HWP Easy package');
      await fs.rename(stateStage,statePath);
    } catch(error) {
      try {
        const configured=(await run(['plugin','marketplace','list','--json'])).marketplaces.some(item=>item.name==='hwp-easy');
        if(saved) {
          await activate(run,saved.marketplace,configured,saved.installed);
          if(saved.installed) await verifyInstalled(home,previous);
        } else {
          // The failed installation owns only this plugin and this marketplace.
          const listing=configured?await run(['plugin','list','--marketplace','hwp-easy','--json']):{};
          if(listing.installed?.some(item=>item.pluginId==='hwp-easy@hwp-easy'&&item.installed))
            await run(['plugin','remove','hwp-easy@hwp-easy','--json']);
          if(configured) await run(['plugin','marketplace','remove','hwp-easy','--json']);
        }
      } catch(recovery) { throw Error(error.message+'; automatic recovery failed: '+recovery.message+'; preserved package: '+(saved?.marketplace || destination)); }
      throw Error(error.message+'; previous HWP Easy installation restored');
    }
    return {status:command==='rollback'?'ROLLED_BACK':previous?.installed?'UPDATED':'INSTALLED',version:selected.version,
      previous_version:previous?.version || null,installed_path:installedPath,marketplace:destination,
      previous_installation:saved?.marketplace || null,explicit_only:true,server_registered:false,
      restart_required:true};
  } finally { await lock.close(); await fs.unlink(lockPath); }
}
