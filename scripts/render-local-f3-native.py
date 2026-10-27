"""Optional original-color native oracle for generated F3 lifecycle files only."""
import hashlib,json,sys
from pathlib import Path
sys.path.insert(0,str(Path(__file__).resolve().parents[1]/'src'))
from one_hwp.hancom import HancomBackend
root=Path(sys.argv[1]).resolve();out=root/'native';out.mkdir(exist_ok=False)
cases=json.loads((root/'cases.json').read_text(encoding='utf-8'));results=[]
with HancomBackend(visible=False) as backend:
 app=backend._ready(files=True)
 for case in cases:
  for stage in ['before','after','restored']:
   source=root/(case['name']+'-'+stage+'.hwp');prior=source.read_bytes();assert app.Open(str(source),'HWP','lock:true;forceopen:true')
   text=case['fixture']['answer_text'] if stage=='after' else case['operations'][0]['expected_old'];rows=[]
   for logical in text.split('\n'):
    if not logical:continue
    app.HAction.Run('MoveDocBegin');ps=app.HParameterSet.HFindReplace;app.HAction.GetDefault('RepeatFind',ps.HSet);ps.FindString=logical;ps.IgnoreMessage=1;assert app.HAction.Execute('RepeatFind',ps.HSet),(case['name'],stage,logical)
    pos=app.GetPos();offset=pos[2]-len(logical.encode('utf-16le'))//2
    for ch in logical:
     assert app.SetPos(pos[0],pos[1],offset);indicator=app.KeyIndicator();key=[indicator[3],indicator[5]]
     if not rows or rows[-1]['key']!=key:rows.append(dict(key=key,text=''))
     rows[-1]['text']+=ch;offset+=len(ch.encode('utf-16le'))//2
   body=[]
   for label in ['HEAD','TAIL','END']:
    app.HAction.Run('MoveDocBegin');ps=app.HParameterSet.HFindReplace;app.HAction.GetDefault('RepeatFind',ps.HSet);ps.FindString=label;ps.IgnoreMessage=1;assert app.HAction.Execute('RepeatFind',ps.HSet);k=app.KeyIndicator();body.append(dict(text=label,page=k[3],line=k[5]))
   app.HAction.Run('MoveDocEnd');pages=app.PageCount
   for page in range(pages):assert app.CreatePageImage(str(out/(source.stem+'-'+str(page)+'.bmp')),page,96,24,'bmp')
   app.Clear(1);assert source.read_bytes()==prior
   results.append(dict(case=source.stem,pages=pages,rows=rows,body=body,input_sha256=hashlib.sha256(prior).hexdigest(),source_unchanged=True));print(json.dumps(dict(case=source.stem,pages=pages)),flush=True)
(out/'results.json').write_text(json.dumps(results,ensure_ascii=False,indent=2)+'\n',encoding='utf-8')
print(json.dumps(dict(documents=len(results),pages=sum(r['pages'] for r in results),source_unchanged=True,no_color_edits=True)))
