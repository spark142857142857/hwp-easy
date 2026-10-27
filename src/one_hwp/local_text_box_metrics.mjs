/** Horizontal rectangle text metrics; unknown LIST_HEADER bytes stay unknown. */
import {view} from './local_complex_records.mjs';
export function textBoxInsets(state,box){
 const list=state.recordSets.get(box.section)?.[box.record_index+2];if(list?.tag!==72||list.payload.length!==33)return null;
 const p=view(list.payload),flags=p.getUint32(4,true),values=[8,10,12,14].map(at=>p.getInt16(at,true));
 if((flags&~0x60)||((flags>>>5)&3)>2||values.some(n=>n<0)||list.payload.subarray(20).some(n=>n))return null;
 const [left,right,top,bottom]=values,width=box.properties.width-left-right,height=box.properties.height-top-bottom,max=p.getUint32(16,true);
 if(width<=0||height<=0||max&&max!==width)return null;
 return {left,right,top,bottom,width,height,vertical_alignment:(flags>>>5)&3};
}
