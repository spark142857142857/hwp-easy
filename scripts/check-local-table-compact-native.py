"""Run frame/ink/restore proof, then prove compaction removed actual pages."""
import hashlib,json,runpy,sys
from pathlib import Path
root=Path(sys.argv[1]);runpy.run_path(str(Path(__file__).with_name('check-local-table-reflow-native.py')),run_name='__main__')
cases=json.loads((root/'cases.json').read_text(encoding='utf-8'));results={r['case']:r for r in json.loads((root/'native/results.json').read_text(encoding='utf-8'))};changes=[]
for c in cases:
 name=c['name'];before=results[name+'-before'];after=results[name+'-after']
 for state in ['before','after','restored']:assert results[name+'-'+state]['input_sha256']==hashlib.sha256((root/f'{name}-{state}.hwp').read_bytes()).hexdigest()
 assert after['pages']<before['pages'],(name,'no actual page reduction')
 assert all(a['properties']['tableHeight']<=b['properties']['tableHeight'] for a,b in zip(c['after']['tables'],c['before']['tables']))
 changes.append(dict(case=name,before_pages=before['pages'],after_pages=after['pages']))
p=root/'native/summary.json';summary=json.loads(p.read_text(encoding='utf-8'));summary.update(input_sha256_verified=True,page_reductions=changes);p.write_text(json.dumps(summary,indent=2)+'\n',encoding='utf-8');print(json.dumps(dict(status='PASS',page_reductions=changes)))
