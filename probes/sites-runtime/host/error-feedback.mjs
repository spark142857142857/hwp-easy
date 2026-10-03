import { StorageError } from '../storage/store.mjs';
import { fileDescriptorOrigin } from './transfer.mjs';
import { publicErrorCode } from './public-errors.mjs';

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
