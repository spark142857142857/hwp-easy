/** Bounded body rectangle text lists. Unknown controls remain opaque. */
import {createHash} from 'node:crypto';
import {GuardError} from './guard/records.mjs';
import {fail,view,textTokens,rawShapes,encodeRecords,spliceRawParagraph,equal} from './local_complex_records.mjs';
import {objectFlow,validObjectHeader} from './local_flow_records.mjs';
import {publishVerifiedPatch} from './local_verified_patch.mjs';
import {sameProperties} from './local_page_state.mjs';
import {textBoxGeometry} from './local_text_box_geometry.mjs';
const cid=r=>Buffer.from(r.payload.subarray(0,4)).toString('ascii');
export function inspectTextBoxes(doc,raw,recordSets,blocks,definitionCount){
 const boxes=[];
 for(const b of blocks){if(!b.text_mapping_verified)continue;const rs=recordSets.get(b.section);let control=-1,index=0;
  for(let i=b.record_index+1;i<b.records_end;i++){const r=rs[i];if(r.tag!==71||r.level!==b.raw_level+1)continue;control++;
   if(cid(r)!==' osg'||rs[i+1]?.tag!==76||cid(rs[i+1])!=='cer$')continue;
   const shape=rs[i+1],list=rs[i+2];if(!validObjectHeader(r.payload)||shape.payload.length<196||list?.tag!==72||list.level!==shape.level+1||list.payload.length!==33)continue;
   let end=i+1;while(end<rs.length&&rs[end].level>r.level)end++;
   try{
    const subtree=rs.slice(i+1,end);if(subtree.some(x=>![76,72,66,67,68,69,79].includes(x.tag))||subtree.filter(x=>x.tag===76).length!==1||subtree.filter(x=>x.tag===72).length!==1||subtree.filter(x=>x.tag===79).length!==1)fail('TEXT_BOX_PROFILE_UNSUPPORTED');
    const count=view(list.payload).getUint16(0,true),flags=view(list.payload).getUint32(4,true);if(count<1||count>16||(flags&31)!==0)fail('TEXT_BOX_PROFILE_UNSUPPORTED');
    const heads=[];for(let j=i+3;j<end;j++)if(rs[j].tag===66&&rs[j].level===list.level)heads.push(j);if(heads.length!==count)fail('TEXT_BOX_PROFILE_UNSUPPORTED');
    const paragraphs=[];for(const [p,at] of heads.entries()){
     let stop=at+1;while(stop<end&&rs[stop].level>rs[at].level)stop++;
     const own=rs.slice(at,stop);if(own.some(x=>![66,67,68,69].includes(x.tag))||rs[at].payload.length<22||view(rs[at].payload).getUint16(14,true)!==0)fail('TEXT_BOX_PROFILE_UNSUPPORTED');
     const ts=own.filter(x=>x.tag===67),cs=own.filter(x=>x.tag===68);if(ts.length>1||cs.length!==1)fail('TEXT_BOX_PROFILE_UNSUPPORTED');
     if(!ts.length&&(view(rs[at].payload).getUint32(0,true)&0x7fffffff)!==1)fail('TEXT_BOX_PROFILE_UNSUPPORTED');
     const rawText=ts[0]?.payload??new Uint8Array([13,0]),tokens=textTokens(rawText);if(tokens.some(t=>!t.text&&t.code!==13))fail('TEXT_BOX_PROFILE_UNSUPPORTED');const text=tokens.map(t=>t.text).join(''),unit_styles=rawShapes(rs[at],cs[0],rawText,definitionCount);
     if((view(rs[at].payload).getUint32(0,true)&0x7fffffff)!==rawText.length/2||Boolean(view(rs[at].payload).getUint32(4,true)&(1<<10))!==tokens.some(t=>t.code===10)||tokens.some(t=>t.text&&t.length===2&&unit_styles[t.unit]!==unit_styles[t.unit+1]))fail('TEXT_BOX_PROFILE_UNSUPPORTED');
     const path=[...b.cell_path,{controlIndex:control,cellIndex:0,cellParaIndex:p}];
     let actual;try{actual=doc.getTextInCellByPath(b.section,b.paragraph,JSON.stringify(path),0,[...text].length);}catch{fail('TEXT_BOX_TEXT_UNVERIFIED');}if(actual!==text)fail('TEXT_BOX_TEXT_UNVERIFIED');
     paragraphs.push({id:`${b.id}:tb${index}:p${p}`,paragraph:p,text,record_index:at,records_end:stop,raw_level:rs[at].level,text_record:ts.length?rs.indexOf(ts[0]):null,shape_record:rs.indexOf(cs[0]),tokens,unit_styles});
    }
    const v=view(r.payload),properties={width:v.getUint32(16,true),height:v.getUint32(20,true),horzOffset:v.getInt32(12,true),vertOffset:v.getInt32(8,true)};
    boxes.push({id:`${b.id}:tb${index++}`,block_id:b.id,section:b.section,paragraph:b.paragraph,cell_path:b.cell_path,control_index:control,record_index:i,records_end:end,properties,flow:objectFlow(r),paragraphs,subtree_sha256:createHash('sha256').update(encodeRecords(rs.slice(i,end))).digest('hex')});
   }catch(error){if(!(error instanceof GuardError))throw error;}
  }
 }return boxes;
}
export function publicTextBoxes(state,version){const target=id=>`hwp5:${version}:${Buffer.from(id).toString('base64url')}`;return state.text_boxes.map(box=>({id:box.id,target_id:target(box.id),block_id:box.block_id,section:box.section,paragraph:box.paragraph,cell_path:box.cell_path,control_index:box.control_index,properties:box.properties,flow:box.flow,subtree_sha256:box.subtree_sha256,geometry_editable:Boolean(textBoxGeometry(state,box)),drawing_node_id:box.drawing_node_id,object_path:box.object_path,nested_object:box.nested_object,mapping_basis:box.mapping_basis,profile:box.nested_object||box.paragraphs.some(p=>p.fields?.length)?'drawing_tree_text_list':box.cell_path.length?'cell_rectangle_plain_paragraphs':'body_rectangle_plain_paragraphs',paragraphs:box.paragraphs.map(p=>({id:p.id,target_id:target(p.id),paragraph:p.paragraph,text:p.text,editable:true,paragraph_properties:p.paragraph_properties,character_runs:p.character_runs,fields:(p.fields??[]).map(f=>({id:f.id,target_id:target(f.id),field_type:f.field_type,name:f.name,guide:f.guide,value:f.value,command:f.command,editable:f.editable,cache_only:f.cache_only,read_only_reason:f.read_only_reason}))}))}));}
export function editTextBox(state,source,version,op){
 if(!equal(Object.keys(op).sort(),['type','target_id','expected_old','start','end','new_text','expected_properties'].sort()))fail('INVALID_OPERATION');
 if(typeof op.target_id!=='string'||!op.target_id.startsWith(`hwp5:${version}:`))fail('VERSION_CONFLICT');const encoded=op.target_id.slice(70),id=Buffer.from(encoded,'base64url').toString();if(Buffer.from(id).toString('base64url')!==encoded)fail('INVALID_TARGET');
 const box=state.text_boxes.find(box=>box.paragraphs.some(p=>p.id===id)),p=box?.paragraphs.find(p=>p.id===id);if(!p)fail('TEXT_BOX_TARGET_REQUIRED');
 if(p.text!==op.expected_old)fail('EXPECTED_OLD_MISMATCH');if(!sameProperties(op.expected_properties,box.properties))fail('EXPECTED_TEXT_BOX_MISMATCH');
 // Structural paragraph insertion is deliberately separate from in-paragraph LF.
 let records=state.recordSets.get(box.section),block=p;
 if(p.text_record===null){const at=p.record_index+1;records=records.toSpliced(at,0,{tag:67,level:p.raw_level+1,payload:new Uint8Array([13,0])});block={...p,text_record:at,shape_record:p.shape_record+1,records_end:p.records_end+1};}
 const patch=spliceRawParagraph(records,block,op.start,op.end,op.new_text);if(patch.wanted===p.text)return {bytes:source,content_verified:true,raw_preservation_verified:true,unchanged:true,layout_verified:false};
 const bytes=publishVerifiedPatch(source,state,box.section,patch.records);return {bytes,content_verified:true,raw_preservation_verified:true,text_box_changed:true,text_range_changed:true,raw_preservation_scope:'selected_plain_text_box_text_style_runs_and_line_cache; drawing_geometry_other_controls_and_streams_exact',layout_verified:false};
}
