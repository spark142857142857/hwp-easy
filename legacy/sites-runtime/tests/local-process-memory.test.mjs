import assert from 'node:assert/strict';
import test from 'node:test';
import { summarizeProcessMemory } from '../scripts/local-process-memory.mjs';

const driver = { pid: 10, parent_pid: 1, name: 'node.exe', rss_bytes: 100 };
test('process memory excludes the sampler, grandchildren and unrelated workerd', () => {
  const report = summarizeProcessMemory([driver,
    { pid: 11, parent_pid: 10, name: 'workerd.exe', rss_bytes: 200 },
    { pid: 12, parent_pid: 10, name: 'powershell.exe', rss_bytes: 900 },
    { pid: 13, parent_pid: 11, name: 'workerd', rss_bytes: 800 },
    { pid: 14, parent_pid: 1, name: 'workerd.exe', rss_bytes: 700 }], 10);
  assert.deepEqual(report, { driver_rss_bytes: 100, direct_workerd_processes: 1,
    direct_workerd_rss_bytes: 200, combined_process_rss_bytes: 300 });
  assert(!JSON.stringify(report).includes('powershell'));
  assert(!('pid' in report));
});
test('missing driver and invalid readings cannot become a zero-memory success', () => {
  for (const rows of [[], [{ ...driver, rss_bytes: 0 }], [{ ...driver, rss_bytes: -1 }],
    [{ ...driver, rss_bytes: NaN }], [{ ...driver, rss_bytes: '100' }]])
    assert.throws(() => summarizeProcessMemory(rows, 10), /^Error: LOCAL_PROCESS_MEMORY_UNAVAILABLE$/);
});
test('duplicate process IDs and accounting overflow cannot inflate a valid report', () => {
  assert.throws(() => summarizeProcessMemory([driver, driver], 10));
  assert.throws(() => summarizeProcessMemory([{ ...driver, rss_bytes: Number.MAX_SAFE_INTEGER },
    { pid: 11, parent_pid: 10, name: 'workerd', rss_bytes: 1 }], 10));
});
test('bounded discovery rejects excessive rows and invalid driver IDs', () => {
  assert.throws(() => summarizeProcessMemory(Array(257).fill(driver), 10));
  for (const pid of [0, -1, NaN, 1.5, '10']) assert.throws(() => summarizeProcessMemory([driver], pid));
});
test('a valid driver with no discovered workerd is distinct from a full runtime sample', () => {
  assert.equal(summarizeProcessMemory([driver], 10).direct_workerd_processes, 0);
});
