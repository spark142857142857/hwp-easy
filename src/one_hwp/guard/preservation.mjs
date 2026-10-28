/**
 * Browser-ESM port of native_engine.py's narrow raw-stream preservation guard.
 * Input Maps contain ALL CFB file streams, with BodyText AND DocInfo already
 * inflated. FileHeader and every other stream retain their original raw bytes.
 * CFB parsing, DEFLATE validation, content correctness, storage, authentication,
 * and layout certification remain outside this module and must not be inferred.
 */
import { GuardError, parseRecords, profileSections, requireStreamMap } from "./records.mjs";

const EMPTY = new Uint8Array();
const DOCINFO_LIMIT = 8 * 1024 * 1024;

function equalBytes(left, right) {
  if (left.byteLength !== right.byteLength) return false;
  for (let index = 0; index < left.byteLength; index += 1) {
    if (left[index] !== right[index]) return false;
  }
  return true;
}

/** Remove only visible UTF-16 units, retaining complete binary control slots. */
export function textControlBytes(payload) {
  if (!(payload instanceof Uint8Array)) throw new GuardError("INVALID_STREAM_BYTES");
  if (payload.byteLength % 2 !== 0) throw new GuardError("INVALID_TEXT_TAIL");
  const view = new DataView(payload.buffer, payload.byteOffset, payload.byteLength);
  let length = 0;
  let offset = 0;
  while (offset < payload.byteLength) {
    const code = view.getUint16(offset, true);
    const extended = (code >= 1 && code <= 9) || code === 11 || code === 12
      || (code >= 14 && code <= 23);
    const size = extended ? 16 : 2;
    if (size > payload.byteLength - offset) {
      throw new GuardError("TRUNCATED_TEXT_CONTROL");
    }
    if (code < 32) {
      length += size;
    }
    offset += size;
  }
  const result = new Uint8Array(length);
  let position = 0;
  offset = 0;
  // A second bounded scan avoids allocating one JS object per control slot.
  while (offset < payload.byteLength) {
    const code = view.getUint16(offset, true);
    const extended = (code >= 1 && code <= 9) || code === 11 || code === 12
      || (code >= 14 && code <= 23);
    const size = extended ? 16 : 2;
    if (code < 32) {
      result.set(payload.subarray(offset, offset + size), position);
      position += size;
    }
    offset += size;
  }
  return result;
}

function shapeIds(payload) {
  if (payload.byteLength % 8 !== 0) throw new GuardError("INVALID_CHAR_SHAPE_TAIL");
  const view = new DataView(payload.buffer, payload.byteOffset, payload.byteLength);
  // A typed array avoids the unbounded-per-entry object overhead of a JS Set.
  const ids = new Uint32Array(payload.byteLength / 8);
  for (let index = 0; index < ids.length; index += 1) {
    ids[index] = view.getUint32(index * 8 + 4, true);
  }
  ids.sort();
  let count = 0;
  for (let index = 0; index < ids.length; index += 1) {
    if (index === 0 || ids[index] !== ids[index - 1]) count += 1;
  }
  const result = new Uint8Array(count * 4);
  const output = new DataView(result.buffer);
  let position = 0;
  for (let index = 0; index < ids.length; index += 1) {
    if (index === 0 || ids[index] !== ids[index - 1]) {
      output.setUint32(position, ids[index], true);
      position += 4;
    }
  }
  return result;
}

/**
 * paragraphIndex is the zero-based tag-66 ordinal, not an envelope index.
 * Exceptions exactly mirror Python: all paragraph line counts/line geometry;
 * targeted low-31-bit text count, char-run count/positions, visible text only.
 * End-of-list bits, style IDs, controls, levels, order, and opaque tails survive.
 */
export function canonicalRecord(record, paragraphIndex, targets) {
  let payload = record.payload;
  const targeted = targets.has(paragraphIndex);
  if (record.tag === 66) {
    if (payload.byteLength < 22) throw new GuardError("INVALID_PARAGRAPH_HEADER");
    const copy = payload.slice();
    copy.fill(0, 16, 18);
    if (targeted) {
      const original = new DataView(payload.buffer, payload.byteOffset, payload.byteLength);
      const output = new DataView(copy.buffer, copy.byteOffset, copy.byteLength);
      output.setUint32(0, original.getUint32(0, true) & 0x80000000, true);
      copy.fill(0, 12, 14);
    }
    payload = copy;
  } else if (record.tag === 67 && targeted) {
    payload = textControlBytes(payload);
  } else if (record.tag === 68 && targeted) {
    payload = shapeIds(payload);
  } else if (record.tag === 69) {
    if (payload.byteLength % 36 !== 0) throw new GuardError("INVALID_LINE_SEGMENT_TAIL");
    payload = EMPTY;
  }
  return { tag: record.tag, level: record.level, payload };
}

function* canonicalRecords(bytes, targets) {
  let paragraph = -1;
  for (const record of parseRecords(bytes)) {
    if (record.tag === 66) paragraph += 1;
    yield canonicalRecord(record, paragraph, targets);
  }
}

function equalBody(before, after, targets) {
  const original = canonicalRecords(before, targets);
  const edited = canonicalRecords(after, targets);
  while (true) {
    const left = original.next();
    const right = edited.next();
    if (left.done || right.done) return left.done === right.done;
    if (left.value.tag !== right.value.tag || left.value.level !== right.value.level
        || !equalBytes(left.value.payload, right.value.payload)) return false;
  }
}

function canonicalDocInfo(bytes) {
  if (bytes.byteLength < 30 || bytes.byteLength > DOCINFO_LIMIT) {
    throw new GuardError("INVALID_DOCINFO_LAYOUT");
  }
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const header = view.getUint32(0, true);
  if ((header & 0x3ff) !== 16 || ((header >>> 10) & 0x3ff) !== 0
      || (header >>> 20) !== 26) {
    throw new GuardError("INVALID_DOCINFO_PROPERTIES");
  }
  const result = bytes.slice();
  result.fill(0, 18, 30); // Three saved-caret DWORDs, and nothing else.
  return result;
}

function operationTargets(operations, profile) {
  if (!Array.isArray(operations)) throw new GuardError("INVALID_OPERATIONS");
  const counts = new Map(profile.sections.map((item) => [item.section, item.paragraph_records]));
  const targets = new Map();
  for (const operation of operations) {
    if (operation === null || typeof operation !== "object" || Array.isArray(operation)
        || !Number.isSafeInteger(operation.section) || operation.section < 0
        || !Number.isSafeInteger(operation.record_index) || operation.record_index < 0
        || (Object.hasOwn(operation, "new_text") && typeof operation.new_text !== "string")) {
      throw new GuardError("INVALID_OPERATIONS");
    }
    if (!counts.has(operation.section) || operation.record_index >= counts.get(operation.section)) {
      throw new GuardError("INVALID_TARGET");
    }
    if (!targets.has(operation.section)) targets.set(operation.section, new Set());
    const sectionTargets = targets.get(operation.section);
    if (sectionTargets.has(operation.record_index)) throw new GuardError("DUPLICATE_TARGET");
    sectionTargets.add(operation.record_index);
  }
  return targets;
}

/**
 * Operation: {section, record_index, new_text?}. record_index is the zero-based
 * paragraph-header/tag-66 ordinal in that section (Python paragraph counter),
 * including table-cell paragraphs. The caller MUST independently validate the
 * engine block-to-ordinal mapping and the requested final visible text. This
 * guard deliberately permits arbitrary visible target text, not just new_text.
 * No stream names, values, or payloads are interpolated into errors or logs.
 */
export function verifyPreservation(beforeStreams, afterStreams, operations) {
  requireStreamMap(beforeStreams);
  requireStreamMap(afterStreams);
  if (beforeStreams.size !== afterStreams.size
      || [...beforeStreams.keys()].some((name) => !afterStreams.has(name))) {
    throw new GuardError("STREAM_SET_CHANGED");
  }
  for (const name of ["FileHeader", "DocInfo", "BodyText/Section0"]) {
    if (!beforeStreams.has(name)) throw new GuardError("REQUIRED_STREAM_MISSING");
  }
  const beforeProfile = profileSections(beforeStreams);
  const afterProfile = profileSections(afterStreams);
  if (beforeProfile.unsupported.length || afterProfile.unsupported.length) {
    throw new GuardError("UNSUPPORTED_BODY_RECORD");
  }
  const targets = operationTargets(operations, beforeProfile);
  for (const [name, before] of beforeStreams) {
    const top = name.split("/", 1)[0];
    if (top === "PrvText" || top === "PrvImage") continue;
    const after = afterStreams.get(name);
    let equal;
    if (name === "DocInfo") {
      equal = equalBytes(canonicalDocInfo(before), canonicalDocInfo(after));
    } else if (top === "BodyText") {
      const section = Number(name.slice("BodyText/Section".length));
      equal = equalBody(before, after, targets.get(section) ?? new Set());
    } else {
      equal = equalBytes(before, after);
    }
    if (!equal) throw new GuardError("PRESERVATION_MISMATCH");
  }
  return {
    verified: true,
    scope: "narrow_raw_record_preservation",
    text_verified: false,
    layout_verified: false,
  };
}
