// Fixed synthetic v3/v4 container; body chain and Keep are deliberately adjacent
// in the mini stream, so the appended body mini sector is not contiguous.
export function miniAllocationFixture(size = 512, twoBodies = false) {
  const END = 0xfffffffe, FREE = 0xffffffff, source = new Uint8Array(5 * size), v = new DataView(source.buffer);
  const u16 = (o, n) => v.setUint16(o, n, true), u32 = (o, n) => v.setUint32(o, n, true);
  source.set(Uint8Array.of(208, 207, 17, 224, 161, 177, 26, 225));
  u16(24, 0x3e); u16(26, size === 512 ? 3 : 4); u16(28, 0xfffe); u16(30, size === 512 ? 9 : 12); u16(32, 6);
  u32(40, size === 512 ? 0 : 1); u32(44, 1); u32(48, 1); u32(56, 4096); u32(60, 3); u32(64, 1); u32(68, END);
  for (let o = 76; o < 512; o += 4) u32(o, FREE); u32(76, 0);
  for (let o = size; o < 2 * size; o += 4) u32(o, FREE);
  u32(size, 0xfffffffd); u32(size + 4, END); u32(size + 8, END); u32(size + 12, END);
  const entry = (index, name, type, first, length, child = FREE, right = FREE) => {
    const o = 2 * size + index * 128;
    [...name].forEach((c, i) => u16(o + i * 2, c.charCodeAt(0)));
    u16(o + 64, (name.length + 1) * 2); source[o + 66] = type; source[o + 67] = 1;
    u32(o + 68, FREE); u32(o + 72, right); u32(o + 76, child); u32(o + 116, first); u32(o + 120, length);
  };
  const rootSize = twoBodies ? 384 : 256;
  entry(0, 'Root Entry', 5, 2, rootSize, 1);
  entry(1, 'BodyText', 1, END, 0, 2, twoBodies ? FREE : 3);
  entry(2, 'Section0', 2, 0, 190, FREE, twoBodies ? 3 : FREE);
  entry(3, twoBodies ? 'Section1' : 'Keep', 2, 3, twoBodies ? 190 : 60);
  source.fill(42, 3 * size, 3 * size + 190);
  source.fill(47, 3 * size + 192, 3 * size + 192 + (twoBodies ? 190 : 60));
  for (let o = 4 * size; o < 5 * size; o += 4) u32(o, FREE);
  for (const [id, next] of [[0, 1], [1, 2], [2, END], [3, twoBodies ? 4 : END], ...(twoBodies ? [[4, 5], [5, END]] : [])]) {
    u32(4 * size + id * 4, next);
  }
  return { source, size, rootSize, rootSizeOffset: 2 * size + 120, bodySizeOffset: 2 * size + 256 + 120,
    miniFatOffset: 4 * size, tailOffset: 3 * size + rootSize };
}
