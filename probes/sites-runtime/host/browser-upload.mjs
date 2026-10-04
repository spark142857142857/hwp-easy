import { StorageError } from '../storage/store.mjs';
import { browserPage, browserHeaders } from './document-viewer.mjs';
import { installUploadForm } from './upload-client.mjs';
export const UPLOAD_PAGE = '/documents/upload';
export const UPLOAD_SCRIPT = '/documents/upload-client.js';
export function browserUploadResponse(request, enabled) {
  const url = new URL(request.url);
  if (![UPLOAD_PAGE, UPLOAD_SCRIPT].includes(url.pathname) || url.search || request.body || request.headers.has('Range')) throw new StorageError('INVALID_UPLOAD_REQUEST');
  if (request.method !== 'GET') return new Response(null, { status: 405, headers: { ...browserHeaders, Allow: 'GET' } });
  if (url.pathname === UPLOAD_SCRIPT) return new Response(`(${installUploadForm.toString()})(globalThis);`, {
    headers: { ...browserHeaders, 'Content-Type': 'text/javascript; charset=utf-8' },
  });
  const response = browserPage('HWP 업로드', `<header><small>HWP Easy · 비공개 개발 단계</small><h1>HWP 업로드</h1>
${enabled ? `<form id="upload-form">
<label for="hwp-file">HWP 파일</label><input id="hwp-file" type="file" accept=".hwp,application/x-hwp" aria-describedby="upload-limit">
<p id="upload-limit"><small>.hwp 파일 · 최대 4 MiB</small></p>
<button id="upload-button" type="submit" disabled>업로드</button>
<p id="upload-status" role="status" aria-live="polite"></p></form>
<noscript><p>파일 업로드에는 브라우저의 JavaScript가 필요합니다.</p></noscript>
<p class="notice">선택한 파일은 내 문서 저장소에 업로드되어 직접 삭제할 때까지 보관됩니다. PC 원본은 변경하지 않습니다.</p>
<p><small>현재 지원 범위가 제한된 개발용 연결입니다. 지원하지 않거나 손상된 HWP는 저장하지 않습니다.</small></p>`
  : '<p role="status">현재 파일 업로드가 꺼져 있습니다.</p>'}</header>
${enabled ? `<script src="${UPLOAD_SCRIPT}" defer></script>` : ''}`);
  // Only this upload page runs the fixed same-origin client. Viewers remain passive.
  response.headers.set('Content-Security-Policy', "default-src 'none'; script-src 'self'; connect-src 'self'; style-src 'unsafe-inline'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'");
  response.headers.set('Referrer-Policy', 'same-origin');
  return response;
}
