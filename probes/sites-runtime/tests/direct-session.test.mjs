import assert from 'node:assert/strict';
import test from 'node:test';
import fs from 'node:fs';
import { createRequire } from 'node:module';
import { pathToFileURL } from 'node:url';
import { HwpDocument, initSync } from '@rhwp/core';
import { createEngineApi } from '../../../src/one_hwp/rhwp_api.mjs';
import { corpus, syntheticFixture } from '../../../src/one_hwp/synthetic_fixtures.mjs';
import { createDocumentEngine } from '../engine/document.mjs';
import { createDocumentService } from '../storage/service.mjs';
import { profileSyntheticEngine } from '../scripts/synthetic-engine-profile.mjs';
import { withPageNumber, rewriteSyntheticBody } from './page-number-fixtures.mjs';
import { miniGrowthFixture } from './cell-list-fixtures.mjs';

const require = createRequire(import.meta.url);
initSync({ module: fs.readFileSync(new URL('./rhwp_bg.wasm', pathToFileURL(require.resolve('@rhwp/core')))) });
const api = createEngineApi(HwpDocument), engine = createDocumentEngine(HwpDocument);
const fixture = (options = {}) => syntheticFixture(HwpDocument, api.exportChecked, options);
const read = (snapshot) => snapshot.read({ expected_sha256: snapshot.source_sha256, max_chars: 64000 }).blocks;
const request = (snapshot, targets, new_text = '합성 한 세션 편집 😀') => ({ expected_sha256: snapshot.source_sha256,
  operations: targets.map((block) => ({ target_id: block.target_id, expected_old: block.text, new_text })) });

for (const [index, spec] of corpus.entries()) {
  test(`direct session ${index + 1}: same checked bytes, model and preflight as snapshot editing`, async () => {
    const bytes = fixture(spec), original = bytes.slice(), snapshot = await engine.open(bytes);
    const blocks = read(snapshot);
    const targets = [blocks.find((b) => b.kind === 'paragraph' && b.editable && b.text),
      blocks.find((b) => b.kind === 'cell' && b.editable)].filter(Boolean);
    const options = request(snapshot, targets);
    assert.deepEqual(await engine.preflight(bytes, options, snapshot.source_sha256), await snapshot.preflight(options));
    const direct = await engine.edit(bytes, options, snapshot.source_sha256), old = await snapshot.edit(options);
    assert.deepEqual(direct, old);
    const after = read(await engine.open(direct.bytes));
    assert.deepEqual(after.map((b) => [b.id, b.text, b.style]), blocks.map((b) => [b.id,
      targets.some((t) => t.id === b.id) ? options.operations[0].new_text : b.text, b.style]));
    assert.deepEqual(bytes, original);
  });
}

test('each direct request constructs/frees two documents; repair still gets a fresh independent reopen', async () => {
  for (const [name, bytes] of [['ordinary', fixture()], ['repair', miniGrowthFixture(HwpDocument, api).bytes]]) {
    const snapshot = await engine.open(bytes), target = read(snapshot).find((b) => b.kind === 'cell' && b.editable && b.text);
    const options = request(snapshot, [target]), profile = profileSyntheticEngine(HwpDocument);
    const fast = createDocumentEngine(profile.Document);
    for (const phase of ['preflight', 'edit']) {
      profile.setPhase(phase);
      const result = await fast[phase](bytes, options, snapshot.source_sha256);
      assert.equal(result.raw_preservation_verified, true);
      const row = profile.report()[phase], expected = name === 'repair' ? 3 : 2;
      assert.equal(row.constructor.calls, expected);
      assert.equal(row.free.calls, expected);
    }
  }
});

test('direct request captures bytes/options before hashing; stale, duplicate, empty fill and clear checks remain', async () => {
  const bytes = fixture({ cells: [['', '원문'], ['질문', '답변']], boldCell: true });
  const original = bytes.slice(), snapshot = await engine.open(bytes), blocks = read(snapshot);
  const fill = blocks.find((b) => b.empty_cell_fill_supported), clear = blocks.find((b) => b.cell_text_clear_supported);
  const edit = request(snapshot, [fill]);
  const pending = engine.edit(bytes, edit, snapshot.source_sha256);
  bytes.fill(0); edit.operations[0].new_text = 'caller changed request';
  const result = await pending;
  assert.equal(read(await engine.open(result.bytes)).find((b) => b.id === fill.id).text, '합성 한 세션 편집 😀');
  assert.deepEqual(await engine.edit(original, request(snapshot, [clear], '')), await snapshot.edit(request(snapshot, [clear], '')));
  for (const [options, code] of [
    [{ ...request(snapshot, [fill]), expected_sha256: '0'.repeat(64) }, 'VERSION_CONFLICT'],
    [request(snapshot, [fill, fill]), 'DUPLICATE_TARGET'],
    [request(snapshot, [fill], '\t'), 'INVALID_OPERATION'],
    [{ ...request(snapshot, [fill]), operations: [{ ...request(snapshot, [fill]).operations[0], expected_old: 'stale' }] }, 'EXPECTED_OLD_MISMATCH'],
  ]) {
    await assert.rejects(engine.edit(original, options), (e) => e.code === code);
    await assert.rejects(engine.preflight(original, options), (e) => e.code === code);
  }
});

test('storage hash mismatch fails before WASM; service authorizes every request before using direct methods', async () => {
  const bytes = fixture(), snapshot = await engine.open(bytes), options = request(snapshot, [read(snapshot).find((b) => b.editable)]);
  const profile = profileSyntheticEngine(HwpDocument); profile.setPhase('reject');
  const direct = createDocumentEngine(profile.Document);
  await assert.rejects(direct.edit(bytes, options, '0'.repeat(64)), (e) => e.code === 'BLOB_MISSING_OR_CORRUPT');
  assert.equal(profile.report().reject, undefined);
  const calls = [], store = { async read(args) { calls.push(['read', args.owner]); throw Error('denied'); },
    replace() { throw Error('must not publish'); } };
  const service = createDocumentService({ edit() { throw Error('must not edit'); }, preflight() { throw Error('must not plan'); } }, store);
  await assert.rejects(service.edit({ owner: 'a', expected_version: 'v', request: options }), /denied/);
  await assert.rejects(service.preflight({ owner: 'b', version_id: 'v', request: options }), /denied/);
  assert.deepEqual(calls, [['read', 'a'], ['read', 'b']]);
});

test('preparation cannot alter authoritative source model; callback rejection always frees the source', () => {
  const bytes = fixture({ table: false }), profile = profileSyntheticEngine(HwpDocument), checkedApi = createEngineApi(profile.Document);
  profile.setPhase('reject');
  assert.throws(() => checkedApi.editDocumentPrepared(bytes, (inspection) => {
    const block = inspection.blocks.find((b) => b.editable); block.text = 'forged';
    return { operations: [{ target_id: block.id, expected_old: 'forged', new_text: 'forged result' }] };
  }), /Target is stale/);
  assert.equal(profile.report().reject.constructor.calls, 1);
  assert.equal(profile.report().reject.free.calls, 1);
  assert.equal(profile.report().reject.export, undefined);
  assert.throws(() => checkedApi.editDocumentPrepared(bytes, () => Promise.resolve({ operations: [] })), /Invalid edit preparation/);
});

test('direct page-number edit retains raw guard: corrupt opaque control yields no result or save', async () => {
  const bytes = withPageNumber(fixture()), original = bytes.slice(), snapshot = await engine.open(bytes);
  const options = request(snapshot, [read(snapshot).find((b) => b.kind === 'cell' && b.editable)]);
  assert.deepEqual(await engine.edit(bytes, options), await snapshot.edit(options));
  const Corrupt = new Proxy(HwpDocument, { construct(Type, args) {
    const doc = new Type(...args), exportOriginal = doc.exportHwpWithReport.bind(doc);
    doc.exportHwpWithReport = () => {
      const exported = exportOriginal(), take = exported.takeBytes.bind(exported);
      exported.takeBytes = () => rewriteSyntheticBody(take(), (records) => {
        const record = records.find((r) => r.tag === 71 && new TextDecoder().decode(r.payload.subarray(0, 4)) === 'pngp');
        assert(record); record.payload = record.payload.slice(); record.payload[10] ^= 1;
        return records;
      });
      return exported;
    };
    return doc;
  } });
  let saves = 0;
  const service = createDocumentService(createDocumentEngine(Corrupt), {
    async read() { return { bytes, sha256: snapshot.source_sha256 }; }, replace() { saves++; } });
  await assert.rejects(service.edit({ owner: 'synthetic', expected_version: 'version', request: options }),
    (e) => e.code === 'PRESERVATION_MISMATCH');
  assert.equal(saves, 0); assert.deepEqual(bytes, original);
});
