"""Independent OLE checks: offsets only, footer compensation, text runs, recovery."""
import json,sys,struct,zlib
from pathlib import Path
import olefile
root=Path(sys.argv[1] if len(sys.argv)>1 else 'outputs/local-placement-check')
def load(path):
 with olefile.OleFileIO(path) as doc: packed={'/'.join(n):doc.openstream(n).read() for n in doc.listdir()}
 compressed=struct.unpack_from('<I',packed['FileHeader'],36)[0]&1
 return packed,{k:zlib.decompress(v,-15) if compressed and (k=='DocInfo' or k.startswith('BodyText/')) else v for k,v in packed.items()}
def records(data):
 out=[];at=0
 while at<len(data):
  head,=struct.unpack_from('<I',data,at);at+=4;size=head>>20
  if size==4095:size,=struct.unpack_from('<I',data,at);at+=4
  assert at+size<=len(data);out.append((head&1023,(head>>10)&1023,data[at:at+size]));at+=size
 assert at==len(data)
 return out
def materialize_empty(rs):
 out=[]
 for i,r in enumerate(rs):
  out.append(r)
  if r[0]==66 and r[1]>=3 and r[1]%2==1 and rs[i+1][0]==68:out.append((67,r[1]+1,b'\r\0'))
 return out
def styles(payload,length):
 runs=[struct.unpack_from('<II',payload,i) for i in range(0,len(payload),8)];assert runs[0][0]==0
 result=[]
 for n,(start,style) in enumerate(runs):result.extend([style]*((runs[n+1][0] if n+1<len(runs) else length)-start))
 assert len(result)==length
 return result
cases=json.loads((root/'cases.json').read_text(encoding='utf-8'))
for c in cases:
 name=c['name'];before=root/(name+'-before.hwp');after=root/(name+'-after.hwp');assert before.read_bytes()==(root/(name+'-restored.hwp')).read_bytes(),name
 pb,b=load(before);pa,a=load(after);assert set(pb)==set(pa)
 for k in pb:
  if k not in ('BodyText/Section0','DocInfo','PrvText','PrvImage'):assert pb[k]==pa[k],(name,k)
 rb=materialize_empty([r for r in records(b['BodyText/Section0']) if r[0]!=69]);ra=materialize_empty([r for r in records(a['BodyText/Section0']) if r[0]!=69]);assert len(rb)==len(ra),(name,len(rb),len(ra))
 splice=next((o for o in c['operations'] if o['type']=='splice_text_box'),None);changed_text=0;changed_styles=0
 transform=next((o for o in c['operations'] if o['type']=='transform_text_box'),None);geometry_counts={71:0,76:0,79:0}
 if transform:
  assert len(c['before']['text_boxes'])==1 and sum(o['type']=='transform_text_box' for o in c['operations'])==1
  geometry_wanted={**transform['expected_properties'],**transform['props']}
 for i,((tag,level,old),(tag2,level2,new)) in enumerate(zip(rb,ra)):
  assert (tag,level)==(tag2,level2)
  x=bytearray(old);y=bytearray(new)
  if tag==66:
   for lo,hi in [(0,8),(8,10),(12,14),(16,18)]:x[lo:hi]=y[lo:hi]=bytes(hi-lo)
   assert x==y,(name,'paragraph header')
  elif tag==71 and old[:4]==b' osg':
   if any(o['type']=='reposition_floating_object' for o in c['operations']):x[8:16]=y[8:16]=bytes(8)
   if transform:
    for at,key,fmt in [(8,'vertOffset','<i'),(12,'horzOffset','<i'),(16,'width','<I'),(20,'height','<I')]:
     assert struct.unpack_from(fmt,old,at)[0]==transform['expected_properties'][key];struct.pack_into(fmt,x,at,geometry_wanted[key])
    geometry_counts[71]+=1
   assert x==y,(name,'flow/geometry')
  elif transform and tag==76:
   assert old[:4]==b'cer$';base=8 if old[:4]==old[4:8] else 4
   for at,key in [(12,'width'),(16,'height'),(20,'width'),(24,'height')]:struct.pack_into('<I',x,base+at,geometry_wanted[key])
   assert x==y,(name,'rectangle component only');geometry_counts[76]+=1
  elif transform and tag==79:
   for n,value in enumerate([0,0,geometry_wanted['width'],0,geometry_wanted['width'],geometry_wanted['height'],0,geometry_wanted['height']]):struct.pack_into('<i',x,1+n*4,value)
   assert x==y,(name,'rectangle corners only');geometry_counts[79]+=1
  elif tag==73:
   if any(o['type']=='protect_page_bottom' for o in c['operations']):x[28:32]=y[28:32]=bytes(4)
   assert x==y,(name,'page definition')
  elif tag==67 and old!=new:
   assert splice and level>=4 and level%2==0;points=list(old.decode('utf-16le')[:-1]);wanted=''.join(points[:splice['start']])+splice['new_text']+''.join(points[splice['end']:]);assert new==(wanted+'\r').encode('utf-16le');changed_text+=1
  elif tag==68 and old!=new:
   assert splice and level>=4 and level%2==0 and rb[i-1][0]==67
   prior=rb[i-1][2];now=ra[i-1][2];points=list(prior.decode('utf-16le')[:-1]);start=len(''.join(points[:splice['start']]).encode('utf-16le'))//2;end=len(''.join(points[:splice['end']]).encode('utf-16le'))//2
   oldstyles=styles(old,len(prior)//2);inherited=oldstyles[start if start<end else max(0,start-1)];expected=oldstyles[:start]+[inherited]*(len(splice['new_text'].encode('utf-16le'))//2)+oldstyles[end:]
   assert styles(new,len(now)//2)==expected,(name,'retained character style');changed_styles+=1
  else:assert old==new,(name,tag,level)
 assert changed_text==bool(splice),(name,'selected text only')
 if transform:assert geometry_counts=={71:1,76:1,79:1},(name,'only one selected rectangle')
 db=records(b['DocInfo']);da=records(a['DocInfo']);sb=[r[2] for r in db if r[0]==25];sa=[r[2] for r in da if r[0]==25];assert sa[:len(sb)]==sb
 for new in sa[len(sb):]:assert any(new[:16]==old[:16] and new[20:]==old[20:] and struct.unpack_from('<i',new,16)[0]>struct.unpack_from('<i',old,16)[0] for old in sb),(name,'footer spacing clone')
 original=[r for r in db if r[0]!=25];updated=[r for r in da if r[0]!=25];assert len(original)==len(updated)
 for (tag,level,old),(tag2,level2,new) in zip(original,updated):
  assert (tag,level)==(tag2,level2);x=bytearray(old);y=bytearray(new)
  if tag==17:x[52:56]=y[52:56]=bytes(4)
  assert x==y,(name,'non-paragraph definitions')
summary=dict(status='PASS',cases=len(cases),independent_ole_raw_checks=True,unselected_geometry_anchors_wrap_images_matrices_exact=True,explicit_rectangle_geometry_cases=sum(any(o['type']=='transform_text_box' for o in c['operations']) for c in cases),footer_text_styles_preserved=True,retained_text_box_character_styles=True,exact_restore=True)
(root/'independent-summary.json').write_text(json.dumps(summary,indent=2)+'\n',encoding='utf-8');print(json.dumps(summary))
