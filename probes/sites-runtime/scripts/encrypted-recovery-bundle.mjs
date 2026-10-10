// Offline operator library only. No key files, passwords, network or production
// restore routes. AEAD binds bytes to the supplied key, not platform provenance.
import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';
import { createRecoveryBundle, readRecoveryBundle, recoveryBundleLimits } from './recovery-bundle.mjs';

export class EncryptedRecoveryBundleError extends Error {
  constructor(code) { super(code); this.name = 'EncryptedRecoveryBundleError'; this.code = code; }
}
const fail = code => { throw new EncryptedRecoveryBundleError(code); };
const magic = Buffer.from('HWPEEN01', 'ascii'), headerBytes = 24, tagBytes = 16;
export const encryptedRecoveryBundleLimits = Object.freeze({ key_bytes: 32,
  max_envelope_bytes: recoveryBundleLimits.max_bundle_bytes + headerBytes + tagBytes });
const copyKey = value => {
  if (!(value instanceof Uint8Array) || value.byteLength !== 32) fail('INVALID_RECOVERY_ENCRYPTION_KEY');
  return Buffer.from(value);
};
const proof = (inner, bytes, verified) => Object.freeze({ ...inner,
  bundle_encrypted: true, bundle_authenticated: true,
  envelope_format: 'hwp-easy-encrypted-recovery-v1', envelope_bytes: bytes,
  authentication: 'aes-256-gcm-with-supplied-key', authentication_verified_on_read: verified,
  encryption_key_custody_verified: false });

/** The caller supplies a separately held random 256-bit key. Never accepts a
 * password/string or caller-controlled nonce. Copies the key before awaiting. */
export async function createEncryptedRecoveryBundle(input, { encryptionKey, latestDeletions, readBlob } = {}) {
  const key = copyKey(encryptionKey);
  let inner;
  try {
    inner = await createRecoveryBundle(input, { latestDeletions, readBlob });
    const header = Buffer.alloc(headerBytes);
    magic.copy(header); header.writeUInt32BE(inner.bytes.length, 8);
    randomBytes(12).copy(header, 12);
    const cipher = createCipheriv('aes-256-gcm', key, header.subarray(12), { authTagLength: tagBytes });
    cipher.setAAD(header);
    const bytes = Buffer.concat([header, cipher.update(inner.bytes), cipher.final(), cipher.getAuthTag()]);
    return { bytes, proof: proof(inner.proof, bytes.length, false) };
  } finally {
    key.fill(0); inner?.bytes.fill(0);
  }
}

/** Authenticates the complete envelope BEFORE parsing any private metadata.
 * The separately obtained latest deletion ledger is still mandatory. */
export async function readEncryptedRecoveryBundle(input, { encryptionKey, latestDeletions } = {}) {
  const key = copyKey(encryptionKey);
  let partial, plaintext;
  try {
    if (!(input instanceof Uint8Array) || input.byteLength < headerBytes + 48 + tagBytes)
      fail('INVALID_ENCRYPTED_RECOVERY_BUNDLE');
    if (input.byteLength > encryptedRecoveryBundleLimits.max_envelope_bytes)
      fail('ENCRYPTED_RECOVERY_BUNDLE_LIMIT_EXCEEDED');
    const bytes = Buffer.from(input), length = bytes.readUInt32BE(8);
    if (!bytes.subarray(0, magic.length).equals(magic) || length < 48
        || bytes.length !== headerBytes + length + tagBytes) fail('INVALID_ENCRYPTED_RECOVERY_BUNDLE');
    const header = bytes.subarray(0, headerBytes);
    try {
      const decipher = createDecipheriv('aes-256-gcm', key, header.subarray(12), { authTagLength: tagBytes });
      decipher.setAAD(header); decipher.setAuthTag(bytes.subarray(-tagBytes));
      partial = decipher.update(bytes.subarray(headerBytes, -tagBytes));
      plaintext = Buffer.concat([partial, decipher.final()]);
    } catch { fail('ENCRYPTED_RECOVERY_BUNDLE_AUTH_FAILED'); }
    const inner = await readRecoveryBundle(plaintext, { latestDeletions });
    return { ...inner, proof: proof(inner.proof, bytes.length, true) };
  } finally {
    key.fill(0); partial?.fill(0); plaintext?.fill(0);
  }
}
