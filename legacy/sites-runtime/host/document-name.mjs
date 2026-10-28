import { StorageError } from '../storage/store.mjs';
import { validDocumentName } from '../storage/document-names.mjs';
import { boundedBytes } from './transfer.mjs';
import { browserPage, escapeHtml, UUID_SOURCE } from './document-viewer.mjs';
export const nameMatch = pathname => pathname.match(new RegExp(`^/documents/(${UUID_SOURCE})/name$`));
const messages = {
  INVALID_DOCUMENT_NAME: '이름은 앞뒤 공백 없이 80자 이내로 입력하세요. 줄바꿈과 보이지 않는 제어 문자는 사용할 수 없습니다.',
  INVALID_DOCUMENT_NAME_REQUEST: '이름 변경 요청을 확인할 수 없습니다. 화면을 다시 열어 주세요.',
  DOCUMENT_NAME_ORIGIN_REQUIRED: '같은 HWP Easy 화면에서 이름을 변경해 주세요.',
  DOCUMENT_NAME_CONFLICT: '다른 화면에서 이름을 변경했습니다. 이 화면을 새로 열어 확인한 뒤 변경해 주세요.',
  DOCUMENT_NAME_OUTCOME_UNKNOWN: '이름이 저장됐는지 확인할 수 없습니다. 내 문서에서 현재 이름을 확인해 주세요.',
};
const fail = code => { throw new StorageError(code); };
export async function documentNameResponse(request, owner, store, origin) {
  const url = new URL(request.url), match = nameMatch(url.pathname);
  if (!match || url.search || request.headers.has('Range')) fail('INVALID_DOCUMENT_NAME_REQUEST');
  if (!['GET', 'POST'].includes(request.method)) return new Response(null, { status:405, headers:{'Cache-Control':'private, no-store',Allow:'GET, POST'} });
  const document_id = match[1];
  try {
    if (request.method === 'POST') {
      if (request.headers.get('origin') !== origin) fail('DOCUMENT_NAME_ORIGIN_REQUIRED');
      if (!/^application\/x-www-form-urlencoded(?:;\s*charset=UTF-8)?$/i.test(request.headers.get('content-type') ?? '')) fail('INVALID_DOCUMENT_NAME_REQUEST');
      const bytes = await boundedBytes(request.body, 2048, request.headers.get('content-length'));
      let body;
      try { body = new URLSearchParams(new TextDecoder('utf-8', {fatal:true}).decode(bytes)); } catch { fail('INVALID_DOCUMENT_NAME_REQUEST'); }
      if ([...body].length !== 2 || body.getAll('display_name').length !== 1 || body.getAll('expected_name_revision').length !== 1) fail('INVALID_DOCUMENT_NAME_REQUEST');
      const display_name = body.get('display_name').trim(), revision = body.get('expected_name_revision');
      if (!validDocumentName(display_name) || !/^(0|[1-9][0-9]{0,15})$/.test(revision)) fail('INVALID_DOCUMENT_NAME');
      const saved = await store.renameDocument({owner,document_id,display_name,expected_name_revision:Number(revision)});
      return new Response(null, {status:303,headers:{Location:`/documents/${document_id}/versions/${saved.current_version}/view`,'Cache-Control':'private, no-store'}});
    }
    if (request.body) fail('INVALID_DOCUMENT_NAME_REQUEST');
    const metadata = await store.documentName({owner,document_id});
    const response = browserPage('문서 이름', `<header><small>HWP Easy</small><h1>문서 이름</h1>
<form action="/documents/${document_id}/name" method="post">
<label for="display-name">내 문서에서 표시할 이름</label>
<input id="display-name" name="display_name" type="text" maxlength="160" value="${escapeHtml(metadata.display_name)}" aria-describedby="name-hint" autocomplete="off">
<input type="hidden" name="expected_name_revision" value="${metadata.name_revision}">
<p id="name-hint"><small>80자 이내. 비우면 문서 번호로 표시합니다. 직접 입력한 이름은 이 문서와 함께 보관되며 원래 파일 이름은 자동 수집하지 않습니다.</small></p>
<nav><button type="submit">이름 저장</button><a href="/documents/${document_id}/versions/${metadata.current_version}/view">취소</a></nav></form>
<p class="notice">이름을 바꿔도 HWP 내용과 이전 저장본은 그대로 유지됩니다.</p></header>`);
    // Retain the browser's same-origin form POST Origin, as on the upload page.
    response.headers.set('Referrer-Policy','same-origin');
    return response;
  } catch (error) {
    if (!messages[error.code]) throw error;
    const response = browserPage('문서 이름 확인', `<header><h1>문서 이름을 확인해 주세요</h1><p role="alert">${messages[error.code]}</p>
<nav><a href="/documents/${document_id}/name">이름 다시 확인</a><a href="/documents">내 문서</a></nav></header>`);
    return new Response(response.body,{status:error.code==='DOCUMENT_NAME_CONFLICT'?409:400,headers:response.headers});
  }
}
