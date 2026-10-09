// Self-contained: the host serves this function as a same-origin script.
// Keep each file selection's request ID across uncertain outcomes.
export function installUploadForm({ document, fetch, crypto, location, AbortController, setTimeout, clearTimeout }) {
  const form = document.getElementById('upload-form'), input = document.getElementById('hwp-file');
  const button = document.getElementById('upload-button'), status = document.getElementById('upload-status');
  const recovery = document.getElementById('upload-recovery');
  if (!form || !input || !button || !status) return;
  let selected, requestId, busy = false, uncertain = false;
  const unknownMessage = '업로드 완료 여부를 확인하지 못했습니다. 이 화면을 유지하고 연결을 확인한 뒤 같은 파일로 다시 시도하세요. 새로고침하면 기존 요청을 잃을 수 있습니다.';
  const validationErrors = new Set(['DOCUMENT_OPERATION_FAILED', 'ENGINE_OPERATION_FAILED', 'INVALID_INPUT_BYTES',
    'REQUIRED_STREAM_MISSING', 'INVALID_BODY_LAYOUT', 'UNSUPPORTED_BODY_RECORD', 'UNSUPPORTED_RECORD_LIMIT',
    'BODY_BYTES_LIMIT', 'BODY_RECORD_LIMIT', 'RAW_TEXT_RECORD_LAYOUT_UNVERIFIED', 'RAW_CHAR_SHAPE_LAYOUT_UNVERIFIED']);
  const messages = {
    AUTHENTICATION_REQUIRED: '로그인이 만료되었습니다. 이 화면을 다시 열어 로그인한 뒤 업로드하세요.',
    DOCUMENT_UPLOADS_NOT_ENABLED: '현재 파일 업로드가 꺼져 있습니다.',
    TRANSFER_LIMIT_EXCEEDED: '4 MiB 이하의 HWP 파일을 선택해주세요.',
    INPUT_LIMIT_EXCEEDED: '이 파일은 현재 처리 한도를 넘습니다. 다른 HWP 파일을 선택해주세요.',
    RAW_TEXT_LIMIT_EXCEEDED: '파일 크기는 작아도 본문 길이가 현재 처리 한도를 넘습니다. 다른 HWP 파일을 선택해주세요.',
    HOSTED_WORKLOAD_LIMIT_EXCEEDED: '본문과 표 셀의 합산 길이가 현재 서버의 처리 한도(40만 단위, 예: 😀는 2단위, 👩‍💻는 5단위)를 넘어서 업로드하지 않았습니다. 같은 파일을 다시 시도해도 해결되지 않습니다.',
  };
  input.addEventListener('change', () => {
    if (busy || uncertain) return;
    selected = undefined; requestId = undefined; button.disabled = true; button.textContent = '업로드';
    if (recovery) recovery.hidden = true;
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
    let finished = false, retry = true, savedConfirmed = false;
    try {
      const response = await fetch('/documents/import', { method: 'POST', credentials: 'same-origin',
        headers: { 'Content-Type': 'application/x-hwp', 'hwp-request-id': requestId },
        body: selected, signal: controller.signal, redirect: 'error' });
      let result;
      try { result = await response.json(); } catch { /* Classify by status when the response body is unreadable. */ }
      const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
      const validObject = result !== null && typeof result === 'object' && !Array.isArray(result);
      const code = validObject && typeof result.error === 'string' ? result.error : undefined;
      if (response.ok && validObject && result.saved === true && typeof result.document_id === 'string'
        && typeof result.version_id === 'string' && uuid.test(result.document_id) && uuid.test(result.version_id)) {
        savedConfirmed = true; uncertain = false;
        status.textContent = '업로드했습니다. 저장된 문서를 여는 중입니다…';
        location.assign(`/documents/${result.document_id}/versions/${result.version_id}/view`);
        finished = true;
      } else if (response.status >= 500 || response.ok || (!code && response.status !== 401)
        || ['COMMIT_OUTCOME_UNKNOWN', 'STORAGE_UNAVAILABLE', 'BLOB_WRITE_FAILED'].includes(code)) {
        uncertain = true; status.textContent = unknownMessage;
      } else if (response.status === 401 || Object.hasOwn(messages, code) || validationErrors.has(code)) {
        const message = response.status === 401 ? messages.AUTHENTICATION_REQUIRED : Object.hasOwn(messages, code)
          ? messages[code] : 'HWP 검사를 완료하지 못했습니다. 손상되었거나 현재 지원하지 않는 파일일 수 있습니다. 다른 파일을 선택해주세요.';
        status.textContent = uncertain
          ? `이전 업로드 완료 여부는 아직 확인되지 않았습니다. ${response.status === 401 || code === 'AUTHENTICATION_REQUIRED'
            ? '이 화면을 유지한 채 새 창에서 같은 계정으로 로그인한 뒤 다시 시도하세요.'
            : '이번 재시도는 거부되었습니다. 이 화면을 유지하고 내 문서를 새 창에서 확인하세요.'}` : message;
        retry = uncertain && (response.status === 401 || code === 'AUTHENTICATION_REQUIRED' || code === 'DOCUMENT_UPLOADS_NOT_ENABLED');
      } else {
        uncertain = true; status.textContent = unknownMessage;
      }
    } catch {
      if (savedConfirmed) {
        retry = false;
        status.textContent = '업로드 완료는 확인했지만 저장본 화면을 열지 못했습니다. 내 문서를 새 창에서 확인하세요.';
      } else { uncertain = true; status.textContent = unknownMessage; }
    } finally {
      clearTimeout(timer);
      if (recovery) recovery.hidden = finished || (!uncertain && !savedConfirmed);
      if (!finished) {
        busy = false; input.disabled = uncertain; button.disabled = !retry;
        button.textContent = retry ? '같은 파일로 다시 시도' : '업로드';
        form.setAttribute('aria-busy', 'false');
      }
    }
  });
}
