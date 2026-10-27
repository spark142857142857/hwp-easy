/** Known omissions in the pinned renderer, reported without inventing coordinates. */
import {readHwp} from '../../probes/sites-runtime/guard/container.mjs';
import {parseRecords,GuardError} from '../../probes/sites-runtime/guard/records.mjs';
import {textTokens,fail} from './local_complex_records.mjs';
import {groupGeometry} from './local_complex_group.mjs';

export function drawingRenderLimits(bytes){
 const limits=[];
 for(const [name,data]of readHwp(bytes).streams){
  if(!/^BodyText\/Section\d+$/.test(name))continue;
  const section=Number(name.slice(16)),rows=[...parseRecords(data)],groups=[];
  for(let i=0;i<rows.length;i++){
   const r=rows[i];if(r.tag!==76)continue;
   while(groups.length&&groups.at(-1).level>=r.level)groups.pop();
   const kind=Buffer.from(r.payload.subarray(0,4)).toString('ascii');
   if(kind==='noc$'){groups.push(r);continue;}
   if(kind!=='cer$'||!groups.length)continue;
   let end=i+1;while(end<rows.length&&rows[end].level>r.level)end++;
   // Only count this rectangle's own text, excluding deeper nested objects.
   const texts=rows.slice(i+1,end).filter(p=>p.tag===67&&p.level===r.level+2),characters=texts.reduce((n,p)=>n+[...textTokens(p.payload).map(t=>t.text).join('')].length,0);
   if(!characters)continue;
   let reason;
   try{const m=groupGeometry(r).combined;if(Math.abs(m[1])>1e-6||Math.abs(m[3])>1e-6)reason='rotated_group_rectangle_text_not_rendered';}
   catch(error){if(!(error instanceof GuardError))throw error;reason='group_rectangle_transform_unverified';}
   if(reason){limits.push({section,shape_record:i,reason,text_paragraphs:texts.length,text_characters:characters});if(limits.length>256)fail('RENDER_DRAWING_LIMIT');}
  }
 }
 return limits;
}
