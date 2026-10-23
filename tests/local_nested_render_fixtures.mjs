/** Trusted canonical flowing tables with visible ancestor prefixes and room. */
import {HwpDocument} from '@rhwp/core';
import {tableReflowFixture} from './local_table_reflow_fixtures.mjs';
import {tableFloatingFixture} from './local_table_floating_fixtures.mjs';
import {tableReflowContexts,reflowTableLocal} from '../src/one_hwp/local_table_reflow.mjs';
import {inspectLocalComplex} from '../src/one_hwp/local_complex.mjs';
import {editLocalComplex} from '../src/one_hwp/local_complex.mjs';
import {digest} from '../src/one_hwp/local_file.mjs';
import {view} from '../src/one_hwp/local_complex_records.mjs';
import {publishVerifiedPatch} from '../src/one_hwp/local_verified_patch.mjs';
export const nestedRenderProfiles=[
 {name:'nested-top',depth:2,alignment:0},
 {name:'nested-middle',depth:2,alignment:1},
 {name:'nested-bottom',depth:2,alignment:2},
 {name:'deep-top',depth:3,alignment:0},
 {name:'deep-middle',depth:3,alignment:1},
 {name:'deep-bottom',depth:3,alignment:2}
];
export function nestedRenderFixture({depth=2,alignment=0,lines=8,room=6000,floating=false,prefix='OUTER'}={}){
 let bytes=tableReflowFixture({depth,lines,alignment:Array(depth).fill(alignment)});
 // Keep this origin/alignment corpus separate from narrow-cell font shaping.
 for(const [old,text]of [['inner label','IN'],['inner answer 😀','PEER'],...prefix!=='OUTER'?[['OUTER',prefix]]:[]]){
  const s=inspectLocalComplex(HwpDocument,bytes,{includeDocumentInfo:false,verifyCharacterModel:false}),b=s.blocks.find(b=>b.text===old);if(!b)continue;const hash=digest(bytes);
  bytes=editLocalComplex(HwpDocument,bytes,hash,{type:'splice_text',target_id:`hwp5:${hash}:${Buffer.from(b.id).toString('base64url')}`,expected_old:old,start:0,end:[...old].length,new_text:text}).bytes;
 }
 if(floating)bytes=tableFloatingFixture({source:bytes,objects:['picture','box']});
 let s=inspectLocalComplex(HwpDocument,bytes,{includeDocumentInfo:false,verifyCharacterModel:false});
 // Make stored minima large enough that alignment has actual spare room.
 const rs=s.recordSets.get(0).map(r=>({...r,payload:r.payload.slice()}));
 for(const t of s.tables){const extra=(depth-t.cell_path.length)*room;for(const c of t.cells)view(rs[c.start].payload).setUint32(20,c.height+extra,true);view(rs[t.record_index].payload).setUint32(20,t.properties.tableHeight+extra,true);}
 bytes=publishVerifiedPatch(bytes,s,0,rs);s=inspectLocalComplex(HwpDocument,bytes,{includeDocumentInfo:false,verifyCharacterModel:false});const version=digest(bytes),c=tableReflowContexts(s,version)[0];
 return reflowTableLocal(HwpDocument,bytes,version,{type:'reflow_table',target_id:c.target_id,expected_old:c.expected_old,expected_tables:c.expected_tables}).bytes;
}
