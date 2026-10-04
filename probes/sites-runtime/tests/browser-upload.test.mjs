import assert from 'node:assert/strict';
import test from 'node:test';
import vm from 'node:vm';
import { browserUploadResponse } from '../host/browser-upload.mjs';
import { installUploadForm } from '../host/upload-client.mjs';
import { uploadClientHarness } from './upload-client-fixtures.mjs';
const origin = 'https://upload.invalid', page = new Request(origin + '/documents/upload');
const file = { name: '합성 시험.hwp', size: 13312 }, document_id = crypto.randomUUID(), version_id = crypto.randomUUID();

test('upload page has an explicit file action and scoped script policy; disabled gate offers no form', async () => {
  const enabled = browserUploadResponse(page, true), html = await enabled.text();
  assert(html.includes('type="file"')); assert(html.includes('type="submit" disabled'));
  assert(html.includes('직접 삭제할 때까지 보관')); assert(html.includes('PC 원본은 변경하지 않습니다'));
  assert.equal(enabled.headers.get('Referrer-Policy'), 'same-origin');
  assert(enabled.headers.get('Content-Security-Policy').includes("script-src 'self'; connect-src 'self'"));
  const disabled = await browserUploadResponse(page, false).text();
  assert(!disabled.includes('<form')); assert(!disabled.includes('<script'));
  for (const suffix of ['/documents/upload?owner=other', '/documents/upload-client.js?v=1']) {
    assert.throws(() => browserUploadResponse(new Request(origin + suffix), true), e => e.code === 'INVALID_UPLOAD_REQUEST');
  }
});

test('browser file rejection never sends bytes, and file selection alone does not upload', async () => {
  let requests = 0;
  const h = uploadClientHarness(() => { requests++; throw new Error(); }); installUploadForm(h.context);
  for (const bad of [{name:'x.hwpx',size:1},{name:'x.hwp',size:0},{name:'x.hwp',size:4194305}]) { h.select(bad); await h.submit(); }
  h.select(file); assert.equal(requests, 0); assert.equal(h.elements.get('upload-button').disabled, false);
});

test('unknown outcomes reuse the same bytes and UUID, suppress parallel writes and navigate only to validated saved IDs', async () => {
  const requests = []; let release;
  const h = uploadClientHarness((url, init) => {
    requests.push({ url, init });
    if (requests.length === 1) return new Promise(resolve => { release = resolve; });
    return Response.json({saved:true, document_id, version_id});
  }); installUploadForm(h.context); h.select(file);
  const pending = h.submit(); await h.submit(); assert.equal(requests.length, 1);
  release(Response.json({error:'COMMIT_OUTCOME_UNKNOWN', message:'<secret>'}, {status:400})); await pending;
  assert(!h.elements.get('upload-status').textContent.includes('<secret>'));
  await h.submit(); assert.equal(requests.length, 2);
  assert.equal(requests[0].init.headers['hwp-request-id'], requests[1].init.headers['hwp-request-id']);
  assert.equal(requests[0].init.body, requests[1].init.body);
  assert.equal(requests[1].init.credentials, 'same-origin'); assert.equal(requests[1].init.redirect, 'error');
  assert.deepEqual(h.navigations, [`/documents/${document_id}/versions/${version_id}/view`]);
});

test('network failure retains retry identity; new selection resets it; bad server IDs never redirect', async () => {
  const ids = []; let attempt = 0;
  const h = uploadClientHarness((url, init) => {
    ids.push(init.headers['hwp-request-id']); attempt++;
    if (attempt < 3) throw new Error('private error');
    return Response.json({saved:true, document_id:'https://other.invalid/',version_id});
  }); installUploadForm(h.context); h.select(file);
  await h.submit(); await h.submit(); assert.equal(ids[0], ids[1]);
  h.select({...file,name:'다른 시험.hwp'}); await h.submit(); assert.notEqual(ids[1], ids[2]);
  assert.equal(h.navigations.length, 0); assert(!h.elements.get('upload-status').textContent.includes('private error'));
});

test('served standalone script works without module imports and refuses automatic retry of unsupported input', async () => {
  let requests = 0;
  const h = uploadClientHarness(() => { requests++; return Response.json({error:'DOCUMENT_OPERATION_FAILED'},{status:400}); });
  const source = await browserUploadResponse(new Request(origin + '/documents/upload-client.js'), true).text();
  vm.runInNewContext(source, h.context); h.select(file); await h.submit(); await h.submit();
  assert.equal(requests, 1); assert.equal(h.elements.get('upload-button').disabled, true);
});
