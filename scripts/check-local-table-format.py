"""Independent table metadata patches; all other stream bytes must stay exact."""
from pathlib import Path
import importlib.util
import json
import struct
import sys

spec = importlib.util.spec_from_file_location('hwp_raw_reader', Path(__file__).with_name('check-local-advanced.py'))
reader = importlib.util.module_from_spec(spec)
spec.loader.exec_module(reader)


def verify_case(folder, case):
    old, blocks, cells = reader.decode(folder / (case['name'] + '-before.hwp'))
    saved, after, new_cells = reader.decode(folder / (case['name'] + '-after.hwp'))
    assert set(old) == set(saved)
    index, op = case['target_raw_index'], case['type']
    target = blocks[index]
    host, row, col = target['cell']
    assert [b['text'] for b in after] == [b['text'] for b in blocks]
    assert len(cells) == len(new_cells)
    assert [(b['host'], b['cell']) for b in after] == [(b['host'], b['cell']) for b in blocks]
    for name in old:
        if name != 'BodyText/Section0':
            assert old[name] == saved[name]
    for coordinate, payload in cells.items():
        expected = bytearray(payload)
        if coordinate[0] == host:
            if op.startswith('resize_'):
                columns = op == 'resize_table_columns'
                start = coordinate[2 if columns else 1]
                span = struct.unpack_from('<H', payload, 12 if columns else 14)[0]
                size = sum(case['widths' if columns else 'heights'][start:start + span])
                struct.pack_into('<I', expected, 16 if columns else 20, size)
                if columns:
                    assert struct.unpack_from('<I', payload, 16)[0] == struct.unpack_from('<I', payload, 34)[0]
                    struct.pack_into('<I', expected, 34, size)
            elif op == 'format_cell' and coordinate == target['cell']:
                props = case['props']
                for key, offset in [('paddingLeft', 24), ('paddingRight', 26), ('paddingTop', 28), ('paddingBottom', 30)]:
                    if key in props:
                        struct.pack_into('<H', expected, offset, props[key])
                flags = struct.unpack_from('<I', expected, 4)[0]
                if 'applyInnerMargin' in props:
                    flags = flags & ~0x10000 | (0x10000 if props['applyInnerMargin'] else 0)
                if 'verticalAlign' in props:
                    flags = flags & ~0x60 | props['verticalAlign'] << 5
                struct.pack_into('<I', expected, 4, flags)
        assert bytes(expected) == new_cells[coordinate]
    for before, current in zip(blocks, after):
        assert reader.canon(before, (71, 72, 77)) == reader.canon(current, (71, 72, 77))
        old_objects = [(t, level, p) for t, level, p in before['records'] if t in (71, 77)]
        objects = [(t, level, p) for t, level, p in current['records'] if t in (71, 77)]
        assert len(old_objects) == len(objects)
        for (tag, level, payload), actual in zip(old_objects, objects):
            expected = bytearray(payload)
            if before['host'] == host and before['cell'] is None:
                if tag == 71 and payload[:4] == b' lbt' and op.startswith('resize_'):
                    struct.pack_into('<I', expected, 16 if op == 'resize_table_columns' else 20, sum(case.get('widths', case.get('heights'))))
                elif tag == 77 and op == 'format_table':
                    for key, offset in [('cellSpacing', 8), ('paddingLeft', 10), ('paddingRight', 12), ('paddingTop', 14), ('paddingBottom', 16)]:
                        if key in case['props']:
                            struct.pack_into('<H', expected, offset, case['props'][key])
            assert (tag, level, bytes(expected)) == actual


if __name__ == '__main__':
    folder = Path(sys.argv[1]) if len(sys.argv) > 1 else Path(__file__).resolve().parents[1] / 'outputs/local-table-format-20261011'
    cases = json.loads((folder / 'cases.json').read_text(encoding='utf-8'))['cases']
    for case in cases:
        verify_case(folder, case)
    report = {'status': 'PASS', 'cases': len(cases), 'reader': 'Python olefile and exact table/cell metadata', 'layout_verified': False}
    (folder / 'independent-verification.json').write_text(json.dumps(report, indent=2) + '\n', encoding='utf-8')
    print(json.dumps(report))
