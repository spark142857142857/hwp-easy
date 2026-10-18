/** Bounded floating frames in cells; all image bytes and matrices stay raw. */
import {fail} from './local_complex_records.mjs';
import {textBoxGeometry} from './local_text_box_geometry.mjs';
import {groupGeometry,groupFrame} from './local_complex_group.mjs';

const bounds=g=>{const m=g.combined,points=[[0,0],[g.width,0],[0,g.height],[g.width,g.height]].map(([x,y])=>[m[0]*x+m[1]*y+m[2],m[3]*x+m[4]*y+m[5]]);return {x:Math.min(...points.map(p=>p[0])),y:Math.min(...points.map(p=>p[1])),right:Math.max(...points.map(p=>p[0])),bottom:Math.max(...points.map(p=>p[1]))};};
export function nestedFloatingObject(state,object){
 const host=state.blocks.find(b=>b.id===object.block_id),rs=state.recordSets.get(object.section),f=object.flow;
 if(!host||!f||f.treatAsChar||f.vertRelTo!==2||f.horzRelTo!==2||f.vertAlign!==0||f.horzAlign!==0||f.textWrap!==3||f.restrictInPage||f.widthRelTo!==4||f.heightRelTo!==2)fail('NESTED_PLACEMENT_OBJECT_PROFILE_UNSUPPORTED');
 if(object.paragraphs){if(!textBoxGeometry(state,object))fail('NESTED_PLACEMENT_OBJECT_PROFILE_UNSUPPORTED');}
 else if(object.pictures){
  const root=groupFrame(rs[object.record_index+1],object.properties),frame=bounds(root);let end=object.record_index+1;while(end<rs.length&&rs[end].level>rs[object.record_index].level)end++;
  if(Math.abs(frame.x)>1||Math.abs(frame.y)>1)fail('NESTED_PLACEMENT_GROUP_FRAME_UNVERIFIED');
  for(let i=object.record_index+2;i<end;i++)if(rs[i].tag===76){const child=bounds(groupGeometry(rs[i]));if(child.x<frame.x-1||child.y<frame.y-1||child.right>frame.right+1||child.bottom>frame.bottom+1)fail('NESTED_PLACEMENT_GROUP_FRAME_UNVERIFIED');}
 }else if(object.picture_index!==undefined){
  const g=groupGeometry(rs[object.record_index+1]),frame=bounds(g),p=object.properties;
  if(Math.abs(frame.x)>1||Math.abs(frame.y)>1||Math.abs(frame.right-p.width)>1||Math.abs(frame.bottom-p.height)>1)fail('NESTED_PLACEMENT_PICTURE_FRAME_UNVERIFIED');
 }else fail('NESTED_PLACEMENT_OBJECT_PROFILE_UNSUPPORTED');
 return {...object,paragraph:host.paragraph,cell_path:host.cell_path};
}
