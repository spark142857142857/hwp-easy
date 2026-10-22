"""Independent OLE proof: anchor-order text/styles survive paragraph partition."""
import json, struct, sys, zlib
from pathlib import Path
import olefile

root=Path(sys.argv[1] if len(sys.argv)>1 else 'outputs/local-table-text-flow')
def load(path):
 with olefile.OleFileIO(path) as doc:p={'/'.join(k):doc.openstream(k).read() for k in doc.listdir()}
 compressed=struct.unpack_from('<I',p['FileHeader'],36)[0]&1
 return p,{k:zlib.decompress(v,-15) if compressed and (k=='DocInfo' or k.startswith('BodyText/')) else v for k,v in p.items()}
def records(data):
 out=[];at=0
 while at<len(data):
  n,=struct.unpack_from('<I',data,at);at+=4;size=n>>20
  if size==4095:size,=struct.unpack_from('<I',data,at);at+=4
  out.append((n&1023,(n>>10)&1023,data[at:at+size]));at+=size
 assert at==len(data);return out
def logical(rs):
 visited=set();events=[];cell_ordinals={i:n for n,(i,r) in enumerate((i,r) for i,r in enumerate(rs) if r[0]==72)}
 def end(i,limit):
  j=i+1
  while j<limit and rs[j][1]>rs[i][1]:j+=1
  return j
 def paragraph(i,limit,cell):
  visited.add(i);level=rs[i][1];stop=end(i,limit);direct=[j for j in range(i+1,stop) if rs[j][1]==level+1];raw=next((rs[j][2] for j in direct if rs[j][0]==67),b'\r\0');shape=next(rs[j][2] for j in direct if rs[j][0]==68);styles=[0]*(len(raw)//2);runs=[struct.unpack_from('<II',shape,k) for k in range(0,len(shape),8)]
  for n,(start,style) in enumerate(runs):styles[start:runs[n+1][0] if n+1<len(runs) else len(styles)]=[style]*((runs[n+1][0] if n+1<len(runs) else len(styles))-start)
  controls=[j for j in direct if rs[j][0]==71 and rs[j][2][:4]==b' lbt'];used=0;at=0;para_style=rs[i][2][8:11].hex()
  while at<len(styles):
   code,=struct.unpack_from('<H',raw,at*2);length=8 if 1<=code<=9 or code in [11,12] or 14<=code<=23 else 1
   if code!=13:events.append(['t' if code>=32 or code==10 else 'a',raw[at*2:(at+length)*2].hex(),styles[at:at+length],para_style,cell])
   if code==11 and raw[at*2+2:at*2+6]==b' lbt':
    control=controls[used];used+=1;table_end=end(control,stop);cells=[j for j in range(control+1,table_end) if rs[j][0]==72 and rs[j][1]==rs[control][1]+1]
    for n,c in enumerate(cells):
     cell_end=cells[n+1] if n+1<len(cells) else table_end;heads=[j for j in range(c+1,cell_end) if rs[j][0]==66 and rs[j][1]==rs[c][1]];assert struct.unpack_from('<H',rs[c][2])[0]==len(heads)
     for h in heads:paragraph(h,cell_end,cell_ordinals[c])
   at+=length
  assert used==len(controls)
 for i,r in enumerate(rs):
  if r[0]==66 and r[1]==0:paragraph(i,len(rs),None)
 # Header/footer and other unvisited paragraph subtrees remain byte exact.
 opaque=[]
 for i,r in enumerate(rs):
  if r[0]==66 and i not in visited:opaque.append(rs[i:end(i,len(rs))])
 return events,opaque
def inventory(rs,inline_spacing=False):
 out=[]
 for tag,level,payload in rs:
  if tag in [66,67,68,69]:continue
  p=bytearray(payload)
  if tag==71 and p[:4]==b' lbt':
   mask=1|4|(3<<3)|(7<<5)|(3<<8)|(7<<10)|(1<<13)|(1<<14)|(1<<20)|(7<<21)|(3<<24);f=struct.unpack_from('<I',p,4)[0];struct.pack_into('<I',p,4,f&~mask);p[8:16]=bytes(8);p[20:24]=bytes(4)
   if len(p)>=46 and len(p)==46+struct.unpack_from('<H',p,44)[0]*2:p[40:44]=bytes(4)
  elif inline_spacing and tag==71 and p[:4]==b' osg':struct.pack_into('<I',p,4,struct.unpack_from('<I',p,4)[0]&~4)
  elif tag==72 and len(p)>=34:p[:2]=bytes(2);p[20:24]=bytes(4)
  elif tag==77:struct.pack_into('<I',p,0,struct.unpack_from('<I',p)[0]&~3)
  out.append((tag,level,bytes(p)))
 return out

cases=json.loads((root/'cases.json').read_text(encoding='utf-8'))
for c in cases:
 name=c['name'];before=root/(name+'-before.hwp');assert before.read_bytes()==(root/(name+'-restored.hwp')).read_bytes();pb,b=load(before);pa,a=load(root/(name+'-after.hwp'));assert set(pb)-{'PrvText','PrvImage'}==set(pa)-{'PrvText','PrvImage'}
 for key in pb:
  if key not in ['BodyText/Section0','PrvText','PrvImage']:assert pb[key]==pa[key],(name,key)
 rb=records(b['BodyText/Section0']);ra=records(a['BodyText/Section0']);old,opaque=logical(rb);new,newopaque=logical(ra);assert opaque==newopaque;assert inventory(rb,c['fixture'].get('host_controls',False))==inventory(ra,c['fixture'].get('host_controls',False)),(name,'unrequested record bytes')
 edit=next((op for op in c['operations'] if op['type']=='splice_text'),None)
 if edit:
  raw=edit['expected_old'].encode('utf-16le');tokens=[raw[i:i+2].hex() for i in range(0,len(raw),2)];matches=[i for i in range(len(old)-len(tokens)+1) if all(old[i+j][0]=='t' and old[i+j][1]==token for j,token in enumerate(tokens))];assert len(matches)==1
  at=matches[0];text=edit['expected_old'];start=len(text[:edit['start']].encode('utf-16le'))//2;stop=len(text[:edit['end']].encode('utf-16le'))//2;previous=old[at+start:at+stop]
  if previous:assert len({json.dumps([v[2],v[3],v[4]]) for v in previous})==1
  inherited=(previous or [old[at+max(0,start-1)]])[0];raw=edit['new_text'].encode('utf-16le');old[at+start:at+stop]=[['t',raw[i:i+2].hex(),*inherited[2:]] for i in range(0,len(raw),2)]
 for edit in (op for op in c['operations'] if op['type']=='set_field'):
  raw=edit['expected_old'].encode('utf-16le');tokens=[raw[i:i+2].hex() for i in range(0,len(raw),2)];matches=[i for i in range(len(old)-len(tokens)+1) if all(old[i+j][0]=='t' and old[i+j][1]==token for j,token in enumerate(tokens))];assert len(matches)==1
  at=matches[0];previous=old[at:at+len(tokens)];assert len({json.dumps([v[2],v[3],v[4]]) for v in previous})==1;raw=edit['new_text'].encode('utf-16le');old[at:at+len(tokens)]=[['t',raw[i:i+2].hex(),*previous[0][2:]] for i in range(0,len(raw),2)]
 assert old==new,(name,'logical text/anchors/styles/order')
summary=dict(status='PASS',cases=len(cases),logical_anchor_order_and_utf16_styles_exact=True,cell_paragraph_counts_verified=True,retained_controls_widths_padding_borders_instances_exact=True,other_streams_and_definitions_exact=True,exact_restore=True)
(root/'independent-summary.json').write_text(json.dumps(summary,indent=2)+'\n',encoding='utf-8');print(json.dumps(summary))
