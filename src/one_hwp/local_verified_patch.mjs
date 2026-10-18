/** Publish exact raw changes and independently reread every resulting stream. */
import {deflateRawSync} from 'node:zlib';
import {readHwp} from '../../probes/sites-runtime/guard/container.mjs';
import {patchLocalPackedStreams} from './local_container_write.mjs';
import {encodeRecords,equalBytes,view,fail} from './local_complex_records.mjs';
export function publishVerifiedPatch(source,state,section,records,docInfo=state.raw.streams.get('DocInfo')){
 return publishVerifiedSections(source,state,new Map([[section,records]]),docInfo);
}
export function publishVerifiedSections(source,state,recordSets,docInfo=state.raw.streams.get('DocInfo')){
 const expected=new Map([...recordSets].map(([section,records])=>[`BodyText/Section${section}`,encodeRecords(records)]));expected.set('DocInfo',docInfo);const compressed=Boolean(view(state.raw.streams.get('FileHeader')).getUint32(36,true)&1),changes=new Map();
 for(const key of expected.keys())if(!state.raw.streams.has(key))fail('PATCH_PRESERVATION_MISMATCH');
 for(const [key,wanted] of expected)if(!equalBytes(wanted,state.raw.streams.get(key)))changes.set(key,compressed?deflateRawSync(wanted,{level:9}):wanted);
 if(!changes.size)return source;const bytes=patchLocalPackedStreams(source,changes),after=readHwp(bytes);
 if(after.streams.size!==state.raw.streams.size)fail('PATCH_PRESERVATION_MISMATCH');for(const [key,old] of state.raw.streams)if(!equalBytes(after.streams.get(key),expected.get(key)??old))fail('PATCH_PRESERVATION_MISMATCH');return bytes;
}
