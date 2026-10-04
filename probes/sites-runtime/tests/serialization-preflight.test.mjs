import assert from 'node:assert/strict';
import test from 'node:test';
import fs from 'node:fs';
import { createRequire } from 'node:module';
import { pathToFileURL } from 'node:url';
import { HwpDocument, initSync } from '@rhwp/core';
import { createEngineApi } from '../../../src/one_hwp/rhwp_api.mjs';
import { syntheticFixture } from '../../../src/one_hwp/synthetic_fixtures.mjs';
import { createDocumentEngine } from '../engine/document.mjs';
import { GuardError } from '../guard/records.mjs';
import { rewriteSyntheticBody } from './page-number-fixtures.mjs';
import { readHwp } from '../guard/container.mjs';
import { parseRecords } from '../guard/records.mjs';

const require = createRequire(import.meta.url);
initSync({ module: fs.readFileSync(new URL('./rhwp_bg.wasm', pathToFileURL(require.resolve('@rhwp/core')))) });
const api = createEngineApi(HwpDocument), engine = createDocumentEngine(HwpDocument);
const fixture = () => syntheticFixture(HwpDocument, api.exportChecked, { paragraphs: ['합성 검증', '보존'] });
const request = (snapshot, text = '합성 새 문구') => {
  const block = snapshot.read({ expected_sha256: snapshot.source_sha256 }).blocks
    .find((item) => item.editable && item.kind === 'cell' && item.text);
  assert.ok(block);
  return { expected_sha256: snapshot.source_sha256,
    operations: [{ target_id: block.target_id, expected_old: block.text, new_text: text }] };
};

test('preflight checks serialization without exposing bytes or changing its snapshot', async () => {
  const bytes = fixture(), original = bytes.slice(), snapshot = await engine.open(bytes);
  const before = snapshot.read({ expected_sha256: snapshot.source_sha256 });
  const edits = request(snapshot), quick = snapshot.plan(edits);
  assert.equal(quick.serialization_checked, false);
  assert.equal(quick.validation_scope, 'targets_and_values_only');
  const result = await snapshot.preflight(edits);
  assert.equal(result.valid, true);
  assert.equal(result.operation_count, 1);
  assert.equal(result.serialization_checked, true);
  assert.equal(result.validation_scope, 'targets_and_in_memory_serialization');
  assert.equal(result.content_verified, true);
  assert.equal(result.raw_preservation_verified, true);
  assert.equal(result.storage_checked, false);
  assert.equal(result.saved, false);
  assert.equal(result.file_changed, false);
  assert.equal(result.persistence, 'none');
  assert.equal(result.layout_verified, false);
  for (const key of ['bytes', 'output_sha256', 'version_id', 'download_url']) assert.equal(Object.hasOwn(result, key), false);
  assert.deepEqual(bytes, original);
  assert.deepEqual(snapshot.read({ expected_sha256: snapshot.source_sha256 }), before);
});

test('preflight preserves zero cell-list words without changing its snapshot', async () => {
  // Engine-generated cells have 0x0400; removing it reproduces the zero-word
  // fallback. The writer ADDS the default, not clears a meaning-bearing bit.
  const bytes = rewriteSyntheticBody(fixture(), (records) => records.map((record) => {
    if (record.tag !== 72 || record.level !== 2) return record;
    const payload = record.payload.slice();
    payload[7] ^= 4;
    return { ...record, payload };
  }));
  const original = bytes.slice(), snapshot = await engine.open(bytes);
  const before = snapshot.read({ expected_sha256: snapshot.source_sha256 }), edits = request(snapshot);
  assert.equal(snapshot.plan(edits).valid, true);
  const result = await snapshot.preflight(edits);
  assert.equal(result.raw_preservation_verified, true);
  assert.equal(result.restored_cell_list_words, 4);
  assert.equal(result.saved, false);
  assert.deepEqual(bytes, original);
  assert.deepEqual(snapshot.read({ expected_sha256: snapshot.source_sha256 }), before);
  // Unchanged visible values still require the same export/preservation checks.
  const unchanged = { ...edits, operations: edits.operations.map((op) => ({ ...op, new_text: op.expected_old })) };
  assert.equal((await snapshot.preflight(unchanged)).raw_preservation_verified, true);
  const edited = await snapshot.edit(edits), decoded = readHwp(edited.bytes);
  const lists = [...parseRecords(decoded.streams.get('BodyText/Section0'))].filter((r) => r.tag === 72);
  assert.equal(lists.length, 4);
  assert.ok(lists.every((r) => r.payload[6] === 0 && r.payload[7] === 0));
});

test('preflight still rejects other writer-normalized metadata without changing input', async () => {
  const bytes = rewriteSyntheticBody(fixture(), (records) => records.map((record) => {
    if (record.tag !== 72 || record.level !== 2) return record;
    const payload = record.payload.slice(); payload[2] ^= 1;
    return { ...record, payload };
  }));
  const original = bytes.slice(), snapshot = await engine.open(bytes), edits = request(snapshot);
  assert.equal(snapshot.plan(edits).valid, true);
  await assert.rejects(snapshot.preflight(edits), (error) => error instanceof GuardError
    && error.code === 'PRESERVATION_MISMATCH' && error.message === 'PRESERVATION_MISMATCH');
  assert.deepEqual(bytes, original);
});

test('preflight retains stale-version and whole-old-value checks', async () => {
  const snapshot = await engine.open(fixture()), edits = request(snapshot);
  await assert.rejects(snapshot.preflight({ ...edits, expected_sha256: 'f'.repeat(64) }),
    (error) => error.code === 'VERSION_CONFLICT');
  await assert.rejects(snapshot.preflight({ ...edits,
    operations: [{ ...edits.operations[0], expected_old: '틀린 이전 값' }] }),
    (error) => error.code === 'EXPECTED_OLD_MISMATCH');
});
