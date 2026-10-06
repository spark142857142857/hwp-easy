// Describes the existing admission decisions. This report never grants editing
// permission or replaces exact-old-value, serialization and preservation checks.
const messages = Object.freeze({
  TARGET_MAPPING_UNVERIFIED: '원문과 조회 대상의 대응을 확인하지 못해 문서 편집을 지원하지 않습니다.',
  DOCUMENT_EDIT_PROFILE_UNSUPPORTED: '문서에 현재 지원하지 않는 구조가 있어 문서 편집을 지원하지 않습니다.',
  TABLE_HOST_PARAGRAPH: '표가 들어 있는 본문 문단은 읽기 전용입니다. 표 셀은 따로 확인합니다.',
  PAGE_NUMBER_HOST_PARAGRAPH: '페이지 번호가 들어 있는 문단은 번호 보존을 위해 읽기 전용입니다.',
  MIXED_CHAR_STYLES: '여러 글자 서식이 섞인 문단은 읽기 전용입니다.',
  TARGET_EDIT_LIMIT_EXCEEDED: '이 문단은 한 대상의 편집 길이 한도를 넘어 읽기 전용입니다.',
  EXISTING_LINE_BREAKS_NOT_EDITABLE: '기존 줄바꿈을 포함한 문단은 읽기 전용입니다.',
  STYLE_SCAN_LIMIT_EXCEEDED: '글자 서식을 확인하는 처리 범위를 넘어 읽기 전용입니다.',
  RAW_CHAR_SHAPE_LAYOUT_UNVERIFIED: '글자 서식의 원본 구조를 확인하지 못해 읽기 전용입니다.',
  RAW_CHAR_SHAPE_REFS_UNCOVERED: '텍스트 검사에 포함되지 않는 별도 글자 서식이 있어 읽기 전용입니다.',
  RAW_TEXT_RECORD_LAYOUT_UNVERIFIED: '기존 텍스트 레코드 한 개를 교체하는 구조가 아니어서 읽기 전용입니다.',
  TARGET_READ_ONLY: '이 대상은 현재 지원하는 편집 범위에 포함되지 않습니다.',
});
const profiles = Object.freeze({ edit_limit_exceeded: 'TARGET_EDIT_LIMIT_EXCEEDED',
  existing_line_breaks_not_editable: 'EXISTING_LINE_BREAKS_NOT_EDITABLE',
  style_scan_limit_exceeded: 'STYLE_SCAN_LIMIT_EXCEEDED' });

export function describeEditability({ blocks, tables, preservedControls, mappingVerified,
  editableProfile, documentProfileSupported, restrictions, emptyCellProfiles, clearCellProfiles }) {
  const tableHosts = new Set(tables.map(t => `s${t.section}:p${t.paragraph}`));
  const pageHosts = new Set(preservedControls.map(c => `s${c.section}:p${c.paragraph}`));
  const targets = new Map(), reasons = new Map();
  const summary = { scope: 'whole_document_supported_blocks', total_blocks: blocks.length,
    body_paragraphs: 0, cell_paragraphs: 0, replacement_candidates: 0,
    body_replacement_candidates: 0, cell_replacement_candidates: 0,
    empty_cell_fill_candidates: 0, cell_text_clear_candidates: 0, read_only_blocks: 0,
    candidate_requires_serialization_preflight: true, serialization_checked: false,
    storage_checked: false, layout_verified: false };
  for (const block of blocks) {
    const editable = editableProfile && block.editable && !restrictions.has(block.id);
    const fill = editable && emptyCellProfiles.has(block.id), clear = editable && clearCellProfiles.has(block.id);
    const codes = new Set();
    if (!editable) {
      if (!mappingVerified) codes.add('TARGET_MAPPING_UNVERIFIED');
      if (!documentProfileSupported) codes.add('DOCUMENT_EDIT_PROFILE_UNSUPPORTED');
      if (block.kind === 'paragraph' && tableHosts.has(block.id)) codes.add('TABLE_HOST_PARAGRAPH');
      if (block.kind === 'paragraph' && pageHosts.has(block.id)) codes.add('PAGE_NUMBER_HOST_PARAGRAPH');
      if (block.style?.profile) codes.add(profiles[block.style.profile] ?? 'TARGET_READ_ONLY');
      if ((block.style?.char_shape_ids?.length ?? 0) > 1) codes.add('MIXED_CHAR_STYLES');
      for (const item of restrictions.get(block.id) ?? []) {
        codes.add(Object.hasOwn(messages, item.code) ? item.code : 'TARGET_READ_ONLY');
      }
      if (!codes.size) codes.add('TARGET_READ_ONLY');
    }
    targets.set(block.id, { editable: Boolean(editable), empty_cell_fill_supported: Boolean(fill),
      cell_text_clear_supported: Boolean(clear), read_only_reasons: [...codes].map(code => ({ code, message_ko: messages[code] })) });
    summary[block.kind === 'cell' ? 'cell_paragraphs' : 'body_paragraphs']++;
    if (editable) {
      summary.replacement_candidates++;
      summary[block.kind === 'cell' ? 'cell_replacement_candidates' : 'body_replacement_candidates']++;
    } else summary.read_only_blocks++;
    if (fill) summary.empty_cell_fill_candidates++;
    if (clear) summary.cell_text_clear_candidates++;
    for (const code of codes) reasons.set(code, (reasons.get(code) ?? 0) + 1);
  }
  summary.read_only_reason_counts = [...reasons].map(([code, count]) => ({ code, message_ko: messages[code], blocks: count }));
  return { targets, summary };
}
