"""Independent OLE/raw preservation proof for pinned public layout repairs."""
import importlib.util
import json
import struct
import sys
from pathlib import Path

spec = importlib.util.spec_from_file_location('raw_format', Path(__file__).with_name('check-local-complex-format.py'))
reader = importlib.util.module_from_spec(spec)
spec.loader.exec_module(reader)
root = Path(sys.argv[1])
cases = json.loads((root / 'cases.json').read_text(encoding='utf-8'))
for case in cases:
    name = case['name']
    source = root / (name + '-before.hwp')
    assert source.read_bytes() == (root / (name + '-restored.hwp')).read_bytes()
    _, before = reader.load(source)
    _, after = reader.load(root / (name + '-after.hwp'))
    assert set(before) == set(after)
    body = 'BodyText/Section0' if name in ('public-fixed-bottom','public-vector-group') else 'BodyText/Section1'
    for key in before:
        if key not in (body, 'DocInfo', 'PrvText', 'PrvImage'):
            assert before[key] == after[key], (name, key)
    old = [r for r in reader.raw.records(before[body]) if r[0] != 69]
    new = [r for r in reader.raw.records(after[body]) if r[0] != 69]
    assert len(old) == len(new)
    changed_text = 0
    for (tag, level, a), (tag2, level2, b) in zip(old, new):
        assert (tag, level) == (tag2, level2)
        if a == b:
            continue
        x, y = bytearray(a), bytearray(b)
        if tag == 66:
            for lo, hi in [(0, 10), (12, 14), (16, 18)]:
                x[lo:hi] = y[lo:hi] = bytes(hi - lo)
        elif tag == 67:
            old_tokens, new_tokens = list(reader.raw.tokens(a)), list(reader.raw.tokens(b))
            assert [(t[3], a[t[0]*2:(t[0]+t[1])*2]) for t in old_tokens if not t[4]] == [(t[3], b[t[0]*2:(t[0]+t[1])*2]) for t in new_tokens if not t[4]]
            text = ''.join(t[4] for t in new_tokens)
            expected = case['operations'][1]['expected_old'] if name == 'public-fixed-bottom' else case['operations'][0]['new_text']
            assert text == expected
            changed_text += 1
            continue
        elif tag == 68:
            continue  # Style-run positions change with the one edited paragraph.
        elif tag == 73 and name == 'public-fixed-bottom':
            assert struct.unpack_from('<I', b, 28)[0] == 13000
            x[28:32] = y[28:32] = bytes(4)
        elif tag == 71 and name == 'public-vector-group':
            assert a[:4] == b' osg'
            x[8:16] = y[8:16] = bytes(8)
        assert x == y, (name, tag, level)
    assert changed_text == (0 if name == 'public-vector-group' else 1)
    a, b = list(reader.raw.records(before['DocInfo'])), list(reader.raw.records(after['DocInfo']))
    sa, sb = [r for r in a if r[0] == 25], [r for r in b if r[0] == 25]
    assert sb[:len(sa)] == sa
    other_a, other_b = [r for r in a if r[0] != 25], [r for r in b if r[0] != 25]
    assert len(other_a) == len(other_b)
    for (tag, level, a), (tag2, level2, b) in zip(other_a, other_b):
        assert (tag, level) == (tag2, level2)
        x, y = bytearray(a), bytearray(b)
        if tag == 17:
            x[52:56] = y[52:56] = bytes(4)
        assert x == y
report = dict(status='PASS',cases=len(cases),independent_ole_records=True,opaque_controls_exact=True,other_sections_exact=True,exact_restore=True)
(root / 'independent-summary.json').write_text(json.dumps(report, indent=2)+'\n', encoding='utf-8')
print(json.dumps(report))
