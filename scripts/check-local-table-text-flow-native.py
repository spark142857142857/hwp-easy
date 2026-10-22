"""Native visible ink order, actual table borders, no overlap and exact recovery."""
import json,re,sys
from pathlib import Path
from PIL import Image,ImageChops
root=Path(sys.argv[1]);out=root/'native';cases=json.loads((root/'cases.json').read_text(encoding='utf-8'));results={r['case']:r for r in json.loads((out/'results.json').read_text(encoding='utf-8'))}
def normalized(s):return re.sub(r'\s+','',re.sub(r'&#(\d+);',lambda m:chr(int(m[1])),s).encode('utf-16-le','surrogatepass').decode('utf-16-le'))
def bands(ys,gap=8):
 groups=[]
 for y in ys:
  if not groups or y>groups[-1][-1]+gap:groups.append([y])
  else:groups[-1].append(y)
 return groups
checks=[];restored=0
for c in cases:
 name=c['name'];f=c['fixture'];before=results[name+'-before'];after=results[name+'-after'];recovery=results[name+'-restored'];assert before['pages']==recovery['pages'];expected=normalized(before['text']);edit=next((op for op in c['operations'] if op['type']=='splice_text'),None)
 if edit:
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
 palette={(g['color']&255,(g['color']>>8)&255,(g['color']>>16)&255):g['key'] for g in f['marked_groups']};locations={g['key']:[] for g in f['marked_groups']};answer_pages=[m['page'] for m in after['markers'][:-2]];assert answer_pages==sorted(answer_pages);assert len(set(answer_pages))>=2 if f['lines']>40 else True
 red_lines=0
 for page in range(after['pages']):
  image=Image.open(out/f'{name}-after-marked-{page}.bmp').convert('RGB');original=Image.open(out/f'{name}-after-{page}.bmp').convert('RGB');assert image.size==original.size;red_ys=[]
  edges=[]
  for edge in [left,right]:
   ys=[y for y in range(original.height) if any(max(original.getpixel((xx,y)))<180 for xx in range(round(edge)-1,round(edge)+2))];edges.append({y for span in bands(ys,gap=1) if len(span)>=16 for y in span})
  framed_rows=edges[0]&edges[1]
  for y in range(image.height):
   row=set()
   for x in range(image.width):
    key=palette.get(image.getpixel((x,y)))
    if key is None:continue
    assert max(original.getpixel((x,y)))<240,(name,page,key,'color-only QA moved glyphs');locations[key].append((page,y));row.add(key)
    if key=='ANSWER':assert content_left-1<=x<content_right+1,(name,page,'answer ink outside selected cell')
   if 'ANSWER' in row:
    red_ys.append(y);assert y in framed_rows,(name,page,'answer missing actual cell frame')
   # Surrounding text must be outside the selected leaf's vertical frame, not
   # merely below its final text line while still overlapping empty table area.
   if row.intersection({'PREFIX','BETWEEN1','BETWEEN2','SUFFIX','TAIL','END'}):assert y not in framed_rows,(name,page,'text inside selected table frame')
  groups=bands(red_ys);red_lines+=len(groups);assert len(groups)==answer_pages.count(page+1),(name,page,len(groups),answer_pages.count(page+1),'clipped visible answer')
  if f.get('footer_static'):
   region=(100,round((p['height']-p['marginBottom']-10000)/75)+8,700,1090);prior=Image.open(out/f'{name}-before-0.bmp').convert('RGB');assert ImageChops.difference(prior.crop(region),original.crop(region)).getbbox() is None,(name,page,'footer moved')
 assert red_lines==f['lines'];assert all(locations.values()),(name,'missing visible host text/peer')
 for a,b in zip(f['flow_order'],f['flow_order'][1:]):assert max(locations[a])<min(locations[b]),(name,a,b,'visible order/overlap')
 checks.append(dict(case=name,pages=after['pages'],visible_answer_lines=red_lines,host_text_and_table_order_clear=True,actual_selected_cell_frame_verified=True,footer_preserved=bool(f.get('footer_static'))))
summary=dict(status='PASS',documents=len(results),pages=sum(r['pages'] for r in results.values()),restored_pages_pixel_exact=restored,native_text_exact=True,checks=checks,layout_verified=False)
(out/'summary.json').write_text(json.dumps(summary,indent=2)+'\n',encoding='utf-8');print(json.dumps(summary))
