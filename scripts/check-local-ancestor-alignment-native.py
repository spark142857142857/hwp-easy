"""Unmodified native frames, prefix origins and shared row/recovery proof."""
import json,re,runpy,sys
from pathlib import Path
from PIL import Image
root=Path(sys.argv[1]);out=root/'native'
shared=runpy.run_path(str(Path(__file__).with_name('check-local-cell-wrap-native.py')),run_name='__main__')
summary=shared['summary'];checks=[];prefixes=0
for c in json.loads((root/'cases.json').read_text(encoding='utf-8')):
 normalize=lambda text:re.sub(r'\s+','',text)
 before,after=[shared['native'][c['name']+'-'+stage] for stage in ['before','after']]
 expected=normalize(before['text'])
 for op in c['operations']:
  if op['type']=='splice_text':
   old,new=normalize(op['expected_old']),normalize(op['new_text']);assert expected.count(old)==1;expected=expected.replace(old,new,1)
 assert expected==normalize(after['text']),(c['name'],'native text/order')
 for stage in ['before','after']:
  runs=json.loads((root/f"{c['name']}-{stage}-runs.json").read_text(encoding='utf-8'));tables=json.loads((root/f"{c['name']}-{stage}-0-geometry.json").read_text(encoding='utf-8'));original=Image.open(out/f"{c['name']}-{stage}-0.bmp").convert('RGB')
  for t in tables:
   path=t.get('cellPath');host=next((r for r in runs if r.get('cellPath')==path and r['text'] in ['OUTER','IN','항목']),None)
   if not host:continue
   # No recoloring: isolate the prefix above its verified child border and
   # inside the first cell. Glyph bearings differ between the two fonts.
   x0=round(host['x'])+1;x1=round(host['x']+host['w'])+5;y0=round(host['y'])-2;y1=min(round(t['y'])-2,round(host['y']+host['h'])+4)
   ink=[(x,y) for y in range(y0,y1) for x in range(x0,x1) if max(original.getpixel((x,y)))<180]
   assert ink,(c['name'],stage,host['text'],'native prefix absent at projected origin')
   assert max(y for x,y in ink)-min(y for x,y in ink)>=6,(c['name'],stage,'prefix ink height')
   assert max(y for x,y in ink)<t['y']-2,(c['name'],stage,'prefix intersects child frame')
   prefixes+=1;checks.append(dict(case=c['name'],stage=stage,text=host['text'],render_y=host['y'],native_ink_top=min(y for x,y in ink),native_ink_bottom=max(y for x,y in ink),child_y=t['y']))
summary.update(native_prefix_origins=prefixes,native_text_order_verified=True,prefix_checks=checks,ancestor_alignment_verified_in_tested_profiles=True)
(out/'ancestor-summary.json').write_text(json.dumps(summary,ensure_ascii=False,indent=2)+'\n',encoding='utf-8')
print(json.dumps({k:v for k,v in summary.items() if k not in ['checks','prefix_checks']},ensure_ascii=False))
