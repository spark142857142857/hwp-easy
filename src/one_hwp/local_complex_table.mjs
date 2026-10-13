/** Raw rectangular table axes; keep child controls and every unrelated record. */
import {fail,view,equal} from './local_complex_records.mjs';
const controlId=r=>Buffer.from(r.payload.subarray(0,4)).toString('ascii');
const extent=(records,at,limit)=>{let end=at+1;while(end<limit&&records[end].level>records[at].level)end++;return end;};
export const standardBlockId=b=>b.cell_path.length===0?`s${b.section}:p${b.paragraph}`:b.cell_path.length===1?`s${b.section}:p${b.paragraph}:t${b.cell_path[0].controlIndex}:c${b.cell_path[0].cellIndex}:p${b.cell_path[0].cellParaIndex}`:null;
export function complexTables(recordSets,blocks){
 const tables=[];
 for(const parent of blocks){const records=recordSets.get(parent.section);let control=0;
  for(let at=parent.record_index+1;at<parent.records_end;at++){
   const r=records[at];if(r.tag!==71||r.level!==parent.raw_level+1)continue;const index=control++;if(controlId(r)!==' lbt')continue;
   const end=extent(records,at,parent.records_end),level=r.level+1,headers=[],tableRecords=[];
   for(let i=at+1;i<end;i++)if(records[i].level===level){if(records[i].tag===77)tableRecords.push(i);if(records[i].tag===72&&records[i].payload.length>=34)headers.push(i);}
   if(tableRecords.length!==1)continue;const tableAt=tableRecords[0],p=view(records[tableAt].payload);if(p.byteLength<18)continue;
   const cells=headers.map((start,cell)=>{const header=records[start],h=view(header.payload),stop=headers[cell+1]??end;
    const children=blocks.filter(b=>b.section===parent.section&&b.paragraph===parent.paragraph&&b.cell_path.length===parent.cell_path.length+1&&equal(b.cell_path.slice(0,-1),parent.cell_path)&&b.cell_path.at(-1).controlIndex===index&&b.cell_path.at(-1).cellIndex===cell);
    return {cell,start,end:stop,row:h.getUint16(10,true),col:h.getUint16(8,true),rowSpan:h.getUint16(14,true),colSpan:h.getUint16(12,true),width:h.getUint32(16,true),height:h.getUint32(20,true),blocks:children.sort((a,b)=>a.cell_paragraph-b.cell_paragraph)};});
   const table={id:`${parent.id}:t${index}`,parent_id:parent.id,section:parent.section,paragraph:parent.paragraph,cell_path:parent.cell_path,control:index,record_index:at,table_record:tableAt,end,cells,dimensions:{rowCount:p.getUint16(4,true),colCount:p.getUint16(6,true),cellCount:cells.length},properties:{tableWidth:r.payload.length>=24?view(r.payload).getUint32(16,true):0,tableHeight:r.payload.length>=24?view(r.payload).getUint32(20,true):0}};
   try{validate(table,records);table.axis_editable=true;}catch(error){table.axis_editable=false;table.read_only_reason=error.code;}tables.push(table);
  }
 }
 return tables;
}
function validate(table,records){
 const {rowCount:rows,colCount:cols}=table.dimensions,control=records[table.record_index],data=records[table.table_record].payload;
 if(!rows||!cols||rows>50||cols>50||rows*cols>256||table.cells.length!==rows*cols||table.cells.some((c,i)=>c.row!==Math.floor(i/cols)||c.col!==i%cols||c.rowSpan!==1||c.colSpan!==1))fail('RECTANGULAR_TABLE_REQUIRED');
 if(control.payload.length<24||data.length!==22+rows*2||view(data).getUint16(data.length-2,true)!==0||Array.from({length:rows},(_,i)=>view(data).getUint16(18+i*2,true)).some(n=>n!==cols))fail('TABLE_RECORD_PROFILE_UNSUPPORTED');
 const widths=table.cells.filter(c=>c.row===0).map(c=>c.width),heights=table.cells.filter(c=>c.col===0).map(c=>c.height);
 if(!table.properties.tableWidth||!table.properties.tableHeight||widths.some(n=>!n)||heights.some(n=>!n)||widths.reduce((a,b)=>a+b,0)!==table.properties.tableWidth||table.cells.some(c=>c.width!==widths[c.col]||c.height!==heights[c.row]))fail('TABLE_GEOMETRY_UNSUPPORTED');
 for(const c of table.cells){if(!c.blocks.length||view(records[c.start].payload).getUint16(0,true)!==c.blocks.length||c.blocks.some(b=>!b.text_mapping_verified))fail('TABLE_CELL_PROFILE_UNSUPPORTED');}
}
function checkedText(value){if(typeof value!=='string'||!value.isWellFormed()||/[\u0000-\u0009\u000b-\u001f]/.test(value)||value.length>100000||value.split('\n').length>100)fail('INVALID_TABLE_TEXTS');return value;}
export function prepareComplexTable(before,block,op){
 const adding=op.type.startsWith('insert_'),rowAxis=op.type.endsWith('_row'),schema=['type','target_id','expected_old','index',adding?'texts':'expected_cells'];if(!equal(Object.keys(op).sort(),schema.sort()))fail('INVALID_OPERATION');
 if(!block.cell_path.length)fail('TABLE_CELL_REQUIRED');const records=before.recordSets.get(block.section),path=block.cell_path.at(-1),parent=block.cell_path.slice(0,-1),table=before.tables.find(t=>t.section===block.section&&t.paragraph===block.paragraph&&t.control===path.controlIndex&&equal(t.cell_path,parent));
 if(!table)fail('TABLE_TARGET_REQUIRED');validate(table,records);const {rowCount:rows,colCount:cols}=table.dimensions,length=rowAxis?rows:cols,index=op.index;
 if(!Number.isSafeInteger(index)||index<0||index>length-(adding?0:1))fail('INVALID_TABLE_INDEX');
 const newRows=rows+(rowAxis?(adding?1:-1):0),newCols=cols+(!rowAxis?(adding?1:-1):0);if(!newRows||!newCols||newRows>50||newCols>50||newRows*newCols>256)fail('INVALID_TABLE_DIMENSIONS');
 const axis=rowAxis?'row':'col',removed=adding?[]:table.cells.filter(c=>c[axis]===index);
 if(adding){if(!Array.isArray(op.texts)||op.texts.length!==(rowAxis?cols:rows)||op.texts.reduce((n,s)=>n+checkedText(s).length,0)>100000)fail('INVALID_TABLE_TEXTS');}
 else{if(!equal(op.expected_cells,removed.map(c=>c.blocks.map(b=>b.text))))fail('EXPECTED_TABLE_CELLS_MISMATCH');for(const c of removed)if(records.slice(c.start+1,c.end).some(r=>![66,67,68,69].includes(r.tag)))fail('TABLE_REMOVED_CELL_HAS_CONTROLS');}
 // Columns stay within the existing table width, including its parent cell.
 // Rows retain stored heights and increase/decrease the table's vertical size.
 const width=table.properties.tableWidth,weights=table.cells.filter(c=>c.row===0).map(c=>c.width),heights=table.cells.filter(c=>c.col===0).map(c=>c.height),oldHeightWeight=heights.reduce((a,b)=>a+b,0);
 if(rowAxis)heights.splice(index,adding?0:1,...(adding?[heights[Math.min(index,rows-1)]]:[]));else weights.splice(index,adding?0:1,...(adding?[weights[Math.min(index,cols-1)]]:[]));
 const total=weights.reduce((a,b)=>a+b,0),widths=rowAxis?weights:weights.map(n=>Math.floor(n*width/total));widths[newCols-1]+=width-widths.reduce((a,b)=>a+b,0);const newHeight=rowAxis?Math.round(table.properties.tableHeight*heights.reduce((a,b)=>a+b,0)/oldHeightWeight):table.properties.tableHeight;
 if(newHeight<1||newHeight>720000||widths.some(n=>n<1))fail('TABLE_GEOMETRY_UNSUPPORTED');
 if(!rowAxis&&table.cells.some(c=>records[c.start].payload.length!==47||view(records[c.start].payload).getUint32(34,true)!==c.width))fail('CELL_HEADER_PROFILE_UNSUPPORTED');
 const translated=c=>{if(!adding&&c[axis]===index)return null;return {...c,[axis]:c[axis]>=index?c[axis]+(adding?1:-1):c[axis]};};
 const retained=table.cells.map(translated).filter(Boolean),cells=[];const added=[];
 for(let row=0;row<newRows;row++)for(let col=0;col<newCols;col++){
  const old=retained.find(c=>c.row===row&&c.col===col),header=(old?records[old.start]:records[table.cells.find(c=>c.row===(rowAxis?Math.min(index,rows-1):row)&&c.col===(rowAxis?col:Math.min(index,cols-1))).start]).payload.slice(),h=view(header);
  h.setUint16(8,col,true);h.setUint16(10,row,true);
  if(!rowAxis){h.setUint32(16,widths[col],true);h.setUint32(34,widths[col],true);}
  if(old){
   const content=records.slice(old.start+1,old.end).map(r=>{if(!rowAxis&&r.tag===66){const payload=r.payload.slice();view(payload).setUint16(16,0,true);return {...r,payload,originHeader:r};}return r;}).filter(r=>rowAxis||r.tag!==69);
   if(!rowAxis){for(const r of content)if(r.tag===71&&controlId(r)===' osg'&&(r.payload.length<24||view(r.payload).getUint32(16,true)>widths[col]))fail('PICTURE_EXCEEDS_NEW_CELL_WIDTH');for(const child of before.tables.filter(t=>old.blocks.some(b=>b.id===t.parent_id)))if(child.properties.tableWidth>widths[col])fail('NESTED_TABLE_EXCEEDS_NEW_CELL_WIDTH');}
   cells.push({tag:72,level:records[old.start].level,payload:header},...content);
  }else{
   const template=table.cells.find(c=>c.row===(rowAxis?Math.min(index,rows-1):row)&&c.col===(rowAxis?col:Math.min(index,cols-1))),b=template.blocks[0];if(!b.unit_styles?.length)fail('TABLE_TEMPLATE_UNVERIFIED');
   const value=op.texts[rowAxis?col:row],text=Buffer.from(value+'\r','utf16le'),paragraph=records[b.record_index].payload.slice(),p=view(paragraph),shape=Buffer.alloc(8);shape.writeUInt32LE(b.unit_styles[0],4);
   h.setUint16(0,1,true);p.setUint32(0,(0x80000000|text.length/2)>>>0,true);p.setUint32(4,value.includes('\n')?1<<10:0,true);p.setUint16(12,1,true);p.setUint16(14,0,true);p.setUint16(16,0,true);p.setUint32(18,0,true);
   const level=records[b.record_index].level;cells.push({tag:72,level,payload:header},{tag:66,level,payload:paragraph},{tag:67,level:level+1,payload:text},{tag:68,level:level+1,payload:shape});added.push({row,col,text:value});
  }
 }
 const data=records[table.table_record].payload,newData=Buffer.alloc(22+newRows*2);newData.set(data.subarray(0,18));view(newData).setUint16(4,newRows,true);view(newData).setUint16(6,newCols,true);for(let row=0;row<newRows;row++)view(newData).setUint16(18+row*2,newCols,true);newData.set(data.subarray(18+rows*2),18+newRows*2);
 const body=records.slice(),tableHeader=records[table.record_index].payload.slice();view(tableHeader).setUint32(20,newHeight,true);body[table.record_index]={...records[table.record_index],payload:tableHeader};body[table.table_record]={...records[table.table_record],payload:newData};
 const first=table.cells[0].start;body.splice(first,table.end-first,...cells);
 const headers=new Map();let ordinal=0;for(const r of body)if(r.tag===66)headers.set(r.originHeader??r,ordinal++);
 const remap={};for(const b of before.blocks){const old=b.section===block.section?records[b.record_index]:null;remap[b.id]=b.section===block.section?(headers.has(old)?`s${b.section}:r${headers.get(old)}`:null):b.id;}
 return {records:body,table,remap,added,newRows,newCols,width,height:newHeight};
}
