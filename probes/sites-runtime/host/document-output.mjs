// Caller must first authorize and read the immutable version through the store.
// A binary MCP resource is not a public URL or a certified client download UI.
import { StorageError } from '../storage/store.mjs';
export const MAX_EMBEDDED_HWP_BYTES = 256 * 1024;
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
export async function documentOutputResource(bytes, metadata) {
  if (!(bytes instanceof Uint8Array) || !bytes.length || bytes.length > MAX_EMBEDDED_HWP_BYTES) {
    throw new StorageError('DOCUMENT_EMBEDDED_OUTPUT_LIMIT_EXCEEDED');
  }
  const documentId = metadata?.document_id, versionId = metadata?.version_id, expectedSha256 = metadata?.sha256;
  if (!uuid.test(documentId) || !uuid.test(versionId)
    || !/^[0-9a-f]{64}$/.test(expectedSha256)) throw new StorageError('INVALID_DOWNLOAD_REQUEST');
  const copied = new Uint8Array(bytes);
  const digest = await crypto.subtle.digest('SHA-256', copied);
  const sha256 = [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('');
  if (sha256 !== expectedSha256) throw new StorageError('BLOB_MISSING_OR_CORRUPT');
  let binary = '';
  for (const byte of copied) binary += String.fromCharCode(byte);
  return { type: 'resource', resource: {
    uri: `hwp-easy://documents/${documentId}/versions/${versionId}/${sha256}.hwp`,
    mimeType: 'application/x-hwp', blob: btoa(binary),
  } };
}
