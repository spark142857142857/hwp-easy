"""Actual Hancom border/visible-ink QA against the shipped SVG and exact undo.
Uses original-color images for borders; QA colors locate ink only. No HWP saves.
"""
import hashlib,json,sys,xml.etree.ElementTree as ET
from pathlib import Path
from PIL import Image,ImageChops
root=Path(sys.argv[1]);out=root/'native';cases=json.loads((root/'cases.json').read_text(encoding='utf-8'));results={r['case']:r for r in json.loads((out/'results.json').read_text(encoding='utf-8'))};proof=[]
def frames(path,depth):
 svg=ET.fromstring(path.read_text(encoding='utf-8'))
 return [{k:float(v) for k,v in list(e)[0].attrib.items()} for e in svg.iter() if e.tag.endswith('clipPath') and e.get('id','').startswith('cell-clip-')][:depth]
def runs(values):
 groups=[]
 for n in sorted(set(values)):
  if not groups or n>groups[-1][-1]+6:groups.append([n])
  else:groups[-1].append(n)
 return groups
for c in cases:
 name=c['name'];before,after,restored=[results[name+'-'+s] for s in ['before','after','restored']];assert before['pages']==restored['pages']
 for state,r in [('before',before),('after',after),('restored',restored)]:
  assert hashlib.sha256((root/(name+'-'+state+'.hwp')).read_bytes()).hexdigest()==r['input_sha256'];assert r['source_unchanged']
 for page in range(before['pages']):assert ImageChops.difference(Image.open(out/f'{name}-before-{page}.bmp').convert('RGB'),Image.open(out/f'{name}-restored-{page}.bmp').convert('RGB')).getbbox() is None
 for state in ['before','after']:
  fs=frames(root/(name+'-'+state+'.svg'),c['fixture']['depth']);assert len(fs)==c['fixture']['depth'];im=Image.open(out/f'{name}-{state}-0.bmp').convert('RGB');pix=im.load()
  for f in fs:
   x,y,w,h=[f[k] for k in ['x','y','width','height']]
   def dark(x,y):return 0<=x<im.width and 0<=y<im.height and max(pix[x,y])<180
   # Both horizontal edges and both vertical edges must be visible at the
   # actual SVG frame (allow raster quantization, never relocate by content).
   scores=[]
   for yy in [y,y+h]:scores.append(sum(any(dark(xx,round(yy)+d) for d in [-1,0,1,2]) for xx in range(round(x)+2,round(x+w)-2))/max(1,round(x+w)-round(x)-4))
   for xx in [x,x+w]:scores.append(sum(any(dark(round(xx)+d,yy) for d in [-1,0,1]) for yy in range(round(y)+2,round(y+h)-2))/max(1,round(y+h)-round(y)-4))
   assert min(scores)>.95,(name,state,f,scores)
  proof.append(dict(case=name,state=state,frames=len(fs),all_original_color_edges_match_shipped_svg=True))
 fs=frames(root/(name+'-after.svg'),c['fixture']['depth']);frame=fs[0];bottom=round(frame['y']+frame['height']);marked=Image.open(out/f'{name}-after-marked-0.bmp').convert('RGB');original=Image.open(out/f'{name}-after-0.bmp').convert('RGB');mp=marked.load();op=original.load();found={}
 for key,color in [('PREFIX',(255,0,0)),('ANSWER',(255,0,255)),('PEER',(0,0,255))]:
  pixels=[(x,y) for y in range(round(frame['y'])+2,bottom-1) for x in range(round(frame['x'])+2,round(frame['x']+frame['width'])-2) if all(abs(mp[x,y][i]-color[i])<65 for i in range(3)) and max(op[x,y])<220]
  assert pixels,(name,key,'no original visible ink');found[key]=dict(x=min(x for x,y in pixels),y=min(y for x,y in pixels),bottom=max(y for x,y in pixels),bands=len(runs(y for x,y in pixels)))
 assert found['ANSWER']['bands']==c['fixture']['lines'],(name,found)
 assert found['PREFIX']['bottom']<fs[1]['y'],(name,'prefix overlaps child table')
 c['native_render_proof']=dict(original_color_frames_match_shipped_svg=True,visible_answer_lines=found['ANSWER']['bands'],prefix_above_child=True,ink=found,exact_restore_pixels=True)
# Ancestor prefixes/table origins must not drift with middle/bottom cell flags;
# ordinary peer text must still move with its original alignment.
for prefix in ['nested','deep']:
 rows=[c for c in cases if c['name'] in [prefix+'-top',prefix+'-middle',prefix+'-bottom']];assert len(rows)==3
 assert len({round(frames(root/(c['name']+'-after.svg'),c['fixture']['depth'])[1]['y'],1) for c in rows})==1
 assert rows[0]['native_render_proof']['ink']['PEER']['y']<rows[1]['native_render_proof']['ink']['PEER']['y']<rows[2]['native_render_proof']['ink']['PEER']['y']
summary=dict(status='PASS',cases=len(cases),documents=len(results),pages=sum(r['pages'] for r in results.values()),svg_native_frame_checks=sum(p['frames'] for p in proof),visible_answer_lines=sum(c['native_render_proof']['visible_answer_lines'] for c in cases),exact_restore_pixel_pages=sum(results[c['name']+'-before']['pages'] for c in cases),original_images_used_for_geometry=True,layout_verified=False)
(out/'nested-render-proof.json').write_text(json.dumps(dict(summary=summary,frames=proof,cases=[dict(name=c['name'],proof=c['native_render_proof']) for c in cases]),indent=2)+'\n',encoding='utf-8');(out/'summary.json').write_text(json.dumps(summary,indent=2)+'\n',encoding='utf-8');print(json.dumps(summary))
