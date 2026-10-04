/** Fixed synthetic compression-boundary fixture. Never reads a personal file. */
import { deflateRaw } from 'pako';
import { syntheticFixture } from '../../../src/one_hwp/synthetic_fixtures.mjs';
import { readCfb, readHwp, replaceAllocatedBodyStreams } from '../guard/container.mjs';
import { parseRecords } from '../guard/records.mjs';
import { encodeRecords } from './page-number-fixtures.mjs';

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
  // Negative fixture only: HWP permits zero padding after raw DEFLATE. Supply
  // an originally padded input; production repair must NOT add padding to fit.
  const source = sourcePadding ? new Uint8Array(allocated_packed_bytes) : fallback;
  if (sourcePadding) source.set(fallback);
  return { candidate, preferred, fallback,
    bytes: replaceAllocatedBodyStreams(candidate, new Map([[name, source]])), allocated_packed_bytes };
}

export const compressionFallbackFixture = (HwpDocument, api) => fixture(HwpDocument, api, 8);
export const compressionRejectedFixture = (HwpDocument, api) => fixture(HwpDocument, api, 39, true);
