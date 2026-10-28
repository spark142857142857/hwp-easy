"""Independent OLE/record proof for the F4 acceptance files; no WASM reader."""
import base64,json,re,struct,sys
from pathlib import Path
from local_table_raw_proof import load,records
root=Path(sys.argv[1]);cases=json.loads((root/'cases.json').read_text(encoding='utf-8'));native_corners={}
def mul(a,b):return [a[0]*b[0]+a[1]*b[3],a[0]*b[1]+a[1]*b[4],a[0]*b[2]+a[1]*b[5]+a[2],a[3]*b[0]+a[4]*b[3],a[3]*b[1]+a[4]*b[4],a[3]*b[2]+a[4]*b[5]+a[5]]
def geometry(data):
 base=8 if data[:4]==data[4:8] else 4;count,=struct.unpack_from('<H',data,base+42);matrix=lambda at:list(struct.unpack_from('<6d',data,base+at));m=matrix(44)
 for n in range(count):m=mul(mul(m,matrix(140+n*96)),matrix(92+n*96))
 return base,m,struct.unpack_from('<II',data,base+12)
def visible(data):
 out=[];i=0
 while i<len(data):
  code,=struct.unpack_from('<H',data,i);size=16 if 1<=code<=9 or code in [11,12] or 14<=code<=23 else 2
  assert i+size<=len(data)
  if code>=32:out.append(data[i:i+2])
  elif code==10:out.append(b'\n\0')
  elif code==9:out.append(b'\t\0')
  i+=size
 return b''.join(out).decode('utf-16le')
def end(rs,i):
 j=i+1
 while j<len(rs) and rs[j][1]>rs[i][1]:j+=1
 return j
def direct(rs,i,tag,level=None):return [j for j in range(i+1,end(rs,i)) if rs[j][0]==tag and rs[j][1]==(rs[i][1]+1 if level is None else level)]
def target_id(value):return base64.urlsafe_b64decode(value[70:]+'='*((-len(value[70:]))%4)).decode()
def locate(rs,identity):
 ordinal=int(re.match(r's0:r(\d+)',identity)[1]);at=[i for i,r in enumerate(rs) if r[0]==66][ordinal]
 if ':tbx:' not in identity and ':dg:' not in identity:return at,None
 address=identity.split(':tbx:' if ':tbx:' in identity else ':dg:')[1].split(':')[0].split('.')
 for part in address:
  n=int(part[1:])
  if part[0]=='c':at=direct(rs,at,71)[n]+1
  elif part[0]=='g':at=direct(rs,at,76)[n]
  elif part[0]=='p':at=direct(rs,at,66)[n]
 if ':tbx:' in identity:
  shape=at;index=int(re.search(r':p(\d+)',identity)[1]);at=direct(rs,shape,66)[index];return at,shape
 return at,None
def paragraphs(rs):return [(i,visible(rs[direct(rs,i,67)[0]][2]) if direct(rs,i,67) else '') for i,r in enumerate(rs) if r[0]==66]
for case in cases:
 name=case['name'];prior=root/(name+'-before.hwp');assert prior.read_bytes()==(root/(name+'-restored.hwp')).read_bytes(),name
 pb,b=load(prior);pa,a=load(root/(name+'-after.hwp'));assert set(pb)==set(pa),name
 for k in pb:
  if k not in ['BodyText/Section0','DocInfo','PrvText','PrvImage']:assert pb[k]==pa[k],(name,k)
 rb,ra=records(b['BodyText/Section0']),records(a['BodyText/Section0']);expected=[v for _,v in paragraphs(rb)];heads=[i for i,_ in paragraphs(rb)];origins=list(heads);changed_components=set();changed_fields=set();changed_lists=set();root_common=set();allowed_text=set()
 for op in case['operations']:
  identity=target_id(op['target_id']);at,box=locate(rb,identity);kind=op['type'];index=origins.index(at) if rb[at][0]==66 else None
  if kind=='transform_drawing_group':
   changed_components.update(i for i in range(at,end(rb,at)) if rb[i][0]==76)
   if ':g' not in identity.split(':dg:')[1]:root_common.add(at-1)
  elif kind in ['replace_text','splice_text']:
   old=expected[index];start=0 if kind=='replace_text' else op['start'];stop=len(old) if kind=='replace_text' else op['end'];expected[index]=old[:start]+op['new_text']+old[stop:];allowed_text.add(at)
  elif kind=='set_field':
   field=next(f for f in case['before']['fields'] if f['target_id']==op['target_id']);old=expected[index];expected[index]=old[:field['start']]+op['new_text']+old[field['end']:];allowed_text.add(at)
  elif kind=='insert_field':expected[index]=expected[index][:op['offset']]+op['value']+expected[index][op['offset']:];allowed_text.add(at)
  elif kind in ['update_field','delete_field']:changed_fields.update(direct(rb,at,71));allowed_text.add(at)
  elif kind=='split_paragraph':old=expected[index];expected[index:index+1]=[old[:op['offset']],old[op['offset']:]];origins[index:index+1]=[at,None];changed_lists.add(direct(rb,box,72)[0]);allowed_text.add(at)
  elif kind.startswith('format_'):allowed_text.add(at)
  elif kind=='insert_paragraphs':expected[index+1:index+1]=op['paragraphs'];origins[index+1:index+1]=[None]*len(op['paragraphs']);changed_lists.add(direct(rb,box,72)[0]);allowed_text.add(at)
 assert [v for _,v in paragraphs(ra)]==expected,(name,'all raw paragraph texts')
 for (now,_),old in zip(paragraphs(ra),origins):
  if old is not None and old not in allowed_text:
   assert rb[old][2]==ra[now][2],(name,'unselected paragraph header')
   assert [rb[i][2] for i in direct(rb,old,68)]==[ra[i][2] for i in direct(ra,now,68)],(name,'unselected character runs')
 norms=case['verification'].get('drawing_frame_normalizations',[])
 if case['verification'].get('drawing_frame_normalization'):norms+=[case['verification']['drawing_frame_normalization']]
 assert len(norms)<=1
 norm=norms[0] if norms else None
 components_before=[(i,r) for i,r in enumerate(rb) if r[0]==76];components_after=[(i,r) for i,r in enumerate(ra) if r[0]==76];assert len(components_before)==len(components_after)
 selected=[locate(rb,target_id(op['target_id']))[0] for op in case['operations'] if op['type']=='transform_drawing_group'];norm_at=locate(rb,norm['root_id'])[0] if norm else None
 for (i,(_,_,old)),(j,(_,_,new)) in zip(components_before,components_after):
  base,m,size=geometry(old);base2,n,size2=geometry(new);assert base==base2;old,new=bytearray(old),bytearray(new);owned=any(at<=i<end(rb,at) for at in selected)
  if owned:old[base+140:base+188]=new[base+140:base+188]=bytes(48)
  if i in selected:old[base+32:base+42]=new[base+32:base+42]=bytes(10)
  if norm and norm_at<i<end(rb,norm_at):
   old[base+140:base+188]=new[base+140:base+188]=bytes(48)
   if not owned:
    assert size==size2
    for k in range(6):
     position='horzOffset' if k==2 else 'vertOffset' if k==5 else None
     assert abs(m[k]+(norm['previous_properties'][position] if position else 0)-n[k]-(norm['properties'][position] if position else 0))<1e-6,(name,'nonselected physical transform')
  if norm and i==norm_at:
   for lo,hi in [(12,28),(34,42)]:old[base+lo:base+hi]=new[base+lo:base+hi]=bytes(hi-lo)
  assert old==new,(name,'unrequested component bytes')
 # Existing definitions are never rewritten. Explicit formatting adds records
 # and changes only the corresponding mapping counts.
 db,da=records(b['DocInfo']),records(a['DocInfo']);formatting=any(op['type'].startswith('format_') for op in case['operations'])
 if not formatting:assert pb['DocInfo']==pa['DocInfo'],name
 else:
  for tag in set(r[0] for r in db)-{17}:
   old=[r for r in db if r[0]==tag];new=[r for r in da if r[0]==tag];assert new[:len(old)]==old,(name,tag,'existing definitions')
  x,y=bytearray(next(r[2] for r in db if r[0]==17)),bytearray(next(r[2] for r in da if r[0]==17))
  for n in [36,52]:x[n:n+4]=y[n:n+4]=bytes(4)
  assert x==y
 # Match ordered non-paragraph records after removing only explicitly owned
 # field wrappers/transform components. Structural changes retain all siblings.
 def retained(rs,before):
  out=[];selected=[]
  for op in case['operations']:
   at,box=locate(rs,target_id(op['target_id']));selected.append((op,at,box))
  for i,(tag,level,data) in enumerate(rs):
   if tag in [66,67,68,69]:continue
   if tag==76:continue # independently checked, including coordinate rebasing
   if norm and tag==71 and i+1==locate(rs,norm['root_id'])[0]:p=bytearray(data);p[8:24]=bytes(16);data=bytes(p)
   if tag==71 and data[:4]==b' osg' and any(op['type']=='transform_drawing_group' and at==i+1 for op,at,_ in selected):
    p=bytearray(data);p[16:24]=bytes(8);data=bytes(p)
   if tag in [71,87] and any(op['type'] in ['insert_field','delete_field','update_field'] and at<i<end(rs,at) and (tag==87 or data[:4] in [b'klc%',b'klh%',b'kmb%']) for op,at,_ in selected):continue
   if tag==72 and any(box is not None and op['type'] in ['split_paragraph','insert_paragraphs'] and i in direct(rs,box,72) for op,_,box in selected):p=bytearray(data);p[:2]=bytes(2);data=bytes(p)
   out.append((tag,level,data))
  return out
 assert retained(rb,True)==retained(ra,False),(name,'unrequested drawing/control/list bytes')
 for stage,rs in [('before',rb),('after',ra),('restored',rb)]:
  corners=[]
  for i,(tag,level,data) in enumerate(rs):
   if tag!=76 or data[:4]!=b'cer$':continue
   owners=[j for j,r in enumerate(rs[:i]) if r[0]==71 and r[2][:4]==b' osg' and j<i<end(rs,j)];assert owners
   owner=owners[-1];y,x=struct.unpack_from('<ii',rs[owner][2],8);_,m,(w,h)=geometry(data);corners.append([[(x+m[0]*px+m[1]*py+m[2])/75,(y+m[3]*px+m[4]*py+m[5])/75] for px,py in [(0,0),(w,0),(w,h),(0,h)]])
  native_corners[name+'-'+stage]=corners
summary=dict(status='PASS',cases=len(cases),independent_ole_raw_preservation=True,all_paragraph_texts_verified=True,unrequested_drawing_control_list_bytes_exact=True,existing_definitions_preserved=True,other_packed_streams_exact=True,exact_restore=True)
(root/'independent-summary.json').write_text(json.dumps(summary,indent=2)+'\n',encoding='utf-8');print(json.dumps(summary))
(root/'native-shape-corners.json').write_text(json.dumps(native_corners,indent=2)+'\n',encoding='utf-8')
