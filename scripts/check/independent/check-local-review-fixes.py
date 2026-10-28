"""Independent OLE proof of the four shipped-runtime review regression cases."""
from pathlib import Path
import importlib.util,json,struct,sys
root=Path(sys.argv[1]);spec=importlib.util.spec_from_file_location('raw',Path(__file__).with_name('check-local-complex.py'));raw=importlib.util.module_from_spec(spec);spec.loader.exec_module(raw)
cases=json.loads((root/'cases.json').read_text(encoding='utf-8'))
for c in cases:
 name=c['name'];before=root/(name+'-before.hwp');after=root/(name+'-after.hwp');assert before.read_bytes()==(root/(name+'-restored.hwp')).read_bytes()
 old,new=raw.streams(before),raw.streams(after);assert set(old)==set(new)
 for key in old:
  if key not in ['BodyText/Section0','DocInfo','PrvText','PrvImage']:assert old[key]==new[key],(name,key)
 da,db=[raw.records(s['DocInfo']) for s in [old,new]];assert len(da)==len(db)
 for (tag,level,x),(tag2,level2,y) in zip(da,db):
  assert (tag,level)==(tag2,level2);a_info,b_info=bytearray(x),bytearray(y)
  # The ordinary text engine updates only the derived caret paragraph/offset.
  if name.startswith('crash-') and tag==16:
   assert len(x)==len(y)==26;a_info[18:26]=b_info[18:26]=bytes(8)
  assert a_info==b_info,(name,'document definitions',tag)
 a,b=[raw.records(s['BodyText/Section0']) for s in [old,new]]
 text=lambda rs:[''.join(t[4] for t in raw.tokens(r[2])) for r in rs if r[0]==67]
 if name.startswith('crash-'):
  assert '종료 후 확인한 편집' in text(b) and '중간 합성 문단' not in text(b)
  assert [v for v in text(a) if v!='중간 합성 문단']==[v for v in text(b) if v!='종료 후 확인한 편집']
  for tag in [71,72,73,76,77,85]:assert [r for r in a if r[0]==tag]==[r for r in b if r[0]==tag],(name,tag)
 elif name=='fixed-text-box-risk':
  assert '짧은 안내 😀' in text(b)
  assert [v for v in text(a) if v!='TEXTBOX LABEL 😀']==[v for v in text(b) if v!='짧은 안내 😀']
  for tag in [71,72,73,76,77,79]:assert [r for r in a if r[0]==tag]==[r for r in b if r[0]==tag],(name,tag)
 else:
  assert text(a)==text(b)
  for tag in [72,73,77,85]:assert [r for r in a if r[0]==tag]==[r for r in b if r[0]==tag],(name,tag)
  x=[r[2] for r in a if r[0]==71 and r[2][:4]==b' osg'];y=[r[2] for r in b if r[0]==71 and r[2][:4]==b' osg'];assert len(x)==len(y)==2
  assert sorted(struct.unpack_from('<I',r,16)[0] for r in x)==[1800,30000]
  assert [struct.unpack_from('<I',r,16)[0] for r in y]==[1800,1800]
  for old_control,new_control in zip(x,y):assert old_control[:16]==new_control[:16] and old_control[20:]==new_control[20:]
report=dict(status='PASS',cases=len(cases),independent_ole_raw_checks=True,untouched_streams_and_text_preserved=True,fixed_box_geometry_preserved=True,exact_restore=True)
(root/'independent-summary.json').write_text(json.dumps(report,indent=2)+'\n',encoding='utf-8');print(json.dumps(report))
