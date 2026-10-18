"""Native synthetic image/TEXT verification; requires Pillow, never edits HWP."""
import json,re,sys
from pathlib import Path
from PIL import Image,ImageChops,ImageDraw
root=Path(sys.argv[1]);out=root/'native';cases=json.loads((root/'cases.json').read_text(encoding='utf-8'));results={r['case']:r for r in json.loads((out/'results.json').read_text(encoding='utf-8'))};restored=0;footer_checks=[];body_geometry_checks=[]
def text(value):return re.sub(r'&#(\d+);',lambda m:chr(int(m[1])),value).encode('utf-16-le','surrogatepass').decode('utf-16-le').replace('\r','').replace('\n','').replace('\t','')
for c in cases:
 name=c['name'];before=results[name+'-before'];after=results[name+'-after'];recovery=results[name+'-restored'];assert before['pages']==recovery['pages']
 for p in range(before['pages']):
  a=Image.open(out/f'{name}-before-{p}.bmp').convert('RGB');b=Image.open(out/f'{name}-restored-{p}.bmp').convert('RGB');assert ImageChops.difference(a,b).getbbox() is None,(name,p,'recovery');restored+=1
 expected=text(before['text'])
 for op in c['operations']:
  if op['type']=='splice_text_box':
   old=op['expected_old'];new=old[:op['start']]+op['new_text']+old[op['end']:]
   if old:expected=expected.replace(text(old),text(new),1)
   else:expected=None
 if expected is not None:assert text(after['text'])==expected,(name,'native text')
 for b in c['after']['text_boxes']:
  for p in b['paragraphs']:assert text(p['text']) in text(after['text']),(name,'box text')
 for b in c['after']['blocks']:
  if b['text']:assert text(b['text']) in text(after['text']),(name,'body/cell text')
 if name in ('geometry-body','geometry-and-text'):
  for state in ['before','after']:
   image=Image.open(out/f'{name}-{state}-0.bmp').convert('RGB');p=c[state]['text_boxes'][0]['properties'];x,y,w,h=[p[k]/75 for k in ('horzOffset','vertOffset','width','height')]
   dark=lambda xx,yy:max(image.getpixel((xx,yy)))<180
   for edge in [x,x+w]:
    assert any(sum(dark(xx,yy) for yy in range(round(y)+2,round(y+h)-1))>=(h-3)*.9 for xx in range(round(edge)-2,round(edge)+3)),(name,state,'native vertical frame edge',edge)
   for edge in [y,y+h]:
    assert any(sum(dark(xx,yy) for xx in range(round(x)+2,round(x+w)-1))>=(w-3)*.9 for yy in range(round(edge)-2,round(edge)+3)),(name,state,'native horizontal frame edge',edge)
  body_geometry_checks.append(dict(case=name,before_after_rectangle_edges_match_hwp_units=True))
 if any(op['type']=='protect_page_bottom' for op in c['operations']):
  # The real footer is at this page coordinate before and after; shrinking the
  # body must never lift it. Compare its whole text strip on every output page.
  original=Image.open(out/f'{name}-before-0.bmp').convert('RGB').crop((100,1005,700,1035))
  assert original.getextrema()!=((255,255),(255,255),(255,255)),(name,'footer must be visible')
  for p in range(after['pages']):
   changed=Image.open(out/f'{name}-after-{p}.bmp').convert('RGB').crop((100,1005,700,1035));assert ImageChops.difference(original,changed).getbbox() is None,(name,p,'fixed footer moved')
  if name.startswith('fixed-footer'):
   prior=Image.open(out/f'{name}-before-0.bmp').convert('RGB').crop((105,920,195,975));changed=Image.open(out/f'{name}-after-0.bmp').convert('RGB').crop((105,920,195,975))
   assert prior.getextrema()!=((255,255),(255,255),(255,255)),(name,'original body conflict must be visible')
   assert changed.getextrema()==((255,255),(255,255),(255,255)),(name,'body did not clear fixed region')
  footer_checks.append(dict(case=name,before_pages=before['pages'],after_pages=after['pages'],footer_pixels_exact=True))
names=[c['name'] for c in cases];sheet=Image.new('RGB',(1200,len(names)*320),'white');draw=ImageDraw.Draw(sheet)
for i,name in enumerate(names):
 for j,state in enumerate(['before','after']):
  draw.text((j*600,i*320),name+' '+state,fill='black');im=Image.open(out/f'{name}-{state}-0.bmp').convert('RGB');region=(95,850,680,1100) if name.startswith(('fixed-footer','reserve-footer')) else (95,120,680,415);sheet.paste(im.crop(region),(j*600,i*320+20))
sheet.save(out/'review.png');summary=dict(status='PASS',documents=len(results),pages=sum(r['pages'] for r in results.values()),native_text_verified=True,restored_pages_pixel_exact=restored,fixed_footer_checks=footer_checks,body_geometry_pixel_checks=body_geometry_checks,layout_verified=False)
(out/'summary.json').write_text(json.dumps(summary,indent=2)+'\n',encoding='utf-8');print(json.dumps(summary))
