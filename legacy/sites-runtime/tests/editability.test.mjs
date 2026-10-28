import assert from 'node:assert/strict';
import test from 'node:test';
import fs from 'node:fs';
import { createRequire } from 'node:module';
import { pathToFileURL } from 'node:url';
import { HwpDocument, initSync } from '@rhwp/core';
import { createEngineApi } from '../../../src/one_hwp/rhwp_api.mjs';
import { syntheticFixture } from '../../../src/one_hwp/synthetic_fixtures.mjs';
import { createDocumentEngine } from '../../../src/one_hwp/engine/document.mjs';
import { describeEditability } from '../../../src/one_hwp/engine/editability.mjs';
import { withPageNumber } from '../../../tests/fixtures/page-number-fixtures.mjs';

const require = createRequire(import.meta.url);
initSync({ module: fs.readFileSync(new URL('./rhwp_bg.wasm', pathToFileURL(require.resolve('@rhwp/core')))) });
const api = createEngineApi(HwpDocument), engine = createDocumentEngine(HwpDocument);
const fixture = options => syntheticFixture(HwpDocument, api.exportChecked, options);
const read = (snapshot, extra = {}) => snapshot.read({ expected_sha256: snapshot.source_sha256, ...extra });

test('full-document counts stay stable across fragments and distinguish cell fill and clear subsets', async () => {
  const bytes = fixture({ paragraphs: ['첫 문단 😀', '중간', '끝'], cells: [['', 'b\nc'], ['d', 'e']] }), original = bytes.slice();
  const snapshot = await engine.open(bytes), first = read(snapshot, { max_chars: 1, max_blocks: 1 });
  assert.equal(first.blocks.length, 1); assert.equal(first.complete, false);
  const summary = structuredClone(first.editability_summary);
  // The pinned writer inserts three existing empty body paragraphs around
  // this table. Two have no replaceable text record and must remain readonly.
  assert.equal(summary.scope, 'whole_document_supported_blocks'); assert.equal(summary.total_blocks, 11);
  assert.equal(summary.body_replacement_candidates, 3); assert.equal(summary.cell_replacement_candidates, 5);
  assert.equal(summary.replacement_candidates, 8); assert.equal(summary.read_only_blocks, 3);
  assert.equal(summary.empty_cell_fill_candidates, 1); assert.equal(summary.cell_text_clear_candidates, 4);
  assert.equal(summary.serialization_checked, false); assert.equal(summary.storage_checked, false);
  assert.equal(summary.candidate_requires_serialization_preflight, true);
  const host = read(snapshot).blocks.find(b => b.read_only_reasons.some(r => r.code === 'TABLE_HOST_PARAGRAPH'));
  assert(host);
  first.editability_summary.read_only_reason_counts[0].message_ko = 'tampered';
  host.read_only_reasons[0].code = 'tampered';
  let cursor = first.next_cursor, fragments = 1, seen = new Set([first.blocks[0].id]);
  while (cursor) {
    const page = read(snapshot, { cursor, max_chars: 1, max_blocks: 1 });
    assert.deepEqual(page.editability_summary, summary);
    for (const block of page.blocks) { seen.add(block.id); fragments++;
      if (block.editable) assert.deepEqual(block.read_only_reasons, []);
      else assert.notEqual(block.read_only_reasons[0].code, 'tampered'); }
    cursor = page.next_cursor;
  }
  assert.equal(seen.size, 11); assert(fragments > seen.size); assert.deepEqual(bytes, original);
});

test('mixed candidates reject unsupported changes while a supported adjacent paragraph still saves', async () => {
  const bytes = fixture({ table: false, mixed: true, paragraphs: ['혼합 글자 서식', '보존 문단'] }), original = bytes.slice();
  const snapshot = await engine.open(bytes), before = read(snapshot);
  assert.equal(before.editability_summary.replacement_candidates, 2);
  assert.equal(before.editability_summary.mixed_style_same_length_candidates, 1);
  assert.equal(before.editability_summary.read_only_blocks, 0);
  assert.equal(before.blocks[0].editable, true);
  assert.equal(before.blocks[0].mixed_style_same_length_supported, true);
  const request = block => ({ expected_sha256: snapshot.source_sha256,
    operations: [{ target_id: block.target_id, expected_old: block.text, new_text: '요청한 수정 😀' }] });
  await assert.rejects(() => snapshot.edit(request(before.blocks[0])), error => error.code === 'MIXED_STYLE_EDIT_UNSUPPORTED');
  const saved = await snapshot.edit(request(before.blocks[1])), after = read(await engine.open(saved.bytes));
  assert.equal(after.blocks[0].text, before.blocks[0].text); assert.deepEqual(after.blocks[0].style, before.blocks[0].style);
  assert.equal(after.blocks[1].text, '요청한 수정 😀'); assert.equal(saved.raw_preservation_verified, true);
  assert.deepEqual(bytes, original);
});

test('unsupported document structure reports zero candidates even for apparently simple cells', async () => {
  const bytes = fixture({ header: true }), original = bytes.slice(), snapshot = await engine.open(bytes), page = read(snapshot);
  assert.equal(page.edit_profile_supported, false); assert.equal(page.content_complete, false);
  assert.equal(page.editability_summary.replacement_candidates, 0);
  assert.equal(page.editability_summary.empty_cell_fill_candidates, 0);
  assert.equal(page.editability_summary.read_only_blocks, page.supported_blocks);
  for (const block of page.blocks) assert(block.read_only_reasons.some(item => item.code === 'DOCUMENT_EDIT_PROFILE_UNSUPPORTED'));
  assert.throws(() => snapshot.plan({ expected_sha256: snapshot.source_sha256,
    operations: [{ target_id: page.blocks[0].target_id, expected_old: page.blocks[0].text, new_text: '수정' }] }),
  error => error.code === 'UNSUPPORTED_EDIT_PROFILE');
  assert.deepEqual(bytes, original);
});

test('preserved page-number host is readonly without misclassifying other supported paragraphs', async () => {
  const bytes = withPageNumber(fixture({ table: false, paragraphs: ['번호 합성 문단', '다른 문단'] }));
  const page = read(await engine.open(bytes));
  assert.equal(page.edit_profile_supported, true); assert.equal(page.all_content_supported, false);
  assert.equal(page.editability_summary.replacement_candidates, 1);
  assert(page.blocks[0].read_only_reasons.some(item => item.code === 'PAGE_NUMBER_HOST_PARAGRAPH'));
  assert.equal(page.blocks[1].editable, true); assert.deepEqual(page.blocks[1].read_only_reasons, []);
});

test('unverified mapping and unknown restrictions have fixed safe explanations without upstream text', () => {
  const options = { blocks: [{ id: 's0:p0', kind: 'paragraph', editable: true, text: 'PRIVATE_SENTINEL', style: {} }],
    tables: [], preservedControls: [], mappingVerified: false, editableProfile: false, documentProfileSupported: true,
    restrictions: new Map([['s0:p0', [{ code: 'PRIVATE_SENTINEL', message_ko: 'PRIVATE_SENTINEL' }]]]),
    emptyCellProfiles: new Map(), clearCellProfiles: new Map() };
  const report = describeEditability(options);
  assert.equal(report.summary.replacement_candidates, 0);
  assert.equal(report.targets.get('s0:p0').read_only_reasons[0].code, 'TARGET_MAPPING_UNVERIFIED');
  assert(!JSON.stringify(report.summary).includes('PRIVATE_SENTINEL'));
  assert(!JSON.stringify([...report.targets.values()]).includes('PRIVATE_SENTINEL'));
  const unknown = describeEditability({ ...options, mappingVerified: true, editableProfile: true });
  assert.equal(unknown.targets.get('s0:p0').read_only_reasons[0].code, 'TARGET_READ_ONLY');
});
