// Read-only, version-bound HTML viewer. All content uses owner-scoped service
// reads; SVG stays a separate passive image request, never inline document HTML.
import { StorageError } from '../storage/store.mjs';
import { GuardError } from '../guard/records.mjs';
import { MAX_HOSTED_BODY_TEXT_CODE_UNITS } from '../guard/hosted-workload.mjs';
import { HANDOFF_SCRIPT, handoffRequest } from './handoff.mjs';
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
.version-state{font-weight:600;margin:0 0 4px}.saved-at{color:#526075;margin:0 0 20px}.version-history{list-style:none;padding:0;margin:12px 0 0}.version-history li{padding:12px 0;border-bottom:1px solid #dde2e8}.version-history li:last-child{border-bottom:0}.version-history a{display:inline-block}.version-history time{display:block;color:#526075;font-size:14px}.viewing{font-size:14px;margin-left:12px;color:#526075}details{margin-top:20px}summary{cursor:pointer;color:#174b82;padding:8px 0}summary:focus-visible{outline:3px solid #3578c5;outline-offset:4px}
label{display:block;font-weight:600;margin-bottom:8px}input[type=file]{display:block;max-width:100%;font:inherit}input::file-selector-button{font:inherit;color:#174b82;background:#eef2f7;border:1px solid #dde2e8;border-radius:6px;padding:10px 14px;margin-right:12px;cursor:pointer}input:focus-visible,textarea:focus-visible{outline:3px solid #3578c5;outline-offset:4px}button:disabled{background:#e2e6ec;color:#526075;cursor:default}
textarea{display:block;box-sizing:border-box;width:100%;padding:12px;font:inherit;font-size:14px;line-height:1.6;border:1px solid #dde2e8;border-radius:6px;resize:vertical}.secondary{background:#eef2f7;color:#174b82}
input[type=text]{box-sizing:border-box;width:100%;padding:12px;font:inherit;border:1px solid #dde2e8;border-radius:6px}
@media(max-width:480px){body{padding:16px 10px}section,header{padding:20px 16px}h1{font-size:24px}}
</style></head><body><main>${body}</main></body></html>`, { headers: { ...browserHeaders, 'Content-Type': 'text/html; charset=utf-8' } });
}
export function viewerPageNumber(url) {
  const entries = [...url.searchParams];
  if (entries.length > 1 || entries.some(([key, value]) => key !== 'page' || !/^(?:0|[1-9][0-9]{0,3})$/.test(value))) fail('INVALID_VIEWER_REQUEST');
  return entries.length ? Number(entries[0][1]) : 0;
}
const savedTimeFormat = new Intl.DateTimeFormat('ko-KR', {
  timeZone: 'Asia/Seoul', year: 'numeric', month: '2-digit', day: '2-digit',
  hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23',
});
export function savedTime(value) {
  if (!Number.isSafeInteger(value) || value < 0 || value > 8640000000000000) return '저장 시각 확인 불가';
  return `<time datetime="${new Date(value).toISOString()}">${escapeHtml(savedTimeFormat.format(value))} (한국 시간)</time>`;
}
function editabilitySection(summary) {
  if (!summary) return '';
  const reasons = summary.read_only_reason_counts.map(item =>
    `<li>${escapeHtml(item.message_ko)} (${item.blocks}곳)</li>`).join('');
  return `<section aria-labelledby="editability-heading"><h2 id="editability-heading">이 저장본의 편집 가능 범위</h2>
<p>편집 후보: 본문 문단 ${summary.body_replacement_candidates}곳 · 표 셀 문단 ${summary.cell_replacement_candidates}곳</p>
<p>읽기 전용: ${summary.read_only_blocks}곳 · 빈 셀 문단 채우기 후보: ${summary.empty_cell_fill_candidates}곳 · 셀 문단 비우기 후보: ${summary.cell_text_clear_candidates}곳</p>
${summary.mixed_style_same_length_candidates ? `<p>혼합 글자 서식의 제한된 치환 후보: ${summary.mixed_style_same_length_candidates}곳. 글자 수와 각 글자의 UTF-16 길이를 유지하고, 한 서식 구간 안의 내용만 바꿀 수 있습니다. 기존 서식은 그대로 보존합니다.</p>` : ''}
<p class="notice">본문·최상위 표 셀의 지원 범위를 기준으로 확인했습니다. 셀 문단의 채우기·비우기와 혼합 서식의 제한된 치환은 편집 후보에 포함된 기능이며 합산하지 않습니다. 편집 후보도 요청한 변경의 저장 전 검사를 통과해야 저장할 수 있습니다. 이 안내는 문서를 수정하지 않습니다.</p>
${reasons ? `<details><summary>읽기 전용인 이유</summary><p>한 문단에 여러 이유가 있을 수 있어 아래 수를 합산하지 않습니다.</p><ul>${reasons}</ul></details>` : ''}</section>`;
}
export async function documentViewerResponse(url, owner, service, canonicalOrigin = url.origin, store) {
  const match = viewerMatch(url.pathname);
  if (!match) fail('INVALID_VIEWER_REQUEST');
  const page = viewerPageNumber(url), document_id = match[1], version_id = match[2];
  let metadata, snapshot, workloadBlocked = false;
  try { ({ metadata, snapshot } = await service.open({ owner, document_id, version_id })); }
  catch (error) {
    // Only a genuine admission refusal has this fallback. Re-read through the
    // owner/hash/deletion-checked store, never trust buffered error metadata or
    // retry the engine. Corruption and authorization errors still fail closed.
    if (!(error instanceof GuardError) || error.code !== 'HOSTED_WORKLOAD_LIMIT_EXCEEDED' || !store) throw error;
    const { bytes, ...saved } = await store.read({ owner, document_id, version_id });
    metadata = saved;
    workloadBlocked = true;
  }
  const versions = await service.history({ owner, document_id });
  const selected = versions.find((v) => v.version_id === version_id);
  if (!selected || selected.sha256 !== metadata.sha256) fail('BLOB_MISSING_OR_CORRUPT');
  // Reuse the already opened snapshot. A bounded first fragment supplies the
  // full-document aggregate without a second WASM open or full-text read.
  const readScope = workloadBlocked ? undefined
    : snapshot.read({ expected_sha256: metadata.sha256, max_chars: 1, max_blocks: 1 });
  const editability = readScope?.editability_summary;
  const partialContent = readScope?.all_content_supported === false;
  const base = `/documents/${document_id}/versions/${version_id}`;
  let preview;
  if (workloadBlocked && page !== 0) fail('INVALID_PREVIEW_PAGE');
  if (!workloadBlocked) {
    try {
      const candidate = snapshot.preview({ expected_sha256: metadata.sha256, page });
      if (candidate.svg.length > 4 * 1024 * 1024) throw new Error('PREVIEW_LIMIT_EXCEEDED');
      preview = candidate;
    }
    catch { if (page !== 0) fail('INVALID_PREVIEW_PAGE'); }
  }
  const current = versions[0].current_version;
  // Current is explicit storage metadata, never inferred from timestamp order.
  const ordered = [...versions].sort((a, b) => Number(b.version_id === current) - Number(a.version_id === current)
    || b.created_at - a.created_at || a.version_id.localeCompare(b.version_id));
  const rows = ordered.map((v) => {
    const sameTime = versions.some((other) => other.version_id !== v.version_id && other.created_at === v.created_at);
    return `<li><a href="/documents/${document_id}/versions/${v.version_id}/view"${v.version_id === version_id ? ' aria-current="page"' : ''}>${v.version_id === current ? '현재 저장본' : '이전 저장본'}${savedTime(v.created_at)}${sameTime ? `<code>${escapeHtml(v.version_id)}</code>` : ''}</a>${v.version_id === version_id ? '<span class="viewing">보고 있음</span>' : ''}</li>`;
  }).join('');
  const navigation = preview ? `<nav aria-label="미리보기 페이지"><span>${page + 1} / ${preview.page_count} 페이지</span>
${page > 0 ? `<a href="${base}/view?page=${page - 1}">이전 페이지</a>` : ''}
${page + 1 < preview.page_count && page < 9999 ? `<a href="${base}/view?page=${page + 1}">다음 페이지</a>` : ''}</nav>` : '';
  const requestText = workloadBlocked ? '' : handoffRequest(canonicalOrigin, document_id, version_id);
  const name = store ? (await store.documentName({owner, document_id})).display_name : '';
  const response = browserPage('저장된 HWP 확인', `<header><small>HWP Easy · 비공개 개발 단계</small><h1>저장된 HWP 확인</h1>
<p>${escapeHtml(name || `HWP 문서 · ${document_id.slice(0, 8)}`)}</p>
<p class="version-state">${version_id === current ? '현재 저장본' : '이전 저장본을 보고 있습니다'}</p>
<p class="saved-at">${savedTime(selected.created_at)}</p>
<a class="primary" href="${base}.hwp" download>이 버전 HWP 다운로드</a>
${version_id !== current ? `<p><a href="/documents/${document_id}/versions/${current}/view">현재 저장본 보기</a></p>` : ''}
<p><a href="/documents">내 문서</a> · <a href="/documents/upload">다른 HWP 업로드</a></p>
<p><a href="/documents/${document_id}/name">문서 이름 설정</a></p>
<details><summary>저장 버전 (${versions.length}개)</summary><ul class="version-history">${rows}</ul></details>
<details><summary>파일 정보</summary><dl><dt>문서 ID</dt><dd><code>${document_id}</code></dd><dt>버전 ID</dt><dd><code>${version_id}</code></dd>
<dt>파일 크기</dt><dd>${selected.byte_size} 바이트</dd><dt>SHA-256</dt><dd><code>${escapeHtml(metadata.sha256)}</code></dd></dl>
</details>
<p class="notice">보기와 다운로드는 문서를 수정하지 않습니다. 이전 버전을 열어도 현재 저장본은 바뀌지 않습니다.</p></header>
${workloadBlocked ? `<section aria-labelledby="workload-heading"><h2 id="workload-heading">이 저장본은 처리 제한을 넘었습니다</h2>
<p>현재 서버의 처리 제한은 본문·표 셀을 합쳐 UTF-16 ${MAX_HOSTED_BODY_TEXT_CODE_UNITS.toLocaleString('ko-KR')}단위입니다. 일반 한글 1자는 1단위이며 이모지 등은 여러 단위를 사용할 수 있습니다.</p>
<p class="notice">이 저장본의 내용 조회·편집·미리보기는 제공하지 않습니다. 같은 요청을 반복하거나 재인증해도 이 제한은 해결되지 않습니다.</p>
<p>기존 문서와 버전은 유지됩니다. 위에서 이 버전 HWP를 다운로드하거나 저장 버전 목록에서 다른 저장본을 선택하세요. 내려받은 HWP는 외부 HWP 프로그램에서 확인할 수 있습니다.</p></section>` : `${partialContent ? `<section aria-labelledby="content-scope-heading"><h2 id="content-scope-heading">일부 내용만 읽을 수 있습니다</h2>
<p class="notice">이 문서의 일부 요소는 현재 에이전트 조회에 포함되지 않습니다. 전체 내용은 내려받은 HWP에서도 확인하세요.</p></section>` : ''}${editabilitySection(editability)}
<section aria-labelledby="handoff-heading"><h2 id="handoff-heading">에이전트에게 전달</h2>
<p>HWP Easy가 연결된 대화에 붙여넣고 원하는 작업을 이어서 적으세요. 같은 계정의 접근 권한이 필요합니다.</p>
<button type="button" class="secondary" id="handoff-copy" aria-describedby="handoff-hint" disabled>링크와 읽기 요청 복사</button>
<p id="handoff-status" role="status" aria-live="polite"></p>
<small id="handoff-hint">이 요청은 지금 보고 있는 저장본을 읽기만 합니다. 수정 내용은 대화에서 따로 요청하세요.</small>
<details id="handoff-details"><summary>요청 확인 · 직접 복사</summary><label for="handoff-request">복사할 요청</label>
<textarea id="handoff-request" readonly rows="8" spellcheck="false">${escapeHtml(requestText)}</textarea></details>
<noscript><p>요청 확인을 열고 내용을 직접 복사해 주세요.</p></noscript></section>
<section aria-label="HWP 기본 미리보기"><h2>기본 미리보기</h2>
<p>글꼴, 줄바꿈과 세부 배치는 미검증입니다. 최종 제출 전 외부 HWP 뷰어에서도 확인하세요.</p>
${navigation}
${preview ? `<p><a href="${base}/pages/${page}.svg">미리보기 이미지 직접 열기</a></p><img src="${base}/pages/${page}.svg" alt="${page + 1}페이지 HWP 기본 미리보기">`
  : '<p role="status">미리보기를 만들 수 없습니다. HWP 다운로드는 계속 사용할 수 있습니다.</p>'}
</section><script src="${HANDOFF_SCRIPT}" defer></script>`}`);
  // Only this fixed host client is active. Document SVG remains a passive image.
  if (!workloadBlocked) response.headers.set('Content-Security-Policy', "default-src 'none'; script-src 'self'; connect-src 'none'; img-src 'self'; style-src 'unsafe-inline'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'");
  return response;
}
