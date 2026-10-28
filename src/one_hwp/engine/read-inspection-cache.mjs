/** Private process memory for already inspected read models, never authority,
 * HWP source bytes, raw streams, live WASM objects or edit results. Serialized
 * byte accounting is NOT a bound or measurement of total JS/WASM isolate RAM.
 */
export function createReadInspectionCache({ maxEntries = 2, maxBytes = 8 * 1024 * 1024,
  ttlMs = 5 * 60 * 1000, now = Date.now } = {}) {
  if (!Number.isSafeInteger(maxEntries) || maxEntries < 1 || maxEntries > 2
    || !Number.isSafeInteger(maxBytes) || maxBytes < 1 || maxBytes > 8 * 1024 * 1024
    || !Number.isSafeInteger(ttlMs) || ttlMs < 1 || ttlMs > 5 * 60 * 1000 || typeof now !== 'function') {
    throw Error('Invalid read cache policy');
  }
  const entries = new Map(); let serializedBytes = 0, hits = 0, misses = 0, evictions = 0;
  const key = (scope, hash) => scope && ['owner', 'document_id', 'version_id'].every((name) =>
    typeof scope[name] === 'string' && scope[name].length > 0 && scope[name].length <= 256)
    && /^[0-9a-f]{64}$/.test(hash)
    ? JSON.stringify([scope.owner, scope.document_id, scope.version_id, hash]) : null;
  const remove = (id) => {
    const entry = entries.get(id); if (!entry) return;
    serializedBytes -= entry.bytes.length; entry.bytes.fill(0); entries.delete(id); evictions++;
  };
  const expire = () => { const time = now(); for (const [id, row] of entries) if (time >= row.expires) remove(id); };
  function get(Type, scope, hash) {
    expire(); const id = key(scope, hash), row = id === null ? null : entries.get(id);
    if (!row || row.Type !== Type) { misses++; return null; }
    // Always detach on a hit. Callers cannot poison another response or edit's
    // authoritative model. Access does not extend the absolute expiration.
    const inspection = JSON.parse(new TextDecoder().decode(row.bytes));
    entries.delete(id); entries.set(id, row); hits++;
    return inspection;
  }
  function put(Type, scope, hash, inspection) {
    expire(); const id = key(scope, hash); if (id === null) return false;
    const json = JSON.stringify(inspection);
    if (json.length > maxBytes) return false;
    const bytes = new TextEncoder().encode(json);
    if (bytes.length > maxBytes) return false;
    remove(id);
    while (entries.size >= maxEntries || serializedBytes + bytes.length > maxBytes) remove(entries.keys().next().value);
    entries.set(id, { Type, owner: scope.owner, document: scope.document_id, bytes, expires: now() + ttlMs });
    serializedBytes += bytes.length;
    return true;
  }
  function invalidate({ owner, document_id } = {}) {
    for (const [id, row] of entries) if (row.owner === owner && row.document === document_id) remove(id);
  }
  return Object.freeze({ get, put, invalidate, stats() { expire(); return {
    entries: entries.size, serialized_bytes: serializedBytes, hits, misses, evictions,
    max_entries: maxEntries, max_serialized_bytes: maxBytes, absolute_ttl_ms: ttlMs,
  }; } });
}
