import test from 'node:test';
import assert from 'node:assert/strict';
import {readCfb,replaceBodyStreamsWithMiniTailAdjustment,replaceLocalBodyWithMiniRootGrowth} from '../../../src/one_hwp/guard/container.mjs';
const FREE=0xffffffff,END=0xfffffffe,FAT=0xfffffffd;
// Independent, fixed synthetic CFB fixtures: no HWP engine or private files.
function fixture(major,units) {
  const size=major===3?512:4096,keep=[];
  for(let left=units-1;left>0;left-=Math.min(left,63))keep.push(Math.min(left,63));
  const count=3+keep.length,dirs=Math.ceil(count*128/size),miniCount=Math.ceil(units*4/size),rootCount=Math.ceil(units*64/size);
  const miniStart=1+dirs,rootStart=miniStart+miniCount,sectors=rootStart+rootCount;
  const bytes=new Uint8Array((sectors+1)*size),v=new DataView(bytes.buffer),u16=(p,n)=>v.setUint16(p,n,true),u32=(p,n)=>v.setUint32(p,n,true),fat=sid=>size+sid*4;
  bytes.set([208,207,17,224,161,177,26,225]);u16(24,0x3e);u16(26,major);u16(28,0xfffe);u16(30,major===3?9:12);u16(32,6);
  u32(40,major===4?dirs:0);u32(44,1);u32(48,1);u32(56,4096);u32(60,miniStart);u32(64,miniCount);u32(68,END);
  for(let p=76;p<512;p+=4)u32(p,FREE);u32(76,0);
  bytes.fill(255,size,2*size);u32(fat(0),FAT);
  for(const [start,length] of [[1,dirs],[miniStart,miniCount],[rootStart,rootCount]])for(let n=0;n<length;n++)u32(fat(start+n),n+1<length?start+n+1:END);
  bytes.fill(255,(miniStart+1)*size,(miniStart+miniCount+1)*size);
  const mini=id=>(miniStart+1)*size+id*4,location=id=>(rootStart+1)*size+id*64;
  function entry(index,name,type,first,length,{right=FREE,child=FREE}={}){const p=2*size+index*128;for(let n=0;n<name.length;n++)u16(p+2*n,name.charCodeAt(n));u16(p+64,2*(name.length+1));bytes[p+66]=type;bytes[p+67]=1;u32(p+68,FREE);u32(p+72,right);u32(p+76,child);u32(p+116,first);u32(p+120,length);return p;}
  const rootEntry=entry(0,'Root Entry',5,rootStart,units*64,{child:1});entry(1,'BodyText',1,END,0,{child:2,right:keep.length?3:FREE});const bodyEntry=entry(2,'Section0',2,0,64);u32(mini(0),END);bytes.fill(11,location(0),location(0)+64);
  let id=1;keep.forEach((length,n)=>{entry(3+n,`Keep${n}`,2,id,length*64,{right:n+1<keep.length?4+n:FREE});for(let j=0;j<length;j++){u32(mini(id+j),j+1<length?id+j+1:END);bytes.fill(20+n,location(id+j),location(id+j)+64);}id+=length;});
  return {bytes,v,size,sectors,fat,mini,rootEntry,bodyEntry,location};
}
for(const major of [3,4])for(const fullMiniFat of [false,true])test(`local BodyText extends full root, CFB v${major}, miniFAT full=${fullMiniFat}`,()=>{
  const size=major===3?512:4096,source=fixture(major,fullMiniFat?size/4:size/64),before=source.bytes.slice(),streams=readCfb(before),replacement=new Uint8Array(65).fill(77),replacements=new Map([['BodyText/Section0',replacement]]);
  assert.throws(()=>replaceBodyStreamsWithMiniTailAdjustment(before,replacements),/BODY_REPAIR_ALLOCATION_UNSUPPORTED/);
  const result=replaceLocalBodyWithMiniRootGrowth(before,replacements),actual=readCfb(result.bytes);
  assert.equal(result.local_root_sector_growth,1);assert.equal(result.local_minifat_sector_growth,Number(fullMiniFat));assert.equal(result.body_mini_sector_growth,1);assert.equal(result.bytes.length,before.length+size*(1+Number(fullMiniFat)));
  for(const [name,content] of streams)assert.deepEqual(actual.get(name),replacements.get(name)??content);assert.deepEqual(source.bytes,before);
});
test('local mini-root growth refuses occupied FAT/miniFAT entries and broader allocation changes without mutation',()=>{
  const changes=[s=>s.v.setUint32(s.fat(s.sectors),END,true),s=>s.v.setUint32(s.mini(8),END,true),s=>s.v.setUint32(s.rootEntry+124,1,true),s=>s.v.setUint32(s.bodyEntry+124,1,true)];
  for(const change of changes){const s=fixture(3,8);change(s);const before=s.bytes.slice();assert.throws(()=>replaceLocalBodyWithMiniRootGrowth(s.bytes,new Map([['BodyText/Section0',new Uint8Array(65)]])),/BODY_REPAIR_ALLOCATION_UNSUPPORTED/);assert.deepEqual(s.bytes,before);}
  for(const length of [129,4096]){const source=fixture(3,8),copy=source.bytes.slice();assert.throws(()=>replaceLocalBodyWithMiniRootGrowth(source.bytes,new Map([['BodyText/Section0',new Uint8Array(length)]])),/BODY_REPAIR_ALLOCATION_UNSUPPORTED/);assert.deepEqual(source.bytes,copy);}
  const source=fixture(3,8);assert.throws(()=>replaceLocalBodyWithMiniRootGrowth(source.bytes,new Map([['BodyText/Section0',new Uint8Array(65)],['BodyText/Section1',new Uint8Array(65)]])),/BODY_REPAIR_ALLOCATION_UNSUPPORTED/);
});
