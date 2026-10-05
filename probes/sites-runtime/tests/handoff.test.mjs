import assert from 'node:assert/strict';
import test from 'node:test';
import vm from 'node:vm';
import { handoffRequest, handoffScriptResponse } from '../host/handoff.mjs';
import { installHandoff } from '../host/handoff-client.mjs';
import { documentViewerResponse } from '../host/document-viewer.mjs';
const origin = 'https://handoff.invalid', document_id = crypto.randomUUID();
const version_id = crypto.randomUUID(), current = crypto.randomUUID(), sha256 = 'a'.repeat(64);
const requestText = handoffRequest(origin, document_id, version_id);
function harness(clipboard) {
  const callbacks = new Map(), elements = new Map(); let deadline;
  for (const id of ['handoff-copy', 'handoff-request', 'handoff-details', 'handoff-status']) {
    elements.set(id, { value: id === 'handoff-request' ? requestText : '', textContent: '',
      disabled: true, open: false, focus() { this.focused = true; }, select() { this.selected = true; },
      addEventListener(name, action) { callbacks.set(name, action); } });
  }
  const context = { document: { getElementById: id => elements.get(id) }, navigator: { clipboard },
    setTimeout(action) { deadline = action; return 1; }, clearTimeout() { deadline = null; } };
  return { elements, context, click: () => callbacks.get('click')(), timeout: () => deadline() };
}

test('handoff points to exact selected version with no page, token, text or write request', () => {
  assert(requestText.includes(`${origin}/documents/${document_id}/versions/${version_id}/view`));
  assert(requestText.includes(`문서 ID: ${document_id}\n버전 ID: ${version_id}`));
  assert(requestText.includes('파일은 수정하거나 저장하지 마'));
  assert(!requestText.includes(current)); assert(!requestText.includes(sha256));
  for (const badOrigin of ['https://user:secret@handoff.invalid', origin + '/private', origin + '?token=secret', 'http://handoff.invalid'])
    assert.throws(() => handoffRequest(badOrigin, document_id, version_id));
  assert.throws(() => handoffRequest(origin, '<script>', version_id));
});

test('older viewer requests retain selected ID after current pointer changes, with canonical host', async () => {
  const calls = [], nextCurrent = crypto.randomUUID(); let pointer = current;
  const service = {
    open(args) { calls.push(args); return { metadata: { sha256 }, snapshot: { preview() { throw Error('PRIVATE_MARKER'); } } }; },
    history() { return [{ version_id, sha256, byte_size: 1, created_at: 1, current_version: pointer },
      { version_id: pointer, sha256, byte_size: 1, created_at: 2, current_version: pointer }]; },
  };
  const url = new URL(`https://incoming.invalid/documents/${document_id}/versions/${version_id}/view`);
  for (const newPointer of [current, nextCurrent]) {
    pointer = newPointer;
    const html = await (await documentViewerResponse(url, 'mock-owner', service, origin)).text();
    const text = html.match(/<textarea[^>]+>([^<]+)<\/textarea>/)[1];
    assert.equal(text, requestText); assert(!text.includes(newPointer)); assert(!text.includes('incoming.invalid'));
    assert(!html.includes('PRIVATE_MARKER')); assert(html.includes('readonly')); assert(html.includes('<noscript>'));
  }
  assert(calls.every((args) => args.owner === 'mock-owner' && args.version_id === version_id));
});

test('copy is an explicit action and served script is self-contained without document-specific data', async () => {
  const copied = [], h = harness({ writeText(value) { copied.push(value); return Promise.resolve(); } });
  const response = handoffScriptResponse(new Request(origin + '/documents/handoff-client.js'));
  assert.equal(response.headers.get('Content-Type'), 'text/javascript; charset=utf-8');
  assert.equal(response.headers.get('Cache-Control'), 'private, no-store');
  const source = await response.text();
  assert(!source.includes(document_id)); assert(!source.includes('fetch('));
  vm.runInNewContext(source, h.context);
  assert.equal(copied.length, 0); assert.equal(h.elements.get('handoff-copy').disabled, false);
  await h.click(); assert.deepEqual(copied, [requestText]);
  assert(h.elements.get('handoff-status').textContent.startsWith('복사했어요.'));
  assert.equal(h.elements.get('handoff-details').open, false);
});

test('denied and unavailable clipboard offer manual selection without leaking private errors', async () => {
  for (const clipboard of [undefined, { writeText() { throw Error('PRIVATE_MARKER'); } },
    { writeText() { return Promise.reject(Error('PRIVATE_MARKER')); } }]) {
    const h = harness(clipboard); installHandoff(h.context); await h.click();
    assert.equal(h.elements.get('handoff-details').open, true);
    assert.equal(h.elements.get('handoff-request').focused, true);
    assert.equal(h.elements.get('handoff-request').selected, true);
    assert(h.elements.get('handoff-status').textContent.includes('직접 복사'));
    assert(!h.elements.get('handoff-status').textContent.includes('PRIVATE_MARKER'));
    assert.equal(h.elements.get('handoff-copy').disabled, false);
  }
});

test('pending copy suppresses duplicate actions and timeout permits manual copy and later retry', async () => {
  let calls = 0;
  const h = harness({ writeText() { calls++; return calls === 1 ? new Promise(() => {}) : Promise.resolve(); } });
  installHandoff(h.context); const pending = h.click(); await h.click();
  assert.equal(calls, 1); assert.equal(h.elements.get('handoff-copy').disabled, true);
  h.timeout(); await pending;
  assert(h.elements.get('handoff-status').textContent.includes('직접 복사'));
  await h.click(); assert.equal(calls, 2); assert(h.elements.get('handoff-status').textContent.includes('복사했어요'));
});

test('clipboard client handles a missing handoff surface without actions', () => {
  assert.doesNotThrow(() => installHandoff({ document: { getElementById() { return null; } } }));
});

test('script route rejects query/body/range/path variants and non-GET methods', () => {
  for (const request of [new Request(origin + '/documents/handoff-client.js?token=secret'),
    new Request(origin + '/documents/handoff-client.js', { headers: { Range: 'bytes=0-1' } }),
    new Request(origin + '/documents/other.js'),
    { url: origin + '/documents/handoff-client.js', method: 'GET', body: {}, headers: new Headers() }])
    assert.throws(() => handoffScriptResponse(request), (error) => error.code === 'INVALID_VIEWER_REQUEST');
  for (const init of [{ method: 'POST' }, { method: 'POST', body: 'private' }])
    assert.equal(handoffScriptResponse(new Request(origin + '/documents/handoff-client.js', init)).status, 405);
});
