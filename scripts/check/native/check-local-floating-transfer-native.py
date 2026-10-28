"""Native cell/column/section transfer checks on trusted synthetic fixtures."""
import json,math,re,sys
from pathlib import Path
from PIL import Image,ImageChops,ImageDraw
root=Path(sys.argv[1]);out=root/'native';cases=json.loads((root/'cases.json').read_text(encoding='utf-8'));rows=json.loads((out/'results.json').read_text(encoding='utf-8'));results={r['case']:r for r in rows}
def text(s):return re.sub(r'&#(\d+);',lambda m:chr(int(m[1])),s).encode('utf-16-le','surrogatepass').decode('utf-16-le').replace('\r','').replace('\n','').replace('\t','')
def image(n,s,p):return Image.open(out/f'{n}-{s}-{p}.bmp').convert('RGB')
def dark(im,x,y):return 0<=x<im.width and 0<=y<im.height and max(im.getpixel((x,y)))<180
def rectangle(im,p,w,h,ytol):
 x,y=p['x'],p['y']
 for left in range(round(x)-3,round(x)+4):
  for top in range(round(y)-ytol,round(y)+ytol+1):
   for dw in (-1,0,1):
    for dh in (-1,0,1):
     right=left+round(w)+dw;bottom=top+round(h)+dh
     if all(sum(dark(im,xx,yy) for yy in range(top+2,bottom-1))>=(h-4)*.9 for xx in (left,right)) and all(sum(dark(im,xx,yy) for xx in range(left+2,right-1))>=(w-4)*.9 for yy in (top,bottom)):return left,top,right,bottom
 raise AssertionError(('native frame not found',p,w,h))
def cell(im,p,tol):
 x,y,w,h=[p[k] for k in ('x','y','w','h')];lo=round(y+h*.7);hi=round(y+h*.95)
 vertical=lambda xx:sum(dark(im,xx,yy) for yy in range(lo,hi))>=(hi-lo)*.9
 lefts=[xx for xx in range(round(x)-tol,round(x)+tol+1) if vertical(xx)];rights=[xx for xx in range(round(x+w)-tol,round(x+w)+tol+1) if vertical(xx)];assert lefts and rights,('cell vertical edges',p)
 left=min(lefts,key=lambda n:abs(n-x));right=min(rights,key=lambda n:abs(n-x-w));start=round((left+right)/2);stop=right-2
 horizontal=lambda yy:sum(dark(im,xx,yy) for xx in range(start,stop))>=(stop-start)*.9
 tops=[yy for yy in range(round(y)-3,round(y)+4) if horizontal(yy)];bottoms=[yy for yy in range(round(y+h)-3,round(y+h)+4) if horizontal(yy)];assert tops and bottoms,('cell horizontal edges',p)
 return left,min(tops,key=lambda n:abs(n-y)),right,min(bottoms,key=lambda n:abs(n-y-h))
checks=[];restored=0;sheet=Image.new('RGB',(1200,len(cases)*290),'white');draw=ImageDraw.Draw(sheet)
for i,c in enumerate(cases):
 n=c['name'];before=results[n+'-before'];after=results[n+'-after'];recovery=results[n+'-restored'];assert before['pages']==after['pages']==recovery['pages'],(n,'page count')
 for page in range(before['pages']):assert ImageChops.difference(image(n,'before',page),image(n,'restored',page)).getbbox() is None,(n,page,'restore');restored+=1
 a=text(before['text']);b=text(after['text'])
 for p in c['before']['text_boxes'][0]['paragraphs']:
  value=text(p['text']);assert value and a.count(value)==b.count(value)==1;a=a.replace(value,'',1);b=b.replace(value,'',1)
 assert a==b,(n,'untargeted native text/order')
 p=c['verification']['placement'];page=p['page'];im=image(n,'after',page);prior=image(n,'before',page);props=c['after']['text_boxes'][0]['properties'];found=rectangle(im,p['after'],props['width']/75,props['height']/75,3 if 'projected_cell' in p else 16);left,top,right,bottom=found
 # This corpus starts the selected drawing outside its destination rectangle.
 # Unchanged native pixels in the destination give a direct collision check.
 gap=1;assert not any(dark(prior,xx,yy) for yy in range(top-gap,bottom+gap+1) for xx in range(left-gap,right+gap+1)),(n,'native destination collision',found)
 grid=None
 if 'projected_cell' in p:
  grid=cell(im,p['projected_cell'],math.ceil(p['inline_prefix_tolerance'])+3);cl,ct,cr,cb=grid;assert cl+2<=left and ct+2<=top and right<=cr-2 and bottom<=cb-2,(n,'outside actual destination cell')
 checks.append(dict(case=n,page=page,native_rectangle=found,actual_cell=grid,native_destination_clear=True,engine_to_native_delta=[round(left-p['after']['x'],2),round(top-p['after']['y'],2)]))
 for j,(label,picture) in enumerate([('before',image(n,'before',0)),('after',im)]):draw.text((j*600,i*290),f'{n} {label}',fill='black');region=(95,max(100,top-60),695,min(im.height,top+200));sheet.paste(picture.crop(region),(j*600,i*290+20))
sheet.save(out/'review.png');summary=dict(status='PASS',documents=len(rows),pages=sum(r['pages'] for r in rows),restored_pages_pixel_exact=restored,native_text_and_untargeted_order_verified=True,placement_checks=checks,layout_verified=False);(out/'summary.json').write_text(json.dumps(summary,indent=2)+'\n',encoding='utf-8');print(json.dumps(summary))
