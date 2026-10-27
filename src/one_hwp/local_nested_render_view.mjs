/** Private HWP input for a bounded canonical nested-table rendering profile.
 * Never return these bytes to a writer, editor, target selector or caller.
 */
import {deflateRawSync} from 'node:zlib';
import {inspectLocalComplex} from './local_complex.mjs';
import {partitionTableHost} from './local_complex_boundary.mjs';
import {parseRecords} from '../../probes/sites-runtime/guard/records.mjs';
import {GuardError} from '../../probes/sites-runtime/guard/records.mjs';
import {readHwp} from '../../probes/sites-runtime/guard/container.mjs';
import {view,encodeRecords,equal} from './local_complex_records.mjs';
import {validObjectHeader} from './local_flow_records.mjs';
import {trackPositions} from './local_complex_table.mjs';
import {bindRenderTables,renderTableKey} from './local_render_table_identity.mjs';
import {patchLocalPackedStreams} from './local_container_write.mjs';
import {tableHostFields,inlineTableHostObject} from './local_table_host_controls.mjs';
import {bindRenderObjects,renderRunKey} from './local_render_object_identity.mjs';
import {adaptLeafCellWraps,projectCellRenderText} from './local_cell_render_wrap.mjs';
const id=r=>Buffer.from(r.payload.subarray(0,4)).toString();
const key=b=>JSON.stringify([b.section,b.paragraph,b.cell_path]);
const plain=p=>p&&['left','justify'].includes(p.alignment)&&p.lineSpacingType===0&&p.lineSpacing>=100&&p.lineSpacing<=300&&!p.keepWithNext&&!p.keepLines&&!p.pageBreakBefore&&!p.fontLineHeight&&['marginLeft','marginRight','indent','spacingBefore','spacingAfter'].every(k=>!p[k]);
function canonical(rs,t){
 const p=rs[t.record_index].payload;if(p.length!==42&&!validObjectHeader(p))return false;const v=view(p);if(p.length===42?v.getUint16(40,true)!==0:v.getUint32(40,true)!==0)return false;const f=v.getUint32(4,true),mask=1|4|(3<<3)|(7<<5)|(3<<8)|(7<<10)|8192|16384|(7<<15)|(3<<18)|(1<<20)|(7<<21)|(3<<24);
 return (f&mask)===((2<<3)|(2<<8)|8192|(4<<15)|(2<<18)|(f&(1<<24)))&&(t.cell_path.length?[2]:[1,2]).includes(view(rs[t.table_record].payload).getUint32(0,true)&3)&&v.getInt32(12,true)===0&&[28,30,32,34].every(i=>!v.getUint16(i,true));
}
export function prepareNestedRenderInput(HwpDocument,bytes){
 try{return prepare(HwpDocument,bytes);}catch(e){if(!(e instanceof GuardError)||e.code.includes('LIMIT'))throw e;return {bytes,tables:[],unadapted:[{reason:'nested_identity_unverified'}],remap:r=>r};}
}
function prepare(HwpDocument,bytes){
 const raw=readHwp(bytes),nested=[...raw.streams].some(([name,data])=>/^BodyText\/Section\d+$/.test(name)&&[...parseRecords(data)].some(r=>r.tag===71&&r.level>1&&id(r)===' lbt'));
 if(!nested)return {bytes,tables:[],unadapted:[],remap:r=>r};
 const unadapted=reason=>({bytes,tables:[],unadapted:[{reason}],remap:r=>r});
 const state=inspectLocalComplex(HwpDocument,bytes,{includeDocumentInfo:false,verifyCharacterModel:false}),ts=state.tables;
 // Bound the complete forest, including distinct siblings and normalized hosts.
 if(ts.length<2||ts.length>16||ts.some(t=>t.section!==0||t.cell_path.length>2))return unadapted('nested_tree_profile');
 const rs=state.recordSets.get(0),pages=rs.filter(r=>r.tag===73),cols=rs.filter(r=>r.tag===71&&id(r)==='dloc');
 if(state.recordSets.size!==1||pages.length!==1||pages[0].payload.length!==40||view(pages[0].payload).getUint32(36,true)!==0||cols.length!==1||cols[0].payload.length<8||((view(cols[0].payload).getUint16(4,true)>>>2)&255)!==1)return unadapted('nested_page_profile');
 if(ts.some(t=>!canonical(rs,t)||!t.layout_editable||t.properties.cellSpacing||t.dimensions.rowCount>32||t.dimensions.colCount>16))return unadapted('nested_table_profile');
 const original=new HwpDocument(bytes);try{const originalBindings=bindRenderTables(original,state);if(!originalBindings)return unadapted('nested_render_identity');
 const replacements=new Map(),changes=new Map(),owners=new Map(),headers=new Map(),tables=[],definitions=[...parseRecords(raw.streams.get('DocInfo'))].map(r=>({...r,payload:r.payload.slice()})),shapes=definitions.filter(r=>r.tag===25),map=definitions.find(r=>r.tag===17),extra=[];
 if(!map||map.payload.length<56||shapes.length>1024)return unadapted('nested_definition_profile');
 const objects=new Map();
 for(const t of ts){
  let xs,ys;try{xs=trackPositions(t,'col');ys=trackPositions(t,'row');}catch{return unadapted('nested_grid_profile');}
  if(xs.some(n=>n==null)||ys.some(n=>n==null)||ys.at(-1)!==t.properties.tableHeight)return unadapted('nested_grid_profile');
  for(const c of t.cells){const h=rs[c.start],v=view(h.payload),flags=v.getUint32(4,true);if((flags&31)||((flags>>>5)&3)>2||c.blocks.some(b=>!plain(b.paragraph_properties)||b.tokens.some(t=>!t.text&&![3,4,10,11,13].includes(t.code))))return unadapted('nested_cell_profile');
   for(const b of c.blocks){const fields=tableHostFields(state,b);if(fields.some(f=>!f.value))return unadapted('nested_empty_field_guide');for(let at=b.record_index+1;at<b.records_end;at++){const r=rs[at];if(r.tag!==71||r.level!==b.raw_level+1||[' lbt','klc%'].includes(id(r)))continue;if(id(r)!==' osg')return unadapted('nested_cell_profile');const o=inlineTableHostObject(state,b,at);if(objects.has(b)||b.text||b.tokens.some(t=>![11,13].includes(t.code))||!o.object.flow.affectLineSpacing||b.paragraph_properties.lineSpacing!==160||['marginLeft','marginRight','marginTop','marginBottom'].some(k=>o.object.flow[k])||o.width>c.width-t.properties.paddingLeft-t.properties.paddingRight)return unadapted('nested_object_flow');objects.set(b,{...o,cell:c});}}
   // The pinned renderer otherwise substitutes a one-pixel padding in nested
   // tables, despite the table's stored default. Make that default explicit.
   const payload=h.payload.slice(),p=view(payload);if(!(flags&0x10000))for(const [i,k]of ['paddingLeft','paddingRight','paddingTop','paddingBottom'].entries())p.setUint16(24+2*i,t.properties[k],true);p.setUint32(4,flags|0x10000,true);changes.set(h,{...h,payload});
  }
 }
 if(objects.size>32)return unadapted('nested_object_limit');
 const removed=new Set(),cellWraps=adaptLeafCellWraps(original,state,originalBindings,{rs,changes,headers,shapes,extra,removed});
 const hosts=new Map();
 for(const t of ts.filter(t=>t.cell_path.length)){
  const host=state.blocks.find(b=>b.id===t.parent_id),parent=ts.find(p=>p.cells.some(c=>c.blocks.includes(host))),cell=parent?.cells.find(c=>c.blocks.includes(host));
  if(!cell)return unadapted('nested_host_profile');
  const owner=changes.get(rs[cell.start]),op=view(owner.payload);op.setUint32(4,op.getUint32(4,true)&~0x60,true);
  const control=rs[t.record_index],payload=control.payload.slice(),v=view(payload);v.setUint32(4,v.getUint32(4,true)|1,true);v.setInt32(8,0,true);changes.set(control,{...control,payload});
  tables.push({section:t.section,table_id:t.id,cell_path:t.cell_path,prefix:!!host.text,stored_prefix_height:view(control.payload).getInt32(8,true),ancestor_alignment:(view(rs[cell.start].payload).getUint32(4,true)>>>5)&3});
  if(!hosts.has(host))hosts.set(host,{cell,peers:[]});hosts.get(host).peers.push(t);
 }
 // For float hosts, native vertical alignment measures the
 // visible flow without the final line's trailing leading. The pinned engine
 // omits nested inline heights from that alignment measurement. Reserve the
 // bounded, single-line flow explicitly in the private cell's top padding.
 const fonts=definitions.filter(r=>r.tag===21);
 for(const t of ts)for(const c of t.cells){
  if(!c.blocks.some(b=>hosts.has(b)))continue;
  let height=0,lastGap=0;
  for(const b of c.blocks){
   const sizes=new Set(b.unit_styles.map(i=>fonts[i]?.payload.length>=46?view(fonts[i].payload).getUint32(42,true):NaN)),size=[...sizes][0],children=hosts.get(b)?.peers;
   if(sizes.size!==1||!Number.isFinite(size)||b.text.includes('\n')||b.text.length*size>c.width*.85)return unadapted('nested_multiline_host');
   if(children){height+=view(rs[children[0].record_index].payload).getInt32(8,true)+children.reduce((n,t)=>n+t.properties.tableHeight,0);lastGap=0;}
   else if(objects.has(b)){height+=objects.get(b).height*b.paragraph_properties.lineSpacing/100;lastGap=objects.get(b).height*(b.paragraph_properties.lineSpacing/100-1);}
   else{height+=size*b.paragraph_properties.lineSpacing/100;lastGap=size*(b.paragraph_properties.lineSpacing/100-1);}
  }
  const p=view(changes.get(rs[c.start]).payload),align=(view(rs[c.start].payload).getUint32(4,true)>>>5)&3,room=c.height-p.getUint16(28,true)-p.getUint16(30,true)-height+lastGap,shift=Math.max(0,Math.round(room*(align===1?.5:align===2?1:0)));
  if(p.getUint16(28,true)+shift>65535)return unadapted('nested_alignment_profile');p.setUint16(28,p.getUint16(28,true)+shift,true);
  for(const b of c.blocks)for(const child of hosts.get(b)?.peers??[])tables.find(t=>t.table_id===child.id).ancestor_alignment_shift_hwpunit=shift;
 }
 // Inline drawings have their own verified line-height contribution in native
 // HWP. The pinned renderer places them correctly but advances only its empty
 // line descent. Reserve the missing advance after that paragraph, privately.
 for(const [b,o]of objects){
  const sizes=new Set(b.unit_styles.map(i=>fonts[i]?.payload.length>=46?view(fonts[i].payload).getUint32(42,true):NaN)),size=[...sizes][0],height=o.height*b.paragraph_properties.lineSpacing/100-size*.4,shape=shapes[b.paragraph_properties.paraShapeId];
  if(sizes.size!==1||!Number.isFinite(size)||size!==1000||height<=0||height>65535||!shape||![46,54,58].includes(shape.payload.length))return unadapted('nested_object_line_profile');
  const fixed=shape.payload.slice(),q=view(fixed),spacing=Math.round(height*2);q.setUint32(0,(q.getUint32(0,true)&~3)|1,true);q.setInt32(24,spacing,true);if(fixed.length>=54){q.setUint32(46,(q.getUint32(46,true)&~31)|1,true);q.setInt32(50,spacing,true);}
  const h={...rs[b.record_index],payload:rs[b.record_index].payload.slice()},p=view(h.payload);p.setUint32(0,2,true);p.setUint32(4,0,true);p.setUint16(8,shapes.length+extra.length,true);p.setUint16(12,1,true);p.setUint16(14,0,true);p.setUint16(16,0,true);
  const styles=Buffer.alloc(8);styles.writeUInt32LE(b.unit_styles[0],4);extra.push({tag:25,level:shape.level,payload:fixed});headers.set(h,{block:b,from:0,synthetic:true});
  replacements.set(rs[b.record_index],[{...rs[b.record_index],originHeader:rs[b.record_index]},...rs.slice(b.record_index+1,b.records_end),h,{tag:67,level:h.level+1,payload:Buffer.from(' \r','utf16le')},{tag:68,level:h.level+1,payload:styles}]);owners.set(rs[o.cell.start],(owners.get(rs[o.cell.start])??0)+1);
 }
 for(const [host,{cell,peers}]of hosts){
  peers.sort((a,b)=>a.record_index-b.record_index);const controls=rs.slice(host.record_index+1,host.records_end).filter(r=>r.tag===71&&r.level===host.raw_level+1),anchors=host.tokens.filter(t=>t.code===11),offset=view(rs[peers[0].record_index].payload).getInt32(8,true);
  if(!host.text_range_editable||controls.length!==peers.length||controls.some((r,i)=>r!==rs[peers[i].record_index])||anchors.length!==peers.length||host.tokens.some(t=>!t.text&&![11,13].includes(t.code))||host.tokens.some(t=>t.text&&t.unit>anchors[0].unit)||host.text.length>64||host.text.includes('\n')||!/^[-\p{Script=Hangul}\p{Script=Han}\p{Script=Latin}\p{Number}\p{Punctuation}\p{Zs}]*$/u.test(host.text))return unadapted('nested_host_profile');
  const shape=shapes[host.paragraph_properties.paraShapeId];if(!shape||![46,54,58].includes(shape.payload.length))return unadapted('nested_definition_profile');
  const sizes=new Set(host.character_runs.map(r=>r.properties.fontSize)),size=[...sizes][0]??1000,line=Math.ceil(size*host.paragraph_properties.lineSpacing/100*1.08);
  if(offset<0||host.text&&(sizes.size!==1||!Number.isFinite(line)||line<100||offset<1600||offset>Math.max(1600,line)*4)||!host.text&&offset!==0&&offset!==Math.max(1600,line))return unadapted('nested_prefix_profile');
  let expected=offset;for(const peer of peers){if(view(rs[peer.record_index].payload).getInt32(8,true)!==expected)return unadapted('nested_sibling_offsets');expected+=peer.properties.tableHeight;}
  if(!host.text&&offset){
   const fixed=shape.payload.slice(),q=view(fixed),spacing=offset*2;q.setUint32(0,(q.getUint32(0,true)&~3)|1,true);q.setInt32(24,spacing,true);if(fixed.length>=54){q.setUint32(46,(q.getUint32(46,true)&~31)|1,true);q.setInt32(50,spacing,true);}
   const h={...rs[host.record_index],payload:rs[host.record_index].payload.slice()},p=view(h.payload);p.setUint32(0,2,true);p.setUint32(4,0,true);p.setUint16(8,shapes.length+extra.length,true);p.setUint16(12,1,true);p.setUint16(14,0,true);p.setUint16(16,0,true);
   const styles=Buffer.alloc(8);styles.writeUInt32LE(host.unit_styles[0],4);const blank=[h,{tag:67,level:h.level+1,payload:Buffer.from(' \r','utf16le')},{tag:68,level:h.level+1,payload:styles}];extra.push({tag:25,level:shape.level,payload:fixed});headers.set(h,{block:host,from:0,synthetic:true});
   // Keep the original paragraph header as the second fragment. expand() must
   // not recursively replace that header again.
   const tableHead={...rs[host.record_index],originHeader:rs[host.record_index]};replacements.set(rs[host.record_index],[...blank,tableHead,...rs.slice(host.record_index+1,host.records_end)]);owners.set(rs[cell.start],(owners.get(rs[cell.start])??0)+1);
  }
  if(host.text||peers.length>1){
   const part=partitionTableHost(state,host),replacement=part.records.slice(host.record_index,host.records_end+(part.records.length-rs.length));
   for(const f of part.fragments)headers.set(f.head,{block:host,from:f.from});
   if(host.text){const fixed=shape.payload.slice(),q=view(fixed),spacing=offset*2;q.setUint32(0,(q.getUint32(0,true)&~3)|1,true);q.setInt32(24,spacing,true);if(fixed.length>=54){q.setUint32(46,(q.getUint32(46,true)&~31)|1,true);q.setInt32(50,spacing,true);}
    view(part.fragments[0].head.payload).setUint16(8,shapes.length+extra.length,true);extra.push({tag:25,level:shape.level,payload:fixed});}
   replacements.set(rs[host.record_index],replacement);owners.set(rs[cell.start],(owners.get(rs[cell.start])??0)+part.delta);
  }
 }
 const expand=records=>{const result=[];for(let i=0;i<records.length;i++){const r=records[i];if(removed.has(r))continue;if(replacements.has(r)){result.push(...expand(replacements.get(r)));while(i+1<records.length&&records[i+1].level>r.level)i++;}else result.push(changes.get(r)??r);}return result;},out=expand(rs);
 for(const [old,delta]of owners){const h=changes.get(old),p=view(h.payload);p.setUint16(0,p.getUint16(0,true)+delta,true);}
 const originalHeaders=new Map(state.blocks.map(b=>[rs[b.record_index],b])),origins=new Map();
 for(const [i,r]of out.entries())if(r.tag===66)origins.set(i,headers.get(r)??{block:originalHeaders.get(r.originHeader??r),from:0});
 if(extra.length){view(map.payload).setUint32(52,shapes.length+extra.length,true);definitions.splice(definitions.indexOf(shapes.at(-1))+1,0,...extra);}
 const pack=value=>(view(raw.streams.get('FileHeader')).getUint32(36,true)&1)?deflateRawSync(encodeRecords(value),{level:9}):encodeRecords(value),privateBytes=patchLocalPackedStreams(bytes,new Map([['BodyText/Section0',pack(out)],['DocInfo',pack(definitions)]])),after=inspectLocalComplex(HwpDocument,privateBytes,{includeDocumentInfo:false,verifyCharacterModel:false}),paths=new Map();
 for(const b of after.blocks){const old=origins.get(b.record_index);if(!old?.block)return unadapted('nested_identity_profile');paths.set(key(b),old);}
 const joined=new Map();for(const b of after.blocks){const entry=paths.get(key(b)),old=entry.block,projected=entry.projection?projectCellRenderText(b.text,entry.projection):b.text;if(projected===null)return unadapted('cell_wrap_projection_identity');if(entry.projection&&(!equal(b.unit_styles,entry.projection.offsets.map((offset,i)=>old.unit_styles[entry.projection.synthetic.has(i)?Math.max(0,offset-1):offset]))))return unadapted('cell_wrap_style_identity');joined.set(old,(joined.get(old)??'')+(entry.synthetic?'':projected));}
 if(state.blocks.some(b=>joined.get(b)!==b.text))return unadapted('nested_text_profile');
 let controls=new Map(),objectControls=new Map(),objectRuns=new Map();
 const privateObjects=new Map(),objectSources=new Map();
 for(const [b,value]of objects){const o=[...after.pictures,...after.text_boxes].find(o=>out[o.record_index]===rs[value.object.record_index]),block=after.blocks.find(b=>b.id===o?.block_id);if(!o||!block)return unadapted('nested_object_identity');privateObjects.set(block,{...value,object:o});objectSources.set(o,{...value,block:b});}
 const refresh=document=>{
  const bindings=bindRenderTables(document,after);if(!bindings)return false;const next=new Map();
  for(const [k,t]of bindings){const oldControl=out[t.record_index],sourceControl=[...changes].find(([,r])=>r===oldControl)?.[0]??oldControl,old=ts.find(t=>rs[t.record_index]===sourceControl),identity=old&&originalBindings.byTable.get(old);if(!identity)return false;next.set(k,{...identity,table_id:old.id,parentParaIdx:old.cell_path.length?old.paragraph:undefined,cellPath:old.cell_path.length?old.cell_path:undefined,cellIdentities:bindings.fragments.get(k).map(c=>c.cell)});}
  if(cellWraps.adapted.length){
   const runs=[];for(let page=0;page<document.pageCount();page++)runs.push(...JSON.parse(document.getPageTextLayout(page)).runs);
   for(const b of after.blocks){const entry=paths.get(key(b));if(!entry.projection)continue;
    const selected=runs.filter(r=>r.secIdx===b.section&&r.parentParaIdx===b.paragraph&&equal(r.cellPath,b.cell_path)&&r.text),expected=entry.projection.text.split('\n').filter(Boolean);
    if(!equal(selected.map(r=>r.text),expected)||selected.some(r=>!Number.isSafeInteger(r.charStart)||r.charStart<0||entry.projection.text.slice(r.charStart,r.charStart+r.text.length)!==r.text))return false;
   }
  }
  const bound=bindRenderObjects(document,after,privateObjects);if(!bound)return false;
  objectControls=new Map([...bound.controls].map(([k,v])=>[k,objectSources.get(v.object)]));objectRuns=new Map([...bound.runs].map(([k,v])=>[k,objectSources.get(v.object)]));controls=next;return true;
 };
 const privateDocument=new HwpDocument(privateBytes);try{if(!refresh(privateDocument))return unadapted('nested_render_identity');}finally{privateDocument.free();}
 return {bytes:privateBytes,tables,unadapted:[],cell_wraps:cellWraps.adapted,unadapted_cells:cellWraps.unadapted,refresh,remap:(r,page=0)=>{
  if(r.type==='table'){const original=controls.get(renderTableKey(r,page));if(!original)return r;const {cellIdentities,...identity}=original;return {...r,...identity,cells:r.cells.map((c,i)=>({...c,cellIdx:cellIdentities[i]}))};}
  const object=r.type?objectControls.get(renderTableKey(r,page)):objectRuns.get(renderRunKey(r,page));
  if(object){const b=object.block,o=object.object,first=b.cell_path[0];return {...r,cellPath:b.cell_path,parentParaIdx:b.paragraph,paraIdx:r.type?b.paragraph:0,controlIdx:r.type?o.control_index:first.controlIndex,cellIdx:first.cellIndex,cellParaIdx:first.cellParaIndex,...(r.type?{stableIndex:[b.section,b.paragraph,...b.cell_path.flatMap(p=>[p.controlIndex,p.cellIndex,p.cellParaIndex]),o.control_index],outerTableControlIdx:first.controlIndex}:{text_box_id:o.id,text_box_paragraph:0})};}
  if(!r.cellPath)return r;const entry=paths.get(JSON.stringify([r.secIdx,r.parentParaIdx,r.cellPath]));if(!entry)return r;if(entry.synthetic)return {...r,render_only_synthetic:true};const b=entry.block,first=b.cell_path[0];return {...r,cellPath:b.cell_path,paraIdx:b.cell_paragraph,parentParaIdx:b.paragraph,controlIdx:first.controlIndex,cellIdx:first.cellIndex,cellParaIdx:first.cellParaIndex,charStart:entry.projection?(entry.projection.offsets[r.charStart??0]??b.text.length):(r.charStart??0)+entry.from,...(entry.projection?{paraShapeId:b.paragraph_properties.paraShapeId}:{})};
 }};
 }finally{original.free();}
}
