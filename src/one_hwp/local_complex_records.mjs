/** Local raw text edits: retain control anchors, definitions and every other record. */
import {GuardError} from '../../probes/sites-runtime/guard/records.mjs';
import {packLocalBodyRewrite} from './local_body_write.mjs';
export const fail=code=>{throw new GuardError(code);};
export const view=b=>new DataView(b.buffer,b.byteOffset,b.byteLength);
export const equalBytes=(a,b)=>a.length===b.length&&a.every((v,i)=>v===b[i]);
export const equal=(a,b)=>JSON.stringify(a)===JSON.stringify(b);
export function encodeRecords(records){
 return Buffer.concat(records.map(r=>{const wide=r.payload.length>=4095,b=Buffer.alloc((wide?8:4)+r.payload.length);
  b.writeUInt32LE((r.tag|(r.level<<10)|((wide?4095:r.payload.length)<<20))>>>0);if(wide)b.writeUInt32LE(r.payload.length,4);Buffer.from(r.payload).copy(b,wide?8:4);return b;}));
}
export function textTokens(payload){
 if(payload.length%2)fail('COMPLEX_TEXT_UNVERIFIED');const tokens=[];let visible=0;
 for(let unit=0;unit<payload.length/2;){const code=view(payload).getUint16(unit*2,true),extended=code>=1&&code<=9||code===11||code===12||code>=14&&code<=23;
  const length=extended?8:1;if(unit+length>payload.length/2)fail('COMPLEX_TEXT_UNVERIFIED');
  if(code>=32){const paired=code>=0xd800&&code<=0xdbff;if(paired&&(unit+1>=payload.length/2||view(payload).getUint16((unit+1)*2,true)<0xdc00||view(payload).getUint16((unit+1)*2,true)>0xdfff))fail('COMPLEX_TEXT_UNVERIFIED');
   if(code>=0xdc00&&code<=0xdfff)fail('COMPLEX_TEXT_UNVERIFIED');const size=paired?2:1;tokens.push({unit,length:size,visible,code,text:Buffer.from(payload.subarray(unit*2,(unit+size)*2)).toString('utf16le')});visible++;unit+=size;
  }else{if(!extended&&![0,10,13,24,30,31].includes(code))fail('COMPLEX_TEXT_UNVERIFIED');tokens.push({unit,length,visible,code,text:code===9?'\t':code===10?'\n':''});if(code===9||code===10)visible++;unit+=length;}
 }
 if(tokens.at(-1)?.code!==13)fail('COMPLEX_TEXT_UNVERIFIED');return tokens;
}
export function rawShapes(header,shape,text,definitionCount){
 if(!shape||shape.payload.length%8||shape.payload.length===0||shape.payload.length>32*8||header.payload.length<22)fail('COMPLEX_STYLE_UNVERIFIED');
 const v=view(shape.payload),anchors=[];for(let p=0;p<shape.payload.length;p+=8)anchors.push({unit:v.getUint32(p,true),id:v.getUint32(p+4,true)});
 if(anchors[0].unit!==0||anchors.some((a,i)=>a.id>=definitionCount||a.unit>=text.length/2||i>0&&a.unit<=anchors[i-1].unit)||view(header.payload).getUint16(12,true)!==anchors.length)fail('COMPLEX_STYLE_UNVERIFIED');
 const units=Array(text.length/2);let at=0;for(let i=0;i<units.length;i++){while(at+1<anchors.length&&anchors[at+1].unit<=i)at++;units[i]=anchors[at].id;}return units;
}
export function spliceRawParagraph(records,block,start,end,value,fieldRange){
 if(typeof value!=='string'||!value.isWellFormed()||/[\u0000-\u0009\u000b-\u001f]/.test(value)||value.length>100000)fail('INVALID_EDIT_TEXT');
 if(value.split('\n').length>100)fail('INVALID_LINE_COUNT');
 const {tokens,unit_styles}=block,points=[...block.text];if(!Number.isSafeInteger(start)||!Number.isSafeInteger(end)||start<0||end<start||end>points.length)fail('INVALID_TEXT_RANGE');
 const textIndex=block.text_record,old=records[textIndex].payload;
 let from,to;
 if(fieldRange){from=fieldRange.from;to=fieldRange.to;}
 else{
  const visible=tokens.filter(t=>t.text),a=visible[start],z=tokens.find(t=>t.visible===end);from=a?.unit??tokens.at(-1).unit;to=end===start?from:z?.unit??tokens.at(-1).unit;
  // Selecting plain text never consumes a field, table or drawing anchor.
  if(tokens.some(t=>!t.text&&t.code!==13&&t.unit>=from&&t.unit<to))fail('TEXT_RANGE_CROSSES_CONTROL');
  if(start===end&&tokens.some(t=>[3,4].includes(t.code)&&t.visible===start))fail('FIELD_TARGET_REQUIRED');
 }
 if(tokens.some(t=>t.unit>=from&&t.unit<to&&!t.text))fail('TEXT_RANGE_CROSSES_CONTROL');
 const wanted=points.slice(0,start).join('')+value+points.slice(end).join('');if(wanted.length>100000)fail('EDIT_LIMIT_EXCEEDED');
 const inherited=unit_styles[from<to?from:Math.max(0,from-1)]??unit_styles[0],ids=unit_styles.slice(0,from).concat(Array(value.length).fill(inherited),unit_styles.slice(to));
 const payload=Buffer.concat([old.subarray(0,from*2),Buffer.from(value,'utf16le'),old.subarray(to*2)]),runs=[];
 ids.forEach((id,unit)=>{if(!unit||id!==ids[unit-1])runs.push({id,unit});});if(runs.length>32)fail('COMPLEX_STYLE_LIMIT');
 const shape=Buffer.alloc(runs.length*8);runs.forEach((r,i)=>{shape.writeUInt32LE(r.unit,i*8);shape.writeUInt32LE(r.id,i*8+4);});
 const header=records[block.record_index].payload.slice();view(header).setUint32(0,((view(header).getUint32(0,true)&0x80000000)|payload.length/2)>>>0,true);
 // LF is HWP character control 10: a line break inside this same paragraph.
 // Keep every other control-mask bit and all field/table/drawing anchors.
 view(header).setUint32(4,(view(header).getUint32(4,true)&~(1<<10))|(textTokens(payload).some(t=>t.code===10)?1<<10:0),true);
 view(header).setUint16(12,runs.length,true);view(header).setUint16(16,0,true);
 const edited=records.map((r,i)=>i===block.record_index?{...r,payload:header}:i===textIndex?{...r,payload}:i===block.shape_record?{...r,payload:shape}:r)
  .filter((r,i)=>!(i>block.record_index&&i<block.records_end&&r.tag===69&&r.level===block.raw_level+1));
 return {records:edited,wanted};
}
export function publishRawBody(source,raw,section,records){
 const name=`BodyText/Section${section}`,expected=encodeRecords(records),bytes=packLocalBodyRewrite(source,raw,new Map([[name,expected]]));return {bytes,name,expected};
}
export function verifyRawOutput(before,after,name,expected){
 if(!equal([...before.streams.keys()].sort(),[...after.streams.keys()].sort()))fail('COMPLEX_PRESERVATION_MISMATCH');
 for(const [key,bytes] of before.streams)if(!equalBytes(after.streams.get(key),key===name?expected:bytes))fail('COMPLEX_PRESERVATION_MISMATCH');
}
