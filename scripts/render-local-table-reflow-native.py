"""Optional isolated Hancom QA of generated fixtures, without saving HWP."""
import sys,json,unicodedata,hashlib
from pathlib import Path
sys.path.insert(0,str(Path(__file__).resolve().parents[1]/'src'))
from one_hwp.hancom import HancomBackend
root=Path(sys.argv[1]).resolve();cases=json.loads((root/'cases.json').read_text(encoding='utf-8'));out=root/'native';out.mkdir(exist_ok=True);results=[]
with HancomBackend(visible=False) as backend:
 app=backend._ready(files=True)
 for c in cases:
  if len(sys.argv)>2 and c['name']!=sys.argv[2]:continue
  for state in ['before','after','restored']:
   source=root/(c['name']+'-'+state+'.hwp');prior=source.read_bytes();assert app.Open(str(source),'HWP','lock:true;forceopen:true');app.HAction.Run('MoveDocEnd');pages=app.PageCount;text=app.GetTextFile('TEXT','');markers=[];answer_positions=[]
   if state=='after':
    for label in ['L'+str(i).zfill(3) for i in range(c['fixture']['lines'])]+['TAIL','END']:
     app.HAction.Run('MoveDocBegin');ps=app.HParameterSet.HFindReplace;app.HAction.GetDefault('RepeatFind',ps.HSet);ps.FindString=label;ps.IgnoreMessage=1
     assert app.HAction.Execute('RepeatFind',ps.HSet),(c['name'],label);indicator=app.KeyIndicator();assert indicator[0];markers.append(dict(text=label,page=indicator[3],line=indicator[5]))
    if c['fixture'].get('metrics_ink'):
     for label in c['fixture']['answer_text'].split('\n'):
      app.HAction.Run('MoveDocBegin');ps.FindString=label;assert app.HAction.Execute('RepeatFind',ps.HSet),(c['name'],label,'whole logical line');pos=app.GetPos();start=pos[2]-len(label.encode('utf-16le'))//2;offset=0
      for ch in label:
       if not ch.isspace() and not unicodedata.category(ch).startswith('M'):
        assert app.SetPos(pos[0],pos[1],start+offset);indicator=app.KeyIndicator();assert indicator[0];answer_positions.append(dict(page=indicator[3],line=indicator[5]))
       offset+=len(ch.encode('utf-16le'))//2
   native_fields=[];field_lines=[];body_positions=[]
   if state=='after':
    for label in c['fixture'].get('body_labels',[]):
     app.HAction.Run('MoveDocBegin');ps=app.HParameterSet.HFindReplace;app.HAction.GetDefault('RepeatFind',ps.HSet);ps.FindString=label;ps.IgnoreMessage=1;assert app.HAction.Execute('RepeatFind',ps.HSet);indicator=app.KeyIndicator();body_positions.append(dict(text=label,page=indicator[3],line=indicator[5]))
   if c['fixture'].get('host_controls'):
    model=c['after' if state=='after' else 'before']
    for field in model['fields']:
     # GetFieldText omits in-paragraph LF; exact UTF-16/LF is checked separately
     # by the independent raw reader and full native text/visible line checks.
     value=app.GetFieldText(field['name']).replace('\r\n','\n');assert value.replace('\n','')==field['value'].replace('\n',''),(c['name'],field['name'],'native field value');native_fields.append(dict(field_id=field['field_id'],name=field['name'],value=value))
     if state=='after' and '\n' in field['value']:
      for label in field['value'].split('\n'):
       app.HAction.Run('MoveDocBegin');ps=app.HParameterSet.HFindReplace;app.HAction.GetDefault('RepeatFind',ps.HSet);ps.FindString=label;ps.IgnoreMessage=1;assert app.HAction.Execute('RepeatFind',ps.HSet);indicator=app.KeyIndicator();field_lines.append(dict(name=field['name'],text=label,page=indicator[3],line=indicator[5]))
   # Clear the find selection before requesting full page images.
   app.HAction.Run('MoveDocEnd')
   for page in range(pages):assert app.CreatePageImage(str(out/(source.stem+'-'+str(page)+'.bmp')),page,96,24,'bmp')
   if state=='after' and c['fixture'].get('marked_ink') and not c['fixture'].get('metrics_ink'):
    # QA-only in-memory foreground colors locate actual visible answer/peer ink.
    # Original images above and all HWP bytes remain unchanged; never save HWP.
    colors=[(g['color'],g['labels']) for g in c['fixture']['marked_groups']] if c['fixture'].get('marked_groups') else [(255,[m['text'] for m in markers[:-2]])]+[(color,[label]) for color,label in zip([16711680,32768],c['fixture'].get('peer_labels',[]))]
    assert len(c['fixture'].get('peer_labels',[]))<=2
    for color,labels in colors:
     for label in labels:
      app.HAction.Run('MoveDocBegin');ps=app.HParameterSet.HFindReplace;app.HAction.GetDefault('RepeatFind',ps.HSet);ps.FindString=label;ps.IgnoreMessage=1
      assert app.HAction.Execute('RepeatFind',ps.HSet),(c['name'],label,'mark')
      # Supply only foreground color. Do not request default font/size
      # values for the QA selection.
      action=app.CreateAction('CharShape');shape=action.CreateSet();shape.SetItem('TextColor',color);assert action.Execute(shape)
    app.HAction.Run('MoveDocEnd')
    assert app.PageCount==pages,(c['name'],'color-only QA changed pagination')
    for page in range(pages):assert app.CreatePageImage(str(out/(source.stem+'-marked-'+str(page)+'.bmp')),page,96,24,'bmp')
   app.Clear(1);assert source.read_bytes()==prior;results.append(dict(case=source.stem,opened=True,pages=pages,text=text,markers=markers,answer_positions=answer_positions,native_fields=native_fields,field_lines=field_lines,body_positions=body_positions,input_sha256=hashlib.sha256(prior).hexdigest(),source_unchanged=True))
(out/'results.json').write_text(json.dumps(results,indent=2,ensure_ascii=False)+'\n',encoding='utf-8');print(json.dumps(dict(documents=len(results),pages=sum(r['pages'] for r in results),all_opened=True,all_markers_located=True)))
