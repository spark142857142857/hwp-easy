/** Version-checked local publication; no uploads, account or configuration changes. */
import fs from 'node:fs';
import path from 'node:path';
import { createHash, randomUUID } from 'node:crypto';
import { GuardError } from '../../probes/sites-runtime/guard/records.mjs';
const fail = code => { throw new GuardError(code); };
export const digest = data => createHash('sha256').update(data).digest('hex');
const MAX_BYTES = 4 * 1024 * 1024;
const key = p => process.platform === 'win32' ? p.toLowerCase() : p;
const hash = h => typeof h === 'string' && /^[0-9a-f]{64}$/.test(h);
const identity = s => `${s.dev}:${s.ino}:${s.size}:${s.mtimeMs}:${s.ctimeMs}`;
function safePath(value, { missing = false, hwp = true, directory = false } = {}) {
  if (typeof value !== 'string' || !path.isAbsolute(value) || value.includes('\0')
    || value.split(/[\\/]/).includes('..') || (hwp && path.extname(value).toLowerCase() !== '.hwp')) fail('INVALID_LOCAL_PATH');
  const resolved = path.resolve(value), root = path.parse(resolved).root;
  let current = root;
  for (const part of resolved.slice(root.length).split(path.sep)) {
    current = path.join(current, part);
    let stat;
    try { stat = fs.lstatSync(current); }
    catch (error) { if (missing && current === resolved && error.code === 'ENOENT') return resolved; throw error; }
    if (stat.isSymbolicLink()) fail('LINKED_PATH_NOT_ALLOWED');
    if (current !== resolved && !stat.isDirectory()) fail('INVALID_LOCAL_PATH');
    if (current === resolved && (directory ? !stat.isDirectory() : !stat.isFile())) fail('INVALID_LOCAL_PATH');
    if (stat.isFile() && stat.nlink !== 1) fail('LINKED_PATH_NOT_ALLOWED');
  }
  return resolved;
}
export function readLocal(value, expected) {
  return readSnapshot(value,expected,true);
}
export function readImageLocal(value,expected) {
  if(typeof value!=='string'||!['.png','.jpg','.jpeg'].includes(path.extname(value).toLowerCase())||!hash(expected))fail('INVALID_IMAGE_FILE');
  const snapshot=readSnapshot(value,expected,false);
  if(snapshot.bytes.length>1048576)fail('IMAGE_LIMIT_EXCEEDED');
  return snapshot;
}
function readSnapshot(value, expected, hwp) {
  if (expected !== undefined && !hash(expected)) fail('INVALID_VERSION');
  const source = safePath(value,{hwp}), initial = fs.lstatSync(source);
  const fd = fs.openSync(source, fs.constants.O_RDONLY | (fs.constants.O_NOFOLLOW ?? 0));
  try {
    const before = fs.fstatSync(fd);
    if (identity(initial) !== identity(before) || !before.isFile() || before.nlink !== 1) fail('VERSION_CONFLICT');
    if (before.size > MAX_BYTES) fail('INPUT_LIMIT_EXCEEDED');
    const bytes = fs.readFileSync(fd);
    if (identity(before) !== identity(fs.fstatSync(fd)) || identity(before) !== identity(fs.lstatSync(source))) fail('VERSION_CONFLICT');
    const sha256 = digest(bytes);
    if (expected !== undefined && sha256 !== expected) fail('VERSION_CONFLICT');
    return { source, sha256, bytes, identity: identity(before), mode: before.mode & 0o777 };
  } finally { fs.closeSync(fd); }
}
function checkedCurrent(snapshot) {
  const fresh = readLocal(snapshot.source, snapshot.sha256);
  if (fresh.identity !== snapshot.identity) fail('VERSION_CONFLICT');
}
function writeExclusive(destination, bytes, mode = 0o600) {
  const fd = fs.openSync(destination, fs.constants.O_WRONLY | fs.constants.O_CREAT | fs.constants.O_EXCL, mode);
  try { fs.writeFileSync(fd, bytes); fs.fsyncSync(fd); } finally { fs.closeSync(fd); }
}
function backupDirectory(source) {
  const directory = path.join(path.dirname(source), '.hwp-easy-backups');
  if (!fs.existsSync(directory)) fs.mkdirSync(directory, { mode: 0o700 });
  safePath(directory, { hwp: false, directory: true });
  return directory;
}
function privateRead(file, maxBytes) {
  safePath(file, { hwp: false });
  const fd = fs.openSync(file, fs.constants.O_RDONLY | (fs.constants.O_NOFOLLOW ?? 0));
  try {
    if (fs.fstatSync(fd).size > maxBytes) fail('BACKUP_INVALID');
    return fs.readFileSync(fd);
  } finally { fs.closeSync(fd); }
}
function backup(snapshot, directory) {
  const id = randomUUID(), file = path.join(directory, `${id}.hwp`);
  writeExclusive(file, snapshot.bytes);
  if (digest(privateRead(file, MAX_BYTES)) !== snapshot.sha256) fail('BACKUP_INVALID');
  writeExclusive(path.join(directory, `${id}.json`), Buffer.from(JSON.stringify({
    format: 1, source: key(snapshot.source), sha256: snapshot.sha256,
  })));
  return id;
}
function syncDirectory(directory) {
  if (process.platform === 'win32') return;
  let fd;
  try { fd = fs.openSync(directory, 'r'); fs.fsyncSync(fd); }
  finally { if (fd !== undefined) fs.closeSync(fd); }
}
export function saveLocal(snapshot, bytes, { output, expected_output_sha256 } = {}) {
  if (!(bytes instanceof Uint8Array) || bytes.length > MAX_BYTES) fail('OUTPUT_LIMIT_EXCEEDED');
  const target = safePath(output ?? snapshot.source, { missing: true }), same = key(target) === key(snapshot.source);
  if (expected_output_sha256 !== undefined && !hash(expected_output_sha256)) fail('INVALID_VERSION');
  let destination;
  if (fs.existsSync(target)) destination = readLocal(target);
  const expected = same ? snapshot.sha256 : expected_output_sha256;
  if (destination && (!expected || destination.sha256 !== expected)) fail('VERSION_CONFLICT');
  if (!destination && expected !== undefined) fail('VERSION_CONFLICT');
  if (same && expected_output_sha256 !== undefined && expected_output_sha256 !== snapshot.sha256) fail('VERSION_CONFLICT');
  const directory = backupDirectory(target), lock = path.join(directory, `${digest(Buffer.from(key(target)))}.lock`);
  let locked = false, temporary;
  try {
    try { writeExclusive(lock, Buffer.from('HWP Easy local save\n')); locked = true; }
    catch (error) { if (error.code === 'EEXIST') fail('DOCUMENT_BUSY'); throw error; }
    checkedCurrent(snapshot);
    if (destination) checkedCurrent(destination);
    temporary = path.join(path.dirname(target), `.hwp-easy-${randomUUID()}.tmp`);
    writeExclusive(temporary, bytes, destination?.mode ?? 0o600);
    if (digest(privateRead(temporary, MAX_BYTES)) !== digest(bytes)) fail('OUTPUT_VERIFICATION_FAILED');
    const backup_id = destination ? backup(destination, directory) : null;
    syncDirectory(directory);
    checkedCurrent(snapshot); if (destination) checkedCurrent(destination);
    safePath(target, { missing: true });
    if (destination) fs.renameSync(temporary, target);
    else { fs.linkSync(temporary, target); fs.unlinkSync(temporary); }
    temporary = undefined;
    syncDirectory(path.dirname(target));
    const published = readLocal(target, digest(bytes));
    return { source: snapshot.source, source_sha256: snapshot.sha256, saved_path: published.source,
      output_sha256: published.sha256, saved: true, save_mode: same ? 'same_file' : 'save_as',
      selected_file_updated: same, file_location: 'current_execution_environment', backup_id, persistence: 'local_file',
      warnings: ['Version checks guard ordinary concurrent edits; this is not an operating-system transaction with unrelated applications.',
        ...(process.platform === 'win32' ? ['Inherited Windows file ACLs and power-loss durability are not independently certified.'] : [])] };
  } finally {
    if (temporary && fs.existsSync(temporary)) fs.unlinkSync(temporary);
    if (locked) fs.unlinkSync(lock);
  }
}
export function restoreLocal(snapshot, backup_id) {
  if (typeof backup_id !== 'string' || !/^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/.test(backup_id)) fail('BACKUP_INVALID');
  const directory = backupDirectory(snapshot.source);
  const metadata = JSON.parse(privateRead(path.join(directory, `${backup_id}.json`), 4096).toString('utf8'));
  const bytes = privateRead(path.join(directory, `${backup_id}.hwp`), MAX_BYTES);
  if (metadata.format !== 1 || metadata.source !== key(snapshot.source) || metadata.sha256 !== digest(bytes)) fail('BACKUP_INVALID');
  return { bytes, publish: () => saveLocal(snapshot, bytes) };
}
