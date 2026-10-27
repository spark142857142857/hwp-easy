/** Generated horizontal text boxes. No personal documents or native dependency. */
import {HwpDocument} from '@rhwp/core';
import {f4GroupFixture,f4CellFixture,f4Inspect,f4Target,f4Patch} from './local_f4_fixtures.mjs';
import {editLocalBatch} from '../src/one_hwp/local_batch.mjs';
import {digest} from '../src/one_hwp/local_file.mjs';
import {view} from '../src/one_hwp/local_complex_records.mjs';
import {groupGeometry} from '../src/one_hwp/local_complex_group.mjs';
export const drawingRenderProfiles=[
 ...[15,-15,90,180,270].map(angle=>({name:`root-${angle}`,angle})),
 ...[10,-15,90,180].map(angle=>({name:`sub-${angle}`,angle,sub:true})),
 {name:'field-sub-10',angle:10,sub:true,field:true},
 {name:'mixed-root-15',angle:15,mixed:true},
 {name:'padded-sub-10',angle:10,sub:true,padding:true},
 {name:'center-root-15',angle:15,vertical:1,alignment:'center'},
 {name:'bottom-root-15',angle:15,vertical:2,alignment:'right'},
 {name:'paragraph-sub-10',angle:10,sub:true,paragraphs:true},
 {name:'identical-root-15',angle:15,duplicate:true},
 {name:'coincident-root-15',angle:15,coincident:true,nested:false},
 {name:'cell-root-15',angle:15,cell:1},
 {name:'nested-cell-root-15',angle:15,cell:2},
 {name:'second-page-root-15',angle:15,pageBreak:true},
];
export async function drawingRenderFixture(profile){
 const options={nested:profile.nested!==false,field:profile.field,paragraphs:profile.paragraphs,duplicate:profile.duplicate},initial=profile.cell?f4CellFixture(profile.cell,options):f4GroupFixture(options);
 let bytes=initial,state=f4Inspect(bytes),operations=[];
 const op=(p,type,rest)=>({type,target_id:f4Target(p.id,digest(bytes)),expected_old:p.text??p.value,...rest});
 for(const [i,box]of state.text_boxes.entries())for(const [j,p]of box.paragraphs.entries())if(!p.fields.length)operations.push(op(p,'replace_text',{new_text:profile.duplicate?'같은 글':profile.coincident?(i?'위 AB':'밑 AB'):j?'다음 줄':'가나 AB'}));
 if(operations.length)bytes=(await editLocalBatch(HwpDocument,bytes,digest(bytes),operations)).bytes;
 state=f4Inspect(bytes);operations=[];
 for(const [i,box]of state.text_boxes.entries())for(const p of box.paragraphs){
  const color=profile.coincident&&i===1?'#cc2255':'#2255bb',ranges=[];let at=0;
  for(const f of p.fields){if(f.start>at)ranges.push([at,f.start]);operations.push(op(f,'format_text',{start:0,end:[...f.value].length,props:{textColor:color}}));at=f.end;}if(at<[...p.text].length)ranges.push([at,[...p.text].length]);
  for(const [start,end]of ranges)operations.push(op(p,'format_text',{start,end,props:{textColor:color}}));
 }
 if(operations.length)bytes=(await editLocalBatch(HwpDocument,bytes,digest(bytes),operations)).bytes;
 if(profile.mixed){state=f4Inspect(bytes);bytes=(await editLocalBatch(HwpDocument,bytes,digest(bytes),[op(state.text_boxes[0].paragraphs[0],'format_text',{start:0,end:2,props:{bold:true,fontSize:1400}})])).bytes;}
 if(profile.alignment){state=f4Inspect(bytes);bytes=(await editLocalBatch(HwpDocument,bytes,digest(bytes),state.text_boxes.map(b=>op(b.paragraphs[0],'format_paragraph',{props:{alignment:profile.alignment}})))).bytes;}
 if(profile.padding||profile.vertical){state=f4Inspect(bytes);bytes=f4Patch(bytes,rs=>{for(const box of state.text_boxes){const p=view(rs[box.list_record].payload);if(profile.padding)for(const at of [8,10,12,14])p.setInt16(at,225,true);if(profile.vertical)p.setUint32(4,(p.getUint32(4,true)&~96)|(profile.vertical<<5),true);}});}
 if(profile.coincident){state=f4Inspect(bytes);const root=state.drawing_tree.groups[0],first=state.drawing_tree.nodes.find(n=>n.text_box_id),second=state.drawing_tree.nodes.filter(n=>n.text_box_id)[1];bytes=f4Patch(bytes,rs=>{const a=groupGeometry(rs[first.shape_record]),b=groupGeometry(rs[second.shape_record]);a.combined.forEach((n,i)=>b.v.setFloat64(b.base+44+i*8,n,true));for(const at of Array.from({length:b.count},(_,i)=>[92+i*96,140+i*96]).flat())[1,0,0,0,1,0].forEach((n,i)=>b.v.setFloat64(b.base+at+i*8,n,true));const g=groupGeometry(rs[root.shape_record]);for(const at of [12,20])g.v.setUint32(g.base+at,10000,true);g.v.setInt32(g.base+34,5000,true);view(rs[root.record_index].payload).setUint32(16,10000,true);});}
 if(profile.pageBreak){state=f4Inspect(bytes);const host=state.blocks.find(b=>b.id===state.drawing_tree.groups[0].block_id);bytes=f4Patch(bytes,rs=>{rs[host.record_index].payload[11]|=4;view(rs[host.record_index].payload).setUint16(16,0,true);for(let i=host.records_end-1;i>host.record_index;i--)if(rs[i].tag===69&&rs[i].level===host.raw_level+1)rs.splice(i,1);});}
 return bytes;
}
export function drawingRenderOperations(read,profile){
 const group=read.drawing_groups.find(g=>profile.sub?g.parent_id:!g.parent_id),host=read.blocks.find(b=>b.id===group.block_id),text=read.text_boxes[0].paragraphs[0],field=read.fields.find(f=>f.block_id===text.id),edit=field?{type:'set_field',target_id:field.target_id,expected_old:field.value,new_text:'EDIT VALUE'}:{type:'splice_text',target_id:text.target_id,expected_old:text.text,start:0,end:[...text.text].length,new_text:profile.duplicate?'선택 글':profile.coincident?'아래 AB':'수정 AB'};
 return [edit,{type:'transform_drawing_group',target_id:group.target_id,expected_old:host.text,expected_properties:group.properties,expected_rotation_angle:group.rotationAngle,props:profile.sub?{width:Math.abs(profile.angle)%180===90?6000:16000,height:Math.abs(profile.angle)%180===90?4000:5000,horzOffset:2000,vertOffset:2000,rotationAngle:profile.angle}:{rotationAngle:profile.angle}}];
}
