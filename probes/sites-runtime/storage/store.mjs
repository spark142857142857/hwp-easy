/** Internal durable D1/R2 store. The host supplies an authenticated owner key.
 * No HTTP routes, filename paths, auth fallbacks or arbitrary blob-key access.
 * HWP validation belongs to the service layer BEFORE mutation.
 */
import { createDeletionStore } from './deletion.mjs';
import { createDocumentNames, validDocumentName } from './document-names.mjs';
export class StorageError extends Error {
  constructor(code) { super(code); this.name = 'StorageError'; this.code = code; }
}
const fail = (code) => { throw new StorageError(code); };
const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const hashPattern = /^[0-9a-f]{64}$/;
const MAX_BYTES = 4 * 1024 * 1024, MAX_VERSIONS = 128;
const saveRejections = new WeakMap();
const rejectSave = (code) => {
  const error = new StorageError(code);
  saveRejections.set(error, code);
  throw error;
};
export function saveRejectionDiagnostic(error) {
  const code = saveRejections.get(error);
  return code && error.code === code ? { reason: code, max_versions_per_document: MAX_VERSIONS } : undefined;
}
const uuid = () => crypto.randomUUID();
const ownerKey = (owner) => {
  if (typeof owner !== 'string' || !/^[a-zA-Z0-9:_-]{1,160}$/.test(owner)) fail('INVALID_OWNER');
  return owner;
};
const id = (value) => { if (typeof value !== 'string' || !uuidPattern.test(value)) fail('INVALID_IDENTIFIER'); return value; };
async function hash(bytes) {
  return [...new Uint8Array(await crypto.subtle.digest('SHA-256', bytes))]
    .map((byte) => byte.toString(16).padStart(2, '0')).join('');
}
const fingerprint = (parts) => hash(new TextEncoder().encode(JSON.stringify(parts)));

export function createVersionStore(db, bucket) {
  if (!db?.prepare || !db?.batch || !bucket?.put || !bucket?.get || !bucket?.delete) fail('STORAGE_UNAVAILABLE');
  const statement = (sql, values = []) => {
    try { return db.prepare(sql).bind(...values); } catch { fail('STORAGE_UNAVAILABLE'); }
  };
  async function first(sql, values) {
    try { return await statement(sql, values).first(); }
    catch { fail('STORAGE_UNAVAILABLE'); }
  }
  async function all(sql, values) {
    try { return (await statement(sql, values).all()).results; }
    catch { fail('STORAGE_UNAVAILABLE'); }
  }
  async function receipt(owner, requestId, expectedFingerprint) {
    if (await first('SELECT document_id FROM hwp_deletions WHERE owner = ? AND request_id = ?', [owner, requestId])) fail('REQUEST_ID_CONFLICT');
    const row = await first(`SELECT r.fingerprint, r.document_id, r.version_id,
      v.sha256, v.byte_size, x.phase AS deletion_phase FROM hwp_requests r LEFT JOIN hwp_versions v
      ON v.owner = r.owner AND v.document_id = r.document_id AND v.id = r.version_id
      LEFT JOIN hwp_deletions x ON x.owner = r.owner AND x.document_id = r.document_id
      WHERE r.owner = ? AND r.id = ?`, [owner, requestId]);
    if (row && row.fingerprint !== expectedFingerprint) fail('REQUEST_ID_CONFLICT');
    if (row?.deletion_phase) fail(row.deletion_phase === 'complete' ? 'DOCUMENT_DELETED' : 'DOCUMENT_DELETION_IN_PROGRESS');
    if (row && !row.sha256) fail('BLOB_MISSING_OR_CORRUPT');
    return row ? { document_id: row.document_id, version_id: row.version_id,
      sha256: row.sha256, byte_size: row.byte_size, saved: true, persistence: 'd1-r2', replayed: true } : null;
  }
  async function candidate(owner, documentId, input) {
    if (!(input instanceof Uint8Array) || !input.length || input.length > MAX_BYTES) fail('INVALID_BYTES_OR_LIMIT');
    const bytes = new Uint8Array(input), sha256 = await hash(bytes), version = uuid();
    // A UUID key per version means restoring identical bytes still creates a
    // NEW revision. A SHA-only current version would allow an ABA stale write.
    const key = `hwp-easy/v1/${owner}/${documentId}/${version}.hwp`;
    return { bytes, sha256, version, key, size: bytes.length, now: Date.now() };
  }
  async function writeBlob(c) {
    let result;
    try { result = await bucket.put(c.key, c.bytes, { onlyIf: { etagDoesNotMatch: '*' },
      sha256: c.sha256, httpMetadata: { contentType: 'application/x-hwp' } }); }
    catch {
      // No metadata mutation has started. This exact random key cannot be
      // referenced by another legitimate operation; clean a lost PUT ack.
      try { await bucket.delete(c.key); } catch {}
      fail('BLOB_WRITE_FAILED');
    }
    if (!result) fail('BLOB_KEY_CONFLICT'); // Never delete an existing key.
  }
  async function checkReplacement(owner, documentId, expectedVersion) {
    // One owner-scoped snapshot explains a rejected save, without revealing a
    // different owner's document or treating this check as a distributed lock.
    const state = await first(`SELECT d.current_version,
      (SELECT count(*) FROM hwp_versions v WHERE v.owner = d.owner AND v.document_id = d.id) AS version_count
      FROM hwp_documents d WHERE d.owner = ? AND d.id = ?
      AND NOT EXISTS (SELECT 1 FROM hwp_deletions x WHERE x.owner = d.owner AND x.document_id = d.id)`,
      [owner, documentId]);
    if (!state) fail('DOCUMENT_OR_VERSION_NOT_FOUND');
    if (!uuidPattern.test(state.current_version) || !Number.isSafeInteger(state.version_count)
      || state.version_count < 1) fail('BLOB_MISSING_OR_CORRUPT');
    if (state.current_version !== expectedVersion) rejectSave('VERSION_CONFLICT');
    if (state.version_count >= MAX_VERSIONS) rejectSave('DOCUMENT_VERSION_LIMIT');
  }
  async function settle(owner, requestId, expectedFingerprint, statements, c, replacement) {
    try { await db.batch(statements); }
    catch {
      // The transaction may have committed but its acknowledgement was lost.
      // NEVER delete candidate bytes or retry a different mutation here.
      try {
        const saved = await receipt(owner, requestId, expectedFingerprint);
        if (saved) return saved;
      } catch (error) {
        if (error.code === 'DOCUMENT_DELETED' || error.code === 'DOCUMENT_DELETION_IN_PROGRESS') {
          // A matching receipt proves explicit deletion won. This candidate is
          // ours; its exact key is safe to discard even if the save ack was lost.
          if (c) try { await bucket.delete(c.key); } catch {}
          throw error;
        }
        if (error.code === 'REQUEST_ID_CONFLICT') throw error;
      }
      fail('COMMIT_OUTCOME_UNKNOWN');
    }
    let saved;
    try { saved = await receipt(owner, requestId, expectedFingerprint); }
    catch (error) {
      if (error.code === 'DOCUMENT_DELETED' || error.code === 'DOCUMENT_DELETION_IN_PROGRESS') {
        if (c) try { await bucket.delete(c.key); } catch {}
        throw error;
      }
      if (error.code !== 'REQUEST_ID_CONFLICT') fail('COMMIT_OUTCOME_UNKNOWN');
      // A successful batch with a different pre-existing receipt cannot publish
      // our candidate; the guarded INSERT/UPDATE statements made no changes.
      if (c) try { await bucket.delete(c.key); } catch {}
      throw error;
    }
    if (saved) {
      if (c && saved.version_id !== c.version) try { await bucket.delete(c.key); } catch {}
      return { ...saved, replayed: !c || saved.version_id !== c.version };
    }
    // A fully acknowledged transaction without our receipt did not publish.
    if (c) try { await bucket.delete(c.key); } catch {}
    if (replacement) {
      await checkReplacement(owner, replacement.documentId, replacement.expectedVersion);
      // State may change again after rejection. Do not guess the past reason.
      rejectSave('SAVE_GUARD_REJECTED');
    }
    fail('VERSION_CONFLICT_OR_HISTORY_LIMIT');
  }
  async function prepareCreate({ owner, request_id, bytes }) {
    ownerKey(owner); id(request_id);
    const documentId = uuid(), c = await candidate(owner, documentId, bytes);
    const fp = await fingerprint(['create', c.sha256, c.size]);
    // No mutation before this handle is returned. ONLY internal synthetic
    // workflows use it to retain the exact generated scope on a lost DB ack.
    const execute = async () => {
      const existing = await receipt(owner, request_id, fp); if (existing) return existing;
      await writeBlob(c);
      const fresh = `NOT EXISTS (SELECT 1 FROM hwp_requests WHERE owner = ? AND id = ?)
        AND NOT EXISTS (SELECT 1 FROM hwp_deletions WHERE owner = ? AND request_id = ?)`;
      return settle(owner, request_id, fp, [
      statement(`INSERT INTO hwp_documents (owner,id,current_version,revision,created_at)
        SELECT ?,?,?,1,? WHERE ${fresh}`, [owner, documentId, c.version, c.now, owner, request_id, owner, request_id]),
      statement(`INSERT INTO hwp_versions (owner,document_id,id,sha256,blob_key,byte_size,created_at)
        SELECT ?,?,?,?,?,?,? WHERE EXISTS (SELECT 1 FROM hwp_documents WHERE owner = ? AND id = ?
        AND current_version = ?) AND ${fresh}`,
        [owner, documentId, c.version, c.sha256, c.key, c.size, c.now, owner, documentId, c.version, owner, request_id, owner, request_id]),
      statement(`INSERT INTO hwp_requests (owner,id,fingerprint,document_id,version_id,created_at)
        SELECT ?,?,?,?,?,? WHERE EXISTS (SELECT 1 FROM hwp_versions WHERE owner = ? AND document_id = ? AND id = ?)
        ON CONFLICT(owner,id) DO NOTHING`, [owner, request_id, fp, documentId, c.version, c.now, owner, documentId, c.version]),
      ], c);
    };
    let pending;
    return Object.freeze({ document_id: documentId, execute: () => pending ??= execute() });
  }
  async function create(args) {
    const prepared = await prepareCreate(args);
    return prepared.execute();
  }
  async function read({ owner, document_id, version_id }) {
    ownerKey(owner); id(document_id); if (version_id !== undefined) id(version_id);
    const row = await first(`SELECT v.id, v.sha256, v.blob_key, v.byte_size, d.current_version, d.revision
      FROM hwp_documents d JOIN hwp_versions v ON v.owner = d.owner AND v.document_id = d.id
      AND v.id = ${version_id ? '?' : 'd.current_version'} WHERE d.owner = ? AND d.id = ?
      AND NOT EXISTS (SELECT 1 FROM hwp_deletions x WHERE x.owner = d.owner AND x.document_id = d.id)`,
      [...(version_id ? [version_id] : []), owner, document_id]);
    if (!row) fail('DOCUMENT_OR_VERSION_NOT_FOUND');
    // A damaged metadata row must not turn this into arbitrary/cross-owner R2 access.
    if (!uuidPattern.test(row.id) || !uuidPattern.test(row.current_version)
      || !hashPattern.test(row.sha256) || !Number.isSafeInteger(row.byte_size)
      || row.byte_size < 1 || row.byte_size > MAX_BYTES
      || !Number.isSafeInteger(row.revision) || row.revision < 1
      || row.blob_key !== `hwp-easy/v1/${owner}/${document_id}/${row.id}.hwp`) fail('BLOB_MISSING_OR_CORRUPT');
    let object;
    try { object = await bucket.get(row.blob_key); } catch { fail('BLOB_READ_FAILED'); }
    if (!object || object.size !== row.byte_size || object.size > MAX_BYTES) fail('BLOB_MISSING_OR_CORRUPT');
    let bytes;
    try { bytes = new Uint8Array(await object.arrayBuffer()); } catch { fail('BLOB_READ_FAILED'); }
    if (bytes.length !== row.byte_size || await hash(bytes) !== row.sha256) fail('BLOB_MISSING_OR_CORRUPT');
    // R2 I/O and hashing can overlap an explicit deletion. Do not return bytes
    // from a document now revoked. This is not a lock or revocation of data
    // already returned to another layer/client before this final check.
    const readable = await first(`SELECT 1 AS allowed FROM hwp_documents d WHERE d.owner = ? AND d.id = ?
      AND EXISTS (SELECT 1 FROM hwp_versions v WHERE v.owner = d.owner AND v.document_id = d.id AND v.id = ?)
      AND NOT EXISTS (SELECT 1 FROM hwp_deletions x WHERE x.owner = d.owner AND x.document_id = d.id)`,
      [owner, document_id, row.id]);
    if (readable?.allowed !== 1) fail('DOCUMENT_OR_VERSION_NOT_FOUND');
    return { bytes, document_id, version_id: row.id, sha256: row.sha256,
      current_version: row.current_version, revision: row.revision, persistence: 'd1-r2' };
  }
  async function replace({ owner, document_id, expected_version, request_id, bytes, intent_sha256 }) {
    ownerKey(owner); id(document_id); id(expected_version); id(request_id);
    if (intent_sha256 !== undefined && !hashPattern.test(intent_sha256)) fail('INVALID_INTENT');
    const c = await candidate(owner, document_id, bytes);
    const fp = await fingerprint(['replace', document_id, expected_version, intent_sha256 ?? c.sha256]);
    const existing = await receipt(owner, request_id, fp); if (existing) return existing;
    // Avoid creating another private blob when deletion/staleness/history limits
    // are already known. The final batch still enforces the same guards, because
    // this preflight is NOT a distributed lock. Exact replays returned above.
    await checkReplacement(owner, document_id, expected_version);
    await writeBlob(c);
    const fresh = `NOT EXISTS (SELECT 1 FROM hwp_requests WHERE owner = ? AND id = ?)
      AND NOT EXISTS (SELECT 1 FROM hwp_deletions WHERE owner = ? AND (document_id = ? OR request_id = ?))`;
    return settle(owner, request_id, fp, [
      statement(`INSERT INTO hwp_versions (owner,document_id,id,sha256,blob_key,byte_size,created_at)
        SELECT ?,?,?,?,?,?,? WHERE EXISTS (SELECT 1 FROM hwp_documents WHERE owner = ? AND id = ?
        AND current_version = ?) AND (SELECT count(*) FROM hwp_versions WHERE owner = ? AND document_id = ?) < ?
        AND ${fresh}`, [owner, document_id, c.version, c.sha256, c.key, c.size, c.now,
          owner, document_id, expected_version, owner, document_id, MAX_VERSIONS, owner, request_id, owner, document_id, request_id]),
      statement(`UPDATE hwp_documents SET current_version = ?, revision = revision + 1 WHERE owner = ? AND id = ?
        AND current_version = ? AND EXISTS (SELECT 1 FROM hwp_versions WHERE owner = ? AND document_id = ? AND id = ?)
        AND ${fresh}`, [c.version, owner, document_id, expected_version, owner, document_id, c.version, owner, request_id, owner, document_id, request_id]),
      statement(`INSERT INTO hwp_requests (owner,id,fingerprint,document_id,version_id,created_at)
        SELECT ?,?,?,?,?,? WHERE EXISTS (SELECT 1 FROM hwp_documents WHERE owner = ? AND id = ? AND current_version = ?)
        ON CONFLICT(owner,id) DO NOTHING`, [owner, request_id, fp, document_id, c.version, c.now, owner, document_id, c.version]),
    ], c, { documentId: document_id, expectedVersion: expected_version });
  }
  async function history({ owner, document_id }) {
    ownerKey(owner); id(document_id);
    const rows = await all(`SELECT v.id AS version_id,v.sha256,v.byte_size,v.created_at,d.current_version,d.revision
      FROM hwp_versions v JOIN hwp_documents d ON d.owner = v.owner AND d.id = v.document_id
      WHERE v.owner = ? AND v.document_id = ?
      AND NOT EXISTS (SELECT 1 FROM hwp_deletions x WHERE x.owner = v.owner AND x.document_id = v.document_id)
      ORDER BY v.created_at, v.id LIMIT ?`, [owner, document_id, MAX_VERSIONS]);
    if (!rows.length) fail('DOCUMENT_OR_VERSION_NOT_FOUND');
    if (rows.some((row) => !uuidPattern.test(row.version_id) || !uuidPattern.test(row.current_version)
      || !hashPattern.test(row.sha256) || !Number.isSafeInteger(row.byte_size) || row.byte_size < 1 || row.byte_size > MAX_BYTES
      || !Number.isSafeInteger(row.revision) || row.revision < 1
      || !Number.isSafeInteger(row.created_at) || row.created_at < 0)
      || !rows.some((row) => row.version_id === rows[0].current_version)) fail('BLOB_MISSING_OR_CORRUPT');
    return rows;
  }
  async function listDocuments({ owner, before }) {
    ownerKey(owner);
    if (before !== undefined && (!before || typeof before !== 'object'
      || Object.keys(before).sort().join(',') !== 'document_id,saved_at'
      || typeof before.document_id !== 'string' || !uuidPattern.test(before.document_id) || !Number.isSafeInteger(before.saved_at)
      || before.saved_at < 0 || before.saved_at > 8640000000000000)) fail('INVALID_DOCUMENT_LIST_REQUEST');
    // Metadata only: no HWP text, blob keys, R2 reads or engine execution.
    // Current is an explicit document pointer, never MAX(version timestamp).
    const rows = await all(`SELECT d.id AS document_id, d.current_version AS version_id,
      v.created_at AS saved_at, v.byte_size, d.revision, d.display_name
      FROM hwp_documents d LEFT JOIN hwp_versions v
      ON v.owner = d.owner AND v.document_id = d.id AND v.id = d.current_version
      WHERE d.owner = ?
      AND NOT EXISTS (SELECT 1 FROM hwp_deletions x WHERE x.owner = d.owner AND x.document_id = d.id)
      ${before ? 'AND (v.created_at < ? OR (v.created_at = ? AND d.id < ?))' : ''}
      ORDER BY v.created_at DESC, d.id DESC LIMIT 21`,
      [owner, ...(before ? [before.saved_at, before.saved_at, before.document_id] : [])]);
    if (!Array.isArray(rows) || rows.length > 21 || rows.some((row) =>
      !uuidPattern.test(row.document_id) || !uuidPattern.test(row.version_id)
      || !Number.isSafeInteger(row.saved_at) || row.saved_at < 0 || row.saved_at > 8640000000000000
      || !Number.isSafeInteger(row.byte_size) || row.byte_size < 1 || row.byte_size > MAX_BYTES
      || !Number.isSafeInteger(row.revision) || row.revision < 1
      || !validDocumentName(row.display_name))) fail('BLOB_MISSING_OR_CORRUPT');
    const documents = rows.slice(0, 20), last = documents.at(-1);
    return { documents, next: rows.length > 20 ? { saved_at: last.saved_at, document_id: last.document_id } : null };
  }
  async function restore({ owner, document_id, expected_version, source_version, request_id }) {
    ownerKey(owner); id(document_id); id(expected_version); id(source_version); id(request_id);
    const intent = await fingerprint(['restore', source_version]);
    const fp = await fingerprint(['replace', document_id, expected_version, intent]);
    const existing = await receipt(owner, request_id, fp); if (existing) return existing;
    const source = await read({ owner, document_id, version_id: source_version });
    return replace({ owner, document_id, expected_version, request_id, bytes: source.bytes, intent_sha256: intent });
  }
  async function purgeSyntheticOwner(owner) {
    // Internal probe cleanup only. Never use a client-supplied production owner.
    if (typeof owner !== 'string' || !/^probe:[0-9a-f-]{36}:[ab]$/.test(owner)
      || !uuidPattern.test(owner.split(':')[1])) fail('NOT_A_SYNTHETIC_OWNER');
    const prefix = `hwp-easy/v1/${owner}/`;
    // Probe tasks have no external callers and finish mutations before cleanup.
    let cursor, count = 0;
    do {
      let page;
      try { page = await bucket.list({ prefix, limit: 1000, ...(cursor ? { cursor } : {}) }); }
      catch { fail('SYNTHETIC_CLEANUP_FAILED'); }
      if (page.objects.some((o) => !o.key.startsWith(prefix)) || (count += page.objects.length) > 4096) fail('SYNTHETIC_CLEANUP_FAILED');
      try { if (page.objects.length) await bucket.delete(page.objects.map((o) => o.key)); }
      catch { fail('SYNTHETIC_CLEANUP_FAILED'); }
      cursor = page.truncated ? page.cursor : null;
      if (page.truncated && !cursor) fail('SYNTHETIC_CLEANUP_FAILED');
    } while (cursor);
    try { await db.batch([
      statement('DELETE FROM hwp_requests WHERE owner = ?', [owner]),
      statement('DELETE FROM hwp_versions WHERE owner = ?', [owner]),
      statement('DELETE FROM hwp_documents WHERE owner = ?', [owner]),
      statement('DELETE FROM hwp_deletions WHERE owner = ?', [owner]),
    ]); } catch { fail('SYNTHETIC_CLEANUP_FAILED'); }
    return { synthetic_blobs_removed: count, cleanup_complete: true };
  }
  const deletion = createDeletionStore({ db, bucket, statement, first, all, fail, ownerKey, id });
  const names = createDocumentNames({ first, all, fail, ownerKey, id });
  return Object.freeze({ create, prepareCreate, read, replace, history, listDocuments, ...names, restore, remove: deletion.remove, purgeSyntheticOwner,
    limits: Object.freeze({ max_bytes: MAX_BYTES, max_versions_per_document: MAX_VERSIONS }) });
}
