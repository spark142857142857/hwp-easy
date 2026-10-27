/** Synthetic narrow leaves; source fonts, text and padding remain authored. */
import {HwpDocument} from '@rhwp/core';
import {nestedRenderFixture} from './local_nested_render_fixtures.mjs';
import {inspectLocalComplex,editLocalComplex} from '../src/one_hwp/local_complex.mjs';
import {view} from '../src/one_hwp/local_complex_records.mjs';
import {publishVerifiedPatch} from '../src/one_hwp/local_verified_patch.mjs';
import {digest} from '../src/one_hwp/local_file.mjs';
export const cellWrapRenderProfiles=[
 {name:'hangul-top',text:'가나다라마바사아자차카타파하가나다라마바사',rows:['가나다라','마바사아','자차카타','파하가나','다라마바','사'],alignment:0},
 {name:'latin-middle',text:'ABCDEFGHIJKLMNOPQRSTUVWX',rows:['ABCDEF','GHIJKL','MNOPQ','RSTUV','WX'],alignment:1},
 {name:'words-bottom',text:'L000 one two three four five six seven eight',rows:['L000 ','one two ','three ','four ','five six ','seven ','eight'],alignment:2},
 {name:'hangul-deep',depth:3,text:'가나다라마바사아자차카타파하가나다라마바사',rows:['가나다','라마바','사아자','차카타','파하가','나다라','마바사'],alignment:0},
 {name:'latin-explicit-break',text:'ABCDEFGHIJKL\nMNOPQRSTUVWX',rows:['ABCDEF','GHIJKL','MNOPQ','RSTUV','WX'],alignment:0},
 {name:'words-middle',text:'L000 one two three four five six seven eight',rows:['L000 ','one two ','three ','four ','five six ','seven ','eight'],alignment:1}
];
export const cellWrapBefore='L000\nL001\nL002';
export function cellWrapRenderFixture(profile,after=false){
 let bytes=nestedRenderFixture({depth:profile.depth??2,alignment:0,lines:3,room:10000});
 // Isolate leaf wrapping from the separate single-paragraph ancestor
 // alignment difference. Ancestors stay top; only the leaf is aligned.
 if(profile.alignment){const s=inspectLocalComplex(HwpDocument,bytes,{includeDocumentInfo:false,verifyCharacterModel:false}),rs=s.recordSets.get(0).map(r=>({...r,payload:r.payload.slice()})),leaf=s.tables.at(-1);for(const c of leaf.cells){const q=view(rs[c.start].payload);q.setUint32(4,(q.getUint32(4,true)&~96)|(profile.alignment<<5),true);}bytes=publishVerifiedPatch(bytes,s,0,rs);}
 if(!after)return bytes;
 const s=inspectLocalComplex(HwpDocument,bytes,{includeDocumentInfo:false,verifyCharacterModel:false}),b=s.blocks.find(b=>b.text===cellWrapBefore),hash=digest(bytes);
 return editLocalComplex(HwpDocument,bytes,hash,{type:'splice_text',target_id:`hwp5:${hash}:${Buffer.from(b.id).toString('base64url')}`,expected_old:b.text,start:0,end:b.text.length,new_text:profile.text}).bytes;
}
