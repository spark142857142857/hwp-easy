// Independent read-only CFB/HWP adapter. No rhwp model, filesystem or network.
import { ZStream, zlibInflateInit2, zlibInflate, zlibInflateEnd, Z_NO_FLUSH,
  Z_OK, Z_STREAM_END } from 'pako';
import { GuardError, profileSections } from './records.mjs';
const FREE = 0xffffffff, END = 0xfffffffe, FAT = 0xfffffffd, DIF = 0xfffffffc;
const defaults = Object.freeze({ maxDocumentBytes: 4 * 1024 * 1024,
  maxBodyBytes: 8 * 1024 * 1024, maxDocInfoBytes: 2 * 1024 * 1024,
  maxDirectoryEntries: 2048, maxPathChars: 65536 });
const fail = (code = 'invalid_cfb') => { throw new GuardError(code); };
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
        if (allowZeroPadding ? tail.some((value) => value !== 0) : tail.length !== 0) fail('compressed_tail');
        return join(chunks, total);
      }
      if (status !== Z_OK || (stream.next_in === previousInput && stream.next_out === 0)) fail('invalid_deflate');
    }
  } catch (error) {
    if (error instanceof GuardError) throw error;
    fail('invalid_deflate');
  } finally { zlibInflateEnd(stream); }
}

export function readCfb(input, options = {}) {
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
    entries.push({ name, type, left: dv.getUint32(p + 68, true), right: dv.getUint32(p + 72, true),
      child: dv.getUint32(p + 76, true), first: dv.getUint32(p + 116, true), size });
  }
  const root = entries[0];
  if (!root || root.type !== 5 || root.name !== 'Root Entry' || root.left !== FREE || root.right !== FREE) fail();
  const rootIds = chain(root.first, 5, Math.ceil(root.size / sectorSize));
  const miniRoot = join(rootIds.map(sector), root.size);
  const miniIds = chain(u32(60), 4, miniCount), miniFat = join(miniIds.map(sector), miniCount * sectorSize);
  const miniView = new DataView(miniFat.buffer), miniOwners = new Uint8Array(Math.ceil(miniRoot.length / 64));
  const streams = new Map(), names = new Set(), visited = new Set([0]);
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
    let content;
    if (entry.size >= 4096) content = join(chain(entry.first, 6, Math.ceil(entry.size / sectorSize)).map(sector), entry.size);
    else {
      const parts = []; let id = entry.first;
      while (id !== END) {
        if (parts.length >= Math.ceil(entry.size / 64) || id >= miniOwners.length || miniOwners[id]
          || id * 4 + 4 > miniFat.length || (id + 1) * 64 > miniRoot.length) fail('mini_chain_invalid');
        miniOwners[id] = 1; parts.push(miniRoot.subarray(id * 64, (id + 1) * 64)); id = miniView.getUint32(id * 4, true);
      }
      if (parts.length !== Math.ceil(entry.size / 64)) fail('mini_chain_invalid');
      content = join(parts, entry.size);
    }
    streams.set(path, content);
  }
  for (let index = 1; index < entries.length; index++) if (entries[index] && !visited.has(index)) fail('directory_invalid');
  return streams;
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
