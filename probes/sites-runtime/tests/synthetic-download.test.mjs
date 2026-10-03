import assert from 'node:assert/strict';
import test from 'node:test';
import fs from 'node:fs';
import { createRequire } from 'node:module';
import { pathToFileURL } from 'node:url';
import { HwpDocument, initSync } from '@rhwp/core';
import { syntheticDownloadBytes, syntheticDownloadResponse, verifySyntheticDownload,
  SYNTHETIC_DOWNLOAD_BYTES, SYNTHETIC_DOWNLOAD_SHA256 } from '../host/synthetic-download.mjs';
const require = createRequire(import.meta.url);
initSync({ module: fs.readFileSync(new URL('./rhwp_bg.wasm', pathToFileURL(require.resolve('@rhwp/core')))) });
const origin = 'https://diagnostic.invalid';
const headers = { 'oai-authenticated-user-id': 'synthetic-a', 'oai-authenticated-user-email': 'a@example.invalid' };
let generated;
const output = async () => (generated ??= await syntheticDownloadBytes(HwpDocument)).slice();
const request = (path, options = {}) => new Request(origin + path, { headers, ...options });

test('fixed edit reproduces the previously verified whole-file pin', async () => {
  const bytes = await output();
  assert.equal(bytes.length, SYNTHETIC_DOWNLOAD_BYTES);
  await verifySyntheticDownload(bytes);
  assert.deepEqual(await syntheticDownloadBytes(HwpDocument), bytes);
});
test('missing or partial identity rejects both routes before engine work', async () => {
  let calls = 0;
  for (const route of ['/diagnostics/download', '/diagnostics/synthetic-result.hwp']) {
    for (const identity of [{}, { 'oai-authenticated-user-id': 'a' }, { 'oai-authenticated-user-email': 'a@x.invalid' }]) {
      const response = await syntheticDownloadResponse(request(route, { headers: identity }), () => { calls++; });
      assert.equal(response.status, 401);
      assert.equal(response.headers.get('Cache-Control'), 'private, no-store');
    }
  }
  assert.equal(calls, 0);
});
test('HTML is synthetic-only, has one fixed link and no script or user reflection', async () => {
  const response = await syntheticDownloadResponse(request('/diagnostics/download'), () => { throw new Error(); });
  assert.equal(response.status, 200);
  const html = await response.text();
  assert.equal((html.match(/<a /g) ?? []).length, 1);
  assert(html.includes('href="/diagnostics/synthetic-result.hwp"'));
  assert(html.includes(SYNTHETIC_DOWNLOAD_SHA256));
  for (const text of ['<script', '<form', '<input', 'a@example.invalid', 'synthetic-a', 'oai-authenticated']) assert(!html.includes(text));
  assert.equal(response.headers.get('Referrer-Policy'), 'no-referrer');
  assert(response.headers.get('Content-Security-Policy').includes("default-src 'none'"));
});
test('method, query, range and unknown route reject before engine work', async () => {
  let calls = 0;
  for (const [route, options, status] of [
    ['/diagnostics/download?owner=private', {}, 400],
    ['/diagnostics/synthetic-result.hwp?path=private', {}, 400],
    ['/diagnostics/synthetic-result.hwp', { headers: { ...headers, Range: 'bytes=0-99' } }, 400],
    ['/diagnostics/download', { method: 'POST', body: 'private' }, 405],
    ['/diagnostics/synthetic-result.hwp', { method: 'HEAD' }, 405],
    ['/diagnostics/other.hwp', {}, 404],
  ]) {
    const response = await syntheticDownloadResponse(request(route, options), () => { calls++; });
    assert.equal(response.status, status);
    if (status === 405) assert.equal(response.headers.get('Allow'), 'GET');
    assert(!(await response.text()).includes('private'));
  }
  assert.equal(calls, 0);
});
test('binary has exact bytes and safe attachment headers', async () => {
  const response = await syntheticDownloadResponse(request('/diagnostics/synthetic-result.hwp'), output);
  assert.equal(response.status, 200);
  assert.equal(response.headers.get('Content-Type'), 'application/x-hwp');
  assert.equal(response.headers.get('Content-Disposition'), 'attachment; filename="hwp-easy-synthetic-edited.hwp"');
  assert.equal(response.headers.get('Content-Length'), String(SYNTHETIC_DOWNLOAD_BYTES));
  assert.equal(response.headers.get('X-Content-Type-Options'), 'nosniff');
  assert.deepEqual(new Uint8Array(await response.arrayBuffer()), await output());
});
test('wrong, tampered and failed generator output cannot be downloaded or disclose errors', async () => {
  const changed = await output(); changed[changed.length - 1] ^= 1;
  for (const build of [async () => new Uint8Array(1), async () => changed, async () => { throw new Error('private stack'); }]) {
    const response = await syntheticDownloadResponse(request('/diagnostics/synthetic-result.hwp'), build);
    assert.equal(response.status, 503);
    assert.deepEqual(await response.json(), { error: 'SYNTHETIC_DOWNLOAD_UNAVAILABLE' });
  }
});

