/** Row/column changes preserve surviving merged cells, with explicit geometry repairs. */
import {GuardError,parseRecords} from './guard/records.mjs';
import {packStructuralBodyRepairs} from './engine/structural-body-repair.mjs';
const fail=code=>{throw new GuardError(code);},equal=(a,b)=>JSON.stringify(a)===JSON.stringify(b);
const view=b=>new DataView(b.buffer,b.byteOffset,b.byteLength),copy=o=>structuredClone(o);
const tableRecord=r=>r.tag===77||r.tag===71&&Buffer.from(r.payload.subarray(0,4)).toString('ascii')===' lbt';
export function prepareMergedAxisChange(before,block,op,records,validateText){
 if(block.kind!=='cell')fail('TABLE_CELL_REQUIRED');
 const table=before.tables.find(t=>t.section===block.section&&t.paragraph===block.paragraph&&t.control===block.control);
 if(!table||before.tables.filter(t=>t.section===block.section&&t.paragraph===block.paragraph).length!==1)fail('TABLE_HOST_PROFILE_UNSUPPORTED');
 const rowAxis=op.type.endsWith('_row'),adding=op.type.startsWith('insert_'),axis=rowAxis?'row':'col',span=rowAxis?'rowSpan':'colSpan',dimension=rowAxis?'tableHeight':'tableWidth';
 const rows=table.dimensions.rowCount,cols=table.dimensions.colCount,length=rowAxis?rows:cols,index=op.index,reference=adding?Math.max(0,index-1):index;
 const newRows=rows+(rowAxis?(adding?1:-1):0),newCols=cols+(!rowAxis?(adding?1:-1):0);
 if(!Number.isSafeInteger(index)||index<0||index>length-(adding?0:1))fail('INVALID_TABLE_INDEX');
 if(newRows<1||newCols<1||newRows>512||newCols>128||newRows*newCols>4096)fail('INVALID_TABLE_DIMENSIONS');
 const inTable=b=>b.section===table.section&&(b.paragraph??b.host)===table.paragraph,isCell=b=>inTable(b)&&b.kind==='cell'&&b.control===table.control;
 const blocks=before.blocks.filter(isCell),coverage=new Set();
 for(const c of table.cells){if(c.row<0||c.col<0||c.row+c.rowSpan>rows||c.col+c.colSpan>cols)fail('TABLE_GRID_UNVERIFIED');
  for(let r=c.row;r<c.row+c.rowSpan;r++)for(let col=c.col;col<c.col+c.colSpan;col++){const k=`${r}:${col}`;if(coverage.has(k))fail('TABLE_GRID_UNVERIFIED');coverage.add(k);}}
 if(coverage.size!==rows*cols)fail('TABLE_GRID_UNVERIFIED');
 for(const b of blocks)if(records.get(b.id).some(r=>![66,67,68,69,72].includes(r.tag)))fail('TABLE_CELL_PROFILE_UNSUPPORTED');
 const widths=Array.from({length:cols},(_,i)=>Math.max(0,...table.cells.filter(c=>c.col===i&&c.colSpan===1).map(c=>c.properties.width))||1800);
 const heights=Array.from({length:rows},(_,i)=>Math.max(0,...table.cells.filter(c=>c.row===i&&c.rowSpan===1).map(c=>c.properties.height))||400);
 const unit=(rowAxis?heights:widths)[reference],size=table.properties[dimension];
 let displayUnit=unit;if(rowAxis&&size>heights.reduce((a,b)=>a+b,0)){const sum=heights.reduce((a,b)=>a+b,0),scaled=heights.map(h=>Math.max(1,Math.floor((h*size+sum/2)/sum)));scaled[rows-1]+=size-scaled.reduce((a,b)=>a+b,0);displayUnit=scaled[reference];}
 const newSize=size+(adding?displayUnit:-displayUnit);
 if(!Number.isSafeInteger(newSize)||newSize<=0||newSize>0xffffffff)fail('TABLE_GEOMETRY_UNSUPPORTED');
 const expectedCells=[],mapped=new Map();
 for(const original of table.cells){const c=copy(original),pos=c[axis],end=pos+c[span];
  if(!adding&&pos===index&&c[span]===1){mapped.set(original.cell,null);continue;}
  const crosses=adding?pos<index&&end>index:pos<=index&&end>index;
  if(crosses){c[span]+=adding?1:-1;const key=rowAxis?'height':'width';c.properties[key]+=adding?unit:-unit;if(c.properties[key]<=0)fail('TABLE_GEOMETRY_UNSUPPORTED');}
  if(adding?pos>=index:pos>index)c[axis]+=adding?1:-1;
  expectedCells.push(c);mapped.set(original.cell,c);
 }
 const covering=(r,c)=>expectedCells.find(x=>x.row<=r&&r<x.row+x.rowSpan&&x.col<=c&&c<x.col+x.colSpan),freshCoordinates=new Set(),templates=new Map();
 if(adding){if(!Array.isArray(op.texts)||op.texts.length!==(rowAxis?cols:rows)||op.texts.some(t=>validateText(t).includes('\n'))||op.texts.reduce((n,s)=>n+s.length,0)>100000)fail('INVALID_TABLE_TEXTS');
  for(let i=0;i<(rowAxis?cols:rows);i++){const row=rowAxis?index:i,col=rowAxis?i:index;if(covering(row,col)){if(op.texts[i]!=='')fail('MERGED_INSERT_TEXT_REQUIRES_EMPTY_SLOT');continue;}
   const other=rowAxis?'col':'row',otherSpan=rowAxis?'colSpan':'rowSpan';
   const tpl=expectedCells.find(c=>c[other]===i&&c[otherSpan]===1&&c[axis]===index+1)
    ??expectedCells.find(c=>index>0&&c[other]===i&&c[otherSpan]===1&&c[axis]===index-1)
    ??expectedCells.find(c=>c[other]===i&&c[otherSpan]===1)??expectedCells[0];
   if(!tpl)fail('TABLE_GRID_UNVERIFIED');const original=table.cells.find(c=>mapped.get(c.cell)===tpl),fresh={...copy(original),row,col,rowSpan:1,colSpan:1,properties:{...copy(original.properties),width:rowAxis?widths[i]:unit,height:rowAxis?unit:heights[i]}};
   expectedCells.push(fresh);freshCoordinates.add(`${row}:${col}`);templates.set(`${row}:${col}`,original);
  }
 }else{const affected=table.cells.filter(c=>c[axis]<=index&&index<c[axis]+c[span]);if(!equal(op.expected_cells,affected.map(c=>blocks.filter(b=>b.cell===c.cell).map(b=>b.text))))fail('EXPECTED_TABLE_CELLS_MISMATCH');}
 expectedCells.sort((a,b)=>a.row-b.row||a.col-b.col);expectedCells.forEach((c,i)=>{c.cell=i;c.id=`${table.id}:c${i}`;});
 const translate=old=>{if(!isCell(old))return copy(old);const c=mapped.get(old.cell);if(!c)return null;return {...copy(old),cell:c.cell,row:c.row,column:c.col,row_span:c.rowSpan,column_span:c.colSpan,id:`${table.id}:c${c.cell}:p${old.cell_paragraph}`};};
 const originalHeader=c=>[...records].filter(([id])=>id===`s${table.section}:p${table.paragraph}`||id.startsWith(`${table.id}:`)).flatMap(([,r])=>r).find(r=>r.tag===72&&view(r.payload).getUint16(10,true)===c.row&&view(r.payload).getUint16(8,true)===c.col);
 const header=r=>{if(!inTable(r))return {};const c=table.cells.find(c=>c.row===view(r.payload).getUint16(10,true)&&c.col===view(r.payload).getUint16(8,true));return c?mapped.get(c.cell):null;};
 const desiredHeader=(original,c,fresh=false)=>{if(original.payload.length!==47)fail('CELL_HEADER_PROFILE_UNSUPPORTED');const p=original.payload.slice(),v=view(p);if(fresh)v.setUint16(0,1,true);v.setUint16(8,c.col,true);v.setUint16(10,c.row,true);v.setUint16(12,c.colSpan,true);v.setUint16(14,c.rowSpan,true);
  const old=view(original.payload);if(old.getUint32(16,true)!==c.properties.width){if(old.getUint32(34,true)!==old.getUint32(16,true))fail('CELL_HEADER_PROFILE_UNSUPPORTED');v.setUint32(16,c.properties.width,true);v.setUint32(34,c.properties.width,true);}v.setUint32(20,c.properties.height,true);return p;};
 const patchHeader=(r,p)=>{if(!inTable(r)||r.preparedHeader)return;const c=header(r);if(!c)fail('TABLE_HEADER_MAPPING_FAILED');p.set(desiredHeader(r,c).subarray(2),2);};
 const allHeaders=raw=>{let host=-1;return [...parseRecords(raw.streams.get(`BodyText/Section${table.section}`))].filter(r=>{if(r.tag===66&&r.level===0)host++;return r.tag===72&&host===table.paragraph;}).map(r=>({...r,section:table.section,host:table.paragraph}));};
 const extraHeaderPairs=(beforeRaw,afterRaw)=>allHeaders(afterRaw).filter(r=>freshCoordinates.has(`${view(r.payload).getUint16(10,true)}:${view(r.payload).getUint16(8,true)}`)).map(saved=>{const key=`${view(saved.payload).getUint16(10,true)}:${view(saved.payload).getUint16(8,true)}`,c=expectedCells.find(c=>`${c.row}:${c.col}`===key),original=originalHeader(templates.get(key));return [{...saved,payload:desiredHeader(original,c,true),preparedHeader:true},saved];});
 function apply(doc){const args=[table.section,table.paragraph,table.control],method=adding?(rowAxis?'insertTableRow':'insertTableColumn'):(rowAxis?'deleteTableRow':'deleteTableColumn'),result=JSON.parse(doc[method](...args,...(adding?[reference,index>0]:[index])));if(!result.ok||result.rowCount!==newRows||result.colCount!==newCols)fail('ENGINE_OPERATION_FAILED');
  for(const key of freshCoordinates){const c=expectedCells.find(c=>`${c.row}:${c.col}`===key),tpl=blocks.find(b=>b.cell===templates.get(key).cell&&b.cell_paragraph===0),value=op.texts[rowAxis?c.col:c.row];if(!tpl.editable||tpl.style.char_shape_ids?.length!==1)fail('TABLE_TEMPLATE_STYLE_UNSUPPORTED');
   for(const response of [doc.insertTextInCell(...args,c.cell,0,0,value),doc.setCharShapeIdInCell(...args,c.cell,0,0,[...value].length,tpl.style.char_shape_ids[0]),doc.setCellParaShapeId(...args,c.cell,0,tpl.style.paragraph.paraShapeId)])if(!JSON.parse(response).ok)fail('ENGINE_OPERATION_FAILED');}}
 function repairCandidate(bytes,raw){const name=`BodyText/Section${table.section}`,body=raw.streams.get(name),patched=body.slice();
  for(const r of allHeaders(raw)){const c=expectedCells.find(c=>c.row===view(r.payload).getUint16(10,true)&&c.col===view(r.payload).getUint16(8,true));if(!c||r.payload.length!==47||view(r.payload).getUint16(12,true)!==c.colSpan||view(r.payload).getUint16(14,true)!==c.rowSpan)fail('TABLE_GRID_UNVERIFIED');
   // Repair only proven geometry; opaque fields still pass exact header checks.
   const offset=r.payload.byteOffset-body.byteOffset,v=view(patched);v.setUint32(offset+16,c.properties.width,true);v.setUint32(offset+20,c.properties.height,true);
   const original=table.cells.find(old=>mapped.get(old.cell)===c)??templates.get(`${c.row}:${c.col}`),wanted=desiredHeader(originalHeader(original),c,freshCoordinates.has(`${c.row}:${c.col}`));v.setUint32(offset+34,view(wanted).getUint32(34,true),true);
  }
  let host=-1;for(const r of parseRecords(body)){if(r.tag===66&&r.level===0)host++;if(host===table.paragraph&&r.tag===71&&Buffer.from(r.payload.subarray(0,4)).toString('ascii')===' lbt'){const offset=r.payload.byteOffset-body.byteOffset;view(patched).setUint32(offset+16,table.properties.tableWidth+(!rowAxis?(adding?unit:-unit):0),true);view(patched).setUint32(offset+20,rowAxis?newSize:table.properties.tableHeight,true);}}
  return packStructuralBodyRepairs(bytes,raw,new Map([[name,patched]])).bytes;
 }
 function verifyHostRecords(left,right,compare){compare(left.filter(r=>!tableRecord(r)),right.filter(r=>!tableRecord(r)),false);const a=left.filter(tableRecord),b=right.filter(tableRecord);if(a.length!==2||b.length!==2)fail('TABLE_RECORD_MISMATCH');
  for(let i=0;i<2;i++){if(a[i].tag!==b[i].tag||a[i].level!==b[i].level)fail('TABLE_RECORD_MISMATCH');const old=a[i].payload;let wanted;
   if(a[i].tag===71){if(old.length<42||b[i].payload.length!==Math.max(46,old.length))fail('TABLE_CONTROL_PROFILE_UNSUPPORTED');wanted=new Uint8Array(Math.max(46,old.length));wanted.set(old);view(wanted).setUint32(rowAxis?20:16,newSize,true);}
   else{if(old.length!==22+rows*2||view(old).getUint16(old.length-2,true)!==0)fail('TABLE_RECORD_PROFILE_UNSUPPORTED');wanted=new Uint8Array(22+newRows*2);wanted.set(old.subarray(0,18));view(wanted).setUint16(4,newRows,true);view(wanted).setUint16(6,newCols,true);for(let r=0;r<newRows;r++)view(wanted).setUint16(18+r*2,expectedCells.filter(c=>c.row===r).length,true);wanted.set(old.subarray(18+rows*2),18+newRows*2);}
   if(!equal([...wanted],[...b[i].payload]))fail('TABLE_RECORD_MISMATCH');}}
 function verifyTable(after,inserted,savedRecords){const saved=after.tables.find(t=>t.id===table.id);if(!saved||!equal(saved.properties,{...table.properties,[dimension]:newSize})||!equal(saved.dimensions,{rowCount:newRows,colCount:newCols,cellCount:expectedCells.length}))fail('TABLE_CONTENT_MISMATCH');
  for(const c of expectedCells){const wanted=copy(c);wanted.paragraph_ids=after.blocks.filter(b=>isCell(b)&&b.cell===c.cell).map(b=>b.id);if(!equal(wanted,saved.cells[c.cell]))fail('TABLE_CELL_PRESERVATION_MISMATCH');}
  if(inserted.length!==freshCoordinates.size)fail('TABLE_CONTENT_MISMATCH');for(const b of inserted){const key=`${b.row}:${b.column}`,tpl=templates.get(key),original=tpl&&blocks.find(x=>x.cell===tpl.cell&&x.cell_paragraph===0);if(!original||b.cell_paragraph!==0||b.text!==op.texts[rowAxis?b.column:b.row]||!equal(b.style,original.style))fail('TABLE_CONTENT_MISMATCH');}
  const actual=[...savedRecords].filter(([id])=>id===`s${table.section}:p${table.paragraph}`||id.startsWith(`${table.id}:`)).flatMap(([,r])=>r).filter(r=>r.tag===72&&r.level===2);for(const key of freshCoordinates){const c=expectedCells.find(c=>`${c.row}:${c.col}`===key),original=originalHeader(templates.get(key)),wanted=desiredHeader(original,c,true),r=actual.find(r=>view(r.payload).getUint16(10,true)===c.row&&view(r.payload).getUint16(8,true)===c.col);if(!r||!equal([...wanted],[...r.payload]))fail('CELL_PRESERVATION_MISMATCH');}}
 const orderHeaders=list=>{const selected=list.filter(inTable).sort((a,b)=>header(a).row-header(b).row||header(a).col-header(b).col);let i=0;return list.map(r=>inTable(r)?selected[i++]:r);};
 return {table,inTable,header,patchHeader,freshCoordinates,translate,apply,repairCandidate,verifyHostRecords,verifyTable,extraHeaderPairs,orderHeaders};
}
