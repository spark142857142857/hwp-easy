import { StorageError } from '../storage/store.mjs';
import { fileDescriptorOrigin, fileOriginRejectionDiagnostic } from './transfer.mjs';
import { publicErrorCode } from './public-errors.mjs';
import { bodyRepairAllocationDiagnostic } from '../guard/container.mjs';

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
