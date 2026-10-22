/** Trusted synthetic horizontal tables; every label is generated test data. */
import {HwpDocument} from '@rhwp/core';
import {fixture} from './rhwp_fixtures.mjs';
import {nestedFixture,checkedExport} from './local_complex_fixtures.mjs';
import {inspectLocalComplex} from '../src/one_hwp/local_complex.mjs';
import {view} from '../src/one_hwp/local_complex_records.mjs';
import {publishVerifiedPatch} from '../src/one_hwp/local_verified_patch.mjs';
import {invalidateSectionLayout} from '../src/one_hwp/local_layout_cache.mjs';
import {editLocalComplex} from '../src/one_hwp/local_complex.mjs';
import {digest} from '../src/one_hwp/local_file.mjs';
import {deflateRawSync} from 'node:zlib';
import {parseRecords} from '../probes/sites-runtime/guard/records.mjs';
import {readHwp} from '../probes/sites-runtime/guard/container.mjs';
import {encodeRecords} from '../src/one_hwp/local_complex_records.mjs';
import {patchLocalPackedStreams} from '../src/one_hwp/local_container_write.mjs';
export const tableAnswer=lines=>Array.from({length:lines},(_,i)=>`L${String(i).padStart(3,'0')}`).join('\n');
export function tableReflowFixture({depth=1,lines=85,rows=1,merged=false,verticalMerge=false,footer=false,narrow=false,alignment=[]}={}){
 if(verticalMerge===true)rows=Math.max(2,rows);
 let bytes=fixture({cells:Array.from({length:rows},(_,i)=>[i?'LAST ROW':'OUTER','SIDE']),paragraphs:['HEAD','TAIL','END']});
 for(let i=1;i<depth;i++)bytes=nestedFixture(bytes,{rows:verticalMerge==='nested'&&i===depth-1?2:1,cols:depth>2&&i===depth-1&&!narrow?1:2,inside_nested:i>1});
 if(footer){const d=new HwpDocument(bytes);try{d.createHeaderFooter(0,false,0);d.insertTextInHeaderFooter(0,false,0,0,0,'FIXED FOOTER');bytes=checkedExport(d);}finally{d.free();}}
 let s=inspectLocalComplex(HwpDocument,bytes,{includeDocumentInfo:false,verifyCharacterModel:false}),b=s.blocks.find(b=>b.cell_path.length===depth),hash=digest(bytes);
 bytes=editLocalComplex(HwpDocument,bytes,hash,{type:'splice_text',target_id:`hwp5:${hash}:${Buffer.from(b.id).toString('base64url')}`,expected_old:b.text,start:0,end:[...b.text].length,new_text:tableAnswer(lines)}).bytes;
 s=inspectLocalComplex(HwpDocument,bytes,{includeDocumentInfo:false,verifyCharacterModel:false});const rs=s.recordSets.get(0).map(r=>({...r,payload:r.payload.slice()}));
 for(const t of s.tables){const control=view(rs[t.record_index].payload);for(const i of [28,30,32,34])control.setUint16(i,0,true);for(const c of t.cells){const p=view(rs[c.start].payload);p.setUint32(4,(p.getUint32(4,true)&~0x60)|((alignment[t.cell_path.length]??0)<<5),true);}}
 if(merged){const t=s.tables.at(-1),first=t.cells[0],second=t.cells[1];view(rs[first.start].payload).setUint16(12,2,true);view(rs[first.start].payload).setUint32(16,first.width+second.width,true);view(rs[first.start].payload).setUint32(34,first.width+second.width,true);rs.splice(second.start,second.end-second.start);const p=view(rs[t.table_record].payload);p.setUint16(18,1,true);}
 if(verticalMerge){const t=verticalMerge==='nested'?s.tables.at(-1):s.tables[0],first=t.cells[0],later=t.cells[2];view(rs[first.start].payload).setUint16(14,2,true);view(rs[first.start].payload).setUint32(20,first.height+later.height,true);rs.splice(later.start,later.end-later.start);view(rs[t.table_record].payload).setUint16(20,1,true);}
 // All new cell paragraphs have ordinary line spacing but deliberately fixed
 // table flow/size protection so a real edit must unlock the selected root tree.
 if(!merged&&!verticalMerge)for(const t of s.tables){const p=view(rs[t.record_index].payload);p.setUint32(4,p.getUint32(4,true)|(1<<20),true);}
 const current=merged||verticalMerge?rs:invalidateSectionLayout(rs,s.blocks);
 return publishVerifiedPatch(bytes,s,0,current);
}
export function multipleRootFixture(){
 const second=tableReflowFixture({depth:2,lines:8});let first=second;
 for(const [old,value] of [[tableAnswer(8),tableAnswer(8).replaceAll('L','A')],['TAIL','FIRST FINISH'],['END','FIRST CLOSE']]){
  const state=inspectLocalComplex(HwpDocument,first,{includeDocumentInfo:false,verifyCharacterModel:false}),b=state.blocks.find(b=>b.text===old),version=digest(first);first=editLocalComplex(HwpDocument,first,version,{type:'replace_text',target_id:`hwp5:${version}:${Buffer.from(b.id).toString('base64url')}`,expected_old:old,new_text:value}).bytes;
 }
 const raw=readHwp(first),defs=[...parseRecords(raw.streams.get('DocInfo'))].map(r=>({...r,payload:r.payload.slice()}));view(defs.find(r=>r.tag===16).payload).setUint16(0,2,true);
 return patchLocalPackedStreams(first,new Map([['DocInfo',deflateRawSync(encodeRecords(defs),{level:9})],['BodyText/Section1',deflateRawSync(readHwp(second).streams.get('BodyText/Section0'),{level:9})]]));
}
/** Distinct sibling tables in a single nested host, in original control order. */
export function hostTablesFixture({depth=2,lines=85,alignment=[],selected=0,count=2,room=0,outerMargins=null}={}){
 let bytes=tableReflowFixture({depth,lines:8,alignment}),state=inspectLocalComplex(HwpDocument,bytes,{includeDocumentInfo:false,verifyCharacterModel:false}),rs=state.recordSets.get(0).map(r=>({...r,payload:r.payload.slice()})),leaf=state.tables.at(-1),host=state.blocks.find(b=>b.id===leaf.parent_id),token=host.tokens.find(t=>t.code===11),anchor=rs[host.text_record].payload.slice(token.unit*2,(token.unit+8)*2),subtree=rs.slice(leaf.record_index,leaf.end),addition=[];
 for(let i=1;i<count;i++){const copy=subtree.map(r=>({...r,payload:r.payload.slice()}));view(copy[0].payload).setUint32(36,100+i,true);addition.push(...copy);}
 rs[host.text_record].payload=Buffer.concat([rs[host.text_record].payload.subarray(0,-2),...Array(count-1).fill(anchor),Buffer.from('\r','utf16le')]);const header=view(rs[host.record_index].payload);header.setUint32(0,((header.getUint32(0,true)&0x80000000)|rs[host.text_record].payload.length/2)>>>0,true);rs.splice(leaf.end,0,...addition);bytes=publishVerifiedPatch(bytes,state,0,rs);
 for(let i=0;i<count;i++){state=inspectLocalComplex(HwpDocument,bytes,{includeDocumentInfo:false,verifyCharacterModel:false});const table=state.tables.filter(t=>t.cell_path.length===depth-1)[i],b=table.cells[0].blocks[0],version=digest(bytes),text=i===selected?tableAnswer(lines):`PEER ${i} TABLE`;bytes=editLocalComplex(HwpDocument,bytes,version,{type:'splice_text',target_id:`hwp5:${version}:${Buffer.from(b.id).toString('base64url')}`,expected_old:b.text,start:0,end:[...b.text].length,new_text:text}).bytes;}
 state=inspectLocalComplex(HwpDocument,bytes,{includeDocumentInfo:false,verifyCharacterModel:false});rs=state.recordSets.get(0).map(r=>({...r,payload:r.payload.slice()}));if(outerMargins)for(const t of state.tables.filter(t=>t.cell_path.length===depth-1))outerMargins.forEach((n,i)=>view(rs[t.record_index].payload).setUint16(28+2*i,n,true));if(room)for(const t of state.tables){for(const c of t.cells)view(rs[c.start].payload).setUint32(20,(depth-t.cell_path.length)*room,true);view(rs[t.record_index].payload).setUint32(20,(depth-t.cell_path.length)*room,true);}
 return publishVerifiedPatch(bytes,state,0,invalidateSectionLayout(rs,state.blocks));
}
