import assert from 'node:assert/strict';
import test from 'node:test';
import fs from 'node:fs';
import { createRequire } from 'node:module';
import { pathToFileURL } from 'node:url';
import { HwpDocument, initSync } from '@rhwp/core';
import { createEngineApi } from '../../../src/one_hwp/rhwp_api.mjs';
import { syntheticFixture } from '../../../src/one_hwp/synthetic_fixtures.mjs';
import { createDocumentEngine, mapRawTargets } from '../../../src/one_hwp/engine/document.mjs';
import { readHwp } from '../../../src/one_hwp/guard/container.mjs';
import { parseRecords } from '../../../src/one_hwp/guard/records.mjs';
import { verifyPreservation } from '../../../src/one_hwp/guard/preservation.mjs';
import { emptyCellFillProfiles, projectVerifiedCellTextTransitions } from '../../../src/one_hwp/guard/empty-cell-fill.mjs';
import { cellTextClearProfiles } from '../../../src/one_hwp/guard/empty-cell-clear.mjs';
import { encodeRecords, rewriteSyntheticBody, withPageNumber } from '../../../tests/fixtures/page-number-fixtures.mjs';

const req = createRequire(import.meta.url);
initSync({ module: fs.readFileSync(new URL('./rhwp_bg.wasm', pathToFileURL(req.resolve('@rhwp/core')))) });
const api = createEngineApi(HwpDocument), engine = createDocumentEngine(HwpDocument);
const fixture = (options = {}) => syntheticFixture(HwpDocument, api.exportChecked,
  { paragraphs: ['합성 검증', '보존'], cells: [['지울 내용 🙂', '보존'], ['', '다른 셀']], ...options });
const inspect = (bytes) => { const d = api.openDocument(bytes); try { return api.inspectDocument(d); } finally { d.free(); } };
const read = (s) => s.read({ expected_sha256: s.source_sha256 });
const edits = (s, operations) => ({ expected_sha256: s.source_sha256, operations });
const op = (b, new_text = '') => ({ target_id: b.target_id, expected_old: b.text, new_text });

for (const boldCell of [false, true]) test(`clear and refill preserve existing cell/paragraph/style, nonzero style=${boldCell}`, async () => {
  const input = fixture({ boldCell }), original = input.slice(), snapshot = await engine.open(input), before = read(snapshot);
  const target = before.blocks.find((b) => b.cell_text_clear_supported);
  assert.ok(target && target.text); assert.equal(target.kind, 'cell');
  assert.equal(target.style.char_shape_ids[0] !== 0, boldCell);
  if (boldCell) assert.throws(() => api.editDocument(input, [{ target_id: target.id, expected_old: target.text, new_text: '' }]),
    /unsupported formatting/); // Local default is deliberately NOT broadened.
  const request = edits(snapshot, [op(target)]), planned = await snapshot.preflight(request);
  assert.equal(planned.cell_text_record_removals_verified, 1); assert.equal(planned.empty_cell_text_insertions_verified, 0);
  assert.equal(planned.raw_preservation_scope, 'narrow_raw_record_preservation_with_verified_cell_text_transitions');
  assert.equal(planned.saved, false); assert.equal(planned.storage_checked, false);
  assert.equal(Object.hasOwn(planned, 'bytes'), false); assert.equal(Object.hasOwn(planned, 'output_sha256'), false);
  const changed = await snapshot.edit(request), cleared = await engine.open(changed.bytes), after = read(cleared);
  assert.deepEqual(after.blocks.map((b) => [b.id, b.text, b.style]), before.blocks.map((b) => [b.id, b.id === target.id ? '' : b.text, b.style]));
  assert.deepEqual(inspect(changed.bytes).tables, inspect(input).tables);
  const empty = after.blocks.find((b) => b.id === target.id);
  assert.equal(empty.empty_cell_fill_supported, true); assert.equal(empty.cell_text_clear_supported, false);
  const filled = await cleared.edit(edits(cleared, [op(empty, '다시 채움 😀')])), reopened = await engine.open(filled.bytes);
  assert.equal(filled.empty_cell_text_insertions_verified, 1);
  assert.equal(read(reopened).blocks.find((b) => b.id === target.id).text, '다시 채움 😀');
  assert.deepEqual(read(reopened).blocks.find((b) => b.id === target.id).style, target.style);
  assert.deepEqual(input, original);
});

test('fill, clear and ordinary replacement can share one atomic request in either target order', async () => {
  for (const reverse of [false, true]) {
    const input = fixture({ boldCell: true }), snapshot = await engine.open(input), before = read(snapshot);
    const clear = before.blocks.find((b) => b.cell_text_clear_supported), fill = before.blocks.find((b) => b.empty_cell_fill_supported);
    const body = before.blocks.find((b) => b.kind === 'paragraph' && b.editable && b.text);
    const operations = [op(clear), op(fill, '채움'), op(body, '새 본문')]; if (reverse) operations.reverse();
    const changed = await snapshot.edit(edits(snapshot, operations)), after = await engine.open(changed.bytes);
    assert.equal(changed.cell_text_record_removals_verified, 1); assert.equal(changed.empty_cell_text_insertions_verified, 1);
    assert.deepEqual(read(after).blocks.map((b) => [b.id, b.text, b.style]), before.blocks.map((b) => {
      const change = operations.find((o) => o.target_id === b.target_id); return [b.id, change?.new_text ?? b.text, b.style];
    }));
  }
});

test('clear profile rejects controls, count/range/hidden-style ambiguity and extra descendants', () => {
  const bytes = fixture(), raw = readHwp(bytes), model = inspect(bytes), mapping = mapRawTargets(raw, model.blocks);
  assert.equal(cellTextClearProfiles(raw, model.blocks, mapping).size, 3);
  const target = model.blocks.find((b) => b.kind === 'cell' && b.text), ordinal = mapping.get(target.id).record_index;
  const mutate = (action) => {
    const records = [...parseRecords(raw.streams.get('BodyText/Section0'))].map((r) => ({ ...r, payload: r.payload.slice() }));
    let paragraph = -1; const group = [];
    for (const record of records) { if (record.tag === 66) paragraph++; if (paragraph === ordinal) group.push(record); }
    action(group, records);
    return { ...raw, streams: new Map(raw.streams).set('BodyText/Section0', encodeRecords(records)) };
  };
  for (const action of [
    (r) => { new DataView(r[0].payload.buffer).setUint32(4, 1, true); },
    (r) => { r[0].payload[0] ^= 1; },
    (r) => { new DataView(r[0].payload.buffer).setUint16(14, 1, true); },
    (r) => { new DataView(r[0].payload.buffer).setUint16(12, 2, true); },
    (r) => { new DataView(r[0].payload.buffer).setUint16(16, 0, true); },
    (r) => { new DataView(r[2].payload.buffer).setUint32(0, 1, true); },
    (r) => { r[2].payload = new Uint8Array(16); },
    (r) => { r[1].payload[0] = 9; r[1].payload[1] = 0; },
    (r) => { r[1].payload[r[1].payload.length - 2] = 0; },
    (r) => { r[1].level = 4; },
    (r, all) => { all.splice(all.indexOf(r[3]), 0, { tag: 71, level: 3, payload: new Uint8Array(4) }); },
  ]) assert.equal(cellTextClearProfiles(mutate(action), model.blocks, mapping).has(target.id), false);
  for (const patch of [{ kind: 'paragraph' }, { editable: false }, { text: '' }]) {
    const changed = model.blocks.map((b) => b.id === target.id ? { ...b, ...patch } : b);
    assert.equal(cellTextClearProfiles(raw, changed, mapping).has(target.id), false);
  }
});

test('removal proof rejects retained/extra/wrong records; metadata still requires the unchanged strict guard', () => {
  const input = fixture({ boldCell: true }), before = readHwp(input), inspection = inspect(input);
  const mapping = mapRawTargets(before, inspection.blocks), clears = cellTextClearProfiles(before, inspection.blocks, mapping);
  const target = inspection.blocks.find((b) => clears.has(b.id));
  const operations = [{ target_id: target.id, expected_old: target.text, new_text: '' }];
  const candidate = api.editDocument(input, operations, { clearCellTargets: new Set([target.id]) }), after = readHwp(candidate);
  const fills = emptyCellFillProfiles(before, inspection.blocks, mapping), rawOps = [{ ...mapping.get(target.id), new_text: '' }];
  const project = (changed) => projectVerifiedCellTextTransitions(before, changed, operations, fills, clears);
  assert.throws(() => verifyPreservation(before.streams, after.streams, rawOps), /PRESERVATION_MISMATCH/);
  const projection = project(after); assert.equal(projection.verified_removals, 1);
  assert.equal(verifyPreservation(projection.streams, after.streams, rawOps).verified, true);
  assert.throws(() => project(before), /CELL_TEXT_REMOVAL_UNVERIFIED/);
  for (const action of [
    (r, i) => { r.splice(i + 1, 0, { tag: 67, level: 3, payload: new Uint8Array([13, 0]) }); },
    (r, i) => { r.splice(i + 1, 1); },
    (r, i) => { r[i + 1].level = 4; },
    (r, i) => { r.splice(i + 2, 0, { tag: 66, level: 2, payload: new Uint8Array(22) }); },
  ]) {
    const records = [...parseRecords(after.streams.get('BodyText/Section0'))].map((r) => ({ ...r, payload: r.payload.slice() }));
    const index = records.findIndex((r) => r.tag === 66 && r.level === 2); action(records, index);
    assert.throws(() => project({ ...after, streams: new Map(after.streams).set('BodyText/Section0', encodeRecords(records)) }),
      /CELL_TEXT_REMOVAL_UNVERIFIED/);
  }
  const corrupted = new Map(after.streams), records = [...parseRecords(after.streams.get('BodyText/Section0'))]
    .map((r) => ({ ...r, payload: r.payload.slice() }));
  records.find((r) => r.tag === 66 && r.level === 2).payload[10] ^= 1;
  corrupted.set('BodyText/Section0', encodeRecords(records));
  assert.equal(project({ ...after, streams: corrupted }).verified_removals, 1);
  assert.throws(() => verifyPreservation(projection.streams, corrupted, rawOps), /PRESERVATION_MISMATCH/);
});

test('tab-containing cell remains normally readable but cannot be cleared under this exception', async () => {
  const input = fixture({ cells: [['탭\t내용', '원문'], ['', '보존']] }), original = input.slice();
  const snapshot = await engine.open(input), target = read(snapshot).blocks.find((b) => b.kind === 'cell' && b.text.includes('\t'));
  assert.ok(target); assert.equal(target.cell_text_clear_supported, false);
  assert.throws(() => snapshot.plan(edits(snapshot, [op(target)])), (e) => e.code === 'TARGET_NOT_EDITABLE');
  await assert.rejects(snapshot.edit(edits(snapshot, [op(target)])), (e) => e.code === 'TARGET_NOT_EDITABLE');
  assert.deepEqual(input, original);
});

test('clear composes with preserved page-number control and zero cell-list metadata', async () => {
  const page = withPageNumber(fixture({ cells: [['', '원문'], ['', '답변']] }));
  const input = rewriteSyntheticBody(page, (records) => records.map((r) => {
    if (r.tag !== 72) return r;
    const payload = r.payload.slice(); payload[6] = 0; payload[7] = 0; return { ...r, payload };
  }));
  const original = input.slice(), snapshot = await engine.open(input), before = read(snapshot);
  const target = before.blocks.find((b) => b.cell_text_clear_supported);
  const changed = await snapshot.edit(edits(snapshot, [op(target)])), after = await engine.open(changed.bytes);
  assert.equal(changed.restored_cell_list_words, 4); assert.equal(changed.cell_text_record_removals_verified, 1);
  assert.deepEqual(read(after).preserved_controls, before.preserved_controls);
  assert.deepEqual(input, original);
});
