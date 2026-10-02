import assert from 'node:assert/strict';
import test from 'node:test';
import { fixture, corpus } from './rhwp_fixtures.mjs';
import { openDocument, inspectDocument, exportChecked, editDocument, previewDocument } from '../src/one_hwp/rhwp_bridge.mjs';

for (const [index, options] of corpus.entries()) {
  test(`real HWP corpus ${index + 1}: read, no-change save, reopen, direct SVG`, () => {
    const bytes = fixture(options);
    assert.equal(bytes.subarray(0, 8).toString('hex'), 'd0cf11e0a1b11ae1');
    const document = openDocument(bytes);
    try {
      const before = inspectDocument(document);
      assert.equal(before.unsupported.length, 0);
      const reopened = openDocument(exportChecked(document));
      try { assert.deepEqual(inspectDocument(reopened).blocks, before.blocks); }
      finally { reopened.free(); }
      const preview = previewDocument(document, 0);
      assert.match(preview.svg, /<svg/);
      assert.equal(preview.layout_verified, false);
    } finally { document.free(); }
  });
}

for (const [index, options] of corpus.slice(0, 10).entries()) {
  test(`real targeted edit ${index + 1}: body and one cell, Korean/emoji/style preservation`, () => {
    // A table host is read-only, so exercise bold body text without a table.
    const bytes = fixture(options.bold ? { ...options, table: false } : options);
    const document = openDocument(bytes);
    let before;
    try { before = inspectDocument(document); } finally { document.free(); }
    const body = before.blocks.find((block) => block.kind === 'paragraph' && block.editable);
    const cell = before.blocks.find((block) => block.kind === 'cell' && block.editable);
    const targets = [body, cell].filter(Boolean);
    const operations = targets.map((block) => ({ target_id: block.id, expected_old: block.text,
      new_text: `수정된 합성 내용 ${index} 😀` }));
    const output = Buffer.from(editDocument(bytes, operations).data, 'base64');
    const reopened = openDocument(output);
    try {
      const after = inspectDocument(reopened);
      for (const operation of operations) assert.equal(after.blocks.find((block) => block.id === operation.target_id).text, operation.new_text);
      assert.deepEqual(after.tables, before.tables);
    } finally { reopened.free(); }
  });
}

test('mixed styles and existing line breaks are readable but not editable', () => {
  for (const options of [{ mixed: true, table: false },
    { paragraphs: ['첫 줄\n둘째 줄'], table: false }]) {
    const bytes = fixture(options);
    const document = openDocument(bytes);
    let block;
    try { block = inspectDocument(document).blocks[0]; } finally { document.free(); }
    assert.equal(block.editable, false);
    assert.throws(() => editDocument(bytes, [{ target_id: block.id, expected_old: block.text, new_text: '교체' }]));
  }
});

test('unsupported header is reported instead of silently claiming whole-document coverage', () => {
  const bytes = fixture({ header: true });
  const document = openDocument(bytes);
  try { assert.ok(inspectDocument(document).unsupported.length > 0); } finally { document.free(); }
  assert.throws(() => editDocument(bytes, [{ target_id: 's0:p0', expected_old: '첫 합성 문단', new_text: '수정' }]));
});

test('nondefault style cannot be silently erased by an empty replacement', () => {
  const bytes = fixture({ bold: true, table: false });
  assert.throws(() => editDocument(bytes, [{ target_id: 's0:p0', expected_old: '첫 합성 문단', new_text: '' }]));
});

test('stale, duplicate and partial-invalid operations do not return output', () => {
  const bytes = fixture();
  const valid = { target_id: 's0:p0', expected_old: '첫 합성 문단', new_text: '수정' };
  assert.throws(() => editDocument(bytes, [valid, valid]));
  assert.throws(() => editDocument(bytes, [valid, { ...valid, target_id: 'missing' }]));
  assert.throws(() => editDocument(bytes, [{ ...valid, expected_old: '잘못된 원문' }]));
  assert.throws(() => editDocument(bytes, [{ ...valid, new_text: '삽입\n문단' }]));
});
