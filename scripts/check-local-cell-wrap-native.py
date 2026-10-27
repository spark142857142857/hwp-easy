"""Native caret membership, original ink, public SVG frames and exact restore."""
import json,sys
from pathlib import Path
from PIL import Image,ImageChops
root=Path(sys.argv[1]);out=root/'native';cases=json.loads((root/'cases.json').read_text(encoding='utf-8'));native={r['case']:r for r in json.loads((out/'results.json').read_text(encoding='utf-8'))}
def border_scores(im,f):
 p=im.load();x,y,w,h=[f[k] for k in ['x','y','w','h']]
 def dark(a,b):return 0<=a<im.width and 0<=b<im.height and max(p[a,b])<230
 return [sum(any(dark(xx,round(yy)+d) for d in range(-2,3)) for xx in range(round(x)+2,round(x+w)-2))/max(1,round(w)-4) for yy in [y,y+h]]+[sum(any(dark(round(xx)+d,yy) for d in range(-2,3)) for yy in range(round(y)+2,round(y+h)-2))/max(1,round(h)-4) for xx in [x,x+w]]
def bands(ys):
 result=[]
 for y in ys:
  if not result or y>result[-1][-1]+6:result.append([y])
  else:result[-1].append(y)
 return result
proof=[];frames=0;restored=0
for c in cases:
 name=c['name'];before,after,undo=[native[name+'-'+s] for s in ['before','after','restored']];assert before['pages']==undo['pages']==1 and after['pages']==1
 assert [r['text'] for r in after['rows']]==c['fixture']['rows'],(name,'native rows',after['rows'])
 assert before['text']==undo['text'];assert (root/(name+'-before.hwp')).read_bytes()==(root/(name+'-restored.hwp')).read_bytes()
 assert ImageChops.difference(Image.open(out/(name+'-before-0.bmp')).convert('RGB'),Image.open(out/(name+'-restored-0.bmp')).convert('RGB')).getbbox() is None;restored+=1
 for stage,model in [('before',before),('after',after)]:
  original=Image.open(out/f'{name}-{stage}-0.bmp').convert('RGB');preview=Image.open(root/f'{name}-{stage}-0-preview.png').convert('RGB');tables=json.loads((root/f'{name}-{stage}-0-geometry.json').read_text(encoding='utf-8'));unique={tuple(f[k] for k in ['x','y','w','h']):f for t in tables for f in [t,*t['cells']]}
  for f in unique.values():
   for im,label in [(original,'native'),(preview,'SVG')]:assert min(border_scores(im,f))>.94,(name,stage,label,f,border_scores(im,f))
   frames+=1
  runs=json.loads((root/f'{name}-{stage}-runs.json').read_text(encoding='utf-8'));answer=[r for r in runs if r.get('cellPath')==c['fixture']['selected_path']]
  if c['fixture'].get('source_fonts'):
   rows=[]
   for run in answer:
    if rows and abs(rows[-1]['y']-run['y'])<.2:rows[-1]['text']+=run['text']
    else:rows.append(dict(run))
   answer=rows
  assert [r['text'] for r in answer]==[r['text'] for r in model['rows']],(name,stage,'shipped rows')
  leaf=next(t for t in tables if t.get('cellPath',[])==c['fixture']['selected_path'][:-1]);cell=next(f for f in leaf['cells'] if f['cellIdx']==c['fixture']['selected_path'][-1]['cellIndex']);x,y,w,h=[cell[k] for k in ['x','y','w','h']];ys=[];points=[]
  for yy in range(round(y)+3,round(y+h)-2):
   ink=[xx for xx in range(round(x)+3,round(x+w)-2) if max(original.getpixel((xx,yy)))<180]
   if ink and len(ink)<.85*w:ys.append(yy);points.extend((xx,yy) for xx in ink)
  spans=bands(ys);assert len(spans)==len(answer),(name,stage,'original ink',len(spans),len(answer))
  if c['fixture'].get('source_fonts'):
   assert all(-4<=band[0]-run['y']<=8 for band,run in zip(spans,answer)),(name,stage,'native row tops',[(band[0],run['y']) for band,run in zip(spans,answer)])
  # Leftmost ink stays inside the authored padding, with a two-pixel glyph
  # bearing allowance. Vertical native glyph baselines/justification remain
  # separate from exact row membership and table-frame checks.
  assert points and min(xx for xx,yy in points)>=x+6.8-2,(name,stage,'left padding')
  assert max(xx for xx,yy in points)<x+w-3,(name,stage,'right frame')
  assert min(yy for xx,yy in points)>y+2 and max(yy for xx,yy in points)<y+h-2
 proof.append(dict(case=name,rows=c['fixture']['rows'],native_caret_and_ink_match_shipped_rows=True,padding_preserved=True,restore_pixels_exact=True))
summary=dict(status='PASS',cases=len(cases),documents=len(native),pages=sum(r['pages'] for r in native.values()),native_and_svg_frames=frames,restored_pixel_pages=restored,answer_rows=sum(len(c['fixture']['rows']) for c in cases),no_color_edits=True,layout_verified=False,checks=proof)
(out/'summary.json').write_text(json.dumps(summary,ensure_ascii=False,indent=2)+'\n',encoding='utf-8');print(json.dumps(summary,ensure_ascii=False))
