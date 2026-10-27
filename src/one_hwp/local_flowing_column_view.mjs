/** Automatic column flow from sequential disposable single-column pages. */
import {deflateRawSync} from 'node:zlib';
import {readHwp} from '../../probes/sites-runtime/guard/container.mjs';
import {parseRecords,GuardError} from '../../probes/sites-runtime/guard/records.mjs';
import {inspectLocalComplex} from './local_complex.mjs';
import {view,encodeRecords} from './local_complex_records.mjs';
import {projectSvgText,hideSvgTableBorders} from './local_svg_geometry.mjs';
import {patchLocalPackedStreams} from './local_container_write.mjs';
const id=r=>Buffer.from(r.payload.subarray(0,4)).toString();
const key=b=>JSON.stringify([b.section,b.paragraph,b.cell_path]);
const namespace=(svg,prefix)=>svg.replace(/\bid="([^"]+)"/g,(_,id)=>`id="${prefix}${id}"`).replace(/url\(#([^\)]+)\)/g,(_,id)=>`url(#${prefix}${id})`).replace(/((?:xlink:)?href=")#([^"]+)"/g,(_,a,id)=>`${a}#${prefix}${id}"`);
const inner=svg=>/^<svg\b[^>]*>([\s\S]*)<\/svg>\s*$/.exec(svg)?.[1];
export function fixedColumnBackground(svg,info,frames,top,bottom,page){
 const base=inner(svg);if(base===undefined)throw new Error('Invalid original SVG');const path=`M0 0H${info.width}V${info.height}H0Z `+frames.map(f=>`M${f.x} ${top}H${f.x+f.width}V${bottom}H${f.x}Z`).join(' ');return `<defs><clipPath id="column-fixed-${page}"><path clip-rule="evenodd" d="${path}"/></clipPath></defs><g clip-path="url(#column-fixed-${page})">${namespace(base,`fixed-${page}-`)}</g>`;
}
export function openFlowingColumnView(HwpDocument,bytes,openSingle){
 const raw=readHwp(bytes),section=raw.streams.get('BodyText/Section0');if(!section)return null;const records=[...parseRecords(section)],defs=records.filter(r=>r.tag===71&&id(r)==='dloc'),pageRecords=records.filter(r=>r.tag===73),heads=records.filter(r=>r.tag===66&&r.level===0);
 if(defs.length!==1||pageRecords.length!==1||heads.slice(1).some(h=>h.payload[11]&8))return null;
 const flags=view(defs[0].payload).getUint16(4,true),count=(flags>>>2)&255;
 if(count<2||count>4||!(flags&4096)||(flags&~0x13fd)||pageRecords[0].payload.length!==40)return null;
 const d=defs[0].payload,lineType=d[10]??0,lineWidth=d[11]??0,color=d.length>=16?view(d).getUint32(12,true):0;
 if(![12,16].includes(d.length)||view(d).getUint16(8,true)!==0||lineType>16||lineWidth>15||!lineType&&(lineWidth||color))return null;
 if(!records.some(r=>r.tag===71&&r.level>1&&id(r)===' lbt'))return null;
 let original,render,keep=false;
 try{
  original=new HwpDocument(bytes);if(original.pageCount()>32)throw new GuardError('RENDERED_LAYOUT_PAGE_LIMIT');const source=inspectLocalComplex(HwpDocument,bytes,{includeDocumentInfo:false,verifyCharacterModel:false}),info=JSON.parse(original.getPageInfo(0)),frames=info.columns,top=info.marginTop+info.marginHeader,bottom=info.height-info.marginBottom-info.marginFooter;
  if(frames?.length!==count||frames.some(c=>c.width<=0)||source.tables.filter(t=>!t.cell_path.length).some(t=>t.properties.tableWidth/75>Math.min(...frames.map(c=>c.width))+.2))return null;
  const rs=records.map(r=>({...r,payload:r.payload.slice()})),page=rs[records.indexOf(pageRecords[0])],col=rs[records.indexOf(defs[0])],p=view(page.payload);p.setUint32(8,Math.round(frames[0].x*75),true);p.setUint32(12,Math.round(p.getUint32(0,true)-(frames[0].x+frames[0].width)*75),true);col.payload=new Uint8Array(12);col.payload.set(defs[0].payload.subarray(0,4));view(col.payload).setUint16(4,0x1004,true);
  const clean=rs.filter(r=>r.tag!==69);for(const r of clean)if(r.tag===66)view(r.payload).setUint16(16,0,true);const data=encodeRecords(clean),packed=(view(raw.streams.get('FileHeader')).getUint32(36,true)&1)?deflateRawSync(data,{level:9}):data,privateBytes=patchLocalPackedStreams(bytes,new Map([['BodyText/Section0',packed]]));render=openSingle(privateBytes);
  if(render.unadapted_tables.length)return null;const virtualCount=render.document.pageCount(),pageCount=Math.ceil(virtualCount/count);if(pageCount>32)throw new GuardError('RENDERED_LAYOUT_PAGE_LIMIT');
  const local=inspectLocalComplex(HwpDocument,privateBytes,{includeDocumentInfo:false,verifyCharacterModel:false}),blockMap=new Map(local.blocks.map(b=>[key(b),source.blocks.find(s=>key(s)===key(b)&&s.text===b.text)])),tableMap=new Map(local.tables.map(t=>[t.id,source.tables.find(s=>s.section===t.section&&s.paragraph===t.paragraph&&s.control===t.control&&JSON.stringify(s.cell_path)===JSON.stringify(t.cell_path))]));if([...blockMap.values(),...tableMap.values()].some(v=>!v))return null;
  const parts=[];let items=0;
  for(let index=0;index<virtualCount;index++){
   const column=index%count,page=Math.floor(index/count),frame=frames[column],dx=frame.x-frames[0].x,map=r=>{if(r.type==='table'){const t=tableMap.get(r.table_id);if(!t)return null;return {...r,table_id:t.id,x:r.x+dx,cells:r.cells.map(c=>({...c,x:c.x+dx}))};}return {...r,x:r.x+dx};},runs=JSON.parse(render.document.getPageTextLayout(index)).runs.map(r=>render.remap(r,index)).filter(r=>!r.render_only_synthetic).map(map),controls=JSON.parse(render.document.getPageControlLayout(index)).controls.map(r=>map(render.remap(r,index)));
   items+=runs.length+controls.length;if(items>20000)throw new GuardError('RENDERED_LAYOUT_ITEM_LIMIT');if([...runs.filter(r=>r.paraIdx<0xfffffff0||r.parentParaIdx!=null),...controls].some(r=>!r||r.x<frame.x-.5||r.x+r.w>frame.x+frame.width+.5||r.y<top-.5||r.y+r.h>bottom+.5))return null;parts.push({index,page,column,frame,runs,controls});
  }
  const document={pageCount:()=>pageCount,getDocumentInfo:()=>JSON.stringify({...JSON.parse(original.getDocumentInfo()),pageCount}),getPageInfo:p=>JSON.stringify({...info,pageIndex:p,pageNumber:info.pageNumber+p}),getPositionOfPage:p=>render.document.getPositionOfPage(p*count),getParagraphLength:(...a)=>original.getParagraphLength(...a),getTextRange:(...a)=>original.getTextRange(...a),getPageTextLayout:p=>JSON.stringify({runs:parts.filter(v=>v.page===p).flatMap(v=>v.runs)}),getPageControlLayout:p=>JSON.stringify({controls:parts.filter(v=>v.page===p).flatMap(v=>v.controls)}),renderPageSvg:p=>{
   if(!Number.isInteger(p)||p<0||p>=pageCount)throw new Error('Invalid page');const originalPage=Math.min(p,original.pageCount()-1),fixedSource=hideSvgTableBorders(projectSvgText(original.renderPageSvg(originalPage),JSON.parse(original.getPageTextLayout(originalPage)).runs.filter(r=>r.paraIdx<0xfffffff0||r.cellPath).map(source=>({source,target:null}))),JSON.parse(original.getPageControlLayout(originalPage)).controls.filter(c=>c.type==='table'));const base=inner(fixedSource);if(base===undefined)throw new Error('Invalid original SVG');const path=`M0 0H${info.width}V${info.height}H0Z `+frames.map(f=>`M${f.x} ${top}H${f.x+f.width}V${bottom}H${f.x}Z`).join(' '),fixed=`<defs><clipPath id="column-fixed-${p}"><path clip-rule="evenodd" d="${path}"/></clipPath></defs><g clip-path="url(#column-fixed-${p})">${namespace(base,`fixed-${p}-`)}</g>`,pieces=parts.filter(v=>v.page===p).map(v=>{const body=inner(render.document.renderPageSvg(v.index));if(body===undefined)throw new Error('Invalid column SVG');return `<svg x="${v.frame.x-.25}" y="${top-.25}" width="${v.frame.width+.5}" height="${bottom-top+.5}" viewBox="${frames[0].x-.25} ${top-.25} ${v.frame.width+.5} ${bottom-top+.5}" overflow="hidden">${namespace(body,`column-${v.index}-`)}</svg>`;});return `<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" width="${info.width}" height="${info.height}" viewBox="0 0 ${info.width} ${info.height}"><rect width="100%" height="100%" fill="#fff"/>${fixed}${pieces.join('')}</svg>`;
  },free:()=>{render.document.free();original.free();}};
  keep=true;return {document,anchors:[],unadapted:[],flow_adaptations:[...(render.flow_adaptations??[]),{kind:'automatic_columns',columns:count,virtual_pages:virtualCount,pages:pageCount}],nested_tables:render.nested_tables,unadapted_tables:[],cell_wraps:render.cell_wraps,unadapted_cells:render.unadapted_cells,remap:r=>r};
 }finally{if(!keep){render?.document.free();original?.free();}}
}
