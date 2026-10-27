"""Pillow-only native pixel checks plus independent SVG/native page membership."""
import json,re,sys,xml.etree.ElementTree as ET
from pathlib import Path
from PIL import Image,ImageDraw

root=Path(sys.argv[1]).resolve();native=root/'native';summary=json.loads((native/'summary.json').read_text(encoding='utf-8'));results={r['stage']:r for r in summary['results']}
for original,restored in [('blank','restored-blank'),('filled','restored-filled'),('filled','revised')]:
 assert results[original]['pages']==results[restored]['pages']
 for p in range(results[original]['pages']):
  a=Image.open(native/f'{original}-{p}.bmp').convert('RGB');b=Image.open(native/f'{restored}-{p}.bmp').convert('RGB');assert a.size==b.size and a.tobytes()==b.tobytes(),(original,restored,p)
for stage,result in results.items():assert result['pages']==result['preview_pages'],stage
svg_text={p:re.sub(r'\s+','',''.join(ET.parse(root/f'long-{p}.svg').getroot().itertext())) for p in range(results['long']['pages'])}
matches=0
for found in results['long']['positions']:
 if not re.match(r'^사례\d{3}$',found['text']):continue
 pages=[p+1 for p,text in svg_text.items() if found['text'] in text];assert pages==[found['page']],(found,pages);matches+=1
assert matches==80
# Every native page has actual ink, with the repeated footer inside the paper.
reference=Image.open(native/'blank-0.bmp').convert('L')
footer_box=(100,reference.height-110,reference.width-100,reference.height-65)
reference_footer=reference.crop(footer_box).tobytes()
for stage,result in results.items():
 for p in range(result['pages']):
  image=Image.open(native/f'{stage}-{p}.bmp').convert('L');assert image.width>700 and image.height>1000
  assert sum(image.histogram()[:128])>1000,(stage,p)
  footer=image.crop(footer_box);assert sum(footer.histogram()[:180])>100,(stage,p,'footer');assert footer.tobytes()==reference_footer,(stage,p,'footer pixels')
files=[native/f'{r["stage"]}-{p}.bmp' for r in summary['results'] for p in range(r['pages'])]
sheet=Image.new('RGB',(4*320,((len(files)+3)//4)*465),'#e5e7eb');draw=ImageDraw.Draw(sheet)
for i,file in enumerate(files):
 image=Image.open(file).convert('RGB');image.thumbnail((304,432));x=(i%4)*320+8;y=(i//4)*465+25;sheet.paste(image,(x,y));draw.text((x,y-19),file.stem,fill='black')
sheet.save(root/'native-contact-sheet.png')
report=dict(status='PASS',native_documents=len(results),native_pages=len(files),same_native_and_preview_page_counts=True,long_answer_markers_on_same_page=matches,restored_pixels_exact=True,revised_equals_original_filled_pixels=True,all_pages_have_ink_and_footer=True,footer_pixels_match_blank=True)
(root/'native-image-summary.json').write_text(json.dumps(report,indent=2)+'\n',encoding='utf-8');print(json.dumps(report))
