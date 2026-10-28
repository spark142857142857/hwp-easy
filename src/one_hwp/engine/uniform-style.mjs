/** Proof only: one plain-text paragraph with one uniform raw shape anchor. */
import { parseRecords } from '../guard/records.mjs';
const view = (bytes) => new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);

export function rawUniformStyleProofs(decoded, blocks, mapping) {
  const selected = new Map(blocks.filter((b) => b.text.length > 2048 && b.text.isWellFormed()
    && !/[\u0000-\u001f]/.test(b.text)).map((b) => {
    const p = mapping.get(b.id); return [`${p?.section}:${p?.record_index}`, b];
  }));
  const proofs = new Map();
  if (!selected.size) return proofs;
  for (const section of decoded.profile.sections) {
    let ordinal = -1, active;
    const finish = () => {
      if (!active) return;
      const { header, children, block } = active, h = view(header.payload);
      const [text, shape, lines] = children;
      if (![22, 24].includes(header.payload.length) || children.length !== 3
        || h.getUint32(4, true) !== 0 || h.getUint16(12, true) !== 1 || h.getUint16(14, true) !== 0
        || text.tag !== 67 || shape.tag !== 68 || lines.tag !== 69
        || children.some((r) => r.level !== header.level + 1)
        || text.payload.length !== (block.text.length + 1) * 2
        || (h.getUint32(0, true) & 0x7fffffff) !== text.payload.length / 2
        || shape.payload.length !== 8 || view(shape.payload).getUint32(0, true) !== 0
        || !lines.payload.length || lines.payload.length % 36
        || h.getUint16(16, true) !== lines.payload.length / 36) return;
      const t = view(text.payload);
      if (t.getUint16(block.text.length * 2, true) !== 13) return;
      for (let i = 0; i < block.text.length; i++) if (t.getUint16(i * 2, true) !== block.text.charCodeAt(i)) return;
      proofs.set(block.id, view(shape.payload).getUint32(4, true));
    };
    for (const record of parseRecords(decoded.streams.get(`BodyText/Section${section.section}`))) {
      if (active && (record.tag === 66 || record.level <= active.header.level)) {
        // A nested paragraph cannot be part of the single plain envelope.
        if (record.level > active.header.level && active.children.length < 4) active.children.push(record);
        finish(); active = undefined;
      }
      if (record.tag === 66) {
        ordinal++;
        const block = selected.get(`${section.section}:${ordinal}`);
        if (block && record.level === (block.kind === 'paragraph' ? 0 : 2)) active = { header: record, children: [], block };
      } else if (active && active.children.length < 4) active.children.push(record);
    }
    finish();
  }
  return proofs;
}
