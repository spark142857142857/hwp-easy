import assert from 'node:assert/strict';
import test from 'node:test';
import fs from 'node:fs';
import { createRequire } from 'node:module';
import { pathToFileURL } from 'node:url';
import { HwpDocument, initSync } from '@rhwp/core';
import { createEngineApi } from '../../../src/one_hwp/rhwp_api.mjs';
import { syntheticFixture } from '../../../src/one_hwp/synthetic_fixtures.mjs';
import { readCfb, readHwp, replaceAllocatedBodyStreams } from '../guard/container.mjs';
import { verifyPreservation } from '../guard/preservation.mjs';
import { preserveZeroCellListWords } from '../engine/cell-list-preservation.mjs';
import { createDocumentEngine } from '../engine/document.mjs';
import { rewriteSyntheticBody, withPageNumber } from './page-number-fixtures.mjs';
import { compressionFallbackFixture, compressionRejectedFixture } from './cell-list-fixtures.mjs';

const require = createRequire(import.meta.url);
initSync({ module: fs.readFileSync(new URL('./rhwp_bg.wasm', pathToFileURL(require.resolve('@rhwp/core')))) });
const api = createEngineApi(HwpDocument);
const fixture = () => syntheticFixture(HwpDocument, api.exportChecked, { paragraphs: ['합성 검증', '보존'] });
const mutateLists = (bytes, action) => rewriteSyntheticBody(bytes, (records) => records.map((r) =>
  r.tag === 72 ? { ...r, payload: action(r.payload.slice()) } : r));
const zeroWords = (bytes) => mutateLists(bytes, (p) => { p[6] = 0; p[7] = 0; return p; });
const inspect = (bytes) => { const d = api.openDocument(bytes); try { return api.inspectDocument(d); } finally { d.free(); } };

test('only matched zero -> 0x0400 words are repaired; nonzero words are not touched', () => {
  const candidate = fixture(), input = zeroWords(candidate), raw = readHwp(input), model = inspect(input);
  const original = input.slice(), saved = candidate.slice();
  const result = preserveZeroCellListWords(raw, candidate, model);
  assert.equal(result.restored_cell_list_words, 4);
  assert.equal(verifyPreservation(raw.streams, readHwp(result.bytes).streams, []).verified, true);
  assert.deepEqual(inspect(result.bytes), model);
  assert.deepEqual(input, original); assert.deepEqual(candidate, saved);
  const untouched = preserveZeroCellListWords(readHwp(candidate), candidate, inspect(candidate));
  assert.equal(untouched.restored_cell_list_words, 0); assert.equal(untouched.bytes, candidate);
});

test('repair refuses unrelated header changes, reversed/nonzero transitions and wrong model coordinates', () => {
  const candidate = fixture(), input = zeroWords(candidate), model = inspect(input);
  for (const [offset, mask] of [[6, 1], [7, 1], [16, 1], [24, 1], [32, 1]]) {
    const corrupted = mutateLists(candidate, (p) => { p[offset] ^= mask; return p; });
    assert.throws(() => preserveZeroCellListWords(readHwp(input), corrupted, model), /PRESERVATION_MISMATCH/);
  }
  assert.throws(() => preserveZeroCellListWords(readHwp(candidate), input, inspect(candidate)), /PRESERVATION_MISMATCH/);
  for (const key of ['col', 'row', 'colSpan', 'rowSpan']) {
    const wrong = structuredClone(model); wrong.tables[0].cells[0][key]++;
    assert.throws(() => preserveZeroCellListWords(readHwp(input), candidate, wrong), /PRESERVATION_MISMATCH/);
  }
  const missing = structuredClone(model); missing.tables[0].cells.pop();
  assert.throws(() => preserveZeroCellListWords(readHwp(input), candidate, missing), /PRESERVATION_MISMATCH/);
  const wrongCount = structuredClone(model); wrongCount.tables[0].cells[0].paragraph_ids.push('not-a-paragraph');
  assert.throws(() => preserveZeroCellListWords(readHwp(input), candidate, wrongCount), /PRESERVATION_MISMATCH/);
});

test('mandatory raw guard still rejects non-cell metadata even after a successful cell repair', () => {
  const candidate = fixture(), input = zeroWords(candidate), model = inspect(input);
  const corrupted = rewriteSyntheticBody(candidate, (records) => records.map((r) => {
    if (r.tag !== 66 || r.level !== 0) return r;
    const payload = r.payload.slice(); payload[10] ^= 1;
    return { ...r, payload };
  }));
  const result = preserveZeroCellListWords(readHwp(input), corrupted, model);
  assert.equal(result.restored_cell_list_words, 4);
  assert.throws(() => verifyPreservation(readHwp(input).streams, readHwp(result.bytes).streams, []), /PRESERVATION_MISMATCH/);
});

test('cell-word preservation composes with the opaque page-number profile and two requested edits', async () => {
  const input = zeroWords(withPageNumber(syntheticFixture(HwpDocument, api.exportChecked))), original = input.slice();
  const engine = createDocumentEngine(HwpDocument), snapshot = await engine.open(input);
  const before = snapshot.read({ expected_sha256: snapshot.source_sha256 });
  const targets = ['paragraph', 'cell'].map((kind) => before.blocks.find((b) => b.kind === kind && b.editable && b.text));
  const operations = targets.map((b, i) => ({ target_id: b.target_id, expected_old: b.text, new_text: `합성 수정 ${i} 😀` }));
  const result = await snapshot.edit({ expected_sha256: snapshot.source_sha256, operations });
  assert.equal(result.restored_cell_list_words, 4);
  assert.equal(result.raw_preservation_verified, true);
  const reopened = await engine.open(result.bytes), after = reopened.read({ expected_sha256: reopened.source_sha256 });
  assert.deepEqual(after.preserved_controls, before.preserved_controls);
  for (const [i, b] of targets.entries()) assert.equal(after.blocks.find((z) => z.id === b.id).text, operations[i].new_text);
  assert.deepEqual(input, original);
});

test('one alternate compression profile preserves the same allocation without relaxing raw checks', async () => {
  const f = compressionFallbackFixture(HwpDocument, api), original = f.bytes.slice(), candidate = f.candidate.slice();
  const name = 'BodyText/Section0';
  assert.notEqual(Math.ceil(f.preferred.length / 64), Math.ceil(f.allocated_packed_bytes / 64));
  assert.equal(Math.ceil(f.fallback.length / 64), Math.ceil(f.allocated_packed_bytes / 64));
  assert.throws(() => replaceAllocatedBodyStreams(f.candidate, new Map([[name, f.preferred]])),
    /BODY_REPAIR_ALLOCATION_UNSUPPORTED/);
  const repaired = preserveZeroCellListWords(readHwp(f.bytes), f.candidate, inspect(f.bytes));
  assert.equal(repaired.restored_cell_list_words, 16);
  assert.equal(repaired.bytes.length, f.candidate.length);
  assert.deepEqual(readCfb(repaired.bytes).get(name), f.fallback);
  assert.equal(verifyPreservation(readHwp(f.bytes).streams, readHwp(repaired.bytes).streams, []).verified, true);
  assert.deepEqual(inspect(repaired.bytes), inspect(f.candidate));
  const snapshot = await createDocumentEngine(HwpDocument).open(f.bytes);
  const target = snapshot.read({ expected_sha256: snapshot.source_sha256 }).blocks.find((b) => b.editable && b.text);
  const result = await snapshot.preflight({ expected_sha256: snapshot.source_sha256,
    operations: [{ target_id: target.target_id, expected_old: target.text, new_text: target.text }] });
  assert.equal(result.raw_preservation_verified, true); assert.equal(result.restored_cell_list_words, 16);
  assert.deepEqual(f.bytes, original); assert.deepEqual(f.candidate, candidate);
});

test('repair still fails if both compression profiles miss the existing allocation', async () => {
  const f = compressionRejectedFixture(HwpDocument, api), original = f.bytes.slice(), candidate = f.candidate.slice();
  for (const packed of [f.preferred, f.fallback]) assert.notEqual(Math.ceil(packed.length / 64),
    Math.ceil(f.allocated_packed_bytes / 64));
  assert.throws(() => preserveZeroCellListWords(readHwp(f.bytes), f.candidate, inspect(f.bytes)),
    /BODY_REPAIR_ALLOCATION_UNSUPPORTED/);
  const snapshot = await createDocumentEngine(HwpDocument).open(f.bytes);
  const target = snapshot.read({ expected_sha256: snapshot.source_sha256 }).blocks.find((b) => b.editable && b.text);
  const request = { expected_sha256: snapshot.source_sha256,
    operations: [{ target_id: target.target_id, expected_old: target.text, new_text: target.text }] };
  await assert.rejects(snapshot.preflight(request), /BODY_REPAIR_ALLOCATION_UNSUPPORTED/);
  await assert.rejects(snapshot.edit(request), /BODY_REPAIR_ALLOCATION_UNSUPPORTED/);
  assert.deepEqual(f.bytes, original); assert.deepEqual(f.candidate, candidate);
});
