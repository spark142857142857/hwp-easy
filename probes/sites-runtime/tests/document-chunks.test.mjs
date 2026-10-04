import assert from 'node:assert/strict';
import test from 'node:test';
import { documentChunkResource, createHwpChunkCollector, MAX_HWP_CHUNK_BYTES, MAX_CHUNKED_HWP_BYTES } from '../host/document-chunks.mjs';
import { validateArguments } from '../host/tools.mjs';
const meta = async (bytes) => ({ document_id: crypto.randomUUID(), version_id: crypto.randomUUID(),
  sha256: Buffer.from(await crypto.subtle.digest('SHA-256', bytes)).toString('hex') });
const part = (bytes, metadata, offset = 0, max_bytes = 1024) => documentChunkResource(bytes, metadata,
  { expected_sha256: metadata.sha256, offset, max_bytes });
const invalid = { code: 'INVALID_DOWNLOAD_CHUNK' };
test('chunk schema requires version hash and offset, rejects transport fields in whole/link mode', () => {
  const args = { document_id: crypto.randomUUID(), version_id: crypto.randomUUID() };
  const chunk = { ...args, delivery: 'chunk', expected_sha256: '0'.repeat(64), offset: 0 };
  assert.equal(validateArguments('hwp_download', chunk), true);
  for (const value of [{ ...chunk, max_bytes: 1024 }, { ...chunk, max_bytes: 65536 }])
    assert.equal(validateArguments('hwp_download', value), true);
  for (const value of [{ ...args, delivery: 'chunk' }, { ...args, offset: 0 }, { ...chunk, offset: -1 },
    { ...chunk, offset: 4194304 }, { ...chunk, max_bytes: 65537 }, { ...chunk, max_bytes: 1 },
    { ...chunk, expected_sha256: 'bad' }, { ...chunk, delivery: 'embedded' }, { ...chunk, owner: 'private' }])
    assert.equal(validateArguments('hwp_download', value), false);
});
test('all byte values roundtrip with exact immediate retries, engine verification and no aliasing', async () => {
  const bytes = Uint8Array.from({ length: 150000 }, (_, i) => i % 256), m = await meta(bytes);
  const collector = createHwpChunkCollector(m, bytes.length);
  while (collector.next_offset !== null) {
    const p = await part(bytes, m, collector.next_offset, MAX_HWP_CHUNK_BYTES);
    assert.equal(p.resource.resource.mimeType, 'application/octet-stream'); assert.equal(p.data.chunk_is_complete_hwp, false);
    await collector.accept(p.data, p.resource);
    assert.equal((await collector.accept(p.data, p.resource)).replayed, true);
  }
  let opened = 0;
  // Unit-only stand-in; actual HWP engine reopening is tested in check-host.
  const first = await collector.finalize(async (b) => { opened++; assert.deepEqual(b, bytes); b.fill(9); return { source_sha256: m.sha256 }; });
  assert.equal(opened, 1); assert.deepEqual(first, bytes); first.fill(1);
  assert.deepEqual(await collector.finalize(async () => ({ source_sha256: m.sha256 })), bytes);
});
test('invalid ranges, limits, pins and hashes never produce chunks', async () => {
  const bytes = Uint8Array.of(1, 2, 3), m = await meta(bytes);
  for (const offset of [-1, 0.5, 3, Number.MAX_SAFE_INTEGER]) await assert.rejects(part(bytes, m, offset), invalid);
  for (const max_bytes of [0, 1023, 65537, Infinity]) await assert.rejects(part(bytes, m, 0, max_bytes), invalid);
  await assert.rejects(documentChunkResource(bytes, m, { offset: 0, expected_sha256: '0'.repeat(64) }), { code: 'VERSION_CONFLICT' });
  await assert.rejects(part(Uint8Array.of(1, 9, 3), m), { code: 'BLOB_MISSING_OR_CORRUPT' });
  for (const total of [0, 1.5, MAX_CHUNKED_HWP_BYTES + 1]) assert.throws(() => createHwpChunkCollector(m, total), invalid);
  assert.throws(() => createHwpChunkCollector({ ...m, version_id: '../private' }, 3), invalid);
});
test('incomplete, gaps, overlaps and older duplicate chunks cannot be published', async () => {
  const bytes = new Uint8Array(3500), m = await meta(bytes), collector = createHwpChunkCollector(m, bytes.length);
  const first = await part(bytes, m), second = await part(bytes, m, 1024), overlap = await part(bytes, m, 512);
  await assert.rejects(collector.finalize(() => {}), { code: 'DOWNLOAD_INCOMPLETE' });
  await assert.rejects(collector.accept(second.data, second.resource), invalid); assert.equal(collector.next_offset, 0);
  await collector.accept(first.data, first.resource);
  await assert.rejects(collector.accept(overlap.data, overlap.resource), invalid); assert.equal(collector.next_offset, 1024);
  await collector.accept(second.data, second.resource);
  await assert.rejects(collector.accept(first.data, first.resource), invalid);
  await assert.rejects(collector.finalize(() => {}), { code: 'DOWNLOAD_INCOMPLETE' });
});
test('wrong document/version, sizes, metadata, malformed and short base64 do not advance', async () => {
  const bytes = new Uint8Array(4000), m = await meta(bytes), good = await part(bytes, m);
  const changes = [{ document_id: crypto.randomUUID() }, { version_id: crypto.randomUUID() }, { output_sha256: '0'.repeat(64) },
    { output_bytes: 5000 }, { chunk_bytes: 0 }, { chunk_bytes: 65537 }, { next_offset: null }, { transfer_complete: true },
    { chunk_sha256: '0'.repeat(64) }, { chunk_is_complete_hwp: true }, { output_transport: 'mcp_embedded_resource' }];
  for (const change of changes) {
    const c = createHwpChunkCollector(m, bytes.length);
    await assert.rejects(c.accept({ ...good.data, ...change }, good.resource), invalid); assert.equal(c.next_offset, 0);
  }
  for (const change of [{ mimeType: 'application/x-hwp' }, { uri: 'https://private.invalid' }, { blob: '!!!!' },
    { blob: 'B' + good.resource.resource.blob.slice(1) },
    { blob: good.resource.resource.blob.slice(0, -4) }, { blob: good.resource.resource.blob + '\n' }]) {
    const c = createHwpChunkCollector(m, bytes.length);
    await assert.rejects(c.accept(good.data, { type: 'resource', resource: { ...good.resource.resource, ...change } }), invalid);
    assert.equal(c.next_offset, 0);
  }
});
test('whole hash and engine reopen failure prevent completion even if individual chunks are consistent', async () => {
  const bytes = new Uint8Array(20), m = await meta(bytes), good = await part(bytes, m);
  const c = createHwpChunkCollector(m, bytes.length); await c.accept(good.data, good.resource);
  await assert.rejects(c.finalize(), invalid);
  await assert.rejects(c.finalize(async () => ({ source_sha256: '0'.repeat(64) })), { code: 'BLOB_MISSING_OR_CORRUPT' });
  await assert.rejects(c.finalize(async () => { throw new Error('UNIT_REOPEN_FAILURE'); }), /UNIT_REOPEN_FAILURE/);
  const wrong = { ...m, sha256: '0'.repeat(64) }, bad = createHwpChunkCollector(wrong, bytes.length);
  const d = { ...good.data, output_sha256: wrong.sha256 }, r = structuredClone(good.resource);
  r.resource.uri = r.resource.uri.replace(m.sha256, wrong.sha256);
  await bad.accept(d, r);
  await assert.rejects(bad.finalize(async () => ({ source_sha256: wrong.sha256 })), { code: 'BLOB_MISSING_OR_CORRUPT' });
});
test('async work snapshots caller buffers/metadata and refuses concurrent collector changes', async () => {
  const bytes = Buffer.alloc(2000, 2), original = new Uint8Array(bytes), m = await meta(bytes);
  const request = { expected_sha256: m.sha256, offset: 0, max_bytes: 1024 }, pending = documentChunkResource(bytes, m, request);
  const pinned = { ...m }; bytes.fill(9); m.document_id = '../bad'; request.offset = 1234;
  const p = await pending; assert.deepEqual(new Uint8Array(Buffer.from(p.resource.resource.blob, 'base64')), original.slice(0, 1024));
  const c = createHwpChunkCollector(pinned, original.length), accepting = c.accept(p.data, p.resource);
  await assert.rejects(c.accept(p.data, p.resource), invalid);
  p.data.version_id = 'bad'; p.resource.resource.blob = 'bad'; await accepting; assert.equal(c.next_offset, 1024);
});
test('exact maximum whole size and final short chunk stay bounded', async () => {
  const bytes = new Uint8Array(MAX_CHUNKED_HWP_BYTES), m = await meta(bytes);
  const p = await part(bytes, m, bytes.length - 1, MAX_HWP_CHUNK_BYTES);
  assert.equal(p.data.chunk_bytes, 1); assert.equal(p.data.transfer_complete, true); assert.equal(p.data.next_offset, null);
  const collector = createHwpChunkCollector(m, bytes.length); let count = 0;
  while (collector.next_offset !== null) {
    const chunk = await part(bytes, m, collector.next_offset, MAX_HWP_CHUNK_BYTES);
    await collector.accept(chunk.data, chunk.resource); count++;
  }
  assert.equal(count, 64);
  assert.deepEqual(await collector.finalize(async () => ({ source_sha256: m.sha256 })), bytes);
});
