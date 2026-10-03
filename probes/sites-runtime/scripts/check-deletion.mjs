// Actual ephemeral workerd D1/R2. Mock owner strings/faults are NOT OAuth tests.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { pathToFileURL } from 'node:url';
import { Miniflare, convertV4MiniflareOptions } from 'miniflare';
import { HwpDocument, initSync } from '@rhwp/core';
import { createEngineApi } from '../../../src/one_hwp/rhwp_api.mjs';
import { syntheticFixture } from '../../../src/one_hwp/synthetic_fixtures.mjs';
import { createVersionStore } from '../storage/store.mjs';
import { applyTestMigrations } from './migrations.mjs';
const require = createRequire(import.meta.url);
initSync({ module: fs.readFileSync(new URL('./rhwp_bg.wasm', pathToFileURL(require.resolve('@rhwp/core')))) });
const mf = new Miniflare(convertV4MiniflareOptions({ compatibilityDate: '2026-10-01',
  modulesRoot: path.resolve('dist/server'), modules: [
    { type: 'ESModule', path: path.resolve('dist/server/index.js') },
    { type: 'CompiledWasm', path: path.resolve('dist/server/rhwp_bg.wasm') }],
  d1Databases: { DB: 'deletion-d1' }, r2Buckets: { BUCKET: 'deletion-r2' } }));
const code = (expected) => (e) => e.code === expected && e.message === expected;
const checks = [], owner = `probe:${crypto.randomUUID()}:a`;
try {
  const db = await mf.getD1Database('DB'), bucket = await mf.getR2Bucket('BUCKET');
  await applyTestMigrations(db);
  const store = createVersionStore(db, bucket);
  const bytes = syntheticFixture(HwpDocument, createEngineApi(HwpDocument).exportChecked, { table: false });
  const create = async () => {
    const request_id = crypto.randomUUID();
    return { ...await store.create({ owner, request_id, bytes }), create_request_id: request_id };
  };
  const args = (doc) => ({ owner, document_id: doc.document_id, expected_version: doc.version_id, request_id: crypto.randomUUID() });
  const baseline = await create(), baselineKey = `hwp-easy/v1/${owner}/${baseline.document_id}/${baseline.version_id}.hwp`;
  const intact = async () => assert.deepEqual((await store.read({ owner, document_id: baseline.document_id })).bytes, bytes);
  const doc = await create(), stale = args(doc);
  const revised = await store.replace({ owner, document_id: doc.document_id, expected_version: doc.version_id,
    request_id: crypto.randomUUID(), bytes });
  await assert.rejects(() => store.remove(stale), code('VERSION_CONFLICT'));
  await assert.rejects(() => store.remove({ ...args(revised), owner: 'other', document_id: doc.document_id }), code('DOCUMENT_OR_VERSION_NOT_FOUND'));
  await assert.rejects(() => store.remove({ ...args(revised), request_id: baseline.create_request_id }), code('REQUEST_ID_CONFLICT'));
  await intact(); checks.push('stale_owner_and_existing_request_rejected_before_blob_delete');
  const deletion = args(revised), removed = await store.remove(deletion);
  assert.equal(removed.recorded_versions_removed, 2); assert.equal(removed.unpublished_blob_gc_verified, false);
  assert.equal((await store.remove(deletion)).replayed, true);
  assert.equal((await bucket.list({ prefix: `hwp-easy/v1/${owner}/${doc.document_id}/` })).objects.length, 0);
  await assert.rejects(() => store.read({ owner, document_id: doc.document_id }), code('DOCUMENT_OR_VERSION_NOT_FOUND'));
  await assert.rejects(() => store.history({ owner, document_id: doc.document_id }), code('DOCUMENT_OR_VERSION_NOT_FOUND'));
  await assert.rejects(() => store.create({ owner, request_id: doc.create_request_id, bytes }), code('DOCUMENT_DELETED'));
  await assert.rejects(() => store.create({ owner, request_id: deletion.request_id, bytes }), code('REQUEST_ID_CONFLICT'));
  await intact(); checks.push('exact_delete_replay_revokes_read_and_history_and_prevents_create_replay_resurrection');

  const retryDoc = await create(), retryArgs = args(retryDoc);
  const failingBucket = { put: (...a) => bucket.put(...a), get: (...a) => bucket.get(...a),
    delete: async () => { throw new Error('injected R2 failure'); } };
  await assert.rejects(() => createVersionStore(db, failingBucket).remove(retryArgs), code('DELETE_INCOMPLETE_RETRY_SAME_REQUEST'));
  await assert.rejects(() => store.read({ owner, document_id: retryDoc.document_id }), code('DOCUMENT_OR_VERSION_NOT_FOUND'));
  await assert.rejects(() => store.replace({ owner, document_id: retryDoc.document_id, expected_version: retryDoc.version_id,
    request_id: crypto.randomUUID(), bytes }), code('VERSION_CONFLICT_OR_HISTORY_LIMIT'));
  assert.equal((await store.remove(retryArgs)).deleted, true);
  await intact(); checks.push('failed_r2_delete_blocks_new_access_and_writes_then_resumes_exact_request');

  for (const mode of ['lost_begin_ack', 'unavailable_begin_receipt', 'lost_finish_ack']) {
    const next = await create(), request = args(next); let batches = 0, unavailable = false;
    const broken = {
      prepare(sql) { const raw = db.prepare(sql); return { bind(...values) {
        const bound = raw.bind(...values);
        if (sql.startsWith('SELECT * FROM hwp_deletions')) return { first: async () => {
          if (unavailable) throw new Error('injected receipt failure'); return bound.first();
        } }; return bound;
      } }; },
      async batch(statements) {
        await db.batch(statements); ++batches;
        if (batches === (mode === 'lost_finish_ack' ? 2 : 1)) {
          unavailable = mode === 'unavailable_begin_receipt'; throw new Error('injected lost acknowledgement');
        }
      },
    };
    const wrapped = createVersionStore(broken, bucket);
    if (mode === 'unavailable_begin_receipt') {
      await assert.rejects(() => wrapped.remove(request), code('DELETE_OUTCOME_UNKNOWN'));
      assert(await bucket.get(`hwp-easy/v1/${owner}/${next.document_id}/${next.version_id}.hwp`));
      assert.equal((await store.remove(request)).deleted, true);
    } else assert.equal((await wrapped.remove(request)).deleted, true);
    await intact(); checks.push(mode);
  }

  const corrupt = await create(), request = args(corrupt);
  const originalKey = `hwp-easy/v1/${owner}/${corrupt.document_id}/${corrupt.version_id}.hwp`;
  await db.prepare('UPDATE hwp_versions SET blob_key = ? WHERE owner = ? AND document_id = ?')
    .bind(`${baselineKey}.foreign`, owner, corrupt.document_id).run();
  let deletes = 0;
  const spy = { put: (...a) => bucket.put(...a), get: (...a) => bucket.get(...a),
    delete: (...a) => { deletes++; return bucket.delete(...a); } };
  await assert.rejects(() => createVersionStore(db, spy).remove(request), code('DELETION_METADATA_CORRUPT'));
  assert.equal(deletes, 0); await intact();
  await db.prepare('UPDATE hwp_versions SET blob_key = ? WHERE owner = ? AND document_id = ?')
    .bind(originalKey, owner, corrupt.document_id).run();
  await store.remove(request); checks.push('corrupt_cross_document_key_rejected_before_any_r2_deletion');

  const raced = await create(), racedArgs = args(raced);
  const outcomes = await Promise.allSettled([store.remove(racedArgs), store.remove(racedArgs)]);
  assert(outcomes.every((o) => o.status === 'fulfilled' && o.value.deleted));
  await intact(); checks.push('concurrent_identical_deletion_requests_are_idempotent');
  console.log(JSON.stringify({ explicit_deletion: 'passed', checks, recorded_versions_only: true,
    unpublished_and_inflight_gc_verified: false, identity_is_mock_not_oauth: true }));
} finally { await mf.dispose(); }
