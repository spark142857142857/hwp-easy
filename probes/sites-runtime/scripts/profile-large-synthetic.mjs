// Separate opt-in diagnostic. The standard benchmark retains its 60s total cap.
// Fixed synthetic input only, one iteration, no production settings or upload.
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawn } from 'node:child_process';
import os from 'node:os';
if (process.argv.length !== 2) throw Error('INVALID_ARGUMENTS');
const root = fileURLToPath(new URL('../../../', import.meta.url));
const probe = fileURLToPath(new URL('../', import.meta.url));
const script = fileURLToPath(new URL('./benchmark-synthetic-case.mjs', import.meta.url));
const completed_phases = [];
const result = await new Promise((resolve) => {
  const child = spawn(process.execPath, ['--expose-gc', '--max-old-space-size=256', script, 'entropy1200k', '--single-large'],
    { cwd: probe, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe', 'ipc'] });
  let output = '', last_phase = 'init', reason_code, stageTimer;
  const stop = (reason) => { reason_code ??= reason; child.kill(); };
  const armStage = () => {
    clearTimeout(stageTimer);
    stageTimer = setTimeout(() => stop('DIAGNOSTIC_STAGE_TIMEOUT'), 45000);
  };
  const totalTimer = setTimeout(() => stop('DIAGNOSTIC_TOTAL_TIMEOUT'), 180000);
  armStage();
  child.on('message', (message) => {
    if (typeof message?.phase === 'string') { last_phase = message.phase; armStage(); }
    if (typeof message?.completed_phase === 'string') {
      completed_phases.push(message);
      console.log(JSON.stringify({ completed_phase: message.completed_phase, duration_ms: message.duration_ms }));
      // GC and bookkeeping are also bounded between measured phases.
      armStage();
    }
  });
  child.stdout.on('data', (chunk) => {
    output += chunk;
    if (output.length > 1024 * 1024) stop('DIAGNOSTIC_OUTPUT_LIMIT');
  });
  child.stderr.resume();
  child.on('error', () => { reason_code ??= 'DIAGNOSTIC_CHILD_FAILED'; });
  child.on('close', (code) => {
    clearTimeout(stageTimer); clearTimeout(totalTimer);
    if (reason_code || code !== 0) return resolve({ status: reason_code?.endsWith('TIMEOUT') ? 'limited' : 'failed',
      reason_code: reason_code ?? 'DIAGNOSTIC_CHILD_FAILED', last_phase, completed_phases });
    try {
      const measured = JSON.parse(output);
      if (measured.case !== 'entropy1200k' || measured.samples?.length !== 1 || measured.samples[0].status !== 'passed') throw Error();
      resolve({ status: 'passed', ...measured });
    } catch { resolve({ status: 'failed', reason_code: 'DIAGNOSTIC_RESULT_INVALID', last_phase, completed_phases }); }
  });
});
const report = { schema_version: 1, recorded_at: new Date().toISOString(),
  host: { platform: process.platform, arch: process.arch, node: process.version, cpu_model: os.cpus()[0]?.model },
  method: { single_iteration: true, stage_timeout_ms: 45000, total_timeout_ms: 180000,
    fixture_generation_separate: true, uploaded_to_hosted_site: false,
    deployed_worker_memory_measured: false, production_limits_changed: false, layout_verified: false }, ...result };
const destination = path.join(root, 'outputs', 'synthetic-performance');
for (const segment of [root, path.join(root, 'outputs'), destination]) {
  if (segment !== root) await fs.mkdir(segment).catch((error) => { if (error.code !== 'EEXIST') throw error; });
  const stat = await fs.lstat(segment);
  if (!stat.isDirectory() || stat.isSymbolicLink()) throw Error('DIAGNOSTIC_OUTPUT_PATH_REJECTED');
}
const filename = `large-profile-${new Date().toISOString().replace(/[:.]/g, '-')}.json`;
await fs.writeFile(path.join(destination, filename), JSON.stringify(report, null, 2) + '\n', { flag: 'wx' });
console.log(JSON.stringify({ status: report.status, report: `outputs/synthetic-performance/${filename}` }));
if (report.status !== 'passed') process.exitCode = report.status === 'limited' ? 2 : 1;
