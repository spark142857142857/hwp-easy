"""Optional isolated Hancom QA of generated fixtures, without saving HWP."""
import sys,json
from pathlib import Path
sys.path.insert(0,str(Path(__file__).resolve().parents[1]/'src'))
from one_hwp.hancom import HancomBackend
root=Path(sys.argv[1]).resolve();cases=json.loads((root/'cases.json').read_text(encoding='utf-8'));out=root/'native';out.mkdir(exist_ok=True);results=[]
with HancomBackend(visible=False) as backend:
 app=backend._ready(files=True)
 for c in cases:
  for state in ['before','after','restored']:
   source=root/(c['name']+'-'+state+'.hwp');prior=source.read_bytes();assert app.Open(str(source),'HWP','lock:true;forceopen:true');app.HAction.Run('MoveDocEnd');pages=app.PageCount;text=app.GetTextFile('TEXT','');markers=[]
   if state=='after':
    for label in ['L'+str(i).zfill(3) for i in range(c['fixture']['lines'])]+['TAIL','END']:
     app.HAction.Run('MoveDocBegin');ps=app.HParameterSet.HFindReplace;app.HAction.GetDefault('RepeatFind',ps.HSet);ps.FindString=label;ps.IgnoreMessage=1
     assert app.HAction.Execute('RepeatFind',ps.HSet),(c['name'],label);indicator=app.KeyIndicator();assert indicator[0];markers.append(dict(text=label,page=indicator[3],line=indicator[5]))
   # Clear the find selection before requesting full page images.
   app.HAction.Run('MoveDocEnd')
   for page in range(pages):assert app.CreatePageImage(str(out/(source.stem+'-'+str(page)+'.bmp')),page,96,24,'bmp')
   if state=='after' and c['fixture'].get('marked_ink'):
    # QA-only in-memory foreground colors locate actual visible answer/peer ink.
    # Original images above and all HWP bytes remain unchanged; never save HWP.
    colors=[(g['color'],g['labels']) for g in c['fixture']['marked_groups']] if c['fixture'].get('marked_groups') else [(255,[m['text'] for m in markers[:-2]])]+[(color,[label]) for color,label in zip([16711680,32768],c['fixture'].get('peer_labels',[]))]
    assert len(c['fixture'].get('peer_labels',[]))<=2
    for color,labels in colors:
     for label in labels:
      app.HAction.Run('MoveDocBegin');ps=app.HParameterSet.HFindReplace;app.HAction.GetDefault('RepeatFind',ps.HSet);ps.FindString=label;ps.IgnoreMessage=1
      assert app.HAction.Execute('RepeatFind',ps.HSet),(c['name'],label,'mark')
      shape=app.HParameterSet.HCharShape;app.HAction.GetDefault('CharShape',shape.HSet);shape.TextColor=color;assert app.HAction.Execute('CharShape',shape.HSet)
    app.HAction.Run('MoveDocEnd')
    assert app.PageCount==pages,(c['name'],'color-only QA changed pagination')
    for page in range(pages):assert app.CreatePageImage(str(out/(source.stem+'-marked-'+str(page)+'.bmp')),page,96,24,'bmp')
   app.Clear(1);assert source.read_bytes()==prior;results.append(dict(case=source.stem,opened=True,pages=pages,text=text,markers=markers,source_unchanged=True))
(out/'results.json').write_text(json.dumps(results,indent=2,ensure_ascii=False)+'\n',encoding='utf-8');print(json.dumps(dict(documents=len(results),pages=sum(r['pages'] for r in results),all_opened=True,all_markers_located=True)))
