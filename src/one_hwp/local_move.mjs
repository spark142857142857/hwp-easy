/** Reorder complete body groups without rewriting their content or definitions. */
import {createLocalEngineApi as createEngineApi} from './local_api.mjs';
import {readHwp} from './guard/container.mjs';
import {GuardError,parseRecords} from './guard/records.mjs';
import {packLocalBodyRewrite} from './local_body_write.mjs';
import {recordsByBlock,preservableStructuralProfile,verifyListCounts} from './local_structure.mjs';
const fail=code=>{throw new GuardError(code);},equal=(a,b)=>JSON.stringify(a)===JSON.stringify(b);
const bytesEqual=(a,b)=>a.length===b.length&&a.every((v,i)=>v===b[i]),view=b=>new DataView(b.buffer,b.byteOffset,b.byteLength);
function rawTarget(value,version){
 if(typeof value!=='string'||!value.startsWith(`hwp5:${version}:`))fail('VERSION_CONFLICT');const encoded=value.slice(70),id=Buffer.from(encoded,'base64url').toString('utf8');if(!id||Buffer.from(id).toString('base64url')!==encoded)fail('INVALID_TARGET');return id;
}
export function moveLocalBlock(HwpDocument,source,version,op){
 const schema=['type','target_id','expected_old','after_target_id','expected_after'];if(!op||!['move_paragraph','move_table'].includes(op.type)||!equal(Object.keys(op).sort(),schema.toSorted()))fail('INVALID_OPERATION');
 const api=createEngineApi(HwpDocument,{mixedStyleSameLength:true,existingLineBreaksEditable:true}),raw=readHwp(source),doc=api.openDocument(source);
 try{
  const before=api.inspectDocument(doc,source);if(!preservableStructuralProfile(raw,before))fail('UNSUPPORTED_EDIT_PROFILE');verifyListCounts(raw,before);const records=recordsByBlock(raw,before);
  const selected=before.blocks.find(b=>b.id===rawTarget(op.target_id,version)),anchor=before.blocks.find(b=>b.id===rawTarget(op.after_target_id,version));
  if(!selected||!anchor||anchor.kind!=='paragraph')fail('MOVE_TARGET_UNSUPPORTED');if(selected.text!==op.expected_old||anchor.text!==op.expected_after)fail('EXPECTED_OLD_MISMATCH');
  if(selected.section!==anchor.section)fail('MOVE_SECTION_UNSUPPORTED');
  if(op.type==='move_paragraph'&&(selected.kind!=='paragraph'||records.get(selected.id).some(r=>![66,67,68,69].includes(r.tag))))fail('MOVE_PARAGRAPH_HAS_CONTROLS');
  if(op.type==='move_table'&&(selected.kind!=='cell'||before.tables.filter(t=>t.section===selected.section&&t.paragraph===selected.paragraph).length!==1))fail('TABLE_CELL_REQUIRED');
  // Section properties belong to the first body group and must stay there.
  if(selected.paragraph===0)fail('MOVE_SECTION_CONTROL_UNSUPPORTED');if(selected.paragraph===anchor.paragraph)fail('MOVE_TO_SELF');
  const name=`BodyText/Section${selected.section}`,body=raw.streams.get(name),roots=[];let cursor=0;
  for(const r of parseRecords(body)){if(r.tag===66&&r.level===0)roots.push({start:cursor,payload:r.payload.byteOffset-body.byteOffset});cursor=r.payload.byteOffset-body.byteOffset+r.payload.length;}
  const paragraphs=before.blocks.filter(b=>b.section===selected.section&&b.kind==='paragraph');if(roots.length!==paragraphs.length||roots[0]?.start!==0||paragraphs.some((b,i)=>b.paragraph!==i))fail('MOVE_BODY_MAPPING_UNVERIFIED');
  const groups=roots.map((r,index)=>({index,bytes:body.slice(r.start,roots[index+1]?.start??body.length),payload:r.payload-r.start})),order=groups.filter(g=>g.index!==selected.paragraph),at=order.findIndex(g=>g.index===anchor.paragraph);if(at<0)fail('MOVE_BODY_MAPPING_UNVERIFIED');order.splice(at+1,0,groups[selected.paragraph]);
  const mapping=new Map(order.map((g,index)=>[g.index,index]));
  const translate=b=>{const result=structuredClone(b);if(b.section===selected.section)result.paragraph=mapping.get(b.paragraph);result.id=`s${result.section}:p${result.paragraph}`+(b.kind==='cell'?`:t${b.control}:c${b.cell}:p${b.cell_paragraph}`:'');return result;};
  const remap=Object.fromEntries(before.blocks.map(b=>[b.id,translate(b).id]));
  if(order.every((g,i)=>g.index===i))return {bytes:source,_target_remap:remap,no_change:true,content_verified:true,raw_preservation_verified:true,structure_changed:false,layout_verified:false};
  const patched=new Uint8Array(body.length);let offset=0;for(const [index,g] of order.entries()){const flags=view(g.bytes).getUint32(g.payload,true);view(g.bytes).setUint32(g.payload,(flags&0x7fffffff)|(index===order.length-1?0x80000000:0),true);patched.set(g.bytes,offset);offset+=g.bytes.length;}
  const output=packLocalBodyRewrite(source,raw,new Map([[name,patched]])),savedRaw=readHwp(output);
  if(!equal([...raw.streams.keys()],[...savedRaw.streams.keys()]))fail('MOVE_STREAM_MISMATCH');for(const [key,value] of raw.streams)if(!bytesEqual(key===name?patched:value,savedRaw.streams.get(key)))fail('MOVE_STREAM_MISMATCH');
  const reopened=api.openDocument(output);let after;try{after=api.inspectDocument(reopened,output);}finally{reopened.free();}
  const expectedBlocks=before.blocks.map((b,index)=>({...translate(b),original_index:index})).sort((a,b)=>a.section-b.section||a.paragraph-b.paragraph||a.original_index-b.original_index).map(({original_index,...b})=>b);
  if(!equal(expectedBlocks,after.blocks))fail('MOVE_CONTENT_MISMATCH');
  const expectedTables=before.tables.map(t=>{const c=structuredClone(t);if(t.section===selected.section)c.paragraph=mapping.get(t.paragraph);c.id=`s${t.section}:p${c.paragraph}:t${t.control}`;c.cells.forEach(cell=>{cell.id=`${c.id}:c${cell.cell}`;cell.paragraph_ids=cell.paragraph_ids.map(id=>remap[id]);});return c;}).sort((a,b)=>a.section-b.section||a.paragraph-b.paragraph||a.control-b.control);
  if(!equal(expectedTables,after.tables))fail('MOVE_TABLE_MISMATCH');const expectedUnsupported=before.unsupported.map(u=>{const c=structuredClone(u);if(u.kind==='control'&&u.list===0&&(u.section??0)===selected.section)c.paragraph=mapping.get(u.paragraph);return c;}).sort((a,b)=>(a.paragraph??0)-(b.paragraph??0));
  if(!equal(expectedUnsupported,[...after.unsupported].sort((a,b)=>(a.paragraph??0)-(b.paragraph??0))))fail('MOVE_CONTROL_MISMATCH');
  verifyListCounts(savedRaw,after);recordsByBlock(savedRaw,after);
  return {bytes:output,_target_remap:remap,content_verified:true,raw_preservation_verified:true,raw_preservation_scope:'whole_body_groups_and_exact_other_streams_with_checked_list_end_flags',structure_changed:true,paragraph_order_changed:true,layout_verified:false};
 }finally{doc.free();}
}
