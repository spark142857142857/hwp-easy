// Additional admission/proof for the positional mixed-style exception. The
// common preservation canonicalizer still handles every other record/stream.
import { GuardError, parseRecords } from '../guard/records.mjs';
const equal = (a, b) => a.length === b.length && a.every((v, i) => v === b[i]);
function targetRecords(decoded, positions) {
  const found = new Map();
  for (const section of decoded.profile.sections) {
    let ordinal = -1;
    for (const record of parseRecords(decoded.streams.get(`BodyText/Section${section.section}`))) {
      if (record.tag === 66) ordinal++;
      const key = `${section.section}:${ordinal}`;
      if (!positions.has(key) || (record.tag !== 67 && record.tag !== 68)) continue;
      const item = found.get(key) ?? { texts: [], shapes: [] };
      const list = item[record.tag === 67 ? 'texts' : 'shapes'];
      // Two entries suffice to reject duplicates without collecting all of them.
      if (list.length < 2) list.push(record);
      found.set(key, item);
    }
  }
  return found;
}
function rawStylesMatch(block, item) {
  if (item?.texts.length !== 1 || item.shapes.length !== 1) return false;
  const text = item.texts[0].payload, shape = item.shapes[0].payload;
  if (text.length % 2 || !shape.length || shape.length % 8 || shape.length / 8 > 64) return false;
  const tv = new DataView(text.buffer, text.byteOffset, text.byteLength);
  if (!text.length || tv.getUint16(text.length - 2, true) !== 13) return false;
  const sv = new DataView(shape.buffer, shape.byteOffset, shape.byteLength);
  const entries = [], ids = new Set(block.style.char_shape_ids);
  for (let i = 0; i < shape.length; i += 8) {
    const position = sv.getUint32(i, true), id = sv.getUint32(i + 4, true);
    if ((!i && position !== 0) || (i && position <= entries.at(-1).position)
      || position >= text.length / 2 || !ids.has(id)) return false;
    entries.push({ position, id });
  }
  let entry = 0, active, point = 0, run = 0;
  for (let position = 0; position < text.length / 2;) {
    if (entries[entry]?.position < position) return false; // inside a slot/pair
    if (entries[entry]?.position === position) active = entries[entry++].id;
    const code = tv.getUint16(position * 2, true);
    const extended = (code >= 1 && code <= 9) || code === 11 || code === 12 || (code >= 14 && code <= 23);
    if (extended) { if (position + 8 > text.length / 2) return false; position += 8; continue; }
    if (code === 13) { if (position !== text.length / 2 - 1) return false; position++; continue; }
    if (code < 32 || (code >= 0xdc00 && code <= 0xdfff)) return false;
    while (block.style.char_runs[run]?.end <= point) run++;
    if (active !== block.style.char_runs[run]?.char_shape_id) return false;
    if (code >= 0xd800 && code <= 0xdbff) {
      if (position + 1 >= text.length / 2) return false;
      const low = tv.getUint16((position + 1) * 2, true);
      if (low < 0xdc00 || low > 0xdfff) return false;
      position += 2;
    } else position++;
    point++;
  }
  return entry === entries.length && point === block.style.char_runs.at(-1).end;
}
export function mixedStyleProfiles(decoded, blocks, mapping) {
  const selected = blocks.filter(b => b.editable && b.style.char_runs);
  if (!selected.length) return new Map();
  const positions = new Set(selected.map(b => {
    const p = mapping.get(b.id); return `${p.section}:${p.record_index}`;
  }));
  const records = targetRecords(decoded, positions), profiles = new Map();
  for (const block of selected) {
    const p = mapping.get(block.id), key = `${p.section}:${p.record_index}`, item = records.get(key);
    if (rawStylesMatch(block, item)) profiles.set(block.id, { ...p, shape: item.shapes[0].payload.slice(), level: item.shapes[0].level });
  }
  return profiles;
}
export function verifyMixedStylePreservation(after, operations, profiles) {
  const selected = operations.filter(o => profiles.has(o.target_id));
  if (!selected.length) return;
  const positions = new Set(selected.map(o => { const p = profiles.get(o.target_id); return `${p.section}:${p.record_index}`; }));
  const records = targetRecords(after, positions);
  for (const operation of selected) {
    const p = profiles.get(operation.target_id), item = records.get(`${p.section}:${p.record_index}`);
    if (item?.shapes.length !== 1 || item.shapes[0].level !== p.level || !equal(item.shapes[0].payload, p.shape)) {
      throw new GuardError('PRESERVATION_MISMATCH');
    }
  }
}
