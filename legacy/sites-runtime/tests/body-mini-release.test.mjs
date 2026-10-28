import assert from 'node:assert/strict';
import test from 'node:test';
import CFB from 'cfb';
import { readCfb, replaceBodyStreamsWithMiniTailAdjustment, replaceAllocatedBodyStreams } from '../../../src/one_hwp/guard/container.mjs';
import { miniAllocationFixture } from './body-mini-fixtures.mjs';

const name = 'BodyText/Section0', END = 0xfffffffe, FREE = 0xffffffff;
for (const size of [512, 4096]) {
  test(`one-mini release preserves root/file allocation, unrelated bytes and streams (${size})`, () => {
    const f = miniAllocationFixture(size), source = Buffer.from(f.source), original = source.slice();
    const replacement = new Uint8Array(128).fill(39), edits = new Map([[name, replacement]]);
    assert.throws(() => replaceAllocatedBodyStreams(source, edits), /BODY_REPAIR_ALLOCATION_UNSUPPORTED/);
    const result = replaceBodyStreamsWithMiniTailAdjustment(source, edits);
    assert.equal(result.body_mini_sector_release, 1); assert.equal(result.body_mini_sector_growth, 0);
    assert.equal(result.bytes.length, original.length);
    const before = readCfb(original), after = readCfb(result.bytes), view = new DataView(result.bytes.buffer);
    assert.deepEqual(after.get(name), replacement); assert.deepEqual(after.get('Keep'), before.get('Keep'));
    assert.equal(view.getUint32(f.rootSizeOffset, true), f.rootSize);
    assert.equal(view.getUint32(f.miniFatOffset + 4, true), END);
    assert.equal(view.getUint32(f.miniFatOffset + 8, true), FREE);
    assert(result.bytes.subarray(3 * size + 128, 3 * size + 192).every(n => n === 0));
    const allowed = new Uint8Array(source.length);
    for (const [offset, length] of [[3 * size, 192], [f.bodySizeOffset, 4], [f.miniFatOffset + 4, 8]])
      allowed.fill(1, offset, offset + length);
    assert(original.every((n, i) => n === result.bytes[i] || allowed[i]));
    const external = CFB.read(Buffer.from(result.bytes), { type: 'buffer' });
    for (const [path, bytes] of after) {
      const index = external.FullPaths.findIndex(p => p.endsWith('/' + path));
      assert(index >= 0); assert.deepEqual(new Uint8Array(external.FileIndex[index].content), bytes);
    }
    result.bytes.fill(0); assert.deepEqual(source, original);
  });

  test(`noncontiguous mini tail release follows the validated chain (${size})`, () => {
    const f = miniAllocationFixture(size), v = new DataView(f.source.buffer);
    f.source.copyWithin(3 * size + 256, 3 * size + 128, 3 * size + 192);
    f.source.fill(0, 3 * size + 128, 3 * size + 192);
    v.setUint32(f.rootSizeOffset, 320, true);
    v.setUint32(f.miniFatOffset + 4, 4, true); v.setUint32(f.miniFatOffset + 8, FREE, true);
    v.setUint32(f.miniFatOffset + 16, END, true);
    const original = f.source.slice(), before = readCfb(original);
    const result = replaceBodyStreamsWithMiniTailAdjustment(f.source, new Map([[name, new Uint8Array(127).fill(38)]]));
    const after = readCfb(result.bytes), out = new DataView(result.bytes.buffer);
    assert.equal(result.body_mini_sector_release, 1); assert.deepEqual(after.get('Keep'), before.get('Keep'));
    assert.equal(out.getUint32(f.miniFatOffset + 4, true), END);
    assert.equal(out.getUint32(f.miniFatOffset + 16, true), FREE);
    assert.equal(out.getUint32(f.rootSizeOffset, true), 320);
    assert.deepEqual(f.source, original);
  });

  test(`release rejects invalid/shared chains and high size DWORD before mutation (${size})`, () => {
    for (const change of [
      v => v.setUint32(fatOffset(size, 2), 0, true),
      v => v.setUint32(fatOffset(size, 2), 3, true),
      v => v.setUint32(2 * size + 256 + 124, 1, true),
    ]) {
      const f = miniAllocationFixture(size); change(new DataView(f.source.buffer));
      const original = f.source.slice();
      assert.throws(() => replaceBodyStreamsWithMiniTailAdjustment(f.source, new Map([[name, new Uint8Array(128)]])));
      assert.deepEqual(f.source, original);
    }
  });
}
const fatOffset = (size, id) => 4 * size + id * 4;

test('release refuses more than one unit, empty bodies, other streams and multiple adjustments atomically', () => {
  for (const [path, length] of [[name, 64], [name, 0], [name, 4096], ['Keep', 1], ['BodyText/Section7', 128]]) {
    const f = miniAllocationFixture(), original = f.source.slice();
    assert.throws(() => replaceBodyStreamsWithMiniTailAdjustment(f.source, new Map([[path, new Uint8Array(length)]])));
    assert.deepEqual(f.source, original);
  }
  for (const second of [128, 193, 64]) {
    const f = miniAllocationFixture(512, true), original = f.source.slice();
    assert.throws(() => replaceBodyStreamsWithMiniTailAdjustment(f.source, new Map([
      [name, new Uint8Array(128)], ['BodyText/Section1', new Uint8Array(second)],
    ])), /BODY_REPAIR_ALLOCATION_UNSUPPORTED/);
    assert.deepEqual(f.source, original);
  }
});

test('one release and exact second body succeed with source and other chain unchanged', () => {
  const f = miniAllocationFixture(512, true), original = f.source.slice();
  const edits = new Map([[name, new Uint8Array(128).fill(38)], ['BodyText/Section1', new Uint8Array(191).fill(39)]]);
  const result = replaceBodyStreamsWithMiniTailAdjustment(f.source, edits);
  assert.equal(result.body_mini_sector_release, 1); assert.deepEqual(readCfb(result.bytes), edits);
  assert.deepEqual(f.source, original);
});

test('regular-sector shrink and regular-to-mini transitions remain unsupported', () => {
  const cfb = CFB.utils.cfb_new();
  CFB.utils.cfb_add(cfb, name, Buffer.alloc(5100, 42));
  CFB.utils.cfb_add(cfb, 'Keep', Buffer.alloc(120, 47));
  const source = Buffer.from(CFB.write(cfb, { type: 'buffer', fileType: 'cfb' })), original = source.slice();
  for (const length of [4608, 4095]) {
    assert.throws(() => replaceBodyStreamsWithMiniTailAdjustment(source, new Map([[name, new Uint8Array(length)]])),
      /BODY_REPAIR_ALLOCATION_UNSUPPORTED/);
    assert.deepEqual(source, original);
  }
});
