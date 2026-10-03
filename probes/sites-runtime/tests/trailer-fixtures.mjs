/** Developer-only synthetic HWP mutation; never import a user path here. */
import { gzipSync, inflateRawSync } from 'node:zlib';

export function withCheckedDeflateTrailers(bytes) {
  // Extend only existing stream padding; retain the engine-produced CFB tree,
  // metadata and stream set. A third-party CFB rewrite is a different profile.
  // Use only Node's stdlib so root Python integration needs no probe npm deps.
  const output = new Uint8Array(bytes), view = new DataView(output.buffer);
  const u32 = (offset) => view.getUint32(offset, true);
  const set32 = (offset, value) => view.setUint32(offset, value, true);
  const size = 2 ** view.getUint16(30, true), END = 0xfffffffe;
  if (size !== 512 || view.getUint16(26, true) !== 3 || u32(44) > 109 || u32(72) !== 0) {
    throw new Error('synthetic_fixture_profile');
  }
  const sectorOffset = (sid) => (sid + 1) * size;
  const next = (sid) => u32(sectorOffset(u32(76 + Math.floor(sid / (size / 4)) * 4)) + (sid % (size / 4)) * 4);
  const chain = (first) => {
    const sectors = [];
    for (let sid = first; sid !== END; sid = next(sid)) {
      if (sectors.length >= output.length / size) throw new Error('synthetic_chain');
      sectors.push(sid);
    }
    return sectors;
  };
  const directories = chain(u32(48)), rootOffset = sectorOffset(directories[0]);
  const miniRoot = chain(u32(rootOffset + 116)), miniFat = chain(u32(60));
  const miniOffset = (sid) => sectorOffset(miniRoot[Math.floor(sid * 64 / size)]) + sid * 64 % size;
  const readMiniStream = (offset, length) => {
    if (!length || length >= 4096) throw new Error('synthetic_fixture_profile');
    const locations = [];
    for (let sid = u32(offset + 116); sid !== END;) {
      locations.push(miniOffset(sid));
      const fatByte = sid * 4;
      sid = u32(sectorOffset(miniFat[Math.floor(fatByte / size)]) + fatByte % size);
      if (locations.length > Math.ceil(length / 64)) throw new Error('synthetic_mini_chain');
    }
    if (locations.length !== Math.ceil(length / 64)) throw new Error('synthetic_mini_chain');
    const packed = new Uint8Array(length);
    for (let index = 0; index < length; index++) packed[index] = output[locations[Math.floor(index / 64)] + index % 64];
    return { packed, locations };
  };
  const seen = new Set();
  for (const sector of directories) {
    for (let slot = 0; slot < size; slot += 128) {
      const offset = sectorOffset(sector) + slot;
      if (output[offset + 66] !== 2) continue;
      const nameLength = view.getUint16(offset + 64, true);
      const name = new TextDecoder('utf-16le').decode(output.subarray(offset, offset + nameLength - 2));
      const length = u32(offset + 120);
      if (name === 'FileHeader') {
        const { packed } = readMiniStream(offset, length);
        if (length < 40 || new DataView(packed.buffer).getUint32(36, true) !== 1) {
          throw new Error('synthetic_fixture_profile');
        }
        seen.add(name);
        continue;
      }
      const path = name === 'DocInfo' ? name : /^Section\d+$/.test(name) ? 'BodyText/' + name : null;
      if (!path) continue;
      if (Math.ceil((length + 8) / 64) !== Math.ceil(length / 64)) {
        throw new Error('synthetic_fixture_padding');
      }
      const { packed, locations } = readMiniStream(offset, length);
      const inflated = inflateRawSync(packed, { info: true });
      if (inflated.engine.bytesWritten !== length) throw new Error('synthetic_existing_tail');
      const trailer = gzipSync(inflated.buffer).subarray(-8);
      for (let index = 0; index < trailer.length; index++) {
        const position = length + index;
        output[locations[Math.floor(position / 64)] + position % 64] = trailer[index];
      }
      set32(offset + 120, length + 8);
      seen.add(path);
    }
  }
  if (!['FileHeader', 'DocInfo', 'BodyText/Section0'].every((path) => seen.has(path))) {
    throw new Error('synthetic_fixture_profile');
  }
  return output;
}
