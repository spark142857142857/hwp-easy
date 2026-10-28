// Actual compiled Worker/D1/R2; synthetic font names and mocked identities.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { pathToFileURL } from 'node:url';
import { createHash } from 'node:crypto';
import { Miniflare, convertV4MiniflareOptions } from 'miniflare';
import { HwpDocument, initSync } from '@rhwp/core';
import { createEngineApi } from '../../../src/one_hwp/rhwp_api.mjs';
import { expectedEditedBlock } from '../../../src/one_hwp/text_font_selection.mjs';
import { createDocumentEngine } from '../../../src/one_hwp/engine/document.mjs';
import { readHwp } from '../../../src/one_hwp/guard/container.mjs';
import { parseRecords } from '../../../src/one_hwp/guard/records.mjs';
import { languageFontFixture } from '../tests/language-font-fixtures.mjs';
import { applyTestMigrations } from './migrations.mjs';

const require = createRequire(import.meta.url);
initSync({ module: fs.readFileSync(new URL('./rhwp_bg.wasm', pathToFileURL(require.resolve('@rhwp/core')))) });
const origin = 'https://language-font.invalid';
const owner = { 'oai-authenticated-user-id': 'language-font-a', 'oai-authenticated-user-email': 'a@example.invalid' };
const other = { ...owner, 'oai-authenticated-user-id': 'language-font-b' };
const sha = (bytes) => createHash('sha256').update(bytes).digest('hex');
const api = createEngineApi(HwpDocument), engine = createDocumentEngine(HwpDocument);
const fonts = (bytes) => [...parseRecords(readHwp(bytes).streams.get('DocInfo'))]
  .filter((record) => [19, 21].includes(record.tag)).map((record) => [record.tag, record.level, [...record.payload]]);
const mf = new Miniflare(convertV4MiniflareOptions({ compatibilityDate: '2026-10-01',
  modulesRoot: path.resolve('dist/server'), modules: [
    { type: 'ESModule', path: path.resolve('dist/server/index.js') },
    { type: 'CompiledWasm', path: path.resolve('dist/server/rhwp_bg.wasm') }],
  d1Databases: { DB: 'language-font-d1' }, r2Buckets: { BUCKET: 'language-font-r2' },
  bindings: { HWP_EASY_ORIGIN: origin, HWP_EASY_ALLOW_UPLOADS: 'true', HWP_EASY_FILE_ORIGINS: '[]' },
  outboundService: () => { throw new Error('UNEXPECTED_NETWORK'); } }));
const checks = [];
try {
  const db = await mf.getD1Database('DB'), bucket = await mf.getR2Bucket('BUCKET');
  await applyTestMigrations(db);
  const state = async () => ({ tables: await Promise.all(['hwp_documents', 'hwp_versions', 'hwp_requests', 'hwp_deletions']
    .map(async (table) => (await db.prepare(`SELECT * FROM ${table} ORDER BY owner, ${table === 'hwp_deletions' ? 'document_id' : 'id'}`).all()).results)),
  blobs: await Promise.all((await bucket.list()).objects.sort((a, b) => a.key.localeCompare(b.key)).map(async (object) =>
    ({ key: object.key, sha256: sha(new Uint8Array(await (await bucket.get(object.key)).arrayBuffer())) }))) });
  const rpc = async (name, args, identity = owner) => {
    const response = await mf.dispatchFetch(`${origin}/mcp`, { method: 'POST', headers: { ...identity, 'Content-Type': 'application/json' },
      body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name, arguments: args } }) });
    assert.equal(response.status, 200); return (await response.json()).result;
  };
  const call = async (...args) => { const result = await rpc(...args); assert(!result.isError); return result.structuredContent.data; };
  const download = async (version) => {
    const link = await call('hwp_download', { document_id: version.document_id, version_id: version.version_id });
    const response = await mf.dispatchFetch(link.download_url, { headers: owner }); assert.equal(response.status, 200);
    return new Uint8Array(await response.arrayBuffer());
  };
  for (const table of [false, true]) {
    const bytes = languageFontFixture(HwpDocument, api, { table });
    const response = await mf.dispatchFetch(`${origin}/documents/import`, { method: 'POST', headers: {
      ...owner, Origin: origin, 'Content-Type': 'application/x-hwp', 'hwp-request-id': crypto.randomUUID() }, body: bytes });
    assert.equal(response.status, 200); const first = await response.json();
    const version = { document_id: first.document_id, version_id: first.version_id }, before = await call('hwp_read', version);
    const targets = table ? before.blocks.filter((b) => b.kind === 'cell')
      : [before.blocks.find((b) => b.kind === 'paragraph' && b.text === '한글 원문')];
    const texts = table ? ['Latin change', 'Latin empty fill', '한글 변경', ''] : ['Latin change'];
    const edits = { expected_sha256: first.sha256, operations: targets.map((b, index) => ({
      target_id: b.target_id, expected_old: b.text, new_text: texts[index] })) };
    const baseline = await state(), planned = await call('hwp_plan', { ...version, ...edits });
    assert(planned.raw_preservation_verified); assert.equal(planned.saved, false);
    assert.deepEqual(await state(), baseline);
    const args = { document_id: first.document_id, expected_version: first.version_id, request_id: crypto.randomUUID(), ...edits };
    const saved = await call('hwp_edit', args); assert(saved.saved); assert(saved.raw_preservation_verified);
    const savedState = await state(), replay = await call('hwp_edit', args);
    assert(replay.replayed); assert.equal(replay.version_id, saved.version_id); assert.deepEqual(await state(), savedState);
    const output = await download(saved), opened = await engine.open(output), after = opened.read({ expected_sha256: saved.sha256 });
    assert.equal(sha(output), saved.sha256); assert.deepEqual(fonts(output), fonts(bytes));
    assert.deepEqual(after.blocks.map((b) => [b.id, b.text, b.style]), before.blocks.map((b) => {
      const index = targets.findIndex((target) => target.id === b.id), expected = index >= 0 ? expectedEditedBlock(b, texts[index], true) : b;
      return [expected.id, expected.text, expected.style];
    }));
    assert.deepEqual(await download(first), bytes);
    assert.equal((await call('hwp_versions', { document_id: first.document_id })).versions.length, 2);
    const denied = await rpc('hwp_read', { document_id: saved.document_id, version_id: saved.version_id }, other);
    assert(denied.isError); assert.equal(denied.content[0].text, 'DOCUMENT_OR_VERSION_NOT_FOUND');
    assert.deepEqual(await state(), savedState);
    const restored = await call('hwp_restore', { document_id: saved.document_id, expected_version: saved.version_id,
      source_version: first.version_id, request_id: crypto.randomUUID() });
    assert.equal(restored.sha256, first.sha256); assert.deepEqual(await download(restored), bytes);
    assert.equal((await call('hwp_versions', { document_id: first.document_id })).versions.length, 3);
    checks.push({ table, whole_text_preserved: true, exact_raw_font_records: true,
      plan_no_storage_mutation: true, exact_retry: true, old_version_retained: true, restore_original: true, mock_other_owner_denied: true });
  }
  console.log(JSON.stringify({ language_font_worker: 'passed', real_workerd_d1_r2_hwp: true,
    identity_headers_are_mocks_not_oauth: true, external_network_used: false, layout_verified: false, checks }));
} finally { await mf.dispose(); }
