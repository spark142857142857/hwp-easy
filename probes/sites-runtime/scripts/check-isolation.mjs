// Adversarial local identities only, NOT a two-account OAuth certification.
// Actual workerd/D1/R2/WASM; every input is generated synthetic HWP bytes.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { pathToFileURL } from 'node:url';
import { Miniflare, convertV4MiniflareOptions } from 'miniflare';
import { HwpDocument, initSync } from '@rhwp/core';
import { createEngineApi } from '../../../src/one_hwp/rhwp_api.mjs';
import { syntheticFixture } from '../../../src/one_hwp/synthetic_fixtures.mjs';
import { createHostApp } from '../host/app.mjs';
import { documentToolError } from '../host/error-feedback.mjs';
import { applyTestMigrations } from './migrations.mjs';

const require = createRequire(import.meta.url);
initSync({ module: fs.readFileSync(new URL('./rhwp_bg.wasm', pathToFileURL(require.resolve('@rhwp/core')))) });
const origin = 'https://probe.invalid', checks = [];
const a = { 'oai-authenticated-user-id': 'isolation-a', 'oai-authenticated-user-email': 'shared@example.invalid' };
const b = { ...a, 'oai-authenticated-user-id': 'isolation-b' };
const renamed = { ...a, 'oai-authenticated-user-email': 'renamed@example.invalid' };
const mf = new Miniflare(convertV4MiniflareOptions({ compatibilityDate: '2026-10-01',
  modulesRoot: path.resolve('dist/server'), modules: [
    { type: 'ESModule', path: path.resolve('dist/server/index.js') },
    { type: 'CompiledWasm', path: path.resolve('dist/server/rhwp_bg.wasm') }],
  d1Databases: { DB: 'isolation-d1' }, r2Buckets: { BUCKET: 'isolation-r2' },
  bindings: { HWP_EASY_ORIGIN: origin, HWP_EASY_ALLOW_UPLOADS: 'true' } }));
try {
  const db = await mf.getD1Database('DB'), bucket = await mf.getR2Bucket('BUCKET');
  await applyTestMigrations(db);
  const rpc = async (name, args, identity = a) => {
    const response = await mf.dispatchFetch(`${origin}/mcp`, { method: 'POST',
      headers: { ...identity, 'Content-Type': 'application/json' },
      body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name, arguments: args } }) });
    assert.equal(response.status, 200); return (await response.json()).result;
  };
  const call = async (...args) => {
    const result = await rpc(...args); assert(!result.isError, JSON.stringify(result));
    return result.structuredContent.data;
  };
  const upload = async (identity, request_id, label) => {
    const api = createEngineApi(HwpDocument);
    const bytes = syntheticFixture(HwpDocument, api.exportChecked, { paragraphs: [label, label] });
    const response = await mf.dispatchFetch(`${origin}/documents/import`, { method: 'POST',
      headers: { ...identity, Origin: origin, 'Content-Type': 'application/x-hwp', 'hwp-request-id': request_id }, body: bytes });
    assert.equal(response.status, 200); return response.json();
  };
  // Same email and same request UUID must still produce separate documents.
  const importId = crypto.randomUUID();
  const first = await upload(a, importId, 'PRIVATE_A_SENTINEL');
  const second = await upload(b, importId, 'PRIVATE_B_SENTINEL');
  assert.notEqual(first.document_id, second.document_id); assert.notEqual(first.sha256, second.sha256);
  assert.equal((await upload(renamed, importId, 'PRIVATE_A_SENTINEL')).document_id, first.document_id);
  assert.equal((await upload(b, importId, 'PRIVATE_B_SENTINEL')).document_id, second.document_id);
  checks.push('same_email_different_user_separate_documents_and_import_receipts', 'same_user_changed_email_exact_import_replay');

  const versionArgs = (v) => ({ document_id: v.document_id, version_id: v.version_id });
  const readA = await call('hwp_read', versionArgs(first), renamed);
  const readB = await call('hwp_read', versionArgs(second), b);
  const edits = (v, read, text) => ({ expected_sha256: v.sha256, operations: [{
    target_id: read.blocks[0].target_id, expected_old: read.blocks[0].text, new_text: text }] });
  const snapshot = async () => ({
    tables: await Promise.all(['hwp_documents', 'hwp_versions', 'hwp_requests', 'hwp_deletions'].map(async (table) =>
      (await db.prepare(`SELECT * FROM ${table} ORDER BY owner, ${table === 'hwp_deletions' ? 'document_id' : 'id'}`).all()).results)),
    blobs: await Promise.all((await bucket.list()).objects.sort((x, y) => x.key.localeCompare(y.key)).map(async (object) => {
      const stored = await bucket.get(object.key);
      return { key: object.key, bytes: [...new Uint8Array(await stored.arrayBuffer())] };
    })),
  });
  const baseline = await snapshot();
  // All eight existing document-specific tools, including no-write plan/preview
  // and destructive delete, must have the same non-disclosing failure.
  for (const [owner, foreign, read] of [[b, first, readA], [a, second, readB]]) {
    const version = versionArgs(foreign), operation = edits(foreign, read, 'not saved');
    const deniedCalls = [
      ['hwp_read', version], ['hwp_plan', { ...version, ...operation }],
      ['hwp_preview', { ...version, page: 0 }], ['hwp_download', version],
      ['hwp_download', { ...version, delivery: 'embedded' }],
      ['hwp_download', { ...version, delivery: 'chunk', expected_sha256: foreign.sha256, offset: 0 }],
      ['hwp_versions', { document_id: foreign.document_id }],
      ['hwp_edit', { document_id: foreign.document_id, expected_version: foreign.version_id,
        request_id: crypto.randomUUID(), ...operation }],
      ['hwp_restore', { document_id: foreign.document_id, expected_version: foreign.version_id,
        source_version: foreign.version_id, request_id: crypto.randomUUID() }],
      ['hwp_delete', { document_id: foreign.document_id, expected_version: foreign.version_id,
        request_id: crypto.randomUUID(), confirmation: 'delete_document_and_recorded_versions' }],
    ];
    for (const [name, args] of deniedCalls) {
      assert.deepEqual(await rpc(name, args, owner), { isError: true,
        content: [{ type: 'text', text: 'DOCUMENT_OR_VERSION_NOT_FOUND' }] });
      assert.deepEqual(await snapshot(), baseline, `denied ${name} changed DB or bytes`);
    }
    for (const suffix of ['.hwp', '/view', '/pages/0.svg']) {
      const response = await mf.dispatchFetch(`${origin}/documents/${foreign.document_id}/versions/${foreign.version_id}${suffix}`,
        { headers: owner });
      assert.equal(response.status, 404); assert.deepEqual(await response.json(), { error: 'DOCUMENT_OR_VERSION_NOT_FOUND' });
      assert.deepEqual(await snapshot(), baseline);
    }
  }
  checks.push('all_eight_document_tools_and_three_http_routes_cross_owner_denied_without_disclosure_or_mutation');
  // Owning one document must not allow mixing in another owner's version id.
  assert.deepEqual(await rpc('hwp_read', { document_id: second.document_id, version_id: first.version_id }, b),
    { isError: true, content: [{ type: 'text', text: 'DOCUMENT_OR_VERSION_NOT_FOUND' }] });
  for (const key of ['owner', 'user_id', 'download_url']) {
    const result = await rpc('hwp_read', { ...versionArgs(first), [key]: 'forged-private-value' }, b);
    assert.equal(result.content[0].text, 'INVALID_TOOL_ARGUMENTS');
  }
  assert.deepEqual(await snapshot(), baseline);
  checks.push('mixed_document_version_and_caller_supplied_authority_rejected');

  // An acknowledged mutation id belongs to an owner, not globally to the UUID.
  const editId = crypto.randomUUID();
  const editA = { document_id: first.document_id, expected_version: first.version_id, request_id: editId,
    ...edits(first, readA, 'PRIVATE_A_EDITED') };
  const editB = { document_id: second.document_id, expected_version: second.version_id, request_id: editId,
    ...edits(second, readB, 'PRIVATE_B_EDITED') };
  const changedA = await call('hwp_edit', editA, renamed), changedB = await call('hwp_edit', editB, b);
  assert.equal((await call('hwp_edit', editA, a)).version_id, changedA.version_id);
  assert.equal((await call('hwp_edit', editB, b)).version_id, changedB.version_id);
  assert.equal((await call('hwp_versions', { document_id: first.document_id }, a)).revision, 2);
  assert.equal((await call('hwp_versions', { document_id: second.document_id }, b)).revision, 2);
  checks.push('same_edit_uuid_separate_owner_receipts_and_exact_replays');

  // Inject unexpected engine errors containing private data. Neither public
  // channel may serialize their codes/messages or break on a code getter.
  for (const error of [{ code: 'PRIVATE_DOCUMENT_TITLE', message: 'PRIVATE_SIGNED_URL' },
    Object.defineProperty({}, 'code', { get() { throw new Error('PRIVATE_GETTER'); } })]) {
    const host = createHostApp({ DB: db, BUCKET: bucket, HWP_EASY_ORIGIN: origin },
      { async open() { throw error; } }, HwpDocument);
    const before = await snapshot();
    await assert.rejects(() => host.call('hwp_read', versionArgs(first), new Request(`${origin}/mcp`, { headers: a })), (caught) => {
      assert.equal(caught, error);
      assert.deepEqual(documentToolError(caught), { isError: true,
        content: [{ type: 'text', text: 'DOCUMENT_OPERATION_FAILED' }] });
      return true;
    });
    const response = await host.http(new Request(`${origin}/documents/${first.document_id}/versions/${first.version_id}/pages/0.svg`,
      { headers: a }));
    assert.equal(response.status, 400); assert.deepEqual(await response.json(), { error: 'DOCUMENT_OPERATION_FAILED' });
    assert.deepEqual(await snapshot(), before);
  }
  checks.push('unexpected_private_engine_codes_hidden_in_mcp_and_http_without_mutation');
  const cap = await call('hwp_capabilities', {});
  assert.equal(cap.upload_status.state, 'file_host_not_configured');
  assert.equal(cap.upload_status.agent_file_import_available, false); assert.equal(cap.stored_document_tools_available, true);
  console.log(JSON.stringify({ isolation_matrix: 'passed', checks, actual_workerd_d1_r2_and_hwp: true,
    identity_is_mock_not_oauth: true, personal_files_used: false, production_upload_settings_changed: false }));
} finally { await mf.dispose(); }
