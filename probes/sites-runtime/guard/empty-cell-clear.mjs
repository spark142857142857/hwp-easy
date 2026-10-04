/** Clear only plain text in an existing cell; never remove a cell or paragraph. */
import { parseRecords } from './records.mjs';

const view = (bytes) => new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
function plainText(payload, text) {
  if (!text.length || !text.isWellFormed() || /[\u0000-\u001f]/.test(text)
    || payload.length !== (text.length + 1) * 2) return false;
  const v = view(payload);
  for (let i = 0; i < text.length; i++) if (v.getUint16(i * 2, true) !== text.charCodeAt(i)) return false;
  return v.getUint16(text.length * 2, true) === 13;
}

export function cellTextClearProfiles(decoded, blocks, mapping) {
  const eligible = new Map(blocks.filter((b) => b.kind === 'cell' && b.editable && b.text !== '')
    .map((b) => [`${mapping.get(b.id)?.section}:${mapping.get(b.id)?.record_index}`, b]));
  const profiles = new Map();
  for (const { section } of decoded.profile.sections) {
    const bytes = decoded.streams.get(`BodyText/Section${section}`);
    let ordinal = -1, active;
    const finish = () => {
      if (!active) return;
      const { header, children, block, record_index } = active, h = view(header.payload);
      const [text, shape, lines] = children;
      if ([22, 24].includes(header.payload.length) && h.getUint32(4, true) === 0
        && h.getUint16(12, true) === 1 && h.getUint16(14, true) === 0
        && children.length === 3 && text.tag === 67 && text.level === 3
        && plainText(text.payload, block.text)
        && (h.getUint32(0, true) & 0x7fffffff) === text.payload.length / 2
        && shape.tag === 68 && shape.level === 3 && shape.payload.length === 8
        && view(shape.payload).getUint32(0, true) === 0 && block.style.char_shape_ids.length === 1
        && view(shape.payload).getUint32(4, true) === block.style.char_shape_ids[0]
        && lines.tag === 69 && lines.level === 3 && lines.payload.length > 0
        && lines.payload.length % 36 === 0 && h.getUint16(16, true) === lines.payload.length / 36) {
        profiles.set(block.id, { section, record_index, envelope_index: header.index,
          text_envelope_index: text.index,
          remove_start: header.payload.byteOffset - bytes.byteOffset + header.payload.length,
          remove_end: text.payload.byteOffset - bytes.byteOffset + text.payload.length });
      }
      active = undefined;
    };
    for (const record of parseRecords(bytes)) {
      if (active && record.level <= 2) finish();
      if (record.tag === 66) ordinal++;
      if (record.tag === 66 && record.level === 2) {
        const block = eligible.get(`${section}:${ordinal}`);
        if (block) active = { header: record, children: [], block, record_index: ordinal };
      } else if (active && active.children.length < 4) active.children.push(record);
    }
    finish();
  }
  return profiles;
}
