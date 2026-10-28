import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';
import { createRequire } from 'node:module';
import { pathToFileURL } from 'node:url';
import { HwpDocument, initSync } from '@rhwp/core';
import { createEngineApi } from '../../../src/one_hwp/rhwp_api.mjs';
import { syntheticFixture } from '../../../src/one_hwp/synthetic_fixtures.mjs';
import { profileSyntheticEngine } from '../../../tests/fixtures/synthetic-engine-profile.mjs';
const require = createRequire(import.meta.url);
initSync({ module: fs.readFileSync(new URL('./rhwp_bg.wasm', pathToFileURL(require.resolve('@rhwp/core')))) });

test('numeric profiling counts constructors and preserves real checked edit bytes/model', () => {
  const original = createEngineApi(HwpDocument);
  const bytes = syntheticFixture(HwpDocument, original.exportChecked, { table: false });
  const profile = profileSyntheticEngine(HwpDocument), api = createEngineApi(profile.Document);
  profile.setPhase('edit');
  const operations = [{ target_id: 's0:p0', expected_old: '첫 합성 문단', new_text: '계측 검증 😀' }];
  const measured = api.editDocumentChecked(bytes, operations), expected = original.editDocumentChecked(bytes, operations);
  assert.deepEqual(measured.bytes, expected.bytes);
  assert.deepEqual(measured.inspection, expected.inspection);
  const report = profile.report();
  assert.equal(Object.hasOwn(report.edit, 'constructor'), true);
  assert.equal(report.edit.constructor.calls, 2);
  assert.equal(report.edit.export.calls, 1);
  assert.equal(report.edit.replaceText.calls, 1);
  assert.equal(report.edit.free.calls, 2);
  for (const row of Object.values(report.edit)) {
    assert.equal(Number.isSafeInteger(row.calls), true);
    assert.equal(Number.isFinite(row.duration_ms) && row.duration_ms >= 0, true);
    assert.deepEqual(Object.keys(row).sort(), ['calls', 'duration_ms']);
  }
  report.edit.constructor.calls = 999;
  assert.equal(profile.report().edit.constructor.calls, 2);
});
