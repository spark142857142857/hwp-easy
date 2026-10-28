// Before WASM parsing/layout: bound visible UTF-16 body text independently of
// compressed file size. This is a work limit, not target or layout validation.
import { GuardError, parseRecords } from './records.mjs';
export const MAX_RAW_BODY_TEXT_CODE_UNITS = 2000000;

export function enforceRawTextBudget(decoded) {
  let units = 0;
  for (const section of decoded.profile.sections) {
    for (const record of parseRecords(decoded.streams.get(`BodyText/Section${section.section}`))) {
      if (record.tag !== 67) continue;
      const payload = record.payload;
      // Leave malformed text recognition to the existing mapping/engine path.
      // Count only complete UTF-16 units; never read beyond this payload.
      const view = new DataView(payload.buffer, payload.byteOffset, payload.byteLength);
      for (let offset = 0; offset + 2 <= payload.length;) {
        const code = view.getUint16(offset, true);
        const extended = (code >= 1 && code <= 9) || code === 11 || code === 12 || (code >= 14 && code <= 23);
        const width = extended ? 16 : 2;
        if (offset + width > payload.length) break;
        if (code >= 32 || code === 9 || code === 10) units++;
        if (units > MAX_RAW_BODY_TEXT_CODE_UNITS) throw new GuardError('RAW_TEXT_LIMIT_EXCEEDED');
        offset += width;
      }
    }
  }
  return units;
}
