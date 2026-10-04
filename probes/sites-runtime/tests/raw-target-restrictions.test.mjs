import assert from 'node:assert/strict';
import test from 'node:test';
import fs from 'node:fs';
import { createRequire } from 'node:module';
import { pathToFileURL } from 'node:url';
import { HwpDocument, initSync } from '@rhwp/core';
import { createEngineApi } from '../../../src/one_hwp/rhwp_api.mjs';
import { syntheticFixture } from '../../../src/one_hwp/synthetic_fixtures.mjs';
import { rawTargetRestrictions } from '../engine/raw-target-restrictions.mjs';
import { createDocumentEngine } from '../engine/document.mjs';
import { encodeRecords, rewriteSyntheticBody } from './page-number-fixtures.mjs';

const shapes = (entries) => {
  const p = new Uint8Array(entries.length * 8), v = new DataView(p.buffer);
  entries.forEach(([start, id], i) => { v.setUint32(i * 8, start, true); v.setUint32(i * 8 + 4, id, true); });
  return p;
};
const block = { id: 's0:p0', editable: true, style: { char_shape_ids: [0] } };
const mapping = new Map([[block.id, { section: 0, record_index: 0 }]]);
const restriction = (payloads, textRecords = 1) => rawTargetRestrictions({ profile: { sections: [{ section: 0 }] },
  streams: new Map([['BodyText/Section0', encodeRecords([{ tag: 66, level: 0, payload: new Uint8Array(22) },
    ...Array.from({ length: textRecords }, () => ({ tag: 67, level: 1, payload: new Uint8Array([13, 0]) })),
    ...payloads.map((payload) => ({ tag: 68, level: 1, payload }))])]]) }, [block], mapping);

test('raw style restrictions retain matching/duplicate IDs but reject uncovered and unverified references', () => {
  assert.equal(restriction([shapes([[0, 0]])]).size, 0);
  assert.equal(restriction([shapes([[0, 0], [9, 0]])]).size, 0);
  assert.equal(restriction([shapes([[0, 0], [9, 1]])]).get(block.id)[0].code, 'RAW_CHAR_SHAPE_REFS_UNCOVERED');
  for (const payloads of [[], [new Uint8Array()], [new Uint8Array(9)], [shapes([[0, 0]]), shapes([[0, 0]])]]) {
    assert.equal(restriction(payloads).get(block.id)[0].code, 'RAW_CHAR_SHAPE_LAYOUT_UNVERIFIED');
  }
});

test('missing and multiple text records are readonly without claiming text insertion support', () => {
  for (const count of [0, 2]) assert.equal(restriction([shapes([[0, 0]])], count).get(block.id)[0].code,
    'RAW_TEXT_RECORD_LAYOUT_UNVERIFIED');
});

const require = createRequire(import.meta.url);
initSync({ module: fs.readFileSync(new URL('./rhwp_bg.wasm', pathToFileURL(require.resolve('@rhwp/core')))) });
const api = createEngineApi(HwpDocument), engine = createDocumentEngine(HwpDocument);

test('nonvisible tail style remains readable, is explicitly readonly and cannot enter plans or saves', async () => {
  // bold body generates a VALID alternate charShape id; cell visible text is id 0.
  const base = syntheticFixture(HwpDocument, api.exportChecked, { bold: true, paragraphs: ['합성 검증', '보존'] });
  const d = api.openDocument(base), model = api.inspectDocument(d); d.free();
  const alternateId = model.blocks[0].style.char_shape_ids[0];
  assert.notEqual(alternateId, 0);
  const cell = model.blocks.find((b) => b.kind === 'cell');
  const input = rewriteSyntheticBody(base, (records) => {
    let firstCell = false, finished = false;
    return records.map((r) => {
      if (r.tag === 66) {
        firstCell = !finished && r.level === 2;
        if (firstCell) { const payload = r.payload.slice(); new DataView(payload.buffer).setUint16(12, 2, true); return { ...r, payload }; }
      }
      if (firstCell && r.tag === 68 && !finished) {
        finished = true; return { ...r, payload: shapes([[0, 0], [cell.text.length, alternateId]]) };
      }
      return r;
    });
  });
  const original = input.slice(), snapshot = await engine.open(input);
  const before = snapshot.read({ expected_sha256: snapshot.source_sha256 });
  const target = before.blocks.find((b) => b.id === cell.id);
  assert.equal(target.text, cell.text);
  assert.deepEqual(target.style.char_shape_ids, [0]);
  assert.equal(target.editable, false);
  assert.equal(target.edit_restrictions[0].code, 'RAW_CHAR_SHAPE_REFS_UNCOVERED');
  const request = { expected_sha256: snapshot.source_sha256,
    operations: [{ target_id: target.target_id, expected_old: target.text, new_text: '요청 문구' }] };
  assert.throws(() => snapshot.plan(request), (e) => e.code === 'TARGET_NOT_EDITABLE');
  await assert.rejects(snapshot.preflight(request), (e) => e.code === 'TARGET_NOT_EDITABLE');
  await assert.rejects(snapshot.edit(request), (e) => e.code === 'TARGET_NOT_EDITABLE');
  assert.deepEqual(input, original);
  target.edit_restrictions[0].code = 'tampered';
  assert.equal(snapshot.read({ expected_sha256: snapshot.source_sha256 }).blocks.find((b) => b.id === cell.id)
    .edit_restrictions[0].code, 'RAW_CHAR_SHAPE_REFS_UNCOVERED');
  // Another cell can still be edited while the non-target tail references survive.
  const other = before.blocks.find((b) => b.kind === 'cell' && b.editable && b.text);
  const edited = await snapshot.edit({ expected_sha256: snapshot.source_sha256,
    operations: [{ target_id: other.target_id, expected_old: other.text, new_text: '합성 새 문구' }] });
  assert.equal(edited.raw_preservation_verified, true);
});

test('an empty cell without a serialized text record is readable but cannot be filled', async () => {
  const base = syntheticFixture(HwpDocument, api.exportChecked, { paragraphs: ['합성 검증', '보존'] });
  const d = api.openDocument(base), model = api.inspectDocument(d); d.free();
  const cell = model.blocks.find((b) => b.kind === 'cell');
  const input = rewriteSyntheticBody(base, (records) => {
    let firstCell = false, finished = false;
    return records.flatMap((r) => {
      if (r.tag === 66) {
        firstCell = !finished && r.level === 2;
        if (firstCell) {
          const payload = r.payload.slice(), v = new DataView(payload.buffer);
          v.setUint32(0, (v.getUint32(0, true) & 0x80000000) | 1, true);
          return [{ ...r, payload }];
        }
      }
      if (firstCell && r.tag === 67 && !finished) { finished = true; return []; }
      return [r];
    });
  });
  const original = input.slice(), snapshot = await engine.open(input);
  const target = snapshot.read({ expected_sha256: snapshot.source_sha256 }).blocks.find((b) => b.id === cell.id);
  assert.equal(target.text, '');
  assert.equal(target.editable, false);
  assert.equal(target.edit_restrictions[0].code, 'RAW_TEXT_RECORD_LAYOUT_UNVERIFIED');
  const request = { expected_sha256: snapshot.source_sha256,
    operations: [{ target_id: target.target_id, expected_old: '', new_text: '합성 추가' }] };
  assert.throws(() => snapshot.plan(request), (e) => e.code === 'TARGET_NOT_EDITABLE');
  await assert.rejects(snapshot.preflight(request), (e) => e.code === 'TARGET_NOT_EDITABLE');
  await assert.rejects(snapshot.edit(request), (e) => e.code === 'TARGET_NOT_EDITABLE');
  assert.deepEqual(input, original);
});
