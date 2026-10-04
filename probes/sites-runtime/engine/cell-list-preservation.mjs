/** Pinned @rhwp/core 0.8.6 zero -> 0x0400 cell LIST_HEADER fallback only. */
import { deflateRaw } from 'pako';
import { readHwp, replaceAllocatedBodyStreams } from '../guard/container.mjs';
import { GuardError, parseRecords } from '../guard/records.mjs';

const fail = () => { throw new GuardError('PRESERVATION_MISMATCH'); };
const view = (bytes) => new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
const equal = (a, b) => a.length === b.length && a.every((value, index) => value === b[index]);

/**
 * No semantic interpretation/masking of this opaque word. For text-only edits,
 * match full record order and the complete unchanged cell header, prove original
 * coordinates/paragraph count against the model, then restore exactly two bytes.
 * All other differences remain for the mandatory whole-document raw guard.
 * Compression may use only the candidate's existing allocation. Reopen/model
 * comparison and raw verification are REQUIRED by the caller after this step.
 */
export function preserveZeroCellListWords(before, candidate, inspection) {
  const after = readHwp(candidate), replacements = new Map();
  let restored = 0;
  for (const section of before.profile.sections) {
    const name = `BodyText/Section${section.section}`, original = before.streams.get(name), saved = after.streams.get(name);
    if (!saved) fail();
    const left = [...parseRecords(original)], right = [...parseRecords(saved)];
    if (left.length !== right.length || left.some((r, index) => r.tag !== right[index].tag || r.level !== right[index].level)) fail();
    const cells = inspection.tables.filter((table) => table.section === section.section).flatMap((table) => table.cells);
    let cellIndex = 0, patched;
    for (let index = 0; index < left.length; index++) {
      const a = left[index], b = right[index];
      if (a.tag !== 72) continue;
      const cell = cells[cellIndex++];
      if (a.level !== 2 || !cell || a.payload.length < 34 || b.payload.length !== a.payload.length) fail();
      const av = view(a.payload);
      if (av.getUint16(0, true) !== cell.paragraph_ids.length
        || av.getUint16(8, true) !== cell.col || av.getUint16(10, true) !== cell.row
        || av.getUint16(12, true) !== cell.colSpan || av.getUint16(14, true) !== cell.rowSpan) fail();
      if (equal(a.payload, b.payload)) continue;
      if (av.getUint16(6, true) !== 0 || view(b.payload).getUint16(6, true) !== 0x0400
        || a.payload.some((value, offset) => offset !== 6 && offset !== 7 && value !== b.payload[offset])) fail();
      patched ??= saved.slice();
      const offset = b.payload.byteOffset - saved.byteOffset;
      patched.set(a.payload.subarray(6, 8), offset + 6);
      restored++;
    }
    if (cellIndex !== cells.length) fail();
    if (patched) {
      const compressed = view(before.streams.get('FileHeader')).getUint32(36, true) & 1;
      replacements.set(name, compressed ? deflateRaw(patched) : patched);
    }
  }
  return { bytes: replacements.size ? replaceAllocatedBodyStreams(candidate, replacements) : candidate,
    restored_cell_list_words: restored };
}
