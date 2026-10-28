"""Independent OLE/zlib record proofs for the selected root-tree flow patch."""
import json,struct,sys,zlib
from pathlib import Path
import olefile
root=Path(sys.argv[1] if len(sys.argv)>1 else 'outputs/local-table-reflow')
def load(path):
 with olefile.OleFileIO(path) as doc:packed={'/'.join(k):doc.openstream(k).read() for k in doc.listdir()}
 compressed=struct.unpack_from('<I',packed['FileHeader'],36)[0]&1
 return packed,{k:zlib.decompress(v,-15) if compressed and (k=='DocInfo' or k.startswith('BodyText/')) else v for k,v in packed.items()}
def records(data):
 result=[];at=0
 while at<len(data):
  h,=struct.unpack_from('<I',data,at);at+=4;size=h>>20
  if size==4095:size,=struct.unpack_from('<I',data,at);at+=4
  assert at+size<=len(data);result.append((h&1023,(h>>10)&1023,data[at:at+size]));at+=size
 return result
cases=json.loads((root/'cases.json').read_text(encoding='utf-8'))
for case in cases:
 name=case['name'];before=root/(name+'-before.hwp');after=root/(name+'-after.hwp');assert before.read_bytes()==(root/(name+'-restored.hwp')).read_bytes()
 pb,b=load(before);pa,a=load(after);assert set(pb)-{'PrvImage','PrvText'}==set(pa)-{'PrvImage','PrvText'}
 section=case['verification']['table_reflow']['root_table_id'].split(':')[0][1:];stream='BodyText/Section'+section
 for key in pb:
  if key not in (stream,'PrvText','PrvImage'):assert pb[key]==pa[key],(name,key)
 rb=[r for r in records(b[stream]) if r[0]!=69];ra=[r for r in records(a[stream]) if r[0]!=69];assert len(rb)==len(ra)
 for (tag,level,old),(tag2,level2,new) in zip(rb,ra):
  assert (tag,level)==(tag2,level2);x=bytearray(old);y=bytearray(new)
  if tag==66:x[16:18]=y[16:18]=bytes(2)
  elif tag==71 and old[:4]==b' lbt':
   mask=1|4|(3<<3)|(7<<5)|(3<<8)|(7<<10)|(1<<13)|(1<<14)|(1<<20)|(7<<21)|(3<<24)
   f,g=struct.unpack_from('<I',x,4)[0],struct.unpack_from('<I',y,4)[0];assert f&~mask==g&~mask
   x[4:16]=y[4:16]=bytes(12);x[20:24]=y[20:24]=bytes(4)
   if len(x)>=46 and len(x)==46+struct.unpack_from('<H',x,44)[0]*2:x[40:44]=y[40:44]=bytes(4)
  elif tag==72 and len(old)>=34:x[20:24]=y[20:24]=bytes(4)
  elif tag==77:
   assert struct.unpack_from('<I',x)[0]&~3==struct.unpack_from('<I',y)[0]&~3;x[:4]=y[:4]=bytes(4)
  assert x==y,(name,tag,level,'unrequested bytes')
 rs=records(a[stream]);footer_indices=set()
 for i,(tag,level,payload) in enumerate(rs):
  if tag==71 and payload[:4] in (b'toof',b'daeh'):
   j=i+1
   while j<len(rs) and rs[j][1]>level:footer_indices.add(j);j+=1
 assert not any(tag==69 and i not in footer_indices for i,(tag,level,payload) in enumerate(rs))
summary=dict(status='PASS',cases=len(cases),independent_ole_and_raw_preservation=True,text_character_styles_and_order_exact=True,widths_padding_borders_instances_preserved=True,docinfo_images_other_sections_exact=True,exact_restore=True)
(root/'independent-summary.json').write_text(json.dumps(summary,indent=2)+'\n',encoding='utf-8');print(json.dumps(summary))
