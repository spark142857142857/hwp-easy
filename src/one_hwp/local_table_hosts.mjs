/** Whole body-host forest selection and lossless table-host paragraph splits. */
import {inspectLocalComplex} from './local_complex.mjs';
import {partitionTableHost} from './local_complex_boundary.mjs';
import {standardBlockId} from './local_complex_table.mjs';
import {publishVerifiedPatch} from './local_verified_patch.mjs';
import {equal,fail,view} from './local_complex_records.mjs';

export const hostRoots=(state,root)=>state.tables.filter(t=>!t.cell_path.length&&t.section===root.section&&t.parent_id===root.parent_id);
export const rootForest=(state,roots)=>state.tables.filter(t=>roots.some(r=>t.section===r.section&&t.record_index>=r.record_index&&t.end<=r.end));
export function normalizeTableHosts(HwpDocument,source,state,roots){
 let bytes=source,ids=roots.map(r=>r.id),remap=null;const normalized=[];
 for(let count=0;count<=16;count++){
  const forest=rootForest(state,ids.map(id=>state.tables.find(t=>t.id===id))),hosts=[...new Set(forest.map(t=>t.parent_id))].map(id=>state.blocks.find(b=>b.id===id));
  const host=hosts.find(b=>{const anchors=b.tokens.filter(t=>t.code===11);return anchors.length&&(b.tokens.some(t=>t.unit>anchors[0].unit&&t.text)||b.tokens.some(t=>t.code===3)||anchors.some(t=>Buffer.from(state.recordSets.get(b.section)[b.text_record].payload.subarray(t.unit*2+2,t.unit*2+6)).toString()!==' lbt')||!b.cell_path.length&&anchors.length>1);});
  if(!host)return {bytes,state,root_ids:ids,remap,normalized};
  if(count===16)fail('TABLE_HOST_NORMALIZATION_LIMIT');
  const format=host.paragraph_properties;if(!format||format.keepLines||format.keepWithNext||format.marginLeft||format.marginRight||format.indent||format.spacingBefore||format.spacingAfter||format.lineSpacingType!==0||format.lineSpacing<100||format.lineSpacing>300||host.text.length>10000)fail('TABLE_REFLOW_PARAGRAPH_PROFILE_UNSUPPORTED');
  const records=state.recordSets.get(host.section),patch=partitionTableHost(state,host),ordinals=new Map();let n=0;
  for(const r of patch.records)if(r.tag===66)ordinals.set(r.originHeader??r,`s${host.section}:r${n++}`);
  const mapping={};for(const old of state.blocks){const next=old.id===host.id?null:old.section===host.section?ordinals.get(records[old.record_index]):old.id;if(next===undefined)fail('TABLE_HOST_TARGET_UNVERIFIED');mapping[old.id]=next;const alias=standardBlockId(old);if(alias)mapping[alias]=next;}
  // Table identity follows the unchanged control record, including equal-looking
  // siblings. Never use text hashes or instance IDs to guess a moved control.
  const headers=new Set([...state.blocks.filter(b=>b.section===host.section&&b!==host).map(b=>records[b.record_index]),...patch.heads]),remove=new Set();
  for(let i=0;i<patch.records.length;i++)if(headers.has(patch.records[i]))for(let j=i+1;j<patch.records.length&&patch.records[j].level>patch.records[i].level;j++)if(patch.records[j].tag===69&&patch.records[j].level===patch.records[i].level+1)remove.add(patch.records[j]);
  const finalRecords=patch.records.filter(r=>!remove.has(r)),controlPositions=new Map(finalRecords.map((r,i)=>[r.originControl??r,i]));
  // Header references survive paragraph insertion; old numeric indices do not.
  const cleared=finalRecords.map(r=>{if(!headers.has(r))return r;const payload=r.payload.slice();view(payload).setUint16(16,0,true);return {...r,payload};});
  bytes=publishVerifiedPatch(bytes,state,host.section,cleared);
  const after=inspectLocalComplex(HwpDocument,bytes,{includeDocumentInfo:false});
  for(const fragment of patch.fragments){const id=ordinals.get(fragment.head.originHeader??fragment.head),now=after.blocks.find(b=>b.id===id);if(!now?.text_mapping_verified||!equal([now.text,now.unit_styles],[fragment.text,fragment.unit_styles]))fail('TABLE_HOST_FRAGMENT_UNVERIFIED');}
  for(const old of state.tables){const at=old.section===host.section?controlPositions.get(records[old.record_index]):old.record_index,now=after.tables.find(t=>t.section===old.section&&t.record_index===at);if(!now)fail('TABLE_HOST_TABLE_UNVERIFIED');mapping[old.id]=now.id;}
  for(const kind of ['pictures','groups','text_boxes','opaque_drawings'])for(const old of state[kind]){
   const at=old.section===host.section?controlPositions.get(records[old.record_index]):old.record_index,now=after[kind].find(o=>o.section===old.section&&o.record_index===at);if(!now)fail('TABLE_HOST_OBJECT_UNVERIFIED');if(old.id)mapping[old.id]=now.id;
   if(kind==='text_boxes')for(const p of old.paragraphs)mapping[p.id]=now.paragraphs[p.paragraph]?.id??null;
  }
  for(const old of state.fields){const fragment=old.block_id===host.id?patch.fragments.find(f=>old.from-8>=f.from&&old.to+8<=f.to):null,block=fragment?ordinals.get(fragment.head.originHeader??fragment.head):mapping[old.block_id],shift=fragment?.visible_from??0,unitShift=fragment?.from??0,now=after.fields.find(f=>f.block_id===block&&f.field_id===old.field_id&&f.start===old.start-shift&&f.end===old.end-shift&&f.from===old.from-unitShift&&f.to===old.to-unitShift);if(!now)fail('TABLE_HOST_FIELDS_UNVERIFIED');mapping[old.id]=now.id;}
  for(const old of state.blocks)if(old.id!==host.id){const now=after.blocks.find(b=>b.id===mapping[old.id]);if(!now||!equal([old.text,old.unit_styles],[now.text,now.unit_styles]))fail('TABLE_HOST_CONTENT_MISMATCH');}
  if(!equal(state.fields.map(f=>[f.field_id,f.value,f.name,f.guide]),after.fields.map(f=>[f.field_id,f.value,f.name,f.guide])))fail('TABLE_HOST_FIELDS_UNVERIFIED');
  ids=ids.map(id=>mapping[id]);if(remap)for(const [old,now]of Object.entries(remap))remap[old]=now===null?null:mapping[now]??null;else remap=mapping;
  normalized.push({old_host_id:host.id,paragraphs_added:patch.delta,retained_fields:state.fields.filter(f=>f.block_id===host.id).length,inline_objects:[...state.pictures,...state.text_boxes].filter(o=>o.block_id===host.id).length});state=after;
 }
 fail('TABLE_HOST_NORMALIZATION_LIMIT');
}
