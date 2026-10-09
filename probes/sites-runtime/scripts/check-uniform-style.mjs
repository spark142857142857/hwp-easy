// Actual local compiled Worker/D1/R2, fixed synthetic input, mocked identities.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { pathToFileURL } from 'node:url';
import { createHash } from 'node:crypto';
import { Miniflare, convertV4MiniflareOptions } from 'miniflare';
import { HwpDocument, initSync } from '@rhwp/core';
import { createEngineApi } from '../../../src/one_hwp/rhwp_api.mjs';
import { syntheticFixture } from '../../../src/one_hwp/synthetic_fixtures.mjs';
import { applyTestMigrations } from './migrations.mjs';

const record = process.argv.length === 3 && process.argv[2] === '--record';
if (process.argv.length !== 2 && !record) throw Error('INVALID_ARGUMENTS');
const require = createRequire(import.meta.url);
initSync({ module: fs.readFileSync(new URL('./rhwp_bg.wasm', pathToFileURL(require.resolve('@rhwp/core')))) });
const api = createEngineApi(HwpDocument), origin = 'https://uniform-style.invalid';
const texts = ['합성', '가'.repeat(100000), '가'.repeat(99999), '가'.repeat(99999), '가'.repeat(99999), '끝'];
const bytes = syntheticFixture(HwpDocument, api.exportChecked, { table: false, paragraphs: texts }), original = bytes.slice();
const owner = { 'oai-authenticated-user-id': 'uniform-style-a', 'oai-authenticated-user-email': 'a@example.invalid' };
const other = { ...owner, 'oai-authenticated-user-id': 'uniform-style-b' };
const sha = b => createHash('sha256').update(b).digest('hex');
const mf = new Miniflare(convertV4MiniflareOptions({ compatibilityDate: '2026-10-01',
  modulesRoot: path.resolve('dist/server'), modules: [
    { type: 'ESModule', path: path.resolve('dist/server/index.js') },
    { type: 'CompiledWasm', path: path.resolve('dist/server/rhwp_bg.wasm') }],
  d1Databases: { DB: 'uniform-style-d1' }, r2Buckets: { BUCKET: 'uniform-style-r2' },
  bindings: { HWP_EASY_ORIGIN: origin, HWP_EASY_ALLOW_UPLOADS: 'true', HWP_EASY_FILE_ORIGINS: '[]' },
  outboundService: () => { throw Error('UNEXPECTED_NETWORK'); } }));
try {
  const db = await mf.getD1Database('DB'), bucket = await mf.getR2Bucket('BUCKET'); await applyTestMigrations(db);
  const state = async () => ({ tables: await Promise.all(['hwp_documents', 'hwp_versions', 'hwp_requests', 'hwp_deletions']
    .map(async table => (await db.prepare(`SELECT * FROM ${table} ORDER BY owner, ${table === 'hwp_deletions' ? 'document_id' : 'id'}`).all()).results)),
  blobs: await Promise.all((await bucket.list()).objects.sort((a, b) => a.key.localeCompare(b.key)).map(async object =>
    ({ key: object.key, sha256: sha(new Uint8Array(await (await bucket.get(object.key)).arrayBuffer())) }))) });
  const rpc = async (name, args, identity = owner) => {
    const response = await mf.dispatchFetch(origin + '/mcp', { method: 'POST', headers: { ...identity, 'Content-Type': 'application/json' },
      body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name, arguments: args } }) });
    assert.equal(response.status, 200); return (await response.json()).result;
  };
  const call = async (...args) => { const result = await rpc(...args); assert(!result.isError, result.structuredContent?.data?.error ?? 'Synthetic tool rejected'); return result.structuredContent.data; };
  const download = async v => {
    const link = await call('hwp_download', { document_id: v.document_id, version_id: v.version_id });
    const response = await mf.dispatchFetch(link.download_url, { headers: owner }); assert.equal(response.status, 200);
    const data = new Uint8Array(await response.arrayBuffer()); assert.equal(sha(data), v.sha256); return data;
  };
  const read = async v => {
    let cursor, complete = false, pages = 0; const blocks = new Map();
    do {
      const result = await call('hwp_read', { document_id: v.document_id, version_id: v.version_id,
        max_chars: 64000, ...(cursor ? { cursor } : {}) });
      assert.equal(result.source_sha256, v.sha256);
      for (const b of result.blocks) {
        const prior = blocks.get(b.id);
        assert.equal(b.start_offset, prior ? [...prior.text].length : 0);
        blocks.set(b.id, { ...b, text: (prior?.text ?? '') + b.text });
      }
      cursor = result.next_cursor; complete = result.content_complete; pages++;
    } while (cursor);
    assert(complete); return { blocks: [...blocks.values()], pages };
  };
  const response = await mf.dispatchFetch(origin + '/documents/import', { method: 'POST', headers: {
    ...owner, Origin: origin, 'Content-Type': 'application/x-hwp', 'hwp-request-id': crypto.randomUUID() }, body: bytes });
  assert.equal(response.status, 200); const first = await response.json();
  assert.equal(first.sha256, sha(bytes)); const before = await read(first);
  assert.deepEqual(before.blocks.map(b => b.text), texts);
  assert.equal(before.blocks.reduce((n, b) => n + b.text.length, 0), 400000);
  const target = before.blocks.at(-1), request = { expected_sha256: first.sha256,
    operations: [{ target_id: target.target_id, expected_old: target.text, new_text: '검' }] };
  const baseline = await state(), planned = await call('hwp_plan', { document_id: first.document_id, version_id: first.version_id, ...request });
  assert(planned.raw_preservation_verified); assert.equal(planned.saved, false); assert.deepEqual(await state(), baseline);
  const args = { document_id: first.document_id, expected_version: first.version_id, request_id: crypto.randomUUID(), ...request };
  const saved = await call('hwp_edit', args); assert(saved.saved && saved.raw_preservation_verified);
  const savedState = await state(), replay = await call('hwp_edit', args);
  assert(replay.replayed); assert.equal(replay.version_id, saved.version_id); assert.deepEqual(await state(), savedState);
  const output = await download(saved), after = await read(saved);
  assert.deepEqual(after.blocks.map(b => [b.id, b.text, b.style]), before.blocks.map(b =>
    [b.id, b.id === target.id ? '검' : b.text, b.style]));
  assert.deepEqual(await download(first), bytes);
  const denied = await rpc('hwp_read', { document_id: saved.document_id, version_id: saved.version_id }, other);
  assert(denied.isError); assert.equal(denied.content[0].text, 'DOCUMENT_OR_VERSION_NOT_FOUND'); assert.deepEqual(await state(), savedState);
  const restored = await call('hwp_restore', { document_id: saved.document_id, expected_version: saved.version_id,
    source_version: first.version_id, request_id: crypto.randomUUID() });
  const restoredBytes = await download(restored); assert.deepEqual(restoredBytes, bytes);
  assert.equal((await call('hwp_versions', { document_id: first.document_id })).versions.length, 3);
  assert.deepEqual(bytes, original);
  let recorded;
  if (record) {
    recorded = path.resolve('../../outputs/uniform-style-check', String(Date.now())); fs.mkdirSync(recorded, { recursive: true });
    fs.writeFileSync(path.join(recorded, 'source.hwp'), bytes, { flag: 'wx' });
    fs.writeFileSync(path.join(recorded, 'edited.hwp'), output, { flag: 'wx' });
    fs.writeFileSync(path.join(recorded, 'restored.hwp'), restoredBytes, { flag: 'wx' });
    fs.writeFileSync(path.join(recorded, 'source-model.json'), JSON.stringify({ blocks: before.blocks,
      operations: [{ target_id: target.id, expected_old: target.text, new_text: '검' }] }), { flag: 'wx' });
  }
  console.log(JSON.stringify({ uniform_style_worker: 'passed', utf16_units: 400000,
    read_pages: before.pages, checked_save_download_and_restore: true, exact_retry: true,
    plan_and_denial_storage_unchanged: true, mock_other_owner_denied: true,
    real_local_workerd_d1_r2: true, actual_oauth_verified: false, network_used: false,
    production_cpu_measured: false, layout_verified: false, recorded }));
} finally { await mf.dispose(); }
