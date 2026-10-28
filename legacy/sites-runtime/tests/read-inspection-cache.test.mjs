import assert from 'node:assert/strict';
import test from 'node:test';
import fs from 'node:fs';
import { createRequire } from 'node:module';
import { pathToFileURL } from 'node:url';
import { HwpDocument, initSync } from '@rhwp/core';
import { createEngineApi } from '../../../src/one_hwp/rhwp_api.mjs';
import { syntheticFixture } from '../../../src/one_hwp/synthetic_fixtures.mjs';
import { createDocumentEngine } from '../../../src/one_hwp/engine/document.mjs';
import { createReadInspectionCache } from '../../../src/one_hwp/engine/read-inspection-cache.mjs';
import { createDocumentService } from '../storage/service.mjs';
import { profileSyntheticEngine } from '../../../tests/fixtures/synthetic-engine-profile.mjs';
const require = createRequire(import.meta.url);
initSync({ module: fs.readFileSync(new URL('./rhwp_bg.wasm', pathToFileURL(require.resolve('@rhwp/core')))) });
const api = createEngineApi(HwpDocument), plain = createDocumentEngine(HwpDocument);
const bytes = syntheticFixture(HwpDocument, api.exportChecked, { paragraphs: ['한😀글 e\u0301 반복 '.repeat(8), '마지막'] });
const scope = { owner: 'synthetic-owner', document_id: 'synthetic-document', version_id: 'synthetic-version' };
const hash = 'a'.repeat(64);

test('cache policy bounds bytes/entries, expires absolutely despite hits, and isolates owner/document/version/hash/provider', () => {
  let time = 0; const cache = createReadInspectionCache({ maxEntries: 2, maxBytes: 120, ttlMs: 10, now: () => time });
  function Type() {} function Other() {}
  const model = { text: '한글😀', nested: { n: 1 } };
  assert.equal(cache.put(Type, scope, hash, model), true); model.nested.n = 7;
  const hit = cache.get(Type, scope, hash); assert.equal(hit.nested.n, 1); hit.nested.n = 9;
  assert.equal(cache.get(Type, scope, hash).nested.n, 1);
  for (const changed of [{ owner: 'other' }, { document_id: 'other' }, { version_id: 'other' }]) {
    assert.equal(cache.get(Type, { ...scope, ...changed }, hash), null);
  }
  assert.equal(cache.get(Type, scope, 'b'.repeat(64)), null);
  assert.equal(cache.get(Other, scope, hash), null);
  assert.equal(cache.put(Type, scope, hash, { text: '가'.repeat(41) }), false); // UTF-8 byte cap, not character count.
  cache.put(Type, { ...scope, version_id: '2' }, hash, model);
  cache.get(Type, scope, hash); // Keep first row as LRU's most recently used.
  cache.put(Type, { ...scope, version_id: '3' }, hash, model);
  assert.equal(cache.get(Type, { ...scope, version_id: '2' }, hash), null);
  assert(cache.stats().serialized_bytes <= 120); assert.equal(cache.stats().entries, 2);
  time = 9; assert(cache.get(Type, scope, hash));
  time = 10; assert.equal(cache.get(Type, scope, hash), null); assert.equal(cache.stats().entries, 0);
  assert.equal(cache.stats().serialized_bytes, 0);
  for (const invalid of [{ maxEntries: 3 }, { maxBytes: 8 * 1024 * 1024 + 1 }, { ttlMs: 300001 }, { now: 1 }]) {
    assert.throws(() => createReadInspectionCache(invalid), /Invalid read cache policy/);
  }
});

test('recreated engines reuse one freed source inspection while full Unicode read responses remain identical', async () => {
  const snapshot = await plain.open(bytes), cache = createReadInspectionCache(), profile = profileSyntheticEngine(HwpDocument);
  profile.setPhase('read'); let cursor = null, pages = 0;
  do {
    const engine = createDocumentEngine(profile.Document, { readInspectionCache: cache });
    const handle = await engine.openRead(bytes, scope, snapshot.source_sha256);
    assert.deepEqual(Object.keys(handle).sort(), ['read', 'source_sha256']);
    const options = { expected_sha256: snapshot.source_sha256, cursor, max_chars: 17 };
    const result = handle.read(options); assert.deepEqual(result, snapshot.read(options));
    if (result.blocks[0]) result.blocks[0].style.paragraph.injected = true;
    cursor = result.next_cursor; pages++;
  } while (cursor);
  assert(pages > 5); assert.equal(profile.report().read.constructor.calls, 1);
  assert.equal(profile.report().read.free.calls, 1); assert.equal(cache.stats().hits, pages - 1);
  const engine = createDocumentEngine(profile.Document, { readInspectionCache: cache });
  await engine.openRead(bytes, { ...scope, owner: 'other' }, snapshot.source_sha256);
  assert.equal(profile.report().read.constructor.calls, 2);
  const before = cache.stats();
  await assert.rejects(engine.openRead(bytes, scope, hash), (e) => e.code === 'BLOB_MISSING_OR_CORRUPT');
  assert.deepEqual(cache.stats(), before); assert.equal(profile.report().read.constructor.calls, 2);
  await engine.openRead(bytes, scope, snapshot.source_sha256); // Restore first scope after LRU hit.
  profile.setPhase('edit');
  const target = snapshot.read({ expected_sha256: snapshot.source_sha256 }).blocks.find((b) => b.editable && b.text);
  await engine.edit(bytes, { expected_sha256: snapshot.source_sha256, operations: [{ target_id: target.target_id,
    expected_old: target.text, new_text: '새 편집 😀' }] });
  assert.equal(profile.report().edit.constructor.calls, 2); assert.equal(profile.report().edit.free.calls, 2);
});

test('service reauthorizes hits and checks revocation after materialization; delete and failed delete invalidate all document versions', async () => {
  const snapshot = await plain.open(bytes), cache = createReadInspectionCache(), profile = profileSyntheticEngine(HwpDocument);
  profile.setPhase('service'); let reads = 0, histories = 0, denied = false, revoked = false, duringEngine = false;
  const store = {
    async read({ owner }) { reads++; if (denied || owner !== scope.owner) throw Error('denied');
      return { bytes, version_id: scope.version_id, sha256: snapshot.source_sha256 }; },
    async history() { histories++; if (revoked) throw Error('revoked');
      return [{ version_id: scope.version_id, sha256: snapshot.source_sha256 }]; },
    async remove() { throw Error('delete pending'); },
  };
  const engine = createDocumentEngine(profile.Document, { readInspectionCache: cache });
  const injected = { ...engine, async openRead(...args) { const result = await engine.openRead(...args);
    if (duringEngine) revoked = true; return result; } };
  const service = createDocumentService(injected, store);
  await service.read(scope); await service.read(scope);
  assert.equal(reads, 2); assert.equal(histories, 2); assert.equal(profile.report().service.constructor.calls, 1);
  denied = true; await assert.rejects(service.read(scope), /denied/); denied = false;
  await assert.rejects(service.read({ ...scope, owner: 'other' }), /denied/);
  assert.equal(histories, 2); assert.equal(cache.stats().hits, 1);
  duringEngine = true; await assert.rejects(service.read(scope), /revoked/);
  assert.equal(cache.stats().entries, 0);
  revoked = false; duringEngine = false; await service.read(scope);
  cache.put(profile.Document, { ...scope, version_id: 'old' }, snapshot.source_sha256, { marker: 'synthetic' });
  assert.equal(cache.stats().entries, 2);
  await assert.rejects(service.remove(scope), /delete pending/);
  assert.equal(cache.stats().entries, 0);
  assert.equal(reads, 6); assert.equal(histories, 4);
});

test('oversized models fall back to fresh inspection and no read handle exposes edit/preflight', async () => {
  const snapshot = await plain.open(bytes), cache = createReadInspectionCache({ maxBytes: 1 });
  const profile = profileSyntheticEngine(HwpDocument); profile.setPhase('fallback');
  const engine = createDocumentEngine(profile.Document, { readInspectionCache: cache });
  for (let i = 0; i < 2; i++) {
    const handle = await engine.openRead(bytes, scope, snapshot.source_sha256);
    assert.equal(handle.edit, undefined); assert.equal(handle.preflight, undefined);
    assert.deepEqual(handle.read({ expected_sha256: snapshot.source_sha256 }), snapshot.read({ expected_sha256: snapshot.source_sha256 }));
  }
  assert.equal(cache.stats().entries, 0); assert.equal(profile.report().fallback.constructor.calls, 2);
  assert.equal(profile.report().fallback.free.calls, 2);
});
