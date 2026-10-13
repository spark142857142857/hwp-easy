/** Local complex character formatting: patch definitions and selected raw runs. */
import {deflateRawSync} from 'node:zlib';
import CFB from '../../probes/sites-runtime/node_modules/cfb/cfb.js';
import {readCfb,readHwp} from '../../probes/sites-runtime/guard/container.mjs';
import {parseRecords} from '../../probes/sites-runtime/guard/records.mjs';
import {validateFormatProperties,patchCharacterShape,fontFaceRecord} from './local_format.mjs';
import {fail,view,equal,equalBytes,encodeRecords} from './local_complex_records.mjs';

// Retain even noncanonical envelopes of existing definitions. New records use
// the standard envelope; source payload views locate the exact original bytes.
export function definitionBytes(stream,records,replacements,additions) {
 const parts=[];let offset=0;
 for(const r of records){const end=r.payload.byteOffset-stream.byteOffset+r.payload.length;
  const payload=replacements.get(r.index);
  parts.push(payload?encodeRecords([{...r,payload}]):stream.subarray(offset,end));
  if(additions.has(r.index))parts.push(encodeRecords(additions.get(r.index)));
  offset=end;
 }
 return Buffer.concat(parts);
}

export function prepareComplexCharacterFormat(raw,records,block,field,op) {
 const props=validateFormatProperties(op.props),text=field?.value??block.text,count=[...text].length;
 if(!Number.isSafeInteger(op.start)||!Number.isSafeInteger(op.end)||op.start<0||op.end<=op.start||op.end>count||count>100000)fail('INVALID_FORMAT_RANGE');
 if(!block.text_range_editable||field&&!field.editable)fail('TARGET_NOT_EDITABLE');
 const start=op.start+(field?.start??0),end=op.end+(field?.start??0);
 const selected=block.tokens.filter(t=>t.text&&t.visible>=start&&t.visible<end);
 if(selected.length!==op.end-op.start||selected.some(t=>t.code===9))fail('FORMAT_TARGET_HAS_CONTROLS');
 const from=selected[0].unit,to=selected.at(-1).unit+selected.at(-1).length;
 if(block.tokens.some(t=>!t.text&&t.unit>=from&&t.unit<to))fail('TEXT_RANGE_CROSSES_CONTROL');
 const stream=raw.streams.get('DocInfo'),defs=[...parseRecords(stream)],shapes=defs.filter(r=>r.tag===21),maps=defs.filter(r=>r.tag===17);
 if(maps.length!==1||maps[0].payload.length<40||view(maps[0].payload).getUint32(36,true)!==shapes.length||!shapes.length||shapes.length>=65535)fail('FORMAT_DEFINITION_MISMATCH');
 const replacements=new Map(),additions=new Map(),mapPayload=maps[0].payload.slice();let fontIds;
 if(Object.hasOwn(props,'fontFamily')){
  const fonts=defs.filter(r=>r.tag===19),counts=Array.from({length:7},(_,i)=>view(mapPayload).getUint32(4+i*4,true)),groups=[];let at=0;
  if(counts.some(n=>!n||n>65534)||counts.reduce((a,b)=>a+b,0)!==fonts.length)fail('FONT_DEFINITION_PROFILE_UNSUPPORTED');
  for(const n of counts){groups.push(fonts.slice(at,at+n));at+=n;}
  fontIds=groups.map(list=>list.findIndex(r=>{if(r.payload.length<3)fail('FONT_DEFINITION_PROFILE_UNSUPPORTED');const length=view(r.payload).getUint16(1,true);if(3+length*2>r.payload.length)fail('FONT_DEFINITION_PROFILE_UNSUPPORTED');return Buffer.from(r.payload.subarray(3,3+length*2)).toString('utf16le')===props.fontFamily;}));
  if(fontIds.some(id=>id<0)){
   if(fontIds.some(id=>id>=0)||!counts.every(n=>n===counts[0]))fail('FONT_DEFINITION_PROFILE_UNSUPPORTED');
   fontIds=Array(7).fill(counts[0]);const payload=fontFaceRecord(props.fontFamily);
   groups.forEach((list,i)=>{additions.set(list.at(-1).index,[{tag:19,level:list.at(-1).level,payload}]);view(mapPayload).setUint32(4+i*4,counts[i]+1,true);});
  }
 }
 const newShapes=[],byOld=new Map(),ids=block.unit_styles.slice();
 for(const t of selected){const old=block.unit_styles[t.unit];if(!byOld.has(old)){
   const wanted=patchCharacterShape(shapes[old]?.payload??new Uint8Array(),props,fontIds);
   let id=shapes.findIndex(r=>equalBytes(r.payload,wanted));
   if(id<0){let added=newShapes.findIndex(r=>equalBytes(r.payload,wanted));if(added<0){added=newShapes.length;newShapes.push({tag:21,level:shapes.at(-1).level,payload:wanted});}id=shapes.length+added;}
   byOld.set(old,id);
  }
  for(let u=t.unit;u<t.unit+t.length;u++)ids[u]=byOld.get(old);
 }
 if(equal(ids,block.unit_styles))return {unchanged:true,props,start,end};
 if(shapes.length+newShapes.length>=65535)fail('FORMAT_DEFINITION_MISMATCH');
 if(newShapes.length){additions.set(shapes.at(-1).index,newShapes);view(mapPayload).setUint32(36,shapes.length+newShapes.length,true);}
 if(!equalBytes(mapPayload,maps[0].payload))replacements.set(maps[0].index,mapPayload);
 const runs=[];ids.forEach((id,unit)=>{if(!unit||id!==ids[unit-1])runs.push({id,unit});});if(runs.length>32)fail('COMPLEX_STYLE_LIMIT');
 const shape=Buffer.alloc(runs.length*8);runs.forEach((r,i)=>{shape.writeUInt32LE(r.unit,i*8);shape.writeUInt32LE(r.id,i*8+4);});
 const header=records[block.record_index].payload.slice();view(header).setUint16(12,runs.length,true);view(header).setUint16(16,0,true);
 const bodyRecords=records.map((r,i)=>i===block.record_index?{...r,payload:header}:i===block.shape_record?{...r,payload:shape}:r)
  .filter((r,i)=>!(i>block.record_index&&i<block.records_end&&r.tag===69&&r.level===block.raw_level+1));
 return {records:bodyRecords,docInfo:definitionBytes(stream,defs,replacements,additions),ids,props,start,end};
}

export function publishComplexCharacterFormat(source,raw,section,patch) {
 const bodyName=`BodyText/Section${section}`,changes=new Map([['DocInfo',patch.docInfo],[bodyName,encodeRecords(patch.records)]]);
 const packed=readCfb(source),tree=CFB.read(Buffer.from(source),{type:'buffer'}),compressed=Boolean(view(raw.streams.get('FileHeader')).getUint32(36,true)&1);
 for(const [name,payload] of changes){const entry=CFB.find(tree,'/'+name);if(!entry||entry.type!==2)fail('COMPLEX_PRESERVATION_MISMATCH');entry.content=compressed?deflateRawSync(payload,{level:9}):Buffer.from(payload);entry.size=entry.content.length;}
 // cfb 1.2.2 seeds a private stream while rebuilding. A trailing vacant entry
 // reserves its name during init, then the writer discards it. Existing magic
 // streams are retained. Independent stream-set checks below reject additions.
 const magic='\u0001Sh33tJ5';if(!CFB.find(tree,'/'+magic)){tree.FullPaths.push(tree.FullPaths[0]+magic);tree.FileIndex.push({name:magic,type:0});}
 const bytes=new Uint8Array(CFB.write(tree,{type:'buffer',fileType:'cfb'}));if(bytes.length>4*1024*1024)fail('FILE_TOO_LARGE');
 const output=readCfb(bytes);if(!equal([...packed.keys()].sort(),[...output.keys()].sort()))fail('COMPLEX_PRESERVATION_MISMATCH');
 for(const [name,value] of packed)if(!changes.has(name)&&!equalBytes(value,output.get(name)))fail('COMPLEX_PRESERVATION_MISMATCH');
 const after=readHwp(bytes);for(const [name,value] of raw.streams)if(!equalBytes(after.streams.get(name),changes.get(name)??value))fail('COMPLEX_PRESERVATION_MISMATCH');
 return bytes;
}

export function verifyComplexCharacterFormat(before,after,block,patch) {
 if(before.blocks.length!==after.blocks.length||before.blocks.some((b,i)=>b.id!==after.blocks[i].id||b.text!==after.blocks[i].text))fail('COMPLEX_CONTENT_MISMATCH');
 const saved=after.blocks.find(b=>b.id===block.id);if(!saved?.text_range_editable||!equal(saved.unit_styles,patch.ids))fail('COMPLEX_STYLE_UNVERIFIED');
 const groups=list=>list.map(g=>{const {record_index,...rest}=g;return {...rest,pictures:g.pictures.map(p=>{const {record_index,...other}=p;return other;})};});
 if(!equal(before.fields,after.fields)||!equal(groups(before.groups),groups(after.groups)))fail('COMPLEX_PRESERVATION_MISMATCH');
 for(const run of saved.character_runs){if(run.end<=patch.start||run.start>=patch.end)continue;
  for(const [key,value] of Object.entries(patch.props))if(key==='fontFamily'?!run.properties.fontFamilies.every(name=>name===value):run.properties[key]!==value)fail('FORMAT_CONTENT_MISMATCH');
 }
}
