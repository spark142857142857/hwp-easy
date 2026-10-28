"""Independent raw-record and read-only native checks for generated application forms."""
import json,re,struct,sys
from pathlib import Path
sys.path.insert(0, str(Path(__file__).resolve().parents[3] / 'scripts/check/independent'))
from local_table_raw_proof import load,records,logical
sys.path.insert(0,str(Path(__file__).resolve().parents[3]/'src'))
from one_hwp.hancom import HancomBackend

root=Path(sys.argv[1]).resolve();out=root/'native';out.mkdir(exist_ok=False)
summary=json.loads((root/'summary.json').read_text(encoding='utf-8'));results=[]
compact=lambda s:re.sub(r'\s+','',s)
def visible(data):
 parts=[];i=0
 while i<len(data):
  code,=struct.unpack_from('<H',data,i);width=16 if 1<=code<=9 or code in [11,12] or 14<=code<=23 else 2
  assert i+width<=len(data)
  if code>=32:parts.append(data[i:i+2])
  elif code==10:parts.append(b'\n\0')
  i+=width
 return b''.join(parts).decode('utf-16le')

original_raw,original=load(root/'blank.hwp');base=records(original['BodyText/Section0'])
base_cells=[r[2] for r in base if r[0]==72 and len(r[2])>=38]
_,base_opaque=logical(base)
with HancomBackend(visible=False) as backend:
 app=backend._ready(files=True)
 for entry in summary['states']:
  stage=entry['stage'];file=root/(stage+'.hwp');data=file.read_bytes();packed,raw=load(file);rs=records(raw['BodyText/Section0'])
  expected=json.loads((root/(stage+'-read.json')).read_text(encoding='utf-8'));texts=[visible(r[2]) for r in rs if r[0]==67]
  for b in expected['blocks']:assert b['text'] in texts,(stage,b['id'])
  assert raw['DocInfo']==original['DocInfo'],stage
  for key in original:
   if key not in ['BodyText/Section0','PrvText','PrvImage']:assert raw[key]==original[key],(stage,key)
  cells=[r[2] for r in rs if r[0]==72 and len(r[2])>=38];assert len(cells)==len(base_cells)==16
  for a,b in zip(base_cells,cells):
   # Cell paragraph count, coordinates, span, width, margins and border/style remain intact.
   assert a[:20]==b[:20] and a[24:]==b[24:],stage
  _,opaque=logical(rs) # checks paragraph/control traversal and UTF-16 style ranges
  assert opaque==base_opaque,(stage,'opaque header/footer paragraphs')
  assert app.Open(str(file),'HWP','lock:true;forceopen:true'),stage
  native=app.GetTextFile('TEXT','');native=re.sub(r'&#(\d+);',lambda m:chr(int(m[1])),native).encode('utf-16le','surrogatepass').decode('utf-16le')
  flat=compact(native)
  for block in expected['blocks']:
   text=block['text']
   if text:assert compact(text) in flat,(stage,text[:40])
  positions=[]
  labels=[t for t in texts if re.match(r'^[1-4]\. ',t)]+['작성 확인:']
  if stage=='long':labels += [f'사례{i:03}' for i in range(1,81)]
  for label in labels:
   assert app.SetPos(0,0,0);app.HAction.Run('MoveDocBegin');ps=app.HParameterSet.HFindReplace;app.HAction.GetDefault('RepeatFind',ps.HSet);ps.FindString=label;ps.IgnoreMessage=1
   assert app.HAction.Execute('RepeatFind',ps.HSet),(stage,label)
   indicator=app.KeyIndicator();positions.append(dict(text=label,page=indicator[3],line=indicator[5],position=list(app.GetPos())))
  assert app.SetPos(0,0,0);app.HAction.Run('MoveDocEnd');pages=app.PageCount
  for page in range(pages):assert app.CreatePageImage(str(out/f'{stage}-{page}.bmp'),page,96,24,'bmp')
  app.Clear(1);assert file.read_bytes()==data
  results.append(dict(stage=stage,pages=pages,preview_pages=entry['pages'],native_text_verified=True,raw_structure_preserved=True,source_unchanged=True,positions=positions))
  print(json.dumps(dict(stage=stage,pages=pages,preview_pages=entry['pages'])),flush=True)
assert (root/'blank.hwp').read_bytes()==(root/'restored-blank.hwp').read_bytes()
assert (root/'filled.hwp').read_bytes()==(root/'restored-filled.hwp').read_bytes()==(root/'revised.hwp').read_bytes()
result=dict(status='PASS',documents=len(results),pages=sum(r['pages'] for r in results),raw_preservation=True,exact_restore=True,native_body_and_cell_text_verified=True,results=results)
(out/'summary.json').write_text(json.dumps(result,ensure_ascii=False,indent=2)+'\n',encoding='utf-8')
print(json.dumps({k:v for k,v in result.items() if k!='results'}))
