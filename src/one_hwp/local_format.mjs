/** Requested formatting, with raw definition patches and complete non-target preservation. */
import {GuardError,parseRecords} from '../../probes/sites-runtime/guard/records.mjs';
import {canonicalRecord,textControlBytes} from '../../probes/sites-runtime/guard/preservation.mjs';
import {modelCharacterIds} from './local_character_runs.mjs';
import {verifyPlainCharacterRuns} from './local_text.mjs';
// FACE_NAME default aliases from pinned npm source e8800c8, serializer/doc_info.rs (MIT).
import fontDefaults from './font_defaults.json' with {type:'json'};
const fail=code=>{throw new GuardError(code);};
const equal=(a,b)=>JSON.stringify(a)===JSON.stringify(b);
const bytesEqual=(a,b)=>a.length===b.length&&a.every((v,i)=>v===b[i]);
const view=b=>new DataView(b.buffer,b.byteOffset,b.byteLength);
const groups=bytes=>{const result=new Map();for(const r of parseRecords(bytes)){if(!result.has(r.tag))result.set(r.tag,[]);result.get(r.tag).push(r);}return result;};
export function validateFormatProperties(input,character=true) {
 const props={...input};
 const allowed=character?['bold','italic','underline','strikethrough','fontSize','textColor','fontFamily']
  :['alignment','lineSpacing','marginLeft','marginRight','indent','spacingBefore','spacingAfter'];
 if(!input||Object.getPrototypeOf(input)!==Object.prototype||!Object.keys(props).length||Object.keys(props).some(k=>!allowed.includes(k)))fail('INVALID_FORMAT_PROPERTIES');
 for(const [key,value] of Object.entries(props)) {
  if(['bold','italic','underline','strikethrough'].includes(key)){if(typeof value!=='boolean')fail('INVALID_FORMAT_PROPERTIES');}
  else if(key==='fontFamily'){if(typeof value!=='string'||!value.isWellFormed()||value.trim()!==value||!value.length||value.length>100||/[\u0000-\u001f,;"'\\]/.test(value))fail('INVALID_FORMAT_PROPERTIES');}
  else if(key==='textColor'){if(typeof value!=='string'||!/^#[0-9a-fA-F]{6}$/.test(value))fail('INVALID_FORMAT_PROPERTIES');props[key]=value.toLowerCase();}
  else if(key==='alignment'){if(!['justify','left','right','center'].includes(value))fail('INVALID_FORMAT_PROPERTIES');}
  else if(!Number.isSafeInteger(value)||value<(key==='fontSize'?100:key==='lineSpacing'?1:key==='indent'?-72000:0)||value>(key==='fontSize'?72000:720000))fail('INVALID_FORMAT_PROPERTIES');
 }
 return props;
}
export function patchCharacterShape(payload,props,fontIds) {
 if(payload.length!==74)fail('CHAR_SHAPE_PROFILE_UNSUPPORTED');
 const result=payload.slice(),v=view(result);
 if(fontIds)fontIds.forEach((id,i)=>v.setUint16(i*2,id,true));
 let flags=v.getUint32(46,true);
 for(const [key,mask] of [['italic',1],['bold',2],['underline',12],['strikethrough',0x180000]])if(Object.hasOwn(props,key))flags=flags&~mask|(props[key]?(key==='underline'?4:key==='strikethrough'?0x80000:mask):0);
 v.setUint32(46,flags,true);
 if(Object.hasOwn(props,'fontSize'))v.setUint32(42,props.fontSize,true);
 if(Object.hasOwn(props,'textColor'))v.setUint32(52,parseInt(props.textColor.slice(1,3),16)|(parseInt(props.textColor.slice(3,5),16)<<8)|(parseInt(props.textColor.slice(5,7),16)<<16),true);
 return result;
}
export function fontFaceRecord(name) {
 const text=Buffer.from(name,'utf16le'),alias=fontDefaults.find(([font])=>font===name)?.[1],fallback=alias?Buffer.from(alias,'utf16le'):null;
 const payload=new Uint8Array(3+text.length+(fallback?2+fallback.length:0));view(payload).setUint16(1,name.length,true);payload.set(text,3);
 if(fallback){payload[0]=32;view(payload).setUint16(3+text.length,alias.length,true);payload.set(fallback,5+text.length);}
 return payload;
}
export function prepareFormatChange(doc,raw,block,operation,records) {
 const character=operation.type==='format_text',props=validateFormatProperties(operation.props,character);
 const count=[...block.text].length,start=character?operation.start:0,end=character?operation.end:count;
 if(character&&(!Number.isSafeInteger(start)||!Number.isSafeInteger(end)||start<0||end<=start||end>count||count>100000))fail('INVALID_FORMAT_RANGE');
 const defs=groups(raw.streams.get('DocInfo')),targetRecords=records.get(block.id);
 let fontIds,fontGrowth=0;
 const fontCounts=Array.from({length:7},(_,i)=>view(defs.get(17)[0].payload).getUint32(4+i*4,true));
 const fonts=defs.get(19)??[],fontGroups=[];let fontOffset=0;
 for(const n of fontCounts){fontGroups.push(fonts.slice(fontOffset,fontOffset+n));fontOffset+=n;}
 if(Object.hasOwn(props,'fontFamily')){
  if(fontOffset!==fonts.length||fontCounts.some(n=>!n||n>65534))fail('FONT_DEFINITION_PROFILE_UNSUPPORTED');
  const names=fontGroups.map(list=>list.map(r=>{const n=view(r.payload).getUint16(1,true);if(3+n*2>r.payload.length)fail('FONT_DEFINITION_PROFILE_UNSUPPORTED');return new TextDecoder('utf-16le').decode(r.payload.subarray(3,3+n*2));}));
  fontIds=names.map(list=>list.indexOf(props.fontFamily));
  if(fontIds.some(id=>id<0)){
   if(fontIds.some(id=>id>=0)||!fontCounts.every(n=>n===fontCounts[0]))fail('FONT_DEFINITION_PROFILE_UNSUPPORTED');
   const id=doc.findOrCreateFontId(props.fontFamily);if(id!==fontCounts[0])fail('FONT_DEFINITION_PROFILE_UNSUPPORTED');fontIds=Array(7).fill(id);fontGrowth=1;
  }
 }
 if(character&&targetRecords.some(r=>r.tag===67&&!bytesEqual(textControlBytes(r.payload),new Uint8Array([13,0]))))fail('FORMAT_TARGET_HAS_CONTROLS');
 const charAt=(document,offset)=>JSON.parse(block.kind==='paragraph'?document.getCharPropertiesAt(block.section,block.paragraph,offset)
  :document.getCellCharPropertiesAt(block.section,block.paragraph,block.control,block.cell,block.cell_paragraph,offset));
 const priorIds=character?modelCharacterIds(block,'FORMAT_CONTENT_MISMATCH'):undefined;
 if(character)verifyPlainCharacterRuns(targetRecords,block.text,priorIds,block.style.char_shape_ids[0]);
 const samplePositions=new Set();
 if(character){
  if(count<=2048)for(let i=0;i<count;i++)samplePositions.add(i);
  else for(let from=0;from<count;){let to=from+1;const changed=from>=start&&from<end;while(to<count&&priorIds[to]===priorIds[from]&&(to>=start&&to<end)===changed)to++;for(const i of [from,Math.floor((from+to-1)/2),to-1])samplePositions.add(i);from=to;}
 }
 const priorProperties=new Map([...samplePositions].map(i=>[i,charAt(doc,i)]));
 const originalParagraph=block.style.paragraph;
 function expectedShape(payload) {
  // New PARA_SHAPE records from a 54-byte source use the writer's 58-byte
  // envelope with a zero property-3 tail. Existing records remain byte-exact.
  const result=!character&&payload.length===54?new Uint8Array(58):payload.slice();
  if(result.length!==payload.length)result.set(payload);
  const v=view(result);
  if(character) {
   return patchCharacterShape(payload,props,fontIds);
  } else {
   if(![54,58].includes(payload.length))fail('PARA_SHAPE_PROFILE_UNSUPPORTED');
   if(Object.hasOwn(props,'alignment'))v.setUint32(0,v.getUint32(0,true)&~28|(['justify','left','right','center'].indexOf(props.alignment)<<2),true);
   for(const [key,offset] of [['marginLeft',4],['marginRight',8],['indent',12],['spacingBefore',16],['spacingAfter',20],['lineSpacing',24]])if(Object.hasOwn(props,key))v.setInt32(offset,props[key],true);
  }return result;
 }
 const shapeIds=character?[...new Set(priorIds.slice(start,end))]:[];
 const permittedShapes=character?shapeIds.map(id=>expectedShape(defs.get(21)[id]?.payload??new Uint8Array()))
  :[expectedShape(defs.get(25)[originalParagraph.paraShapeId]?.payload??new Uint8Array())];
 const expectedShapes=new Map();
 const expectedFor=(id,changed)=>{const key=`${id}:${changed}`;if(!expectedShapes.has(key)){const original=defs.get(21)[id]?.payload;if(!original)fail('FORMAT_DEFINITION_MISMATCH');expectedShapes.set(key,changed?expectedShape(original):original);}return expectedShapes.get(key);};
 function apply(){const engineProps={...props};if(fontIds){delete engineProps.fontFamily;engineProps.fontIds=fontIds;}const value=JSON.stringify(engineProps),checked=result=>{if(!JSON.parse(result).ok)fail('ENGINE_OPERATION_FAILED');};
  if(character){
   // The upstream range formatter clones its first style for the whole range.
   // Format each original run separately and reuse its checked resulting ID.
   const cache=new Map();let from=start;
   while(from<end){const originalId=priorIds[from];let to=from+1;while(to<end&&priorIds[to]===originalId)to++;
    if(cache.has(originalId))checked(block.kind==='paragraph'?doc.setCharShapeId(block.section,block.paragraph,from,to,cache.get(originalId))
     :doc.setCharShapeIdInCell(block.section,block.paragraph,block.control,block.cell,block.cell_paragraph,from,to,cache.get(originalId)));
    else{checked(block.kind==='paragraph'?doc.applyCharFormat(block.section,block.paragraph,from,to,value)
     :doc.applyCharFormatInCell(block.section,block.paragraph,block.control,block.cell,block.cell_paragraph,from,to,value));cache.set(originalId,charAt(doc,from).charShapeId);}
    from=to;
   }
  }else checked(block.kind==='paragraph'?doc.applyParaFormat(block.section,block.paragraph,value)
   :doc.applyParaFormatInCell(block.section,block.paragraph,block.control,block.cell,block.cell_paragraph,value));
 }
 function verifyDefinitions(a,b) {
  const left=groups(a),right=groups(b),tag=character?21:25;
  if(!equal([...left.keys()],[...right.keys()]))fail('FORMAT_DEFINITION_MISMATCH');
  const growth=(right.get(tag)?.length??0)-(left.get(tag)?.length??0);
  if(growth<0||growth>Math.max(1,permittedShapes.length))fail('FORMAT_DEFINITION_MISMATCH');
  for(const [kind,list] of left){const saved=right.get(kind);if(saved.length!==list.length+(kind===tag?growth:kind===19?fontGrowth*7:0))fail('FORMAT_DEFINITION_MISMATCH');
   if(kind===19&&fontGrowth){let offset=0;const newFont=fontFaceRecord(props.fontFamily);
    for(let lang=0;lang<7;lang++){for(const r of fontGroups[lang]){const s=saved[offset++];if(s.level!==r.level||!bytesEqual(r.payload,s.payload))fail('FORMAT_DEFINITION_MISMATCH');}const s=saved[offset++];if(s.level!==1||!bytesEqual(s.payload,newFont))fail('FORMAT_DEFINITION_MISMATCH');}continue;
   }
   list.forEach((r,i)=>{const old=r.payload.slice(),now=saved[i].payload.slice();if(r.level!==saved[i].level)fail('FORMAT_DEFINITION_MISMATCH');
    if(kind===16){old.fill(0,14,26);now.fill(0,14,26);}
    if(kind===17){const offset=character?36:52;if(view(now).getUint32(offset,true)!==view(old).getUint32(offset,true)+growth)fail('FORMAT_DEFINITION_MISMATCH');old.fill(0,offset,offset+4);now.fill(0,offset,offset+4);for(let lang=0;lang<7;lang++){const pos=4+lang*4;if(view(now).getUint32(pos,true)!==view(old).getUint32(pos,true)+fontGrowth)fail('FORMAT_DEFINITION_MISMATCH');old.fill(0,pos,pos+4);now.fill(0,pos,pos+4);}}
    if(!bytesEqual(old,now))fail('FORMAT_DEFINITION_MISMATCH');
   });
  }
  for(const r of right.get(tag).slice(left.get(tag).length))if(r.level!==left.get(tag)[0].level||!permittedShapes.some(p=>bytesEqual(p,r.payload)))fail('FORMAT_DEFINITION_MISMATCH');
 }
 function verifyBlock(saved,reopened,savedRaw) {
  const old=structuredClone(block),now=structuredClone(saved);delete old.style;delete now.style;delete old.editable;delete now.editable;
  if(!equal(old,now))fail('FORMAT_CONTENT_MISMATCH');
  const afterDefs=groups(savedRaw.streams.get('DocInfo'));
  if(character) {
   if(!equal(block.style.paragraph,saved.style.paragraph))fail('FORMAT_CONTENT_MISMATCH');
   const afterIds=modelCharacterIds(saved,'FORMAT_CONTENT_MISMATCH');
   for(const [i,original] of priorProperties) {
    const wanted=structuredClone(original),actual=charAt(reopened,i);delete wanted.charShapeId;delete actual.charShapeId;
    if(i>=start&&i<end){Object.assign(wanted,props);if(fontIds)wanted.fontFamilies=Array(7).fill(props.fontFamily);if(Object.hasOwn(props,'underline'))wanted.underlineType=props.underline?'Bottom':'None';}
    if(!equal(wanted,actual))fail('FORMAT_CONTENT_MISMATCH');
   }
   for(let i=0;i<count;i++){
    const expected=expectedFor(priorIds[i],i>=start&&i<end);
    if(!bytesEqual(expected,afterDefs.get(21)[afterIds[i]]?.payload??new Uint8Array()))fail('FORMAT_DEFINITION_MISMATCH');
   }
  } else {
   const wanted={...block.style.paragraph,...props},actual={...saved.style.paragraph};delete wanted.paraShapeId;delete actual.paraShapeId;
   // The model reports margins/indent at 1/150 and spacing at 1/75 of the
   // raw HWP unit, rounded to one decimal. The definition check is exact.
   for(const key of ['marginLeft','marginRight','indent','spacingBefore','spacingAfter'])if(Object.hasOwn(props,key))wanted[key]=Math.round(props[key]/(key.startsWith('spacing')?75:150)*10)/10;
   if(!equal(wanted,actual))fail('FORMAT_CONTENT_MISMATCH');
   const charBefore={...block.style},charAfter={...saved.style};delete charBefore.paragraph;delete charAfter.paragraph;
   if(!equal(charBefore,charAfter))fail('FORMAT_CONTENT_MISMATCH');
   if(!bytesEqual(permittedShapes[0],afterDefs.get(25)[saved.style.paragraph.paraShapeId]?.payload??new Uint8Array()))fail('FORMAT_DEFINITION_MISMATCH');
  }
 }
 function verifyRecords(left,right,savedRaw) {
  const normalize=list=>list.filter(r=>r.tag!==69&&r.tag!==72&&!(character&&r.tag===68)).map(r=>{
   const canonical=canonicalRecord(r,0,new Set()),payload=canonical.payload.slice();
   if(r.tag===66){if(character)payload.fill(0,12,14);else payload.fill(0,8,10);}
   return {tag:r.tag,level:r.level,payload};
  });
  const a=normalize(left),b=normalize(right);if(a.length!==b.length||a.some((r,i)=>r.tag!==b[i].tag||r.level!==b[i].level||!bytesEqual(r.payload,b[i].payload)))fail('FORMAT_RECORD_MISMATCH');
  if(character) {
   const runs=right.filter(r=>r.tag===68);if(runs.length!==1||runs[0].payload.length%8)fail('FORMAT_RECORD_MISMATCH');
   const header=right.find(r=>r.tag===66);if(view(header.payload).getUint16(12,true)!==runs[0].payload.length/8)fail('FORMAT_RECORD_MISMATCH');
   const payload=runs[0].payload,v=view(payload),definitions=groups(savedRaw.streams.get('DocInfo')).get(21);
   const anchors=[];
   for(let i=0;i<payload.length;i+=8)anchors.push({position:v.getUint32(i,true),shape:v.getUint32(i+4,true)});
   if(!anchors.length||anchors[0].position!==0||anchors.some((a,i)=>i&&a.position<=anchors[i-1].position))fail('FORMAT_RECORD_MISMATCH');
   // Raw runs use UTF-16 positions, while the engine accepts code-point offsets.
   // Check both surrogate units, and permit a trailing terminator run only.
   let offset=0,point=0;
   for(const ch of block.text) {
    const expected=expectedFor(priorIds[point],point>=start&&point<end);
    for(let unit=0;unit<ch.length;unit++) {
     const anchor=anchors.findLast(a=>a.position<=offset+unit);
     if(!bytesEqual(expected,definitions[anchor.shape]?.payload??new Uint8Array()))fail('FORMAT_RECORD_MISMATCH');
    }
    offset+=ch.length;point++;
   }
   if(anchors.some(a=>a.position>offset))fail('FORMAT_RECORD_MISMATCH');
  }
 }
 return {apply,verifyDefinitions,verifyBlock,verifyRecords};
}
