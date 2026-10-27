/** Preserve leaf-cell padding in the disposable view. No authoring bytes escape.
 * Pinned, document-bound base advances exclude renderer justification stretch.
 */
import {view} from './local_complex_records.mjs';
import {parseRecords} from '../../probes/sites-runtime/guard/records.mjs';
import {renderTableKey} from './local_render_table_identity.mjs';
const same=(a,b)=>JSON.stringify(a)===JSON.stringify(b);
const path=b=>b.cell_path.flatMap(p=>[p.controlIndex,p.cellIndex,p.cellParaIndex]);
const font=p=>p&&[70,74].includes(p.length)&&view(p).getUint32(42,true)===1000&&view(p).getUint32(46,true)===0&&[...p.subarray(14,21),...p.subarray(28,35)].every(n=>n===100)&&[...p.subarray(21,28),...p.subarray(35,42)].every(n=>n===0);

function project(text,widths,width){
 const cuts=new Set();let x=0,at=0;
 for(const match of text.matchAll(/[A-Za-z0-9]+| +|[\uac00-\ud7a3]|\n/g)){
  if(match.index!==at)return null;
  const token=match[0],total=widths.slice(at,at+token.length).reduce((a,b)=>a+b,0);
  if(token==='\n'){x=0;at++;continue;}
  if(token[0]===' '){x+=total;at+=token.length;continue;}
  if(/^[A-Za-z0-9]/.test(token)&&total<=width&&x>0&&x+total>width){cuts.add(at);x=0;}
  for(let i=0;i<token.length;i++,at++){
   const advance=widths[at];if(advance>width)return null;
   if(x>0&&x+advance>width){cuts.add(at);x=0;}x+=advance;
  }
 }
 if(at!==text.length)return null;
 let rendered='';const offsets=[],synthetic=new Set();
 for(let i=0;i<text.length;i++){if(cuts.has(i)){synthetic.add(rendered.length);offsets.push(i);rendered+='\n';}offsets.push(i);rendered+=text[i];}offsets.push(text.length);
 return {text:rendered,offsets,synthetic,lines:rendered.split('\n').length};
}

export function projectCellRenderText(text,projection){
 if(text.length!==projection.text.length)return null;
 let result='';for(let i=0;i<text.length;i++){if(projection.synthetic.has(i)){if(text[i]!=='\n')return null;}else result+=text[i];}return result;
}

export function adaptLeafCellWraps(document,state,bindings,context){
 const {rs,changes,headers,shapes,extra,removed}=context,adapted=[],unadapted=[];
 if(document.pageCount()!==1||typeof document.getFontDecisionTrace!=='function')return {adapted,unadapted};
 const runs=JSON.parse(document.getPageTextLayout(0)).runs,controls=JSON.parse(document.getPageControlLayout(0)).controls;let trace=null,total=0;
 const fonts=[...parseRecords(state.raw.streams.get('DocInfo'))].filter(r=>r.tag===21);
 for(const control of controls.filter(c=>c.type==='table')){
  const table=bindings.get(renderTableKey(control,0));if(!table)continue;
  for(const cell of table.cells){
   const header=changes.get(rs[cell.start]),p=header&&view(header.payload),left=p?.getUint16(24,true),right=p?.getUint16(26,true),frame=control.cells.find(c=>c.row===cell.row&&c.col===cell.col);
   if(!frame||!p||!cell.blocks.length||left<=75||cell.blocks.some(b=>state.tables.some(t=>t.parent_id===b.id)))continue;
   const first=cell.blocks[0],observed=runs.filter(r=>r.text&&r.parentParaIdx===first.paragraph&&same(r.cellPath,first.cell_path));
   if(!observed.length||Math.min(...observed.map(r=>r.x))>=frame.x+left/75-.5)continue;
   const reject=reason=>unadapted.push({block_id:first.id,cell_path:first.cell_path,reason});
   const shape=shapes[first.paragraph_properties.paraShapeId];
   if(cell.blocks.length!==1||!first.text_range_editable||first.text.length>1024||!/^[A-Za-z0-9 \n\uac00-\ud7a3]+$/.test(first.text)||first.tokens.some(t=>!t.text&&t.code!==13)||!shape||![46,54,58].includes(shape.payload.length)||(view(shape.payload).getUint32(0,true)&0xffe0)!==0x180||first.unit_styles.some(id=>!font(fonts[id]?.payload))||Buffer.from(rs[first.text_record].payload).toString('utf16le')!==first.text+'\r'){
    reject('cell_wrap_text_profile');continue;
   }
   total+=first.text.length;if(total>4096){reject('cell_wrap_trace_budget');continue;}
   if(!trace){const value=JSON.parse(document.getFontDecisionTrace(0,JSON.stringify({maxCharacters:4096})));trace=value.schemaVersion===1&&Array.isArray(value.records)?value.records:[];}
   const samples=trace.filter(r=>r.source?.status==='complete'&&r.source.sectionIndex===first.section&&r.source.paragraphIndex===first.paragraph&&same(r.source.nestedPath,path(first))),widths=[];
   let valid=true;
   for(let i=0;i<first.text.length;i++){
    if(first.text[i]==='\n'){widths.push(0);continue;}
    const found=samples.filter(r=>r.source.charOffset===i&&r.source.character===first.text[i]&&r.source.charShapeId===first.unit_styles[i]),m=found[0]?.layoutMetric;
    if(found.length!==1||!m||!(m.widthSource==='embeddedMetric'||first.text[i]===' '&&m.widthSource==='metricHalfSpace')||m.matchKind!=='exact'||m.characterMatch!=='hit'||!Number.isFinite(m.baseAdvanceHwpunit)||m.baseAdvanceHwpunit<=0||!Array.isArray(m.transforms)||m.transforms.some(t=>!['extraCharacterSpacing','extraWordSpacing'].includes(t.kind))){valid=false;break;}
    widths.push(m.baseAdvanceHwpunit);
   }
   const width=cell.width-left-right,projection=valid&&width>0?project(first.text,widths,width):null;
   if(!projection){reject('cell_wrap_font_metrics_unverified');continue;}
   const expectedHeight=projection.lines*1000*first.paragraph_properties.lineSpacing/100-1000*(first.paragraph_properties.lineSpacing/100-1);
   if(expectedHeight>cell.height-p.getUint16(28,true)-p.getUint16(30,true)){reject('cell_wrap_exceeds_stored_height');continue;}
   const fixed=shape.payload.slice(),q=view(fixed);q.setUint32(0,(q.getUint32(0,true)&~28)|4,true);q.setInt32(4,left*2,true);q.setInt32(8,right*2,true);
   const h={...rs[first.record_index],payload:rs[first.record_index].payload.slice()},v=view(h.payload),text=Buffer.from(projection.text+'\r','utf16le'),ids=projection.offsets.map((offset,i)=>first.unit_styles[projection.synthetic.has(i)?Math.max(0,offset-1):offset]),styles=[];
   ids.forEach((id,i)=>{if(!i||id!==ids[i-1])styles.push([i,id]);});if(styles.length>32){reject('cell_wrap_style_budget');continue;}
   const styleBytes=Buffer.alloc(styles.length*8);styles.forEach(([at,id],i)=>{styleBytes.writeUInt32LE(at,i*8);styleBytes.writeUInt32LE(id,i*8+4);});
   v.setUint32(0,((v.getUint32(0,true)&0x80000000)|text.length/2)>>>0,true);v.setUint32(4,projection.text.includes('\n')?1024:0,true);v.setUint16(8,shapes.length+extra.length,true);v.setUint16(12,styles.length,true);v.setUint16(16,0,true);
   p.setUint16(24,0,true);p.setUint16(26,0,true);changes.set(rs[first.record_index],h);changes.set(rs[first.text_record],{...rs[first.text_record],payload:text});changes.set(rs[first.shape_record],{...rs[first.shape_record],payload:styleBytes});extra.push({tag:25,level:shape.level,payload:fixed});headers.set(h,{block:first,from:0,projection});
   for(let at=first.record_index+1;at<first.records_end;at++)if(rs[at].tag===69&&rs[at].level===first.raw_level+1)removed.add(rs[at]);
   adapted.push({block_id:first.id,section:first.section,paragraph:first.paragraph,cell_path:first.cell_path,padding_left:left,padding_right:right,render_lines:projection.lines,inserted_line_breaks:projection.synthetic.size,metric_source:'pinned_document_exact_base_advances',font_and_native_layout_verified:false});
  }
 }
 return {adapted,unadapted};
}
