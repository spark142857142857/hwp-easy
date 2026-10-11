"""Independent final-stream equivalence and operation-level raw checks."""
from pathlib import Path
import importlib.util
import json
import sys

def module(name, filename):
    spec = importlib.util.spec_from_file_location(name, Path(__file__).with_name(filename))
    value = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(value)
    return value

reader = module('hwp_batch_raw', 'check-local-advanced.py')
text_reader = module('hwp_batch_text', 'check-local-text.py')
table_reader = module('hwp_batch_table', 'check-local-table-format.py')
folder = Path(sys.argv[1]) if len(sys.argv) > 1 else Path(__file__).resolve().parents[1] / 'outputs/local-batch-20261011'
cases = json.loads((folder / 'cases.json').read_text(encoding='utf-8'))['cases']
checks = 0
for case in cases:
    atomic, blocks, cells = reader.decode(folder / (case['name'] + '-after.hwp'))
    separate, other, other_cells = reader.decode(folder / (case['name'] + '-separate.hwp'))
    assert atomic == separate
    assert blocks == other and cells == other_cells
    for step in case['steps']:
        if step['type'] in ('splice_text', 'split_paragraph'):
            text_reader.verify_case(folder, step, verify_merge=False)
        elif step['type'] in ('resize_table_columns', 'resize_table_rows', 'format_cell', 'format_table'):
            table_reader.verify_case(folder, step)
        elif step['type'] in ('format_text', 'format_paragraph', 'merge_table_cells', 'insert_table_column'):
            reader.verify_case(folder / (step['name'] + '-before.hwp'), folder / (step['name'] + '-after.hwp'), step)
        else:
            continue
        checks += 1
report = {'status': 'PASS', 'cases': len(cases), 'independent_operation_checks': checks,
          'reader': 'Python olefile, final decoded-stream equivalence and raw operation checks', 'layout_verified': False}
(folder / 'independent-verification.json').write_text(json.dumps(report, indent=2) + '\n', encoding='utf-8')
print(json.dumps(report))
