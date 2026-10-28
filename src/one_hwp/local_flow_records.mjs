/** HWP5 common-object flags, table 70 of Hancom revision 1.2. */
import {view,fail} from './local_complex_records.mjs';
import {parseRecords} from './guard/records.mjs';
export function nextObjectInstanceId(raw){
 const ids=new Set();for(const [name,bytes] of raw.streams){if(!/^BodyText\/Section\d+$/.test(name))continue;for(const r of parseRecords(bytes))if(r.tag===71&&r.payload.length>=40&&[' osg',' lbt'].includes(Buffer.from(r.payload.subarray(0,4)).toString()))ids.add(view(r.payload).getUint32(36,true));}
 let instance=1;while(ids.has(instance))instance++;if(instance>0xffffffff)fail('PICTURE_INSTANCE_LIMIT');return instance;
}
export const validObjectHeader=payload=>payload.length>=46&&payload.length===46+2*view(payload).getUint16(44,true);
export function objectFlow(record){
 if(record.payload.length<44)fail('OBJECT_FLOW_PROFILE_UNSUPPORTED');const p=view(record.payload),f=p.getUint32(4,true);
 return {treatAsChar:Boolean(f&1),affectLineSpacing:Boolean(f&4),vertRelTo:(f>>>3)&3,vertAlign:(f>>>5)&7,horzRelTo:(f>>>8)&3,horzAlign:(f>>>10)&7,restrictInPage:Boolean(f&8192),allowOverlap:Boolean(f&16384),widthRelTo:(f>>>15)&7,heightRelTo:(f>>>18)&3,textWrap:(f>>>21)&7,textFlow:(f>>>24)&3,marginLeft:p.getUint16(28,true),marginRight:p.getUint16(30,true),marginTop:p.getUint16(32,true),marginBottom:p.getUint16(34,true)};
}
