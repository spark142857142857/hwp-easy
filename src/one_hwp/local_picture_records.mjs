/** Selected paragraph/object rewrites; all other raw records remain exact. */
import {GuardError,parseRecords} from '../../probes/sites-runtime/guard/records.mjs';
import {packLocalBodyRewrite} from '../../probes/sites-runtime/engine/structural-body-repair.mjs';
const fail=code=>{throw new GuardError(code);},view=b=>new DataView(b.buffer,b.byteOffset,b.byteLength);
export const pictureAnchor=Uint8Array.from([11,0,32,111,115,103,0,0,0,0,0,0,0,0,11,0]);
export function anchors(text){const list=[];let visible=0;for(let p=0;p<text.length;p+=2){const code=view(text).getUint16(p,true);if(code===11){if(p+16>text.length||!pictureAnchor.every((n,i)=>text[p+i]===n))fail('PICTURE_ANCHOR_PROFILE_UNSUPPORTED');list.push({raw:p/2,visible});p+=14;}else if(code>=32||code===9||code===10)visible++;else if(code!==13)fail('PICTURE_ANCHOR_PROFILE_UNSUPPORTED');}return list;}
export function objectGroups(records){const objects=records.filter(r=>[71,76,85].includes(r.tag));if(objects.length%3)fail('PICTURE_PROFILE_UNSUPPORTED');return Array.from({length:objects.length/3},(_,i)=>objects.slice(i*3,i*3+3));}
function encode(records){const parts=records.map(r=>{const wide=r.payload.length>=4095,b=new Uint8Array((wide?8:4)+r.payload.length);view(b).setUint32(0,r.tag|(r.level<<10)|((wide?4095:r.payload.length)<<20),true);if(wide)view(b).setUint32(4,r.payload.length,true);b.set(r.payload,wide?8:4);return b;});const b=new Uint8Array(parts.reduce((n,p)=>n+p.length,0));let offset=0;for(const p of parts){b.set(p,offset);offset+=p.length;}return b;}
export function rewritePictureBlock(candidate,candidateRaw,sourceRaw,sourceRecords,block,groups,change){
 const original=sourceRecords.get(block.id),base=original.filter(r=>![71,76,85].includes(r.tag)).map(r=>({...r,payload:r.payload.slice()}));
 let text=base.find(r=>r.tag===67);if(!text){text={tag:67,level:block.kind==='cell'?3:1,payload:new Uint8Array([13,0])};base.splice(1,0,text);}
 if(change){const byte=change.raw*2,delta=change.insert?8:-8,old=text.payload,output=new Uint8Array(old.length+delta*2);output.set(old.subarray(0,byte));if(change.insert){output.set(pictureAnchor,byte);output.set(old.subarray(byte),byte+16);}else output.set(old.subarray(byte+16),byte);text.payload=output;
  const shapes=base.find(r=>r.tag===68);if(!shapes||shapes.payload.length%8)fail('PICTURE_ANCHOR_PROFILE_UNSUPPORTED');for(let p=0;p<shapes.payload.length;p+=8){const pos=view(shapes.payload).getUint32(p,true);if(pos>change.raw){if(!change.insert&&pos<change.raw+8)fail('PICTURE_ANCHOR_PROFILE_UNSUPPORTED');view(shapes.payload).setUint32(p,pos+delta,true);}}
 }
 const header=base.find(r=>r.tag===66),v=view(header.payload);v.setUint32(0,(v.getUint32(0,true)&0x80000000)|text.payload.length/2,true);v.setUint32(4,groups.length?1<<11:0,true);
 // A LIST_HEADER for the next cell can be attached to this block by the raw
 // mapping. Keep it after the selected paragraph's controls.
 const index=base.findIndex(r=>r.tag===72);base.splice(index<0?base.length:index,0,...groups.flat());
 const name=`BodyText/Section${block.section}`,all=[...parseRecords(sourceRaw.streams.get(name))],first=all.findIndex(r=>r.payload.byteOffset===original[0].payload.byteOffset),last=first+original.length;
 if(first<0||last>all.length)fail('TARGET_MAPPING_UNVERIFIED');const body=encode([...all.slice(0,first),...base,...all.slice(last)]);
 return packLocalBodyRewrite(candidate,candidateRaw,new Map([[name,body]]));
}
export function changedPictureProperties(group,prior,props){
 const result=group.map(r=>({...r,payload:r.payload.slice()})),h=view(result[0].payload),s=view(result[1].payload),p=view(result[2].payload),wanted={...prior,...props};
 if(Object.hasOwn(props,'rotationAngle')||prior.rotationAngle%360!==0&&('width' in props||'height' in props))if([20,24,28,32].some(offset=>s.getUint32(offset,true)<=0||s.getUint32(offset,true)>720000))fail('PICTURE_GEOMETRY_UNSUPPORTED');
 for(const [key,offset] of [['vertOffset',8],['horzOffset',12],['width',16],['height',20]])if(Object.hasOwn(props,key))h.setInt32(offset,props[key],true);
 for(const [key,offset] of [['width',28],['height',32]])if(Object.hasOwn(props,key)){let value=props[key];if(prior.rotationAngle%360!==0)value=Math.max(1,Math.round(s.getUint32(offset,true)*value/prior[key]));s.setUint32(offset,value,true);}
 if(Object.hasOwn(props,'rotationAngle')){const w=s.getUint32(28,true),height=s.getUint32(32,true),theta=props.rotationAngle*Math.PI/180,c=Math.abs(Math.cos(theta)),sin=Math.abs(Math.sin(theta)),width=Math.max(1,Math.round(w*c+height*sin)),newHeight=Math.max(1,Math.round(w*sin+height*c));
  const x=h.getInt32(12,true)+Math.floor(h.getUint32(16,true)/2),y=h.getInt32(8,true)+Math.floor(h.getUint32(20,true)/2);h.setUint32(16,width,true);h.setUint32(20,newHeight,true);h.setInt32(12,x-Math.floor(width/2),true);h.setInt32(8,y-Math.floor(newHeight/2),true);s.setInt16(40,props.rotationAngle,true);s.setInt32(42,Math.floor(width/2),true);s.setInt32(46,Math.floor(newHeight/2),true);
  Object.assign(wanted,{width,height:newHeight,horzOffset:h.getInt32(12,true),vertOffset:h.getInt32(8,true)});
 }
 if(Object.hasOwn(props,'rotationAngle')||prior.rotationAngle%360!==0&&('width' in props||'height' in props)){
  // Pinned RHWP serializer's ungrouped translation, scale and rotation set.
  const angle=s.getInt16(40,true),theta=angle*Math.PI/180,c=Math.cos(theta),sin=Math.sin(theta),w=s.getUint32(28,true),height=s.getUint32(32,true),x=s.getInt32(8,true),y=s.getInt32(12,true),tx=-Math.min(0,w*c,-height*sin,w*c-height*sin),ty=-Math.min(0,w*sin,height*c,w*sin+height*c);
  const identity=[1,0,0,0,1,0],matrices=angle%360===0?[identity,identity,identity]:[[1,0,x,0,1,y],[w/s.getUint32(20,true),0,0,0,height/s.getUint32(24,true),0],[c,-sin,tx-x,sin,c,ty-y]];
  s.setUint16(50,1,true);matrices.flat().forEach((n,i)=>s.setFloat64(52+i*8,n,true));
 }
 if(['cropLeft','cropTop','cropRight','cropBottom'].some(k=>Object.hasOwn(props,k))){if(wanted.cropLeft+wanted.cropRight>=prior.sourceWidth||wanted.cropTop+wanted.cropBottom>=prior.sourceHeight)fail('INVALID_PICTURE_CROP');p.setInt32(44,wanted.cropLeft,true);p.setInt32(48,wanted.cropTop,true);p.setInt32(52,prior.sourceWidth-wanted.cropRight,true);p.setInt32(56,prior.sourceHeight-wanted.cropBottom,true);}
 return {records:result,properties:wanted};
}
