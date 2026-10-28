// Real ephemeral workerd D1/R2 plus synthetic HWP; fault injection is NOT OAuth.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { pathToFileURL } from 'node:url';
import { Miniflare, convertV4MiniflareOptions } from 'miniflare';
import { HwpDocument, initSync } from '@rhwp/core';
import { createEngineApi } from '../../../src/one_hwp/rhwp_api.mjs';
import { syntheticFixture } from '../../../src/one_hwp/synthetic_fixtures.mjs';
import { createDocumentEngine } from '../../../src/one_hwp/engine/document.mjs';
import { createDocumentService } from '../storage/service.mjs';
import { createVersionStore, StorageError } from '../storage/store.mjs';
import { createHostApp } from '../host/app.mjs';
import { authenticatedOwner } from '../host/transfer.mjs';
import { applyTestMigrations } from './migrations.mjs';
const require = createRequire(import.meta.url);
initSync({ module: fs.readFileSync(new URL('./rhwp_bg.wasm', pathToFileURL(require.resolve('@rhwp/core')))) });
const mf = new Miniflare(convertV4MiniflareOptions({ compatibilityDate: '2026-10-01',
  modulesRoot: path.resolve('dist/server'), modules: [
    { type: 'ESModule', path: path.resolve('dist/server/index.js') },
    { type: 'CompiledWasm', path: path.resolve('dist/server/rhwp_bg.wasm') }],
  d1Databases: { DB: 'fault-d1' }, r2Buckets: { BUCKET: 'fault-r2' } }));
const checks = [], code = (expected) => (e) => e.code === expected && e.message === expected;
const origin = 'https://probe.invalid', headers = new Headers({
  'oai-authenticated-user-id': 'synthetic-fault-owner', 'oai-authenticated-user-email': 'fault@example.invalid' });
try {
  const db = await mf.getD1Database('DB'), bucket = await mf.getR2Bucket('BUCKET');
  await applyTestMigrations(db);
  const owner = await authenticatedOwner(headers), engine = createDocumentEngine(HwpDocument);
  const api = createEngineApi(HwpDocument), bytes = syntheticFixture(HwpDocument, api.exportChecked);
  const store = createVersionStore(db, bucket), service = createDocumentService(engine, store);
  const marker = await service.create({ owner, request_id: crypto.randomUUID(), bytes });
  const baselineKeys = (await bucket.list()).objects.map((o) => o.key).sort();
  const request = new Request(`${origin}/mcp`, { headers });
  const app = (DB = db, BUCKET = bucket, candidateEngine = engine) => createHostApp({
    DB, BUCKET, HWP_EASY_ORIGIN: origin }, candidateEngine, HwpDocument);
  const intact = async () => {
    assert.deepEqual((await bucket.list()).objects.map((o) => o.key).sort(), baselineKeys);
    assert.equal((await db.prepare('SELECT count(*) AS n FROM hwp_documents').first()).n, 1);
    assert.deepEqual((await store.read({ owner, document_id: marker.document_id })).bytes, bytes);
  };
  const invoke = (host) => host.call('hwp_workflow_probe', {}, request);

  for (const mode of ['before_commit', 'lost_ack_and_receipt']) {
    let batches = 0, failed = false;
    const broken = {
      prepare(sql) {
        const raw = db.prepare(sql);
        return { bind(...values) {
          const bound = raw.bind(...values);
          if (sql.includes('SELECT r.fingerprint')) return { first: async () => {
            if (failed && mode === 'lost_ack_and_receipt') throw new Error('injected receipt failure');
            return bound.first();
          } };
          return bound;
        } };
      },
      async batch(statements) {
        if (++batches === 1) {
          if (mode === 'lost_ack_and_receipt') await db.batch(statements);
          failed = true; throw new Error('injected commit acknowledgement failure');
        }
        return db.batch(statements);
      },
    };
    await assert.rejects(() => invoke(app(broken)), code('COMMIT_OUTCOME_UNKNOWN'));
    await intact(); checks.push(`generated_scope_cleaned_${mode}`);
  }

  let firstPut = true, firstDelete = true;
  const lostBlobAck = {
    get: (...a) => bucket.get(...a), list: (...a) => bucket.list(...a),
    async put(...a) {
      const result = await bucket.put(...a);
      if (firstPut) { firstPut = false; throw new Error('injected blob ack failure'); }
      return result;
    },
    async delete(...a) {
      if (firstDelete) { firstDelete = false; throw new Error('injected one-shot cleanup failure'); }
      return bucket.delete(...a);
    },
  };
  await assert.rejects(() => invoke(app(db, lostBlobAck)), code('BLOB_WRITE_FAILED'));
  await intact(); checks.push('unpublished_blob_cleaned_after_lost_put_ack_and_failed_first_cleanup');

  let opens = 0;
  const failedRead = { ...engine, async open(...a) {
    if (++opens === 2) throw new StorageError('DOCUMENT_OPERATION_FAILED');
    return engine.open(...a);
  }, async openRead(...a) {
    if (++opens === 2) throw new StorageError('DOCUMENT_OPERATION_FAILED');
    return engine.openRead(...a);
  } };
  await assert.rejects(() => invoke(app(db, bucket, failedRead)), code('DOCUMENT_OPERATION_FAILED'));
  await intact(); checks.push('read_failure_cleans_generated_document_not_existing_document');

  // These injected cleanup failures MUST stop before deleting any unrelated
  // data. Recovery below addresses only newly created ids in this local test.
  const recoverLocalAdditions = async () => {
    const ids = (await db.prepare('SELECT id FROM hwp_documents WHERE owner = ?').bind(owner).all()).results
      .map((r) => r.id).filter((id) => id !== marker.document_id);
    for (const id of ids) {
      assert.match(id, /^[0-9a-f-]{36}$/);
      const prefix = `hwp-easy/v1/${owner}/${id}/`, objects = (await bucket.list({ prefix })).objects;
      assert(objects.every((o) => o.key.startsWith(prefix) && !baselineKeys.includes(o.key)));
      if (objects.length) await bucket.delete(objects.map((o) => o.key));
      await db.batch([
        db.prepare('DELETE FROM hwp_requests WHERE owner = ? AND document_id = ?').bind(owner, id),
        db.prepare('DELETE FROM hwp_versions WHERE owner = ? AND document_id = ?').bind(owner, id),
        db.prepare('DELETE FROM hwp_documents WHERE owner = ? AND id = ?').bind(owner, id),
      ]);
    }
    await intact();
  };
  for (const mode of ['unavailable_provenance', 'wrong_creation_receipt', 'cross_document_listing']) {
    let deletions = 0;
    const broken = {
      batch: (...a) => db.batch(...a), prepare(sql) {
        const raw = db.prepare(sql);
        return { bind(...values) {
          const bound = raw.bind(...values);
          if (mode === 'unavailable_provenance' && sql.startsWith('SELECT id FROM hwp_documents')) {
            return { first: async () => { throw new Error('injected provenance read failure'); } };
          }
          if (mode === 'wrong_creation_receipt' && sql.startsWith('SELECT document_id FROM hwp_requests')) {
            return { first: async () => ({ document_id: marker.document_id }) };
          }
          return bound;
        } };
      },
    };
    const guarded = { put: (...a) => bucket.put(...a), get: (...a) => bucket.get(...a),
      list: (...a) => mode === 'cross_document_listing' ? Promise.resolve({ objects: [{ key: baselineKeys[0] }], truncated: false }) : bucket.list(...a),
      delete: (...a) => { deletions++; return bucket.delete(...a); } };
    await assert.rejects(() => invoke(app(broken, guarded)), code('SYNTHETIC_CLEANUP_FAILED'));
    assert.equal(deletions, 0);
    assert.deepEqual((await store.read({ owner, document_id: marker.document_id })).bytes, bytes);
    await recoverLocalAdditions(); checks.push(`unsafe_cleanup_stopped_${mode}`);
  }
  console.log(JSON.stringify({ host_failure_contract: 'passed', checks,
    actual_workerd_d1_r2_and_synthetic_hwp: true, faults_and_identity_are_injected_not_oauth: true,
    existing_document_preserved: true, local_synthetic_cleanup_complete: true }));
} finally { await mf.dispose(); }
