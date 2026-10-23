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
import {patchLocalPackedStreams} from './local_container_write.mjs';
const id=r=>Buffer.from(r.payload.subarray(0,4)).toString();
const key=b=>JSON.stringify([b.section,b.paragraph,b.cell_path]);
const plain=p=>p&&['left','justify'].includes(p.alignment)&&p.lineSpacingType===0&&p.lineSpacing>=100&&p.lineSpacing<=300&&!p.keepWithNext&&!p.keepLines&&!p.pageBreakBefore&&!p.fontLineHeight&&['marginLeft','marginRight','indent','spacingBefore','spacingAfter'].every(k=>!p[k]);
function canonical(rs,t){
 const p=rs[t.record_index].payload;if(p.length!==42&&!validObjectHeader(p))return false;const v=view(p);if(p.length===42?v.getUint16(40,true)!==0:v.getUint32(40,true)!==0)return false;const f=v.getUint32(4,true),mask=1|4|(3<<3)|(7<<5)|(3<<8)|(7<<10)|8192|16384|(7<<15)|(3<<18)|(1<<20)|(7<<21)|(3<<24);
 return (f&mask)===((2<<3)|(2<<8)|8192|(4<<15)|(2<<18)|(f&(1<<24)))&&(view(rs[t.table_record].payload).getUint32(0,true)&3)===2&&v.getInt32(12,true)===0&&[28,30,32,34].every(i=>!v.getUint16(i,true));
}
export function prepareNestedRenderInput(HwpDocument,bytes){
 try{return prepare(HwpDocument,bytes);}catch(e){if(!(e instanceof GuardError)||e.code.includes('LIMIT'))throw e;return {bytes,tables:[],unadapted:[{reason:'nested_identity_unverified'}],remap:r=>r};}
}
function prepare(HwpDocument,bytes){
 const raw=readHwp(bytes),nested=[...raw.streams].some(([name,data])=>/^BodyText\/Section\d+$/.test(name)&&[...parseRecords(data)].some(r=>r.tag===71&&r.level>1&&id(r)===' lbt'));
 if(!nested)return {bytes,tables:[],unadapted:[],remap:r=>r};
 const unadapted=reason=>({bytes,tables:[],unadapted:[{reason}],remap:r=>r});
 const state=inspectLocalComplex(HwpDocument,bytes,{includeDocumentInfo:false,verifyCharacterModel:false}),ts=state.tables;
 // One root chain, depth two or three, on one horizontal column. Siblings,
 // page-split roots and arbitrary floating origins remain explicitly unknown.
 if(ts.length<2||ts.length>3||ts.some((t,i)=>t.section!==0||t.cell_path.length!==i))return unadapted('nested_tree_profile');
 const rs=state.recordSets.get(0),pages=rs.filter(r=>r.tag===73),cols=rs.filter(r=>r.tag===71&&id(r)==='dloc');
 if(state.recordSets.size!==1||pages.length!==1||pages[0].payload.length!==40||view(pages[0].payload).getUint32(36,true)!==0||cols.length!==1||cols[0].payload.length<8||((view(cols[0].payload).getUint16(4,true)>>>2)&255)!==1)return unadapted('nested_page_profile');
 if(ts.some(t=>!canonical(rs,t)||!t.layout_editable||t.properties.cellSpacing||t.dimensions.rowCount>32||t.dimensions.colCount>16))return unadapted('nested_table_profile');
 const original=new HwpDocument(bytes),identities=new Map();try{
  const count=original.pageCount();if(count>32)return unadapted('nested_render_pagination');const observed=[];
  for(let page=0;page<count;page++)observed.push(...JSON.parse(original.getPageControlLayout(page)).controls.filter(c=>c.type==='table').map(c=>({...c,page})));
  if(observed.length!==ts.length||new Set(observed.map(c=>c.page)).size!==1||new Set(observed.map(c=>c.stableIndex?.length)).size!==ts.length)return unadapted('nested_render_pagination');
  for(const c of observed)identities.set(c.stableIndex.length,{stableIndex:c.stableIndex,secIdx:c.secIdx,paraIdx:c.paraIdx,controlIdx:c.controlIdx});
 }finally{original.free();}
 const replacements=new Map(),changes=new Map(),owners=new Map(),headers=new Map(),tables=[],definitions=[...parseRecords(raw.streams.get('DocInfo'))].map(r=>({...r,payload:r.payload.slice()})),shapes=definitions.filter(r=>r.tag===25),map=definitions.find(r=>r.tag===17),extra=[];
 if(!map||map.payload.length<56||shapes.length>1024)return unadapted('nested_definition_profile');
 for(const t of ts){
  let xs,ys;try{xs=trackPositions(t,'col');ys=trackPositions(t,'row');}catch{return unadapted('nested_grid_profile');}
  if(xs.some(n=>n==null)||ys.some(n=>n==null)||ys.at(-1)!==t.properties.tableHeight)return unadapted('nested_grid_profile');
  for(const c of t.cells){const h=rs[c.start],v=view(h.payload),flags=v.getUint32(4,true);if((flags&31)||((flags>>>5)&3)>2||c.blocks.some(b=>!plain(b.paragraph_properties)||b.tokens.some(t=>!t.text&&![10,11,13].includes(t.code))||rs.slice(b.record_index+1,b.records_end).some(r=>r.tag===71&&r.level===b.raw_level+1&&id(r)!==' lbt')))return unadapted('nested_cell_profile');
   // The pinned renderer otherwise substitutes a one-pixel padding in nested
   // tables, despite the table's stored default. Make that default explicit.
   const payload=h.payload.slice(),p=view(payload);if(!(flags&0x10000))for(const [i,k]of ['paddingLeft','paddingRight','paddingTop','paddingBottom'].entries())p.setUint16(24+2*i,t.properties[k],true);p.setUint32(4,flags|0x10000,true);changes.set(h,{...h,payload});
  }
 }
 for(const t of ts.slice(1)){
  const host=state.blocks.find(b=>b.id===t.parent_id),parent=ts.find(p=>p.cells.some(c=>c.blocks.includes(host))),cell=parent?.cells.find(c=>c.blocks.includes(host)),controls=rs.slice(host.record_index+1,host.records_end).filter(r=>r.tag===71&&r.level===host.raw_level+1),anchors=host.tokens.filter(t=>t.code===11),offset=view(rs[t.record_index].payload).getInt32(8,true);
  if(!cell||cell.blocks.length!==1||!host.text_range_editable||controls.length!==1||controls[0]!==rs[t.record_index]||anchors.length!==1||host.tokens.some(t=>!t.text&&![11,13].includes(t.code))||host.tokens.some(t=>t.text&&t.unit>anchors[0].unit)||host.text.length>64||host.text.includes('\n')||!/^[-\p{Script=Hangul}\p{Script=Han}\p{Script=Latin}\p{Number}\p{Punctuation}\p{Zs}]*$/u.test(host.text))return unadapted('nested_host_profile');
  const shape=shapes[host.paragraph_properties.paraShapeId];if(!shape||![46,54,58].includes(shape.payload.length))return unadapted('nested_definition_profile');
  const sizes=new Set(host.character_runs.map(r=>r.properties.fontSize)),size=[...sizes][0],line=Math.ceil(size*host.paragraph_properties.lineSpacing/100*1.08);
  if(offset<0||host.text&&(sizes.size!==1||!Number.isFinite(line)||line<100||offset<1600||offset>Math.max(1600,line)*4)||!host.text&&offset!==0)return unadapted('nested_prefix_profile');
  const owner=changes.get(rs[cell.start]),op=view(owner.payload);op.setUint32(4,op.getUint32(4,true)&~0x60,true);
  const control=rs[t.record_index],payload=control.payload.slice(),v=view(payload);v.setUint32(4,v.getUint32(4,true)|1,true);v.setInt32(8,0,true);changes.set(control,{...control,payload});
  if(host.text){
   const part=partitionTableHost(state,host),replacement=part.records.slice(host.record_index,host.records_end+(part.records.length-rs.length));
   for(const f of part.fragments)headers.set(f.head,host);
   // Fixed per-line reserve keeps the stored prefix-to-table gap. Glyph
   // shaping/wrapping remains a separate uncertainty, never native proof.
   const fixed=shape.payload.slice(),q=view(fixed),spacing=Math.max(1600,line)*2;q.setUint32(0,(q.getUint32(0,true)&~3)|1,true);q.setInt32(24,spacing,true);if(fixed.length>=54){q.setUint32(46,(q.getUint32(46,true)&~31)|1,true);q.setInt32(50,spacing,true);}
   const first=part.fragments[0].head;view(first.payload).setUint16(8,shapes.length+extra.length,true);extra.push({tag:25,level:shape.level,payload:fixed});replacements.set(rs[host.record_index],replacement);owners.set(rs[cell.start],(owners.get(rs[cell.start])??0)+part.delta);
  }
  tables.push({section:t.section,table_id:t.id,cell_path:t.cell_path,prefix:!!host.text,stored_prefix_height:offset,ancestor_alignment:(view(rs[cell.start].payload).getUint32(4,true)>>>5)&3});
 }
 const expand=records=>{const result=[];for(let i=0;i<records.length;i++){const r=records[i];if(replacements.has(r)){result.push(...expand(replacements.get(r)));while(i+1<records.length&&records[i+1].level>r.level)i++;}else result.push(changes.get(r)??r);}return result;},out=expand(rs);
 for(const [old,delta]of owners){const h=changes.get(old),p=view(h.payload);p.setUint16(0,p.getUint16(0,true)+delta,true);}
 const originalHeaders=new Map(state.blocks.map(b=>[rs[b.record_index],b])),origins=new Map();
 for(const [i,r]of out.entries())if(r.tag===66)origins.set(i,headers.get(r)??originalHeaders.get(r));
 if(extra.length){view(map.payload).setUint32(52,shapes.length+extra.length,true);definitions.splice(definitions.indexOf(shapes.at(-1))+1,0,...extra);}
 const pack=value=>(view(raw.streams.get('FileHeader')).getUint32(36,true)&1)?deflateRawSync(encodeRecords(value),{level:9}):encodeRecords(value),privateBytes=patchLocalPackedStreams(bytes,new Map([['BodyText/Section0',pack(out)],['DocInfo',pack(definitions)]])),after=inspectLocalComplex(HwpDocument,privateBytes,{includeDocumentInfo:false,verifyCharacterModel:false}),paths=new Map();
 for(const b of after.blocks){const old=origins.get(b.record_index);if(!old)return unadapted('nested_identity_profile');paths.set(key(b),old);}
 if(!equal(state.blocks.filter(b=>b.text).map(b=>b.text),after.blocks.filter(b=>b.text).map(b=>b.text)))return unadapted('nested_text_profile');
 return {bytes:privateBytes,tables,unadapted:[],remap:r=>{if(r.type==='table'){const original=identities.get(r.stableIndex?.length);return original?{...r,...original}:r;}if(!r.cellPath)return r;const b=paths.get(JSON.stringify([r.secIdx,r.parentParaIdx,r.cellPath]));return b?{...r,cellPath:b.cell_path,cellIdx:b.cell_path.at(-1).cellIndex,cellParaIdx:b.cell_path.at(-1).cellParaIndex}:r;}};
}
