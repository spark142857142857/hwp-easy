"""Independent F3 raw OLE proof; disposable render records must never save."""
import json,runpy,sys
from pathlib import Path
root=Path(sys.argv[1] if len(sys.argv)>1 else 'outputs/local-f3')
sys.argv=[sys.argv[0],str(root)]
runpy.run_path(str(Path(__file__).with_name('check-local-table-sync.py')),run_name='__main__')
from local_table_raw_proof import load,records
for case in json.loads((root/'cases.json').read_text(encoding='utf-8')):
 before,b=load(root/(case['name']+'-before.hwp'));after,a=load(root/(case['name']+'-after.hwp'))
 assert before['DocInfo']==after['DocInfo'],case['name']
 for data in [b,a]:
  rs=records(data['BodyText/Section0']);assert len([r for r in rs if r[0]==66])==len([r for r in records(b['BodyText/Section0']) if r[0]==66])
path=root/'independent-summary.json';summary=json.loads(path.read_text(encoding='utf-8'));summary.update(render_only_paragraphs_and_definitions_absent=True,source_fonts_and_original_footer_bytes_preserved=True)
path.write_text(json.dumps(summary,indent=2)+'\n',encoding='utf-8');print(json.dumps(summary))
