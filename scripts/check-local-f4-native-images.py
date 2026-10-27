"""Pixel/geometry oracle over original-color native F4 page BMPs (Pillow)."""
import json,sys,math
from pathlib import Path
from PIL import Image,ImageChops
root=Path(sys.argv[1]);native=root/(sys.argv[2] if len(sys.argv)>2 else 'native')
cases=json.loads((root/'cases.json').read_text(encoding='utf-8'));results=json.loads((native/'results.json').read_text(encoding='utf-8'));corners=json.loads((root/'native-shape-corners.json').read_text(encoding='utf-8'))
restored=0;checked_corners=0;siblings=0;body_checks=0
def img(name,stage,page=0):return Image.open(native/(f'{name}-{stage}-{page}.bmp')).convert('RGB')
for case in cases:
 name=case['name'];states={r['stage']:r for r in results if r['case']==name};assert states['before']['pages']==states['after']['pages']==states['restored']['pages']
 assert states['before']['body']==states['after']['body']==states['restored']['body'],(name,'body flow changed');body_checks+=len(states['before']['body'])
 for page in range(states['before']['pages']):assert ImageChops.difference(img(name,'before',page),img(name,'restored',page)).getbbox() is None,(name,'restored pixels');restored+=1
 for stage in ['before','after']:
  image=img(name,stage);pixels=image.load()
  for frame in corners[name+'-'+stage]:
   for x,y in frame:
    px,py=round(x),round(y);assert 0<=px<image.width and 0<=py<image.height,(name,stage,x,y,image.size)
    nearby=[max(pixels[a,b]) for a in range(max(0,px-2),min(image.width,px+3)) for b in range(max(0,py-2),min(image.height,py+3))]
    assert min(nearby)<110,(name,stage,'native frame corner differs from raw transform',x,y);checked_corners+=1
 regions=[]
 if name=='picture-subgroup-transform':regions=[(25,345,184,396)]
 elif name=='mixed-subgroup-transform':regions=[(25,438,78,490)]
 elif name in ['subgroup-transform','subgroup-transform-text']:regions=[(25,398,323,496)]
 elif name=='nested-group-text':regions=[(185,265,323,363),(25,398,323,496)]
 elif name=='group-identical':regions=[(25,265,163,363)]
 elif name not in ['group-boundaries','root-transform','body-field-metadata','body-hyperlink-cache','body-date-cache']:regions=[(185,265,323,363)]
 for region in regions:
  if name in ['picture-subgroup-transform','mixed-subgroup-transform']:assert sum(img(name,'before').crop(region).convert('L').histogram()[:240])>100,(name,'empty sibling comparison region')
  assert ImageChops.difference(img(name,'before').crop(region),img(name,'after').crop(region)).getbbox() is None,(name,'untouched sibling pixels');siblings+=1
 if name in ['group-field-metadata','body-field-metadata']:assert ImageChops.difference(img(name,'before'),img(name,'after')).getbbox() is None,(name,'metadata-only visible change')
summary=dict(status='PASS',documents=len(results),native_pages=sum(r['pages'] for r in results),restored_pixel_pages=restored,raw_transform_native_corners=checked_corners,unchanged_sibling_regions=siblings,unchanged_body_positions=body_checks,native_original_colors=True,layout_verified=False)
(root/'native-image-summary.json').write_text(json.dumps(summary,indent=2)+'\n',encoding='utf-8');print(json.dumps(summary))
