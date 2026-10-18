/** Synthetic cross-container transfers; no user documents. */
import {HwpDocument} from '@rhwp/core';
import {deflateRawSync} from 'node:zlib';
import {nestedFloatingFixture} from './local_nested_floating_fixtures.mjs';
import {placementFixture} from './local_placement_fixtures.mjs';
import {floatingAreaFixture} from './local_floating_fixtures.mjs';
import {fixture} from './rhwp_fixtures.mjs';
import {inspectLocalComplex} from '../src/one_hwp/local_complex.mjs';
import {reanchorFloating} from '../src/one_hwp/local_floating_anchor.mjs';
import {publishVerifiedSections} from '../src/one_hwp/local_verified_patch.mjs';
import {patchLocalPackedStreams} from '../src/one_hwp/local_container_write.mjs';
import {readHwp} from '../probes/sites-runtime/guard/container.mjs';
import {parseRecords} from '../probes/sites-runtime/guard/records.mjs';
import {view,encodeRecords,spliceRawParagraph} from '../src/one_hwp/local_complex_records.mjs';

export function transferFixture({bodySource=false,sections=false,ordinary=false,cachedBodySource=false,emptyDestination=false,destination='nested'}={}){
 let bytes=cachedBodySource?placementFixture({box:true,boxWidth:3000,boxOffset:10000}):ordinary?floatingAreaFixture({cell:true}):nestedFloatingFixture();
 if(cachedBodySource){const state=inspectLocalComplex(HwpDocument,bytes,{includeDocumentInfo:false,verifyCharacterModel:false}),p=state.text_boxes[0].paragraphs[0],rs=spliceRawParagraph(state.recordSets.get(0),p,0,[...p.text].length,'BOX').records;bytes=publishVerifiedSections(bytes,state,new Map([[0,rs]]));}
 if(bodySource){const s=inspectLocalComplex(HwpDocument,bytes,{includeDocumentInfo:false,verifyCharacterModel:false}),box=s.text_boxes[0],b=s.blocks.find(b=>b.id===box.block_id),destination=s.blocks.filter(b=>!b.cell_path.length).at(-1),a=reanchorFloating(s,{b,selected:box},destination);bytes=publishVerifiedSections(bytes,s,a.recordSets);}
 if(sections){const raw=readHwp(bytes),docInfo=[...parseRecords(raw.streams.get('DocInfo'))].map(r=>({...r,payload:r.payload.slice()}));view(docInfo.find(r=>r.tag===16).payload).setUint16(0,2,true);const body=readHwp(fixture({table:false,paragraphs:['SECOND SECTION DESTINATION','SECOND TAIL']})).streams.get('BodyText/Section0');bytes=patchLocalPackedStreams(bytes,new Map([['DocInfo',deflateRawSync(encodeRecords(docInfo),{level:9})],['BodyText/Section1',deflateRawSync(body,{level:9})]]));}
 if(emptyDestination){let state=inspectLocalComplex(HwpDocument,bytes,{includeDocumentInfo:false,verifyCharacterModel:false}),b=transferDestination(state,{destination,emptyDestination}),rs=spliceRawParagraph(state.recordSets.get(b.section),b,0,[...b.text].length,'').records;bytes=publishVerifiedSections(bytes,state,new Map([[b.section,rs]]));state=inspectLocalComplex(HwpDocument,bytes,{includeDocumentInfo:false,verifyCharacterModel:false});b=transferDestination(state,{destination,emptyDestination});rs=state.recordSets.get(b.section).filter((r,i)=>i!==b.text_record);bytes=publishVerifiedSections(bytes,state,new Map([[b.section,rs]]));}
 return bytes;
}
export const transferProfiles=[
 {name:'nested-sibling',destination:'nested'},
 {name:'nested-ordinary',destination:'ordinary'},
 {name:'nested-body',destination:'body'},
 {name:'body-nested',bodySource:true,destination:'nested'},
 {name:'ordinary-sibling',ordinary:true,destination:'ordinary'},
 {name:'section-body',bodySource:true,sections:true,destination:'section'},
 {name:'nested-section',sections:true,destination:'section'},
 {name:'nested-empty',emptyDestination:true,destination:'nested'},
 {name:'section-empty',bodySource:true,sections:true,emptyDestination:true,destination:'section'},
 {name:'cached-section',cachedBodySource:true,sections:true,destination:'section'}
];
export function transferDestination(s,profile){return profile.destination==='section'?(profile.emptyDestination?s.blocks.filter(b=>b.section===1).at(-1):s.blocks.find(b=>b.section===1)):profile.destination==='body'?s.blocks.filter(b=>!b.cell_path.length).at(-1):s.blocks.find(b=>b.cell_path.length===(profile.destination==='nested'?2:1)&&b.cell_path.at(-1).cellIndex===1);}
