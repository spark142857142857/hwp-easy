// Sparse supplementary-character positions avoid rebuilding a whole paragraph
// as a JS character array for every read fragment. Offsets stay code points.
export function indexUnicodeText(text) {
  const pairs = [];
  for (const match of text.matchAll(/[\uD800-\uDBFF][\uDC00-\uDFFF]/g)) pairs.push(match.index - pairs.length);
  const positions = Uint32Array.from(pairs), length = text.length - positions.length;
  const unitOffset = (point) => {
    if (!Number.isSafeInteger(point) || point < 0 || point > length) throw RangeError('INVALID_TEXT_OFFSET');
    let low = 0, high = positions.length;
    while (low < high) {
      const middle = (low + high) >>> 1;
      if (positions[middle] < point) low = middle + 1; else high = middle;
    }
    return point + low;
  };
  return Object.freeze({ length, slice(start, end) {
    if (start > end) throw RangeError('INVALID_TEXT_OFFSET');
    return text.slice(unitOffset(start), unitOffset(end));
  } });
}
