/** Install both client packages into isolated roots and exercise the actual installed files. */
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import {fileURLToPath} from 'node:url';
import {execFileSync} from 'node:child_process';
import assert from 'node:assert/strict';
import {installSkill} from './install_agent_skill.mjs';

const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const temporary=fs.mkdtempSync(path.join(os.tmpdir(),'hwp-easy-client-check-'));
try {
 const runtime=[];
 for(const client of ['claude-code','cursor']) {
  const packagePath=path.join(root,'outputs/agent-packages',client,'hwp-easy');
  const installed=await installSkill(packagePath,client,path.join(temporary,client,'skills'));
  const reportPath=path.join(root,'outputs/agent-client-check',client);
  const stdout=execFileSync(process.execPath,[path.join(root,'scripts/check-installed-plugin.mjs'),installed.skill_path,reportPath],
   {encoding:'utf8',windowsHide:true,timeout:300000});
  const report=JSON.parse(stdout);assert.equal(report.status,'PASS');assert.equal(report.client,client);
  runtime.push({client,version:report.version,runner_sha256:report.runner_sha256,wasm_sha256:report.wasm_sha256,status:report.status});
 }
 assert.equal(runtime[0].runner_sha256,runtime[1].runner_sha256);assert.equal(runtime[0].wasm_sha256,runtime[1].wasm_sha256);
 console.log(JSON.stringify({status:'PASS',shared_engine_identical:true,clients:runtime,host_model_invocation_verified:false}));
} finally {
 assert.equal(path.dirname(temporary),os.tmpdir());assert.ok(path.basename(temporary).startsWith('hwp-easy-client-check-'));
 fs.rmSync(temporary,{recursive:true,force:true});
}
