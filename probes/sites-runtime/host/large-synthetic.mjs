import { syntheticFixture } from '../../../src/one_hwp/synthetic_fixtures.mjs';
// Fixed, non-personal bytes. Enough deterministic entropy to exceed 256 KiB.
export function largeSyntheticFixture(HwpDocument, exportChecked) {
  let state = 12345;
  const text = Array.from({ length: 350000 }, () => {
    state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
    return String.fromCharCode(33 + state % 90);
  }).join('');
  return syntheticFixture(HwpDocument, exportChecked,
    { paragraphs: [text, '합성 마지막 문단'], table: false });
}
