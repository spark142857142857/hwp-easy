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
export const tableAnswer=lines=>Array.from({length:lines},(_,i)=>`L${String(i).padStart(3,'0')}`).join('\n');
export function tableReflowFixture({depth=1,lines=85,rows=1,merged=false,footer=false,narrow=false}={}){
 let bytes=fixture({cells:Array.from({length:rows},(_,i)=>[i?'LAST ROW':'OUTER','SIDE']),paragraphs:['HEAD','TAIL','END']});
 for(let i=1;i<depth;i++)bytes=nestedFixture(bytes,{cols:depth>2&&i===depth-1&&!narrow?1:2,inside_nested:i>1});
 if(footer){const d=new HwpDocument(bytes);try{d.createHeaderFooter(0,false,0);d.insertTextInHeaderFooter(0,false,0,0,0,'FIXED FOOTER');bytes=checkedExport(d);}finally{d.free();}}
 let s=inspectLocalComplex(HwpDocument,bytes,{includeDocumentInfo:false,verifyCharacterModel:false}),b=s.blocks.find(b=>b.cell_path.length===depth),hash=digest(bytes);
 bytes=editLocalComplex(HwpDocument,bytes,hash,{type:'splice_text',target_id:`hwp5:${hash}:${Buffer.from(b.id).toString('base64url')}`,expected_old:b.text,start:0,end:[...b.text].length,new_text:tableAnswer(lines)}).bytes;
 s=inspectLocalComplex(HwpDocument,bytes,{includeDocumentInfo:false,verifyCharacterModel:false});const rs=s.recordSets.get(0).map(r=>({...r,payload:r.payload.slice()}));
 for(const t of s.tables){const control=view(rs[t.record_index].payload);for(const i of [28,30,32,34])control.setUint16(i,0,true);for(const c of t.cells){const p=view(rs[c.start].payload);p.setUint32(4,p.getUint32(4,true)&~0x60,true);}}
 if(merged){const t=s.tables.at(-1),first=t.cells[0],second=t.cells[1];view(rs[first.start].payload).setUint16(12,2,true);view(rs[first.start].payload).setUint32(16,first.width+second.width,true);view(rs[first.start].payload).setUint32(34,first.width+second.width,true);rs.splice(second.start,second.end-second.start);const p=view(rs[t.table_record].payload);p.setUint16(18,1,true);}
 // All new cell paragraphs have ordinary line spacing but deliberately fixed
 // table flow/size protection so a real edit must unlock the selected root tree.
 if(!merged)for(const t of s.tables){const p=view(rs[t.record_index].payload);p.setUint32(4,p.getUint32(4,true)|(1<<20),true);}
 const current=merged?rs:invalidateSectionLayout(rs,s.blocks);
 return publishVerifiedPatch(bytes,s,0,current);
}
