/** Local allocation fallback, preserving every packed non-body stream exactly. */
import {deflateRawSync} from 'node:zlib';
import {packLocalBodyRewrite as boundedRewrite} from '../../probes/sites-runtime/engine/structural-body-repair.mjs';
import {patchLocalPackedStreams} from './local_container_write.mjs';
export function packLocalBodyRewrite(source,raw,bodies){
 try{return boundedRewrite(source,raw,bodies);}
 catch(error){
  if(error.code!=='BODY_REPAIR_ALLOCATION_UNSUPPORTED')throw error;
  const header=raw.streams.get('FileHeader'),compressed=new DataView(header.buffer,header.byteOffset,header.length).getUint32(36,true)&1;
  return patchLocalPackedStreams(source,new Map([...bodies].map(([name,body])=>[name,compressed?deflateRawSync(body,{level:9}):body])));
 }
}
