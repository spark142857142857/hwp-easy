/** Narrow exception for adding text to an EXISTING empty cell paragraph.
 * No paragraph/cell/style/control creation. The projection is proof-only:
 * it is never serialized, stored, or returned as an edited document.
 */
import { GuardError, parseRecords } from './records.mjs';

const fail = () => { throw new GuardError('EMPTY_CELL_INSERTION_UNVERIFIED'); };
const view = (bytes) => new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);

export function emptyCellFillProfiles(decoded, blocks, mapping) {
  const eligible = new Map(blocks.filter((b) => b.kind === 'cell' && b.editable && b.text === '')
    .map((b) => [`${mapping.get(b.id)?.section}:${mapping.get(b.id)?.record_index}`, b]));
  const profiles = new Map();
  for (const { section } of decoded.profile.sections) {
    const bytes = decoded.streams.get(`BodyText/Section${section}`);
    let ordinal = -1, active;
    const finish = () => {
      if (!active) return;
      const { header, children, block, record_index } = active, h = view(header.payload);
      if ([22, 24].includes(header.payload.length) && (h.getUint32(0, true) & 0x7fffffff) === 1
        && h.getUint32(4, true) === 0 && h.getUint16(12, true) === 1
        && h.getUint16(14, true) === 0 && h.getUint16(16, true) === 1
        && children.length === 2 && children[0].tag === 68 && children[0].level === 3
        && children[0].payload.length === 8 && view(children[0].payload).getUint32(0, true) === 0
        && block.style.char_shape_ids.length === 1
        && view(children[0].payload).getUint32(4, true) === block.style.char_shape_ids[0]
        && children[1].tag === 69 && children[1].level === 3 && children[1].payload.length === 36) {
        profiles.set(block.id, { section, record_index, envelope_index: header.index,
          insert_offset: header.payload.byteOffset - bytes.byteOffset + header.payload.length });
      }
      active = undefined;
    };
    for (const record of parseRecords(bytes)) {
      if (active && record.level <= 2) finish();
      if (record.tag === 66) ordinal++;
      if (record.tag === 66 && record.level === 2) {
        const block = eligible.get(`${section}:${ordinal}`);
        if (block) active = { header: record, children: [], block, record_index: ordinal };
      } else if (active) {
        // Keep at most three descendants; any third record disqualifies it.
        if (active.children.length < 3) active.children.push(record);
      }
    }
    finish();
  }
  return profiles;
}

function requestedPayload(text) {
  if (typeof text !== 'string' || !text.length || !text.isWellFormed()
    || /[\u0000-\u001f]/.test(text) || text.length > 200000) fail();
  const bytes = new Uint8Array((text.length + 1) * 2), v = view(bytes);
  for (let i = 0; i < text.length; i++) v.setUint16(i * 2, text.charCodeAt(i), true);
  v.setUint16(text.length * 2, 13, true);
  return bytes;
}

function equal(left, right) {
  return left.length === right.length && left.every((byte, i) => byte === right[i]);
}

/** Prove EXACTLY the requested insertions before using the unchanged raw guard.
 * All other envelopes must still align; the raw guard then checks their bytes.
 * Profiles are internal, obtained from emptyCellFillProfiles for this snapshot.
 */
export function projectVerifiedEmptyCellInsertions(before, after, operations, profiles) {
  const bySection = new Map();
  if (!Array.isArray(operations) || operations.length > 100) fail();
  for (const operation of operations) {
    const profile = profiles.get(operation.target_id);
    if (!profile || operation.new_text === '') continue;
    if (!bySection.has(profile.section)) bySection.set(profile.section, new Map());
    const targets = bySection.get(profile.section);
    if (targets.has(profile.envelope_index)) fail();
    targets.set(profile.envelope_index, { ...profile, payload: requestedPayload(operation.new_text) });
  }
  const streams = new Map(before.streams);
  let count = 0;
  for (const [section, targets] of bySection) {
    const name = `BodyText/Section${section}`, original = before.streams.get(name);
    const candidate = after.streams.get(name), right = parseRecords(candidate);
    const offsets = [];
    for (const left of parseRecords(original)) {
      const current = right.next();
      if (current.done || left.tag !== current.value.tag || left.level !== current.value.level) fail();
      const target = targets.get(left.index);
      if (!target) continue;
      if (left.tag !== 66 || left.level !== 2
        || target.insert_offset !== left.payload.byteOffset - original.byteOffset + left.payload.length) fail();
      const inserted = right.next();
      if (inserted.done || inserted.value.tag !== 67 || inserted.value.level !== 3
        || !equal(inserted.value.payload, target.payload)) fail();
      offsets.push(target.insert_offset);
    }
    if (!right.next().done || offsets.length !== targets.size) fail();
    const projected = new Uint8Array(original.length + offsets.length * 6);
    let start = 0, position = 0;
    for (const offset of offsets) {
      projected.set(original.subarray(start, offset), position); position += offset - start;
      // Empty PARA_TEXT containing only the paragraph terminator (CR).
      view(projected).setUint32(position, 67 | (3 << 10) | (2 << 20), true);
      projected[position + 4] = 13; position += 6; start = offset;
    }
    projected.set(original.subarray(start), position);
    streams.set(name, projected); count += offsets.length;
  }
  return { streams, verified_insertions: count };
}
