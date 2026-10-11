/** Selected body/cell pictures, with exact non-target raw and binary preservation. */
import {GuardError,parseRecords} from '../../probes/sites-runtime/guard/records.mjs';
import {readHwp,inflateBoundedRaw} from '../../probes/sites-runtime/guard/container.mjs';
import {createLocalEngineApi as createEngineApi} from './local_api.mjs';
import {readImageLocal} from './local_file.mjs';
import {structuralProfileSupported,recordsByBlock,compareRecords,verifyCellHeaders,verifyListCounts} from './local_structure.mjs';
import {cellPicturePath} from './local_cell_picture.mjs';
import {imageSize} from './local_image.mjs';
import {anchors,objectGroups,rewritePictureBlock,changedPictureProperties} from './local_picture_records.mjs';
const fail=code=>{throw new GuardError(code);},equal=(a,b)=>JSON.stringify(a)===JSON.stringify(b);
const bytesEqual=(a,b)=>a.length===b.length&&a.every((n,i)=>n===b[i]),view=b=>new DataView(b.buffer,b.byteOffset,b.byteLength);
const group=data=>{const m=new Map();for(const r of parseRecords(data)){if(!m.has(r.tag))m.set(r.tag,[]);m.get(r.tag).push(r);}return m;};
const component=Buffer.from('6369702463697024000000000000000000000100201c0000100e0000201c0000100e000000000000000000000000000000000100000000000000f03f000000000000000000000000000000000000000000000000000000000000f03f0000000000000000000000000000f03f000000000000000000000000000000000000000000000000000000000000f03f0000000000000000000000000000f03f000000000000000000000000000000000000000000000000000000000000f03f0000000000000000','hex');
const picture=Buffer.from('0000000000000000000000000000000000000000201c000000000000201c0000100e000000000000100e000000000000000000004b0000004b000000000000000000000000000001000000000000000000004b0000004b00000000','hex');
const bodyHeader=Buffer.from('206f736700000a000000000000000000201c0000100e000001000000000000000000000000000000000000000000','hex');
export function pictureProfile(raw,model,records) {
 if(raw.profile.sections.length!==1)fail('PICTURE_PROFILE_UNSUPPORTED');const images=[];
 for(const b of model.blocks){const list=records.get(b.id);if(!list.some(r=>[76,85].includes(r.tag)))continue;const groups=objectGroups(list),level=b.kind==='cell'?3:1,text=list.find(r=>r.tag===67)?.payload;
  if(!text||groups.length>32||anchors(text).length!==groups.length)fail('PICTURE_PROFILE_UNSUPPORTED');
  groups.forEach((g,index)=>{if(g.some((r,i)=>r.tag!==[71,76,85][i]||r.level!==level+i)||g[0].payload.length!==46||Buffer.from(g[0].payload.subarray(0,4)).toString('ascii')!==' osg'
   ||g[1].payload.length!==196||Buffer.from(g[1].payload.subarray(0,8)).toString('ascii')!=='cip$cip$'||view(g[1].payload).getUint16(16,true)!==0||g[2].payload.length!==91)fail('PICTURE_PROFILE_UNSUPPORTED');images.push({...b,picture_index:index});});
 }
 const unsupported=model.unsupported.filter(x=>!(x.kind==='control'&&x.control_id==='gso'&&images.some(b=>b.kind==='paragraph'?x.list===0&&b.paragraph===x.paragraph:x.list>0&&b.cell_paragraph===x.paragraph)));
 const rawUnknown=raw.profile.unsupported.filter(x=>![76,85].includes(x.record_tag));
 if(!structuralProfileSupported({...raw,profile:{...raw.profile,unsupported:rawUnknown}},{...model,unsupported})||model.unsupported.length-unsupported.length!==images.length||raw.profile.unsupported.length-rawUnknown.length!==images.length*2)fail('PICTURE_PROFILE_UNSUPPORTED');return images;
}
function pictureProperties(doc,b,index,records){
 const props=JSON.parse(b.kind==='cell'?doc.getCellPicturePropertiesByPath(b.section,b.paragraph,cellPicturePath(b),index):doc.getPictureProperties(b.section,b.paragraph,index));
 const data=doc.getControlImageData(b.section,b.paragraph,b.kind==='cell'?cellPicturePath(b):'',index),size=imageSize(data),p=view(objectGroups(records)[index][2].payload),sourceWidth=size.width*75,sourceHeight=size.height*75;
 if(p.getInt32(44,true)<0||p.getInt32(48,true)<0||p.getInt32(52,true)>sourceWidth||p.getInt32(56,true)>sourceHeight||p.getInt32(44,true)>=p.getInt32(52,true)||p.getInt32(48,true)>=p.getInt32(56,true))fail('PICTURE_CROP_PROFILE_UNSUPPORTED');
 return {...props,sourceWidth,sourceHeight,cropLeft:p.getInt32(44,true),cropTop:p.getInt32(48,true),cropRight:sourceWidth-p.getInt32(52,true),cropBottom:sourceHeight-p.getInt32(56,true)};
}
export function localPictures(HwpDocument,bytes,hash){const api=createEngineApi(HwpDocument,{mixedStyleSameLength:true,existingLineBreaksEditable:true}),doc=api.openDocument(bytes);
 try{const model=api.inspectDocument(doc,bytes),raw=readHwp(bytes),records=recordsByBlock(raw,model);return pictureProfile(raw,model,records).map(b=>({target_id:`hwp5:${hash}:${Buffer.from(b.id).toString('base64url')}`,picture_index:b.picture_index,section:b.section,paragraph:b.paragraph,
  ...(b.kind==='cell'?{control:b.control,cell:b.cell,cell_paragraph:b.cell_paragraph}:{}),properties:pictureProperties(doc,b,b.picture_index,records.get(b.id)),format:b.kind==='cell'?'cell_picture':'body_picture',editable:true}));}finally{doc.free();}}
export function pictureEdit(HwpDocument,source,hash,op){
 const schemas={insert_picture:['type','target_id','expected_old','offset','image','width','height'],update_picture:['type','target_id','expected_old','expected_properties','props'],delete_picture:['type','target_id','expected_old','expected_properties'],replace_picture:['type','target_id','expected_old','expected_properties','image']};
 if(!op||!schemas[op.type]||!equal(Object.keys(op).filter(k=>k!=='picture_index').sort(),schemas[op.type].sort())||op.type==='insert_picture'&&Object.hasOwn(op,'picture_index'))fail('INVALID_OPERATION');
 if(typeof op.target_id!=='string'||!op.target_id.startsWith(`hwp5:${hash}:`))fail('VERSION_CONFLICT');const encoded=op.target_id.slice(70),id=Buffer.from(encoded,'base64url').toString('utf8');if(Buffer.from(id).toString('base64url')!==encoded)fail('INVALID_TARGET');
 const api=createEngineApi(HwpDocument,{mixedStyleSameLength:true,existingLineBreaksEditable:true}),raw=readHwp(source),doc=api.openDocument(source);
 try{const before=api.inspectDocument(doc,source),records=recordsByBlock(raw,before),images=pictureProfile(raw,before,records),block=before.blocks.find(b=>b.id===id);
  if(!block||block.section!==0)fail('PICTURE_TARGET_REQUIRED');if(block.text!==op.expected_old)fail('EXPECTED_OLD_MISMATCH');const oldRecords=records.get(id),groups=oldRecords.some(r=>[76,85].includes(r.tag))?objectGroups(oldRecords):[],oldAnchors=anchors(oldRecords.find(r=>r.tag===67)?.payload??new Uint8Array([13,0]));
  const insert=op.type==='insert_picture',deleting=op.type==='delete_picture',replacing=op.type==='replace_picture',cell=block.kind==='cell',cellPath=cell?cellPicturePath(block):'';
  let index=op.picture_index??0,prior,wanted,bytes,pixels,binId,newStream,change,output=source,savedRaw=raw,nextGroups=groups.map(g=>g.map(r=>({...r,payload:r.payload.slice()})));
  if(!insert){if(groups.length>1&&!Object.hasOwn(op,'picture_index'))fail('PICTURE_INDEX_REQUIRED');if(!Number.isSafeInteger(index)||index<0||index>=groups.length)fail('PICTURE_TARGET_REQUIRED');prior=pictureProperties(doc,block,index,oldRecords);if(!equal(op.expected_properties,prior))fail('EXPECTED_PICTURE_MISMATCH');}
  if(insert||replacing){if(!op.image||!equal(Object.keys(op.image).sort(),['expected_sha256','source']))fail('INVALID_IMAGE_FILE');bytes=readImageLocal(op.image.source,op.image.expected_sha256).bytes;pixels=imageSize(bytes,op.image.source);
   if(insert){if(groups.length>=32||block.style.char_shape_ids?.length!==1||oldRecords.some(r=>![66,67,68,69,71,76,85,...(cell?[72]:[])].includes(r.tag)))fail('PICTURE_ANCHOR_PROFILE_UNSUPPORTED');if(!Number.isSafeInteger(op.offset)||op.offset<0||op.offset>[...block.text].length)fail('INVALID_PICTURE_OFFSET');if(![op.width,op.height].every(n=>Number.isSafeInteger(n)&&n>0&&n<=720000))fail('INVALID_PICTURE_SIZE');
    const point=[...block.text].slice(0,op.offset).join('').length;index=oldAnchors.filter(a=>a.visible<=point).length;change={raw:point+index*8,insert:true};
    // Register binary data through the engine, then reuse original body records.
    if(!JSON.parse(doc.insertPicture(0,block.paragraph,op.offset,cellPath,bytes,op.width,op.height,pixels.width,pixels.height,pixels.extension,'')).ok)fail('ENGINE_OPERATION_FAILED');
   }else if(!JSON.parse(doc.assignPictureImage(0,block.paragraph,cellPath,index,bytes,pixels.width,pixels.height,pixels.extension)).ok)fail('ENGINE_OPERATION_FAILED');
   output=api.exportChecked(doc);savedRaw=readHwp(output);const newDefs=group(savedRaw.streams.get('DocInfo')).get(18),oldDefs=group(raw.streams.get('DocInfo')).get(18)??[];if(newDefs.length!==oldDefs.length+1)fail('PICTURE_DEFINITION_MISMATCH');const bin=newDefs.at(-1);binId=view(bin.payload).getUint16(2,true);
   const suffix=Buffer.from(pixels.extension,'utf16le'),expectedBin=new Uint8Array(6+suffix.length);view(expectedBin).setUint16(0,257,true);view(expectedBin).setUint16(2,binId,true);view(expectedBin).setUint16(4,pixels.extension.length,true);expectedBin.set(suffix,6);
   if(bin.level!==1||!binId||!bytesEqual(bin.payload,expectedBin))fail('PICTURE_DEFINITION_MISMATCH');newStream=`BinData/BIN${binId.toString(16).toUpperCase().padStart(4,'0')}.${pixels.extension}`;
   if(raw.streams.has(newStream)||!savedRaw.streams.has(newStream)||!bytesEqual(inflateBoundedRaw(savedRaw.streams.get(newStream),1048576,{allowZeroPadding:false}),bytes))fail('PICTURE_BINARY_MISMATCH');
   if(insert){const all=[...parseRecords(savedRaw.streams.get('BodyText/Section0'))],p=all.findIndex(r=>r.tag===85&&view(r.payload).getUint16(71,true)===binId),newObjects=all.slice(p-2,p+1).map((r,i)=>({...r,level:(cell?3:1)+i,payload:r.payload.slice()}));
    // HWP table 70: bits 15..17=4 and 18..19=2 mean absolute size.
    // Inline placement must retain them; zero makes dimensions percentages.
    if(p<2||newObjects.some((r,i)=>r.tag!==[71,76,85][i]))fail('PICTURE_RECORD_MISMATCH');if(cell){const v=view(newObjects[0].payload);v.setUint32(4,0x000a0001,true);v.setInt32(8,0,true);v.setInt32(12,0,true);}
    const header=Uint8Array.from(bodyHeader),shape=Uint8Array.from(component),pic=Uint8Array.from(picture);if(cell)view(header).setUint32(4,0x000a0001,true);view(header).setUint32(16,op.width,true);view(header).setUint32(20,op.height,true);const instance=view(newObjects[0].payload).getUint32(24,true);if(!instance)fail('PICTURE_RECORD_MISMATCH');view(header).setUint32(24,instance,true);
    for(const pos of [20,28])view(shape).setUint32(pos,op.width,true);for(const pos of [24,32])view(shape).setUint32(pos,op.height,true);for(const pos of [20,28])view(pic).setUint32(pos,op.width,true);for(const pos of [32,40])view(pic).setUint32(pos,op.height,true);for(const pos of [52,82])view(pic).setUint32(pos,pixels.width*75,true);for(const pos of [56,86])view(pic).setUint32(pos,pixels.height*75,true);view(pic).setUint16(71,binId,true);
    if([header,shape,pic].some((p,i)=>!bytesEqual(p,newObjects[i].payload)))fail('PICTURE_RECORD_MISMATCH');nextGroups.splice(index,0,newObjects);
   }else{const v=view(nextGroups[index][2].payload);v.setUint16(71,binId,true);v.setInt32(44,0,true);v.setInt32(48,0,true);for(const pos of [52,82])v.setUint32(pos,pixels.width*75,true);for(const pos of [56,86])v.setUint32(pos,pixels.height*75,true);wanted={...prior,sourceWidth:pixels.width*75,sourceHeight:pixels.height*75,cropLeft:0,cropTop:0,cropRight:0,cropBottom:0};}
  }else if(deleting){change={raw:oldAnchors[index].raw,insert:false};nextGroups.splice(index,1);}
  else{const props=op.props,allowed=['width','height','horzOffset','vertOffset','cropLeft','cropTop','cropRight','cropBottom','rotationAngle'];if(!props||Object.getPrototypeOf(props)!==Object.prototype||!Object.keys(props).length||Object.entries(props).some(([k,n])=>!allowed.includes(k)||!Number.isSafeInteger(n)||Math.abs(n)>720000||['width','height'].includes(k)&&n<=0||k.startsWith('crop')&&n<0||k==='rotationAngle'&&Math.abs(n)>359))fail('INVALID_PICTURE_PROPERTIES');const updated=changedPictureProperties(nextGroups[index],prior,props);nextGroups[index]=updated.records;wanted=updated.properties;}
  output=rewritePictureBlock(output,savedRaw,raw,records,block,nextGroups,change);savedRaw=readHwp(output);const reopened=api.openDocument(output);
  try{const after=api.inspectDocument(reopened,output),savedRecords=recordsByBlock(savedRaw,after),savedImages=pictureProfile(savedRaw,after,savedRecords);if(after.blocks.length!==before.blocks.length||!equal(after.tables,before.tables)||savedImages.length!==images.length+(insert?1:deleting?-1:0))fail('PICTURE_CONTENT_MISMATCH');
   for(const old of before.blocks){const now=after.blocks.find(b=>b.id===old.id);if(!now)fail('PICTURE_CONTENT_MISMATCH');const a=structuredClone(old),b=structuredClone(now);if(old.id===id){delete a.editable;delete b.editable;}if(!equal(a,b))fail('PICTURE_CONTENT_MISMATCH');if(old.id!==id)compareRecords(records.get(old.id),savedRecords.get(old.id),false);}
   const actualGroups=objectGroups(savedRecords.get(id));if(actualGroups.length!==nextGroups.length||!actualGroups.every((g,j)=>g.every((r,i)=>r.tag===nextGroups[j][i].tag&&r.level===nextGroups[j][i].level&&bytesEqual(r.payload,nextGroups[j][i].payload))))fail('PICTURE_RECORD_MISMATCH');
   const text=savedRecords.get(id).find(r=>r.tag===67)?.payload;if(!text||anchors(text).length!==actualGroups.length)fail('PICTURE_ANCHOR_MISMATCH');
   if(!deleting){const actual=pictureProperties(reopened,block,index,savedRecords.get(id));if(insert?actual.width!==op.width||actual.height!==op.height||cell&&!actual.treatAsChar:!equal(actual,wanted))fail('PICTURE_CONTENT_MISMATCH');if((insert||replacing)&&!bytesEqual(reopened.getControlImageData(0,block.paragraph,cellPath,index),bytes))fail('PICTURE_BINARY_MISMATCH');}
   verifyListCounts(savedRaw,after);verifyCellHeaders(raw,savedRaw,b=>structuredClone(b),null,null);
  }finally{reopened.free();}
  const priorDefs=group(raw.streams.get('DocInfo')),nextDefs=group(savedRaw.streams.get('DocInfo')),adding=insert||replacing;const allowedTags=adding?new Set([...priorDefs.keys(),18]):new Set(priorDefs.keys());if(!equal([...allowedTags].sort(),[...nextDefs.keys()].sort()))fail('PICTURE_DEFINITION_MISMATCH');
  for(const [tag,list] of priorDefs){const saved=nextDefs.get(tag);if(saved.length!==list.length+(adding&&tag===18?1:0))fail('PICTURE_DEFINITION_MISMATCH');list.forEach((r,i)=>{const a=r.payload.slice(),b=saved[i].payload.slice();if(r.level!==saved[i].level)fail('PICTURE_DEFINITION_MISMATCH');if(tag===16&&adding){a.fill(0,14,26);b.fill(0,14,26);}if(tag===17&&adding){if(view(b).getUint32(0,true)!==view(a).getUint32(0,true)+1)fail('PICTURE_DEFINITION_MISMATCH');a.fill(0,0,4);b.fill(0,0,4);}if(!bytesEqual(a,b))fail('PICTURE_DEFINITION_MISMATCH');});}
  if(!equal([...savedRaw.streams.keys()].filter(n=>!raw.streams.has(n)),adding?[newStream]:[]))fail('STREAM_SET_CHANGED');for(const [name,original] of raw.streams){if(name==='BodyText/Section0'||adding&&['PrvText','PrvImage','DocInfo'].includes(name))continue;if(!savedRaw.streams.has(name)||!bytesEqual(original,savedRaw.streams.get(name)))fail('PRESERVATION_MISMATCH');}
  return {bytes:output,content_verified:true,raw_preservation_verified:true,raw_preservation_scope:'selected_picture_and_exact_non_target_preservation',picture_changed:true,picture_index:index,retained_unused_image_data:deleting||replacing,structure_changed:insert||deleting,layout_verified:false,restored_cell_list_words:0};
 }finally{doc.free();}}
