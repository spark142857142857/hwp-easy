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
  assert(html.includes('40만 단위'));
  assert(html.includes('id="upload-recovery" hidden'));
  assert(html.includes('href="/documents" target="_blank" rel="noopener"'));
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
  assert.equal(h.elements.get('upload-recovery').hidden, true);
});

test('network failure keeps the original file and identity despite reselection; bad server IDs stay uncertain', async () => {
  const ids = []; let attempt = 0;
  const h = uploadClientHarness((url, init) => {
    ids.push(init.headers['hwp-request-id']); attempt++;
    if (attempt < 3) throw new Error('private error');
    return Response.json({saved:true, document_id:'https://other.invalid/',version_id});
  }); installUploadForm(h.context); h.select(file);
  await h.submit(); await h.submit(); assert.equal(ids[0], ids[1]);
  assert.equal(h.elements.get('hwp-file').disabled, true); assert.equal(h.elements.get('upload-recovery').hidden, false);
  h.select({...file,name:'다른 시험.hwp'}); await h.submit(); assert.equal(ids[1], ids[2]);
  assert.equal(h.navigations.length, 0); assert(!h.elements.get('upload-status').textContent.includes('private error'));
  assert(h.elements.get('upload-status').textContent.includes('완료 여부를 확인하지 못'));
  assert(!h.elements.get('upload-status').textContent.includes('손상'));
});

test('served standalone script works without module imports and refuses automatic retry of unsupported input', async () => {
  let requests = 0;
  const h = uploadClientHarness(() => { requests++; return Response.json({error:'DOCUMENT_OPERATION_FAILED'},{status:400}); });
  const source = await browserUploadResponse(new Request(origin + '/documents/upload-client.js'), true).text();
  vm.runInNewContext(source, h.context); h.select(file); await h.submit(); await h.submit();
  assert.equal(requests, 1); assert.equal(h.elements.get('upload-button').disabled, true);
});

test('hosted workload rejection explains the limit and prevents a repeated upload', async () => {
  let requests = 0;
  const h = uploadClientHarness(() => {
    requests++; return Response.json({ error: 'HOSTED_WORKLOAD_LIMIT_EXCEEDED', message: 'PRIVATE_SENTINEL' }, { status: 400 });
  });
  installUploadForm(h.context); h.select(file); await h.submit(); await h.submit();
  assert.equal(requests, 1); assert.equal(h.elements.get('upload-button').disabled, true);
  assert(h.elements.get('upload-status').textContent.includes('40만'));
  assert(!h.elements.get('upload-status').textContent.includes('PRIVATE_SENTINEL'));
});

test('malformed acknowledgements and gateway responses retain one request until a valid receipt arrives', async () => {
  const uncertainResponses = [
    () => Response.json({saved:true, document_id, version_id:null}),
    () => Response.json({saved:false, error:'HOSTED_WORKLOAD_LIMIT_EXCEEDED'}),
    () => Response.json(null), () => Response.json([]), () => Response.json('PRIVATE_SENTINEL'),
    () => new Response('<html>PRIVATE_SENTINEL</html>', {status:200}),
    () => Response.json({error:'PRIVATE_SENTINEL'}, {status:400}),
    () => Response.json({error:'DOCUMENT_OPERATION_FAILED', message:'PRIVATE_SENTINEL'}, {status:500}),
    () => new Response('PRIVATE_SENTINEL', {status:502}),
    () => Response.json({error:'PRIVATE_SENTINEL'}, {status:503}),
    () => new Response('PRIVATE_SENTINEL', {status:504}),
  ];
  for (const reply of uncertainResponses) {
    const requests = [];
    const h = uploadClientHarness((url, init) => {
      requests.push(init);
      return requests.length === 1 ? reply() : Response.json({saved:true,document_id,version_id});
    });
    installUploadForm(h.context); h.select(file); await h.submit();
    assert.equal(requests.length, 1); assert.equal(h.navigations.length, 0);
    assert.equal(h.elements.get('hwp-file').disabled, true);
    assert.equal(h.elements.get('upload-recovery').hidden, false);
    const message = h.elements.get('upload-status').textContent;
    assert(message.includes('완료 여부를 확인하지 못')); assert(!message.includes('손상'));
    assert(!message.includes('PRIVATE_SENTINEL')); assert(!message.includes('업로드하지 않았'));
    h.select({...file,name:'replacement.hwp'}); await h.submit();
    assert.equal(requests[0].headers['hwp-request-id'], requests[1].headers['hwp-request-id']);
    assert.equal(requests[1].body, file);
    assert.deepEqual(h.navigations, [`/documents/${document_id}/versions/${version_id}/view`]);
    assert.equal(h.elements.get('upload-recovery').hidden, true);
  }
});

test('reauthentication on retry preserves the uncertain request and can later receive the same receipt', async () => {
  for (const authReply of [() => Response.json({error:'AUTHENTICATION_REQUIRED'}, {status:401}),
    () => new Response('PRIVATE_SENTINEL', {status:401})]) {
    const requests = [];
    const h = uploadClientHarness((url, init) => {
      requests.push(init);
      if (requests.length === 1) throw new Error('lost reply');
      return requests.length === 2 ? authReply() : Response.json({saved:true,document_id,version_id});
    });
    installUploadForm(h.context); h.select(file); await h.submit(); await h.submit();
    assert(h.elements.get('upload-status').textContent.includes('이전 업로드 완료 여부는 아직 확인되지'));
    assert(h.elements.get('upload-status').textContent.includes('새 창에서 같은 계정'));
    assert(!h.elements.get('upload-status').textContent.includes('PRIVATE_SENTINEL'));
    assert.equal(h.elements.get('hwp-file').disabled, true);
    h.select({...file,name:'replacement.hwp'}); await h.submit();
    assert.equal(new Set(requests.map(r => r.headers['hwp-request-id'])).size, 1);
    assert(requests.every(r => r.body === file)); assert.equal(h.navigations.length, 1);
  }
});

test('a later input refusal does not turn an earlier uncertain upload into a confirmed failure', async () => {
  for (const error of ['HOSTED_WORKLOAD_LIMIT_EXCEEDED','DOCUMENT_OPERATION_FAILED','TRANSFER_LIMIT_EXCEEDED']) {
    let requests = 0;
    const h = uploadClientHarness(() => {
      if (++requests === 1) throw new Error('lost reply');
      return Response.json({error, message:'PRIVATE_SENTINEL'}, {status:400});
    });
    installUploadForm(h.context); h.select(file); await h.submit(); await h.submit();
    assert(h.elements.get('upload-status').textContent.includes('이전 업로드 완료 여부는 아직 확인되지'));
    assert(!h.elements.get('upload-status').textContent.includes('업로드하지 않았'));
    assert.equal(h.elements.get('hwp-file').disabled, true);
    assert.equal(h.elements.get('upload-button').disabled, true);
    assert.equal(h.elements.get('upload-recovery').hidden, false);
    h.select({...file,name:'replacement.hwp'}); await h.submit(); assert.equal(requests, 2);
    assert.equal(h.navigations.length, 0);
  }
});

test('a first confirmed input refusal allows a fresh selection with a new request', async () => {
  const requests = [];
  const h = uploadClientHarness((url, init) => {
    requests.push(init);
    return requests.length === 1 ? Response.json({error:'HOSTED_WORKLOAD_LIMIT_EXCEEDED'}, {status:400})
      : Response.json({saved:true,document_id,version_id});
  });
  installUploadForm(h.context); h.select(file); await h.submit(); await h.submit();
  assert.equal(requests.length, 1); assert.equal(h.elements.get('hwp-file').disabled, false);
  const replacement = {...file,name:'replacement.hwp'}; h.select(replacement); await h.submit();
  assert.notEqual(requests[0].headers['hwp-request-id'], requests[1].headers['hwp-request-id']);
  assert.equal(requests[1].body, replacement); assert.equal(h.navigations.length, 1);
});

test('failed navigation after a valid receipt reports confirmed saving and does not resend', async () => {
  let requests = 0;
  const h = uploadClientHarness(() => { requests++; return Response.json({saved:true,document_id,version_id}); });
  h.context.location.assign = () => { throw new Error('PRIVATE_SENTINEL'); };
  installUploadForm(h.context); h.select(file); await h.submit(); await h.submit();
  assert.equal(requests, 1); assert.equal(h.elements.get('upload-button').disabled, true);
  assert.equal(h.elements.get('hwp-file').disabled, false);
  assert(h.elements.get('upload-status').textContent.includes('업로드 완료는 확인했지만'));
  assert(!h.elements.get('upload-status').textContent.includes('PRIVATE_SENTINEL'));
  assert.equal(h.elements.get('upload-recovery').hidden, false);
  h.select({...file,name:'next.hwp'});
  assert.equal(h.elements.get('upload-recovery').hidden, true);
  assert.equal(h.elements.get('upload-button').disabled, false);
});
