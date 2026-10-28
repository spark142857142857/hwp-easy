/** Original language font slots and mixed character sizes, all synthetic. */
import {HwpDocument} from '@rhwp/core';
import {cellWrapRenderFixture,cellWrapBefore} from './local_cell_wrap_render_fixtures.mjs';
import {inspectLocalComplex,editLocalComplex} from '../src/one_hwp/local_complex.mjs';
import {view,encodeRecords} from '../src/one_hwp/local_complex_records.mjs';
import {parseRecords} from '../src/one_hwp/guard/records.mjs';
import {fontFaceRecord} from '../src/one_hwp/local_format.mjs';
import {publishVerifiedPatch} from '../src/one_hwp/local_verified_patch.mjs';
import {tableReflowContexts,reflowTableLocal} from '../src/one_hwp/local_table_reflow.mjs';
import {digest} from '../src/one_hwp/local_file.mjs';
const latin='ABCDEFGHIJKLMNOPQRSTUVWX',hangul='가나다라마바사아자차카타파하가나다라마바사';
export const sourceFontProfiles=[
 {name:'source-batang',rows:["ABCDEF","GHIJKL","MNOPQ","RSTUV","WX"],text:latin,formats:[]},
 {name:'mixed-latin',rows:["ABCDE","FGHIJ","KLMNOPQ","RSTUV","WX"],text:latin,formats:[{start:0,end:24,props:{fontSize:800}},{start:2,end:10,props:{fontSize:1400,bold:true}},{start:18,end:24,props:{fontSize:1000}}]},
 {name:'mixed-hangul',rows:["가나다라","마바","사아","자차","카타파","하가나다","라마바사"],text:hangul,formats:[{start:4,end:12,props:{fontSize:1400}},{start:16,end:21,props:{fontSize:800}}]},
 {name:'source-dotum',rows:["ABCDEF","GHIJK","LMNO","PQRSTU","VWX"],text:latin,formats:[{start:0,end:24,props:{fontFamily:'함초롬돋움'}},{start:6,end:14,props:{fontSize:1400,bold:true}}]},
 {name:'language-slots',rows:["ABCDE","가나다","라마","FGHIJ","KLM바","사"],text:'ABCDE가나다라마FGHIJKLM바사',englishArial:true,formats:[{start:7,end:14,props:{fontSize:1400}}]},
 {name:'mixed-explicit',rows:["A","B","C"],text:'A\nB\nC',formats:[{start:0,end:5,props:{fontSize:800}},{start:0,end:1,props:{fontSize:1800}}]},
 {name:'mixed-middle',rows:["ABCD","EFGH","IJKLMN","OPQRS","TUVWX"],text:latin,alignment:1,ancestorAlignment:1,formats:[{start:2,end:10,props:{fontSize:1400,bold:true}}]},
 {name:'deep-mixed-bottom',rows:["가나다","라마","바사","아자","차카","타파","하가나","다라마","바사"],text:hangul,depth:3,alignment:2,ancestorAlignment:2,formats:[{start:4,end:12,props:{fontSize:1400}},{start:16,end:21,props:{fontSize:800}}]}
];
export function sourceFontFixture(profile,after=false){
 let bytes=cellWrapRenderFixture({...profile,room:16000});
 if(profile.englishArial){const s=inspectLocalComplex(HwpDocument,bytes,{includeDocumentInfo:false}),defs=[...parseRecords(s.raw.streams.get('DocInfo'))].map(r=>({...r,payload:r.payload.slice()})),map=defs.find(r=>r.tag===17),fonts=defs.filter(r=>r.tag===19);fonts[view(map.payload).getUint32(4,true)+1].payload=fontFaceRecord('Arial');bytes=publishVerifiedPatch(bytes,s,0,s.recordSets.get(0),encodeRecords(defs));}
 if(!after)return bytes;
 for(const op of [{type:'splice_text',start:0,end:cellWrapBefore.length,new_text:profile.text},...profile.formats.map(f=>({type:'format_text',...f}))]){
  const s=inspectLocalComplex(HwpDocument,bytes,{includeDocumentInfo:false}),b=s.blocks.find(b=>b.text===(op.type==='splice_text'?cellWrapBefore:profile.text)),h=digest(bytes);bytes=editLocalComplex(HwpDocument,bytes,h,{...op,target_id:`hwp5:${h}:${Buffer.from(b.id).toString('base64url')}`,expected_old:b.text}).bytes;
 }
 const s=inspectLocalComplex(HwpDocument,bytes,{includeDocumentInfo:false}),h=digest(bytes),c=tableReflowContexts(s,h)[0];return reflowTableLocal(HwpDocument,bytes,h,{type:'reflow_table',...Object.fromEntries(['target_id','expected_old','expected_tables'].map(k=>[k,c[k]]))}).bytes;
}
