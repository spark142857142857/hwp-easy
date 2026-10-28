"""Independent large text/style/boundary checks using two existing raw readers."""
from pathlib import Path
import importlib.util
import json
import sys


def module(filename, name):
    spec = importlib.util.spec_from_file_location(name, Path(__file__).with_name(filename))
    result = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(result)
    return result


text = module('check-local-text.py', 'long_text_reader')
formatting = module('check-local-advanced.py', 'long_format_reader')
folder = Path(sys.argv[1]) if len(sys.argv) > 1 else Path(__file__).resolve().parents[3] / 'outputs/local-long-text-20261011'
cases = json.loads((folder / 'cases.json').read_text(encoding='utf-8'))['cases']
for case in cases:
    if case['type'] == 'format_text':
        formatting.verify_case(folder / (case['name'] + '-before.hwp'), folder / (case['name'] + '-after.hwp'), case)
    else:
        text.verify_case(folder, case)
report = {'status': 'PASS', 'cases': len(cases), 'reader': 'Python olefile; all retained UTF-16 runs and requested definitions', 'layout_verified': False}
(folder / 'independent-verification.json').write_text(json.dumps(report, indent=2) + '\n', encoding='utf-8')
print(json.dumps(report))
