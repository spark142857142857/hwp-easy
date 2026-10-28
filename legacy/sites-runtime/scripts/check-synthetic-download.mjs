// Actual workerd + WASM. User headers are mocks, NOT OAuth/browser proof.
// Intentionally no D1/R2 bindings; this route must not access document storage.
import assert from 'node:assert/strict';
import path from 'node:path';
import { Miniflare, convertV4MiniflareOptions } from 'miniflare';
import { verifySyntheticDownload, SYNTHETIC_DOWNLOAD_BYTES } from '../host/synthetic-download.mjs';
let outbound = 0;
const mf = new Miniflare(convertV4MiniflareOptions({
  compatibilityDate: '2026-10-01', modulesRoot: path.resolve('dist/server'),
  modules: [{ type: 'ESModule', path: path.resolve('dist/server/index.js') },
    { type: 'CompiledWasm', path: path.resolve('dist/server/rhwp_bg.wasm') }],
  outboundService: () => { outbound++; throw new Error('No network allowed'); },
}));
const headers = { 'oai-authenticated-user-id': 'synthetic-download-user', 'oai-authenticated-user-email': 'synthetic@example.invalid' };
try {
  const origin = 'https://diagnostic.invalid';
  for (const route of ['/diagnostics/download', '/diagnostics/synthetic-result.hwp']) {
    assert.equal((await mf.dispatchFetch(origin + route)).status, 401);
    assert.equal((await mf.dispatchFetch(origin + route, { headers: { 'oai-authenticated-user-id': 'partial' } })).status, 401);
  }
  const page = await mf.dispatchFetch(origin + '/diagnostics/download', { headers });
  assert.equal(page.status, 200);
  const html = await page.text(); assert(html.includes('시험 HWP 다운로드')); assert(!html.includes('<script'));
  for (const [suffix, init, status] of [
    ['/diagnostics/synthetic-result.hwp?file=private', { headers }, 400],
    ['/diagnostics/synthetic-result.hwp', { headers, method: 'POST', body: 'private' }, 405],
    ['/diagnostics/synthetic-result.hwp', { headers: { ...headers, Range: 'bytes=0-10' } }, 400],
    ['/diagnostics/unknown.hwp', { headers }, 404],
  ]) assert.equal((await mf.dispatchFetch(origin + suffix, init)).status, status);
  let first;
  for (let i = 0; i < 2; i++) {
    const result = await mf.dispatchFetch(origin + '/diagnostics/synthetic-result.hwp', { headers });
    assert.equal(result.status, 200);
    assert.equal(result.headers.get('Content-Type'), 'application/x-hwp');
    assert.equal(result.headers.get('Cache-Control'), 'private, no-store');
    assert.equal(result.headers.get('Content-Length'), String(SYNTHETIC_DOWNLOAD_BYTES));
    const bytes = new Uint8Array(await result.arrayBuffer());
    await verifySyntheticDownload(bytes);
    if (first) assert.deepEqual(bytes, first); else first = bytes;
  }
  assert.equal(outbound, 0);
  console.log(JSON.stringify({ synthetic_browser_download_contract: 'passed', actual_workerd_and_hwp: true,
    no_storage_bindings: true, no_outbound_requests: true, identity_is_mock: true,
    actual_authenticated_browser_download_verified: false }));
} finally { await mf.dispose(); }

