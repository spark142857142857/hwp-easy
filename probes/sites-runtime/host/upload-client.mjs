// Self-contained: the host serves this function as a same-origin script.
// Keep each file selection's request ID across uncertain outcomes.
export function installUploadForm({ document, fetch, crypto, location, AbortController, setTimeout, clearTimeout }) {
  const form = document.getElementById('upload-form'), input = document.getElementById('hwp-file');
  const button = document.getElementById('upload-button'), status = document.getElementById('upload-status');
  if (!form || !input || !button || !status) return;
  let selected, requestId, busy = false;
  const messages = {
    AUTHENTICATION_REQUIRED: '로그인이 만료되었습니다. 이 화면을 다시 열어 로그인한 뒤 업로드하세요.',
    DOCUMENT_UPLOADS_NOT_ENABLED: '현재 파일 업로드가 꺼져 있습니다.',
    TRANSFER_LIMIT_EXCEEDED: '4 MiB 이하의 HWP 파일을 선택해주세요.',
    INPUT_LIMIT_EXCEEDED: '이 파일은 현재 처리 한도를 넘습니다. 다른 HWP 파일을 선택해주세요.',
    RAW_TEXT_LIMIT_EXCEEDED: '파일 크기는 작아도 본문 길이가 현재 처리 한도를 넘습니다. 다른 HWP 파일을 선택해주세요.',
  };
  input.addEventListener('change', () => {
    if (busy) return;
    selected = undefined; requestId = undefined; button.disabled = true; button.textContent = '업로드';
    const file = input.files?.[0];
    if (!file) { status.textContent = ''; return; }
    if (!/\.hwp$/i.test(file.name) || file.size < 1 || file.size > 4194304) {
      status.textContent = '내용이 있는 .hwp 파일을 선택해주세요. 최대 크기는 4 MiB입니다.';
      return;
    }
    selected = file; requestId = crypto.randomUUID(); button.disabled = false;
    status.textContent = `${file.name} · 업로드 준비됨`;
  });
  form.addEventListener('submit', async (event) => {
    event.preventDefault();
    if (busy || !selected || button.disabled) return;
    busy = true; input.disabled = true; button.disabled = true; form.setAttribute('aria-busy', 'true');
    status.textContent = '업로드하고 HWP를 검사하는 중입니다…';
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 30000);
    let finished = false, retry = true;
    try {
      const response = await fetch('/documents/import', { method: 'POST', credentials: 'same-origin',
        headers: { 'Content-Type': 'application/x-hwp', 'hwp-request-id': requestId },
        body: selected, signal: controller.signal, redirect: 'error' });
      const result = await response.json();
      const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
      if (response.ok && result.saved === true && uuid.test(result.document_id) && uuid.test(result.version_id)) {
        status.textContent = '업로드했습니다. 저장된 문서를 여는 중입니다…';
        location.assign(`/documents/${result.document_id}/versions/${result.version_id}/view`);
        finished = true;
      } else if (response.status === 401 || Object.hasOwn(messages, result.error)) {
        status.textContent = response.status === 401 ? messages.AUTHENTICATION_REQUIRED : messages[result.error];
        retry = false;
      } else if (['COMMIT_OUTCOME_UNKNOWN', 'STORAGE_UNAVAILABLE', 'BLOB_WRITE_FAILED'].includes(result.error)) {
        status.textContent = '업로드 완료를 확인하지 못했습니다. 이 화면에서 같은 파일로 다시 시도하면 중복 저장을 방지합니다.';
      } else {
        status.textContent = 'HWP 검사를 통과하지 못했습니다. 손상되었거나 현재 지원하지 않는 파일일 수 있습니다. 다른 파일을 선택해주세요.';
        retry = false;
      }
    } catch {
      status.textContent = '업로드 완료를 확인하지 못했습니다. 화면을 새로고침하지 말고, 연결을 확인한 뒤 같은 파일로 다시 시도해주세요.';
    } finally {
      clearTimeout(timer);
      if (!finished) {
        busy = false; input.disabled = false; button.disabled = !retry;
        button.textContent = retry ? '같은 파일로 다시 시도' : '업로드';
        form.setAttribute('aria-busy', 'false');
      }
    }
  });
}
