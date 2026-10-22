"""Unmodified native pixels: wrapped/mixed-size text, real borders and recovery.

Foreground-color marking can itself change Hancom's narrow-cell line layout.
Use the isolated synthetic answer cell's original ink and native caret lines.
"""
import json,re,sys
from pathlib import Path
from PIL import Image,ImageChops
root=Path(sys.argv[1]);out=root/'native';cases=json.loads((root/'cases.json').read_text(encoding='utf-8'));results={r['case']:r for r in json.loads((out/'results.json').read_text(encoding='utf-8'))}
def normalize(s):return re.sub(r'\s+','',re.sub(r'&#(\d+);',lambda m:chr(int(m[1])),s).encode('utf-16-le','surrogatepass').decode('utf-16-le'))
def bands(ys,gap=6):
 groups=[]
 for y in ys:
  if not groups or y>groups[-1][-1]+gap:groups.append([y])
  else:groups[-1].append(y)
 return groups
checks=[];restored=0
for c in cases:
 name=c['name'];f=c['fixture'];before=results[name+'-before'];after=results[name+'-after'];recovery=results[name+'-restored'];assert before['pages']==recovery['pages'];expected=normalize(before['text'])
 for op in c['operations']:
  if op['type']=='splice_text':
   old=normalize(op['expected_old']);assert expected.count(old)==1;text=op['expected_old'];expected=expected.replace(old,normalize(text[:op['start']]+op['new_text']+text[op['end']:]),1)
 assert expected==normalize(after['text']),(name,'native text/order')
 for page in range(before['pages']):
  a=Image.open(out/f'{name}-before-{page}.bmp').convert('RGB');b=Image.open(out/f'{name}-restored-{page}.bmp').convert('RGB');assert ImageChops.difference(a,b).getbbox() is None;restored+=1
 tables=c['after']['tables'];leaf=next(t for t in tables if t['id']==f['selected_table_id']);p=next(p['properties'] for p in c['after']['page_definitions'] if p['section']==leaf['section']);left=(p['marginLeft']+p['marginGutter'])/75;path=leaf.get('cell_path',[])
 for i,part in enumerate(path):
  table=next(t for t in tables if t['section']==leaf['section'] and t['paragraph']==leaf['paragraph'] and t.get('cell_path',[])==path[:i] and t['control']==part['controlIndex']);cell=next(c['properties'] for c in table['cells'] if c['cell']==part['cellIndex']);left+=(cell['paddingLeft'] if cell['applyInnerMargin'] else table['properties']['paddingLeft'])/75
 right=left+leaf['cells'][0]['properties']['width']/75;positions=sorted({(m['page'],m['line']) for m in after['answer_positions']});assert positions;visible=0;ink_bounds=[]
 for page in range(after['pages']):
  image=Image.open(out/f'{name}-after-{page}.bmp').convert('RGB');edges=[]
  for edge in [left,right]:
   ys=[y for y in range(image.height) if any(min(image.getpixel((xx,y)))<160 for xx in range(round(edge)-1,round(edge)+2))];edges.append({y for span in bands(ys,1) if len(span)>=16 for y in span})
  frame=edges[0]&edges[1];ys=[];points=[];x0=round(left)+2;x1=round(right)-1
  for y in sorted(frame):
   ink=[x for x in range(x0,x1) if min(image.getpixel((x,y)))<160]
   if not ink or len(ink)>.9*(x1-x0):continue # horizontal border
   ys.append(y);points.extend((x,y) for x in ink)
  spans=bands(ys);count=sum(v[0]==page+1 for v in positions);assert len(spans)==count,(name,page,len(spans),count,'visible wrapped lines')
  # Require a clear interior row on either side of every glyph group. A border
  # or adjacent cell cannot stand in for a missing line in this isolated cell.
  for span in spans:assert span[0]-1 in frame and span[-1]+1 in frame,(name,page,'ink touches top/bottom frame')
  visible+=len(spans)
  if points:
   assert min(x for x,y in points)>left+1 and max(x for x,y in points)<right-1,(name,page,'ink touches side frame')
   ink_bounds.append(dict(page=page+1,left=min(x for x,y in points),right=max(x for x,y in points),top=min(y for x,y in points),bottom=max(y for x,y in points)))
 assert visible==len(positions);assert after['markers'][-2]['page']>=positions[-1][0];assert after['markers'][-1]['page']>=after['markers'][-2]['page'];assert visible>=f['lines']
 checks.append(dict(case=name,pages=after['pages'],logical_lines=f['lines'],visible_physical_lines=visible,actual_cell_frame=True,native_caret_lines_match_original_ink=True,ink_bounds=ink_bounds))
summary=dict(status='PASS',documents=len(results),pages=sum(r['pages'] for r in results.values()),restored_pages_pixel_exact=restored,native_text_exact=True,original_pixels_without_color_edits=True,checks=checks,layout_verified=False)
(out/'summary.json').write_text(json.dumps(summary,indent=2)+'\n',encoding='utf-8');print(json.dumps(summary))
