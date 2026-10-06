import { StorageError, saveRejectionDiagnostic } from '../storage/store.mjs';
import { fileDescriptorOrigin, fileOriginRejectionDiagnostic } from './transfer.mjs';
import { publicErrorCode } from './public-errors.mjs';
import { bodyRepairAllocationDiagnostic } from '../guard/container.mjs';
import { MAX_HOSTED_BODY_TEXT_CODE_UNITS } from '../guard/hosted-workload.mjs';

// Only errors made here carry diagnostics. Never serialize arbitrary error
// properties: they can contain private document data or signed download URLs.
const deniedImports = new WeakMap();
export function uploadDisabledError(file) {
  const error = new StorageError('DOCUMENT_UPLOADS_NOT_ENABLED');
  try {
    const origin = fileDescriptorOrigin(file);
    deniedImports.set(error, origin);
  } catch { /* Keep the existing upload-gate error for unsafe descriptors. */ }
  return error;
}

export function documentToolError(error) {
  const code = publicErrorCode(error);
  const result = { isError: true, content: [{ type: 'text', text: code }] };
  if (code === 'HOSTED_WORKLOAD_LIMIT_EXCEEDED') {
    const feedback = { stage: 'private-development', layout_verified: false,
      data: { error: code, workload_diagnostic: {
        status: 'hosted_body_text_limit_exceeded',
        max_body_text_utf16_code_units: MAX_HOSTED_BODY_TEXT_CODE_UNITS,
        message_ko: '본문과 표 셀의 합산 길이가 현재 서버의 처리 한도(40만 UTF-16 단위)를 넘어 이번 요청을 저장하지 않았습니다. 예를 들어 😀는 2단위, 👩‍💻는 5단위로 계산합니다. 재인증이나 같은 요청의 재시도로 해결되지 않으며, 문서를 임의로 자르거나 일부만 저장하지 마세요.',
        saved: false, retry_same_request_recommended: false,
        suggested_action: 'report_hosted_limit_without_altering_document',
        automatic_partial_save_allowed: false, unrequested_edits_allowed: false,
      } } };
    result.content.push({ type: 'text', text: JSON.stringify(feedback) });
    result.structuredContent = feedback;
    return result;
  }
  const save = saveRejectionDiagnostic(error);
  if (save) {
    const guidance = {
      VERSION_CONFLICT: {
        status: 'current_version_changed',
        message_ko: '지정한 저장본이 현재 저장본과 달라 이번 요청은 저장하지 않았습니다. 최신 버전 목록과 현재 저장본을 끝까지 읽고, 요청한 수정 내용과 대상을 다시 확인한 뒤 새 요청으로 저장하세요.',
        suggested_action: 'read_current_version_and_replan',
      },
      DOCUMENT_VERSION_LIMIT: {
        status: 'document_version_limit_reached',
        message_ko: '문서별 저장 버전 한도(128개)에 도달해 수정이나 복구를 추가 저장하지 않았습니다. 기존 문서와 버전은 보존됩니다. 한도는 재시도로 해결되지 않으며, 자동 삭제나 요청하지 않은 다른 문서 저장을 하지 마세요.',
        suggested_action: 'report_version_limit_and_ask_user_for_next_action',
        max_versions_per_document: save.max_versions_per_document,
      },
      SAVE_GUARD_REJECTED: {
        status: 'save_guard_rejected_reason_unconfirmed',
        message_ko: '저장 조건을 충족하지 않아 이번 요청은 저장하지 않았습니다. 이후 상태가 바뀌어 충돌이나 한도 초과 중 어느 원인인지 확정할 수 없습니다. 버전 목록과 현재 저장본을 다시 확인하세요.',
        suggested_action: 'inspect_current_version_before_retry',
      },
    }[save.reason];
    const feedback = { stage: 'private-development', layout_verified: false,
      data: { error: code, save_diagnostic: { ...guidance, saved: false,
        retry_same_request_recommended: false, automatic_overwrite_allowed: false,
        automatic_version_deletion_allowed: false, unrequested_save_as_allowed: false } } };
    result.content.push({ type: 'text', text: JSON.stringify(feedback) });
    result.structuredContent = feedback;
    return result;
  }
  const rejectedOrigin = code === 'FILE_URL_NOT_ALLOWED' ? fileOriginRejectionDiagnostic(error) : undefined;
  if (rejectedOrigin) {
    const feedback = { stage: 'private-development', layout_verified: false,
      data: { error: code, transfer_diagnostic: {
        status: 'file_origin_not_allowlisted', ...rejectedOrigin,
        candidate_origin_is_not_authorization: true, candidate_origin_allowed: false,
        network_request_made: false, input_file_bytes_received: false, stored: false,
        automatic_host_expansion_allowed: false,
      } } };
    result.content.push({ type: 'text', text: JSON.stringify(feedback) });
    result.structuredContent = feedback;
    return result;
  }
  const allocation = code === 'BODY_REPAIR_ALLOCATION_UNSUPPORTED' ? bodyRepairAllocationDiagnostic(error) : undefined;
  if (allocation) {
    const feedback = { stage: 'private-development', layout_verified: false,
      data: { error: code, edit_diagnostic: {
        status: 'existing_body_allocation_mismatch',
        message_ko: '보존할 본문 데이터가 편집 후보 HWP의 기존 저장 할당 조건과 맞지 않아 저장하지 않았습니다. 재인증이나 디스크 여유 공간 문제가 아니라 현재 엔진의 편집 제한입니다.',
        allocation, saved: false, file_changed: false,
        retry_same_request_recommended: false,
        suggested_action: 'report_limit_without_altering_request',
        automatic_partial_save_allowed: false, unrequested_edits_allowed: false,
      } } };
    result.content.push({ type: 'text', text: JSON.stringify(feedback) });
    result.structuredContent = feedback;
    return result;
  }
  const origin = deniedImports.get(error);
  if (code !== 'DOCUMENT_UPLOADS_NOT_ENABLED' || !origin) return result;
  const feedback = { stage: 'private-development', layout_verified: false,
    data: { error: code, transfer_diagnostic: {
      status: 'upload_disabled_origin_only', candidate_file_origin: origin,
      candidate_origin_is_not_authorization: true, general_uploads_enabled: false,
      network_request_made: false, input_file_bytes_received: false, stored: false,
    } } };
  // The first text block and isError remain unchanged for existing clients.
  result.content.push({ type: 'text', text: JSON.stringify(feedback) });
  result.structuredContent = feedback;
  return result;
}
