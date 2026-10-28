/** Explicit row/column changes for plain rectangular tables; raw guards stay mandatory. */
import { GuardError } from './guard/records.mjs';
const fail=code=>{throw new GuardError(code);};
const equal=(a,b)=>JSON.stringify(a)===JSON.stringify(b);
const view=b=>new DataView(b.buffer,b.byteOffset,b.byteLength);
const copy=o=>structuredClone(o);
const tableRecord=r=>r.tag===77 || r.tag===71&&String.fromCharCode(...r.payload.subarray(0,4).toReversed())==='tbl ';
export function prepareTableChange(before,block,operation,sourceRecords,validateText) {
  if(block.kind!=='cell')fail('TABLE_CELL_REQUIRED');
  const table=before.tables.find(t=>t.section===block.section&&t.paragraph===block.paragraph&&t.control===block.control);
  if(!table || before.tables.filter(t=>t.section===block.section&&t.paragraph===block.paragraph).length!==1)fail('TABLE_HOST_PROFILE_UNSUPPORTED');
  const rowAxis=operation.type.endsWith('_row'),axis=rowAxis?'row':'col',adding=operation.type.startsWith('insert_');
  const {rowCount:rows,colCount:cols}=table.dimensions;
  const length=rowAxis?rows:cols,index=operation.index;
  if(!Number.isSafeInteger(index)||index<0||index>length-(adding?0:1))fail('INVALID_TABLE_INDEX');
  const newRows=rows+(rowAxis?(adding?1:-1):0),newCols=cols+(!rowAxis?(adding?1:-1):0);
  if(newRows<1||newCols<1||newRows>50||newCols>50||newRows*newCols>256)fail('INVALID_TABLE_DIMENSIONS');
  if(table.cells.length!==rows*cols||table.cells.some((c,i)=>c.cell!==i||c.row!==Math.floor(i/cols)||c.col!==i%cols||c.rowSpan!==1||c.colSpan!==1))fail('RECTANGULAR_TABLE_REQUIRED');
  const inTable=b=>b.section===table.section&&(b.paragraph??b.host)===table.paragraph;
  const isCell=b=>inTable(b)&&b.kind==='cell'&&b.control===table.control;
  const blocks=before.blocks.filter(isCell);
  for(const b of blocks) {
    if(!b.editable||b.style.char_shape_ids.length!==1||sourceRecords.get(b.id).some(r=>![66,67,68,69,72].includes(r.tag)))fail('TABLE_CELL_PROFILE_UNSUPPORTED');
  }
  if(adding) {
    if(!Array.isArray(operation.texts)||operation.texts.length!==(rowAxis?cols:rows)
      ||operation.texts.some(value=>validateText(value).includes('\n'))
      ||operation.texts.reduce((n,s)=>n+s.length,0)>100000)fail('INVALID_TABLE_TEXTS');
  } else {
    const removed=table.cells.filter(c=>c[axis]===index).map(c=>blocks.filter(b=>b.cell===c.cell).map(b=>b.text));
    if(!equal(operation.expected_cells,removed))fail('EXPECTED_TABLE_CELLS_MISMATCH');
  }
  const dimension=rowAxis?'tableHeight':'tableWidth';
  // The pinned engine scales uniform table geometry. More complex geometry
  // needs a separate proof, rather than allowing arbitrary size changes.
  const size=table.properties[dimension];
  if(!Number.isSafeInteger(size)||size<=0||size%length!==0)fail('TABLE_GEOMETRY_UNSUPPORTED');
  const newSize=size/length*(length+(adding?1:-1));
  const translatedCell=old=>{
    const row=old.row,col=old.col??old.column,pos=rowAxis?row:col;
    if(!adding&&pos===index)return null;
    const changed=pos>=index?pos+(adding?1:-1):pos;
    return {row:rowAxis?changed:row,col:rowAxis?col:changed};
  };
  const freshCoordinates=new Set();
  if(adding)for(let i=0;i<(rowAxis?newCols:newRows);i++)freshCoordinates.add(rowAxis?`${index}:${i}`:`${i}:${index}`);
  const header=r=>inTable(r)?translatedCell({row:view(r.payload).getUint16(10,true),col:view(r.payload).getUint16(8,true)}):{};
  const patchHeader=(r,payload)=>{if(!inTable(r))return;const translated=header(r);if(!translated)fail('TABLE_HEADER_MAPPING_FAILED');view(payload).setUint16(10,translated.row,true);view(payload).setUint16(8,translated.col,true);};
  const translate=old=>{
    if(!isCell(old))return copy(old);
    const position=translatedCell(old);if(!position)return null;
    const b=copy(old);b.row=position.row;b.column=position.col;b.cell=position.row*newCols+position.col;
    b.id=`s${b.section}:p${b.paragraph}:t${b.control}:c${b.cell}:p${b.cell_paragraph}`;return b;
  };
  function apply(doc) {
    const args=[table.section,table.paragraph,table.control];
    const method=adding?(rowAxis?'insertTableRow':'insertTableColumn'):(rowAxis?'deleteTableRow':'deleteTableColumn');
    const response=JSON.parse(doc[method](...args,...(adding?[Math.max(0,index-1),index>0]:[index])));
    if(!response.ok||response.rowCount!==newRows||response.colCount!==newCols)fail('ENGINE_OPERATION_FAILED');
    if(adding)operation.texts.forEach((value,i)=>{
      const row=rowAxis?index:i,col=rowAxis?i:index,cell=row*newCols+col;
      const template=table.cells.find(c=>c.row===(rowAxis?Math.min(index,rows-1):row)&&c.col===(rowAxis?col:Math.min(index,cols-1)));
      const old=blocks.find(b=>b.cell===template.cell&&b.cell_paragraph===0);
      for(const result of [doc.insertTextInCell(...args,cell,0,0,value),
        doc.setCharShapeIdInCell(...args,cell,0,0,[...value].length,old.style.char_shape_ids[0]),
        doc.setCellParaShapeId(...args,cell,0,old.style.paragraph.paraShapeId)])if(!JSON.parse(result).ok)fail('ENGINE_OPERATION_FAILED');
    });
  }
  function verifyHostRecords(left,right,compareRecords) {
    compareRecords(left.filter(r=>!tableRecord(r)),right.filter(r=>!tableRecord(r)),false);
    const a=left.filter(tableRecord),b=right.filter(tableRecord);
    if(a.length!==2||b.length!==2||a.some((r,i)=>r.tag!==b[i].tag||r.level!==b[i].level))fail('TABLE_RECORD_MISMATCH');
    for(let i=0;i<a.length;i++) {
      const old=a[i].payload,saved=b[i].payload;
      if(a[i].tag===71) {
        if(![42,46].includes(old.length)||saved.length!==46||old.length===46&&old.subarray(42).some(v=>v!==0))fail('TABLE_CONTROL_PROFILE_UNSUPPORTED');
        const expected=new Uint8Array(46);expected.set(old);
        if(view(old).getUint32(rowAxis?20:16,true)!==size)fail('TABLE_GEOMETRY_UNSUPPORTED');
        view(expected).setUint32(rowAxis?20:16,newSize,true);
        if(!equal([...expected],[...saved]))fail('TABLE_RECORD_MISMATCH');
      } else {
        if(old.length!==22+2*rows||view(old).getUint16(4,true)!==rows||view(old).getUint16(6,true)!==cols
          ||Array.from({length:rows},(_,r)=>view(old).getUint16(18+2*r,true)).some(n=>n!==cols)
          ||view(old).getUint16(old.length-2,true)!==0)fail('TABLE_RECORD_PROFILE_UNSUPPORTED');
        const expected=new Uint8Array(22+2*newRows);expected.set(old.subarray(0,18));
        view(expected).setUint16(4,newRows,true);view(expected).setUint16(6,newCols,true);
        for(let row=0;row<newRows;row++)view(expected).setUint16(18+2*row,newCols,true);
        expected.set(old.subarray(18+2*rows),18+2*newRows);
        if(!equal([...expected],[...saved]))fail('TABLE_RECORD_MISMATCH');
      }
    }
  }
  function verifyTable(after,inserted) {
    const saved=after.tables.find(t=>t.id===table.id);
    const expectedProperties={...table.properties,[dimension]:newSize};
    if(!saved||!equal(saved.properties,expectedProperties)||!equal(saved.dimensions,{rowCount:newRows,colCount:newCols,cellCount:newRows*newCols}))fail('TABLE_CONTENT_MISMATCH');
    for(const old of table.cells) {
      const position=translatedCell(old);if(!position)continue;
      const cell=position.row*newCols+position.col,expected={...copy(old),id:`${table.id}:c${cell}`,cell,...position};
      expected.paragraph_ids=old.paragraph_ids.map(id=>translate(before.blocks.find(b=>b.id===id)).id);
      if(!equal(expected,saved.cells[cell]))fail('TABLE_CELL_PRESERVATION_MISMATCH');
    }
    if(inserted.length!==(adding?operation.texts.length:0))fail('TABLE_CONTENT_MISMATCH');
    inserted.forEach(b=>{
      const i=rowAxis?b.column:b.row;
      if(!isCell(b)||!freshCoordinates.has(`${b.row}:${b.column}`)||b.cell_paragraph!==0||b.text!==operation.texts[i]
        ||b.row_span!==1||b.column_span!==1||b.style.char_shape_ids.length!==1)fail('TABLE_CONTENT_MISMATCH');
      const template=table.cells.find(c=>c.row===(rowAxis?Math.min(index,rows-1):b.row)&&c.col===(rowAxis?b.column:Math.min(index,cols-1)));
      const original=blocks.find(x=>x.cell===template.cell&&x.cell_paragraph===0);
      if(!equal(original.style.paragraph,b.style.paragraph)||!equal(original.style.char_shape_ids,b.style.char_shape_ids))fail('TABLE_CONTENT_MISMATCH');
      const actual=saved.cells[b.cell];
      if(!equal(actual.properties,template.properties)||actual.rowSpan!==1||actual.colSpan!==1||actual.paragraph_ids.length!==1)fail('TABLE_CELL_PRESERVATION_MISMATCH');
    });
  }
  return {table,header,patchHeader,inTable,freshCoordinates,translate,apply,verifyHostRecords,verifyTable};
}
