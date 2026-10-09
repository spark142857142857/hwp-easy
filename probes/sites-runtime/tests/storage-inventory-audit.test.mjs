import assert from 'node:assert/strict';
import test from 'node:test';
import { auditStorageInventory, StorageInventoryAuditError, storageInventoryLimits } from '../scripts/storage-inventory-audit.mjs';
const key = (owner = 'synthetic:a') => `hwp-easy/v1/${owner}/${crypto.randomUUID()}/${crypto.randomUUID()}.hwp`;
const rejection = code => error => error instanceof StorageInventoryAuditError && error.code === code && error.message === code;
const page = (objects = [], cursor = null) => ({ objects, cursor, truncated: cursor !== null });
const run = (records, objects) => auditStorageInventory(records, { listBlobPage: async () => page(objects) });

test('complete pagination accounts for recorded, unreferenced and unrelated objects without deletion or private keys', async () => {
  const first = key(), second = key('synthetic:b'), candidate = key(), deleted = key('synthetic:deleted');
  const records = [{ blob_key: first, byte_size: 3 }, { blob_key: second, byte_size: 5 }];
  const pages = [page([{ key: first, size: 3 }, { key: candidate, size: 7 }], 'PRIVATE_CURSOR'),
    page([{ key: second, size: 5 }, { key: deleted, size: 11 }, { key: 'PRIVATE_UNRELATED_PATH', size: 13 }])];
  const cursors = [], before = structuredClone({ records, pages });
  const result = await auditStorageInventory(records, { listBlobPage: async cursor => {
    cursors.push(cursor); return pages[cursors.length - 1];
  } });
  assert.deepEqual(cursors, [null, 'PRIVATE_CURSOR']);
  assert.deepEqual(result, { audit: 'passed', pages: 2, objects: 5, recorded_objects: 2, recorded_bytes: 8,
    unreferenced_managed_objects: 2, unreferenced_managed_bytes: 18, other_objects: 1, other_bytes: 13,
    atomic_snapshot_verified: false, listing_completeness_independently_verified: false,
    unreferenced_objects_deletable: false, cleaned: false, production_GC_verified: false });
  assert.deepEqual({ records, pages }, before);
  for (const privateValue of [first, second, candidate, deleted, 'PRIVATE_CURSOR', 'PRIVATE_UNRELATED_PATH', 'synthetic:'])
    assert(!JSON.stringify(result).includes(privateValue));
  assert(Object.isFrozen(result));
});

test('missing recorded objects and same-size objects from another owner cannot pass', async () => {
  const first = key(), record = { blob_key: first, byte_size: 3 };
  const otherOwner = first.replace('synthetic:a', 'synthetic:b');
  for (const objects of [[], [{ key: otherOwner, size: 3 }]])
    await assert.rejects(() => run([record], objects), rejection('STORAGE_INVENTORY_RECORDED_OBJECT_MISSING'));
  await assert.rejects(() => run([record], [{ key: first, size: 4 }]), rejection('STORAGE_INVENTORY_RECORDED_SIZE_MISMATCH'));
});

test('duplicates within or across pages invalidate an inventory', async () => {
  const first = key(), row = { key: first, size: 3 };
  await assert.rejects(() => run([], [row, row]), rejection('STORAGE_INVENTORY_DUPLICATE_KEY'));
  let calls = 0;
  await assert.rejects(() => auditStorageInventory([], { listBlobPage: async () => page([row], calls++ === 0 ? 'next' : null) }),
    rejection('STORAGE_INVENTORY_DUPLICATE_KEY'));
});

test('truncated empty pages and repeated cursors fail instead of reporting a partial inventory', async () => {
  await assert.rejects(() => auditStorageInventory([], { listBlobPage: async () => page([], 'next') }),
    rejection('STORAGE_INVENTORY_PAGINATION_STALLED'));
  let calls = 0;
  await assert.rejects(() => auditStorageInventory([], { listBlobPage: async () => page([{ key: `unknown-${calls++}`, size: 0 }], 'same') }),
    rejection('STORAGE_INVENTORY_PAGINATION_STALLED'));
  assert.equal(calls, 2);
});

test('invalid record schema or arbitrary paths are rejected before listing', async () => {
  for (const records of [null, [{ blob_key: '../PRIVATE_PATH', byte_size: 1 }],
    [{ blob_key: key(), byte_size: 0 }], [{ blob_key: key(), byte_size: 1, extra: 'PRIVATE_NAME' }]]) {
    let calls = 0;
    await assert.rejects(() => auditStorageInventory(records, { listBlobPage: async () => { calls++; return page(); } }),
      rejection('INVALID_STORAGE_INVENTORY'));
    assert.equal(calls, 0);
  }
  const row = { blob_key: key(), byte_size: 1 };
  await assert.rejects(() => run([row, row], []), rejection('STORAGE_INVENTORY_DUPLICATE_KEY'));
});

test('untrusted listing shape, sizes, cursors and unknown fields are rejected', async () => {
  for (const bad of [null, { objects: [], truncated: false }, { ...page(), extra: 'PRIVATE_VALUE' },
    { ...page(), cursor: 'unexpected' }, { objects: [], truncated: true, cursor: '' },
    { objects: [], truncated: true, cursor: 'x'.repeat(storageInventoryLimits.max_cursor_utf16_units + 1) },
    page([{ key: '', size: 1 }]), page([{ key: 'x'.repeat(storageInventoryLimits.max_key_utf16_units + 1), size: 1 }]),
    page([{ key: key(), size: -1 }]), page([{ key: key(), size: 1.1 }]),
    page([{ key: key(), size: 1, uploaded: 'PRIVATE_TIME' }])])
    await assert.rejects(() => auditStorageInventory([], { listBlobPage: async () => bad }), rejection('INVALID_STORAGE_INVENTORY'));
});

test('listing failures do not reveal upstream credentials or a successful prefix', async () => {
  let calls = 0;
  await assert.rejects(() => auditStorageInventory([], { listBlobPage: async () => {
    if (!calls++) return page([{ key: key(), size: 1 }], 'PRIVATE_CURSOR');
    throw new Error('PRIVATE_TOKEN_AND_KEY');
  } }), error => {
    assert(rejection('STORAGE_INVENTORY_LIST_UNAVAILABLE')(error));
    assert(!('cause' in error)); assert(!String(error).includes('PRIVATE_TOKEN_AND_KEY')); return true;
  });
});

test('object, page, record and accumulated string budgets bound incomplete scans', async () => {
  await assert.rejects(() => run(Array(storageInventoryLimits.max_recorded_versions + 1).fill({}), []),
    rejection('STORAGE_INVENTORY_LIMIT_EXCEEDED'));
  await assert.rejects(() => run([], Array(storageInventoryLimits.max_objects + 1).fill({ key: 'x', size: 0 })),
    rejection('STORAGE_INVENTORY_LIMIT_EXCEEDED'));
  let calls = 0;
  await assert.rejects(() => auditStorageInventory([], { listBlobPage: async () => page([{ key: `object-${calls}`, size: 0 }], `cursor-${calls++}`) }),
    rejection('STORAGE_INVENTORY_LIMIT_EXCEEDED'));
  assert.equal(calls, storageInventoryLimits.max_pages);
  const longKeys = Array.from({ length: 5000 }, (_, i) => ({ key: String(i).padEnd(1024, 'x'), size: 0 }));
  await assert.rejects(() => run([], longKeys), rejection('STORAGE_INVENTORY_LIMIT_EXCEEDED'));
  await assert.rejects(() => run([], [{ key: key(), size: Number.MAX_SAFE_INTEGER }, { key: 'other', size: 1 }]),
    rejection('STORAGE_INVENTORY_LIMIT_EXCEEDED'));
});

test('recorded keys and sizes are snapshotted before asynchronous listing', async () => {
  const first = key(), records = [{ blob_key: first, byte_size: 3 }];
  const result = await auditStorageInventory(records, { listBlobPage: async () => {
    records[0].blob_key = key(); records[0].byte_size = 9; return page([{ key: first, size: 3 }]);
  } });
  assert.equal(result.recorded_objects, 1); assert.equal(result.recorded_bytes, 3);
});

test('an empty complete inventory is allowed while every destructive/operational claim stays false', async () => {
  const result = await run([], []);
  assert.equal(result.objects, 0); assert.equal(result.pages, 1);
  assert.equal(result.unreferenced_objects_deletable, false); assert.equal(result.atomic_snapshot_verified, false);
  assert.equal(result.cleaned, false); assert.equal(result.production_GC_verified, false);
});
