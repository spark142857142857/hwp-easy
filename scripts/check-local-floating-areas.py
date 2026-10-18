"""Independent OLE/record check of selected-anchor moves and exact recovery."""
import json,struct,sys,zlib
from pathlib import Path
import olefile

root=Path(sys.argv[1] if len(sys.argv)>1 else 'outputs/local-floating-areas')
def streams(path):
    with olefile.OleFileIO(path) as ole:
        result={'/'.join(p):ole.openstream(p).read() for p in ole.listdir()}
    compressed=struct.unpack_from('<I',result['FileHeader'],36)[0]&1
    return {k:zlib.decompress(v,-15) if compressed and (k=='DocInfo' or k.startswith('BodyText/')) else v for k,v in result.items()}
def records(data):
    out=[];at=0
    while at<len(data):
        h=struct.unpack_from('<I',data,at)[0];at+=4;size=h>>20
        if size==4095:size=struct.unpack_from('<I',data,at)[0];at+=4
        assert at+size<=len(data)
        out.append((h&1023,(h>>10)&1023,data[at:at+size]));at+=size
    return out
def selected(rs,props,required=True):
    found=[i for i,(tag,level,p) in enumerate(rs) if tag==71 and p[:4]==b' osg' and len(p)>=40 and struct.unpack_from('<iiII',p,8)==(props['vertOffset'],props['horzOffset'],props['width'],props['height'])]
    if not found and not required:return len(rs),len(rs)
    assert len(found)==1,found
    at=found[0];end=at+1
    while end<len(rs) and rs[end][1]>rs[at][1]:end+=1
    return at,end
def without_anchor(text,selected_ordinal=None):
    removed=set();at=0;ordinal=0
    while at<len(text)//2:
        code=struct.unpack_from('<H',text,at*2)[0]
        extended=1<=code<=9 or code in (11,12) or 14<=code<=23
        size=8 if extended else 1
        if code==11 and text[at*2+2:at*2+6]==b' osg':
            if ordinal==selected_ordinal:removed.update(range(at,at+8))
            ordinal+=1
        at+=size
    return b''.join(text[i*2:i*2+2] for i in range(len(text)//2) if i not in removed),removed
def outside(rs,start,end):
    selected_head=None;selected_ordinal=None
    if start!=end:
        level=rs[start][1];host=max(i for i,(t,l,p) in enumerate(rs[:start]) if t==66 and l==level-1);selected_head=rs[host][2]
        selected_ordinal=sum(t==71 and l==level and p[:4]==b' osg' for t,l,p in rs[host+1:start])
    rs=rs[:start]+rs[end:];materialized=[]
    for i,(tag,level,payload) in enumerate(rs):
        materialized.append((tag,level,payload))
        if tag==66 and i+1<len(rs) and rs[i+1][0]==68 and rs[i+1][1]==level+1:
            materialized.append((67,level+1,b'\r\0'))
    rs=materialized;changes={}
    for i,(tag,level,payload) in enumerate(rs):
        if tag!=66:continue
        stop=i+1
        while stop<len(rs) and rs[stop][1]>level:stop+=1
        own={t:j for j,(t,l,p) in enumerate(rs[i+1:stop],i+1) if l==level+1 and t in (67,68)}
        if 67 not in own:
            head=bytearray(payload);struct.pack_into('<H',head,16,0);changes[i]=bytes(head);continue
        raw=rs[own[67]][2];text,removed=without_anchor(raw,selected_ordinal if payload is selected_head else None);shape=rs[own[68]][2];runs=[struct.unpack_from('<II',shape,j) for j in range(0,len(shape),8)];ids=[];at=0
        for unit in range(len(raw)//2):
            while at+1<len(runs) and runs[at+1][0]<=unit:at+=1
            if unit not in removed:ids.append(runs[at][1])
        anchors=[(i,n) for i,n in enumerate(ids) if i==0 or n!=ids[i-1]]
        head=bytearray(payload);flags=struct.unpack_from('<I',head)[0];struct.pack_into('<I',head,0,(flags&0x80000000)|len(text)//2)
        if removed:
            at=0;has_anchor=False
            while at<len(text)//2:
                code=struct.unpack_from('<H',text,at*2)[0];has_anchor=has_anchor or code==11;at+=8 if 1<=code<=9 or code in (11,12) or 14<=code<=23 else 1
            struct.pack_into('<I',head,4,(struct.unpack_from('<I',head,4)[0]&~(1<<11))|((1<<11) if has_anchor else 0))
        struct.pack_into('<H',head,12,len(anchors));struct.pack_into('<H',head,16,0)
        changes.update({i:bytes(head),own[67]:text,own[68]:b''.join(struct.pack('<II',*r) for r in anchors)})
    return [(t,l,changes.get(i,p)) for i,(t,l,p) in enumerate(rs) if t!=69]
def subtree(rs,start,end):
    result=list(rs[start:end]);t,l,p=result[0];result[0]=(t,l,p[:8]+b'\0'*8+p[16:]);return [(t,ll-l,p) for t,ll,p in result]

cases=json.loads((root/'cases.json').read_text(encoding='utf-8'))
for case in cases:
    name=case['name'];before=root/(name+'-before.hwp');after=root/(name+'-after.hwp');restored=root/(name+'-restored.hwp');assert before.read_bytes()==restored.read_bytes(),(name,'restore')
    a=streams(before);b=streams(after);previews={'PrvText','PrvImage'};assert set(a)-previews==set(b)-previews,(name,'stream set')
    body_keys=[key for key in a if key.startswith('BodyText/Section')]
    old_selected=[];new_selected=[]
    for key in a:
        if key not in body_keys and key not in previews:assert a[key]==b[key],(name,key)
    for key in body_keys:
        old=records(a[key]);now=records(b[key]);i,j=selected(old,case['operations'][0]['expected_properties'],False);k,m=selected(now,case['verification']['placement']['properties'],False)
        if i!=j:old_selected.append(subtree(old,i,j))
        if k!=m:new_selected.append(subtree(now,k,m))
        assert outside(old,i,j)==outside(now,k,m),(name,key,'non-selected records/anchors/styles/order')
    assert len(old_selected)==len(new_selected)==1,(name,'unique selected drawing')
    assert old_selected==new_selected,(name,'drawing subtree except offsets and level translation')

summary=dict(status='PASS',cases=len(cases),independent_ole_records=True,selected_subtree_offsets_and_relative_levels_verified=True,non_target_order_text_styles_streams_exact=True,exact_restore=True)
(root/'independent-summary.json').write_text(json.dumps(summary,indent=2)+'\n',encoding='utf-8');print(json.dumps(summary))
