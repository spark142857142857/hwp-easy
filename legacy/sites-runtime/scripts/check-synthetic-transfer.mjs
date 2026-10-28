// Real workerd/D1/R2, but MOCK file delivery and identity. No external network,
// personal source files, OAuth claims or client download-UI certification.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { pathToFileURL } from 'node:url';
import { Miniflare, convertV4MiniflareOptions } from 'miniflare';
import { HwpDocument, initSync } from '@rhwp/core';
import { transferFixture, verifyTransferFixture, SYNTHETIC_TRANSFER_SHA256 } from '../host/synthetic-transfer.mjs';
import { createDocumentEngine } from '../../../src/one_hwp/engine/document.mjs';
import { createDocumentService } from '../storage/service.mjs';
import { createVersionStore, StorageError } from '../storage/store.mjs';
import { createHostApp } from '../host/app.mjs';
import { authenticatedOwner } from '../host/transfer.mjs';
import { applyTestMigrations } from './migrations.mjs';

const require = createRequire(import.meta.url);
initSync({ module: fs.readFileSync(new URL('./rhwp_bg.wasm', pathToFileURL(require.resolve('@rhwp/core')))) });
const bytes = transferFixture(HwpDocument), original = bytes.slice();
assert.equal(await verifyTransferFixture(bytes), SYNTHETIC_TRANSFER_SHA256);
assert.deepEqual(transferFixture(HwpDocument), bytes);
const origin = 'https://probe.invalid', fileOrigin = 'https://files.example.invalid';
let fetches = 0;
const mf = new Miniflare(convertV4MiniflareOptions({ compatibilityDate: '2026-10-01',
  modulesRoot: path.resolve('dist/server'), modules: [
    { type: 'ESModule', path: path.resolve('dist/server/index.js') },
    { type: 'CompiledWasm', path: path.resolve('dist/server/rhwp_bg.wasm') }],
  d1Databases: { DB: 'synthetic-transfer-d1' }, r2Buckets: { BUCKET: 'synthetic-transfer-r2' },
  bindings: { HWP_EASY_ORIGIN: origin, HWP_EASY_ALLOW_UPLOADS: 'false',
    HWP_EASY_FILE_ORIGINS: '[]', HWP_EASY_SYNTHETIC_FILE_ORIGINS: JSON.stringify([fileOrigin]) },
  outboundService: async (request) => {
    fetches++;
    const url = new URL(request.url);
    assert.equal(url.origin, fileOrigin);
    for (const name of ['authorization', 'cookie', 'oai-sites-authorization', 'oai-authenticated-user-id', 'oai-authenticated-user-email']) {
      assert.equal(request.headers.get(name), null);
    }
    if (url.pathname === '/redirect') return new Response(null, { status: 302, headers: { Location: 'http://127.0.0.1/' } });
    if (url.pathname === '/oversized') return new Response(new Uint8Array(bytes.length + 1));
    if (url.pathname === '/different') return new Response(new Uint8Array(bytes.length).fill(1));
    if (url.pathname === '/tampered') { const changed = bytes.slice(); changed[changed.length - 1] ^= 1; return new Response(changed); }
    return new Response(bytes);
  },
}));
const headers = { 'oai-authenticated-user-id': 'synthetic-transfer-a', 'oai-authenticated-user-email': 'a@example.invalid' };
const checks = [];
try {
  const db = await mf.getD1Database('DB'), bucket = await mf.getR2Bucket('BUCKET');
  await applyTestMigrations(db);
  const engine = createDocumentEngine(HwpDocument), store = createVersionStore(db, bucket);
  const owner = await authenticatedOwner(new Headers(headers));
  const marker = await createDocumentService(engine, store).create({ owner, request_id: crypto.randomUUID(), bytes });
  const keys = (await bucket.list()).objects.map((o) => o.key).sort();
  const intact = async () => {
    assert.deepEqual((await bucket.list()).objects.map((o) => o.key).sort(), keys);
    assert.equal((await db.prepare('SELECT count(*) AS n FROM hwp_documents').first()).n, 1);
    assert.deepEqual((await store.read({ owner, document_id: marker.document_id })).bytes, original);
  };
  const file = (route = '/fixture') => ({ file_id: 'synthetic-file', download_url: `${fileOrigin}${route}?token=not-for-logs`,
    file_name: 'private-name-not-for-logs.hwp' });
  const invoke = async (name, args, identity = headers) => {
    const response = await mf.dispatchFetch(`${origin}/mcp`, { method: 'POST', headers: { ...identity, 'Content-Type': 'application/json' },
      body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name, arguments: args } }) });
    return { status: response.status, body: await response.json() };
  };
  const authenticated = new Request(`${origin}/mcp`, { headers });
  const disabled = createHostApp({ DB: db, BUCKET: bucket, HWP_EASY_ORIGIN: origin, HWP_EASY_FILE_ORIGINS: JSON.stringify([fileOrigin]) },
    engine, HwpDocument, () => { throw new Error('Diagnostic must not fetch without its separate origin configuration'); });
  const diagnostic = await disabled.call('hwp_transfer_probe', { file: file() }, authenticated);
  assert.equal(diagnostic.structuredContent.data.status, 'file_host_confirmation_required');
  assert.equal(diagnostic.structuredContent.data.candidate_file_origin, fileOrigin);
  assert.equal(diagnostic.structuredContent.data.network_request_made, false);
  assert.equal(diagnostic.structuredContent.data.input_file_bytes_received, false);
  assert.equal(diagnostic.content.length, 1);
  assert(!JSON.stringify(diagnostic).includes('not-for-logs'));
  await intact(); checks.push('origin_only_no_fetch_no_private_descriptor_echo_or_storage');

  assert.equal((await invoke('hwp_transfer_probe', { file: file() }, {})).status, 401);
  assert.equal(fetches, 0);
  const imported = await invoke('hwp_import', { file: file(), request_id: crypto.randomUUID() });
  assert.equal(imported.body.result.isError, true);
  assert.equal(imported.body.result.content[0].text, 'DOCUMENT_UPLOADS_NOT_ENABLED');
  const blockedDiagnostic = imported.body.result.structuredContent.data.transfer_diagnostic;
  assert.equal(blockedDiagnostic.candidate_file_origin, fileOrigin);
  for (const key of ['network_request_made', 'input_file_bytes_received', 'stored', 'general_uploads_enabled']) {
    assert.equal(blockedDiagnostic[key], false);
  }
  assert.equal(blockedDiagnostic.candidate_origin_is_not_authorization, true);
  assert(!JSON.stringify(imported.body).includes('not-for-logs'));
  for (const download_url of ['http://127.0.0.1/private', 'https://host.internal/private',
    'https://user:secret@files.example.invalid/']) {
    const rejected = await invoke('hwp_import', { file: { ...file(), download_url }, request_id: crypto.randomUUID() });
    assert.deepEqual(rejected.body.result, { isError: true, content: [{ type: 'text', text: 'DOCUMENT_UPLOADS_NOT_ENABLED' }] });
  }
  assert.equal((await invoke('hwp_import', { file: file(), request_id: crypto.randomUUID() }, {})).status, 401);
  const overridden = await invoke('hwp_import', { file: { ...file(), owner }, request_id: crypto.randomUUID() });
  assert.equal(overridden.body.result.content[0].text, 'INVALID_TOOL_ARGUMENTS');
  assert.equal(fetches, 0);
  await intact();
  checks.push('disabled_import_safe_origin_feedback_no_fetch_no_storage_or_descriptor_echo');
  checks.push('authentication_and_general_upload_gate_not_bypassed');

  const output = (await invoke('hwp_transfer_probe', { file: file() })).body.result;
  assert(!output.isError);
  const report = output.structuredContent.data;
  assert.equal(report.status, 'synthetic_transfer_passed');
  assert.equal(report.scope, 'server_pinned_synthetic_file_only');
  for (const key of ['passed', 'server_pinned_fixture_verified', 'input_file_bytes_received', 'synthetic_cleanup_complete',
    'read_plan_edit_default_save', 'previous_version_restore', 'request_replay']) assert.equal(report[key], true);
  for (const key of ['general_uploads_enabled', 'native_download_artifact_verified', 'native_file_attachment_verified',
    'codex_cloud_client_verified', 'dots_client_verified', 'layout_verified']) assert.equal(report[key], false);
  assert(!JSON.stringify(report).includes('not-for-logs'));
  const resource = output.content.find((c) => c.type === 'resource').resource;
  assert.equal(resource.mimeType, 'application/x-hwp');
  assert.equal(resource.uri, `hwp-easy://synthetic-transfer/${report.output_sha256}.hwp`);
  const returned = new Uint8Array(Buffer.from(resource.blob, 'base64'));
  assert.equal(returned.length, report.output_bytes);
  const reopened = await engine.open(returned);
  assert.equal(reopened.source_sha256, report.output_sha256);
  const after = reopened.read({ expected_sha256: reopened.source_sha256 });
  assert(after.blocks.some((b) => b.kind === 'paragraph' && b.text === '인증 범위 합성 편집 0 😀'));
  assert(after.blocks.some((b) => b.kind === 'cell' && b.text === '인증 범위 합성 편집 1 😀'));
  assert(after.blocks.some((b) => b.text === '끝까지 조회 확인'));
  await intact(); assert.deepEqual(bytes, original);
  checks.push('workerd_pinned_synthetic_fetch_edit_save_reopen_restore_cleanup_embedded_hwp');

  const resultAgain = (await invoke('hwp_transfer_probe', { file: file() })).body.result;
  assert.deepEqual(resultAgain.content.find((c) => c.type === 'resource'), output.content.find((c) => c.type === 'resource'));
  await intact(); checks.push('independent_repeat_returns_same_hwp_without_retaining_test_documents');
  for (const [route, expected] of [['/different', 'SYNTHETIC_FIXTURE_REQUIRED'], ['/tampered', 'SYNTHETIC_FIXTURE_REQUIRED'],
    ['/oversized', 'TRANSFER_LIMIT_EXCEEDED'], ['/redirect', 'FILE_FETCH_FAILED']]) {
    const failure = (await invoke('hwp_transfer_probe', { file: file(route) })).body.result;
    assert.equal(failure.isError, true); assert.equal(failure.content[0].text, expected);
    assert.equal(failure.content.length, 1);
    await intact();
  }
  checks.push('mismatching_tampered_oversized_redirected_input_never_published_or_returned');
  const count = fetches;
  for (const args of [{ file: { ...file(), download_url: 'https://other.invalid/x' } },
    { file: file(), sha256: SYNTHETIC_TRANSFER_SHA256 }, { file: file(), owner }]) {
    assert.equal((await invoke('hwp_transfer_probe', args)).body.result.isError, true);
  }
  assert.equal(fetches, count); await intact();
  checks.push('unapproved_hosts_and_caller_hash_identity_overrides_rejected_before_fetch');
  let opens = 0;
  const brokenEngine = { ...engine, async open(...args) {
    if (++opens === 2) throw new StorageError('DOCUMENT_OPERATION_FAILED');
    return engine.open(...args);
  }, async openRead(...args) {
    if (++opens === 2) throw new StorageError('DOCUMENT_OPERATION_FAILED');
    return engine.openRead(...args);
  } };
  const broken = createHostApp({ DB: db, BUCKET: bucket, HWP_EASY_ORIGIN: origin,
    HWP_EASY_SYNTHETIC_FILE_ORIGINS: JSON.stringify([fileOrigin]) }, brokenEngine, HwpDocument, async () => new Response(bytes));
  await assert.rejects(() => broken.call('hwp_transfer_probe', { file: file() }, authenticated),
    (e) => e.code === 'DOCUMENT_OPERATION_FAILED');
  await intact(); checks.push('workflow_failure_returns_no_embedded_hwp_and_cleans_only_test_document');
  console.log(JSON.stringify({ synthetic_transfer_contract: 'passed', checks,
    actual_workerd_d1_r2_and_hwp: true, identity_and_file_network_are_mocks: true,
    native_file_attachment_verified: false, native_download_artifact_verified: false, fixture_sha256: SYNTHETIC_TRANSFER_SHA256 }));
} finally { await mf.dispose(); }
