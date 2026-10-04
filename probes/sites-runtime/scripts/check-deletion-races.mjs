// Deterministic barriers around real local D1/R2. Identities, timing and faults
// are injected; this is NOT OAuth revocation or production garbage collection.
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
import { createHostApp } from '../host/app.mjs';
import { authenticatedOwner } from '../host/transfer.mjs';
import { applyTestMigrations } from './migrations.mjs';

const require = createRequire(import.meta.url);
initSync({ module: fs.readFileSync(new URL('./rhwp_bg.wasm', pathToFileURL(require.resolve('@rhwp/core')))) });
const mf = new Miniflare(convertV4MiniflareOptions({ compatibilityDate: '2026-10-01',
  modulesRoot: path.resolve('dist/server'), modules: [
    { type: 'ESModule', path: path.resolve('dist/server/index.js') },
    { type: 'CompiledWasm', path: path.resolve('dist/server/rhwp_bg.wasm') }],
  d1Databases: { DB: 'deletion-race-d1' }, r2Buckets: { BUCKET: 'deletion-race-r2' } }));
function barrier() {
  let arrived, resume;
  const entered = new Promise((resolve) => { arrived = resolve; });
  const released = new Promise((resolve) => { resume = resolve; });
  return { entered, release: resume, async pause() { arrived(); await released; } };
}
async function reached(gate) {
  let timer;
  try { await Promise.race([gate.entered, new Promise((_, reject) => {
    timer = setTimeout(() => reject(new Error('TEST_BARRIER_NOT_REACHED')), 5000);
  })]); } finally { clearTimeout(timer); }
}
const outcome = (promise) => promise.then((value) => ({ ok: true, value }), (error) => ({ ok: false, error }));
const rejected = (result, code) => {
  assert.equal(result.ok, false); assert.equal(result.error.code, code); assert.equal(result.error.message, code);
};
const code = (value) => (error) => error.code === value && error.message === value;
const checks = [], identity = new Headers({ 'oai-authenticated-user-id': 'synthetic-deletion-race',
  'oai-authenticated-user-email': 'synthetic@example.invalid' });
const owner = await authenticatedOwner(identity), origin = 'https://probe.invalid';
try {
  const db = await mf.getD1Database('DB'), bucket = await mf.getR2Bucket('BUCKET');
  await applyTestMigrations(db);
  const store = createVersionStore(db, bucket);
  const bytes = syntheticFixture(HwpDocument, createEngineApi(HwpDocument).exportChecked, { table: false });
  const create = () => store.create({ owner, request_id: crypto.randomUUID(), bytes });
  const deletion = (doc) => ({ owner, document_id: doc.document_id, expected_version: doc.version_id, request_id: crypto.randomUUID() });
  const write = (doc) => ({ ...deletion(doc), bytes });
  const prefix = (doc) => `hwp-easy/v1/${owner}/${doc.document_id}/`;
  const keys = async (doc) => (await bucket.list({ prefix: prefix(doc) })).objects.map((object) => object.key);
  const protectedDoc = await create();
  const intact = async () => assert.deepEqual((await store.read({ owner, document_id: protectedDoc.document_id })).bytes, bytes);
  const revoked = async (doc) => {
    await assert.rejects(() => store.read({ owner, document_id: doc.document_id }), code('DOCUMENT_OR_VERSION_NOT_FOUND'));
    await assert.rejects(() => store.history({ owner, document_id: doc.document_id }), code('DOCUMENT_OR_VERSION_NOT_FOUND'));
    assert.equal((await db.prepare('SELECT count(*) AS n FROM hwp_documents WHERE owner = ? AND id = ?')
      .bind(owner, doc.document_id).first()).n, 0);
    await intact();
  };

  // A read already fetched R2 bytes but has not returned them to the caller.
  // Completing deletion before that return must prevent a stale read result.
  const pausedReader = (gate) => ({ put: (...args) => bucket.put(...args), delete: (...args) => bucket.delete(...args),
    async get(key) {
      const object = await bucket.get(key), held = await object.arrayBuffer();
      await gate.pause(); return { size: object.size, arrayBuffer: async () => held };
    } });
  for (const channel of ['storage', 'http']) for (const phase of ['pending', 'complete']) {
    const doc = await create(), request = deletion(doc), gate = barrier();
    const heldBucket = pausedReader(gate);
    const reading = outcome(channel === 'storage'
      ? createVersionStore(db, heldBucket).read({ owner, document_id: doc.document_id })
      : createHostApp({ DB: db, BUCKET: heldBucket, HWP_EASY_ORIGIN: origin }, {}, HwpDocument)
        .http(new Request(`${origin}/documents/${doc.document_id}/versions/${doc.version_id}.hwp`, { headers: identity })));
    try {
      await reached(gate);
      if (phase === 'complete') await store.remove(request);
      else {
        const failedDeletion = { put: (...args) => bucket.put(...args), get: (...args) => bucket.get(...args),
          async delete() { throw new Error('PRIVATE_INJECTED_DELETE_FAILURE'); } };
        await assert.rejects(() => createVersionStore(db, failedDeletion).remove(request), code('DELETE_INCOMPLETE_RETRY_SAME_REQUEST'));
      }
    } finally { gate.release(); }
    const result = await reading;
    if (channel === 'storage') rejected(result, 'DOCUMENT_OR_VERSION_NOT_FOUND');
    else {
      assert.equal(result.ok, true); assert.equal(result.value.status, 404);
      assert.deepEqual(await result.value.json(), { error: 'DOCUMENT_OR_VERSION_NOT_FOUND' });
    }
    if (phase === 'pending') await store.remove(request);
    await revoked(doc); assert.equal((await keys(doc)).length, 0);
    checks.push(`${channel}_read_rechecks_${phase}_deletion_before_returning_already_fetched_bytes`);
  }
  // Embedded delivery has additional engine/encoding work after store.read.
  // A deletion during that work must not release the buffered binary resource.
  for (const phase of ['pending', 'complete']) {
    const doc = await create(), request = deletion(doc), gate = barrier();
    const host = createHostApp({ DB: db, BUCKET: bucket, HWP_EASY_ORIGIN: origin }, {
      async open() { await gate.pause(); return { source_sha256: doc.sha256 }; },
    }, HwpDocument);
    const reading = outcome(host.call('hwp_download', { document_id: doc.document_id,
      version_id: doc.version_id, delivery: 'embedded' }, new Request(`${origin}/mcp`, { headers: identity })));
    try {
      await reached(gate);
      if (phase === 'complete') await store.remove(request);
      else {
        const broken = { get: (...args) => bucket.get(...args), put: (...args) => bucket.put(...args),
          async delete() { throw new Error('PRIVATE_INJECTED_DELETE_FAILURE'); } };
        await assert.rejects(() => createVersionStore(db, broken).remove(request), code('DELETE_INCOMPLETE_RETRY_SAME_REQUEST'));
      }
    } finally { gate.release(); }
    rejected(await reading, 'DOCUMENT_OR_VERSION_NOT_FOUND');
    if (phase === 'pending') await store.remove(request);
    await revoked(doc); checks.push(`embedded_output_rechecks_${phase}_deletion_after_engine_open`);
  }
  // The new guard must not confuse a normal edit with deletion. Old versions
  // remain readable, and a receipt already confirmed before staleness replays.
  const retained = await create(), retainedGate = barrier();
  const oldRead = outcome(createVersionStore(db, pausedReader(retainedGate)).read({ owner,
    document_id: retained.document_id, version_id: retained.version_id }));
  let latest;
  const retainedWrite = write(retained);
  try { await reached(retainedGate); latest = await store.replace(retainedWrite); }
  finally { retainedGate.release(); }
  const oldResult = await oldRead;
  assert.equal(oldResult.ok, true); assert.equal(oldResult.value.version_id, retained.version_id);
  assert.deepEqual(oldResult.value.bytes, bytes); assert.notEqual(latest.version_id, retained.version_id);
  const replay = await store.replace(retainedWrite);
  assert.equal(replay.replayed, true); assert.equal(replay.version_id, latest.version_id);
  await intact(); checks.push('normal_edit_does_not_revoke_readable_pinned_old_version');

  // A failed final authorization query must not release the buffered bytes.
  let readQueries = 0;
  const unavailableDb = { batch: (...args) => db.batch(...args), prepare(sql) {
    const raw = db.prepare(sql);
    return { bind(...values) {
      const bound = raw.bind(...values);
      if (sql.startsWith('SELECT 1 AS allowed FROM hwp_documents d')) return { async first() {
        readQueries++; throw new Error('PRIVATE_INJECTED_AUTH_CHECK_FAILURE');
      } };
      return bound;
    } };
  } };
  await assert.rejects(() => createVersionStore(unavailableDb, bucket).read({ owner, document_id: retained.document_id }),
    code('STORAGE_UNAVAILABLE'));
  assert.equal(readQueries, 1); await intact(); checks.push('unavailable_final_read_guard_fails_closed');

  // Refuse already-deleting/deleted/stale documents before another R2 PUT.
  for (const phase of ['pending', 'complete', 'stale']) {
    const doc = await create(), request = deletion(doc); let puts = 0;
    if (phase === 'pending') {
      const unavailable = { put: (...args) => bucket.put(...args), get: (...args) => bucket.get(...args),
        async delete() { throw new Error('PRIVATE_INJECTED_DELETE_FAILURE'); } };
      await assert.rejects(() => createVersionStore(db, unavailable).remove(request), code('DELETE_INCOMPLETE_RETRY_SAME_REQUEST'));
    } else if (phase === 'complete') await store.remove(request);
    else await store.replace(write(doc));
    const spy = { get: (...args) => bucket.get(...args), delete: (...args) => bucket.delete(...args),
      put(...args) { puts++; return bucket.put(...args); } };
    await assert.rejects(() => createVersionStore(db, spy).replace(write(doc)), code('VERSION_CONFLICT_OR_HISTORY_LIMIT'));
    assert.equal(puts, 0);
    if (phase === 'pending') await store.remove(request);
    await intact();
  }
  checks.push('pending_complete_deletion_and_stale_version_refuse_before_r2_put');

  // The early guard is NOT a lock: deletion can still happen after it. The
  // final transactional guard must reject both late-write schedules and the
  // acknowledged losing writer must clean ONLY its exact random candidate.
  for (const timing of ['before_put', 'after_put']) {
    const doc = await create(), gate = barrier();
    const heldWriter = { get: (...args) => bucket.get(...args), delete: (...args) => bucket.delete(...args),
      async put(...args) {
        if (timing === 'before_put') await gate.pause();
        const result = await bucket.put(...args);
        if (timing === 'after_put') await gate.pause();
        return result;
      } };
    const writing = outcome(createVersionStore(db, heldWriter).replace(write(doc)));
    try { await reached(gate); await store.remove(deletion(doc)); }
    finally { gate.release(); }
    rejected(await writing, 'VERSION_CONFLICT_OR_HISTORY_LIMIT');
    await revoked(doc); assert.equal((await keys(doc)).length, 0);
    checks.push(`delete_wins_${timing}_writer_cannot_resurrect_document_and_cleans_candidate`);
  }

  // Save committed, but its response/receipt is held while an explicit deletion
  // of that NEW current version completes. Report deleted, not a save retry.
  for (const phase of ['pending', 'complete']) for (const lostAck of [false, true]) {
    const doc = await create(), gate = barrier();
    let removeRequest;
    const heldDb = { prepare: (...args) => db.prepare(...args), async batch(statements) {
      const result = await db.batch(statements); await gate.pause();
      if (lostAck) throw new Error('PRIVATE_INJECTED_ACK_LOSS');
      return result;
    } };
    const writing = outcome(createVersionStore(heldDb, bucket).replace(write(doc)));
    try {
      await reached(gate);
      const current = await db.prepare('SELECT current_version FROM hwp_documents WHERE owner = ? AND id = ?')
        .bind(owner, doc.document_id).first();
      assert.notEqual(current.current_version, doc.version_id);
      removeRequest = { ...deletion(doc), expected_version: current.current_version };
      if (phase === 'complete') {
        const removed = await store.remove(removeRequest);
        assert.equal(removed.recorded_versions_removed, 2);
      } else {
        const failedDeletion = { put: (...args) => bucket.put(...args), get: (...args) => bucket.get(...args),
          async delete() { throw new Error('PRIVATE_INJECTED_DELETE_FAILURE'); } };
        await assert.rejects(() => createVersionStore(db, failedDeletion).remove(removeRequest),
          code('DELETE_INCOMPLETE_RETRY_SAME_REQUEST'));
      }
    } finally { gate.release(); }
    rejected(await writing, phase === 'complete' ? 'DOCUMENT_DELETED' : 'DOCUMENT_DELETION_IN_PROGRESS');
    if (phase === 'pending') await store.remove(removeRequest);
    await revoked(doc); assert.equal((await keys(doc)).length, 0);
    checks.push(`committed_save_then_delete_reports_${phase}_${lostAck ? 'lost' : 'normal'}_ack`);
  }
  console.log(JSON.stringify({ deletion_races: 'passed', checks, actual_workerd_d1_r2_and_synthetic_hwp: true,
    timing_and_identity_are_injected: true, real_oauth_revocation_verified: false,
    production_unpublished_blob_gc_verified: false, already_delivered_bytes_cannot_be_revoked: true }));
} finally { await mf.dispose(); }
