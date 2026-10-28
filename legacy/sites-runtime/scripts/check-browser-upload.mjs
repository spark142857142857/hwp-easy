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
  const snapshot = async () => {
    const tables = {};
    for (const table of ['hwp_documents','hwp_versions','hwp_requests']) {
      tables[table] = (await db.prepare(`SELECT * FROM ${table} ORDER BY owner, id`).all()).results;
    }
    const blobs = [];
    for (const entry of (await bucket.list()).objects.sort((a,b) => a.key.localeCompare(b.key))) {
      const object = await bucket.get(entry.key);
      const digest = await crypto.subtle.digest('SHA-256', await object.arrayBuffer());
      blobs.push({key:entry.key, size:entry.size, sha256:Buffer.from(digest).toString('hex')});
    }
    return {tables,blobs};
  };
  // Commit the real import, then replace only its acknowledgement. Never turn
  // a transport/response fault into a new upload or a claim that nothing saved.
  for (const fault of ['malformed-success','gateway','reauthentication','later-refusal']) {
    const baselineCount = await count(), sent = []; let committed, beforeRetry;
    const h = uploadClientHarness(async (url, init) => {
      sent.push(init);
      if (sent.length === 2 && ['reauthentication','later-refusal'].includes(fault)) {
        return fault === 'reauthentication' ? new Response('PRIVATE_SENTINEL', {status:401})
          : Response.json({error:'HOSTED_WORKLOAD_LIMIT_EXCEEDED',message:'PRIVATE_SENTINEL'}, {status:400});
      }
      const response = await mf.dispatchFetch(origin + url, {...init, headers:{...owner,Origin:origin,...init.headers}});
      assert.equal(response.status, 200); committed = await response.clone().json();
      if (sent.length === 1) {
        beforeRetry = await snapshot();
        if (fault === 'malformed-success') return Response.json({saved:true,document_id:'PRIVATE_SENTINEL',version_id:committed.version_id});
        if (fault === 'gateway') return Response.json({error:'DOCUMENT_OPERATION_FAILED',message:'PRIVATE_SENTINEL'}, {status:503});
        throw new Error('Lost response after commit');
      }
      assert.equal(committed.replayed, true); return response;
    });
    vm.runInNewContext(source, h.context);
    const selected = new File([bytes], `${fault}.hwp`, {type:'application/x-hwp'});
    h.select(selected); await h.submit(); assert.equal(await count(), baselineCount + 1);
    assert.equal(h.navigations.length, 0); assert.equal(h.elements.get('hwp-file').disabled, true);
    assert.equal(h.elements.get('upload-recovery').hidden, false);
    assert(!h.elements.get('upload-status').textContent.includes('PRIVATE_SENTINEL'));
    h.select(new File([new Uint8Array([1])], 'replacement.hwp')); await h.submit();
    if (['reauthentication','later-refusal'].includes(fault)) {
      assert(h.elements.get('upload-status').textContent.includes('이전 업로드 완료 여부는 아직 확인되지'));
      assert(!h.elements.get('upload-status').textContent.includes('업로드하지 않았'));
      assert.deepEqual(await snapshot(), beforeRetry);
      if (fault === 'reauthentication') await h.submit();
      else { await h.submit(); assert.equal(sent.length, 2); assert.equal(h.elements.get('upload-button').disabled, true); }
    }
    assert.equal(new Set(sent.map(r => r.headers['hwp-request-id'])).size, 1);
    assert(sent.every(r => r.body === selected));
    assert.deepEqual(await snapshot(), beforeRetry);
    assert.equal(h.navigations.length, fault === 'later-refusal' ? 0 : 1);
    assert.equal(h.elements.get('upload-recovery').hidden, fault !== 'later-refusal');
    const recovered = await mf.dispatchFetch(origin + `/documents/${committed.document_id}/versions/${committed.version_id}.hwp`, {headers:owner});
    assert.equal(recovered.status, 200); assert.deepEqual(new Uint8Array(await recovered.arrayBuffer()), bytes);
  }
  assert.equal(await count(), 5); assert.equal((await bucket.list()).objects.length, 5); assert.equal(outbound, 0);
  console.log(JSON.stringify({browser_upload_contract:'passed',actual_compiled_workerd_d1_r2_wasm:true,
    page_and_selection_read_only:true,disabled_gate_and_csrf_enforced:true,lost_ack_same_request_one_document:true,
    malformed_ack_gateway_and_auth_retry_one_document_each:true,later_refusal_preserves_prior_uncertainty:true,
    recovery_keeps_document_version_receipt_and_blob_bytes:true,synthetic_documents:5,
    selected_saved_version_viewer_and_exact_download:true,document_preview_stays_passive:true,
    identity_and_dom_are_mocks:true,actual_oauth_browser_upload_verified:false,layout_verified:false}));
} finally { await mf.dispose(); }
