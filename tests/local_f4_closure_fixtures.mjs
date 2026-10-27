/** Complete F4 candidate acceptance matrix. */
import {f4GroupFixture,f4CellFixture,f4NestedBoxFixture,f4FieldFixture,f4PictureGroupsFixture,f4MixedGroupFixture} from './local_f4_fixtures.mjs';
import {fieldFixture} from './local_complex_fixtures.mjs';
const para=(s,index=0)=>s.text_boxes[index].paragraphs[0];
const text=(s,value,index=0)=>({type:'replace_text',target_id:para(s,index).target_id,expected_old:para(s,index).text,new_text:value});
const field=(s,type,rest)=>({type,target_id:s.fields[0].target_id,expected_old:s.fields[0].value,...rest});
const transform=(s,n,props)=>({type:'transform_drawing_group',target_id:n.target_id,expected_old:s.blocks.find(b=>b.id===n.block_id).text,expected_properties:n.properties,expected_rotation_angle:n.rotationAngle,props});
export const f4ClosureProfiles=[
 {name:'group-text',fixture:()=>f4GroupFixture(),operations:s=>[text(s,'변경 문장')]},
 {name:'group-empty',fixture:()=>f4GroupFixture({empty:true}),operations:s=>[text(s,'빈 상자 채움')]},
 {name:'group-identical',fixture:()=>f4GroupFixture({duplicate:true}),operations:s=>[text(s,'선택한 두번째',1)]},
 {name:'group-format',fixture:()=>f4GroupFixture(),operations:s=>[{type:'format_text',target_id:para(s).target_id,expected_old:para(s).text,start:0,end:5,props:{bold:true,fontSize:1400,textColor:'#225588'}},{type:'format_paragraph',target_id:para(s).target_id,expected_old:para(s).text,props:{alignment:'center',spacingAfter:200}}]},
 {name:'group-boundaries',fixture:()=>f4GroupFixture(),operations:s=>[{type:'split_paragraph',target_id:para(s).target_id,expected_old:para(s).text,offset:5},text(s,'따라간 형제',1)]},
 {name:'group-insert-paragraphs',fixture:()=>f4GroupFixture(),operations:s=>[{type:'insert_paragraphs',target_id:para(s).target_id,expected_old:para(s).text,paragraphs:['추가 문단','마지막 줄']}]},
 {name:'nested-group-text',fixture:()=>f4GroupFixture({nested:true}),operations:s=>[text(s,'깊은 그룹 글')]},
 {name:'cell-group-text',fixture:()=>f4CellFixture(),operations:s=>[text(s,'셀 안 그룹')]},
 {name:'nested-cell-group-text',fixture:()=>f4CellFixture(2),operations:s=>[text(s,'중첩 셀 그룹')]},
 {name:'nested-box-text',fixture:f4NestedBoxFixture,operations:s=>{const box=s.text_boxes.find(b=>b.object_path.includes('p0'));return [{type:'replace_text',target_id:box.paragraphs[0].target_id,expected_old:box.paragraphs[0].text,new_text:'내부 상자'}];}},
 {name:'group-field-cache',fixture:()=>f4GroupFixture({field:true}),operations:s=>[field(s,'set_field',{new_text:'새 필드값'})]},
 {name:'group-field-metadata',fixture:()=>f4GroupFixture({field:true}),operations:s=>[field(s,'update_field',{expected_metadata:{name:s.fields[0].name,guide:s.fields[0].guide,command:s.fields[0].command},props:{name:'새 이름',guide:'새 안내'}})]},
 {name:'group-field-remove',fixture:()=>f4GroupFixture({field:true}),operations:s=>[field(s,'delete_field',{})]},
 {name:'group-field-create',fixture:()=>f4GroupFixture(),operations:s=>[{type:'insert_field',target_id:para(s).target_id,expected_old:para(s).text,offset:2,name:'입력값',guide:'여기에 입력',value:'새 값'}]},
 {name:'body-field-metadata',fixture:()=>fieldFixture(),operations:s=>[field(s,'update_field',{expected_metadata:{name:s.fields[0].name,guide:s.fields[0].guide,command:s.fields[0].command},props:{name:'새 이름',guide:'새 안내'}})]},
 ...['hyperlink','bookmark'].map(kind=>({name:`group-${kind}-create`,fixture:()=>f4GroupFixture(),operations:s=>[{type:'insert_field',target_id:para(s).target_id,expected_old:para(s).text,offset:2,field_type:kind,command:kind==='hyperlink'?'https://example.org/;1;0;0;':'내부 대상',name:'필드 이름',guide:'',value:'LINK'}]})),
 ...['hyperlink','date'].map(kind=>({name:`body-${kind}-cache`,fixture:()=>f4FieldFixture(kind),operations:s=>[field(s,'set_field',{new_text:'CACHE VALUE'})]})),
 {name:'subgroup-transform',fixture:()=>f4GroupFixture({nested:true}),operations:s=>[transform(s,s.drawing_groups.find(n=>n.parent_id),{width:16000,height:5000,rotationAngle:10,horzOffset:2000,vertOffset:2000})]},
 {name:'subgroup-transform-text',fixture:()=>f4GroupFixture({nested:true}),operations:s=>[transform(s,s.drawing_groups.find(n=>n.parent_id),{width:16000,height:5000,horzOffset:2000,vertOffset:2000}),text(s,'변형 후 편집')]},
 {name:'picture-subgroup-transform',fixture:f4PictureGroupsFixture,operations:s=>[transform(s,s.drawing_groups.find(n=>n.parent_id),{width:8000,height:2500,rotationAngle:10,horzOffset:1000,vertOffset:1000})]},
 {name:'mixed-subgroup-transform',fixture:f4MixedGroupFixture,operations:s=>[transform(s,s.drawing_groups.find(n=>n.parent_id),{width:16000,height:5000,horzOffset:2000,vertOffset:2000}),text(s,'혼합 그룹 편집')]},
 {name:'root-transform',fixture:()=>f4GroupFixture(),operations:s=>[transform(s,s.drawing_groups[0],{width:20000,height:6000,rotationAngle:5})]},
];
