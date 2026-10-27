/** Horizontal text scene in transformed bounds. Private bytes never reach storage. */
import {readHwp} from '../../probes/sites-runtime/guard/container.mjs';
import {parseRecords} from '../../probes/sites-runtime/guard/records.mjs';
import {view,encodeRecords,fail} from './local_complex_records.mjs';
import {packLocalBodyRewrite} from './local_body_write.mjs';
import {groupGeometry} from './local_complex_group.mjs';
import {fieldKinds} from './local_field_records.mjs';
import {svgInner} from './local_svg_geometry.mjs';
import {createNaturalTextMeasurer} from './local_font_measure.mjs';
import {projectCellLines} from './local_cell_render_wrap.mjs';
import {parseEngineSvg} from './local_svg_scene.mjs';

const identity=[1,0,0,0,1,0];
const near=(a,b)=>Math.abs(a-b)<.15;
const attr=(tag,name)=>Number(new RegExp(`\\b${name}="([^"]+)"`).exec(tag)?.[1]);
export function projectDrawingText(Doc,bytes,state,node,box,displayFrame){
 const rs=state.recordSets.get(node.section),g=node.geometry;
 if(!g.width||!g.height||g.width>720000||g.height>720000||g.v.getUint32(g.base+20,true)!==g.width||g.v.getUint32(g.base+24,true)!==g.height)fail('DRAWING_TEXT_INTRINSIC_FRAME_UNVERIFIED');
 for(const p of box.paragraphs)for(let i=p.record_index+1;i<p.records_end;i++)if(rs[i].tag===71&&!fieldKinds.has(Buffer.from(rs[i].payload.subarray(0,4)).toString()))fail('DRAWING_TEXT_NESTED_CONTROL_UNVERIFIED');
 const width=Math.round(displayFrame.w*75),height=Math.round(displayFrame.h*75);if(width<1||height<1||width>720000||height>720000)fail('DRAWING_TEXT_FRAME_UNVERIFIED');
 const blank=Doc.createEmpty();let template;
 try{blank.createBlankDocument();template=[...parseRecords(readHwp(blank.exportHwp()).streams.get('BodyText/Section0'))].map(r=>({...r,payload:r.payload.slice()}));}finally{blank.free();}
 const h=template[0],text=template.find(r=>r.tag===67&&r.level===1),style=template.find(r=>r.tag===68&&r.level===1);
 if(h?.tag!==66||!text||!style)fail('DRAWING_TEXT_TEMPLATE_UNVERIFIED');
 const anchor=Buffer.alloc(16);anchor.writeUInt16LE(11);anchor.write(' osg',2);anchor.writeUInt16LE(11,14);
 text.payload=Buffer.concat([text.payload.subarray(0,-2),anchor,Buffer.from('\r','utf16le')]);view(h.payload).setUint32(0,(0x80000000|text.payload.length/2)>>>0,true);view(h.payload).setUint32(4,4|(1<<11),true);
 for(const r of template)if(r.tag===73){const p=view(r.payload);p.setUint32(0,Math.max(width+7500,60000),true);p.setUint32(4,Math.max(height+7500,80000),true);for(const at of [8,12,16,20,24,28,32,36])p.setUint32(at,0,true);}
 const common={...rs[node.root.control_record],level:1,payload:rs[node.root.control_record].payload.slice()},c=view(common.payload);
 c.setUint32(4,(4<<15)|(2<<18)|(3<<21)|(1<<24),true);c.setInt32(8,0,true);c.setInt32(12,0,true);c.setUint32(16,width,true);c.setUint32(20,height,true);for(const at of [28,30,32,34])c.setUint16(at,0,true);
 const projections=new Map(),measure=createNaturalTextMeasurer(Doc,bytes),sourceRows=[],list=view(rs[box.list_record].payload),vertical=(list.getUint32(4,true)>>5)&3,available=(width-list.getInt16(8,true)-list.getInt16(10,true))/75;
 if(vertical===3||vertical&&box.paragraphs.some(p=>!p.text||p.paragraph_properties.spacingBefore||p.paragraph_properties.spacingAfter))fail('DRAWING_TEXT_ALIGNMENT_UNVERIFIED');
 if(available<=0)fail('DRAWING_TEXT_FRAME_UNVERIFIED');
 for(let at=node.shape_record;at<node.records_end;at++){
  const p=box.paragraphs.find(p=>p.record_index===at);if(!p){sourceRows.push(rs[at]);continue;}
  if(p.text.includes('\t')||p.text.length>10000||view(rs[at].payload).getUint16(14,true)!==0)fail('DRAWING_TEXT_PARAGRAPH_PROFILE_UNVERIFIED');
  const q=p.paragraph_properties;if(q.marginLeft||q.marginRight||q.indent)fail('DRAWING_TEXT_PARAGRAPH_PROFILE_UNVERIFIED');
  const measured=p.text?measure(p.text,p.character_runs):[],widths=[];let next=0;for(const ch of p.text){const w=ch==='\n'?0:measured[next++];widths.push(w);for(let i=1;i<ch.length;i++)widths.push(0);}if(next!==measured.length)fail('DRAWING_TEXT_MEASUREMENT_UNVERIFIED');
  const boundary=new Set((p.fields??[]).flatMap(f=>[f.start,f.end]).map(n=>[...p.text].slice(0,n).join('').length)),projection=projectCellLines(p.text,widths,available,boundary);if(!projection)fail('DRAWING_TEXT_MEASUREMENT_UNVERIFIED');projections.set(p.paragraph,projection);
  const ids=p.tokens.filter(t=>t.text).flatMap(t=>p.unit_styles.slice(t.unit,t.unit+t.length)),styles=projection.offsets.slice(0,-1).map(n=>ids[n]??ids.at(-1)??p.unit_styles[0]);styles.push(ids.at(-1)??p.unit_styles[0]);const anchors=[];styles.forEach((id,i)=>{if(!i||id!==styles[i-1])anchors.push([i,id]);});if(anchors.length>32)fail('DRAWING_TEXT_STYLE_LIMIT');
  const shape=Buffer.alloc(anchors.length*8);anchors.forEach(([unit,id],i)=>{shape.writeUInt32LE(unit,i*8);shape.writeUInt32LE(id,i*8+4);});const h={...rs[at],payload:rs[at].payload.slice()},hv=view(h.payload),text=Buffer.from(projection.text+'\r','utf16le');hv.setUint32(0,((hv.getUint32(0,true)&0x80000000)|text.length/2)>>>0,true);hv.setUint32(4,projection.text.includes('\n')?1<<10:0,true);hv.setUint16(12,anchors.length,true);hv.setUint16(14,0,true);hv.setUint16(16,0,true);
  sourceRows.push(h,{tag:67,level:h.level+1,payload:text},{tag:68,level:h.level+1,payload:shape});at=p.records_end-1;
 }
 const rows=sourceRows.map(r=>({...r,level:r.level-rs[node.shape_record].level+2,payload:r.payload.slice()})),local=groupGeometry(rows[0]);
 const privateList=rows.find(r=>r.tag===72);if(!privateList)fail('DRAWING_TEXT_SOURCE_UNVERIFIED');view(privateList.payload).setUint32(4,list.getUint32(4,true)&~96,true);
 local.v.setUint16(local.base+8,0,true);local.v.setInt16(local.base+32,0,true);local.v.setUint32(local.base+28,local.v.getUint32(local.base+28,true)&~3,true);
 for(const at of [12,20])local.v.setUint32(local.base+at,width,true);for(const at of [16,24])local.v.setUint32(local.base+at,height,true);
 for(const at of [44,...Array.from({length:local.count},(_,i)=>[92+i*96,140+i*96]).flat()])identity.forEach((n,i)=>local.v.setFloat64(local.base+at+i*8,n,true));
 const body=[...template,common,...rows].filter(r=>r.tag!==69);for(const r of body)if(r.tag===66)view(r.payload).setUint16(16,0,true);
 const privateBytes=packLocalBodyRewrite(bytes,state.raw,new Map([['BodyText/Section0',encodeRecords(body)]])),doc=new Doc(privateBytes);
 try{
  const controls=JSON.parse(doc.getPageControlLayout(0)).controls,frame=controls.find(c=>c.type==='shape'&&c.paraIdx===0&&c.controlIdx===2);
  if(controls.length!==1||!frame||!near(frame.x,0)||!near(frame.y,0)||!near(frame.w,width/75)||!near(frame.h,height/75))fail('DRAWING_TEXT_FRAME_UNVERIFIED');
  const runs=JSON.parse(doc.getPageTextLayout(0)).runs;
  if(runs.some(r=>r.parentParaIdx!==0||r.controlIdx!==2||!Number.isInteger(r.cellParaIdx)||!box.paragraphs[r.cellParaIdx]))fail('DRAWING_TEXT_SOURCE_UNVERIFIED');
  for(const p of box.paragraphs){const projection=projections.get(p.paragraph),content=runs.filter(r=>r.cellParaIdx===p.paragraph).map(r=>r.text).join('');if(content!==p.text.replaceAll('\n',''))fail('DRAWING_TEXT_CONTENT_UNVERIFIED');for(const r of runs.filter(r=>r.cellParaIdx===p.paragraph)){if(projection.text.slice(r.charStart,r.charStart+r.text.length)!==r.text)fail('DRAWING_TEXT_SOURCE_UNVERIFIED');r.charStart=projection.offsets[r.charStart];}}
  let inDefs=false,background=0,outline=0;
  const svg=svgInner(doc.renderPageSvg(0));if(svg===undefined)fail('DRAWING_TEXT_SVG_UNVERIFIED');
  let fragment=svg.replace(/<[^>]+>/g,tag=>{
   if(/^<defs\b/.test(tag)){inDefs=true;return tag;}if(/^<\/defs/.test(tag)){inDefs=false;return tag;}if(inDefs||!/^<rect\b/.test(tag))return tag;
   if(near(attr(tag,'x'),0)&&near(attr(tag,'y'),0)){
    if(!background&&attr(tag,'width')>width/75+50&&attr(tag,'height')>height/75+50){background++;return '';}
    if(!outline&&near(attr(tag,'width'),width/75)&&near(attr(tag,'height'),height/75)){outline++;return '';}
   }return tag;
  });
  if(vertical){
   const top=list.getInt16(12,true)/75,inner=(height-list.getInt16(12,true)-list.getInt16(14,true))/75,content=Math.max(0,...runs.map(r=>r.y+r.h-top)),offset=Math.max(0,inner-content)*(vertical===1?.5:1);
   // Move ink inside the original clip, keeping padding and overflow clipping.
   const wrapped='<svg>'+fragment+'</svg>',clips=parseEngineSvg(wrapped).filter(n=>n.name==='g'&&/#[-\w]*textbox-clip-/.test(n.attrs['clip-path']??''));if(clips.length!==1||clips[0].closeStart==null)fail('DRAWING_TEXT_CLIP_UNVERIFIED');const clip=clips[0];
   fragment=wrapped.slice(5,clip.openEnd)+`<g transform="translate(0 ${offset})">`+wrapped.slice(clip.openEnd,clip.closeStart)+'</g>'+wrapped.slice(clip.closeStart,-6);for(const r of runs)r.y+=offset;
  }
  if(background!==1||outline!==1||Buffer.byteLength(fragment)>1024*1024)fail('DRAWING_TEXT_SVG_UNVERIFIED');
  return {fragment,runs};
 }finally{doc.free();}
}
