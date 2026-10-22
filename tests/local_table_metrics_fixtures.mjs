/** Reproducible narrow and styled Unicode answers; no external documents. */
import {HwpDocument} from '@rhwp/core';
import {tableReflowFixture} from './local_table_reflow_fixtures.mjs';
import {inspectLocalComplex,editLocalComplex} from '../src/one_hwp/local_complex.mjs';
import {digest} from '../src/one_hwp/local_file.mjs';
import {view} from '../src/one_hwp/local_complex_records.mjs';
import {publishVerifiedPatch} from '../src/one_hwp/local_verified_patch.mjs';
import {invalidateSectionLayout} from '../src/one_hwp/local_layout_cache.mjs';

export const metricsProfiles=[
 {name:'narrow-latin',depth:3,narrow:true,lines:40},
 {name:'narrow-hangul',depth:3,narrow:true,padding:150,lines:28,kind:'hangul'},
 {name:'mixed-lines',depth:2,lines:45,mixed:'lines'},
 {name:'mixed-inline',depth:2,lines:32,mixed:'inline'},
 {name:'unicode-clusters',depth:2,lines:28,kind:'unicode'},
 {name:'narrow-unicode',depth:3,narrow:true,padding:150,lines:14,kind:'unicode'},
 {name:'mixed-unicode',depth:2,lines:24,kind:'unicode',mixed:'inline'},
 {name:'reopened-mixed-sync',depth:2,lines:32,mixed:'inline',sync:true},
];
export function metricsText({lines=20,kind}){return Array.from({length:lines},(_,i)=>`L${String(i).padStart(3,'0')}`+(kind==='hangul'?' 한글':kind==='unicode'?' cafe\u0301 각 한글 Αβ Жя':'')).join('\n');}
export function tableMetricsFixture(profile){
 const text=metricsText(profile);let bytes=tableReflowFixture({...profile,lines:1});
 const snapshot=()=>inspectLocalComplex(HwpDocument,bytes,{includeDocumentInfo:false});
 const edit=op=>{const s=snapshot(),b=s.blocks.find(b=>b.cell_path.length===profile.depth);bytes=editLocalComplex(HwpDocument,bytes,digest(bytes),{target_id:`hwp5:${digest(bytes)}:${Buffer.from(b.id).toString('base64url')}`,expected_old:b.text,...op}).bytes;};
 edit({type:'splice_text',start:0,end:4,new_text:text});
 if(profile.mixed){let start=0;for(const [i,line] of text.split('\n').entries()){const n=[...line].length;if(i<12)edit({type:'format_text',start,end:start+(profile.mixed==='inline'?2:n),props:{fontSize:i%2?800:1800,bold:i%2===0}});start+=n+1;}}
 if(profile.narrow){for(let i=0;i<profile.depth;i++){const s=snapshot(),other=s.blocks.find(b=>b.cell_path.length===i+1&&b.text.includes('inner answer'));if(other)bytes=editLocalComplex(HwpDocument,bytes,digest(bytes),{type:'replace_text',target_id:`hwp5:${digest(bytes)}:${Buffer.from(other.id).toString('base64url')}`,expected_old:other.text,new_text:'PEER'}).bytes;}}
 if(profile.padding!==undefined){const s=snapshot(),rs=s.recordSets.get(0).map(r=>({...r,payload:r.payload.slice()}));for(const c of s.tables.at(-1).cells){const p=view(rs[c.start].payload);p.setUint32(4,p.getUint32(4,true)|0x10000,true);p.setUint16(24,profile.padding,true);p.setUint16(26,profile.padding,true);}bytes=publishVerifiedPatch(bytes,s,0,invalidateSectionLayout(rs,s.blocks));}
 return {bytes,text};
}
