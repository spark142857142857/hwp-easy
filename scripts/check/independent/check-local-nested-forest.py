"""Independent proof that private paragraph splits/flow/definitions never save."""
import json,runpy,struct,sys
from pathlib import Path
root=Path(sys.argv[1] if len(sys.argv)>1 else 'outputs/local-nested-forest')
sys.argv=[sys.argv[0],str(root)]
runpy.run_path(str(Path(__file__).with_name('check-local-table-sync.py')),run_name='__main__')
from local_table_raw_proof import load,records
for c in json.loads((root/'cases.json').read_text(encoding='utf-8')):
 pb,b=load(root/(c['name']+'-before.hwp'));pa,a=load(root/(c['name']+'-after.hwp'))
 assert pb['DocInfo']==pa['DocInfo'],c['name']
 for rs in [records(b['BodyText/Section0']),records(a['BodyText/Section0'])]:
  assert len([r for r in rs if r[0]==71 and r[2][:4]==b' lbt'])==len(c['before']['tables'])
  assert all(not(struct.unpack_from('<I',p,4)[0]&1) for tag,level,p in rs if tag==71 and p[:4]==b' lbt')
summary_path=root/'independent-summary.json';summary=json.loads(summary_path.read_text(encoding='utf-8'))
summary.update(render_only_partitions_absent_from_hwp=True,table_floating_state_preserved=True,original_paragraph_definitions_exact=True)
summary_path.write_text(json.dumps(summary,indent=2)+'\n',encoding='utf-8');print(json.dumps(summary))
