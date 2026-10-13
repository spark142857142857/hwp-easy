/** Change one mapped paragraph's shape; retain shared definitions and controls. */
import {parseRecords} from '../../probes/sites-runtime/guard/records.mjs';
import {validateFormatProperties} from './local_format.mjs';
import {definitionBytes} from './local_complex_format.mjs';
import {fail,view,equalBytes} from './local_complex_records.mjs';
const positions=[['marginLeft',4],['marginRight',8],['indent',12],['spacingBefore',16],['spacingAfter',20],['lineSpacing',24]];
export function complexParagraphProperties(raw,records,block){
 const header=records[block.record_index];if(header.payload.length<22)fail('PARA_SHAPE_PROFILE_UNSUPPORTED');
 const id=view(header.payload).getUint16(8,true),shapes=[...parseRecords(raw.streams.get('DocInfo'))].filter(r=>r.tag===25),shape=shapes[id];
 if(!shape||![46,54,58].includes(shape.payload.length))fail('PARA_SHAPE_PROFILE_UNSUPPORTED');
 const p=view(shape.payload),alignment=['justify','left','right','center'][(p.getUint32(0,true)>>2)&7];
 if(!alignment)fail('PARA_SHAPE_PROFILE_UNSUPPORTED');
 const flags=p.getUint32(0,true),modern=shape.payload.length>=54&&p.getUint32(50,true)>0;
 return {paraShapeId:id,alignment,lineSpacingType:modern?p.getUint32(46,true)&31:flags&3,...Object.fromEntries(positions.map(([key,offset])=>[key,p.getInt32(key==='lineSpacing'&&modern?50:offset,true)])),widowOrphan:Boolean(flags&1<<16),keepWithNext:Boolean(flags&1<<17),keepLines:Boolean(flags&1<<18),pageBreakBefore:Boolean(flags&1<<19),fontLineHeight:Boolean(flags&1<<22)};
}
export function prepareComplexParagraphFormat(raw,records,block,op){
 const props=validateFormatProperties(op.props,false);if(!block.text_mapping_verified)fail('TARGET_NOT_EDITABLE');
 const before=complexParagraphProperties(raw,records,block),stream=raw.streams.get('DocInfo'),defs=[...parseRecords(stream)],shapes=defs.filter(r=>r.tag===25),maps=defs.filter(r=>r.tag===17);
 if(maps.length!==1||maps[0].payload.length<56||view(maps[0].payload).getUint32(52,true)!==shapes.length||shapes.length>=65535)fail('FORMAT_DEFINITION_MISMATCH');
 const wanted=shapes[before.paraShapeId].payload.slice(),p=view(wanted);
 if(Object.hasOwn(props,'alignment'))p.setUint32(0,(p.getUint32(0,true)&~28)|(['justify','left','right','center'].indexOf(props.alignment)<<2),true);
 for(const [key,offset]of positions)if(Object.hasOwn(props,key))p.setInt32(offset,props[key],true);
 if(wanted.length>=54&&Object.hasOwn(props,'lineSpacing')&&p.getUint32(50,true)>0)p.setInt32(50,props.lineSpacing,true);
 if(equalBytes(wanted,shapes[before.paraShapeId].payload))return {unchanged:true};
 let id=shapes.findIndex(r=>equalBytes(r.payload,wanted));const replacements=new Map(),additions=new Map();
 if(id<0){id=shapes.length;additions.set(shapes.at(-1).index,[{tag:25,level:shapes.at(-1).level,payload:wanted}]);const map=maps[0].payload.slice();view(map).setUint32(52,shapes.length+1,true);replacements.set(maps[0].index,map);}
 const header=records[block.record_index].payload.slice();view(header).setUint16(8,id,true);view(header).setUint16(16,0,true);
 const body=records.map((r,i)=>i===block.record_index?{...r,payload:header}:r).filter((r,i)=>!(i>block.record_index&&i<block.records_end&&r.tag===69&&r.level===block.raw_level+1));
 return {records:body,docInfo:definitionBytes(stream,defs,replacements,additions),props:{...before,...props,paraShapeId:id},wanted};
}
