/** Synthetic language-specific font mappings; no installed font files needed. */
export function languageFontFixture(HwpDocument, api, { table = true, text = '한글 원문' } = {}) {
  const document = HwpDocument.createEmpty();
  try {
    document.createBlankDocument();
    const heading = '합성 글꼴 시험';
    document.insertText(0, 0, 0, heading);
    document.splitParagraph(0, 0, [...heading].length);
    document.insertText(0, 1, 0, text);
    document.splitParagraph(0, 1, [...text].length);
    document.insertText(0, 2, 0, '보존 문단');
    const fonts = ['합성 한글', 'Synthetic Latin', '合成漢字', '合成カナ', 'Synthetic Other', 'Synthetic Symbol', 'Synthetic User'];
    const ids = fonts.map((name, language) => document.findOrCreateFontIdForLang(language, name));
    if (ids.some((id) => !Number.isSafeInteger(id) || id < 0)) throw Error('Synthetic font creation failed');
    const format = JSON.stringify({ fontIds: ids });
    document.applyCharFormat(0, 1, 0, [...text].length, format);
    if (table) {
      const location = JSON.parse(document.createTable(0, 0, [...heading].length, 2, 2));
      for (const [cell, value] of ['한글 원문', '', 'Latin source', '보존 셀'].entries()) {
        if (value) document.insertTextInCell(0, location.paraIdx, location.controlIdx, cell, 0, 0, value);
        document.applyCharFormatInCell(0, location.paraIdx, location.controlIdx, cell, 0, 0, [...value].length, format);
      }
    }
    return api.exportChecked(document);
  } finally { document.free(); }
}
