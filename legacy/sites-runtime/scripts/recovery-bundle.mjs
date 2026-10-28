// Offline developer/operator library, never imported by the deployed Worker.
// A bundle contains private metadata and HWP bytes. Checksums detect corruption,
// not a forged/replaced backup. No paths, credentials or restore callbacks exist.
import { createHash } from 'node:crypto';
import { auditRecoverySnapshot, copyBoundedRecoveryMetadata, recoveryLimits } from './recovery-audit.mjs';

export class RecoveryBundleError extends Error {
  constructor(code) { super(code); this.name = 'RecoveryBundleError'; this.code = code; }
}
const fail = code => { throw new RecoveryBundleError(code); };
const magic = Buffer.from('HWPEBK01', 'ascii'), headerBytes = 16, checksumBytes = 32, blobHeaderBytes = 36;
const hash = bytes => createHash('sha256').update(bytes).digest();
export const recoveryBundleLimits = Object.freeze({ max_metadata_bytes: 16 * 1024 * 1024,
  max_blob_count: recoveryLimits.max_rows_per_table,
  max_bundle_bytes: 16 * 1024 * 1024 + recoveryLimits.max_total_blob_bytes
    + recoveryLimits.max_rows_per_table * blobHeaderBytes + headerBytes + checksumBytes });
const boundary = (proof, extra) => Object.freeze({ ...proof, ...extra,
  bundle_authenticated: false, bundle_encrypted: false, hwp_format_verified: false,
  platform_backup_restore_verified: false });

/** Packages exactly one bounded, audited snapshot and its recorded immutable
 * blobs. Copies metadata before asynchronous reads; copies each blob once at
 * ingestion. Never packages the external ledger as future authoritative input. */
export async function createRecoveryBundle(input, { latestDeletions, readBlob } = {}) {
  if (typeof readBlob !== 'function') fail('INVALID_RECOVERY_BUNDLE');
  const { snapshot, ledger } = copyBoundedRecoveryMetadata(input, latestDeletions);
  const metadata = Buffer.from(JSON.stringify(snapshot), 'utf8');
  if (metadata.length > recoveryBundleLimits.max_metadata_bytes) fail('RECOVERY_BUNDLE_LIMIT_EXCEEDED');
  const blobs = new Map(), sizes = new Map(snapshot.tables.hwp_versions.map(row => [row.blob_key, row.byte_size]));
  const proof = await auditRecoverySnapshot(snapshot, { latestDeletions: ledger, readBlob: async key => {
    const bytes = await readBlob(key);
    // Let the audit reject invalid lengths without copying an oversized value.
    if (!(bytes instanceof Uint8Array) || bytes.byteLength !== sizes.get(key)
        || bytes.byteLength > recoveryLimits.max_blob_bytes) return bytes;
    const copy = Uint8Array.from(bytes); blobs.set(key, copy); return copy;
  } });
  const count = snapshot.tables.hwp_versions.length;
  const payloadLength = headerBytes + metadata.length + count * blobHeaderBytes + proof.bytes_checked;
  if (payloadLength + checksumBytes > recoveryBundleLimits.max_bundle_bytes) fail('RECOVERY_BUNDLE_LIMIT_EXCEEDED');
  const bytes = Buffer.alloc(payloadLength + checksumBytes);
  magic.copy(bytes); bytes.writeUInt32BE(metadata.length, 8); bytes.writeUInt32BE(count, 12);
  metadata.copy(bytes, headerBytes);
  let offset = headerBytes + metadata.length;
  for (const row of snapshot.tables.hwp_versions) {
    const blob = blobs.get(row.blob_key);
    assertBlob(blob, row);
    Buffer.from(row.sha256, 'hex').copy(bytes, offset); bytes.writeUInt32BE(blob.length, offset + 32);
    bytes.set(blob, offset + blobHeaderBytes); offset += blobHeaderBytes + blob.length;
  }
  if (offset !== payloadLength) fail('INVALID_RECOVERY_BUNDLE');
  hash(bytes.subarray(0, payloadLength)).copy(bytes, payloadLength);
  return { bytes, proof: boundary(proof, { bundle_created: true, bundle_bytes: bytes.length }) };
}

function assertBlob(bytes, row) {
  if (!(bytes instanceof Uint8Array) || bytes.length !== row.byte_size
      || hash(bytes).toString('hex') !== row.sha256) fail('RECOVERY_BUNDLE_CORRUPT');
}

/** Copies a bounded bundle before parsing. Returns private snapshot data and a
 * copy-on-read byte adapter ONLY after all checks pass. latestDeletions must be
 * obtained separately, even if the file is byte-for-byte intact. */
export async function readRecoveryBundle(input, { latestDeletions } = {}) {
  if (!(input instanceof Uint8Array) || input.byteLength < headerBytes + checksumBytes)
    fail('INVALID_RECOVERY_BUNDLE');
  if (input.byteLength > recoveryBundleLimits.max_bundle_bytes) fail('RECOVERY_BUNDLE_LIMIT_EXCEEDED');
  const bytes = Buffer.from(input), end = bytes.length - checksumBytes;
  if (!bytes.subarray(0, magic.length).equals(magic)) fail('INVALID_RECOVERY_BUNDLE');
  const metadataLength = bytes.readUInt32BE(8), blobCount = bytes.readUInt32BE(12);
  if (metadataLength > recoveryBundleLimits.max_metadata_bytes || blobCount > recoveryBundleLimits.max_blob_count)
    fail('RECOVERY_BUNDLE_LIMIT_EXCEEDED');
  if (metadataLength === 0 || headerBytes + metadataLength > end) fail('INVALID_RECOVERY_BUNDLE');
  if (!hash(bytes.subarray(0, end)).equals(bytes.subarray(end))) fail('RECOVERY_BUNDLE_CORRUPT');
  let snapshot;
  try { snapshot = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes.subarray(headerBytes, headerBytes + metadataLength))); }
  catch { fail('INVALID_RECOVERY_BUNDLE'); }
  // Bounds and stable copies before entry allocation; full semantic audit below.
  const copied = copyBoundedRecoveryMetadata(snapshot, latestDeletions);
  snapshot = copied.snapshot;
  if (snapshot.tables.hwp_versions.length !== blobCount) fail('INVALID_RECOVERY_BUNDLE');
  const blobs = new Map(); let offset = headerBytes + metadataLength, total = 0;
  for (const row of snapshot.tables.hwp_versions) {
    if (offset + blobHeaderBytes > end) fail('INVALID_RECOVERY_BUNDLE');
    const sha256 = bytes.subarray(offset, offset + 32).toString('hex'), length = bytes.readUInt32BE(offset + 32);
    if (length > recoveryLimits.max_blob_bytes || (total += length) > recoveryLimits.max_total_blob_bytes)
      fail('RECOVERY_BUNDLE_LIMIT_EXCEEDED');
    if (length === 0 || offset + blobHeaderBytes + length > end) fail('INVALID_RECOVERY_BUNDLE');
    if (sha256 !== row.sha256 || length !== row.byte_size || blobs.has(row.blob_key)) fail('RECOVERY_BUNDLE_CORRUPT');
    // These views are on the private bounded copy, never on the caller's buffer.
    const blob = bytes.subarray(offset + blobHeaderBytes, offset + blobHeaderBytes + length);
    assertBlob(blob, row); blobs.set(row.blob_key, blob);
    offset += blobHeaderBytes + length;
  }
  if (offset !== end) fail('INVALID_RECOVERY_BUNDLE');
  const proof = await auditRecoverySnapshot(snapshot, { latestDeletions: copied.ledger, readBlob: async key => blobs.get(key) });
  return { snapshot, readBlob: async key => {
    const blob = blobs.get(key); return blob === undefined ? undefined : Uint8Array.from(blob);
  },
    proof: boundary(proof, { bundle_bytes: bytes.length, bundle_checksum_verified: true }) };
}
