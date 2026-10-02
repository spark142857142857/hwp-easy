import { createVersionStore, StorageError } from '../storage/store.mjs';
import { createDocumentService } from '../storage/service.mjs';
import { authenticatedOwner, boundedBytes, configuredOrigin, configuredFileOrigins, fetchInputFile } from './transfer.mjs';
import { documentTools, validateArguments } from './tools.mjs';
import { createEngineApi } from '../../../src/one_hwp/rhwp_api.mjs';
import { syntheticFixture } from '../../../src/one_hwp/synthetic_fixtures.mjs';
const fail = (code) => { throw new StorageError(code); };
const uuid = '[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}';
const jsonResponse = (data, status = 200) => Response.json(data, { status,
  headers: { 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' } });
const errorCode = (error) => typeof error?.code === 'string' && /^[A-Z][A-Z0-9_]{0,80}$/.test(error.code) ? error.code : 'DOCUMENT_OPERATION_FAILED';

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
      max_input_bytes: store.limits.max_bytes, max_versions_per_document: store.limits.max_versions_per_document,
      default_save: 'same_remote_document', pc_original_updated: false, layout_verified: false,
      native_file_attachment_verified: false, codex_cloud_client_verified: false, dots_client_verified: false,
      retention: 'production_policy_not_finalized_uploads_default_off' };
    if (name === 'hwp_import') {
      if (!uploadsEnabled()) fail('DOCUMENT_UPLOADS_NOT_ENABLED');
      const bytes = await fetchInputFile(args.file, env.HWP_EASY_FILE_ORIGINS, fetcher);
      return service.create({ owner, request_id: args.request_id, bytes });
    }
    if (name === 'hwp_edit') return service.edit({ owner, ...args,
      request: { expected_sha256: args.expected_sha256, operations: args.operations } });
    if (name === 'hwp_restore') return service.restore({ owner, ...args });
    if (name === 'hwp_versions') return { document_id: args.document_id,
      versions: await service.history({ owner, document_id: args.document_id }) };
    if (name === 'hwp_workflow_probe') return workflow(owner);
    const { snapshot, metadata } = await service.open({ owner, document_id: args.document_id, version_id: args.version_id });
    if (name === 'hwp_read') return { ...snapshot.read({ expected_sha256: metadata.sha256,
      ...(args.cursor ? { cursor: args.cursor } : {}), ...(args.max_chars ? { max_chars: args.max_chars } : {}),
      ...(args.max_blocks ? { max_blocks: args.max_blocks } : {}) }), storage: metadata };
    if (name === 'hwp_plan') return { ...snapshot.plan({ expected_sha256: args.expected_sha256, operations: args.operations }),
      storage: metadata, stale_for_save: metadata.version_id !== metadata.current_version };
    const base = `${origin()}/documents/${args.document_id}/versions/${args.version_id}`;
    if (name === 'hwp_download') return { ...metadata, download_url: `${base}.hwp`, mime_type: 'application/x-hwp',
      requires_same_user_sign_in: true, public_share_link: false };
    snapshot.preview({ expected_sha256: metadata.sha256, page: args.page });
    return { ...metadata, preview_url: `${base}/pages/${args.page}.svg`, requires_same_user_sign_in: true, layout_verified: false };
  }
  async function removeGeneratedDocument(owner, documentId) {
    // Called ONLY with the random id generated inside workflow(), never a tool argument.
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
    ]);
  }
  async function workflow(owner) {
    const api = createEngineApi(HwpDocument);
    const bytes = syntheticFixture(HwpDocument, api.exportChecked, { paragraphs: ['합성 에이전트 문서', '합성 에이전트 문서'] });
    let created, report;
    const check = (value) => { if (!value) fail('WORKFLOW_PROBE_FAILED'); };
    try {
      created = await service.create({ owner, request_id: crypto.randomUUID(), bytes });
      const input = { document_id: created.document_id, version_id: created.version_id, max_chars: 5 };
      const found = new Map(); let cursor, pages = 0;
      do {
        const read = await tool('hwp_read', { ...input, ...(cursor ? { cursor } : {}) }, owner);
        for (const block of read.blocks) found.set(block.id, { ...block, text: (found.get(block.id)?.text ?? '') + block.text });
        cursor = read.next_cursor; check(++pages < 100);
      } while (cursor);
      const blocks = [...found.values()], body = blocks.find((b) => b.kind === 'paragraph' && b.editable && b.text),
        cell = blocks.find((b) => b.kind === 'cell' && b.editable && b.text);
      check(body && cell);
      const edits = { expected_sha256: created.sha256, operations: [body, cell].map((b, i) => ({
        target_id: b.target_id, expected_old: b.text, new_text: `인증 범위 합성 편집 ${i} 😀` })) };
      check((await tool('hwp_plan', { document_id: created.document_id, version_id: created.version_id, ...edits }, owner)).file_changed === false);
      const editArgs = { document_id: created.document_id, expected_version: created.version_id,
        request_id: crypto.randomUUID(), ...edits };
      const edited = await tool('hwp_edit', editArgs, owner), replayed = await tool('hwp_edit', editArgs, owner);
      check(edited.saved && edited.raw_preservation_verified && replayed.replayed && replayed.version_id === edited.version_id);
      const link = await tool('hwp_download', { document_id: created.document_id, version_id: edited.version_id }, owner);
      const output = await download(link.download_url, owner);
      check(output.status === 200 && output.headers.get('content-type') === 'application/x-hwp');
      const reopened = await engine.open(new Uint8Array(await output.arrayBuffer()));
      const after = reopened.read({ expected_sha256: reopened.source_sha256 });
      check(after.blocks.find((b) => b.id === body.id).text === edits.operations[0].new_text);
      check(after.blocks.find((b) => b.id === cell.id).text === edits.operations[1].new_text);
      const preview = await tool('hwp_preview', { document_id: created.document_id, version_id: edited.version_id, page: 0 }, owner);
      check((await download(preview.preview_url, owner)).status === 200);
      const restored = await tool('hwp_restore', { document_id: created.document_id, expected_version: edited.version_id,
        source_version: created.version_id, request_id: crypto.randomUUID() }, owner);
      check(restored.sha256 === created.sha256 && restored.version_id !== created.version_id);
      check((await tool('hwp_versions', { document_id: created.document_id }, owner)).versions.length === 3);
      report = { passed: true, scope: 'signed_in_user_fixed_synthetic_only', persistence: 'd1-r2',
        owner_source: 'sites_dispatch_authenticated_identity', pages, read_plan_edit_default_save: true,
        owner_scoped_binary_handler_and_reopen: true, owner_scoped_svg_handler: true,
        external_http_download_verified: false,
        request_replay: true, previous_version_restore: true, native_file_attachment_verified: false,
        real_two_user_oauth_verified: false, codex_cloud_client_verified: false, dots_client_verified: false,
        uploads_enabled: uploadsEnabled(), layout_verified: false };
    } finally {
      if (created) {
        try { await removeGeneratedDocument(owner, created.document_id); }
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
      return await download(request.url, owner);
    } catch (error) { return jsonResponse({ error: errorCode(error) }, error?.code === 'DOCUMENT_OR_VERSION_NOT_FOUND' ? 404 : 400); }
  }
  async function call(name, args, request) {
    const owner = await authenticatedOwner(request.headers);
    const data = await tool(name, args, owner);
    const result = { stage: 'private-development', data, layout_verified: false };
    return { content: [{ type: 'text', text: JSON.stringify(result) }], structuredContent: result };
  }
  return Object.freeze({ http, call, tools: documentTools, errorCode });
}
