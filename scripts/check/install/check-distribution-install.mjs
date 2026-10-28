/** Exercise the real Codex CLI in isolated homes; never change the user's Codex installation. */
import fs from 'node:fs/promises';
import path from 'node:path';
import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {findCodex,codexRunner} from '../../../packages/hwp-easy/lib/install.mjs';
import {inspectPlugin} from '../../../packages/hwp-easy/lib/plugin.mjs';

const [packageArg,oldArg,reportArg]=process.argv.slice(2);
assert.ok(packageArg&&oldArg&&reportArg,'Usage: node check-distribution-install.mjs <unpacked-npm-package> <old-marketplace> <fresh-report-folder>');
const root=fileURLToPath(new URL('../../..',import.meta.url)),pkg=path.resolve(packageArg),old=path.resolve(oldArg),report=path.resolve(reportArg);
await fs.mkdir(report);
const codex=await findCodex(),cli=path.join(pkg,'bin/hwp-easy.mjs');
const selected=await inspectPlugin(path.join(pkg,'plugins/hwp-easy'));
const oldVersion=(await inspectPlugin(path.join(old,'plugins/hwp-easy'))).version;
const execute=(executable,args,env={})=>{
  const result=spawnSync(executable,args,{shell:false,windowsHide:true,encoding:'utf8',timeout:120000,env:{...process.env,...env}});
  assert.equal(result.error,undefined);return result;
};
const installer=(command,name,extra=[],error=false)=>{
  const response=execute(process.execPath,[cli,command,'--codex-home',path.join(report,name+'-home'),'--data-dir',path.join(report,name+'-data'),'--json',...extra]);
  if(error){assert.equal(response.status,1);return response.stderr;}
  assert.equal(response.status,0,response.stderr);return JSON.parse(response.stdout);
};
const prepare=async name=>{
  const home=path.join(report,name+'-home');await fs.mkdir(home);
  await fs.writeFile(path.join(home,'config.toml'),'hide_agent_reasoning = true\n');return home;
};
const checkDocument=(installation,name)=>{
  const destination=path.join(report,name);
  const js=execute(process.execPath,[path.join(root,'scripts/check/install/check-installed-plugin.mjs'),installation.installed_path,destination]);
  assert.equal(js.status,0,js.stderr);
  const python=path.join(root,'.venv',process.platform==='win32'?'Scripts/python.exe':'bin/python');
  const independent=execute(python,['-X','utf8',path.join(root,'scripts/check/install/check-installed-plugin.py'),destination]);
  assert.equal(independent.status,0,independent.stderr);
  return JSON.parse(js.stdout);
};
const home=await prepare('fresh'),fresh=installer('install','fresh');assert.equal(fresh.status,'INSTALLED');
assert.equal((await inspectPlugin(fresh.installed_path)).digest,selected.digest);
const documentFresh=checkDocument(fresh,'fresh-document');
assert.equal(installer('install','fresh').status,'UNCHANGED');
assert.match(await fs.readFile(path.join(home,'config.toml'),'utf8'),/hide_agent_reasoning = true/);
// Removing npm's source must not remove the permanent registered marketplace.
const paused=pkg+'-temporarily-unavailable';await fs.rename(pkg,paused);
try {assert.equal((await inspectPlugin(fresh.installed_path)).digest,selected.digest);await codexRunner(codex,home)(['plugin','list','--marketplace','hwp-easy','--json']);}
finally {await fs.rename(paused,pkg);}

const updateHome=await prepare('update'),oldRun=codexRunner(codex,updateHome);
await oldRun(['plugin','marketplace','add',old,'--json']);await oldRun(['plugin','add','hwp-easy@hwp-easy','--json']);
const upgraded=installer('update','update');assert.equal(upgraded.previous_version,oldVersion);assert.equal(upgraded.version,selected.version);
const documentUpdate=checkDocument(upgraded,'update-document');
assert.equal(installer('rollback','update').version,oldVersion);
assert.equal(installer('rollback','update').version,selected.version);
assert.match(await fs.readFile(path.join(updateHome,'config.toml'),'utf8'),/hide_agent_reasoning = true/);

const failHome=await prepare('failure'),failRun=codexRunner(codex,failHome);
await failRun(['plugin','marketplace','add',old,'--json']);await failRun(['plugin','add','hwp-easy@hwp-easy','--json']);
const wrapper=path.join(report,'fault-injected-codex.mjs'),marker=path.join(report,'fail-next-install');
await fs.writeFile(marker,'one failure');
await fs.writeFile(wrapper,`import fs from 'node:fs';import {spawnSync} from 'node:child_process';\nconst args=process.argv.slice(2);\nif(args[0]==='plugin'&&args[1]==='add'&&fs.existsSync(${JSON.stringify(marker)})){fs.unlinkSync(${JSON.stringify(marker)});console.error('injected failure');process.exit(24);}\nconst r=spawnSync(${JSON.stringify(codex)},args,{shell:false,windowsHide:true,stdio:'inherit'});process.exit(r.status??1);\n`);
assert.match(installer('update','failure',['--codex',wrapper],true),/previous HWP Easy installation restored/);
assert.equal(installer('status','failure').version,oldVersion);
assert.match(await fs.readFile(path.join(failHome,'config.toml'),'utf8'),/hide_agent_reasoning = true/);
const result={status:'PASS',version:selected.version,actual_codex_executable:codex,isolated_codex_homes:true,
  fresh_install:true,idempotent_install:true,update_from_version:oldVersion,plugin_rollback_and_redo:true,
  injected_real_cli_install_failure_recovered:true,unrelated_setting_retained:true,npm_source_removal_survived:true,
  fresh_installed_document:documentFresh,updated_installed_document:documentUpdate,
  global_codex_configuration_changed:false,claude_code_or_cursor_changed:false,github_actions_run:false,computer_use_calls:0,
  fresh_chat_model_call:false,external_layout_retest:false};
await fs.writeFile(path.join(report,'verification.json'),JSON.stringify(result,null,2)+'\n');
console.log(JSON.stringify({status:result.status,version:result.version,report:path.join(report,'verification.json')}));
