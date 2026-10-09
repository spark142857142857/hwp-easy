import { StorageError } from './store.mjs';
/** Internal HWP service: the host supplies trusted identity, never a tool argument.
 * No upload/download route or OAuth fallback is enabled by this module.
 */
export function createDocumentService(engine, store) {
  async function prepareCreate({ owner, request_id, bytes }) {
    const copied = bytes instanceof Uint8Array ? bytes.slice() : bytes;
    await engine.open(copied);
    return store.prepareCreate({ owner, request_id, bytes: copied });
  }
  async function create({ owner, request_id, bytes }) {
    const copied = bytes instanceof Uint8Array ? bytes.slice() : bytes;
    await engine.open(copied); // Validate HWP before the first blob/metadata mutation.
    return store.create({ owner, request_id, bytes: copied });
  }
  async function open({ owner, document_id, version_id }) {
    const saved = await store.read({ owner, document_id, version_id });
    const snapshot = await engine.open(saved.bytes);
    if (snapshot.source_sha256 !== saved.sha256) throw new Error('STORAGE_CONTENT_MISMATCH');
    const { bytes, ...metadata } = saved;
    return { metadata, snapshot };
  }
  async function read({ owner, document_id, version_id, options = {} }) {
    const { bytes, ...metadata } = await store.read({ owner, document_id, version_id });
    const snapshot = await engine.openRead(bytes, { owner, document_id, version_id: metadata.version_id }, metadata.sha256);
    const result = snapshot.read({ expected_sha256: metadata.sha256, ...options });
    // Hashing, source inspection and cache access can overlap deletion. Recheck
    // this immutable stored version before returning materialized document text.
    try {
      const history = await store.history({ owner, document_id });
      if (!history.some((v) => v.version_id === metadata.version_id && v.sha256 === metadata.sha256)) {
        throw new StorageError('DOCUMENT_OR_VERSION_NOT_FOUND');
      }
    } catch (error) { engine.forgetReads({ owner, document_id }); throw error; }
    return { ...result, storage: metadata };
  }
  async function edit({ owner, document_id, expected_version, request_id, request }) {
    try { request = structuredClone(request); } catch { throw new StorageError('INVALID_REQUEST'); }
    // Immutable expected version allows exact-request replay even after later edits.
    const savedSource = await store.read({ owner, document_id, version_id: expected_version });
    // Fresh source inspection and request validation share the mutation session;
    // the serialized result is still independently reopened and raw-checked.
    const output = await engine.edit(savedSource.bytes, request, savedSource.sha256);
    const canonical = ['edit', request.expected_sha256,
      request.operations.map((op) => [op.target_id, op.expected_old, op.new_text])];
    const intent_sha256 = [...new Uint8Array(await crypto.subtle.digest('SHA-256',
      new TextEncoder().encode(JSON.stringify(canonical))))].map((n) => n.toString(16).padStart(2, '0')).join('');
    const saved = await store.replace({ owner, document_id, expected_version, request_id,
      bytes: output.bytes, intent_sha256 });
    return { ...saved, content_verified: output.content_verified,
      raw_preservation_verified: output.raw_preservation_verified,
      ...(output.pagination_diagnostic ? { pagination_diagnostic: output.pagination_diagnostic } : {}),
      layout_verified: false };
  }
  async function preflight({ owner, document_id, version_id, request }) {
    try { request = structuredClone(request); } catch { throw new StorageError('INVALID_REQUEST'); }
    const { bytes, ...metadata } = await store.read({ owner, document_id, version_id });
    const result = await engine.preflight(bytes, request, metadata.sha256);
    return { ...result, storage: metadata, stale_for_save: metadata.version_id !== metadata.current_version };
  }
  async function restore(args) {
    args = { ...args };
    await open({ owner: args.owner, document_id: args.document_id, version_id: args.source_version });
    return store.restore(args);
  }
  async function remove(args) {
    engine.forgetReads(args);
    try { return await store.remove(args); }
    finally { engine.forgetReads(args); }
  }
  return Object.freeze({ create, prepareCreate, open, read, edit, preflight, restore, remove, history: store.history });
}
