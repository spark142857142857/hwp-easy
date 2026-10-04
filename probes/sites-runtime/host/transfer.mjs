import { StorageError } from '../storage/store.mjs';
const fail = (code) => { throw new StorageError(code); };
// Keep diagnostics separate from arbitrary upstream error properties. Only a
// validated public HTTPS origin and a count survive this pre-fetch rejection.
const deniedFileOrigins = new WeakMap();
export function fileOriginRejectionDiagnostic(error) {
  const diagnostic = deniedFileOrigins.get(error);
  return diagnostic ? { ...diagnostic } : undefined;
}
export const TRANSFER_BODY_TIMEOUT_MS = 30000;
// Cancellation can itself never settle. Observe errors without letting an
// upstream cancel hook hold a rejected transfer (and its reader) indefinitely.
const cancelQuietly = (source) => { try { Promise.resolve(source?.cancel()).catch(() => {}); } catch {} };
export async function boundedBytes(body, maximum, length, timeoutMs = TRANSFER_BODY_TIMEOUT_MS) {
  if (!Number.isSafeInteger(maximum) || maximum < 1 || maximum > 4 * 1024 * 1024) fail('INVALID_TRANSFER_LIMIT');
  if (!Number.isSafeInteger(timeoutMs) || timeoutMs < 1 || timeoutMs > TRANSFER_BODY_TIMEOUT_MS) fail('INVALID_TRANSFER_TIMEOUT');
  if (length !== null && length !== undefined && (!/^\d+$/.test(String(length)) || Number(length) > maximum)) {
    cancelQuietly(body);
    fail('TRANSFER_LIMIT_EXCEEDED');
  }
  if (!body?.getReader) fail('EMPTY_TRANSFER');
  // Never retain every network chunk: millions of tiny chunks can exhaust the
  // heap even when the accumulated byte count is below the input limit.
  const reader = body.getReader(), bytes = new Uint8Array(maximum); let size = 0, chunks = 0;
  let timer;
  // One total deadline, not a fresh allowance after every arriving chunk.
  const deadline = new Promise((_, reject) => {
    timer = setTimeout(() => reject(new StorageError('TRANSFER_TIMEOUT')), timeoutMs);
  });
  try {
    while (true) {
      const { value, done } = await Promise.race([reader.read(), deadline]); if (done) break;
      if (!(value instanceof Uint8Array)) fail('TRANSFER_READ_FAILED');
      if (++chunks > 16384 || size + value.byteLength > maximum) fail('TRANSFER_LIMIT_EXCEEDED');
      bytes.set(value, size); size += value.byteLength;
    }
  } catch (error) {
    cancelQuietly(reader);
    if (error instanceof StorageError) throw error;
    fail('TRANSFER_READ_FAILED');
  } finally { clearTimeout(timer); reader.releaseLock(); }
  if (!size) fail('EMPTY_TRANSFER');
  return bytes.slice(0, size);
}
export async function authenticatedOwner(headers) {
  // Trusted ONLY behind Sites dispatch. Presence checks are not an OAuth verifier.
  const user = headers.get('oai-authenticated-user-id'), email = headers.get('oai-authenticated-user-email');
  if (!user || !email || user.length > 1024 || email.length > 512) fail('AUTHENTICATION_REQUIRED');
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(`hwp-easy/site-user/v1\0${user}`));
  return `user:${[...new Uint8Array(digest)].map((n) => n.toString(16).padStart(2, '0')).join('')}`;
}
export function configuredOrigin(value) {
  let url;
  try { url = new URL(value); } catch { fail('FILE_HOST_NOT_CONFIGURED'); }
  if (url.protocol !== 'https:' || url.username || url.password || url.port
    || url.pathname !== '/' || url.search || url.hash || !/^[a-z0-9.-]+\.[a-z]{2,}$/.test(url.hostname)
    || /(?:^|\.)(?:localhost|local|internal)$/.test(url.hostname)) fail('FILE_HOST_NOT_CONFIGURED');
  return url.origin;
}
export function configuredFileOrigins(originConfig) {
  let allowed;
  try { allowed = JSON.parse(originConfig ?? '[]'); } catch { fail('FILE_HOST_NOT_CONFIGURED'); }
  if (!Array.isArray(allowed) || !allowed.length || allowed.length > 8) fail('FILE_HOST_NOT_CONFIGURED');
  return allowed.map(configuredOrigin);
}
export function fileDescriptorOrigin(file) {
  // Inspect ONLY the public HTTPS origin. Never return a signed URL's path,
  // query, file ID, filename or user-supplied MIME type, and never fetch here.
  if (!file || typeof file !== 'object' || Array.isArray(file)
    || Object.keys(file).some((k) => !['download_url', 'file_id', 'mime_type', 'file_name'].includes(k))
    || typeof file.file_id !== 'string' || !file.file_id.length || file.file_id.length > 256
    || typeof file.download_url !== 'string' || file.download_url.length > 8192
    || (file.mime_type !== undefined && (typeof file.mime_type !== 'string' || file.mime_type.length > 256))
    || (file.file_name !== undefined && (typeof file.file_name !== 'string' || file.file_name.length > 512))) fail('INVALID_FILE_ARGUMENT');
  let url;
  try { url = new URL(file.download_url); } catch { fail('FILE_URL_NOT_ALLOWED'); }
  if (url.protocol !== 'https:' || url.username || url.password || url.port || url.hash) fail('FILE_URL_NOT_ALLOWED');
  try { configuredOrigin(url.origin); } catch { fail('FILE_URL_NOT_ALLOWED'); }
  return url.origin;
}
export async function fetchInputFile(file, originConfig, fetcher = fetch, maximum = 4 * 1024 * 1024) {
  // A fileParams object is a descriptor, NOT proof of arbitrary URL authority.
  const candidate = fileDescriptorOrigin(file);
  const allowed = configuredFileOrigins(originConfig);
  if (!allowed.includes(candidate)) {
    const error = new StorageError('FILE_URL_NOT_ALLOWED');
    deniedFileOrigins.set(error, { candidate_file_origin: candidate,
      configured_file_origins_count: allowed.length });
    throw error;
  }
  const url = new URL(file.download_url);
  let result;
  try {
    // Never forward Sites/user credentials or follow a redirect to another host.
    result = await fetcher(url.href, { redirect: 'manual', signal: AbortSignal.timeout(30000),
      headers: { Accept: 'application/x-hwp, application/octet-stream' } });
  } catch { fail('FILE_FETCH_FAILED'); }
  if (!result.ok) { cancelQuietly(result.body); fail('FILE_FETCH_FAILED'); }
  return boundedBytes(result.body, maximum, result.headers.get('content-length'));
}
