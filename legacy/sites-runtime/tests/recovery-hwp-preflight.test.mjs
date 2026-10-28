import assert from 'node:assert/strict';
import test from 'node:test';
import fs from 'node:fs';
import { createRequire } from 'node:module';
import { pathToFileURL } from 'node:url';
import { createHash } from 'node:crypto';
import { HwpDocument, initSync } from '@rhwp/core';
import { createDocumentEngine } from '../../../src/one_hwp/engine/document.mjs';
import { createEngineApi } from '../../../src/one_hwp/rhwp_api.mjs';
import { syntheticFixture } from '../../../src/one_hwp/synthetic_fixtures.mjs';
import { mixedFixture } from '../../../tests/fixtures/mixed-style-fixtures.mjs';
import { makeRawTextLimitFixture } from '../scripts/performance-fixtures.mjs';
import { auditRecoverySnapshot } from '../scripts/recovery-audit.mjs';
import { preflightRecoveryHwp, recoveryHwpPreflightLimits } from '../scripts/recovery-hwp-preflight.mjs';

const require = createRequire(import.meta.url);
initSync({ module: fs.readFileSync(new URL('./rhwp_bg.wasm', pathToFileURL(require.resolve('@rhwp/core')))) });
const api = createEngineApi(HwpDocument), engine = createDocumentEngine(HwpDocument);
const sha = bytes => createHash('sha256').update(bytes).digest('hex');
const make = options => syntheticFixture(HwpDocument, api.exportChecked, options);
const small = make({ table: false, paragraphs: ['비공개 합성 본문 😀'] });
const rejected = code => error => error.code === code && error.message === code;
function fixture(inputs = [small]) {
  const owner = 'synthetic:preflight', keys = new Map();
  const tables = { hwp_documents: [], hwp_versions: [], hwp_requests: [], hwp_deletions: [] };
  // Separate documents so a batch can exceed 128 without violating per-document limits.
  for (const bytes of inputs) {
    const document = crypto.randomUUID(), version = crypto.randomUUID();
    const blob_key = `hwp-easy/v1/${owner}/${document}/${version}.hwp`;
    keys.set(blob_key, bytes.slice());
    tables.hwp_documents.push({ owner, id: document, current_version: version, revision: 1,
      created_at: 1, display_name: 'PRIVATE_NAME_합성', name_revision: 1 });
    tables.hwp_versions.push({ owner, document_id: document, id: version, sha256: sha(bytes),
      blob_key, byte_size: bytes.length, created_at: 1 });
    tables.hwp_requests.push({ owner, id: crypto.randomUUID(), document_id: document,
      version_id: version, fingerprint: 'a'.repeat(64), created_at: 1 });
  }
  return { snapshot: { format: 'hwp-easy-recovery-v1', tables }, latestDeletions: [], keys };
}
const run = (f, extra = {}) => preflightRecoveryHwp(f.snapshot, {
  latestDeletions: f.latestDeletions, readBlob: async key => f.keys.get(key), engine, ...extra });

test('genuine mixed-style merged HWP versions are fully read before immutable recovery data is returned', async () => {
  const f = fixture([small, mixedFixture(HwpDocument, 'cell', { merged: true })]);
  const before = structuredClone(f.snapshot), result = await run(f);
  assert.equal(result.proof.hwp_reopen_verified, true);
  assert.equal(result.proof.hwp_versions_checked, 2);
  assert.equal(result.proof.hwp_content_complete_versions, 2);
  assert.equal(result.proof.hwp_partial_content_versions, 0);
  assert.deepEqual(result.snapshot, before); assert.deepEqual(f.snapshot, before);
  assert.throws(() => { result.snapshot.tables.hwp_documents[0].display_name = 'CHANGED'; }, TypeError);
  assert.throws(() => { result.snapshot.tables.hwp_versions.pop(); }, TypeError);
  for (const [key, bytes] of f.keys) assert.deepEqual(await result.readBlob(key), bytes);
  const key = f.keys.keys().next().value;
  (await result.readBlob(key)).fill(0); assert.deepEqual(await result.readBlob(key), f.keys.get(key));
  assert.equal(await result.readBlob('unrelated/path'), undefined);
  for (const field of ['restored', 'layout_verified', 'hwp_editability_verified', 'hosted_performance_verified',
    'snapshot_provenance_verified', 'latest_deletion_ledger_freshness_verified', 'platform_backup_restore_verified'])
    assert.equal(result.proof[field], false, field);
  for (const privateText of ['PRIVATE_NAME', '비공개', 'synthetic:preflight', key])
    assert(!JSON.stringify(result.proof).includes(privateText));
});

test('full cursor chains cover repeated paragraphs and supplementary emoji without stopping at the first page', async () => {
  const bytes = make({ table: false, paragraphs: ['😀'.repeat(33000) + '가'.repeat(32000), ...Array(257).fill('반복 합성 문단')] });
  const result = await run(fixture([bytes]));
  assert(result.proof.hwp_read_pages_checked >= 4);
  assert.equal(result.proof.hwp_content_complete_versions, 1);
  assert.equal(result.proof.hwp_text_utf16_units_checked, 98000 + 257 * '반복 합성 문단'.length);
});

test('a readable HWP with unsupported header content keeps its partial classification', async () => {
  const result = await run(fixture([make({ header: true })]));
  assert.equal(result.proof.hwp_reopen_verified, true);
  assert.equal(result.proof.hwp_content_complete_versions, 0);
  assert.equal(result.proof.hwp_partial_content_versions, 1);
  assert.equal(result.proof.hwp_editability_verified, false);
});

test('matching hashes of non-HWP bytes pass the byte audit but fail before any engine open or result adapter', async () => {
  const f = fixture([small, Buffer.from('PRIVATE_FAKE_HWP')]);
  const proof = await auditRecoverySnapshot(f.snapshot, { latestDeletions: [], readBlob: async key => f.keys.get(key) });
  assert.equal(proof.versions, 2);
  let opens = 0;
  await assert.rejects(() => run(f, { engine: { open() { opens++; throw Error('PRIVATE_ENGINE_ERROR'); } } }),
    rejected('RECOVERY_HWP_UNREADABLE'));
  assert.equal(opens, 0); // Inspect the whole raw batch before opening the first good version.
});

test('missing bytes, wrong metadata and newer deletion records fail before WASM', async () => {
  let opens = 0, reads = 0;
  const sentinel = { open() { opens++; throw Error('PRIVATE_ERROR'); } };
  const f = fixture();
  await assert.rejects(() => run(f, { engine: sentinel, readBlob: async () => undefined }),
    rejected('RECOVERY_BLOB_MISSING_OR_CORRUPT'));
  f.snapshot.tables.hwp_versions[0].blob_key = '../../PRIVATE_PATH';
  await assert.rejects(() => run(f, { engine: sentinel, readBlob: async () => { reads++; } }),
    rejected('RECOVERY_METADATA_INCONSISTENT'));
  const g = fixture(), doc = g.snapshot.tables.hwp_documents[0], version = g.snapshot.tables.hwp_versions[0];
  const later = { owner: doc.owner, document_id: doc.id, request_id: crypto.randomUUID(), expected_version: version.id,
    phase: 'complete', version_count: 1, created_at: 1, completed_at: 2 };
  await assert.rejects(() => run(g, { engine: sentinel, latestDeletions: [later] }),
    rejected('RECOVERY_DELETION_LEDGER_MISMATCH'));
  assert.equal(opens, 0); assert.equal(reads, 0);
});

test('batch version count is bounded before reads; per-file and aggregate UTF-16 work before WASM', async () => {
  let opens = 0, reads = 0;
  const sentinel = { open() { opens++; throw Error('PRIVATE_ERROR'); } };
  await assert.rejects(() => run(fixture(Array(129).fill(small)), { engine: sentinel,
    readBlob: async () => { reads++; } }), rejected('RECOVERY_HWP_WORK_LIMIT_EXCEEDED'));
  assert.equal(reads, 0);
  for (const units of [400001, 2000001]) {
    const bytes = makeRawTextLimitFixture(units, HwpDocument, api);
    await assert.rejects(() => run(fixture([bytes]), { engine: sentinel }), rejected('RECOVERY_HWP_WORK_LIMIT_EXCEEDED'));
  }
  const boundary = makeRawTextLimitFixture(400000, HwpDocument, api);
  await assert.rejects(() => run(fixture([small, ...Array(5).fill(boundary)]), { engine: sentinel }),
    rejected('RECOVERY_HWP_WORK_LIMIT_EXCEEDED'));
  assert.equal(opens, 0);
  // Negative admission-only fixture: crossing into a sentinel is NOT a valid-HWP success.
  await assert.rejects(() => run(fixture([boundary]), { engine: sentinel }), rejected('RECOVERY_HWP_UNREADABLE'));
  assert.equal(opens, 1);
  await assert.rejects(() => run(fixture(Array(5).fill(boundary)), { engine: sentinel }), rejected('RECOVERY_HWP_UNREADABLE'));
  assert.equal(opens, 2); // Exactly two million units pass only the work admission.
  await assert.rejects(() => run(fixture(Array(128).fill(small)), { engine: sentinel }), rejected('RECOVERY_HWP_UNREADABLE'));
  assert.equal(opens, 3); // Exactly 128 versions likewise reach the first engine call.
});

test('capture isolates caller changes across reads and engine input mutation', async () => {
  const f = fixture([small, small]), before = structuredClone(f.snapshot);
  const expected = new Map([...f.keys].map(([key, bytes]) => [key, bytes.slice()]));
  let previous;
  const result = await run(f, { readBlob: async key => {
    f.snapshot.tables.hwp_documents[0].display_name = 'PRIVATE_CHANGED';
    if (previous) previous.fill(0);
    previous = f.keys.get(key); return previous;
  }, engine: { async open(bytes) { const opened = await engine.open(bytes); bytes.fill(0); return opened; } } });
  assert.deepEqual(result.snapshot, before);
  for (const [key, bytes] of expected) assert.deepEqual(await result.readBlob(key), bytes);
});

test('engine and read failures disclose fixed codes; wrong hashes and stuck cursors cannot certify recovery', async () => {
  const f = fixture();
  for (const injected of [
    { open() { throw Error('PRIVATE_ENGINE_ERROR'); } },
    { open: () => ({ source_sha256: 'b'.repeat(64), read() {} }) },
    { open: bytes => ({ source_sha256: sha(bytes), read() { throw Error('PRIVATE_READ_ERROR'); } }) },
    { open: bytes => ({ source_sha256: sha(bytes), read: () => ({ source_sha256: sha(bytes),
      complete: false, content_complete: false, blocks: [], next_cursor: { sha256: sha(bytes), block_index: 0, offset: 0 } }) }) },
  ]) await assert.rejects(() => run(f, { engine: injected }), rejected('RECOVERY_HWP_UNREADABLE'));
});

test('read page budget prevents an unending progressing chain from becoming a success', async () => {
  const f = fixture(); let pages = 0;
  await assert.rejects(() => run(f, { engine: { open: bytes => ({ source_sha256: sha(bytes),
    read: () => ({ source_sha256: sha(bytes), complete: false, content_complete: false, blocks: [],
      next_cursor: { sha256: sha(bytes), block_index: ++pages, offset: 0 } }) }) } }),
  rejected('RECOVERY_HWP_WORK_LIMIT_EXCEEDED'));
  assert.equal(pages, recoveryHwpPreflightLimits.max_total_read_pages);
});

test('a late engine failure returns no partially preflighted recovery data', async () => {
  const f = fixture([small, small]); let opens = 0;
  await assert.rejects(() => run(f, { engine: { async open(bytes) {
    if (++opens === 2) throw Error('PRIVATE_LATE_ERROR');
    return engine.open(bytes);
  } } }), rejected('RECOVERY_HWP_UNREADABLE'));
  assert.equal(opens, 2);
});

test('empty recovery data does not claim any HWP reopen; missing dependencies or ledger are rejected', async () => {
  const empty = await run(fixture([]));
  assert.equal(empty.proof.hwp_reopen_verified, false); assert.equal(empty.proof.hwp_versions_checked, 0);
  assert.equal(empty.proof.hwp_read_pages_checked, 0);
  await assert.rejects(() => run(fixture(), { engine: {} }), rejected('INVALID_RECOVERY_HWP_PREFLIGHT'));
  await assert.rejects(() => run(fixture(), { latestDeletions: undefined }), rejected('INVALID_RECOVERY_SNAPSHOT'));
});
