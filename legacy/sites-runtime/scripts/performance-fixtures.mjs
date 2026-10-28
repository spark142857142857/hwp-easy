// Developer-only generated inputs. No source paths, network or personal files.
import { syntheticFixture } from '../../../src/one_hwp/synthetic_fixtures.mjs';
import CFB from 'cfb';
import { deflateRawSync, inflateRawSync } from 'node:zlib';
import { readCfb } from '../../../src/one_hwp/guard/container.mjs';
import { parseRecords } from '../../../src/one_hwp/guard/records.mjs';
import { encodeRecords } from '../../../tests/fixtures/page-number-fixtures.mjs';

export const performanceCases = Object.freeze([
  'small', 'form45', 'repeated200k', 'entropy64k', 'entropy350k',
  'entropy1200k', 'content_limit2000k',
]);

function deterministicText(length) {
  let state = 12345, result = '';
  for (let offset = 0; offset < length; offset += 4096) {
    const chunk = [];
    for (let i = offset; i < Math.min(length, offset + 4096); i++) {
      state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
      chunk.push(String.fromCharCode(33 + state % 90));
    }
    result += chunk.join('');
  }
  return result;
}

export function makePerformanceFixture(name, HwpDocument, api) {
  if (!performanceCases.includes(name)) throw new Error('INVALID_SYNTHETIC_CASE');
  if (name === 'content_limit2000k') {
    // Negative READ workload only. Avoid constructing two million characters
    // through the upstream editor before testing our model inspection limit.
    // This external CFB rewrite is NOT an engine-writer preservation fixture.
    return makeRawTextLimitFixture(2000001, HwpDocument, api);
  }
  let options = {};
  if (name === 'form45') options.cells = Array.from({ length: 45 }, (_, index) =>
    [index === 0 ? '합성 문항\n합성 안내' : index === 1 ? '' : '반복 합성 답변']);
  else if (name !== 'small') {
    const length = { repeated200k: 200000, entropy64k: 64000, entropy350k: 350000,
      entropy1200k: 1200000 }[name];
    options = { table: false,
      paragraphs: [name === 'repeated200k' ? '가'.repeat(length) : deterministicText(length), '합성 마지막 문단'] };
  }
  return syntheticFixture(HwpDocument, api.exportChecked, options);
}

// Negative admission fixture only: externally extend one text record. This is
// not a valid-edit/layout corpus and must never count as a successful save.
export function makeRawTextLimitFixture(units, HwpDocument, api) {
  if (!Number.isSafeInteger(units) || units < 1 || units > 2000001) throw new Error('INVALID_SYNTHETIC_CASE');
  const base = syntheticFixture(HwpDocument, api.exportChecked,
    { table: false, paragraphs: ['가'] });
  const streams = readCfb(base), body = 'BodyText/Section0';
  const records = [...parseRecords(inflateRawSync(streams.get(body)))];
  const header = records.find((record) => record.tag === 66 && record.level === 0);
  const text = records.find((record) => record.tag === 67 && record.level === 1);
  const extra = Buffer.from('가'.repeat(units - 1), 'utf16le');
  const payload = new Uint8Array(text.payload.length + extra.length);
  payload.set(text.payload.subarray(0, -2));
  payload.set(extra, text.payload.length - 2);
  payload.set(text.payload.subarray(-2), payload.length - 2);
  text.payload = payload;
  const view = new DataView(header.payload.buffer, header.payload.byteOffset, header.payload.byteLength);
  view.setUint32(0, view.getUint32(0, true) + units - 1, true);
  streams.set(body, deflateRawSync(encodeRecords(records)));
  const container = CFB.utils.cfb_new();
  for (const [stream, bytes] of streams) CFB.utils.cfb_add(container, stream, Buffer.from(bytes));
  return new Uint8Array(CFB.write(container, { type: 'buffer', fileType: 'cfb' }));
}
