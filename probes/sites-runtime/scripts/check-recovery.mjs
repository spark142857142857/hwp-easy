// Synthetic-only, two independent local workerd D1/R2 stores. No operational
// export/import, user-selected path, credential, external file or network access.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';
import { pathToFileURL } from 'node:url';
import { createHash } from 'node:crypto';
import { Miniflare, convertV4MiniflareOptions } from 'miniflare';
import { HwpDocument, initSync } from '@rhwp/core';
import { createDocumentEngine } from '../engine/document.mjs';
import { mixedFixture, MIXED_TEXT, MIXED_REPLACEMENT } from '../tests/mixed-style-fixtures.mjs';
import { createVersionStore } from '../storage/store.mjs';
import { createDocumentService } from '../storage/service.mjs';
import { authenticatedOwner } from '../host/transfer.mjs';
import { applyTestMigrations } from './migrations.mjs';
import { auditRecoverySnapshot, recoveryColumns, RecoveryAuditError } from './recovery-audit.mjs';

if (process.argv.length !== 2) throw Error('Synthetic recovery check accepts no arguments');
const require = createRequire(import.meta.url);
initSync({ module: fs.readFileSync(new URL('./rhwp_bg.wasm', pathToFileURL(require.resolve('@rhwp/core')))) });
const engine = createDocumentEngine(HwpDocument), bytes = mixedFixture(HwpDocument, 'cell', { merged: true });
const sha = bytes => createHash('sha256').update(bytes).digest('hex');
const origin = 'https://recovery.invalid';
const identity = id => ({ 'oai-authenticated-user-id': id, 'oai-authenticated-user-email': 'same@example.invalid' });
const a = identity('synthetic-recovery-a'), b = identity('synthetic-recovery-b');
const ownerA = await authenticatedOwner(new Headers(a)), ownerB = await authenticatedOwner(new Headers(b));
assert.notEqual(ownerA, ownerB);
const tempRoot = fs.realpathSync(os.tmpdir()), persist = fs.mkdtempSync(path.join(tempRoot, 'hwp-easy-recovery-'));
const options = name => convertV4MiniflareOptions({ compatibilityDate: '2026-10-01',
  resourcePersistencePath: path.join(persist, name), modulesRoot: path.resolve('dist/server'),
  modules: [{ type: 'ESModule', path: path.resolve('dist/server/index.js') },
    { type: 'CompiledWasm', path: path.resolve('dist/server/rhwp_bg.wasm') }],
  d1Databases: { DB: `${name}-d1` }, r2Buckets: { BUCKET: `${name}-r2` },
  bindings: { HWP_EASY_ORIGIN: origin, HWP_EASY_ALLOW_UPLOADS: 'false', HWP_EASY_FILE_ORIGINS: '[]' },
  outboundService: () => { throw Error('UNEXPECTED_NETWORK'); } });
const capture = async db => {
  const tables = Object.keys(recoveryColumns), results = await db.batch(tables.map(table => db.prepare(`SELECT * FROM ${table} ORDER BY owner, ${table === 'hwp_deletions' ? 'document_id' : 'id'}`)));
  return { format: 'hwp-easy-recovery-v1', tables: Object.fromEntries(tables.map((table, i) => [table, results[i].results])) };
};
const code = expected => error => error.code === expected && error.message === expected;
const auditCode = expected => error => error instanceof RecoveryAuditError && code(expected)(error);
let source, recovered;
const checks = [];
try {
  source = new Miniflare(options('source'));
  const db = await source.getD1Database('DB'), bucket = await source.getR2Bucket('BUCKET');
  await applyTestMigrations(db);
  const store = createVersionStore(db, bucket), service = createDocumentService(engine, store), sharedRequest = crypto.randomUUID();
  const created = await service.create({ owner: ownerA, request_id: sharedRequest, bytes });
  const other = await service.create({ owner: ownerB, request_id: sharedRequest, bytes });
  const original = await service.open({ owner: ownerA, document_id: created.document_id });
  const block = original.snapshot.read({ expected_sha256: created.sha256 }).blocks.find(block => block.text === MIXED_TEXT);
  const request = { expected_sha256: created.sha256, operations: [{ target_id: block.target_id,
    expected_old: MIXED_TEXT, new_text: MIXED_REPLACEMENT }] };
  const editArgs = { owner: ownerA, document_id: created.document_id, expected_version: created.version_id,
    request_id: crypto.randomUUID(), request };
  const edited = await service.edit(editArgs);
  const restoreArgs = { owner: ownerA, document_id: created.document_id, expected_version: edited.version_id,
    source_version: created.version_id, request_id: crypto.randomUUID() };
  const restored = await service.restore(restoreArgs);
  assert.equal(restored.sha256, created.sha256); assert.notEqual(restored.version_id, created.version_id);
  await store.renameDocument({ owner: ownerA, document_id: created.document_id, display_name: '합성 복구 전 이름', expected_name_revision: 0 });
  const renameArgs = { owner: ownerA, document_id: created.document_id, display_name: '합성 복구 양식 😀', expected_name_revision: 1 };
  await store.renameDocument(renameArgs);
  const deletedCreateArgs = { owner: ownerA, request_id: crypto.randomUUID(), bytes };
  const deleted = await service.create(deletedCreateArgs);
  const preDeletion = await capture(db);
  const deleteArgs = { owner: ownerA, document_id: deleted.document_id, expected_version: deleted.version_id, request_id: crypto.randomUUID() };
  await store.remove(deleteArgs);
  // An unreferenced candidate is deliberately excluded from the recorded-version
  // recovery set. The inventory only reports it; no GC/deletion is performed.
  const orphanKey = `hwp-easy/v1/${ownerA}/${crypto.randomUUID()}/${crypto.randomUUID()}.hwp`;
  await bucket.put(orphanKey, bytes);
  const snapshot = await capture(db);
  const latestDeletions = (await db.prepare('SELECT * FROM hwp_deletions ORDER BY owner,document_id').all()).results;
  const blobs = new Map();
  for (const row of snapshot.tables.hwp_versions)
    blobs.set(row.blob_key, new Uint8Array(await (await bucket.get(row.blob_key)).arrayBuffer()));
  assert.equal(blobs.size, 4); assert(!blobs.has(orphanKey));
  assert.equal((await bucket.list()).objects.length, 5);
  checks.push('quiescent_synthetic_capture_has_four_recorded_versions_and_excludes_unpublished_blob');
  const audit = input => auditRecoverySnapshot(input, { latestDeletions, readBlob: async key => blobs.get(key) });
  const proof = await audit(snapshot);
  assert.equal(proof.documents, 2); assert.equal(proof.deletions, 1);
  assert.deepEqual(await capture(db), snapshot); // Audit is read-only.
  checks.push('metadata_owners_names_current_pointers_revisions_receipts_and_hashes_audited');
  const listedBefore = (await bucket.list()).objects.map(object => ({ key: object.key, size: object.size }));
  const allHashesBefore = new Map();
  for (const object of listedBefore)
    allHashesBefore.set(object.key, sha(new Uint8Array(await (await bucket.get(object.key)).arrayBuffer())));
  let inventoryPages = 0;
  const inventoryProof = await auditRecoverySnapshot(snapshot, { latestDeletions, readBlob: async key => blobs.get(key),
    listBlobPage: async cursor => {
      const result = await bucket.list({ limit: 2, ...(cursor === null ? {} : { cursor }) });
      inventoryPages++;
      return { objects: result.objects.map(object => ({ key: object.key, size: object.size })),
        truncated: result.truncated, cursor: result.truncated ? result.cursor : null };
    } });
  assert.equal(inventoryPages, 3); assert.equal(inventoryProof.storage_inventory.objects, 5);
  assert.equal(inventoryProof.storage_inventory.recorded_objects, 4);
  assert.equal(inventoryProof.storage_inventory.unreferenced_managed_objects, 1);
  assert.equal(inventoryProof.storage_inventory.unreferenced_managed_bytes, bytes.length);
  assert.equal(inventoryProof.storage_inventory.unreferenced_objects_deletable, false);
  assert(!JSON.stringify(inventoryProof).includes(orphanKey));
  assert.deepEqual(await capture(db), snapshot);
  assert.deepEqual((await bucket.list()).objects.map(object => ({ key: object.key, size: object.size })), listedBefore);
  for (const [key, hash] of allHashesBefore)
    assert.equal(sha(new Uint8Array(await (await bucket.get(key)).arrayBuffer())), hash);
  checks.push('paginated_read_only_inventory_reports_one_unpublished_blob_and_preserves_all_metadata_and_five_blobs');
  await assert.rejects(() => audit(preDeletion), auditCode('RECOVERY_DELETION_LEDGER_MISMATCH'));
  const missingTombstone = structuredClone(snapshot); missingTombstone.tables.hwp_deletions = [];
  await assert.rejects(() => audit(missingTombstone), auditCode('RECOVERY_DELETION_LEDGER_MISMATCH'));
  checks.push('older_recovery_point_and_missing_tombstone_refused_against_later_authoritative_deletion');
  const missingDeletedReceipt = structuredClone(snapshot);
  missingDeletedReceipt.tables.hwp_requests = missingDeletedReceipt.tables.hwp_requests.filter(row=>row.document_id!==deleted.document_id);
  await assert.rejects(()=>audit(missingDeletedReceipt),auditCode('RECOVERY_METADATA_INCONSISTENT'));
  checks.push('missing_old_creation_receipt_of_deleted_document_refused_before_recovery');
  await assert.rejects(() => auditRecoverySnapshot(snapshot, { latestDeletions, readBlob: async()=>null }), auditCode('RECOVERY_BLOB_MISSING_OR_CORRUPT'));
  await assert.rejects(() => auditRecoverySnapshot(snapshot, { latestDeletions, readBlob: async key => {
    const corrupt = blobs.get(key).slice(); corrupt[corrupt.length-1] ^= 1; return corrupt;
  } }), auditCode('RECOVERY_BLOB_MISSING_OR_CORRUPT'));
  const wrongKey = structuredClone(snapshot); wrongKey.tables.hwp_versions[0].blob_key = orphanKey;
  let reads = 0;
  await assert.rejects(() => auditRecoverySnapshot(wrongKey, { latestDeletions, readBlob: async()=>{ reads++; } }), auditCode('RECOVERY_METADATA_INCONSISTENT'));
  assert.equal(reads,0);
  checks.push('missing_corrupt_and_cross_document_blob_metadata_refused_before_recovery');
  await source.dispose(); source = undefined; // Nothing below reads source storage.
  recovered = new Miniflare(options('recovered'));
  let recoveredDb = await recovered.getD1Database('DB'), recoveredBucket = await recovered.getR2Bucket('BUCKET');
  await applyTestMigrations(recoveredDb);
  for (const table of Object.keys(recoveryColumns))
    assert.equal((await recoveredDb.prepare(`SELECT count(*) AS n FROM ${table}`).first()).n, 0);
  assert.equal((await recoveredBucket.list()).objects.length,0);
  // This fixed synthetic test setup is NOT exposed as an operational importer.
  await audit(snapshot);
  for (const row of snapshot.tables.hwp_versions) {
    const result = await recoveredBucket.put(row.blob_key, blobs.get(row.blob_key), {
      onlyIf: { etagDoesNotMatch: '*' }, sha256: row.sha256, httpMetadata: { contentType: 'application/x-hwp' } });
    assert(result);
  }
  await recoveredDb.batch(Object.entries(recoveryColumns).flatMap(([table, columns]) => snapshot.tables[table].map(row =>
    recoveredDb.prepare(`INSERT INTO ${table} (${columns.join(',')}) VALUES (${columns.map(()=>'?').join(',')})`).bind(...columns.map(column=>row[column])))));
  assert.deepEqual(await capture(recoveredDb), snapshot);
  assert.equal((await recoveredBucket.list()).objects.length,4);
  assert.equal(await recoveredBucket.get(orphanKey),null);
  checks.push('fresh_isolated_D1_R2_populated_only_with_audited_metadata_and_recorded_blobs');
  await recovered.dispose(); recovered = new Miniflare(options('recovered'));
  recoveredDb = await recovered.getD1Database('DB'); recoveredBucket = await recovered.getR2Bucket('BUCKET');
  const newStore = createVersionStore(recoveredDb,recoveredBucket), newService = createDocumentService(engine,newStore);
  assert.deepEqual(await capture(recoveredDb),snapshot);
  checks.push('new_recovery_runtime_reopens_independent_persisted_store');
  for (const version of [created,edited,restored,other]) {
    const owner = version.document_id === other.document_id ? ownerB : ownerA;
    const saved = await newStore.read({ owner, document_id:version.document_id,version_id:version.version_id });
    assert.equal(sha(saved.bytes),version.sha256);
    const opened = await newService.open({ owner,document_id:version.document_id,version_id:version.version_id });
    const read = opened.snapshot.read({expected_sha256:version.sha256});
    assert.equal(read.content_complete,true);
    assert.equal(read.blocks.find(b=>b.text===MIXED_TEXT||b.text===MIXED_REPLACEMENT).text,version.version_id===edited.version_id?MIXED_REPLACEMENT:MIXED_TEXT);
  }
  assert.equal((await newStore.history({owner:ownerA,document_id:created.document_id})).length,3);
  assert.equal((await newStore.read({owner:ownerA,document_id:created.document_id})).version_id,restored.version_id);
  assert.equal((await newStore.documentName({owner:ownerA,document_id:created.document_id})).name_revision,2);
  checks.push('all_four_HWP_versions_reopen_with_original_mixed_styles_current_revision_and_names');
  assert.equal((await newService.create({owner:ownerA,request_id:sharedRequest,bytes})).version_id,created.version_id);
  assert.equal((await newService.create({owner:ownerB,request_id:sharedRequest,bytes})).version_id,other.version_id);
  assert.equal((await newService.edit(editArgs)).version_id,edited.version_id);
  assert.equal((await newService.restore(restoreArgs)).version_id,restored.version_id);
  assert.equal((await newStore.renameDocument(renameArgs)).replayed,true);
  await assert.rejects(()=>newService.edit({...editArgs,request_id:crypto.randomUUID()}),code('VERSION_CONFLICT'));
  assert.deepEqual(await capture(recoveredDb),snapshot);
  checks.push('creation_edit_restore_name_exact_retries_and_stale_write_guard_survive_recovery');
  assert.equal((await newStore.remove(deleteArgs)).replayed,true);
  await assert.rejects(()=>newService.create(deletedCreateArgs),code('DOCUMENT_DELETED'));
  await assert.rejects(()=>newStore.read({owner:ownerA,document_id:deleted.document_id}),code('DOCUMENT_OR_VERSION_NOT_FOUND'));
  checks.push('completed_deletion_and_old_creation_replay_cannot_resurrect_deleted_document');
  const route = version => `${origin}/documents/${version.document_id}/versions/${version.version_id}`;
  for (const version of [created,edited,restored,other]) {
    const headers=version.document_id===other.document_id?b:a;
    const response=await recovered.dispatchFetch(route(version)+'.hwp',{headers});
    assert.equal(response.status,200);assert.equal(sha(new Uint8Array(await response.arrayBuffer())),version.sha256);
  }
  assert.equal((await recovered.dispatchFetch(route(created)+'.hwp')).status,401);
  assert.equal((await recovered.dispatchFetch(route(created)+'.hwp',{headers:b})).status,404);
  for (const suffix of ['/view','.hwp'])
    assert.equal((await recovered.dispatchFetch(route(deleted)+suffix,{headers:a})).status,404);
  const view=await recovered.dispatchFetch(route(restored)+'/view',{headers:a});
  assert.equal(view.status,200);assert((await view.text()).includes('혼합 글자 서식의 제한된 치환 후보: 1곳'));
  const svg=await recovered.dispatchFetch(`${route(restored)}/pages/0.svg`,{headers:a});
  assert.equal(svg.status,200);assert((await svg.text()).includes('<svg'));
  assert.deepEqual(await capture(recoveredDb),snapshot);
  checks.push('compiled_HTTP_download_preview_and_mock_owner_denial_enforce_restored_state');
  const recoveredAudit=await auditRecoverySnapshot(await capture(recoveredDb),{latestDeletions,readBlob:async key=>new Uint8Array(await (await recoveredBucket.get(key)).arrayBuffer())});
  assert.deepEqual(recoveredAudit,proof);
  checks.push('post_restart_recovery_audit_matches_capture_and_every_recorded_blob_hash');
  console.log(JSON.stringify({synthetic_recovery:'passed',checks,recovered_documents:2,recovered_versions:4,
    completed_deletion_receipts:1,actual_local_workerd_D1_R2:true,source_runtime_disposed_before_recovery:true,
    independent_recovery_store_restarted:true,actual_OAuth_verified:false,operational_backup_export_verified:false,
    platform_backup_restore_verified:false,deletion_ledger_freshness_in_production_verified:false,
    synthetic_storage_inventory:inventoryProof.storage_inventory,
    unpublished_blob_GC_verified:false,layout_verified:false}));
} finally {
  if(source)await source.dispose();if(recovered)await recovered.dispose();
  const resolved=fs.realpathSync(persist),relative=path.relative(tempRoot,resolved);
  if(!relative||relative.startsWith('..')||path.isAbsolute(relative)||!path.basename(resolved).startsWith('hwp-easy-recovery-'))
    throw Error('Unsafe synthetic recovery cleanup target');
  fs.rmSync(resolved,{recursive:true,force:true});
}
