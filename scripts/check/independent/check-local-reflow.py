"""Independent OLE/HWP flag, text, outline-tail, image and exact recovery checks."""
import json,sys,struct,zlib,base64
from pathlib import Path
import olefile
root=Path(sys.argv[1] if len(sys.argv)>1 else 'outputs/local-reflow-check')
def load(path):
 with olefile.OleFileIO(path) as doc:
  packed={'/'.join(name):doc.openstream(name).read() for name in doc.listdir()}
 compressed=struct.unpack_from('<I',packed['FileHeader'],36)[0]&1
 return packed,{k:zlib.decompress(v,-15) if compressed and (k=='DocInfo' or k.startswith('BodyText/')) else v for k,v in packed.items()}
def records(data):
 out=[];at=0
 while at<len(data):
  head,=struct.unpack_from('<I',data,at);at+=4;size=head>>20
  if size==4095:size,=struct.unpack_from('<I',data,at);at+=4
  assert at+size<=len(data)
  out.append((head&1023,(head>>10)&1023,data[at:at+size]));at+=size
 assert at==len(data)
 return out
cases=json.loads((root/'cases.json').read_text(encoding='utf-8'))
for case in cases:
 name=case['name'];before=(root/(name+'-before.hwp'));after=root/(name+'-after.hwp');assert before.read_bytes()==(root/(name+'-restored.hwp')).read_bytes(),name
 pb,b=load(before);pa,a=load(after);assert set(pb)==set(pa)
 for key in pb:
  if key not in ('BodyText/Section0','DocInfo','PrvText','PrvImage'):assert pb[key]==pa[key],(name,key)
 rb=records(b['BodyText/Section0']);ra=records(a['BodyText/Section0']);rb=[r for r in rb if r[0]!=69];ra=[r for r in ra if r[0]!=69];assert len(rb)==len(ra)
 for (tag,level,old),(tag2,level2,new) in zip(rb,ra):
  assert (tag,level)==(tag2,level2)
  if tag==66:
   x=bytearray(old);y=bytearray(new);x[8:10]=y[8:10]=b'\0\0';x[16:18]=y[16:18]=b'\0\0';assert x==y,(name,'paragraph header')
  elif tag==71 and old[:4]==b' osg':
   x=bytearray(old);y=bytearray(new);x[4:16]=y[4:16]=bytes(12);assert x==y,(name,'object header')
  else:assert old==new,(name,tag)
 # Existing definitions remain exact. Added paragraph shapes change only flow bits.
 db=records(b['DocInfo']);da=records(a['DocInfo']);shapesb=[r[2] for r in db if r[0]==25];shapesa=[r[2] for r in da if r[0]==25];assert shapesa[:len(shapesb)]==shapesb
 for payload in shapesa[len(shapesb):]:
  flags,=struct.unpack_from('<I',payload);assert flags&3==0 and not flags&((1<<17)|(1<<18));assert flags&(1<<16) and flags&(1<<22)
  assert struct.unpack_from('<i',payload,24)[0]>=100
  if len(payload)>=54:assert struct.unpack_from('<I',payload,46)[0]&31==0 and struct.unpack_from('<I',payload,50)[0]>=100
  assert any(payload[4:24]==old[4:24] and payload[28:46]==old[28:46] and payload[54:]==old[54:] and (flags&~((3)|(1<<16)|(1<<17)|(1<<18)|(1<<22)))==(struct.unpack_from('<I',old)[0]&~((3)|(1<<16)|(1<<17)|(1<<18)|(1<<22))) for old in shapesb)
 if name.startswith('floating'):
  assert b['DocInfo']==a['DocInfo']
  for tag,level,p in ra:
   if tag==71 and level==1 and p[:4]==b' osg':
    f,=struct.unpack_from('<I',p,4);assert f&1 and f&4 and not f&16384;assert (f>>21)&7==3;assert struct.unpack_from('<ii',p,8)==(0,0)
 assert not any(tag==69 for tag,level,p in records(a['BodyText/Section0']))
summary=dict(status='PASS',cases=len(cases),independent_ole_and_raw_preservation=True,text_and_character_runs_exact=True,explicit_breaks_and_outline_tail_preserved=True,images_and_group_matrices_exact=True,exact_restore=True)
(root/'independent-summary.json').write_text(json.dumps(summary,indent=2)+'\n',encoding='utf-8');print(json.dumps(summary))
