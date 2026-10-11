"""Independent OLE/raw-control/UTF-16 verification, including recursive tables."""
from pathlib import Path
import io
import json
import struct
import sys
import zlib
import olefile


def records(data):
    p, out = 0, []
    while p < len(data):
        header, = struct.unpack_from('<I', data, p)
        p += 4
        size = header >> 20
        if size == 4095:
            size, = struct.unpack_from('<I', data, p)
            p += 4
        assert p + size <= len(data)
        out.append((header & 1023, (header >> 10) & 1023, data[p:p + size]))
        p += size
    assert p == len(data)
    return out


def streams(file):
    out = {}
    with olefile.OleFileIO(io.BytesIO(file.read_bytes())) as d:
        compressed = struct.unpack_from('<I', d.openstream('FileHeader').read(), 36)[0] & 1
        for n in d.listdir():
            value = d.openstream(n).read()
            if compressed and (n[0] == 'BodyText' or n == ['DocInfo']):
                value = zlib.decompress(value, -15)
            out['/'.join(n)] = value
    return out


def tokens(data):
    p, visible, out = 0, 0, []
    while p < len(data):
        code, = struct.unpack_from('<H', data, p)
        width = 16 if 1 <= code <= 9 or code in (11, 12) or 14 <= code <= 23 else 2
        if 0xd800 <= code <= 0xdbff:
            width = 4
        text = data[p:p + width].decode('utf-16le') if code >= 32 or code == 10 else '\t' if code == 9 else ''
        out.append((p // 2, width // 2, visible, code, text))
        if text:
            visible += 1
        p += width
    assert p == len(data)
    return out


def verify(folder, case):
    a, b = (streams(folder / (case['name'] + suffix + '.hwp')) for suffix in ('-before', '-after'))
    assert set(a) == set(b)
    body = 'BodyText/Section0'
    for name in a:
        if name != body:
            assert a[name] == b[name]
    old, new = records(a[body]), records(b[body])
    heads = [i for i, (tag, _, _) in enumerate(old) if tag == 66]
    at = heads[case['target_raw_index']]
    stop = next((i for i in heads if i > at), len(old))
    expected = list(old)
    kind = case['type']
    if kind in ('set_field', 'splice_text'):
        text_idx = next(i for i in range(at + 1, stop) if old[i][0] == 67)
        shape_idx = next(i for i in range(at + 1, stop) if old[i][0] == 68)
        text = old[text_idx][2]
        ts = tokens(text)
        start, end, value = case['start'], case['end'], case['new_text']
        if kind == 'set_field':
            begin = next(t for t in ts if t[3] == 3 and t[2] == start)
            finish = next(t for t in ts if t[3] == 4 and t[2] == end)
            left, right = begin[0] + 8, finish[0]
            assert ''.join(t[4] for t in ts if left <= t[0] < right) == case['expected_old']
        else:
            points = [t for t in ts if t[4]]
            left = points[start][0] if start < len(points) else ts[-1][0]
            right = points[end][0] if end < len(points) else ts[-1][0]
        anchors = list(struct.iter_unpack('<II', old[shape_idx][2]))
        ids = [next(s for pos, s in reversed(anchors) if pos <= i) for i in range(len(text) // 2)]
        inherited = ids[left if left < right else max(0, left - 1)]
        value_bytes = value.encode('utf-16le')
        wanted_text = text[:left * 2] + value_bytes + text[right * 2:]
        wanted_ids = ids[:left] + [inherited] * (len(value_bytes) // 2) + ids[right:]
        runs = [(i, s) for i, s in enumerate(wanted_ids) if i == 0 or s != wanted_ids[i - 1]]
        shapes = b''.join(struct.pack('<II', *r) for r in runs)
        header = bytearray(old[at][2])
        prior, = struct.unpack_from('<I', header)
        struct.pack_into('<I', header, 0, prior & 0x80000000 | len(wanted_text) // 2)
        # Character 10 is a line break inside the existing paragraph. Only
        # its control-mask bit changes; field/table/drawing bits stay exact.
        mask, = struct.unpack_from('<I', header, 4)
        struct.pack_into('<I', header, 4, (mask & ~(1 << 10)) | (1 << 10 if any(t[3] == 10 for t in tokens(wanted_text)) else 0))
        struct.pack_into('<H', header, 12, len(runs))
        struct.pack_into('<H', header, 16, 0)
        for i, payload in ((at, bytes(header)), (text_idx, wanted_text), (shape_idx, shapes)):
            expected[i] = (*old[i][:2], payload)
        expected = [r for i, r in enumerate(expected) if not (at < i < stop and r[0] == 69 and r[1] == old[at][1] + 1)]
    else:
        group = next(i for i in range(at + 1, stop) if old[i][0] == 71 and old[i][2][:4] == b' osg' and old[i + 1][2][:4] == b'noc$')
        if kind == 'move_picture_group':
            payload = bytearray(old[group][2])
            for key, offset in (('horzOffset', 12), ('vertOffset', 8)):
                if key in case['props']:
                    struct.pack_into('<i', payload, offset, case['props'][key])
            expected[group] = (*old[group][:2], bytes(payload))
        else:
            children = [i for i in range(group + 1, stop) if old[i][0] == 85]
            child = children[case['picture_index']]
            payload = bytearray(old[child][2])
            width, height = struct.unpack_from('<II', payload, 82)
            for key, offset, extent in (('cropLeft', 44, 0), ('cropTop', 48, 0), ('cropRight', 52, width), ('cropBottom', 56, height)):
                if key in case['props']:
                    value = case['props'][key]
                    struct.pack_into('<i', payload, offset, extent - value if extent else value)
            expected[child] = (*old[child][:2], bytes(payload))
    assert new == expected


if __name__ == '__main__':
    folder = Path(sys.argv[1]) if len(sys.argv) > 1 else Path(__file__).resolve().parents[1] / 'outputs/local-complex-check'
    cases = json.loads((folder / 'cases.json').read_text(encoding='utf-8'))
    for case in cases:
        verify(folder, case)
    summary = {'status': 'PASS', 'cases': len(cases), 'independent_olefile_raw_control_checks': True}
    (folder / 'python.json').write_text(json.dumps(summary, indent=2) + '\n', encoding='utf-8')
    print(json.dumps(summary))
