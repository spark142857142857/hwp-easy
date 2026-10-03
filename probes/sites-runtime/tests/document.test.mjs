import assert from 'node:assert/strict';
import test from 'node:test';
import fs from 'node:fs';
import { createRequire } from 'node:module';
import { pathToFileURL } from 'node:url';
import { HwpDocument, initSync } from '@rhwp/core';
import { createEngineApi } from '../../../src/one_hwp/rhwp_api.mjs';
import { syntheticFixture, corpus } from '../../../src/one_hwp/synthetic_fixtures.mjs';
import { createDocumentEngine, mapRawTargets } from '../engine/document.mjs';
import { readHwp } from '../guard/container.mjs';
import { GuardError } from '../guard/records.mjs';
import { withCheckedDeflateTrailers } from './trailer-fixtures.mjs';
const require = createRequire(import.meta.url);
initSync({ module: fs.readFileSync(new URL('./rhwp_bg.wasm', pathToFileURL(require.resolve('@rhwp/core')))) });
const api = createEngineApi(HwpDocument), engine = createDocumentEngine(HwpDocument);
const fixture = (options = {}) => syntheticFixture(HwpDocument, api.exportChecked, options);
const code = (expected) => (error) => error instanceof GuardError && error.code === expected && error.message === expected;
const options = (snapshot, extra = {}) => ({ expected_sha256: snapshot.source_sha256, ...extra });
function readAll(snapshot, max_chars = 8000) {
  const found = new Map(); let cursor = null, pages = 0, last;
  do {
    last = snapshot.read(options(snapshot, { cursor, max_chars }));
    for (const block of last.blocks) {
      const previous = found.get(block.id);
      assert.equal(block.start_offset, previous ? [...previous.text].length : 0);
      found.set(block.id, { ...block, text: (previous?.text ?? '') + block.text });
    }
    cursor = last.next_cursor;
    assert.ok(++pages < 10000);
  } while (cursor);
  assert.equal(last.complete, true);
  return { blocks: [...found.values()], pages, last };
}

for (const [index, spec] of corpus.entries()) {
  test(`portable document ${index + 1}: complete read, versioned target, edit and independent preservation`, async () => {
    const bytes = fixture(spec), original = bytes.slice(), snapshot = await engine.open(bytes);
    const read = readAll(snapshot, 97);
    assert.equal(read.last.target_mapping_verified, true);
    assert.equal(read.last.content_complete, true);
    const body = read.blocks.find((block) => block.kind === 'paragraph' && block.editable && block.text.length);
    const cell = read.blocks.find((block) => block.kind === 'cell' && block.editable && block.text.length);
    const targets = [body, cell].filter(Boolean);
    assert.ok(targets.length);
    const operations = targets.map((block, i) => ({ target_id: block.target_id, expected_old: block.text, new_text: `수정 ${i} 😀` }));
    assert.equal(snapshot.plan(options(snapshot, { operations })).file_changed, false);
    const changed = await snapshot.edit(options(snapshot, { operations }));
    assert.equal(changed.saved, false);
    assert.equal(changed.raw_preservation_verified, true);
    assert.equal(changed.content_verified, true);
    assert.equal(changed.layout_verified, false);
    assert.deepEqual(bytes, original);
    const reopened = await engine.open(changed.bytes);
    assert.notEqual(reopened.source_sha256, snapshot.source_sha256);
    const after = readAll(reopened).blocks;
    assert.deepEqual(after.map(({ id, text }) => ({ id, text })), read.blocks.map(({ id, text }) => ({ id,
      text: targets.findIndex((block) => block.id === id) < 0 ? text : `수정 ${targets.findIndex((block) => block.id === id)} 😀` })));
    assert.equal(reopened.preview(options(reopened, { page: 0 })).svg.includes('<svg'), true);
  });
}

test('checked compression trailers survive the read-plan-edit-reopen preservation flow', async () => {
  const bytes = withCheckedDeflateTrailers(fixture()), original = bytes.slice();
  const snapshot = await engine.open(bytes), before = readAll(snapshot, 97);
  assert.equal(before.last.content_complete, true);
  const targets = ['paragraph', 'cell'].map((kind) => before.blocks.find((b) => b.kind === kind && b.editable));
  const operations = targets.map((b, i) => ({ target_id: b.target_id, expected_old: b.text, new_text: `합성 꼬리 수정 ${i} 😀` }));
  assert.equal(snapshot.plan(options(snapshot, { operations })).file_changed, false);
  const result = await snapshot.edit(options(snapshot, { operations }));
  assert.equal(result.raw_preservation_verified, true);
  assert.equal(result.content_verified, true);
  assert.equal(result.layout_verified, false);
  const reopened = await engine.open(result.bytes), after = readAll(reopened).blocks;
  assert.deepEqual(after.map(({ id, text }) => ({ id, text })), before.blocks.map(({ id, text }) => {
    const index = targets.findIndex((b) => b.id === id);
    return { id, text: index < 0 ? text : `합성 꼬리 수정 ${index} 😀` };
  }));
  assert.deepEqual(bytes, original);
});

test('long paragraph chain includes the tail without splitting surrogate pairs', async () => {
  const text = '😀가'.repeat(35000) + '끝';
  const snapshot = await engine.open(fixture({ table: false, paragraphs: [text] }));
  const read = readAll(snapshot, 999);
  assert.ok(read.pages > 60);
  assert.equal(read.blocks[0].text, text);
  assert.equal(read.blocks[0].text.isWellFormed(), true);
  assert.equal(read.blocks[0].total_chars, 70001);
});
test('copied snapshot cannot be changed by caller mutation during hashing or by changing a read result', async () => {
  const bytes = fixture({ table: false });
  const pending = engine.open(bytes); bytes.fill(0);
  const snapshot = await pending;
  const read = snapshot.read(options(snapshot));
  read.blocks[0].text = '침범'; read.blocks[0].style.char_shape_ids[0] = 123;
  assert.equal(snapshot.read(options(snapshot)).blocks[0].text, '첫 합성 문단');
});
test('version, cursor, whole old value, duplicates and unknown arguments reject before output', async () => {
  const snapshot = await engine.open(fixture());
  const read = readAll(snapshot), block = read.blocks.find((b) => b.editable && b.text);
  const operation = { target_id: block.target_id, expected_old: block.text, new_text: '변경' };
  assert.throws(() => snapshot.read({ expected_sha256: 'f'.repeat(64) }), code('VERSION_CONFLICT'));
  assert.throws(() => snapshot.read(options(snapshot, { max_chars: 0 })), code('INVALID_LIMIT'));
  assert.throws(() => snapshot.read(options(snapshot, { file: 'not accepted' })), code('INVALID_ARGUMENTS'));
  assert.throws(() => snapshot.read(options(snapshot, { cursor: { sha256: 'f'.repeat(64), block_index: 0, offset: 0 } })), code('CURSOR_VERSION_CONFLICT'));
  for (const offset of [-1, 1.5, 1e8]) assert.throws(() => snapshot.read(options(snapshot,
    { cursor: { sha256: snapshot.source_sha256, block_index: 0, offset } })), code('INVALID_CURSOR'));
  assert.throws(() => snapshot.plan(options(snapshot, { operations: [{ ...operation, expected_old: '' }] })), code('EXPECTED_OLD_MISMATCH'));
  assert.throws(() => snapshot.plan(options(snapshot, { operations: [operation, operation] })), code('DUPLICATE_TARGET'));
  assert.throws(() => snapshot.plan(options(snapshot, { operations: [{ ...operation, target_id: operation.target_id.replace(snapshot.source_sha256, 'f'.repeat(64)) }] })), code('TARGET_VERSION_OR_ID_INVALID'));
  for (const new_text of ['a\nb', 'a\rb', '\u0000', '\ud800']) assert.throws(() => snapshot.plan(options(snapshot,
    { operations: [{ ...operation, new_text }] })), code('INVALID_OPERATION'));
  assert.throws(() => snapshot.plan(options(snapshot, { operations: [{ ...operation, new_text: '가'.repeat(100001) }] })), code('EDIT_LIMIT_EXCEEDED'));
  assert.equal(snapshot.read(options(snapshot)).blocks[0].text, '첫 합성 문단');
});
test('unsupported header is not whole-document coverage and cannot be edited', async () => {
  const snapshot = await engine.open(fixture({ header: true }));
  const read = snapshot.read(options(snapshot));
  assert.equal(read.all_content_supported, false);
  assert.equal(read.content_complete, false);
  assert.ok(read.blocks.every((block) => !block.editable));
  assert.throws(() => snapshot.plan(options(snapshot, { operations: [] })), code('UNSUPPORTED_EDIT_PROFILE'));
});
test('mixed styles remain readable with a read-only target', async () => {
  const snapshot = await engine.open(fixture({ table: false, mixed: true }));
  assert.equal(snapshot.read(options(snapshot)).blocks[0].editable, false);
});
test('ordered raw mapping detects text/order/level mismatch even when paragraph counts match', () => {
  const bytes = fixture(), raw = readHwp(bytes), doc = api.openDocument(bytes);
  let blocks; try { blocks = api.inspectDocument(doc).blocks; } finally { doc.free(); }
  assert.equal(mapRawTargets(raw, blocks).size, blocks.length);
  assert.throws(() => mapRawTargets(raw, blocks.map((b, i) => i ? b : { ...b, text: 'different' })), code('TARGET_MAPPING_UNVERIFIED'));
  assert.throws(() => mapRawTargets(raw, [blocks[1], blocks[0], ...blocks.slice(2)]), code('TARGET_MAPPING_UNVERIFIED'));
  assert.throws(() => mapRawTargets(raw, blocks.map((b) => b.kind === 'cell' ? { ...b, kind: 'paragraph' } : b)), code('TARGET_MAPPING_UNVERIFIED'));
});
test('WASM console errors are suppressed synchronously and the host logger is restored', async () => {
  let logs = 0;
  const prior = console.error, logger = () => { logs++; };
  console.error = logger;
  class Broken { constructor() { console.error('synthetic content marker'); throw new Error('synthetic content marker'); } }
  try {
    await assert.rejects(createDocumentEngine(Broken).open(fixture()), code('ENGINE_OPERATION_FAILED'));
    assert.equal(logs, 0); assert.equal(console.error, logger);
    console.error('host-owned message'); assert.equal(logs, 1);
  } finally { console.error = prior; }
});
test('input bounds and malformed bytes are checked before opening the engine', async () => {
  await assert.rejects(engine.open('not bytes'), code('INVALID_INPUT_BYTES'));
  await assert.rejects(engine.open(new Uint8Array(4 * 1024 * 1024 + 1)), code('INPUT_LIMIT_EXCEEDED'));
  await assert.rejects(engine.open(new Uint8Array()), (e) => e instanceof GuardError);
});

test('partially invalid edits return no bytes and cannot change the input snapshot', async () => {
  const snapshot = await engine.open(fixture({ table: false }));
  const block = snapshot.read(options(snapshot)).blocks[0];
  const operation = { target_id: block.target_id, expected_old: block.text, new_text: '유효한 수정' };
  await assert.rejects(snapshot.edit(options(snapshot, { operations: [operation,
    { ...operation, target_id: 'invalid', new_text: '실패할 수정' }] })), code('TARGET_VERSION_OR_ID_INVALID'));
  assert.equal(snapshot.read(options(snapshot)).blocks[0].text, block.text);
});
test('operation count and cumulative new text have separate bounds', async () => {
  const snapshot = await engine.open(fixture({ table: false, paragraphs: ['a', 'b', 'c', 'd', 'e', 'f'] }));
  const blocks = snapshot.read(options(snapshot)).blocks;
  const operations = blocks.map((b) => ({ target_id: b.target_id, expected_old: b.text, new_text: '가'.repeat(100000) }));
  assert.throws(() => snapshot.plan(options(snapshot, { operations })), code('EDIT_LIMIT_EXCEEDED'));
  assert.throws(() => snapshot.plan(options(snapshot, { operations: Array(101).fill(operations[0]) })), code('INVALID_OPERATIONS'));
});
// Fast API-envelope mocks test only defensive work limits, not HWP compatibility.
const model = (count, text = '') => ({
  getDocumentInfo: () => '{"sectionCount":1,"pageCount":1}',
  getCursorModel: () => '{"lists":[]}', getControls: () => '[]',
  getSectionCount: () => 1, getParagraphCount: () => count,
  getParagraphLength: () => text.length, getTextRange: () => text,
  getParaPropertiesAt: () => '{}', getCharPropertiesAt: () => '{"charShapeId":0}',
  getValidationWarnings: () => '{"count":0}',
});
test('common API stops at section, text and block work limits', () => {
  assert.throws(() => api.inspectDocument({ ...model(1), getSectionCount: () => 65 }), /Content inspection limit/);
  assert.throws(() => api.inspectDocument(model(4097)), /Content inspection limit/);
  assert.throws(() => api.inspectDocument(model(1, '가'.repeat(2000001))), /Content inspection limit/);
});
test('common API style-scan exhaustion is explicit and read-only', () => {
  const inspected = api.inspectDocument(model(9, '가'.repeat(100000)));
  assert.ok(inspected.blocks.slice(0, 8).every((block) => block.editable));
  assert.equal(inspected.blocks[8].editable, false);
  assert.equal(inspected.blocks[8].style.profile, 'style_scan_limit_exceeded');
});
