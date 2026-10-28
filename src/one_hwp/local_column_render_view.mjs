/** Explicit left-to-right columns, composed from disposable single-column views.
 * This facade has no export/save methods. Automatic column balancing, continued
 * tables and page/section breaks are deliberately outside this bounded profile.
 */
import {openFlowingColumnView,fixedColumnBackground} from './local_flowing_column_view.mjs';
import {deflateRawSync} from 'node:zlib';
import {inspectLocalComplex} from './local_complex.mjs';
import {view,encodeRecords} from './local_complex_records.mjs';
import {patchLocalPackedStreams} from './local_container_write.mjs';
import {bindRenderTables} from './local_render_table_identity.mjs';
import {GuardError,parseRecords} from './guard/records.mjs';
import {readHwp} from './guard/container.mjs';
const id=r=>Buffer.from(r.payload.subarray(0,4)).toString();
const pathKey=b=>JSON.stringify([b.paragraph,b.cell_path]);
const inside=(r,c,top,bottom)=>r.x>=c.x-.5&&r.x+r.w<=c.x+c.width+.5&&r.y>=top-.5&&r.y+r.h<=bottom+.5;

export function openColumnRenderView(HwpDocument,bytes,openSingle){
 // Most render requests are single-column. Detect candidates from raw records
 // before constructing/paginating an extra WASM document (notably long text).
 try{
  const section=readHwp(bytes).streams.get('BodyText/Section0');if(!section)return null;
  const definition=[...parseRecords(section)].find(r=>r.tag===71&&id(r)==='dloc');if(!definition||definition.payload.length<8||((view(definition.payload).getUint16(4,true)>>>2)&255)<=1)return null;
 }catch(e){if(!(e instanceof GuardError)||e.code.includes('LIMIT'))throw e;return null;}
 let flowing;try{flowing=openFlowingColumnView(HwpDocument,bytes,openSingle);}catch(e){if(!(e instanceof GuardError)||e.code.includes('LIMIT'))throw e;}if(flowing)return flowing;
 const original=new HwpDocument(bytes),parts=[];let keep=false;
 try{
  if(original.pageCount()>32)throw new GuardError('RENDERED_LAYOUT_PAGE_LIMIT');
  const info=JSON.parse(original.getPageInfo(0));if(info.columns?.length<=1)return null;
  const state=inspectLocalComplex(HwpDocument,bytes,{includeDocumentInfo:false,verifyCharacterModel:false}),rs=state.recordSets.get(0),columns=rs?.filter(r=>r.tag===71&&id(r)==='dloc'),pages=rs?.filter(r=>r.tag===73);
  if(!state.tables.some(t=>t.cell_path.length))return null;
  const reject=reason=>({unsupported_column_profile:reason});
  if(state.recordSets.size!==1||original.pageCount()!==1||columns?.length!==1||pages?.length!==1||pages[0].payload.length!==40)return reject('column_page_profile');
  const def=columns[0],flags=view(def.payload).getUint16(4,true),count=(flags>>>2)&255,p=view(pages[0].payload),bodyWidth=p.getUint32(0,true)-p.getUint32(8,true)-p.getUint32(12,true)-p.getUint32(32,true),left=p.getUint32(8,true),frames=[];
  if(count<2||count>4||(flags&~0x13fc)||p.getUint32(36,true)!==0||p.getUint32(32,true)!==0||info.columns.length!==count)return reject('column_definition_profile');
  // The compositor clips each column to the body. Never silently discard an
  // authored page decoration or a column rule outside those column frames.
  const borders=[...parseRecords(state.raw.streams.get('DocInfo'))].filter(r=>r.tag===20),emptyBorder='00000000000000000000000000000000000000000000000000000100000000000000000000000000';
  if(rs.filter(r=>r.tag===75).some(r=>r.payload.length!==14||Buffer.from(borders[view(r.payload).getUint16(12,true)-1]?.payload??[]).length===0))return reject('column_page_decoration');
  let x=left;
  if(flags&0x1000){if(![12,16].includes(def.payload.length)||view(def.payload).getUint16(8,true)!==0||(def.payload[10]??0)>16||(def.payload[11]??0)>15||!(def.payload[10]??0)&&def.payload.subarray(11).some(n=>n))return reject('column_definition_profile');const gap=view(def.payload).getUint16(6,true),width=(bodyWidth-gap*(count-1))/count;for(let i=0;i<count;i++){frames.push({x:x/75,width:width/75});x+=width+gap;}}
  else{if(def.payload.length!==14+count*4||(def.payload[8+count*4]??0)>16||(def.payload[9+count*4]??0)>15||!(def.payload[8+count*4]??0)&&def.payload.subarray(9+count*4).some(n=>n))return reject('column_definition_profile');const v=view(def.payload),weights=Array.from({length:count},(_,i)=>({w:v.getInt16(8+i*4,true),gap:v.getInt16(10+i*4,true)}));if(weights.some(c=>c.w<=0||c.gap<0)||weights.at(-1).gap!==0||weights.reduce((n,c)=>n+c.w+c.gap,0)!==32768)return reject('column_definition_profile');for(const c of weights){frames.push({x:x/75,width:bodyWidth*c.w/32768/75});x+=bodyWidth*(c.w+c.gap)/32768;}}
  if(frames.some((c,i)=>c.width<=0||Math.abs(c.x-info.columns[i].x)>.2||Math.abs(c.width-info.columns[i].width)>.2))return reject('column_frame_identity');
  const roots=state.blocks.filter(b=>!b.cell_path.length),groups=[[]];
  for(const [i,b]of roots.entries()){const split=rs[b.record_index].payload[11];if(i&&split&8)groups.push([]);if(i&&(split&~8)||!i&&(split&~3))return reject('column_break_profile');groups.at(-1).push(b);}
  if(groups.length>count||groups.some(g=>!g.length)||rs.some(r=>r.tag===71&&![' lbt',' osg','klc%','dces','dloc'].includes(id(r))))return reject('column_control_profile');
  const bindings=bindRenderTables(original,state);if(!bindings)return reject('column_table_identity');
  const first=roots[0],setup=[];
  for(let at=first.record_index+1;at<first.records_end;at++){const r=rs[at];if(r.tag===71&&r.level===1&&['dces','dloc'].includes(id(r))){let end=at+1;while(end<first.records_end&&rs[end].level>1)end++;setup.push(...rs.slice(at,end));at=end-1;}}
  const anchors=first.tokens.filter(t=>t.code===2);if(anchors.length!==2||setup.filter(r=>r.level===1).length!==2)return reject('column_section_setup');
  const setupText=Buffer.concat(anchors.map(t=>rs[first.text_record].payload.subarray(t.unit*2,(t.unit+8)*2))),top=info.marginTop+info.marginHeader,bottom=info.height-info.marginBottom-info.marginFooter;
  for(const [column,blocks]of groups.entries()){
   const frame=frames[column],selected=rs.slice(blocks[0].record_index,blocks.at(-1).records_end),copies=new Map(),clone=r=>{if(copies.has(r))return copies.get(r);const c={...r,payload:r.payload.slice()};copies.set(r,c);return c;};let records=selected.map(clone);
   if(column){
    if(blocks[0].text_record===undefined||blocks[0].shape_record===undefined)return reject('column_section_setup');
    const b=blocks[0],h=clone(rs[b.record_index]),text=clone(rs[b.text_record]),shape=clone(rs[b.shape_record]);h.payload[11]&=~8;text.payload=Buffer.concat([setupText,text.payload]);const v=view(h.payload);v.setUint32(0,((v.getUint32(0,true)&0x80000000)|text.payload.length/2)>>>0,true);v.setUint32(4,v.getUint32(4,true)|4,true);
    const old=shape.payload,extra=Buffer.alloc(8);extra.writeUInt32LE(b.unit_styles[0],4);for(let at=0;at<old.length;at+=8)view(old).setUint32(at,view(old).getUint32(at,true)+16,true);shape.payload=Buffer.concat([extra,old]);v.setUint16(12,shape.payload.length/8,true);records.splice(3,0,...setup.map(clone));
   }
   const page=clone(pages[0]),pageView=view(page.payload),columnDef=clone(def);pageView.setUint32(8,Math.round(frame.x*75),true);pageView.setUint32(12,Math.round(p.getUint32(0,true)-(frame.x+frame.width)*75),true);columnDef.payload=new Uint8Array(12);columnDef.payload.set(def.payload.subarray(0,4));view(columnDef.payload).setUint16(4,0x1004,true);
   // Cached line segments contain the original column origin; remeasure only
   // this temporary section and keep every source cache untouched.
   records=records.filter(r=>r.tag!==69);for(const r of records)if(r.tag===66)view(r.payload).setUint16(16,0,true);
   const packed=(view(state.raw.streams.get('FileHeader')).getUint32(36,true)&1)?deflateRawSync(encodeRecords(records),{level:9}):encodeRecords(records),privateBytes=patchLocalPackedStreams(bytes,new Map([['BodyText/Section0',packed]])),local=inspectLocalComplex(HwpDocument,privateBytes,{includeDocumentInfo:false,verifyCharacterModel:false}),render=openSingle(privateBytes);parts.push(render);
   if(render.unadapted_tables.length||render.document.pageCount()!==1)return reject('column_local_pagination');
   const reverse=new Map([...copies].map(([a,b])=>[b,a])),localBlocks=new Map(),localTables=new Map(),localObjects=new Map();
   for(const b of local.blocks){const source=state.blocks.find(old=>rs[old.record_index]===reverse.get(records[b.record_index]));if(!source||source.text!==b.text)return reject('column_block_identity');localBlocks.set(pathKey(b),source);}
   for(const t of local.tables){const source=state.tables.find(old=>rs[old.record_index]===reverse.get(records[t.record_index]));if(!source)return reject('column_table_identity');localTables.set(t.id,source);}
   for(const o of [...local.pictures,...local.text_boxes]){const source=[...state.pictures,...state.text_boxes].find(old=>rs[old.record_index]===reverse.get(records[o.record_index]));if(!source||!o.cell_path.length)return reject('column_object_identity');localObjects.set(o.id??`${o.block_id}:${o.control_index}`,{local:o,source});}
   const remap=r=>{
    if(r.type==='table'){const source=localTables.get(r.table_id);if(!source)return null;return {...r,...bindings.byTable.get(source),table_id:source.id,...(source.cell_path.length?{parentParaIdx:source.paragraph,cellPath:source.cell_path}:{})};}
    const b=localBlocks.get(JSON.stringify([r.parentParaIdx??r.paraIdx,r.cellPath??[]]));if(!b)return null;
    const o=r.text_box_id?localObjects.get(r.text_box_id)?.source:r.type?[...localObjects.values()].find(o=>JSON.stringify(o.local.cell_path)===JSON.stringify(r.cellPath)&&o.local.control_index===r.controlIdx)?.source:null;
    if((r.type||r.text_box_id)&&!o)return null;
    return {...r,paraIdx:r.type?b.paragraph:r.text_box_id?0:r.cellPath?b.cell_paragraph:b.paragraph,...(r.cellPath?{parentParaIdx:b.paragraph,cellPath:b.cell_path,controlIdx:r.type?o.control_index:b.cell_path[0].controlIndex,cellIdx:b.cell_path[0].cellIndex,cellParaIdx:b.cell_path[0].cellParaIndex}:{}),...(r.text_box_id?{text_box_id:o.id}:{}),...(r.type?{stableIndex:[b.section,b.paragraph,...b.cell_path.flatMap(p=>[p.controlIndex,p.cellIndex,p.cellParaIndex]),o.control_index],outerTableControlIdx:b.cell_path[0].controlIndex}:{})};
   };
   render.column=column;render.frame=frame;render.runs=JSON.parse(render.document.getPageTextLayout(0)).runs.map(r=>render.remap(r,0)).filter(r=>!r.render_only_synthetic).map(remap);render.controls=JSON.parse(render.document.getPageControlLayout(0)).controls.map(r=>remap(render.remap(r,0)));
   if([...render.runs,...render.controls].some(r=>!r||!inside(r,frame,top,bottom)))return reject('column_content_overflow');
   const mapCell=c=>{const b=local.blocks.find(b=>b.id===c.block_id),source=b&&localBlocks.get(pathKey(b));if(!source)throw new GuardError('COLUMN_CELL_WRAP_IDENTITY');return {...c,block_id:source.id,section:source.section,paragraph:source.paragraph,cell_path:source.cell_path,column};};
   render.sourceCellWraps=render.cell_wraps.map(mapCell);render.sourceUnadaptedCells=render.unadapted_cells.map(mapCell);
   render.sourceTables=render.nested_tables.map(t=>({...t,table_id:localTables.get(t.table_id).id,cell_path:localTables.get(t.table_id).cell_path,column}));
  }
  const runs=parts.flatMap(p=>p.runs),controls=parts.flatMap(p=>p.controls);if(runs.length+controls.length>20000)return reject('column_item_limit');
  const document={
   pageCount:()=>1,getDocumentInfo:()=>JSON.stringify({...JSON.parse(original.getDocumentInfo()),pageCount:1}),getPageInfo:()=>JSON.stringify(info),getPositionOfPage:()=>JSON.stringify({ok:true,sec:0,para:0,charOffset:0}),getPageTextLayout:()=>JSON.stringify({runs}),getPageControlLayout:()=>JSON.stringify({controls}),getParagraphLength:(...args)=>original.getParagraphLength(...args),getTextRange:(...args)=>original.getTextRange(...args),
   renderPageSvg:page=>{if(page!==0)throw new Error('Invalid page');const pieces=parts.map((part,i)=>{const svg=part.document.renderPageSvg(0),match=/^<svg\b[^>]*>([\s\S]*)<\/svg>\s*$/.exec(svg);if(!match)throw new Error('Unexpected render SVG');const prefix=`column-${i}-`,inner=match[1].replace(/\bid="([^"]+)"/g,(_,id)=>`id="${prefix}${id}"`).replace(/url\(#([^\)]+)\)/g,(_,id)=>`url(#${prefix}${id})`).replace(/((?:xlink:)?href=")#([^"]+)"/g,(_,a,id)=>`${a}#${prefix}${id}"`);return `<svg x="${part.frame.x-.25}" y="${top-.25}" width="${part.frame.width+.5}" height="${bottom-top+.5}" viewBox="${part.frame.x-.25} ${top-.25} ${part.frame.width+.5} ${bottom-top+.5}" overflow="hidden">${inner}</svg>`;});return `<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" width="${p.getUint32(0,true)/75}" height="${p.getUint32(4,true)/75}" viewBox="0 0 ${p.getUint32(0,true)/75} ${p.getUint32(4,true)/75}"><rect width="100%" height="100%" fill="#fff"/>${fixedColumnBackground(original.renderPageSvg(0),info,frames,top,bottom,0)}${pieces.join('')}</svg>`;},
   free:()=>{for(const part of parts)part.document.free();original.free();}
  };
  keep=true;return {document,anchors:[],unadapted:[],nested_tables:parts.flatMap(p=>p.sourceTables),unadapted_tables:[],cell_wraps:parts.flatMap(p=>p.sourceCellWraps),unadapted_cells:parts.flatMap(p=>p.sourceUnadaptedCells),remap:r=>r};
 }catch(e){if(!(e instanceof GuardError)||e.code.includes('LIMIT'))throw e;return {unsupported_column_profile:'column_identity_unverified'};}
 finally{if(!keep){for(const part of parts)part.document.free();original.free();}}
}
