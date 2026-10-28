/** Independent bounded binary-reader tests. All bytes are synthetic and local.
 * cfb is a dev-only fixture writer, never the reader under test. The real HWP
 * fixture initializes only the probe's pinned WASM package; no root npm install,
 * personal documents, network, COM, UI, hosted service, or filesystem writes.
 * Passing these tests is not full CFB/HWP compatibility or visual certification.
 */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { createRequire } from 'node:module';
import { pathToFileURL } from 'node:url';
import test from 'node:test';
import { gzipSync } from 'node:zlib';
import CFB from 'cfb';
import { deflate, deflateRaw } from 'pako';
import { HwpDocument, initSync } from '@rhwp/core';
import { inflateBoundedRaw, readCfb, readHwp } from '../../../src/one_hwp/guard/container.mjs';
import { GuardError } from '../../../src/one_hwp/guard/records.mjs';
import { withCheckedDeflateTrailers } from '../../../tests/fixtures/trailer-fixtures.mjs';

const FREE = 0xffffffff, END = 0xfffffffe, FAT = 0xfffffffd;
const require = createRequire(import.meta.url);
const coreUrl = pathToFileURL(require.resolve('@rhwp/core'));
initSync({ module: fs.readFileSync(new URL('./rhwp_bg.wasm', coreUrl)) });

function concat(...parts) {
  const result = new Uint8Array(parts.reduce((size, part) => size + part.length, 0));
  let offset = 0;
  for (const part of parts) { result.set(part, offset); offset += part.length; }
  return result;
}
const view = (bytes) => new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
const get32 = (bytes, offset) => view(bytes).getUint32(offset, true);
const set32 = (bytes, offset, value) => view(bytes).setUint32(offset, value, true);
const set16 = (bytes, offset, value) => view(bytes).setUint16(offset, value, true);
function record(tag, payload = new Uint8Array(), level = 0) {
  const result = new Uint8Array(4 + payload.length);
  set32(result, 0, tag | (level << 10) | (payload.length << 20));
  result.set(payload, 4);
  return result;
}
function guardCode(action, code) {
  assert.throws(action, (error) => error instanceof GuardError
    && error.code === code && error.message === code);
}
function writeCfb(streams) {
  const container = CFB.utils.cfb_new();
  for (const [name, bytes] of streams) CFB.utils.cfb_add(container, name, Buffer.from(bytes));
  return new Uint8Array(CFB.write(container, { type: 'buffer', fileType: 'cfb' }));
}
function hwpStreams({ compressed = false, bodies = [record(66, new Uint8Array(22))] } = {}) {
  const header = new Uint8Array(256);
  header.set(new TextEncoder().encode('HWP Document File\0'));
  header[35] = 5;
  set32(header, 36, compressed ? 1 : 0);
  const encode = (bytes) => compressed ? deflateRaw(bytes) : bytes;
  return new Map([
    ['FileHeader', header], ['DocInfo', encode(record(16, new Uint8Array(26)))],
    ...bodies.map((body, index) => [`BodyText/Section${index}`, encode(body)]),
  ]);
}
function realHwp({ table = false } = {}) {
  const document = HwpDocument.createEmpty();
  let exported;
  let cellParagraphs = 0;
  try {
    document.createBlankDocument();
    document.insertText(0, 0, 0, '첫 합성 문단 😀');
    document.splitParagraph(0, 0, document.getParagraphLength(0, 0));
    document.insertText(0, 1, 0, '마지막 합성 문단');
    if (table) {
      const location = JSON.parse(document.createTable(0, 0, document.getParagraphLength(0, 0), 2, 2));
      for (let cell = 0; cell < 4; cell++) {
        document.insertTextInCell(0, location.paraIdx, location.controlIdx, cell, 0, 0, `합성 셀 ${cell}`);
        cellParagraphs += document.getCellParagraphCount(0, location.paraIdx, location.controlIdx, cell);
      }
    }
    exported = document.exportHwpWithReport();
    assert.equal(JSON.parse(exported.contentLoss()).count, 0);
    return { bytes: new Uint8Array(exported.takeBytes()),
      paragraphRecords: document.getParagraphCount(0) + cellParagraphs };
  } finally { exported?.free(); document.free(); }
}

// Locate writer-produced sectors for corruption tests, without using CFB.read.
function sectorSize(bytes) { return 2 ** view(bytes).getUint16(30, true); }
function fatOffset(bytes, sid) {
  const size = sectorSize(bytes);
  const fatSid = get32(bytes, 76 + Math.floor(sid / (size / 4)) * 4);
  return (fatSid + 1) * size + (sid % (size / 4)) * 4;
}
function directoryEntries(bytes) {
  const size = sectorSize(bytes), entries = [];
  let sid = get32(bytes, 48);
  for (let sectorIndex = 0; sid !== END && sectorIndex < bytes.length / size; sectorIndex++) {
    for (let slot = 0; slot < size; slot += 128) {
      const offset = (sid + 1) * size + slot;
      const type = bytes[offset + 66];
      if (!type) continue;
      const length = view(bytes).getUint16(offset + 64, true);
      let name = '';
      for (let n = 0; n < length - 2; n += 2) name += String.fromCharCode(view(bytes).getUint16(offset + n, true));
      entries.push({ name, offset, index: sectorIndex * size / 128 + slot / 128 });
    }
    sid = get32(bytes, fatOffset(bytes, sid));
  }
  return entries;
}
function entry(bytes, name) {
  const found = directoryEntries(bytes).find((item) => item.name === name);
  assert.ok(found, `synthetic entry ${name} exists`);
  return found;
}
function changed(bytes, mutate) { const copy = bytes.slice(); mutate(copy); return copy; }
const withCheckedTrailer = (raw) => new Uint8Array(gzipSync(raw).subarray(10));
function v4EmptyCfb() {
  const bytes = new Uint8Array(3 * 4096);
  bytes.set(Uint8Array.of(208, 207, 17, 224, 161, 177, 26, 225));
  set16(bytes, 24, 0x3e); set16(bytes, 26, 4); set16(bytes, 28, 0xfffe);
  set16(bytes, 30, 12); set16(bytes, 32, 6);
  set32(bytes, 40, 1); set32(bytes, 44, 1); set32(bytes, 48, 1);
  set32(bytes, 56, 4096); set32(bytes, 60, END); set32(bytes, 68, END);
  for (let offset = 76; offset < 512; offset += 4) set32(bytes, offset, FREE);
  set32(bytes, 76, 0);
  for (let offset = 4096; offset < 8192; offset += 4) set32(bytes, offset, FREE);
  set32(bytes, 4096, FAT); set32(bytes, 4100, END);
  const root = 8192, name = 'Root Entry';
  for (let index = 0; index < name.length; index++) set16(bytes, root + index * 2, name.charCodeAt(index));
  set16(bytes, root + 64, (name.length + 1) * 2);
  bytes[root + 66] = 5; bytes[root + 67] = 1;
  for (const offset of [68, 72, 76]) set32(bytes, root + offset, FREE);
  set32(bytes, root + 116, END);
  return bytes;
}

test('raw inflate accepts exact output bounds across multiple chunks without mutating input', () => {
  const raw = new Uint8Array(3 * 16384 + 37).fill(0x41);
  const compressed = deflateRaw(raw), copy = compressed.slice();
  assert.deepEqual(inflateBoundedRaw(compressed, raw.length), raw);
  assert.deepEqual(compressed, copy);
  guardCode(() => inflateBoundedRaw(compressed, raw.length - 1), 'expanded_limit');
});
test('raw inflate zero-byte bound accepts empty output and rejects one expanded byte', () => {
  assert.deepEqual(inflateBoundedRaw(deflateRaw(new Uint8Array()), 0), new Uint8Array());
  guardCode(() => inflateBoundedRaw(deflateRaw(Uint8Array.of(1)), 0), 'expanded_limit');
});
test('raw inflate permits only explicitly allowed zero padding and rejects concatenated streams', () => {
  const raw = new TextEncoder().encode('synthetic body');
  const encoded = deflateRaw(raw), padded = concat(encoded, new Uint8Array(64));
  assert.deepEqual(inflateBoundedRaw(padded, raw.length), raw);
  guardCode(() => inflateBoundedRaw(padded, raw.length, { allowZeroPadding: false }), 'compressed_tail');
  guardCode(() => inflateBoundedRaw(concat(encoded, Uint8Array.of(0, 1)), raw.length), 'compressed_tail');
  guardCode(() => inflateBoundedRaw(concat(encoded, deflateRaw(raw)), raw.length), 'compressed_tail');
});
test('raw inflate rejects truncation, invalid deflate, and wrapped zlib input', () => {
  const raw = new Uint8Array(100).fill(0x41), encoded = deflateRaw(raw);
  for (const bytes of [new Uint8Array(), encoded.slice(0, -1), Uint8Array.of(7), deflate(raw)]) {
    guardCode(() => inflateBoundedRaw(bytes, raw.length), 'invalid_deflate');
  }
});
test('raw inflate validates byte-array input and finite nonnegative bounded limits', () => {
  for (const limit of [-1, 0.5, NaN, Infinity, 8 * 1024 * 1024 + 1]) {
    guardCode(() => inflateBoundedRaw(Uint8Array.of(3, 0), limit), 'invalid_limits');
  }
  guardCode(() => inflateBoundedRaw('synthetic', 5), 'invalid_limits');
});
test('raw inflate validates a gzip-style CRC32/ISIZE trailer without a gzip header', () => {
  for (const raw of [new Uint8Array(), new TextEncoder().encode('123456789'),
    new Uint8Array(3 * 16384 + 37).fill(0x41)]) {
    const encoded = withCheckedTrailer(raw), copy = encoded.slice();
    assert.deepEqual(inflateBoundedRaw(encoded, raw.length), raw);
    assert.deepEqual(inflateBoundedRaw(encoded, raw.length, { allowZeroPadding: false }), raw);
    assert.deepEqual(encoded, copy);
    const offset = concat(Uint8Array.of(9), encoded, Uint8Array.of(9)).subarray(1, encoded.length + 1);
    assert.deepEqual(inflateBoundedRaw(offset, raw.length), raw);
  }
  const known = withCheckedTrailer(new TextEncoder().encode('123456789'));
  assert.equal(get32(known, known.length - 8), 0xcbf43926);
});
test('raw inflate rejects corrupt CRC, ISIZE, swapped byte order, and extra trailer bytes', () => {
  const raw = new TextEncoder().encode('synthetic trailer'), encoded = withCheckedTrailer(raw);
  const crcOffset = encoded.length - 8, sizeOffset = encoded.length - 4;
  const cases = [changed(encoded, (x) => x[crcOffset] ^= 1),
    changed(encoded, (x) => x[sizeOffset] ^= 1),
    changed(encoded, (x) => view(x).setUint32(crcOffset, get32(x, crcOffset), false)),
    encoded.slice(0, -1), concat(encoded, Uint8Array.of(0)), concat(encoded, deflateRaw(raw))];
  for (const bytes of cases) guardCode(() => inflateBoundedRaw(bytes, raw.length), 'compressed_tail');
});
test('valid CRC32/ISIZE trailer does not bypass decompression size or end-of-stream checks', () => {
  const raw = new Uint8Array(1000).fill(0x41), encoded = withCheckedTrailer(raw);
  guardCode(() => inflateBoundedRaw(encoded, raw.length - 1), 'expanded_limit');
  for (const bytes of [encoded.slice(0, 1), encoded.slice(0, -9)]) {
    guardCode(() => inflateBoundedRaw(bytes, raw.length), 'invalid_deflate');
  }
});

const cfbFixture = () => writeCfb(new Map([
  ['SmallA', Uint8Array.of(1, 2, 3)], ['SmallB', new Uint8Array(70).fill(0x42)],
  ['LargeA', new Uint8Array(4096).fill(0x41)], ['LargeB', new Uint8Array(5000).fill(0x43)],
  ['Nested/Child', Uint8Array.of(8, 9)],
]));
test('CFB reads mini, ordinary, and nested streams exactly, including offset views', () => {
  const bytes = cfbFixture(), copy = bytes.slice();
  const input = concat(new Uint8Array(7), bytes, new Uint8Array(9)).subarray(7, 7 + bytes.length);
  const streams = readCfb(input);
  assert.deepEqual(streams.get('SmallA'), Uint8Array.of(1, 2, 3));
  assert.deepEqual(streams.get('SmallB'), new Uint8Array(70).fill(0x42));
  assert.deepEqual(streams.get('LargeA'), new Uint8Array(4096).fill(0x41));
  assert.deepEqual(streams.get('LargeB'), new Uint8Array(5000).fill(0x43));
  assert.deepEqual(streams.get('Nested/Child'), Uint8Array.of(8, 9));
  assert.deepEqual(bytes, copy);
});
test('CFB zero-length streams require ENDOFCHAIN and expose no content bytes', () => {
  const bytes = writeCfb(new Map([['Empty', new Uint8Array()]]));
  // cfb 1.2.2 assigns zero to the unused start slot. Construct the guard's
  // supported canonical empty chain explicitly; no reader is used to fix it.
  const offset = entry(bytes, 'Empty').offset + 116;
  set32(bytes, offset, END);
  assert.deepEqual(readCfb(bytes).get('Empty'), new Uint8Array());
  guardCode(() => readCfb(changed(bytes, (copy) => set32(copy, offset, 0))), 'mini_chain_invalid');
});
test('CFB v3 ignores uninitialized high stream-size DWORDs, including root size', () => {
  const original = cfbFixture();
  const modified = changed(original, (bytes) => {
    for (const item of directoryEntries(bytes)) set32(bytes, item.offset + 124, 0xdeadbeef);
  });
  assert.deepEqual(readCfb(modified), readCfb(original));
});
test('CFB v4 accepts a valid empty container and honors its high size DWORD', () => {
  const original = v4EmptyCfb();
  assert.deepEqual(readCfb(original), new Map());
  guardCode(() => readCfb(changed(original, (bytes) => set32(bytes, 8192 + 124, 1))), 'stream_limit');
  guardCode(() => readCfb(changed(original, (bytes) => { bytes[600] = 1; })), 'invalid_cfb');
});
for (const [name, mutate] of [
  ['magic', (bytes) => { bytes[0] ^= 1; }],
  ['CLSID', (bytes) => { bytes[8] = 1; }],
  ['version', (bytes) => set16(bytes, 26, 2)],
  ['byte order', (bytes) => set16(bytes, 28, 0xfeff)],
  ['sector shift', (bytes) => set16(bytes, 30, 10)],
  ['mini-sector shift', (bytes) => set16(bytes, 32, 5)],
  ['reserved header', (bytes) => { bytes[34] = 1; }],
  ['v3 directory count', (bytes) => set32(bytes, 40, 1)],
  ['mini cutoff', (bytes) => set32(bytes, 56, 64)],
]) {
  test(`CFB refuses malformed ${name} with a fixed code`, () => {
    guardCode(() => readCfb(changed(cfbFixture(), mutate)), 'invalid_cfb');
  });
}
test('CFB refuses non-byte input, truncation, over-limit input, and oversized declared streams', () => {
  const bytes = cfbFixture();
  guardCode(() => readCfb('synthetic'), 'input_limit');
  guardCode(() => readCfb(bytes.subarray(0, 511)), 'input_limit');
  guardCode(() => readCfb(bytes.subarray(0, -1)), 'invalid_cfb');
  guardCode(() => readCfb(bytes, { maxDocumentBytes: bytes.length - 1 }), 'input_limit');
  guardCode(() => readCfb(changed(bytes, (value) => set32(value, entry(value, 'SmallA').offset + 120, 4 * 1024 * 1024 + 1))), 'stream_limit');
});
test('CFB rejects FAT role mismatch, duplicate FAT ownership, and inconsistent DIFAT', () => {
  const original = cfbFixture();
  guardCode(() => readCfb(changed(original, (bytes) => set32(bytes, fatOffset(bytes, get32(bytes, 76)), END))), 'cfb_chain_invalid');
  guardCode(() => readCfb(changed(original, (bytes) => {
    set32(bytes, 44, get32(bytes, 44) + 1); set32(bytes, 80, get32(bytes, 76));
  })), 'cfb_chain_invalid');
  guardCode(() => readCfb(changed(original, (bytes) => { set32(bytes, 72, 1); set32(bytes, 68, get32(bytes, 76)); })), 'cfb_chain_invalid');
});
test('CFB directory, root mini-stream, MiniFAT, and regular stream ownership cannot alias', () => {
  const original = cfbFixture(), directorySid = get32(original, 48);
  guardCode(() => readCfb(changed(original, (bytes) => set32(bytes, fatOffset(bytes, directorySid), directorySid))), 'cfb_chain_invalid');
  guardCode(() => readCfb(changed(original, (bytes) => set32(bytes, entry(bytes, 'Root Entry').offset + 116, directorySid))), 'cfb_chain_invalid');
  guardCode(() => readCfb(changed(original, (bytes) => set32(bytes, 60, directorySid))), 'cfb_chain_invalid');
  guardCode(() => readCfb(changed(original, (bytes) => {
    set32(bytes, entry(bytes, 'LargeB').offset + 116, get32(bytes, entry(bytes, 'LargeA').offset + 116));
  })), 'cfb_chain_invalid');
});
test('CFB refuses ordinary chain cycles, out-of-range SIDs, and mismatched declared lengths', () => {
  const original = cfbFixture();
  guardCode(() => readCfb(changed(original, (bytes) => {
    const sid = get32(bytes, entry(bytes, 'LargeA').offset + 116); set32(bytes, fatOffset(bytes, sid), sid);
  })), 'cfb_chain_invalid');
  guardCode(() => readCfb(changed(original, (bytes) => set32(bytes, entry(bytes, 'LargeA').offset + 116, 0x10000000))), 'cfb_chain_invalid');
  guardCode(() => readCfb(changed(original, (bytes) => set32(bytes, entry(bytes, 'LargeA').offset + 120, 4097))), 'cfb_chain_invalid');
});
test('CFB refuses mini-chain cycles, reused mini-sectors, truncation, and out-of-range SIDs', () => {
  const original = cfbFixture();
  guardCode(() => readCfb(changed(original, (bytes) => {
    const sid = get32(bytes, entry(bytes, 'SmallA').offset + 116);
    set32(bytes, (get32(bytes, 60) + 1) * sectorSize(bytes) + sid * 4, sid);
  })), 'mini_chain_invalid');
  guardCode(() => readCfb(changed(original, (bytes) => {
    set32(bytes, entry(bytes, 'SmallB').offset + 116, get32(bytes, entry(bytes, 'SmallA').offset + 116));
  })), 'mini_chain_invalid');
  guardCode(() => readCfb(changed(original, (bytes) => set32(bytes, entry(bytes, 'SmallA').offset + 120, 65))), 'mini_chain_invalid');
  guardCode(() => readCfb(changed(original, (bytes) => set32(bytes, entry(bytes, 'SmallA').offset + 116, 0x10000000))), 'mini_chain_invalid');
});
test('CFB directory trees reject cycles, orphan entries, and children on stream entries', () => {
  const original = cfbFixture();
  guardCode(() => readCfb(changed(original, (bytes) => {
    const item = entry(bytes, 'SmallA'); set32(bytes, item.offset + 68, item.index);
  })), 'directory_invalid');
  guardCode(() => readCfb(changed(original, (bytes) => set32(bytes, entry(bytes, 'Root Entry').offset + 76, FREE))), 'directory_invalid');
  guardCode(() => readCfb(changed(original, (bytes) => set32(bytes, entry(bytes, 'SmallA').offset + 76, 1))), 'directory_invalid');
});
for (const unit of [0, 47, 92, 58, 33]) {
  test(`CFB directory refuses forbidden name unit ${unit}`, () => {
    guardCode(() => readCfb(changed(cfbFixture(), (bytes) => set16(bytes, entry(bytes, 'SmallA').offset, unit))), 'invalid_cfb');
  });
}
test('CFB directory refuses empty/odd/overlong names, missing terminators, and invalid colors', () => {
  const original = cfbFixture();
  for (const length of [2, 3, 66]) {
    guardCode(() => readCfb(changed(original, (bytes) => set16(bytes, entry(bytes, 'SmallA').offset + 64, length))), 'invalid_cfb');
  }
  guardCode(() => readCfb(changed(original, (bytes) => {
    const offset = entry(bytes, 'SmallA').offset; set16(bytes, offset + view(bytes).getUint16(offset + 64, true) - 2, 65);
  })), 'invalid_cfb');
  guardCode(() => readCfb(changed(original, (bytes) => { bytes[entry(bytes, 'SmallA').offset + 67] = 2; })), 'invalid_cfb');
});
test('CFB metadata budgets are inclusive for directory slots and aggregate path characters', () => {
  const bytes = writeCfb(new Map([['A', Uint8Array.of(1)], ['BBBB', Uint8Array.of(2)]]));
  const slots = directoryEntries(bytes).length <= 4 ? 4 : 8;
  assert.ok(readCfb(bytes, { maxDirectoryEntries: slots }).has('A'));
  guardCode(() => readCfb(bytes, { maxDirectoryEntries: slots - 1 }), 'directory_limit');
  const chars = [...readCfb(bytes).keys()].reduce((sum, name) => sum + name.length, 0);
  assert.ok(readCfb(bytes, { maxPathChars: chars }).has('BBBB'));
  guardCode(() => readCfb(bytes, { maxPathChars: chars - 1 }), 'directory_limit');
});
test('CFB/HWP options may only lower known integer budgets and reject non-object options', () => {
  const bytes = writeCfb(hwpStreams());
  for (const options of [null, [], true, 0, 'synthetic', { unknown: 0 }, { maxBodyBytes: -1 },
    { maxBodyBytes: 0.5 }, { maxDocumentBytes: 4 * 1024 * 1024 + 1 },
    { maxDirectoryEntries: 2049 }, { maxPathChars: 65537 }, { constructor: 0 },
    { toString: 0 }, JSON.parse('{"__proto__":0}')]) {
    guardCode(() => readCfb(bytes, options), 'invalid_limits');
    guardCode(() => readHwp(bytes, options), 'invalid_limits');
  }
});

test('real pinned WASM synthetic HWP paragraphs and table pass the independent reader', () => {
  for (const table of [false, true]) {
    const { bytes, paragraphRecords } = realHwp({ table }), copy = bytes.slice();
    const result = readHwp(bytes);
    assert.equal(result.streams.get('FileHeader')[35], 5);
    assert.equal(result.profile.paragraph_records, paragraphRecords);
    assert.deepEqual(result.profile.unsupported, []);
    assert.deepEqual(bytes, copy);
  }
});
test('HWP raw and compressed section streams expose identical envelopes', () => {
  const bodies = [record(66, new Uint8Array(22)), record(66, new Uint8Array(22))];
  const plain = readHwp(writeCfb(hwpStreams({ bodies })));
  const compressed = readHwp(writeCfb(hwpStreams({ compressed: true, bodies })));
  assert.deepEqual(plain.profile, compressed.profile);
  assert.deepEqual(plain.streams.get('DocInfo'), compressed.streams.get('DocInfo'));
  assert.equal(compressed.profile.paragraph_records, 2);
});
test('HWP body accepts compressed zero padding, but DocInfo accepts no compressed tail', () => {
  const streams = hwpStreams({ compressed: true });
  streams.set('BodyText/Section0', concat(streams.get('BodyText/Section0'), new Uint8Array(32)));
  assert.equal(readHwp(writeCfb(streams)).profile.paragraph_records, 1);
  streams.set('DocInfo', concat(streams.get('DocInfo'), Uint8Array.of(0)));
  guardCode(() => readHwp(writeCfb(streams)), 'compressed_tail');
});
test('HWP accepts only verified CRC32/ISIZE trailers on body and DocInfo streams', () => {
  const streams = hwpStreams(), expected = readHwp(writeCfb(streams));
  set32(streams.get('FileHeader'), 36, 1);
  for (const name of ['DocInfo', 'BodyText/Section0']) streams.set(name, withCheckedTrailer(streams.get(name)));
  const actual = readHwp(writeCfb(streams));
  assert.deepEqual(actual.profile, expected.profile);
  assert.deepEqual(actual.streams.get('DocInfo'), expected.streams.get('DocInfo'));
  for (const name of ['DocInfo', 'BodyText/Section0']) {
    const corrupt = new Map(streams);
    corrupt.set(name, changed(corrupt.get(name), (x) => x[x.length - 8] ^= 1));
    guardCode(() => readHwp(writeCfb(corrupt)), 'compressed_tail');
  }
});
test('generated real HWP keeps decoded streams and profile with checked trailers', () => {
  // Buffer.slice aliases its input; the fixture mutator must still make a copy.
  const source = Buffer.from(realHwp({ table: true }).bytes), copy = Buffer.from(source);
  const expected = readHwp(source), actual = readHwp(withCheckedDeflateTrailers(source));
  assert.deepEqual(actual.profile, expected.profile);
  assert.deepEqual(actual.streams, expected.streams);
  assert.deepEqual(source, copy);
});
test('HWP rejects nonzero body compressed tails and truncated compressed DocInfo', () => {
  const streams = hwpStreams({ compressed: true });
  streams.set('BodyText/Section0', concat(streams.get('BodyText/Section0'), Uint8Array.of(1)));
  guardCode(() => readHwp(writeCfb(streams)), 'compressed_tail');
  const truncated = hwpStreams({ compressed: true });
  truncated.set('DocInfo', truncated.get('DocInfo').slice(0, -1));
  guardCode(() => readHwp(writeCfb(truncated)), 'invalid_deflate');
});
test('HWP rejects missing required streams, wrong signature, and unsupported format version', () => {
  for (const name of ['FileHeader', 'DocInfo', 'BodyText/Section0']) {
    const streams = hwpStreams(); streams.delete(name);
    guardCode(() => readHwp(writeCfb(streams)), 'unsupported_hwp');
  }
  const wrongSignature = hwpStreams(); wrongSignature.get('FileHeader')[0] ^= 1;
  guardCode(() => readHwp(writeCfb(wrongSignature)), 'unsupported_hwp');
  const wrongVersion = hwpStreams(); wrongVersion.get('FileHeader')[35] = 4;
  guardCode(() => readHwp(writeCfb(wrongVersion)), 'unsupported_hwp');
});
for (const flags of [2, 4, 8, 16, 32, 0x80000000, 3]) {
  test(`HWP refuses security/optional flags ${flags}`, () => {
    const streams = hwpStreams(); set32(streams.get('FileHeader'), 36, flags);
    guardCode(() => readHwp(writeCfb(streams)), 'unsupported_hwp_flags');
  });
}
test('HWP discloses unknown body envelopes without including their payload', () => {
  const secret = 'SYNTHETIC_PRIVATE_BODY_NOT_IN_PROFILE';
  const body = concat(record(66, new Uint8Array(22)), record(1000, new TextEncoder().encode(secret), 1));
  const result = readHwp(writeCfb(hwpStreams({ bodies: [body] })));
  assert.equal(result.profile.paragraph_records, 1);
  assert.deepEqual(result.profile.unsupported.map(({ record_tag, record_level }) => [record_tag, record_level]), [[1000, 1]]);
  assert.equal(JSON.stringify(result.profile).includes(secret), false);
});
test('HWP aggregate expanded body and independent DocInfo budgets apply to raw and compressed streams', () => {
  const body = record(66, new Uint8Array(22)), docInfoBytes = 30;
  for (const compressed of [false, true]) {
    const bytes = writeCfb(hwpStreams({ compressed, bodies: [body, body] }));
    assert.equal(readHwp(bytes, { maxBodyBytes: body.length * 2, maxDocInfoBytes: docInfoBytes }).profile.expanded_bytes, 52);
    guardCode(() => readHwp(bytes, { maxBodyBytes: body.length * 2 - 1 }), 'expanded_limit');
    guardCode(() => readHwp(bytes, { maxDocInfoBytes: docInfoBytes - 1 }), 'expanded_limit');
  }
});
test('HWP malformed body record tails and section gaps are rejected rather than counted as success', () => {
  guardCode(() => readHwp(writeCfb(hwpStreams({ bodies: [Uint8Array.of(1)] }))), 'TRUNCATED_RECORD_HEADER');
  const streams = hwpStreams(); streams.set('BodyText/Section2', record(66, new Uint8Array(22)));
  guardCode(() => readHwp(writeCfb(streams)), 'INCOMPLETE_SECTIONS');
  const invalidName = hwpStreams(); invalidName.set('BodyText/Other', record(66, new Uint8Array(22)));
  guardCode(() => readHwp(writeCfb(invalidName)), 'INVALID_BODY_LAYOUT');
});
