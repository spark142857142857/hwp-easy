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
import { miniGrowthFixture } from './cell-list-fixtures.mjs';
const require = createRequire(import.meta.url);
initSync({ module: fs.readFileSync(new URL('./rhwp_bg.wasm', pathToFileURL(require.resolve('@rhwp/core')))) });
const api = createEngineApi(HwpDocument), engine = createDocumentEngine(HwpDocument);
const fixture = (options = {}) => syntheticFixture(HwpDocument, api.exportChecked, options);
const code = (expected) => (error) => error instanceof GuardError && error.code === expected && error.message === expected;
const options = (snapshot, extra = {}) => ({ expected_sha256: snapshot.source_sha256, ...extra });
function readAll(snapshot, max_chars = 8000, max_blocks = 128) {
  const found = new Map(), completed = new Set(); let cursor = null, pages = 0, last;
  do {
    last = snapshot.read(options(snapshot, { cursor, max_chars, max_blocks }));
    assert.equal(last.offsets, 'unicode_code_points');
    assert.deepEqual(last.page_starts_at, cursor
      ? { block_index: cursor.block_index, offset: cursor.offset } : { block_index: 0, offset: 0 });
    assert.ok(last.blocks.length <= max_blocks);
    assert.ok(last.blocks.reduce((count, block) => count + [...block.text].length, 0) <= max_chars);
    for (const block of last.blocks) {
      assert.equal(completed.has(block.id), false, 'a completed target cannot reappear');
      const previous = found.get(block.id);
      assert.equal(block.start_offset, previous ? [...previous.text].length : 0);
      assert.equal(block.end_offset - block.start_offset, [...block.text].length);
      assert.equal(block.text.isWellFormed(), true);
      assert.equal(block.fragment_complete, block.end_offset === block.total_chars);
      if (previous) assert.equal(block.target_id, previous.target_id);
      found.set(block.id, { ...block, text: (previous?.text ?? '') + block.text });
      if (block.fragment_complete) completed.add(block.id);
    }
    assert.equal(last.complete, last.next_cursor === null);
    if (last.next_cursor) {
      assert.equal(last.next_cursor.sha256, snapshot.source_sha256);
      assert.ok(last.next_cursor.block_index > last.page_starts_at.block_index
        || (last.next_cursor.block_index === last.page_starts_at.block_index
          && last.next_cursor.offset > last.page_starts_at.offset), 'each page must advance');
    }
    cursor = last.next_cursor;
    assert.ok(++pages < 10000);
  } while (cursor);
  assert.equal(last.complete, true);
  assert.equal(completed.size, found.size);
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

test('Unicode pagination keeps empty and duplicate paragraph/cell targets at both page limits', async () => {
  // Code-point offsets are not grapheme-cluster offsets: decomposed Hangul,
  // combining accents and emoji sequences may span pages, but must reassemble exactly.
  const paragraphs = ['', '', '한글 한 e\u0301 👩‍💻 🇰🇷', '반복 😀', '반복 😀', '끝'];
  const cells = [['', '반복 😀\n\n끝'], ['반복 😀', '가 e\u0301 👨‍👩‍👧‍👦']];
  const bytes = fixture({ paragraphs, cells }), snapshot = await engine.open(bytes);
  const document = api.openDocument(bytes);
  let expected;
  try { expected = api.inspectDocument(document).blocks; }
  finally { document.free(); }
  // The synthetic createTable call adds an empty body paragraph after its anchor.
  // Verify that exported model too, rather than silently dropping empty blocks.
  assert.deepEqual(expected.filter((b) => b.kind === 'paragraph').map((b) => b.text),
    [paragraphs[0], '', ...paragraphs.slice(1)]);
  assert.deepEqual(expected.filter((b) => b.kind === 'cell').map((b) => b.text), cells.flatMap((row) => row.flatMap((text) => text.split('\n'))));
  for (const max_chars of [1, 2, 3, 8, 64]) {
    for (const max_blocks of [1, 2, 3, 128]) {
      const read = readAll(snapshot, max_chars, max_blocks);
      assert.deepEqual(read.blocks.map(({ id, kind, text }) => ({ id, kind, text })),
        expected.map(({ id, kind, text }) => ({ id, kind, text })));
      assert.equal(new Set(read.blocks.map((b) => b.target_id)).size, expected.length);
      assert.equal(read.last.content_complete, true);
    }
  }
});

test('a partial Unicode read cannot become an edit old value or a cursor for the saved version', async () => {
  const text = '한😀글 e\u0301 끝', snapshot = await engine.open(fixture({ table: false, paragraphs: [text, '보존'] }));
  const first = snapshot.read(options(snapshot, { max_chars: 2, max_blocks: 1 }));
  assert.equal(first.blocks[0].text, '한😀');
  assert.equal(first.blocks[0].fragment_complete, false);
  const operation = { target_id: first.blocks[0].target_id, expected_old: first.blocks[0].text, new_text: '국소 수정 🚀' };
  assert.throws(() => snapshot.plan(options(snapshot, { operations: [operation] })), code('EXPECTED_OLD_MISMATCH'));
  assert.deepEqual(snapshot.read(options(snapshot, { max_chars: 2, max_blocks: 1 })), first);
  const full = readAll(snapshot, 1, 1).blocks[0];
  const changed = await snapshot.edit(options(snapshot, { operations: [{ ...operation, expected_old: full.text }] }));
  const reopened = await engine.open(changed.bytes);
  assert.throws(() => reopened.read(options(reopened, { cursor: first.next_cursor })), code('CURSOR_VERSION_CONFLICT'));
  assert.deepEqual(readAll(reopened, 1, 1).blocks.map((b) => b.text), ['국소 수정 🚀', '보존']);
  // An immutable old snapshot remains readable even after another version exists.
  assert.equal(readAll(snapshot, 2, 1).blocks[0].text, text);
});
test('copied snapshot cannot be changed by caller mutation during hashing or by changing a read result', async () => {
  const bytes = fixture({ table: false });
  const pending = engine.open(bytes); bytes.fill(0);
  const snapshot = await pending;
  const read = snapshot.read(options(snapshot));
  const originalStyle = structuredClone(read.blocks[0].style);
  read.blocks[0].text = '침범'; read.blocks[0].style.char_shape_ids[0] = 123;
  assert.equal(snapshot.read(options(snapshot)).blocks[0].text, '첫 합성 문단');
  assert.deepEqual(snapshot.read(options(snapshot)).blocks[0].style, originalStyle);
});

test('unchanged edit bytes reuse their checked inspection; repaired bytes are freshly reopened', async () => {
  for (const repair of [false, true]) {
    let opens = 0;
    const counted = new Proxy(HwpDocument, { construct(Type, args) {
      opens++; return Reflect.construct(Type, args, Type);
    } });
    const localEngine = createDocumentEngine(counted);
    const bytes = repair ? miniGrowthFixture(HwpDocument, api).bytes : fixture({ table: false });
    const snapshot = await localEngine.open(bytes), before = readAll(snapshot).blocks;
    const target = before.find((block) => block.editable && block.text && block.kind === (repair ? 'cell' : 'paragraph'));
    assert.ok(target);
    const changed = await snapshot.edit(options(snapshot, { operations: [{ target_id: target.target_id,
      expected_old: target.text, new_text: '검증된 수정 😀' }] }));
    assert.equal(changed.raw_preservation_verified, true);
    assert.equal(changed.content_verified, true);
    assert.equal(changed.restored_cell_list_words > 0, repair);
    // Initial open, editing source, serialized candidate; a repair needs one more.
    assert.equal(opens, repair ? 4 : 3);
    const after = readAll(await engine.open(changed.bytes)).blocks;
    assert.deepEqual(after.map((block) => block.text), before.map((block) => block.id === target.id ? '검증된 수정 😀' : block.text));
  }
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
