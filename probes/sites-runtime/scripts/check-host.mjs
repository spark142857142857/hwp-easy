import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { pathToFileURL } from 'node:url';
import { Miniflare, convertV4MiniflareOptions } from 'miniflare';
import { HwpDocument, initSync } from '@rhwp/core';
import { createEngineApi } from '../../../src/one_hwp/rhwp_api.mjs';
import { syntheticFixture } from '../../../src/one_hwp/synthetic_fixtures.mjs';
import { createDocumentEngine } from '../engine/document.mjs';
import { createHostApp } from '../host/app.mjs';
import { authenticatedOwner, boundedBytes, fetchInputFile } from '../host/transfer.mjs';
import { applyTestMigrations } from './migrations.mjs';
const require = createRequire(import.meta.url);
initSync({ module: fs.readFileSync(new URL('./rhwp_bg.wasm', pathToFileURL(require.resolve('@rhwp/core')))) });
const origin = 'https://probe.invalid';
const mf = new Miniflare(convertV4MiniflareOptions({ compatibilityDate: '2026-10-01',
  modulesRoot: path.resolve('dist/server'), modules: [
    { type: 'ESModule', path: path.resolve('dist/server/index.js') },
    { type: 'CompiledWasm', path: path.resolve('dist/server/rhwp_bg.wasm') }],
  d1Databases: { DB: 'host-d1' }, r2Buckets: { BUCKET: 'host-r2' },
  bindings: { HWP_EASY_ORIGIN: origin, HWP_EASY_ALLOW_UPLOADS: 'true' } }));
const checkCode = (code) => (e) => e.code === code && e.message === code;
const headers = { 'oai-authenticated-user-id': 'synthetic-a', 'oai-authenticated-user-email': 'a@example.invalid' };
const other = { 'oai-authenticated-user-id': 'synthetic-b', 'oai-authenticated-user-email': 'b@example.invalid' };
const checks = [];
try {
  const db = await mf.getD1Database('DB'), bucket = await mf.getR2Bucket('BUCKET');
  await applyTestMigrations(db);
  const api = createEngineApi(HwpDocument), engine = createDocumentEngine(HwpDocument);
  const bytes = syntheticFixture(HwpDocument, api.exportChecked, { paragraphs: ['파일 왕복 합성 문서', '파일 왕복 합성 문서'] });
  const rpc = (name, args, identity = headers) => mf.dispatchFetch(`${origin}/mcp`, { method: 'POST',
    headers: { ...identity, 'Content-Type': 'application/json' }, body: JSON.stringify({ jsonrpc: '2.0', id: 1,
      method: 'tools/call', params: { name, arguments: args } }) });
  const call = async (name, args, identity) => {
    const response = await rpc(name, args, identity); assert.equal(response.status, 200);
    const result = (await response.json()).result;
    if (result.isError) throw new Error(result.content[0].text);
    return result.structuredContent.data;
  };
  const denied = async (name, args, code, identity) => {
    const response = await rpc(name, args, identity);
    const result = (await response.json()).result;
    assert.equal(result.isError, true); assert.equal(result.content[0].text, code);
  };
  assert.equal((await rpc('hwp_capabilities', {}, {})).status, 401);
  assert.equal((await rpc('hwp_capabilities', {}, { 'oai-authenticated-user-id': 'no-email' })).status, 401);
  const firstOwner = await authenticatedOwner(new Headers(headers));
  const renamedOwner = await authenticatedOwner(new Headers({ ...headers, 'oai-authenticated-user-email': 'changed@example.invalid' }));
  assert.equal(firstOwner, renamedOwner); assert.match(firstOwner, /^user:[0-9a-f]{64}$/);
  assert.notEqual(firstOwner, await authenticatedOwner(new Headers(other)));
  checks.push('mock_headers_not_oauth_identity_checks', 'stable_owner_ignores_email_and_name_changes');
  const oversized = await mf.dispatchFetch(`${origin}/mcp`, { method: 'POST',
    headers: { ...headers, 'Content-Type': 'application/json' }, body: ' '.repeat(3 * 1024 * 1024 + 1) });
  assert.equal(oversized.status, 413);
  checks.push('rpc_actual_stream_over_three_mib_rejected');
  const upload = (extra = {}, identity = headers, input = bytes) => mf.dispatchFetch(`${origin}/documents/import`, {
    method: 'POST', headers: { ...identity, Origin: origin, 'Content-Type': 'application/x-hwp',
      'hwp-request-id': crypto.randomUUID(), ...extra }, body: input });
  assert.equal((await upload({}, {})).status, 401);
  assert.equal((await upload({ Origin: 'https://other.invalid' })).status, 400);
  assert.equal((await upload({ Origin: '' })).status, 400);
  assert.equal((await upload({ 'hwp-request-id': 'invalid' })).status, 400);
  assert.equal((await upload({}, headers, new Uint8Array([1, 2]))).status, 400);
  assert.equal((await db.prepare('SELECT count(*) AS n FROM hwp_documents').first()).n, 0);
  checks.push('upload_requires_identity_same_origin_valid_id_and_hwp');
  const request_id = crypto.randomUUID();
  const accepted = await upload({ 'hwp-request-id': request_id }); assert.equal(accepted.status, 200);
  const created = await accepted.json();
  const repeated = await (await upload({ 'hwp-request-id': request_id })).json();
  assert.equal(repeated.replayed, true); assert.equal(repeated.document_id, created.document_id);
  const args = { document_id: created.document_id, version_id: created.version_id };
  const before = await call('hwp_read', args);
  const body = before.blocks.find((b) => b.kind === 'paragraph' && b.editable && b.text),
    cell = before.blocks.find((b) => b.kind === 'cell' && b.editable && b.text);
  const edits = { expected_sha256: created.sha256, operations: [body, cell].map((b, i) => ({
    target_id: b.target_id, expected_old: b.text, new_text: `왕복 수정 ${i} 😀` })) };
  assert.equal((await call('hwp_plan', { ...args, ...edits })).file_changed, false);
  const editArgs = { document_id: created.document_id, expected_version: created.version_id,
    request_id: crypto.randomUUID(), ...edits };
  const edited = await call('hwp_edit', editArgs);
  assert.equal(edited.saved, true); assert.equal(edited.document_id, created.document_id);
  assert.equal(edited.raw_preservation_verified, true);
  assert.equal((await call('hwp_edit', editArgs)).replayed, true);
  const current = { document_id: created.document_id, version_id: edited.version_id };
  const link = await call('hwp_download', current);
  assert.equal(link.public_share_link, false);
  const result = await mf.dispatchFetch(link.download_url, { headers }); assert.equal(result.status, 200);
  const output = new Uint8Array(await result.arrayBuffer()), reopened = await engine.open(output);
  const final = reopened.read({ expected_sha256: edited.sha256 });
  assert.equal(final.blocks.find((b) => b.id === body.id).text, edits.operations[0].new_text);
  assert.equal(final.blocks.find((b) => b.id === cell.id).text, edits.operations[1].new_text);
  checks.push('real_workerd_binary_upload_mcp_read_plan_same_document_edit_download_reopen', 'exact_edit_retry');
  assert.equal((await mf.dispatchFetch(link.download_url)).status, 401);
  assert.equal((await mf.dispatchFetch(link.download_url, { headers: other })).status, 404);
  for (const [name, value] of [['hwp_read', current], ['hwp_download', current], ['hwp_versions', { document_id: created.document_id }],
    ['hwp_restore', { document_id: created.document_id, expected_version: edited.version_id, source_version: created.version_id,
      request_id: crypto.randomUUID() }], ['hwp_edit', editArgs]]) {
    await denied(name, value, 'DOCUMENT_OR_VERSION_NOT_FOUND', other);
  }
  await denied('hwp_read', { ...current, owner: firstOwner }, 'INVALID_TOOL_ARGUMENTS');
  await denied('hwp_edit', { ...editArgs, request_id: crypto.randomUUID() }, 'VERSION_CONFLICT_OR_HISTORY_LIMIT');
  const old = await call('hwp_read', args);
  assert.equal(old.blocks.find((b) => b.id === body.id).text, body.text);
  checks.push('mock_two_user_read_edit_restore_download_isolation', 'client_owner_argument_rejected', 'stale_save_keeps_current');
  const preview = await call('hwp_preview', { ...current, page: 0 });
  const svg = await mf.dispatchFetch(preview.preview_url, { headers }); assert.equal(svg.status, 200);
  assert.match(svg.headers.get('content-security-policy'), /sandbox/);
  assert.match(await svg.text(), /<svg/);
  assert.equal((await mf.dispatchFetch(preview.preview_url, { headers: other })).status, 404);
  const restored = await call('hwp_restore', { document_id: created.document_id,
    expected_version: edited.version_id, source_version: created.version_id, request_id: crypto.randomUUID() });
  assert.equal(restored.sha256, created.sha256); assert.notEqual(restored.version_id, created.version_id);
  const history = await call('hwp_versions', { document_id: created.document_id });
  assert.equal(history.current_version, restored.version_id);
  assert.equal(history.revision, 3); assert.equal(history.versions.length, 3);
  assert.equal(history.order, 'created_at_then_id_not_revision_order');
  assert(history.versions.some((v) => v.version_id === history.current_version));
  checks.push('protected_passive_svg_unverified_layout', 'restore_as_new_revision');
  checks.push('version_list_explicitly_marks_current_not_last_timestamp');

  const countBefore = (await db.prepare('SELECT count(*) AS n FROM hwp_documents').first()).n;
  const workflow = await call('hwp_workflow_probe', {});
  assert.equal(workflow.passed, true); assert.equal(workflow.synthetic_cleanup_complete, true);
  assert.equal(workflow.native_file_attachment_verified, false);
  assert.equal(workflow.external_http_download_verified, false);
  assert.equal(workflow.owner_scoped_binary_handler_and_reopen, true);
  assert.equal((await db.prepare('SELECT count(*) AS n FROM hwp_documents').first()).n, countBefore);
  assert.equal((await call('hwp_read', { document_id: created.document_id, version_id: restored.version_id })).storage.sha256, created.sha256);
  checks.push('workflow_probe_cleanup_does_not_delete_existing_documents');

  // Download URL behavior uses a fake network response, NEVER a fake OAuth claim.
  let fetched = 0;
  const file = { download_url: 'https://files.example.invalid/signed', file_id: 'synthetic-file' };
  const fetcher = async (url, options) => {
    fetched++; assert.equal(options.redirect, 'manual'); assert.equal(options.headers.Authorization, undefined);
    return new Response(bytes);
  };
  await assert.rejects(() => fetchInputFile(file, undefined, fetcher), checkCode('FILE_HOST_NOT_CONFIGURED'));
  await assert.rejects(() => fetchInputFile({ ...file, download_url: 'http://127.0.0.1/private' },
    '["https://files.example.invalid"]', fetcher), checkCode('FILE_URL_NOT_ALLOWED'));
  assert.equal(fetched, 0);
  assert.deepEqual(await fetchInputFile(file, '["https://files.example.invalid"]', fetcher), bytes);
  await assert.rejects(() => fetchInputFile(file, '["https://files.example.invalid"]', async () =>
    new Response(null, { status: 302, headers: { Location: 'http://127.0.0.1/' } })), checkCode('FILE_FETCH_FAILED'));
  await assert.rejects(() => boundedBytes(new Response(new Uint8Array(6)).body, 5, null), checkCode('TRANSFER_LIMIT_EXCEEDED'));
  const disabled = createHostApp({ DB: db, BUCKET: bucket, HWP_EASY_ORIGIN: origin }, engine, HwpDocument, fetcher);
  const authenticated = new Request(`${origin}/mcp`, { headers });
  await assert.rejects(() => disabled.call('hwp_import', { file, request_id: crypto.randomUUID() }, authenticated), checkCode('DOCUMENT_UPLOADS_NOT_ENABLED'));
  assert.equal((await disabled.http(new Request(`${origin}/documents/import`, { method: 'POST', headers }))).status, 400);
  assert.equal((await disabled.call('hwp_capabilities', {}, authenticated)).structuredContent.data.file_url_origins_configured, false);
  const invalidOrigins = createHostApp({ DB: db, BUCKET: bucket, HWP_EASY_FILE_ORIGINS: '["http://localhost"]' }, engine, HwpDocument);
  assert.equal((await invalidOrigins.call('hwp_capabilities', {}, authenticated)).structuredContent.data.file_url_origins_configured, false);
  const enabled = createHostApp({ DB: db, BUCKET: bucket, HWP_EASY_ORIGIN: origin,
    HWP_EASY_ALLOW_UPLOADS: 'true', HWP_EASY_FILE_ORIGINS: '["https://files.example.invalid"]' }, engine, HwpDocument, fetcher);
  const imported = await enabled.call('hwp_import', { file, request_id: crypto.randomUUID() }, authenticated);
  assert.equal(imported.structuredContent.data.saved, true);
  const countBeforeInvalid = (await db.prepare('SELECT count(*) AS n FROM hwp_documents').first()).n;
  const invalidFile = createHostApp({ DB: db, BUCKET: bucket, HWP_EASY_ORIGIN: origin,
    HWP_EASY_ALLOW_UPLOADS: 'true', HWP_EASY_FILE_ORIGINS: '["https://files.example.invalid"]' },
  engine, HwpDocument, async () => new Response(new Uint8Array([1, 2])));
  await assert.rejects(() => invalidFile.call('hwp_import', { file, request_id: crypto.randomUUID() }, authenticated));
  assert.equal((await db.prepare('SELECT count(*) AS n FROM hwp_documents').first()).n, countBeforeInvalid);
  checks.push('fileparams_invalid_hwp_not_published');
  checks.push('fileparams_fake_fetch_contract', 'unconfigured_hosts_and_redirects_rejected_before_network',
    'bounded_stream_without_content_length', 'uploads_default_off');
  const deletion = { document_id: created.document_id, expected_version: restored.version_id,
    request_id: crypto.randomUUID(), confirmation: 'delete_document_and_recorded_versions' };
  await denied('hwp_delete', { ...deletion, confirmation: 'delete_all_files' }, 'INVALID_TOOL_ARGUMENTS');
  await denied('hwp_delete', deletion, 'DOCUMENT_OR_VERSION_NOT_FOUND', other);
  await denied('hwp_delete', { ...deletion, expected_version: created.version_id }, 'VERSION_CONFLICT');
  const removed = await call('hwp_delete', deletion);
  assert.equal(removed.recorded_versions_removed, 3); assert.equal(removed.unpublished_blob_gc_verified, false);
  assert.equal((await call('hwp_delete', deletion)).replayed, true);
  await denied('hwp_read', current, 'DOCUMENT_OR_VERSION_NOT_FOUND');
  assert.equal((await mf.dispatchFetch(link.download_url, { headers })).status, 404);
  assert.equal((await call('hwp_read', { document_id: imported.structuredContent.data.document_id,
    version_id: imported.structuredContent.data.version_id })).storage.sha256, imported.structuredContent.data.sha256);
  checks.push('delete_confirmation_owner_and_version_guards', 'explicit_delete_replay_and_recorded_version_cleanup',
    'deleted_document_read_and_download_revoked', 'delete_preserves_other_documents');
  console.log(JSON.stringify({ authenticated_host_contract: 'passed', checks,
    real_d1_r2_and_hwp: true, local_identity_headers_are_mocks_not_oauth: true,
    fileparam_network_is_mocked: true, native_client_attachment_verified: false, workflow }));
} finally { await mf.dispose(); }
