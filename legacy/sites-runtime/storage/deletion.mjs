// Explicit deletion of one authenticated document. No timers or user-selected keys.
export function createDeletionStore({ db, bucket, statement, first, all, fail, ownerKey, id }) {
  const report = (row, replayed) => ({ document_id: row.document_id, deleted: true, replayed,
    document_access_revoked: true, recorded_versions_removed: row.version_count,
    irreversible: true, scope: 'logical_document_and_recorded_versions',
    unpublished_blob_gc_verified: false, in_flight_writer_gc_verified: false });
  function validate(row, args) {
    if (!row || row.document_id !== args.document_id || row.expected_version !== args.expected_version) fail('REQUEST_ID_CONFLICT');
    if (!['pending', 'complete'].includes(row.phase) || !Number.isSafeInteger(row.version_count)
      || row.version_count < 1 || row.version_count > 128) fail('DELETION_RECEIPT_CORRUPT');
    return row;
  }
  const receipt = (owner, requestId) => first('SELECT * FROM hwp_deletions WHERE owner = ? AND request_id = ?', [owner, requestId]);
  async function remove(args) {
    const { owner, document_id, expected_version, request_id } = args;
    ownerKey(owner); id(document_id); id(expected_version); id(request_id);
    let row = await receipt(owner, request_id), replayed = !!row;
    if (!row) {
      if (await first('SELECT id FROM hwp_requests WHERE owner = ? AND id = ?', [owner, request_id])) fail('REQUEST_ID_CONFLICT');
      let unknown = false;
      try {
        await db.batch([statement(`INSERT INTO hwp_deletions
          (owner,document_id,request_id,expected_version,phase,version_count,created_at)
          SELECT ?,?,?,?,'pending',(SELECT count(*) FROM hwp_versions WHERE owner = ? AND document_id = ?),?
          WHERE EXISTS (SELECT 1 FROM hwp_documents WHERE owner = ? AND id = ? AND current_version = ?)
          AND NOT EXISTS (SELECT 1 FROM hwp_requests WHERE owner = ? AND id = ?)
          ON CONFLICT DO NOTHING`, [owner, document_id, request_id, expected_version, owner, document_id,
          Date.now(), owner, document_id, expected_version, owner, request_id])]);
      } catch { unknown = true; }
      try { row = await receipt(owner, request_id); }
      catch { fail('DELETE_OUTCOME_UNKNOWN'); }
      if (!row) {
        if (unknown) fail('DELETE_OUTCOME_UNKNOWN');
        const locked = await first('SELECT phase FROM hwp_deletions WHERE owner = ? AND document_id = ?', [owner, document_id]);
        if (locked) fail(locked.phase === 'complete' ? 'DOCUMENT_DELETED' : 'DOCUMENT_DELETION_IN_PROGRESS');
        const current = await first('SELECT current_version FROM hwp_documents WHERE owner = ? AND id = ?', [owner, document_id]);
        fail(current ? 'VERSION_CONFLICT' : 'DOCUMENT_OR_VERSION_NOT_FOUND');
      }
    }
    validate(row, args);
    if (row.phase === 'complete') return report(row, true);
    // Verify EVERY stored key before deleting ANY. Corrupt metadata must never
    // expand an explicit document deletion into another document's R2 area.
    const versions = await all('SELECT id,blob_key FROM hwp_versions WHERE owner = ? AND document_id = ?', [owner, document_id]);
    if (versions.length !== row.version_count || !versions.some((v) => v.id === expected_version)) {
      const concurrent = validate(await receipt(owner, request_id), args);
      if (concurrent.phase === 'complete') return report(concurrent, true);
      fail('DELETION_METADATA_CORRUPT');
    }
    for (const v of versions) {
      try { id(v.id); } catch { fail('DELETION_METADATA_CORRUPT'); }
      if (v.blob_key !== `hwp-easy/v1/${owner}/${document_id}/${v.id}.hwp`) fail('DELETION_METADATA_CORRUPT');
    }
    try { await bucket.delete(versions.map((v) => v.blob_key)); }
    catch { fail('DELETE_INCOMPLETE_RETRY_SAME_REQUEST'); }
    try {
      await db.batch([
        statement('DELETE FROM hwp_versions WHERE owner = ? AND document_id = ?', [owner, document_id]),
        statement('DELETE FROM hwp_documents WHERE owner = ? AND id = ? AND current_version = ?', [owner, document_id, expected_version]),
        statement(`UPDATE hwp_deletions SET phase = 'complete', completed_at = ? WHERE owner = ? AND document_id = ?
          AND request_id = ? AND NOT EXISTS (SELECT 1 FROM hwp_documents WHERE owner = ? AND id = ?)
          AND NOT EXISTS (SELECT 1 FROM hwp_versions WHERE owner = ? AND document_id = ?)`,
        [Date.now(), owner, document_id, request_id, owner, document_id, owner, document_id]),
      ]);
    } catch { /* Reconcile the exact tombstone before reporting completion. */ }
    try { row = validate(await receipt(owner, request_id), args); }
    catch { fail('DELETE_OUTCOME_UNKNOWN'); }
    if (row.phase !== 'complete') fail('DELETE_INCOMPLETE_RETRY_SAME_REQUEST');
    return report(row, replayed);
  }
  return Object.freeze({ remove });
}
