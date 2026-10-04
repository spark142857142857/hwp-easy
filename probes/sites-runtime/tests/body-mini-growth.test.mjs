import assert from 'node:assert/strict';
import test from 'node:test';
import CFB from 'cfb';
import { readCfb, replaceAllocatedBodyStreams, replaceBodyStreamsWithMiniTailGrowth } from '../guard/container.mjs';

// Fixed synthetic v3/v4 container; body chain and Keep are deliberately adjacent
// in the mini stream, so the appended body mini sector is not contiguous.
function fixture(size = 512, twoBodies = false) {
  const END = 0xfffffffe, FREE = 0xffffffff, source = new Uint8Array(5 * size), v = new DataView(source.buffer);
  const u16 = (o, n) => v.setUint16(o, n, true), u32 = (o, n) => v.setUint32(o, n, true);
  source.set(Uint8Array.of(208, 207, 17, 224, 161, 177, 26, 225));
  u16(24, 0x3e); u16(26, size === 512 ? 3 : 4); u16(28, 0xfffe); u16(30, size === 512 ? 9 : 12); u16(32, 6);
  u32(40, size === 512 ? 0 : 1); u32(44, 1); u32(48, 1); u32(56, 4096); u32(60, 3); u32(64, 1); u32(68, END);
  for (let o = 76; o < 512; o += 4) u32(o, FREE); u32(76, 0);
  for (let o = size; o < 2 * size; o += 4) u32(o, FREE);
  u32(size, 0xfffffffd); u32(size + 4, END); u32(size + 8, END); u32(size + 12, END);
  const entry = (index, name, type, first, length, child = FREE, right = FREE) => {
    const o = 2 * size + index * 128;
    [...name].forEach((c, i) => u16(o + i * 2, c.charCodeAt(0)));
    u16(o + 64, (name.length + 1) * 2); source[o + 66] = type; source[o + 67] = 1;
    u32(o + 68, FREE); u32(o + 72, right); u32(o + 76, child); u32(o + 116, first); u32(o + 120, length);
  };
  const rootSize = twoBodies ? 384 : 256;
  entry(0, 'Root Entry', 5, 2, rootSize, 1);
  entry(1, 'BodyText', 1, END, 0, 2, twoBodies ? FREE : 3);
  entry(2, 'Section0', 2, 0, 190, FREE, twoBodies ? 3 : FREE);
  entry(3, twoBodies ? 'Section1' : 'Keep', 2, 3, twoBodies ? 190 : 60);
  source.fill(42, 3 * size, 3 * size + 190);
  source.fill(47, 3 * size + 192, 3 * size + 192 + (twoBodies ? 190 : 60));
  for (let o = 4 * size; o < 5 * size; o += 4) u32(o, FREE);
  for (const [id, next] of [[0, 1], [1, 2], [2, END], [3, twoBodies ? 4 : END], ...(twoBodies ? [[4, 5], [5, END]] : [])]) {
    u32(4 * size + id * 4, next);
  }
  return { source, size, rootSize, rootSizeOffset: 2 * size + 120, bodySizeOffset: 2 * size + 256 + 120,
    miniFatOffset: 4 * size, tailOffset: 3 * size + rootSize };
}

for (const size of [512, 4096]) {
  test(`one-mini append preserves file length, FAT, other data and exact metadata (${size})`, () => {
    const f = fixture(size), original = f.source.slice(), name = 'BodyText/Section0', replacement = new Uint8Array(193).fill(39);
    assert.throws(() => replaceAllocatedBodyStreams(f.source, new Map([[name, replacement]])), /BODY_REPAIR_ALLOCATION_UNSUPPORTED/);
    const result = replaceBodyStreamsWithMiniTailGrowth(f.source, new Map([[name, replacement]]));
    assert.equal(result.body_mini_sector_growth, 1); assert.equal(result.bytes.length, original.length);
    const after = readCfb(result.bytes), before = readCfb(original);
    assert.deepEqual(after.get(name), replacement); assert.deepEqual(after.get('Keep'), before.get('Keep'));
    const allowed = new Uint8Array(original.length);
    for (const [start, length] of [[3 * size, 192], [f.tailOffset, 64], [f.bodySizeOffset, 4],
      [f.rootSizeOffset, 4], [f.miniFatOffset + 8, 4], [f.miniFatOffset + 16, 4]]) allowed.fill(1, start, start + length);
    assert(original.every((byte, index) => byte === result.bytes[index] || allowed[index]));
    const v = new DataView(result.bytes.buffer);
    assert.equal(v.getUint32(f.rootSizeOffset, true), 320);
    assert.equal(v.getUint32(f.miniFatOffset + 8, true), 4);
    assert.equal(v.getUint32(f.miniFatOffset + 16, true), 0xfffffffe);
    const external = CFB.read(Buffer.from(result.bytes), { type: 'buffer' });
    for (const [path, bytes] of after) {
      const index = external.FullPaths.findIndex((p) => p.endsWith('/' + path));
      assert(index >= 0); assert.deepEqual(new Uint8Array(external.FileIndex[index].content), bytes);
    }
    assert.deepEqual(f.source, original);
  });

  test(`mini growth rejects full root capacity, occupied entry, nonzero tail and malformed chains (${size})`, () => {
    for (const action of [
      (f, v) => v.setUint32(f.rootSizeOffset, size, true),
      (f, v) => v.setUint32(f.miniFatOffset + 16, 0xfffffffe, true),
      (f) => { f.source[f.tailOffset + 31] = 91; },
      (f, v) => v.setUint32(f.rootSizeOffset, 257, true),
      (f, v) => v.setUint32(f.rootSizeOffset + 4, 1, true),
      (f, v) => v.setUint32(f.bodySizeOffset + 4, 1, true),
      (f, v) => v.setUint32(f.miniFatOffset + 8, 3, true),
    ]) {
      const f = fixture(size); action(f, new DataView(f.source.buffer)); const original = f.source.slice();
      assert.throws(() => replaceBodyStreamsWithMiniTailGrowth(f.source,
        new Map([['BodyText/Section0', new Uint8Array(193)]])));
      assert.deepEqual(f.source, original);
    }
  });
}

test('growth cannot shrink, cross storage classes, append two minis or modify other streams', () => {
  for (const [name, length] of [['BodyText/Section0', 128], ['BodyText/Section0', 257],
    ['BodyText/Section0', 4096], ['Keep', 61], ['BodyText/Section1', 193]]) {
    const { source } = fixture(), original = source.slice();
    assert.throws(() => replaceBodyStreamsWithMiniTailGrowth(source, new Map([[name, new Uint8Array(length)]])));
    assert.deepEqual(source, original);
  }
  const { source } = fixture(512, true), original = source.slice();
  assert.throws(() => replaceBodyStreamsWithMiniTailGrowth(source, new Map([
    ['BodyText/Section0', new Uint8Array(193)], ['BodyText/Section1', new Uint8Array(193)],
  ])), /BODY_REPAIR_ALLOCATION_UNSUPPORTED/);
  assert.deepEqual(source, original);
});

test('exact-allocation fast path and Buffer immutability remain unchanged', () => {
  const source = Buffer.from(fixture().source), original = Buffer.from(source), name = 'BodyText/Section0';
  const same = new Map([[name, new Uint8Array(191).fill(39)]]), exact = replaceBodyStreamsWithMiniTailGrowth(source, same);
  assert.equal(exact.body_mini_sector_growth, 0); assert.deepEqual(exact.bytes, replaceAllocatedBodyStreams(source, same));
  const grown = replaceBodyStreamsWithMiniTailGrowth(source, new Map([[name, new Uint8Array(193).fill(38)]]));
  assert.equal(grown.body_mini_sector_growth, 1); grown.bytes.fill(0); assert.deepEqual(source, original);
});

test('one grow and one exact replacement succeed atomically without relocating either stream', () => {
  const { source } = fixture(512, true), original = source.slice();
  const edits = new Map([['BodyText/Section0', new Uint8Array(193).fill(39)],
    ['BodyText/Section1', new Uint8Array(191).fill(37)]]);
  const result = replaceBodyStreamsWithMiniTailGrowth(source, edits);
  assert.equal(result.body_mini_sector_growth, 1); assert.deepEqual(readCfb(result.bytes), edits);
  assert.deepEqual(source, original);
});
