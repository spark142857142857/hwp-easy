"""Native visible ink order, actual table borders, no overlap and exact recovery."""
import json,re,sys
from pathlib import Path
from PIL import Image,ImageChops,ImageFilter
root=Path(sys.argv[1]);out=root/'native';cases=json.loads((root/'cases.json').read_text(encoding='utf-8'));results={r['case']:r for r in json.loads((out/'results.json').read_text(encoding='utf-8'))}
def normalized(s):return re.sub(r'\s+','',re.sub(r'&#(\d+);',lambda m:chr(int(m[1])),s).encode('utf-16-le','surrogatepass').decode('utf-16-le'))
def bands(ys,gap=8):
 groups=[]
 for y in ys:
  if not groups or y>groups[-1][-1]+gap:groups.append([y])
  else:groups[-1].append(y)
 return groups
def colored_components(image):
 r,g,b=image.split();maximum=ImageChops.lighter(r,ImageChops.lighter(g,b));minimum=ImageChops.darker(r,ImageChops.darker(g,b));mask=ImageChops.subtract(maximum,minimum).point(lambda v:255 if v>=70 else 0).filter(ImageFilter.MinFilter(3)).filter(ImageFilter.MaxFilter(5));rect=mask.getbbox()
 if rect is None:return []
 crop=mask.crop(rect);points={(x+rect[0],y+rect[1]) for y in range(crop.height) for x in range(crop.width) if crop.getpixel((x,y))};bounds=[]
 while points:
  first=points.pop();todo=[first];part=[first]
  while todo:
   x,y=todo.pop()
   for q in [(x-1,y),(x+1,y),(x,y-1),(x,y+1)]:
    if q in points:points.remove(q);todo.append(q);part.append(q)
  if len(part)>50:bounds.append((min(x for x,y in part),min(y for x,y in part),max(x for x,y in part)+1,max(y for x,y in part)+1))
 return bounds
checks=[];restored=0
for c in cases:
 name=c['name'];f=c['fixture'];before=results[name+'-before'];after=results[name+'-after'];recovery=results[name+'-restored'];assert before['pages']==recovery['pages'];expected=normalized(before['text']);edit=next((op for op in c['operations'] if op['type']=='splice_text'),None)
 if edit:
  old=normalized(edit['expected_old']);assert expected.count(old)==1;expected=expected.replace(old,normalized(edit['new_text']),1)
 for edit in (op for op in c['operations'] if op['type']=='set_field'):
  old=normalized(edit['expected_old']);assert expected.count(old)==1;expected=expected.replace(old,normalized(edit['new_text']),1)
 assert expected==normalized(after['text']),(name,'native text/order')
 for page in range(before['pages']):
  a=Image.open(out/f'{name}-before-{page}.bmp').convert('RGB');b=Image.open(out/f'{name}-restored-{page}.bmp').convert('RGB');assert ImageChops.difference(a,b).getbbox() is None;restored+=1
 tables=c['after']['tables'];leaf=next(t for t in tables if t['id']==f['selected_table_id']);p=next(p['properties'] for p in c['after']['page_definitions'] if p['section']==leaf['section']);left=(p['marginLeft']+p['marginGutter'])/75;path=leaf.get('cell_path',[])
 descriptors={t['id']:t for context in c['after']['table_reflow'] for t in context['expected_tables']}
 for i,part in enumerate(path):
  table=next(t for t in tables if t['section']==leaf['section'] and t['paragraph']==leaf['paragraph'] and t.get('cell_path',[])==path[:i] and t['control']==part['controlIndex']);cell=next(c['properties'] for c in table['cells'] if c['cell']==part['cellIndex']);left+=(cell['paddingLeft'] if cell['applyInnerMargin'] else table['properties']['paddingLeft'])/75;left+=descriptors.get(table['id'],{}).get('flow',{}).get('marginLeft',0)/75
 left+=descriptors.get(leaf['id'],{}).get('flow',{}).get('marginLeft',0)/75
 cell=leaf['cells'][0]['properties'];right=left+cell['width']/75;content_left=left+(cell['paddingLeft'] if cell['applyInnerMargin'] else leaf['properties']['paddingLeft'])/75;content_right=right-(cell['paddingRight'] if cell['applyInnerMargin'] else leaf['properties']['paddingRight'])/75
 def inline_left(obj):
  host=next(b for b in c['after']['blocks'] if b['id']==obj['block_id']);path=host.get('cell_path',[]);x=(p['marginLeft']+p['marginGutter'])/75
  for i,part in enumerate(path):
   table=next(t for t in tables if t['section']==host['section'] and t['paragraph']==host['paragraph'] and t.get('cell_path',[])==path[:i] and t['control']==part['controlIndex']);cell=next(v['properties'] for v in table['cells'] if v['cell']==part['cellIndex']);x+=(cell['paddingLeft'] if cell['applyInnerMargin'] else table['properties']['paddingLeft'])/75;x+=descriptors.get(table['id'],{}).get('flow',{}).get('marginLeft',0)/75
  return x+obj['flow']['marginLeft']/75
 palette={(g['color']&255,(g['color']>>8)&255,(g['color']>>16)&255):g['key'] for g in f['marked_groups']};locations={g['key']:[] for g in f['marked_groups']};answer_pages=[m['page'] for m in after['markers'][:-2]];assert answer_pages==sorted(answer_pages);assert len(set(answer_pages))>=2 if f['lines']>40 else True
 red_lines=0;picture_bounds=[];box_frames=[]
 if 'PICTURE' in f['flow_order']:locations['PICTURE']=[]
 for page in range(after['pages']):
  image=Image.open(out/f'{name}-after-marked-{page}.bmp').convert('RGB');original=Image.open(out/f'{name}-after-{page}.bmp').convert('RGB');assert image.size==original.size;red_ys=[];field_ys=[]
  edges=[]
  for edge in [left,right]:
   ys=[y for y in range(original.height) if any(max(original.getpixel((xx,y)))<180 for xx in range(round(edge)-1,round(edge)+2))];edges.append({y for span in bands(ys,gap=1) if len(span)>=16 for y in span})
  framed_rows=edges[0]&edges[1]
  box_rows=set();box_left=None
  if f.get('host_controls') and c['after']['text_boxes']:
   box=c['after']['text_boxes'][0];box_left=inline_left(box);box_right=box_left+box['properties']['width']/75;vertical=[]
   for edge in [box_left,box_right]:vertical.append({y for y in range(original.height) if any(max(original.getpixel((xx,y)))<180 for xx in range(round(edge)-1,round(edge)+2))})
   for span in bands(sorted(vertical[0]&vertical[1]),1):
    if abs(len(span)-box['properties']['height']/75)<=4:box_rows.update(span);box_frames.append(dict(page=page,top=span[0],bottom=span[-1],left=box_left,right=box_right))
  if f.get('host_controls') and c['after']['pictures']:
   picture=c['after']['pictures'][0];w=picture['properties']['width']/75;h=picture['properties']['height']/75;candidates=[r for r in colored_components(original) if abs(r[2]-r[0]-w)<=5 and abs(r[3]-r[1]-h)<=5];assert len(candidates)<=1,(name,page,'ambiguous native image')
   for bounds in candidates:
    assert abs(bounds[0]-inline_left(picture))<=4,(name,page,'native picture horizontal origin')
    assert all(y not in framed_rows for y in range(bounds[1]+2,bounds[3]-2)),(name,page,'picture overlaps answer cell');locations['PICTURE'].extend([(page,bounds[1]),(page,bounds[3]-1)]);picture_bounds.append(dict(page=page,bounds=bounds))
  for y in range(image.height):
   row=set()
   for x in range(image.width):
    key=palette.get(image.getpixel((x,y)))
    if key is None:continue
    # Native empty ClickHere guides may already use a palette color. They are
    # display cues, not answer ink; locate only pixels changed by QA marking.
    if f.get('host_controls') and image.getpixel((x,y))==original.getpixel((x,y)):continue
    assert max(original.getpixel((x,y)))<240,(name,page,key,'color-only QA moved glyphs');locations[key].append((page,y));row.add(key)
    if key=='ANSWER':assert content_left-1<=x<content_right+1,(name,page,'answer ink outside selected cell')
    if key=='BOX':assert y in box_rows and box_left<x<box_right,(name,page,'text outside native text-box frame')
   if 'ANSWER' in row:
    red_ys.append(y);assert y in framed_rows,(name,page,'answer missing actual cell frame')
   if f.get('host_controls') and f.get('sync') and 'BETWEEN1' in row:field_ys.append(y)
   # Surrounding text must be outside the selected leaf's vertical frame, not
   # merely below its final text line while still overlapping empty table area.
   if row.intersection({'PREFIX','BETWEEN1','BETWEEN2','SUFFIX','TAIL','END'}):assert y not in framed_rows,(name,page,'text inside selected table frame')
  groups=bands(red_ys);red_lines+=len(groups);assert len(groups)==answer_pages.count(page+1),(name,page,len(groups),answer_pages.count(page+1),'clipped visible answer')
  if f.get('host_controls') and f.get('sync'):assert len(bands(field_ys))==sum(v['page']==page+1 for v in after['field_lines']),(name,page,'clipped visible field lines')
  if f.get('footer_static'):
   region=(100,round((p['height']-p['marginBottom']-10000)/75)+8,700,1090);prior=Image.open(out/f'{name}-before-0.bmp').convert('RGB');assert ImageChops.difference(prior.crop(region),original.crop(region)).getbbox() is None,(name,page,'footer moved')
 assert red_lines==f['lines'];assert all(locations.values()),(name,'missing visible host text/peer')
 if f.get('host_controls'):assert len(picture_bounds)==len(c['after']['pictures']),(name,'missing native picture')
 if f.get('host_controls'):assert len(box_frames)==len(c['after']['text_boxes']),(name,'missing native text-box frame')
 for a,b in zip(f['flow_order'],f['flow_order'][1:]):assert max(locations[a])<min(locations[b]),(name,a,b,'visible order/overlap')
 checks.append(dict(case=name,pages=after['pages'],visible_answer_lines=red_lines,host_text_and_table_order_clear=True,actual_selected_cell_frame_verified=True,native_field_values_verified=len(after.get('native_fields',[])),picture_bounds=picture_bounds,text_box_frames=box_frames,footer_preserved=bool(f.get('footer_static'))))
summary=dict(status='PASS',documents=len(results),pages=sum(r['pages'] for r in results.values()),restored_pages_pixel_exact=restored,native_text_exact=True,checks=checks,layout_verified=False)
(out/'summary.json').write_text(json.dumps(summary,indent=2)+'\n',encoding='utf-8');print(json.dumps(summary))
