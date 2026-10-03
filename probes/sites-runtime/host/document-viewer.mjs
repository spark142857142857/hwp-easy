// Read-only, version-bound HTML viewer. All content uses owner-scoped service
// reads; SVG stays a separate passive image request, never inline document HTML.
import { StorageError } from '../storage/store.mjs';
export const UUID_SOURCE = '[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}';
export const viewerMatch = (pathname) => pathname.match(new RegExp(`^/documents/(${UUID_SOURCE})/versions/(${UUID_SOURCE})/view$`));
const fail = (code) => { throw new StorageError(code); };
export const escapeHtml = (value) => String(value).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
export const browserHeaders = {
  'Cache-Control': 'private, no-store', 'X-Content-Type-Options': 'nosniff',
  'Referrer-Policy': 'no-referrer', 'X-Frame-Options': 'DENY',
  'Content-Security-Policy': "default-src 'none'; img-src 'self'; style-src 'unsafe-inline'; base-uri 'none'; form-action 'self'; frame-ancestors 'none'",
};
export function browserPage(title, body) {
  return new Response(`<!doctype html><html lang="ko"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1"><title>${escapeHtml(title)} — HWP Easy</title>
<style>
:root{font-family:system-ui,sans-serif;color:#172033;background:#f6f7f9;line-height:1.65;font-size:16px}
body{margin:0;padding:32px 20px}main{max-width:900px;margin:auto}section,header{background:#fff;padding:24px;border:1px solid #dde2e8;border-radius:10px;margin-bottom:20px}
h1{font-size:26px;line-height:1.4;margin:4px 0 16px}h2{font-size:20px}small{font-size:14px;color:#526075}
a,button{color:#174b82}button,.primary{display:inline-block;background:#172033;color:#fff;border:0;border-radius:6px;padding:12px 18px;font:inherit;font-weight:600;text-decoration:none;cursor:pointer}
a:focus-visible,button:focus-visible{outline:3px solid #3578c5;outline-offset:4px}code{font-size:13px;overflow-wrap:anywhere}dl{margin:16px 0}dt{font-weight:600}dd{margin:0 0 10px;overflow-wrap:anywhere}
nav{display:flex;gap:20px;align-items:center;flex-wrap:wrap}img{display:block;width:100%;height:auto;background:#fff;border:1px solid #dde2e8}li{overflow-wrap:anywhere;margin:8px 0}.notice{padding:12px 16px;background:#eef2f7;border-radius:6px}
@media(max-width:480px){body{padding:16px 10px}section,header{padding:20px 16px}h1{font-size:24px}}
</style></head><body><main>${body}</main></body></html>`, { headers: { ...browserHeaders, 'Content-Type': 'text/html; charset=utf-8' } });
}
export function viewerPageNumber(url) {
  const entries = [...url.searchParams];
  if (entries.length > 1 || entries.some(([key, value]) => key !== 'page' || !/^(?:0|[1-9][0-9]{0,3})$/.test(value))) fail('INVALID_VIEWER_REQUEST');
  return entries.length ? Number(entries[0][1]) : 0;
}
export async function documentViewerResponse(url, owner, service) {
  const match = viewerMatch(url.pathname);
  if (!match) fail('INVALID_VIEWER_REQUEST');
  const page = viewerPageNumber(url), document_id = match[1], version_id = match[2];
  const { metadata, snapshot } = await service.open({ owner, document_id, version_id });
  const versions = await service.history({ owner, document_id });
  const selected = versions.find((v) => v.version_id === version_id);
  if (!selected || selected.sha256 !== metadata.sha256) fail('BLOB_MISSING_OR_CORRUPT');
  const base = `/documents/${document_id}/versions/${version_id}`;
  let preview;
  try {
    const candidate = snapshot.preview({ expected_sha256: metadata.sha256, page });
    if (candidate.svg.length > 4 * 1024 * 1024) throw new Error('PREVIEW_LIMIT_EXCEEDED');
    preview = candidate;
  }
  catch { if (page !== 0) fail('INVALID_PREVIEW_PAGE'); }
  const current = versions[0].current_version;
  const rows = versions.map((v) => `<li><a href="/documents/${document_id}/versions/${v.version_id}/view">${v.version_id === version_id ? '보고 있는 버전' : '저장 버전'} ${escapeHtml(v.version_id)}</a>${v.version_id === current ? ' · 현재 저장본' : ''}</li>`).join('');
  const navigation = preview ? `<nav aria-label="미리보기 페이지"><span>${page + 1} / ${preview.page_count} 페이지</span>
${page > 0 ? `<a href="${base}/view?page=${page - 1}">이전 페이지</a>` : ''}
${page + 1 < preview.page_count && page < 9999 ? `<a href="${base}/view?page=${page + 1}">다음 페이지</a>` : ''}</nav>` : '';
  return browserPage('저장된 HWP 확인', `<header><small>HWP Easy · 비공개 개발 단계</small><h1>저장된 HWP 확인</h1>
<a class="primary" href="${base}.hwp" download>이 버전 HWP 다운로드</a>
<dl><dt>문서 ID</dt><dd><code>${document_id}</code></dd><dt>보고 있는 버전</dt><dd><code>${version_id}</code> · ${version_id === current ? '현재 저장본' : '이전 저장본'}</dd>
<dt>파일 크기</dt><dd>${selected.byte_size} 바이트</dd><dt>SHA-256</dt><dd><code>${escapeHtml(metadata.sha256)}</code></dd></dl>
<details><summary>다른 저장 버전 (${versions.length}개)</summary><ul>${rows}</ul></details>
<p class="notice">보기와 다운로드는 문서를 수정하지 않습니다. 이전 버전을 열어도 현재 저장본은 바뀌지 않습니다.</p></header>
<section aria-label="HWP 기본 미리보기"><h2>기본 미리보기</h2>
<p>글꼴, 줄바꿈과 세부 배치는 미검증입니다. 최종 제출 전 외부 HWP 뷰어에서도 확인하세요.</p>
${navigation}
${preview ? `<p><a href="${base}/pages/${page}.svg">미리보기 이미지 직접 열기</a></p><img src="${base}/pages/${page}.svg" alt="${page + 1}페이지 HWP 기본 미리보기">`
  : '<p role="status">미리보기를 만들 수 없습니다. HWP 다운로드는 계속 사용할 수 있습니다.</p>'}
<p><small>이 화면의 표시만으로 서식 정확성이나 일반 HWP·Cloud·Dots 지원을 인증하지 않습니다.</small></p></section>`);
}
