// Developer diagnostics only. RSS belongs to OS processes, not a Worker isolate
// or an individual request. No command lines, environment or user data are read.
import { execFile } from 'node:child_process';
import fs from 'node:fs/promises';
import path from 'node:path';
import { promisify } from 'node:util';

const run = promisify(execFile);
const fail = () => { throw Error('LOCAL_PROCESS_MEMORY_UNAVAILABLE'); };
const integer = n => Number.isSafeInteger(n) && n >= 0;

export function summarizeProcessMemory(rows, rootPid) {
  if (!integer(rootPid) || rootPid < 1 || !Array.isArray(rows) || rows.length > 256) fail();
  const selected = [], seen = new Set();
  for (const row of rows) {
    if (!row || !integer(row.pid) || !integer(row.parent_pid)
        || !integer(row.rss_bytes) || typeof row.name !== 'string') fail();
    if (seen.has(row.pid)) fail();
    seen.add(row.pid);
    if (row.pid === rootPid || (row.parent_pid === rootPid && /^workerd(?:\.exe)?$/.test(row.name)))
      selected.push(row);
  }
  const driver = selected.find(row => row.pid === rootPid);
  if (!driver || driver.rss_bytes === 0) fail();
  const workerd = selected.filter(row => row.pid !== rootPid);
  const workerdRss = workerd.reduce((sum, row) => sum + row.rss_bytes, 0);
  if (!integer(workerdRss) || !integer(workerdRss + driver.rss_bytes)) fail();
  return { driver_rss_bytes: driver.rss_bytes, direct_workerd_processes: workerd.length,
    direct_workerd_rss_bytes: workerdRss, combined_process_rss_bytes: driver.rss_bytes + workerdRss };
}

async function linuxRows(rootPid) {
  const children = (await fs.readFile(`/proc/${rootPid}/task/${rootPid}/children`, 'utf8'))
    .trim().split(/\s+/).filter(Boolean).map(Number);
  if (children.length > 255 || !children.every(n => integer(n) && n > 0)) fail();
  const rows = [];
  for (const pid of [rootPid, ...children]) {
    try {
      const name = (await fs.readFile(`/proc/${pid}/comm`, 'utf8')).trim();
      if (pid !== rootPid && name !== 'workerd') continue;
      const status = await fs.readFile(`/proc/${pid}/status`, 'utf8');
      const parent = /^PPid:\s+(\d+)$/m.exec(status), rss = /^VmRSS:\s+(\d+) kB$/m.exec(status);
      if (!parent || !rss) fail();
      rows.push({ pid, parent_pid: Number(parent[1]), name, rss_bytes: Number(rss[1]) * 1024 });
    } catch (error) {
      // A child may have exited between discovery and inspection; a missing
      // driver or malformed reading must still fail instead of claiming zero.
      if (pid === rootPid || error.code !== 'ENOENT') throw error;
    }
  }
  return rows;
}

async function windowsRows(rootPid) {
  const executable = path.join(process.env.SystemRoot || 'C:\\Windows',
    'System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe');
  // rootPid is an integer validated by the public entrypoint. Restrict the OS
  // query to this driver and its immediate children; exclude the sampler itself.
  const command = `$ErrorActionPreference='Stop'; @(
    Get-CimInstance Win32_Process -Filter 'ProcessId=${rootPid} OR ParentProcessId=${rootPid}' |
    Select-Object @{n='pid';e={[long]$_.ProcessId}}, @{n='parent_pid';e={[long]$_.ParentProcessId}},
      @{n='name';e={$_.Name}}, @{n='rss_bytes';e={[long]$_.WorkingSetSize}}
  ) | ConvertTo-Json -Compress`;
  const { stdout } = await run(executable, ['-NoProfile', '-NonInteractive', '-Command', command],
    { windowsHide: true, timeout: 8000, maxBuffer: 64 * 1024, encoding: 'utf8' });
  const rows = JSON.parse(stdout.trim().replace(/^\uFEFF/, ''));
  return Array.isArray(rows) ? rows : [rows];
}

export async function sampleLocalProcessMemory() {
  try {
    const rows = process.platform === 'win32' ? await windowsRows(process.pid)
      : process.platform === 'linux' ? await linuxRows(process.pid) : fail();
    return { measured: true, ...summarizeProcessMemory(rows, process.pid) };
  } catch { return { measured: false, error: 'LOCAL_PROCESS_MEMORY_UNAVAILABLE' }; }
}
