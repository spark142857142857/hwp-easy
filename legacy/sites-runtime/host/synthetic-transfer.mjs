// A diagnostic exception, never a general upload policy. The server owns this
// pin; a caller-provided hash, filename or MIME type cannot authorize a file.
import { StorageError } from '../storage/store.mjs';
import { createEngineApi } from '../../../src/one_hwp/rhwp_api.mjs';
import { syntheticFixture } from '../../../src/one_hwp/synthetic_fixtures.mjs';

export const SYNTHETIC_TRANSFER_BYTES = 13312;
export const SYNTHETIC_TRANSFER_SHA256 = '58ed8fc70a3f6c497f6450e617b9a7f54b8abbb389991feeb75f7582468eee66';
export function transferFixture(HwpDocument) {
  return syntheticFixture(HwpDocument, createEngineApi(HwpDocument).exportChecked, {
    paragraphs: ['HWP Easy 합성 첨부 시험', '개인정보 없는 고정 테스트 문서', '끝까지 조회 확인'],
  });
}
export async function verifyTransferFixture(bytes) {
  if (!(bytes instanceof Uint8Array) || bytes.byteLength !== SYNTHETIC_TRANSFER_BYTES) {
    throw new StorageError('SYNTHETIC_FIXTURE_REQUIRED');
  }
  const digest = await crypto.subtle.digest('SHA-256', bytes);
  const sha256 = [...new Uint8Array(digest)].map((n) => n.toString(16).padStart(2, '0')).join('');
  if (sha256 !== SYNTHETIC_TRANSFER_SHA256) throw new StorageError('SYNTHETIC_FIXTURE_REQUIRED');
  return sha256;
}
export function syntheticOutputResource(bytes, sha256) {
  if (!(bytes instanceof Uint8Array) || !bytes.length || bytes.length > 65536 || !/^[0-9a-f]{64}$/.test(sha256)) {
    throw new StorageError('SYNTHETIC_OUTPUT_LIMIT_EXCEEDED');
  }
  // Only the already-verified, fixed synthetic workflow output reaches here.
  // Embedded MCP bytes survive cleanup; this is not a public document URL or
  // a promise that every client presents a native downloadable file artifact.
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return { type: 'resource', resource: { uri: `hwp-easy://synthetic-transfer/${sha256}.hwp`,
    mimeType: 'application/x-hwp', blob: btoa(binary) } };
}
