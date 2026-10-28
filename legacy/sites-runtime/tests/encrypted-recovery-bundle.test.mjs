import assert from 'node:assert/strict';
import test from 'node:test';
import { createCipheriv, createDecipheriv, createHash, randomBytes } from 'node:crypto';
import { createEncryptedRecoveryBundle, readEncryptedRecoveryBundle,
  EncryptedRecoveryBundleError, encryptedRecoveryBundleLimits } from '../scripts/encrypted-recovery-bundle.mjs';
import { createRecoveryBundle, readRecoveryBundle } from '../scripts/recovery-bundle.mjs';

const code = expected => error => error.code === expected && error.message === expected;
function fixture() {
  const owner = 'synthetic:encrypted', document = crypto.randomUUID(), version = crypto.randomUUID();
  const blob_key = `hwp-easy/v1/${owner}/${document}/${version}.hwp`;
  const blob = Buffer.from('SYNTHETIC_PRIVATE_BODY_한글😀');
  const snapshot = { format: 'hwp-easy-recovery-v1', tables: {
    hwp_documents: [{ owner, id: document, current_version: version, revision: 1,
      created_at: 1, display_name: 'SYNTHETIC_PRIVATE_NAME', name_revision: 1 }],
    hwp_versions: [{ owner, document_id: document, id: version, blob_key,
      sha256: createHash('sha256').update(blob).digest('hex'), byte_size: blob.length, created_at: 1 }],
    hwp_requests: [{ owner, id: crypto.randomUUID(), document_id: document, version_id: version,
      fingerprint: 'a'.repeat(64), created_at: 1 }], hwp_deletions: [] } };
  return { snapshot, encryptionKey: randomBytes(32), latestDeletions: [], readBlob: async key => key === blob_key ? blob : undefined, blob, blob_key };
}
const pack = f => createEncryptedRecoveryBundle(f.snapshot, f);
// Independent format consumer/producer: test the public binary contract with
// Node's primitive, without calling the wrapper's decryption/encryption path.
function decode(bytes, key) {
  const decipher = createDecipheriv('aes-256-gcm', key, bytes.subarray(12, 24), { authTagLength: 16 });
  decipher.setAAD(bytes.subarray(0, 24)); decipher.setAuthTag(bytes.subarray(-16));
  return Buffer.concat([decipher.update(bytes.subarray(24, -16)), decipher.final()]);
}
function encode(plaintext, key) {
  const header = Buffer.alloc(24); header.write('HWPEEN01'); header.writeUInt32BE(plaintext.length, 8);
  randomBytes(12).copy(header, 12);
  const cipher = createCipheriv('aes-256-gcm', key, header.subarray(12), { authTagLength: 16 });
  cipher.setAAD(header);
  return Buffer.concat([header, cipher.update(plaintext), cipher.final(), cipher.getAuthTag()]);
}

test('encrypted file hides names, keys and content and preserves audited data with independently decoded framing', async () => {
  const f = fixture(), before = structuredClone(f.snapshot), keyBefore = Buffer.from(f.encryptionKey), packed = await pack(f);
  assert.equal(packed.bytes.subarray(0, 8).toString('ascii'), 'HWPEEN01');
  assert.equal(packed.bytes.readUInt32BE(8), packed.bytes.length - 40);
  for (const marker of ['SYNTHETIC_PRIVATE_NAME', 'SYNTHETIC_PRIVATE_BODY', f.blob_key])
    assert.equal(packed.bytes.includes(Buffer.from(marker)), false);
  const plaintext = decode(packed.bytes, f.encryptionKey);
  const independent = await readRecoveryBundle(plaintext, f);
  assert.deepEqual(independent.snapshot, before);
  const opened = await readEncryptedRecoveryBundle(packed.bytes, f);
  assert.deepEqual(opened.snapshot, before); assert.deepEqual(f.snapshot, before);
  assert.deepEqual(Buffer.from(await opened.readBlob(f.blob_key)), f.blob);
  assert.deepEqual(f.encryptionKey, keyBefore);
  assert.equal(opened.proof.bundle_encrypted, true); assert.equal(opened.proof.bundle_authenticated, true);
  assert.equal(opened.proof.authentication_verified_on_read, true);
  assert.equal(packed.proof.authentication_verified_on_read, false);
  for (const field of ['snapshot_provenance_verified', 'latest_deletion_ledger_freshness_verified',
    'platform_backup_restore_verified', 'encryption_key_custody_verified', 'hwp_format_verified', 'restored'])
    assert.equal(opened.proof[field], false, field);
  assert.equal(JSON.stringify(opened.proof).includes('PRIVATE'), false);
});
test('two captures use distinct internally generated nonces and cannot silently accept another key', async () => {
  const f = fixture(), a = await pack(f), b = await pack(f);
  assert.notDeepEqual(a.bytes.subarray(12, 24), b.bytes.subarray(12, 24));
  assert.notDeepEqual(a.bytes, b.bytes);
  await assert.rejects(() => readEncryptedRecoveryBundle(a.bytes, { ...f, encryptionKey: randomBytes(32) }),
    code('ENCRYPTED_RECOVERY_BUNDLE_AUTH_FAILED'));
});
test('Web Crypto independently authenticates the envelope and recovers the same complete inner bundle', async () => {
  const f = fixture(), { bytes } = await pack(f);
  const key = await crypto.subtle.importKey('raw', f.encryptionKey, 'AES-GCM', false, ['decrypt']);
  const plaintext = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: bytes.subarray(12, 24),
    additionalData: bytes.subarray(0, 24), tagLength: 128 }, key, bytes.subarray(24));
  const opened = await readRecoveryBundle(new Uint8Array(plaintext), f);
  assert.deepEqual(opened.snapshot, f.snapshot);
  assert.deepEqual(Buffer.from(await opened.readBlob(f.blob_key)), f.blob);
});
test('tampered nonce, ciphertext or tag is refused before private metadata validation', async () => {
  const f = fixture(), { bytes } = await pack(f);
  const options = { encryptionKey: f.encryptionKey, get latestDeletions() { return undefined; } };
  for (const at of [12, 23, 24, bytes.length - 17, bytes.length - 16, bytes.length - 1]) {
    const corrupt = Buffer.from(bytes); corrupt[at] ^= 1;
    await assert.rejects(() => readEncryptedRecoveryBundle(corrupt, options), code('ENCRYPTED_RECOVERY_BUNDLE_AUTH_FAILED'));
  }
});
test('invalid framing, truncation, tag removal, appended payload and oversized input are bounded', async () => {
  const f = fixture(), { bytes } = await pack(f);
  for (const at of [0, 7, 8, 11]) {
    const corrupt = Buffer.from(bytes); corrupt[at] ^= 1;
    await assert.rejects(() => readEncryptedRecoveryBundle(corrupt, f), code('INVALID_ENCRYPTED_RECOVERY_BUNDLE'));
  }
  for (const truncated of [bytes.subarray(0, 24), bytes.subarray(0, -1), bytes.subarray(0, -16), Buffer.concat([bytes, Buffer.from([0])])])
    await assert.rejects(() => readEncryptedRecoveryBundle(truncated, f), code('INVALID_ENCRYPTED_RECOVERY_BUNDLE'));
  const oversized = new Uint8Array(encryptedRecoveryBundleLimits.max_envelope_bytes + 1);
  await assert.rejects(() => readEncryptedRecoveryBundle(oversized, f), code('ENCRYPTED_RECOVERY_BUNDLE_LIMIT_EXCEEDED'));
});
test('password strings and wrong key sizes are refused without any blob read or secret in the error', async () => {
  const f = fixture(); let reads = 0;
  for (const encryptionKey of [undefined, 'PRIVATE_PASSWORD'.repeat(3), new Uint8Array(0), new Uint8Array(16), new Uint8Array(31), new Uint8Array(33)]) {
    const options = { ...f, encryptionKey, readBlob: async () => { reads++; } };
    await assert.rejects(() => createEncryptedRecoveryBundle(f.snapshot, options), code('INVALID_RECOVERY_ENCRYPTION_KEY'));
    await assert.rejects(() => readEncryptedRecoveryBundle(new Uint8Array(100), options), code('INVALID_RECOVERY_ENCRYPTION_KEY'));
  }
  assert.equal(reads, 0);
});
test('valid AEAD never replaces the external latest deletion ledger or authenticates inner invalid data', async () => {
  const f = fixture(), { bytes } = await pack(f);
  await assert.rejects(() => readEncryptedRecoveryBundle(bytes, { encryptionKey: f.encryptionKey }), code('INVALID_RECOVERY_SNAPSHOT'));
  const newerDeletion = { owner: f.snapshot.tables.hwp_documents[0].owner,
    document_id: f.snapshot.tables.hwp_documents[0].id, expected_version: f.snapshot.tables.hwp_versions[0].id,
    request_id: crypto.randomUUID(), version_count: 1, phase: 'complete', created_at: 2, completed_at: 3 };
  await assert.rejects(() => readEncryptedRecoveryBundle(bytes, { ...f, latestDeletions: [newerDeletion] }), code('RECOVERY_DELETION_LEDGER_MISMATCH'));
  const pending = { ...newerDeletion, phase: 'pending', completed_at: null };
  await assert.rejects(() => readEncryptedRecoveryBundle(bytes, { ...f, latestDeletions: [pending] }), code('RECOVERY_DELETION_PENDING'));
  const malformed = decode(bytes, f.encryptionKey); malformed[16] = 255;
  await assert.rejects(() => readEncryptedRecoveryBundle(encode(malformed, f.encryptionKey), f), code('RECOVERY_BUNDLE_CORRUPT'));
  createHash('sha256').update(malformed.subarray(0, -32)).digest().copy(malformed, malformed.length - 32);
  await assert.rejects(() => readEncryptedRecoveryBundle(encode(malformed, f.encryptionKey), f), code('INVALID_RECOVERY_BUNDLE'));
});
test('caller mutation during capture or read cannot change the private key, snapshot or decoded bytes', async () => {
  const f = fixture(), expected = structuredClone(f.snapshot), stableKey = Buffer.from(f.encryptionKey);
  const packed = await createEncryptedRecoveryBundle(f.snapshot, { ...f, readBlob: async key => {
    f.encryptionKey.fill(0); f.snapshot.tables.hwp_documents[0].display_name = 'CHANGED'; return f.readBlob(key);
  } });
  const supplied = Buffer.from(stableKey), envelope = Buffer.from(packed.bytes);
  const pending = readEncryptedRecoveryBundle(envelope, { encryptionKey: supplied, latestDeletions: [] });
  envelope.fill(0); supplied.fill(0);
  const opened = await pending;
  assert.deepEqual(opened.snapshot, expected);
  const first = await opened.readBlob(f.blob_key); first.fill(0);
  assert.deepEqual(Buffer.from(await opened.readBlob(f.blob_key)), f.blob);
});
test('encrypted and plaintext readers reject the other format without an automatic downgrade', async () => {
  const f = fixture(), encrypted = await pack(f), plain = await createRecoveryBundle(f.snapshot, f);
  await assert.rejects(() => readEncryptedRecoveryBundle(plain.bytes, f), code('INVALID_ENCRYPTED_RECOVERY_BUNDLE'));
  await assert.rejects(() => readRecoveryBundle(encrypted.bytes, f), code('INVALID_RECOVERY_BUNDLE'));
  assert(EncryptedRecoveryBundleError.prototype instanceof Error);
});
