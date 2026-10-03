import assert from 'node:assert/strict';
import test from 'node:test';
import { documentViewerResponse, escapeHtml, viewerMatch, viewerPageNumber } from '../host/document-viewer.mjs';
const document_id = crypto.randomUUID(), version_id = crypto.randomUUID(), other = crypto.randomUUID();
const sha256 = 'a'.repeat(64), url = new URL(`https://viewer.invalid/documents/${document_id}/versions/${version_id}/view`);
function service(preview = () => ({ page_count: 3, svg: '<svg><script>never inline</script></svg>' })) {
  const calls = [];
  return { calls,
    async open(args) { calls.push(['open', args]); return { metadata: { sha256 }, snapshot: { preview } }; },
    async history(args) { calls.push(['history', args]); return [
      { version_id, sha256, byte_size: 13312, current_version: other },
      { version_id: other, sha256, byte_size: 13312, current_version: other },
    ]; },
  };
}
test('viewer route accepts only immutable version UUID paths', () => {
  assert(viewerMatch(url.pathname));
  for (const path of ['/documents/all/view', url.pathname + '/', url.pathname.replace(version_id, 'private')]) assert.equal(viewerMatch(path), null);
});
test('viewer page query is strict, bounded and non-repeating', () => {
  assert.equal(viewerPageNumber(url), 0);
  assert.equal(viewerPageNumber(new URL(url + '?page=2')), 2);
  for (const suffix of ['?page=-1', '?page=01', '?page=10000', '?page=1&page=2', '?owner=x', '?page=NaN']) {
    assert.throws(() => viewerPageNumber(new URL(url + suffix)), (e) => e.code === 'INVALID_VIEWER_REQUEST');
  }
});
test('viewer reads selected owner/version, keeps previews passive and labels old/current honestly', async () => {
  const s = service(), response = await documentViewerResponse(url, 'user:mock', s), html = await response.text();
  assert.equal(response.status, 200);
  assert.deepEqual(s.calls, [['open', { owner: 'user:mock', document_id, version_id }], ['history', { owner: 'user:mock', document_id }]]);
  assert(html.includes(`href="/documents/${document_id}/versions/${version_id}.hwp"`));
  assert(html.includes(`src="/documents/${document_id}/versions/${version_id}/pages/0.svg"`));
  assert(html.includes('이전 저장본')); assert(html.includes('현재 저장본')); assert(html.includes('다음 페이지'));
  assert(!html.includes('<script')); assert(!html.includes('<svg')); assert(!html.includes('<iframe')); assert(!html.includes('<object'));
  assert.equal(response.headers.get('Cache-Control'), 'private, no-store');
  assert(response.headers.get('Content-Security-Policy').includes("img-src 'self'"));
  assert(response.headers.get('Content-Security-Policy').includes("default-src 'none'"));
});
test('preview failure does not hide the immutable HWP download', async () => {
  for (const preview of [() => { throw new Error('private content'); }, () => ({ svg: 'x'.repeat(4 * 1024 * 1024 + 1) })]) {
    const response = await documentViewerResponse(url, 'user:mock', service(preview));
    const html = await response.text();
    assert(html.includes('미리보기를 만들 수 없습니다')); assert(html.includes('.hwp" download'));
    assert(!html.includes('private content')); assert(!html.includes('<img'));
  }
});
test('nonzero invalid preview pages are rejected instead of silently showing a different page', async () => {
  await assert.rejects(() => documentViewerResponse(new URL(url + '?page=9999'), 'user:mock',
    service(() => { throw new Error(); })), (e) => e.code === 'INVALID_PREVIEW_PAGE');
});
test('HTML escapes metacharacters and inconsistent selected version metadata is refused', async () => {
  assert.equal(escapeHtml('<"a&\'b>'), '&lt;&quot;a&amp;&#39;b&gt;');
  const s = service(); s.history = async () => [{ version_id, sha256: 'b'.repeat(64) }];
  await assert.rejects(() => documentViewerResponse(url, 'user:mock', s), (e) => e.code === 'BLOB_MISSING_OR_CORRUPT');
});
