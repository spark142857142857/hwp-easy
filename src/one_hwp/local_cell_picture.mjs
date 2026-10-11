/** Move only a newly inserted floating picture into the explicitly selected cell. */
import {GuardError,parseRecords} from '../../probes/sites-runtime/guard/records.mjs';
import {packLocalBodyRewrite} from '../../probes/sites-runtime/engine/structural-body-repair.mjs';
const fail=code=>{throw new GuardError(code);},view=b=>new DataView(b.buffer,b.byteOffset,b.byteLength);
function encode(records){const parts=records.map(r=>{const wide=r.payload.length>=4095,b=new Uint8Array((wide?8:4)+r.payload.length);view(b).setUint32(0,r.tag|(r.level<<10)|((wide?4095:r.payload.length)<<20),true);if(wide)view(b).setUint32(4,r.payload.length,true);b.set(r.payload,wide?8:4);return b;});const b=new Uint8Array(parts.reduce((n,p)=>n+p.length,0));let offset=0;for(const p of parts){b.set(p,offset);offset+=p.length;}return b;}
export const cellPicturePath=b=>JSON.stringify([{controlIndex:b.control,cellIndex:b.cell,cellParaIndex:b.cell_paragraph}]);
export function relocateCellPicture(candidate,raw,beforeRecords,block,offset){
 const name=`BodyText/Section${block.section}`,records=[...parseRecords(raw.streams.get(name))],anchor=Uint8Array.from([11,0,32,111,115,103,0,0,0,0,0,0,0,0,11,0]);
 let host=-1,cell=-1,paragraph=-1,selected=[],hostIndices=[],objectStart=-1;
 for(let i=0;i<records.length;i++){const r=records[i];if(r.tag===66&&r.level===0){host++;cell=-1;paragraph=-1;}
  if(host!==block.paragraph)continue;if(r.tag===72&&r.level===2){cell++;paragraph=-1;}
  if(r.tag===66&&r.level===2)paragraph++;
  if(r.tag===71&&r.level===1&&Buffer.from(r.payload.subarray(0,4)).toString('ascii')===' osg'){if(objectStart>=0)fail('PICTURE_ANCHOR_PROFILE_UNSUPPORTED');objectStart=i;}
  if(cell===block.cell&&paragraph===block.cell_paragraph&&[66,67,68,69].includes(r.tag)&&r.level===(r.tag===66?2:3))selected.push(i);
  if(cell===-1&&[66,67,68].includes(r.tag)&&r.level===(r.tag===66?0:1))hostIndices.push(i);
 }
 const objects=records.slice(objectStart,objectStart+3);if(objectStart<0||objects.some((r,i)=>r.tag!==[71,76,85][i]||r.level!==i+1))fail('PICTURE_RECORD_MISMATCH');
 const oldHost=beforeRecords.get(`s${block.section}:p${block.paragraph}`),oldCell=beforeRecords.get(block.id),targetHeader=records[selected.find(i=>records[i].tag===66)];
 if(!targetHeader||oldCell.some(r=>![66,67,68,69,72].includes(r.tag)))fail('PICTURE_ANCHOR_PROFILE_UNSUPPORTED');
 const oldText=oldCell.find(r=>r.tag===67)?.payload??new Uint8Array([13,0]),point=[...block.text].slice(0,offset).join('').length,byte=point*2;
 const text=new Uint8Array(oldText.length+16);text.set(oldText.subarray(0,byte));text.set(anchor,byte);text.set(oldText.subarray(byte),byte+16);
 const replacement=new Map();for(const i of hostIndices){const old=oldHost.find(r=>r.tag===records[i].tag);if(!old)fail('PICTURE_ANCHOR_PROFILE_UNSUPPORTED');replacement.set(i,{...records[i],payload:old.payload.slice()});}
 const cellRecords=selected.map(i=>({...records[i],payload:records[i].payload.slice()}));const header=cellRecords.find(r=>r.tag===66);view(header.payload).setUint32(0,(view(header.payload).getUint32(0,true)&0x80000000)|(text.length/2),true);view(header.payload).setUint32(4,view(header.payload).getUint32(4,true)|(1<<11),true);
 let paraText=cellRecords.find(r=>r.tag===67);if(!paraText){paraText={tag:67,level:3,payload:text};cellRecords.splice(1,0,paraText);}else paraText.payload=text;
 const shapes=cellRecords.find(r=>r.tag===68);if(!shapes||shapes.payload.length%8)fail('PICTURE_ANCHOR_PROFILE_UNSUPPORTED');for(let i=0;i<shapes.payload.length;i+=8){const pos=view(shapes.payload).getUint32(i,true);if(pos>point)view(shapes.payload).setUint32(i,pos+8,true);}
 // Use cell-relative inline geometry. It moves with the cell instead of being
 // a page-relative sibling of the table. Size and binary identity stay exact.
 const moved=objects.map(r=>({...r,level:r.level+2,payload:r.payload.slice()})),v=view(moved[0].payload);v.setUint32(4,0x000a0001,true);v.setInt32(8,0,true);v.setInt32(12,0,true);
 const drop=new Set([...selected,objectStart,objectStart+1,objectStart+2]),output=[];
 for(let i=0;i<records.length;i++){if(i===selected[0])output.push(...cellRecords,...moved);if(!drop.has(i))output.push(replacement.get(i)??records[i]);}
 return packLocalBodyRewrite(candidate,raw,new Map([[name,encode(output)]]));
}
