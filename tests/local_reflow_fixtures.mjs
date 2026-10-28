/** Trusted inputs with deliberately fixed text heights and floating overlays. */
import {HwpDocument} from '@rhwp/core';
import {fixture} from './rhwp_fixtures.mjs';
import {groupFixture,nestedGroupFixture,fieldFixture,nestedFixture,checkedExport} from './local_complex_fixtures.mjs';
import {readHwp} from '../src/one_hwp/guard/container.mjs';
import {parseRecords} from '../src/one_hwp/guard/records.mjs';
import {packLocalBodyRewrite} from '../src/one_hwp/local_body_write.mjs';
import {encodeRecords,view} from '../src/one_hwp/local_complex_records.mjs';
import {deflateRawSync} from 'node:zlib';
import {patchLocalPackedStreams} from '../src/one_hwp/local_container_write.mjs';
import {inspectLocalComplex} from '../src/one_hwp/local_complex.mjs';
export function floatingFixture({multiple=false,nested=true}={}){
 const source=multiple?groupFixture({source:groupFixture(),paragraph:2}):nested?nestedGroupFixture():groupFixture(),raw=readHwp(source),records=[...parseRecords(raw.streams.get('BodyText/Section0'))].map(r=>({...r,payload:r.payload.slice()}));
 for(const r of records)if(r.tag===71&&r.level===1&&Buffer.from(r.payload.subarray(0,4)).toString()===' osg'){const p=view(r.payload),mask=(3<<3)|(3<<8)|(7<<21)|(1<<14);p.setUint32(4,((p.getUint32(4,true)&~mask)|(2<<3)|(2<<8)|(5<<21)|(1<<14))>>>0,true);p.setInt32(8,0,true);p.setInt32(12,0,true);}
 return packLocalBodyRewrite(source,raw,new Map([['BodyText/Section0',encodeRecords(records)]]));
}
export function fixedHeightFixture({cell=false,field=false,lines=60,modern=true,pageBreak=false}={}){
 const text=Array.from({length:lines},(_,i)=>`자동 높이 검증 ${String(i+1).padStart(3,'0')} 가나다 ABC`).join('\n');
 const doc=new HwpDocument(field?fieldFixture({cell,mixed:true}):cell?nestedFixture():fixture({table:false,paragraphs:['heading',text,'tail']}));let source;
 try{if(field){const f=JSON.parse(doc.getFieldList())[0];doc.setFieldValue(f.fieldId,text);}source=checkedExport(doc);}finally{doc.free();}
 const raw=readHwp(source),state=inspectLocalComplex(HwpDocument,source,{includeDocumentInfo:false,verifyCharacterModel:false}),block=state.blocks.find(b=>b.text.includes('자동 높이 검증'))??state.blocks.find(b=>b.cell_path.length===2),defs=[...parseRecords(raw.streams.get('DocInfo'))].map(r=>({...r,payload:r.payload.slice()})),shapes=defs.filter(r=>r.tag===25);
 const shape={...shapes[block.paragraph_properties.paraShapeId],payload:shapes[block.paragraph_properties.paraShapeId].payload.slice()},p=view(shape.payload);p.setUint32(0,((p.getUint32(0,true)&~3)|1|(1<<17)|(1<<18)|(pageBreak?1<<19:0))>>>0,true);p.setInt32(24,500,true);if(shape.payload.length>=54){p.setUint32(46,(p.getUint32(46,true)&~31)|(modern?1:0),true);p.setInt32(50,modern?500:0,true);}
 defs.splice(defs.indexOf(shapes.at(-1))+1,0,shape);view(defs.find(r=>r.tag===17).payload).setUint32(52,shapes.length+1,true);
 const body=state.recordSets.get(block.section).map((r,i)=>i===block.record_index?{...r,payload:r.payload.slice()}:r);view(body[block.record_index].payload).setUint16(8,shapes.length,true);
 const compressed=view(raw.streams.get('FileHeader')).getUint32(36,true)&1,changes=new Map([['DocInfo',encodeRecords(defs)],[`BodyText/Section${block.section}`,encodeRecords(body)]]);return patchLocalPackedStreams(source,new Map([...changes].map(([k,v])=>[k,compressed?deflateRawSync(v,{level:9}):v])));
}
