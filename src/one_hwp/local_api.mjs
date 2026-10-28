/** Local inspection acceleration backed by complete raw/model target mapping. */
import {createEngineApi} from './rhwp_api.mjs';
import {readHwp} from './guard/container.mjs';
import {GuardError} from './guard/records.mjs';
import {mapRawTargets} from './engine/document.mjs';
import {rawPlainStyleProofs} from './engine/plain-style.mjs';
export function localPlainStyleProofs(bytes,blocks){
 const raw=readHwp(bytes);let mapping;
 try{mapping=mapRawTargets(raw,blocks);}catch(error){if(error instanceof GuardError&&error.code==='TARGET_MAPPING_UNVERIFIED')return undefined;throw error;}
 return rawPlainStyleProofs(raw,blocks,mapping);
}
export const createLocalEngineApi=(HwpDocument,options={})=>createEngineApi(HwpDocument,{...options,plainStyleProofs:localPlainStyleProofs});
