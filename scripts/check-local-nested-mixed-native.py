"""Native original-color frames, unchanged picture pixels and field origins.
Run after rendering trusted packaged fixtures; no native HWP writes occur.
"""
import json,re,runpy,sys
from pathlib import Path
from PIL import Image,ImageChops

root=Path(sys.argv[1]);native=root/'native'
helpers=runpy.run_path(str(Path(__file__).with_name('check-local-nested-forest-native.py')),run_name='__main__')
border_scores=helpers['border_scores'];proof=[];pictures=boxes=field_origins=0
cases=json.loads((root/'cases.json').read_text(encoding='utf-8'))
def grid_pixels(im):
 pix=im.load();remaining={(x,y) for y in range(im.height) for x in range(im.width) if max(pix[x,y])-min(pix[x,y])>65};result=[]
 # ClearType gives otherwise black glyph edges colored pixels. The trusted
 # grid has large connected color regions; isolated glyph edges are smaller.
 while remaining:
  start=remaining.pop();todo=[start];component=[start]
  while todo:
   x,y=todo.pop()
   for point in [(x-1,y),(x+1,y),(x,y-1),(x,y+1)]:
    if point in remaining:remaining.remove(point);todo.append(point);component.append(point)
  if len(component)>=100:result.extend(component)
 return result
for case in cases:
 name=case['name'];checks=[]
 for stage in ['before','after']:
  runs=json.loads((root/f'{name}-{stage}-runs.json').read_text(encoding='utf-8'));answer=[r for r in runs if re.fullmatch(r'L\d{3}',r['text'])];expected=8 if stage=='before' else case['fixture']['lines'];assert len(answer)==expected and len({(r['page'],r['y']) for r in answer})==expected,(name,stage,'preview answer wrapping')
  controls=json.loads((root/f'{name}-{stage}-objects.json').read_text(encoding='utf-8'))
  for c in controls:
   page=c['page'];original=Image.open(native/f'{name}-{stage}-{page}.bmp').convert('RGB');preview=Image.open(root/f'{name}-{stage}-{page}-preview.png').convert('RGB')
   if c['type']=='shape':
    assert min(border_scores(original,c))>.95,(name,stage,'native box frame',c)
    assert min(border_scores(preview,c,230))>.95,(name,stage,'shipped SVG box frame',c);boxes+=1
   else:
    assert c['type']=='image'
    # This corpus has one embedded color grid per document. Locate its actual
    # pixels globally rather than assuming the declared frame is its position.
    for im,label in [(original,'native'),(preview,'preview')]:
     points=grid_pixels(im)
     assert points,(name,stage,label,'missing image');bounds=[min(x for x,y in points),min(y for x,y in points),max(x for x,y in points)+1,max(y for x,y in points)+1]
     expected=[c['x'],c['y'],c['x']+c['w'],c['y']+c['h']]
     assert all(abs(a-b)<2 for a,b in zip(bounds,expected)),(name,stage,label,bounds,expected)
    if stage=='after':
     marked=Image.open(native/f'{name}-after-marked-{page}.bmp').convert('RGB');rect=(round(c['x'])+2,round(c['y'])+2,round(c['x']+c['w'])-2,round(c['y']+c['h'])-2)
     assert ImageChops.difference(original.crop(rect),marked.crop(rect)).getbbox() is None,(name,'QA color changed picture pixels')
    pictures+=1
   checks.append(dict(stage=stage,kind=c['type'],native_and_preview_frame=True))
 fields=case['after']['fields'];runs=json.loads((root/f'{name}-after-runs.json').read_text(encoding='utf-8'))
 if fields:
  original=Image.open(native/f'{name}-after-0.bmp').convert('RGB');marked=Image.open(native/f'{name}-after-marked-0.bmp').convert('RGB');op=original.load();mp=marked.load()
  green=[(x,y) for y in range(original.height) for x in range(original.width) if mp[x,y][1]>80 and mp[x,y][0]<65 and mp[x,y][2]<65 and mp[x,y]!=op[x,y] and max(op[x,y])<220];covered=set()
  for f in fields:
   assert f['value'];matches=[r for r in runs if r['text'].startswith(f['value'])];assert len(matches)==1,(name,f['name'],'field run identity')
   r=matches[0];width=r['charX'][len(f['value'])];points={(x,y) for x,y in green if r['x']-3<=x<=r['x']+width+3 and r['y']-2<=y<=r['y']+r['h']+3};assert len(points)>5,(name,f['name'],'field native ink outside preview origin');covered.update(points);field_origins+=1
  assert covered==set(green),(name,'unaccounted native field ink')
 proof.append(dict(case=name,objects=checks,field_origins=len(fields)))
base=json.loads((native/'forest-render-proof.json').read_text(encoding='utf-8'))['summary']
summary={**base,'native_and_preview_box_frames':boxes,'native_and_preview_picture_frames':pictures,'native_field_origins':field_origins,'unchanged_picture_pixels_during_color_qa':True}
(native/'mixed-render-proof.json').write_text(json.dumps(dict(summary=summary,cases=proof),indent=2)+'\n',encoding='utf-8');print(json.dumps(summary))
