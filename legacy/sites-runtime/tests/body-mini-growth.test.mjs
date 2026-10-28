import assert from 'node:assert/strict';
import test from 'node:test';
import CFB from 'cfb';
import { readCfb, replaceAllocatedBodyStreams, replaceBodyStreamsWithMiniTailGrowth } from '../../../src/one_hwp/guard/container.mjs';

import { miniAllocationFixture as fixture } from './body-mini-fixtures.mjs';


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
