"""Original-color Hancom/SVG borders, page membership and exact undo pixels.
Generated fixtures only; color QA locates ink without saving or reflow claims.
"""
import hashlib,json,sys
from pathlib import Path
from PIL import Image,ImageChops
root=Path(sys.argv[1]);native=root/'native';cases=json.loads((root/'cases.json').read_text(encoding='utf-8'));results={r['case']:r for r in json.loads((native/'results.json').read_text(encoding='utf-8'))};proof=[];frame_count=0;restore_pages=0

def border_scores(im,f,threshold=180):
 p=im.load();x,y,w,h=[f[k] for k in ['x','y','w','h']]
 def dark(x,y):return 0<=x<im.width and 0<=y<im.height and max(p[x,y])<threshold
 scores=[]
 for yy in [y,y+h]:scores.append(sum(any(dark(xx,round(yy)+d) for d in [-2,-1,0,1,2]) for xx in range(round(x)+2,round(x+w)-2))/max(1,round(x+w)-round(x)-4))
 for xx in [x,x+w]:scores.append(sum(any(dark(round(xx)+d,yy) for d in [-2,-1,0,1,2]) for yy in range(round(y)+2,round(y+h)-2))/max(1,round(y+h)-round(y)-4))
 return scores

def bands(values):
 result=[]
 for y in sorted(set(values)):
  if not result or y>result[-1][-1]+6:result.append([y])
  else:result[-1].append(y)
 return result

for c in cases:
 name=c['name'];before,after,restored=[results[name+'-'+s] for s in ['before','after','restored']];assert before['pages']==restored['pages']
 for state,r in [('before',before),('after',after),('restored',restored)]:assert r['source_unchanged'] and hashlib.sha256((root/(name+'-'+state+'.hwp')).read_bytes()).hexdigest()==r['input_sha256']
 for page in range(before['pages']):assert ImageChops.difference(Image.open(native/f'{name}-before-{page}.bmp').convert('RGB'),Image.open(native/f'{name}-restored-{page}.bmp').convert('RGB')).getbbox() is None
 restore_pages+=before['pages'];checks=[]
 for state,r in [('before',before),('after',after)]:
  svg_pages=list(root.glob(f'{name}-{state}-*-geometry.json'));assert len(svg_pages)==r['pages'],(name,state,'native versus preview page count',len(svg_pages),r['pages'])
  for page in range(r['pages']):
   tables=json.loads((root/f'{name}-{state}-{page}-geometry.json').read_text(encoding='utf-8'));frames={tuple(f[k] for k in ['x','y','w','h']):f for t in tables for f in [t,*t['cells']]};original=Image.open(native/f'{name}-{state}-{page}.bmp').convert('RGB');preview=Image.open(root/f'{name}-{state}-{page}-preview.png').convert('RGB')
   for f in frames.values():
    ns=border_scores(original,f);ps=border_scores(preview,f,230);assert min(ns)>.95,(name,state,page,f,ns,'native');assert min(ps)>.95,(name,state,page,f,ps,'preview');frame_count+=1
   checks.append(dict(state=state,page=page,frames=len(frames),native_and_shipped_svg_borders_match=True))
 ink=[];line_bands=0
 for page in range(after['pages']):
  original=Image.open(native/f'{name}-after-{page}.bmp').convert('RGB');marked=Image.open(native/f'{name}-after-marked-{page}.bmp').convert('RGB');op=original.load();mp=marked.load();ys=[y for y in range(original.height) for x in range(original.width) if mp[x,y][0]>190 and mp[x,y][2]>190 and mp[x,y][1]<65 and max(op[x,y])<220 and mp[x,y]!=op[x,y]];line_bands+=len(bands(ys));ink.append(dict(page=page,answer_lines=len(bands(ys))))
 assert line_bands==c['fixture']['lines'],(name,line_bands)
 proof.append(dict(case=name,frames=checks,visible_answer_lines=line_bands,ink=ink,exact_restore_pixels=True))
summary=dict(status='PASS',cases=len(cases),documents=len(results),pages=sum(r['pages'] for r in results.values()),native_and_preview_frames=frame_count,visible_answer_lines=sum(p['visible_answer_lines'] for p in proof),exact_restore_pixel_pages=restore_pages,original_color_images_used=True,layout_verified=False)
(native/'forest-render-proof.json').write_text(json.dumps(dict(summary=summary,cases=proof),indent=2)+'\n',encoding='utf-8');print(json.dumps(summary))
