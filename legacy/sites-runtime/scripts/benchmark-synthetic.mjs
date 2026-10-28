// Opt-in developer measurement, not a product CLI or timing threshold in CI.
// Accepts no user paths. Each fixed workload gets a fresh bounded child process.
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawn } from 'node:child_process';
import os from 'node:os';
import { performanceCases } from './performance-fixtures.mjs';

if (process.argv.length !== 2) throw Error('Synthetic benchmark accepts no arguments');
const root = fileURLToPath(new URL('../../../', import.meta.url));
const probe = fileURLToPath(new URL('../', import.meta.url));
const caseScript = fileURLToPath(new URL('./benchmark-synthetic-case.mjs', import.meta.url));
const workerScript = fileURLToPath(new URL('./check-performance-limits.mjs', import.meta.url));

async function child(script, args) {
  return new Promise((resolve) => {
    const processChild = spawn(process.execPath, ['--expose-gc', '--max-old-space-size=256', script, ...args],
      { cwd: probe, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe', 'ipc'] });
    let output = '', timedOut = false, outputExceeded = false, lastPhase, iteration = 0;
    const completedPhases = [];
    processChild.on('message', (message) => {
      if (typeof message?.phase === 'string') lastPhase = message.phase;
      if (Number.isSafeInteger(message?.completed_iteration)) iteration = message.completed_iteration + 1;
      if (typeof message?.completed_phase === 'string') completedPhases.push({ iteration, ...message });
    });
    const timer = setTimeout(() => { timedOut = true; processChild.kill(); }, 60000);
    processChild.stdout.on('data', (chunk) => {
      output += chunk;
      if (output.length > 1024 * 1024) { outputExceeded = true; processChild.kill(); }
    });
    // Upstream stderr can contain WASM messages. Drain without retaining/logging.
    processChild.stderr.resume();
    processChild.on('error', () => {});
    processChild.on('close', (code) => {
      clearTimeout(timer);
      if (timedOut || outputExceeded || code !== 0) return resolve({ status: timedOut ? 'limited' : 'failed',
        completed_phases: completedPhases, engine_operation_timeout_proven: false,
        last_phase: lastPhase,
        reason_code: timedOut ? 'BENCHMARK_CHILD_TIMEOUT' : outputExceeded ? 'BENCHMARK_OUTPUT_LIMIT' : 'BENCHMARK_CHILD_FAILED' });
      try { resolve(JSON.parse(output)); }
      catch { resolve({ status: 'failed', reason_code: 'BENCHMARK_RESULT_INVALID' }); }
    });
  });
}

const cases = [];
for (const name of performanceCases) {
  const result = await child(caseScript, [name]);
  cases.push({ case: name, ...result });
  console.log(JSON.stringify({ synthetic_case: name, status: result.status ?? 'measured',
    input_bytes: result.input_bytes, iterations: result.samples?.length }));
}
const worker = await child(workerScript, []);
const completed = (item) => item.samples?.length && item.samples.every((sample) =>
  ['passed', 'expected_rejection'].includes(sample.status));
const passed = cases.every(completed) && worker.status === 'passed';
const limited = !passed && cases.every((item) => completed(item) || item.status === 'limited') && worker.status === 'passed';
const report = { schema_version: 1, recorded_at: new Date().toISOString(), status: passed ? 'passed' : limited ? 'limited' : 'failed',
  host: { platform: process.platform, arch: process.arch, node: process.version, engine: '0.8.6',
    cpu_model: os.cpus()[0]?.model, logical_cpus: os.cpus().length },
  method: { synthetic_only: true, uploaded_to_hosted_site: false, child_timeout_ms: 60000,
    child_v8_old_space_mib: 256, memory_samples_are_phase_endpoints: true,
    process_peak_rss_includes_init_fixture_and_measurement: true,
    wasm_linear_bytes_is_capacity_not_live_allocations: true, gc_between_node_iterations: true,
    first_iteration_separate_from_subsequent_iterations: true,
    total_deployed_worker_isolate_memory_measured: false, layout_verified: false,
    hosted_latency_measured: false, hosted_cost_measured: false }, cases, worker };
const destination = path.join(root, 'outputs', 'synthetic-performance');
// No link traversal or replacement of an existing report; only our fixed path.
for (const segment of [root, path.join(root, 'outputs'), destination]) {
  if (segment !== root) await fs.mkdir(segment).catch((error) => { if (error.code !== 'EEXIST') throw error; });
  const stat = await fs.lstat(segment);
  if (!stat.isDirectory() || stat.isSymbolicLink()) throw Error('BENCHMARK_OUTPUT_PATH_REJECTED');
}
const filename = `measurement-${new Date().toISOString().replace(/[:.]/g, '-')}.json`;
await fs.writeFile(path.join(destination, filename), JSON.stringify(report, null, 2) + '\n', { flag: 'wx' });
console.log(JSON.stringify({ status: report.status, report: `outputs/synthetic-performance/${filename}`,
  total_deployed_worker_isolate_memory_measured: false }));
if (!passed) process.exitCode = limited ? 2 : 1;
