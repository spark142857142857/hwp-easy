import assert from 'node:assert/strict';
import test from 'node:test';
import CFB from 'cfb';
import { bodyRepairAllocationDiagnostic, readCfb, replaceAllocatedBodyStreams } from '../guard/container.mjs';

const make = (length) => {
  const cfb = CFB.utils.cfb_new();
  for (const [name, size] of [['DocInfo', 100], ['BodyText/Section0', length], ['BinData/keep', 150], ['Other/Section0', 120]]) {
    CFB.utils.cfb_add(cfb, name, Buffer.alloc(size, 42));
  }
  return new Uint8Array(CFB.write(cfb, { type: 'buffer', fileType: 'cfb' }));
};
for (const length of [190, 5100]) {
  test(`bounded body replacement preserves CFB allocation and other streams (${length})`, () => {
    const source = make(length), original = source.slice();
    const replacement = new Uint8Array(length + 1).fill(39), before = readCfb(source);
    const result = replaceAllocatedBodyStreams(source, new Map([['BodyText/Section0', replacement]]));
    assert.notEqual(result, source);
    assert.equal(result.length, source.length);
    assert.deepEqual(result.subarray(0, 512), source.subarray(0, 512));
    assert.deepEqual(source, original);
    const after = readCfb(result);
    assert.deepEqual([...before.keys()], [...after.keys()]);
    for (const [name, content] of before) assert.deepEqual(after.get(name), name === 'BodyText/Section0' ? replacement : content);
    // Independent dev reader, not only the parser used by replacement.
    const external = CFB.read(Buffer.from(result), { type: 'buffer' });
    const index = external.FullPaths.findIndex((path) => path.endsWith('/BodyText/Section0'));
    assert.ok(index >= 0);
    assert.deepEqual(new Uint8Array(external.FileIndex[index].content), replacement);
  });
}

test('body replacement rejects allocation changes/storage class and is immutable for Buffer input', () => {
  for (const [oldSize, newSize] of [[190, 193], [5100, 5121], [4080, 4096], [4100, 4095], [190, 0]]) {
    const source = Buffer.from(make(oldSize)), original = Buffer.from(source);
    assert.throws(() => replaceAllocatedBodyStreams(source,
      new Map([['BodyText/Section0', new Uint8Array(newSize)]])), /BODY_REPAIR_(ALLOCATION_UNSUPPORTED|INVALID)/);
    assert.deepEqual(source, original);
  }
  const source = Buffer.from(make(190)), original = Buffer.from(source);
  const result = replaceAllocatedBodyStreams(source, new Map([['BodyText/Section0', new Uint8Array(191)]]));
  assert.deepEqual(source, original);
  result.fill(0); assert.deepEqual(source, original);
});

test('validated allocation rejection distinguishes growth, shrink and storage-class changes without private fields', () => {
  for (const [oldSize, newSize] of [[190, 193], [193, 190], [5100, 5121], [5121, 5100], [4080, 4096], [4100, 4095]]) {
    const source = make(oldSize), original = source.slice();
    let caught;
    assert.throws(() => replaceAllocatedBodyStreams(source,
      new Map([['BodyText/Section0', new Uint8Array(newSize)]])), (error) => {
      caught = error; return error.code === 'BODY_REPAIR_ALLOCATION_UNSUPPORTED';
    });
    const oldMini = oldSize < 4096, newMini = newSize < 4096;
    const expected = { scope: 'candidate_body_stream_allocation',
      reason: oldMini === newMini ? 'allocation_count_changed' : 'storage_class_changed',
      candidate_storage_class: oldMini ? 'mini' : 'regular', repaired_storage_class: newMini ? 'mini' : 'regular',
      candidate_unit_bytes: oldMini ? 64 : 512, repaired_unit_bytes: newMini ? 64 : 512,
      candidate_units: Math.ceil(oldSize / (oldMini ? 64 : 512)), repaired_units: Math.ceil(newSize / (newMini ? 64 : 512)),
      candidate_stream_bytes: oldSize, repaired_stream_bytes: newSize };
    assert.deepEqual(bodyRepairAllocationDiagnostic(caught), expected);
    caught.message = 'PRIVATE_DOCUMENT_TEXT'; caught.allocation = { secret: 'PRIVATE_SIGNED_URL' };
    const copy = bodyRepairAllocationDiagnostic(caught); copy.candidate_stream_bytes = -1;
    assert.deepEqual(bodyRepairAllocationDiagnostic(caught), expected);
    assert.deepEqual(source, original);
  }
  for (const error of [null, 'private', new Error('PRIVATE_TEXT'), {
    code: 'BODY_REPAIR_ALLOCATION_UNSUPPORTED', allocation: { secret: 'PRIVATE_TEXT' } }]) {
    assert.equal(bodyRepairAllocationDiagnostic(error), undefined);
  }
  assert.throws(() => replaceAllocatedBodyStreams(make(190),
    new Map([['BodyText/Section1', new Uint8Array(193)]])), (error) => {
    assert.equal(bodyRepairAllocationDiagnostic(error), undefined); return error.code === 'BODY_REPAIR_ALLOCATION_UNSUPPORTED';
  });
});

test('bounded body replacement supports validated CFB v4 mini and regular allocation', () => {
  const END = 0xfffffffe, FREE = 0xffffffff, FAT = 0xfffffffd, size = 4096;
  for (const mini of [true, false]) {
    const source = new Uint8Array(5 * size), v = new DataView(source.buffer);
    const set16 = (o, n) => v.setUint16(o, n, true), set32 = (o, n) => v.setUint32(o, n, true);
    source.set(Uint8Array.of(208, 207, 17, 224, 161, 177, 26, 225));
    set16(24, 0x3e); set16(26, 4); set16(28, 0xfffe); set16(30, 12); set16(32, 6);
    set32(40, 1); set32(44, 1); set32(48, 1); set32(56, 4096);
    set32(60, mini ? 3 : END); set32(64, mini ? 1 : 0); set32(68, END);
    for (let o = 76; o < 512; o += 4) set32(o, FREE); set32(76, 0);
    for (let o = size; o < 2 * size; o += 4) set32(o, FREE);
    set32(size, FAT); set32(size + 4, END); set32(size + 8, mini ? END : 3); set32(size + 12, END);
    const entry = (index, name, type, first, length, child = FREE) => {
      const o = 2 * size + index * 128;
      [...name].forEach((c, i) => set16(o + i * 2, c.charCodeAt(0)));
      set16(o + 64, (name.length + 1) * 2); source[o + 66] = type; source[o + 67] = 1;
      set32(o + 68, FREE); set32(o + 72, FREE); set32(o + 76, child); set32(o + 116, first); set32(o + 120, length);
    };
    entry(0, 'Root Entry', 5, mini ? 2 : END, mini ? 192 : 0, 1);
    entry(1, 'BodyText', 1, END, 0, 2);
    const length = mini ? 190 : 4100; entry(2, 'Section0', 2, mini ? 0 : 2, length);
    source.fill(42, 3 * size, 3 * size + length);
    if (mini) {
      for (let o = 4 * size; o < 5 * size; o += 4) set32(o, FREE);
      set32(4 * size, 1); set32(4 * size + 4, 2); set32(4 * size + 8, END);
    }
    const original = source.slice(), replacement = new Uint8Array(length + 1).fill(39);
    assert.equal(readCfb(source).get('BodyText/Section0').length, length);
    for (const newSize of mini ? [193, 4096] : [4095, 8193]) {
      assert.throws(() => replaceAllocatedBodyStreams(source,
        new Map([['BodyText/Section0', new Uint8Array(newSize)]])), (error) => {
        const d = bodyRepairAllocationDiagnostic(error), newMini = newSize < 4096;
        assert.equal(d.candidate_unit_bytes, mini ? 64 : size);
        assert.equal(d.repaired_unit_bytes, newMini ? 64 : size);
        assert.equal(d.repaired_units, Math.ceil(newSize / (newMini ? 64 : size)));
        assert.equal(d.reason, mini === newMini ? 'allocation_count_changed' : 'storage_class_changed');
        return error.code === 'BODY_REPAIR_ALLOCATION_UNSUPPORTED';
      });
      assert.deepEqual(source, original);
    }
    const output = replaceAllocatedBodyStreams(source, new Map([['BodyText/Section0', replacement]]));
    assert.deepEqual(readCfb(output).get('BodyText/Section0'), replacement);
    assert.deepEqual(source, original);
    assert.deepEqual(output.subarray(0, 2 * size), source.subarray(0, 2 * size));
    const external = CFB.read(Buffer.from(output), { type: 'buffer' });
    assert.deepEqual(new Uint8Array(external.FileIndex[external.FullPaths.findIndex((p) => p.endsWith('/BodyText/Section0'))].content), replacement);
  }
});

test('later allocation failure never partially replaces an earlier valid body stream', () => {
  const cfb = CFB.utils.cfb_new();
  for (const name of ['BodyText/Section0', 'BodyText/Section1']) CFB.utils.cfb_add(cfb, name, Buffer.alloc(190, 42));
  const source = new Uint8Array(CFB.write(cfb, { type: 'buffer', fileType: 'cfb' })), original = source.slice();
  assert.throws(() => replaceAllocatedBodyStreams(source, new Map([
    ['BodyText/Section0', new Uint8Array(191).fill(39)], ['BodyText/Section1', new Uint8Array(193).fill(39)],
  ])), (error) => bodyRepairAllocationDiagnostic(error)?.repaired_stream_bytes === 193);
  assert.deepEqual(source, original); assert.deepEqual(readCfb(source), readCfb(original));
});

test('body replacement cannot write other streams, create paths or accept malformed chains', () => {
  const source = make(190), original = source.slice();
  for (const name of ['DocInfo', 'Other/Section0', 'BodyText/Section01', 'BodyText/Section1']) {
    assert.throws(() => replaceAllocatedBodyStreams(source, new Map([[name, new Uint8Array(190)]])), /BODY_REPAIR_/);
  }
  const bad = source.slice(); new DataView(bad.buffer).setUint32(48, 0xffffffff, true);
  assert.throws(() => replaceAllocatedBodyStreams(bad, new Map([['BodyText/Section0', new Uint8Array(190)]])));
  assert.throws(() => replaceAllocatedBodyStreams(source, new Map()), /BODY_REPAIR_INVALID/);
  assert.deepEqual(source, original);
});
