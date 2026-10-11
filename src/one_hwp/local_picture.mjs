/** Local body PNG objects: exact binary payload and non-target preservation checks. */
import {GuardError,parseRecords} from '../../probes/sites-runtime/guard/records.mjs';
import {canonicalRecord,textControlBytes} from '../../probes/sites-runtime/guard/preservation.mjs';
import {readHwp,inflateBoundedRaw} from '../../probes/sites-runtime/guard/container.mjs';
import {createEngineApi} from './rhwp_api.mjs';
import {readImageLocal} from './local_file.mjs';
import {structuralProfileSupported,recordsByBlock,compareRecords,preserveStructuralCellWords,verifyCellHeaders,verifyListCounts} from './local_structure.mjs';
const fail=code=>{throw new GuardError(code);};
const equal=(a,b)=>JSON.stringify(a)===JSON.stringify(b);
const bytesEqual=(a,b)=>a.length===b.length&&a.every((n,i)=>n===b[i]);
const view=b=>new DataView(b.buffer,b.byteOffset,b.byteLength);
const group=data=>{const m=new Map();for(const r of parseRecords(data)){if(!m.has(r.tag))m.set(r.tag,[]);m.get(r.tag).push(r);}return m;};
const component=Buffer.from('6369702463697024000000000000000000000100201c0000100e0000201c0000100e000000000000000000000000000000000100000000000000f03f000000000000000000000000000000000000000000000000000000000000f03f0000000000000000000000000000f03f000000000000000000000000000000000000000000000000000000000000f03f0000000000000000000000000000f03f000000000000000000000000000000000000000000000000000000000000f03f0000000000000000','hex');
const picture=Buffer.from('0000000000000000000000000000000000000000201c000000000000201c0000100e000000000000100e000000000000000000004b0000004b000000000000000000000000000001000000000000000000004b0000004b00000000','hex');
const bodyHeader=Buffer.from('206f736700000a000000000000000000201c0000100e000001000000000000000000000000000000000000000000','hex');
function pngSize(bytes) {
 if(!bytesEqual(bytes.subarray(0,8),new Uint8Array([137,80,78,71,13,10,26,10])))fail('INVALID_PNG');
 let offset=8,first=true,idat=false,ended=false,width,height;
 while(offset<bytes.length){if(ended||offset+12>bytes.length)fail('INVALID_PNG');const v=view(bytes),length=v.getUint32(offset),end=offset+12+length;
  if(end>bytes.length)fail('INVALID_PNG');const tag=Buffer.from(bytes.subarray(offset+4,offset+8)).toString('ascii');
  let crc=0xffffffff;for(let i=offset+4;i<end-4;i++){crc^=bytes[i];for(let b=0;b<8;b++)crc=crc>>>1^((crc&1)?0xedb88320:0);}
  if((crc^0xffffffff)>>>0!==v.getUint32(end-4))fail('INVALID_PNG');
  if(first){if(tag!=='IHDR'||length!==13)fail('INVALID_PNG');width=v.getUint32(offset+8);height=v.getUint32(offset+12);first=false;}
  else if(tag==='IHDR')fail('INVALID_PNG');
  if(tag==='IDAT')idat=true;if(tag==='IEND'){if(length||!idat)fail('INVALID_PNG');ended=true;}offset=end;
 }
 if(!ended||!width||!height||width>8192||height>8192||width*height>16000000)fail('IMAGE_LIMIT_EXCEEDED');
 return {width,height};
}
export function pictureProfile(raw,model,records) {
 if(raw.profile.sections.length!==1)fail('PICTURE_PROFILE_UNSUPPORTED');
 const images=[];
 for(const b of model.blocks){const list=records.get(b.id),objects=list.filter(r=>[76,85].includes(r.tag));if(!objects.length)continue;
  const headers=list.filter(r=>r.tag===71);
  if(b.kind!=='paragraph'||headers.length!==1||headers[0].level!==1||Buffer.from(headers[0].payload.subarray(0,4)).toString('ascii')!==' osg'
   ||objects.length!==2||objects[0].tag!==76||objects[0].level!==2||objects[0].payload.length!==196
   ||Buffer.from(objects[0].payload.subarray(0,8)).toString('ascii')!=='cip$cip$'
   ||objects[1].tag!==85||objects[1].level!==3||objects[1].payload.length!==91)fail('PICTURE_PROFILE_UNSUPPORTED');
  const controls=list.filter(r=>r.tag===67).map(r=>textControlBytes(r.payload));
  if(controls.length!==1||controls[0].length!==18||view(controls[0]).getUint16(0,true)!==11||view(controls[0]).getUint16(14,true)!==11||view(controls[0]).getUint16(16,true)!==13)fail('PICTURE_PROFILE_UNSUPPORTED');
  images.push(b);
 }
 const unsupported=model.unsupported.filter(x=>!(x.kind==='control'&&x.control_id==='gso'&&x.list===0&&images.some(b=>b.paragraph===x.paragraph)));
 const rawUnknown=raw.profile.unsupported.filter(x=>![76,85].includes(x.record_tag));
 if(!structuralProfileSupported({...raw,profile:{...raw.profile,unsupported:rawUnknown}},{...model,unsupported})
  ||model.unsupported.length-unsupported.length!==images.length||raw.profile.unsupported.length-rawUnknown.length!==images.length*2)fail('PICTURE_PROFILE_UNSUPPORTED');
 return images;
}
export function localPictures(HwpDocument,bytes,hash) {
 const api=createEngineApi(HwpDocument,{mixedStyleSameLength:true,existingLineBreaksEditable:true}),doc=api.openDocument(bytes);
 try{const model=api.inspectDocument(doc,bytes),raw=readHwp(bytes),records=recordsByBlock(raw,model),images=pictureProfile(raw,model,records);
  return images.map(b=>({target_id:`hwp5:${hash}:${Buffer.from(b.id).toString('base64url')}`,section:b.section,paragraph:b.paragraph,
   properties:JSON.parse(doc.getPictureProperties(b.section,b.paragraph,0)),format:'body_picture',editable:true}));
 }finally{doc.free();}
}
export function pictureEdit(HwpDocument,source,hash,op) {
 const schemas={insert_picture:['type','target_id','expected_old','offset','image','width','height'],
  update_picture:['type','target_id','expected_old','expected_properties','props'],delete_picture:['type','target_id','expected_old','expected_properties']};
 if(!op||!schemas[op.type]||!equal(Object.keys(op).sort(),schemas[op.type].sort()))fail('INVALID_OPERATION');
 if(typeof op.target_id!=='string'||!op.target_id.startsWith(`hwp5:${hash}:`))fail('VERSION_CONFLICT');
 const encoded=op.target_id.slice(70),id=Buffer.from(encoded,'base64url').toString('utf8');if(Buffer.from(id).toString('base64url')!==encoded)fail('INVALID_TARGET');
 const api=createEngineApi(HwpDocument,{mixedStyleSameLength:true,existingLineBreaksEditable:true}),raw=readHwp(source),doc=api.openDocument(source);
 try{
  const before=api.inspectDocument(doc,source),records=recordsByBlock(raw,before),images=pictureProfile(raw,before,records),block=before.blocks.find(b=>b.id===id);
  if(!block||block.kind!=='paragraph'||block.section!==0)fail('BODY_PARAGRAPH_REQUIRED');if(block.text!==op.expected_old)fail('EXPECTED_OLD_MISMATCH');
  const insert=op.type==='insert_picture',deleting=op.type==='delete_picture',oldRecords=records.get(id);
  let bytes,pixels,prior,props,binId,newStream;
  if(insert){
   if(images.some(b=>b.id===id)||oldRecords.some(r=>![66,67,68,69].includes(r.tag))||block.style.char_shape_ids?.length!==1
    ||oldRecords.some(r=>r.tag===67&&!bytesEqual(textControlBytes(r.payload),new Uint8Array([13,0]))))fail('PICTURE_ANCHOR_PROFILE_UNSUPPORTED');
   if(!Number.isSafeInteger(op.offset)||op.offset<0||op.offset>[...block.text].length)fail('INVALID_PICTURE_OFFSET');
   if(![op.width,op.height].every(n=>Number.isSafeInteger(n)&&n>0&&n<=720000))fail('INVALID_PICTURE_SIZE');
   if(!op.image||!equal(Object.keys(op.image).sort(),['expected_sha256','source']))fail('INVALID_IMAGE_FILE');
   bytes=readImageLocal(op.image.source,op.image.expected_sha256).bytes;pixels=pngSize(bytes);
   const response=JSON.parse(doc.insertPicture(0,block.paragraph,op.offset,'',bytes,op.width,op.height,pixels.width,pixels.height,'png',''));
   if(!response.ok||response.paraIdx!==block.paragraph||response.controlIdx!==0)fail('ENGINE_OPERATION_FAILED');
  }else{
   if(!images.some(b=>b.id===id))fail('PICTURE_TARGET_REQUIRED');prior=JSON.parse(doc.getPictureProperties(0,block.paragraph,0));
   if(!equal(op.expected_properties,prior))fail('EXPECTED_PICTURE_MISMATCH');
   if(deleting){if(!JSON.parse(doc.deletePictureControl(0,block.paragraph,0)).ok)fail('ENGINE_OPERATION_FAILED');}
   else{
    props=op.props;if(!props||Object.getPrototypeOf(props)!==Object.prototype||!Object.keys(props).length
     ||Object.entries(props).some(([k,n])=>!['width','height','horzOffset','vertOffset'].includes(k)||!Number.isSafeInteger(n)||Math.abs(n)>720000||['width','height'].includes(k)&&n<=0))fail('INVALID_PICTURE_PROPERTIES');
    if(!JSON.parse(doc.setPictureProperties(0,block.paragraph,0,JSON.stringify(props))).ok)fail('ENGINE_OPERATION_FAILED');
   }
  }
  let output=api.exportChecked(doc),savedRaw=readHwp(output),after;const opened=api.openDocument(output);
  try{after=api.inspectDocument(opened,output);}finally{opened.free();}
  const identity=b=>structuredClone(b),repair=preserveStructuralCellWords(raw,output,savedRaw,before,after,identity,null,null);
  if(repair.bytes!==output){output=repair.bytes;savedRaw=readHwp(output);const d=api.openDocument(output);try{if(!equal(api.inspectDocument(d,output),after))fail('PRESERVATION_MISMATCH');}finally{d.free();}}
  const savedRecords=recordsByBlock(savedRaw,after),savedImages=pictureProfile(savedRaw,after,savedRecords),saved=after.blocks.find(b=>b.id===id);
  if(after.blocks.length!==before.blocks.length||!equal(after.tables,before.tables)||savedImages.length!==images.length+(insert?1:deleting?-1:0))fail('PICTURE_CONTENT_MISMATCH');
  for(const old of before.blocks){const now=after.blocks.find(b=>b.id===old.id);if(!now)fail('PICTURE_CONTENT_MISMATCH');
   if(old.id===id){const a=structuredClone(old),b=structuredClone(now);delete a.editable;delete b.editable;if(!equal(a,b))fail('PICTURE_CONTENT_MISMATCH');}
   else {if(!equal(old,now))fail('PICTURE_CONTENT_MISMATCH');compareRecords(records.get(old.id),savedRecords.get(now.id),false);}
  }
  const target=savedRecords.get(id),newObjects=target.filter(r=>[71,76,85].includes(r.tag));
  if(insert){
   const newDefs=group(savedRaw.streams.get('DocInfo')).get(18),oldDefs=group(raw.streams.get('DocInfo')).get(18)??[];
   if(newDefs.length!==oldDefs.length+1)fail('PICTURE_DEFINITION_MISMATCH');const bin=newDefs.at(-1);binId=view(bin.payload).getUint16(2,true);
   const expectedBin=new Uint8Array([1,1,binId&255,binId>>>8,3,0,112,0,110,0,103,0]);
   if(bin.level!==1||!bytesEqual(bin.payload,expectedBin)||!binId)fail('PICTURE_DEFINITION_MISMATCH');
   newStream=`BinData/BIN${binId.toString(16).toUpperCase().padStart(4,'0')}.png`;
   if(raw.streams.has(newStream)||!savedRaw.streams.has(newStream)||!bytesEqual(inflateBoundedRaw(savedRaw.streams.get(newStream),1048576,{allowZeroPadding:false}),bytes))fail('PICTURE_BINARY_MISMATCH');
   const header=Uint8Array.from(bodyHeader),shape=Uint8Array.from(component),pic=Uint8Array.from(picture);
   if(newObjects.length!==3||newObjects.some((r,i)=>r.tag!==[71,76,85][i]))fail('PICTURE_RECORD_MISMATCH');
   view(header).setUint32(16,op.width,true);view(header).setUint32(20,op.height,true);
   const instance=view(newObjects[0].payload).getUint32(24,true);if(!instance)fail('PICTURE_RECORD_MISMATCH');view(header).setUint32(24,instance,true);
   for(const p of [20,28])view(shape).setUint32(p,op.width,true);for(const p of [24,32])view(shape).setUint32(p,op.height,true);
   for(const p of [20,28])view(pic).setUint32(p,op.width,true);for(const p of [32,40])view(pic).setUint32(p,op.height,true);
   for(const p of [52,82])view(pic).setUint32(p,pixels.width*75,true);for(const p of [56,86])view(pic).setUint32(p,pixels.height*75,true);view(pic).setUint16(71,binId,true);
   if([header,shape,pic].some((p,i)=>!bytesEqual(p,newObjects[i].payload)))fail('PICTURE_RECORD_MISMATCH');
  }else if(!deleting){
   const originalObjects=oldRecords.filter(r=>[71,76,85].includes(r.tag));
   if(newObjects.length!==3)fail('PICTURE_RECORD_MISMATCH');
   originalObjects.forEach((r,i)=>{const expected=r.payload.slice();
    if(r.tag===71)for(const [key,offset] of [['vertOffset',8],['horzOffset',12],['width',16],['height',20]])if(Object.hasOwn(props,key))view(expected).setInt32(offset,props[key],true);
    if(r.tag===76)for(const [key,offset] of [['width',28],['height',32]])if(Object.hasOwn(props,key))view(expected).setUint32(offset,props[key],true);
    if(r.level!==newObjects[i].level||r.tag!==newObjects[i].tag||!bytesEqual(expected,newObjects[i].payload))fail('PICTURE_RECORD_MISMATCH');
   });
  }else if(newObjects.length)fail('PICTURE_RECORD_MISMATCH');
  const strip=(list,hasPicture)=>list.filter(r=>![69,71,76,85].includes(r.tag)).map(r=>{
   const p=canonicalRecord(r,0,new Set()).payload.slice();
   if(r.tag===66){p.fill(0,0,8);} // Text count and object flag checked below.
   if(r.tag===67&&hasPicture){const v=view(p);let start=-1;for(let i=0;i<p.length;i+=2)if(v.getUint16(i,true)===11){if(start>=0)fail('PICTURE_RECORD_MISMATCH');start=i;i+=14;}
    if(start<0)fail('PICTURE_RECORD_MISMATCH');return {tag:r.tag,level:r.level,payload:new Uint8Array([...p.subarray(0,start),...p.subarray(start+16)])};
   }return {tag:r.tag,level:r.level,payload:p};
  }).filter(r=>!(r.tag===67&&bytesEqual(r.payload,new Uint8Array([13,0]))));
  const left=strip(oldRecords,!insert),right=strip(target,!deleting);
  if(left.length!==right.length||left.some((r,i)=>r.tag!==right[i].tag||r.level!==right[i].level||!bytesEqual(r.payload,right[i].payload)))fail('PICTURE_RECORD_MISMATCH');
  const header=target.find(r=>r.tag===66),text=target.find(r=>r.tag===67),total=text?text.payload.length/2:0;
  const declared=view(header.payload).getUint32(0,true)&0x7fffffff;
  if((text?declared!==total:declared>1||saved.text!=='')||view(header.payload).getUint32(4,true)!==(deleting?0:1<<11))fail('PICTURE_RECORD_MISMATCH');
  // For insertion, independently prove the raw anchor is at the requested point.
  if(insert){const prefix=[...block.text].slice(0,op.offset).join(''),offset=prefix.length*2;
   const anchor=text.payload.subarray(offset,offset+16);if(!bytesEqual(anchor,new Uint8Array([11,0,32,111,115,103,0,0,0,0,0,0,0,0,11,0])))fail('PICTURE_ANCHOR_MISMATCH');}
  const priorDefs=group(raw.streams.get('DocInfo')),nextDefs=group(savedRaw.streams.get('DocInfo'));
  const allowedTags=insert?new Set([...priorDefs.keys(),18]):new Set(priorDefs.keys());if(!equal([...allowedTags].sort(),[...nextDefs.keys()].sort()))fail('PICTURE_DEFINITION_MISMATCH');
  for(const [tag,list] of priorDefs){const saved=nextDefs.get(tag);if(saved.length!==list.length+(insert&&tag===18?1:0))fail('PICTURE_DEFINITION_MISMATCH');
   list.forEach((r,i)=>{const a=r.payload.slice(),b=saved[i].payload.slice();if(r.level!==saved[i].level)fail('PICTURE_DEFINITION_MISMATCH');if(tag===16){a.fill(0,14,26);b.fill(0,14,26);}
    if(tag===17&&insert){if(view(b).getUint32(0,true)!==view(a).getUint32(0,true)+1)fail('PICTURE_DEFINITION_MISMATCH');a.fill(0,0,4);b.fill(0,0,4);}if(!bytesEqual(a,b))fail('PICTURE_DEFINITION_MISMATCH');
   });
  }
  const extras=[...savedRaw.streams.keys()].filter(n=>!raw.streams.has(n));if(!equal(extras,insert?[newStream]:[]))fail('STREAM_SET_CHANGED');
  for(const [name,original] of raw.streams){if(name.startsWith('BodyText/')||['PrvText','PrvImage','DocInfo'].includes(name))continue;
   if(!savedRaw.streams.has(name)||!bytesEqual(original,savedRaw.streams.get(name)))fail('PRESERVATION_MISMATCH');}
  verifyListCounts(savedRaw,after);verifyCellHeaders(raw,savedRaw,identity,null,null);
  if(!deleting){const d=api.openDocument(output);try{const actual=JSON.parse(d.getPictureProperties(0,block.paragraph,0));if(insert){if(actual.width!==op.width||actual.height!==op.height||!bytesEqual(d.getControlImageData(0,block.paragraph,'',0),bytes))fail('PICTURE_CONTENT_MISMATCH');}
   else if(!equal(actual,{...prior,...props}))fail('PICTURE_CONTENT_MISMATCH');}finally{d.free();}}
  return {bytes:output,content_verified:true,raw_preservation_verified:true,raw_preservation_scope:'body_picture_and_exact_non_target_preservation',
   picture_changed:true,retained_unused_image_data:deleting,structure_changed:insert||deleting,layout_verified:false,restored_cell_list_words:repair.restored_cell_list_words};
 }finally{doc.free();}
}
