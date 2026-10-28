/** Developer-only synthetic record writer. Never accepts a user document path. */
import { deflateRawSync } from 'node:zlib';
import { readHwp } from '../../src/one_hwp/guard/container.mjs';
import { parseRecords } from '../../src/one_hwp/guard/records.mjs';

export function encodeRecords(records) {
  const parts = records.map(({ tag, level, payload }) => {
    const wide = payload.length >= 4095, bytes = new Uint8Array((wide ? 8 : 4) + payload.length);
    const view = new DataView(bytes.buffer);
    view.setUint32(0, tag | (level << 10) | ((wide ? 4095 : payload.length) << 20), true);
    if (wide) view.setUint32(4, payload.length, true);
    bytes.set(payload, wide ? 8 : 4);
    return bytes;
  });
  const output = new Uint8Array(parts.reduce((size, part) => size + part.length, 0));
  let offset = 0;
  for (const part of parts) { output.set(part, offset); offset += part.length; }
  return output;
}

export function rewriteSyntheticBody(bytes, rewrite) {
  // Retain the engine-generated CFB tree/metadata/streams. A third-party CFB
  // rewrite changes its preservation profile. Only use existing mini padding.
  const decoded = readHwp(bytes);
  const packed = deflateRawSync(encodeRecords(rewrite([...parseRecords(decoded.streams.get('BodyText/Section0'))])));
  const output = new Uint8Array(bytes), view = new DataView(output.buffer);
  const u32 = (offset) => view.getUint32(offset, true), size = 512, END = 0xfffffffe;
  if (view.getUint16(30, true) !== 9 || u32(72) !== 0 || u32(44) > 109
    || new DataView(decoded.streams.get('FileHeader').buffer).getUint32(36, true) !== 1) throw new Error('synthetic_fixture_profile');
  const sector = (sid) => (sid + 1) * size;
  const next = (sid) => u32(sector(u32(76 + Math.floor(sid / 128) * 4)) + (sid % 128) * 4);
  const chain = (first) => {
    const found = [];
    for (let sid = first; sid !== END; sid = next(sid)) {
      if (found.length >= output.length / size) throw new Error('synthetic_chain');
      found.push(sid);
    }
    return found;
  };
  const directories = chain(u32(48)), root = sector(directories[0]);
  const miniRoot = chain(u32(root + 116)), miniFat = chain(u32(60));
  const miniOffset = (sid) => sector(miniRoot[Math.floor(sid / 8)]) + sid % 8 * 64;
  for (const directory of directories) {
    for (let slot = 0; slot < size; slot += 128) {
      const entry = sector(directory) + slot;
      if (output[entry + 66] !== 2) continue;
      const name = new TextDecoder('utf-16le').decode(output.subarray(entry, entry + view.getUint16(entry + 64, true) - 2));
      if (name !== 'Section0') continue;
      const length = u32(entry + 120), locations = [];
      if (length >= 4096 || Math.ceil(length / 64) !== Math.ceil(packed.length / 64)) throw new Error('synthetic_fixture_padding');
      for (let sid = u32(entry + 116); sid !== END;) {
        locations.push(miniOffset(sid));
        sid = u32(sector(miniFat[Math.floor(sid / 128)]) + sid % 128 * 4);
        if (locations.length > Math.ceil(length / 64)) throw new Error('synthetic_mini_chain');
      }
      if (locations.length !== Math.ceil(length / 64)) throw new Error('synthetic_mini_chain');
      for (let index = 0; index < locations.length * 64; index++) output[locations[Math.floor(index / 64)] + index % 64] = packed[index] ?? 0;
      view.setUint32(entry + 120, packed.length, true);
      return output;
    }
  }
  throw new Error('synthetic_section_missing');
}

export function withPageNumber(bytes, { paragraph = 0, position = 5, numberFormat = 0,
  userSymbol = 0, prefix = 45, suffix = 45 } = {}) {
  return rewriteSyntheticBody(bytes, (records) => {
    let root = -1, inserted = false;
    const anchor = new Uint8Array(16), anchorView = new DataView(anchor.buffer);
    anchorView.setUint16(0, 21, true); anchorView.setUint16(14, 21, true);
    anchor.set(new TextEncoder().encode('pngp'), 2);
    const payload = new Uint8Array(16), properties = new DataView(payload.buffer);
    payload.set(new TextEncoder().encode('pngp'));
    properties.setUint32(4, numberFormat | (position << 8), true);
    [userSymbol, prefix, suffix, 45].forEach((value, index) => properties.setUint16(8 + index * 2, value, true));
    const output = [];
    for (const original of records) {
      let record = original;
      if (record.tag === 66 && record.level === 0) {
        root++;
        if (root === paragraph) {
          const header = record.payload.slice(), view = new DataView(header.buffer);
          view.setUint32(0, view.getUint32(0, true) + 8, true);
          view.setUint32(4, view.getUint32(4, true) | (1 << 21), true);
          record = { ...record, payload: header };
        }
      }
      if (root === paragraph && record.tag === 67 && record.level === 1) {
        const text = new Uint8Array(anchor.length + record.payload.length);
        text.set(anchor); text.set(record.payload, anchor.length);
        record = { ...record, payload: text };
      }
      if (root === paragraph && record.tag === 71 && record.level === 1 && !inserted) {
        output.push({ tag: 71, level: 1, payload }); inserted = true;
      }
      // A paragraph without other controls ends before the next root header.
      if (root > paragraph && !inserted) {
        output.push({ tag: 71, level: 1, payload }); inserted = true;
      }
      output.push(record);
    }
    if (!inserted) output.push({ tag: 71, level: 1, payload });
    return output;
  });
}
