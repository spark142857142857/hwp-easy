"""Independent raw flow/image/style preservation for disposable render views."""
import json,runpy,sys
from pathlib import Path
root=Path(sys.argv[1] if len(sys.argv)>1 else 'outputs/local-render-view')
# Reuse the raw OLE/control/style checks for the same floating edit contract.
sys.argv=[sys.argv[0],str(root)]
runpy.run_path(str(Path(__file__).with_name('check-local-table-floating.py')),run_name='__main__')
from local_table_raw_proof import load,records
for c in json.loads((root/'cases.json').read_text(encoding='utf-8')):
 _,raw=load(root/(c['name']+'-after.hwp'));rs=records(raw['BodyText/Section0'])
 # No inserted space from the transient renderer may enter a real body anchor.
 for i,(tag,level,payload) in enumerate(rs):
  if tag!=66 or level!=0:continue
  end=next((j for j in range(i+1,len(rs)) if rs[j][1]<=level),len(rs));children=rs[i+1:end]
  if any(t==71 and l==1 and p[:4]==b' osg' for t,l,p in children):
   texts=[p for t,l,p in children if t==67 and l==1]
   assert len(texts)==1 and len(texts[0])==18 and texts[0][0:2]==b'\x0b\x00' and texts[0][-2:]==b'\r\x00'
summary_path=root/'independent-summary.json';summary=json.loads(summary_path.read_text(encoding='utf-8'));summary['render_only_spaces_absent_from_hwp']=True;summary_path.write_text(json.dumps(summary,indent=2)+'\n',encoding='utf-8');print(json.dumps(dict(status='PASS',render_only_spaces_absent_from_hwp=True)))
