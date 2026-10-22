"""Native cell borders, image frames, ink clearance and exact restored pages."""
import json,math,re,sys
from pathlib import Path
from PIL import Image,ImageChops,ImageDraw
root=Path(sys.argv[1]);out=root/'native';cases=json.loads((root/'cases.json').read_text(encoding='utf-8'));rows=json.loads((out/'results.json').read_text(encoding='utf-8'));results={r['case']:r for r in rows}
def text(s):return re.sub(r'&#(\d+);',lambda m:chr(int(m[1])),s).encode('utf-16-le','surrogatepass').decode('utf-16-le').replace('\r','').replace('\n','').replace('\t','')
def image(name,state):return Image.open(out/f'{name}-{state}-0.bmp').convert('RGB')
def dark(im,x,y):return 0<=x<im.width and 0<=y<im.height and max(im.getpixel((x,y)))<180
def cell(im,p,tolerance):
    x,y,w,h=[p[k] for k in ('x','y','w','h')];lo=round(y+h*.7);hi=round(y+h*.95)
    vertical=lambda xx:sum(dark(im,xx,yy) for yy in range(lo,hi))>=(hi-lo)*.9
    xs=[xx for xx in range(round(x)-tolerance,round(x)+tolerance+1) if vertical(xx)]
    rights=[xx for xx in range(round(x+w)-tolerance,round(x+w)+tolerance+1) if vertical(xx)];assert xs and rights,('native cell vertical edges',p,xs,rights)
    left=min(xs,key=lambda n:abs(n-x));right=min(rights,key=lambda n:abs(n-x-w));start=round((left+right)/2);stop=right-2
    horizontal=lambda yy:sum(dark(im,xx,yy) for xx in range(start,stop))>=(stop-start)*.9
    ys=[yy for yy in range(round(y)-3,round(y)+4) if horizontal(yy)];bottoms=[yy for yy in range(round(y+h)-3,round(y+h)+4) if horizontal(yy)];assert ys and bottoms,('native cell horizontal edges',p,ys,bottoms)
    return left,min(ys,key=lambda n:abs(n-y)),right,min(bottoms,key=lambda n:abs(n-y-h))
checks=[]
for c in cases:
 name=c['name'];a=image(name,'before');b=image(name,'after');r=image(name,'restored');assert all(results[name+'-'+state]['pages']==1 for state in ('before','after','restored'));assert ImageChops.difference(a,r).getbbox() is None,(name,'restored pixels');assert text(results[name+'-before']['text'])==text(results[name+'-after']['text']),(name,'native text/order')
 p=c['verification']['placement'];expected=p['after'];x,y,w,h=[expected[k] for k in ('x','y','w','h')];pixels=[]
 for yy in range(round(y)-3,round(y+h)+4):
  for xx in range(round(x)-3,round(x+w)+4):
   rgb=b.getpixel((xx,yy))
   if max(rgb)-min(rgb)>80 and min(rgb)<170:pixels.append((xx,yy))
 assert len(pixels)>w*h*.35,(name,'visible embedded image',len(pixels),expected)
 bounds=(min(xx for xx,yy in pixels),min(yy for xx,yy in pixels),max(xx for xx,yy in pixels)+1,max(yy for xx,yy in pixels)+1)
 assert all(abs(v-e)<=3 for v,e in zip(bounds,(x,y,x+w,y+h))),(name,'native image frame',bounds,expected)
 grid=cell(b,p['projected_cell'],math.ceil(p['inline_prefix_tolerance'])+3);assert grid==cell(a,p['projected_cell'],math.ceil(p['inline_prefix_tolerance'])+3),(name,'cell geometry')
 left,top,right,bottom=bounds;cl,ct,cr,cb=grid;assert left>=cl+2 and top>=ct+2 and right<=cr-2 and bottom<=cb-2,(name,'image outside cell',bounds,grid)
 old=p['before'];in_old=lambda xx,yy:not c['options'].get('bodySource') and old['x']-4<=xx<=old['x']+old['w']+4 and old['y']-4<=yy<=old['y']+old['h']+4
 ink=[(xx,yy) for yy in range(ct+3,cb-2) for xx in range(cl+3,cr-2) if not in_old(xx,yy) and dark(a,xx,yy)]
 assert not any(left-1<=xx<=right+1 and top-1<=yy<=bottom+1 for xx,yy in ink),(name,'image intersects native text')
 assert all(dark(b,xx,yy) for xx,yy in ink),(name,'non-target native ink moved')
 if c['options'].get('inline'):
  difference=ImageChops.difference(a,b);mask=ImageDraw.Draw(difference)
  for mask_bounds in (p['before'],p['after']):mask.rectangle((math.floor(mask_bounds['x'])-4,math.floor(mask_bounds['y'])-4,math.ceil(mask_bounds['x']+mask_bounds['w'])+4,math.ceil(mask_bounds['y']+mask_bounds['h'])+4),fill='black')
  assert difference.getbbox() is None,(name,'non-target native page ink moved')
 checks.append(dict(case=name,group=c['options'].get('group',False),actual_cell=grid,actual_image_frame=bounds,native_ink_clear=True))
summary=dict(status='PASS',documents=len(rows),pages=sum(r['pages'] for r in rows),native_cell_and_image_checks=checks,native_text_verified=True,restored_pages_pixel_exact=len(cases),layout_verified=False)
(out/'summary.json').write_text(json.dumps(summary,indent=2)+'\n',encoding='utf-8');print(json.dumps(summary))
