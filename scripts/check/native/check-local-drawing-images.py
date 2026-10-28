"""Independent geometry, color-position, paint-order and exact recovery checks."""
import json,sys,math
from pathlib import Path
import numpy as np
from PIL import Image,ImageDraw
root=Path(sys.argv[1]);cases=json.loads((root/'cases.json').read_text(encoding='utf-8'));native=json.loads((root/'native/results.json').read_text(encoding='utf-8'));corners=json.loads((root/'native-shape-corners.json').read_text(encoding='utf-8'))
def image(name,stage,page=0,svg=False):return Image.open(root/(f'{name}-{stage}-{page}.png' if svg else f'native/{name}-{stage}-{page}.bmp')).convert('RGB')
def mask(im,kind):
 a=np.asarray(im).astype(np.int16);r,g,b=[a[:,:,i] for i in range(3)]
 # Exclude ClearType's colored fringes on the black body text.
 target=(34,85,187) if kind=='blue' else (204,34,85)
 # The Native oracle uses discrete subpixel levels; resvg uses grayscale AA.
 # The 34-base channel is disjoint from black text's subpixel palette.
 channel=r if kind=='blue' else g
 native=np.any(np.abs(channel[:,:,None]-np.array([34,78,117,154,189,222]))<=1,axis=2)
 alpha=np.stack([(255-v)/(255-c) for v,c in zip([r,g,b],target)],axis=2)
 grayscale=alpha.max(axis=2)-alpha.min(axis=2)<.025
 broad=(b-r>55)&(b-g>25)&(r<170) if kind=='blue' else (r-g>65)&(r-b>35)&(g<165)
 return broad&(native|grayscale)
def bounds(points,pad=3):
 xs,ys=zip(*points);return (max(0,math.floor(min(xs))-pad),max(0,math.floor(min(ys))-pad),math.ceil(max(xs))+pad,math.ceil(max(ys))+pad)
def covered(point,polygon):
 # These fixtures use opaque white rectangle fills in raw child paint order.
 x,y=point;inside=False;distance=math.inf
 for (a,b),(c,d) in zip(polygon,polygon[1:]+polygon[:1]):
  if (b>y)!=(d>y) and x<(c-a)*(y-b)/(d-b)+a:inside=not inside
  dx,dy=c-a,d-b;u=max(0,min(1,((x-a)*dx+(y-b)*dy)/(dx*dx+dy*dy)));distance=min(distance,math.hypot(x-a-u*dx,y-b-u*dy))
 return inside and distance>2
reports=[];frame_corners=restores=regions=occluded=0;selected=[]
for case in cases:
 name=case['name'];st={r['stage']:r for r in native if r['case']==name};assert st['before']['body']==st['after']['body']==st['restored']['body'],(name,'body changed');assert st['before']['pages']==st['after']['pages']==st['restored']['pages']
 for p in range(st['before']['pages']):
  assert image(name,'before',p).tobytes()==image(name,'restored',p).tobytes(),(name,'native restore',p)
  assert image(name,'before',p,True).tobytes()==image(name,'restored',p,True).tobytes(),(name,'preview restore',p);restores+=1
 for stage in ['before','after']:
  expected=next(r for r in case['rendered'] if r['stage']==stage);assert expected['pages']==st[stage]['pages'],(name,stage,'page count')
  # Every generated control uses a paper-relative origin. The page owning the
  # host is independently checked by the presence of its colored native ink.
  frames=corners[name+'-'+stage]
  ink_pages=[p for p in range(st[stage]['pages']) if mask(image(name,stage,p),'blue').sum()+mask(image(name,stage,p),'magenta').sum()>0];assert len(ink_pages)==1,(name,stage,ink_pages);page=ink_pages[0]
  im=image(name,stage,page);sv=image(name,stage,page,True);a=np.asarray(im);b=np.asarray(sv)
  for i,points in enumerate(frames):
   for x,y in points:
    if any(covered((x,y),later) for later in frames[i+1:]):occluded+=1;continue
    xx,yy=round(x),round(y);assert 0<=xx<a.shape[1] and 0<=yy<a.shape[0],(name,stage,'corner outside')
    assert a[max(0,yy-2):yy+3,max(0,xx-2):xx+3].max(axis=2).min()<180,(name,stage,'native corner',x,y)
    if stage=='after':assert b[max(0,yy-2):yy+3,max(0,xx-2):xx+3].max(axis=2).min()<210,(name,stage,'preview corner',x,y)
    frame_corners+=1
  if stage=='after':
   for color in ['blue','magenta']:
    n,s=mask(im,color),mask(sv,color);assert bool(n.sum())==bool(s.sum()),(name,color,'visible paint order',int(n.sum()),int(s.sum()))
    if not n.sum():continue
    # Compare layout independently of HCR/Nanum glyph outlines. Each visible
    # source line must have matching first-glyph left/bottom anchors; all ink
    # must also fit the union of those line envelopes. Whole-word widths and
    # font shapes are deliberately not certified by this oracle.
    runs=json.loads((root/f'{name}-after-{page}-runs.json').read_text(encoding='utf-8'));groups={};envelope=np.zeros_like(n)
    for run in runs:
     if run.get('render_drawing_text') and run['text'].strip() and run['textColor']=={'blue':'#2255bb','magenta':'#cc2255'}[color]:groups.setdefault((run['source_paragraph_id'],round(run['y'],1)),[]).append(run)
    for key,line in groups.items():
     x=min(v['x'] for v in line);y=min(v['y'] for v in line);right=max(v['x']+v['w'] for v in line);bottom=max(v['y']+v['h'] for v in line)
     l,t=max(0,math.floor(x)-2),max(0,math.floor(y)-7);r,bt=math.ceil(x+min(12,right-x)),math.ceil(bottom)+2;anchors=[]
     for ink in [n,s]:
      yy,xx=np.where(ink[t:bt,l:r]);assert len(xx),(name,color,key,'missing line anchor');anchors.append([int(xx.min())+l,int(yy.max())+t])
     delta=max(abs(a-b) for a,b in zip(*anchors));assert delta<=3,(name,color,key,'line anchor',anchors)
     # Native font ascenders differ by up to 5 px in these fixtures; horizontal
     # advances differ as well. Keep that known font difference separate.
     envelope[t:bt,max(0,math.floor(x)-3):math.ceil(right)+12]=True
     reports.append(dict(case=name,paragraph=key[0],color=color,anchors=anchors,max_anchor_delta_px=delta));regions+=1
    coverage=float((n&envelope).sum()/n.sum());assert coverage>.99,(name,color,'unexpected line ink',coverage)
   selected.append((name,im,sv,frames))
thumbs=[]
for name,a,b,frames in selected:
 points=[p for f in frames for p in f];roi=bounds(points,15);a=a.crop(roi);b=b.crop(roi);a.thumbnail((320,260));b.thumbnail((320,260));tile=Image.new('RGB',(660,290),'#e5e7eb');tile.paste(a,(8,25));tile.paste(b,(338,25));ImageDraw.Draw(tile).text((8,6),name+' / Native - preview',fill='black');thumbs.append(tile)
sheet=Image.new('RGB',(1320,math.ceil(len(thumbs)/2)*290),'#e5e7eb')
for i,tile in enumerate(thumbs):sheet.paste(tile,((i%2)*660,(i//2)*290))
sheet.save(root/'native-preview-contact-sheet.png')
result=dict(status='PASS',cases=len(cases),native_documents=len(native),native_pages=sum(r['pages'] for r in native),restored_native_and_preview_pages=restores,frame_corners=frame_corners,corners_occluded_by_later_opaque_rectangles=occluded,text_line_anchors=regions,line_anchor_tolerance_px=3,frame_corner_tolerance_px=2,native_body_positions_unchanged=True,font_shapes_and_word_widths_verified=False,layout_verified=False,regions=reports)
(root/'native-image-summary.json').write_text(json.dumps(result,indent=2)+'\n',encoding='utf-8');print(json.dumps({k:v for k,v in result.items() if k!='regions'}))
