import { createVersionStore, StorageError } from '../storage/store.mjs';
import { createDocumentService } from '../storage/service.mjs';
import { authenticatedOwner, boundedBytes, configuredOrigin, configuredFileOrigins, fileDescriptorOrigin, fetchInputFile, TRANSFER_BODY_TIMEOUT_MS } from './transfer.mjs';
import { SYNTHETIC_TRANSFER_BYTES, SYNTHETIC_TRANSFER_SHA256, verifyTransferFixture, syntheticOutputResource } from './synthetic-transfer.mjs';
import { documentTools, validateArguments } from './tools.mjs';
import { uploadDisabledError } from './error-feedback.mjs';
import { publicErrorCode as errorCode } from './public-errors.mjs';
import { uploadStatus } from './upload-status.mjs';
import { documentViewerResponse, viewerMatch } from './document-viewer.mjs';
import { storedSyntheticResponse } from './stored-synthetic.mjs';
import { browserUploadResponse, UPLOAD_PAGE, UPLOAD_SCRIPT } from './browser-upload.mjs';
import { documentOutputResource, MAX_EMBEDDED_HWP_BYTES } from './document-output.mjs';
import { documentChunkResource, createHwpChunkCollector, MAX_HWP_CHUNK_BYTES, MAX_CHUNKED_HWP_BYTES } from './document-chunks.mjs';
import { largeSyntheticFixture } from './large-synthetic.mjs';
import { createEngineApi } from '../../../src/one_hwp/rhwp_api.mjs';
import { syntheticFixture } from '../../../src/one_hwp/synthetic_fixtures.mjs';
const fail = (code) => { throw new StorageError(code); };
const uuid = '[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}';
const jsonResponse = (data, status = 200) => Response.json(data, { status,
  headers: { 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' } });

export function createHostApp(env, engine, HwpDocument, fetcher = fetch) {
  const store = createVersionStore(env.DB, env.BUCKET), service = createDocumentService(engine, store);
  const origin = () => configuredOrigin(env.HWP_EASY_ORIGIN);
  const uploadsEnabled = () => env.HWP_EASY_ALLOW_UPLOADS === 'true';
  const fileOriginsConfigured = () => {
    try { return configuredFileOrigins(env.HWP_EASY_FILE_ORIGINS).length > 0; } catch { return false; }
  };
  async function tool(name, args, owner) {
    if (!validateArguments(name, args)) fail('INVALID_TOOL_ARGUMENTS');
    if (name === 'hwp_capabilities') return { engine: '@rhwp/core', engine_version: '0.8.6', hwp_only: true,
      document_tools_implemented: true, uploads_enabled: uploadsEnabled(),
      file_url_origins_configured: fileOriginsConfigured(),
      upload_status: uploadStatus(uploadsEnabled(), fileOriginsConfigured()),
      stored_document_tools_available: true,
      embedded_hwp_download_available: true, max_embedded_hwp_bytes: MAX_EMBEDDED_HWP_BYTES,
      chunked_hwp_download_available: true, max_hwp_chunk_bytes: MAX_HWP_CHUNK_BYTES,
      max_chunked_hwp_bytes: MAX_CHUNKED_HWP_BYTES, client_chunk_reassembly_verified: false,
      synthetic_transfer_probe_implemented: true, synthetic_transfer_fixture_sha256: SYNTHETIC_TRANSFER_SHA256,
      synthetic_transfer_fixture_bytes: SYNTHETIC_TRANSFER_BYTES,
      synthetic_transfer_origins_configured: syntheticFileOriginsConfigured(),
      transfer_body_timeout_ms: TRANSFER_BODY_TIMEOUT_MS,
      max_input_bytes: store.limits.max_bytes, max_versions_per_document: store.limits.max_versions_per_document,
      default_save: 'same_remote_document', pc_original_updated: false, layout_verified: false,
      native_file_attachment_verified: false, codex_cloud_client_verified: false, dots_client_verified: false,
      retention: 'until_explicit_delete', automatic_expiry: false,
      deletion_scope: 'logical_document_and_recorded_versions', unpublished_blob_gc_verified: false };
    if (name === 'hwp_import') {
      if (!uploadsEnabled()) throw uploadDisabledError(args.file);
      const bytes = await fetchInputFile(args.file, env.HWP_EASY_FILE_ORIGINS, fetcher);
      return service.create({ owner, request_id: args.request_id, bytes });
    }
    if (name === 'hwp_transfer_probe') {
      const candidateOrigin = fileDescriptorOrigin(args.file);
      const diagnostics = { scope: 'server_pinned_synthetic_file_only', candidate_file_origin: candidateOrigin,
        candidate_origin_is_not_authorization: true, input_file_bytes_received: false,
        general_uploads_enabled: uploadsEnabled(), expected_fixture_sha256: SYNTHETIC_TRANSFER_SHA256,
        expected_fixture_bytes: SYNTHETIC_TRANSFER_BYTES, native_download_artifact_verified: false };
      if (!syntheticFileOriginsConfigured()) return { ...diagnostics, status: 'file_host_confirmation_required',
        network_request_made: false, stored: false };
      const bytes = await fetchInputFile(args.file, env.HWP_EASY_SYNTHETIC_FILE_ORIGINS, fetcher, SYNTHETIC_TRANSFER_BYTES);
      await verifyTransferFixture(bytes);
      let output;
      const report = await workflow(owner, bytes, (result) => { output = result; });
      if (!output || output.bytes.length > 65536) fail('SYNTHETIC_OUTPUT_LIMIT_EXCEEDED');
      return { ...diagnostics, ...report, status: 'synthetic_transfer_passed',
        scope: diagnostics.scope,
        input_file_bytes_received: true, network_request_made: true, server_pinned_fixture_verified: true,
        output_sha256: output.sha256, output_bytes: output.bytes.length,
        output_transport: 'mcp_embedded_resource', _synthetic_output: syntheticOutputResource(output.bytes, output.sha256) };
    }
    if (name === 'hwp_edit') return service.edit({ owner, ...args,
      request: { expected_sha256: args.expected_sha256, operations: args.operations } });
    if (name === 'hwp_restore') return service.restore({ owner, ...args });
    if (name === 'hwp_delete') return service.remove({ owner, document_id: args.document_id,
      expected_version: args.expected_version, request_id: args.request_id });
    if (name === 'hwp_versions') {
      const history = await service.history({ owner, document_id: args.document_id });
      return { document_id: args.document_id, current_version: history[0].current_version, revision: history[0].revision,
        order: 'created_at_then_id_not_revision_order',
        versions: history.map(({ current_version, revision, ...entry }) => entry) };
    }
    if (name === 'hwp_workflow_probe') return workflow(owner, undefined, undefined, args.diagnostic === 'large_chunks');
    if (name === 'hwp_download') {
      const { bytes, ...metadata } = await store.read({ owner, document_id: args.document_id, version_id: args.version_id });
      if (args.delivery === 'embedded' && bytes.length > MAX_EMBEDDED_HWP_BYTES) fail('DOCUMENT_EMBEDDED_OUTPUT_LIMIT_EXCEEDED');
      if (args.delivery === 'chunk' && args.expected_sha256 !== metadata.sha256) fail('VERSION_CONFLICT');
      const snapshot = await engine.open(bytes);
      if (snapshot.source_sha256 !== metadata.sha256) fail('BLOB_MISSING_OR_CORRUPT');
      const base = `${origin()}/documents/${args.document_id}/versions/${args.version_id}`;
      const data = { ...metadata, download_url: `${base}.hwp`, mime_type: 'application/x-hwp',
        viewer_url: `${base}/view`, requires_same_user_sign_in: true, public_share_link: false };
      if (!['embedded', 'chunk'].includes(args.delivery)) return data;
      const chunk = args.delivery === 'chunk' ? await documentChunkResource(bytes, metadata, args) : null;
      const resource = chunk?.resource ?? await documentOutputResource(bytes, metadata);
      // Engine open / encoding can overlap deletion. Check this pinned version
      // once more before returning the newly materialized resource, not after.
      const history = await store.history({ owner, document_id: args.document_id });
      if (!history.some((v) => v.version_id === args.version_id && v.sha256 === metadata.sha256)) {
        fail('DOCUMENT_OR_VERSION_NOT_FOUND');
      }
      if (chunk) return { ...data, ...chunk.data, _document_output: resource };
      return { ...data, output_transport: 'mcp_embedded_resource', output_bytes: bytes.length,
        output_sha256: metadata.sha256, local_file_saved: false, native_file_attachment_verified: false,
        _document_output: resource };
    }
    const { snapshot, metadata } = await service.open({ owner, document_id: args.document_id, version_id: args.version_id });
    if (name === 'hwp_read') return { ...snapshot.read({ expected_sha256: metadata.sha256,
      ...(args.cursor ? { cursor: args.cursor } : {}), ...(args.max_chars ? { max_chars: args.max_chars } : {}),
      ...(args.max_blocks ? { max_blocks: args.max_blocks } : {}) }), storage: metadata };
    if (name === 'hwp_plan') return { ...await snapshot.preflight({ expected_sha256: args.expected_sha256, operations: args.operations }),
      storage: metadata, stale_for_save: metadata.version_id !== metadata.current_version };
    const base = `${origin()}/documents/${args.document_id}/versions/${args.version_id}`;
    snapshot.preview({ expected_sha256: metadata.sha256, page: args.page });
    return { ...metadata, preview_url: `${base}/pages/${args.page}.svg`, viewer_url: `${base}/view?page=${args.page}`, requires_same_user_sign_in: true, layout_verified: false };
  }
  async function verifyGeneratedDocument(owner, documentId, createRequestId) {
    // Both ids are generated ONLY inside workflow(), never supplied by a caller.
    // If a document exists, require this run's creation receipt BEFORE deleting
    // any blob. Corrupt/unavailable provenance must not erase another document.
    const existing = await env.DB.prepare('SELECT id FROM hwp_documents WHERE owner = ? AND id = ?').bind(owner, documentId).first();
    if (existing) {
      const receipt = await env.DB.prepare('SELECT document_id FROM hwp_requests WHERE owner = ? AND id = ?').bind(owner, createRequestId).first();
      if (receipt?.document_id !== documentId) fail('SYNTHETIC_CLEANUP_FAILED');
    }
    const prefix = `hwp-easy/v1/${owner}/${documentId}/`;
    const page = await env.BUCKET.list({ prefix, limit: 1000 });
    if (!Array.isArray(page.objects) || page.truncated || page.objects.length > 512
      || page.objects.some((o) => typeof o?.key !== 'string' || !o.key.startsWith(prefix))) fail('SYNTHETIC_CLEANUP_FAILED');
  }
  async function removeGeneratedDocument(owner, documentId, createRequestId) {
    await verifyGeneratedDocument(owner, documentId, createRequestId);
    const prefix = `hwp-easy/v1/${owner}/${documentId}/`; let cursor, count = 0;
    do {
      const page = await env.BUCKET.list({ prefix, limit: 1000, ...(cursor ? { cursor } : {}) });
      if (page.objects.some((o) => !o.key.startsWith(prefix)) || (count += page.objects.length) > 512) fail('SYNTHETIC_CLEANUP_FAILED');
      if (page.objects.length) await env.BUCKET.delete(page.objects.map((o) => o.key));
      cursor = page.truncated ? page.cursor : null;
      if (page.truncated && !cursor) fail('SYNTHETIC_CLEANUP_FAILED');
    } while (cursor);
    await env.DB.batch([
      env.DB.prepare('DELETE FROM hwp_requests WHERE owner = ? AND document_id = ?').bind(owner, documentId),
      env.DB.prepare('DELETE FROM hwp_versions WHERE owner = ? AND document_id = ?').bind(owner, documentId),
      env.DB.prepare('DELETE FROM hwp_documents WHERE owner = ? AND id = ?').bind(owner, documentId),
      env.DB.prepare('DELETE FROM hwp_deletions WHERE owner = ? AND document_id = ?').bind(owner, documentId),
    ]);
  }
  function syntheticFileOriginsConfigured() {
    try { return configuredFileOrigins(env.HWP_EASY_SYNTHETIC_FILE_ORIGINS).length > 0; } catch { return false; }
  }
  async function chunkWorkflow(owner, api) {
    const bytes = largeSyntheticFixture(HwpDocument, api.exportChecked), requestId = crypto.randomUUID();
    let prepared;
    try {
      if (bytes.length <= MAX_EMBEDDED_HWP_BYTES) fail('WORKFLOW_PROBE_FAILED');
      prepared = await service.prepareCreate({ owner, request_id: requestId, bytes });
      const doc = await prepared.execute(), collector = createHwpChunkCollector(doc, bytes.length);
      let chunks = 0;
      while (collector.next_offset !== null) {
        if (++chunks > 64) fail('WORKFLOW_PROBE_FAILED');
        const result = await tool('hwp_download', { document_id: doc.document_id, version_id: doc.version_id,
          delivery: 'chunk', expected_sha256: doc.sha256, offset: collector.next_offset }, owner);
        await collector.accept(result, result._document_output);
      }
      const assembled = await collector.finalize((b) => engine.open(b));
      if (!assembled.every((b, i) => b === bytes[i]) || assembled.length !== bytes.length) fail('WORKFLOW_PROBE_FAILED');
      return { server_chunk_workflow_verified: true, server_chunk_reassembly_bytes: bytes.length,
        server_chunk_count: chunks, client_chunk_reassembly_verified: false };
    } finally {
      if (prepared) {
        try { await removeGeneratedDocument(owner, prepared.document_id, requestId); }
        catch { fail('SYNTHETIC_CLEANUP_FAILED'); }
      }
    }
  }
  async function workflow(owner, inputBytes, onOutput, checkLargeChunks = false) {
    const api = createEngineApi(HwpDocument);
    const bytes = inputBytes ?? syntheticFixture(HwpDocument, api.exportChecked, {
      paragraphs: ['합성 에이전트 문서', '합성 에이전트 문서'], cells: [['문항', '합성 답변'], ['', '보존']] });
    let created, prepared, report, embedded;
    const createRequestId = crypto.randomUUID();
    const check = (value) => { if (!value) fail('WORKFLOW_PROBE_FAILED'); };
    try {
      prepared = await service.prepareCreate({ owner, request_id: createRequestId, bytes });
      created = await prepared.execute();
      check(created.document_id === prepared.document_id);
      const input = { document_id: created.document_id, version_id: created.version_id, max_chars: 5 };
      const found = new Map(); let cursor, pages = 0;
      do {
        const read = await tool('hwp_read', { ...input, ...(cursor ? { cursor } : {}) }, owner);
        for (const block of read.blocks) found.set(block.id, { ...block, text: (found.get(block.id)?.text ?? '') + block.text });
        cursor = read.next_cursor; check(++pages < 100);
      } while (cursor);
      const blocks = [...found.values()], body = blocks.find((b) => b.kind === 'paragraph' && b.editable && b.text),
        cell = blocks.find((b) => b.kind === 'cell' && b.editable && b.text),
        emptyCell = blocks.find((b) => b.empty_cell_fill_supported);
      check(body && cell);
      if (!inputBytes) check(emptyCell);
      const selected = [body, cell, ...(emptyCell ? [emptyCell] : [])];
      const edits = { expected_sha256: created.sha256, operations: selected.map((b, i) => ({
        target_id: b.target_id, expected_old: b.text, new_text: `인증 범위 합성 편집 ${i} 😀` })) };
      const planned = await tool('hwp_plan', { document_id: created.document_id, version_id: created.version_id, ...edits }, owner);
      check(planned.file_changed === false && planned.empty_cell_text_insertions_verified === (emptyCell ? 1 : 0));
      const editArgs = { document_id: created.document_id, expected_version: created.version_id,
        request_id: crypto.randomUUID(), ...edits };
      const edited = await tool('hwp_edit', editArgs, owner), replayed = await tool('hwp_edit', editArgs, owner);
      check(edited.saved && edited.raw_preservation_verified && replayed.replayed && replayed.version_id === edited.version_id);
      const link = await tool('hwp_download', { document_id: created.document_id, version_id: edited.version_id }, owner);
      const output = await download(link.download_url, owner);
      check(output.status === 200 && output.headers.get('content-type') === 'application/x-hwp');
      const outputBytes = new Uint8Array(await output.arrayBuffer());
      embedded = await tool('hwp_download', { document_id: created.document_id, version_id: edited.version_id,
        delivery: 'embedded' }, owner);
      const blob = atob(embedded._document_output.resource.blob);
      check(blob.length === outputBytes.length && outputBytes.every((byte, i) => byte === blob.charCodeAt(i)));
      const reopened = await engine.open(outputBytes);
      const after = reopened.read({ expected_sha256: reopened.source_sha256 });
      check(after.blocks.find((b) => b.id === body.id).text === edits.operations[0].new_text);
      check(after.blocks.find((b) => b.id === cell.id).text === edits.operations[1].new_text);
      if (emptyCell) check(after.blocks.find((b) => b.id === emptyCell.id).text === edits.operations[2].new_text);
      if (onOutput) onOutput({ bytes: outputBytes, sha256: reopened.source_sha256 });
      let finalEdited = edited;
      if (emptyCell) {
        const target = after.blocks.find((b) => b.id === emptyCell.id);
        check(target.cell_text_clear_supported);
        const clearEdits = { expected_sha256: edited.sha256, operations: [{
          target_id: target.target_id, expected_old: target.text, new_text: '' }] };
        const clearPlan = await tool('hwp_plan', { document_id: created.document_id, version_id: edited.version_id, ...clearEdits }, owner);
        check(clearPlan.cell_text_record_removals_verified === 1 && clearPlan.saved === false);
        const clearArgs = { document_id: created.document_id, expected_version: edited.version_id,
          request_id: crypto.randomUUID(), ...clearEdits };
        finalEdited = await tool('hwp_edit', clearArgs, owner);
        const clearReplay = await tool('hwp_edit', clearArgs, owner);
        check(finalEdited.saved && clearReplay.replayed && clearReplay.version_id === finalEdited.version_id);
        const clearLink = await tool('hwp_download', { document_id: created.document_id, version_id: finalEdited.version_id }, owner);
        const clearOutput = await download(clearLink.download_url, owner);
        check(clearOutput.status === 200);
        const cleared = await engine.open(new Uint8Array(await clearOutput.arrayBuffer()));
        const clearRead = cleared.read({ expected_sha256: cleared.source_sha256 });
        check(JSON.stringify(clearRead.blocks.map((b) => [b.id, b.text, b.style])) ===
          JSON.stringify(after.blocks.map((b) => [b.id, b.id === target.id ? '' : b.text, b.style])));
      }
      const expectedVersions = emptyCell ? 4 : 3;
      const preview = await tool('hwp_preview', { document_id: created.document_id, version_id: finalEdited.version_id, page: 0 }, owner);
      check((await download(preview.preview_url, owner)).status === 200);
      const restored = await tool('hwp_restore', { document_id: created.document_id, expected_version: finalEdited.version_id,
        source_version: created.version_id, request_id: crypto.randomUUID() }, owner);
      check(restored.sha256 === created.sha256 && restored.version_id !== created.version_id);
      check((await tool('hwp_versions', { document_id: created.document_id }, owner)).versions.length === expectedVersions);
      const deletion = { document_id: created.document_id, expected_version: restored.version_id,
        request_id: crypto.randomUUID(), confirmation: 'delete_document_and_recorded_versions' };
      await verifyGeneratedDocument(owner, prepared.document_id, createRequestId);
      const deleted = await tool('hwp_delete', deletion, owner);
      check(deleted.deleted && deleted.recorded_versions_removed === expectedVersions && !deleted.unpublished_blob_gc_verified);
      check((await tool('hwp_delete', deletion, owner)).replayed);
      try { await service.open({ owner, document_id: created.document_id }); fail('WORKFLOW_PROBE_FAILED'); }
      catch (error) { check(error.code === 'DOCUMENT_OR_VERSION_NOT_FOUND'); }
      report = { passed: true, scope: 'signed_in_user_fixed_synthetic_only', persistence: 'd1-r2',
        owner_source: 'sites_dispatch_authenticated_identity', pages, read_plan_edit_default_save: true,
        empty_cell_fill_save_reopen: !!emptyCell,
        cell_text_clear_save_reopen: !!emptyCell,
        owner_scoped_binary_handler_and_reopen: true, owner_scoped_svg_handler: true,
        stored_version_embedded_hwp_verified: true,
        external_http_download_verified: false,
        request_replay: true, previous_version_restore: true, native_file_attachment_verified: false,
        explicit_delete_of_recorded_versions: true, unpublished_blob_gc_verified: false,
        real_two_user_oauth_verified: false, codex_cloud_client_verified: false, dots_client_verified: false,
        uploads_enabled: uploadsEnabled(), layout_verified: false };
      // Only the built-in diagnostic returns its own already-verified bytes.
      // General download returns a resource only after explicit delivery choice.
      if (!inputBytes) Object.assign(report, { output_transport: embedded.output_transport,
        output_sha256: embedded.output_sha256, output_bytes: embedded.output_bytes,
        _document_output: embedded._document_output });
      if (!inputBytes) Object.assign(report, { server_chunk_diagnostic_requested: checkLargeChunks,
        server_chunk_workflow_verified: false, client_chunk_reassembly_verified: false },
      checkLargeChunks ? await chunkWorkflow(owner, api) : {});
    } finally {
      if (prepared) {
        try { await removeGeneratedDocument(owner, prepared.document_id, createRequestId); }
        catch { fail('SYNTHETIC_CLEANUP_FAILED'); }
        if (report) report.synthetic_cleanup_complete = true;
      }
    }
    return report;
  }
  async function download(address, owner) {
    const url = new URL(address);
    if (url.search) fail('INVALID_DOWNLOAD_REQUEST');
    const match = url.pathname.match(new RegExp(`^/documents/(${uuid})/versions/(${uuid})(?:\\.hwp|/pages/(\\d{1,4})\\.svg)$`));
    if (!match) fail('INVALID_DOWNLOAD_REQUEST');
    const saved = await store.read({ owner, document_id: match[1], version_id: match[2] });
    const headers = { 'Cache-Control': 'private, no-store', 'X-Content-Type-Options': 'nosniff',
      'Referrer-Policy': 'no-referrer', 'Content-Security-Policy': "default-src 'none'; style-src 'unsafe-inline'; sandbox" };
    if (match[3] !== undefined) {
      const snapshot = await engine.open(saved.bytes);
      const preview = snapshot.preview({ expected_sha256: saved.sha256, page: Number(match[3]) });
      if (preview.svg.length > 4 * 1024 * 1024) fail('PREVIEW_LIMIT_EXCEEDED');
      return new Response(preview.svg, { headers: { ...headers, 'Content-Type': 'image/svg+xml; charset=utf-8' } });
    }
    return new Response(saved.bytes, { headers: { ...headers, 'Content-Type': 'application/x-hwp',
      'Content-Disposition': 'attachment; filename="document.hwp"', 'Content-Length': String(saved.bytes.length) } });
  }
  async function http(request) {
    let owner;
    try { owner = await authenticatedOwner(request.headers); }
    catch { return jsonResponse({ error: 'AUTHENTICATION_REQUIRED' }, 401); }
    try {
      const url = new URL(request.url);
      if ([UPLOAD_PAGE, UPLOAD_SCRIPT].includes(url.pathname)) return browserUploadResponse(request, uploadsEnabled());
      if (url.pathname === '/diagnostics/stored-document') return await storedSyntheticResponse(request, owner, service, HwpDocument, origin());
      if (url.pathname === '/documents/import') {
        if (request.method !== 'POST') return new Response(null, { status: 405, headers: { Allow: 'POST' } });
        if (!uploadsEnabled()) fail('DOCUMENT_UPLOADS_NOT_ENABLED');
        if (url.search) fail('INVALID_UPLOAD_REQUEST');
        const request_id = request.headers.get('hwp-request-id');
        if (!new RegExp(`^${uuid}$`).test(request_id ?? '')) fail('INVALID_IDENTIFIER');
        // Cookie-based browser upload requests must have a same-origin Origin.
        const source = request.headers.get('origin');
        if (source !== origin()) fail('UPLOAD_ORIGIN_REQUIRED');
        if (!['application/x-hwp', 'application/octet-stream'].includes(request.headers.get('content-type'))) fail('INVALID_UPLOAD_CONTENT_TYPE');
        const bytes = await boundedBytes(request.body, store.limits.max_bytes, request.headers.get('content-length'));
        return jsonResponse(await service.create({ owner, request_id, bytes }));
      }
      if (request.method !== 'GET') return new Response(null, { status: 405, headers: { Allow: 'GET' } });
      if (viewerMatch(url.pathname)) return await documentViewerResponse(url, owner, service);
      return await download(request.url, owner);
    } catch (error) {
      const code = errorCode(error);
      return jsonResponse({ error: code }, code === 'DOCUMENT_OR_VERSION_NOT_FOUND' ? 404 : 400);
    }
  }
  async function call(name, args, request) {
    const owner = await authenticatedOwner(request.headers);
    const { _synthetic_output, _document_output, ...data } = await tool(name, args, owner);
    const resource = _document_output ?? _synthetic_output;
    const result = { stage: 'private-development', data, layout_verified: false };
    return { content: [{ type: 'text', text: JSON.stringify(result) }, ...(resource ? [resource] : [])], structuredContent: result };
  }
  return Object.freeze({ http, call, tools: documentTools, errorCode });
}
