"""Optional Windows compatibility check on trusted synthetic package outputs only."""
import sys,json
from pathlib import Path
sys.path.insert(0,str(Path(__file__).resolve().parents[1]/'src'))
from one_hwp.hancom import HancomBackend
root=Path(sys.argv[1]).resolve();cases=json.loads((root/'cases.json').read_text(encoding='utf-8'));out=root/'native';out.mkdir(exist_ok=True);results=[]
with HancomBackend(visible=False) as backend:
 app=backend._ready(files=True)
 for case in cases:
  for state in ['before','after','restored']:
   source=root/(case['name']+'-'+state+'.hwp');prior=source.read_bytes();assert app.Open(str(source),'HWP','lock:true;forceopen:true')
   app.HAction.Run('MoveDocEnd');pages=app.PageCount;text=app.GetTextFile('TEXT','')
   for page in range(pages):assert app.CreatePageImage(str(out/(source.stem+'-'+str(page)+'.bmp')),page,96,24,'bmp')
   app.Clear(1);assert source.read_bytes()==prior
   results.append(dict(case=source.stem,opened=True,pages=pages,images=True,text=text,source_unchanged=True))
(out/'results.json').write_text(json.dumps(results,indent=2,ensure_ascii=False)+'\n',encoding='utf-8');print(json.dumps(dict(documents=len(results),pages=sum(r['pages'] for r in results),all_opened=True,all_images=True)))
