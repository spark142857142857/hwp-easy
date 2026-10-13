/** HWP5 common-object flags, table 70 of Hancom revision 1.2. */
import {view,fail} from './local_complex_records.mjs';
export const validObjectHeader=payload=>payload.length>=46&&payload.length===46+2*view(payload).getUint16(44,true);
export function objectFlow(record){
 if(record.payload.length<44)fail('OBJECT_FLOW_PROFILE_UNSUPPORTED');const p=view(record.payload),f=p.getUint32(4,true);
 return {treatAsChar:Boolean(f&1),affectLineSpacing:Boolean(f&4),vertRelTo:(f>>>3)&3,vertAlign:(f>>>5)&7,horzRelTo:(f>>>8)&3,horzAlign:(f>>>10)&7,restrictInPage:Boolean(f&8192),allowOverlap:Boolean(f&16384),widthRelTo:(f>>>15)&7,heightRelTo:(f>>>18)&3,textWrap:(f>>>21)&7,textFlow:(f>>>24)&3,marginLeft:p.getUint16(28,true),marginRight:p.getUint16(30,true),marginTop:p.getUint16(32,true),marginBottom:p.getUint16(34,true)};
}
