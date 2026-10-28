"""Original-color page/row/border oracle and byte/pixel-exact recovery."""
import hashlib,json,sys
from pathlib import Path
from PIL import Image,ImageChops
root=Path(sys.argv[1]);cases=json.loads((root/'cases.json').read_text(encoding='utf-8'));results={r['case']:r for r in json.loads((root/'native/results.json').read_text(encoding='utf-8'))}
def border_scores(im,f,threshold=180):
 p=im.load();x,y,w,h=[f[k] for k in ['x','y','w','h']]
 def dark(x,y):return 0<=x<im.width and 0<=y<im.height and max(p[x,y][:3])<threshold
 scores=[]
 for yy in [y,y+h]:scores.append(sum(any(dark(xx,round(yy)+d) for d in [-2,-1,0,1,2]) for xx in range(round(x)+2,round(x+w)-2))/max(1,round(x+w)-round(x)-4))
 for xx in [x,x+w]:scores.append(sum(any(dark(round(xx)+d,yy) for d in [-2,-1,0,1,2]) for yy in range(round(y)+2,round(y+h)-2))/max(1,round(y+h)-round(y)-4))
 return scores
frames=rows=restore_pages=pages=0;proof=[]
for case in cases:
 name=case['name'];before,after,restored=[results[name+'-'+s] for s in ['before','after','restored']];assert before['pages']==restored['pages']
 for page in range(before['pages']):assert ImageChops.difference(Image.open(root/f'native/{name}-before-{page}.bmp').convert('RGB'),Image.open(root/f'native/{name}-restored-{page}.bmp').convert('RGB')).getbbox() is None
 restore_pages+=before['pages']
 for stage,native in [('before',before),('after',after)]:
  assert hashlib.sha256((root/f'{name}-{stage}.hwp').read_bytes()).hexdigest()==native['input_sha256'];assert case[stage+'_layout']['page_count']==native['pages'],(name,stage,'page count')
  runs=json.loads((root/f'{name}-{stage}-runs.json').read_text(encoding='utf-8'));selected=[r for r in runs if r.get('cellPath')==case['fixture']['selected_path'] and r.get('parentParaIdx')==case[stage]['blocks'][next(i for i,b in enumerate(case['before']['blocks']) if b['target_id']==case['operations'][0]['target_id'])]['paragraph']];physical=[]
  for r in selected:
   if physical and physical[-1]['page']==r['page'] and abs(physical[-1]['y']-r['y'])<.3:physical[-1]['text']+=r['text']
   else:physical.append(dict(page=r['page'],y=r['y'],text=r['text']))
  assert [r['text'] for r in physical]==[r['text'] for r in native['rows']],(name,stage,'native rows',[r['text'] for r in physical],[r['text'] for r in native['rows']]);assert [r['page']+1 for r in physical]==[r['key'][0] for r in native['rows']],(name,stage,'row pages');rows+=len(physical)
  for b in native['body']:
   found=[r for r in runs if not r.get('cellPath') and r.get('paraIdx',0)<0xfffffff0 and r['text']==b['text']];assert len(found)==1 and found[0]['page']+1==b['page'],(name,stage,'body page',b)
  for page in range(native['pages']):
   controls=json.loads((root/f'{name}-{stage}-{page}-geometry.json').read_text(encoding='utf-8'));unique={tuple(f[k] for k in ['x','y','w','h']):f for t in controls if t['type']=='table' for f in [t,*t['cells']]};im=Image.open(root/f'native/{name}-{stage}-{page}.bmp').convert('RGB');preview=Image.open(root/f'{name}-{stage}-{page}-preview.png').convert('RGB')
   for f in unique.values():
    ns,ps=border_scores(im,f),border_scores(preview,f,230);assert min(ns)>.94,(name,stage,page,f,ns,'native');assert min(ps)>.94,(name,stage,page,f,ps,'shipped SVG');frames+=1
   pages+=1
 proof.append(dict(case=name,native_pages=before['pages']+after['pages']+restored['pages'],before_after_rows_and_body_pages_match=True,exact_restore_pixels=True))
summary=dict(status='PASS',cases=len(cases),native_documents=len(results),native_pages=sum(r['pages'] for r in results.values()),compared_pages=pages,border_frames=frames,selected_physical_rows=rows,restored_pixel_pages=restore_pages,no_color_edits=True,source_unchanged=True,complete_native_font_shapes_certified=False)
(root/'native-verified-summary.json').write_text(json.dumps(summary,indent=2)+'\n',encoding='utf-8');(root/'native-verified-cases.json').write_text(json.dumps(proof,indent=2)+'\n',encoding='utf-8');print(json.dumps(summary))
