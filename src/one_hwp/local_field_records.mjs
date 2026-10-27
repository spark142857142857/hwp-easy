/** Raw field identity, command and visible cache. Commands are data, never run. */
import {createHash} from 'node:crypto';
import {view,encodeRecords} from './local_complex_records.mjs';
export const fieldKinds=new Map(Object.entries({
 'klc%':'clickhere','klh%':'hyperlink','kmb%':'bookmark','etd%':'date',
 'tdd%':'docdate','tap%':'path','gmm%':'mailmerge','frx%':'crossref',
 'umf%':'formula','rms%':'summary','rsu%':'userinfo','em%%':'memo',
 'rpc%':'privateinfo','cot%':'toc','knu%':'unknown'
}));
export const fieldControlId=r=>Buffer.from(r.payload.subarray(0,4)).toString('ascii');
const hash=bytes=>createHash('sha256').update(bytes).digest('hex');
const validText=s=>s.isWellFormed()&&!/[\u0000-\u001f]/u.test(s);
export function fieldDefinition(record,children=[]){
 const p=record.payload;if(p.length<15)return null;const v=view(p),length=v.getUint16(9,true),end=11+length*2;
 if(length>4096||end+4>p.length)return null;
 const command=Buffer.from(p.subarray(11,end)).toString('utf16le');if(!validText(command))return null;
 let name='';const names=children.filter(r=>r.tag===87);
 if(names.length===1&&names[0].payload.length>=12){const b=names[0].payload,n=view(b).getUint16(10,true);if(12+n*2===b.length)name=Buffer.from(b.subarray(12)).toString('utf16le');}
 let guide='';if(fieldControlId(record)==='klc%'){const m=/Direction:wstring:(\d+):/.exec(command);if(m){const n=Number(m[1]);if(n<=4096)guide=command.slice(m.index+m[0].length,m.index+m[0].length+n);}}
 return {field_type:fieldKinds.get(fieldControlId(record))??'unknown',control_id:fieldControlId(record),field_id:v.getUint32(end,true),command,name,guide,properties:v.getUint32(4,true),extra_properties:v.getUint8(8),command_end:end,metadata_tail_sha256:hash(p.subarray(end+4)),definition_sha256:hash(encodeRecords([record,...children]))};
}
export function inspectParagraphFields(records,block){
 if(block.text_record==null||!block.tokens)return [];const controls=[];
 for(let i=block.record_index+1;i<block.records_end;i++)if(records[i].tag===71&&records[i].level===block.raw_level+1){let end=i+1;while(end<block.records_end&&records[end].level>records[i].level)end++;controls.push({at:i,end});}
 const raw=records[block.text_record].payload,anchors=block.tokens.filter(t=>t.length===8&&t.code!==4&&controls.some(({at})=>fieldControlId(records[at])===Buffer.from(raw.subarray(t.unit*2+2,t.unit*2+6)).toString('ascii')));
 if(anchors.length!==controls.length||anchors.some((t,i)=>fieldControlId(records[controls[i].at])!==Buffer.from(raw.subarray(t.unit*2+2,t.unit*2+6)).toString('ascii')))return [];const byUnit=new Map(anchors.map((t,i)=>[t.unit,controls[i]])),stack=[],fields=[];
 for(const token of block.tokens){
  if(token.code===3){const item=byUnit.get(token.unit);if(!item||!fieldKinds.has(fieldControlId(records[item.at])))return [];const definition=fieldDefinition(records[item.at],records.slice(item.at+1,item.end));if(!definition)return [];stack.push({token,item,definition});}
  if(token.code===4){const start=stack.pop();if(!start||!Buffer.from(raw.subarray(start.token.unit*2+2,start.token.unit*2+6)).equals(Buffer.from(raw.subarray(token.unit*2+2,token.unit*2+6))))return [];const from=start.token.unit+8,to=token.unit,range=block.tokens.filter(t=>t.unit>=from&&t.unit<to),value=range.map(t=>t.text).join(''),nested=range.some(t=>t.code===3||t.code===4),known=!['unknown','memo','privateinfo','toc'].includes(start.definition.field_type),editable=Boolean(block.text_range_editable)&&known&&!nested&&range.every(t=>t.text);
   fields.push({...start.definition,id:`${block.id}:f${start.definition.field_id}`,block_id:block.id,section:block.section,cell_path:block.cell_path,start:start.token.visible,end:token.visible,from,to,value,editable,cache_only:start.definition.field_type!=='clickhere',record_index:start.item.at,records_end:start.item.end,...(!editable?{read_only_reason:nested?'NESTED_FIELD_RANGE':range.some(t=>!t.text)?'FIELD_VALUE_HAS_CONTROLS':!known?'FIELD_KIND_READ_ONLY':'FIELD_TEXT_UNVERIFIED'}:{})});
  }
 }
 return stack.length?[]:fields.sort((a,b)=>a.from-b.from);
}
export function publicFieldMetadata(f){return {field_type:f.field_type,field_id:f.field_id,name:f.name,guide:f.guide,command:f.command,properties:f.properties,extra_properties:f.extra_properties};}

/** A field ID must identify one definition, including unmapped object lists. */
export function ambiguousFieldIds(recordSets){
 const counts=new Map();
 for(const rows of recordSets.values())for(const r of rows){
  if(r.tag!==71||!fieldKinds.has(fieldControlId(r)))continue;
  const definition=fieldDefinition(r);if(!definition)continue;
  counts.set(definition.field_id,(counts.get(definition.field_id)??0)+1);
 }
 return new Set([...counts].filter(([,count])=>count>1).map(([id])=>id));
}
