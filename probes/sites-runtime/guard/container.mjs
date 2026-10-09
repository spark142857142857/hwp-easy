// Independent CFB/HWP reader and narrow body repair. No rhwp model, filesystem or network.
import { ZStream, zlibInflateInit2, zlibInflate, zlibInflateEnd, Z_NO_FLUSH,
  Z_OK, Z_STREAM_END } from 'pako';
import { GuardError, profileSections } from './records.mjs';
const FREE = 0xffffffff, END = 0xfffffffe, FAT = 0xfffffffd, DIF = 0xfffffffc;
const defaults = Object.freeze({ maxDocumentBytes: 4 * 1024 * 1024,
  maxBodyBytes: 8 * 1024 * 1024, maxDocInfoBytes: 2 * 1024 * 1024,
  maxDirectoryEntries: 2048, maxPathChars: 65536 });
const fail = (code = 'invalid_cfb') => { throw new GuardError(code); };
// Only a mismatch found in this validated container can carry size feedback.
// Never expose arbitrary error fields or document/stream names to the host.
const allocationFailures = new WeakMap();
export function bodyRepairAllocationDiagnostic(error) {
  const diagnostic = allocationFailures.get(error);
  return diagnostic ? { ...diagnostic } : undefined;
}
function allocationFailure(input, original, layout, replacement) {
  const candidateMini = original.length < 4096, repairedMini = replacement.length < 4096;
  const repairedUnit = repairedMini ? 64
    : 2 ** new DataView(input.buffer, input.byteOffset, input.byteLength).getUint16(30, true);
  const error = new GuardError('BODY_REPAIR_ALLOCATION_UNSUPPORTED');
  allocationFailures.set(error, Object.freeze({
    scope: 'candidate_body_stream_allocation',
    reason: candidateMini === repairedMini ? 'allocation_count_changed' : 'storage_class_changed',
    candidate_storage_class: candidateMini ? 'mini' : 'regular',
    repaired_storage_class: repairedMini ? 'mini' : 'regular',
    candidate_unit_bytes: layout.unit, repaired_unit_bytes: repairedUnit,
    candidate_units: layout.locations.length, repaired_units: Math.ceil(replacement.length / repairedUnit),
    candidate_stream_bytes: original.length, repaired_stream_bytes: replacement.length,
  }));
  throw error;
}
const equal = (a, b) => a.length === b.length && a.every((x, i) => x === b[i]);
const join = (parts, size) => {
  const result = new Uint8Array(size); let offset = 0;
  for (const part of parts) { const n = Math.min(part.length, size - offset); result.set(part.subarray(0, n), offset); offset += n; }
  if (offset !== size) fail();
  return result;
};
function boundedOptions(options) {
  if (!options || typeof options !== 'object' || Array.isArray(options)) fail('invalid_limits');
  const result = { ...defaults };
  for (const [key, value] of Object.entries(options)) {
    if (!Object.hasOwn(defaults, key) || !Number.isSafeInteger(value) || value < 0 || value > defaults[key]) fail('invalid_limits');
    result[key] = value;
  }
  return result;
}

// RFC 1952 CRC32, over bounded inflated bytes. No authenticity claim.
const crcTable = Uint32Array.from({ length: 256 }, (_, value) => {
  for (let bit = 0; bit < 8; bit++) value = (value >>> 1) ^ ((value & 1) ? 0xedb88320 : 0);
  return value >>> 0;
});
function crc32(bytes) {
  let crc = 0xffffffff;
  for (const byte of bytes) crc = (crc >>> 8) ^ crcTable[(crc ^ byte) & 0xff];
  return (crc ^ 0xffffffff) >>> 0;
}

export function inflateBoundedRaw(input, limit, { allowZeroPadding = true } = {}) {
  if (!(input instanceof Uint8Array) || !Number.isSafeInteger(limit) || limit < 0
    || limit > defaults.maxBodyBytes) fail('invalid_limits');
  const stream = new ZStream();
  if (zlibInflateInit2(stream, -15) !== Z_OK) fail('inflate_unavailable');
  stream.input = input; stream.next_in = 0; stream.avail_in = input.length;
  let total = 0; const chunks = [];
  try {
    while (true) {
      const previousInput = stream.next_in;
      const output = new Uint8Array(Math.min(16384, limit - total + 1));
      stream.output = output; stream.next_out = 0; stream.avail_out = output.length;
      const status = zlibInflate(stream, Z_NO_FLUSH);
      total += stream.next_out;
      if (total > limit) fail('expanded_limit');
      if (stream.next_out) chunks.push(output.subarray(0, stream.next_out));
      if (status === Z_STREAM_END) {
        const tail = input.subarray(stream.next_in);
        const expanded = join(chunks, total);
        // Observed HWP raw-DEFLATE variant: exactly CRC32 + ISIZE, no gzip
        // header. Validate both fields; never ignore an arbitrary 8-byte tail.
        const trailer = tail.length === 8 ? new DataView(tail.buffer, tail.byteOffset, 8) : null;
        const verifiedTrailer = trailer && trailer.getUint32(4, true) === total
          && trailer.getUint32(0, true) === crc32(expanded);
        if (tail.length && !verifiedTrailer
          && !(allowZeroPadding && !tail.some((value) => value !== 0))) fail('compressed_tail');
        return expanded;
      }
      if (status !== Z_OK || (stream.next_in === previousInput && stream.next_out === 0)) fail('invalid_deflate');
    }
  } catch (error) {
    if (error instanceof GuardError) throw error;
    fail('invalid_deflate');
  } finally { zlibInflateEnd(stream); }
}

function parseCfb(input, options = {}, captureLayout = false) {
  const limits = boundedOptions(options);
  if (!(input instanceof Uint8Array) || input.length > limits.maxDocumentBytes || input.length < 512) fail('input_limit');
  const view = new DataView(input.buffer, input.byteOffset, input.byteLength);
  const u16 = (p) => view.getUint16(p, true), u32 = (p) => view.getUint32(p, true);
  const zero = (start, end) => !input.subarray(start, end).some((x) => x !== 0);
  if (!equal(input.subarray(0, 8), Uint8Array.of(208, 207, 17, 224, 161, 177, 26, 225))) fail();
  const major = u16(26), shift = u16(30), sectorSize = 2 ** shift;
  if (!zero(8, 24) || ![3, 4].includes(major) || shift !== (major === 3 ? 9 : 12)
    || u16(28) !== 0xfffe || u16(32) !== 6 || !zero(34, 40) || u32(56) !== 4096
    || (major === 3 && u32(40) !== 0) || !zero(512, sectorSize)
    || input.length % sectorSize !== 0 || input.length < sectorSize * 3) fail();
  const sectorCount = input.length / sectorSize - 1, owners = new Uint8Array(sectorCount);
  const validSid = (id) => Number.isInteger(id) && id >= 0 && id < sectorCount;
  const claim = (id, role) => { if (!validSid(id) || owners[id]) fail('cfb_chain_invalid'); owners[id] = role; };
  const sector = (id) => {
    if (!validSid(id)) fail('cfb_chain_invalid');
    return input.subarray((id + 1) * sectorSize, (id + 2) * sectorSize);
  };
  const sectorU32 = (id, position) => new DataView(input.buffer, input.byteOffset + (id + 1) * sectorSize, sectorSize).getUint32(position, true);
  const fatCount = u32(44), difCount = u32(72), miniCount = u32(64);
  if (!fatCount || fatCount > sectorCount || difCount > sectorCount || miniCount > sectorCount) fail('cfb_chain_invalid');
  const fatIds = [], difIds = [];
  const addFat = (id) => { if (id !== FREE) { if (!validSid(id) || fatIds.length >= fatCount) fail('cfb_chain_invalid'); claim(id, 1); fatIds.push(id); } };
  for (let p = 76; p < 512; p += 4) addFat(u32(p));
  let difSid = u32(68);
  for (let n = 0; n < difCount; n++) {
    claim(difSid, 2); difIds.push(difSid);
    for (let p = 0; p < sectorSize - 4; p += 4) addFat(sectorU32(difSid, p));
    difSid = sectorU32(difSid, sectorSize - 4);
  }
  if (difSid !== END || fatIds.length !== fatCount || fatCount * sectorSize / 4 < sectorCount) fail('cfb_chain_invalid');
  const nextFat = (id) => {
    if (!validSid(id)) fail('cfb_chain_invalid');
    const index = Math.floor(id / (sectorSize / 4));
    return sectorU32(fatIds[index], (id % (sectorSize / 4)) * 4);
  };
  for (const id of fatIds) if (nextFat(id) !== FAT) fail('cfb_chain_invalid');
  for (const id of difIds) if (nextFat(id) !== DIF) fail('cfb_chain_invalid');
  const chain = (first, role, expected = undefined) => {
    const ids = []; let id = first;
    while (id !== END) {
      if (ids.length >= sectorCount || (expected !== undefined && ids.length >= expected)) fail('cfb_chain_invalid');
      claim(id, role); ids.push(id); id = nextFat(id);
    }
    if (expected !== undefined && ids.length !== expected) fail('cfb_chain_invalid');
    return ids;
  };
  const directoryIds = chain(u32(48), 3, major === 4 ? u32(40) : undefined);
  if (!directoryIds.length || directoryIds.length * sectorSize / 128 > limits.maxDirectoryEntries) fail('directory_limit');
  const directory = join(directoryIds.map(sector), directoryIds.length * sectorSize);
  const entries = [], dv = new DataView(directory.buffer);
  for (let p = 0; p < directory.length; p += 128) {
    const type = directory[p + 66];
    if (type === 0) { entries.push(null); continue; }
    const length = dv.getUint16(p + 64, true);
    if (![1, 2, 5].includes(type) || length < 4 || length > 64 || length % 2
      || directory[p + 67] > 1 || dv.getUint16(p + length - 2, true) !== 0) fail();
    let name = '';
    for (let offset = 0; offset < length - 2; offset += 2) {
      const unit = dv.getUint16(p + offset, true);
      if (unit === 0 || unit === 47 || unit === 92 || unit === 58 || unit === 33) fail();
      name += String.fromCharCode(unit);
    }
    // CFB v3 readers MUST ignore high DWORD, including uninitialized bytes.
    const size = dv.getUint32(p + 120, true) + (major === 4 ? dv.getUint32(p + 124, true) * 2 ** 32 : 0);
    if (!Number.isSafeInteger(size) || size > limits.maxDocumentBytes) fail('stream_limit');
    entries.push({ name, type, directoryOffset: p, left: dv.getUint32(p + 68, true), right: dv.getUint32(p + 72, true),
      child: dv.getUint32(p + 76, true), first: dv.getUint32(p + 116, true), size });
  }
  const root = entries[0];
  if (!root || root.type !== 5 || root.name !== 'Root Entry' || root.left !== FREE || root.right !== FREE) fail();
  const rootIds = chain(root.first, 5, Math.ceil(root.size / sectorSize));
  const miniRoot = join(rootIds.map(sector), root.size);
  const miniIds = chain(u32(60), 4, miniCount), miniFat = join(miniIds.map(sector), miniCount * sectorSize);
  const miniView = new DataView(miniFat.buffer), miniOwners = new Uint8Array(Math.ceil(miniRoot.length / 64));
  const streams = new Map(), layouts = new Map(), names = new Set(), visited = new Set([0]);
  let pathChars = 0;
  const stack = root.child === FREE ? [] : [[root.child, '']];
  while (stack.length) {
    const [index, parent] = stack.pop();
    if (index === FREE) continue;
    if (!Number.isInteger(index) || index >= entries.length || visited.has(index)) fail('directory_invalid');
    visited.add(index); const entry = entries[index];
    if (!entry || entry.type === 5) fail('directory_invalid');
    if (stack.length > limits.maxDirectoryEntries * 2) fail('directory_limit');
    const pathLength = parent.length + entry.name.length;
    pathChars += pathLength;
    if (pathLength > 2048 || pathChars > limits.maxPathChars) fail('directory_limit');
    const path = parent + entry.name, folded = path.toUpperCase();
    // This intentionally conservative duplicate policy is not the complete
    // CFB Unicode ordering/RB-tree validator. Case-fold expansions may reject.
    if (names.has(folded)) fail('directory_invalid');
    names.add(folded);
    stack.push([entry.right, parent], [entry.left, parent]);
    if (entry.type === 1) {
      if (entry.child !== FREE) stack.push([entry.child, path + '/']);
      continue;
    }
    if (entry.child !== FREE) fail('directory_invalid');
    let content, locations, miniSectorIds;
    if (entry.size >= 4096) {
      const ids = chain(entry.first, 6, Math.ceil(entry.size / sectorSize));
      content = join(ids.map(sector), entry.size);
      if (captureLayout) locations = ids.map((id) => (id + 1) * sectorSize);
    }
    else {
      const parts = []; let id = entry.first;
      if (captureLayout) { locations = []; miniSectorIds = []; }
      while (id !== END) {
        if (parts.length >= Math.ceil(entry.size / 64) || id >= miniOwners.length || miniOwners[id]
          || id * 4 + 4 > miniFat.length || (id + 1) * 64 > miniRoot.length) fail('mini_chain_invalid');
        miniOwners[id] = 1; parts.push(miniRoot.subarray(id * 64, (id + 1) * 64));
        if (captureLayout) {
          locations.push((rootIds[Math.floor(id * 64 / sectorSize)] + 1) * sectorSize + id * 64 % sectorSize);
          miniSectorIds.push(id);
        }
        id = miniView.getUint32(id * 4, true);
      }
      if (parts.length !== Math.ceil(entry.size / 64)) fail('mini_chain_invalid');
      content = join(parts, entry.size);
    }
    streams.set(path, content);
    if (captureLayout) layouts.set(path, { locations, miniSectorIds, unit: entry.size >= 4096 ? sectorSize : 64,
      sizeOffset: (directoryIds[Math.floor(entry.directoryOffset / sectorSize)] + 1) * sectorSize
        + entry.directoryOffset % sectorSize + 120 });
  }
  for (let index = 1; index < entries.length; index++) if (entries[index] && !visited.has(index)) fail('directory_invalid');
  return { streams, layouts, miniLayout: captureLayout ? {
    rootSize: root.size, rootCapacity: rootIds.length * sectorSize,
    rootSizeOffset: (directoryIds[0] + 1) * sectorSize + 120,
    sectorOffset: (id) => (rootIds[Math.floor(id * 64 / sectorSize)] + 1) * sectorSize + id * 64 % sectorSize,
    fatEntryOffset: (id) => id * 4 + 4 <= miniFat.length
      ? (miniIds[Math.floor(id * 4 / sectorSize)] + 1) * sectorSize + id * 4 % sectorSize : undefined,
  } : undefined };
}

export function readCfb(input, options = {}) {
  return parseCfb(input, options).streams;
}

/**
 * Narrow, allocation-preserving BodyText replacement. Never adds/removes a
 * stream, changes FAT/miniFAT/directory trees, or reallocates sectors. Used only
 * after a known writer defect is matched; this is NOT a general CFB writer.
 * A changed allocation count/storage class is rejected without touching input.
 */
export function replaceAllocatedBodyStreams(input, replacements) {
  if (!(replacements instanceof Map) || !replacements.size || replacements.size > 64) fail('BODY_REPAIR_INVALID');
  const { streams, layouts } = parseCfb(input, {}, true);
  for (const [name, bytes] of replacements) {
    if (typeof name !== 'string' || !/^BodyText\/Section(?:0|[1-9]\d*)$/.test(name)
      || !(bytes instanceof Uint8Array) || !bytes.length) fail('BODY_REPAIR_INVALID');
    const original = streams.get(name), layout = layouts.get(name);
    if (!original || !layout) fail('BODY_REPAIR_ALLOCATION_UNSUPPORTED');
    if ((bytes.length >= 4096) !== (original.length >= 4096)
      || Math.ceil(bytes.length / layout.unit) !== layout.locations.length) allocationFailure(input, original, layout, bytes);
  }
  const output = new Uint8Array(input), view = new DataView(output.buffer, output.byteOffset, output.byteLength);
  for (const [name, bytes] of replacements) {
    const { locations, unit, sizeOffset } = layouts.get(name);
    locations.forEach((offset, index) => {
      output.fill(0, offset, offset + unit);
      output.set(bytes.subarray(index * unit, (index + 1) * unit), offset);
    });
    view.setUint32(sizeOffset, bytes.length, true);
  }
  const checked = readCfb(output);
  if (streams.size !== checked.size || [...streams].some(([name, original]) =>
    !checked.has(name) || !equal(replacements.get(name) ?? original, checked.get(name)))) fail('BODY_REPAIR_INVALID');
  return output;
}

/**
 * Explicit adapter-only fallback: append ONE 64-byte mini sector in already
 * allocated, zero-filled mini-stream tail space. No file/FAT/root-chain growth,
 * stream relocation, shrink, class transition, free-hole reuse or padding.
 * The default exact-allocation writer above deliberately remains unchanged.
 */
export function replaceBodyStreamsWithMiniTailGrowth(input, replacements) {
  let originalFailure;
  try { return { bytes: replaceAllocatedBodyStreams(input, replacements), body_mini_sector_growth: 0 }; }
  catch (error) {
    if (!bodyRepairAllocationDiagnostic(error)) throw error;
    originalFailure = error;
  }
  const reject = () => { throw originalFailure; };
  const { streams, layouts, miniLayout } = parseCfb(input, {}, true);
  let growing;
  for (const [name, bytes] of replacements) {
    if (typeof name !== 'string' || !/^BodyText\/Section(?:0|[1-9]\d*)$/.test(name)
      || !(bytes instanceof Uint8Array) || !bytes.length) fail('BODY_REPAIR_INVALID');
    const original = streams.get(name), layout = layouts.get(name);
    if (!original || !layout) reject();
    if ((bytes.length >= 4096) === (original.length >= 4096)
      && Math.ceil(bytes.length / layout.unit) === layout.locations.length) continue;
    if (growing || layout.unit !== 64 || bytes.length >= 4096
      || Math.ceil(bytes.length / 64) !== layout.locations.length + 1 || !layout.miniSectorIds?.length) reject();
    growing = { name, layout };
  }
  if (!growing || miniLayout.rootSize % 64 || miniLayout.rootSize + 64 > miniLayout.rootCapacity) reject();
  const id = miniLayout.rootSize / 64, tailOffset = miniLayout.sectorOffset(id);
  const newFatOffset = miniLayout.fatEntryOffset(id);
  const oldTail = growing.layout.miniSectorIds.at(-1), oldFatOffset = miniLayout.fatEntryOffset(oldTail);
  const sourceView = new DataView(input.buffer, input.byteOffset, input.byteLength);
  if (newFatOffset === undefined || oldFatOffset === undefined
    || sourceView.getUint32(miniLayout.rootSizeOffset + 4, true) !== 0
    || sourceView.getUint32(growing.layout.sizeOffset + 4, true) !== 0
    || sourceView.getUint32(newFatOffset, true) !== FREE || sourceView.getUint32(oldFatOffset, true) !== END
    || input.subarray(tailOffset, tailOffset + 64).some((byte) => byte !== 0)) reject();
  const output = new Uint8Array(input), view = new DataView(output.buffer);
  const allowed = new Uint8Array(input.length), permit = (offset, length) => allowed.fill(1, offset, offset + length);
  for (const [name, bytes] of replacements) {
    const layout = layouts.get(name), locations = name === growing.name ? [...layout.locations, tailOffset] : layout.locations;
    locations.forEach((offset, index) => {
      permit(offset, layout.unit); output.fill(0, offset, offset + layout.unit);
      output.set(bytes.subarray(index * layout.unit, (index + 1) * layout.unit), offset);
    });
    permit(layout.sizeOffset, 4); view.setUint32(layout.sizeOffset, bytes.length, true);
  }
  permit(oldFatOffset, 4); view.setUint32(oldFatOffset, id, true);
  permit(newFatOffset, 4); view.setUint32(newFatOffset, END, true);
  permit(miniLayout.rootSizeOffset, 4); view.setUint32(miniLayout.rootSizeOffset, miniLayout.rootSize + 64, true);
  // Whole-container byte check supplements the independent stream reparse:
  // every byte outside the exact body data/size and three metadata DWORDs stays.
  if (input.some((byte, index) => byte !== output[index] && !allowed[index])) fail('BODY_REPAIR_INVALID');
  const checked = parseCfb(output, {}, true);
  if (streams.size !== checked.streams.size || [...streams].some(([name, original]) =>
    !checked.streams.has(name) || !equal(replacements.get(name) ?? original, checked.streams.get(name)))) fail('BODY_REPAIR_INVALID');
  for (const [name, layout] of layouts) {
    const after = checked.layouts.get(name), expectedLocations = name === growing.name ? [...layout.locations, tailOffset] : layout.locations;
    if (!after || after.unit !== layout.unit || after.sizeOffset !== layout.sizeOffset
      || !equal(expectedLocations, after.locations)) fail('BODY_REPAIR_INVALID');
  }
  if (checked.miniLayout.rootSize !== miniLayout.rootSize + 64
    || checked.miniLayout.rootCapacity !== miniLayout.rootCapacity) fail('BODY_REPAIR_INVALID');
  return { bytes: output, body_mini_sector_growth: 1 };
}

/** Adapter-only extension: release ONE last mini sector of ONE body chain.
 * Keep file/FAT/root allocation, directory tree and every other stream fixed.
 * No class transition, stream relocation, arbitrary shrink or free-hole reuse.
 * The exact writer and growth-only entry point keep their original contracts.
 */
export function replaceBodyStreamsWithMiniTailAdjustment(input, replacements) {
  let originalFailure;
  try {
    return { ...replaceBodyStreamsWithMiniTailGrowth(input, replacements), body_mini_sector_release: 0 };
  } catch (error) {
    if (!bodyRepairAllocationDiagnostic(error)) throw error;
    originalFailure = error;
  }
  const reject = () => { throw originalFailure; };
  const { streams, layouts, miniLayout } = parseCfb(input, {}, true);
  let shrinking;
  for (const [name, bytes] of replacements) {
    const original = streams.get(name), layout = layouts.get(name);
    if (!original || !layout) reject();
    if ((bytes.length >= 4096) === (original.length >= 4096)
      && Math.ceil(bytes.length / layout.unit) === layout.locations.length) continue;
    if (shrinking || layout.unit !== 64 || bytes.length >= 4096 || bytes.length === 0
      || layout.locations.length < 2 || Math.ceil(bytes.length / 64) !== layout.locations.length - 1
      || layout.miniSectorIds?.length !== layout.locations.length) reject();
    shrinking = { name, layout };
  }
  if (!shrinking) reject();
  const ids = shrinking.layout.miniSectorIds;
  const keptTail = ids.at(-2), releasedTail = ids.at(-1);
  const keptFatOffset = miniLayout.fatEntryOffset(keptTail), releasedFatOffset = miniLayout.fatEntryOffset(releasedTail);
  const sourceView = new DataView(input.buffer, input.byteOffset, input.byteLength);
  if (keptFatOffset === undefined || releasedFatOffset === undefined
    || sourceView.getUint32(shrinking.layout.sizeOffset + 4, true) !== 0
    || sourceView.getUint32(keptFatOffset, true) !== releasedTail
    || sourceView.getUint32(releasedFatOffset, true) !== END) reject();
  const output = new Uint8Array(input), view = new DataView(output.buffer);
  const allowed = new Uint8Array(input.length), permit = (offset, length) => allowed.fill(1, offset, offset + length);
  for (const [name, bytes] of replacements) {
    const { locations, unit, sizeOffset } = layouts.get(name);
    locations.forEach((offset, index) => {
      permit(offset, unit); output.fill(0, offset, offset + unit);
      output.set(bytes.subarray(index * unit, (index + 1) * unit), offset);
    });
    permit(sizeOffset, 4); view.setUint32(sizeOffset, bytes.length, true);
  }
  permit(keptFatOffset, 4); view.setUint32(keptFatOffset, END, true);
  permit(releasedFatOffset, 4); view.setUint32(releasedFatOffset, FREE, true);
  if (input.some((byte, index) => byte !== output[index] && !allowed[index])) fail('BODY_REPAIR_INVALID');
  const checked = parseCfb(output, {}, true);
  if (streams.size !== checked.streams.size || [...streams].some(([name, original]) =>
    !checked.streams.has(name) || !equal(replacements.get(name) ?? original, checked.streams.get(name)))) fail('BODY_REPAIR_INVALID');
  for (const [name, layout] of layouts) {
    const after = checked.layouts.get(name), expectedLocations = name === shrinking.name ? layout.locations.slice(0, -1) : layout.locations;
    if (!after || after.unit !== layout.unit || after.sizeOffset !== layout.sizeOffset
      || !equal(expectedLocations, after.locations)) fail('BODY_REPAIR_INVALID');
  }
  if (checked.miniLayout.rootSize !== miniLayout.rootSize
    || checked.miniLayout.rootCapacity !== miniLayout.rootCapacity) fail('BODY_REPAIR_INVALID');
  return { bytes: output, body_mini_sector_growth: 0, body_mini_sector_release: 1 };
}

export function readHwp(input, options = {}) {
  const limits = boundedOptions(options), streams = readCfb(input, options), header = streams.get('FileHeader');
  const signature = new TextEncoder().encode('HWP Document File\0');
  if (!header || header.length < 40 || !equal(header.subarray(0, signature.length), signature)
    || header[35] !== 5 || !streams.has('DocInfo') || !streams.has('BodyText/Section0')) fail('unsupported_hwp');
  const flags = new DataView(header.buffer, header.byteOffset).getUint32(36, true);
  if (flags & ~1) fail('unsupported_hwp_flags');
  let bodyBytes = 0;
  for (const [name, bytes] of streams) {
    if (name === 'DocInfo' || name.startsWith('BodyText/')) {
      const limit = name === 'DocInfo' ? limits.maxDocInfoBytes : limits.maxBodyBytes - bodyBytes;
      const raw = flags & 1 ? inflateBoundedRaw(bytes, limit, { allowZeroPadding: name !== 'DocInfo' }) : bytes;
      if (raw.length > limit) fail('expanded_limit');
      if (name !== 'DocInfo') bodyBytes += raw.length;
      streams.set(name, raw);
    }
  }
  return { streams, profile: profileSections(streams, { maxExpandedBytes: limits.maxBodyBytes, maxRecords: 100000 }) };
}
