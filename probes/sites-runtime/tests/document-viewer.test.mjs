import assert from 'node:assert/strict';
import test from 'node:test';
import { documentViewerResponse, escapeHtml, viewerMatch, viewerPageNumber } from '../host/document-viewer.mjs';
import { GuardError } from '../guard/records.mjs';
import { StorageError } from '../storage/store.mjs';
const document_id = crypto.randomUUID(), version_id = crypto.randomUUID(), other = crypto.randomUUID();
const sha256 = 'a'.repeat(64), url = new URL(`https://viewer.invalid/documents/${document_id}/versions/${version_id}/view`);
function service(preview = () => ({ page_count: 3, svg: '<svg><script>never inline</script></svg>' })) {
  const calls = [];
  return { calls,
    async open(args) { calls.push(['open', args]); return { metadata: { sha256 }, snapshot: { preview,
      read(options) { assert.deepEqual(options, { expected_sha256: sha256, max_chars: 1, max_blocks: 1 });
        return { editability_summary: { body_replacement_candidates: 2, cell_replacement_candidates: 4,
          read_only_blocks: 1, empty_cell_fill_candidates: 1, cell_text_clear_candidates: 3,
          read_only_reason_counts: [{ message_ko: '표가 들어 있는 문단은 읽기 전용입니다.', blocks: 1 }] } }; },
    } }; },
    async history(args) { calls.push(['history', args]); return [
      { version_id, sha256, byte_size: 13312, current_version: other, created_at: Date.UTC(2026, 9, 4, 1, 2, 3) },
      { version_id: other, sha256, byte_size: 13312, current_version: other, created_at: Date.UTC(2026, 9, 4, 2, 3, 4) },
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
  assert(html.includes('이 저장본의 편집 가능 범위')); assert(html.includes('본문 문단 2곳 · 표 셀 문단 4곳'));
  assert(html.includes('읽기 전용: 1곳')); assert(html.includes('표가 들어 있는 문단은 읽기 전용입니다.'));
  assert(html.includes('저장 전 검사를 통과해야 저장할 수 있습니다'));
  assert.equal((html.match(/<script/g) ?? []).length, 1);
  assert(html.includes('<script src="/documents/handoff-client.js" defer></script>'));
  assert(!html.includes('<svg')); assert(!html.includes('<iframe')); assert(!html.includes('<object'));
  assert.equal(response.headers.get('Cache-Control'), 'private, no-store');
  assert(response.headers.get('Content-Security-Policy').includes("img-src 'self'"));
  assert(response.headers.get('Content-Security-Policy').includes("default-src 'none'"));
  assert(response.headers.get('Content-Security-Policy').includes("script-src 'self'; connect-src 'none'"));
});
test('preview failure does not hide the immutable HWP download', async () => {
  for (const preview of [() => { throw new Error('private content'); }, () => ({ svg: 'x'.repeat(4 * 1024 * 1024 + 1) })]) {
    const response = await documentViewerResponse(url, 'user:mock', service(preview));
    const html = await response.text();
    assert(html.includes('미리보기를 만들 수 없습니다')); assert(html.includes('.hwp" download'));
    assert(!html.includes('private content')); assert(!html.includes('<img'));
  }
});

test('partial content is visible before handoff; bounded fragments alone do not imply unsupported content', async () => {
  for (const all_content_supported of [true, false]) {
    let reads = 0, previews = 0;
    const s = service(() => { previews++; return { page_count: 1, svg: '<svg />' }; });
    const open = s.open.bind(s);
    s.open = async (args) => {
      const result = await open(args), read = result.snapshot.read;
      result.snapshot.read = options => { reads++; return { ...read(options),
        all_content_supported, content_complete: false,
        unsupported: [{ reason: '<script>untrusted document detail</script>' }] }; };
      return result;
    };
    const response = await documentViewerResponse(url, 'user:mock', s), html = await response.text();
    const notice = html.indexOf('일부 내용만 읽을 수 있습니다');
    assert.equal(notice >= 0, !all_content_supported);
    if (!all_content_supported) {
      assert(notice < html.indexOf('이 저장본의 편집 가능 범위'));
      assert(notice < html.indexOf('에이전트에게 전달'));
      assert(html.includes('전체 내용은 내려받은 HWP에서도 확인하세요'));
    }
    assert(!html.includes('untrusted document detail'));
    assert(html.includes(`href="/documents/${document_id}/versions/${version_id}.hwp" download`));
    assert.equal(reads, 1); assert.equal(previews, 1);
    assert.equal(response.headers.get('Cache-Control'), 'private, no-store');
    assert.deepEqual(s.calls.map(c => c[0]), ['open', 'history']);
  }
});

test('version selection uses explicit current metadata despite clock order or equal save times', async () => {
  const s = service(), history = s.history.bind(s);
  s.history = async (args) => (await history(args)).map((v) => ({ ...v, created_at: 1791075723000 }));
  const html = await (await documentViewerResponse(url, 'user:mock', s)).text();
  const list = html.match(/<ul class="version-history">([\s\S]*?)<\/ul>/)[1];
  assert(list.indexOf(`/versions/${other}/view`) < list.indexOf(`/versions/${version_id}/view`));
  assert(list.includes(`<code>${other}</code>`)); assert(list.includes(`<code>${version_id}</code>`));
  assert(list.includes('aria-current="page">이전 저장본'));
  assert(html.includes('현재 저장본 보기')); assert(html.includes('(한국 시간)'));
  assert(html.includes('<details><summary>파일 정보</summary>'));
  assert(!html.slice(0, html.indexOf('<details>')).includes(sha256));
  // A clock moving backwards also cannot turn the selected old version into current.
  s.history = async (args) => (await history(args)).map((v) => ({ ...v, created_at: v.version_id === other ? 0 : 1 }));
  const currentUrl = new URL(url.toString().replace(version_id, other));
  const currentHtml = await (await documentViewerResponse(currentUrl, 'user:mock', s)).text();
  assert(currentHtml.includes('<p class="version-state">현재 저장본</p>'));
  assert(!currentHtml.includes('현재 저장본 보기'));
  assert(currentHtml.includes(`href="/documents/${document_id}/versions/${other}.hwp"`));
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

function blockedService(error = new GuardError('HOSTED_WORKLOAD_LIMIT_EXCEEDED')) {
  const s = service();
  s.open = async (args) => { s.calls.push(['open', args]); throw error; };
  const storeCalls = [], store = {
    async read(args) {
      storeCalls.push(['read', args]);
      return { bytes: new Uint8Array([0xde, 0xad]), document_id, version_id, sha256 };
    },
    async documentName(args) { storeCalls.push(['documentName', args]); return { display_name: '<script>private title</script>' }; },
  };
  return { s, store, storeCalls };
}
test('admission-blocked viewer retains verified download/history without engine retry or read handoff', async () => {
  for (const selected of [version_id, other]) {
    const { s, store, storeCalls } = blockedService();
    const selectedUrl = new URL(url.toString().replace(version_id, selected));
    const response = await documentViewerResponse(selectedUrl, 'user:mock', s, url.origin, store);
    const html = await response.text();
    assert.equal(response.status, 200);
    assert.deepEqual(s.calls, [['open', { owner: 'user:mock', document_id, version_id: selected }],
      ['history', { owner: 'user:mock', document_id }]]);
    assert.deepEqual(storeCalls, [['read', { owner: 'user:mock', document_id, version_id: selected }],
      ['documentName', { owner: 'user:mock', document_id }]]);
    assert(html.includes(`href="/documents/${document_id}/versions/${selected}.hwp" download`));
    assert(html.includes('저장 버전 (2개)')); assert(html.includes('400,000단위'));
    assert(html.includes('기존 문서와 버전은 유지됩니다'));
    assert(html.includes('같은 요청을 반복하거나 재인증해도 이 제한은 해결되지 않습니다'));
    assert(html.includes('&lt;script&gt;private title&lt;/script&gt;'));
    assert.equal(html.includes('현재 저장본 보기'), selected !== other);
    for (const absent of ['<script', '<img', '<svg', '<textarea', 'handoff-copy', '에이전트에게 전달', '편집 후보:']) assert(!html.includes(absent));
    assert(!response.headers.get('Content-Security-Policy').includes('script-src'));
    assert.equal(response.headers.get('Cache-Control'), 'private, no-store');
  }
});
test('fallback is specific to genuine hosted workload refusal, never authorization/corruption or forged codes', async () => {
  for (const error of [new StorageError('DOCUMENT_OR_VERSION_NOT_FOUND'), new StorageError('BLOB_MISSING_OR_CORRUPT'),
    new GuardError('UNSUPPORTED_DOCUMENT_FEATURE'), Object.assign(new Error('private error'), { code: 'HOSTED_WORKLOAD_LIMIT_EXCEEDED' })]) {
    const { s, store, storeCalls } = blockedService(error);
    await assert.rejects(() => documentViewerResponse(url, 'user:mock', s, url.origin, store), (caught) => caught === error);
    assert.deepEqual(storeCalls, []); assert.equal(s.calls.length, 1);
  }
  const { s } = blockedService();
  await assert.rejects(() => documentViewerResponse(url, 'user:mock', s), (e) => e.code === 'HOSTED_WORKLOAD_LIMIT_EXCEEDED');
});
test('fallback rechecks store authorization/hash and late revocation before returning HTML', async () => {
  for (const phase of ['read', 'history', 'documentName']) {
    for (const code of ['DOCUMENT_OR_VERSION_NOT_FOUND', 'BLOB_MISSING_OR_CORRUPT']) {
      const { s, store } = blockedService(), error = new StorageError(code);
      (phase === 'history' ? s : store)[phase] = async () => { throw error; };
      await assert.rejects(() => documentViewerResponse(url, 'user:mock', s, url.origin, store), (caught) => caught === error);
    }
  }
  for (const history of [[], [{ version_id, sha256: 'b'.repeat(64) }]]) {
    const { s, store } = blockedService(); s.history = async () => history;
    await assert.rejects(() => documentViewerResponse(url, 'user:mock', s, url.origin, store), (e) => e.code === 'BLOB_MISSING_OR_CORRUPT');
  }
});
test('blocked viewer accepts page zero but never silently substitutes for a requested preview page', async () => {
  for (const page of [0, 1, 9999]) {
    const { s, store } = blockedService();
    const result = () => documentViewerResponse(new URL(url + `?page=${page}`), 'user:mock', s, url.origin, store);
    if (page === 0) assert.equal((await result()).status, 200);
    else await assert.rejects(result, (e) => e.code === 'INVALID_PREVIEW_PAGE');
  }
});
