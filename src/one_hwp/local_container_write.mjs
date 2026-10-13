/** Rebuild local CFB allocations with exact packed-stream preservation proofs. */
import CFB from '../../probes/sites-runtime/node_modules/cfb/cfb.js';
import {readCfb} from '../../probes/sites-runtime/guard/container.mjs';
import {GuardError} from '../../probes/sites-runtime/guard/records.mjs';
const fail=code=>{throw new GuardError(code);},equalBytes=(a,b)=>a.length===b.length&&a.every((v,i)=>v===b[i]);

function placeholder(tree){const magic='\u0001Sh33tJ5';if(!CFB.find(tree,'/'+magic)){tree.FullPaths.push(tree.FullPaths[0]+magic);tree.FileIndex.push({name:magic,type:0});}}
function writeContainer(tree){
 // cfb 1.2.2 resets stream starts during directory reconstruction but skips
 // zero-length streams during allocation. They must use ENDOFCHAIN, not 0.
 placeholder(tree);CFB.utils.cfb_gc(tree);
 for(const entry of tree.FileIndex)if(entry.type===2&&entry.size===0)entry.start=-2;
 // A vacant placeholder prevents the library's private marker from becoming
 // a new document stream. This final, valid tree needs no further rebuilding.
 placeholder(tree);return new Uint8Array(CFB.write(tree,{type:'buffer',fileType:'cfb'}));
}

export function patchLocalPackedStreams(source,changes){
 const before=readCfb(source),tree=CFB.read(Buffer.from(source),{type:'buffer'});
 // Add requested streams before reserving the writer's marker name. An
 // input may legitimately contain that exact name; its bytes must survive.
 for(const [name,payload]of changes){
  const entry=CFB.find(tree,'/'+name);if(entry){if(entry.type!==2)fail('LOCAL_CONTAINER_PRESERVATION_MISMATCH');entry.content=Buffer.from(payload);entry.size=payload.length;}
  else CFB.utils.cfb_add(tree,name,Buffer.from(payload),{unsafe:true});
 }
 const bytes=writeContainer(tree);if(bytes.length>4194304)fail('OUTPUT_LIMIT_EXCEEDED');
 const after=readCfb(bytes),expected=new Set([...before.keys(),...changes.keys()]);
 if(after.size!==expected.size||[...after.keys()].some(n=>!expected.has(n)))fail('LOCAL_CONTAINER_PRESERVATION_MISMATCH');
 for(const [name,payload]of after)if(!equalBytes(payload,changes.get(name)??before.get(name)))fail('LOCAL_CONTAINER_PRESERVATION_MISMATCH');
 return bytes;
}

export function createLocalDocumentClass(HwpDocument){
 return class extends HwpDocument{
  constructor(bytes){super(bytes);this.localSource=bytes instanceof Uint8Array?bytes.slice():undefined;}
  exportHwpWithReport(){
   const report=super.exportHwpWithReport(),source=this.localSource;
   return {contentLoss:()=>report.contentLoss(),free:()=>report.free(),takeBytes:()=>{
    const candidate=new Uint8Array(report.takeBytes());if(!source)return candidate;
    const original=readCfb(source),current=readCfb(candidate),retained=new Map();
    // No local operation modifies scripts, document options, summary metadata
    // or old binary payloads. Preserve these even when the upstream serializer
    // cannot carry them through a different CFB allocation layout.
    for(const [name,payload]of original)if(!['FileHeader','DocInfo'].includes(name)&&!name.startsWith('BodyText/')&&(!current.has(name)||!equalBytes(payload,current.get(name))))retained.set(name,payload);
    return retained.size?patchLocalPackedStreams(candidate,retained):candidate;
   }};
  }
 };
}
