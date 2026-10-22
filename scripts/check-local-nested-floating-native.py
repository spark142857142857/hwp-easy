"""Verify actual nested-cell borders, floating rectangle, native text and recovery."""
import json,math,re,sys
from pathlib import Path
from PIL import Image,ImageChops,ImageDraw
root=Path(sys.argv[1]);out=root/'native';cases=json.loads((root/'cases.json').read_text(encoding='utf-8'));rows=json.loads((out/'results.json').read_text(encoding='utf-8'));results={r['case']:r for r in rows}
def text(s):return re.sub(r'&#(\d+);',lambda m:chr(int(m[1])),s).encode('utf-16-le','surrogatepass').decode('utf-16-le').replace('\r','').replace('\n','').replace('\t','')
def image(name,state):return Image.open(out/f'{name}-{state}-0.bmp').convert('RGB')
def dark(im,x,y):return 0<=x<im.width and 0<=y<im.height and max(im.getpixel((x,y)))<180
def rectangle(im,p):
    x,y,w,h=[p[k] for k in ('x','y','w','h')]
    for left in range(round(x)-3,round(x)+4):
        for top in range(round(y)-3,round(y)+4):
            for dw in (-1,0,1):
                for dh in (-1,0,1):
                    right=left+round(w)+dw;bottom=top+round(h)+dh
                    if all(sum(dark(im,xx,yy) for yy in range(top+2,bottom-1))>=(h-4)*.9 for xx in (left,right)) and all(sum(dark(im,xx,yy) for xx in range(left+2,right-1))>=(w-4)*.9 for yy in (top,bottom)):return left,top,right,bottom
    raise AssertionError(('native floating frame',p))
def cell(im,p,tolerance):
    x,y,w,h=[p[k] for k in ('x','y','w','h')];lo=round(y+h*.7);hi=round(y+h*.95)
    vertical=lambda xx:sum(dark(im,xx,yy) for yy in range(lo,hi))>=(hi-lo)*.9
    xs=[xx for xx in range(round(x)-tolerance,round(x)+tolerance+1) if vertical(xx)]
    rights=[xx for xx in range(round(x+w)-tolerance,round(x+w)+tolerance+1) if vertical(xx)];assert xs and rights,('native cell vertical edges',p,xs,rights)
    left=min(xs,key=lambda n:abs(n-x));right=min(rights,key=lambda n:abs(n-x-w));start=round((left+right)/2);stop=right-2
    horizontal=lambda yy:sum(dark(im,xx,yy) for xx in range(start,stop))>=(stop-start)*.9
    ys=[yy for yy in range(round(y)-3,round(y)+4) if horizontal(yy)];bottoms=[yy for yy in range(round(y+h)-3,round(y+h)+4) if horizontal(yy)];assert ys and bottoms,('native cell horizontal edges',p,ys,bottoms)
    return left,min(ys,key=lambda n:abs(n-y)),right,min(bottoms,key=lambda n:abs(n-y-h))
checks=[];sheet=Image.new('RGB',(1200,len(cases)*300),'white');draw=ImageDraw.Draw(sheet)
assert cases,'No native cases were supplied'
for i,c in enumerate(cases):
    name=c['name'];a=image(name,'before');b=image(name,'after');r=image(name,'restored');assert all(results[name+'-'+s]['pages']==1 for s in ('before','after','restored'));assert ImageChops.difference(a,r).getbbox() is None,(name,'restore pixels');assert text(results[name+'-before']['text'])==text(results[name+'-after']['text']),(name,'native text/order')
    p=c['verification']['placement'];box=rectangle(b,p['after']);tolerance=math.ceil(p['inline_prefix_tolerance'])+3;grid=cell(b,p['projected_cell'],tolerance);prior=cell(a,p['projected_cell'],tolerance);assert grid==prior,(name,'cell geometry moved')
    left,top,right,bottom=box;cl,ct,cr,cb=grid;assert left>=cl+2 and top>=ct+2 and right<=cr-2 and bottom<=cb-2,(name,'box outside actual nested cell',box,grid)
    # Exclude the old selected frame and its text; the remaining native ink
    # independently checks cell text/sibling objects for all alignments.
    old=p['before'];in_old=lambda xx,yy:old['x']-4<=xx<=old['x']+old['w']+4 and old['y']-4<=yy<=old['y']+old['h']+4
    ink=[(xx,yy) for yy in range(ct+3,cb-2) for xx in range(cl+3,cr-2) if not in_old(xx,yy) and dark(a,xx,yy)]
    assert not any(left-1<=xx<=right+1 and top-1<=yy<=bottom+1 for xx,yy in ink),(name,'box intersects native cell text',box,grid)
    assert all(dark(b,xx,yy) for xx,yy in ink),(name,'native text position changed')
    difference=ImageChops.difference(a,b)
    masked=ImageDraw.Draw(difference)
    for bounds in (p['before'],p['after']):
        masked.rectangle((math.floor(bounds['x'])-4,math.floor(bounds['y'])-4,math.ceil(bounds['x']+bounds['w'])+4,math.ceil(bounds['y']+bounds['h'])+4),fill='black')
    assert difference.getbbox() is None,(name,'non-target native page ink moved')
    checks.append(dict(case=name,depth=len(c['after']['text_boxes'][0]['cell_path']),actual_cell=grid,actual_box=box,cell_edges_unchanged=True,native_text_ink_clear=True))
    region=(max(0,cl-45),max(0,ct-30),min(b.width,cr+250),min(b.height,cb+35))
    for j,(label,im) in enumerate([('before',a),('after',b)]):draw.text((j*600,i*300),f'{name} {label}',fill='black');sheet.paste(im.crop(region),(j*600,i*300+20))
sheet.save(out/'review.png');summary=dict(status='PASS',documents=len(rows),pages=sum(r['pages'] for r in rows),native_cell_and_floating_frame_checks=checks,native_text_verified=True,restored_pages_pixel_exact=len(cases),layout_verified=False)
(out/'summary.json').write_text(json.dumps(summary,indent=2)+'\n',encoding='utf-8');print(json.dumps(summary))
