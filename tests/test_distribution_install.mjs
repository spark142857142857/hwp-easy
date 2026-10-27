import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {pluginFiles,sha256,inspectPlugin,writeMarketplace} from '../packages/hwp-easy/lib/plugin.mjs';
import {manageInstallation} from '../packages/hwp-easy/lib/install.mjs';

async function fixture(t, version='0.5.0') {
  const root=await fs.mkdtemp(path.join(os.tmpdir(),'hwp-easy-installer-test-'));
  t.after(async()=>{assert.equal(path.dirname(root),os.tmpdir());assert.match(path.basename(root),/^hwp-easy-installer-test-/);await fs.rm(root,{recursive:true,force:true});});
  const plugin=path.join(root,'payload'),home=path.join(root,'Codex home 한글'),dataDir=path.join(root,'Installer with spaces');
  await fs.mkdir(plugin);
  for(const name of pluginFiles) {await fs.mkdir(path.dirname(path.join(plugin,name)),{recursive:true});await fs.writeFile(path.join(plugin,name),'synthetic '+name+' '+version);}
  const bytes=name=>fs.readFile(path.join(plugin,'skills/edit-local-hwp/scripts',name));
  const manifest={package:'hwp-easy',version,runner_sha256:sha256(await bytes('local-runner.mjs')),wasm_sha256:sha256(await bytes('rhwp_bg.wasm')),
    local_preview:{renderer:{wasm_sha256:sha256(await bytes('resvg_bg.wasm'))},font:{sha256:sha256(await bytes('NanumGothic-Regular.ttf'))}}};
  await fs.writeFile(path.join(plugin,'plugin.json'),JSON.stringify({name:'hwp-easy',version,extensions:{'com.openai':version.startsWith('0.2.')?{}:{requires_local_executor:true}}}));
  await fs.writeFile(path.join(plugin,'build-manifest.json'),JSON.stringify(manifest));
  await fs.writeFile(path.join(plugin,'skills/edit-local-hwp/agents/openai.yaml'),'policy:\n  allow_implicit_invocation: false\n');
  await fs.mkdir(home,{recursive:true});
  const unrelated=path.join(home,'unrelated-config.toml');await fs.writeFile(unrelated,'unrelated = "preserve"\n');
  let market,installed,failInstall=false;
  const mutations=[];
  const run=async args=>{
    const command=args.slice(0,3).join(' ');
    if(command==='plugin marketplace list') return {marketplaces:market?[{name:'hwp-easy',root:market}]:[]};
    if(args[0]==='plugin'&&args[1]==='list') return {installed:installed?[{pluginId:'hwp-easy@hwp-easy',installed:true,enabled:true}]:[],available:[]};
    mutations.push(args);
    if(command==='plugin marketplace add') {market=args[3];return {};}
    if(command==='plugin marketplace remove') {market=undefined;return {};}
    if(args[0]==='plugin'&&args[1]==='remove') {installed=undefined;return {};}
    if(args[0]==='plugin'&&args[1]==='add') {
      if(failInstall){failInstall=false;throw Error('injected install failure');}
      const source=path.join(market,'plugins/hwp-easy'),info=await inspectPlugin(source);
      const cache=path.join(home,'plugins/cache/hwp-easy/hwp-easy',info.version);
      await fs.mkdir(path.dirname(cache),{recursive:true});await fs.cp(source,cache,{recursive:true});
      installed=cache;return {installedPath:cache};
    }
    throw Error('Unexpected command '+args.join(' '));
  };
  const options={payload:plugin,codexHome:home,dataDir,run};
  return {root,plugin,home,dataDir,run,options,mutations,unrelated,failNextInstall:()=>{failInstall=true;}};
}

test('fresh install survives removal of the npm payload and is idempotent',async t=>{
  const f=await fixture(t),first=await manageInstallation(f.options);
  assert.equal(first.status,'INSTALLED');assert.equal(first.explicit_only,true);
  const count=f.mutations.length;
  assert.equal((await manageInstallation(f.options)).status,'UNCHANGED');assert.equal(f.mutations.length,count);
  await fs.rename(f.plugin,f.plugin+'-npm-cache-removed');
  assert.equal((await manageInstallation({...f.options,command:'status'})).version,'0.5.0');
  assert.equal((await inspectPlugin(first.installed_path)).version,'0.5.0');
  assert.equal(await fs.readFile(f.unrelated,'utf8'),'unrelated = "preserve"\n');
});

test('update preserves old package, rollback restores it and can toggle back',async t=>{
  const f=await fixture(t,'0.2.19');await manageInstallation(f.options);
  const next=await fixture(t);
  const result=await manageInstallation({...f.options,payload:next.plugin,command:'update'});
  assert.equal(result.previous_version,'0.2.19');assert.equal(result.version,'0.5.0');
  assert.equal((await inspectPlugin(path.join(result.previous_installation,'plugins/hwp-easy'))).version,'0.2.19');
  const rollback=await manageInstallation({...f.options,payload:next.plugin,command:'rollback'});
  assert.equal(rollback.status,'ROLLED_BACK');assert.equal(rollback.version,'0.2.19');
  assert.equal((await manageInstallation({...f.options,command:'rollback'})).version,'0.5.0');
  assert.equal(await fs.readFile(f.unrelated,'utf8'),'unrelated = "preserve"\n');
});

test('failed update automatically restores the previous package',async t=>{
  const f=await fixture(t,'0.2.19');await manageInstallation(f.options);
  const next=await fixture(t);f.failNextInstall();
  await assert.rejects(manageInstallation({...f.options,payload:next.plugin,command:'update'}),/previous HWP Easy installation restored/);
  assert.equal((await manageInstallation({...f.options,command:'status'})).version,'0.2.19');
  assert.equal((await inspectPlugin(path.join(f.home,'plugins/cache/hwp-easy/hwp-easy/0.2.19'))).version,'0.2.19');
});

test('failed first install removes only its own registration',async t=>{
  const f=await fixture(t);f.failNextInstall();
  await assert.rejects(manageInstallation(f.options),/previous HWP Easy installation restored/);
  assert.equal((await manageInstallation({...f.options,command:'status'})).status,'NOT_INSTALLED');
});

test('tampered runtime, extra server configuration and automatic invocation are refused before mutation',async t=>{
  for(const scenario of ['runtime','server','policy']) {
    const f=await fixture(t);
    const file=scenario==='runtime'?'skills/edit-local-hwp/scripts/local-runner.mjs':scenario==='server'?'mcp.json':'skills/edit-local-hwp/agents/openai.yaml';
    await fs.writeFile(path.join(f.plugin,file),scenario==='policy'?'policy:\n  allow_implicit_invocation: true\n':'tampered');
    await assert.rejects(manageInstallation(f.options),/hash mismatch|unexpected|Explicit-only/);
    assert.equal(f.mutations.length,0);
  }
});

test('missing Codex commands, downgrade and existing unrelated marketplace are refused',async t=>{
  const f=await fixture(t);
  await assert.rejects(manageInstallation({...f.options,run:async()=>{throw Error('unsupported command');}}),/unsupported command/);
  await manageInstallation(f.options);
  const old=await fixture(t,'0.2.19');
  await assert.rejects(manageInstallation({...f.options,command:'update',payload:old.plugin}),/downgrade/);
  const directory=path.join(f.root,'unrelated');await fs.mkdir(path.join(directory,'.agents/plugins'),{recursive:true});
  await fs.writeFile(path.join(directory,'.agents/plugins/marketplace.json'),JSON.stringify({name:'hwp-easy',plugins:[{name:'other'}]}));
  const run=async args=>args[1]==='marketplace'?{marketplaces:[{name:'hwp-easy',root:directory}]}:{installed:[]};
  await assert.rejects(manageInstallation({...f.options,run}),/not the supported HWP Easy catalog/);
});

test('held lock and symlinked data directory do not alter the active plugin',async t=>{
  const f=await fixture(t);await fs.mkdir(f.dataDir,{recursive:true});await fs.writeFile(path.join(f.dataDir,'install.lock'),'busy');
  await assert.rejects(manageInstallation(f.options),{code:'EEXIST'});assert.equal(f.mutations.length,0);
  const linked=path.join(f.root,'linked');await fs.symlink(f.dataDir,linked,process.platform==='win32'?'junction':'dir');
  await assert.rejects(manageInstallation({...f.options,dataDir:linked}),/Linked/);assert.equal(f.mutations.length,0);
});

test('rollback checks the preserved package and refuses a changed backup',async t=>{
  const f=await fixture(t,'0.2.19');await manageInstallation(f.options);const next=await fixture(t);
  const result=await manageInstallation({...f.options,payload:next.plugin,command:'update'});
  await fs.writeFile(path.join(result.previous_installation,'plugins/hwp-easy/skills/edit-local-hwp/scripts/local-runner.mjs'),'bad');
  const count=f.mutations.length;
  await assert.rejects(manageInstallation({...f.options,command:'rollback'}),/hash mismatch/);assert.equal(f.mutations.length,count);
});

test('marketplace preparation refuses an existing directory',async t=>{
  const f=await fixture(t),destination=path.join(f.root,'existing');await fs.mkdir(destination);
  await assert.rejects(writeMarketplace(f.plugin,destination),{code:'EEXIST'});
  assert.deepEqual(await fs.readdir(destination),[]);
});
