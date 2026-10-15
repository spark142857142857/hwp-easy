"""Optional native QA of trusted public compound-test copies; never saves HWP."""
import hashlib
import html
import json
import re
import struct
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / 'src'))
from one_hwp.hancom import HancomBackend


def digest(data):
    return hashlib.sha256(data).hexdigest()


def normalized(value):
    value = value or ''
    # Hancom emits UTF-16 surrogate units as separate numeric entities.
    value = re.sub(r'&#(\d+);', lambda m: chr(int(m[1])), value)
    value = value.encode('utf-16-le', 'surrogatepass').decode('utf-16-le')
    value = html.unescape(value)
    return re.sub(r'\s+', '', value)


def pixels(path):
    data = path.read_bytes()
    assert data[:2] == b'BM'
    offset = struct.unpack_from('<I', data, 10)[0]
    return digest(data[offset:])


root = Path(sys.argv[1]).resolve()
summary = json.loads((root / 'results.json').read_text(encoding='utf-8'))
out = root / 'native'
out.mkdir(exist_ok=False)
results = []
with HancomBackend(visible=False) as backend:
    app = backend._ready(files=True)
    for entry in summary['documents']:
        case = root / str(entry['id'])
        details = json.loads((case / 'case.json').read_text(encoding='utf-8'))
        fragments = []
        for change in details.get('changed', []):
            fragments.extend(line for line in change['value'].splitlines()
                             if line.startswith(('복합 검증', '합성 입력')))
        for state in ['before', 'after', 'restored']:
            source = case / (state + '.hwp')
            original = source.read_bytes()
            row = dict(id=entry['id'], state=state, source_sha256=digest(original))
            try:
                row['opened'] = bool(app.Open(str(source), 'HWP', 'lock:true;forceopen:true'))
                if not row['opened']:
                    raise RuntimeError('NATIVE_OPEN_FAILED')
                app.HAction.Run('MoveDocEnd')
                row['pages'] = int(app.PageCount)
                assert 0 < row['pages'] <= 32
                text = normalized(app.GetTextFile('TEXT', ''))
                row['requested_lines'] = len(fragments) if state == 'after' else 0
                row['missing_requested_lines'] = sum(normalized(v) not in text for v in fragments) if state == 'after' else 0
                row['images'] = []
                for page in range(row['pages']):
                    image = out / f"{entry['id']:02d}-{state}-{page:02d}.bmp"
                    rendered = bool(app.CreatePageImage(str(image), page, 96, 24, 'bmp'))
                    row['images'].append(dict(page=page, rendered=rendered,
                                              pixel_sha256=pixels(image) if rendered else None))
            except Exception as error:
                row['error'] = str(error)
            finally:
                app.Clear(1)
                row['source_unchanged'] = source.read_bytes() == original
            results.append(row)
            (out / 'results.json').write_text(json.dumps(results, indent=2) + '\n', encoding='utf-8')
            print(json.dumps({k: row.get(k) for k in ['id', 'state', 'opened', 'pages', 'missing_requested_lines', 'error']}), flush=True)

comparisons = []
for entry in summary['documents']:
    before, after, restored = [next(r for r in results if r['id'] == entry['id'] and r['state'] == s)
                               for s in ['before', 'after', 'restored']]
    comparisons.append(dict(id=entry['id'], exact_restore=before['source_sha256'] == restored['source_sha256'],
                            restored_pixels_exact=bool(before.get('images')) and all(i['rendered'] for i in before['images'])
                            and before['images'] == restored.get('images'),
                            before_pages=before.get('pages'), after_pages=after.get('pages'),
                            all_pages_rendered=all(r.get('images') and all(i['rendered'] for i in r['images'])
                                                   for r in [before, after, restored])))
report = dict(files=len(results), pages=sum(r.get('pages', 0) for r in results),
              all_opened=all(r.get('opened') for r in results),
              all_sources_unchanged=all(r['source_unchanged'] for r in results),
              missing_requested_lines=sum(r.get('missing_requested_lines', 0) for r in results),
              documents=comparisons)
report['status'] = 'PASS' if (report['all_opened'] and report['all_sources_unchanged']
    and report['missing_requested_lines'] == 0 and all(not r.get('error') for r in results)
    and all(c['exact_restore'] and c['restored_pixels_exact'] and c['all_pages_rendered'] for c in comparisons)) else 'FAILED'
(out / 'summary.json').write_text(json.dumps(report, indent=2) + '\n', encoding='utf-8')
print(json.dumps(report))
assert report['status'] == 'PASS', 'Native public regression failed; inspect native/results.json'
