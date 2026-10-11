"""Independent UTF-16 run, paragraph and stream checks for range edits."""
from pathlib import Path
import importlib.util
import json
import struct
import sys

spec = importlib.util.spec_from_file_location('hwp_raw_reader', Path(__file__).with_name('check-local-advanced.py'))
reader = importlib.util.module_from_spec(spec)
spec.loader.exec_module(reader)


def shapes(block):
    runs = [p for tag, _, p in block['records'] if tag == 68]
    assert len(runs) == 1 and len(runs[0]) % 8 == 0
    anchors = list(struct.iter_unpack('<II', runs[0]))
    assert anchors and anchors[0][0] == 0
    assert all(a[0] < b[0] for a, b in zip(anchors, anchors[1:]))
    offset, result = 0, []
    for ch in block['text']:
        width = len(ch.encode('utf-16le')) // 2
        values = [next(shape for pos, shape in reversed(anchors) if pos <= offset + i) for i in range(width)]
        assert len(set(values)) == 1
        result.append(values[0])
        offset += width
    assert all(pos <= offset for pos, _ in anchors)
    return result, anchors[0][1]


def streams_unchanged(old, saved):
    assert set(old) == set(saved)
    for name in old:
        if not name.startswith('BodyText/') and name not in ('DocInfo', 'PrvText', 'PrvImage'):
            assert saved[name] == old[name]
    a, b = reader.definitions(old), reader.definitions(saved)
    assert set(a) == set(b)
    for tag in a:
        assert len(a[tag]) == len(b[tag])
        for (level, left), (new_level, right) in zip(a[tag], b[tag]):
            assert level == new_level
            if tag == 16:
                left, right = bytearray(left), bytearray(right)
                left[14:26] = right[14:26] = bytes(12)
            assert left == right


def verify_case(folder, case, verify_merge=True):
    name = case['name']
    old, before, cells = reader.decode(folder / (name + '-before.hwp'))
    saved, after, new_cells = reader.decode(folder / (name + '-after.hwp'))
    streams_unchanged(old, saved)
    index = case['target_raw_index']
    target = before[index]
    prior, empty = shapes(target)
    multiline = case['type'] == 'splice_text' and '\n' in case['new_text']
    if multiline:
        start, end, text = case['start'], case['end'], case['new_text']
        inherited = prior[start] if end > start else prior[max(0, start - 1)] if prior else empty
        parts = text.split('\n')
        wanted = (target['text'][:start] + text + target['text'][end:]).split('\n')
        ids = [([*prior[:start]] if i == 0 else []) + [inherited] * len(part) + ([*prior[end:]] if i == len(parts) - 1 else []) for i, part in enumerate(parts)]
        assert len(after) == len(before) + len(parts) - 1
        changed = after[index:index + len(parts)]
        assert [b['text'] for b in changed] == wanted
        assert [shapes(b)[0] for b in changed] == ids
        assert all(shapes(b)[1] == inherited for b, run in zip(changed, ids) if not run)
        assert [reader.canon(b) for b in before[:index] + before[index + 1:]] == [reader.canon(b) for b in after[:index] + after[index + len(parts):]]
        assert len(cells) == len(new_cells)
        for left, right in zip(cells.values(), new_cells.values()):
            assert left[2:] == right[2:]
    elif case['type'] == 'splice_text':
        start, end, text = case['start'], case['end'], case['new_text']
        inherited = prior[start] if end > start else prior[max(0, start - 1)] if prior else empty
        wanted = target['text'][:start] + text + target['text'][end:]
        ids = prior[:start] + [inherited] * len(text) + prior[end:]
        assert len(before) == len(after)
        assert after[index]['text'] == wanted and shapes(after[index])[0] == ids
        if not ids:
            assert shapes(after[index])[1] == empty
        assert [reader.canon(b) for b in before[:index] + before[index + 1:]] == [reader.canon(b) for b in after[:index] + after[index + 1:]]
        assert cells == new_cells
        changed = [after[index]]
    elif case['type'] == 'duplicate_paragraph':
        assert len(after) == len(before) + 1
        changed = after[index:index + 2]
        assert [b['text'] for b in changed] == [target['text'], target['text']]
        assert all(shapes(b) == (prior, empty) for b in changed)
        assert [reader.canon(b) for b in before[:index] + before[index + 1:]] == [reader.canon(b) for b in after[:index] + after[index + 2:]]
        assert len(cells) == len(new_cells)
        for left, right in zip(cells.values(), new_cells.values()):
            assert left[2:] == right[2:]
    else:
        offset = case['offset']
        assert len(after) == len(before) + 1
        assert [b['text'] for b in after[index:index + 2]] == [target['text'][:offset], target['text'][offset:]]
        assert shapes(after[index])[0] == prior[:offset]
        assert shapes(after[index + 1])[0] == prior[offset:]
        assert [reader.canon(b) for b in before[:index] + before[index + 1:]] == [reader.canon(b) for b in after[:index] + after[index + 2:]]
        # Cell paragraph counts are checked by decode; every other byte stays exact.
        assert len(cells) == len(new_cells)
        for left, right in zip(cells.values(), new_cells.values()):
            assert left[2:] == right[2:]
        changed = after[index:index + 2]
        if verify_merge:
            merged, merged_blocks, merged_cells = reader.decode(folder / case['merged_file'])
            streams_unchanged(old, merged)
            assert [b['text'] for b in merged_blocks] == [b['text'] for b in before]
            assert [shapes(b)[0] for b in merged_blocks] == [shapes(b)[0] for b in before]
            assert [reader.canon(b) for b in merged_blocks] == [reader.canon(b) for b in before]
            assert merged_cells == cells
    for current in changed:
        expected = reader.canon(target, (67, 68), ((0, 4), (12, 14)))
        if (case['type'] in ('split_paragraph', 'duplicate_paragraph') or multiline) and current is not changed[0]:
            expected = [(tag, level, payload[:18] + bytes(4) + payload[22:]) if tag == 66 else (tag, level, payload) for tag, level, payload in expected]
        assert expected == reader.canon(current, (67, 68), ((0, 4), (12, 14)))
    return True


if __name__ == '__main__':
    folder = Path(sys.argv[1]) if len(sys.argv) > 1 else Path(__file__).resolve().parents[1] / 'outputs/local-text-20261011'
    cases = json.loads((folder / 'cases.json').read_text(encoding='utf-8'))['cases']
    for case in cases:
        verify_case(folder, case)
    report = {'status': 'PASS', 'cases': len(cases), 'reader': 'Python olefile, raw UTF-16 anchors and definitions', 'layout_verified': False}
    (folder / 'independent-verification.json').write_text(json.dumps(report, indent=2) + '\n', encoding='utf-8')
    print(json.dumps(report))
