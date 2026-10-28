"""Independent OLE proof of floating flags, reservations and non-target bytes."""
import json,struct,sys
from pathlib import Path
from local_table_raw_proof import load,records,logical,inventory

root=Path(sys.argv[1] if len(sys.argv)>1 else 'outputs/local-table-floating')
cases=json.loads((root/'cases.json').read_text(encoding='utf-8'))
u32=lambda p,i:struct.unpack_from('<I',p,i)[0]
mask=1|4|(3<<3)|(7<<5)|(3<<8)|(7<<10)|8192|16384|(7<<21)|(3<<24)
canonical=(2<<3)|(2<<8)|8192|(3<<21)|(1<<24)
for case in cases:
 name=case['name'];before=root/(name+'-before.hwp');assert before.read_bytes()==(root/(name+'-restored.hwp')).read_bytes()
 pb,b=load(before);pa,a=load(root/(name+'-after.hwp'));assert set(pb)-{'PrvText','PrvImage'}==set(pa)-{'PrvText','PrvImage'}
 for key in pb:
  if key not in ['BodyText/Section0','DocInfo','PrvText','PrvImage']:assert pb[key]==pa[key],(name,key)
 rb=records(b['BodyText/Section0']);ra=records(a['BodyText/Section0']);db=records(b['DocInfo']);da=records(a['DocInfo']);sb=[r for r in db if r[0]==25];sa=[r for r in da if r[0]==25]
 assert sa[:len(sb)]==sb
 def definition_inventory(rs):
  out=[]
  for tag,level,payload in rs:
   if tag==25:continue
   p=bytearray(payload)
   if tag==17:p[52:56]=bytes(4)
   out.append((tag,level,bytes(p)))
  return out
 assert definition_inventory(db)==definition_inventory(da)
 assert u32(next(r[2] for r in da if r[0]==17),52)==len(sa)
 # The only allowed paragraph shape change is on an empty, standalone body
 # anchor. No text/style run, other paragraph definition or binary is replaced.
 def prepared(rs,shapes):
  out=list(rs);hosts=[];objects=[]
  for i,(tag,level,payload) in enumerate(rs):
   if tag!=66 or level!=0:continue
   end=next((j for j in range(i+1,len(rs)) if rs[j][1]<=level),len(rs));direct=[j for j in range(i+1,end) if rs[j][1]==1];draw=[j for j in direct if rs[j][0]==71 and rs[j][2][:4]==b' osg']
   if not draw:continue
   assert len(draw)==1;at=draw[0];obj=rs[at][2];assert not (u32(obj,4)&1)
   shape_id=struct.unpack_from('<H',payload,8)[0];shape=bytearray(shapes[shape_id][2]);head=bytearray(payload);head[8:10]=bytes(2);out[i]=(tag,level,bytes(head));hosts.append((shape,shape_id));objects.append(obj)
   f=bytearray(obj);struct.pack_into('<I',f,4,u32(f,4)&~mask);f[8:12]=bytes(4)
   if case['fixture'].get('resize') and rs[at+1][2][:4]==b'cip$':
    requested=next(op for op in case['operations'] if op['type']=='update_picture');expected=requested['props']['height'] if rs is ra else requested['expected_properties']['height'];assert u32(obj,20)==expected
    f[20:24]=bytes(4);shape=bytearray(rs[at+1][2]);assert u32(shape,32)==expected;shape[32:36]=bytes(4);out[at+1]=(rs[at+1][0],rs[at+1][1],bytes(shape))
   out[at]=(71,1,bytes(f))
   # The common picture frame height is the only picture-specific edit in the
   # resize case. Matrices and binary/source/crop records remain exact.
  return out,hosts,objects
 xb,hb,ob=prepared(rb,sb);xa,ha,oa=prepared(ra,sa);assert len(ob)==len(oa)==len(case['fixture']['objects'])
 for (old,_),(new,shape_id),obj in zip(hb,ha,oa):
  assert u32(obj,4)&mask==canonical;assert struct.unpack_from('<i',obj,8)[0]==0
  assert u32(new,0)&3==1;reserve=struct.unpack_from('<i',new,50 if len(new)>=54 else 24)[0];assert reserve>=2*(u32(obj,20)+2000)
  for shape in [old,new]:
   struct.pack_into('<I',shape,0,u32(shape,0)&~(3|(1<<19)));shape[24:28]=bytes(4)
   if len(shape)>=54:struct.pack_into('<I',shape,46,u32(shape,46)&~31);shape[50:54]=bytes(4)
  assert old==new,(name,'unexpected host format')
 assert inventory(xb)==inventory(xa),(name,'control geometry/order/width/crop/border/instance bytes')
 headers_before=[bytearray(r[2]) for r in xb if r[0]==66];headers_after=[bytearray(r[2]) for r in xa if r[0]==66];assert len(headers_before)==len(headers_after)
 edit=next((op for op in case['operations'] if op['type']=='splice_text'),None);changed_counts=0
 for old_header,new_header in zip(headers_before,headers_after):
  old_header[16:18]=new_header[16:18]=bytes(2)
  if old_header[:4]!=new_header[:4]:
   assert edit is not None;delta=(len(edit['new_text'].encode('utf-16le'))-len(edit['expected_old'].encode('utf-16le')))//2;assert u32(new_header,0)==u32(old_header,0)+delta;old_header[:4]=new_header[:4];changed_counts+=1
   if '\n' in edit['new_text'] and '\n' not in edit['expected_old']:struct.pack_into('<I',old_header,4,u32(old_header,4)|(1<<10))
  assert old_header==new_header,(name,'unrequested paragraph header bytes')
 assert changed_counts==(1 if edit else 0)
 old,opaque=logical(xb);new,newopaque=logical(xa);assert opaque==newopaque
 if edit:
  raw=edit['expected_old'].encode('utf-16le');tokens=[raw[i:i+2].hex() for i in range(0,len(raw),2)];hits=[i for i in range(len(old)-len(tokens)+1) if all(old[i+j][0]=='t' and old[i+j][1]==t for j,t in enumerate(tokens))];assert len(hits)==1;at=hits[0];prior=old[at:at+len(tokens)];assert len({json.dumps(v[2:]) for v in prior})==1;raw=edit['new_text'].encode('utf-16le');old[at:at+len(tokens)]=[['t',raw[i:i+2].hex(),*prior[0][2:]] for i in range(0,len(raw),2)]
 assert old==new,(name,'text/anchor/style order')
 assert len(sa)-len(sb)<=len(oa)
summary=dict(status='PASS',cases=len(cases),floating_state_preserved=True,canonical_body_flow_and_reserved_height=True,original_definitions_retained=True,text_styles_geometry_crops_images_other_streams_preserved=True,exact_restore=True)
(root/'independent-summary.json').write_text(json.dumps(summary,indent=2)+'\n',encoding='utf-8');print(json.dumps(summary))
