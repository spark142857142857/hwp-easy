import { StorageError } from '../storage/store.mjs';
const fail = (code) => { throw new StorageError(code); };
export async function boundedBytes(body, maximum, length) {
  if (!Number.isSafeInteger(maximum) || maximum < 1 || maximum > 4 * 1024 * 1024) fail('INVALID_TRANSFER_LIMIT');
  if (length !== null && length !== undefined && (!/^\d+$/.test(String(length)) || Number(length) > maximum)) {
    try { await body?.cancel(); } catch {}
    fail('TRANSFER_LIMIT_EXCEEDED');
  }
  if (!body?.getReader) fail('EMPTY_TRANSFER');
  // Never retain every network chunk: millions of tiny chunks can exhaust the
  // heap even when the accumulated byte count is below the input limit.
  const reader = body.getReader(), bytes = new Uint8Array(maximum); let size = 0, chunks = 0;
  try {
    while (true) {
      const { value, done } = await reader.read(); if (done) break;
      if (!(value instanceof Uint8Array)) fail('TRANSFER_READ_FAILED');
      if (++chunks > 16384 || size + value.byteLength > maximum) fail('TRANSFER_LIMIT_EXCEEDED');
      bytes.set(value, size); size += value.byteLength;
    }
  } catch (error) {
    try { await reader.cancel(); } catch {}
    if (error instanceof StorageError) throw error;
    fail('TRANSFER_READ_FAILED');
  } finally { reader.releaseLock(); }
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
export async function fetchInputFile(file, originConfig, fetcher = fetch) {
  // A fileParams object is a transfer descriptor, NOT proof of arbitrary URL authority.
  if (!file || typeof file !== 'object' || Array.isArray(file)
    || Object.keys(file).some((k) => !['download_url', 'file_id', 'mime_type', 'file_name'].includes(k))
    || typeof file.file_id !== 'string' || !file.file_id.length || file.file_id.length > 256
    || typeof file.download_url !== 'string' || file.download_url.length > 8192
    || (file.mime_type !== undefined && (typeof file.mime_type !== 'string' || file.mime_type.length > 256))
    || (file.file_name !== undefined && (typeof file.file_name !== 'string' || file.file_name.length > 512))) fail('INVALID_FILE_ARGUMENT');
  const allowed = configuredFileOrigins(originConfig);
  let url;
  try { url = new URL(file.download_url); } catch { fail('FILE_URL_NOT_ALLOWED'); }
  if (url.protocol !== 'https:' || url.username || url.password || url.port || url.hash || !allowed.includes(url.origin)) fail('FILE_URL_NOT_ALLOWED');
  let result;
  try {
    // Never forward Sites/user credentials or follow a redirect to another host.
    result = await fetcher(url.href, { redirect: 'manual', signal: AbortSignal.timeout(30000),
      headers: { Accept: 'application/x-hwp, application/octet-stream' } });
  } catch { fail('FILE_FETCH_FAILED'); }
  if (!result.ok) { try { await result.body?.cancel(); } catch {} fail('FILE_FETCH_FAILED'); }
  return boundedBytes(result.body, 4 * 1024 * 1024, result.headers.get('content-length'));
}
