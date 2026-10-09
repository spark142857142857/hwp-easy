import assert from 'node:assert/strict';
import test from 'node:test';
import fs from 'node:fs';
import { createRequire } from 'node:module';
import { pathToFileURL } from 'node:url';
import { HwpDocument, initSync } from '@rhwp/core';
import { createEngineApi } from '../../../src/one_hwp/rhwp_api.mjs';
import { syntheticFixture } from '../../../src/one_hwp/synthetic_fixtures.mjs';
import { createDocumentEngine } from '../engine/document.mjs';
import { createReadInspectionCache } from '../engine/read-inspection-cache.mjs';

const require = createRequire(import.meta.url);
initSync({ module: fs.readFileSync(new URL('./rhwp_bg.wasm', pathToFileURL(require.resolve('@rhwp/core')))) });
const api = createEngineApi(HwpDocument);
const fixture = () => syntheticFixture(HwpDocument, api.exportChecked, {
  paragraphs: ['합성 좌표 시험', '보존'], merged: true,
  cells: [['반복', '반복', '반복'], ['반복', '반복', '반복'], ['', '', '']]
});
const whole = (snapshot) => snapshot.read({ expected_sha256: snapshot.source_sha256, max_chars: 64000 });

test('merged repeated cells require returned coordinates and exact ID, preserving all other paragraphs', async () => {
  const bytes = fixture(), original = bytes.slice(), engine = createDocumentEngine(HwpDocument);
  const snapshot = await engine.open(bytes), before = whole(snapshot), cells = before.blocks.filter((b) => b.kind === 'cell');
  assert.equal(before.coordinate_system.index_base, 0);
  const merged = cells.filter((b) => b.row === 0 && b.column === 0);
  assert.equal(merged.length, 2);
  assert.deepEqual(merged.map((b) => [b.cell, b.cell_paragraph, b.row_span, b.column_span]), [[0, 0, 1, 2], [0, 1, 1, 2]]);
  const target = cells.find((b) => b.row === 1 && b.column === 0);
  assert.equal(target.cell, 2);
  assert.notEqual(target.cell, target.row * 3 + target.column);
  assert.ok(cells.filter((b) => b.text === target.text).length > 1);
  const request = { expected_sha256: snapshot.source_sha256,
    operations: [{ target_id: target.target_id, expected_old: target.text, new_text: '선택 칸 검증' }] };
  const plan = await snapshot.preflight(request);
  assert.equal(plan.saved, false);
  const result = await snapshot.edit(request), reopened = await engine.open(result.bytes), after = whole(reopened);
  assert.equal(result.raw_preservation_verified, true);
  assert.deepEqual(after.blocks.map((b) => [b.id, b.text, b.style, b.row, b.column, b.row_span, b.column_span]),
    before.blocks.map((b) => [b.id, b.id === target.id ? request.operations[0].new_text : b.text,
      b.style, b.row, b.column, b.row_span, b.column_span]));
  await assert.rejects(reopened.preflight({ expected_sha256: reopened.source_sha256, operations: request.operations }),
    (e) => e.code === 'TARGET_VERSION_OR_ID_INVALID');
  assert.deepEqual(bytes, original);
});

test('coordinate metadata remains detached across continued and cached reads including zero anchors', async () => {
  const bytes = fixture(), cache = createReadInspectionCache(), engine = createDocumentEngine(HwpDocument, { readInspectionCache: cache });
  const snapshot = await engine.open(bytes), sourceHash = snapshot.source_sha256;
  const scope = { owner: 'synthetic-coordinate-owner', document_id: 'synthetic-document', version_id: 'synthetic-version' };
  const handle = await engine.openRead(bytes, scope, sourceHash);
  let page = handle.read({ expected_sha256: sourceHash, max_chars: 1, max_blocks: 1 });
  const expected = structuredClone(page.coordinate_system), seen = new Map();
  while (true) {
    assert.deepEqual(page.coordinate_system, expected);
    for (const block of page.blocks) seen.set(block.id, [block.row, block.column, block.row_span, block.column_span]);
    const cursor = page.next_cursor;
    page.coordinate_system.index_base = 99;
    page.coordinate_system.index_fields.length = 0;
    if (!cursor) break;
    page = handle.read({ expected_sha256: sourceHash, cursor, max_chars: 1, max_blocks: 1 });
  }
  const hit = await engine.openRead(bytes, scope, sourceHash);
  assert.equal(cache.stats().hits, 1);
  assert.deepEqual(hit.read({ expected_sha256: sourceHash }).coordinate_system, expected);
  const zero = whole(snapshot).blocks.find((b) => b.kind === 'cell' && b.row === 0 && b.column === 0);
  assert.deepEqual(seen.get(zero.id), [0, 0, 1, 2]);
  assert.equal(seen.size, whole(snapshot).supported_blocks);
});
