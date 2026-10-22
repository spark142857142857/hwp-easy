/** Indivisible fields and bounded inline objects in explicit table-host splits. */
import {fail,view} from './local_complex_records.mjs';
import {textBoxGeometry} from './local_text_box_geometry.mjs';
import {complexParagraphProperties} from './local_complex_paragraph.mjs';
import {parseRecords} from '../../probes/sites-runtime/guard/records.mjs';
import {groupGeometry} from './local_complex_group.mjs';

export function tableHostFields(state,b){
 const fields=state.fields.filter(f=>f.block_id===b.id),starts=b.tokens.filter(t=>t.code===3),ends=b.tokens.filter(t=>t.code===4);
 const rs=state.recordSets.get(b.section);let definitions=0;for(let i=b.record_index+1;i<b.records_end;i++)if(rs[i].tag===71&&rs[i].level===b.raw_level+1&&Buffer.from(rs[i].payload.subarray(0,4)).toString()==='klc%')definitions++;
 if(definitions!==fields.length||starts.length!==fields.length||ends.length!==fields.length||fields.some(f=>!f.editable||!starts.some(t=>t.unit+8===f.from)||!ends.some(t=>t.unit===f.to)))fail('TABLE_HOST_FIELD_UNVERIFIED');
 return fields;
}
export function inlineTableHostObject(state,b,at){
 const rs=state.recordSets.get(b.section),picture=state.pictures.find(p=>p.section===b.section&&p.record_index===at),box=state.text_boxes.find(p=>p.section===b.section&&p.record_index===at),object=picture??box;
 if(!object)fail('TABLE_HOST_OBJECT_UNSUPPORTED');
 const f=object.flow,p=object.properties;
 if(!f.treatAsChar||f.widthRelTo!==4||f.heightRelTo!==2||p.horzOffset||p.vertOffset||p.width<=0||p.height<=0||picture&&p.rotationAngle!==0)fail('TABLE_HOST_OBJECT_UNSUPPORTED');
 if(picture){const g=groupGeometry(rs[at+1]);if(g.count!==1||g.combined[0]<=0||g.combined[4]<=0||[1,2,3,5].some(i=>Math.abs(g.combined[i])>1e-9))fail('TABLE_HOST_OBJECT_UNSUPPORTED');}
 if(box){
  if(!textBoxGeometry(state,{...box,flow:{...f,treatAsChar:false}})||box.paragraphs.length!==1||!rs[at+2].payload.subarray(8).every(n=>n===0))fail('TABLE_HOST_TEXT_BOX_UNVERIFIED');
  const paragraph=box.paragraphs[0],props=complexParagraphProperties(state.raw,rs,paragraph),defs=[...parseRecords(state.raw.streams.get('DocInfo'))].filter(r=>r.tag===21);
  if(!/^[\p{Script=Hangul}\p{Script=Latin}\p{Number}\p{Punctuation}\p{Zs}]*$/u.test(paragraph.text)||props.lineSpacingType!==0||props.lineSpacing<100||props.lineSpacing>300||['marginLeft','marginRight','indent','spacingBefore','spacingAfter'].some(k=>props[k]))fail('TABLE_HOST_TEXT_BOX_UNVERIFIED');
  let width=0,size=1000;for(const t of paragraph.tokens.filter(t=>t.text)){const payload=defs[paragraph.unit_styles[t.unit]]?.payload;if(!payload||payload.length<50||[...payload.subarray(14,21),...payload.subarray(28,35)].some(n=>n!==100)||[...payload.subarray(21,28),...payload.subarray(35,42)].some(n=>n!==0)||(view(payload).getUint32(46,true)&~3))fail('TABLE_HOST_TEXT_BOX_UNVERIFIED');const font=view(payload).getUint32(42,true);size=Math.max(size,font);width+=font*1.2;}
  if(width>p.width*.9||size*props.lineSpacing/100*1.2>p.height*.9)fail('TABLE_HOST_TEXT_BOX_UNVERIFIED');
 }
 return {object,kind:picture?'picture':'text_box',width:p.width+f.marginLeft+f.marginRight,height:p.height+f.marginTop+f.marginBottom};
}
export function tableHostParagraphHeight(state,b,width,measure,plainHeight){
 const textHeight=plainHeight(b,width,measure),rs=state.recordSets.get(b.section),fields=tableHostFields(state,b),size=Math.max(1000,...b.character_runs.map(r=>r.properties.fontSize));let guideHeight=0;
 for(const field of fields.filter(f=>!f.value)){const label=field.guide||field.name;if(label.length>80||/[\r\n]/.test(label)||[...label].length*size*1.2>width*.9)fail('TABLE_HOST_FIELD_GUIDE_UNVERIFIED');guideHeight+=Math.ceil(size*b.paragraph_properties.lineSpacing/100*1.2);}
 const controls=[],objects=[];for(let i=b.record_index+1;i<b.records_end;i++)if(rs[i].tag===71&&rs[i].level===b.raw_level+1)controls.push(i);
 for(const at of controls){const id=Buffer.from(rs[at].payload.subarray(0,4)).toString();if([' lbt','klc%'].includes(id))continue;if(id!==' osg')fail('TABLE_REFLOW_CELL_CONTROL_UNSUPPORTED');objects.push(inlineTableHostObject(state,b,at));}
 const normal=textHeight+guideHeight;
 if(!objects.length)return normal;
 if(objects.length!==1||b.text||b.tokens.some(t=>t.code!==11&&t.code!==13)||objects[0].width>width)fail('TABLE_HOST_OBJECT_FLOW_UNVERIFIED');
 return Math.max(normal,Math.ceil((objects[0].height+1000)*b.paragraph_properties.lineSpacing/100*1.08));
}
