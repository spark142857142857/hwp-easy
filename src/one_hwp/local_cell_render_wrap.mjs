/** Preserve leaf-cell padding in the disposable view. No authoring bytes escape.
 * Pinned, document-bound base advances exclude renderer justification stretch.
 */
import {view} from './local_complex_records.mjs';
import {parseRecords} from '../../probes/sites-runtime/guard/records.mjs';
import {createNaturalTextMeasurer} from './local_font_measure.mjs';
import {renderTableKey} from './local_render_table_identity.mjs';
const same=(a,b)=>JSON.stringify(a)===JSON.stringify(b);
const path=b=>b.cell_path.flatMap(p=>[p.controlIndex,p.cellIndex,p.cellParaIndex]);
const font=p=>p&&[70,74].includes(p.length)&&view(p).getUint32(42,true)>=100&&view(p).getUint32(42,true)<=20000&&(view(p).getUint32(46,true)&~(15|0x180000))===0&&[...p.subarray(14,21),...p.subarray(28,35)].every(n=>n>=50&&n<=200)&&[...p.subarray(21,28)].every(n=>n<=50||n>=236)&&[...p.subarray(35,42)].every(n=>n===0);

export function projectCellLines(text,widths,width){
 const cuts=new Set(),atoms=[...new Intl.Segmenter('und',{granularity:'grapheme'}).segment(text)].map(a=>({text:a.segment,at:a.index,width:widths.slice(a.index,a.index+a.segment.length).reduce((n,w)=>n+w,0)}));let x=0,line=[];
 const closing=/^[\p{Pe}\p{Pf},.!?:;、。，！？：；%‰]/u,opening=/[\p{Ps}\p{Pi}]$/u,word=/^[\p{Script=Latin}\p{Number}\p{Mark}]+$/u;
 const wrap=next=>{let carry=[];if(line.length&&(closing.test(next.text)||opening.test(line.at(-1).text))){carry.unshift(line.pop());while(line.length&&opening.test(line.at(-1).text))carry.unshift(line.pop());}const start=carry[0]?.at??next.at;cuts.add(start);line=carry;x=carry.reduce((n,a)=>n+a.width,0);};
 for(let i=0;i<atoms.length;i++){
  const atom=atoms[i];if(atom.text==='\n'){line=[];x=0;continue;}
  if(word.test(atom.text)&&(i===0||!word.test(atoms[i-1].text))){let n=i,total=0;while(n<atoms.length&&word.test(atoms[n].text))total+=atoms[n++].width;if(x>0&&x+total>width)wrap(atom);}
  if(atom.width>width||!Number.isFinite(atom.width)||atom.width<0)return null;
  if(!/^ +$/.test(atom.text)&&x>0&&x+atom.width>width)wrap(atom);
  line.push(atom);x+=atom.width;
 }
 let rendered='';const offsets=[],synthetic=new Set();
 for(let i=0;i<text.length;i++){if(cuts.has(i)){synthetic.add(rendered.length);offsets.push(i);rendered+='\n';}offsets.push(i);rendered+=text[i];}offsets.push(text.length);
 return {text:rendered,offsets,synthetic,lines:rendered.split('\n').length};
}

export function projectCellRenderText(text,projection){
 if(text.length!==projection.text.length)return null;if(projection.normalized)return text===projection.text?projection.sourceText:null;
 let result='';for(let i=0;i<text.length;i++){if(projection.synthetic.has(i)){if(text[i]!==((projection.syntheticValues??{})[i]??'\n'))return null;}else result+=text[i];}return result;
}

export function adaptLeafCellWraps(document,state,bindings,context){
 const {rs,changes,headers,shapes,extra,removed,replacements}=context,adapted=[],unadapted=[];let normalizedMeasure;
 if(document.pageCount()>32||typeof document.getFontDecisionTrace!=='function')return {adapted,unadapted};
 const runs=JSON.parse(document.getPageTextLayout(0)).runs,controls=JSON.parse(document.getPageControlLayout(0)).controls;let trace=null,total=0;
 const fonts=[...parseRecords(state.raw.streams.get('DocInfo'))].filter(r=>r.tag===21);
 for(const control of controls.filter(c=>c.type==='table')){
  const table=bindings.get(renderTableKey(control,0));if(!table)continue;
  for(const cell of table.cells){
   const header=changes.get(rs[cell.start]),p=header&&view(header.payload),left=header&&view(rs[cell.start].payload).getUint16(24,true)||p?.getUint16(24,true),right=header&&view(rs[cell.start].payload).getUint16(26,true)||p?.getUint16(26,true),frame=control.cells.find(c=>c.row===cell.row&&c.col===cell.col);
   if(!frame||!p||!cell.blocks.length||left<=75||cell.blocks.some(b=>state.tables.some(t=>t.parent_id===b.id)))continue;
   if(cell.blocks.some(b=>!b.text_range_editable||!/^[\p{Script=Hangul}\p{Script=Latin}\p{Script=Han}\p{Number}\p{Punctuation}\p{Zs}\p{Mark}\n]*$/u.test(b.text)||b.unit_styles.some(id=>!font(fonts[id]?.payload)))){
    for(const b of cell.blocks)if(b.text&&runs.some(r=>r.parentParaIdx===b.paragraph&&same(r.cellPath,b.cell_path)&&r.x<frame.x+left/75-.5))unadapted.push({block_id:b.id,cell_path:b.cell_path,reason:'cell_wrap_text_profile'});continue;
   }
   const checkpoint={changes:new Map(changes),headers:new Map(headers),header:header.payload.slice(),extra:extra.length,removed:new Set(removed),replacements:new Map(replacements),adapted:adapted.length,unadapted:unadapted.length};
   for(const first of cell.blocks){const observed=runs.filter(r=>r.text&&r.parentParaIdx===first.paragraph&&same(r.cellPath,first.cell_path));
   if(first.text&&(!observed.length||Math.min(...observed.map(r=>r.x))>=frame.x+left/75-.5))continue;
   const reject=reason=>unadapted.push({block_id:first.id,cell_path:first.cell_path,reason});
   const shape=shapes[first.paragraph_properties.paraShapeId];
   if(!first.text_range_editable||first.text.length>1024||!/^[\p{Script=Hangul}\p{Script=Latin}\p{Script=Han}\p{Number}\p{Punctuation}\p{Zs}\p{Mark}\n]*$/u.test(first.text)||first.tokens.some(t=>!t.text&&t.code!==13)||!shape||![46,54,58].includes(shape.payload.length)||(view(shape.payload).getUint32(0,true)&0xffe0)!==0x180||first.unit_styles.some(id=>!font(fonts[id]?.payload))||Buffer.from(rs[first.text_record]?.payload??Buffer.from('\r','utf16le')).toString('utf16le')!==first.text+'\r'){
    reject('cell_wrap_text_profile');continue;
   }
   total+=first.text.length;if(total>4096){reject('cell_wrap_trace_budget');continue;}
   if(!trace){const value=JSON.parse(document.getFontDecisionTrace(0,JSON.stringify({maxCharacters:4096})));trace=value.schemaVersion===1&&Array.isArray(value.records)?value.records:[];}
   const samples=trace.filter(r=>r.source?.status==='complete'&&r.source.sectionIndex===first.section&&r.source.paragraphIndex===first.paragraph&&same(r.source.nestedPath,path(first))),widths=[];
   let valid=true;
   for(let i=0;i<first.text.length;i++){
    if(first.text[i]==='\n'){widths.push(0);continue;}
    const found=samples.filter(r=>r.source.charOffset===i&&r.source.character===first.text[i]&&r.source.charShapeId===first.unit_styles[i]),m=found[0]?.layoutMetric;
    if(found.length!==1||!m||!(m.widthSource==='embeddedMetric'||first.text[i]===' '&&m.widthSource==='metricHalfSpace')||!['exact','boldOnly'].includes(m.matchKind)||m.characterMatch!=='hit'||!Number.isFinite(m.baseAdvanceHwpunit)||m.baseAdvanceHwpunit<0||!Array.isArray(m.transforms)||m.transforms.some(t=>!['extraCharacterSpacing','extraWordSpacing','ratio','letterSpacing'].includes(t.kind))){valid=false;break;}
    let advance=m.baseAdvanceHwpunit;for(const t of m.transforms)if(t.kind==='ratio')advance*=Number(t.output);
    if(m.transforms.some(t=>t.kind==='letterSpacing')){const source=fonts[first.unit_styles[i]].payload,spacing=[...source.subarray(21,28)].map(n=>n>127?n-256:n);if(spacing.some(n=>n!==spacing[0])){valid=false;break;}
     // HWP spacing is proportional to the ratio-adjusted glyph advance, not
     // an absolute font-size addition. Match its integral HWPUNIT decision.
     advance=Math.trunc(advance*(1+spacing[0]/100)+1e-6);
    }if(!Number.isFinite(advance)||advance<0){valid=false;break;}widths.push(advance);
   }
   let text=first.text,sourceOffsets=Array.from({length:text.length+1},(_,i)=>i),normalizedClusters=0;
   if(text.normalize('NFC')!==text&&context.bytes){
    let normalized='';sourceOffsets=[];let safe=true;const ids=[];
    for(const g of new Intl.Segmenter('und',{granularity:'grapheme'}).segment(text)){const value=g.segment.normalize('NFC'),styles=first.unit_styles.slice(g.index,g.index+g.segment.length);if(styles.some(id=>id!==styles[0])){safe=false;break;}if(value!==g.segment)normalizedClusters++;for(let i=0;i<value.length;i++){sourceOffsets.push(g.index);ids.push(styles[0]);}normalized+=value;}sourceOffsets.push(text.length);
    if(safe){const runs=[];for(let i=0;i<ids.length;i++){if(!i||ids[i]!==ids[i-1])runs.push({start:i,end:i+1,properties:{charShapeId:ids[i],fontSize:view(fonts[ids[i]].payload).getUint32(42,true)}});else runs.at(-1).end=i+1;}
     try{normalizedMeasure??=createNaturalTextMeasurer(document.constructor,context.bytes,{prefixProof:true});if(!normalizedMeasure.isExact(normalized,runs))safe=false;else{const measured=normalizedMeasure(normalized,runs);widths.length=0;let at=0;for(const ch of normalized)widths.push(ch==='\n'?0:measured[at++]*75);text=normalized;valid=true;}}catch{safe=false;}
    }if(!safe)valid=false;
   }
   const width=cell.width-left-right,projection=valid&&width>0?projectCellLines(text,widths,width):null;
   if(projection&&normalizedClusters){projection.offsets=projection.offsets.map(i=>sourceOffsets[i]);projection.normalized=true;projection.sourceText=first.text;}

   if(projection&&!first.text){projection.text=' ';projection.offsets=[0,0];projection.synthetic=new Set([0]);projection.syntheticValues={0:' '};projection.onlySynthetic=true;}
   if(!projection){reject('cell_wrap_font_metrics_unverified');continue;}
   const sizes=first.unit_styles.map(id=>view(fonts[id].payload).getUint32(42,true));
   projection.styleOffsets=projection.offsets.map((offset,i)=>projection.synthetic.has(i)?(sizes[Math.max(0,offset-1)]<=sizes[offset]?Math.max(0,offset-1):offset):offset);
   const lineSizes=[];let lineSize=0;for(let i=0;i<projection.text.length;i++){if(projection.text[i]==='\n'){lineSizes.push(Math.max(lineSize,sizes[projection.styleOffsets[i]]));lineSize=0;}else lineSize=Math.max(lineSize,sizes[projection.styleOffsets[i]]);}lineSizes.push(lineSize||sizes.at(-1));
   const spacing=first.paragraph_properties.lineSpacing/100,expectedHeight=lineSizes.reduce((n,size,i)=>n+Math.max(size,lineSizes[i-1]??size,lineSizes[i+1]??size)*spacing,0)-lineSizes.at(-1)*(spacing-1);
   if(expectedHeight>cell.height-p.getUint16(28,true)-p.getUint16(30,true)){reject('cell_wrap_exceeds_stored_height');continue;}
   const fixed=shape.payload.slice(),q=view(fixed);q.setInt32(4,left*2,true);q.setInt32(8,right*2,true);
   const h={...rs[first.record_index],payload:rs[first.record_index].payload.slice()},v=view(h.payload),textBytes=Buffer.from(projection.text+'\r','utf16le'),ids=projection.styleOffsets.map(offset=>first.unit_styles[offset]),styles=[];
   ids.forEach((id,i)=>{if(!i||id!==ids[i-1])styles.push([i,id]);});if(styles.length>32){reject('cell_wrap_style_budget');continue;}
   const styleBytes=Buffer.alloc(styles.length*8);styles.forEach(([at,id],i)=>{styleBytes.writeUInt32LE(at,i*8);styleBytes.writeUInt32LE(id,i*8+4);});
   v.setUint32(0,((v.getUint32(0,true)&0x80000000)|textBytes.length/2)>>>0,true);v.setUint32(4,projection.text.includes('\n')?1024:0,true);v.setUint16(8,shapes.length+extra.length,true);v.setUint16(12,styles.length,true);v.setUint16(16,0,true);
   p.setUint16(24,0,true);p.setUint16(26,0,true);changes.set(rs[first.record_index],h);if(rs[first.text_record])changes.set(rs[first.text_record],{...rs[first.text_record],payload:textBytes});else replacements.set(rs[first.record_index],[h,{tag:67,level:h.level+1,payload:textBytes},...rs.slice(first.record_index+1,first.records_end)]);changes.set(rs[first.shape_record],{...rs[first.shape_record],payload:styleBytes});extra.push({tag:25,level:shape.level,payload:fixed});headers.set(h,{block:first,from:0,projection});
   for(let at=first.record_index+1;at<first.records_end;at++)if(rs[at].tag===69&&rs[at].level===first.raw_level+1)removed.add(rs[at]);
   adapted.push({block_id:first.id,section:first.section,paragraph:first.paragraph,cell_path:first.cell_path,padding_left:left,padding_right:right,render_lines:projection.lines,render_line_sizes:lineSizes,inserted_line_breaks:projection.synthetic.size,metric_source:'pinned_document_exact_base_advances',normalized_clusters:normalizedClusters,font_and_native_layout_verified:false});
   }
   if(unadapted.length>checkpoint.unadapted){header.payload.set(checkpoint.header);changes.clear();for(const pair of checkpoint.changes)changes.set(...pair);headers.clear();for(const pair of checkpoint.headers)headers.set(...pair);extra.length=checkpoint.extra;replacements.clear();for(const pair of checkpoint.replacements)replacements.set(...pair);removed.clear();for(const r of checkpoint.removed)removed.add(r);adapted.length=checkpoint.adapted;}
  }
 }
 return {adapted,unadapted};
}

/** Runs may split a physical line at a source character-style boundary. */
export function validateProjectedCellRuns(runs,projection,block){
 const lines=[];let at=0;for(const text of projection.text.split('\n')){lines.push({text,start:at,end:at+text.length,runs:[]});at+=text.length+1;}
 let previous=-1;
 for(const r of runs){const start=r.charStart;if(!Number.isSafeInteger(start)||start<=previous||start<0||projection.text.slice(start,start+r.text.length)!==r.text)return false;previous=start;
  const line=lines.find(l=>start>=l.start&&start<l.end);if(!line||start+r.text.length>line.end||block.unit_styles.slice(start,start+r.text.length).some(id=>id!==r.charShapeId))return false;line.runs.push(r);
 }
 let y=-Infinity,page=-1;for(const l of lines.filter(l=>l.text)){const p=l.runs[0]?.renderPage??0;if(p<page||l.runs.map(r=>r.text).join('')!==l.text||p===page&&l.runs[0].y<=y+.5||l.runs.some(r=>(r.renderPage??0)!==p||Math.abs(r.y-l.runs[0].y)>.2))return false;page=p;y=l.runs[0].y;}
 return true;
}

/** Return original offsets/text even when a disposable glyph uses NFC. */
export function remapProjectedCellRun(run,projection,block){
 const start=projection.offsets[run.charStart??0]??block.text.length;
 if(!projection.normalized)return {charStart:start,paraShapeId:block.paragraph_properties.paraShapeId};
 const end=projection.offsets[(run.charStart??0)+run.text.length]??block.text.length,text=block.text.slice(start,end),charX=[];
 if(Array.isArray(run.charX)){for(let i=0;i<run.text.length;i++){const a=projection.offsets[(run.charStart??0)+i],b=projection.offsets[(run.charStart??0)+i+1];for(let n=a;n<b;n++)charX.push(run.charX[i]);}charX.push(run.charX.at(-1));}
 return {text,charStart:start,...(charX.length?{charX}:{}),paraShapeId:block.paragraph_properties.paraShapeId,render_normalized_clusters:true};
}
