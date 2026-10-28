import assert from 'node:assert/strict';
import test from 'node:test';
import fs from 'node:fs';
import { createRequire } from 'node:module';
import { pathToFileURL } from 'node:url';
import { HwpDocument, initSync } from '@rhwp/core';
import { createEngineApi } from '../../../src/one_hwp/rhwp_api.mjs';
import { syntheticFixture } from '../../../src/one_hwp/synthetic_fixtures.mjs';
import { createDocumentEngine } from '../../../src/one_hwp/engine/document.mjs';
import { readHwp } from '../../../src/one_hwp/guard/container.mjs';
import { GuardError, parseRecords } from '../../../src/one_hwp/guard/records.mjs';
import { verifyPreservation, textControlBytes } from '../../../src/one_hwp/guard/preservation.mjs';
import { pageNumberPreservationProfile } from '../../../src/one_hwp/guard/page-number.mjs';
import { encodeRecords, withPageNumber, rewriteSyntheticBody } from '../../../tests/fixtures/page-number-fixtures.mjs';
const require = createRequire(import.meta.url);
initSync({ module: fs.readFileSync(new URL('./rhwp_bg.wasm', pathToFileURL(require.resolve('@rhwp/core')))) });
const api = createEngineApi(HwpDocument), engine = createDocumentEngine(HwpDocument);
const base = () => syntheticFixture(HwpDocument, api.exportChecked);
const options = (snapshot, extra = {}) => ({ expected_sha256: snapshot.source_sha256, ...extra });
const code = (expected) => (error) => error instanceof GuardError && error.code === expected;
const isPageNumber = (record) => record.tag === 71 && Buffer.from(record.payload.subarray(0, 4)).toString() === 'pngp';
const inspection = (bytes) => {
  const doc = api.openDocument(bytes);
  try { return api.inspectDocument(doc); } finally { doc.free(); }
};
function pageControlBytes(decoded) {
  const records = [...parseRecords(decoded.streams.get('BodyText/Section0'))];
  return records.filter(isPageNumber).map((record) => Buffer.from(record.payload));
}
function mutated(decoded, change) {
  const streams = new Map(decoded.streams);
  const records = [...parseRecords(streams.get('BodyText/Section0'))].map((record) => ({ ...record, payload: record.payload.slice() }));
  streams.set('BodyText/Section0', encodeRecords(change(records)));
  return { ...decoded, streams };
}

for (const spec of [{}, { paragraph: 1 }, { position: 1, prefix: 91, suffix: 93 },
  { position: 10, numberFormat: 1, userSymbol: 9733 }]) {
  test(`pgnp preservation-only body/cell edit and reopen: ${JSON.stringify(spec)}`, async () => {
    const bytes = withPageNumber(base(), spec), original = bytes.slice(), raw = readHwp(bytes);
    const snapshot = await engine.open(bytes);
    let cursor = null, last; const blocks = [];
    do {
      last = snapshot.read(options(snapshot, { cursor, max_blocks: 1, max_chars: 64000 }));
      blocks.push(...last.blocks); cursor = last.next_cursor;
      assert.equal(last.all_content_supported, false);
      assert.equal(last.content_complete, false);
      assert.equal(last.edit_profile_supported, true);
      assert.equal(last.preserved_controls.length, 1);
    } while (cursor);
    assert.equal(new Set(blocks.map((b) => b.id)).size, blocks.length);
    assert.equal(last.complete, true);
    assert.equal(last.unsupported[0].control_id, 'pgnp');
    const host = blocks.find((b) => b.id === `s0:p${spec.paragraph ?? 0}`);
    assert.equal(host.editable, false);
    assert.throws(() => snapshot.plan(options(snapshot, { operations: [{ target_id: host.target_id,
      expected_old: host.text, new_text: '호스트 수정 거부' }] })), code('TARGET_NOT_EDITABLE'));
    const targets = ['paragraph', 'cell'].map((kind) => blocks.find((b) => b.kind === kind && b.editable && b.text));
    assert.ok(targets.every(Boolean));
    const operations = targets.map((b, i) => ({ target_id: b.target_id, expected_old: b.text, new_text: `국소 합성 수정 ${i} 😀` }));
    assert.equal(snapshot.plan(options(snapshot, { operations })).file_changed, false);
    const output = await snapshot.edit(options(snapshot, { operations }));
    assert.equal(output.raw_preservation_verified, true);
    assert.equal(output.content_verified, true);
    assert.equal(output.layout_verified, false);
    assert.deepEqual(bytes, original);
    const after = readHwp(output.bytes);
    assert.deepEqual(pageControlBytes(after), pageControlBytes(raw));
    assert.deepEqual([...parseRecords(after.streams.get('BodyText/Section0'))].filter((r) => r.tag === 67).map((r) => textControlBytes(r.payload)),
      [...parseRecords(raw.streams.get('BodyText/Section0'))].filter((r) => r.tag === 67).map((r) => textControlBytes(r.payload)));
    const saved = await engine.open(output.bytes), read = saved.read(options(saved));
    assert.equal(read.edit_profile_supported, true);
    assert.equal(read.content_complete, false);
    const expected = new Map(blocks.map((b) => [b.id, operations.find((op) => op.target_id === b.target_id)?.new_text ?? b.text]));
    for (const block of read.blocks) assert.equal(block.text, expected.get(block.id));
  });
}

test('pgnp shape proof rejects missing/duplicate records, wrong nesting/size/attributes/anchors/model coverage', () => {
  const bytes = withPageNumber(base()), decoded = readHwp(bytes), unsupported = inspection(bytes).unsupported;
  assert.equal(pageNumberPreservationProfile(decoded, unsupported).length, 1);
  const changes = [
    (records) => records.filter((r) => !isPageNumber(r)),
    (records) => records.flatMap((r) => isPageNumber(r) ? [r, r] : [r]),
    (records) => records.map((r) => isPageNumber(r) ? { ...r, level: 2 } : r),
    (records) => records.map((r) => isPageNumber(r) ? { ...r, payload: r.payload.slice(0, 14) } : r),
    (records) => records.map((r) => { if (isPageNumber(r)) r.payload[7] |= 128; return r; }),
    (records) => records.map((r) => { if (isPageNumber(r)) r.payload[5] = 11; return r; }),
    (records) => records.map((r) => { if (isPageNumber(r)) r.payload[4] = 255; return r; }),
    (records) => records.map((r) => { if (isPageNumber(r)) r.payload[14] = 0; return r; }),
    (records) => records.flatMap((r) => isPageNumber(r) ? [r, { tag: 72, level: 2, payload: new Uint8Array(8) }] : [r]),
    ...[0, 6, 14].map((offset) => (records) => { const text = records.find((r) => r.tag === 67 && r.level === 1); text.payload[offset] ^= 1; return records; }),
  ];
  for (const change of changes) assert.equal(pageNumberPreservationProfile(mutated(decoded, change), unsupported), null);
  for (const model of [[], [{ ...unsupported[0], paragraph: 1 }], [{ ...unsupported[0], list: 1 }], [...unsupported, ...unsupported]]) {
    assert.equal(pageNumberPreservationProfile(decoded, model), null);
  }
  const multi = { ...decoded, profile: { ...decoded.profile, sections: [...decoded.profile.sections, { section: 1 }] },
    streams: new Map([...decoded.streams, ['BodyText/Section1', decoded.streams.get('BodyText/Section0')]]) };
  assert.equal(pageNumberPreservationProfile(multi, unsupported), null);
});

test('independent preservation rejects pgnp deletion, movement, property changes and anchor corruption', () => {
  const decoded = readHwp(withPageNumber(base()));
  const changes = [
    (records) => records.filter((r) => !isPageNumber(r)),
    (records) => { const index = records.findIndex(isPageNumber); [records[index], records[index + 1]] = [records[index + 1], records[index]]; return records; },
    ...[4, 5, 8, 10, 12, 14].map((offset) => (records) => { records.find(isPageNumber).payload[offset] ^= 1; return records; }),
    ...[0, 2, 6, 14].map((offset) => (records) => { records.find((r) => r.tag === 67 && r.level === 1).payload[offset] ^= 1; return records; }),
  ];
  for (const change of changes) assert.throws(() => verifyPreservation(decoded.streams, mutated(decoded, change).streams, []), code('PRESERVATION_MISMATCH'));
});

test('local/shared default remains blocked; explicit pgnp exception cannot allow a header', () => {
  const bytes = withPageNumber(base()), before = inspection(bytes), block = before.blocks.find((b) => b.kind === 'cell');
  const operations = [{ target_id: block.id, expected_old: block.text, new_text: '수정' }];
  assert.throws(() => api.editDocument(bytes, operations), /Unsupported edit profile/);
  const header = syntheticFixture(HwpDocument, api.exportChecked, { header: true });
  assert.throws(() => api.editDocument(header, operations, { preservePageNumbers: true }), /Unsupported edit profile/);
});

test('an unverified raw pgnp shape remains readable but rejects plans before an edit', async () => {
  const bytes = withPageNumber(base());
  const malformed = rewriteSyntheticBody(bytes, (records) => {
    const record = records.find(isPageNumber); record.payload = record.payload.slice(); record.payload[7] = 128;
    return records;
  });
  const snapshot = await engine.open(malformed), read = snapshot.read(options(snapshot));
  assert.equal(read.edit_profile_supported, false);
  assert.equal(read.content_complete, false);
  assert.deepEqual(read.preserved_controls, []);
  assert.ok(read.unsupported.some((item) => item.kind === 'page_number_profile'));
  assert.ok(read.blocks.every((block) => !block.editable));
  assert.throws(() => snapshot.plan(options(snapshot, { operations: [] })), code('UNSUPPORTED_EDIT_PROFILE'));
});

test('WASM property corruption returns no output bytes even when the text model is unchanged', async () => {
  class CorruptingDocument {
    constructor(bytes) {
      const doc = new HwpDocument(bytes), original = doc.exportHwpWithReport.bind(doc);
      doc.exportHwpWithReport = () => {
        const exported = original(), take = exported.takeBytes.bind(exported);
        exported.takeBytes = () => rewriteSyntheticBody(take(), (records) => {
          const record = records.find(isPageNumber); record.payload = record.payload.slice(); record.payload[10] = 91;
          return records;
        });
        return exported;
      };
      return doc;
    }
  }
  const bytes = withPageNumber(base()), snapshot = await createDocumentEngine(CorruptingDocument).open(bytes);
  const block = snapshot.read(options(snapshot)).blocks.find((b) => b.kind === 'cell' && b.editable);
  await assert.rejects(snapshot.edit(options(snapshot, { operations: [{ target_id: block.target_id,
    expected_old: block.text, new_text: block.text }] })), code('PRESERVATION_MISMATCH'));
  assert.equal(snapshot.read(options(snapshot)).source_sha256, snapshot.source_sha256);
});
