// Developer-only, read-only audit. Not a backup exporter, restore command or
// production route. A trusted operator must establish snapshot/ledger provenance.
import { createHash } from 'node:crypto';
import { validDocumentName } from '../storage/document-names.mjs';
import { auditStorageInventory } from './storage-inventory-audit.mjs';

export class RecoveryAuditError extends Error {
  constructor(code) { super(code); this.name = 'RecoveryAuditError'; this.code = code; }
}
const fail = code => { throw new RecoveryAuditError(code); };
export const recoveryLimits = Object.freeze({ max_rows_per_table: 10000,
  max_metadata_utf16_units: 2 * 1024 * 1024,
  max_blob_bytes: 4 * 1024 * 1024, max_total_blob_bytes: 64 * 1024 * 1024,
  max_versions_per_document: 128 });
export const recoveryColumns = Object.freeze({
  hwp_documents: ['owner', 'id', 'current_version', 'revision', 'created_at', 'display_name', 'name_revision'],
  hwp_versions: ['owner', 'document_id', 'id', 'sha256', 'blob_key', 'byte_size', 'created_at'],
  hwp_requests: ['owner', 'id', 'fingerprint', 'document_id', 'version_id', 'created_at'],
  hwp_deletions: ['owner', 'document_id', 'request_id', 'expected_version', 'phase', 'version_count', 'created_at', 'completed_at'],
});
for (const columns of Object.values(recoveryColumns)) Object.freeze(columns);
const uuid = value => typeof value === 'string' && /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(value);
const owner = value => typeof value === 'string' && /^[a-zA-Z0-9:_-]{1,160}$/.test(value);
const digest = value => typeof value === 'string' && /^[0-9a-f]{64}$/.test(value);
const integer = (value, minimum = 0) => Number.isSafeInteger(value) && value >= minimum;
const object = (value, keys) => value && Object.getPrototypeOf(value) === Object.prototype
  && Object.keys(value).sort().join(',') === [...keys].sort().join(',');
const documentKey = row => `${row.owner}/${row.document_id ?? row.id}`;
const versionKey = row => `${row.owner}/${row.document_id}/${row.version_id ?? row.id}`;
function unique(rows, key) {
  const map = new Map();
  for (const row of rows) {
    const id = key(row);
    if (map.has(id)) fail('RECOVERY_METADATA_INCONSISTENT');
    map.set(id, row);
  }
  return map;
}
function deletionRows(rows) {
  if (!Array.isArray(rows)) fail('INVALID_RECOVERY_SNAPSHOT');
  if (rows.length > recoveryLimits.max_rows_per_table) fail('RECOVERY_LIMIT_EXCEEDED');
  for (const row of rows) {
    if (!object(row, recoveryColumns.hwp_deletions) || !owner(row.owner) || !uuid(row.document_id)
      || !uuid(row.request_id) || !uuid(row.expected_version) || !integer(row.created_at)
      || !integer(row.version_count, 1) || row.version_count > 128
      || !['pending', 'complete'].includes(row.phase)
      || (row.phase === 'complete' ? !integer(row.completed_at) : row.completed_at !== null))
      fail('INVALID_RECOVERY_SNAPSHOT');
    if (row.phase === 'pending') fail('RECOVERY_DELETION_PENDING');
  }
  unique(rows, row => `${row.owner}/${row.request_id}`);
  return unique(rows, documentKey);
}

// Internal private-data copy for offline packaging. Applies schema/size bounds
// before allocation; semantic validity still requires auditRecoverySnapshot.
export function copyBoundedRecoveryMetadata(input, latestDeletions) {
  if (!object(input, ['format', 'tables']) || input.format !== 'hwp-easy-recovery-v1'
    || !object(input.tables, Object.keys(recoveryColumns))) fail('INVALID_RECOVERY_SNAPSHOT');
  // Bound flat metadata before copying it; blob bytes are supplied separately.
  let metadataUnits = 0;
  for (const [rows, columns] of [...Object.entries(recoveryColumns).map(([table, columns]) => [input.tables[table], columns]),
    [latestDeletions, recoveryColumns.hwp_deletions]]) {
    if (!Array.isArray(rows)) fail('INVALID_RECOVERY_SNAPSHOT');
    if (rows.length > recoveryLimits.max_rows_per_table) fail('RECOVERY_LIMIT_EXCEEDED');
    for (const row of rows) {
      if (!object(row, columns)) fail('INVALID_RECOVERY_SNAPSHOT');
      for (const value of Object.values(row)) {
        if (value !== null && !['string', 'number'].includes(typeof value)) fail('INVALID_RECOVERY_SNAPSHOT');
        if (typeof value === 'string' && (metadataUnits += value.length) > recoveryLimits.max_metadata_utf16_units)
          fail('RECOVERY_LIMIT_EXCEEDED');
      }
    }
  }
  let snapshot, ledger;
  try { snapshot = structuredClone(input); ledger = structuredClone(latestDeletions); }
  catch { fail('INVALID_RECOVERY_SNAPSHOT'); }
  return { snapshot, ledger };
}

/** latestDeletions is an independently obtained COMPLETE, authoritative ledger,
 * including deletions after the recovery point. Never substitute the snapshot's
 * own ledger in an operational audit. Freshness/authenticity are caller duties.
 * Validates every row/key before calling readBlob; never returns private rows. */
export async function auditRecoverySnapshot(input, { latestDeletions, readBlob, listBlobPage } = {}) {
  if (typeof readBlob !== 'function' || (listBlobPage !== undefined && typeof listBlobPage !== 'function'))
    fail('INVALID_RECOVERY_SNAPSHOT');
  const { snapshot, ledger } = copyBoundedRecoveryMetadata(input, latestDeletions);
  if (!object(snapshot, ['format', 'tables']) || snapshot.format !== 'hwp-easy-recovery-v1'
    || !object(snapshot.tables, Object.keys(recoveryColumns))) fail('INVALID_RECOVERY_SNAPSHOT');
  const tables = snapshot.tables;
  for (const [table, columns] of Object.entries(recoveryColumns)) {
    const rows = tables[table];
    if (!Array.isArray(rows)) fail('INVALID_RECOVERY_SNAPSHOT');
    if (rows.length > recoveryLimits.max_rows_per_table) fail('RECOVERY_LIMIT_EXCEEDED');
    for (const row of rows) {
      if (!object(row, columns) || !owner(row.owner) || !integer(row.created_at)) fail('INVALID_RECOVERY_SNAPSHOT');
    }
  }
  const tombstones = deletionRows(tables.hwp_deletions), required = deletionRows(ledger);
  if (tombstones.size !== required.size) fail('RECOVERY_DELETION_LEDGER_MISMATCH');
  for (const [key, row] of required) {
    const stored = tombstones.get(key);
    if (!stored || recoveryColumns.hwp_deletions.some(column => row[column] !== stored[column]))
      fail('RECOVERY_DELETION_LEDGER_MISMATCH');
  }
  for (const row of tables.hwp_documents) {
    if (!uuid(row.id) || !uuid(row.current_version) || !integer(row.revision, 1)
      || !integer(row.name_revision) || !validDocumentName(row.display_name)) fail('INVALID_RECOVERY_SNAPSHOT');
  }
  const documents = unique(tables.hwp_documents, documentKey);
  let byteCount = 0;
  for (const row of tables.hwp_versions) {
    if (!uuid(row.id) || !uuid(row.document_id) || !digest(row.sha256) || !integer(row.byte_size, 1))
      fail('INVALID_RECOVERY_SNAPSHOT');
    if (row.byte_size > recoveryLimits.max_blob_bytes || (byteCount += row.byte_size) > recoveryLimits.max_total_blob_bytes)
      fail('RECOVERY_LIMIT_EXCEEDED');
    // Never let a corrupt metadata row select a path or another owner's bytes.
    if (row.blob_key !== `hwp-easy/v1/${row.owner}/${row.document_id}/${row.id}.hwp`)
      fail('RECOVERY_METADATA_INCONSISTENT');
  }
  const versions = unique(tables.hwp_versions, versionKey), counts = new Map();
  for (const row of versions.values()) {
    const key = documentKey(row);
    if (!documents.has(key) || tombstones.has(key)) fail('RECOVERY_METADATA_INCONSISTENT');
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }
  for (const [key, row] of documents) {
    if (tombstones.has(key) || !versions.has(`${key}/${row.current_version}`)
      || counts.get(key) !== row.revision || counts.get(key) > recoveryLimits.max_versions_per_document)
      fail('RECOVERY_METADATA_INCONSISTENT');
  }
  for (const row of tables.hwp_requests) {
    if (!uuid(row.id) || !uuid(row.document_id) || !uuid(row.version_id) || !digest(row.fingerprint))
      fail('INVALID_RECOVERY_SNAPSHOT');
  }
  const receipts = unique(tables.hwp_requests, row => `${row.owner}/${row.id}`), versionReceipts = new Map();
  let deletedReceipts = 0;
  const deletedVersions = new Map();
  const deletionRequestIds = new Set([...tombstones.values()].map(row => `${row.owner}/${row.request_id}`));
  for (const [key, row] of receipts) {
    if (deletionRequestIds.has(key)) fail('RECOVERY_METADATA_INCONSISTENT');
    const doc = documentKey(row);
    if (tombstones.has(doc)) {
      const seen = deletedVersions.get(doc) ?? new Set();
      if (seen.has(row.version_id)) fail('RECOVERY_METADATA_INCONSISTENT');
      seen.add(row.version_id); deletedVersions.set(doc, seen); deletedReceipts++; continue;
    }
    const version = versionKey(row);
    if (!versions.has(version) || versionReceipts.has(version)) fail('RECOVERY_METADATA_INCONSISTENT');
    versionReceipts.set(version, row);
  }
  if (versionReceipts.size !== versions.size) fail('RECOVERY_METADATA_INCONSISTENT');
  // Deletion keeps the old creation/edit receipts. Losing those would allow an
  // old creation request to be accepted as a new document after recovery.
  for (const [key, row] of tombstones) {
    const seen = deletedVersions.get(key);
    if (seen?.size !== row.version_count || !seen.has(row.expected_version)) fail('RECOVERY_METADATA_INCONSISTENT');
  }
  for (const row of versions.values()) {
    let bytes;
    try { bytes = await readBlob(row.blob_key); }
    catch { fail('RECOVERY_BLOB_UNAVAILABLE'); }
    if (!(bytes instanceof Uint8Array) || bytes.byteLength !== row.byte_size
      || createHash('sha256').update(bytes).digest('hex') !== row.sha256)
      fail('RECOVERY_BLOB_MISSING_OR_CORRUPT');
  }
  const inventory = listBlobPage === undefined ? undefined : await auditStorageInventory(
    [...versions.values()].map(row => ({ blob_key: row.blob_key, byte_size: row.byte_size })), { listBlobPage });
  return Object.freeze({ audit: 'passed', documents: documents.size, versions: versions.size,
    requests: receipts.size, deletions: tombstones.size, deleted_request_receipts: deletedReceipts,
    bytes_checked: byteCount, restored: false, snapshot_provenance_verified: false,
    latest_deletion_ledger_freshness_verified: false, platform_backup_restore_verified: false,
    ...(inventory === undefined ? {} : { storage_inventory: inventory }) });
}
