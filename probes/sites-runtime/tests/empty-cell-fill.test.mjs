import assert from 'node:assert/strict';
import test from 'node:test';
import fs from 'node:fs';
import { createRequire } from 'node:module';
import { pathToFileURL } from 'node:url';
import { HwpDocument, initSync } from '@rhwp/core';
import { createEngineApi } from '../../../src/one_hwp/rhwp_api.mjs';
import { syntheticFixture } from '../../../src/one_hwp/synthetic_fixtures.mjs';
import { createDocumentEngine, mapRawTargets } from '../engine/document.mjs';
import { readHwp } from '../guard/container.mjs';
import { parseRecords } from '../guard/records.mjs';
import { verifyPreservation } from '../guard/preservation.mjs';
import { emptyCellFillProfiles, projectVerifiedEmptyCellInsertions } from '../guard/empty-cell-fill.mjs';
import { encodeRecords, rewriteSyntheticBody, withPageNumber } from './page-number-fixtures.mjs';

const req = createRequire(import.meta.url);
initSync({ module: fs.readFileSync(new URL('./rhwp_bg.wasm', pathToFileURL(req.resolve('@rhwp/core')))) });
const api = createEngineApi(HwpDocument), engine = createDocumentEngine(HwpDocument);
const fixture = (options = {}) => syntheticFixture(HwpDocument, api.exportChecked,
  { paragraphs: ['합성 검증', '보존'], cells: [['', '원문'], ['', '답변']], ...options });
const model = (bytes) => { const d = api.openDocument(bytes); try { return api.inspectDocument(d); } finally { d.free(); } };
const request = (snapshot, targets, text = '합성 추가 🙂 e\u0301') => ({ expected_sha256: snapshot.source_sha256,
  operations: targets.map((b) => ({ target_id: b.target_id, expected_old: b.text, new_text: text })) });

test('two empty existing cells can be filled alongside a nonempty replacement and reopened exactly', async () => {
  const input = fixture(), original = input.slice(), snapshot = await engine.open(input);
  const before = snapshot.read({ expected_sha256: snapshot.source_sha256 });
  const fills = before.blocks.filter((b) => b.empty_cell_fill_supported);
  assert.equal(fills.length, 2); assert.ok(fills.every((b) => b.editable && b.kind === 'cell' && b.text === ''));
  assert.ok(before.blocks.filter((b) => b.kind === 'paragraph' && !b.text).every((b) => !b.empty_cell_fill_supported));
  const ordinary = before.blocks.find((b) => b.kind === 'cell' && b.text);
  const args = request(snapshot, [...fills, ordinary]);
  const plan = await snapshot.preflight(args);
  assert.equal(plan.empty_cell_text_insertions_verified, 2);
  assert.equal(plan.raw_preservation_scope, 'narrow_raw_record_preservation_with_verified_empty_cell_insertions');
  assert.equal(plan.saved, false); assert.equal(plan.storage_checked, false);
  assert.equal(Object.hasOwn(plan, 'bytes'), false); assert.equal(Object.hasOwn(plan, 'output_sha256'), false);
  const result = await snapshot.edit(args), after = await engine.open(result.bytes);
  assert.equal(result.content_verified, true); assert.equal(result.raw_preservation_verified, true);
  assert.equal(result.layout_verified, false); assert.equal(result.saved, false);
  assert.equal(result.empty_cell_text_insertions_verified, 2);
  const reopened = after.read({ expected_sha256: after.source_sha256 });
  assert.deepEqual(reopened.blocks.map((b) => [b.id, b.text, b.style]), before.blocks.map((b) =>
    [b.id, args.operations.some((op) => op.target_id === b.target_id) ? args.operations[0].new_text : b.text, b.style]));
  assert.ok(fills.every((b) => !reopened.blocks.find((x) => x.id === b.id).empty_cell_fill_supported));
  assert.deepEqual(input, original);
});

test('empty no-op stays on the original strict path; tabs and stale/duplicate requests fail without mutation', async () => {
  const input = fixture(), original = input.slice(), snapshot = await engine.open(input);
  const fill = snapshot.read({ expected_sha256: snapshot.source_sha256 }).blocks.find((b) => b.empty_cell_fill_supported);
  const noop = await snapshot.preflight(request(snapshot, [fill], ''));
  assert.equal(noop.empty_cell_text_insertions_verified, 0);
  assert.equal(noop.raw_preservation_scope, 'narrow_raw_record_preservation');
  await assert.rejects(snapshot.preflight(request(snapshot, [fill], '탭\t추가')), (e) => e.code === 'INVALID_OPERATION');
  await assert.rejects(snapshot.edit(request(snapshot, [fill, fill])), (e) => e.code === 'DUPLICATE_TARGET');
  const stale = request(snapshot, [fill]); stale.operations[0].expected_old = '아님';
  await assert.rejects(snapshot.preflight(stale), (e) => e.code === 'EXPECTED_OLD_MISMATCH');
  assert.deepEqual(input, original);
});

test('existing nonzero cell style is retained when filling, without a new style definition', async () => {
  const base = fixture({ boldCell: true }), inspection = model(base);
  const alternate = inspection.blocks.find((b) => b.kind === 'cell' && b.text).style.char_shape_ids[0];
  assert.notEqual(alternate, 0);
  const input = rewriteSyntheticBody(base, (records) => {
    let firstEmpty = false, finished = false;
    return records.map((r) => {
      if (r.tag === 66) firstEmpty = !finished && r.level === 2;
      if (!firstEmpty || r.tag !== 68 || finished) return r;
      finished = true;
      const payload = r.payload.slice(); new DataView(payload.buffer).setUint32(4, alternate, true);
      return { ...r, payload };
    });
  });
  const snapshot = await engine.open(input), before = snapshot.read({ expected_sha256: snapshot.source_sha256 });
  const target = before.blocks.find((b) => b.empty_cell_fill_supported);
  assert.deepEqual(target.style.char_shape_ids, [alternate]);
  const edited = await snapshot.edit(request(snapshot, [target])), reopened = await engine.open(edited.bytes);
  const after = reopened.read({ expected_sha256: reopened.source_sha256 }).blocks.find((b) => b.id === target.id);
  assert.deepEqual(after.style, target.style);
  assert.equal(edited.empty_cell_text_insertions_verified, 1);
});

test('duplicate empty paragraphs in the same cell retain coordinates and only selected targets are filled', async () => {
  const input = fixture({ cells: [['\n', '원문'], ['', '답변']] }), original = input.slice();
  const snapshot = await engine.open(input), before = snapshot.read({ expected_sha256: snapshot.source_sha256 });
  const fills = before.blocks.filter((b) => b.empty_cell_fill_supported);
  assert.equal(fills.length, 3); assert.notEqual(fills[0].target_id, fills[1].target_id);
  const args = request(snapshot, [fills[1], fills[2]]), edited = await snapshot.edit(args);
  const reopened = await engine.open(edited.bytes), after = reopened.read({ expected_sha256: reopened.source_sha256 });
  assert.deepEqual(after.blocks.map((b) => [b.id, b.text]), before.blocks.map((b) =>
    [b.id, [fills[1].id, fills[2].id].includes(b.id) ? args.operations[0].new_text : b.text]));
  assert.equal(after.blocks.find((b) => b.id === fills[0].id).empty_cell_fill_supported, true);
  assert.equal(edited.empty_cell_text_insertions_verified, 2); assert.deepEqual(input, original);
});

function profileFixture(size = 24) {
  const h = new Uint8Array(size), v = new DataView(h.buffer);
  v.setUint32(0, 0x80000001, true); v.setUint16(12, 1, true); v.setUint16(16, 1, true);
  const shape = new Uint8Array(8); new DataView(shape.buffer).setUint32(4, 7, true);
  const records = [{ tag: 66, level: 2, payload: h }, { tag: 68, level: 3, payload: shape },
    { tag: 69, level: 3, payload: new Uint8Array(36) }, { tag: 72, level: 2, payload: new Uint8Array(34) }];
  const block = { id: 'cell', kind: 'cell', editable: true, text: '', style: { char_shape_ids: [7] } };
  const mapping = new Map([['cell', { section: 0, record_index: 0 }]]);
  const decoded = (items) => ({ streams: new Map([['BodyText/Section0', encodeRecords(items)]]),
    profile: { sections: [{ section: 0 }] } });
  return { records, block, mapping, decoded };
}

test('22/24 byte profile keeps end bit, nonzero style and sibling list boundary; every other layout stays readonly', () => {
  for (const size of [22, 24]) {
    const f = profileFixture(size);
    assert.equal(emptyCellFillProfiles(f.decoded(f.records), [f.block], f.mapping).size, 1);
    for (const mutate of [
      (r) => { new DataView(r[0].payload.buffer).setUint32(0, 0x80000000, true); },
      (r) => { new DataView(r[0].payload.buffer).setUint32(4, 1, true); },
      (r) => { new DataView(r[0].payload.buffer).setUint16(12, 2, true); },
      (r) => { new DataView(r[0].payload.buffer).setUint16(14, 1, true); },
      (r) => { new DataView(r[0].payload.buffer).setUint16(16, 0, true); },
      (r) => { new DataView(r[1].payload.buffer).setUint32(0, 1, true); },
      (r) => { new DataView(r[1].payload.buffer).setUint32(4, 8, true); },
      (r) => { r[1].payload = new Uint8Array(16); },
      (r) => { r[1].level = 4; },
      (r) => { r[2].payload = new Uint8Array(72); },
      (r) => { r.splice(2, 0, { tag: 71, level: 3, payload: new Uint8Array(4) }); },
      (r) => { r.splice(1, 0, { tag: 67, level: 3, payload: new Uint8Array([13, 0]) }); },
      (r) => { [r[1], r[2]] = [r[2], r[1]]; },
    ]) {
      const records = structuredClone(f.records); mutate(records);
      assert.equal(emptyCellFillProfiles(f.decoded(records), [f.block], f.mapping).size, 0);
    }
    for (const patch of [{ kind: 'paragraph' }, { editable: false }, { text: 'not empty' }])
      assert.equal(emptyCellFillProfiles(f.decoded(f.records), [{ ...f.block, ...patch }], f.mapping).size, 0);
  }
});

test('insertion proof requires exact UTF16/CR, position, count, level and unchanged other envelopes', () => {
  const f = profileFixture(), before = f.decoded(f.records), saved = before.streams.get('BodyText/Section0').slice();
  const profiles = emptyCellFillProfiles(before, [f.block], f.mapping), text = '가🙂';
  const payload = new Uint8Array((text.length + 1) * 2), v = new DataView(payload.buffer);
  for (let i = 0; i < text.length; i++) v.setUint16(i * 2, text.charCodeAt(i), true);
  v.setUint16(text.length * 2, 13, true);
  const candidate = [f.records[0], { tag: 67, level: 3, payload }, ...f.records.slice(1)];
  const operations = [{ target_id: 'cell', new_text: text }];
  const project = (items, ops = operations) => projectVerifiedEmptyCellInsertions(before, f.decoded(items), ops, profiles);
  const proof = project(candidate);
  assert.equal(proof.verified_insertions, 1);
  assert.equal([...parseRecords(proof.streams.get('BodyText/Section0'))][1].payload[0], 13);
  for (const mutate of [
    (r) => { r[1].payload[0] ^= 1; }, (r) => { r[1].payload[r[1].payload.length - 2] = 0; },
    (r) => { r[1].level = 4; }, (r) => { r[1].tag = 68; },
    (r) => { [r[1], r[2]] = [r[2], r[1]]; }, (r) => { r.splice(1, 1); },
    (r) => { r.splice(2, 0, structuredClone(r[1])); }, (r) => { r.pop(); },
    (r) => { r.push({ tag: 66, level: 2, payload: new Uint8Array(22) }); },
  ]) {
    const records = structuredClone(candidate); mutate(records);
    assert.throws(() => project(records), (e) => e.code === 'EMPTY_CELL_INSERTION_UNVERIFIED');
  }
  for (const new_text of ['\t', '\n', '\u0000', '\ud800']) assert.throws(() =>
    project(candidate, [{ target_id: 'cell', new_text }]), (e) => e.code === 'EMPTY_CELL_INSERTION_UNVERIFIED');
  assert.throws(() => project(candidate, [...operations, ...operations]), /EMPTY_CELL_INSERTION_UNVERIFIED/);
  assert.deepEqual(before.streams.get('BodyText/Section0'), saved);
});

test('strict raw guard is not weakened: insertion needs proof and unrelated metadata still fails afterward', () => {
  const input = fixture(), inspection = model(input), before = readHwp(input);
  const mapping = mapRawTargets(before, inspection.blocks), profiles = emptyCellFillProfiles(before, inspection.blocks, mapping);
  const target = inspection.blocks.find((b) => profiles.has(b.id));
  const operations = [{ target_id: target.id, expected_old: '', new_text: '검증' }];
  const candidate = api.editDocument(input, operations), after = readHwp(candidate);
  const rawOps = [{ ...mapping.get(target.id), new_text: '검증' }];
  assert.throws(() => verifyPreservation(before.streams, after.streams, rawOps), /PRESERVATION_MISMATCH/);
  const projection = projectVerifiedEmptyCellInsertions(before, after, operations, profiles);
  assert.equal(verifyPreservation(projection.streams, after.streams, rawOps).verified, true);
  const records = [...parseRecords(after.streams.get('BodyText/Section0'))].map((r) => ({ ...r, payload: r.payload.slice() }));
  records.find((r) => r.tag === 66 && r.level === 2).payload[10] ^= 1;
  const corrupted = new Map(after.streams); corrupted.set('BodyText/Section0', encodeRecords(records));
  assert.equal(projectVerifiedEmptyCellInsertions(before, { streams: corrupted }, operations, profiles).verified_insertions, 1);
  assert.throws(() => verifyPreservation(projection.streams, corrupted, rawOps), /PRESERVATION_MISMATCH/);
});

test('empty fill composes with page-number opaque preservation and zero cell-list word repair', async () => {
  const page = withPageNumber(fixture());
  const input = rewriteSyntheticBody(page, (records) => records.map((r) => {
    if (r.tag !== 72) return r;
    const payload = r.payload.slice(); payload[6] = 0; payload[7] = 0; return { ...r, payload };
  }));
  const original = input.slice(), snapshot = await engine.open(input);
  const before = snapshot.read({ expected_sha256: snapshot.source_sha256 });
  const targets = before.blocks.filter((b) => b.empty_cell_fill_supported);
  assert.equal(targets.length, 2); assert.equal(before.preserved_controls.length, 1);
  const edited = await snapshot.edit(request(snapshot, targets)), reopened = await engine.open(edited.bytes);
  assert.equal(edited.restored_cell_list_words, 4); assert.equal(edited.empty_cell_text_insertions_verified, 2);
  assert.deepEqual(reopened.read({ expected_sha256: reopened.source_sha256 }).preserved_controls, before.preserved_controls);
  assert.deepEqual(input, original);
});
