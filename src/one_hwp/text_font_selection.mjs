// Pinned @rhwp/core 0.8.6 uses the first character's language to report
// fontFamily; fontFamilies is the complete seven-language mapping. Mirror only
// that derived selection, never discard the mapping or other style properties.
// Primary source: rhwp v0.8.6 renderer/style_resolver.rs detect_lang_category.
export function pinnedFontLanguage(text) {
  const cp = text.codePointAt(0), inRange = (lo, hi) => cp >= lo && cp <= hi;
  if (cp === 0x318d) return 6;
  if (inRange(0x1100, 0x11ff) || inRange(0x3130, 0x318f) || inRange(0xac00, 0xd7af)
    || inRange(0xa960, 0xa97f) || inRange(0xd7b0, 0xd7ff)) return 0;
  if (inRange(0x41, 0x5a) || inRange(0x61, 0x7a) || inRange(0x30, 0x39)
    || inRange(0xc0, 0x24f) || inRange(0x1e00, 0x1eff)) return 1;
  if (inRange(0x4e00, 0x9fff) || inRange(0x3400, 0x4dbf) || inRange(0xf900, 0xfaff)
    || inRange(0x20000, 0x2a6df)) return 2;
  if (inRange(0x3040, 0x309f) || inRange(0x30a0, 0x30ff) || inRange(0x31f0, 0x31ff)) return 3;
  if (inRange(0x2190, 0x23ff) || inRange(0x2500, 0x27bf) || inRange(0x2460, 0x24ff)
    || inRange(0x3000, 0x303f)) return 5;
  return 0; // Empty text, punctuation, emoji and every other pinned default.
}

export function expectedEditedBlock(block, newText, languageFontSelection = false) {
  const expected = { ...block, text: newText }, char = block.style?.char, fonts = char?.fontFamilies;
  if (!languageFontSelection || newText === block.text || !Array.isArray(fonts) || fonts.length !== 7
    || !fonts.every((font) => typeof font === 'string' && font.length > 0)
    || char.fontFamily !== fonts[pinnedFontLanguage(block.text)]) return expected;
  return { ...expected, style: { ...block.style, char: { ...char, fontFamily: fonts[pinnedFontLanguage(newText)] } } };
}
