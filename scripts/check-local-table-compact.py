"""Independent byte preservation and merged row geometry after compaction."""
import json,runpy,struct,sys
from pathlib import Path
from local_table_raw_proof import load,records
root=Path(sys.argv[1] if len(sys.argv)>1 else 'outputs/local-table-compact');sys.argv=[sys.argv[0],str(root)]
runpy.run_path(str(Path(__file__).with_name('check-local-table-sync.py')),run_name='__main__')
cases=json.loads((root/'cases.json').read_text(encoding='utf-8'))
for c in cases:
 name=c['name'];_,raw=load(root/(name+'-after.hwp'));rs=records(raw['BodyText/Section0']);heights=[]
 for at,(tag,level,payload) in enumerate(rs):
  if tag!=71 or payload[:4]!=b' lbt':continue
  end=next((i for i in range(at+1,len(rs)) if rs[i][1]<=level),len(rs));direct=[r for r in rs[at+1:end] if r[1]==level+1];table=next(p for tag,l,p in direct if tag==77);count=struct.unpack_from('<H',table,4)[0];edges=[[] for _ in range(count+1)]
  for tag,l,p in direct:
   if tag!=72:continue
   start=struct.unpack_from('<H',p,10)[0];span=struct.unpack_from('<H',p,14)[0];height=struct.unpack_from('<I',p,20)[0];edges[start].append((start+span,height));edges[start+span].append((start,-height))
  positions={0:0};queue=[0]
  for start in queue:
   for end,delta in edges[start]:
    value=positions[start]+delta
    if end in positions:assert positions[end]==value,(name,'inconsistent merged heights')
    else:positions[end]=value;queue.append(end)
  assert len(positions)==count+1;assert all(positions[i+1]-positions[i]>=100 for i in range(count));assert positions[count]==struct.unpack_from('<I',payload,20)[0];heights.append(positions[count])
 assert heights and any(a['properties']['tableHeight']<b['properties']['tableHeight'] for a,b in zip(c['after']['tables'],c['before']['tables']))
p=root/'independent-summary.json';summary=json.loads(p.read_text(encoding='utf-8'));summary.update(merged_row_boundaries_consistent=True,positive_row_floor_verified=True,stored_height_reduced=True);p.write_text(json.dumps(summary,indent=2)+'\n',encoding='utf-8');print(json.dumps(dict(status='PASS',cases=len(cases),merged_row_boundaries_consistent=True)))
