/** Internal durable D1/R2 store. The host supplies an authenticated owner key.
 * No HTTP routes, filename paths, auth fallbacks or arbitrary blob-key access.
 * HWP validation belongs to the service layer BEFORE mutation.
 */
export class StorageError extends Error {
  constructor(code) { super(code); this.name = 'StorageError'; this.code = code; }
}
const fail = (code) => { throw new StorageError(code); };
const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const hashPattern = /^[0-9a-f]{64}$/;
const MAX_BYTES = 4 * 1024 * 1024, MAX_VERSIONS = 128;
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
    const row = await first(`SELECT r.fingerprint, r.document_id, r.version_id,
      v.sha256, v.byte_size FROM hwp_requests r JOIN hwp_versions v
      ON v.owner = r.owner AND v.document_id = r.document_id AND v.id = r.version_id
      WHERE r.owner = ? AND r.id = ?`, [owner, requestId]);
    if (row && row.fingerprint !== expectedFingerprint) fail('REQUEST_ID_CONFLICT');
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
  async function settle(owner, requestId, expectedFingerprint, statements, c) {
    try { await db.batch(statements); }
    catch {
      // The transaction may have committed but its acknowledgement was lost.
      // NEVER delete candidate bytes or retry a different mutation here.
      try {
        const saved = await receipt(owner, requestId, expectedFingerprint);
        if (saved) return saved;
      } catch (error) { if (error.code === 'REQUEST_ID_CONFLICT') throw error; }
      fail('COMMIT_OUTCOME_UNKNOWN');
    }
    let saved;
    try { saved = await receipt(owner, requestId, expectedFingerprint); }
    catch (error) {
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
    fail('VERSION_CONFLICT_OR_HISTORY_LIMIT');
  }
  async function create({ owner, request_id, bytes }) {
    ownerKey(owner); id(request_id);
    const documentId = uuid(), c = await candidate(owner, documentId, bytes);
    const fp = await fingerprint(['create', c.sha256, c.size]);
    const existing = await receipt(owner, request_id, fp); if (existing) return existing;
    await writeBlob(c);
    const fresh = `NOT EXISTS (SELECT 1 FROM hwp_requests WHERE owner = ? AND id = ?)`;
    return settle(owner, request_id, fp, [
      statement(`INSERT INTO hwp_documents (owner,id,current_version,revision,created_at)
        SELECT ?,?,?,1,? WHERE ${fresh}`, [owner, documentId, c.version, c.now, owner, request_id]),
      statement(`INSERT INTO hwp_versions (owner,document_id,id,sha256,blob_key,byte_size,created_at)
        SELECT ?,?,?,?,?,?,? WHERE EXISTS (SELECT 1 FROM hwp_documents WHERE owner = ? AND id = ?
        AND current_version = ?) AND ${fresh}`,
        [owner, documentId, c.version, c.sha256, c.key, c.size, c.now, owner, documentId, c.version, owner, request_id]),
      statement(`INSERT INTO hwp_requests (owner,id,fingerprint,document_id,version_id,created_at)
        SELECT ?,?,?,?,?,? WHERE EXISTS (SELECT 1 FROM hwp_versions WHERE owner = ? AND document_id = ? AND id = ?)
        ON CONFLICT(owner,id) DO NOTHING`, [owner, request_id, fp, documentId, c.version, c.now, owner, documentId, c.version]),
    ], c);
  }
  async function read({ owner, document_id, version_id }) {
    ownerKey(owner); id(document_id); if (version_id !== undefined) id(version_id);
    const row = await first(`SELECT v.id, v.sha256, v.blob_key, v.byte_size, d.current_version, d.revision
      FROM hwp_documents d JOIN hwp_versions v ON v.owner = d.owner AND v.document_id = d.id
      AND v.id = ${version_id ? '?' : 'd.current_version'} WHERE d.owner = ? AND d.id = ?`,
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
    return { bytes, document_id, version_id: row.id, sha256: row.sha256,
      current_version: row.current_version, revision: row.revision, persistence: 'd1-r2' };
  }
  async function replace({ owner, document_id, expected_version, request_id, bytes, intent_sha256 }) {
    ownerKey(owner); id(document_id); id(expected_version); id(request_id);
    if (intent_sha256 !== undefined && !hashPattern.test(intent_sha256)) fail('INVALID_INTENT');
    const c = await candidate(owner, document_id, bytes);
    const fp = await fingerprint(['replace', document_id, expected_version, intent_sha256 ?? c.sha256]);
    const existing = await receipt(owner, request_id, fp); if (existing) return existing;
    await writeBlob(c);
    const fresh = `NOT EXISTS (SELECT 1 FROM hwp_requests WHERE owner = ? AND id = ?)`;
    return settle(owner, request_id, fp, [
      statement(`INSERT INTO hwp_versions (owner,document_id,id,sha256,blob_key,byte_size,created_at)
        SELECT ?,?,?,?,?,?,? WHERE EXISTS (SELECT 1 FROM hwp_documents WHERE owner = ? AND id = ?
        AND current_version = ?) AND (SELECT count(*) FROM hwp_versions WHERE owner = ? AND document_id = ?) < ?
        AND ${fresh}`, [owner, document_id, c.version, c.sha256, c.key, c.size, c.now,
          owner, document_id, expected_version, owner, document_id, MAX_VERSIONS, owner, request_id]),
      statement(`UPDATE hwp_documents SET current_version = ?, revision = revision + 1 WHERE owner = ? AND id = ?
        AND current_version = ? AND EXISTS (SELECT 1 FROM hwp_versions WHERE owner = ? AND document_id = ? AND id = ?)
        AND ${fresh}`, [c.version, owner, document_id, expected_version, owner, document_id, c.version, owner, request_id]),
      statement(`INSERT INTO hwp_requests (owner,id,fingerprint,document_id,version_id,created_at)
        SELECT ?,?,?,?,?,? WHERE EXISTS (SELECT 1 FROM hwp_documents WHERE owner = ? AND id = ? AND current_version = ?)
        ON CONFLICT(owner,id) DO NOTHING`, [owner, request_id, fp, document_id, c.version, c.now, owner, document_id, c.version]),
    ], c);
  }
  async function history({ owner, document_id }) {
    ownerKey(owner); id(document_id);
    const rows = await all(`SELECT v.id AS version_id,v.sha256,v.byte_size,v.created_at
      FROM hwp_versions v JOIN hwp_documents d ON d.owner = v.owner AND d.id = v.document_id
      WHERE v.owner = ? AND v.document_id = ? ORDER BY v.created_at, v.id LIMIT ?`, [owner, document_id, MAX_VERSIONS]);
    if (!rows.length) fail('DOCUMENT_OR_VERSION_NOT_FOUND');
    return rows;
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
    ]); } catch { fail('SYNTHETIC_CLEANUP_FAILED'); }
    return { synthetic_blobs_removed: count, cleanup_complete: true };
  }
  return Object.freeze({ create, read, replace, history, restore, purgeSyntheticOwner,
    limits: Object.freeze({ max_bytes: MAX_BYTES, max_versions_per_document: MAX_VERSIONS }) });
}
