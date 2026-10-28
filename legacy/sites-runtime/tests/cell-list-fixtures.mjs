/** Fixed synthetic compression-boundary fixture. Never reads a personal file. */
import { deflateRaw } from 'pako';
import { syntheticFixture } from '../../../src/one_hwp/synthetic_fixtures.mjs';
import { readCfb, readHwp, replaceAllocatedBodyStreams } from '../../../src/one_hwp/guard/container.mjs';
import { parseRecords } from '../../../src/one_hwp/guard/records.mjs';
import { encodeRecords } from '../../../tests/fixtures/page-number-fixtures.mjs';

function fixture(HwpDocument, api, rows, sourcePadding = false) {
  const cells = Array.from({ length: rows }, (_, i) => [
    `${i} 합성 질문`, `${i} 합성 답변 원문 가나다라마바사 ABC 0123456789`,
  ]);
  const candidate = syntheticFixture(HwpDocument, api.exportChecked,
    { paragraphs: ['합성 검증', '보존'], cells });
  const name = 'BodyText/Section0', decoded = readHwp(candidate);
  const patched = encodeRecords([...parseRecords(decoded.streams.get(name))].map((r) => {
    if (r.tag !== 72) return r;
    const payload = r.payload.slice(); payload[6] = 0; payload[7] = 0;
    return { ...r, payload };
  }));
  const preferred = deflateRaw(patched), fallback = deflateRaw(patched, { level: 9 });
  const allocated_packed_bytes = readCfb(candidate).get(name).length;
  // Boundary fixture only: HWP permits zero padding after raw DEFLATE. Supply
  // an originally padded input; production repair must NOT add padding to fit.
  const source = sourcePadding ? new Uint8Array(allocated_packed_bytes) : fallback;
  if (sourcePadding) source.set(fallback);
  return { candidate, preferred, fallback,
    bytes: replaceAllocatedBodyStreams(candidate, new Map([[name, source]])), allocated_packed_bytes };
}

export const compressionFallbackFixture = (HwpDocument, api) => fixture(HwpDocument, api, 8);
export const miniReleaseFixture = (HwpDocument, api) => fixture(HwpDocument, api, 39, true);

// Fixed, non-personal one-mini growth boundary: clear the third question cell.
// The deterministic ASCII answers avoid relying on a personal document's data.
export function miniGrowthFixture(HwpDocument, api) {
  let state = 12345;
  const token = () => {
    state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
    return String.fromCharCode(33 + state % 90);
  };
  const cells = Array.from({ length: 3 }, (_, i) => [
    `${i} 합성 질문`, `${i} 합성 답변 ` + Array.from({ length: 40 }, token).join(''),
  ]);
  const candidate = syntheticFixture(HwpDocument, api.exportChecked,
    { paragraphs: ['합성 검증', '보존'], cells });
  const name = 'BodyText/Section0';
  const patched = encodeRecords([...parseRecords(readHwp(candidate).streams.get(name))].map((r) => {
    if (r.tag !== 72) return r;
    const payload = r.payload.slice(); payload[6] = 0; payload[7] = 0;
    return { ...r, payload };
  }));
  return { bytes: replaceAllocatedBodyStreams(candidate, new Map([[name, deflateRaw(patched, { level: 9 })]])),
    target_block_index: 6 };
}
