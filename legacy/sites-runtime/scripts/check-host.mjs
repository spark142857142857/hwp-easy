import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { pathToFileURL } from 'node:url';
import { Miniflare, convertV4MiniflareOptions } from 'miniflare';
import { HwpDocument, initSync } from '@rhwp/core';
import { createEngineApi } from '../../../src/one_hwp/rhwp_api.mjs';
import { syntheticFixture } from '../../../src/one_hwp/synthetic_fixtures.mjs';
import { createDocumentEngine } from '../../../src/one_hwp/engine/document.mjs';
import { createHostApp } from '../host/app.mjs';
import { authenticatedOwner, boundedBytes, fetchInputFile } from '../host/transfer.mjs';
import { applyTestMigrations } from './migrations.mjs';
import { withCheckedDeflateTrailers } from '../../../tests/fixtures/trailer-fixtures.mjs';
import { withPageNumber, rewriteSyntheticBody } from '../../../tests/fixtures/page-number-fixtures.mjs';
import { compressionFallbackFixture, miniReleaseFixture, miniGrowthFixture } from '../tests/cell-list-fixtures.mjs';
import { readCfb, readHwp } from '../../../src/one_hwp/guard/container.mjs';
import { parseRecords } from '../../../src/one_hwp/guard/records.mjs';
import { createHwpChunkCollector } from '../host/document-chunks.mjs';
import { largeSyntheticFixture } from '../host/large-synthetic.mjs';
const require = createRequire(import.meta.url);
initSync({ module: fs.readFileSync(new URL('./rhwp_bg.wasm', pathToFileURL(require.resolve('@rhwp/core')))) });
const origin = 'https://probe.invalid';
const mf = new Miniflare(convertV4MiniflareOptions({ compatibilityDate: '2026-10-01',
  modulesRoot: path.resolve('dist/server'), modules: [
    { type: 'ESModule', path: path.resolve('dist/server/index.js') },
    { type: 'CompiledWasm', path: path.resolve('dist/server/rhwp_bg.wasm') }],
  d1Databases: { DB: 'host-d1' }, r2Buckets: { BUCKET: 'host-r2' },
  bindings: { HWP_EASY_ORIGIN: origin, HWP_EASY_ALLOW_UPLOADS: 'true',
    HWP_EASY_FILE_ORIGINS: '["https://files.example.invalid"]' } }));
const checkCode = (code) => (e) => e.code === code && e.message === code;
const headers = { 'oai-authenticated-user-id': 'synthetic-a', 'oai-authenticated-user-email': 'a@example.invalid' };
const other = { 'oai-authenticated-user-id': 'synthetic-b', 'oai-authenticated-user-email': 'b@example.invalid' };
const checks = [];
try {
  const db = await mf.getD1Database('DB'), bucket = await mf.getR2Bucket('BUCKET');
  const blobState = async () => {
    const page = await bucket.list();
    return { truncated: page.truncated, objects: page.objects.map((item) => ({
      key: item.key, size: item.size, etag: item.etag, uploaded: Number(item.uploaded),
    })) };
  };
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
    return result;
  };
  assert.equal((await rpc('hwp_capabilities', {}, {})).status, 401);
  assert.equal((await rpc('hwp_capabilities', {}, { 'oai-authenticated-user-id': 'no-email' })).status, 401);
  assert.equal((await call('hwp_capabilities', {})).transfer_body_timeout_ms, 30000);
  assert.equal((await call('hwp_capabilities', {})).engine_page_count_change_notice_available, true);
  const firstOwner = await authenticatedOwner(new Headers(headers));
  const renamedOwner = await authenticatedOwner(new Headers({ ...headers, 'oai-authenticated-user-email': 'changed@example.invalid' }));
  assert.equal(firstOwner, renamedOwner); assert.match(firstOwner, /^user:[0-9a-f]{64}$/);
  assert.notEqual(firstOwner, await authenticatedOwner(new Headers(other)));
  checks.push('mock_headers_not_oauth_identity_checks', 'stable_owner_ignores_email_and_name_changes');
  // Unknown-length streaming exercises the accumulated-byte limit. A fixed
  // string adds Content-Length and can hit an early response/socket-reset race
  // in Miniflare's Node transport before its request upload has completed.
  const oversizedBody = new ReadableStream({ start(controller) {
    controller.enqueue(new TextEncoder().encode(' '.repeat(3 * 1024 * 1024 + 1))); controller.close();
  } });
  const oversized = await mf.dispatchFetch(`${origin}/mcp`, { method: 'POST', duplex: 'half',
    headers: { ...headers, 'Content-Type': 'application/json' }, body: oversizedBody });
  assert.equal(oversized.status, 413);
  assert.equal((await db.prepare('SELECT COUNT(*) AS n FROM hwp_documents').first()).n, 0);
  assert.equal((await db.prepare('SELECT COUNT(*) AS n FROM hwp_versions').first()).n, 0);
  assert.deepEqual((await bucket.list()).objects, []);
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
  assert.equal(before.coordinate_system.index_base, 0);
  assert.equal(before.coordinate_system.cell_index, 'stored_cell_order_not_row_times_columns');
  const fragment = await call('hwp_read', { ...args, max_chars: 1, max_blocks: 1 });
  assert.ok(fragment.next_cursor);
  assert.deepEqual(fragment.coordinate_system, before.coordinate_system);
  fragment.coordinate_system.index_base = 99;
  const continued = await call('hwp_read', { ...args, cursor: fragment.next_cursor, max_chars: 1, max_blocks: 1 });
  assert.deepEqual(continued.coordinate_system, before.coordinate_system);
  checks.push('zero_based_coordinate_contract_survives_continued_read_without_guessing_cell_indices');
  const body = before.blocks.find((b) => b.kind === 'paragraph' && b.editable && b.text),
    cell = before.blocks.find((b) => b.kind === 'cell' && b.editable && b.text);
  const edits = { expected_sha256: created.sha256, operations: [body, cell].map((b, i) => ({
    target_id: b.target_id, expected_old: b.text, new_text: `왕복 수정 ${i} 😀` })) };
  const planHistory = await call('hwp_versions', { document_id: created.document_id });
  const planBlobs = await blobState();
  const planned = await call('hwp_plan', { ...args, ...edits });
  assert.equal(planned.file_changed, false);
  assert.equal(planned.serialization_checked, true);
  assert.equal(planned.content_verified, true);
  assert.equal(planned.raw_preservation_verified, true);
  assert.equal(planned.pagination_diagnostic.scope, 'pinned_engine_page_count_only');
  assert.equal(planned.pagination_diagnostic.source_page_count, 1);
  assert.equal(planned.pagination_diagnostic.layout_verified, false);
  assert.equal(planned.pagination_diagnostic.page_limit_checked, false);
  assert.equal(planned.storage_checked, false);
  assert.equal(planned.saved, false);
  assert.equal(Object.hasOwn(planned, 'bytes'), false);
  assert.equal(Object.hasOwn(planned, 'output_sha256'), false);
  assert.deepEqual(await call('hwp_versions', { document_id: created.document_id }), planHistory);
  assert.deepEqual(await blobState(), planBlobs);
  checks.push('plan_serializes_and_verifies_without_d1_r2_mutation');
  const editArgs = { document_id: created.document_id, expected_version: created.version_id,
    request_id: crypto.randomUUID(), ...edits };
  const edited = await call('hwp_edit', editArgs);
  assert.equal(edited.saved, true); assert.equal(edited.document_id, created.document_id);
  assert.equal(edited.raw_preservation_verified, true);
  assert.deepEqual(edited.pagination_diagnostic, planned.pagination_diagnostic);
  const editedReplay = await call('hwp_edit', editArgs);
  assert.equal(editedReplay.replayed, true);
  assert.deepEqual(editedReplay.pagination_diagnostic, edited.pagination_diagnostic);
  checks.push('engine_page_count_notice_survives_plan_save_and_exact_retry_without_layout_claim');
  const current = { document_id: created.document_id, version_id: edited.version_id };
  const link = await call('hwp_download', current);
  assert.equal(link.public_share_link, false);
  const result = await mf.dispatchFetch(link.download_url, { headers }); assert.equal(result.status, 200);
  const output = new Uint8Array(await result.arrayBuffer()), reopened = await engine.open(output);
  const downloadHistory = await call('hwp_versions', { document_id: created.document_id }), downloadBlobs = await blobState();
  const downloadResult = (await (await rpc('hwp_download', { ...current, delivery: 'embedded' })).json()).result;
  assert.equal(downloadResult.isError, undefined);
  const embedded = downloadResult.content.filter((c) => c.type === 'resource'); assert.equal(embedded.length, 1);
  assert.deepEqual(new Uint8Array(Buffer.from(embedded[0].resource.blob, 'base64')), output);
  assert.equal(embedded[0].resource.mimeType, 'application/x-hwp');
  assert.equal(downloadResult.structuredContent.data.output_sha256, edited.sha256);
  assert.equal(downloadResult.structuredContent.data.output_bytes, output.length);
  assert.equal(downloadResult.structuredContent.data.local_file_saved, false);
  assert(!JSON.stringify(downloadResult.structuredContent).includes(embedded[0].resource.blob));
  assert.deepEqual(await call('hwp_versions', { document_id: created.document_id }), downloadHistory);
  assert.deepEqual(await blobState(), downloadBlobs);
  await denied('hwp_download', { ...current, delivery: 'embedded' }, 'DOCUMENT_OR_VERSION_NOT_FOUND', other);
  const oldEmbedded = (await (await rpc('hwp_download', { ...args, delivery: 'embedded' })).json()).result;
  assert.deepEqual(new Uint8Array(Buffer.from(oldEmbedded.content.find((c) => c.type === 'resource').resource.blob, 'base64')), bytes);
  assert.equal((await (await rpc('hwp_download', current)).json()).result.content.length, 1);
  checks.push('embedded_immutable_current_and_old_hwp_exact_bytes_no_storage_mutation_owner_scope');
  const largeBytes = largeSyntheticFixture(HwpDocument, api.exportChecked);
  assert(largeBytes.length > 256 * 1024);
  const largeUpload = await upload({}, headers, largeBytes); assert.equal(largeUpload.status, 200);
  const largeDoc = await largeUpload.json(), largeArgs = { document_id: largeDoc.document_id, version_id: largeDoc.version_id };
  let largeHistory = await call('hwp_versions', { document_id: largeDoc.document_id }), largeBlobs = await blobState();
  const tooLarge = await denied('hwp_download', { ...largeArgs, delivery: 'embedded' }, 'DOCUMENT_EMBEDDED_OUTPUT_LIMIT_EXCEEDED');
  assert.equal(tooLarge.content.length, 1);
  const largeLink = await call('hwp_download', largeArgs);
  assert.deepEqual(new Uint8Array(await (await mf.dispatchFetch(largeLink.download_url, { headers })).arrayBuffer()), largeBytes);
  assert.deepEqual(await call('hwp_versions', { document_id: largeDoc.document_id }), largeHistory);
  assert.deepEqual(await blobState(), largeBlobs);
  checks.push('over_256_kib_real_synthetic_hwp_rejected_without_truncation_link_and_storage_preserved');
  for (const [pin, original] of [[{ ...largeArgs, sha256: largeDoc.sha256 }, largeBytes],
    [{ ...args, sha256: created.sha256 }, bytes]]) {
    const collector = createHwpChunkCollector(pin, original.length); let count = 0;
    while (collector.next_offset !== null) {
      const chunkArgs = { document_id: pin.document_id, version_id: pin.version_id, delivery: 'chunk',
        expected_sha256: pin.sha256, offset: collector.next_offset };
      const envelope = (await (await rpc('hwp_download', chunkArgs)).json()).result;
      assert.equal(envelope.isError, undefined);
      const data = envelope.structuredContent.data, resources = envelope.content.filter((r) => r.type === 'resource');
      assert.equal(resources.length, 1); assert.equal(resources[0].resource.mimeType, 'application/octet-stream');
      assert.equal(data.chunk_is_complete_hwp, false); assert.equal(data.local_file_saved, false);
      assert(!JSON.stringify(envelope.structuredContent).includes(resources[0].resource.blob));
      await collector.accept(data, resources[0]);
      const retry = (await (await rpc('hwp_download', chunkArgs)).json()).result;
      assert.deepEqual(retry, envelope);
      assert.equal((await collector.accept(data, resources[0])).replayed, true);
      assert(++count <= 64);
      if (pin.document_id === largeDoc.document_id && count === 1) {
        // A separate save changes current_version midway. Continue the pinned
        // old version, never silently switch to that new version.
        const changed = await call('hwp_restore', { document_id: largeDoc.document_id,
          expected_version: largeDoc.version_id, source_version: largeDoc.version_id, request_id: crypto.randomUUID() });
        assert.notEqual(changed.version_id, pin.version_id);
        largeHistory = await call('hwp_versions', { document_id: largeDoc.document_id });
        largeBlobs = await blobState();
      }
    }
    assert.deepEqual(await collector.finalize((b) => engine.open(b)), original);
    if (pin.document_id === largeDoc.document_id) assert.equal(count, 6);
    await denied('hwp_download', { document_id: pin.document_id, version_id: pin.version_id, delivery: 'chunk',
      expected_sha256: pin.sha256, offset: 0 }, 'DOCUMENT_OR_VERSION_NOT_FOUND', other);
    await denied('hwp_download', { document_id: pin.document_id, version_id: pin.version_id, delivery: 'chunk',
      expected_sha256: '0'.repeat(64), offset: 0 }, 'VERSION_CONFLICT');
    await denied('hwp_download', { document_id: pin.document_id, version_id: pin.version_id, delivery: 'chunk',
      expected_sha256: pin.sha256, offset: original.length }, 'INVALID_DOWNLOAD_CHUNK');
  }
  assert.deepEqual(await call('hwp_versions', { document_id: largeDoc.document_id }), largeHistory);
  assert.deepEqual(await call('hwp_versions', { document_id: created.document_id }), downloadHistory);
  assert.deepEqual(await blobState(), largeBlobs);
  checks.push('six_chunks_large_hwp_and_pinned_old_version_exact_retry_hash_reopen_owner_scope_storage_unchanged');
  const unfinished = createHwpChunkCollector(largeDoc, largeBytes.length);
  const firstChunk = (await (await rpc('hwp_download', { ...largeArgs, delivery: 'chunk',
    expected_sha256: largeDoc.sha256, offset: 0 })).json()).result;
  await unfinished.accept(firstChunk.structuredContent.data, firstChunk.content.find((r) => r.type === 'resource'));
  await call('hwp_delete', { document_id: largeDoc.document_id, expected_version: largeHistory.current_version,
    request_id: crypto.randomUUID(), confirmation: 'delete_document_and_recorded_versions' });
  const stopped = await denied('hwp_download', { ...largeArgs, delivery: 'chunk', expected_sha256: largeDoc.sha256,
    offset: unfinished.next_offset }, 'DOCUMENT_OR_VERSION_NOT_FOUND');
  assert.equal(stopped.content.length, 1);
  await assert.rejects(unfinished.finalize((b) => engine.open(b)), { code: 'DOWNLOAD_INCOMPLETE' });
  checks.push('save_mid_transfer_keeps_pinned_version_delete_between_chunks_prevents_incomplete_publication');
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
  const staleHistory = await call('hwp_versions', { document_id: created.document_id }), staleBlobs = await blobState();
  const stale = await denied('hwp_edit', { ...editArgs, request_id: crypto.randomUUID() }, 'VERSION_CONFLICT');
  assert.equal(stale.structuredContent.data.save_diagnostic.status, 'current_version_changed');
  assert.equal(stale.structuredContent.data.save_diagnostic.suggested_action, 'read_current_version_and_replan');
  assert.equal(stale.structuredContent.data.save_diagnostic.saved, false);
  assert.equal(stale.structuredContent.data.save_diagnostic.automatic_overwrite_allowed, false);
  assert.deepEqual(await call('hwp_versions', { document_id: created.document_id }), staleHistory);
  assert.deepEqual(await blobState(), staleBlobs);
  checks.push('stale_save_feedback_requires_reread_without_new_versions_or_blobs');
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

  // A generated HWP with verified CRC32/ISIZE footers must pass the actual
  // workerd path, not just the Node engine and independent guard unit tests.
  const footerBytes = withCheckedDeflateTrailers(syntheticFixture(HwpDocument, api.exportChecked));
  const footerOriginal = footerBytes.slice();
  const footerAccepted = await upload({}, headers, footerBytes);
  assert.equal(footerAccepted.status, 200);
  const footerCreated = await footerAccepted.json();
  const footerArgs = { document_id: footerCreated.document_id, version_id: footerCreated.version_id };
  const footerBefore = await call('hwp_read', footerArgs);
  assert.equal(footerBefore.content_complete, true);
  const footerTargets = ['paragraph', 'cell'].map((kind) =>
    footerBefore.blocks.find((b) => b.kind === kind && b.editable && b.text));
  assert(footerTargets.every(Boolean));
  const footerEdits = { expected_sha256: footerCreated.sha256, operations: footerTargets.map((b, i) => ({
    target_id: b.target_id, expected_old: b.text, new_text: `검증 꼬리 수정 ${i}` })) };
  assert.equal((await call('hwp_plan', { ...footerArgs, ...footerEdits })).file_changed, false);
  const footerEdited = await call('hwp_edit', { document_id: footerCreated.document_id,
    expected_version: footerCreated.version_id, request_id: crypto.randomUUID(), ...footerEdits });
  assert.equal(footerEdited.saved, true);
  assert.equal(footerEdited.raw_preservation_verified, true);
  assert.equal(footerEdited.layout_verified, false);
  const footerLink = await call('hwp_download', { document_id: footerCreated.document_id,
    version_id: footerEdited.version_id });
  const footerDownload = await mf.dispatchFetch(footerLink.download_url, { headers });
  assert.equal(footerDownload.status, 200);
  const footerOutput = new Uint8Array(await footerDownload.arrayBuffer());
  const footerReopened = (await engine.open(footerOutput)).read({ expected_sha256: footerEdited.sha256 });
  for (const target of footerBefore.blocks) {
    const operation = footerEdits.operations.find((op) => op.target_id === target.target_id);
    assert.equal(footerReopened.blocks.find((b) => b.id === target.id).text, operation?.new_text ?? target.text);
  }
  const footerRestored = await call('hwp_restore', { document_id: footerCreated.document_id,
    expected_version: footerEdited.version_id, source_version: footerCreated.version_id,
    request_id: crypto.randomUUID() });
  assert.equal(footerRestored.sha256, footerCreated.sha256);
  const footerRestoreLink = await call('hwp_download', { document_id: footerCreated.document_id,
    version_id: footerRestored.version_id });
  const footerRestoreDownload = await mf.dispatchFetch(footerRestoreLink.download_url, { headers });
  assert.equal(footerRestoreDownload.status, 200);
  assert.deepEqual(new Uint8Array(await footerRestoreDownload.arrayBuffer()), footerOriginal);
  assert.deepEqual(footerBytes, footerOriginal);
  checks.push('checked_crc32_isize_hwp_real_workerd_read_plan_edit_download_reopen_restore');

  const countBefore = (await db.prepare('SELECT count(*) AS n FROM hwp_documents').first()).n;
  const workflowEnvelope = (await (await rpc('hwp_workflow_probe', {})).json()).result;
  const workflow = workflowEnvelope.structuredContent.data;
  assert.equal(workflow.passed, true); assert.equal(workflow.synthetic_cleanup_complete, true);
  assert.equal(workflow.native_file_attachment_verified, false);
  assert.equal(workflow.external_http_download_verified, false);
  assert.equal(workflow.owner_scoped_binary_handler_and_reopen, true);
  assert.equal(workflow.empty_cell_fill_save_reopen, true);
  assert.equal(workflow.cell_text_clear_save_reopen, true);
  assert.equal(workflow.stored_version_embedded_hwp_verified, true);
  assert.equal(workflow.server_chunk_workflow_verified, false);
  assert.equal(workflow.server_chunk_diagnostic_requested, false);
  assert.equal(workflow.client_chunk_reassembly_verified, false);
  const expanded = await call('hwp_workflow_probe', { diagnostic: 'large_chunks' });
  assert.equal(expanded.server_chunk_diagnostic_requested, true);
  assert.equal(expanded.server_chunk_workflow_verified, true); assert.equal(expanded.server_chunk_count, 6);
  assert.equal(expanded.synthetic_cleanup_complete, true); assert.equal(expanded.client_chunk_reassembly_verified, false);
  const savedWorkflow = spawnSync(process.execPath, ['scripts/save-workflow-result.mjs'], {
    input: JSON.stringify(workflowEnvelope) + '\r\n', encoding: 'utf8', timeout: 15000,
  });
  assert.equal(savedWorkflow.status, 0); const savedWorkflowMeta = JSON.parse(savedWorkflow.stdout);
  assert.equal(savedWorkflowMeta.independently_reproduced_bytes_match, true);
  assert.equal(savedWorkflowMeta.local_reopen_verified, true);
  assert.equal(savedWorkflowMeta.sha256, workflow.output_sha256);
  assert.deepEqual(fs.readFileSync(savedWorkflowMeta.path), Buffer.from(workflowEnvelope.content.find((c) => c.type === 'resource').resource.blob, 'base64'));
  const syntheticOutputs = () => fs.readdirSync(path.dirname(savedWorkflowMeta.path)).sort();
  const beforeRejectedOutput = syntheticOutputs();
  for (const mutate of [
    (r) => { r.structuredContent.data.scope = 'personal_document'; },
    (r) => { r.content.find((c) => c.type === 'resource').resource.blob = Buffer.from([1, 2, 3]).toString('base64'); },
    (r) => { r.content.push(r.content.find((c) => c.type === 'resource')); },
    (r) => { r.structuredContent.data.output_sha256 = '0'.repeat(64); },
  ]) {
    const corrupted = structuredClone(workflowEnvelope); mutate(corrupted);
    const deniedResult = spawnSync(process.execPath, ['scripts/save-workflow-result.mjs'], {
      input: JSON.stringify(corrupted), encoding: 'utf8', timeout: 15000,
    });
    assert.equal(deniedResult.status, 1); assert.equal(deniedResult.stdout, '');
    assert.deepEqual(syntheticOutputs(), beforeRejectedOutput);
  }
  checks.push('fixed_workflow_resource_independently_reproduced_local_file_reopen_rejects_unverified_results');
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
  const blobsBeforeDeniedOrigin = await blobState();
  const blockedOrigin = await denied('hwp_import', {
    file: { file_id: 'PRIVATE_FILE_ID', file_name: 'PRIVATE_FILE_NAME.hwp',
      download_url: 'https://unlisted.example.invalid/PRIVATE_PATH?token=PRIVATE_TOKEN' },
    request_id: crypto.randomUUID(),
  }, 'FILE_URL_NOT_ALLOWED');
  assert.equal(blockedOrigin.structuredContent.data.transfer_diagnostic.status, 'file_origin_not_allowlisted');
  assert.equal(blockedOrigin.structuredContent.data.transfer_diagnostic.candidate_file_origin,
    'https://unlisted.example.invalid');
  assert.equal(blockedOrigin.structuredContent.data.transfer_diagnostic.configured_file_origins_count, 1);
  assert.equal(blockedOrigin.structuredContent.data.transfer_diagnostic.network_request_made, false);
  assert.equal(blockedOrigin.structuredContent.data.transfer_diagnostic.stored, false);
  assert.deepEqual(JSON.parse(blockedOrigin.content[1].text), blockedOrigin.structuredContent);
  assert(!JSON.stringify(blockedOrigin).includes('PRIVATE_'));
  assert.equal((await db.prepare('SELECT count(*) AS n FROM hwp_documents').first()).n, countBeforeInvalid);
  assert.deepEqual(await blobState(), blobsBeforeDeniedOrigin);
  checks.push('mcp_denied_origin_feedback_without_private_url_or_storage');
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
  await denied('hwp_download', { ...current, delivery: 'embedded' }, 'DOCUMENT_OR_VERSION_NOT_FOUND');
  assert.equal((await mf.dispatchFetch(link.download_url, { headers })).status, 404);
  assert.equal((await call('hwp_read', { document_id: imported.structuredContent.data.document_id,
    version_id: imported.structuredContent.data.version_id })).storage.sha256, imported.structuredContent.data.sha256);
  checks.push('delete_confirmation_owner_and_version_guards', 'explicit_delete_replay_and_recorded_version_cleanup',
    'deleted_document_read_and_download_revoked', 'delete_preserves_other_documents');
  const pageBytes = withPageNumber(syntheticFixture(HwpDocument, api.exportChecked));
  const pageDoc = await (await upload({}, headers, pageBytes)).json();
  const pageArgs = { document_id: pageDoc.document_id, version_id: pageDoc.version_id };
  const pageBefore = await call('hwp_read', pageArgs);
  assert.equal(pageBefore.edit_profile_supported, true);
  assert.equal(pageBefore.content_complete, false);
  assert.equal(pageBefore.preserved_controls[0].edit_mode, 'preserve_bytes_only');
  const pageTargets = ['paragraph', 'cell'].map((kind) => pageBefore.blocks.find((b) => b.kind === kind && b.editable && b.text));
  const pageEdits = { expected_sha256: pageDoc.sha256, operations: pageTargets.map((b, i) => ({
    target_id: b.target_id, expected_old: b.text, new_text: `쪽 번호 보존 합성 수정 ${i} 😀` })) };
  assert.equal((await call('hwp_plan', { ...pageArgs, ...pageEdits })).file_changed, false);
  const pageEdited = await call('hwp_edit', { document_id: pageDoc.document_id, expected_version: pageDoc.version_id,
    request_id: crypto.randomUUID(), ...pageEdits });
  assert.equal(pageEdited.saved, true); assert.equal(pageEdited.raw_preservation_verified, true);
  const pageDownload = await call('hwp_download', { document_id: pageDoc.document_id, version_id: pageEdited.version_id });
  const pageOutput = new Uint8Array(await (await mf.dispatchFetch(pageDownload.download_url, { headers })).arrayBuffer());
  const pageReopened = await engine.open(pageOutput), pageAfter = pageReopened.read({ expected_sha256: pageEdited.sha256 });
  assert.equal(pageAfter.edit_profile_supported, true); assert.deepEqual(pageAfter.preserved_controls, pageBefore.preserved_controls);
  for (const [index, target] of pageTargets.entries()) assert.equal(pageAfter.blocks.find((b) => b.id === target.id).text, pageEdits.operations[index].new_text);
  const pageOriginal = await call('hwp_read', pageArgs);
  assert.equal(pageOriginal.storage.sha256, pageDoc.sha256);
  await denied('hwp_read', pageArgs, 'DOCUMENT_OR_VERSION_NOT_FOUND', other);
  checks.push('pgnp_actual_workerd_d1_r2_body_cell_save_download_reopen', 'pgnp_previous_version_unchanged_and_mock_other_user_denied');
  const normalizedBytes = rewriteSyntheticBody(syntheticFixture(HwpDocument, api.exportChecked,
    { paragraphs: ['합성 검증', '보존'] }), (records) => records.map((record) => {
    if (record.tag !== 72 || record.level !== 2) return record;
    const payload = record.payload.slice(); payload[7] ^= 4;
    return { ...record, payload };
  }));
  const normalizedDoc = await (await upload({}, headers, normalizedBytes)).json();
  const normalizedArgs = { document_id: normalizedDoc.document_id, version_id: normalizedDoc.version_id };
  const normalizedRead = await call('hwp_read', normalizedArgs);
  const normalizedTarget = normalizedRead.blocks.find((b) => b.editable && b.kind === 'cell' && b.text);
  const normalizedEdits = { expected_sha256: normalizedDoc.sha256, operations: [{
    target_id: normalizedTarget.target_id, expected_old: normalizedTarget.text, new_text: '합성 새 문구',
  }] };
  const normalizedHistory = await call('hwp_versions', { document_id: normalizedDoc.document_id });
  const normalizedBlobs = await blobState();
  const normalizedPlan = await call('hwp_plan', { ...normalizedArgs, ...normalizedEdits });
  assert.equal(normalizedPlan.restored_cell_list_words, 4);
  assert.equal(normalizedPlan.raw_preservation_verified, true);
  assert.deepEqual(await call('hwp_versions', { document_id: normalizedDoc.document_id }), normalizedHistory);
  assert.deepEqual(await blobState(), normalizedBlobs);
  const normalizedLink = await call('hwp_download', normalizedArgs);
  assert.deepEqual(new Uint8Array(await (await mf.dispatchFetch(normalizedLink.download_url, { headers })).arrayBuffer()), normalizedBytes);
  const normalizedSaved = await call('hwp_edit', { document_id: normalizedDoc.document_id,
    expected_version: normalizedDoc.version_id, request_id: crypto.randomUUID(), ...normalizedEdits });
  const normalizedCurrent = { document_id: normalizedDoc.document_id, version_id: normalizedSaved.version_id };
  const normalizedReopened = await call('hwp_read', normalizedCurrent);
  assert.equal(normalizedReopened.blocks.find((b) => b.id === normalizedTarget.id).text, '합성 새 문구');
  const repairedLink = await call('hwp_download', normalizedCurrent);
  const repairedBytes = new Uint8Array(await (await mf.dispatchFetch(repairedLink.download_url, { headers })).arrayBuffer());
  const repairedRaw = readHwp(repairedBytes);
  assert.ok([...parseRecords(repairedRaw.streams.get('BodyText/Section0'))]
    .filter((r) => r.tag === 72).every((r) => r.payload[6] === 0 && r.payload[7] === 0));
  checks.push('zero_cell_list_words_preserved_through_plan_save_download_reopen');
  const otherLossBytes = rewriteSyntheticBody(syntheticFixture(HwpDocument, api.exportChecked,
    { paragraphs: ['합성 검증', '보존'] }), (records) => records.map((record) => {
    if (record.tag !== 72 || record.level !== 2) return record;
    const payload = record.payload.slice(); payload[2] ^= 1;
    return { ...record, payload };
  }));
  const otherLossDoc = await (await upload({}, headers, otherLossBytes)).json();
  const otherLossArgs = { document_id: otherLossDoc.document_id, version_id: otherLossDoc.version_id };
  const otherLossRead = await call('hwp_read', otherLossArgs);
  const otherLossTarget = otherLossRead.blocks.find((b) => b.editable && b.kind === 'cell' && b.text);
  const otherLossEdits = { expected_sha256: otherLossDoc.sha256, operations: [{
    target_id: otherLossTarget.target_id, expected_old: otherLossTarget.text, new_text: '합성 새 문구',
  }] };
  const otherLossHistory = await call('hwp_versions', { document_id: otherLossDoc.document_id });
  const otherLossBlobs = await blobState();
  await denied('hwp_plan', { ...otherLossArgs, ...otherLossEdits }, 'PRESERVATION_MISMATCH');
  await denied('hwp_edit', { document_id: otherLossDoc.document_id, expected_version: otherLossDoc.version_id,
    request_id: crypto.randomUUID(), ...otherLossEdits }, 'PRESERVATION_MISMATCH');
  assert.deepEqual(await call('hwp_versions', { document_id: otherLossDoc.document_id }), otherLossHistory);
  assert.deepEqual(await blobState(), otherLossBlobs);
  checks.push('other_writer_metadata_loss_still_rejected_without_storage_change');
  // Eligibility reasons must survive actual Worker/MCP reads, and rejected
  // targets must never publish a new D1 version or R2 blob.
  for (const kind of ['tail_style', 'missing_text']) {
    const restrictionBase = syntheticFixture(HwpDocument, api.exportChecked,
      { bold: kind === 'tail_style', paragraphs: ['합성 검증', '보존'] });
    const restrictionModel = (() => {
      const d = api.openDocument(restrictionBase);
      try { return api.inspectDocument(d); } finally { d.free(); }
    })();
    const restrictedCell = restrictionModel.blocks.find((b) => b.kind === 'cell');
    const alternateId = restrictionModel.blocks[0].style.char_shape_ids[0];
    if (kind === 'tail_style') assert.notEqual(alternateId, 0);
    const restrictedBytes = rewriteSyntheticBody(restrictionBase, (records) => {
      let inFirstCell = false, finished = false;
      return records.flatMap((r) => {
        if (r.tag === 66) {
          inFirstCell = !finished && r.level === 2;
          if (inFirstCell) {
            const payload = r.payload.slice(), v = new DataView(payload.buffer);
            if (kind === 'tail_style') v.setUint16(12, 2, true);
            else {
              v.setUint32(0, (v.getUint32(0, true) & 0x80000000) | 1, true);
              v.setUint16(14, 1, true); // Range metadata is outside the empty-fill profile.
            }
            return [{ ...r, payload }];
          }
        }
        if (inFirstCell && !finished && r.tag === (kind === 'tail_style' ? 68 : 67)) {
          finished = true;
          if (kind === 'missing_text') return [];
          const payload = new Uint8Array(16), v = new DataView(payload.buffer);
          v.setUint32(8, restrictedCell.text.length, true); v.setUint32(12, alternateId, true);
          return [{ ...r, payload }];
        }
        return [r];
      });
    });
    const restrictionUpload = await upload({}, headers, restrictedBytes); assert.equal(restrictionUpload.status, 200);
    const restrictionDoc = await restrictionUpload.json();
    const restrictionArgs = { document_id: restrictionDoc.document_id, version_id: restrictionDoc.version_id };
    const restrictionRead = await call('hwp_read', restrictionArgs);
    const restricted = restrictionRead.blocks.find((b) => b.id === restrictedCell.id);
    assert.equal(restricted.editable, false);
    assert.equal(restricted.edit_restrictions[0].code,
      kind === 'tail_style' ? 'RAW_CHAR_SHAPE_REFS_UNCOVERED' : 'RAW_TEXT_RECORD_LAYOUT_UNVERIFIED');
    assert.equal(typeof restricted.edit_restrictions[0].message_ko, 'string');
    const restrictionEdits = { expected_sha256: restrictionDoc.sha256,
      operations: [{ target_id: restricted.target_id, expected_old: restricted.text, new_text: '합성 새 문구' }] };
    const restrictionHistory = await call('hwp_versions', { document_id: restrictionDoc.document_id });
    const restrictionBlobs = await blobState();
    await denied('hwp_plan', { ...restrictionArgs, ...restrictionEdits }, 'TARGET_NOT_EDITABLE');
    await denied('hwp_edit', { document_id: restrictionDoc.document_id, expected_version: restrictionDoc.version_id,
      request_id: crypto.randomUUID(), ...restrictionEdits }, 'TARGET_NOT_EDITABLE');
    assert.deepEqual(await call('hwp_versions', { document_id: restrictionDoc.document_id }), restrictionHistory);
    assert.deepEqual(await blobState(), restrictionBlobs);
    const originalLink = await call('hwp_download', restrictionArgs);
    assert.deepEqual(new Uint8Array(await (await mf.dispatchFetch(originalLink.download_url, { headers })).arrayBuffer()), restrictedBytes);
    if (kind === 'tail_style') {
      const eligible = restrictionRead.blocks.find((b) => b.kind === 'cell' && b.editable && b.text);
      const allowedEdit = await call('hwp_edit', { document_id: restrictionDoc.document_id,
        expected_version: restrictionDoc.version_id, request_id: crypto.randomUUID(), expected_sha256: restrictionDoc.sha256,
        operations: [{ target_id: eligible.target_id, expected_old: eligible.text, new_text: '합성 정상 수정' }] });
      assert.equal(allowedEdit.raw_preservation_verified, true);
      const allowedRead = await call('hwp_read', { document_id: restrictionDoc.document_id, version_id: allowedEdit.version_id });
      assert.equal(allowedRead.blocks.find((b) => b.id === eligible.id).text, '합성 정상 수정');
      assert.equal(allowedRead.blocks.find((b) => b.id === restrictedCell.id).editable, false);
    }
  }
  checks.push('raw_text_and_style_restrictions_visible_in_actual_worker_mcp',
    'restricted_plan_save_rejected_before_d1_r2_mutation', 'other_cell_edit_keeps_nonvisible_style_refs');
  const emptyBytes = syntheticFixture(HwpDocument, api.exportChecked,
    { paragraphs: ['합성 검증', '보존'], cells: [['', '원문'], ['', '답변']] });
  const emptyUpload = await upload({}, headers, emptyBytes); assert.equal(emptyUpload.status, 200);
  const emptyDoc = await emptyUpload.json();
  const emptyArgs = { document_id: emptyDoc.document_id, version_id: emptyDoc.version_id };
  const emptyRead = await call('hwp_read', emptyArgs), emptyTargets = emptyRead.blocks.filter((b) => b.empty_cell_fill_supported);
  assert.equal(emptyTargets.length, 2);
  const emptyEdits = { expected_sha256: emptyDoc.sha256, operations: emptyTargets.map((b) => ({
    target_id: b.target_id, expected_old: '', new_text: '합성 빈 셀 추가 🙂',
  })) };
  const emptyHistory = await call('hwp_versions', { document_id: emptyDoc.document_id }), emptyBlobs = await blobState();
  const emptyPlan = await call('hwp_plan', { ...emptyArgs, ...emptyEdits });
  assert.equal(emptyPlan.empty_cell_text_insertions_verified, 2);
  assert.equal(emptyPlan.raw_preservation_scope, 'narrow_raw_record_preservation_with_verified_empty_cell_insertions');
  assert.deepEqual(await call('hwp_versions', { document_id: emptyDoc.document_id }), emptyHistory);
  assert.deepEqual(await blobState(), emptyBlobs);
  const tabEdits = { ...emptyEdits, operations: [{ ...emptyEdits.operations[0], new_text: '탭\t추가' }] };
  await denied('hwp_plan', { ...emptyArgs, ...tabEdits }, 'INVALID_OPERATION');
  await denied('hwp_edit', { document_id: emptyDoc.document_id, expected_version: emptyDoc.version_id,
    request_id: crypto.randomUUID(), ...tabEdits }, 'INVALID_OPERATION');
  assert.deepEqual(await call('hwp_versions', { document_id: emptyDoc.document_id }), emptyHistory);
  assert.deepEqual(await blobState(), emptyBlobs);
  const emptySaveArgs = { document_id: emptyDoc.document_id, expected_version: emptyDoc.version_id,
    request_id: crypto.randomUUID(), ...emptyEdits };
  const emptySaved = await call('hwp_edit', emptySaveArgs), emptyReplay = await call('hwp_edit', emptySaveArgs);
  assert.equal(emptySaved.saved, true); assert.equal(emptySaved.raw_preservation_verified, true);
  assert.equal(emptyReplay.replayed, true); assert.equal(emptyReplay.version_id, emptySaved.version_id);
  const emptyLink = await call('hwp_download', { document_id: emptyDoc.document_id, version_id: emptySaved.version_id });
  const emptyOutput = new Uint8Array(await (await mf.dispatchFetch(emptyLink.download_url, { headers })).arrayBuffer());
  const emptyReopened = await engine.open(emptyOutput), emptyAfter = emptyReopened.read({ expected_sha256: emptySaved.sha256 });
  assert.deepEqual(emptyAfter.blocks.map((b) => [b.id, b.text, b.style]), emptyRead.blocks.map((b) =>
    [b.id, b.empty_cell_fill_supported ? '합성 빈 셀 추가 🙂' : b.text, b.style]));
  const emptyOriginalLink = await call('hwp_download', emptyArgs);
  assert.deepEqual(new Uint8Array(await (await mf.dispatchFetch(emptyOriginalLink.download_url, { headers })).arrayBuffer()), emptyBytes);
  assert.equal((await call('hwp_versions', { document_id: emptyDoc.document_id })).versions.length, 2);
  const clearTargets = emptyAfter.blocks.filter((b) => emptyTargets.some((t) => t.id === b.id));
  assert.ok(clearTargets.every((b) => b.cell_text_clear_supported));
  const clearArgs = { document_id: emptyDoc.document_id, version_id: emptySaved.version_id };
  const clearEdits = { expected_sha256: emptySaved.sha256, operations: clearTargets.map((b) => ({
    target_id: b.target_id, expected_old: b.text, new_text: '',
  })) };
  const beforeClearHistory = await call('hwp_versions', { document_id: emptyDoc.document_id }), beforeClearBlobs = await blobState();
  const clearPlan = await call('hwp_plan', { ...clearArgs, ...clearEdits });
  assert.equal(clearPlan.cell_text_record_removals_verified, 2); assert.equal(clearPlan.saved, false);
  assert.equal(clearPlan.raw_preservation_scope, 'narrow_raw_record_preservation_with_verified_cell_text_transitions');
  assert.deepEqual(await call('hwp_versions', { document_id: emptyDoc.document_id }), beforeClearHistory);
  assert.deepEqual(await blobState(), beforeClearBlobs);
  const clearSaveArgs = { document_id: emptyDoc.document_id, expected_version: emptySaved.version_id,
    request_id: crypto.randomUUID(), ...clearEdits };
  const clearSaved = await call('hwp_edit', clearSaveArgs), clearReplay = await call('hwp_edit', clearSaveArgs);
  assert.equal(clearSaved.saved, true); assert.equal(clearReplay.version_id, clearSaved.version_id); assert.equal(clearReplay.replayed, true);
  const clearLink = await call('hwp_download', { document_id: emptyDoc.document_id, version_id: clearSaved.version_id });
  const clearOutput = new Uint8Array(await (await mf.dispatchFetch(clearLink.download_url, { headers })).arrayBuffer());
  const clearSnapshot = await engine.open(clearOutput), clearedRead = clearSnapshot.read({ expected_sha256: clearSaved.sha256 });
  assert.deepEqual(clearedRead.blocks.map((b) => [b.id, b.text, b.style]), emptyRead.blocks.map((b) => [b.id, b.text, b.style]));
  assert.deepEqual(new Uint8Array(await (await mf.dispatchFetch(emptyLink.download_url, { headers })).arrayBuffer()), emptyOutput);
  const refillTargets = clearedRead.blocks.filter((b) => b.empty_cell_fill_supported);
  assert.equal(refillTargets.length, 2);
  const refilled = await call('hwp_edit', { document_id: emptyDoc.document_id, expected_version: clearSaved.version_id,
    request_id: crypto.randomUUID(), expected_sha256: clearSaved.sha256, operations: refillTargets.map((b) => ({
      target_id: b.target_id, expected_old: '', new_text: '합성 다시 채움 😀',
    })) });
  const refilledRead = await call('hwp_read', { document_id: emptyDoc.document_id, version_id: refilled.version_id });
  assert.deepEqual(refilledRead.blocks.map((b) => [b.id, b.text, b.style]), emptyRead.blocks.map((b) =>
    [b.id, b.empty_cell_fill_supported ? '합성 다시 채움 😀' : b.text, b.style]));
  assert.equal((await call('hwp_versions', { document_id: emptyDoc.document_id })).versions.length, 4);
  assert.deepEqual(new Uint8Array(await (await mf.dispatchFetch(clearLink.download_url, { headers })).arrayBuffer()), clearOutput);
  checks.push('empty_cell_fill_worker_plan_no_mutation_save_replay_download_reopen_original_retained',
    'empty_cell_tab_rejected_before_d1_r2_mutation',
    'cell_clear_worker_plan_no_mutation_save_replay_download_reopen_refill_all_prior_versions_retained');
  const compressionBytes = compressionFallbackFixture(HwpDocument, api).bytes;
  const compressionUpload = await upload({}, headers, compressionBytes); assert.equal(compressionUpload.status, 200);
  const compressionDoc = await compressionUpload.json();
  const compressionArgs = { document_id: compressionDoc.document_id, version_id: compressionDoc.version_id };
  const compressionRead = await call('hwp_read', compressionArgs);
  const compressionTarget = compressionRead.blocks.find((b) => b.editable && b.text);
  const compressionEdits = { expected_sha256: compressionDoc.sha256, operations: [{
    target_id: compressionTarget.target_id, expected_old: compressionTarget.text, new_text: compressionTarget.text,
  }] };
  const compressionHistory = await call('hwp_versions', { document_id: compressionDoc.document_id });
  const compressionBlobs = await blobState();
  const compressionPlan = await call('hwp_plan', { ...compressionArgs, ...compressionEdits });
  assert.equal(compressionPlan.restored_cell_list_words, 16);
  assert.equal(compressionPlan.raw_preservation_verified, true);
  assert.deepEqual(await call('hwp_versions', { document_id: compressionDoc.document_id }), compressionHistory);
  assert.deepEqual(await blobState(), compressionBlobs);
  const compressionSaved = await call('hwp_edit', { document_id: compressionDoc.document_id,
    expected_version: compressionDoc.version_id, request_id: crypto.randomUUID(), ...compressionEdits });
  assert.equal(compressionSaved.raw_preservation_verified, true);
  const compressionLink = await call('hwp_download', { document_id: compressionDoc.document_id, version_id: compressionSaved.version_id });
  const compressionOutput = new Uint8Array(await (await mf.dispatchFetch(compressionLink.download_url, { headers })).arrayBuffer());
  const compressionReopened = await engine.open(compressionOutput);
  assert.equal(compressionReopened.read({ expected_sha256: compressionSaved.sha256 }).blocks
    .find((b) => b.id === compressionTarget.id).text, compressionTarget.text);
  assert.equal(readCfb(compressionOutput).get('BodyText/Section0').length,
    compressionFallbackFixture(HwpDocument, api).fallback.length);
  checks.push('alternate_compression_same_allocation_actual_worker_plan_save_download_reopen');
  const growthFixture = miniGrowthFixture(HwpDocument, api);
  const growthUpload = await upload({}, headers, growthFixture.bytes); assert.equal(growthUpload.status, 200);
  const growthDoc = await growthUpload.json();
  const growthArgs = { document_id: growthDoc.document_id, version_id: growthDoc.version_id };
  const growthRead = await call('hwp_read', growthArgs), growthTarget = growthRead.blocks[growthFixture.target_block_index];
  assert.equal(growthTarget.cell_text_clear_supported, true);
  const growthEdits = { expected_sha256: growthDoc.sha256, operations: [{
    target_id: growthTarget.target_id, expected_old: growthTarget.text, new_text: '',
  }] };
  const growthHistory = await call('hwp_versions', { document_id: growthDoc.document_id });
  const growthBlobs = await blobState();
  const growthPlan = await call('hwp_plan', { ...growthArgs, ...growthEdits });
  assert.equal(growthPlan.body_mini_sector_growth, 1); assert.equal(growthPlan.restored_cell_list_words, 6);
  assert.equal(growthPlan.raw_preservation_verified, true); assert.equal(growthPlan.saved, false);
  assert.deepEqual(await call('hwp_versions', { document_id: growthDoc.document_id }), growthHistory);
  assert.deepEqual(await blobState(), growthBlobs);
  await denied('hwp_plan', { ...growthArgs, ...growthEdits }, 'DOCUMENT_OR_VERSION_NOT_FOUND', other);
  const growthSaveArgs = { document_id: growthDoc.document_id, expected_version: growthDoc.version_id,
    request_id: crypto.randomUUID(), ...growthEdits };
  const growthSaved = await call('hwp_edit', growthSaveArgs), growthReplay = await call('hwp_edit', growthSaveArgs);
  assert.equal(growthSaved.saved, true); assert.equal(growthSaved.raw_preservation_verified, true);
  assert.equal(growthReplay.replayed, true); assert.equal(growthReplay.version_id, growthSaved.version_id);
  const growthLink = await call('hwp_download', { document_id: growthDoc.document_id, version_id: growthSaved.version_id });
  const growthOutput = new Uint8Array(await (await mf.dispatchFetch(growthLink.download_url, { headers })).arrayBuffer());
  const growthReopened = await engine.open(growthOutput);
  assert.deepEqual(growthReopened.read({ expected_sha256: growthSaved.sha256 }).blocks.map((b) => [b.id, b.text, b.style]),
    growthRead.blocks.map((b) => [b.id, b.id === growthTarget.id ? '' : b.text, b.style]));
  const growthOriginalLink = await call('hwp_download', growthArgs);
  assert.deepEqual(new Uint8Array(await (await mf.dispatchFetch(growthOriginalLink.download_url, { headers })).arrayBuffer()),
    growthFixture.bytes);
  assert.equal((await call('hwp_versions', { document_id: growthDoc.document_id })).versions.length, 2);
  checks.push('one_mini_tail_growth_actual_worker_plan_no_mutation_save_replay_download_reopen_original_retained');
  const releaseBoundaryBytes = miniReleaseFixture(HwpDocument, api).bytes;
  const releaseBoundaryUpload = await upload({}, headers, releaseBoundaryBytes);
  assert.equal(releaseBoundaryUpload.status, 200);
  const releaseBoundaryDoc = await releaseBoundaryUpload.json();
  const releaseBoundaryArgs = { document_id: releaseBoundaryDoc.document_id, version_id: releaseBoundaryDoc.version_id };
  const releaseBoundaryRead = await call('hwp_read', releaseBoundaryArgs);
  const releaseBoundaryTarget = releaseBoundaryRead.blocks.find((b) => b.editable && b.text);
  const releaseBoundaryEdits = { expected_sha256: releaseBoundaryDoc.sha256, operations: [{
    target_id: releaseBoundaryTarget.target_id, expected_old: releaseBoundaryTarget.text, new_text: releaseBoundaryTarget.text,
  }] };
  const releaseBoundaryHistory = await call('hwp_versions', { document_id: releaseBoundaryDoc.document_id });
  const releaseBoundaryBlobs = await blobState();
  const releasePlan = await call('hwp_plan', { ...releaseBoundaryArgs, ...releaseBoundaryEdits });
  assert.equal(releasePlan.body_mini_sector_release, 1); assert.equal(releasePlan.saved, false);
  assert.equal(releasePlan.raw_preservation_verified, true);
  assert.deepEqual(await call('hwp_versions', { document_id: releaseBoundaryDoc.document_id }), releaseBoundaryHistory);
  assert.deepEqual(await blobState(), releaseBoundaryBlobs);
  const releaseBoundaryLink = await call('hwp_download', releaseBoundaryArgs);
  assert.deepEqual(new Uint8Array(await (await mf.dispatchFetch(releaseBoundaryLink.download_url, { headers })).arrayBuffer()),
    releaseBoundaryBytes);
  await denied('hwp_plan', { ...releaseBoundaryArgs, ...releaseBoundaryEdits }, 'DOCUMENT_OR_VERSION_NOT_FOUND', other);
  const releaseSaveArgs = { document_id: releaseBoundaryDoc.document_id,
    expected_version: releaseBoundaryDoc.version_id, request_id: crypto.randomUUID(), ...releaseBoundaryEdits };
  const releaseSaved = await call('hwp_edit', releaseSaveArgs), releaseReplay = await call('hwp_edit', releaseSaveArgs);
  assert.equal(releaseSaved.saved, true); assert.equal(releaseSaved.raw_preservation_verified, true);
  assert.equal(releaseReplay.replayed, true); assert.equal(releaseReplay.version_id, releaseSaved.version_id);
  const releaseLink = await call('hwp_download', { document_id: releaseBoundaryDoc.document_id, version_id: releaseSaved.version_id });
  const releaseOutput = new Uint8Array(await (await mf.dispatchFetch(releaseLink.download_url, { headers })).arrayBuffer());
  const releaseLocal = await engine.edit(releaseBoundaryBytes, releaseBoundaryEdits, releaseBoundaryDoc.sha256);
  assert.deepEqual(releaseOutput, releaseLocal.bytes);
  const releaseReopened = await engine.open(releaseOutput);
  assert.deepEqual(releaseReopened.read({ expected_sha256: releaseSaved.sha256 }).blocks.map(b => [b.id, b.text, b.style]),
    releaseBoundaryRead.blocks.map(b => [b.id, b.text, b.style]));
  const releaseRestore = await call('hwp_restore', { document_id: releaseBoundaryDoc.document_id,
    expected_version: releaseSaved.version_id, source_version: releaseBoundaryDoc.version_id, request_id: crypto.randomUUID() });
  assert.equal(releaseRestore.sha256, releaseBoundaryDoc.sha256);
  assert.equal((await call('hwp_versions', { document_id: releaseBoundaryDoc.document_id })).versions.length, 3);
  checks.push('one_mini_tail_release_actual_worker_plan_no_mutation_owner_guard_save_replay_download_reopen_restore');
  const partialBytes = syntheticFixture(HwpDocument, api.exportChecked, { header: true });
  const partialUpload = await upload({}, headers, partialBytes); assert.equal(partialUpload.status, 200);
  const partialDoc = await partialUpload.json(), partialArgs = { document_id: partialDoc.document_id, version_id: partialDoc.version_id };
  const partialRead = await call('hwp_read', partialArgs);
  assert.equal(partialRead.all_content_supported, false); assert.equal(partialRead.content_complete, false);
  const partialHistory = await call('hwp_versions', { document_id: partialDoc.document_id }), partialBlobs = await blobState();
  const partialPath = `${origin}/documents/${partialDoc.document_id}/versions/${partialDoc.version_id}/view`;
  assert.equal((await mf.dispatchFetch(partialPath)).status, 401);
  assert.equal((await mf.dispatchFetch(partialPath, { headers: other })).status, 404);
  const partialView = await mf.dispatchFetch(partialPath, { headers }); assert.equal(partialView.status, 200);
  const partialHtml = await partialView.text();
  assert(partialHtml.includes('일부 내용만 읽을 수 있습니다'));
  assert(partialHtml.indexOf('일부 내용만 읽을 수 있습니다') < partialHtml.indexOf('에이전트에게 전달'));
  const partialDownload = await mf.dispatchFetch(`${origin}/documents/${partialDoc.document_id}/versions/${partialDoc.version_id}.hwp`, { headers });
  assert.deepEqual(new Uint8Array(await partialDownload.arrayBuffer()), partialBytes);
  assert.deepEqual(await call('hwp_versions', { document_id: partialDoc.document_id }), partialHistory);
  assert.deepEqual(await blobState(), partialBlobs);
  checks.push('partial_content_notice_matches_actual_hwp_profile_and_keeps_owner_guard_download_storage');
  console.log(JSON.stringify({ authenticated_host_contract: 'passed', checks,
    real_d1_r2_and_hwp: true, local_identity_headers_are_mocks_not_oauth: true,
    fileparam_network_is_mocked: true, native_client_attachment_verified: false, workflow }));
} finally { await mf.dispose(); }
