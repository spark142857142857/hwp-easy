/** Pack independently proven local structural metadata repairs. No model edits. */
import {deflateRaw} from 'pako';
import {readCfb,replaceBodyStreamsWithMiniTailAdjustment} from '../guard/container.mjs';
import {GuardError} from '../guard/records.mjs';
const view=bytes=>new DataView(bytes.buffer,bytes.byteOffset,bytes.byteLength);
export function packStructuralBodyRepairs(candidate,afterRaw,patches) {
 const packed=readCfb(candidate),replacements=new Map();
 const compressed=view(afterRaw.streams.get('FileHeader')).getUint32(36,true)&1;
 for(const [name,body] of patches) {
  const original=afterRaw.streams.get(name);
  if(!name.startsWith('BodyText/Section')||!original||body.length!==original.length)throw new GuardError('BODY_REPAIR_INVALID');
  let bytes=compressed?deflateRaw(body):body;
  if(compressed) {
   const allocated=packed.get(name),unit=allocated.length<4096?64:2**view(candidate).getUint16(30,true);
   if((bytes.length>=4096)!==(allocated.length>=4096)
     ||Math.ceil(bytes.length/unit)!==Math.ceil(allocated.length/unit))bytes=deflateRaw(body,{level:9});
  }
  replacements.set(name,bytes);
 }
 return replaceBodyStreamsWithMiniTailAdjustment(candidate,replacements);
}
