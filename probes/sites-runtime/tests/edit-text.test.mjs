import assert from 'node:assert/strict';
import test from 'node:test';
import fs from 'node:fs';
import { createRequire } from 'node:module';
import { pathToFileURL } from 'node:url';
import { HwpDocument, initSync } from '@rhwp/core';
import { createEngineApi } from '../../../src/one_hwp/rhwp_api.mjs';
import { syntheticFixture } from '../../../src/one_hwp/synthetic_fixtures.mjs';
import { createDocumentEngine } from '../engine/document.mjs';
import { GuardError } from '../guard/records.mjs';
import { EDIT_TEXT_CONSTRAINTS, editTextRejectionDiagnostic, validateEditText } from '../guard/edit-text.mjs';
import { documentToolError } from '../host/error-feedback.mjs';

const require = createRequire(import.meta.url);
initSync({ module: fs.readFileSync(new URL('./rhwp_bg.wasm', pathToFileURL(require.resolve('@rhwp/core')))) });
const api = createEngineApi(HwpDocument), engine = createDocumentEngine(HwpDocument);
const cases = [
  ['첫째\n둘째', 'line_breaks'], ['첫째\r\n둘째', 'line_breaks'], ['첫째\r둘째', 'line_breaks'],
  ['\n', 'line_breaks'], ['문구\u0000끝', 'control_characters'], ['문구\u000b끝', 'control_characters'],
  ['문구\u001b끝', 'control_characters'], ['문구\ud800끝', 'ill_formed_unicode'],
  ['문구\udc00끝', 'ill_formed_unicode'], ['문구\t끝', 'empty_cell_tab'],
];

test('text rejection retains only a fixed reason and one-based bounded operation number', () => {
  for (const [text, reason] of cases) {
    let caught;
    assert.throws(() => validateEditText(text, 1, true), error => { caught = error; return error.code === 'INVALID_OPERATION'; });
    assert.deepEqual(editTextRejectionDiagnostic(caught), { reason, operation_number: 2 });
    assert.equal(caught.message, 'INVALID_OPERATION');
    assert.deepEqual(Object.keys(caught).sort(), ['code', 'name']);
    const returned = editTextRejectionDiagnostic(caught); returned.reason = 'private';
    assert.equal(editTextRejectionDiagnostic(caught).reason, reason);
  }
  for (const index of [-1, 100, NaN, 'PRIVATE_SENTINEL']) {
    let caught;
    assert.throws(() => validateEditText('\n', index), e => { caught = e; return true; });
    assert.equal(editTextRejectionDiagnostic(caught), undefined);
  }
  let caught;
  assert.throws(() => validateEditText('\n', 99), e => { caught = e; return true; });
  assert.equal(editTextRejectionDiagnostic(caught).operation_number, 100);
});

test('valid Unicode, empty strings, punctuation and spacing are accepted without normalization', () => {
  for (const text of ['', '  공백 유지  ', '한글 한 e\u0301 👩‍💻 🇰🇷 日本語 中文 <>& “문구”'])
    assert.doesNotThrow(() => validateEditText(text, 0, true));
  // This helper describes existing admission; it does not grant tab preservation.
  assert.doesNotThrow(() => validateEditText('기존 일반 대상\t입력', 0));
  assert.throws(() => validateEditText(null, 0), e => e.code === 'INVALID_OPERATION' && !editTextRejectionDiagnostic(e));
});

test('only genuine validation errors on plan/edit carry safe text guidance', () => {
  for (const [text, reason] of cases) {
    let caught;
    assert.throws(() => validateEditText('PRIVATE_SENTINEL' + text, 1, true), e => { caught = e; return true; });
    caught.message = 'PRIVATE_SENTINEL'; caught.stack = 'PRIVATE_SENTINEL'; caught.text = text;
    for (const tool of ['hwp_plan', 'hwp_edit']) {
      const response = documentToolError(caught, tool), d = response.structuredContent.data.edit_diagnostic;
      assert.equal(response.content[0].text, 'INVALID_OPERATION');
      assert.deepEqual(JSON.parse(response.content[1].text), response.structuredContent);
      assert.equal(d.reason, reason); assert.equal(d.operation_number, 2);
      assert.equal(d.saved, false); assert.equal(d.file_changed, false);
      assert.equal(d.entire_operation_batch_rejected, true);
      assert.equal(d.retry_same_request_recommended, false);
      assert.equal(d.automatic_text_normalization_allowed, false);
      assert.equal(d.automatic_partial_save_allowed, false);
      assert(!JSON.stringify(response).includes('PRIVATE_SENTINEL'));
    }
    assert(!documentToolError(caught, 'hwp_restore').structuredContent);
    caught.code = 'EXPECTED_OLD_MISMATCH';
    assert(!documentToolError(caught, 'hwp_edit').structuredContent);
  }
  for (const error of [new GuardError('INVALID_OPERATION'), { code: 'INVALID_OPERATION',
    reason: 'line_breaks', edit_diagnostic: { saved: true, text: 'PRIVATE_SENTINEL' } }])
    assert.deepEqual(documentToolError(error, 'hwp_edit'), { isError: true, content: [{ type: 'text', text: 'INVALID_OPERATION' }] });
});

test('snapshot and direct prepared edit paths reject the entire multi-target batch before output', async () => {
  const bytes = syntheticFixture(HwpDocument, api.exportChecked, { cells: [['문항', ''], ['보존', '반복 답변']] });
  const original = bytes.slice(), snapshot = await engine.open(bytes);
  const before = snapshot.read({ expected_sha256: snapshot.source_sha256 });
  assert.deepEqual(before.replacement_text_constraints, EDIT_TEXT_CONSTRAINTS);
  before.replacement_text_constraints.new_line_breaks_supported = true;
  assert.equal(snapshot.read({ expected_sha256: snapshot.source_sha256 }).replacement_text_constraints.new_line_breaks_supported, false);
  const ordinary = before.blocks.find(b => b.editable && b.text), empty = before.blocks.find(b => b.empty_cell_fill_supported);
  for (const [new_text, reason] of cases) {
    const args = { expected_sha256: snapshot.source_sha256, operations: [
      { target_id: ordinary.target_id, expected_old: ordinary.text, new_text: '부분 저장 금지' },
      { target_id: empty.target_id, expected_old: '', new_text },
    ] };
    const verify = e => e.code === 'INVALID_OPERATION'
      && editTextRejectionDiagnostic(e)?.reason === reason && editTextRejectionDiagnostic(e)?.operation_number === 2;
    assert.throws(() => snapshot.plan(args), verify);
    for (const action of [() => snapshot.preflight(args), () => snapshot.edit(args),
      () => engine.preflight(bytes, args, snapshot.source_sha256), () => engine.edit(bytes, args, snapshot.source_sha256)])
      await assert.rejects(action, verify);
    assert.deepEqual(snapshot.read({ expected_sha256: snapshot.source_sha256 }).blocks, before.blocks);
    assert.deepEqual(bytes, original);
  }
});
