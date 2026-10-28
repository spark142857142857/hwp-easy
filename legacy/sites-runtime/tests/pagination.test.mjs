import assert from 'node:assert/strict';
import test from 'node:test';
import fs from 'node:fs';
import { createRequire } from 'node:module';
import { pathToFileURL } from 'node:url';
import { HwpDocument, initSync } from '@rhwp/core';
import { createEngineApi } from '../../../src/one_hwp/rhwp_api.mjs';
import { syntheticFixture } from '../../../src/one_hwp/synthetic_fixtures.mjs';
import { createDocumentEngine } from '../../../src/one_hwp/engine/document.mjs';
import { paginationDiagnostic } from '../../../src/one_hwp/engine/pagination.mjs';
import { profileSyntheticEngine } from '../../../tests/fixtures/synthetic-engine-profile.mjs';

const require = createRequire(import.meta.url);
initSync({ module: fs.readFileSync(new URL('./rhwp_bg.wasm', pathToFileURL(require.resolve('@rhwp/core')))) });
const api = createEngineApi(HwpDocument);
const fixture = () => syntheticFixture(HwpDocument, api.exportChecked, { table: false, paragraphs: ['합성 원문', '보존 문단'] });

test('engine page count growth is returned by checked plan/edit without extra opens or text shortening', async () => {
  const bytes = fixture(), unchanged = bytes.slice(), profile = profileSyntheticEngine(HwpDocument);
  const engine = createDocumentEngine(profile.Document), snapshot = await engine.open(bytes);
  const target = snapshot.read({ expected_sha256: snapshot.source_sha256 }).blocks.find((b) => b.text === '합성 원문');
  const text = '합성 긴 답변 검증 '.repeat(500);
  const request = { expected_sha256: snapshot.source_sha256,
    operations: [{ target_id: target.target_id, expected_old: target.text, new_text: text }] };
  profile.setPhase('plan');
  const planned = await engine.preflight(bytes, request, snapshot.source_sha256);
  assert.equal(planned.saved, false);
  assert.equal(planned.pagination_diagnostic.status, 'changed');
  assert.equal(planned.pagination_diagnostic.source_page_count, 1);
  assert.ok(planned.pagination_diagnostic.output_page_count > 1);
  assert.equal(planned.pagination_diagnostic.layout_verified, false);
  assert.equal(planned.pagination_diagnostic.page_limit_checked, false);
  assert.equal(planned.pagination_diagnostic.automatic_text_shortening_allowed, false);
  assert.equal(profile.report().plan.constructor.calls, 2);
  assert.equal(profile.report().plan.free.calls, 2);
  profile.setPhase('edit');
  const edited = await engine.edit(bytes, request, snapshot.source_sha256);
  assert.deepEqual(edited.pagination_diagnostic, planned.pagination_diagnostic);
  assert.equal(profile.report().edit.constructor.calls, 2);
  assert.equal(profile.report().edit.free.calls, 2);
  const reopened = await engine.open(edited.bytes);
  const blocks = reopened.read({ expected_sha256: reopened.source_sha256, max_chars: 64000 }).blocks;
  assert.equal(blocks.find((b) => b.id === target.id).text, text);
  assert.equal(blocks.find((b) => b.text === '보존 문단').text, '보존 문단');
  assert.equal(edited.raw_preservation_verified, true);
  assert.deepEqual(bytes, unchanged);
  assert.equal(reopened.preview({ expected_sha256: reopened.source_sha256, page: 0 }).page_count,
    edited.pagination_diagnostic.output_page_count);
});

test('same engine count keeps layout/page limits unverified and returned notices detached', async () => {
  const bytes = fixture(), engine = createDocumentEngine(HwpDocument), snapshot = await engine.open(bytes);
  const target = snapshot.read({ expected_sha256: snapshot.source_sha256 }).blocks.find((b) => b.text === '합성 원문');
  const request = { expected_sha256: snapshot.source_sha256,
    operations: [{ target_id: target.target_id, expected_old: target.text, new_text: '합성 수정' }] };
  const first = await snapshot.preflight(request);
  assert.equal(first.pagination_diagnostic.status, 'unchanged');
  assert.equal(first.pagination_diagnostic.page_count_changed, false);
  assert.equal(first.pagination_diagnostic.layout_verified, false);
  first.pagination_diagnostic.layout_verified = true;
  first.pagination_diagnostic.source_page_count = 999;
  const second = await snapshot.preflight(request);
  assert.equal(second.pagination_diagnostic.layout_verified, false);
  assert.equal(second.pagination_diagnostic.source_page_count, 1);
});

test('missing/invalid counts cannot become a positive page-limit or layout claim', () => {
  for (const value of [undefined, null, 0, -1, 1.5, NaN, Infinity, '1']) {
    const notice = paginationDiagnostic(value, 3);
    assert.equal(notice.status, 'unavailable');
    assert.equal(notice.source_page_count, null);
    assert.equal(notice.page_count_changed, null);
    assert.equal(notice.page_limit_checked, false);
    assert.equal(notice.layout_verified, false);
    assert.equal(notice.automatic_partial_save_allowed, false);
  }
});
