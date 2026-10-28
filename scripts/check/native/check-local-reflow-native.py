"""Optional Pillow verification of native TEXT, visible line spacing and recovery pixels."""
import json,re,sys
from pathlib import Path
from PIL import Image,ImageChops,ImageDraw
root=Path(sys.argv[1]);out=root/'native';cases=json.loads((root/'cases.json').read_text(encoding='utf-8'));results={r['case']:r for r in json.loads((out/'results.json').read_text(encoding='utf-8'))};restored=0;line_checks=[]
def text(value):return re.sub(r'&#(\d+);',lambda m:chr(int(m[1])),value).encode('utf-16-le','surrogatepass').decode('utf-16-le').replace('\r','').replace('\n','')
for c in cases:
 name=c['name'];before=results[name+'-before'];after=results[name+'-after'];recovery=results[name+'-restored'];assert before['pages']==recovery['pages']
 for page in range(before['pages']):
  a=Image.open(out/(name+'-before-'+str(page)+'.bmp')).convert('RGB');b=Image.open(out/(name+'-restored-'+str(page)+'.bmp')).convert('RGB');assert ImageChops.difference(a,b).getbbox() is None;restored+=1
 assert text(before['text'])==text(after['text']),name
 assert all(text(b['text']) in text(after['text']) for b in c['after']['blocks'] if b['text']),name
 if name.startswith('fixed-body'):
  bands=[]
  for page in range(after['pages']):
   im=Image.open(out/(name+'-after-'+str(page)+'.bmp')).convert('RGB');rows=[]
   for y in range(110,1030):
    ink=sum(1 for x in range(110,500) if max(im.getpixel((x,y)))<160)
    if ink>=2:rows.append(y)
   groups=[]
   for y in rows:
    if not groups or y>groups[-1][-1]+3:groups.append([y])
    else:groups[-1].append(y)
   assert all(b[0]-a[-1]>=4 for a,b in zip(groups,groups[1:])),(name,page,'lines touch')
   bands.extend(groups)
  # 60 answer lines + heading + tail. Each must form a separate visible ink band.
  assert len(bands)==62,(name,len(bands));assert after['pages']==2,(name,after['pages']);line_checks.append(dict(case=name,visible_lines=62,pages=2,ink_lines_separated=True))
names=['fixed-body-true','fixed-field-false','fixed-field-true','floating-group-false','floating-group-true','floating-picture'];sheet=Image.new('RGB',(1000,len(names)*400),'white');draw=ImageDraw.Draw(sheet)
for i,name in enumerate(names):
 for j,state in enumerate(['before','after']):
  draw.text((j*500,i*400),name+' '+state,fill='black');im=Image.open(out/(name+'-'+state+'-0.bmp')).convert('RGB');sheet.paste(im.crop((95,120,580,500)),(j*500,i*400+20))
sheet.save(out/'review.png');summary=dict(status='PASS',documents=len(results),pages=sum(r['pages'] for r in results.values()),native_text_exact=True,restored_pages_pixel_exact=restored,visible_line_checks=line_checks,layout_verified=False)
(out/'summary.json').write_text(json.dumps(summary,indent=2)+'\n',encoding='utf-8');print(json.dumps(summary))
