// Real local workerd D1/R2, with explicitly labelled injected failure cases.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';
import { pathToFileURL } from 'node:url';
import { Miniflare, convertV4MiniflareOptions } from 'miniflare';
import { HwpDocument, initSync } from '@rhwp/core';
import { createEngineApi } from '../../../src/one_hwp/rhwp_api.mjs';
import { syntheticFixture } from '../../../src/one_hwp/synthetic_fixtures.mjs';
import { createDocumentEngine } from '../engine/document.mjs';
import { createVersionStore, StorageError } from '../storage/store.mjs';
import { createDocumentService } from '../storage/service.mjs';
import { applyTestMigrations } from './migrations.mjs';
const require = createRequire(import.meta.url);
initSync({ module: fs.readFileSync(new URL('./rhwp_bg.wasm', pathToFileURL(require.resolve('@rhwp/core')))) });
const engine = createDocumentEngine(HwpDocument), api = createEngineApi(HwpDocument);
const bytes = syntheticFixture(HwpDocument, api.exportChecked, { table: false, paragraphs: ['저장 테스트 😀'] });
const tempRoot = fs.realpathSync(os.tmpdir());
const persist = fs.mkdtempSync(path.join(tempRoot, 'hwp-easy-storage-'));
const options = { compatibilityDate: '2026-10-01', resourcePersistencePath: persist,
  modulesRoot: path.resolve('dist/server'),
  modules: [{ type: 'ESModule', path: path.resolve('dist/server/index.js') },
    { type: 'CompiledWasm', path: path.resolve('dist/server/rhwp_bg.wasm') }],
  d1Databases: { DB: 'synthetic-d1' }, r2Buckets: { BUCKET: 'synthetic-r2' } };
let mf;
const checks = [];
const isCode = (code) => (error) => error instanceof StorageError && error.code === code && error.message === code;
const owner = `probe:${crypto.randomUUID()}:a`;
try {
  mf = new Miniflare(convertV4MiniflareOptions(options));
  let db = await mf.getD1Database('DB'), bucket = await mf.getR2Bucket('BUCKET');
  await applyTestMigrations(db);
  let store = createVersionStore(db, bucket), service = createDocumentService(engine, store);
  const created = await service.create({ owner, request_id: crypto.randomUUID(), bytes });
  const original = await service.open({ owner, document_id: created.document_id });
  const block = original.snapshot.read({ expected_sha256: created.sha256 }).blocks.find((b) => b.editable && b.text);
  const request = { expected_sha256: created.sha256,
    operations: [{ target_id: block.target_id, expected_old: block.text, new_text: '재시작 후 읽을 내용 😀' }] };
  const editId = crypto.randomUUID();
  const edited = await service.edit({ owner, document_id: created.document_id,
    expected_version: created.version_id, request_id: editId, request });
  await mf.dispose(); mf = undefined;
  // A NEW runtime and NEW store instances must recover current/prior versions and receipts.
  mf = new Miniflare(convertV4MiniflareOptions(options));
  db = await mf.getD1Database('DB'); bucket = await mf.getR2Bucket('BUCKET');
  store = createVersionStore(db, bucket); service = createDocumentService(engine, store);
  const reopened = await service.open({ owner, document_id: created.document_id });
  assert.equal(reopened.metadata.version_id, edited.version_id);
  assert.equal(reopened.snapshot.read({ expected_sha256: edited.sha256 }).blocks.find((b) => b.id === block.id).text,
    '재시작 후 읽을 내용 😀');
  const replay = await service.edit({ owner, document_id: created.document_id,
    expected_version: created.version_id, request_id: editId, request });
  assert.equal(replay.replayed, true); assert.equal(replay.version_id, edited.version_id);
  assert.equal((await service.history({ owner, document_id: created.document_id })).length, 2);
  const restored = await service.restore({ owner, document_id: created.document_id,
    expected_version: edited.version_id, source_version: created.version_id, request_id: crypto.randomUUID() });
  assert.equal(restored.sha256, created.sha256); assert.notEqual(restored.version_id, created.version_id);
  checks.push('runtime_restart_current_prior_versions_and_request_receipt', 'restore_creates_new_revision');

  // Same id with a different intent cannot overwrite a saved request.
  await assert.rejects(() => service.edit({ owner, document_id: created.document_id,
    expected_version: created.version_id, request_id: editId,
    request: { ...request, operations: [{ ...request.operations[0], new_text: '다른 요청' }] } }), isCode('REQUEST_ID_CONFLICT'));
  await assert.rejects(() => service.create({ owner, request_id: crypto.randomUUID(), bytes: new Uint8Array([1, 2]) }));
  assert.equal((await service.history({ owner, document_id: created.document_id })).length, 3);
  checks.push('request_id_conflicting_intent_rejected', 'invalid_hwp_not_published');

  // Inject lost DB acknowledgement *after* a real successful transaction.
  const ackLostDb = { prepare: (...args) => db.prepare(...args), batch: async (statements) => {
    await db.batch(statements); throw new Error('injected acknowledgement lost');
  } };
  const ackRequest = crypto.randomUUID();
  const ackSaved = await createVersionStore(ackLostDb, bucket).create({ owner, request_id: ackRequest, bytes });
  assert.equal(ackSaved.saved, true); assert.equal(ackSaved.replayed, true);
  assert.deepEqual((await store.read({ owner, document_id: ackSaved.document_id })).bytes, bytes);
  checks.push('injected_lost_ack_resolved_by_persistent_receipt');

  // Lost commit acknowledgement PLUS temporarily unreadable receipt: keep bytes.
  let unavailable = false;
  const uncertainDb = {
    prepare(sql) { const raw = db.prepare(sql); return { bind(...args) {
      const bound = raw.bind(...args);
      return sql.includes('SELECT r.fingerprint') ? { first: async () => {
        if (unavailable) throw new Error('injected receipt unavailable');
        return bound.first();
      } } : bound;
    } }; },
    async batch(statements) { await db.batch(statements); unavailable = true; throw new Error('injected ack lost'); },
  };
  const unknownRequest = crypto.randomUUID();
  await assert.rejects(() => createVersionStore(uncertainDb, bucket).create({ owner,
    request_id: unknownRequest, bytes }), isCode('COMMIT_OUTCOME_UNKNOWN'));
  const recovered = await store.create({ owner, request_id: unknownRequest, bytes });
  assert.equal(recovered.replayed, true);
  assert.deepEqual((await store.read({ owner, document_id: recovered.document_id })).bytes, bytes);
  checks.push('injected_unknown_commit_keeps_blob_and_recovers_on_exact_retry');

  // R2 fails before any metadata transaction: do not alter the current version.
  const brokenBucket = { put: async () => { throw new Error('private detail'); },
    get: (...args) => bucket.get(...args), delete: (...args) => bucket.delete(...args) };
  await assert.rejects(() => createVersionStore(db, brokenBucket).replace({ owner,
    document_id: created.document_id, expected_version: restored.version_id,
    request_id: crypto.randomUUID(), bytes }), isCode('BLOB_WRITE_FAILED'));
  assert.equal((await store.read({ owner, document_id: created.document_id })).version_id, restored.version_id);
  checks.push('injected_blob_failure_keeps_current_version');

  const putAckLostBucket = { put: async (...args) => {
    await bucket.put(...args); throw new Error('injected PUT ack lost');
  }, get: (...args) => bucket.get(...args), delete: (...args) => bucket.delete(...args) };
  const priorBlobCount = (await bucket.list()).objects.length;
  await assert.rejects(() => createVersionStore(db, putAckLostBucket).create({ owner,
    request_id: crypto.randomUUID(), bytes }), isCode('BLOB_WRITE_FAILED'));
  assert.equal((await bucket.list()).objects.length, priorBlobCount);
  checks.push('injected_put_ack_loss_cleans_only_unpublished_random_key');

  const limited = await store.create({ owner, request_id: crypto.randomUUID(), bytes });
  let current = limited.version_id;
  for (let i = 1; i < store.limits.max_versions_per_document; i++) {
    current = (await store.replace({ owner, document_id: limited.document_id,
      expected_version: current, request_id: crypto.randomUUID(), bytes })).version_id;
  }
  await assert.rejects(() => store.replace({ owner, document_id: limited.document_id,
    expected_version: current, request_id: crypto.randomUUID(), bytes }), isCode('VERSION_CONFLICT_OR_HISTORY_LIMIT'));
  assert.equal((await store.read({ owner, document_id: limited.document_id })).version_id, current);
  assert.equal((await store.history({ owner, document_id: limited.document_id })).length, 128);
  checks.push('real_128_version_limit_rejects_without_deleting_history');

  // Corrupt cross-owner metadata is rejected BEFORE a blob lookup.
  let blobRead = false;
  const corruptDb = { batch: (...args) => db.batch(...args), prepare: () => ({ bind: () => ({ first: async () => ({
    id: restored.version_id, current_version: restored.version_id, sha256: restored.sha256,
    byte_size: bytes.length, revision: 3, blob_key: 'hwp-easy/v1/different-owner/private.hwp',
  }) }) }) };
  const trackedBucket = { put: (...args) => bucket.put(...args), delete: (...args) => bucket.delete(...args),
    get: async (...args) => { blobRead = true; return bucket.get(...args); } };
  await assert.rejects(() => createVersionStore(corruptDb, trackedBucket).read({ owner,
    document_id: created.document_id }), isCode('BLOB_MISSING_OR_CORRUPT'));
  assert.equal(blobRead, false);
  checks.push('injected_cross_owner_blob_reference_rejected_before_read');

  const prefix = `hwp-easy/v1/${owner}/`;
  const victim = (await bucket.list({ prefix })).objects[0];
  await bucket.put(victim.key, new Uint8Array([9]));
  const victimVersion = victim.key.split('/').at(-1).replace('.hwp', '');
  const victimDocument = victim.key.split('/').at(-2);
  await assert.rejects(() => store.read({ owner, document_id: victimDocument,
    version_id: victimVersion }), isCode('BLOB_MISSING_OR_CORRUPT'));
  checks.push('real_blob_corruption_detected');
  assert.equal((await store.purgeSyntheticOwner(owner)).cleanup_complete, true);
  await assert.rejects(() => store.purgeSyntheticOwner('production-owner'), isCode('NOT_A_SYNTHETIC_OWNER'));
  checks.push('cleanup_exact_generated_namespace_only');

  // Now exercise the bundled Worker route, not just the JS store API.
  assert.equal((await mf.dispatchFetch('https://probe.invalid/storage-probe')).status, 405);
  assert.equal((await mf.dispatchFetch('https://probe.invalid/storage-probe?owner=attacker', { method: 'POST' })).status, 400);
  assert.equal((await mf.dispatchFetch('https://probe.invalid/storage-probe', { method: 'POST', body: 'not accepted' })).status, 400);
  const result = await mf.dispatchFetch('https://probe.invalid/storage-probe', { method: 'POST' });
  assert.equal(result.status, 200);
  const report = await result.json();
  assert.equal(report.passed, true); assert.equal(report.synthetic_cleanup_complete, true);
  checks.push('bundled_worker_synthetic_storage_probe', 'no_client_owner_or_document_input');
  assert.equal((await db.prepare('SELECT count(*) AS n FROM hwp_documents').first()).n, 0);
  assert.equal((await bucket.list()).objects.length, 0);
  console.log(JSON.stringify({ local_d1_r2: 'passed', runtime_restart_verified: true,
    injected_failures_are_not_real_auth_certification: true, checks, report }));
} finally {
  if (mf) await mf.dispose();
  const resolved = fs.realpathSync(persist), relative = path.relative(tempRoot, resolved);
  if (!relative || relative.startsWith('..') || path.isAbsolute(relative)
    || !path.basename(resolved).startsWith('hwp-easy-storage-')) throw new Error('Unsafe temp cleanup target');
  fs.rmSync(resolved, { recursive: true, force: true }); // Only our validated mkdtemp directory.
}
