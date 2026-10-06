// Local compiled production Worker with real D1/R2/WASM. Identity, file
// delivery and DOM are mocks. Synthetic-only; no network or deployed changes.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { createRequire } from 'node:module';
import { pathToFileURL } from 'node:url';
import { createHash } from 'node:crypto';
import { Miniflare, convertV4MiniflareOptions } from 'miniflare';
import { HwpDocument, initSync } from '@rhwp/core';
import { createEngineApi } from '../../../src/one_hwp/rhwp_api.mjs';
import { syntheticFixture } from '../../../src/one_hwp/synthetic_fixtures.mjs';
import { createVersionStore } from '../storage/store.mjs';
import { authenticatedOwner } from '../host/transfer.mjs';
import { uploadClientHarness } from '../tests/upload-client-fixtures.mjs';
import { makeRawTextLimitFixture } from './performance-fixtures.mjs';
import { applyTestMigrations } from './migrations.mjs';

if (process.argv.length !== 2) throw Error('Synthetic workload check accepts no arguments');
const require = createRequire(import.meta.url);
initSync({ module: fs.readFileSync(new URL('./rhwp_bg.wasm', pathToFileURL(require.resolve('@rhwp/core')))) });
const api = createEngineApi(HwpDocument), origin = 'https://workload.invalid', fileOrigin = 'https://files.example.invalid';
const small = syntheticFixture(HwpDocument, api.exportChecked,
  { paragraphs: ['a', 'b', 'c'], cells: [['😀', 'b\nc'], ['d', 'e']] });
// Negative admission only, never claimed as an editable/layout-valid corpus.
const oversized = makeRawTextLimitFixture(1200000, HwpDocument, api);
const overBoundary = makeRawTextLimitFixture(400001, HwpDocument, api);
const digest = bytes => createHash('sha256').update(bytes).digest('hex');
let mockedFetches = 0;
const mf = new Miniflare(convertV4MiniflareOptions({ compatibilityDate: '2026-10-01',
  modulesRoot: path.resolve('dist/server'), modules: [
    { type: 'ESModule', path: path.resolve('dist/server/index.js') },
    { type: 'CompiledWasm', path: path.resolve('dist/server/rhwp_bg.wasm') }],
  d1Databases: { DB: 'hosted-workload-d1' }, r2Buckets: { BUCKET: 'hosted-workload-r2' },
  bindings: { HWP_EASY_ORIGIN: origin, HWP_EASY_ALLOW_UPLOADS: 'true',
    HWP_EASY_FILE_ORIGINS: JSON.stringify([fileOrigin]) },
  outboundService: request => {
    assert.equal(request.url, fileOrigin + '/synthetic');
    mockedFetches++; return new Response(oversized);
  } }));
const identity = { 'oai-authenticated-user-id': 'synthetic-workload-owner',
  'oai-authenticated-user-email': 'synthetic@example.invalid' };
const checks = [];
try {
  const db = await mf.getD1Database('DB'), bucket = await mf.getR2Bucket('BUCKET');
  await applyTestMigrations(db);
  const store = createVersionStore(db, bucket), owner = await authenticatedOwner(new Headers(identity));
  // Explicit test setup bypasses service admission to represent a pre-limit
  // stored version. Production handlers never expose this bypass.
  const legacy = await store.create({ owner, request_id: crypto.randomUUID(), bytes: oversized });
  const current = await store.replace({ owner, document_id: legacy.document_id, expected_version: legacy.version_id,
    request_id: crypto.randomUUID(), bytes: small, intent_sha256: digest(small) });
  const state = async () => {
    const rows = {};
    for (const table of ['hwp_documents', 'hwp_versions', 'hwp_requests', 'hwp_deletions']) {
      rows[table] = (await db.prepare(`SELECT * FROM ${table}`).all()).results
        .sort((a, b) => JSON.stringify(a).localeCompare(JSON.stringify(b)));
    }
    const blobs = [];
    for (const object of (await bucket.list()).objects.sort((a, b) => a.key.localeCompare(b.key))) {
      blobs.push({ key: object.key, sha256: digest(new Uint8Array(await (await bucket.get(object.key)).arrayBuffer())) });
    }
    return { rows, blobs };
  };
  const baseline = await state(), intact = async () => assert.deepEqual(await state(), baseline);
  const call = async (name, args) => {
    const response = await mf.dispatchFetch(origin + '/mcp', { method: 'POST',
      headers: { ...identity, 'Content-Type': 'application/json' }, body: JSON.stringify({ jsonrpc: '2.0',
        id: 1, method: 'tools/call', params: { name, arguments: args } }) });
    assert.equal(response.status, 200); return (await response.json()).result;
  };
  const success = async (name, args) => {
    const result = await call(name, args); assert.equal(result.isError, undefined);
    return result.structuredContent.data;
  };
  const denied = async (name, args) => {
    const result = await call(name, args);
    assert.equal(result.isError, true); assert.equal(result.content[0].text, 'HOSTED_WORKLOAD_LIMIT_EXCEEDED');
    const diagnostic = result.structuredContent.data.workload_diagnostic;
    assert.equal(diagnostic.max_body_text_utf16_code_units, 400000);
    assert.equal(diagnostic.saved, false); assert.equal(diagnostic.retry_same_request_recommended, false);
    assert.equal(diagnostic.automatic_partial_save_allowed, false);
    await intact();
  };
  const upload = (bytes, requestId) => mf.dispatchFetch(origin + '/documents/import', { method: 'POST',
    headers: { ...identity, Origin: origin, 'Content-Type': 'application/x-hwp', 'hwp-request-id': requestId }, body: bytes });
  for (const bytes of [overBoundary, oversized]) {
    const requestId = crypto.randomUUID();
    for (let attempt = 0; attempt < 2; attempt++) {
      const response = await upload(bytes, requestId);
      assert.equal(response.status, 400); assert.equal((await response.json()).error, 'HOSTED_WORKLOAD_LIMIT_EXCEEDED');
      await intact();
    }
  }
  checks.push('400001_and_1200000_unit_upload_rejection_preserves_all_rows_and_blobs');
  const imported = { file: { file_id: 'synthetic', download_url: fileOrigin + '/synthetic' }, request_id: crypto.randomUUID() };
  await denied('hwp_import', imported); await denied('hwp_import', imported);
  assert.equal(mockedFetches, 2); // Exactly the two explicit calls, no automatic fetch retry.
  checks.push('import_same_uuid_refusal_has_no_receipt_or_automatic_fetch_retry');

  const before = await success('hwp_read', { document_id: current.document_id, version_id: current.version_id });
  assert.equal(before.content_complete, true);
  const targets = before.blocks.filter(b => b.editable).slice(0, 6);
  assert(targets.some(b => b.kind === 'paragraph')); assert(targets.some(b => b.kind === 'cell'));
  const operations = targets.map(b => ({ target_id: b.target_id, expected_old: b.text, new_text: '가'.repeat(80000) }));
  const request = { expected_sha256: current.sha256, operations };
  await denied('hwp_plan', { document_id: current.document_id, version_id: current.version_id, ...request });
  const edit = { document_id: current.document_id, expected_version: current.version_id, request_id: crypto.randomUUID(), ...request };
  await denied('hwp_edit', edit); await denied('hwp_edit', edit);
  checks.push('projected_mixed_paragraph_cell_edit_and_plan_refusal_preserve_current_and_history');

  const restore = { document_id: current.document_id, expected_version: current.version_id,
    source_version: legacy.version_id, request_id: crypto.randomUUID() };
  await denied('hwp_restore', restore); await denied('hwp_restore', restore);
  await denied('hwp_read', { document_id: legacy.document_id, version_id: legacy.version_id });
  await denied('hwp_edit', { ...edit, expected_version: legacy.version_id, expected_sha256: legacy.sha256 });
  checks.push('oversized_source_read_edit_restore_refusal_preserves_current_version');
  for (const saved of [legacy, current]) {
    const response = await mf.dispatchFetch(`${origin}/documents/${saved.document_id}/versions/${saved.version_id}.hwp`, { headers: identity });
    assert.equal(response.status, 200);
    assert.equal(digest(new Uint8Array(await response.arrayBuffer())), saved.sha256);
  }
  assert.equal((await success('hwp_versions', { document_id: current.document_id })).versions.length, 2);
  await intact(); checks.push('legacy_oversized_and_current_raw_downloads_and_history_remain_available');

  const served = await mf.dispatchFetch(origin + '/documents/upload-client.js', { headers: identity });
  let submissions = 0;
  const client = uploadClientHarness(async (_url, init) => {
    submissions++; return upload(oversized, init.headers['hwp-request-id']);
  });
  vm.runInNewContext(await served.text(), client.context);
  client.select(new File([oversized], 'synthetic.hwp', { type: 'application/x-hwp' }));
  await client.submit(); await client.submit();
  assert.equal(submissions, 1); assert.equal(client.elements.get('upload-button').disabled, true);
  assert(client.elements.get('upload-status').textContent.includes('40만'));
  await intact(); checks.push('compiled_served_browser_client_prevents_repeat_after_real_worker_refusal');

  // Restore admits the selected small source even when the current version is
  // oversized: users can explicitly recover to a supported earlier version.
  const oversizedCurrent = await store.replace({ owner, document_id: current.document_id, expected_version: current.version_id,
    request_id: crypto.randomUUID(), bytes: oversized, intent_sha256: digest(oversized) });
  const restored = await success('hwp_restore', { document_id: current.document_id, expected_version: oversizedCurrent.version_id,
    source_version: current.version_id, request_id: crypto.randomUUID() });
  assert.equal(restored.sha256, current.sha256); assert.notEqual(restored.version_id, current.version_id);
  assert.equal((await success('hwp_versions', { document_id: current.document_id })).versions.length, 4);
  assert.deepEqual((await store.read({ owner, document_id: current.document_id })).bytes, small);
  checks.push('explicit_restore_of_allowed_source_from_oversized_current_succeeds_and_retains_history');
  console.log(JSON.stringify({ hosted_workload_contract: 'passed', checks, mocked_file_fetches: mockedFetches,
    actual_compiled_workerd_d1_r2_wasm: true, synthetic_only: true, actual_oauth_verified: false,
    successful_400000_unit_layout_or_serialization_verified: false, layout_verified: false }));
} finally { await mf.dispose(); }
