/** Pictures in mapped complex paragraphs; opaque controls are never serialized. */
import {deflateRawSync} from 'node:zlib';
import {parseRecords} from '../../probes/sites-runtime/guard/records.mjs';
import {inflateBoundedRaw} from '../../probes/sites-runtime/guard/container.mjs';
import {readImageLocal} from './local_file.mjs';
import {imageSize} from './local_image.mjs';
import {patchLocalPackedStreams} from './local_container_write.mjs';
import {definitionBytes} from './local_complex_format.mjs';
import {rawPictureRecords} from './local_picture.mjs';
import {pictureAnchor,changedPictureProperties} from './local_picture_records.mjs';
import {fail,view,equal,equalBytes,encodeRecords,textTokens} from './local_complex_records.mjs';
import {validObjectHeader,nextObjectInstanceId} from './local_flow_records.mjs';

const id=r=>Buffer.from(r.payload.subarray(0,4)).toString('ascii');
export function complexPictureProperties(raw,group){
 if(group.some((r,i)=>r.tag!==[71,76,85][i]||r.level!==group[0].level+i)||!validObjectHeader(group[0].payload)||group[1].payload.length!==196||group[2].payload.length!==91||id(group[0])!==' osg'||Buffer.from(group[1].payload.subarray(0,8)).toString('ascii')!=='cip$cip$'||view(group[1].payload).getUint16(16,true)!==0)fail('PICTURE_PROFILE_UNSUPPORTED');
 const h=view(group[0].payload),s=view(group[1].payload),p=view(group[2].payload),binId=p.getUint16(71,true);
 const names=[...raw.streams.keys()].filter(n=>new RegExp(`^BinData/BIN${binId.toString(16).padStart(4,'0')}\\.(png|jpe?g)$`,'i').test(n));
 if(names.length!==1)fail('PICTURE_BINARY_MISMATCH');let bytes=raw.streams.get(names[0]),pixels;
 try{pixels=imageSize(bytes);}catch{bytes=inflateBoundedRaw(bytes,1048576);pixels=imageSize(bytes);}
 const sourceWidth=pixels.width*75,sourceHeight=pixels.height*75,props={width:h.getUint32(16,true),height:h.getUint32(20,true),horzOffset:h.getInt32(12,true),vertOffset:h.getInt32(8,true),rotationAngle:s.getInt16(40,true),treatAsChar:Boolean(h.getUint32(4,true)&1),sourceWidth,sourceHeight,cropLeft:p.getInt32(44,true),cropTop:p.getInt32(48,true),cropRight:sourceWidth-p.getInt32(52,true),cropBottom:sourceHeight-p.getInt32(56,true)};
 if(!props.width||!props.height||props.width>720000||props.height>720000||Math.abs(props.rotationAngle)>359||['cropLeft','cropTop','cropRight','cropBottom'].some(k=>props[k]<0)||props.cropLeft+props.cropRight>=sourceWidth||props.cropTop+props.cropBottom>=sourceHeight)fail('PICTURE_PROFILE_UNSUPPORTED');
 return {properties:props,binId,bytes,stream:names[0]};
}
export function complexPictures(raw,records,block){
 const result=[];let control=0,picture=0;
 for(let at=block.record_index+1;at<block.records_end;at++){
  const r=records[at];if(r.tag!==71||r.level!==block.raw_level+1)continue;
  const control_index=control++;if(id(r)!==' osg'||records[at+1]?.tag!==76||id(records[at+1])==='noc$')continue;
  const group=records.slice(at,at+3),index=picture++;
  try{const info=complexPictureProperties(raw,group);result.push({picture_index:index,control_index,record_index:at,properties:info.properties,bin_id:info.binId});}catch(error){if(!['PICTURE_PROFILE_UNSUPPORTED','PICTURE_BINARY_MISMATCH','INVALID_IMAGE_FILE','INVALID_IMAGE_FORMAT','INVALID_PNG','INVALID_JPEG','JPEG_PROFILE_UNSUPPORTED'].includes(error.code))throw error;}
 }
 return result;
}
export function addComplexImage(raw,image){
 if(!image||!equal(Object.keys(image).sort(),['expected_sha256','source']))fail('INVALID_IMAGE_FILE');
 const bytes=readImageLocal(image.source,image.expected_sha256).bytes,pixels=imageSize(bytes,image.source),defs=[...parseRecords(raw.streams.get('DocInfo'))],maps=defs.filter(r=>r.tag===17),bins=defs.filter(r=>r.tag===18);
 if(maps.length!==1||maps[0].payload.length<4||view(maps[0].payload).getUint32(0,true)!==bins.length||bins.length>=65535)fail('PICTURE_DEFINITION_MISMATCH');
 const ids=bins.filter(r=>r.payload.length>=4&&[1,2].includes(view(r.payload).getUint16(0,true)&15)).map(r=>view(r.payload).getUint16(2,true));
 for(const name of raw.streams.keys()){const found=name.match(/^BinData\/BIN([0-9a-f]{4})\./i);if(found)ids.push(parseInt(found[1],16));}
 const binId=Math.max(0,...ids)+1;if(binId>65535)fail('PICTURE_DEFINITION_MISMATCH');
 const suffix=Buffer.from(pixels.extension,'utf16le'),payload=Buffer.alloc(6+suffix.length);payload.writeUInt16LE(257,0);payload.writeUInt16LE(binId,2);payload.writeUInt16LE(pixels.extension.length,4);suffix.copy(payload,6);
 const map=maps[0].payload.slice();view(map).setUint32(0,bins.length+1,true);
 const docInfo=definitionBytes(raw.streams.get('DocInfo'),defs,new Map([[maps[0].index,map]]),new Map([[(bins.at(-1)??maps[0]).index,[{tag:18,level:1,payload}]]]));
 return {bytes,pixels,binId,docInfo,stream:`BinData/BIN${binId.toString(16).toUpperCase().padStart(4,'0')}.${pixels.extension}`};
}
export function publishComplexPicture(source,raw,section,records,image){
 const compressed=Boolean(view(raw.streams.get('FileHeader')).getUint32(36,true)&1),body=encodeRecords(records),changes=new Map([[`BodyText/Section${section}`,compressed?deflateRawSync(body,{level:9}):body]]);
 if(image){changes.set('DocInfo',compressed?deflateRawSync(image.docInfo,{level:9}):image.docInfo);changes.set(image.stream,deflateRawSync(image.bytes,{level:9}));}
 return patchLocalPackedStreams(source,changes);
}
export function prepareComplexPicture(raw,records,block,op){
 const schemas={insert_picture:['offset','image','width','height'],update_picture:['expected_properties','props'],replace_picture:['expected_properties','image'],delete_picture:['expected_properties']};
 if(!schemas[op.type]||!equal(Object.keys(op).filter(k=>k!=='picture_index').sort(),['type','target_id','expected_old',...schemas[op.type]].sort())||op.type==='insert_picture'&&Object.hasOwn(op,'picture_index'))fail('INVALID_OPERATION');
 if(!block.text_mapping_verified||!block.text_range_editable)fail('TARGET_NOT_EDITABLE');
 const pictures=complexPictures(raw,records,block),out=records.map(r=>({...r,payload:r.payload.slice()})),inserting=op.type==='insert_picture',deleting=op.type==='delete_picture';let image,selected,wanted,from,to,insertAt;
 if(inserting){
  if(pictures.length>=32||!Number.isSafeInteger(op.offset)||op.offset<0||op.offset>[...block.text].length||![op.width,op.height].every(n=>Number.isSafeInteger(n)&&n>0&&n<=720000))fail('INVALID_PICTURE_SIZE');
  from=block.tokens.find(t=>t.text&&t.visible>=op.offset)?.unit??block.tokens.at(-1).unit;to=from;
  let field=false;for(const t of block.tokens){if(t.unit>=from)break;if(t.code===3)field=true;if(t.code===4)field=false;}if(field)fail('FIELD_TARGET_REQUIRED');
  const controls=[];for(let i=block.record_index+1;i<block.records_end;i++)if(records[i].tag===71&&records[i].level===block.raw_level+1)controls.push(i);
  const kinds=new Set(controls.map(i=>id(records[i]))),anchorId=t=>Buffer.from(records[block.text_record].payload.subarray(t.unit*2+2,t.unit*2+6)).toString('ascii');
  const anchors=block.tokens.filter(t=>t.length===8&&t.code!==4&&kinds.has(anchorId(t)));
  // Control records follow ALL anchors, including section settings and fields.
  // Ordering just drawings loses a field when a picture precedes its marker.
  if(anchors.length!==controls.length||anchors.some((t,i)=>anchorId(t)!==id(records[controls[i]])))fail('PICTURE_ANCHOR_PROFILE_UNSUPPORTED');
  const before=anchors.filter(t=>t.unit<from).length;insertAt=controls[before]??block.records_end;
  const instance=nextObjectInstanceId(raw);
  image=addComplexImage(raw,op.image);out.splice(insertAt,0,...rawPictureRecords(block.raw_level+1,op.width,op.height,image.pixels,image.binId,instance,true));
 }else{
  if(pictures.length>1&&!Object.hasOwn(op,'picture_index'))fail('PICTURE_INDEX_REQUIRED');const index=op.picture_index??0;selected=pictures.find(p=>p.picture_index===index);if(!Number.isSafeInteger(index)||!selected)fail('PICTURE_TARGET_REQUIRED');
  if(!equal(selected.properties,op.expected_properties))fail('EXPECTED_PICTURE_MISMATCH');
  const group=out.slice(selected.record_index,selected.record_index+3);
  if(deleting){
   const gso=[];for(let i=block.record_index+1;i<block.records_end;i++)if(records[i].tag===71&&records[i].level===block.raw_level+1&&id(records[i])===' osg')gso.push(i);
   const anchors=block.tokens.filter(t=>t.code===11&&Buffer.from(records[block.text_record].payload.subarray(t.unit*2+2,t.unit*2+6)).toString('ascii')===' osg');
   if(gso.length!==anchors.length)fail('PICTURE_ANCHOR_PROFILE_UNSUPPORTED');from=anchors[gso.indexOf(selected.record_index)].unit;to=from+8;out.splice(selected.record_index,3);
  }else if(op.type==='replace_picture'){
   image=addComplexImage(raw,op.image);if(equalBytes(image.bytes,complexPictureProperties(raw,group).bytes)&&['cropLeft','cropTop','cropRight','cropBottom'].every(k=>selected.properties[k]===0))return {unchanged:true};const p=view(group[2].payload);p.setUint16(71,image.binId,true);p.setInt32(44,0,true);p.setInt32(48,0,true);for(const n of [52,82])p.setUint32(n,image.pixels.width*75,true);for(const n of [56,86])p.setUint32(n,image.pixels.height*75,true);
   wanted={...selected.properties,sourceWidth:image.pixels.width*75,sourceHeight:image.pixels.height*75,cropLeft:0,cropTop:0,cropRight:0,cropBottom:0};
  }else{
   const props=op.props,allowed=['width','height','horzOffset','vertOffset','cropLeft','cropTop','cropRight','cropBottom','rotationAngle'];
   if(!props||Object.getPrototypeOf(props)!==Object.prototype||!Object.keys(props).length||Object.entries(props).some(([k,n])=>!allowed.includes(k)||!Number.isSafeInteger(n)||Math.abs(n)>720000||['width','height'].includes(k)&&n<=0||k.startsWith('crop')&&n<0||k==='rotationAngle'&&Math.abs(n)>359))fail('INVALID_PICTURE_PROPERTIES');
   const changed=changedPictureProperties(group,selected.properties,props);wanted=changed.properties;if(equal(wanted,selected.properties))return {unchanged:true};out.splice(selected.record_index,3,...changed.records);
  }
 }
 if(inserting||deleting){
  const header=out[block.record_index],text=out[block.text_record],old=text.payload,value=inserting?pictureAnchor:Buffer.alloc(0);text.payload=Buffer.concat([old.subarray(0,from*2),value,old.subarray(to*2)]);
  const ids=block.unit_styles.slice(0,from).concat(inserting?Array(8).fill(block.unit_styles[Math.max(0,from-1)]):[],block.unit_styles.slice(to)),runs=[];ids.forEach((id,unit)=>{if(!unit||id!==ids[unit-1])runs.push({id,unit});});if(runs.length>32)fail('COMPLEX_STYLE_LIMIT');
  const shapes=Buffer.alloc(runs.length*8);runs.forEach((r,i)=>{shapes.writeUInt32LE(r.unit,i*8);shapes.writeUInt32LE(r.id,i*8+4);});out[block.shape_record].payload=shapes;
  const h=view(header.payload);h.setUint32(0,((h.getUint32(0,true)&0x80000000)|text.payload.length/2)>>>0,true);h.setUint16(12,runs.length,true);h.setUint16(16,0,true);const mask=h.getUint32(4,true);h.setUint32(4,textTokens(text.payload).some(t=>t.code===11)?mask|1<<11:mask&~(1<<11),true);
 }
 const selectedHeader=out[block.record_index],level=selectedHeader.level+1;let end=block.record_index+1;while(end<out.length&&out[end].level>selectedHeader.level)end++;
 const final=out.filter((r,i)=>!(i>block.record_index&&i<end&&r.tag===69&&r.level===level));
 return {records:final,image,wanted,selected,inserting,deleting,expected_picture_count:pictures.length+(inserting?1:deleting?-1:0)};
}
