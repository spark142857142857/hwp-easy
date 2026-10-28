"""Independent OLE proof of source font definitions and requested per-unit styles."""
import json,struct,sys
from pathlib import Path
from local_table_raw_proof import load,records
root=Path(sys.argv[1]);cases=json.loads((root/'cases.json').read_text(encoding='utf-8'))
def styles(payload,length):
 runs=[struct.unpack_from('<II',payload,i) for i in range(0,len(payload),8)];assert runs[0][0]==0
 return [v for i,(start,v) in enumerate(runs) for _ in range((runs[i+1][0] if i+1<len(runs) else length)-start)]
for c in cases:
 name=c['name'];pb,b=load(root/(name+'-before.hwp'));pa,a=load(root/(name+'-after.hwp'));assert (root/(name+'-before.hwp')).read_bytes()==(root/(name+'-restored.hwp')).read_bytes()
 assert set(pb)-{'PrvText','PrvImage'}==set(pa)-{'PrvText','PrvImage'}
 for key in pb:
  if key not in ['DocInfo','BodyText/Section0','PrvText','PrvImage']:assert pb[key]==pa[key],(name,key)
 db,da=records(b['DocInfo']),records(a['DocInfo']);old_shapes=[r[2] for r in db if r[0]==21];new_shapes=[r[2] for r in da if r[0]==21];assert new_shapes[:len(old_shapes)]==old_shapes
 left=[r for r in db if r[0]!=21];right=[r for r in da if r[0]!=21];assert len(left)==len(right)
 for (tag,lev,x),(tag2,lev2,y) in zip(left,right):
  assert (tag,lev)==(tag2,lev2);x,y=bytearray(x),bytearray(y)
  if tag==17:x[36:40]=y[36:40]=bytes(4)
  assert x==y,(name,tag,'original shared definitions')
 rb=[r for r in records(b['BodyText/Section0']) if r[0]!=69];ra=[r for r in records(a['BodyText/Section0']) if r[0]!=69];assert len(rb)==len(ra)
 op=c['operations'][0];old_text=(op['expected_old']+'\r').encode('utf-16le');new_text=(op['new_text']+'\r').encode('utf-16le');selected=next(i for i,r in enumerate(rb) if r[0]==67 and r[2]==old_text);base=styles(rb[selected+1][2],len(old_text)//2);assert len(set(base))==1
 expected=[old_shapes[base[0]]]*(len(new_text)//2);permitted=set(old_shapes)
 font_records=[r[2] for r in db if r[0]==19];counts=struct.unpack_from('<7I',next(r[2] for r in db if r[0]==17),4)
 for fmt in c['operations'][1:]:
  assert fmt['type']=='format_text';props=fmt['props'];assert set(props)<={'fontFamily','fontSize','bold'};font_ids=[];at=0
  if 'fontFamily' in props:
   for count in counts:
    names=[p[3:3+2*struct.unpack_from('<H',p,1)[0]].decode('utf-16le') for p in font_records[at:at+count]];font_ids.append(names.index(props['fontFamily']));at+=count
  for index in range(fmt['start'],fmt['end']):
   p=bytearray(expected[index])
   if font_ids:struct.pack_into('<7H',p,0,*font_ids)
   if 'fontSize' in props:struct.pack_into('<I',p,42,props['fontSize'])
   if 'bold' in props:struct.pack_into('<I',p,46,(struct.unpack_from('<I',p,46)[0]&~2)|(2 if props['bold'] else 0))
   expected[index]=bytes(p);permitted.add(bytes(p))
 assert all(p in permitted for p in new_shapes)
 actual=styles(ra[selected+1][2],len(new_text)//2);assert [new_shapes[i] for i in actual]==expected,(name,'requested source styles')
 for index,((tag,lev,old),(tag2,lev2,new)) in enumerate(zip(rb,ra)):
  assert (tag,lev)==(tag2,lev2);x,y=bytearray(old),bytearray(new)
  if index==selected:assert new==new_text;continue
  if index==selected+1:continue
  if tag==66:
   x[16:18]=y[16:18]=bytes(2)
   if index==selected-1:
    assert struct.unpack_from('<I',new,4)[0]==(struct.unpack_from('<I',old,4)[0]&~1024)|(1024 if '\n' in op['new_text'] else 0)
    x[:8]=y[:8]=bytes(8);x[12:14]=y[12:14]=bytes(2)
  elif tag==71 and old[:4]==b' lbt':
   mask=1|4|(3<<3)|(7<<5)|(3<<8)|(7<<10)|(1<<13)|(1<<14)|(1<<20)|(7<<21)|(3<<24);assert struct.unpack_from('<I',old,4)[0]&~mask==struct.unpack_from('<I',new,4)[0]&~mask
   x[4:16]=y[4:16]=bytes(12);x[20:24]=y[20:24]=bytes(4)
   if len(x)>=46 and len(x)==46+struct.unpack_from('<H',x,44)[0]*2:x[40:44]=y[40:44]=bytes(4)
  elif tag==72:x[20:24]=y[20:24]=bytes(4)
  elif tag==77:assert struct.unpack_from('<I',old)[0]&~3==struct.unpack_from('<I',new)[0]&~3;x[:4]=y[:4]=bytes(4)
  assert x==y,(name,tag,lev,'unrequested body bytes')
summary=dict(status='PASS',cases=len(cases),original_font_and_paragraph_definitions_exact=True,requested_per_character_source_styles_verified=True,other_body_bytes_and_streams_exact=True,exact_restore=True)
(root/'independent-summary.json').write_text(json.dumps(summary,indent=2)+'\n',encoding='utf-8');print(json.dumps(summary))
