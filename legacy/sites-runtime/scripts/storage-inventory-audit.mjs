// Developer-only, read-only comparison. Unreferenced objects are NOT deletion
// candidates: listing and metadata may race with an in-flight publication.
export class StorageInventoryAuditError extends Error {
  constructor(code) { super(code); this.name = 'StorageInventoryAuditError'; this.code = code; }
}
const fail = code => { throw new StorageInventoryAuditError(code); };
export const storageInventoryLimits = Object.freeze({ max_recorded_versions: 10000,
  max_objects: 20000, max_pages: 128, max_key_utf16_units: 1024,
  max_cursor_utf16_units: 1024, max_string_utf16_units: 4 * 1024 * 1024 });
const object = (value, keys) => value && Object.getPrototypeOf(value) === Object.prototype
  && Object.keys(value).sort().join(',') === [...keys].sort().join(',');
const size = value => Number.isSafeInteger(value) && value >= 0;
const key = value => typeof value === 'string' && value.length > 0
  && value.length <= storageInventoryLimits.max_key_utf16_units;
const uuid = '[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}';
const managedKey = new RegExp(`^hwp-easy/v1/[a-zA-Z0-9:_-]{1,160}/${uuid}/${uuid}\\.hwp$`);

/** listBlobPage(cursor) supplies a normalized COMPLETE bucket listing:
 * {objects:[{key,size}], truncated:boolean, cursor:string|null}.
 * No bucket client, credentials, deletion callback or object keys are returned.
 * Completion of pagination cannot establish an atomic operational snapshot. */
export async function auditStorageInventory(recordedVersions, { listBlobPage } = {}) {
  if (!Array.isArray(recordedVersions) || typeof listBlobPage !== 'function') fail('INVALID_STORAGE_INVENTORY');
  if (recordedVersions.length > storageInventoryLimits.max_recorded_versions) fail('STORAGE_INVENTORY_LIMIT_EXCEEDED');
  const recorded = new Map();
  let stringUnits = 0;
  for (const row of recordedVersions) {
    if (!object(row, ['blob_key', 'byte_size']) || !key(row.blob_key)
      || !managedKey.test(row.blob_key) || !size(row.byte_size) || row.byte_size === 0)
      fail('INVALID_STORAGE_INVENTORY');
    if (recorded.has(row.blob_key)) fail('STORAGE_INVENTORY_DUPLICATE_KEY');
    recorded.set(row.blob_key, row.byte_size); stringUnits += row.blob_key.length;
  }
  const seen = new Set(), cursors = new Set();
  let cursor = null, pages = 0, recordedCount = 0, recordedBytes = 0;
  let unreferencedCount = 0, unreferencedBytes = 0, otherCount = 0, otherBytes = 0;
  do {
    if (++pages > storageInventoryLimits.max_pages) fail('STORAGE_INVENTORY_LIMIT_EXCEEDED');
    let page;
    try { page = await listBlobPage(cursor); }
    catch { fail('STORAGE_INVENTORY_LIST_UNAVAILABLE'); }
    if (!object(page, ['objects', 'truncated', 'cursor']) || !Array.isArray(page.objects)
      || typeof page.truncated !== 'boolean'
      || (page.truncated ? typeof page.cursor !== 'string' || !page.cursor.length
        || page.cursor.length > storageInventoryLimits.max_cursor_utf16_units : page.cursor !== null))
      fail('INVALID_STORAGE_INVENTORY');
    if (page.objects.length > storageInventoryLimits.max_objects - seen.size) fail('STORAGE_INVENTORY_LIMIT_EXCEEDED');
    for (const row of page.objects) {
      if (!object(row, ['key', 'size']) || !key(row.key) || !size(row.size)) fail('INVALID_STORAGE_INVENTORY');
      if ((stringUnits += row.key.length) > storageInventoryLimits.max_string_utf16_units)
        fail('STORAGE_INVENTORY_LIMIT_EXCEEDED');
      if (seen.has(row.key)) fail('STORAGE_INVENTORY_DUPLICATE_KEY');
      seen.add(row.key);
      if (recorded.has(row.key)) {
        if (recorded.get(row.key) !== row.size) fail('STORAGE_INVENTORY_RECORDED_SIZE_MISMATCH');
        recordedCount++; recordedBytes += row.size;
      } else if (managedKey.test(row.key)) { unreferencedCount++; unreferencedBytes += row.size; }
      else { otherCount++; otherBytes += row.size; }
      if (![recordedBytes, unreferencedBytes, otherBytes, recordedBytes + unreferencedBytes + otherBytes].every(size))
        fail('STORAGE_INVENTORY_LIMIT_EXCEEDED');
    }
    if (page.truncated) {
      if (!page.objects.length || cursors.has(page.cursor)) fail('STORAGE_INVENTORY_PAGINATION_STALLED');
      cursors.add(page.cursor);
      if ((stringUnits += page.cursor.length) > storageInventoryLimits.max_string_utf16_units)
        fail('STORAGE_INVENTORY_LIMIT_EXCEEDED');
    }
    cursor = page.cursor;
  } while (cursor !== null);
  if (recordedCount !== recorded.size) fail('STORAGE_INVENTORY_RECORDED_OBJECT_MISSING');
  return Object.freeze({ audit: 'passed', pages, objects: seen.size,
    recorded_objects: recordedCount, recorded_bytes: recordedBytes,
    unreferenced_managed_objects: unreferencedCount, unreferenced_managed_bytes: unreferencedBytes,
    other_objects: otherCount, other_bytes: otherBytes,
    atomic_snapshot_verified: false, listing_completeness_independently_verified: false,
    unreferenced_objects_deletable: false,
    cleaned: false, production_GC_verified: false });
}
