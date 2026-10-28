"""Independent public compound checks using OLE/raw records, without the JS reader."""
from pathlib import Path
import base64
import hashlib
import importlib.util
import json
import struct
import sys
import zlib

spec = importlib.util.spec_from_file_location('format_raw', Path(__file__).with_name('check-local-complex-format.py'))
reader = importlib.util.module_from_spec(spec)
spec.loader.exec_module(reader)
records, tokens = reader.raw.records, reader.raw.tokens


def paragraphs(data):
    rs = records(data)
    return rs, record_groups(rs)


def record_groups(rs):
    heads = [i for i, r in enumerate(rs) if r[0] == 66]
    return [rs[a:(heads[i + 1] if i + 1 < len(heads) else len(rs))] for i, a in enumerate(heads)]


def own(group, tag):
    matches = [r for r in group[1:] if r[0] == tag and r[1] == group[0][1] + 1]
    if tag == 67 and not matches:
        return b"\r\0"
    assert len(matches) == 1
    return matches[0][2]


def fields(group):
    text = own(group, 67)
    controls = [r for r in group if r[0] == 71 and r[1] == group[0][1] + 1]
    control = 0
    stack, out = [], {}
    for unit, length, visible, code, value in tokens(text):
        if length == 8 and code != 4 and control < len(controls) and text[unit * 2 + 2:unit * 2 + 6] == controls[control][2][:4]:
            payload = controls[control][2]
            control += 1
            if code == 3 and payload[:4] == b'klc%':
                field_id, = struct.unpack_from('<I', payload, len(payload) - 8)
                stack.append((field_id, visible, unit + 8))
        elif code == 4 and stack:
            field_id, start, first = stack.pop()
            out[field_id] = (start, visible, ''.join(t[4] for t in tokens(text) if first <= t[0] < unit))
    assert not stack
    return out


def style_ids(group):
    text, runs = own(group, 67), list(struct.iter_unpack('<II', own(group, 68)))
    assert runs[0][0] == 0 and all(a[0] < b[0] for a, b in zip(runs, runs[1:]))
    assert struct.unpack_from('<H', group[0][2], 12)[0] == len(runs)
    return [next(s for p, s in reversed(runs) if p <= i) for i in range(len(text) // 2)]


def verify(folder):
    case = json.loads((folder / 'case.json').read_text(encoding='utf-8'))
    assert (folder / 'before.hwp').read_bytes() == (folder / 'restored.hwp').read_bytes()
    pa, a = reader.load(folder / 'before.hwp')
    pb, b = reader.load(folder / 'after.hwp')
    da, db = records(a['DocInfo']), records(b['DocInfo'])
    grouped = lambda rs, tag: [r for r in rs if r[0] == tag]
    for tag in (18, 21, 25):
        old, new = grouped(da, tag), grouped(db, tag)
        assert new[:len(old)] == old
    ma, mb = grouped(da, 17), grouped(db, 17)
    assert len(ma) == len(mb) == 1
    old_map, new_map = bytearray(ma[0][2]), bytearray(mb[0][2])
    for tag, offset in ((18, 0), (21, 36), (25, 52)):
        assert struct.unpack_from('<I', new_map, offset)[0] == len(grouped(db, tag))
        old_map[offset:offset + 4] = new_map[offset:offset + 4] = b'\0' * 4
    assert old_map == new_map
    assert [r for r in da if r[0] not in (17, 18, 21, 25)] == [r for r in db if r[0] not in (17, 18, 21, 25)]
    new_streams = set(pb) - set(pa) - {'PrvText', 'PrvImage'}
    assert len(new_streams) == 1
    binary_name = new_streams.pop()
    inserted = next(o for o in case['operations'] if o['type'] == 'insert_picture')
    image = zlib.decompress(pb[binary_name], -15)
    assert hashlib.sha256(image).hexdigest() == inserted['image']['expected_sha256']
    changed_ids = {c['id'] for c in case['changed']}
    verified_ids = {b['id'] for b in case['before']['blocks'] if b['text_mapping_verified']}
    expected = {key: value for key, value in case['wanted'] if key in verified_ids}
    raw_by_id = {}
    for name in pa:
        if name not in ('DocInfo', 'PrvText', 'PrvImage') and not name.startswith('BodyText/'):
            assert pa[name] == pb[name]
        if not name.startswith('BodyText/'):
            continue
        section = int(name.removeprefix('BodyText/Section'))
        ra, ga = paragraphs(a[name]); rb, gb = paragraphs(b[name])
        assert len(ga) == len(gb)
        new_pictures = [i for i, r in enumerate(rb) if r[0] == 85 and ('BIN%04x' % struct.unpack_from('<H', r[2], 71)[0]).lower() in binary_name.lower()]
        exclude = set()
        for i in new_pictures:
            assert [rb[k][0] for k in (i - 2, i - 1, i)] == [71, 76, 85]
            assert struct.unpack_from('<II', rb[i - 2][2], 16) == (inserted['width'], inserted['height'])
            assert struct.unpack_from('<i', rb[i][2], 44)[0] == struct.unpack_from('<i', rb[i][2], 48)[0] == 0
            assert struct.unpack_from('<II', rb[i][2], 82) == (4800, 3000)
            exclude.update((i - 2, i - 1, i))
        opaque = lambda rs: [r for r in rs if r[0] not in (66, 67, 68, 69)]
        retained = [r for i, r in enumerate(rb) if i not in exclude]
        assert opaque(ra) == opaque(retained)
        gb = record_groups(retained)
        for ordinal, (old, new) in enumerate(zip(ga, gb)):
            block_id = f's{section}:r{ordinal}'
            raw_by_id[block_id] = (old, new)
            if block_id in expected:
                assert ''.join(t[4] for t in tokens(own(new, 67))) == expected[block_id]
            if block_id not in changed_ids:
                assert old == new
            else:
                ha, hb = bytearray(old[0][2]), bytearray(new[0][2])
                for lo, hi in ((0, 10), (12, 14), (16, 18)):
                    ha[lo:hi] = hb[lo:hi] = b'\0' * (hi - lo)
                assert ha == hb
                assert struct.unpack_from('<I', new[0][2], 0)[0] & 0x7fffffff == len(own(new, 67)) // 2
                assert struct.unpack_from('<H', new[0][2], 16)[0] == 0
                style_ids(new)
    all_fields = {}
    for block_id, (_, new) in raw_by_id.items():
        for field_id, value in fields(new).items():
            all_fields[(block_id, field_id)] = value
    for f in case['after']['fields']:
        assert all_fields[(f['block_id'], f['field_id'])] == (f['start'], f['end'], f['value'])
    shapes = grouped(db, 21)
    for op in case['operations']:
        if op['type'] not in ('format_text', 'format_paragraph'):
            continue
        # Target IDs are decoded locally, never by the JS reader.
        encoded = op['target_id'].split(':', 2)[2]
        target = base64.urlsafe_b64decode(encoded + '=' * (-len(encoded) % 4)).decode()
        block_id = target.split(':f')[0]
        old, new = raw_by_id[block_id]
        if op['type'] == 'format_paragraph':
            selected = grouped(db, 25)[struct.unpack_from('<H', new[0][2], 8)[0]][2]
            assert struct.unpack_from('<I', selected, 0)[0] >> 2 & 7 == 1
            assert struct.unpack_from('<i', selected, 24)[0] == 175
            assert struct.unpack_from('<i', selected, 20)[0] == 120
        else:
            start, end = op['start'], op['end']
            if ':f' in target:
                start += all_fields[(block_id, int(target.split(':f')[1]))][0]
                end += all_fields[(block_id, int(target.split(':f')[1]))][0]
            ids = style_ids(new)
            for unit, length, visible, _, value in tokens(own(new, 67)):
                if value and start <= visible < end:
                    for u in range(unit, unit + length):
                        shape = shapes[ids[u]][2]
                        assert struct.unpack_from('<I', shape, 46)[0] & 2
                        assert struct.unpack_from('<I', shape, 42)[0] == 1250
                        assert struct.unpack_from('<I', shape, 52)[0] == 0x835a24
    preview = b['PrvText'].decode('utf-16le')
    assert '\0' not in preview
    if case['preview_cache']['status'] == 'updated':
        assert b['PrvImage'][:2] == b'BM' and len(b['PrvImage']) > 54
    else:
        assert b.get('PrvImage', b'') == b''


if __name__ == '__main__':
    out = Path(sys.argv[1])
    summary = json.loads((out / 'results.json').read_text(encoding='utf-8'))
    for case in summary['documents']:
        assert case['status'] == 'PASS'
        verify(out / str(case['id']))
    result = {'status': 'PASS', 'documents': len(summary['documents']), 'independent_ole_text_fields_styles_binary_opaque_controls': True, 'exact_restore': True}
    (out / 'independent-summary.json').write_text(json.dumps(result, indent=2) + '\n', encoding='utf-8')
    print(json.dumps(result))
