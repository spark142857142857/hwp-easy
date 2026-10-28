"""Independent OLE, grid, child-control and recovery checks, without the JS engine."""
from collections import Counter
from pathlib import Path
import hashlib
import importlib.util
import json
import struct
import sys

spec = importlib.util.spec_from_file_location('compound', Path(__file__).with_name('check-local-compound.py'))
raw = importlib.util.module_from_spec(spec)
spec.loader.exec_module(raw)


def end_of(rs, start):
    return next((i for i in range(start + 1, len(rs)) if rs[i][1] <= rs[start][1]), len(rs))


def table_at(rs, start):
    end = end_of(rs, start)
    level = rs[start][1] + 1
    data = [r for r in rs[start + 1:end] if r[0] == 77 and r[1] == level]
    assert len(data) == 1
    rows, cols = struct.unpack_from('<HH', data[0][2], 4)
    heads = [i for i in range(start + 1, end) if rs[i][0] == 72 and rs[i][1] == level]
    cells = []
    grid = set()
    for ordinal, at in enumerate(heads):
        stop = heads[ordinal + 1] if ordinal + 1 < len(heads) else end
        h = rs[at][2]
        col, row, cs, rsn, width, height = struct.unpack_from('<HHHHII', h, 8)
        assert cs > 0 and rsn > 0 and col + cs <= cols and row + rsn <= rows
        for r in range(row, row + rsn):
            for c in range(col, col + cs):
                assert (r, c) not in grid
                grid.add((r, c))
        paragraph_heads = [r for r in rs[at + 1:stop] if r[0] == 66 and r[1] == level]
        assert len(paragraph_heads) == struct.unpack_from('<H', h)[0]
        assert paragraph_heads and all(bool(struct.unpack_from('<I', p[2])[0] & 0x80000000) == (i == len(paragraph_heads)-1) for i, p in enumerate(paragraph_heads))
        cells.append(dict(row=row, col=col, rowSpan=rsn, colSpan=cs, width=width, height=height, header=h, records=rs[at:stop]))
    assert len(grid) == rows * cols
    assert [struct.unpack_from('<H', data[0][2], 18 + i*2)[0] for i in range(rows)] == [sum(c['row'] == i for c in cells) for i in range(rows)]
    return dict(rows=rows, cols=cols, cells=cells, control=rs[start][2], data=data[0][2])


def selected_table(rs, table):
    parent = table['id'].split(':t')[0]
    ordinal = int(parent.split(':r')[1])
    at = [i for i, r in enumerate(rs) if r[0] == 66][ordinal]
    controls = [i for i in range(at + 1, end_of(rs, at)) if rs[i][0] == 71 and rs[i][1] == rs[at][1] + 1]
    start = controls[table['control']]
    assert rs[start][2][:4] == b' lbt'
    return table_at(rs, start)


def encode(rs):
    out = bytearray()
    for tag, level, payload in rs:
        size = len(payload)
        out.extend(struct.pack('<I', tag | level << 10 | min(size, 4095) << 20))
        if size >= 4095:
            out.extend(struct.pack('<I', size))
        out.extend(payload)
    return bytes(out)


def verify(folder, case):
    name = case['name']
    before, after = [folder / (name + '-' + state + '.hwp') for state in ('before', 'after')]
    assert before.read_bytes() == (folder / (name + '-restored.hwp')).read_bytes()
    packed_a, a = raw.reader.load(before)
    packed_b, b = raw.reader.load(after)
    assert packed_a.keys() == packed_b.keys()
    for stream in packed_a:
        if stream not in ('BodyText/Section0', 'PrvText', 'PrvImage'):
            assert packed_a[stream] == packed_b[stream], stream
    ra, rb = [raw.records(s['BodyText/Section0']) for s in (a, b)]
    for rs in (ra, rb):
        for i, r in enumerate(rs):
            if r[0] == 71 and r[2][:4] == b' lbt':
                table_at(rs, i)
    ta, tb = [selected_table(rs, case['selected_table']) for rs in (ra, rb)]
    op = case['operations'][0]
    removed = []
    if op['type'].startswith(('insert_table_', 'delete_table_')):
        axis = 'row' if op['type'].endswith('_row') else 'col'
        dim = 'rows' if axis == 'row' else 'cols'
        adding = op['type'].startswith('insert_')
        assert tb[dim] == ta[dim] + (1 if adding else -1)
        assert tb['cols' if dim == 'rows' else 'rows'] == ta['cols' if dim == 'rows' else 'rows']
        affected = [c for c in ta['cells'] if c[axis] <= op['index'] < c[axis] + c[axis+'Span']]
        if not adding:
            removed = [r for c in affected if c[axis+'Span'] == 1 for r in c['records']]
            if 'expected_cell_sha256' in op:
                assert op['expected_cell_sha256'] == [hashlib.sha256(encode(c['records'])).hexdigest() for c in affected]
        for c in ta['cells']:
            if not adding and c[axis] == op['index'] and c[axis+'Span'] == 1:
                continue
            coordinate = c[axis] + (int(c[axis] >= op['index']) if adding else -int(c[axis] > op['index']))
            span = c[axis+'Span'] + (int(c[axis] < op['index'] < c[axis]+c[axis+'Span']) if adding else -int(c[axis] <= op['index'] < c[axis]+c[axis+'Span']))
            match = next(n for n in tb['cells'] if n[axis] == coordinate and n['col' if axis == 'row' else 'row'] == c['col' if axis == 'row' else 'row'])
            assert match[axis+'Span'] == span
    elif op['type'] == 'merge_table_cells':
        bounds = op['range']
        chosen = [c for c in ta['cells'] if bounds['top'] <= c['row'] <= bounds['bottom'] and bounds['left'] <= c['col'] <= bounds['right']]
        assert len(tb['cells']) == len(ta['cells']) - len(chosen) + 1
        merged = next(c for c in tb['cells'] if c['row'] == bounds['top'] and c['col'] == bounds['left'])
        assert merged['rowSpan'] == bounds['bottom']-bounds['top']+1 and merged['colSpan'] == bounds['right']-bounds['left']+1
    elif op['type'] == 'split_table_cell':
        original = ta['cells'][0]
        assert len(tb['cells']) == len(ta['cells']) + original['rowSpan']*original['colSpan'] - 1
        assert all(c['rowSpan'] == c['colSpan'] == 1 for c in tb['cells'])
    else:
        for operation in case['operations']:
            if operation['type'].startswith('resize_table_'):
                columns = operation['type'] == 'resize_table_columns'
                values = operation['widths' if columns else 'heights']
                assert struct.unpack_from('<I', tb['control'], 16 if columns else 20)[0] == sum(values)
                for c in tb['cells']:
                    start, count = c['col' if columns else 'row'], c['colSpan' if columns else 'rowSpan']
                    assert c['width' if columns else 'height'] == sum(values[start:start+count])
            elif operation['type'] == 'format_table':
                for key, value in operation['props'].items():
                    offset = {'cellSpacing':8, 'paddingLeft':10, 'paddingRight':12, 'paddingTop':14, 'paddingBottom':16}[key]
                    assert struct.unpack_from('<H', tb['data'], offset)[0] == value
            elif operation['type'] == 'format_cell':
                cell = tb['cells'][1]
                assert struct.unpack_from('<HH', cell['header'], 24) == (150, 170)
                assert (struct.unpack_from('<I', cell['header'], 4)[0] >> 5) & 3 == 2
                assert struct.unpack_from('<I', cell['header'], 4)[0] & 0x10000
    # Every retained opaque picture/group/field record and exact text payload
    # remains present. Only explicitly acknowledged subtrees may disappear.
    removed_counts = Counter(removed)
    retained = Counter(ra) - removed_counts
    for tag in (67, 76, 85, 87):
        expected = Counter({r:n for r, n in retained.items() if r[0] == tag})
        assert not (expected - Counter(rb)), (name, tag)
    content = ''.join(t[4] for r in rb if r[0] == 67 for t in raw.tokens(r[2]))
    assert all(value in content for value in op.get('texts', []))


if __name__ == '__main__':
    folder = Path(sys.argv[1])
    cases = json.loads((folder / 'cases.json').read_text(encoding='utf-8'))
    for case in cases:
        verify(folder, case)
    result = dict(status='PASS', cases=len(cases), independent_ole_grid_child_controls=True, subtree_acknowledgement=True, exact_restore=True)
    (folder / 'independent-summary.json').write_text(json.dumps(result, indent=2) + '\n', encoding='utf-8')
    print(json.dumps(result))
