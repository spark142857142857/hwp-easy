"""Independent OLE, definition, UTF-16 and control preservation checks."""
from pathlib import Path
import io
import json
import struct
import sys
import zlib
import olefile
import importlib.util

# Reuse the independent raw token/record scanners, never the JS writer.
spec = importlib.util.spec_from_file_location('complex_raw', Path(__file__).with_name('check-local-complex.py'))
raw = importlib.util.module_from_spec(spec)
spec.loader.exec_module(raw)


def load(file):
    packed = {}
    with olefile.OleFileIO(io.BytesIO(file.read_bytes())) as d:
        for name in d.listdir():
            packed['/'.join(name)] = d.openstream(name).read()
    compressed = struct.unpack_from('<I', packed['FileHeader'], 36)[0] & 1
    decoded = {n: zlib.decompress(b, -15) if compressed and (n == 'DocInfo' or n.startswith('BodyText/')) else b for n, b in packed.items()}
    return packed, decoded


def patch_shape(payload, props, fonts):
    assert len(payload) == 74
    out = bytearray(payload)
    if fonts is not None:
        for i, value in enumerate(fonts):
            struct.pack_into('<H', out, i * 2, value)
    flags, = struct.unpack_from('<I', out, 46)
    for key, mask, on in [('italic', 1, 1), ('bold', 2, 2), ('underline', 12, 4), ('strikethrough', 0x180000, 0x80000)]:
        if key in props:
            flags = flags & ~mask | (on if props[key] else 0)
    struct.pack_into('<I', out, 46, flags)
    if 'fontSize' in props:
        struct.pack_into('<I', out, 42, props['fontSize'])
    if 'textColor' in props:
        color = props['textColor'][1:]
        struct.pack_into('<I', out, 52, int(color[:2], 16) | int(color[2:4], 16) << 8 | int(color[4:], 16) << 16)
    return bytes(out)


def verify(folder, case):
    pa, a = load(folder / (case['name'] + '-before.hwp'))
    pb, b = load(folder / (case['name'] + '-after.hwp'))
    body = 'BodyText/Section' + str(case['section'])
    assert set(pa) == set(pb)
    for name in pa:
        if name not in ('DocInfo', body):
            assert pa[name] == pb[name]
    da, db = raw.records(a['DocInfo']), raw.records(b['DocInfo'])
    group = lambda rs, tag: [r for r in rs if r[0] == tag]
    ca, cb = group(da, 21), group(db, 21)
    assert cb[:len(ca)] == ca and len(cb) >= len(ca)
    ma, mb = group(da, 17), group(db, 17)
    assert len(ma) == len(mb) == 1
    left, right = bytearray(ma[0][2]), bytearray(mb[0][2])
    assert struct.unpack_from('<I', right, 36)[0] == len(cb)
    assert struct.unpack_from('<I', left, 36)[0] == len(ca)
    left[36:40] = right[36:40] = b'\0' * 4
    fa, fb = group(da, 19), group(db, 19)
    counts_a = struct.unpack_from('<7I', ma[0][2], 4)
    counts_b = struct.unpack_from('<7I', mb[0][2], 4)
    fonts = [] if 'fontFamily' in case['props'] else None
    ai = bi = 0
    for n, m in zip(counts_a, counts_b):
        assert m in (n, n + 1)
        assert fb[bi:bi + n] == fa[ai:ai + n]
        if m > n:
            payload = fb[bi + n][2]
            length, = struct.unpack_from('<H', payload, 1)
            assert payload[3:3 + length * 2].decode('utf-16le') == case['props']['fontFamily']
            assert payload[0] == 0 and len(payload) == 3 + length * 2  # synthetic new names have no alias
        if fonts is not None:
            names = [r[2][3:3 + struct.unpack_from('<H', r[2], 1)[0] * 2].decode('utf-16le') for r in fb[bi:bi + m]]
            fonts.append(names.index(case['props']['fontFamily']))
        ai += n
        bi += m
    assert ai == len(fa) and bi == len(fb)
    left[4:32] = right[4:32] = b'\0' * 28
    assert left == right
    assert [r for r in da if r[0] not in (17, 19, 21)] == [r for r in db if r[0] not in (17, 19, 21)]
    ra, rb = raw.records(a[body]), raw.records(b[body])
    headers_a = [i for i, r in enumerate(ra) if r[0] == 66]
    headers_b = [i for i, r in enumerate(rb) if r[0] == 66]
    assert len(headers_a) == len(headers_b)
    # target_raw_index counts all sections, unlike per-section record ordinals.
    prior = sum(sum(r[0] == 66 for r in raw.records(a['BodyText/Section' + str(s)])) for s in range(case['section']))
    target = case['target_raw_index'] - prior
    shape_patches = set()
    for i, (sa, sb) in enumerate(zip(headers_a, headers_b)):
        ea = headers_a[i + 1] if i + 1 < len(headers_a) else len(ra)
        eb = headers_b[i + 1] if i + 1 < len(headers_b) else len(rb)
        xa, xb = ra[sa:ea], rb[sb:eb]
        if i != target:
            assert xa == xb
            continue
        ha, hb = bytearray(xa[0][2]), bytearray(xb[0][2])
        assert struct.unpack_from('<H', hb, 16)[0] == 0
        ha[12:14] = hb[12:14] = b'\0' * 2
        ha[16:18] = hb[16:18] = b'\0' * 2
        assert ha == hb
        level = xa[0][1] + 1
        assert [r for r in xa[1:] if not (r[1] == level and r[0] in (68, 69))] == [r for r in xb[1:] if not (r[1] == level and r[0] in (68, 69))]
        text = next(r[2] for r in xa if r[0] == 67 and r[1] == level)
        shapes_a = next(r[2] for r in xa if r[0] == 68 and r[1] == level)
        shapes_b = next(r[2] for r in xb if r[0] == 68 and r[1] == level)
        def ids(payload):
            runs = list(struct.iter_unpack('<II', payload))
            assert runs[0][0] == 0 and all(x[0] < y[0] for x, y in zip(runs, runs[1:]))
            return [next(style for at, style in reversed(runs) if at <= u) for u in range(len(text) // 2)]
        ia, ib = ids(shapes_a), ids(shapes_b)
        assert struct.unpack_from('<H', xb[0][2], 12)[0] == len(shapes_b) // 8
        for unit, length, visible, code, value in raw.tokens(text):
            selected = bool(value) and case['start'] <= visible < case['end']
            if selected:
                wanted = patch_shape(ca[ia[unit]][2], case['props'], fonts)
                shape_patches.add(wanted)
                for u in range(unit, unit + length):
                    assert cb[ib[u]][2] == wanted
            else:
                assert ia[unit:unit + length] == ib[unit:unit + length]
    assert all(r[2] in shape_patches for r in cb[len(ca):])


if __name__ == '__main__':
    folder = Path(sys.argv[1] if len(sys.argv) > 1 else 'outputs/local-complex-format-check')
    cases = json.loads((folder / 'cases.json').read_text(encoding='utf-8'))
    for case in cases:
        verify(folder, case)
    result = {'status': 'PASS', 'independent_cases': len(cases), 'packed_streams': 'PASS', 'existing_definitions': 'PASS', 'all_utf16_styles': 'PASS', 'fields_tables_pictures': 'PASS'}
    (folder / 'independent-summary.json').write_text(json.dumps(result, indent=2) + '\n', encoding='utf-8')
    print(json.dumps(result))
