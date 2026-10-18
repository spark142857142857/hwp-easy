"""Native page/rectangle checks for the trusted F1 package corpus (Pillow)."""
import json,re,sys
from pathlib import Path
from PIL import Image,ImageChops,ImageDraw
root=Path(sys.argv[1]);out=root/'native';cases=json.loads((root/'cases.json').read_text(encoding='utf-8'));rows=json.loads((out/'results.json').read_text(encoding='utf-8'));results={r['case']:r for r in rows}
def text(s):return re.sub(r'&#(\d+);',lambda m:chr(int(m[1])),s).encode('utf-16-le','surrogatepass').decode('utf-16-le').replace('\r','').replace('\n','').replace('\t','')
def image(name,state,page):return Image.open(out/f'{name}-{state}-{page}.bmp').convert('RGB')
def rectangle(im,x,y,w,h,tolerance):
    dark=lambda a,b:0<=a<im.width and 0<=b<im.height and max(im.getpixel((a,b)))<180
    for left in range(round(x)-tolerance,round(x)+tolerance+1):
        for top in range(round(y)-tolerance,round(y)+tolerance+1):
            for dw in (-1,0,1):
                for dh in (-1,0,1):
                    right=left+round(w)+dw;bottom=top+round(h)+dh
                    if all(sum(dark(xx,yy) for yy in range(top+2,bottom-1))>=(h-4)*.9 for xx in (left,right)) and all(sum(dark(xx,yy) for xx in range(left+2,right-1))>=(w-4)*.9 for yy in (top,bottom)):return left,top,right,bottom
    raise AssertionError(('rectangle not found',x,y,w,h))
restored=0;rectangles=[];page_moves=[]
for c in cases:
    name=c['name'];before=results[name+'-before'];after=results[name+'-after'];recovery=results[name+'-restored'];assert before['pages']==recovery['pages']==after['pages']
    for page in range(before['pages']):
        assert ImageChops.difference(image(name,'before',page),image(name,'restored',page)).getbbox() is None,(name,page,'restore');restored+=1
    a=text(before['text']);b=text(after['text'])
    for box in c['before'].get('text_boxes',[]):
        for p in box['paragraphs']:
            value=text(p['text']);assert value and a.count(value)==b.count(value)==1;a=a.replace(value,'',1);b=b.replace(value,'',1)
    assert a==b,(name,'non-target native text/order')
    place=c['verification']['placement'];page=place['page'];assert page<after['pages'];im=image(name,'after',page)
    if c['after'].get('text_boxes'):
        props=c['after']['text_boxes'][0]['properties'];x,y=place['after']['x'],place['after']['y'];w,h=props['width']/75,props['height']/75
        found=rectangle(im,x,y,w,h,16 if name.startswith('cell-') else 3)
        if name.startswith('cell-'):
            assert len(c['after']['text_boxes'][0]['cell_path'])==1,'nested cell native coordinates are unverified'
            # Find the actual native table grid, independent of WASM's y origin.
            grid=[]
            for yy in range(120,700):
                if sum(max(im.getpixel((xx,yy)))<180 for xx in range(114,672))>550:grid.append(yy)
            edges=[v for i,v in enumerate(grid) if not i or v-grid[i-1]>2];assert len(edges)>=3,(name,'native table grid')
            left,top,right,bottom=found;assert left>=115 and right<=391 and top>=edges[0]+18 and bottom<=edges[1]-2,(name,'box must clear cell border and host text',found,edges)
        rectangles.append(dict(case=name,page=page,native_rectangle=found,cell_bounds_checked=name.startswith('cell-')))
    if name.startswith('page-'):
        assert page==1 and place['previous_page']==0
        # A moved picture/group has visible color only on its new page.
        if name in ('page-group','page-picture'):
            def colored(im):
                raw=im.tobytes();return sum(max(r,g,b)-min(r,g,b)>40 for r,g,b in zip(raw[0::3],raw[1::3],raw[2::3]))
            assert colored(im)>colored(image(name,'before',page))+1000 and colored(image(name,'after',0))<colored(image(name,'before',0))-1000,(name,'native image page')
        page_moves.append(dict(case=name,previous_page=0,page=page,native_opened=True))
sheet=Image.new('RGB',(1200,len(cases)*295),'white');draw=ImageDraw.Draw(sheet)
for i,c in enumerate(cases):
    for j,state in enumerate(['before','after']):
        page=0 if state=='before' else c['verification']['placement']['page'];draw.text((j*600,i*295),f'{c["name"]} {state} page {page}',fill='black');sheet.paste(image(c['name'],state,page).crop((95,120,695,390)),(j*600,i*295+20))
sheet.save(out/'review.png');summary=dict(status='PASS',documents=len(rows),pages=sum(r['pages'] for r in rows),native_text_and_untargeted_order_verified=True,restored_pages_pixel_exact=restored,rectangle_checks=rectangles,page_moves=page_moves,layout_verified=False)
(out/'summary.json').write_text(json.dumps(summary,indent=2)+'\n',encoding='utf-8');print(json.dumps(summary))
