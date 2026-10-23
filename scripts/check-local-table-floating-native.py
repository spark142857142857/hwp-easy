"""Original native image bounds, visible ink, table separation and exact restore."""
import hashlib,json,re,sys
from pathlib import Path
from PIL import Image,ImageChops,ImageFilter
root=Path(sys.argv[1]);out=root/'native';cases=json.loads((root/'cases.json').read_text(encoding='utf-8'));results={r['case']:r for r in json.loads((out/'results.json').read_text(encoding='utf-8'))}
def normal(s):return re.sub(r'\s+','',s)
def bands(ys,gap=1):
 groups=[]
 for y in sorted(ys):
  if not groups or y>groups[-1][-1]+gap:groups.append([y])
  else:groups[-1].append(y)
 return groups
def image_components(image):
 r,g,b=image.split();mask=ImageChops.subtract(ImageChops.lighter(r,ImageChops.lighter(g,b)),ImageChops.darker(r,ImageChops.darker(g,b))).point(lambda v:255 if v>=70 else 0).filter(ImageFilter.MinFilter(3)).filter(ImageFilter.MaxFilter(5));rect=mask.getbbox()
 if rect is None:return []
 crop=mask.crop(rect);points={(x+rect[0],y+rect[1])for y in range(crop.height)for x in range(crop.width)if crop.getpixel((x,y))};parts=[]
 while points:
  first=points.pop();todo=[first];part=[first]
  while todo:
   x,y=todo.pop()
   for q in [(x-1,y),(x+1,y),(x,y-1),(x,y+1)]:
    if q in points:points.remove(q);todo.append(q);part.append(q)
  if len(part)>50:parts.append((min(x for x,y in part),min(y for x,y in part),max(x for x,y in part)+1,max(y for x,y in part)+1))
 return parts
checks=[];restored=0
for c in cases:
 name=c['name'];f=c['fixture'];before=results[name+'-before'];after=results[name+'-after'];recovery=results[name+'-restored'];assert before['pages']==recovery['pages'];expected=normal(before['text'])
 for edit in (op for op in c['operations'] if op['type']=='splice_text'):
  old=normal(edit['expected_old']);assert expected.count(old)==1;expected=expected.replace(old,normal(edit['new_text']),1)
 assert expected==normal(after['text'])
 for state in ['before','after','restored']:assert results[name+'-'+state]['input_sha256']==hashlib.sha256((root/f'{name}-{state}.hwp').read_bytes()).hexdigest()
 for page in range(before['pages']):assert ImageChops.difference(Image.open(out/f'{name}-before-{page}.bmp').convert('RGB'),Image.open(out/f'{name}-restored-{page}.bmp').convert('RGB')).getbbox() is None;restored+=1
 p=c['after']['page_definitions'][0]['properties'];body_left=(p['marginLeft']+p['marginGutter'])/75;body_top=(p['marginTop']+p['marginHeader'])/75;body_bottom=(p['height']-p['marginBottom']-p['marginFooter'])/75;root_table=next(t for t in c['after']['tables'] if not t.get('cell_path'));right=body_left+root_table['properties']['tableWidth']/75
 locations={g['key']:[] for g in f['marked_groups'] if g['labels']};palette={(g['color']&255,(g['color']>>8)&255,(g['color']>>16)&255):g['key'] for g in f['marked_groups']};frames=[];pictures=[];visible=0
 objects=c['after']['pictures']+c['after']['text_boxes'];assert all(not o['flow']['treatAsChar'] for o in objects)
 for page in range(after['pages']):
  original=Image.open(out/f'{name}-after-{page}.bmp').convert('RGB');marked=Image.open(out/f'{name}-after-marked-{page}.bmp').convert('RGB')
  def edge_rows(x):return {y for y in range(original.height) if any(max(original.getpixel((xx,y)))<180 for xx in range(round(x)-1,round(x)+2))}
  table_rows={y for span in bands(edge_rows(body_left)&edge_rows(right)) if len(span)>=20 for y in span};page_frames=[];page_images=[]
  for box in c['after']['text_boxes']:
   x=body_left+box['properties']['horzOffset']/75;r=x+box['properties']['width']/75;h=box['properties']['height']/75
   for span in bands(edge_rows(x)&edge_rows(r)):
    if abs(len(span)-h)<=4:
     bounds=(x,span[0],r,span[-1]+1);assert span[0]>=body_top-3 and span[-1]<=body_bottom+3;assert not set(span[2:-2])&table_rows,(name,'box/table overlap');frames.append((page,bounds));page_frames.append(bounds)
  for pic in c['after']['pictures']:
   p2=pic['properties'];w=p2['width']/75;h=p2['height']/75;x=body_left+p2['horzOffset']/75
   for bounds in image_components(original):
    if abs(bounds[2]-bounds[0]-w)<=5 and abs(bounds[3]-bounds[1]-h)<=5:
     assert abs(bounds[0]-x)<=4;assert bounds[1]>=body_top-3 and bounds[3]<=body_bottom+3;assert not set(range(bounds[1]+2,bounds[3]-2))&table_rows,(name,'picture/table overlap');
     if (page,bounds) not in pictures:pictures.append((page,bounds));page_images.append(bounds)
  for a in page_frames:
   for b in page_images:assert a[3]<=b[1] or b[3]<=a[1] or a[2]<=b[0] or b[2]<=a[0],(name,'picture/box overlap')
  ys=[];body_ys=[]
  for y in range(marked.height):
   for x in range(marked.width):
    key=palette.get(marked.getpixel((x,y)))
    if key is None:continue
    assert max(original.getpixel((x,y)))<240,(name,'QA changed original glyph position');locations[key].append((page,y))
    if key=='ANSWER':assert y in table_rows;ys.append(y)
    if key=='BODY':assert y not in table_rows;body_ys.append(y)
    if key=='BOX':assert any(a[0]<x<a[2] and a[1]<y<a[3] for a in page_frames),(name,'hidden box text')
    if key in ['TAIL','END']:assert y not in table_rows and all(not (a[0]-2<=x<a[2]+2 and a[1]-2<=y<a[3]+2) for a in page_frames+page_images),(name,'hidden following body')
  if f.get('body_labels'):assert len(bands(set(body_ys),8))==sum(v['page']==page+1 for v in after['body_positions']),(name,'hidden preceding body')
  visible+=len(bands(set(ys),8));assert len(bands(set(ys),8))==sum(m['page']==page+1 for m in after['markers'][:-2])
  if f.get('footer'):
   prior=Image.open(out/f'{name}-before-0.bmp').convert('RGB');region=(0,round(body_bottom)+8,original.width,original.height);assert ImageChops.difference(prior.crop(region),original.crop(region)).getbbox() is None,(name,'footer changed')
 assert visible==f['lines'];assert all(locations.values()),(name,{k:len(v) for k,v in locations.items()});assert len(frames)==len(c['after']['text_boxes']);assert len(pictures)==len(c['after']['pictures'])
 box_iter=iter(frames);picture_iter=iter(pictures);sequence=[('box',next(box_iter)) if kind=='box' else ('picture',next(picture_iter)) for kind in f['objects']]
 ordered=[(page,bounds[1],bounds[3]) for kind,(page,bounds) in sequence]
 for a,b in zip(ordered,ordered[1:]):assert a[0]<b[0] or a[0]==b[0] and a[2]<b[1]
 last=max((page,bounds[3]) for page,bounds in frames+pictures);assert last<min(locations['TAIL']);assert max(locations['TAIL'])<min(locations['END']);assert max(locations['ANSWER'])<min((page,bounds[1]) for page,bounds in frames+pictures)
 if f.get('samePage'):assert after['pages']==1 and all(p==0 for p,bounds in frames+pictures),(name,'unnecessary page break')
 if f.get('migrate'):assert before['pages']>after['pages']==1,(name,'managed break did not reduce pages')
 checks.append(dict(case=name,pages=after['pages'],visible_answer_lines=visible,picture_bounds=pictures,text_box_frames=frames,following_body_visible=True,footer_preserved=bool(f.get('footer'))))
summary=dict(status='PASS',documents=len(results),pages=sum(r['pages'] for r in results.values()),restored_pages_pixel_exact=restored,native_text_exact=True,input_sha256_verified=True,checks=checks,layout_verified=False)
(out/'summary.json').write_text(json.dumps(summary,indent=2)+'\n',encoding='utf-8');print(json.dumps(summary))
