import assert from 'node:assert/strict';
import test from 'node:test';
import { indexUnicodeText } from '../../../src/one_hwp/engine/unicode-text.mjs';

test('sparse Unicode offsets reproduce code-point slices, including unmatched surrogates', () => {
  for (const text of ['', '한글 ASCII', '😀🚀가😀', 'e\u0301 👩‍💻 🇰🇷', '\ud800가\udc00😀\ud800', '😀가'.repeat(20)]) {
    const points = [...text], indexed = indexUnicodeText(text);
    assert.equal(indexed.length, points.length);
    for (let start = 0; start <= points.length; start++) {
      for (let end = start; end <= points.length; end++) {
        assert.equal(indexed.slice(start, end), points.slice(start, end).join(''));
      }
    }
  }
});

test('Unicode slicing rejects invalid positions instead of coercing them', () => {
  const indexed = indexUnicodeText('가😀끝');
  for (const offset of [-1, 4, 0.5, NaN, Infinity, '1', null]) {
    assert.throws(() => indexed.slice(offset, 3), RangeError);
    assert.throws(() => indexed.slice(0, offset), RangeError);
  }
  assert.throws(() => indexed.slice(2, 1), RangeError);
});
