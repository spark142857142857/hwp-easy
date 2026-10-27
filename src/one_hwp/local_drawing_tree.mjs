/** Structurally addressed drawing components and their text lists. */
import {createHash} from 'node:crypto';
import {GuardError} from '../../probes/sites-runtime/guard/records.mjs';
import {view,textTokens,rawShapes,encodeRecords,fail} from './local_complex_records.mjs';
import {groupGeometry,groupFrame} from './local_complex_group.mjs';
import {objectFlow,validObjectHeader} from './local_flow_records.mjs';
import {complexParagraphProperties} from './local_complex_paragraph.mjs';
import {inspectParagraphFields} from './local_field_records.mjs';
import {verifyObjectParagraphs} from './local_object_projection.mjs';
const id=r=>Buffer.from(r.payload.subarray(0,4)).toString('ascii');
const hash=rs=>createHash('sha256').update(encodeRecords(rs)).digest('hex');
const extent=(rs,i,limit)=>{let end=i+1;while(end<limit&&rs[end].level>rs[i].level)end++;return end;};
export const composeAffine=(a,b)=>[a[0]*b[0]+a[1]*b[3],a[0]*b[1]+a[1]*b[4],a[0]*b[2]+a[1]*b[5]+a[2],a[3]*b[0]+a[4]*b[3],a[3]*b[1]+a[4]*b[4],a[3]*b[2]+a[4]*b[5]+a[5]];
export function inverseAffine(m){const [a,b,x,c,d,y]=m,det=a*d-b*c;if(!Number.isFinite(det)||Math.abs(det)<1e-9)fail('DRAWING_TRANSFORM_UNVERIFIED');return [d/det,-b/det,(b*y-d*x)/det,-c/det,a/det,(c*x-a*y)/det];}
export function affineBounds(m,w,h){const p=[[0,0],[w,0],[0,h],[w,h]].map(([x,y])=>[m[0]*x+m[1]*y+m[2],m[3]*x+m[4]*y+m[5]]),x=Math.min(...p.map(p=>p[0])),y=Math.min(...p.map(p=>p[1]));return {horzOffset:x,vertOffset:y,width:Math.max(...p.map(p=>p[0]))-x,height:Math.max(...p.map(p=>p[1]))-y};}
export function inspectDrawingTree(HwpDocument,bytes,raw,recordSets,blocks,definitions,existingBoxes){
 const nodes=[],groups=[],boxes=[],unadapted=[];
 function visit(rs,b,control,at,end,shapeAt,parent,address,ownerBox=null){
  if(address.length>24||nodes.length>=256)fail('DRAWING_TREE_LIMIT');const shape=rs[shapeAt];if(shape?.tag!==76)return;let geometry;
  try{geometry=groupGeometry(shape);}catch(e){if(!(e instanceof GuardError))throw e;unadapted.push({section:b.section,block_id:b.id,address,reason:e.code});return;}
  const kind=id(shape),root=parent?.root??{control_record:at,control_index:control,flow:objectFlow(rs[at]),properties:{width:view(rs[at].payload).getUint32(16,true),height:view(rs[at].payload).getUint32(20,true),horzOffset:view(rs[at].payload).getInt32(12,true),vertOffset:view(rs[at].payload).getInt32(8,true)}},relative=parent?composeAffine(inverseAffine(parent.geometry.combined),geometry.combined):geometry.combined,properties=parent?affineBounds(relative,geometry.width,geometry.height):root.properties;
  const node={id:`${b.id}:dg:${address.join('.')}`,block_id:b.id,section:b.section,paragraph:b.paragraph,cell_path:b.cell_path,address,kind,record_index:at,shape_record:shapeAt,records_end:end,control_index:control,parent_id:parent?.id??null,owner_box_id:ownerBox?.id??null,root,geometry,relative,properties,frame_size:{width:geometry.width*Math.hypot(relative[0],relative[3]),height:geometry.height*Math.hypot(relative[1],relative[4])},rotationAngle:geometry.v.getInt16(geometry.base+32,true),subtree_sha256:hash(rs.slice(shapeAt,end)),children:[]};nodes.push(node);parent?.children.push(node);if(kind==='noc$')groups.push(node);
  if(kind==='noc$'){
   const children=[];for(let i=shapeAt+1;i<end;i++)if(rs[i].tag===76&&rs[i].level===shape.level+1)children.push(i);
   const tail=geometry.base+92+geometry.count*96,p=shape.payload,count=tail+2<=p.length?view(p).getUint16(tail,true):-1;
   if(count!==children.length||count>64||tail+2+count*4>p.length||children.some((i,n)=>!Buffer.from(p.subarray(tail+2+n*4,tail+6+n*4)).equals(Buffer.from(rs[i].payload.subarray(0,4))))){node.read_only_reason='DRAWING_CHILDREN_UNVERIFIED';return;}
   for(const [index,i]of children.entries())visit(rs,b,control,at,extent(rs,i,end),i,node,[...address,'g'+index],ownerBox);
   return;
  }
  const direct=[];for(let i=shapeAt+1;i<end;i++)if(rs[i].level===shape.level+1)direct.push(i);const lists=direct.filter(i=>rs[i].tag===72&&rs[i].payload.length===33);if(lists.length!==1)return;
  const listAt=lists[0],list=rs[listAt],heads=direct.filter(i=>i>listAt&&rs[i].tag===66),count=view(list.payload).getUint16(0,true);if(count<1||count>32||count!==heads.length||(view(list.payload).getUint32(4,true)&31))return;
  const existing=existingBoxes.find(x=>x.section===b.section&&x.record_index===at&&!parent&&!ownerBox),box={...(existing??{}),id:existing?.id??`${b.id}:tbx:${address.join('.')}`,block_id:b.id,section:b.section,paragraph:b.paragraph,cell_path:b.cell_path,control_index:control,record_index:at,shape_record:shapeAt,list_record:listAt,records_end:end,properties:parent?{...properties}:root.properties,flow:root.flow,paragraphs:[],subtree_sha256:existing?.subtree_sha256??hash(rs.slice(shapeAt,end)),drawing_node_id:node.id,object_path:address,nested_object:Boolean(parent||ownerBox),owner_box_id:ownerBox?.id??null,shape_kind:kind,content_size:{width:geometry.width,height:geometry.height},mapping_basis:'raw_drawing_tree_and_disposable_paragraph_projection'};
  try{for(const [index,i]of heads.entries()){
   const stop=extent(rs,i,end),own=rs.slice(i+1,stop).filter(r=>r.level===rs[i].level+1),ts=own.filter(r=>r.tag===67),cs=own.filter(r=>r.tag===68);if(ts.length>1||cs.length!==1||rs[i].payload.length<22)fail('DRAWING_TEXT_PROFILE_UNSUPPORTED');const payload=ts[0]?.payload??Buffer.from('\r','utf16le'),tokens=textTokens(payload),text=tokens.map(t=>t.text).join('');if((view(rs[i].payload).getUint32(0,true)&0x7fffffff)!==payload.length/2)fail('DRAWING_TEXT_UNVERIFIED');const styles=rawShapes(rs[i],cs[0],payload,definitions);if(tokens.some(t=>t.text&&t.length===2&&styles[t.unit]!==styles[t.unit+1]))fail('DRAWING_TEXT_UNVERIFIED');
   const p={id:`${box.id}:p${index}`,paragraph:index,section:b.section,cell_path:b.cell_path,text,record_index:i,records_end:stop,raw_level:rs[i].level,text_record:ts.length?rs.indexOf(ts[0]):null,shape_record:rs.indexOf(cs[0]),tokens,unit_styles:styles,text_mapping_verified:true,text_range_editable:text.length<=100000};p.paragraph_properties=complexParagraphProperties(raw,rs,p);p.fields=inspectParagraphFields(rs,p);box.paragraphs.push(p);
  }
  let verified=verifyObjectParagraphs(HwpDocument,bytes,raw,rs,box.paragraphs);if(!verified)fail('DRAWING_TEXT_MODEL_UNVERIFIED');
  }catch(e){if(!(e instanceof GuardError))throw e;unadapted.push({section:b.section,block_id:b.id,address,reason:e.code});return;}
  node.text_box_id=box.id;boxes.push(box);if(boxes.length>64)fail('DRAWING_TEXT_BOX_LIMIT');
  for(const p of box.paragraphs){let ci=-1;for(let i=p.record_index+1;i<p.records_end;i++)if(rs[i].tag===71&&rs[i].level===p.raw_level+1){ci++;if(id(rs[i])===' osg'&&validObjectHeader(rs[i].payload)&&rs[i+1]?.tag===76)visit(rs,b,ci,i,extent(rs,i,p.records_end),i+1,null,[...address,'p'+p.paragraph,'c'+ci],box);}}
 }
 for(const b of blocks){if(!b.text_mapping_verified)continue;const rs=recordSets.get(b.section);let control=-1;for(let i=b.record_index+1;i<b.records_end;i++)if(rs[i].tag===71&&rs[i].level===b.raw_level+1){control++;if(id(rs[i])===' osg'&&validObjectHeader(rs[i].payload)&&rs[i+1]?.tag===76)visit(rs,b,control,i,extent(rs,i,b.records_end),i+1,null,['c'+control]);}}
 return {nodes,groups,boxes,unadapted};
}
export function publicDrawingGroups(state,version){return (state.drawing_tree?.groups??[]).map(n=>({id:n.id,target_id:`hwp5:${version}:${Buffer.from(n.id).toString('base64url')}`,block_id:n.block_id,section:n.section,paragraph:n.paragraph,cell_path:n.cell_path,object_path:n.address,parent_id:n.parent_id,properties:n.properties,frame_size:n.frame_size,rotationAngle:n.rotationAngle,subtree_sha256:n.subtree_sha256,children:n.children.map(c=>({id:c.id,kind:c.kind,text_box_id:c.text_box_id??null})),...(!n.read_only_reason?{editable:true}:{editable:false,read_only_reason:n.read_only_reason})}));}
