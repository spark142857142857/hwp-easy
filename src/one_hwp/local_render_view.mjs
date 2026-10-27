/** Disposable render-only adaptation for WASM's collapsed empty float anchors.
 * Never pass this document to editing, export, target selection or saving.
 */
import {readHwp} from '../../probes/sites-runtime/guard/container.mjs';
import {parseRecords} from '../../probes/sites-runtime/guard/records.mjs';
import {fail,view} from './local_complex_records.mjs';
import {validObjectHeader,objectFlow} from './local_flow_records.mjs';
import {createEngineApi} from './rhwp_api.mjs';
import {prepareNestedRenderInput} from './local_nested_render_view.mjs';
import {adaptFooterRenderView} from './local_fixed_render_view.mjs';
import {adaptPartialRenderGeometry} from './local_fragment_render_view.mjs';
import {adaptEmptyParagraphFlow} from './local_empty_render_flow.mjs';
import {openColumnRenderView} from './local_column_render_view.mjs';
import {openPaginatedTableView} from './local_paginated_table_view.mjs';
import {drawingRenderLimits} from './local_drawing_render_limits.mjs';
import {prepareSetupFontRender} from './local_setup_font_render.mjs';

export function openLocalRenderView(HwpDocument,bytes,allowColumns=true){
 const setup=prepareSetupFontRender(bytes),result=openRenderInput(HwpDocument,setup.bytes,allowColumns);
 try{result.unadapted_drawings=drawingRenderLimits(bytes);result.flow_adaptations=[...setup.notes,...(result.flow_adaptations??[])];return result;}
 catch(error){result.document.free();throw error;}
}
function openRenderInput(HwpDocument,bytes,allowColumns){
 const columns=allowColumns?openColumnRenderView(HwpDocument,bytes,b=>openLocalRenderView(HwpDocument,b,false)):null;
 const finish=view=>{try{return adaptFooterRenderView(HwpDocument,bytes,view);}catch(e){view.document.free();throw e;}};
 if(columns?.document)return finish(columns);
 const paginated=openPaginatedTableView(HwpDocument,bytes);if(paginated)return finish(paginated);
 const nested=prepareNestedRenderInput(HwpDocument,bytes);let document=new HwpDocument(nested.bytes);
 if(columns?.unsupported_column_profile)nested.unadapted.push({reason:columns.unsupported_column_profile});
 try{
  if(document.pageCount()>32)fail('RENDERED_LAYOUT_PAGE_LIMIT');
  if(nested.tables.length){
   const count=document.pageCount(),controls=[];
   for(let page=0;page<Math.min(count,33);page++)controls.push(...JSON.parse(document.getPageControlLayout(page)).controls.filter(c=>c.type==='table').map(c=>nested.remap(c,page)).filter(c=>!c.render_fixed_region).map(c=>({...c,page})));
   // Complete-row fragments were bound to their original rows before opening.
   // Partial rows, overflow and unknown pagination keep the original view.
   const roots=controls.filter(c=>c.stableIndex?.length===3);
   if(count>32||!roots.length||!nested.partial_rows&&controls.length!==nested.tables.length+roots.length||roots.some(root=>{const info=JSON.parse(document.getPageInfo(root.page));return root.x<info.bodyLeft-.5||root.x+root.w>info.bodyRight+.5||root.y<info.marginTop+info.marginHeader-.5||root.y+root.h>info.height-info.marginBottom-info.marginFooter+(nested.partial_rows?4:.5);})){const original=new HwpDocument(bytes);document.free();document=original;nested.unadapted.push({reason:'nested_render_pagination'});nested.tables=[];nested.cell_wraps=[];nested.unadapted_cells=[];nested.remap=r=>r;}
  }
  let flow_adaptations=adaptEmptyParagraphFlow(document,bytes),anchors=adaptEmptyFloatingAnchors(document,bytes);
  if(nested.tables.length&&!nested.refresh(document)){const original=new HwpDocument(bytes);document.free();document=original;nested.unadapted.push({reason:'nested_anchor_pagination'});nested.tables=[];nested.cell_wraps=[];nested.unadapted_cells=[];nested.remap=r=>r;flow_adaptations=adaptEmptyParagraphFlow(document,bytes);anchors=adaptEmptyFloatingAnchors(document,bytes);}
  const fragments=nested.partial_rows?adaptPartialRenderGeometry(HwpDocument,bytes,document,nested.remap):null;if(fragments){document=fragments.document;flow_adaptations.push(...fragments.notes);}else if(nested.partial_rows)nested.unadapted.push({reason:'nested_partial_geometry_profile'});
  const result={document,...anchors,nested_tables:nested.tables,unadapted_tables:nested.unadapted,cell_wraps:nested.cell_wraps??[],unadapted_cells:nested.unadapted_cells??[],flow_adaptations,remap:(r,page)=>{const value=fragments?r:nested.remap(r,page);return !value.cellPath&&value.parentParaIdx==null&&value.text===' '&&flow_adaptations.some(a=>a.section===value.secIdx&&a.paragraph===value.paraIdx)?{...value,render_only_synthetic:true}:value;}};return adaptFooterRenderView(HwpDocument,bytes,result);
 }catch(e){document.free();throw e;}
}

export function adaptEmptyFloatingAnchors(document,bytes){
 const raw=readHwp(bytes),shapes=[...parseRecords(raw.streams.get('DocInfo'))].filter(r=>r.tag===25),anchors=[],unadapted=[],pictures=[];
 for(const [name,stream] of raw.streams){
  if(!/^BodyText\/Section\d+$/.test(name))continue;const section=Number(name.slice(16)),rs=[...parseRecords(stream)],heads=rs.map((r,i)=>[r,i]).filter(([r])=>r.tag===66&&r.level===0),pages=rs.filter(r=>r.tag===73),columns=rs.filter(r=>r.tag===71&&Buffer.from(r.payload.subarray(0,4)).toString()==='dloc');
  for(const [[head,at],paragraph] of heads.map((v,i)=>[v,i])){
   const end=heads[paragraph+1]?.[1]??rs.length,direct=rs.slice(at+1,end).filter(r=>r.level===1),texts=direct.filter(r=>r.tag===67),objects=direct.filter(r=>r.tag===71&&Buffer.from(r.payload.subarray(0,4)).toString()===' osg'),shape=shapes[head.payload.length>=10?view(head.payload).getUint16(8,true):-1]?.payload;
   if(texts.length!==1||objects.length!==1||!shape||![46,54,58].includes(shape.length))continue;
   const text=texts[0].payload,p=view(shape),flags=p.getUint32(0,true),modern=shape.length>=54&&p.getInt32(50,true)>0,spacing=modern?p.getInt32(50,true):p.getInt32(24,true),type=modern?p.getUint32(46,true)&31:flags&3;
   // Exactly one extended drawing anchor and its terminator, no actual text,
   // fields or extra controls. A visible/mixed host is never normalized.
   if(text.length!==18||view(text).getUint16(0,true)!==11||view(text).getUint16(14,true)!==11||view(text).getUint16(16,true)!==13||Buffer.from(text.subarray(2,6)).toString()!==' osg'||type!==1||spacing<=0)continue;
   const identity={section,paragraph};const reject=reason=>unadapted.push({...identity,reason});
   if(head.payload.length<22||(view(head.payload).getUint32(0,true)&0x7fffffff)!==9||head.payload[11]||direct.filter(r=>r.tag===71).length!==1||!validObjectHeader(objects[0].payload)){reject('anchor_structure');continue;}
   if(pages.length!==1||pages[0].payload.length!==40||columns.length!==1||columns[0].payload.length<8||((view(columns[0].payload).getUint16(4,true)>>>2)&255)!==1){reject('page_profile');continue;}
   const page=view(pages[0].payload),o=view(objects[0].payload),flow=objectFlow(objects[0]),height=page.getUint32(4,true)-[16,20,24,28].reduce((n,i)=>n+page.getUint32(i,true),0),width=page.getUint32(0,true)-[8,12,32].reduce((n,i)=>n+page.getUint32(i,true),0),reserve=spacing/2;
   const mask=1|4|(3<<3)|(7<<5)|(3<<8)|(7<<10)|8192|16384|(7<<21)|(3<<24),canonical=(2<<3)|(2<<8)|8192|(3<<21)|(1<<24);
   if(page.getUint32(36,true)!==0||page.getUint32(0,true)>page.getUint32(4,true)||(o.getUint32(4,true)&mask)!==canonical||flow.widthRelTo!==4||flow.heightRelTo!==2||['marginLeft','marginRight','marginTop','marginBottom'].some(k=>flow[k])||o.getInt32(8,true)!==0||o.getInt32(12,true)<flow.marginLeft||o.getInt32(12,true)+o.getUint32(16,true)+flow.marginRight>width||reserve<o.getUint32(20,true)+flow.marginTop+flow.marginBottom+2000||reserve>height-3600){reject('floating_profile');continue;}
   if((flags&((1<<17)|(1<<18)|(1<<22)))||[4,8,12,16,20].some(i=>p.getInt32(i,true)!==0)||modern&&((flags&3)!==1||p.getInt32(24,true)!==spacing)){reject('paragraph_profile');continue;}
   const child=rs[rs.indexOf(objects[0])+1];
   if(child?.tag!==76||!['cip$','cer$'].includes(Buffer.from(child.payload.subarray(0,4)).toString())||child.payload.length<42||view(child.payload).getInt16(40,true)!==0){reject('drawing_profile');continue;}
   if(document.getParagraphCount(section)!==heads.length||document.getTextRange(section,paragraph,0,document.getParagraphLength(section,paragraph))!==''){reject('engine_identity');continue;}
   const anchor={...identity,reserved_height:reserve};anchors.push(anchor);
   if(Buffer.from(child.payload.subarray(0,4)).toString()==='cip$')pictures.push({anchor,width:o.getUint32(16,true)/75,height:o.getUint32(20,true)/75});
  }
 }
 if(anchors.length+unadapted.length>128)fail('RENDER_VIEW_ANCHOR_LIMIT');
 // An ordinary space has no visible ink. It makes the existing fixed line
 // height effective in this private WASM instance; source bytes stay untouched.
 for(const a of anchors)document.insertText(a.section,a.paragraph,0,' ');
 // The pinned renderer can also position a picture after a text box at the
 // preceding anchor's mid-line. On this exact paragraph-relative profile its
 // own invisible line is the unambiguous reference. Correct only this private
 // picture offset; do not infer an absolute/native page origin from the line.
 const observe=()=>{
  const count=document.pageCount();if(count>32)fail('RENDERED_LAYOUT_PAGE_LIMIT');const runs=[],controls=[];let total=0;
  for(let page=0;page<count;page++){
   const r=JSON.parse(document.getPageTextLayout(page)).runs,c=JSON.parse(document.getPageControlLayout(page)).controls;total+=r.length+c.length;if(total>20000)fail('RENDERED_LAYOUT_ITEM_LIMIT');
   runs.push(...r.map(v=>({...v,page})));controls.push(...c.map(v=>({...v,page})));
  }return {runs,controls};
 };
 if(pictures.length){
  const observed=observe(),adjusted=[];
  for(const {anchor:a,width,height} of pictures){
   const lines=observed.runs.filter(r=>r.secIdx===a.section&&r.paraIdx===a.paragraph&&r.parentParaIdx==null&&r.cellIdx==null&&r.text===' '&&r.charStart===0),objects=observed.controls.filter(c=>c.type==='image'&&JSON.stringify(c.stableIndex)===JSON.stringify([a.section,a.paragraph,0]));
   if(lines.length!==1||objects.length!==1||lines[0].page!==objects[0].page||Math.abs(objects[0].w-width)>.5||Math.abs(objects[0].h-height)>.5){unadapted.push({section:a.section,paragraph:a.paragraph,reason:'picture_render_identity'});continue;}
   const delta=lines[0].y-objects[0].y;if(!Number.isFinite(delta)||Math.abs(delta)>a.reserved_height/75){unadapted.push({section:a.section,paragraph:a.paragraph,reason:'picture_render_origin'});continue;}
   if(Math.abs(delta)>.5){const offset=Math.round(delta*75),result=JSON.parse(document.setPictureProperties(a.section,a.paragraph,0,JSON.stringify({vertOffset:offset})));if(result.ok!==true)fail('RENDER_VIEW_ANCHOR_ORIGIN_UNVERIFIED');a.picture_origin_correction=offset;adjusted.push(a);}
  }
  if(adjusted.length){const checked=observe();for(const a of adjusted){const line=checked.runs.find(r=>r.secIdx===a.section&&r.paraIdx===a.paragraph&&r.parentParaIdx==null&&r.cellIdx==null&&r.text===' '&&r.charStart===0),object=checked.controls.find(c=>c.type==='image'&&JSON.stringify(c.stableIndex)===JSON.stringify([a.section,a.paragraph,0]));if(!line||!object||line.page!==object.page||Math.abs(line.y-object.y)>.5)fail('RENDER_VIEW_ANCHOR_ORIGIN_UNVERIFIED');}}
 }
 return {anchors,unadapted};
}

export function renderLocalPreview(HwpDocument,bytes,page){
 const api=createEngineApi(HwpDocument),view=openLocalRenderView(HwpDocument,bytes),document=view.document;
 try{
  const preview=api.previewDocument(document,page);
  return {...preview,render_unadapted_drawings:view.unadapted_drawings,render_content_complete:view.unadapted_drawings.length===0?null:false,render_flow_adaptations:view.flow_adaptations??[],render_adaptations:view.anchors,render_unadapted_anchors:view.unadapted,render_nested_tables:view.nested_tables,render_unadapted_tables:view.unadapted_tables,render_cell_wraps:view.cell_wraps,render_unadapted_cells:view.unadapted_cells,render_source:'disposable_view_of_current_bytes',warnings:[...preview.warnings,...(view.unadapted_drawings.length?['회전한 그룹 안의 글이 이 미리보기에서 누락될 수 있습니다. 저장된 HWP 내용과 미리보기는 구분해서 확인하세요.']:[]),...(view.cell_wraps.length?['Bounded leaf-cell padding and line breaks use source-bound embedded base advances only in the disposable view; complete native font layout remains unverified.']:[]),...(view.anchors.length?['Empty floating-anchor fixed line heights are materialized only in the disposable render view.']:[]),...(view.nested_tables.length?['Canonical nested-table origins and ancestor alignment are adapted only in the disposable render view; font wrapping and native pagination remain unverified.']:[])]};
 }finally{document.free();}
}
