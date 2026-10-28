"""Independent native images: leaf ink, ancestor frames, body tail and footers."""
import base64,json,re,sys
from pathlib import Path
from PIL import Image,ImageChops
root=Path(sys.argv[1]);out=root/'native';cases=json.loads((root/'cases.json').read_text(encoding='utf-8'));results={r['case']:r for r in json.loads((out/'results.json').read_text(encoding='utf-8'))}
def normalized(s):return re.sub(r'\s+','',re.sub(r'&#(\d+);',lambda m:chr(int(m[1])),s).encode('utf-16-le','surrogatepass').decode('utf-16-le'))
def bands(values,gap=1):
 groups=[]
 for n in values:
  if not groups or n>groups[-1][-1]+gap:groups.append([n])
  else:groups[-1].append(n)
 return groups
restored=0;checks=[]
for c in cases:
 name=c['name'];before=results[name+'-before'];after=results[name+'-after'];recovery=results[name+'-restored'];assert before['pages']==recovery['pages']
 edit=next((op for op in c['operations'] if op['type']=='splice_text'),None)
 expected=normalized(before['text']);old=normalized(edit['expected_old']) if edit else None
 if edit:assert expected.count(old)==1;expected=expected.replace(old,normalized(edit['new_text']),1)
 assert expected==normalized(after['text']),(name,'native text')
 for page in range(before['pages']):
  a=Image.open(out/f'{name}-before-{page}.bmp').convert('RGB');b=Image.open(out/f'{name}-restored-{page}.bmp').convert('RGB');assert ImageChops.difference(a,b).getbbox() is None;restored+=1
 markers=after['markers'];assert len(markers)==c['fixture']['lines']+2;pages=[m['page'] for m in markers[:-2]];assert pages==sorted(pages);assert min(pages)>=1 and max(pages)<=after['pages'];assert markers[-2]['page']>=max(pages)
 if c['fixture']['lines']>40:assert len(set(pages))>=2,(name,'long answer did not continue')
 encoded=edit['target_id'][70:] if edit else '';identity=base64.urlsafe_b64decode(encoded+'='*((-len(encoded))%4)).decode() if edit else 's0:';section=int(identity.split(':')[0][1:])
 tables=[t for t in c['after']['tables'] if t['section']==section];root_table=next(t for t in tables if not t.get('cell_path',[]));leaf=next((t for t in tables if t['id']==c['fixture'].get('selected_table_id')),None) or max(tables,key=lambda t:len(t.get('cell_path',[])));p=next(p['properties'] for p in c['after']['page_definitions'] if p['section']==section);left=(p['marginLeft']+p['marginGutter'])/75
 path=leaf.get('cell_path',[])
 for i,part in enumerate(path):
  t=next(t for t in tables if t.get('cell_path',[])==path[:i] and t['control']==part['controlIndex']);cell=next(c['properties'] for c in t['cells'] if c['cell']==part['cellIndex']);left+=(cell['paddingLeft'] if cell['applyInnerMargin'] else t['properties']['paddingLeft'])/75
 # Explicit table offsets include the preserved left outer margin in Hancom.
 for t in [leaf]:
  descriptor=next((d for d in c['after']['table_reflow'][0]['expected_tables'] if d['id']==t['id']),None)
  if descriptor:left+=descriptor['flow']['marginLeft']/75
 cell=leaf['cells'][0]['properties'];padding=cell['paddingLeft'] if cell['applyInnerMargin'] else leaf['properties']['paddingLeft'];right=left+cell['width']/75;content_left=round(left+padding/75);content_right=round(right-(cell['paddingRight'] if cell['applyInnerMargin'] else leaf['properties']['paddingRight'])/75)
 ink_bands=0;last_bottom=None
 for page in range(after['pages']):
  im=Image.open(out/f'{name}-after-{page}.bmp').convert('RGB');dark=lambda x,y:max(im.getpixel((x,y)))<180
  top=round((p['marginTop']+p['marginHeader'])/75);bottom=round((p['height']-p['marginBottom']-p['marginFooter'])/75)
  candidates=[]
  for x in range(round(left)-2,round(left)+3):
   spans=bands([y for y in range(top,bottom+3) if dark(x,y)]);spans=[s for s in spans if len(s)>=16]
   if spans:candidates.append((sum(map(len,spans)),x,spans))
  if page+1 in pages:
   assert candidates,(name,page,'leaf frame missing');_,x,spans=max(candidates);assert abs(x-left)<=2
   for span in spans:
    lo,hi=span[0]+2,span[-1]-1;ink_bands+=len(bands([y for y in range(lo,hi) if any(dark(xx,y) for xx in range(content_left,content_right))],gap=3))
  # A full outer table rule below the final answer must precede following body.
  if page+1==markers[-2]['page']:
   x0=round((p['marginLeft']+p['marginGutter'])/75);x1=round(x0+root_table['properties']['tableWidth']/75)
   rules=[y for y in range(top,bottom+3) if sum(dark(x,y) for x in range(x0+2,x1-2))>(x1-x0-4)*.95];assert rules or markers[-2]['page']>max(pages),(name,'outer frame missing');last_bottom=max(rules) if rules else top
   assert sum(dark(x,y) for y in range(last_bottom+3,bottom) for x in range(x0,x0+50))>30,(name,'body tail not below table')
  if c['fixture'].get('mode')=='footer':
   variant=c['fixture']['footer'].get('variant',0);old_page=page if page<before['pages'] else page%2 if variant else 0
   region=(100,round((p['height']-p['marginBottom']-10000)/75)+8,700,1090)
   present=variant==0 or (variant==1 and page%2==1) or (variant==2 and page%2==0)
   assert (ImageChops.difference(im.crop(region),Image.new('RGB',im.crop(region).size,'white')).getbbox() is not None)==present,(name,page,'footer parity/content')
   if present:assert old_page<before['pages'],(name,'missing original footer parity reference')
   prior=Image.open(out/f'{name}-before-{old_page}.bmp').convert('RGB') if present else Image.new('RGB',im.size,'white')
   difference=ImageChops.difference(prior.crop(region),im.crop(region));box=difference.getbbox()
   if c['fixture']['footer'].get('number') and page!=old_page and present:
    # Only the known generated page-number digit may differ. Title, second
    # paragraph, absolute vertical position and all other footer pixels match.
    assert box and 110<=box[0] and box[2]<=125 and 0<=box[1] and box[3]<=24,(name,page,box,'page number did not update in its original area')
   else:assert box is None,(name,page,'complex footer moved')
  elif c['fixture'].get('footer'):
   prior=Image.open(out/f'{name}-before-0.bmp').convert('RGB');region=(100,max(1010,bottom+3),700,1040);assert ImageChops.difference(prior.crop(region),im.crop(region)).getbbox() is None,(name,page,'footer moved')
 assert ink_bands>=c['fixture']['lines'],(name,ink_bands,'clipped leaf text')
 if c['fixture'].get('marked_ink'):
  red_bands=0;locations={label:[] for label in ['ANSWER']+c['fixture'].get('peer_labels',[])}
  for page in range(after['pages']):
   im=Image.open(out/f'{name}-after-marked-{page}.bmp').convert('RGB');original=Image.open(out/f'{name}-after-{page}.bmp').convert('RGB');reds=[]
   assert original.size==im.size
   for y in range(im.height):
    row=[]
    for x in range(im.width):
     r,g,b=im.getpixel((x,y));label=None
     if r>160 and g<100 and b<100:label='ANSWER';row.append(x)
     elif b>160 and r<100 and g<100:label=c['fixture']['peer_labels'][0]
     elif 80<g<200 and r<70 and b<70:label=c['fixture']['peer_labels'][1]
     if label:
      assert content_left-1<=x<content_right+1,(name,page,label,'ink outside selected cell')
      assert max(original.getpixel((x,y)))<240,(name,'QA color moved glyphs')
      locations[label].append((page,y))
    if row:
     reds.append(y)
     assert all(any(max(original.getpixel((xx,y)))<180 for xx in range(round(edge)-2,round(edge)+3)) for edge in [left,right]),(name,page,'visible answer lacks its cell frame')
   # Thin red antialiasing can leave a six-pixel gap inside one 10pt glyph;
   # the generated 160% line spacing leaves at least twelve between lines.
   groups=bands(reds,gap=8);red_bands+=len(groups)
   assert len(groups)==pages.count(page+1),(name,page,'found answer is not visible exactly once',len(groups),pages.count(page+1))
  assert red_bands==c['fixture']['lines'],(name,'clipped or overlapping marked answer')
  assert all(locations.values()),(name,'a peer table has no visible ink')
  if c['fixture'].get('multi'):
   labels=list(c['fixture']['peer_labels']);labels.insert(c['fixture'].get('selected',0),'ANSWER')
   for a,b in zip(labels,labels[1:]):assert max(locations[a])<min(locations[b]),(name,a,b,'sibling tables overlap or changed order')
 checks.append(dict(case=name,pages=after['pages'],marker_count=len(markers)-2,leaf_ink_bands=ink_bands,tail_below_outer_frame=True,footer_preserved=c['fixture'].get('mode')=='footer' or bool(c['fixture'].get('footer')),marked_visible_lines=red_bands if c['fixture'].get('marked_ink') else None,marked_peer_order_clear=True if c['fixture'].get('multi') else None))
summary=dict(status='PASS',documents=len(results),pages=sum(r['pages'] for r in results.values()),restored_pages_pixel_exact=restored,native_text_exact=True,checks=checks,layout_verified=False)
(out/'summary.json').write_text(json.dumps(summary,indent=2)+'\n',encoding='utf-8');print(json.dumps(summary))
