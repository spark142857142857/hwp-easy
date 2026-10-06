import assert from 'node:assert/strict';
import test from 'node:test';
import fs from 'node:fs';
import { createRequire } from 'node:module';
import { pathToFileURL } from 'node:url';
import { HwpDocument, initSync } from '@rhwp/core';
import { createEngineApi } from '../../../src/one_hwp/rhwp_api.mjs';
import { syntheticFixture } from '../../../src/one_hwp/synthetic_fixtures.mjs';
import { createDocumentEngine } from '../engine/document.mjs';
import { enforceRawTextBudget } from '../guard/text-budget.mjs';
import { enforceHostedTextBudget, MAX_HOSTED_BODY_TEXT_CODE_UNITS } from '../guard/hosted-workload.mjs';
import { readHwp } from '../guard/container.mjs';
import { encodeRecords } from './page-number-fixtures.mjs';
import { makeRawTextLimitFixture } from '../scripts/performance-fixtures.mjs';

const require = createRequire(import.meta.url);
initSync({ module: fs.readFileSync(new URL('./rhwp_bg.wasm', pathToFileURL(require.resolve('@rhwp/core')))) });
const api = createEngineApi(HwpDocument);
const rejected = (error) => error.code === 'HOSTED_WORKLOAD_LIMIT_EXCEEDED';

test('hosted admission sums sections and cells in UTF-16 units, with an inclusive boundary', () => {
  for (const units of [399999, 400000, 400001]) {
    const decoded = { streams: new Map(), profile: { sections: [{ section: 0 }, { section: 1 }] } };
    // Multiple body paragraphs and nested cell paragraphs in multiple sections.
    // CR paragraph terminators are excluded; each supplementary emoji is two units.
    const sections = [
      [[1, '가'.repeat(99999)], [1, '😀'.repeat(50000)]],
      [[3, '나'.repeat(100000)], [3, '🚀'.repeat(50000)], [3, '끝'.repeat(units - 399999)]],
    ];
    sections.forEach((paragraphs, section) => decoded.streams.set(`BodyText/Section${section}`, encodeRecords(
      paragraphs.flatMap(([level, text]) => [
        { tag: 66, level: level - 1, payload: new Uint8Array(22) },
        { tag: 67, level, payload: Buffer.from(text + '\r', 'utf16le') },
      ]))));
    const count = enforceRawTextBudget(decoded);
    assert.equal(count, units);
    if (units <= MAX_HOSTED_BODY_TEXT_CODE_UNITS) assert.doesNotThrow(() => enforceHostedTextBudget(count));
    else assert.throws(() => enforceHostedTextBudget(count), rejected);
  }
});

test('UTF-16 counting distinguishes supplementary emoji, joined emoji and combining sequences', () => {
  const text = '😀👩‍💻✈️e\u0301'; // 2 + 5 + 2 + 2 units, not four rendered glyphs.
  const decoded = { streams: new Map([['BodyText/Section0', encodeRecords([
    { tag: 67, level: 1, payload: Buffer.from(text + '\r', 'utf16le') },
  ])]]), profile: { sections: [{ section: 0 }] } };
  assert.equal(text.length, 11); assert.equal(enforceRawTextBudget(decoded), 11);
});

test('source boundary admits 399999 and 400000 units to the engine and rejects 400001 before WASM', async () => {
  let constructions = 0;
  const fake = new Proxy(class {}, { construct() { constructions++; throw Error('synthetic sentinel'); } });
  const engine = createDocumentEngine(fake, { hostedWorkloadBudget: true });
  for (const units of [399999, 400000, 400001]) {
    const bytes = makeRawTextLimitFixture(units, HwpDocument, api), before = constructions;
    await assert.rejects(() => engine.open(bytes), units > MAX_HOSTED_BODY_TEXT_CODE_UNITS
      ? rejected : e => e.code === 'ENGINE_OPERATION_FAILED');
    assert.equal(constructions - before, units > MAX_HOSTED_BODY_TEXT_CODE_UNITS ? 0 : 1);
  }
  // Admission-only fixtures: reaching a sentinel constructor is not a valid
  // serialization, layout, or successful hosted boundary workload claim.
});

test('oversized compressed HWP cannot reach WASM or even a warm inspection cache on any engine entrypoint', async () => {
  const bytes = makeRawTextLimitFixture(1200000, HwpDocument, api), original = bytes.slice();
  assert(bytes.length < 4 * 1024 * 1024);
  assert.equal(enforceRawTextBudget(readHwp(bytes)), 1200000);
  let constructions = 0, cacheReads = 0;
  const fake = new Proxy(class {}, { construct() { constructions++; throw Error('unexpected WASM'); } });
  const engine = createDocumentEngine(fake, { hostedWorkloadBudget: true,
    readInspectionCache: { get() { cacheReads++; throw Error('unexpected cache'); } } });
  for (const action of [() => engine.open(bytes), () => engine.openRead(bytes, {}, '0'.repeat(64)),
    () => engine.edit(bytes, {}), () => engine.preflight(bytes, {})]) await assert.rejects(action, rejected);
  assert.equal(constructions, 0); assert.equal(cacheReads, 0); assert.deepEqual(bytes, original);
  // The generic/local adapter has not silently acquired the hosted pilot limit.
  await assert.rejects(() => createDocumentEngine(fake).open(bytes), e => e.code === 'ENGINE_OPERATION_FAILED');
  assert.equal(constructions, 1);
});

test('projected atomic edit is checked before any mutation, and stale old text cannot subtract from its budget', async () => {
  const bytes = syntheticFixture(HwpDocument, api.exportChecked,
    { paragraphs: ['a', 'b', 'c'], cells: [['😀', 'b\nc'], ['d', 'e']] }), original = bytes.slice();
  let mutations = 0;
  const observed = new Proxy(HwpDocument, { construct(Type, args) {
    const document = Reflect.construct(Type, args, Type);
    return new Proxy(document, { get(target, key) {
      const value = Reflect.get(target, key, target);
      if (typeof value !== 'function') return value;
      return (...args) => {
        if (['replaceText', 'insertText', 'deleteText', 'setCharShapeId',
          'insertTextInCell', 'deleteTextInCell', 'setCellCharShapeId'].includes(key)) mutations++;
        return Reflect.apply(value, target, args);
      };
    } });
  } });
  const engine = createDocumentEngine(observed, { hostedWorkloadBudget: true }), snapshot = await engine.open(bytes);
  const blocks = snapshot.read({ expected_sha256: snapshot.source_sha256 }).blocks;
  const selected = blocks.filter(b => b.editable).slice(0, 6);
  assert(selected.some(b => b.kind === 'paragraph')); assert(selected.some(b => b.kind === 'cell'));
  const unchangedUnits = enforceRawTextBudget(readHwp(bytes)) - selected.reduce((sum, b) => sum + b.text.length, 0);
  const operations = selected.map((b, i) => ({ target_id: b.target_id, expected_old: b.text,
    new_text: i === 0 ? '가'.repeat(59998) + '😀' : '나'.repeat(i === 5 ? 100000 - unchangedUnits : 60000) }));
  const request = { expected_sha256: snapshot.source_sha256, operations };
  const below = structuredClone(request); below.operations.at(-1).new_text = below.operations.at(-1).new_text.slice(0, -1);
  assert.equal(snapshot.plan(below).valid, true); // 399,999 units, including untouched text.
  assert.equal(snapshot.plan(request).valid, true); // Exactly 400,000 units; no serialization assertion.
  const oneOver = structuredClone(request); oneOver.operations.at(-1).new_text += '가';
  assert.throws(() => snapshot.plan(oneOver), rejected);
  const oversized = structuredClone(request); oversized.operations.at(-1).new_text += '😀';
  assert.throws(() => snapshot.plan(oversized), rejected);
  for (const over of [oneOver, oversized]) {
    for (const action of [() => snapshot.edit(over), () => snapshot.preflight(over),
      () => engine.edit(bytes, over), () => engine.preflight(bytes, over)]) await assert.rejects(action, rejected);
  }
  assert.equal(mutations, 0); assert.deepEqual(bytes, original);
  const stale = structuredClone(oversized); stale.operations[0].expected_old = '가'.repeat(100000);
  assert.throws(() => snapshot.plan(stale), e => e.code === 'EXPECTED_OLD_MISMATCH');
});
