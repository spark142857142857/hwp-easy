/** Narrow text-record transitions in EXISTING cell paragraphs.
 * No paragraph/cell/style/control creation. The projection is proof-only:
 * it is never serialized, stored, or returned as an edited document.
 */
import { GuardError, parseRecords } from './records.mjs';

const fail = () => { throw new GuardError('EMPTY_CELL_INSERTION_UNVERIFIED'); };
const clearFail = () => { throw new GuardError('CELL_TEXT_REMOVAL_UNVERIFIED'); };
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
  return projectVerifiedCellTextTransitions(before, after, operations, profiles, new Map());
}

/** Source-only proof projection: add empty CR records for verified fills and
 * remove precisely the old plain-text record for verified clears. All other
 * source bytes are unchanged; the original strict guard remains mandatory.
 */
export function projectVerifiedCellTextTransitions(before, after, operations, profiles, clearProfiles) {
  const bySection = new Map();
  if (!Array.isArray(operations) || operations.length > 100) fail();
  for (const operation of operations) {
    const filling = profiles.get(operation.target_id), clearing = clearProfiles.get(operation.target_id);
    const profile = operation.new_text === '' ? clearing : filling;
    if (!profile) continue;
    if (!bySection.has(profile.section)) bySection.set(profile.section, new Map());
    const targets = bySection.get(profile.section);
    if (targets.has(profile.envelope_index)) fail();
    targets.set(profile.envelope_index, { ...profile, clear: operation.new_text === '',
      ...(operation.new_text === '' ? {} : { payload: requestedPayload(operation.new_text) }) });
  }
  const streams = new Map(before.streams);
  let count = 0, removals = 0;
  for (const [section, targets] of bySection) {
    const name = `BodyText/Section${section}`, original = before.streams.get(name);
    const candidate = after.streams.get(name), right = parseRecords(candidate);
    const reject = [...targets.values()].some((target) => target.clear) ? clearFail : fail;
    const changes = [], leftRecords = parseRecords(original);
    for (const left of leftRecords) {
      const current = right.next();
      if (current.done || left.tag !== current.value.tag || left.level !== current.value.level) reject();
      const target = targets.get(left.index);
      if (!target) continue;
      if (left.tag !== 66 || left.level !== 2) reject();
      const boundary = left.payload.byteOffset - original.byteOffset + left.payload.length;
      if (target.clear) {
        const removed = leftRecords.next();
        if (removed.done || removed.value.tag !== 67 || removed.value.level !== 3
          || removed.value.index !== target.text_envelope_index || target.remove_start !== boundary
          || target.remove_end !== removed.value.payload.byteOffset - original.byteOffset + removed.value.payload.length) clearFail();
        // The next normal pair must be the original char-shape envelope. An
        // after PARA_TEXT (even empty CR) or another unexpected record fails.
        changes.push({ start: target.remove_start, end: target.remove_end, insert: false }); removals++;
        continue;
      }
      if (target.insert_offset !== boundary) fail();
      const inserted = right.next();
      if (inserted.done || inserted.value.tag !== 67 || inserted.value.level !== 3
        || !equal(inserted.value.payload, target.payload)) fail();
      changes.push({ start: target.insert_offset, end: target.insert_offset, insert: true }); count++;
    }
    if (!right.next().done || changes.length !== targets.size) reject();
    const projected = new Uint8Array(original.length + changes.reduce((n, c) => n + (c.insert ? 6 : c.start - c.end), 0));
    let start = 0, position = 0;
    for (const change of changes) {
      projected.set(original.subarray(start, change.start), position); position += change.start - start;
      // Empty PARA_TEXT containing only the paragraph terminator (CR).
      if (change.insert) {
        view(projected).setUint32(position, 67 | (3 << 10) | (2 << 20), true);
        projected[position + 4] = 13; position += 6;
      }
      start = change.end;
    }
    projected.set(original.subarray(start), position);
    streams.set(name, projected);
  }
  return { streams, verified_insertions: count, verified_removals: removals };
}
