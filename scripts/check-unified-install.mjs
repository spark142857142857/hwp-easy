/** All clients share one packaged engine; synthetic documents and isolated installs only. */
import fs from 'node:fs/promises';
import path from 'node:path';
import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {createAgentPackage} from '../packages/hwp-easy/lib/agent-package.mjs';
import {installSkill,inspectSkill} from '../packages/hwp-easy/lib/agent-skill.mjs';
import {inspectPlugin} from '../packages/hwp-easy/lib/plugin.mjs';

const [packageArg,oldArg,reportArg]=process.argv.slice(2);
assert.ok(packageArg&&oldArg&&reportArg,'Usage: node check-unified-install.mjs <unpacked-npm-folder> <old-marketplace> <fresh-report-folder>');
const root=fileURLToPath(new URL('..',import.meta.url)),pkg=path.resolve(packageArg),old=path.resolve(oldArg),report=path.resolve(reportArg);
const oldVersion=(await inspectPlugin(path.join(old,'plugins/hwp-easy'))).version;
await fs.mkdir(report);
const run=(exe,args,timeout=240000)=>{
 const r=spawnSync(exe,args,{encoding:'utf8',shell:false,windowsHide:true,timeout,env:process.env});
 assert.equal(r.error,undefined);assert.equal(r.status,0,r.stderr);return r.stdout;
};
const cli=path.join(pkg,'bin/hwp-easy.mjs'),python=path.join(root,'.venv',process.platform==='win32'?'Scripts/python.exe':'bin/python');
const invoke=(command,client,skills)=>JSON.parse(run(process.execPath,[cli,command,'--client',client,'--skills-root',skills,'--data-dir',path.join(report,'data'),'--json']));
const document=(directory,name)=>{
 const output=path.join(report,name);
 const result=JSON.parse(run(process.execPath,[path.join(root,'scripts/check-installed-plugin.mjs'),directory,output]));
 run(python,['-X','utf8',path.join(root,'scripts/check-installed-plugin.py'),output]);return result;
};
const clients=[];
for(const client of ['claude-code','cursor']) {
 const freshRoot=path.join(report,client,'fresh-skills'),fresh=invoke('install',client,freshRoot);
 assert.equal(fresh.status,'INSTALLED');const check=document(fresh.skill_path,client+'-fresh-document');
 assert.equal(invoke('install',client,freshRoot).status,'UNCHANGED');
 const prior=path.join(report,client,'old-package');await createAgentPackage(path.join(old,'plugins/hwp-easy'),client,prior);
 const updateRoot=path.join(report,client,'update-skills');await installSkill(prior,client,updateRoot);
 const updated=invoke('update',client,updateRoot);assert.equal(updated.previous_version,oldVersion);
 document(updated.skill_path,client+'-updated-document');
 assert.equal(invoke('rollback',client,updateRoot).version,oldVersion);
 assert.equal(invoke('rollback',client,updateRoot).version,check.version);
 assert.deepEqual(await fs.readdir(updateRoot),['hwp-easy']);
 await inspectSkill(updated.skill_path,client);
 clients.push({client,version:check.version,runner_sha256:check.runner_sha256,wasm_sha256:check.wasm_sha256,
  fresh_install:true,update_from_version:oldVersion,plugin_rollback_and_redo:true,same_file_save_restore_and_independent_reader:true});
}
const codexReport=JSON.parse(run(process.execPath,[path.join(root,'scripts/check-distribution-install.mjs'),pkg,old,path.join(report,'codex')],360000));
assert.equal(codexReport.status,'PASS');
const codex=JSON.parse(await fs.readFile(path.join(report,'codex/verification.json'),'utf8'));
for(const client of clients){assert.equal(client.runner_sha256,codex.fresh_installed_document.runner_sha256);assert.equal(client.wasm_sha256,codex.fresh_installed_document.wasm_sha256);}
const result={status:'PASS',version:clients[0].version,shared_engine_identical:true,clients,codex:codexReport,
 current_user_installations_changed:false,github_actions_run:false,computer_use_calls:0,model_invocation_verified:false};
await fs.writeFile(path.join(report,'verification.json'),JSON.stringify(result,null,2)+'\n');
console.log(JSON.stringify({status:'PASS',version:result.version,all_clients:true,report:path.join(report,'verification.json')}));
