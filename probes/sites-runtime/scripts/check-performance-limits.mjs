// Real compiled workerd/D1/R2/WASM, but LOCAL and with mock identity. Fixed
// synthetic bytes only. Durations are observations, never CI pass thresholds.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { pathToFileURL } from 'node:url';
import { createHash } from 'node:crypto';
import { performance } from 'node:perf_hooks';
import { Miniflare, convertV4MiniflareOptions } from 'miniflare';
import { HwpDocument, initSync } from '@rhwp/core';
import { createEngineApi } from '../../../src/one_hwp/rhwp_api.mjs';
import { createDocumentEngine } from '../engine/document.mjs';
import { boundedBytes } from '../host/transfer.mjs';
import { applyTestMigrations } from './migrations.mjs';
import { makePerformanceFixture, makeRawTextLimitFixture } from './performance-fixtures.mjs';

if (process.argv.length !== 2) throw Error('Synthetic limit check accepts no arguments');
const maximum = 4 * 1024 * 1024, require = createRequire(import.meta.url);
initSync({ module: fs.readFileSync(new URL('./rhwp_bg.wasm', pathToFileURL(require.resolve('@rhwp/core')))) });
const api = createEngineApi(HwpDocument), origin = 'https://performance.invalid';
// Test-only entrypoint, supplied to Miniflare in memory and never built or
// packaged. It calls the actual compiled production Worker with a fixed
// synthetic request inside workerd. Cancelling that request cannot reset the
// Node HTTP bridge carrying the small test command and response.
const boundaryEntry = `import production from './index.js';
export default { fetch(request, env, ctx) {
  const url = new URL(request.url);
  const declared = url.pathname === '/__synthetic_declared_boundary';
  if (!declared && url.pathname !== '/__synthetic_stream_boundary')
    return production.fetch(request, env, ctx);
  if (request.method !== 'GET' || url.search) return new Response(null, {status: 405});
  const bytes = new Uint8Array(4 * 1024 * 1024 + 1);
  const headers = new Headers(request.headers);
  headers.set('Content-Type', 'application/x-hwp');
  headers.set('hwp-request-id', crypto.randomUUID());
  headers.delete('Content-Length');
  if (declared) headers.set('Content-Length', String(bytes.length));
  const body = new ReadableStream({start(controller) {controller.enqueue(bytes); controller.close();}});
  return production.fetch(new Request(url.origin + '/documents/import',
    {method: 'POST', headers, body}), env, ctx);
} };`;
let outbound = 0;
const mf = new Miniflare(convertV4MiniflareOptions({ compatibilityDate: '2026-10-01',
  modulesRoot: path.resolve('dist/server'), modules: [
    { type: 'ESModule', path: path.resolve('dist/server/synthetic-limit-entry.js'), contents: boundaryEntry },
    { type: 'ESModule', path: path.resolve('dist/server/index.js') },
    { type: 'CompiledWasm', path: path.resolve('dist/server/rhwp_bg.wasm') }],
  d1Databases: { DB: 'performance-d1' }, r2Buckets: { BUCKET: 'performance-r2' },
  bindings: { HWP_EASY_ORIGIN: origin, HWP_EASY_ALLOW_UPLOADS: 'true', HWP_EASY_FILE_ORIGINS: '[]' },
  outboundService: () => { outbound++; throw Error('No external network'); } }));
const identity = { 'oai-authenticated-user-id': 'synthetic-performance-owner',
  'oai-authenticated-user-email': 'synthetic@example.invalid' };
const digest = (bytes) => createHash('sha256').update(bytes).digest('hex');
const upload = (bytes, extra = {}) => mf.dispatchFetch(origin + '/documents/import', { method: 'POST',
  headers: { ...identity, Origin: origin, 'Content-Type': 'application/x-hwp',
    'hwp-request-id': crypto.randomUUID(), ...extra }, body: bytes });
const samples = [], boundaries = [];
try {
  const db = await mf.getD1Database('DB'), bucket = await mf.getR2Bucket('BUCKET');
  await applyTestMigrations(db);
  const count = async () => (await db.prepare('SELECT count(*) AS n FROM hwp_documents').first()).n;
  const call = async (name, args) => {
    const response = await mf.dispatchFetch(origin + '/mcp', { method: 'POST',
      headers: { ...identity, 'Content-Type': 'application/json' }, body: JSON.stringify({ jsonrpc: '2.0',
        id: 1, method: 'tools/call', params: { name, arguments: args } }) });
    assert.equal(response.status, 200);
    const result = (await response.json()).result;
    assert.equal(result.isError, undefined);
    return result.structuredContent.data;
  };
  // Byte admission is NOT valid-HWP admission. Zeros at/below the boundary
  const capabilities = await call('hwp_capabilities', {});
  assert.equal(capabilities.max_body_text_utf16_code_units, 2000000);
  assert.equal(capabilities.raw_body_text_limit_checked_before_wasm, true);
  assert.equal(capabilities.max_hosted_body_text_utf16_code_units, 400000);
  assert.equal(capabilities.hosted_body_text_limit_checked_before_wasm, true);
  // must pass transfer and then fail the container without publishing data.
  for (const length of [maximum - 1, maximum, maximum + 1]) {
    const bytes = new Uint8Array(length);
    // The oversized stream is constructed inside the compiled Worker harness;
    // at/below-boundary bytes still traverse the real Node HTTP upload bridge.
    const response = length > maximum
      ? await mf.dispatchFetch(origin + '/__synthetic_stream_boundary', { headers: { ...identity, Origin: origin } })
      : await upload(bytes);
    assert.equal(response.status, 400);
    const error = (await response.json()).error;
    if (length > maximum) assert.equal(error, 'TRANSFER_LIMIT_EXCEEDED');
    else assert.equal(error, 'DOCUMENT_OPERATION_FAILED'); // Public container rejection, no parser detail.
    assert.equal(await count(), 0);
    assert.equal((await bucket.list()).objects.length, 0);
    boundaries.push({ layer: 'compiled_worker_upload', bytes: length, error, published: false,
      transport: length > maximum ? 'in_worker_synthetic_request' : 'node_http_upload',
      valid_hwp: false, transfer_admitted: length <= maximum });
  }
  const declared = await mf.dispatchFetch(origin + '/__synthetic_declared_boundary',
    { headers: { ...identity, Origin: origin } });
  assert.equal(declared.status, 400);
  assert.equal((await declared.json()).error, 'TRANSFER_LIMIT_EXCEEDED');
  assert.equal(await count(), 0);
  assert.equal((await bucket.list()).objects.length, 0);
  boundaries.push({ layer: 'compiled_worker_upload_declared_length', transport: 'in_worker_synthetic_request',
    error: 'TRANSFER_LIMIT_EXCEEDED', published: false });
  let readerAcquired = false, declaredCancelled = false;
  await assert.rejects(() => boundedBytes({ getReader() { readerAcquired = true; throw Error('Unexpected read'); },
    cancel() { declaredCancelled = true; } }, maximum, String(maximum + 1)),
    (error) => error.code === 'TRANSFER_LIMIT_EXCEEDED');
  assert.equal(readerAcquired, false); assert.equal(declaredCancelled, true);
  boundaries.push({ layer: 'declared_length_unit', reader_acquired: false, cancelled: true,
    error: 'TRANSFER_LIMIT_EXCEEDED' });
  // No declared length: actual arriving bytes must independently enforce it.
  for (const length of [maximum - 1, maximum, maximum + 1]) {
    let cancelled = false;
    const input = new Uint8Array(length);
    const stream = new ReadableStream({ start(controller) { controller.enqueue(input); controller.close(); },
      cancel() { cancelled = true; } });
    if (length > maximum) await assert.rejects(() => boundedBytes(stream, maximum, null),
      (error) => error.code === 'TRANSFER_LIMIT_EXCEEDED');
    else assert.equal((await boundedBytes(stream, maximum, null)).length, length);
    assert.equal(stream.locked, false);
    boundaries.push({ layer: 'stream_without_declared_length', bytes: length,
      status: length > maximum ? 'rejected' : 'admitted', reader_released: true, cancelled });
  }
  let engineTouched = false;
  const fakeEngine = createDocumentEngine({ createEmpty() { engineTouched = true; throw Error('Unexpected engine call'); } });
  await assert.rejects(() => fakeEngine.open(new Uint8Array(maximum + 1)), (error) => error.code === 'INPUT_LIMIT_EXCEEDED');
  assert.equal(engineTouched, false);
  boundaries.push({ layer: 'engine_adapter', bytes: maximum + 1,
    error: 'INPUT_LIMIT_EXCEEDED', wasm_called: false });
  // Negative admission only; this compressed external CFB rewrite is never
  // passed off as an editable/layout-preserved large document.
  const hostedOversized = makeRawTextLimitFixture(1200000, HwpDocument, api);
  const hostedHash = digest(hostedOversized), hostedStart = performance.now();
  const hostedRejected = await upload(hostedOversized);
  assert.equal(hostedRejected.status, 400);
  assert.equal((await hostedRejected.json()).error, 'HOSTED_WORKLOAD_LIMIT_EXCEEDED');
  assert.equal(digest(hostedOversized), hostedHash);
  assert.equal(await count(), 0); assert.equal((await bucket.list()).objects.length, 0);
  for (const table of ['hwp_versions', 'hwp_requests']) {
    assert.equal((await db.prepare(`SELECT count(*) AS n FROM ${table}`).first()).n, 0);
  }
  boundaries.push({ layer: 'compiled_worker_hosted_workload_budget', input_bytes: hostedOversized.length,
    visible_utf16_units: 1200000, error: 'HOSTED_WORKLOAD_LIMIT_EXCEEDED',
    elapsed_ms: performance.now() - hostedStart, published: false, source_unchanged: true,
    fixture_scope: 'negative_admission_external_cfb_rewrite' });
  const compressed = makePerformanceFixture('content_limit2000k', HwpDocument, api);
  const limitStart = performance.now(), compressedHash = digest(compressed);
  const rejectedText = await upload(compressed);
  assert.equal(rejectedText.status, 400);
  assert.equal((await rejectedText.json()).error, 'RAW_TEXT_LIMIT_EXCEEDED');
  assert.equal(digest(compressed), compressedHash);
  assert.equal(await count(), 0); assert.equal((await bucket.list()).objects.length, 0);
  boundaries.push({ layer: 'compiled_worker_raw_text_budget', input_bytes: compressed.length,
    visible_utf16_units: 2000001, error: 'RAW_TEXT_LIMIT_EXCEEDED',
    elapsed_ms: performance.now() - limitStart, published: false, source_unchanged: true });

  for (const name of ['small', 'form45']) {
    const bytes = makePerformanceFixture(name, HwpDocument, api), original = digest(bytes);
    for (let iteration = 0; iteration < 3; iteration++) {
      const timings_ms = {};
      const timed = async (phase, action) => {
        const start = performance.now();
        try { return await action(); } finally { timings_ms[phase] = performance.now() - start; }
      };
      const created = await timed('upload', async () => {
        const response = await upload(bytes); assert.equal(response.status, 200); return response.json();
      });
      const args = { document_id: created.document_id, version_id: created.version_id };
      const before = await timed('read', () => call('hwp_read', args));
      assert.equal(before.content_complete, true);
      const target = before.blocks.find((b) => b.kind === 'cell' && b.cell === 2 && b.editable)
        ?? before.blocks.find((b) => b.kind === 'cell' && b.editable && b.text);
      assert(target);
      const edits = { expected_sha256: created.sha256, operations: [{ target_id: target.target_id,
        expected_old: target.text, new_text: '합성 성능 검사 완료 😀' }] };
      const planned = await timed('preflight', () => call('hwp_plan', { ...args, ...edits }));
      assert.equal(planned.serialization_checked, true);
      const edited = await timed('edit_save', () => call('hwp_edit', { document_id: created.document_id,
        expected_version: created.version_id, request_id: crypto.randomUUID(), ...edits }));
      assert.equal(edited.raw_preservation_verified, true);
      const after = await timed('read_after', () => call('hwp_read', { ...args, version_id: edited.version_id }));
      assert.equal(after.content_complete, true);
      assert.deepEqual(after.blocks.map(({ id, text }) => ({ id, text })),
        before.blocks.map(({ id, text }) => ({ id, text: id === target.id ? edits.operations[0].new_text : text })));
      const downloaded = await timed('download', async () => {
        const response = await mf.dispatchFetch(`${origin}/documents/${created.document_id}/versions/${edited.version_id}.hwp`, { headers: identity });
        assert.equal(response.status, 200); return new Uint8Array(await response.arrayBuffer());
      });
      assert.equal(digest(downloaded), edited.sha256);
      const restored = await timed('restore', () => call('hwp_restore', { document_id: created.document_id,
        expected_version: edited.version_id, source_version: created.version_id, request_id: crypto.randomUUID() }));
      assert.equal(restored.sha256, original);
      const history = await call('hwp_versions', { document_id: created.document_id });
      assert.equal(history.versions.length, 3);
      samples.push({ case: name, iteration, input_bytes: bytes.length, blocks: before.blocks.length,
        timings_ms, versions_retained: 3, download_hash_verified: true, restore_hash_verified: true,
        target_and_non_target_text_verified: true, raw_preservation_verified: true });
    }
  }
  assert.equal(outbound, 0);
  console.log(JSON.stringify({ status: 'passed', scope: 'local_compiled_workerd_d1_r2_wasm_mock_identity',
    synthetic_only: true, boundaries, samples, outbound_requests: outbound,
    actual_oauth_verified: false, total_isolate_memory_measured: false, layout_verified: false,
    storage_state: 'ephemeral_miniflare_disposed_after_run' }));
} finally { await mf.dispose(); }
