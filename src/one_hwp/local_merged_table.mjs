/** Split/merge existing cells without discarding their paragraphs or opaque headers. */
import {GuardError,parseRecords} from '../../probes/sites-runtime/guard/records.mjs';
import {textControlBytes} from '../../probes/sites-runtime/guard/preservation.mjs';
import {packStructuralBodyRepairs} from '../../probes/sites-runtime/engine/structural-body-repair.mjs';
const fail=code=>{throw new GuardError(code);};
const equal=(a,b)=>JSON.stringify(a)===JSON.stringify(b);
const view=b=>new DataView(b.buffer,b.byteOffset,b.byteLength);
const copy=o=>structuredClone(o);
const tableRecord=r=>r.tag===77||r.tag===71&&String.fromCharCode(...r.payload.subarray(0,4).toReversed())==='tbl ';
export function prepareMergedTableChange(before,block,operation,records) {
 if(block.kind!=='cell')fail('TABLE_CELL_REQUIRED');
 const table=before.tables.find(t=>t.section===block.section&&t.paragraph===block.paragraph&&t.control===block.control);
 if(!table||before.tables.filter(t=>t.section===block.section&&t.paragraph===block.paragraph).length!==1)fail('TABLE_HOST_PROFILE_UNSUPPORTED');
 const splitting=operation.type==='split_table_cell',target=table.cells.find(c=>c.cell===block.cell);
 const inTable=b=>b.section===table.section&&(b.paragraph??b.host)===table.paragraph;
 const isCell=b=>inTable(b)&&b.kind==='cell'&&b.control===table.control;
 const sourceBlocks=before.blocks.filter(isCell),range=splitting
  ?{top:target.row,left:target.col,bottom:target.row+target.rowSpan-1,right:target.col+target.colSpan-1}:operation.range;
 if(!range||!equal(Object.keys(range).sort(),['bottom','left','right','top'])||Object.values(range).some(n=>!Number.isSafeInteger(n)||n<0)
  ||range.bottom<range.top||range.right<range.left||range.bottom>=table.dimensions.rowCount||range.right>=table.dimensions.colCount)fail('INVALID_CELL_RANGE');
 const selected=table.cells.filter(c=>c.row<=range.bottom&&c.row+c.rowSpan>range.top&&c.col<=range.right&&c.col+c.colSpan>range.left);
 if(selected.some(c=>c.row<range.top||c.col<range.left||c.row+c.rowSpan-1>range.bottom||c.col+c.colSpan-1>range.right))fail('CELL_RANGE_CROSSES_MERGE');
 const coverage=new Set();
 for(const c of selected)for(let r=c.row;r<c.row+c.rowSpan;r++)for(let col=c.col;col<c.col+c.colSpan;col++){
  const key=`${r}:${col}`;if(coverage.has(key))fail('TABLE_GRID_UNVERIFIED');coverage.add(key);
 }
 if(coverage.size!==(range.bottom-range.top+1)*(range.right-range.left+1)||coverage.size>256)fail('TABLE_GRID_UNVERIFIED');
 if(splitting&&target.rowSpan===1&&target.colSpan===1)fail('MERGED_CELL_REQUIRED');
 if(!splitting&&(selected.length<2||selected[0].cell!==block.cell||selected[0].row!==range.top||selected[0].col!==range.left))fail('MERGE_TOP_LEFT_REQUIRED');
 const selectedBlocks=selected.map(c=>sourceBlocks.filter(b=>b.cell===c.cell));
 if(!equal(operation.expected_cells,selectedBlocks.map(list=>list.map(b=>b.text))))fail('EXPECTED_TABLE_CELLS_MISMATCH');
 for(const b of selectedBlocks.flat())if(!b.editable||b.style.char_shape_ids?.length!==1||records.get(b.id).some(r=>![66,67,68,69,72].includes(r.tag)
  ||r.tag===67&&!equal([...textControlBytes(r.payload)],[13,0])))fail('TABLE_CELL_PROFILE_UNSUPPORTED');
 const retainedLists=selectedBlocks.map((list,i)=>splitting||i===0?list:list.filter(b=>b.text.length));
 const first=selected[0],template=selectedBlocks[0][0],expectedCells=table.cells.filter(c=>!selected.includes(c)).map(copy);
 const geometry=[];
 if(splitting) {
  const width=first.properties.width,height=first.properties.height;
  if(!Number.isSafeInteger(width)||!Number.isSafeInteger(height)||width<first.colSpan||height<first.rowSpan)fail('TABLE_GEOMETRY_UNSUPPORTED');
  for(let r=0;r<first.rowSpan;r++)for(let c=0;c<first.colSpan;c++)geometry.push({row:first.row+r,col:first.col+c,
   width:Math.floor(width/first.colSpan)+(c===first.colSpan-1?width%first.colSpan:0),
   height:Math.floor(height/first.rowSpan)+(r===first.rowSpan-1?height%first.rowSpan:0)});
  for(const g of geometry)expectedCells.push({...copy(first),row:g.row,col:g.col,rowSpan:1,colSpan:1,properties:{...copy(first.properties),width:g.width,height:g.height}});
 } else {
  const horizontal=selected.filter(c=>c.row===range.top),vertical=selected.filter(c=>c.col===range.left);
  const width=horizontal.reduce((n,c)=>n+c.properties.width,0),height=vertical.reduce((n,c)=>n+c.properties.height,0);
  // Unequal edge geometry cannot be inferred from the cell grid alone.
  for(let r=range.top;r<=range.bottom;r++)if(selected.filter(c=>c.row<=r&&r<c.row+c.rowSpan).reduce((n,c)=>n+c.properties.width,0)!==width)fail('TABLE_GEOMETRY_UNSUPPORTED');
  for(let col=range.left;col<=range.right;col++)if(selected.filter(c=>c.col<=col&&col<c.col+c.colSpan).reduce((n,c)=>n+c.properties.height,0)!==height)fail('TABLE_GEOMETRY_UNSUPPORTED');
  expectedCells.push({...copy(first),rowSpan:range.bottom-range.top+1,colSpan:range.right-range.left+1,properties:{...copy(first.properties),width,height}});
 }
 expectedCells.sort((a,b)=>a.row-b.row||a.col-b.col);
 expectedCells.forEach((c,i)=>{c.cell=i;c.id=`${table.id}:c${i}`;});
 const cellAt=(row,col)=>expectedCells.find(c=>c.row===row&&c.col===col);
 const tableHeaders=raw=>{
  const result=[];for(const {section} of raw.profile.sections){let host=-1;
   for(const r of parseRecords(raw.streams.get(`BodyText/Section${section}`))){if(r.tag===66&&r.level===0)host++;
    if(r.tag===72&&section===table.section&&host===table.paragraph)result.push({...r,section,host});
   }}return result;
 };
 const selectedIds=new Set(selected.map(c=>c.cell)),freshCoordinates=new Set(splitting?geometry.slice(1).map(c=>`${c.row}:${c.col}`):[]);
 const translate=old=>{
  if(!isCell(old))return copy(old);
  const original=table.cells.find(c=>c.cell===old.cell),merged=selectedIds.has(old.cell)&&!splitting;
  if(merged&&!retainedLists.flat().some(b=>b.id===old.id))return null;
  const cell=cellAt(merged?first.row:original.row,merged?first.col:original.col),result=copy(old);
  result.cell=cell.cell;result.row=cell.row;result.column=cell.col;result.row_span=cell.rowSpan;result.column_span=cell.colSpan;
  if(merged){const list=selected.findIndex(c=>c.cell===old.cell);result.cell_paragraph=retainedLists.slice(0,list).reduce((n,items)=>n+items.length,0)+retainedLists[list].findIndex(b=>b.id===old.id);}
  result.id=`${table.id}:c${result.cell}:p${result.cell_paragraph}`;return result;
 };
 const header=r=>{
  if(!inTable(r))return {};
  const row=view(r.payload).getUint16(10,true),col=view(r.payload).getUint16(8,true);
  if(!splitting&&selected.some(c=>c.row===row&&c.col===col)&&!(row===first.row&&col===first.col))return null;
  return cellAt(row,col);
 };
 const patchHeader=(r,payload)=>{
  if(!inTable(r))return;const saved=header(r);if(!saved)fail('TABLE_HEADER_MAPPING_FAILED');
  if(r.preparedHeader)return;
  const row=view(r.payload).getUint16(10,true),col=view(r.payload).getUint16(8,true);
  if(!selected.some(c=>c.row===row&&c.col===col)&&!freshCoordinates.has(`${row}:${col}`))return;
  if(payload.length!==47||view(r.payload).getUint32(34,true)!==view(r.payload).getUint32(16,true))fail('CELL_HEADER_PROFILE_UNSUPPORTED');
  const v=view(payload);v.setUint16(12,saved.colSpan,true);v.setUint16(14,saved.rowSpan,true);
  v.setUint32(16,saved.properties.width,true);v.setUint32(20,saved.properties.height,true);
  // The parsed minimum-width cache mirrors width in this verified profile.
  v.setUint32(34,splitting?Math.floor(first.properties.width/first.colSpan):saved.properties.width,true);
 };
 const extraHeaderPairs=(beforeRaw,afterRaw)=>{
  if(!splitting)return [];const original=tableHeaders(beforeRaw).find(r=>view(r.payload).getUint16(10,true)===first.row&&view(r.payload).getUint16(8,true)===first.col);
  return tableHeaders(afterRaw).filter(r=>freshCoordinates.has(`${view(r.payload).getUint16(10,true)}:${view(r.payload).getUint16(8,true)}`)).map(saved=>{
   const payload=original.payload.slice(),v=view(payload);v.setUint16(0,1,true);v.setUint16(8,view(saved.payload).getUint16(8,true),true);v.setUint16(10,view(saved.payload).getUint16(10,true),true);
   const expected={...original,payload};patchHeader(expected,payload);expected.preparedHeader=true;return [expected,saved];
  });
 };
 function apply(doc) {
  const args=[table.section,table.paragraph,table.control],response=JSON.parse(splitting?doc.splitTableCell(...args,first.row,first.col)
   :doc.mergeTableCells(...args,range.top,range.left,range.bottom,range.right));
  if(!response.ok||response.cellCount!==expectedCells.length)fail('ENGINE_OPERATION_FAILED');
 }
 function repairCandidate(bytes,raw) {
  const patches=new Map();
  for(const r of tableHeaders(raw)){
   if(!splitting){const v=view(r.payload);if(v.getUint16(10,true)!==first.row||v.getUint16(8,true)!==first.col)continue;
    const desired=cellAt(first.row,first.col);if(r.payload.length!==47||v.getUint16(12,true)!==desired.colSpan||v.getUint16(14,true)!==desired.rowSpan)fail('CELL_HEADER_PROFILE_UNSUPPORTED');
    if(v.getUint32(16,true)===desired.properties.width&&v.getUint32(20,true)===desired.properties.height&&v.getUint32(34,true)===desired.properties.width)continue;
    // Merging uses the grid's inferred column sizes. The requested rectangle
    // retains the exact sum of the selected cells' actual edge dimensions.
    const name=`BodyText/Section${r.section}`,body=raw.streams.get(name);if(!patches.has(name))patches.set(name,body.slice());
    const changed=view(patches.get(name)),offset=r.payload.byteOffset-body.byteOffset;
    changed.setUint32(offset+16,desired.properties.width,true);changed.setUint32(offset+20,desired.properties.height,true);changed.setUint32(offset+34,desired.properties.width,true);continue;
   }
   const v=view(r.payload),g=geometry.find(c=>c.row===v.getUint16(10,true)&&c.col===v.getUint16(8,true));if(!g)continue;
   if(v.getUint32(16,true)!==Math.floor(first.properties.width/first.colSpan)||v.getUint32(20,true)!==Math.floor(first.properties.height/first.rowSpan))fail('TABLE_GEOMETRY_UNSUPPORTED');
   if(v.getUint32(16,true)===g.width&&v.getUint32(20,true)===g.height)continue;
   // Keep the exact total size instead of losing integer division remainders.
   // A raw same-length repair avoids the setter's unrelated whole-table resize.
   const name=`BodyText/Section${r.section}`,body=raw.streams.get(name);if(!patches.has(name))patches.set(name,body.slice());
   const changed=view(patches.get(name)),offset=r.payload.byteOffset-body.byteOffset;
   changed.setUint32(offset+16,g.width,true);changed.setUint32(offset+20,g.height,true);
  }
  return patches.size?packStructuralBodyRepairs(bytes,raw,patches).bytes:bytes;
 }
 function verifyHostRecords(left,right,compareRecords) {
  compareRecords(left.filter(r=>!tableRecord(r)),right.filter(r=>!tableRecord(r)),false);
  const a=left.filter(tableRecord),b=right.filter(tableRecord);
  if(a.length!==2||b.length!==2||a.some((r,i)=>r.tag!==b[i].tag||r.level!==b[i].level))fail('TABLE_RECORD_MISMATCH');
  for(let i=0;i<a.length;i++) {
   const old=a[i].payload,expected=old.slice();
   if(a[i].tag===77){const rows=table.dimensions.rowCount;if(old.length!==22+rows*2||view(old).getUint16(old.length-2,true)!==0)fail('TABLE_RECORD_PROFILE_UNSUPPORTED');
    for(let row=0;row<rows;row++){
     if(view(old).getUint16(18+row*2,true)!==table.cells.filter(c=>c.row===row).length)fail('TABLE_GRID_UNVERIFIED');
     view(expected).setUint16(18+row*2,expectedCells.filter(c=>c.row===row).length,true);
    }
   }
   if(!equal([...expected],[...b[i].payload]))fail('TABLE_RECORD_MISMATCH');
  }
 }
 function verifyTable(after,inserted,savedRecords) {
  const saved=after.tables.find(t=>t.id===table.id);
  if(!saved||!equal(saved.properties,table.properties)||!equal(saved.dimensions,{...table.dimensions,cellCount:expectedCells.length}))fail('TABLE_CONTENT_MISMATCH');
  for(const cell of expectedCells){const expected=copy(cell);expected.paragraph_ids=after.blocks.filter(b=>isCell(b)&&b.cell===cell.cell).map(b=>b.id);
   if(!equal(expected,saved.cells[cell.cell]))fail('TABLE_CELL_PRESERVATION_MISMATCH');
  }
  if(inserted.length!==freshCoordinates.size)fail('TABLE_CONTENT_MISMATCH');
  for(const b of inserted){if(!isCell(b)||!freshCoordinates.has(`${b.row}:${b.column}`)||b.cell_paragraph!==0||b.text!==''||!equal(b.style,template.style))fail('TABLE_CONTENT_MISMATCH');
   const actual=savedRecords.get(b.id).filter(r=>r.tag===72); // Its own header may belong to the preceding block.
   if(actual.some(r=>r.level!==2))fail('CELL_HEADER_PROFILE_UNSUPPORTED');
  }
  // New empty-cell headers inherit every opaque field from the selected cell.
  if(splitting){const tableRecords=source=>[...source.entries()].filter(([id])=>id.startsWith(`s${table.section}:p${table.paragraph}:`)||id===`s${table.section}:p${table.paragraph}`).flatMap(([,list])=>list);
   const all=tableRecords(savedRecords).filter(r=>r.tag===72),original=tableRecords(records).find(r=>r.tag===72&&view(r.payload).getUint16(10,true)===first.row&&view(r.payload).getUint16(8,true)===first.col);
   for(const coordinate of freshCoordinates){const [row,col]=coordinate.split(':').map(Number),actual=all.find(r=>r.tag===72&&view(r.payload).getUint16(10,true)===row&&view(r.payload).getUint16(8,true)===col);
    if(!actual||!original)fail('CELL_HEADER_MAPPING_FAILED');const expected=original.payload.slice(),v=view(expected),cell=cellAt(row,col);
    v.setUint16(0,1,true);v.setUint16(8,col,true);v.setUint16(10,row,true);v.setUint16(12,1,true);v.setUint16(14,1,true);v.setUint32(16,cell.properties.width,true);v.setUint32(20,cell.properties.height,true);v.setUint32(34,Math.floor(first.properties.width/first.colSpan),true);
    if(!equal([...expected],[...actual.payload]))fail('CELL_PRESERVATION_MISMATCH');
   }
  }
 }
 return {table,inTable,header,patchHeader,freshCoordinates,translate,apply,verifyHostRecords,verifyTable,extraHeaderPairs,repairCandidate};
}
