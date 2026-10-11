/** Table geometry and cell layout through exact, bounded raw metadata patches. */
import {createEngineApi} from './rhwp_api.mjs';
import {readHwp} from '../../probes/sites-runtime/guard/container.mjs';
import {GuardError} from '../../probes/sites-runtime/guard/records.mjs';
import {packLocalBodyRewrite} from '../../probes/sites-runtime/engine/structural-body-repair.mjs';
import {recordsByBlock,preservableStructuralProfile,verifyListCounts} from './local_structure.mjs';
const fail=code=>{throw new GuardError(code);},equal=(a,b)=>JSON.stringify(a)===JSON.stringify(b);
const bytesEqual=(a,b)=>a.length===b.length&&a.every((v,i)=>v===b[i]);
const view=b=>new DataView(b.buffer,b.byteOffset,b.byteLength);
const paddings=['paddingLeft','paddingRight','paddingTop','paddingBottom'];
export function tableFormatEdit(HwpDocument,source,hash,op){
  const schemas={resize_table_columns:['type','target_id','expected_old','widths'],resize_table_rows:['type','target_id','expected_old','heights'],format_cell:['type','target_id','expected_old','props'],format_table:['type','target_id','expected_old','props']};
  if(!op||!schemas[op.type]||!equal(Object.keys(op).sort(),schemas[op.type].toSorted()))fail('INVALID_OPERATION');
  if(typeof op.target_id!=='string'||!op.target_id.startsWith(`hwp5:${hash}:`))fail('VERSION_CONFLICT');
  const encoded=op.target_id.slice(70),id=Buffer.from(encoded,'base64url').toString('utf8');if(Buffer.from(id).toString('base64url')!==encoded)fail('INVALID_TARGET');
  const api=createEngineApi(HwpDocument,{mixedStyleSameLength:true,existingLineBreaksEditable:true}),raw=readHwp(source),doc=api.openDocument(source);
  try{
    const before=api.inspectDocument(doc,source);if(!preservableStructuralProfile(raw,before))fail('UNSUPPORTED_EDIT_PROFILE');verifyListCounts(raw,before);
    const block=before.blocks.find(b=>b.id===id);if(!block||block.kind!=='cell')fail('TABLE_CELL_REQUIRED');if(block.text!==op.expected_old)fail('EXPECTED_OLD_MISMATCH');
    const table=before.tables.find(t=>t.section===block.section&&t.paragraph===block.paragraph&&t.control===block.control);
    if(!table||before.tables.filter(t=>t.section===block.section&&t.paragraph===block.paragraph).length!==1)fail('TABLE_HOST_PROFILE_UNSUPPORTED');
    const wanted=structuredClone(table),records=recordsByBlock(raw,before),host=records.get(`s${table.section}:p${table.paragraph}`),all=before.blocks.filter(b=>b.section===table.section&&b.paragraph===table.paragraph).flatMap(b=>records.get(b.id));
    const cellHeaders=all.filter(r=>r.tag===72),cellHeader=cell=>cellHeaders.find(r=>view(r.payload).getUint16(10,true)===cell.row&&view(r.payload).getUint16(8,true)===cell.col);
    if(cellHeaders.length!==table.cells.length||table.cells.some(c=>cellHeader(c)?.payload.length!==47))fail('CELL_HEADER_PROFILE_UNSUPPORTED');
const name=`BodyText/Section${table.section}`,body=raw.streams.get(name),patched=body.slice();
    const patch=(record,fn)=>{const p=record.payload.slice();fn(view(p),p);patched.set(p,record.payload.byteOffset-body.byteOffset);};
    if(op.type.startsWith('resize_')){
      const columns=op.type==='resize_table_columns',values=columns?op.widths:op.heights,length=columns?table.dimensions.colCount:table.dimensions.rowCount;
      if(length>512||table.dimensions.rowCount*table.dimensions.colCount>4096||!Array.isArray(values)||values.length!==length||values.some(n=>!Number.isSafeInteger(n)||n<100||n>720000)||values.reduce((a,b)=>a+b,0)>720000)fail('INVALID_TABLE_SIZES');
      const coverage=new Set();for(const c of table.cells)for(let r=c.row;r<c.row+c.rowSpan;r++)for(let col=c.col;col<c.col+c.colSpan;col++){if(r<0||r>=table.dimensions.rowCount||col<0||col>=table.dimensions.colCount||coverage.has(`${r}:${col}`))fail('TABLE_GRID_UNVERIFIED');coverage.add(`${r}:${col}`);}
      if(coverage.size!==table.dimensions.rowCount*table.dimensions.colCount)fail('TABLE_GRID_UNVERIFIED');
      for(const c of wanted.cells){const start=columns?c.col:c.row,span=columns?c.colSpan:c.rowSpan,size=values.slice(start,start+span).reduce((a,b)=>a+b,0),r=cellHeader(c),v=view(r.payload);
        if(columns&&v.getUint32(34,true)!==v.getUint32(16,true))fail('CELL_WIDTH_PROFILE_UNSUPPORTED');
        c.properties[columns?'width':'height']=size;patch(r,v=>{v.setUint32(columns?16:20,size,true);if(columns)v.setUint32(34,size,true);});
      }
      const control=host.filter(r=>r.tag===71&&Buffer.from(r.payload.subarray(0,4)).toString('ascii')===' lbt');if(control.length!==1||control[0].payload.length<42||control[0].payload.length>4096
        ||view(control[0].payload).getUint32(16,true)!==table.properties.tableWidth||view(control[0].payload).getUint32(20,true)!==table.properties.tableHeight)fail('TABLE_CONTROL_PROFILE_UNSUPPORTED');
      const size=values.reduce((a,b)=>a+b,0);wanted.properties[columns?'tableWidth':'tableHeight']=size;patch(control[0],v=>v.setUint32(columns?16:20,size,true));
    }else{
      const cell=op.type==='format_cell',allowed=cell?[...paddings,'applyInnerMargin','verticalAlign']:[...paddings,'cellSpacing'],props=op.props;
      if(!props||Object.getPrototypeOf(props)!==Object.prototype||!Object.keys(props).length||Object.keys(props).some(k=>!allowed.includes(k)))fail('INVALID_CELL_PROPERTIES');
      for(const [key,value] of Object.entries(props))if(key==='applyInnerMargin'?typeof value!=='boolean':key==='verticalAlign'?![0,1,2].includes(value):!Number.isSafeInteger(value)||value<0||value>65535)fail('INVALID_CELL_PROPERTIES');
      if(cell){const selected=wanted.cells.find(c=>c.cell===block.cell);Object.assign(selected.properties,props);patch(cellHeader(selected),v=>{
          for(let i=0;i<4;i++)if(Object.hasOwn(props,paddings[i]))v.setUint16(24+i*2,props[paddings[i]],true);
          let flags=v.getUint32(4,true);if(Object.hasOwn(props,'applyInnerMargin'))flags=flags&~0x10000|(props.applyInnerMargin?0x10000:0);if(Object.hasOwn(props,'verticalAlign'))flags=flags&~0x60|(props.verticalAlign<<5);v.setUint32(4,flags>>>0,true);
        });
      }else{Object.assign(wanted.properties,props);const record=host.filter(r=>r.tag===77);if(record.length!==1||record[0].payload.length<18)fail('TABLE_RECORD_PROFILE_UNSUPPORTED');patch(record[0],v=>{
          if(Object.hasOwn(props,'cellSpacing'))v.setUint16(8,props.cellSpacing,true);for(let i=0;i<4;i++)if(Object.hasOwn(props,paddings[i]))v.setUint16(10+i*2,props[paddings[i]],true);
        });}
    }
    const output=packLocalBodyRewrite(source,raw,new Map([[name,patched]])),savedRaw=readHwp(output);
    if(!equal([...raw.streams.keys()],[...savedRaw.streams.keys()]))fail('TABLE_FORMAT_STREAM_MISMATCH');
    for(const [key,value] of raw.streams)if(!bytesEqual(key===name?patched:value,savedRaw.streams.get(key)))fail('TABLE_FORMAT_STREAM_MISMATCH');
    const reopened=api.openDocument(output);let after;try{after=api.inspectDocument(reopened,output);}finally{reopened.free();}
    if(!equal(before.blocks,after.blocks)||!equal(before.unsupported,after.unsupported))fail('TABLE_FORMAT_CONTENT_MISMATCH');
    if(!equal(before.tables.map(t=>t.id===table.id?wanted:t),after.tables))fail('TABLE_FORMAT_PROPERTIES_MISMATCH');
    verifyListCounts(savedRaw,after);return {bytes:output,content_verified:true,raw_preservation_verified:true,raw_preservation_scope:'only_requested_table_or_cell_metadata',structure_changed:false,table_formatting_changed:true,layout_verified:false};
  }finally{doc.free();}
}
