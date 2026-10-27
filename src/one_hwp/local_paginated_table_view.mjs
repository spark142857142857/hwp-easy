/** Read-only pagination of a canonical table tree from a verified tall scene.
 * The tall page is disposable. Its bytes never enter a writer or target model.
 */
import {deflateRawSync} from 'node:zlib';
import {readHwp} from '../../probes/sites-runtime/guard/container.mjs';
import {parseRecords,GuardError} from '../../probes/sites-runtime/guard/records.mjs';
import {inspectLocalComplex} from './local_complex.mjs';
import {view,encodeRecords} from './local_complex_records.mjs';
import {patchLocalPackedStreams} from './local_container_write.mjs';
import {prepareNestedRenderInput} from './local_nested_render_view.mjs';
import {adaptEmptyParagraphFlow} from './local_empty_render_flow.mjs';
import {cellPads} from './local_inline_cell_flow.mjs';
import {trackPositions} from './local_complex_table.mjs';
import {projectSvgText,svgInner,svgNamespace,hideSvgTableBorders} from './local_svg_geometry.mjs';
import {fixedColumnBackground} from './local_flowing_column_view.mjs';
const same=(a,b)=>JSON.stringify(a)===JSON.stringify(b);
const get=(s,k)=>Number(new RegExp(`\\b${k}="([^"]+)"`).exec(s)?.[1]);
const set=(s,k,v)=>s.replace(new RegExp(`(\\b${k}=")[^"]*(")`),(_,a,b)=>`${a}${v}${b}`);

export function openPaginatedTableView(HwpDocument,bytes){
 try{return openVerifiedTableView(HwpDocument,bytes);}catch(e){if(!(e instanceof GuardError)||e.code.includes('LIMIT'))throw e;return null;}
}
function openVerifiedTableView(HwpDocument,bytes){
 const raw=readHwp(bytes),stream=raw.streams.get('BodyText/Section0');if(!stream)return null;
 const rs=[...parseRecords(stream)],pageRecords=rs.filter(r=>r.tag===73),columns=rs.filter(r=>r.tag===71&&Buffer.from(r.payload.subarray(0,4)).toString()==='dloc');
 if(pageRecords.length!==1||pageRecords[0].payload.length!==40||columns.length!==1||((view(columns[0].payload).getUint16(4,true)>>>2)&255)!==1||!rs.some(r=>r.tag===71&&r.level>1&&Buffer.from(r.payload.subarray(0,4)).toString()===' lbt'))return null;
 let original,seed,keep=false;
 try{
  original=new HwpDocument(bytes);if(original.pageCount()>32)throw new GuardError('RENDERED_LAYOUT_PAGE_LIMIT');
  const state=inspectLocalComplex(HwpDocument,bytes,{includeDocumentInfo:false,verifyCharacterModel:false}),roots=state.tables.filter(t=>!t.cell_path.length),info=JSON.parse(original.getPageInfo(0)),top=info.marginTop+info.marginHeader,bottom=info.height-info.marginBottom-info.marginFooter;
  if(state.recordSets.size!==1||roots.length!==1||state.pictures.length||state.text_boxes.length||state.fields.length)return null;
  const root=roots[0],rootHead=state.blocks.find(b=>b.id===root.parent_id);
  if(state.tables.some(t=>(view(rs[t.table_record].payload).getUint32(0,true)&4)&&t.cells.some(c=>view(rs[c.start].payload).getUint32(4,true)&0x40000)))return null;
  if(rootHead?.text||state.tables.some(t=>(view(rs[t.table_record].payload).getUint32(0,true)&3)!==2)||root.properties.tableHeight/75<bottom-top)return null;
  // Explicit paragraph/page breaks and keep rules need a separate flow proof.
  if(state.blocks.some(b=>b.paragraph_properties.pageBreakBefore||b.paragraph_properties.keepWithNext||b.paragraph_properties.keepLines)||rs.filter(r=>r.tag===66&&r.level===0).some((r,i)=>r.payload[11]&&!(i===0&&r.payload[11]===3)))return null;
  for(const t of state.tables)for(const c of t.cells)if(state.tables.filter(n=>c.blocks.some(b=>b.id===n.parent_id)).length>1)return null;
  const tall=rs.map(r=>({...r,payload:r.payload.slice()})),paper=tall[rs.indexOf(pageRecords[0])],height=Math.ceil((root.properties.tableHeight/75+info.height*2)*75);
  if(height>2000000)return null;view(paper.payload).setUint32(4,height,true);
  for(const r of tall)if(r.tag===66)view(r.payload).setUint16(16,0,true);
  const data=encodeRecords(tall.filter(r=>r.tag!==69)),packed=(view(raw.streams.get('FileHeader')).getUint32(36,true)&1)?deflateRawSync(data,{level:9}):data,tallBytes=patchLocalPackedStreams(bytes,new Map([['BodyText/Section0',packed]])),prepared=prepareNestedRenderInput(HwpDocument,tallBytes);
  if(prepared.unadapted.length||!prepared.tables.length)return null;
  seed=new HwpDocument(prepared.bytes);const empty=adaptEmptyParagraphFlow(seed,tallBytes);if(seed.pageCount()!==1||!prepared.refresh(seed))return null;
  const sourceRuns=JSON.parse(seed.getPageTextLayout(0)).runs,mapped=sourceRuns.map(r=>prepared.remap(r,0)),controls=JSON.parse(seed.getPageControlLayout(0)).controls.map(c=>prepared.remap(c,0)),baseTables=new Map(controls.filter(c=>c.type==='table').map(c=>[c.table_id,c])),rootFrame=baseTables.get(root.id);
  if(baseTables.size!==state.tables.length||!rootFrame||rootFrame.y<top-.5||rootFrame.y>bottom-100)return null;
  const pages=[],consumed=new Map(state.tables.map(t=>[t.id,0])),rowCursors=new Map(),notes=[];
  const ordered=state.tables.slice().sort((a,b)=>a.cell_path.length-b.cell_path.length);
  const rowGroups=new Map();for(const t of ordered)for(const cell of t.cells){const items=mapped.map((r,i)=>({r,source:sourceRuns[i],i})).filter(({r})=>!r.render_only_synthetic&&r.cellPath?.length===t.cell_path.length+1&&same(r.cellPath.slice(0,-1),t.cell_path)&&r.cellPath.at(-1).controlIndex===t.control&&r.cellPath.at(-1).cellIndex===cell.cell).sort((a,b)=>a.r.y-b.r.y||a.r.x-b.r.x),groups=[];for(const item of items){let g=groups.at(-1);if(!g||Math.abs(g.y-item.r.y)>.4){g={y:item.r.y,h:item.r.h,items:[]};groups.push(g);}g.h=Math.max(g.h,item.r.h);g.items.push(item);}rowGroups.set(cell,groups);rowCursors.set(cell,0);}
  const rootRepeat=Math.max(...ordered.map(leaf=>leaf.cell_path.reduce((n,path,i)=>{const parent=ordered.find(t=>same(t.cell_path,leaf.cell_path.slice(0,i))&&t.control===path.controlIndex),cell=parent?.cells.find(c=>c.cell===path.cellIndex);if(!cell)return n;const pad=cellPads(rs,parent,cell);return n+pad[2]+pad[3];},0)));
  let rootRemaining=root.properties.tableHeight/75;
  for(let page=0;rootRemaining>.1;page++){
   if(page>=32)throw new GuardError('RENDERED_LAYOUT_PAGE_LIMIT');const pageTables=new Map(),pairs=sourceRuns.map(source=>({source,target:null})),runs=[],rootPad=cellPads(rs,root,root.cells[0]),y=page?top:rootFrame.y,room=bottom-y-rootPad[3],h=Math.min(rootRemaining+(page?rootRepeat:0),room);
   if(h<=0)return null;
   for(const t of ordered){
    const old=baseTables.get(t.id),prior=consumed.get(t.id),ownPad=cellPads(rs,t,t.cells[0]);let frameY,frameH;
    if(t===root){frameY=y;frameH=h;}else{
     const host=state.blocks.find(b=>b.id===t.parent_id),parent=ordered.find(p=>p.cells.some(c=>c.blocks.includes(host))),parentCell=parent?.cells.find(c=>c.blocks.includes(host)),pf=pageTables.get(parent?.id)?.cells.find(c=>c.cellIdx===parentCell?.cell);if(!pf)continue;
     const pad=cellPads(rs,parent,parentCell);frameY=pf.y+pad[2]+(prior?0:view(rs[t.record_index].payload).getInt32(8,true)/75);const available=pf.y+pf.h-pad[3]-frameY;if(available<=0)continue;const remaining=t.properties.tableHeight/75-prior;frameH=Math.min(remaining+(prior?ownPad[2]+ownPad[3]:0),available-(remaining>available&&rootRemaining>h-(page?rootRepeat:0)+.1?ownPad[3]:0));if(frameH<=0)continue;
    }
    const repeat=prior?(t===root?rootRepeat:ownPad[2]+ownPad[3]):0,used=frameH-repeat,tracks=trackPositions(t,'row').map(n=>n/75),end=prior+used,cells=[];
    for(const cell of t.cells){const start=tracks[cell.row],finish=tracks[cell.row+cell.rowSpan],a=Math.max(start,prior),b=Math.min(finish,end);if(b<=a+.1)continue;const oldCell=old.cells.find(c=>c.cellIdx===cell.cell);if(!oldCell)return null;const continuation=start<prior+.1&&prior>0,fy=frameY+a-prior+(prior&&a>prior+.1?repeat:0),fh=b-a+(continuation?repeat:0);cells.push({...oldCell,y:fy,h:fh});}
    const control={...old,y:frameY,h:frameH,cells};pageTables.set(t.id,control);consumed.set(t.id,Math.min(t.properties.tableHeight/75,end));
    for(const cell of t.cells){const f=cells.find(c=>c.cellIdx===cell.cell);if(!f)continue;const groups=rowGroups.get(cell),cursor=rowCursors.get(cell),pad=cellPads(rs,t,cell);let next=cursor,lineY=f.y+pad[2];
     // Stored full-cell alignment is already included in the tall scene. On a
     // continued cell native HWP resumes its text at the content top.
     if(groups.length&&cursor<groups.length){const oldCell=old.cells.find(c=>c.cellIdx===cell.cell),split=Math.abs(f.h-oldCell.h)>.5,children=state.tables.some(child=>cell.blocks.some(b=>b.id===child.parent_id));if(split){if(!children){const content=groups.at(-1).y-groups[cursor].y+groups.at(-1).h,alignment=(view(rs[cell.start].payload).getUint32(4,true)>>>5)&3;lineY+=Math.max(0,f.h-pad[2]-pad[3]-content)*(alignment===1?.5:alignment===2?1:0);}}else if(!prior)lineY+=Math.max(0,groups[0].y-oldCell.y-pad[2]);}
     for(;next<groups.length;next++){const g=groups[next],gap=next===cursor?0:g.y-groups[next-1].y;if(next>cursor)lineY+=gap;if(lineY+g.h>f.y+f.h-pad[3]+.5)break;for(const item of g.items){const target={...item.r,y:lineY+(item.r.y-g.y)};pairs[item.i].target=target;runs.push(target);}}
     rowCursors.set(cell,next);
    }
   }
   rootRemaining-=h-(page?rootRepeat:0);
   for(let i=0;i<mapped.length;i++){const r=mapped[i];if(r.cellPath||r.paraIdx>=0xfffffff0)continue;const blank=empty.some(e=>e.section===r.secIdx&&e.paragraph===r.paraIdx);if(blank)continue;if(page===0&&r.paraIdx<root.paragraph){pairs[i].target=r;runs.push(r);}}
   pages.push({runs,controls:[...pageTables.values()],pairs});notes.push({kind:'table_row_pagination',section:0,table_id:root.id,page,source_height:root.properties.tableHeight});
  }
  const lastRoot=pages.at(-1).controls.find(c=>c.table_id===root.id);let bodyPage=pages.at(-1),bodyIndex=pages.length-1,delta=lastRoot.y+lastRoot.h-rootFrame.y-rootFrame.h;
  const tail=mapped.map((r,i)=>({r,i})).filter(({r})=>!r.cellPath&&r.paraIdx>root.paragraph&&r.paraIdx<0xfffffff0).sort((a,b)=>a.r.y-b.r.y||a.r.x-b.r.x);
  for(const {r,i}of tail){let y=r.y+delta;if(y+r.h>bottom+.5){if(pages.length>=32)throw new GuardError('RENDERED_LAYOUT_PAGE_LIMIT');bodyPage={runs:[],controls:[],pairs:sourceRuns.map(source=>({source,target:null}))};pages.push(bodyPage);bodyIndex++;delta=top-r.y;y=top;notes.push({kind:'following_body_pagination',section:0,page:bodyIndex});}const target={...r,y};bodyPage.pairs[i].target=target;if(!empty.some(e=>e.section===r.secIdx&&e.paragraph===r.paraIdx))bodyPage.runs.push(target);}
  if([...rowGroups].some(([cell,groups])=>rowCursors.get(cell)!==groups.length))return null;
  const seedSvg=seed.renderPageSvg(0),seedInner=svgInner(seedSvg);if(seedInner===undefined)return null;
  function draw(page){const p=pages[page],frames=[];for(const t of ordered){const old=baseTables.get(t.id),next=p.controls.find(c=>c.table_id===t.id);frames.push({old,next,depth:t.cell_path.length});for(const c of old.cells)frames.push({old:c,next:next?.cells.find(n=>n.cellIdx===c.cellIdx),depth:t.cell_path.length+1});}
   let inClip=false;const body=projectSvgText(seedSvg,p.pairs).replace(/<[^>]+>/g,tag=>{if(/^<clipPath\b/.test(tag)){inClip=true;return tag;}if(/^<\/clipPath/.test(tag)){inClip=false;return tag;}if(inClip&&/^<rect\b/.test(tag)){const f=frames.find(f=>Math.abs(get(tag,'x')-f.old.x)<.4&&Math.abs(get(tag,'y')-f.old.y)<.4&&Math.abs(get(tag,'width')-f.old.w)<.4&&Math.abs(get(tag,'height')-f.old.h)<.4);if(f){tag=set(set(tag,'y',f.next?.y??0),'height',f.next?.h??0);}return tag;}if(/^<line\b/.test(tag)){const x1=get(tag,'x1'),x2=get(tag,'x2'),y1=get(tag,'y1'),y2=get(tag,'y2');if(Math.abs(y1-y2)<.01){for(const t of ordered.slice().reverse()){const old=baseTables.get(t.id);if([x1,x2].some(x=>x<old.x-.4||x>old.x+old.w+.4))continue;const matches=old.cells.flatMap(c=>[Math.abs(y1-c.y)<.4?{c,edge:'top'}:null,Math.abs(y1-c.y-c.h)<.4?{c,edge:'bottom'}:null]).filter(Boolean);if(!matches.length)continue;const next=p.controls.find(c=>c.table_id===t.id),ys=matches.map(({c,edge})=>{const f=next?.cells.find(f=>f.cellIdx===c.cellIdx);return f?(edge==='top'?f.y:f.y+f.h):null;}).filter(y=>y!==null);if(!ys.length)return tag.replace('<line','<line visibility="hidden"');if(ys.some(y=>Math.abs(y-ys[0])>.5))return tag.replace('<line','<line visibility="hidden"');return set(set(tag,'y1',ys[0]),'y2',ys[0]);}}const f=frames.slice().sort((a,b)=>b.depth-a.depth).find(f=>[x1,x2].every(x=>x>=f.old.x-.4&&x<=f.old.x+f.old.w+.4)&&[y1,y2].every(y=>y>=f.old.y-.4&&y<=f.old.y+f.old.h+.4)&&((Math.abs(y1-y2)<.01&&[f.old.y,f.old.y+f.old.h].some(y=>Math.abs(y1-y)<.4))||Math.abs(x1-x2)<.01));if(f){if(!f.next)return tag.replace('<line','<line visibility="hidden"');const map=y=>Math.abs(y-f.old.y)<.4?f.next.y:Math.abs(y-f.old.y-f.old.h)<.4?f.next.y+f.next.h:f.next.y+(y-f.old.y);return set(set(tag,'y1',map(y1)),'y2',map(y2));}}return tag;});
   const originalPage=Math.min(page,original.pageCount()-1),fixedSvg=hideSvgTableBorders(projectSvgText(original.renderPageSvg(originalPage),JSON.parse(original.getPageTextLayout(originalPage)).runs.filter(r=>r.paraIdx<0xfffffff0||r.cellPath).map(source=>({source,target:null}))),JSON.parse(original.getPageControlLayout(originalPage)).controls.filter(c=>c.type==='table'));const fixed=fixedColumnBackground(fixedSvg,info,[{x:info.bodyLeft,width:info.bodyRight-info.bodyLeft}],top,bottom,page);return `<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" width="${info.width}" height="${info.height}" viewBox="0 0 ${info.width} ${info.height}"><rect width="100%" height="100%" fill="#fff"/>${fixed}<svg x="${info.bodyLeft-.25}" y="${top-.25}" width="${info.bodyRight-info.bodyLeft+.5}" height="${bottom-top+.5}" viewBox="${info.bodyLeft-.25} ${top-.25} ${info.bodyRight-info.bodyLeft+.5} ${bottom-top+.5}" overflow="hidden">${svgNamespace(svgInner(body),`flow-${page}-`)}</svg></svg>`;
  }
  const document={pageCount:()=>pages.length,getDocumentInfo:()=>JSON.stringify({...JSON.parse(original.getDocumentInfo()),pageCount:pages.length}),getPageInfo:p=>JSON.stringify({...info,pageIndex:p,pageNumber:info.pageNumber+p}),getPositionOfPage:p=>original.getPositionOfPage(Math.min(p,original.pageCount()-1)),getParagraphLength:(...a)=>original.getParagraphLength(...a),getTextRange:(...a)=>original.getTextRange(...a),getPageTextLayout:p=>JSON.stringify({runs:pages[p].runs}),getPageControlLayout:p=>JSON.stringify({controls:pages[p].controls}),renderPageSvg:draw,free:()=>{seed.free();original.free();}};
  keep=true;return {document,anchors:[],unadapted:[],nested_tables:prepared.tables,unadapted_tables:[],cell_wraps:prepared.cell_wraps,unadapted_cells:prepared.unadapted_cells,flow_adaptations:[...empty,...notes],remap:r=>r};
 }finally{if(!keep){seed?.free();original?.free();}}
}
