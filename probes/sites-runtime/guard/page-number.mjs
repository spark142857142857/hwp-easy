/** Narrow preservation-only exception, not semantic reading or pgnp editing.
 * HWP 5.0 revision 1.3 tables 127, 147/148: CTRL_HEADER has a four-byte ID
 * followed by twelve bytes of page-number-position data. All bytes are opaque
 * to the editor and must pass the separate before/after preservation guard.
 */
import { parseRecords } from './records.mjs';

const id = (bytes, offset = 0) => String.fromCharCode(...bytes.subarray(offset, offset + 4).toReversed());
const view = (bytes) => new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);

export function pageNumberPreservationProfile(decoded, unsupported) {
  const controls = unsupported.filter((item) => item.kind === 'control' && item.control_id === 'pgnp');
  // getControls list coordinates are verified here only for one root section.
  // Other sections/lists remain conservative until separately covered.
  if (decoded.profile.sections.length !== 1) {
    if (controls.length) return null;
    for (const { section } of decoded.profile.sections) {
      for (const record of parseRecords(decoded.streams.get(`BodyText/Section${section}`))) {
        if (record.tag === 71 && id(record.payload) === 'pgnp') return null;
      }
    }
    return [];
  }
  if (controls.some((item) => item.list !== 0 || !Number.isSafeInteger(item.paragraph) || item.paragraph < 0)) return null;
  const anchors = new Map(), headers = new Map();
  let root = -1, level = -1, previousPageNumber = false;
  const count = (map, key) => map.set(key, (map.get(key) ?? 0) + 1);
  // Stream the bounded envelopes; do not retain an object for every record.
  for (const record of parseRecords(decoded.streams.get('BodyText/Section0'))) {
    if (previousPageNumber && record.level > 1) return null;
    previousPageNumber = false;
    if (record.tag === 66) {
      level = record.level;
      if (level === 0) root++;
    }
    if (record.tag === 71 && id(record.payload) === 'pgnp') {
      if (root < 0 || level !== 0 || record.level !== 1 || record.payload.length !== 16) return null;
      const bytes = view(record.payload), attributes = bytes.getUint32(4, true);
      // Reserved bits and unknown position/number formats are NOT relaxed.
      // Character decoration bytes are not decoded or rewritten.
      if ((attributes & 0xfffff000) || (attributes & 255) > 16
        || ((attributes >>> 8) & 15) > 10 || bytes.getUint16(14, true) !== 45) return null;
      count(headers, root);
      previousPageNumber = true;
    }
    if (record.tag !== 67) continue;
    if (record.payload.length % 2) return null;
    const bytes = view(record.payload);
    for (let offset = 0; offset < record.payload.length;) {
      const code = bytes.getUint16(offset, true);
      const extended = (code >= 1 && code <= 9) || code === 11 || code === 12 || (code >= 14 && code <= 23);
      const width = extended ? 16 : 2;
      if (offset + width > record.payload.length) return null;
      if (extended && id(record.payload, offset + 2) === 'pgnp') {
        if (level !== 0 || record.level !== 1 || root < 0 || code !== 21
          || bytes.getUint16(offset + 14, true) !== 21
          || record.payload.subarray(offset + 6, offset + 14).some((byte) => byte !== 0)) return null;
        count(anchors, root);
      }
      offset += width;
    }
  }
  const modeled = new Map();
  for (const control of controls) count(modeled, control.paragraph);
  if (headers.size !== modeled.size || anchors.size !== modeled.size
    || [...modeled].some(([paragraph, total]) => headers.get(paragraph) !== total || anchors.get(paragraph) !== total)) return null;
  return controls.map((control) => ({ control_id: 'pgnp', section: 0, paragraph: control.paragraph,
    edit_mode: 'preserve_bytes_only', semantic_read_supported: false }));
}
