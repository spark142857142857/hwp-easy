// Explicit browser-only seed of ONE server-pinned synthetic HWP. No upload,
// caller-supplied bytes/path/document, automatic edit, or automatic deletion.
import { StorageError } from '../storage/store.mjs';
import { boundedBytes } from './transfer.mjs';
import { syntheticDownloadBytes } from './synthetic-download.mjs';
import { browserHeaders, browserPage, UUID_SOURCE } from './document-viewer.mjs';
const fail = (code) => { throw new StorageError(code); };
export async function storedSyntheticResponse(request, owner, service, HwpDocument, origin) {
  const url = new URL(request.url), route = '/diagnostics/stored-document';
  if (url.pathname !== route || url.search) fail('INVALID_SYNTHETIC_SEED_REQUEST');
  if (request.method === 'GET') {
    if (request.body || request.headers.has('Range')) fail('INVALID_SYNTHETIC_SEED_REQUEST');
    const requestId = crypto.randomUUID();
    return browserPage('저장 문서 시험', `<header><small>HWP Easy · 합성 문서만 사용하는 개발 시험</small><h1>저장된 HWP 보기 시험</h1>
<p>버튼을 누르면 개인정보 없는 고정 시험 HWP 한 개를 내 문서 저장소에 보관합니다. 이후 같은 버전의 미리보기와 다운로드를 확인할 수 있습니다.</p>
<form method="post" action="${route}"><input type="hidden" name="request_id" value="${requestId}">
<button type="submit" name="confirmation" value="create_fixed_synthetic">합성 시험 문서 저장하기</button></form>
<p class="notice">이 화면을 여는 것만으로 파일을 만들거나 수정하지 않습니다. 생성한 시험 문서는 직접 삭제할 때까지 보관합니다. 개인 파일 업로드는 닫혀 있습니다.</p></header>`);
  }
  if (request.method !== 'POST') return new Response(null, { status: 405, headers: { ...browserHeaders, Allow: 'GET, POST' } });
  if (request.headers.get('Origin') !== origin) fail('SYNTHETIC_SEED_ORIGIN_REQUIRED');
  if (!/^application\/x-www-form-urlencoded(?:;\s*charset=UTF-8)?$/i.test(request.headers.get('Content-Type') ?? '')) fail('INVALID_SYNTHETIC_SEED_REQUEST');
  const bytes = await boundedBytes(request.body, 256, request.headers.get('Content-Length'));
  let form;
  try { form = new URLSearchParams(new TextDecoder('utf-8', { fatal: true }).decode(bytes)); }
  catch { fail('INVALID_SYNTHETIC_SEED_REQUEST'); }
  const entries = [...form];
  if (entries.length !== 2 || form.getAll('request_id').length !== 1 || form.getAll('confirmation').length !== 1
    || form.get('confirmation') !== 'create_fixed_synthetic'
    || !new RegExp(`^${UUID_SOURCE}$`).test(form.get('request_id') ?? '')) fail('INVALID_SYNTHETIC_SEED_REQUEST');
  const saved = await service.create({ owner, request_id: form.get('request_id'), bytes: await syntheticDownloadBytes(HwpDocument) });
  return new Response(null, { status: 303, headers: { ...browserHeaders,
    Location: `/documents/${saved.document_id}/versions/${saved.version_id}/view` } });
}

