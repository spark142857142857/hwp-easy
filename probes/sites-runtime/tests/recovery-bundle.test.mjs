import assert from 'node:assert/strict';
import test from 'node:test';
import { createHash } from 'node:crypto';
import { createRecoveryBundle, readRecoveryBundle, RecoveryBundleError, recoveryBundleLimits } from '../scripts/recovery-bundle.mjs';
import { recoveryLimits } from '../scripts/recovery-audit.mjs';

const uuid = () => crypto.randomUUID();
const sha = bytes => createHash('sha256').update(bytes).digest('hex');
const rejected = code => error => error.code === code && error.message === code;
function fixture() {
  const owner = 'synthetic:bundle', document = uuid(), deletedDocument = uuid(), keys = new Map();
  const versions = [], requests = [];
  for (let i = 0; i < 2; i++) {
    const id = uuid(), blob_key = `hwp-easy/v1/${owner}/${document}/${id}.hwp`, bytes = Uint8Array.from([1, 2, i]);
    keys.set(blob_key, bytes);
    versions.push({ owner, document_id: document, id, sha256: sha(bytes), blob_key, byte_size: bytes.length, created_at: 1 });
    requests.push({ owner, id: uuid(), document_id: document, version_id: id, fingerprint: 'a'.repeat(64), created_at: 1 });
  }
  const deletion = { owner, document_id: deletedDocument, request_id: uuid(), expected_version: uuid(),
    phase: 'complete', version_count: 1, created_at: 1, completed_at: 2 };
  requests.push({ owner, id: uuid(), document_id: deletedDocument, version_id: deletion.expected_version,
    fingerprint: 'b'.repeat(64), created_at: 1 });
  const snapshot = { format: 'hwp-easy-recovery-v1', tables: {
    hwp_documents: [{ owner, id: document, current_version: versions.at(-1).id, revision: 2,
      created_at: 1, display_name: 'PRIVATE_NAME_한글😀', name_revision: 1 }],
    hwp_versions: versions, hwp_requests: requests, hwp_deletions: [deletion] } };
  return { snapshot, latestDeletions: [structuredClone(deletion)], keys };
}
const pack = f => createRecoveryBundle(f.snapshot, { latestDeletions: f.latestDeletions, readBlob: async key => f.keys.get(key) });
function seal(bytes) {
  createHash('sha256').update(bytes.subarray(0, -32)).digest().copy(bytes, bytes.length - 32); return bytes;
}
function changeMetadata(bytes, mutate) {
  const length = bytes.readUInt32BE(8), metadata = JSON.parse(bytes.subarray(16, 16 + length).toString('utf8'));
  mutate(metadata);
  const next = Buffer.from(JSON.stringify(metadata)), header = Buffer.from(bytes.subarray(0, 16));
  header.writeUInt32BE(next.length, 8);
  return seal(Buffer.concat([header, next, bytes.subarray(16 + length, -32), Buffer.alloc(32)]));
}

test('bundle retains metadata, names, receipts, deletion guards and every recorded byte', async () => {
  const f = fixture(), before = structuredClone(f.snapshot), packed = await pack(f);
  const restored = await readRecoveryBundle(packed.bytes, { latestDeletions: f.latestDeletions });
  assert.deepEqual(restored.snapshot, before); assert.deepEqual(f.snapshot, before);
  for (const [key, bytes] of f.keys) assert.deepEqual(await restored.readBlob(key), bytes);
  assert.equal(restored.proof.versions, 2); assert.equal(restored.proof.deleted_request_receipts, 1);
  assert.equal(restored.proof.bundle_checksum_verified, true);
  for (const field of ['restored','bundle_authenticated','bundle_encrypted','hwp_format_verified',
    'snapshot_provenance_verified','latest_deletion_ledger_freshness_verified','platform_backup_restore_verified'])
    assert.equal(restored.proof[field], false, field);
  assert(!JSON.stringify(restored.proof).includes('PRIVATE_NAME'));
  assert.equal(await restored.readBlob('unrelated/path'), undefined);
});
test('caller changes during asynchronous capture cannot change packaged metadata or already captured blobs', async () => {
  const f = fixture(), before = structuredClone(f.snapshot);
  const expected = new Map([...f.keys].map(([key, bytes]) => [key, bytes.slice()]));
  let calls = 0, previous;
  const packed = await createRecoveryBundle(f.snapshot, { latestDeletions: f.latestDeletions, readBlob: async key => {
    calls++;
    f.snapshot.tables.hwp_documents[0].display_name = 'CHANGED_AFTER_START';
    f.latestDeletions[0].completed_at = 100;
    if (previous) previous.fill(99);
    previous = f.keys.get(key); return previous;
  } });
  const restored = await readRecoveryBundle(packed.bytes, { latestDeletions: before.tables.hwp_deletions });
  assert.equal(calls, 2); assert.deepEqual(restored.snapshot, before);
  for (const [key, bytes] of expected) assert.deepEqual(await restored.readBlob(key), bytes);
});
test('decoded bytes are private copies even for Buffer inputs and later caller mutation', async () => {
  const f = fixture(), { bytes } = await pack(f), copy = Buffer.from(bytes);
  const restored = await readRecoveryBundle(copy, { latestDeletions: f.latestDeletions });
  copy.fill(0);
  const [key, expected] = f.keys.entries().next().value;
  const first = await restored.readBlob(key); first.fill(77);
  assert.deepEqual(await restored.readBlob(key), expected);
});
test('absent, newer or pending external deletion ledger cannot be replaced by the archived ledger', async () => {
  const f = fixture(), { bytes } = await pack(f);
  await assert.rejects(() => readRecoveryBundle(bytes), rejected('INVALID_RECOVERY_SNAPSHOT'));
  const changed = structuredClone(f.latestDeletions); changed[0].completed_at++;
  await assert.rejects(() => readRecoveryBundle(bytes, { latestDeletions: changed }), rejected('RECOVERY_DELETION_LEDGER_MISMATCH'));
  const pending = structuredClone(f.latestDeletions); pending[0].phase = 'pending'; pending[0].completed_at = null;
  await assert.rejects(() => readRecoveryBundle(bytes, { latestDeletions: pending }), rejected('RECOVERY_DELETION_PENDING'));
});
test('byte corruption, truncation, missing entries and extra payload never become valid backups', async () => {
  const f = fixture(), { bytes } = await pack(f);
  const corrupt = Buffer.from(bytes); corrupt[20] ^= 1;
  await assert.rejects(() => readRecoveryBundle(corrupt, { latestDeletions: f.latestDeletions }), rejected('RECOVERY_BUNDLE_CORRUPT'));
  for (const length of [0, 15, 47, bytes.length - 1])
    await assert.rejects(() => readRecoveryBundle(bytes.subarray(0, length), { latestDeletions: f.latestDeletions }), error => error instanceof RecoveryBundleError);
  const extra = seal(Buffer.concat([bytes.subarray(0, -32), Buffer.from([1]), Buffer.alloc(32)]));
  await assert.rejects(() => readRecoveryBundle(extra, { latestDeletions: f.latestDeletions }), rejected('INVALID_RECOVERY_BUNDLE'));
  const fewer = Buffer.from(bytes); fewer.writeUInt32BE(1, 12); seal(fewer);
  await assert.rejects(() => readRecoveryBundle(fewer, { latestDeletions: f.latestDeletions }), rejected('INVALID_RECOVERY_BUNDLE'));
});
test('a recomputed checksum cannot bypass byte hashes, metadata ownership or deleted request receipts', async () => {
  const f = fixture(), { bytes } = await pack(f);
  const corruptBlob = Buffer.from(bytes), blobStart = 16 + bytes.readUInt32BE(8) + 36;
  corruptBlob[blobStart] ^= 1; seal(corruptBlob);
  await assert.rejects(() => readRecoveryBundle(corruptBlob, { latestDeletions: f.latestDeletions }), rejected('RECOVERY_BUNDLE_CORRUPT'));
  const wrongPath = changeMetadata(bytes, snapshot => { snapshot.tables.hwp_versions[0].blob_key = '../../PRIVATE_PATH'; });
  await assert.rejects(() => readRecoveryBundle(wrongPath, { latestDeletions: f.latestDeletions }), rejected('RECOVERY_METADATA_INCONSISTENT'));
  const noDeletedReceipt = changeMetadata(bytes, snapshot => { snapshot.tables.hwp_requests.pop(); });
  await assert.rejects(() => readRecoveryBundle(noDeletedReceipt, { latestDeletions: f.latestDeletions }), rejected('RECOVERY_METADATA_INCONSISTENT'));
});
test('format, count, byte and metadata budgets reject oversized values before accepting a bundle', async () => {
  const f = fixture(), { bytes } = await pack(f);
  for (const [at, value] of [[8,recoveryBundleLimits.max_metadata_bytes+1],[12,recoveryBundleLimits.max_blob_count+1]]) {
    const large = Buffer.from(bytes); large.writeUInt32BE(value, at); seal(large);
    await assert.rejects(() => readRecoveryBundle(large, { latestDeletions: f.latestDeletions }), rejected('RECOVERY_BUNDLE_LIMIT_EXCEEDED'));
  }
  const largeBlob = Buffer.from(bytes); largeBlob.writeUInt32BE(recoveryLimits.max_blob_bytes+1, 16 + bytes.readUInt32BE(8) + 32); seal(largeBlob);
  await assert.rejects(() => readRecoveryBundle(largeBlob, { latestDeletions: f.latestDeletions }), rejected('RECOVERY_BUNDLE_LIMIT_EXCEEDED'));
  const oversizedMetadata = fixture(); oversizedMetadata.snapshot.tables.hwp_documents[0].display_name = 'x'.repeat(recoveryLimits.max_metadata_utf16_units+1);
  let calls = 0;
  await assert.rejects(() => createRecoveryBundle(oversizedMetadata.snapshot, { latestDeletions: [], readBlob: async () => { calls++; } }), rejected('RECOVERY_LIMIT_EXCEEDED'));
  assert.equal(calls, 0);
});
test('invalid UTF-8 and JSON never disclose parser messages or private metadata', async () => {
  const f = fixture(), { bytes } = await pack(f), invalidUtf8 = Buffer.from(bytes), invalidJson = Buffer.from(bytes);
  invalidUtf8[16] = 255; seal(invalidUtf8); invalidJson[16] = 33; seal(invalidJson);
  for (const corrupt of [invalidUtf8, invalidJson])
    await assert.rejects(() => readRecoveryBundle(corrupt, { latestDeletions: f.latestDeletions }), rejected('INVALID_RECOVERY_BUNDLE'));
});
