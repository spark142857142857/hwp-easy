// User-entered metadata only. Never derive a name from HWP text or filenames.
export function validDocumentName(value) {
  return typeof value === 'string' && value === value.trim() && [...value].length <= 80
    && !/[\p{Cc}\p{Cf}\p{Cs}]/u.test(value);
}
export function createDocumentNames({ first, all, fail, ownerKey, id }) {
  const live = `NOT EXISTS (SELECT 1 FROM hwp_deletions x WHERE x.owner = hwp_documents.owner AND x.document_id = hwp_documents.id)
    AND EXISTS (SELECT 1 FROM hwp_versions v WHERE v.owner = hwp_documents.owner AND v.document_id = hwp_documents.id AND v.id = hwp_documents.current_version)`;
  const checked = row => {
    if (!row) fail('DOCUMENT_OR_VERSION_NOT_FOUND');
    if (!validDocumentName(row.display_name) || !Number.isSafeInteger(row.name_revision) || row.name_revision < 0) fail('BLOB_MISSING_OR_CORRUPT');
    id(row.current_version);
    return row;
  };
  async function documentName({ owner, document_id }) {
    ownerKey(owner); id(document_id);
    return checked(await first(`SELECT display_name, name_revision, current_version FROM hwp_documents WHERE owner = ? AND id = ? AND ${live}`, [owner, document_id]));
  }
  async function renameDocument({ owner, document_id, display_name, expected_name_revision }) {
    ownerKey(owner); id(document_id);
    if (!validDocumentName(display_name) || !Number.isSafeInteger(expected_name_revision)
      || expected_name_revision < 0 || expected_name_revision >= Number.MAX_SAFE_INTEGER) fail('INVALID_DOCUMENT_NAME');
    const current = await documentName({ owner, document_id });
    // Exact acknowledgement retry only; a changed-and-restored name has a new
    // revision, so an old form cannot silently overwrite concurrent changes.
    const replay = row => row.name_revision === expected_name_revision + 1 && row.display_name === display_name;
    if (replay(current)) return { ...current, replayed: true };
    if (current.name_revision !== expected_name_revision) fail('DOCUMENT_NAME_CONFLICT');
    if (current.display_name === display_name) return { ...current, replayed:false, unchanged:true };
    let rows;
    try {
      rows = await all(`UPDATE hwp_documents SET display_name = ?, name_revision = name_revision + 1
        WHERE owner = ? AND id = ? AND name_revision = ? AND ${live}
        RETURNING display_name, name_revision, current_version`, [display_name, owner, document_id, expected_name_revision]);
    } catch {
      // A lost update acknowledgement may have committed. Read-only resolution
      // never changes the name, HWP, requests or version pointer a second time.
      try { const after = await documentName({ owner, document_id }); if (replay(after)) return { ...after, replayed: true }; } catch {}
      fail('DOCUMENT_NAME_OUTCOME_UNKNOWN');
    }
    const after = await documentName({ owner, document_id });
    if (rows.length !== 1 || !replay(after)) fail('DOCUMENT_NAME_CONFLICT');
    return { ...checked(rows[0]), replayed: false };
  }
  return { documentName, renameDocument };
}
