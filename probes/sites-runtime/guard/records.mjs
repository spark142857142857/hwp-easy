/**
 * Narrow HWP 5 body-envelope scanner, independent of the WASM document model.
 * Browser ESM only: the caller supplies already-inflated stream bytes. This is
 * not a CFB reader, a DEFLATE codec, a document writer, or a layout validator.
 */

export class GuardError extends Error {
  constructor(code) {
    super(code);
    this.name = "GuardError";
    this.code = code;
  }
}

export const DEFAULT_LIMITS = Object.freeze({
  maxExpandedBytes: 64 * 1024 * 1024,
  maxRecords: 1_000_000,
  maxUnsupportedRecords: 1024,
});

// Valid-format recognition does not imply edit support. In particular, tag 70
// is deliberately outside the Python engine's verified preservation subset.
const BODY_TAGS = new Set([66, 67, 68, 69, 71, 72, 73, 74, 75, 77]);

export function requireStreamMap(streams) {
  if (!(streams instanceof Map)) throw new GuardError("INVALID_STREAM_MAP");
  for (const [name, bytes] of streams) {
    if (typeof name !== "string" || name.length === 0) {
      throw new GuardError("INVALID_STREAM_MAP");
    }
    if (!(bytes instanceof Uint8Array)) {
      throw new GuardError("INVALID_STREAM_BYTES");
    }
  }
}

function resolveLimits(options) {
  if (options === undefined) return DEFAULT_LIMITS;
  if (options === null || typeof options !== "object" || Array.isArray(options)) {
    throw new GuardError("INVALID_LIMITS");
  }
  const limits = { ...DEFAULT_LIMITS };
  for (const [key, value] of Object.entries(options)) {
    if (!Object.hasOwn(DEFAULT_LIMITS, key) || !Number.isSafeInteger(value)
        || value < 0 || value > DEFAULT_LIMITS[key]) {
      throw new GuardError("INVALID_LIMITS");
    }
    limits[key] = value;
  }
  return limits;
}

/**
 * Yield checked record envelopes and payload views without copying a document.
 * index is the all-record envelope ordinal, NOT the paragraph target ordinal.
 * Header width (short/extended) is intentionally not part of canonical equality.
 */
export function* parseRecords(bytes) {
  if (!(bytes instanceof Uint8Array)) throw new GuardError("INVALID_STREAM_BYTES");
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  let position = 0;
  let index = 0;
  while (position < bytes.byteLength) {
    if (bytes.byteLength - position < 4) {
      throw new GuardError("TRUNCATED_RECORD_HEADER");
    }
    const header = view.getUint32(position, true);
    position += 4;
    const tag = header & 0x3ff;
    const level = (header >>> 10) & 0x3ff;
    let size = header >>> 20;
    if (size === 0xfff) {
      if (bytes.byteLength - position < 4) {
        throw new GuardError("TRUNCATED_RECORD_SIZE");
      }
      size = view.getUint32(position, true);
      position += 4;
    }
    if (size > bytes.byteLength - position) {
      throw new GuardError("TRUNCATED_RECORD_PAYLOAD");
    }
    const payload = bytes.subarray(position, position + size);
    position += size;
    yield { tag, level, size, index, payload };
    index += 1;
  }
}

/**
 * Accept a whole-stream Map or a BodyText-only Map. BodyText bytes must already
 * be inflated. Warnings contain envelope metadata only, never opaque payloads.
 * Empty section sets match the Python scanner; a full-document caller must
 * independently require FileHeader, DocInfo, and BodyText/Section0.
 * Optional limits may only LOWER the Python limits, never enlarge them.
 */
export function profileSections(streams, options) {
  requireStreamMap(streams);
  const limits = resolveLimits(options);
  const sections = [];
  const unsupported = [];
  let expandedBytes = 0;
  let recordCount = 0;
  let paragraphCount = 0;

  for (const [name, bytes] of streams) {
    if (name.split("/", 1)[0] !== "BodyText") continue;
    const match = /^BodyText\/Section([0-9]+)$/.exec(name);
    const section = match === null ? NaN : Number(match[1]);
    if (!Number.isSafeInteger(section)) throw new GuardError("INVALID_BODY_LAYOUT");
    if (bytes.byteLength > limits.maxExpandedBytes - expandedBytes) {
      throw new GuardError("BODY_BYTES_LIMIT");
    }
    expandedBytes += bytes.byteLength;
    let sectionParagraphs = 0;
    let sectionRecords = 0;
    for (const record of parseRecords(bytes)) {
      recordCount += 1;
      sectionRecords += 1;
      if (recordCount > limits.maxRecords) throw new GuardError("BODY_RECORD_LIMIT");
      if (record.tag === 66) {
        paragraphCount += 1;
        sectionParagraphs += 1;
      }
      if (!BODY_TAGS.has(record.tag)) {
        if (unsupported.length >= limits.maxUnsupportedRecords) {
          throw new GuardError("UNSUPPORTED_RECORD_LIMIT");
        }
        unsupported.push({
          kind: "body_record",
          section,
          record_tag: record.tag,
          record_level: record.level,
          reason: "Record is outside the verified content/preservation profile",
        });
      }
    }
    sections.push({
      section,
      paragraph_records: sectionParagraphs,
      record_count: sectionRecords,
      expanded_bytes: bytes.byteLength,
    });
  }
  sections.sort((left, right) => left.section - right.section);
  if (sections.some((item, index) => item.section !== index)) {
    throw new GuardError("INCOMPLETE_SECTIONS");
  }
  return {
    unsupported,
    paragraph_records: paragraphCount,
    record_count: recordCount,
    expanded_bytes: expandedBytes,
    sections,
  };
}
