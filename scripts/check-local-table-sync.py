"""Independent OLE/record proof for automatic cell edits and complex footers."""
import base64,json,struct,sys,zlib
from pathlib import Path
import olefile
root=Path(sys.argv[1] if len(sys.argv)>1 else 'outputs/local-table-sync')
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
def styles(data,length):
 runs=[struct.unpack_from('<II',data,i) for i in range(0,len(data),8)];assert runs and runs[0][0]==0
 return [style for n,(start,style) in enumerate(runs) for _ in range((runs[n+1][0] if n+1<len(runs) else length)-start)]
cases=json.loads((root/'cases.json').read_text(encoding='utf-8'))
for c in cases:
 name=c['name'];prior=root/(name+'-before.hwp');assert prior.read_bytes()==(root/(name+'-restored.hwp')).read_bytes()
 pb,b=load(prior);pa,a=load(root/(name+'-after.hwp'));assert set(pb)-{'PrvText','PrvImage'}==set(pa)-{'PrvText','PrvImage'}
 footer=c['fixture']['mode']=='footer';edit=next((op for op in c['operations'] if op['type']=='splice_text'),None)
 encoded=edit['target_id'][70:] if edit else '';identity=base64.urlsafe_b64decode(encoded+'='*((-len(encoded))%4)).decode() if edit else 's0:';section=identity.split(':')[0][1:];stream='BodyText/Section'+section
 for key in pb:
  if key not in (stream,'DocInfo','PrvText','PrvImage'):assert pb[key]==pa[key],(name,key)
 if not footer:assert pb['DocInfo']==pa['DocInfo']
 else:
  db,da=records(b['DocInfo']),records(a['DocInfo']);sb=[r[2] for r in db if r[0]==25];sa=[r[2] for r in da if r[0]==25];assert sa[:len(sb)]==sb
  for new in sa[len(sb):]:assert any(new[:16]==old[:16] and new[20:]==old[20:] and struct.unpack_from('<i',new,16)[0]-struct.unpack_from('<i',old,16)[0]==12000 for old in sb)
  old=[r for r in db if r[0]!=25];new=[r for r in da if r[0]!=25];assert len(old)==len(new)
  for (tag,level,x),(tag2,level2,y) in zip(old,new):
   assert (tag,level)==(tag2,level2);x,y=bytearray(x),bytearray(y)
   if tag==17:x[52:56]=y[52:56]=bytes(4)
   assert x==y,(name,'non-paragraph definitions')
 rb=[r for r in records(b[stream]) if r[0]!=69];ra=[r for r in records(a[stream]) if r[0]!=69];assert len(rb)==len(ra)
 in_footer=False;changed_text=0;footer_heads=0
 for i,((tag,level,old),(tag2,level2,new)) in enumerate(zip(rb,ra)):
  assert (tag,level)==(tag2,level2);x,y=bytearray(old),bytearray(new)
  if in_footer and level<=1:in_footer=False
  if tag==71 and old[:4] in (b'toof',b'daeh'):in_footer=True
  if tag==66:
   x[16:18]=y[16:18]=bytes(2)
   if edit and i+1<len(rb) and rb[i+1][0]==67 and rb[i+1][2]==(edit['expected_old']+'\r').encode('utf-16le'):
    expected_mask=(struct.unpack_from('<I',old,4)[0]&~(1<<10))|((1<<10) if '\n' in edit['new_text'] else 0);assert struct.unpack_from('<I',new,4)[0]==expected_mask;x[4:8]=y[4:8]=bytes(4);x[:4]=y[:4]=bytes(4);x[12:14]=y[12:14]=bytes(2)
   if footer and in_footer and old[8:10]!=new[8:10]:footer_heads+=1;x[8:10]=y[8:10]=bytes(2)
  elif tag==67 and edit and old==(edit['expected_old']+'\r').encode('utf-16le'):
   assert new==(edit['new_text']+'\r').encode('utf-16le');changed_text+=1;continue
  elif tag==68 and edit and rb[i-1][0]==67 and rb[i-1][2]==(edit['expected_old']+'\r').encode('utf-16le'):
   ids=styles(old,len(rb[i-1][2])//2);assert len(set(ids))==1;assert styles(new,len(ra[i-1][2])//2)==[ids[0]]*(len(ra[i-1][2])//2);continue
  elif not in_footer and tag==71 and old[:4]==b' lbt':
   mask=1|4|(3<<3)|(7<<5)|(3<<8)|(7<<10)|(1<<13)|(1<<14)|(1<<20)|(7<<21)|(3<<24);assert struct.unpack_from('<I',old,4)[0]&~mask==struct.unpack_from('<I',new,4)[0]&~mask
   x[4:16]=y[4:16]=bytes(12);x[20:24]=y[20:24]=bytes(4)
   if len(x)>=46 and len(x)==46+struct.unpack_from('<H',x,44)[0]*2:x[40:44]=y[40:44]=bytes(4)
  elif not in_footer and tag==72 and len(old)>=34:x[20:24]=y[20:24]=bytes(4)
  elif not in_footer and tag==77:assert struct.unpack_from('<I',old)[0]&~3==struct.unpack_from('<I',new)[0]&~3;x[:4]=y[:4]=bytes(4)
  elif tag==73 and footer:assert struct.unpack_from('<I',new,28)[0]==16000;x[28:32]=y[28:32]=bytes(4)
  assert x==y,(name,tag,level,'unrequested bytes')
 assert changed_text==bool(edit);assert footer_heads==bool(footer)
summary=dict(status='PASS',cases=len(cases),independent_ole_raw_preservation=True,selected_text_and_inherited_styles_verified=True,footer_tables_and_page_numbers_exact=True,original_definitions_and_other_streams_exact=True,exact_restore=True)
(root/'independent-summary.json').write_text(json.dumps(summary,indent=2)+'\n',encoding='utf-8');print(json.dumps(summary))
