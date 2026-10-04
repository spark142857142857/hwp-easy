import { StorageError } from '../storage/store.mjs';
import { browserPage, escapeHtml, savedTime, UUID_SOURCE } from './document-viewer.mjs';
const cursorPattern = new RegExp(`^(0|[1-9][0-9]{0,15})\\.(${UUID_SOURCE})$`);
export const documentListCursor = (next) => `${next.saved_at}.${next.document_id}`;
export function documentListBefore(request) {
  const url = new URL(request.url), entries = [...url.searchParams];
  if (url.pathname !== '/documents' || request.body || request.headers.has('Range')
    || entries.length > 1 || entries.some(([key]) => key !== 'before')) throw new StorageError('INVALID_DOCUMENT_LIST_REQUEST');
  if (!entries.length) return undefined;
  const match = entries[0][1].match(cursorPattern);
  if (!match || Number(match[1]) > 8640000000000000) throw new StorageError('INVALID_DOCUMENT_LIST_REQUEST');
  return { saved_at: Number(match[1]), document_id: match[2] };
}
export async function documentListResponse(request, owner, store) {
  if (request.method !== 'GET') return new Response(null, { status: 405, headers: { 'Cache-Control': 'private, no-store', Allow: 'GET' } });
  const before = documentListBefore(request);
  const { documents, next } = await store.listDocuments({ owner, ...(before ? { before } : {}) });
  const rows = documents.map((doc) => `<li><a href="/documents/${doc.document_id}/versions/${doc.version_id}/view">HWP 문서 · ${escapeHtml(doc.document_id.slice(0, 8))}</a>
<p><small>마지막 저장 ${savedTime(doc.saved_at)} · ${(doc.byte_size / 1024).toLocaleString('ko-KR', { maximumFractionDigits: 1 })} KiB · 저장 ${doc.revision}회</small></p></li>`).join('');
  return browserPage('내 문서', `<header><small>HWP Easy · 비공개 개발 단계</small><h1>내 문서</h1>
<nav aria-label="문서 작업"><a class="primary" href="/documents/upload">HWP 업로드</a>${before ? '<a href="/documents">최근 문서로 돌아가기</a>' : ''}</nav></header>
<section aria-label="저장 문서"><h2>저장된 HWP</h2>
${documents.length ? `<ul class="version-history document-list">${rows}</ul>` : `<p role="status">${before ? '이 위치 이후에 저장된 문서가 없습니다.' : '아직 저장된 문서가 없습니다. HWP 파일을 업로드해 시작하세요.'}</p>`}
${next ? `<nav aria-label="문서 목록 페이지"><a href="/documents?before=${documentListCursor(next)}">이전 문서 더 보기</a></nav>` : ''}
<p><small>마지막 저장 시각 순으로 표시합니다. 문서를 열면 해당 저장본의 보기 링크를 에이전트에게 전달할 수 있습니다.</small></p>
<p><small>원래 파일 이름은 보관하지 않아 짧은 문서 번호로 구분합니다. 파일과 이전 버전은 직접 삭제할 때까지 보관됩니다.</small></p></section>`);
}
