/** Explicit subgroup transforms in the verified immediate parent's coordinate space. */
import {fail,view,equal} from './local_complex_records.mjs';
import {groupGeometry,prepareComplexGroup} from './local_complex_group.mjs';
import {composeAffine as mul,inverseAffine as inv,affineBounds} from './local_drawing_tree.mjs';
function union(children,parent,records){const inverse=inv(groupGeometry(records[parent.shape_record]).combined),bounds=children.map(n=>{const g=groupGeometry(records[n.shape_record]);return affineBounds(mul(inverse,g.combined),g.width,g.height);});if(!bounds.length)fail('DRAWING_FRAME_UNVERIFIED');const x=Math.min(...bounds.map(b=>b.horzOffset)),y=Math.min(...bounds.map(b=>b.vertOffset));return {x,y,width:Math.max(...bounds.map(b=>b.horzOffset+b.width))-x,height:Math.max(...bounds.map(b=>b.vertOffset+b.height))-y};}
function normalizeParentFrame(state,records,out,node){
 let parent=state.drawing_tree.nodes.find(n=>n.id===node.parent_id);
 while(parent){
  const old=union(parent.children,parent,records),next=union(parent.children,parent,out),same=Object.keys(old).every(k=>Math.abs(old[k]-next[k])<1e-6);if(same){parent=state.drawing_tree.nodes.find(n=>n.id===parent.parent_id);continue;}
  // Hancom fits a group's content bounds into its common frame. Shrinking an
  // edge child would stretch untouched siblings unless the outer basis is
  // normalized too. Only an explicitly verified 1:1 root can be compensated.
  const g=parent.geometry,f=parent.root.flow,p=parent.root.properties;
  if(parent.parent_id||parent.owner_box_id||f.treatAsChar||![3,4].includes(f.textWrap)||(g.v.getUint32(g.base+28,true)&3)!==0||g.v.getUint32(g.base+20,true)!==g.width||g.v.getUint32(g.base+24,true)!==g.height||parent.rotationAngle!==0||g.combined.some((n,i)=>Math.abs(n-[1,0,0,0,1,0][i])>1e-9)||g.width!==p.width||g.height!==p.height||f.widthRelTo!==4||f.heightRelTo!==2||f.horzAlign!==0||f.vertAlign!==0||Math.abs(old.x)>.001||Math.abs(old.y)>.001||Math.abs(old.width-g.width)>.001||Math.abs(old.height-g.height)>.001||Object.values(next).some(n=>!Number.isFinite(n)||Math.abs(n-Math.round(n))>1e-6)||next.width<1||next.height<1)fail('DRAWING_FRAME_NORMALIZATION_UNVERIFIED');
  if(Math.abs(p.horzOffset+next.x)>720000||Math.abs(p.vertOffset+next.y)>720000)fail('DRAWING_FRAME_NORMALIZATION_UNVERIFIED');
  const x=Math.round(next.x),y=Math.round(next.y),width=Math.round(next.width),height=Math.round(next.height),translation=[1,0,-x,0,1,-y];
  for(let i=parent.shape_record+1;i<parent.records_end;i++)if(out[i].tag===76){const child=groupGeometry(out[i]),t=child.matrix(44),rotation=mul(inv(t),mul(translation,mul(t,child.matrix(140))));rotation.forEach((n,j)=>child.v.setFloat64(child.base+140+j*8,Math.abs(n)<1e-10?0:n,true));}
  const root=groupGeometry(out[parent.shape_record]);for(const offset of [12,20])root.v.setUint32(root.base+offset,width,true);for(const offset of [16,24])root.v.setUint32(root.base+offset,height,true);root.v.setInt32(root.base+34,Math.round(width/2),true);root.v.setInt32(root.base+38,Math.round(height/2),true);
  const common=view(out[parent.root.control_record].payload);common.setUint32(16,width,true);common.setUint32(20,height,true);common.setInt32(12,p.horzOffset+x,true);common.setInt32(8,p.vertOffset+y,true);
  return {root_id:parent.id,origin_shift:{x,y},previous_properties:p,properties:{width,height,horzOffset:p.horzOffset+x,vertOffset:p.vertOffset+y},basis:'canonical_root_rebase_preserves_nonselected_physical_transforms'};
 }return null;
}
export function prepareDrawingTransform(state,records,node,op){
 if(!equal(Object.keys(op).sort(),['type','target_id','expected_old','expected_properties','expected_rotation_angle','props'].sort()))fail('INVALID_OPERATION');
 if(node.read_only_reason||!equal(node.properties,op.expected_properties)||node.rotationAngle!==op.expected_rotation_angle)fail('EXPECTED_GROUP_MISMATCH');
 const props=op.props;if(!props||Object.getPrototypeOf(props)!==Object.prototype||!Object.keys(props).length||Object.entries(props).some(([k,v])=>!['width','height','horzOffset','vertOffset','rotationAngle'].includes(k)||!Number.isSafeInteger(v)||Math.abs(v)>720000||['width','height'].includes(k)&&v<1||k==='rotationAngle'&&Math.abs(v)>359))fail('INVALID_GROUP_PROPERTIES');
 if(!node.parent_id){
  if(Object.keys(props).some(k=>k.endsWith('Offset')))fail('DRAWING_ROOT_MOVE_REQUIRES_PLACEMENT');
  return prepareComplexGroup(state.raw,records,{...node,record_index:node.root.control_record}, {...op,type:'transform_picture_group'});
 }
 const parent=state.drawing_tree.nodes.find(p=>p.id===node.parent_id),m=node.relative,g=node.geometry,det=m[0]*m[4]-m[1]*m[3],sx=Math.hypot(m[0],m[3]),sy=Math.hypot(m[1],m[4]);
 if(!parent||parent.read_only_reason||g.v.getUint16(g.base+8,true)!==parent.geometry.v.getUint16(parent.geometry.base+8,true)+1||(g.v.getUint32(g.base+28,true)&3)!==0||det<=1e-9||!sx||!sy||Math.abs(m[0]*m[1]+m[3]*m[4])>1e-6||!g.width||!g.height)fail('DRAWING_TRANSFORM_UNVERIFIED');
 const angle=Math.atan2(m[3],m[0])*180/Math.PI,angleDelta=(angle-node.rotationAngle)*Math.PI/180;if(Math.abs(Math.atan2(Math.sin(angleDelta),Math.cos(angleDelta)))>1e-6)fail('DRAWING_ROTATION_UNVERIFIED');
 const frame={width:props.width??node.frame_size.width,height:props.height??node.frame_size.height},theta=(props.rotationAngle??node.rotationAngle)*Math.PI/180,c=Math.cos(theta),s=Math.sin(theta),a=c*frame.width/g.width,b=-s*frame.height/g.height,d=s*frame.width/g.width,e=c*frame.height/g.height,center=[m[0]*g.width/2+m[1]*g.height/2+m[2],m[3]*g.width/2+m[4]*g.height/2+m[5]],wanted=[a,b,center[0]-a*g.width/2-b*g.height/2,d,e,center[1]-d*g.width/2-e*g.height/2];
 let bounds=affineBounds(wanted,g.width,g.height);wanted[2]+=(props.horzOffset??bounds.horzOffset)-bounds.horzOffset;wanted[5]+=(props.vertOffset??bounds.vertOffset)-bounds.vertOffset;bounds=affineBounds(wanted,g.width,g.height);
 if(bounds.horzOffset<-.01||bounds.vertOffset<-.01||bounds.horzOffset+bounds.width>parent.geometry.width+.01||bounds.vertOffset+bounds.height>parent.geometry.height+.01)fail('DRAWING_OUTSIDE_PARENT');
 if(wanted.every((n,i)=>Math.abs(n-m[i])<1e-9))return {unchanged:true};
 const delta=mul(parent.geometry.combined,mul(wanted,mul(inv(m),inv(parent.geometry.combined)))),out=records.map(r=>({...r,payload:r.payload.slice()}));
 for(let i=node.shape_record;i<node.records_end;i++)if(out[i].tag===76){const child=groupGeometry(out[i]),t=child.matrix(44),rotation=mul(inv(t),mul(delta,mul(t,child.matrix(140))));if(rotation.some(n=>!Number.isFinite(n)||Math.abs(n)>720000))fail('DRAWING_TRANSFORM_UNVERIFIED');rotation.forEach((n,j)=>child.v.setFloat64(child.base+140+j*8,Math.abs(n)<1e-10?0:n,true));}
 const v=view(out[node.shape_record].payload);v.setInt16(g.base+32,props.rotationAngle??node.rotationAngle,true);v.setInt32(g.base+34,Math.round(g.width/2),true);v.setInt32(g.base+38,Math.round(g.height/2),true);
 const normalization=normalizeParentFrame(state,records,out,node);if(normalization){wanted[2]-=normalization.origin_shift.x;wanted[5]-=normalization.origin_shift.y;}
 return {records:out,wantedMatrix:wanted,normalization};
}
