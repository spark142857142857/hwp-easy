"""Independent OLE proof: anchor-order text/styles survive paragraph partition."""
import json, struct, sys, zlib
from pathlib import Path
import olefile

root=Path(sys.argv[1] if len(sys.argv)>1 else 'outputs/local-table-text-flow')
from local_table_raw_proof import load,records,logical,inventory

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
