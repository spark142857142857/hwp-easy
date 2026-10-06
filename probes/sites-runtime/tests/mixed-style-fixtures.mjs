// Only genuine writer-created synthetic HWP; initialize the pinned WASM first.
import { createEngineApi } from '../../../src/one_hwp/rhwp_api.mjs';
import { syntheticFixture } from '../../../src/one_hwp/synthetic_fixtures.mjs';
export const MIXED_TEXT = '성명: 김철수 😀';
export const MIXED_REPLACEMENT = '성명: 홍길동 😀';
export function mixedFixture(HwpDocument, kind = 'paragraph', { merged = false } = {}) {
  const api = createEngineApi(HwpDocument);
  const base = syntheticFixture(HwpDocument, api.exportChecked, {
    paragraphs: kind === 'paragraph' ? [MIXED_TEXT, '비대상 보존 문단'] : ['합성 양식', '비대상 보존 문단'],
    table: kind === 'cell', merged,
    cells: [[MIXED_TEXT, '보존 셀'], ['여러\n문단', '그대로']],
  });
  const document = api.openDocument(base);
  try {
    const block = api.inspectDocument(document).blocks.find(b => b.kind === kind && b.text === MIXED_TEXT);
    if (!block) throw new Error('Fixed synthetic target missing');
    const result = kind === 'paragraph'
      ? document.applyCharFormat(block.section, block.paragraph, 0, 4, JSON.stringify({ bold: true, textColor: '#224488' }))
      : document.applyCharFormatInCell(block.section, block.paragraph, block.control,
        block.cell, block.cell_paragraph, 0, 4, JSON.stringify({ bold: true, textColor: '#224488' }));
    if (JSON.parse(result).ok !== true) throw new Error('Fixed synthetic formatting failed');
    return api.exportChecked(document);
  } finally { document.free(); }
}
