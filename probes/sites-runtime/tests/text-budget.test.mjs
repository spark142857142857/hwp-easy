import assert from 'node:assert/strict';
import test from 'node:test';
import fs from 'node:fs';
import { createRequire } from 'node:module';
import { pathToFileURL } from 'node:url';
import { HwpDocument, initSync } from '@rhwp/core';
import { enforceRawTextBudget, MAX_RAW_BODY_TEXT_CODE_UNITS } from '../guard/text-budget.mjs';
import { createEngineApi } from '../../../src/one_hwp/rhwp_api.mjs';
import { createDocumentEngine } from '../engine/document.mjs';
import { readHwp } from '../guard/container.mjs';
import { makePerformanceFixture } from '../scripts/performance-fixtures.mjs';
import { encodeRecords } from './page-number-fixtures.mjs';

function decoded(payloads) {
  const streams = new Map(payloads.map((payload, index) => [`BodyText/Section${index}`,
    encodeRecords([{ tag: 67, level: 1, payload }])]));
  return { streams, profile: { sections: payloads.map((_, section) => ({ section })) } };
}
const utf16 = (text) => new Uint8Array(Buffer.from(text, 'utf16le'));
const limit = (error) => error.code === 'RAW_TEXT_LIMIT_EXCEEDED';

test('raw body text budget uses UTF-16 units and admits the exact boundary', () => {
  const text = '😀'.repeat(MAX_RAW_BODY_TEXT_CODE_UNITS / 2);
  assert.equal(enforceRawTextBudget(decoded([utf16(text + '\r')])), MAX_RAW_BODY_TEXT_CODE_UNITS);
  assert.throws(() => enforceRawTextBudget(decoded([utf16(text + '가\r')])), limit);
});

test('raw body text budget aggregates every section and cell-level text record', () => {
  assert.throws(() => enforceRawTextBudget(decoded([
    utf16('가'.repeat(1000000)), utf16('나'.repeat(1000001)),
  ])), limit);
  const records = encodeRecords([
    { tag: 67, level: 1, payload: utf16('본문\r') },
    { tag: 67, level: 3, payload: utf16('셀 😀\r') },
  ]);
  assert.equal(enforceRawTextBudget({ streams: new Map([['BodyText/Section0', records]]),
    profile: { sections: [{ section: 0 }] } }), 6);
});

test('opaque control slots are skipped, while tab and newline match visible text counting', () => {
  const slots = new Uint8Array(32), view = new DataView(slots.buffer);
  view.setUint16(0, 2, true); slots.fill(65, 2, 16); // Opaque bytes are not visible text.
  view.setUint16(16, 9, true); slots.fill(66, 18, 32); // Extended tab is one visible unit.
  const tail = utf16('한😀\n\r\0'), payload = new Uint8Array(slots.length + tail.length);
  payload.set(slots); payload.set(tail, slots.length);
  assert.equal(enforceRawTextBudget(decoded([payload])), 5);
  assert.equal(enforceRawTextBudget(decoded([new Uint8Array([2, 0, 65])])), 0);
});

test('highly compressed synthetic HWP is rejected before WASM construction, without changing bytes', async () => {
  const require = createRequire(import.meta.url);
  initSync({ module: fs.readFileSync(new URL('./rhwp_bg.wasm', pathToFileURL(require.resolve('@rhwp/core')))) });
  const bytes = makePerformanceFixture('content_limit2000k', HwpDocument, createEngineApi(HwpDocument));
  assert(bytes.length < 4 * 1024 * 1024);
  const original = bytes.slice();
  assert.throws(() => enforceRawTextBudget(readHwp(bytes)), limit);
  let touched = false;
  const fake = new Proxy(class {}, { construct() { touched = true; throw Error('WASM must not run'); } });
  await assert.rejects(() => createDocumentEngine(fake).open(bytes), limit);
  assert.equal(touched, false);
  assert.deepEqual(bytes, original);
});
