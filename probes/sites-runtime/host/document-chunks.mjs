// Bounded, immutable-version transport. A chunk is NOT a standalone HWP file.
// Callers authorize/store-read and reopen the whole HWP before issuing chunks.
import { StorageError } from '../storage/store.mjs';
export const MAX_HWP_CHUNK_BYTES = 64 * 1024;
export const MAX_CHUNKED_HWP_BYTES = 4 * 1024 * 1024;
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const hash = /^[0-9a-f]{64}$/;
const fail = (code = 'INVALID_DOWNLOAD_CHUNK') => { throw new StorageError(code); };
const integer = (n, min, max) => Number.isSafeInteger(n) && n >= min && n <= max;
const sha = async (bytes) => [...new Uint8Array(await crypto.subtle.digest('SHA-256', bytes))]
  .map((b) => b.toString(16).padStart(2, '0')).join('');
const encode = (bytes) => { let text = ''; for (const b of bytes) text += String.fromCharCode(b); return btoa(text); };
const uri = (d) => `hwp-easy://documents/${d.document_id}/versions/${d.version_id}/${d.output_sha256}/chunks/${d.chunk_offset}-${d.chunk_bytes}-${d.chunk_sha256}.bin`;
function pin(metadata, total) {
  const p = { document_id: metadata?.document_id, version_id: metadata?.version_id,
    output_sha256: metadata?.sha256, output_bytes: total };
  if (!uuid.test(p.document_id) || !uuid.test(p.version_id) || !hash.test(p.output_sha256)
    || !integer(total, 1, MAX_CHUNKED_HWP_BYTES)) fail();
  return p;
}
export async function documentChunkResource(bytes, metadata, request) {
  if (!(bytes instanceof Uint8Array)) fail();
  const pinned = pin(metadata, bytes.length), offset = request?.offset, limit = request?.max_bytes ?? MAX_HWP_CHUNK_BYTES;
  if (!integer(offset, 0, bytes.length - 1) || !integer(limit, 1024, MAX_HWP_CHUNK_BYTES)) fail();
  if (request?.expected_sha256 !== pinned.output_sha256) fail('VERSION_CONFLICT');
  const whole = new Uint8Array(bytes);
  if (await sha(whole) !== pinned.output_sha256) fail('BLOB_MISSING_OR_CORRUPT');
  const part = whole.slice(offset, offset + limit), next = offset + part.length;
  const data = { ...pinned, output_transport: 'mcp_chunk_resource', chunk_offset: offset, chunk_bytes: part.length,
    chunk_sha256: await sha(part), next_offset: next < whole.length ? next : null,
    transfer_complete: next === whole.length, chunk_is_complete_hwp: false,
    local_file_saved: false, native_file_attachment_verified: false };
  return { data, resource: { type: 'resource', resource: { uri: uri(data), mimeType: 'application/octet-stream', blob: encode(part) } } };
}

// Client-side reference collector: no filesystem/network access. Pin before
// receiving data; finalize requires an independent HWP engine reopen callback.
export function createHwpChunkCollector(metadata, total) {
  const pinned = pin(metadata, total), buffer = new Uint8Array(total);
  let offset = 0, last, busy = false;
  return {
    get next_offset() { return offset === total ? null : offset; },
    async accept(data, resource) {
      if (busy) fail(); busy = true;
      try {
        // Snapshot untrusted/caller-owned fields before the first await.
        const d = { ...data }, r = { ...resource?.resource };
        if (Object.keys(pinned).some((k) => d[k] !== pinned[k]) || d.output_transport !== 'mcp_chunk_resource'
          || d.chunk_is_complete_hwp !== false || resource?.type !== 'resource' || r.mimeType !== 'application/octet-stream'
          || !integer(d.chunk_offset, 0, total - 1) || !integer(d.chunk_bytes, 1, MAX_HWP_CHUNK_BYTES)
          || d.chunk_offset + d.chunk_bytes > total || !hash.test(d.chunk_sha256)
          || d.transfer_complete !== (d.chunk_offset + d.chunk_bytes === total)
          || d.next_offset !== (d.transfer_complete ? null : d.chunk_offset + d.chunk_bytes)
          || r.uri !== uri(d) || typeof r.blob !== 'string' || r.blob.length !== 4 * Math.ceil(d.chunk_bytes / 3)
          || !/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(r.blob)) fail();
        const decoded = atob(r.blob), part = Uint8Array.from(decoded, (c) => c.charCodeAt(0));
        if (part.length !== d.chunk_bytes || encode(part) !== r.blob || await sha(part) !== d.chunk_sha256) fail();
        // Only an exact immediate retry is accepted. No gaps, reorder or overlap.
        if (last && d.chunk_offset === last.offset && d.chunk_bytes === last.length && d.chunk_sha256 === last.sha256) {
          if (!part.every((b, i) => b === buffer[d.chunk_offset + i])) fail();
          return { replayed: true, next_offset: offset === total ? null : offset };
        }
        if (d.chunk_offset !== offset) fail();
        buffer.set(part, offset); offset += part.length;
        last = { offset: d.chunk_offset, length: part.length, sha256: d.chunk_sha256 };
        return { replayed: false, next_offset: offset === total ? null : offset };
      } finally { busy = false; }
    },
    async finalize(reopen) {
      if (busy || offset !== total) fail('DOWNLOAD_INCOMPLETE');
      if (typeof reopen !== 'function') fail(); busy = true;
      try {
        const bytes = new Uint8Array(buffer);
        if (await sha(bytes) !== pinned.output_sha256) fail('BLOB_MISSING_OR_CORRUPT');
        const snapshot = await reopen(new Uint8Array(bytes));
        if (snapshot?.source_sha256 !== pinned.output_sha256) fail('BLOB_MISSING_OR_CORRUPT');
        return bytes;
      } finally { busy = false; }
    },
  };
}
