import assert from 'node:assert/strict';
import test from 'node:test';
import { createHash } from 'node:crypto';
import { auditRecoverySnapshot, RecoveryAuditError, recoveryLimits } from '../scripts/recovery-audit.mjs';
const uuid = () => crypto.randomUUID();
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
const rejected = code => error => error instanceof RecoveryAuditError && error.code === code && error.message === code;
function fixture() {
  const documentId = uuid(), deletedId = uuid(), keys = new Map();
  const docs = [], versions = [], requests = [];
  for (const [owner, count] of [['synthetic:a', 2], ['synthetic:b', 1]]) {
    let current;
    for (let i = 0; i < count; i++) {
      const id = uuid(), bytes = new Uint8Array([1, 2, i]);
      const key = `hwp-easy/v1/${owner}/${documentId}/${id}.hwp`;
      keys.set(key, bytes); current = id;
      versions.push({ owner, document_id: documentId, id, sha256: hash(bytes), blob_key: key, byte_size: bytes.length, created_at: 1 });
      requests.push({ owner, id: uuid(), document_id: documentId, version_id: id, fingerprint: 'a'.repeat(64), created_at: 1 });
    }
    docs.push({ owner, id: documentId, current_version: current, revision: count, created_at: 1,
      display_name: 'PRIVATE_DOCUMENT_NAME', name_revision: 2 });
  }
  const deletion = { owner: 'synthetic:a', document_id: deletedId, request_id: uuid(), expected_version: uuid(),
    phase: 'complete', version_count: 1, created_at: 1, completed_at: 2 };
  requests.push({ owner: deletion.owner, id: uuid(), document_id: deletedId, version_id: deletion.expected_version,
    fingerprint: 'b'.repeat(64), created_at: 1 });
  const snapshot = { format: 'hwp-easy-recovery-v1', tables: {
    hwp_documents: docs, hwp_versions: versions, hwp_requests: requests, hwp_deletions: [deletion] } };
  return { snapshot, latestDeletions: [structuredClone(deletion)], keys };
}
const run = (f, readBlob = async key => f.keys.get(key)) => auditRecoverySnapshot(f.snapshot, { latestDeletions: f.latestDeletions, readBlob });

test('recovery audit checks every immutable version and returns aggregates without private metadata', async () => {
  const f = fixture(), lookedUp = [];
  const result = await run(f, async key => { lookedUp.push(key); return f.keys.get(key); });
  assert.equal(result.documents, 2); assert.equal(result.versions, 3);
  assert.equal(result.requests, 4); assert.equal(result.deletions, 1); assert.equal(result.bytes_checked, 9);
  assert.equal(result.deleted_request_receipts, 1); assert.equal(result.restored, false);
  assert.equal(result.latest_deletion_ledger_freshness_verified, false);
  assert.equal(result.platform_backup_restore_verified, false);
  assert.deepEqual(new Set(lookedUp), new Set(f.keys.keys()));
  assert(!JSON.stringify(result).includes('PRIVATE_DOCUMENT_NAME'));
});

test('unknown schema, absent authoritative ledger and malformed metadata fail before blob access', async () => {
  for (const mutate of [f=>{f.snapshot.format='other';}, f=>{f.snapshot.tables.hwp_documents[0].extra='private';},
    f=>{delete f.latestDeletions;}, f=>{f.snapshot.tables.hwp_versions[0].sha256='secret';},
    f=>{f.snapshot.tables.hwp_documents[0].display_name='bad\nname';}, f=>{f.snapshot.tables.hwp_requests[0].id='bad';}]) {
    const f=fixture(); mutate(f); let calls=0;
    await assert.rejects(()=>run(f,async()=>{calls++;}),rejected('INVALID_RECOVERY_SNAPSHOT'));
    assert.equal(calls,0);
  }
});

test('inconsistent pointers, ownership, keys and receipts never read arbitrary bytes', async () => {
  for (const mutate of [f=>{f.snapshot.tables.hwp_documents[0].current_version=uuid();},
    f=>{f.snapshot.tables.hwp_documents[0].revision++;}, f=>{f.snapshot.tables.hwp_versions[0].owner='synthetic:c';},
    f=>{f.snapshot.tables.hwp_versions[0].blob_key='private/path';}, f=>{f.snapshot.tables.hwp_requests.shift();},
    f=>{f.snapshot.tables.hwp_versions.push(structuredClone(f.snapshot.tables.hwp_versions[0]));},
    f=>{f.snapshot.tables.hwp_requests.push(structuredClone(f.snapshot.tables.hwp_requests[0]));},
    f=>{f.snapshot.tables.hwp_requests[0].version_id=uuid();},
    f=>{f.snapshot.tables.hwp_requests[0].id=f.snapshot.tables.hwp_deletions[0].request_id;}]) {
    const f=fixture(); mutate(f); let calls=0;
    await assert.rejects(()=>run(f,async()=>{calls++;}),rejected('RECOVERY_METADATA_INCONSISTENT'));
    assert.equal(calls,0);
  }
});

test('snapshot with a live document that has a completed tombstone is refused', async () => {
  const f=fixture(), d=f.snapshot.tables.hwp_deletions[0];
  d.document_id=f.snapshot.tables.hwp_documents[0].id;
  f.latestDeletions=structuredClone(f.snapshot.tables.hwp_deletions);
  await assert.rejects(()=>run(f),rejected('RECOVERY_METADATA_INCONSISTENT'));
});

test('post-backup deletions and missing or changed deletion receipts block recovery eligibility', async () => {
  for (const mutate of [f=>{f.latestDeletions.push({...f.latestDeletions[0],document_id:f.snapshot.tables.hwp_documents[0].id,request_id:uuid()});},
    f=>{f.snapshot.tables.hwp_deletions=[];}, f=>{f.latestDeletions[0].request_id=uuid();}]) {
    const f=fixture();mutate(f);let calls=0;
    await assert.rejects(()=>run(f,async()=>{calls++;}),rejected('RECOVERY_DELETION_LEDGER_MISMATCH'));
    assert.equal(calls,0);
  }
});

test('in-progress deletion requires reconciliation rather than restoration', async () => {
  for (const target of ['snapshot','ledger']) {
    const f=fixture(), row=target==='snapshot'?f.snapshot.tables.hwp_deletions[0]:f.latestDeletions[0];
    row.phase='pending';row.completed_at=null;
    await assert.rejects(()=>run(f),rejected('RECOVERY_DELETION_PENDING'));
  }
});

test('every deleted-version receipt including the last current version must survive recovery', async () => {
  for (const mutate of [f=>{f.snapshot.tables.hwp_requests.pop();},
    f=>{f.snapshot.tables.hwp_requests.push({...f.snapshot.tables.hwp_requests.at(-1),id:uuid()});},
    f=>{f.snapshot.tables.hwp_deletions[0].expected_version=uuid();f.latestDeletions=structuredClone(f.snapshot.tables.hwp_deletions);}]) {
    const f=fixture();mutate(f);let calls=0;
    await assert.rejects(()=>run(f,async()=>{calls++;}),rejected('RECOVERY_METADATA_INCONSISTENT'));assert.equal(calls,0);
  }
});

test('missing, truncated and hash-corrupt blobs cannot pass the audit', async () => {
  for (const read of [async()=>null,async()=>new Uint8Array([1]),async()=>new Uint8Array([9,9,9])])
    await assert.rejects(()=>run(fixture(),read),rejected('RECOVERY_BLOB_MISSING_OR_CORRUPT'));
});

test('upstream exceptions are replaced by a fixed non-disclosing error', async () => {
  await assert.rejects(()=>run(fixture(),async()=>{throw new Error('PRIVATE_TOKEN_SENTINEL');}),error=>{
    assert(rejected('RECOVERY_BLOB_UNAVAILABLE')(error)); assert(!('cause' in error));
    assert(!String(error).includes('PRIVATE_TOKEN_SENTINEL'));return true;
  });
});

test('row, individual blob, aggregate byte and document version budgets are bounded', async () => {
  for (const mutate of [f=>{f.snapshot.tables.hwp_requests=Array(recoveryLimits.max_rows_per_table+1).fill(f.snapshot.tables.hwp_requests[0]);},
    f=>{f.snapshot.tables.hwp_versions[0].byte_size=recoveryLimits.max_blob_bytes+1;},
    f=>{f.snapshot.tables.hwp_documents[0].display_name='x'.repeat(recoveryLimits.max_metadata_utf16_units+1);},
    f=>{f.snapshot.tables.hwp_versions=Array(17).fill({...f.snapshot.tables.hwp_versions[0],byte_size:recoveryLimits.max_blob_bytes});}]) {
    const f=fixture();mutate(f);let calls=0;
    await assert.rejects(()=>run(f,async()=>{calls++;}),rejected('RECOVERY_LIMIT_EXCEEDED'));assert.equal(calls,0);
  }
  const f=fixture(), original=f.snapshot.tables.hwp_versions[0], doc=f.snapshot.tables.hwp_documents[0];
  for(let i=0;i<127;i++) {
    const row={...original,id:uuid()};row.blob_key=`hwp-easy/v1/${row.owner}/${row.document_id}/${row.id}.hwp`;
    f.snapshot.tables.hwp_versions.push(row);
  }
  doc.revision=129;
  await assert.rejects(()=>run(f),rejected('RECOVERY_METADATA_INCONSISTENT'));
});

test('metadata is copied before asynchronous reads and input records are not returned or changed', async () => {
  const f=fixture(), before=structuredClone(f.snapshot);
  await run(f);assert.deepEqual(f.snapshot,before);
  let calls=0;
  const result=await run(f,async key=>{if(!calls++)f.snapshot.tables.hwp_documents[0].current_version=uuid();return f.keys.get(key);});
  assert.equal(result.audit,'passed');assert.equal(calls,3);
});

test('optional full inventory compares only validated immutable keys and omits private metadata', async () => {
  const f = fixture(), before = structuredClone(f.snapshot), candidate = `hwp-easy/v1/synthetic:a/${uuid()}/${uuid()}.hwp`;
  const result = await auditRecoverySnapshot(f.snapshot, { latestDeletions: f.latestDeletions,
    readBlob: async key => f.keys.get(key), listBlobPage: async cursor => {
      assert.equal(cursor, null);
      return { objects: [...f.keys].map(([key, bytes]) => ({ key, size: bytes.length })).concat({ key: candidate, size: 2 }),
        truncated: false, cursor: null };
    } });
  assert.equal(result.storage_inventory.recorded_objects, 3);
  assert.equal(result.storage_inventory.unreferenced_managed_objects, 1);
  assert.equal(result.storage_inventory.unreferenced_objects_deletable, false);
  assert(!JSON.stringify(result).includes(candidate)); assert(!JSON.stringify(result).includes('PRIVATE_DOCUMENT_NAME'));
  assert.deepEqual(f.snapshot, before);
});

test('invalid recovery metadata or corrupt bytes never invoke the optional inventory listing', async () => {
  for (const invalidMetadata of [true, false]) {
    const f = fixture(); if (invalidMetadata) f.snapshot.tables.hwp_versions[0].blob_key = 'PRIVATE_PATH';
    let listings = 0;
    await assert.rejects(() => auditRecoverySnapshot(f.snapshot, { latestDeletions: f.latestDeletions,
      readBlob: async () => null, listBlobPage: async () => { listings++; } }),
    rejected(invalidMetadata ? 'RECOVERY_METADATA_INCONSISTENT' : 'RECOVERY_BLOB_MISSING_OR_CORRUPT'));
    assert.equal(listings, 0);
  }
});
