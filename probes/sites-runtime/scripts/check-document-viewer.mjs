// Real workerd/D1/R2/WASM, but identity headers are mocks, not real OAuth.
// The only HTTP seed uses a fixed built-in document. No personal source/network.
import assert from 'node:assert/strict';
import path from 'node:path';
import { Miniflare, convertV4MiniflareOptions } from 'miniflare';
import { applyTestMigrations } from './migrations.mjs';
import { verifySyntheticDownload } from '../host/synthetic-download.mjs';
const origin = 'https://stored.invalid';
let outbound = 0;
const options = () => convertV4MiniflareOptions({
  compatibilityDate: '2026-10-01', modulesRoot: path.resolve('dist/server'),
  modules: [{ type: 'ESModule', path: path.resolve('dist/server/index.js') },
    { type: 'CompiledWasm', path: path.resolve('dist/server/rhwp_bg.wasm') }],
  d1Databases: { DB: 'stored-document-d1' }, r2Buckets: { BUCKET: 'stored-document-r2' },
  bindings: { HWP_EASY_ORIGIN: origin, HWP_EASY_ALLOW_UPLOADS: 'false', HWP_EASY_FILE_ORIGINS: '[]' },
  outboundService: () => { outbound++; throw new Error('No external network'); },
});
const mf = new Miniflare(options());
const a = { 'oai-authenticated-user-id': 'stored-a', 'oai-authenticated-user-email': 'a@example.invalid' };
const b = { 'oai-authenticated-user-id': 'stored-b', 'oai-authenticated-user-email': 'b@example.invalid' };
const seedRoute = '/diagnostics/stored-document', checks = [];
const requestId = crypto.randomUUID(), validBody = new URLSearchParams({ request_id: requestId, confirmation: 'create_fixed_synthetic' }).toString();
const post = (body = validBody, headers = {}) => mf.dispatchFetch(origin + seedRoute, { method: 'POST',
  headers: { ...a, Origin: origin, 'Content-Type': 'application/x-www-form-urlencoded', ...headers }, body, redirect: 'manual' });
const invoke = async (name, args, identity = a) => {
  const response = await mf.dispatchFetch(origin + '/mcp', { method: 'POST', headers: { ...identity, 'Content-Type': 'application/json' },
    body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name, arguments: args } }) });
  assert.equal(response.status, 200); return (await response.json()).result;
};
try {
  let db = await mf.getD1Database('DB'), bucket = await mf.getR2Bucket('BUCKET');
  await applyTestMigrations(db);
  const count = async () => (await db.prepare('SELECT count(*) AS n FROM hwp_documents').first()).n;
  for (const init of [{}, { method: 'POST', body: validBody }]) assert.equal((await mf.dispatchFetch(origin + seedRoute, init)).status, 401);
  assert.equal(await count(), 0);
  const seed = await mf.dispatchFetch(origin + seedRoute, { headers: a });
  assert.equal(seed.status, 200);
  assert.equal(seed.headers.get('Referrer-Policy'), 'same-origin');
  const html = await seed.text();
  assert(html.includes('method="post"')); assert(html.includes('합성 시험 문서 저장하기'));
  assert.equal(await count(), 0); assert.equal((await bucket.list()).objects.length, 0);
  checks.push('anonymous_or_partial_identity_denied_get_seed_is_read_only');

  for (const [body, headers] of [[validBody, { Origin: 'https://other.invalid' }], [validBody, { Origin: '' }], [validBody, { Origin: 'null' }],
    [validBody, { 'Content-Type': 'application/json' }], ['request_id=private', {}], [validBody + '&owner=other', {}],
    [validBody + '&request_id=' + requestId, {}], [validBody.replace('create_fixed_synthetic', 'upload_private'), {}]]) {
    assert.equal((await post(body, headers)).status, 400);
    assert.equal(await count(), 0); assert.equal((await bucket.list()).objects.length, 0);
  }
  assert.equal((await post('x'.repeat(257))).status, 400);
  const badQuery = await mf.dispatchFetch(origin + seedRoute + '?document_id=private', { headers: a });
  assert.equal(badQuery.status, 400);
  checks.push('csrf_origin_content_type_confirmation_extra_input_size_and_query_rejected_before_storage');

  const created = await post(); assert.equal(created.status, 303);
  const location = created.headers.get('Location');
  const match = location.match(/^\/documents\/([^/]+)\/versions\/([^/]+)\/view$/);
  assert(match); const document_id = match[1], version_id = match[2];
  assert.equal((await post()).headers.get('Location'), location);
  assert.equal(await count(), 1); assert.equal((await bucket.list()).objects.length, 1);
  const capture = async () => ({ keys: (await bucket.list()).objects.map((o) => o.key).sort(),
    versions: (await db.prepare('SELECT count(*) AS n FROM hwp_versions').first()).n });
  const before = await capture();
  for (const suffix of ['/view', '.hwp', '/pages/0.svg']) {
    const address = `/documents/${document_id}/versions/${version_id}${suffix}`;
    assert.equal((await mf.dispatchFetch(origin + address)).status, 401);
    assert.equal((await mf.dispatchFetch(origin + address, { headers: b })).status, 404);
    const response = await mf.dispatchFetch(origin + address, { headers: a });
    assert.equal(response.status, 200);
    if (suffix === '.hwp') await verifySyntheticDownload(new Uint8Array(await response.arrayBuffer()));
    if (suffix === '/pages/0.svg') { assert.equal(response.headers.get('Content-Type'), 'image/svg+xml; charset=utf-8'); assert((await response.text()).includes('<svg')); }
    if (suffix === '/view') { assert.equal(response.headers.get('Referrer-Policy'), 'no-referrer'); const text = await response.text(); assert(text.includes('현재 저장본')); assert(text.includes('세부 배치는 미검증')); }
  }
  assert.deepEqual(await capture(), before);
  checks.push('exact_seed_retry_one_document_one_version_owner_scoped_view_hwp_svg_reads_without_mutation');

  const read = (await invoke('hwp_read', { document_id, version_id })).structuredContent.data;
  const target = read.blocks.find((v) => v.kind === 'paragraph' && v.editable && v.text);
  const edited = (await invoke('hwp_edit', { document_id, expected_version: version_id, expected_sha256: read.source_sha256,
    request_id: crypto.randomUUID(), operations: [{ target_id: target.target_id, expected_old: target.text, new_text: '저장 버전 연결 시험 😀' }] })).structuredContent.data;
  assert(edited.saved); assert.notEqual(edited.version_id, version_id);
  const download = (await invoke('hwp_download', { document_id, version_id: edited.version_id })).structuredContent.data;
  assert.equal(download.viewer_url, `${origin}/documents/${document_id}/versions/${edited.version_id}/view`);
  const preview = (await invoke('hwp_preview', { document_id, version_id: edited.version_id, page: 0 })).structuredContent.data;
  assert.equal(preview.viewer_url, download.viewer_url + '?page=0');
  const oldView = await mf.dispatchFetch(origin + location, { headers: a });
  const oldHtml = await oldView.text(); assert(oldHtml.includes('이전 저장본')); assert(oldHtml.includes('저장 버전 (2개)'));
  assert(oldHtml.includes(`href="/documents/${document_id}/versions/${edited.version_id}/view">현재 저장본 보기`));
  assert(oldHtml.includes('<details><summary>파일 정보</summary>'));
  const oldHwp = await mf.dispatchFetch(origin + location.replace('/view', '.hwp'), { headers: a });
  await verifySyntheticDownload(new Uint8Array(await oldHwp.arrayBuffer()));
  const currentHwp = await mf.dispatchFetch(download.download_url, { headers: a });
  const currentBytes = new Uint8Array(await currentHwp.arrayBuffer());
  const sha = [...new Uint8Array(await crypto.subtle.digest('SHA-256', currentBytes))].map((n) => n.toString(16).padStart(2, '0')).join('');
  assert.equal(sha, edited.sha256);
  const history = (await invoke('hwp_versions', { document_id })).structuredContent.data;
  assert.equal(history.current_version, edited.version_id); assert.equal(history.versions.length, 2);
  const invalid = await mf.dispatchFetch(origin + location + '?page=1&page=2', { headers: a });
  assert.equal(invalid.status, 400);
  // Restart the actual Worker isolate; keep the same emulator's durable DB/bucket.
  await mf.setOptions(options());
  db = await mf.getD1Database('DB'); bucket = await mf.getR2Bucket('BUCKET');
  const afterRestart = await mf.dispatchFetch(download.viewer_url, { headers: a });
  assert.equal(afterRestart.status, 200); assert((await afterRestart.text()).includes(edited.sha256));
  assert.equal(await count(), 1);
  checks.push('mcp_edit_and_links_share_stored_version_old_version_stays_read_only_and_survives_worker_restart');

  const deleted = await invoke('hwp_delete', { document_id, expected_version: edited.version_id,
    request_id: crypto.randomUUID(), confirmation: 'delete_document_and_recorded_versions' });
  assert(deleted.structuredContent.data.deleted);
  for (const suffix of ['/view', '.hwp', '/pages/0.svg']) assert.equal((await mf.dispatchFetch(
    `${origin}/documents/${document_id}/versions/${edited.version_id}${suffix}`, { headers: a })).status, 404);
  assert.equal(await count(), 0); assert.equal((await bucket.list()).objects.length, 0);
  checks.push('explicit_delete_revokes_view_binary_and_svg_without_recreating_document');
  assert.equal(outbound, 0);
  console.log(JSON.stringify({ stored_document_viewer_contract: 'passed', checks, actual_workerd_d1_r2_and_hwp: true,
    identity_is_mock_not_oauth: true, uploads_enabled: false, actual_browser_and_mcp_shared_identity_verified: false, layout_verified: false }));
} finally { await mf.dispose(); }
