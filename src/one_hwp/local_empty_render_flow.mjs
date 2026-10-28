/** Materialize native blank-paragraph advances only in a disposable instance. */
import {readHwp} from './guard/container.mjs';
import {parseRecords} from './guard/records.mjs';
import {view,fail} from './local_complex_records.mjs';

export function adaptEmptyParagraphFlow(document,bytes){
 const adapted=[];
 for(const [name,data]of readHwp(bytes).streams){
  if(!/^BodyText\/Section\d+$/.test(name))continue;
  const section=Number(name.slice(16)),rs=[...parseRecords(data)],heads=rs.map((r,i)=>[r,i]).filter(([r])=>r.tag===66&&r.level===0);
  for(const [[h,at],paragraph]of heads.map((v,i)=>[v,i])){
   if(h.payload.length<22)continue;
   const end=heads[paragraph+1]?.[1]??rs.length,direct=rs.slice(at+1,end).filter(r=>r.level===1),text=direct.filter(r=>r.tag===67),controls=direct.filter(r=>r.tag===71);
   if(text.length>1||controls.some(r=>!['dces','dloc'].includes(Buffer.from(r.payload.subarray(0,4)).toString())))continue;
   // Setup anchors are extended controls. Other invisible controls, fields and
   // object hosts have independent semantics and do not enter this path.
   const payload=text[0]?.payload??new Uint8Array(),p=view(payload);let offset=0,valid=true;
   while(offset<payload.length/2){const code=p.getUint16(offset*2,true);if(code===13&&offset===payload.length/2-1){offset++;break;}if(code!==2||offset+8>payload.length/2){valid=false;break;}offset+=8;}
   if(!valid||offset!==payload.length/2||document.getParagraphLength(section,paragraph)!==0)continue;
   if(adapted.length>=4096)fail('RENDERED_LAYOUT_ITEM_LIMIT');
   document.insertText(section,paragraph,0,' ');adapted.push({kind:'empty_paragraph',section,paragraph});
  }
 }
 return adapted;
}
