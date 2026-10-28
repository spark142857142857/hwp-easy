import assert from 'node:assert/strict';
import test from 'node:test';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';
import { pathToFileURL } from 'node:url';
import { HwpDocument, initSync } from '@rhwp/core';
import { createEngineApi } from '../../../src/one_hwp/rhwp_api.mjs';
import { syntheticFixture } from '../../../src/one_hwp/synthetic_fixtures.mjs';
import { createDocumentEngine } from '../../../src/one_hwp/engine/document.mjs';
import { classifySnapshot, inspectFolder } from '../scripts/local-profile.mjs';
import { withPageNumber } from '../../../tests/fixtures/page-number-fixtures.mjs';

const require = createRequire(import.meta.url);
initSync({ module: await fs.readFile(new URL('./rhwp_bg.wasm', pathToFileURL(require.resolve('@rhwp/core')))) });
const api = createEngineApi(HwpDocument), engine = createDocumentEngine(HwpDocument);
const fixture = (options) => syntheticFixture(HwpDocument, api.exportChecked, options);
const options = (snapshot, extra = {}) => ({ expected_sha256: snapshot.source_sha256, ...extra });
function allBlocks(snapshot) {
  const blocks = [], seen = new Set(); let cursor = null;
  do {
    const page = snapshot.read(options(snapshot, { cursor }));
    for (const block of page.blocks) if (!seen.has(block.id)) { seen.add(block.id); blocks.push(block); }
    cursor = page.next_cursor;
  } while (cursor);
  return blocks;
}

test('classification exhausts fragmented read chain without retaining private fields or invoking writes', async () => {
  const marker = 'PRIVATE_SENTINEL';
  const snapshot = await engine.open(fixture({ table: false, paragraphs: [marker.repeat(900), '끝'] }));
  let reads = 0;
  const result = classifySnapshot({ source_sha256: snapshot.source_sha256,
    read(value) { reads++; return snapshot.read(value); },
    edit() { assert.fail('no edit'); }, preflight() { assert.fail('no serialization'); } });
  assert.ok(reads > 1);
  assert.equal(result.counts.blocks, 2);
  assert.equal(result.counts.replacement_candidates, 2);
  assert.equal(result.serialization_checked, false);
  assert.equal(JSON.stringify(result).includes(marker), false);
  assert.equal(JSON.stringify(result).includes(snapshot.source_sha256), false);
});

test('mixed classification reflects the narrow host candidate while unsupported headers stay readonly', async () => {
  const mixed = classifySnapshot(await engine.open(fixture({ table: false, mixed: true })));
  assert.equal(mixed.style_counts.mixed_visible_styles, 1);
  assert.equal(mixed.counts.read_only_blocks, 0);
  assert.equal(mixed.counts.replacement_candidates, mixed.counts.blocks);
  assert.equal(mixed.serialization_checked, false);
  const header = classifySnapshot(await engine.open(fixture({ header: true })));
  assert.equal(header.read_coverage, 'partial_profile');
  assert.equal(header.edit_profile_supported, false);
  assert.equal(header.counts.replacement_candidates, 0);
  assert.equal(header.counts.empty_fill_candidates, 0);
});

test('unknown parser labels and messages are collapsed to a fixed aggregate label', () => {
  const marker = 'PRIVATE_SENTINEL';
  const report = classifySnapshot({ source_sha256: marker, read() { return {
    blocks: [{ id: marker, kind: 'paragraph', total_chars: 1, text: marker,
      edit_restrictions: [{ code: marker, message_ko: marker }], style: { profile: marker } }],
    complete: true, next_cursor: null, supported_blocks: 1,
    unsupported: [{ kind: marker, reason: marker }], warnings: [marker], table_count: 0,
  }; } });
  assert.equal(JSON.stringify(report).includes(marker), false);
  assert.deepEqual(report.restriction_counts, { other: 1 });
  assert.deepEqual(report.unsupported_counts, { other: 1 });
});

test('stalled cursors and incomplete paragraph coverage are rejected', () => {
  const page = { blocks: [], supported_blocks: 1, complete: true, next_cursor: null };
  assert.throws(() => classifySnapshot({ source_sha256: 'x', read: () => page }), /READ_CHAIN_FAILED/);
  assert.throws(() => classifySnapshot({ source_sha256: 'x', read: () => ({ ...page,
    complete: false, next_cursor: { block_index: 0, offset: 0 } }) }), /READ_CHAIN_FAILED/);
});

test('local corpus accepts only top-level HWP, leaves source bytes unchanged, and hides paths/errors', async () => {
  const folder = await fs.mkdtemp(path.join(os.tmpdir(), 'hwp-profile-'));
  try {
    const marker = 'PRIVATE_SENTINEL', source = path.join(folder, `${marker}.hwp`);
    const bytes = fixture({ table: false });
    await fs.writeFile(source, bytes);
    await fs.writeFile(path.join(folder, `${marker}.hwpx`), marker);
    await fs.mkdir(path.join(folder, 'nested'));
    await fs.writeFile(path.join(folder, 'nested', 'ignored.hwp'), bytes);
    const report = await inspectFolder(folder, engine);
    assert.equal(report.summary.documents, 1);
    assert.equal(report.documents[0].source_unchanged, true);
    assert.deepEqual(new Uint8Array(await fs.readFile(source)), bytes);
    assert.equal(JSON.stringify(report).includes(marker), false);
    assert.equal(JSON.stringify(report).includes(folder), false);
    const failed = await inspectFolder(folder, { open() { throw Error(marker); } });
    assert.equal(failed.summary.failed, 1);
    assert.equal(failed.documents[0].source_unchanged, true);
    assert.equal(JSON.stringify(failed).includes(marker), false);
  } finally { await fs.rm(folder, { recursive: true, force: true }); }
});

test('source changes, hard links, and oversized documents cannot be reported as supported', async () => {
  const folder = await fs.mkdtemp(path.join(os.tmpdir(), 'hwp-profile-'));
  try {
    const source = path.join(folder, 'a.hwp'), bytes = fixture({ table: false });
    await fs.writeFile(source, bytes);
    const changed = await inspectFolder(folder, { async open(value) {
      await fs.appendFile(source, new Uint8Array([0])); return engine.open(value);
    } });
    assert.equal(changed.documents[0].reason_code, 'SOURCE_RECHECK_FAILED');
    assert.equal(changed.documents[0].source_unchanged, false);
    await fs.link(source, path.join(folder, 'b.hwp'));
    await fs.writeFile(path.join(folder, 'large.hwp'), new Uint8Array(4 * 1024 * 1024 + 1));
    const rejected = await inspectFolder(folder, { open() { assert.fail('must not parse rejected source'); } });
    assert.equal(rejected.summary.failed, 3);
    assert.deepEqual(rejected.documents.map((item) => item.reason_code),
      ['PATH_REJECTED', 'PATH_REJECTED', 'INPUT_LIMIT_EXCEEDED']);
  } finally { await fs.rm(folder, { recursive: true, force: true }); }
});

// Nonpersonal representative of the 45-cell / multiple-paragraph table profile.
test('representative form keeps duplicate cells, clears/fills a cell, and preserves non-target blocks', async () => {
  const cells = Array.from({ length: 45 }, (_, index) =>
    [index === 0 ? '합성 문항\n합성 안내' : index === 1 ? '' : '반복 합성 답변']);
  const bytes = fixture({ cells }), original = bytes.slice();
  const snapshot = await engine.open(bytes), before = allBlocks(snapshot), report = classifySnapshot(snapshot);
  assert.equal(report.tables, 1);
  assert.equal(report.counts.cell_paragraphs, 46);
  assert.equal(report.counts.empty_fill_candidates, 1);
  const target = before.find((block) => block.kind === 'cell' && block.cell === 2);
  const operations = [{ target_id: target.target_id, expected_old: target.text, new_text: '길이가 다른 합성 답변' }];
  const checked = await snapshot.preflight(options(snapshot, { operations }));
  assert.equal(checked.serialization_checked, true);
  const edited = await snapshot.edit(options(snapshot, { operations }));
  const reopened = await engine.open(edited.bytes), after = allBlocks(reopened);
  for (const block of after) assert.equal(block.text, block.id === target.id ? operations[0].new_text : before.find((b) => b.id === block.id).text);
  const fill = after.find((block) => block.empty_cell_fill_supported);
  const filled = await reopened.edit(options(reopened, { operations: [
    { target_id: fill.target_id, expected_old: '', new_text: '빈 칸 합성 입력' } ] }));
  const filledSnapshot = await engine.open(filled.bytes);
  const filledTarget = allBlocks(filledSnapshot).find((block) => block.id === fill.id);
  assert.equal(filledTarget.text, '빈 칸 합성 입력');
  const cleared = await filledSnapshot.edit(options(filledSnapshot, { operations: [
    { target_id: filledTarget.target_id, expected_old: filledTarget.text, new_text: '' } ] }));
  assert.equal(allBlocks(await engine.open(cleared.bytes)).find((block) => block.id === fill.id).text, '');
  assert.deepEqual(bytes, original);
});

test('opaque page number keeps partial read coverage despite allowed candidate text edits', async () => {
  const bytes = withPageNumber(fixture({})), original = bytes.slice();
  const snapshot = await engine.open(bytes), report = classifySnapshot(snapshot);
  assert.equal(report.read_coverage, 'partial_profile');
  assert.equal(report.preserved_control_count, 1);
  assert.equal(report.edit_profile_supported, true);
  const target = allBlocks(snapshot).find((block) => block.kind === 'cell' && block.editable);
  const result = await snapshot.edit(options(snapshot, { operations: [
    { target_id: target.target_id, expected_old: target.text, new_text: '페이지 번호 보존 합성 답변' } ] }));
  assert.equal(classifySnapshot(await engine.open(result.bytes)).preserved_control_count, 1);
  assert.deepEqual(bytes, original);
});
