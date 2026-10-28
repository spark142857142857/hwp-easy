import assert from 'node:assert/strict';
import test from 'node:test';
import fs from 'node:fs';
import { createRequire } from 'node:module';
import { pathToFileURL } from 'node:url';
import { HwpDocument, initSync } from '@rhwp/core';
import { createEngineApi } from '../../../src/one_hwp/rhwp_api.mjs';
import { expectedEditedBlock, pinnedFontLanguage } from '../../../src/one_hwp/text_font_selection.mjs';
import { createDocumentEngine } from '../../../src/one_hwp/engine/document.mjs';
import { readHwp } from '../../../src/one_hwp/guard/container.mjs';
import { parseRecords } from '../../../src/one_hwp/guard/records.mjs';
import { languageFontFixture } from './language-font-fixtures.mjs';

const require = createRequire(import.meta.url);
initSync({ module: fs.readFileSync(new URL('./rhwp_bg.wasm', pathToFileURL(require.resolve('@rhwp/core')))) });
const api = createEngineApi(HwpDocument), engine = createDocumentEngine(HwpDocument);
const read = (snapshot) => snapshot.read({ expected_sha256: snapshot.source_sha256, max_chars: 64000 }).blocks;
const fonts = (bytes) => [...parseRecords(readHwp(bytes).streams.get('DocInfo'))]
  .filter((record) => [19, 21].includes(record.tag)).map((record) => [record.tag, record.level, record.payload]);

test('font selection range boundaries agree with the real pinned engine including supplementary characters', () => {
  const ranges = [[0x1100, 0x11ff], [0x3130, 0x318f], [0xac00, 0xd7af], [0xa960, 0xa97f], [0xd7b0, 0xd7ff],
    [0x41, 0x5a], [0x61, 0x7a], [0x30, 0x39], [0xc0, 0x24f], [0x1e00, 0x1eff],
    [0x4e00, 0x9fff], [0x3400, 0x4dbf], [0xf900, 0xfaff], [0x20000, 0x2a6df],
    [0x3040, 0x309f], [0x30a0, 0x30ff], [0x31f0, 0x31ff], [0x2190, 0x23ff],
    [0x2500, 0x27bf], [0x2460, 0x24ff], [0x3000, 0x303f]];
  const points = [...new Set([0x318c, 0x318d, 0x318e, 0x1f600, 0x20, 0x10ffff,
    ...ranges.flatMap(([start, end]) => [start - 1, start, end, end + 1])])]
    .filter((cp) => cp < 0xd800 || cp > 0xdfff); // Scalar values; no unpaired surrogates.
  const characters = points.map((cp) => String.fromCodePoint(cp)), text = characters.join('');
  const bytes = languageFontFixture(HwpDocument, api, { table: false, text }), document = api.openDocument(bytes);
  try {
    const target = api.inspectDocument(document).blocks.find((b) => b.text === text);
    assert.equal(target.style.char.fontFamilies.length, 7);
    for (const [offset, character] of characters.entries()) {
      const char = JSON.parse(document.getCharPropertiesAt(target.section, target.paragraph, offset));
      assert.equal(char.fontFamily, target.style.char.fontFamilies[pinnedFontLanguage(character)],
        `pinned language selection for U+${points[offset].toString(16)}`);
      assert.deepEqual(char.fontFamilies, target.style.char.fontFamilies);
    }
  } finally { document.free(); }
});

test('body language changes retain all seven font definitions and exact requested text', async () => {
  const bytes = languageFontFixture(HwpDocument, api, { table: false, text: 'Latin source' });
  const original = bytes.slice(), snapshot = await engine.open(bytes), before = read(snapshot);
  const target = before.find((b) => b.kind === 'paragraph' && b.text === 'Latin source');
  const samples = ['한글 변경', 'Latin change', 'écriture', '漢字 변경', '𠀀 한자 확장', 'かな 변경',
    'カナ 변경', '→ 합성 기호', 'ㆍ 합성 사용자', '😀 합성 이모지', ' 공백 시작', 'ᄀ 결합 자모'];
  assert.equal(new Set(target.style.char.fontFamilies).size, 7);
  for (const text of samples) {
    const request = { expected_sha256: snapshot.source_sha256,
      operations: [{ target_id: target.target_id, expected_old: target.text, new_text: text }] };
    const plan = await engine.preflight(bytes, request, snapshot.source_sha256);
    assert.equal(plan.saved, false);
    const edited = await engine.edit(bytes, request, snapshot.source_sha256), after = read(await engine.open(edited.bytes));
    assert.equal(edited.raw_preservation_verified, true);
    assert.deepEqual(after.map((b) => [b.id, b.text, b.style]), before.map((b) => {
      const expected = b.id === target.id ? expectedEditedBlock(b, text, true) : b;
      return [expected.id, expected.text, expected.style];
    }));
    assert.deepEqual(fonts(edited.bytes), fonts(bytes));
  }
  assert.deepEqual(bytes, original);
});

test('cell fill, Korean/Latin replacement and clear preserve language mappings atomically', async () => {
  const bytes = languageFontFixture(HwpDocument, api), original = bytes.slice(), snapshot = await engine.open(bytes), before = read(snapshot);
  const cells = before.filter((b) => b.kind === 'cell'), texts = ['Latin change', 'Latin empty fill', '한글 변경', ''];
  assert.ok(cells[1].empty_cell_fill_supported);
  assert.ok(cells[3].cell_text_clear_supported);
  const operations = cells.map((b, i) => ({ target_id: b.target_id, expected_old: b.text, new_text: texts[i] }));
  const request = { expected_sha256: snapshot.source_sha256, operations };
  const planned = await snapshot.preflight(request), result = await snapshot.edit(request), after = read(await engine.open(result.bytes));
  assert.equal(planned.saved, false); assert.equal(result.empty_cell_text_insertions_verified, 1);
  assert.equal(result.cell_text_record_removals_verified, 1);
  assert.equal(result.raw_preservation_verified, true);
  assert.deepEqual(after.map((b) => [b.id, b.text, b.style]), before.map((b) => {
    const index = cells.findIndex((cell) => cell.id === b.id), expected = index >= 0 ? expectedEditedBlock(b, texts[index], true) : b;
    return [expected.id, expected.text, expected.style];
  }));
  assert.deepEqual(fonts(result.bytes), fonts(bytes));
  assert.deepEqual(bytes, original);
});

test('changed full font mapping or an incorrectly selected representative family still rejects plan and edit', async () => {
  const bytes = languageFontFixture(HwpDocument, api, { table: false }), original = bytes.slice(), snapshot = await engine.open(bytes);
  const target = read(snapshot).find((b) => b.kind === 'paragraph' && b.text === '한글 원문'), request = { expected_sha256: snapshot.source_sha256,
    operations: [{ target_id: target.target_id, expected_old: target.text, new_text: 'Latin change' }] };
  for (const property of ['fontFamilies', 'fontFamily', 'fontSize']) {
    for (const method of ['preflight', 'edit']) {
      let opens = 0;
      const Type = new Proxy(HwpDocument, { construct(Target, args) {
        const document = Reflect.construct(Target, args, Target), reopened = ++opens === 2;
        return new Proxy(document, { get(source, key) {
          const value = Reflect.get(source, key, source);
          if (typeof value !== 'function') return value;
          return (...values) => {
            const result = Reflect.apply(value, source, values);
            if (!reopened || key !== 'getCharPropertiesAt' || values[1] !== target.paragraph) return result;
            const char = JSON.parse(result);
            if (property === 'fontFamilies') char.fontFamilies[1] = 'Injected font';
            if (property === 'fontFamily') char.fontFamily = char.fontFamilies[0];
            if (property === 'fontSize') char.fontSize++;
            return JSON.stringify(char);
          };
        } });
      } });
      await assert.rejects(createDocumentEngine(Type)[method](bytes, request, snapshot.source_sha256),
        (error) => error.code === 'ENGINE_OPERATION_FAILED');
      assert.equal(opens, 2);
    }
  }
  assert.deepEqual(bytes, original);
});

test('missing/inconsistent font mapping and conservative local default do not allow font differences', () => {
  const bytes = languageFontFixture(HwpDocument, api, { table: false }), document = api.openDocument(bytes);
  let block; try { block = api.inspectDocument(document).blocks.find((b) => b.kind === 'paragraph' && b.text === '한글 원문'); } finally { document.free(); }
  const operation = { target_id: block.id, expected_old: block.text, new_text: 'Latin change' };
  assert.throws(() => api.editDocument(bytes, [operation]), /preservation checks/);
  for (const invalid of [undefined, [], ['one font'], [...block.style.char.fontFamilies.slice(0, 6), null]]) {
    const broken = structuredClone(block); broken.style.char.fontFamilies = invalid;
    assert.equal(expectedEditedBlock(broken, operation.new_text, true).style.char.fontFamily, block.style.char.fontFamily);
  }
  const inconsistent = structuredClone(block); inconsistent.style.char.fontFamily = 'Unverified source font';
  assert.equal(expectedEditedBlock(inconsistent, operation.new_text, true).style.char.fontFamily, 'Unverified source font');
});
