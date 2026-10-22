/** Synthetic embedded pictures/groups in ordinary and nested cell anchors. */
import {prepareComplexGroup} from '../src/one_hwp/local_complex_group.mjs';
import {changedPictureProperties} from '../src/one_hwp/local_picture_records.mjs';
import {HwpDocument} from '@rhwp/core';
import CFB from '../probes/sites-runtime/node_modules/cfb/cfb.js';
import {deflateRawSync} from 'node:zlib';
import {readHwp,readCfb} from '../probes/sites-runtime/guard/container.mjs';
import {parseRecords} from '../probes/sites-runtime/guard/records.mjs';
import {fixture} from './rhwp_fixtures.mjs';
import {nestedFloatingFixture} from './local_nested_floating_fixtures.mjs';
import {inlineCellFixture} from './local_inline_cell_fixtures.mjs';
import {checkedExport} from './local_complex_fixtures.mjs';
import {progressiveJpeg} from './local_image_fixtures.mjs';
import {inspectLocalComplex} from '../src/one_hwp/local_complex.mjs';
import {reanchorFloating} from '../src/one_hwp/local_floating_anchor.mjs';
import {publishVerifiedPatch} from '../src/one_hwp/local_verified_patch.mjs';
import {packLocalBodyRewrite} from '../src/one_hwp/local_body_write.mjs';
import {view,encodeRecords} from '../src/one_hwp/local_complex_records.mjs';
import {invalidateSectionLayout} from '../src/one_hwp/local_layout_cache.mjs';

export function cellImageFixture({group=false,bodySource=false,destinationDepth=null,angle=0,crop=false,inline=null,...options}={}){
 let bytes=inline?inlineCellFixture(inline):nestedFloatingFixture(options),state=inspectLocalComplex(HwpDocument,bytes),box=state.text_boxes[0];
 const doc=new HwpDocument(fixture({table:false,paragraphs:['HOST','IMAGES','END']}));let donor;
 try{
  const a=JSON.parse(doc.insertPicture(0,1,0,'[]',progressiveJpeg,group?1200:3000,2000,64,40,'jpg','synthetic first'));
  if(group){const c=JSON.parse(doc.insertPicture(0,1,6,'[]',progressiveJpeg,1200,2000,64,40,'jpg','synthetic second'));doc.setPictureProperties(0,c.paraIdx,c.controlIdx,JSON.stringify({treatAsChar:false,horzOffset:1600}));const r=JSON.parse(doc.groupShapes(JSON.stringify({sectionIdx:0,targets:[{paraIdx:a.paraIdx,controlIdx:a.controlIdx},{paraIdx:c.paraIdx,controlIdx:c.controlIdx}]})));if(!r.ok)throw Error('Synthetic grouping failed');}
  donor=checkedExport(doc);
 }finally{doc.free();}
 const ds=inspectLocalComplex(HwpDocument,donor),object=group?ds.groups[0]:ds.pictures[0],drs=ds.recordSets.get(0);let end=object.record_index+1;while(end<drs.length&&drs[end].level>drs[object.record_index].level)end++;
 const addition=drs.slice(object.record_index,end).map(r=>({...r,level:r.level+state.recordSets.get(0)[box.record_index].level-drs[object.record_index].level,payload:r.payload.slice()})),v=view(addition[0].payload);
 v.setUint32(4,((v.getUint32(4,true)&~(1|(3<<3)|(3<<8)|(7<<21)))|(2<<3)|(2<<8)|(3<<21))>>>0,true);v.setInt32(12,0,true);v.setInt32(8,0,true);
 if(angle){if(group){const changed=prepareComplexGroup(ds.raw,drs,object,{type:'transform_picture_group',target_id:'fixture',expected_old:'',expected_properties:object.properties,expected_rotation_angle:object.rotationAngle,props:{rotationAngle:angle}});const part=changed.records.slice(object.record_index,end);for(let i=0;i<part.length;i++)if(i)addition[i].payload=part[i].payload.slice();view(addition[0].payload).setUint32(16,changed.wantedGroup.width,true);view(addition[0].payload).setUint32(20,changed.wantedGroup.height,true);}else{const changed=changedPictureProperties(addition,object.properties,{rotationAngle:angle});for(let i=0;i<addition.length;i++)addition[i].payload=changed.records[i].payload;view(addition[0].payload).setInt32(12,0,true);view(addition[0].payload).setInt32(8,0,true);}}
 if(crop&&!group){view(addition[2].payload).setInt32(44,750,true);view(addition[2].payload).setInt32(52,4050,true);}
 const rs=state.recordSets.get(0),records=rs.slice(0,box.record_index).concat(addition,rs.slice(box.records_end)),defs=[...parseRecords(state.raw.streams.get('DocInfo'))].map(r=>({...r,payload:r.payload.slice()})),bins=[...parseRecords(ds.raw.streams.get('DocInfo'))].filter(r=>r.tag===18),map=defs.find(r=>r.tag===17);view(map.payload).setUint32(0,bins.length,true);defs.splice(defs.indexOf(map)+1,0,...bins);
 const streams=readCfb(bytes),compressed=view(state.raw.streams.get('FileHeader')).getUint32(36,true)&1;streams.set('DocInfo',compressed?deflateRawSync(encodeRecords(defs),{level:9}):encodeRecords(defs));streams.set('BodyText/Section0',compressed?deflateRawSync(encodeRecords(records),{level:9}):encodeRecords(records));for(const [name,data]of readCfb(donor))if(name.startsWith('BinData/'))streams.set(name,data);const cfb=CFB.utils.cfb_new();for(const [name,data]of streams)CFB.utils.cfb_add(cfb,name,Buffer.from(data));bytes=new Uint8Array(CFB.write(cfb,{type:'buffer',fileType:'cfb'}));
 state=inspectLocalComplex(HwpDocument,bytes);const selected=group?state.groups[0]:state.pictures[0],host=state.blocks.find(b=>b.id===selected.block_id),destination=inline?host:bodySource?state.blocks.findLast(b=>!b.cell_path.length):state.blocks.find(b=>b.cell_path.length===(destinationDepth??options.depth??2)&&(destinationDepth!==1||b.cell_path[0].cellIndex===1));
 if(destination.id!==host.id)bytes=publishVerifiedPatch(bytes,state,0,reanchorFloating(state,{selected,b:host},destination).records);
 state=inspectLocalComplex(HwpDocument,bytes);return packLocalBodyRewrite(bytes,state.raw,new Map([['BodyText/Section0',encodeRecords(invalidateSectionLayout(state.recordSets.get(0),state.blocks))]]));
}

export const cellImageProfiles=[{},{group:true},{destinationDepth:1},{group:true,destinationDepth:1},{depth:3,prefix:''},{group:true,depth:3,prefix:''},{ancestorAlignment:[2]},{group:true,ancestorAlignment:[1]},{bodySource:true},{group:true,bodySource:true},{crop:true},{angle:90},{group:true,angle:90},{inline:{duplicate:true,selected:1}},{group:true,inline:{duplicate:true,selected:1,ancestorAlignment:[2]}},{inline:{prior:true,following:true,ancestorAlignment:[1]}},{group:true,inline:{prefix:'문'.repeat(24),wide:true}}];
