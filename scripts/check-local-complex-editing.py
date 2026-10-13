"""Independent synthetic complex-edit checks; JS is used only to create cases."""
from pathlib import Path
import importlib.util
import json
import struct
import sys
import zlib

spec = importlib.util.spec_from_file_location('compound', Path(__file__).with_name('check-local-compound.py'))
raw = importlib.util.module_from_spec(spec)
spec.loader.exec_module(raw)


def compose(a, b):
    return [a[0]*b[0]+a[1]*b[3], a[0]*b[1]+a[1]*b[4], a[0]*b[2]+a[1]*b[5]+a[2],
            a[3]*b[0]+a[4]*b[3], a[3]*b[1]+a[4]*b[4], a[3]*b[2]+a[4]*b[5]+a[5]]


def combined(shape):
    count, = struct.unpack_from('<H', shape, 46)
    value = list(struct.unpack_from('<6d', shape, 48))
    for i in range(count):
        scale, rotation = (struct.unpack_from('<6d', shape, at + i*96) for at in (96, 144))
        value = compose(compose(value, rotation), scale)
    return value


def verify(folder, case):
    name = case['name']
    before, after = (folder / (name + suffix + '.hwp') for suffix in ('-before', '-after'))
    assert before.read_bytes() == (folder / (name + '-restored.hwp')).read_bytes()
    pa, a = raw.reader.load(before); pb, b = raw.reader.load(after)
    operations = case['operations']
    for stream in pa:
        if stream not in ('DocInfo', 'BodyText/Section0', 'PrvText', 'PrvImage'):
            assert pa[stream] == pb[stream]
    ra, ga = raw.paragraphs(a['BodyText/Section0']); rb, gb = raw.paragraphs(b['BodyText/Section0'])
    opaque = lambda rs: [r for r in rs if r[0] not in (66, 67, 68, 69)]
    op = operations[0]
    if name.startswith('field-'):
        assert pa['DocInfo'] == pb['DocInfo']
        created = op['type'] == 'insert_field'
        f = (case['after'] if created else case['before'])['fields'][0]
        ordinal = int(f['block_id'].split(':r')[1]); old, new = ga[ordinal], gb[ordinal]
        old_text = ''.join(t[4] for t in raw.tokens(raw.own(old, 67)))
        new_text = ''.join(t[4] for t in raw.tokens(raw.own(new, 67)))
        assert new_text == (old_text[:op['offset']] + op['value'] + old_text[op['offset']:] if created else old_text)
        fa, fb = raw.fields(old), raw.fields(new)
        if created:
            assert fb[f['field_id']] == (op['offset'], op['offset'] + len(op['value']), op['value'])
        else:
            assert f['field_id'] not in fb
        field_header = next(i for i, r in enumerate(rb if created else ra) if r[0] == 71 and r[2][:4] == b'klc%' and struct.unpack_from('<I', r[2], len(r[2])-8)[0] == f['field_id'])
        chosen = rb if created else ra
        assert chosen[field_header + 1][0] == 87
        attr = chosen[field_header + 1][2]
        length, = struct.unpack_from('<H', attr, 10)
        assert attr[12:12+length*2].decode('utf-16le') == f['name']
        retained = [r for i, r in enumerate(chosen) if i not in (field_header, field_header+1)]
        assert opaque(retained) == opaque(ra if created else rb)
        for i, (left, right) in enumerate(zip(ga, gb)):
            if i != ordinal:
                assert left == right
    elif name.startswith('group-'):
        assert len(ra) == len(rb)
        changes = [i for i, (left, right) in enumerate(zip(ra, rb)) if left != right]
        if len(operations) == 1:
            assert len(changes) == 1 and ra[changes[0]][0] == 85
            picture_at = changes[0]
        else:
            assert len(changes) == 2 and [ra[i][0] for i in changes] == [76, 85]
            shape_at, picture_at = changes
            left, right = ra[shape_at][2], rb[shape_at][2]
            count, = struct.unpack_from('<H', left, 46)
            at = 144 + (count-1)*96
            assert left[:36] == right[:36] and left[46:at] == right[46:at] and left[at+48:] == right[at+48:]
            assert struct.unpack_from('<h', right, 36)[0] == 90
            old, new = combined(left), combined(right)
            w, h = struct.unpack_from('<II', left, 16)
            transform = lambda m, x, y: (m[0]*x+m[1]*y+m[2], m[3]*x+m[4]*y+m[5])
            center = transform(old, w/2, h/2)
            assert all(abs(x-y) < 1e-6 for x, y in zip(center, transform(new, w/2, h/2)))
            for x, y in ((0, 0), (w, 0), (0, h), (w, h)):
                ox, oy = transform(old, x, y); nx, ny = transform(new, x, y)
                assert abs(nx-(center[0]-(oy-center[1]))) < 1e-6
                assert abs(ny-(center[1]+(ox-center[0]))) < 1e-6
        bin_id, = struct.unpack_from('<H', rb[picture_at][2], 71)
        stream = next(n for n in b if f'BIN{bin_id:04x}'.lower() in n.lower())
        assert raw.hashlib.sha256(zlib.decompress(b[stream], -15)).hexdigest() == op['image']['expected_sha256']
        da, db = raw.records(a['DocInfo']), raw.records(b['DocInfo'])
        for tag in (18, 21, 25):
            old_defs, new_defs = ([r for r in rs if r[0] == tag] for rs in (da, db))
            assert new_defs[:len(old_defs)] == old_defs
    else:
        assert pa['DocInfo'] == pb['DocInfo']
        # Retained child controls and all picture/group bytes stay exact,
        # except the explicitly requested picture crop in the final case.
        old = [r for r in ra if r[0] in (76, 85, 87)]
        new = [r for r in rb if r[0] in (76, 85, 87)]
        if name == 'picture-table-row':
            for left, right in zip(old, new):
                if left[0] == 85:
                    x, y = bytearray(left[2]), bytearray(right[2]);assert struct.unpack_from('<i', y, 44)[0] == 75;x[44:48] = y[44:48] = b'\0'*4;assert x == y
                else:
                    assert left == right
        else:
            assert old == new
        assert len(old) == len(new)
        depth = len(next(b for b in case['before']['blocks'] if b['target_id'] == op['target_id'])['cell_path']) if name != 'picture-table-row' else 1
        if name.startswith('nested-public-'):
            block_id = raw.base64.urlsafe_b64decode(op['target_id'].split(':', 2)[2] + '=' * (-len(op['target_id'].split(':', 2)[2]) % 4)).decode()
            table = next(t for t in case['before']['tables'] if any(block_id in c['paragraph_ids'] for c in t['cells']))
            def selected_table(rs):
                parent, control = table['id'].split(':t')
                ordinal = int(parent.split(':r')[1]);at = [i for i, r in enumerate(rs) if r[0] == 66][ordinal]
                stop = next((i for i in range(at+1, len(rs)) if rs[i][1] <= rs[at][1]), len(rs))
                own_controls = [i for i in range(at+1, stop) if rs[i][0] == 71 and rs[i][1] == rs[at][1]+1]
                start = own_controls[int(control)];assert rs[start][2][:4] == b' lbt'
                return next(r for r in rs[start+1:] if r[0] == 77 and r[1] == rs[start][1]+1)
            table_a, table_b = [selected_table(ra)], [selected_table(rb)]
        else:
            table_a = [r for r in ra if r[0] == 77 and r[1] == depth*2]
            table_b = [r for r in rb if r[0] == 77 and r[1] == depth*2]
        assert len(table_a) == len(table_b) == 1
        prior = struct.unpack_from('<HH', table_a[0][2], 4); now = struct.unpack_from('<HH', table_b[0][2], 4)
        axis = 0 if op['type'].endswith('_row') else 1
        assert now[axis] == prior[axis] + (1 if op['type'].startswith('insert_') else -1)
        assert now[1-axis] == prior[1-axis]
        if op['type'].startswith('insert_'):
            content = ''.join(t[4] for r in rb if r[0] == 67 for t in raw.tokens(r[2]))
            assert all(value in content for value in op['texts'])
        # Table changes can shift raw IDs; independently match retained full
        # paragraph payloads rather than accepting the JS remapping alone.
        old_texts = [r for r in ra if r[0] == 67]
        new_texts = [r for r in rb if r[0] == 67]
        removed = [s for cell in op.get('expected_cells', []) for s in cell]
        for r in old_texts:
            visible = ''.join(t[4] for t in raw.tokens(r[2]))
            if visible not in removed:
                assert r in new_texts


if __name__ == '__main__':
    folder = Path(sys.argv[1])
    cases = json.loads((folder / 'cases.json').read_text(encoding='utf-8'))
    for case in cases:
        verify(folder, case)
    result = {'status': 'PASS', 'cases': len(cases), 'independent_ole_fields_axes_binary_affine_checks': True, 'exact_restore': True}
    (folder / 'independent-summary.json').write_text(json.dumps(result, indent=2) + '\n', encoding='utf-8')
    print(json.dumps(result))
