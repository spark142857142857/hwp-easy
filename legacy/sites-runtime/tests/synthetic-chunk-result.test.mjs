import assert from 'node:assert/strict';
import test from 'node:test';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { spawn } from 'node:child_process';
import { HwpDocument, initSync } from '@rhwp/core';
import { transferFixture } from '../host/synthetic-transfer.mjs';
import { syntheticDownloadBytes } from '../host/synthetic-download.mjs';
import { documentChunkResource } from '../host/document-chunks.mjs';
import { readSyntheticChunkInput, verifySyntheticChunkResult, saveSyntheticChunkResult,
  MAX_SYNTHETIC_CHUNK_INPUT_BYTES } from '../client/synthetic-chunk-result.mjs';
const require = createRequire(import.meta.url);
initSync({ module: await fs.readFile(new URL('./rhwp_bg.wasm', pathToFileURL(require.resolve('@rhwp/core')))) });
const hash = async bytes => Buffer.from(await crypto.subtle.digest('SHA-256', bytes)).toString('hex');
async function bundle(bytes, retries = false) {
  const pin = { document_id: crypto.randomUUID(), version_id: crypto.randomUUID(),
    sha256: await hash(bytes), byte_size: bytes.length }, results = [];
  for (let offset = 0; offset < bytes.length; offset += 1024) {
    const p = await documentChunkResource(bytes, pin, { expected_sha256: pin.sha256, offset, max_bytes: 1024 });
    const result = { structuredContent: { stage: 'private-development', data: p.data },
      content: [{ type: 'text', text: 'ignored' }, p.resource], isError: false };
    results.push(result);
    if (retries && offset === 0) results.push({ result: structuredClone(result) });
  }
  return { schema_version: 1, pin, results };
}
async function temporary(t) {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'hwp-synthetic-chunks-'));
  t.after(async () => {
    // Check the exact newly created test root before recursive cleanup.
    assert.equal(path.dirname(path.resolve(directory)), path.resolve(os.tmpdir()));
    assert.match(path.basename(directory), /^hwp-synthetic-chunks-[A-Za-z0-9]+$/);
    await fs.rm(directory, { recursive: true, force: true });
  });
  return directory;
}

test('fixed source and edited HWP chunks reopen, reproduce independently, and publish complete files', async t => {
  const root = await temporary(t);
  for (const [variant, bytes] of [['fixed_source', transferFixture(HwpDocument)],
    ['fixed_edited', await syntheticDownloadBytes(HwpDocument)]]) {
    const report = await saveSyntheticChunkResult(await bundle(bytes, true), HwpDocument, root);
    assert.equal(report.variant, variant); assert.equal(report.unique_chunks, 13);
    assert.equal(report.exact_retries, 1); assert.equal(report.independently_reproduced_bytes_match, true);
    for (const key of ['native_client_transport_verified', 'native_file_attachment_verified',
      'codex_cloud_client_verified', 'dots_client_verified', 'layout_verified']) assert.equal(report[key], false);
    assert.deepEqual(await fs.readFile(report.path), Buffer.from(bytes));
  }
  const files = await fs.readdir(path.join(root, 'outputs', 'synthetic-chunks'));
  assert.equal(files.length, 2); assert(files.every(name => /^retrieved-[0-9a-f-]+\.hwp$/.test(name)));
});

test('missing, reordered, duplicate older and corrupted chunks never create output directories', async t => {
  const root = await temporary(t), good = await bundle(transferFixture(HwpDocument));
  const bad = [];
  const missing = structuredClone(good); missing.results.pop(); bad.push(missing);
  const reordered = structuredClone(good); [reordered.results[0], reordered.results[1]] =
    [reordered.results[1], reordered.results[0]]; bad.push(reordered);
  const older = structuredClone(good); older.results.splice(2, 0, older.results[0]); bad.push(older);
  const corrupted = structuredClone(good); corrupted.results[0].content[1].resource.blob =
    'AAAA' + corrupted.results[0].content[1].resource.blob.slice(4); bad.push(corrupted);
  for (const input of bad) await assert.rejects(saveSyntheticChunkResult(input, HwpDocument, root));
  assert.deepEqual(await fs.readdir(root), []);
});

test('version mixing, error results and ambiguous resource envelopes are rejected', async () => {
  const good = await bundle(transferFixture(HwpDocument));
  for (const mutate of [b => { b.results[1].structuredContent.data.version_id = crypto.randomUUID(); },
    b => { b.results[0].isError = true; }, b => { b.results[0].structuredContent.stage = 'production'; },
    b => { b.results[0].content.push(b.results[0].content[1]); },
    b => { b.results[0].content = []; }, b => { b.pin.byte_size++; }]) {
    const changed = structuredClone(good); mutate(changed);
    await assert.rejects(verifySyntheticChunkResult(changed, HwpDocument));
  }
});

test('self-consistent non-fixture bytes with their own hash cannot enter the synthetic helper', async t => {
  const root = await temporary(t), arbitrary = Buffer.alloc(13312, 5);
  await assert.rejects(saveSyntheticChunkResult(await bundle(arbitrary), HwpDocument, root));
  assert.deepEqual(await fs.readdir(root), []);
});

test('stdin accepts split UTF-8 JSON, rejects oversized, malformed and invalid UTF-8 input', async () => {
  const input = { note: '합성 시험', schema_version: 1 }, text = Buffer.from(JSON.stringify(input));
  async function* pieces() { for (const b of text) yield Buffer.of(b); }
  assert.deepEqual(await readSyntheticChunkInput(pieces()), input);
  async function* one(bytes) { yield bytes; }
  for (const bytes of [Buffer.alloc(MAX_SYNTHETIC_CHUNK_INPUT_BYTES + 1),
    Buffer.from('{'), Buffer.from([0xff])]) await assert.rejects(readSyntheticChunkInput(one(bytes)));
});

test('invalid bundle size and schema are rejected before engine or file publication', async () => {
  const good = await bundle(transferFixture(HwpDocument));
  for (const changed of [{ ...good, schema_version: 2 }, { ...good, results: [] },
    { ...good, results: Array(33).fill(good.results[0]) }, { ...good, pin: null }])
    await assert.rejects(verifySyntheticChunkResult(changed, HwpDocument));
});

test('output directory links are refused and unrelated files are preserved', async t => {
  const root = await temporary(t), outside = await temporary(t);
  const sentinel = path.join(outside, 'sentinel.txt'); await fs.writeFile(sentinel, 'keep');
  await fs.symlink(outside, path.join(root, 'outputs'), process.platform === 'win32' ? 'junction' : 'dir');
  await assert.rejects(saveSyntheticChunkResult(await bundle(transferFixture(HwpDocument)), HwpDocument, root));
  assert.deepEqual(await fs.readdir(outside), ['sentinel.txt']);
  assert.equal(await fs.readFile(sentinel, 'utf8'), 'keep');
});

test('CLI accepts bounded MCP JSON over stdin and refuses source/destination arguments', async () => {
  const script = fileURLToPath(new URL('../scripts/save-chunk-result.mjs', import.meta.url));
  const run = (input, args = []) => new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [script, ...args], { stdio: ['pipe', 'pipe', 'pipe'], windowsHide: true });
    let stdout = '', stderr = '';
    child.stdout.on('data', b => { stdout += b; }); child.stderr.on('data', b => { stderr += b; });
    child.on('error', reject); child.on('close', code => resolve({ code, stdout, stderr }));
    child.stdin.on('error', e => { if (e.code !== 'EPIPE') reject(e); });
    child.stdin.end(JSON.stringify(input));
  });
  const input = await bundle(transferFixture(HwpDocument), true), valid = await run(input);
  assert.equal(valid.code, 0); assert.equal(valid.stderr, '');
  const report = JSON.parse(valid.stdout);
  try { assert.equal(await hash(await fs.readFile(report.path)), input.pin.sha256); }
  finally { await fs.unlink(report.path); }
  const denied = await run(input, ['personal.hwp']);
  assert.equal(denied.code, 1); assert.equal(denied.stdout, '');
  assert.match(denied.stderr, /^Fixed synthetic chunk verification failed;/);
});
