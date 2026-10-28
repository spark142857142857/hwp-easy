"""Independent whole body-group reorder proof, including style, table and picture bytes."""
from pathlib import Path
import importlib.util
import json
import struct
import sys

spec = importlib.util.spec_from_file_location('hwp_raw_reader', Path(__file__).with_name('check-local-advanced.py'))
reader = importlib.util.module_from_spec(spec)
spec.loader.exec_module(reader)


def groups(body):
    result = []
    for tag, level, payload in reader.records(body):
        if tag == 66 and level == 0:
            result.append([])
            payload = bytearray(payload)
            struct.pack_into('<I', payload, 0, struct.unpack_from('<I', payload)[0] & 0x7fffffff)
            payload = bytes(payload)
        assert result
        result[-1].append((tag, level, payload))
    return result


def verify_case(folder, case):
    old, before, _ = reader.decode(folder / (case['name'] + '-before.hwp'))
    saved, after, _ = reader.decode(folder / (case['name'] + '-after.hwp'))
    assert set(old) - {'PrvText', 'PrvImage'} == set(saved) - {'PrvText', 'PrvImage'}
    for name in old:
        if name not in ('BodyText/Section0', 'PrvText', 'PrvImage'):
            assert old[name] == saved[name]
    prior = groups(old['BodyText/Section0'])
    order = list(range(len(prior)))
    order.remove(case['from'])
    order.insert(order.index(case['after']) + 1, case['from'])
    assert [prior[i] for i in order] == groups(saved['BodyText/Section0'])
    assert len(before) == len(after)
    return True


if __name__ == '__main__':
    folder = Path(sys.argv[1]) if len(sys.argv) > 1 else Path(__file__).resolve().parents[3] / 'outputs/local-move-20261011'
    cases = json.loads((folder / 'cases.json').read_text(encoding='utf-8'))['cases']
    for case in cases:
        verify_case(folder, case)
    report = {'status': 'PASS', 'cases': len(cases), 'reader': 'Python olefile; complete raw body groups and exact other streams', 'layout_verified': False}
    (folder / 'independent-verification.json').write_text(json.dumps(report, indent=2) + '\n', encoding='utf-8')
    print(json.dumps(report))
