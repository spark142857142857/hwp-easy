/** Target-only limits: existing text records and visible/raw style coverage. */
import { parseRecords } from '../guard/records.mjs';

export function rawTargetRestrictions(decoded, blocks, mapping, emptyCellProfiles = new Map(), mixedProfiles = new Map()) {
  const references = new Map();
  for (const section of decoded.profile.sections) {
    let paragraph = -1;
    for (const r of parseRecords(decoded.streams.get(`BodyText/Section${section.section}`))) {
      if (r.tag === 66) paragraph++;
      if (r.tag !== 67 && r.tag !== 68) continue;
      // Uniform targets require one visible/raw ID. Mixed targets need the
      // separate exact-anchor profile; collect only a uniform mismatch here.
      const key = `${section.section}:${paragraph}`, refs = references.get(key) ?? {
        records: 0, text_records: 0, first_id: undefined, mixed_ids: false, malformed: false,
      };
      if (r.tag === 67) refs.text_records++;
      else {
        refs.records++;
        if (!r.payload.length || r.payload.length % 8) refs.malformed = true;
        else {
          const v = new DataView(r.payload.buffer, r.payload.byteOffset, r.payload.byteLength);
          for (let offset = 4; offset < r.payload.length; offset += 8) {
            const id = v.getUint32(offset, true);
            if (refs.first_id === undefined) refs.first_id = id;
            else if (refs.first_id !== id) refs.mixed_ids = true;
          }
        }
      }
      references.set(key, refs);
    }
  }
  const restrictions = new Map();
  for (const block of blocks) {
    if (!block.editable) continue;
    const position = mapping.get(block.id), refs = references.get(`${position?.section}:${position?.record_index}`);
    const visible = block.style.char_shape_ids;
    let restriction;
    if (!refs || refs.records !== 1 || refs.malformed) restriction = {
      code: 'RAW_CHAR_SHAPE_LAYOUT_UNVERIFIED',
      message_ko: '글자 서식의 원본 구조를 확인하지 못해 이 문단은 읽기만 지원합니다.',
    };
    else if (!mixedProfiles.has(block.id) && (!Array.isArray(visible) || visible.length !== 1 || refs.mixed_ids || visible[0] !== refs.first_id)) restriction = {
      code: 'RAW_CHAR_SHAPE_REFS_UNCOVERED',
      message_ko: '텍스트 검사에 포함되지 않는 별도 글자 서식이 있어 이 문단은 읽기만 지원합니다.',
    };
    const items = restriction ? [restriction] : [];
    if (!refs || (refs.text_records !== 1 && !(refs.text_records === 0 && emptyCellProfiles.has(block.id)))) items.push({
      code: 'RAW_TEXT_RECORD_LAYOUT_UNVERIFIED',
      message_ko: '기존 텍스트 레코드 한 개를 교체하는 구조가 아니어서 이 문단은 읽기만 지원합니다.',
    });
    if (items.length) restrictions.set(block.id, items);
  }
  return restrictions;
}
