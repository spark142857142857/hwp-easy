import assert from 'node:assert/strict';
import test from 'node:test';
import fs from 'node:fs';
import { createRequire } from 'node:module';
import { pathToFileURL } from 'node:url';
import { HwpDocument, initSync } from '@rhwp/core';
import { createEngineApi } from '../../../src/one_hwp/rhwp_api.mjs';
import { mixedStyleEdit } from '../../../src/one_hwp/mixed_style.mjs';
import { createDocumentEngine, mapRawTargets } from '../../../src/one_hwp/engine/document.mjs';
import { mixedStyleProfiles, verifyMixedStylePreservation } from '../../../src/one_hwp/engine/mixed-style.mjs';
import { readHwp } from '../../../src/one_hwp/guard/container.mjs';
import { GuardError, parseRecords } from '../../../src/one_hwp/guard/records.mjs';
import { verifyPreservation } from '../../../src/one_hwp/guard/preservation.mjs';
import { documentToolError } from '../host/error-feedback.mjs';
import { mixedFixture, MIXED_TEXT, MIXED_REPLACEMENT } from '../../../tests/fixtures/mixed-style-fixtures.mjs';
import { syntheticFixture } from '../../../src/one_hwp/synthetic_fixtures.mjs';
const require = createRequire(import.meta.url);
initSync({ module: fs.readFileSync(new URL('./rhwp_bg.wasm', pathToFileURL(require.resolve('@rhwp/core')))) });
const engine = createDocumentEngine(HwpDocument), api = createEngineApi(HwpDocument);
const read = s => s.read({ expected_sha256: s.source_sha256 });
const request = (s, b, new_text = MIXED_REPLACEMENT) => ({ expected_sha256: s.source_sha256,
  operations: [{ target_id: b.target_id, expected_old: b.text, new_text }] });

for (const [kind, merged] of [['paragraph', false], ['cell', false], ['cell', true]]) {
  test(`real mixed ${kind}, merged=${merged}: one run changes, all style anchors/other content survive`, async () => {
    const bytes = mixedFixture(HwpDocument, kind, { merged }), original = bytes.slice();
    const snapshot = await engine.open(bytes), before = read(snapshot), target = before.blocks.find(b => b.text === MIXED_TEXT);
    assert(target.editable); assert(target.mixed_style_same_length_supported);
    assert.equal(before.editability_summary.mixed_style_same_length_candidates, 1);
    const prepared = await snapshot.preflight(request(snapshot, target));
    assert(prepared.serialization_checked); assert.equal(prepared.saved, false);
    const edited = await snapshot.edit(request(snapshot, target)), after = read(await engine.open(edited.bytes));
    assert(edited.content_verified); assert(edited.raw_preservation_verified);
    assert.deepEqual(after.blocks.map(b => b.text), before.blocks.map(b => b.id === target.id ? MIXED_REPLACEMENT : b.text));
    for (let i = 0; i < before.blocks.length; i++) assert.deepEqual(after.blocks[i].style, before.blocks[i].style);
    const document = api.openDocument(bytes);
    try {
      const blocks = api.inspectDocument(document).blocks;
      assert.equal(blocks.find(b => b.id === target.id).editable, false, 'local common API remains conservative');
    } finally { document.free(); }
    assert.deepEqual(bytes, original);
    assert.throws(() => snapshot.plan(request(snapshot, target, '')), e => e.code === 'MIXED_STYLE_EDIT_UNSUPPORTED');
    await assert.rejects(() => snapshot.edit(request(snapshot, target, '')), e => e.code === 'MIXED_STYLE_EDIT_UNSUPPORTED');
    for (const new_text of [MIXED_TEXT, MIXED_TEXT.replace('😀', '🚀')]) {
      const next = await snapshot.edit(request(snapshot, target, new_text));
      const view = read(await engine.open(next.bytes));
      assert.equal(view.blocks.find(b => b.id === target.id).text, new_text);
      assert.deepEqual(view.blocks.map(b => b.style), before.blocks.map(b => b.style));
    }
  });
}
test('mixed restrictions reject growth, deletion, surrogate-width changes, crossing runs and stale values atomically', async () => {
  const bytes = mixedFixture(HwpDocument), original = bytes.slice(), snapshot = await engine.open(bytes);
  const before = read(snapshot), target = before.blocks.find(b => b.text === MIXED_TEXT);
  for (const text of [MIXED_TEXT + '추가', '', '이름: 홍길동 😀', '성명: 김철수 가']) {
    assert.throws(() => snapshot.plan(request(snapshot, target, text)), e => e.code === 'MIXED_STYLE_EDIT_UNSUPPORTED');
    await assert.rejects(() => snapshot.edit(request(snapshot, target, text)), e => e.code === 'MIXED_STYLE_EDIT_UNSUPPORTED');
  }
  const adjacent = before.blocks.find(b => b.text === '비대상 보존 문단');
  const operations = [request(snapshot, adjacent, '유효한 인접 수정').operations[0], request(snapshot, target, MIXED_TEXT + '추가').operations[0]];
  await assert.rejects(() => snapshot.preflight({ expected_sha256: snapshot.source_sha256, operations }), e => e.code === 'MIXED_STYLE_EDIT_UNSUPPORTED');
  await assert.rejects(() => snapshot.edit({ expected_sha256: snapshot.source_sha256, operations }), e => e.code === 'MIXED_STYLE_EDIT_UNSUPPORTED');
  const stale = request(snapshot, target); stale.operations[0].expected_old = '이전 값 아님';
  await assert.rejects(() => snapshot.edit(stale), e => e.code === 'EXPECTED_OLD_MISMATCH');
  assert.deepEqual(read(snapshot), before); assert.deepEqual(bytes, original);
});
test('32 real visible style runs remain candidates; 33 runs stay readonly without blocking adjacent text', async () => {
  for (const count of [32, 33]) {
    const text = '가'.repeat(count);
    const base = syntheticFixture(HwpDocument, api.exportChecked, { paragraphs: [text, '인접 문단'], table: false });
    const document = api.openDocument(base);
    let bytes;
    try {
      for (let i = 0; i < count; i += 2) {
        assert.equal(JSON.parse(document.applyCharFormat(0, 0, i, i + 1, JSON.stringify({ bold: true }))).ok, true);
      }
      bytes = api.exportChecked(document);
    } finally { document.free(); }
    const snapshot = await engine.open(bytes), before = read(snapshot), target = before.blocks.find(b => b.text === text);
    assert.equal(target.editable, count === 32);
    assert.equal(target.mixed_style_same_length_supported, count === 32);
    if (count === 32) {
      assert.equal(target.style.char_runs.length, 32);
      const edited = await snapshot.edit(request(snapshot, target, '나' + text.slice(1)));
      assert(edited.raw_preservation_verified);
    } else {
      assert.throws(() => snapshot.plan(request(snapshot, target, '나' + text.slice(1))), e => e.code === 'TARGET_NOT_EDITABLE');
      const adjacent = before.blocks.find(b => b.text === '인접 문단');
      const edited = await snapshot.edit(request(snapshot, adjacent, '인접 수정'));
      assert.equal(read(await engine.open(edited.bytes)).blocks.find(b => b.id === target.id).text, text);
    }
  }
});
test('equal total UTF-16 length cannot disguise moved surrogate boundaries or a changed span across runs', () => {
  const runs = [{ start: 0, end: 1, char_shape_id: 7 }, { start: 1, end: 3, char_shape_id: 0 }];
  assert.equal(mixedStyleEdit('가😀나', '😀가나', runs), null);
  assert.equal(mixedStyleEdit('가😀나', '다🚀나', runs), null);
  assert.deepEqual(mixedStyleEdit('가😀나', '가🚀나', runs), { start: 1, count: 1, new_text: '🚀', char_shape_id: 0 });
});
test('raw mixed admission rejects hidden IDs, malformed/moved anchors and exact output proof catches same-ID offset tampering', async () => {
  const bytes = mixedFixture(HwpDocument), document = createEngineApi(HwpDocument, { mixedStyleSameLength: true }).openDocument(bytes);
  let blocks;
  try { blocks = createEngineApi(HwpDocument, { mixedStyleSameLength: true }).inspectDocument(document).blocks; } finally { document.free(); }
  const original = readHwp(bytes), mapping = mapRawTargets(original, blocks), profiles = mixedStyleProfiles(original, blocks, mapping);
  assert.equal(profiles.size, 1);
  const target = blocks.find(b => b.text === MIXED_TEXT), position = mapping.get(target.id);
  for (const mode of ['hidden', 'offset', 'duplicate']) {
    const changed = { ...original, streams: new Map([...original.streams].map(([name, raw]) => [name, raw.slice()])) };
    let ordinal = -1;
    for (const record of parseRecords(changed.streams.get('BodyText/Section0'))) {
      if (record.tag === 66) ordinal++;
      if (ordinal !== position.record_index || record.tag !== 68) continue;
      const v = new DataView(record.payload.buffer, record.payload.byteOffset, record.payload.byteLength);
      if (mode === 'hidden') v.setUint32(4, 99999, true);
      else if (mode === 'duplicate') v.setUint32(8, 0, true);
      else v.setUint32(16, v.getUint32(16, true) + 1, true);
    }
    assert.equal(mixedStyleProfiles(changed, blocks, mapping).size, 0);
    assert.throws(() => verifyMixedStylePreservation(changed, [{ target_id: target.id }], profiles), e => e.code === 'PRESERVATION_MISMATCH');
    if (mode === 'offset') assert(verifyPreservation(original.streams, changed.streams, [{ ...position }]).verified,
      'additional mixed proof must enforce positions that common targeted canonicalization deliberately omits');
  }
});
test('mixed refusal has fixed safe guidance without private payloads, retries or partial-save permission', () => {
  const error = new GuardError('MIXED_STYLE_EDIT_UNSUPPORTED'); error.private = 'PRIVATE_SENTINEL';
  const result = documentToolError(error), d = result.structuredContent.data.edit_diagnostic;
  assert(result.isError); assert.equal(d.saved, false); assert.equal(d.retry_same_request_recommended, false);
  assert.equal(d.automatic_partial_save_allowed, false); assert.equal(d.unrequested_edits_allowed, false);
  assert(!JSON.stringify(result).includes('PRIVATE_SENTINEL')); assert(d.message_ko.includes('한 서식 구간'));
});
