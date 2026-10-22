/** Interleaved text/table anchors and co-hosted body roots; synthetic only. */
import {HwpDocument} from '@rhwp/core';
import {tableReflowFixture,hostTablesFixture,tableAnswer} from './local_table_reflow_fixtures.mjs';
import {inspectLocalComplex,editLocalComplex} from '../src/one_hwp/local_complex.mjs';
import {view} from '../src/one_hwp/local_complex_records.mjs';
import {publishVerifiedPatch} from '../src/one_hwp/local_verified_patch.mjs';
import {digest} from '../src/one_hwp/local_file.mjs';
import {checkedExport} from './local_complex_fixtures.mjs';
const inspect=bytes=>inspectLocalComplex(HwpDocument,bytes,{includeDocumentInfo:false,verifyCharacterModel:false});
export function tableTextFlowFixture({body=false,depth=2,count=2,selected=0,lines=85,alignment=[],prefix='PREFIX NOTE',between='BETWEEN NOTE',suffix='SUFFIX NOTE',mixed=false,field=false,outerMargins=null}={}){
 let bytes=body?tableReflowFixture({depth,lines:8,alignment}):hostTablesFixture({depth,count,selected,lines:8,alignment,outerMargins}),state=inspect(bytes);
 if(body){const root=state.tables[0],host=state.blocks.find(b=>b.id===root.parent_id),rs=state.recordSets.get(0).map(r=>({...r,payload:r.payload.slice()})),subtree=rs.slice(root.record_index,root.end),addition=[];
  for(let i=1;i<count;i++){const copy=subtree.map(r=>({...r,payload:r.payload.slice()}));for(const r of copy)if(r.tag===71&&Buffer.from(r.payload.subarray(0,4)).toString()===' lbt')view(r.payload).setUint32(36,1000+i*16+addition.length,true);addition.push(...copy);}
  rs.splice(root.end,0,...addition);const anchor=rs[host.text_record].payload.subarray(0,-2);rs[host.text_record].payload=Buffer.concat([...Array(count).fill(anchor),Buffer.from('\r','utf16le')]);view(rs[host.record_index].payload).setUint32(0,rs[host.text_record].payload.length/2,true);bytes=publishVerifiedPatch(bytes,state,0,rs);
 }
 for(let i=0;i<count;i++){state=inspect(bytes);const roots=state.tables.filter(t=>!t.cell_path.length),tree=body?state.tables.filter(t=>t.record_index>=roots[i].record_index&&t.end<=roots[i].end):state.tables.filter(t=>t.cell_path.length===depth-1),leaf=body?tree.reduce((a,b)=>a.cell_path.length>=b.cell_path.length?a:b):tree[i],b=leaf.cells[0].blocks[0],version=digest(bytes);bytes=editLocalComplex(HwpDocument,bytes,version,{type:'splice_text',target_id:`hwp5:${version}:${Buffer.from(b.id).toString('base64url')}`,expected_old:b.text,start:0,end:[...b.text].length,new_text:i===selected?tableAnswer(lines):`PEER ${i} TABLE`}).bytes;}
 state=inspect(bytes);const tables=state.tables.filter(t=>body?!t.cell_path.length:t.cell_path.length===depth-1),host=state.blocks.find(b=>b.id===tables[0].parent_id),rs=state.recordSets.get(0).map(r=>({...r,payload:r.payload.slice()})),raw=rs[host.text_record].payload,anchors=host.tokens.filter(t=>t.code===11).map(t=>raw.subarray(t.unit*2,(t.unit+t.length)*2)),units=[Buffer.from(prefix,'utf16le')];
 for(const [i,a]of anchors.entries()){const separator=Array.isArray(between)?between[i-1]:between;if(i&&separator)units.push(Buffer.from(separator,'utf16le'));units.push(a);}units.push(Buffer.from(suffix+'\r','utf16le'));const payload=Buffer.concat(units),header=view(rs[host.record_index].payload);header.setUint32(0,((header.getUint32(0,true)&0x80000000)|payload.length/2)>>>0,true);header.setUint32(4,(1<<11)|(payload.toString('utf16le').includes('\n')?1<<10:0),true);header.setUint16(12,1,true);header.setUint16(16,0,true);const shape=new Uint8Array(8);view(shape).setUint32(4,host.unit_styles[0],true);rs[host.text_record].payload=payload;rs[host.shape_record].payload=shape;
 bytes=publishVerifiedPatch(bytes,state,0,rs.filter(r=>r.tag!==69));
 if(mixed&&prefix){state=inspect(bytes);const host=state.blocks.find(b=>b.text.startsWith(prefix)),version=digest(bytes);bytes=editLocalComplex(HwpDocument,bytes,version,{type:'format_text',target_id:`hwp5:${version}:${Buffer.from(host.id).toString('base64url')}`,expected_old:host.text,start:0,end:[...prefix].length,props:{bold:true}}).bytes;}
 if(field){state=inspect(bytes);const tail=state.blocks.find(b=>b.text==='TAIL'),d=new HwpDocument(bytes);try{const f=JSON.parse(d.insertClickHereField(0,tail.paragraph,0,'guide','memo','retained-field',true));d.setFieldValue(f.fieldId,'FIELD VALUE');bytes=checkedExport(d);}finally{d.free();}}
 return bytes;
}
