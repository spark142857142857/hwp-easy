import assert from 'node:assert/strict';
import test from 'node:test';
import fs from 'node:fs';
import { createRequire } from 'node:module';
import { pathToFileURL } from 'node:url';
import { HwpDocument, initSync } from '@rhwp/core';
import { createEngineApi } from '../../../src/one_hwp/rhwp_api.mjs';
import { syntheticFixture, corpus } from '../../../src/one_hwp/synthetic_fixtures.mjs';
import { createDocumentEngine, mapRawTargets } from '../../../src/one_hwp/engine/document.mjs';
import { rawUniformStyleProofs } from '../../../src/one_hwp/engine/uniform-style.mjs';
import { readHwp } from '../../../src/one_hwp/guard/container.mjs';
import { parseRecords } from '../../../src/one_hwp/guard/records.mjs';
import { encodeRecords } from '../../../tests/fixtures/page-number-fixtures.mjs';
import { profileSyntheticEngine } from '../../../tests/fixtures/synthetic-engine-profile.mjs';
const require = createRequire(import.meta.url);
initSync({ module: fs.readFileSync(new URL('./rhwp_bg.wasm', pathToFileURL(require.resolve('@rhwp/core')))) });
const api = createEngineApi(HwpDocument);
const fixture = spec => syntheticFixture(HwpDocument, api.exportChecked, spec);
const full = snapshot => snapshot.read({ expected_sha256: snapshot.source_sha256, max_chars: 64000 });

test('long plain body and cell: bounded queries, identical full model and checked bytes', async () => {
  const text = '가😀e\u0301'.repeat(2500), bytes = fixture({ paragraphs: ['합성', text, '끝'], cells: [['문항', text], ['반복', '보존']] });
  const original = bytes.slice(), profiled = profileSyntheticEngine(HwpDocument), fast = createDocumentEngine(profiled.Document);
  profiled.setPhase('open'); const opened = await fast.open(bytes), before = full(opened);
  const legacy = createDocumentEngine(HwpDocument, { uniformStyleInspection: false }), old = await legacy.open(bytes);
  assert.deepEqual(before, full(old));
  assert(profiled.report().open.inspection_queries.calls < 100, 'uniform raw proof replaces per-glyph queries');
  const targets = before.blocks.filter(b => b.text === text);
  assert.equal(targets.length, 2); assert(targets.every(b => b.editable));
  const request = { expected_sha256: opened.source_sha256, operations: targets.map(b => ({
    target_id: b.target_id, expected_old: b.text, new_text: '나😀e\u0301'.repeat(2500) })) };
  profiled.setPhase('preflight');
  assert.deepEqual(await fast.preflight(bytes, request), await legacy.preflight(bytes, request));
  const preflightCounters = profiled.report().preflight;
  profiled.setPhase('edit');
  const result = await fast.edit(bytes, request), baseline = await legacy.edit(bytes, request);
  assert.deepEqual(result, baseline);
  assert(result.raw_preservation_verified);
  assert.equal(preflightCounters.constructor.calls, 2);
  assert.equal(preflightCounters.free.calls, 2);
  assert(preflightCounters.inspection_queries.calls < 200);
  const after = full(await fast.open(result.bytes));
  assert.deepEqual(after.blocks.map(b => [b.id, b.text, b.style]), before.blocks.map(b => [b.id,
    targets.some(t => t.id === b.id) ? request.operations[0].new_text : b.text, b.style]));
  assert.deepEqual(bytes, original);
});

test('existing corpus and mixed/control paragraphs retain legacy model and fallback scan', async () => {
  const fast = createDocumentEngine(HwpDocument), old = createDocumentEngine(HwpDocument, { uniformStyleInspection: false });
  for (const spec of corpus) {
    const bytes = fixture(spec);
    assert.deepEqual(full(await fast.open(bytes)), full(await old.open(bytes)));
  }
  const text = '가'.repeat(5000), bytes = fixture({ table: false, mixed: true, paragraphs: [text, '끝'] });
  const tracked = profileSyntheticEngine(HwpDocument); tracked.setPhase('mixed');
  const opened = await createDocumentEngine(tracked.Document).open(bytes);
  assert.deepEqual(full(opened), full(await old.open(bytes)));
  assert(tracked.report().mixed.inspection_queries.calls >= 5000);
});

test('raw proof rejects duplicate, nonzero/tail anchors, inconsistent counts and extra records', () => {
  const text = '가'.repeat(5000), bytes = fixture({ table: false, paragraphs: ['합성', text, '끝'] });
  const document = api.openDocument(bytes); let blocks;
  try { blocks = api.inspectDocument(document).blocks; } finally { document.free(); }
  const source = readHwp(bytes), mapping = mapRawTargets(source, blocks), target = blocks.find(b => b.text === text);
  assert.equal(rawUniformStyleProofs(source, blocks, mapping).get(target.id), target.style.char_shape_ids[0]);
  for (const variant of ['duplicate_shape', 'tail_shape', 'nonzero_start', 'header_count', 'extra_record', 'nested_paragraph', 'text_difference']) {
    const records = [...parseRecords(source.streams.get('BodyText/Section0'))].map(r => ({ ...r, payload: r.payload.slice() }));
    const ordinal = mapping.get(target.id).record_index; let seen = -1, start;
    for (const [index, record] of records.entries()) if (record.tag === 66 && ++seen === ordinal) { start = index; break; }
    const header = records[start], shapeIndex = records.findIndex((r, i) => i > start && r.tag === 68), shape = records[shapeIndex];
    if (variant === 'duplicate_shape') records.splice(shapeIndex, 0, { ...shape, payload: shape.payload.slice() });
    if (variant === 'tail_shape') { const value = new Uint8Array(16); value.set(shape.payload); new DataView(value.buffer).setUint32(8, text.length, true); shape.payload = value; }
    if (variant === 'nonzero_start') new DataView(shape.payload.buffer).setUint32(0, 1, true);
    if (variant === 'header_count') new DataView(header.payload.buffer).setUint16(12, 2, true);
    if (variant === 'extra_record') records.splice(shapeIndex, 0, { tag: 70, level: 1, payload: new Uint8Array(12) });
    if (variant === 'nested_paragraph') records.splice(shapeIndex + 2, 0, { tag: 66, level: 2, payload: header.payload.slice() });
    if (variant === 'text_difference') new DataView(records[start + 1].payload.buffer).setUint16(0, '나'.charCodeAt(0), true);
    const decoded = { ...source, streams: new Map(source.streams) }; decoded.streams.set('BodyText/Section0', encodeRecords(records));
    assert.equal(rawUniformStyleProofs(decoded, blocks, mapping).has(target.id), false, variant);
  }
});

test('a disagreement in the sampled model shape falls back to full scan', async () => {
  const text = '가'.repeat(5000), bytes = fixture({ table: false, paragraphs: ['합성', text, '끝'] });
  let calls = 0;
  const Type = new Proxy(HwpDocument, { construct(Target, args) {
    const doc = Reflect.construct(Target, args, Target);
    return new Proxy(doc, { get(source, key) {
      const value = Reflect.get(source, key, source);
      if (typeof value !== 'function') return value;
      return (...args) => {
        const result = Reflect.apply(value, source, args);
        if (key !== 'getCharPropertiesAt' || args[1] !== 1) return result;
        calls++; if (args[2] !== 2500) return result;
        const properties = JSON.parse(result); properties.charShapeId = 1; return JSON.stringify(properties);
      };
    } });
  } });
  const opened = await createDocumentEngine(Type).open(bytes);
  assert(calls >= 5000);
  assert.deepEqual(full(opened), full(await createDocumentEngine(Type, { uniformStyleInspection: false }).open(bytes)));
});

test('proof provider receives detached bytes/model and original style budget remains charged', () => {
  const fake = {
    getDocumentInfo: () => '{"sectionCount":1,"pageCount":1}', getCursorModel: () => '{"lists":[]}', getControls: () => '[]',
    getSectionCount: () => 1, getParagraphCount: () => 9, getParagraphLength: () => 100000,
    getTextRange: () => '가'.repeat(100000), getParaPropertiesAt: () => '{}', getCharPropertiesAt: () => '{"charShapeId":0}',
    getValidationWarnings: () => '{"count":0}'
  };
  const bytes = Uint8Array.of(1, 2, 3);
  const fast = createEngineApi(HwpDocument, { uniformStyleProofs(copy, blocks) {
    copy.fill(0); const ids = blocks.map(b => [b.id, 0]); blocks[0].text = 'mutated'; return new Map(ids);
  } });
  const before = fast.inspectDocument(fake, bytes);
  assert.equal(before.blocks[0].text.length, 100000);
  assert.deepEqual(bytes, Uint8Array.of(1, 2, 3));
  assert(before.blocks.slice(0, 8).every(b => b.editable));
  assert.equal(before.blocks[8].style.profile, 'style_scan_limit_exceeded');
  assert.throws(() => createEngineApi(HwpDocument, { uniformStyleProofs: true }), /Invalid uniform/);
  assert.throws(() => createEngineApi(HwpDocument, { uniformStyleProofs: () => ({}) }).inspectDocument(fake, bytes), /Invalid uniform style proofs/);
});
