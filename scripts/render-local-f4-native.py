"""Optional original-color Hancom oracle for generated F4 acceptance files only."""
import json,sys,hashlib,re
from pathlib import Path
sys.path.insert(0,str(Path(__file__).resolve().parents[1]/'src'))
from one_hwp.hancom import HancomBackend
root=Path(sys.argv[1]).resolve();out=root/(sys.argv[2] if len(sys.argv)>2 else 'native');assert out.resolve().parent==root;out.mkdir(exist_ok=False)
cases=json.loads((root/'cases.json').read_text(encoding='utf-8'));results=[]
with HancomBackend(visible=False) as backend:
 app=backend._ready(files=True)
 for case in cases:
  for stage in ['before','after','restored']:
   file=root/(case['name']+'-'+stage+'.hwp');prior=file.read_bytes();assert app.Open(str(file),'HWP','lock:true;forceopen:true'),file.name
   state=case['after'] if stage=='after' else case['before'];native=app.GetTextFile('TEXT','');native=re.sub(r'&#(\d+);',lambda m:chr(int(m[1])),native).encode('utf-16le','surrogatepass').decode('utf-16le');flat=native.replace('\r','').replace('\n','');expected=[b['text'] for b in state['blocks']]+[p['text'] for b in state.get('text_boxes',[]) for p in b['paragraphs']]
   # These tests edit stored caches, not field evaluation. An application may
   # independently refresh a date; record it without calling that an edit loss.
   dynamic=case['name']=='body-date-cache';missing=[t for t in expected if t and t.replace('\n','') not in flat]
   if not dynamic:assert not missing,(file.name,missing)
   positions=[]
   for label in ['HEAD','TAIL','END']:
    if not any(b['text']==label for b in state['blocks']):continue
    app.HAction.Run('MoveDocBegin');ps=app.HParameterSet.HFindReplace;app.HAction.GetDefault('RepeatFind',ps.HSet);ps.FindString=label;ps.IgnoreMessage=1;assert app.HAction.Execute('RepeatFind',ps.HSet);k=app.KeyIndicator();positions.append(dict(text=label,page=k[3],line=k[5]))
   font=None
   if case['name']=='group-format':
    app.HAction.Run('MoveDocBegin');ps=app.HParameterSet.HFindReplace;app.HAction.GetDefault('RepeatFind',ps.HSet);ps.FindString='FIRST';ps.IgnoreMessage=1;assert app.HAction.Execute('RepeatFind',ps.HSet)
    cs=app.HParameterSet.HCharShape;app.HAction.GetDefault('CharShape',cs.HSet);font=dict(height=cs.Height,bold=bool(cs.Bold),color=cs.TextColor)
    assert font['height']==(1400 if stage=='after' else 1000);assert font['bold']==(stage=='after')
   assert app.SetPos(0,0,0);app.HAction.Run('MoveDocEnd')
   pages=app.PageCount
   for page in range(pages):assert app.CreatePageImage(str(out/(file.stem+'-'+str(page)+'.bmp')),page,96,24,'bmp')
   app.Clear(1);assert file.read_bytes()==prior
   result=dict(case=case['name'],stage=stage,pages=pages,input_sha256=hashlib.sha256(prior).hexdigest(),source_unchanged=True,native_text_verified=not missing,cache_refresh_missing=missing,font=font,body=positions);results.append(result);print(json.dumps(dict(case=file.stem,pages=pages)),flush=True)
(out/'results.json').write_text(json.dumps(results,ensure_ascii=False,indent=2)+'\n',encoding='utf-8')
print(json.dumps(dict(documents=len(results),pages=sum(r['pages'] for r in results),source_unchanged=True,no_color_edits=True)))
