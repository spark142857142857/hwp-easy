// Real compiled Worker/D1/R2/WASM and the served client script. Identity/DOM
// are mocks; this is not an OAuth or actual browser proof.
import assert from 'node:assert/strict';
import path from 'node:path';
import vm from 'node:vm';
import { Miniflare, convertV4MiniflareOptions } from 'miniflare';
import { applyTestMigrations } from './migrations.mjs';
import { verifySyntheticDownload } from '../host/synthetic-download.mjs';
import { uploadClientHarness } from '../tests/upload-client-fixtures.mjs';
const origin = 'https://upload.invalid';
let outbound = 0;
const options = (enabled) => convertV4MiniflareOptions({
  compatibilityDate: '2026-10-01', modulesRoot: path.resolve('dist/server'),
  modules: [{ type: 'ESModule', path: path.resolve('dist/server/index.js') },
    { type: 'CompiledWasm', path: path.resolve('dist/server/rhwp_bg.wasm') }],
  d1Databases: { DB: 'upload-d1' }, r2Buckets: { BUCKET: 'upload-r2' },
  bindings: { HWP_EASY_ORIGIN: origin, HWP_EASY_ALLOW_UPLOADS: String(enabled), HWP_EASY_FILE_ORIGINS: '[]' },
  outboundService: () => { outbound++; throw new Error('No external network'); },
});
const mf = new Miniflare(options(false));
const owner = { 'oai-authenticated-user-id': 'upload-owner', 'oai-authenticated-user-email': 'a@example.invalid' };
const other = { 'oai-authenticated-user-id': 'upload-other', 'oai-authenticated-user-email': 'b@example.invalid' };
try {
  let db = await mf.getD1Database('DB'); await applyTestMigrations(db);
  const count = async () => (await db.prepare('SELECT count(*) AS n FROM hwp_documents').first()).n;
  for (const route of ['/documents/upload', '/documents/upload-client.js']) {
    assert.equal((await mf.dispatchFetch(origin + route)).status, 401);
    assert.equal((await mf.dispatchFetch(origin + route, {headers:{'oai-authenticated-user-id':'partial'}})).status, 401);
  }
  const disabled = await (await mf.dispatchFetch(origin + '/documents/upload', {headers:owner})).text();
  assert(!disabled.includes('<form')); assert(!disabled.includes('<script'));
  assert.equal(await count(), 0);
  await mf.setOptions(options(true)); db = await mf.getD1Database('DB');
  const page = await mf.dispatchFetch(origin + '/documents/upload', {headers:owner});
  assert.equal(page.status, 200); assert((await page.text()).includes('type="file"'));
  assert(page.headers.get('Content-Security-Policy').includes("script-src 'self'"));
  assert.equal(page.headers.get('Referrer-Policy'), 'same-origin');
  assert.equal(await count(), 0);
  const script = await mf.dispatchFetch(origin + '/documents/upload-client.js', {headers:owner});
  assert.equal(script.headers.get('Content-Type'), 'text/javascript; charset=utf-8');
  const source = await script.text();
  for (const suffix of ['/documents/upload?owner=x', '/documents/upload-client.js?x=1']) {
    assert.equal((await mf.dispatchFetch(origin + suffix, {headers:owner})).status, 400);
  }
  const bytes = new Uint8Array(await (await mf.dispatchFetch(origin + '/diagnostics/synthetic-result.hwp', {headers:owner})).arrayBuffer());
  await verifySyntheticDownload(bytes);
  for (const [headers, body] of [[{Origin:'https://other.invalid'},bytes],[{Origin:'null'},bytes],[{},new Uint8Array([1,2])]]) {
    const denied = await mf.dispatchFetch(origin + '/documents/import', {method:'POST',headers:{...owner,
      Origin:origin,'Content-Type':'application/x-hwp','hwp-request-id':crypto.randomUUID(),...headers},body});
    assert.equal(denied.status, 400); assert.equal(await count(), 0);
  }
  const requests = []; let saved;
  const client = uploadClientHarness(async (url, init) => {
    assert.equal(url, '/documents/import'); requests.push(init.headers['hwp-request-id']);
    const result = await mf.dispatchFetch(origin + url, {...init, headers:{...owner,Origin:origin,...init.headers}});
    assert.equal(result.status, 200); saved = await result.clone().json();
    if (requests.length === 1) throw new Error('Simulated lost acknowledgement after committed upload');
    return result;
  });
  vm.runInNewContext(source, client.context);
  client.select(new File([bytes], '합성 업로드 시험.hwp', {type:'application/x-hwp'}));
  assert.equal(await count(), 0); assert.equal(requests.length, 0);
  await client.submit(); assert.equal(await count(), 1); assert.equal(client.navigations.length, 0);
  await client.submit(); assert.equal(await count(), 1); assert(saved.replayed);
  assert.equal(requests[0], requests[1]);
  const viewer = `/documents/${saved.document_id}/versions/${saved.version_id}/view`;
  assert.deepEqual(client.navigations, [viewer]);
  assert.equal((await mf.dispatchFetch(origin + viewer, {headers:other})).status, 404);
  const viewed = await mf.dispatchFetch(origin + viewer, {headers:owner}); assert.equal(viewed.status, 200);
  assert(viewed.headers.get('Content-Security-Policy').includes("script-src 'self'; connect-src 'none'"));
  const viewerHtml = await viewed.text();
  assert(viewerHtml.includes('<script src="/documents/handoff-client.js" defer></script>'));
  assert(!viewerHtml.includes('upload-client.js'));
  const download = await mf.dispatchFetch(origin + viewer.replace('/view', '.hwp'), {headers:owner});
  assert.deepEqual(new Uint8Array(await download.arrayBuffer()), bytes);
  const bucket = await mf.getR2Bucket('BUCKET'); assert.equal((await bucket.list()).objects.length, 1);
  assert.equal(await count(), 1); assert.equal(outbound, 0);
  console.log(JSON.stringify({browser_upload_contract:'passed',actual_compiled_workerd_d1_r2_wasm:true,
    page_and_selection_read_only:true,disabled_gate_and_csrf_enforced:true,lost_ack_same_request_one_document:true,
    selected_saved_version_viewer_and_exact_download:true,document_preview_stays_passive:true,
    identity_and_dom_are_mocks:true,actual_oauth_browser_upload_verified:false,layout_verified:false}));
} finally { await mf.dispose(); }
