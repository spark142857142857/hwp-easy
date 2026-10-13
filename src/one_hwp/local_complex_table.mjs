/** Raw table geometry and cell subtrees; never round-trip unrelated controls. */
import {createHash} from 'node:crypto';
import {fail,view,equal,encodeRecords} from './local_complex_records.mjs';
const controlId=r=>Buffer.from(r.payload.subarray(0,4)).toString('ascii');
const extent=(records,at,limit)=>{let end=at+1;while(end<limit&&records[end].level>records[at].level)end++;return end;};
const sum=(values,start=0,count=values.length)=>values.slice(start,start+count).reduce((a,b)=>a+b,0);
const covers=(c,row,col)=>row>=c.row&&row<c.row+c.rowSpan&&col>=c.col&&col<c.col+c.colSpan;
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
    const subtree_sha256=createHash('sha256').update(encodeRecords(records.slice(start,stop))).digest('hex');
    return {cell,start,end:stop,row:h.getUint16(10,true),col:h.getUint16(8,true),rowSpan:h.getUint16(14,true),colSpan:h.getUint16(12,true),width:h.getUint32(16,true),height:h.getUint32(20,true),subtree_sha256,blocks:children.sort((a,b)=>a.cell_paragraph-b.cell_paragraph)};});
   const table={id:`${parent.id}:t${index}`,parent_id:parent.id,section:parent.section,paragraph:parent.paragraph,cell_path:parent.cell_path,control:index,record_index:at,table_record:tableAt,end,cells,dimensions:{rowCount:p.getUint16(4,true),colCount:p.getUint16(6,true),cellCount:cells.length},properties:{tableWidth:r.payload.length>=24?view(r.payload).getUint32(16,true):0,tableHeight:r.payload.length>=24?view(r.payload).getUint32(20,true):0,cellSpacing:p.getUint16(8,true),...Object.fromEntries(['paddingLeft','paddingRight','paddingTop','paddingBottom'].map((k,i)=>[k,p.getUint16(10+i*2,true)]))}};
   try{validate(table,records,false);table.layout_editable=true;}catch(error){table.layout_editable=false;}
   try{validate(table,records);table.axis_editable=true;}catch(error){table.axis_editable=false;table.read_only_reason=error.code;}tables.push(table);
  }
 }
 return tables;
}
/** Recover tracks only when existing span constraints determine every boundary. */
function tracks(table,axis){
 const count=table.dimensions[axis==='col'?'colCount':'rowCount'],span=axis+'Span',size=axis==='col'?'width':'height',edges=Array.from({length:count+1},()=>[]),positions=Array(count+1).fill(null);
 for(const c of table.cells){edges[c[axis]].push([c[axis]+c[span],c[size]]);edges[c[axis]+c[span]].push([c[axis],-c[size]]);}
 positions[0]=0;const queue=[0];
 for(let i=0;i<queue.length;i++)for(const [end,delta]of edges[queue[i]]){const value=positions[queue[i]]+delta;if(positions[end]===null){positions[end]=value;queue.push(end);}else if(positions[end]!==value)fail('TABLE_GEOMETRY_UNSUPPORTED');}
 if(positions.some(n=>n===null))fail('TABLE_TRACK_GEOMETRY_UNDETERMINED');
 const values=positions.slice(1).map((n,i)=>n-positions[i]);if(values.some(n=>n<1||n>720000))fail('TABLE_GEOMETRY_UNSUPPORTED');
 if(axis==='col'&&positions[count]!==table.properties.tableWidth)fail('TABLE_GEOMETRY_UNSUPPORTED');
 return values;
}
function validate(table,records,requireTracks=true){
 const {rowCount:rows,colCount:cols}=table.dimensions,control=records[table.record_index],data=records[table.table_record].payload;
 if(!rows||!cols||rows>50||cols>50||rows*cols>256||!table.cells.length)fail('INVALID_TABLE_DIMENSIONS');
 const grid=new Set();let previous=-1;
 for(const c of table.cells){
  const coordinate=c.row*cols+c.col;if(coordinate<=previous||!c.rowSpan||!c.colSpan||c.row+c.rowSpan>rows||c.col+c.colSpan>cols)fail('TABLE_GRID_UNVERIFIED');previous=coordinate;
  for(let row=c.row;row<c.row+c.rowSpan;row++)for(let col=c.col;col<c.col+c.colSpan;col++){const key=row*cols+col;if(grid.has(key))fail('TABLE_GRID_UNVERIFIED');grid.add(key);}
  if(!c.blocks.length||view(records[c.start].payload).getUint16(0,true)!==c.blocks.length||c.blocks.some(b=>!b.text_mapping_verified))fail('TABLE_CELL_PROFILE_UNSUPPORTED');
 }
 if(grid.size!==rows*cols)fail('TABLE_GRID_UNVERIFIED');
 if(control.payload.length<24||data.length!==22+rows*2||view(data).getUint16(data.length-2,true)!==0||Array.from({length:rows},(_,i)=>view(data).getUint16(18+i*2,true)).some((n,row)=>n!==table.cells.filter(c=>c.row===row).length))fail('TABLE_RECORD_PROFILE_UNSUPPORTED');
 if(!table.properties.tableWidth||!table.properties.tableHeight)fail('TABLE_GEOMETRY_UNSUPPORTED');
 return requireTracks?{widths:tracks(table,'col'),heights:tracks(table,'row')}:{};
}
function checkedText(value){if(typeof value!=='string'||!value.isWellFormed()||/[\u0000-\u0009\u000b-\u001f]/.test(value)||value.length>100000||value.split('\n').length>100)fail('INVALID_TABLE_TEXTS');return value;}
/** Width cache is observed in legacy 46-byte, 47-byte and named-cell headers. */
function patchWidth(header,oldWidth,width){
 if(width===oldWidth)return;
 if(header.length<38||view(header).getUint32(34,true)!==oldWidth)fail('CELL_HEADER_PROFILE_UNSUPPORTED');
 view(header).setUint32(16,width,true);view(header).setUint32(34,width,true);
}
function freshCell(before,records,template,geometry,value){
 const original=records[template.start].payload,b=template.blocks[0],oldShape=records[b.shape_record].payload;
 let inherited=b.unit_styles?.[0];
 // Legacy empty paragraphs can omit PARA_TEXT entirely. Their sole shape
 // anchor still proves the style for a newly materialized paragraph.
 if(inherited===undefined&&b.text===''&&b.tokens.length===0&&oldShape.length===8&&view(oldShape).getUint32(0,true)===0&&view(records[b.record_index].payload).getUint16(12,true)===1)inherited=view(oldShape).getUint32(4,true);
 if(!Number.isSafeInteger(inherited)||inherited>=before.character_definition_count)fail('TABLE_TEMPLATE_UNVERIFIED');
 // Copy cell styling, never duplicate a template's named-cell field identity.
 const header=Buffer.alloc(47);header.set(original.subarray(0,34));const h=view(header);
 h.setUint16(0,1,true);h.setUint16(8,geometry.col,true);h.setUint16(10,geometry.row,true);h.setUint16(12,1,true);h.setUint16(14,1,true);
 h.setUint32(16,geometry.width,true);h.setUint32(20,geometry.height,true);h.setUint32(34,geometry.width,true);
 const text=Buffer.from(value+'\r','utf16le'),paragraph=records[b.record_index].payload.slice(),p=view(paragraph),shape=Buffer.alloc(8);shape.writeUInt32LE(inherited,4);
 p.setUint32(0,(0x80000000|text.length/2)>>>0,true);p.setUint32(4,value.includes('\n')?1<<10:0,true);p.setUint16(12,1,true);p.setUint16(14,0,true);p.setUint16(16,0,true);p.setUint32(18,0,true);
 // Hancom requires the empty-cell profile without a literal CR-only text
 // record. The runner materializes text when that empty paragraph is edited.
 const level=records[b.record_index].level;return [{tag:72,level,payload:header},{tag:66,level,payload:paragraph},...(value?[{tag:67,level:level+1,payload:text}]:[]),{tag:68,level:level+1,payload:shape}];
}
function retainedCell(before,records,c,geometry){
 const header=records[c.start].payload.slice(),h=view(header);h.setUint16(8,geometry.col,true);h.setUint16(10,geometry.row,true);h.setUint16(12,geometry.colSpan,true);h.setUint16(14,geometry.rowSpan,true);h.setUint32(20,geometry.height,true);patchWidth(header,c.width,geometry.width);
 const widthChanged=c.width!==geometry.width,level=records[c.start].level;
 const content=records.slice(c.start+1,c.end).map(r=>{if(widthChanged&&r.tag===66&&r.level===level){const payload=r.payload.slice();view(payload).setUint16(16,0,true);return {...r,payload,originHeader:r};}return r;}).filter(r=>!widthChanged||r.tag!==69||r.level!==level+1);
 if(widthChanged){
  for(const r of content)if(r.tag===71&&controlId(r)===' osg'&&(r.payload.length<24||view(r.payload).getUint32(16,true)>geometry.width))fail('PICTURE_EXCEEDS_NEW_CELL_WIDTH');
  for(const child of before.tables.filter(t=>c.blocks.some(b=>b.id===t.parent_id)))if(child.properties.tableWidth>geometry.width)fail('NESTED_TABLE_EXCEEDS_NEW_CELL_WIDTH');
 }
 return [{...records[c.start],payload:header},...content];
}
function finish(before,block,table,records,cells,newRows,newCols,height,added){
 cells.sort((a,b)=>a.row-b.row||a.col-b.col);
 const data=records[table.table_record].payload,newData=Buffer.alloc(22+newRows*2);newData.set(data.subarray(0,18));view(newData).setUint16(4,newRows,true);view(newData).setUint16(6,newCols,true);
 for(let row=0;row<newRows;row++)view(newData).setUint16(18+row*2,cells.filter(c=>c.row===row).length,true);
 newData.set(data.subarray(18+table.dimensions.rowCount*2),18+newRows*2);
 const body=records.slice(),tableHeader=records[table.record_index].payload.slice();view(tableHeader).setUint32(20,height,true);body[table.record_index]={...records[table.record_index],payload:tableHeader};body[table.table_record]={...records[table.table_record],payload:newData};
 const first=table.cells[0].start;body.splice(first,table.end-first,...cells.flatMap(c=>c.records));
 const headers=new Map();let ordinal=0;for(const r of body)if(r.tag===66)headers.set(r.originHeader??r,ordinal++);
 const remap={};for(const b of before.blocks){const old=b.section===block.section?records[b.record_index]:null;remap[b.id]=b.section===block.section?(headers.has(old)?`s${b.section}:r${headers.get(old)}`:null):b.id;}
 return {records:body,table,remap,added,newRows,newCols,cellCount:cells.length,width:table.properties.tableWidth,height,expectedCells:cells.map(c=>({row:c.row,col:c.col,rowSpan:c.rowSpan,colSpan:c.colSpan,width:c.width,height:c.height}))};
}
export function prepareComplexTable(before,block,op){
 const records=before.recordSets.get(block.section),path=block.cell_path.at(-1);
 if(!path)fail('TABLE_CELL_REQUIRED');
 const table=before.tables.find(t=>t.section===block.section&&t.paragraph===block.paragraph&&t.control===path.controlIndex&&equal(t.cell_path,block.cell_path.slice(0,-1)));
 if(!table)fail('TABLE_TARGET_REQUIRED');validate(table,records,false);
 if(['resize_table_columns','resize_table_rows','format_cell','format_table'].includes(op.type))return prepareLayout(before,block,table,records,op);
 const split=op.type==='split_table_cell';
 const oldWidths=split&&Object.hasOwn(op,'widths')?explicitTracks(table,op.widths,'col'):tracks(table,'col'),oldHeights=split&&Object.hasOwn(op,'heights')?explicitTracks(table,op.heights,'row'):tracks(table,'row');
 if(['merge_table_cells','split_table_cell'].includes(op.type))return prepareCellBoundary(before,block,table,records,op,oldWidths,oldHeights);
 const adding=op.type.startsWith('insert_'),rowAxis=op.type.endsWith('_row'),schema=['type','target_id','expected_old','index',adding?'texts':'expected_cells'];
 if(!adding&&Object.hasOwn(op,'expected_cell_sha256'))schema.push('expected_cell_sha256');if(!equal(Object.keys(op).sort(),schema.sort()))fail('INVALID_OPERATION');
 const {rowCount:rows,colCount:cols}=table.dimensions,length=rowAxis?rows:cols,index=op.index;
 if(!Number.isSafeInteger(index)||index<0||index>length-(adding?0:1))fail('INVALID_TABLE_INDEX');
 const newRows=rows+(rowAxis?(adding?1:-1):0),newCols=cols+(!rowAxis?(adding?1:-1):0);if(!newRows||!newCols||newRows>50||newCols>50||newRows*newCols>256)fail('INVALID_TABLE_DIMENSIONS');
 const axis=rowAxis?'row':'col',span=axis+'Span',affected=table.cells.filter(c=>c[axis]<=index&&index<c[axis]+c[span]),removed=adding?[]:affected.filter(c=>c[span]===1);
 if(adding){if(!Array.isArray(op.texts)||op.texts.length!==(rowAxis?cols:rows)||op.texts.reduce((n,s)=>n+checkedText(s).length,0)>100000)fail('INVALID_TABLE_TEXTS');}
 else{
  if(!equal(op.expected_cells,affected.map(c=>c.blocks.map(b=>b.text))))fail('EXPECTED_TABLE_CELLS_MISMATCH');
  if(Object.hasOwn(op,'expected_cell_sha256')&&!equal(op.expected_cell_sha256,affected.map(c=>c.subtree_sha256)))fail('EXPECTED_CELL_SUBTREE_MISMATCH');
  if(removed.some(c=>records[c.start].payload.length>47||records.slice(c.start+1,c.end).some(r=>![66,67,68,69].includes(r.tag)))&&!Object.hasOwn(op,'expected_cell_sha256'))fail('TABLE_REMOVED_CELL_HAS_CONTROLS');
 }
 const weights=oldWidths.slice(),heights=oldHeights.slice();(rowAxis?heights:weights).splice(index,adding?0:1,...(adding?[(rowAxis?heights:weights)[Math.min(index,length-1)]]:[]));
 const width=table.properties.tableWidth,total=sum(weights),widths=rowAxis?weights:weights.map(n=>Math.floor(n*width/total));widths[newCols-1]+=width-sum(widths);
 const height=rowAxis?Math.round(table.properties.tableHeight*sum(heights)/sum(oldHeights)):table.properties.tableHeight;
 if(height<1||height>720000||widths.some(n=>n<1))fail('TABLE_GEOMETRY_UNSUPPORTED');
 const cells=[],added=[];
 for(const c of table.cells){if(removed.includes(c))continue;const geometry={...c};
  if(adding){if(c[axis]>=index)geometry[axis]++;else if(index<c[axis]+c[span])geometry[span]++;}
  else{if(c[axis]>index)geometry[axis]--;else if(index<c[axis]+c[span])geometry[span]--;}
  geometry.width=sum(widths,geometry.col,geometry.colSpan);geometry.height=sum(heights,geometry.row,geometry.rowSpan);
  cells.push({...geometry,records:retainedCell(before,records,c,geometry)});
 }
 if(adding)for(let i=0;i<(rowAxis?newCols:newRows);i++){
  const row=rowAxis?index:i,col=rowAxis?i:index,value=op.texts[i];
  if(cells.some(c=>covers(c,row,col))){if(value!=='')fail('TABLE_INSERT_TEXT_IN_MERGED_CELL');continue;}
  const template=table.cells.find(c=>covers(c,rowAxis?Math.min(index,rows-1):row,rowAxis?col:Math.min(index,cols-1))),geometry={row,col,rowSpan:1,colSpan:1,width:widths[col],height:heights[row]};
  cells.push({...geometry,records:freshCell(before,records,template,geometry,value)});added.push({row,col,text:value});
 }
 return finish(before,block,table,records,cells,newRows,newCols,height,added);
}
function prepareCellBoundary(before,block,table,records,op,widths,heights){
 const splitting=op.type==='split_table_cell',schema=['type','target_id','expected_old','expected_cells',...(splitting?['widths','heights'].filter(k=>Object.hasOwn(op,k)):['range'])];if(!equal(Object.keys(op).sort(),schema.sort()))fail('INVALID_OPERATION');
 const target=table.cells[block.cell_path.at(-1).cellIndex],range=splitting?{top:target.row,left:target.col,bottom:target.row+target.rowSpan-1,right:target.col+target.colSpan-1}:op.range;
 if(!range||!equal(Object.keys(range).sort(),['bottom','left','right','top'])||Object.values(range).some(n=>!Number.isSafeInteger(n)||n<0)||range.top>range.bottom||range.left>range.right||range.bottom>=table.dimensions.rowCount||range.right>=table.dimensions.colCount)fail('INVALID_CELL_RANGE');
 const selected=table.cells.filter(c=>c.row<=range.bottom&&c.row+c.rowSpan>range.top&&c.col<=range.right&&c.col+c.colSpan>range.left);
 if(selected.some(c=>c.row<range.top||c.col<range.left||c.row+c.rowSpan-1>range.bottom||c.col+c.colSpan-1>range.right))fail('CELL_RANGE_CROSSES_MERGE');
 if(splitting&&target.rowSpan===1&&target.colSpan===1)fail('MERGED_CELL_REQUIRED');
 if(!splitting&&(selected.length<2||target!==selected[0]||target.row!==range.top||target.col!==range.left))fail('MERGE_TOP_LEFT_REQUIRED');
 if(!equal(op.expected_cells,selected.map(c=>c.blocks.map(b=>b.text))))fail('EXPECTED_TABLE_CELLS_MISMATCH');
 const cells=table.cells.filter(c=>!selected.includes(c)).map(c=>({...c,records:records.slice(c.start,c.end)})),added=[];
 if(splitting){
  for(let row=range.top;row<=range.bottom;row++)for(let col=range.left;col<=range.right;col++){
   const geometry={row,col,rowSpan:1,colSpan:1,width:widths[col],height:heights[row]},first=row===range.top&&col===range.left;
   cells.push({...geometry,records:first?retainedCell(before,records,target,geometry):freshCell(before,records,target,geometry,'')});if(!first)added.push({row,col,text:''});
  }
 }else{
  // A single cell cannot retain multiple independent named-cell identities.
  if(selected.slice(1).some(c=>records[c.start].payload.length>47))fail('CELL_FIELD_MERGE_UNSUPPORTED');
  const geometry={row:range.top,col:range.left,rowSpan:range.bottom-range.top+1,colSpan:range.right-range.left+1,width:sum(widths,range.left,range.right-range.left+1),height:sum(heights,range.top,range.bottom-range.top+1)};
  const first=retainedCell(before,records,target,geometry),content=first.slice(1).concat(...selected.slice(1).map(c=>records.slice(c.start+1,c.end))),paragraphs=content.filter(r=>r.tag===66&&r.level===block.raw_level);
  if(paragraphs.length>65535)fail('TABLE_CELL_PROFILE_UNSUPPORTED');view(first[0].payload).setUint16(0,paragraphs.length,true);
  const last=paragraphs.at(-1),patched=content.map(r=>{if(!paragraphs.includes(r))return r;const payload=r.payload.slice(),h=view(payload);h.setUint32(0,((h.getUint32(0,true)&0x7fffffff)|(r===last?0x80000000:0))>>>0,true);h.setUint16(16,0,true);return {...r,payload,originHeader:r.originHeader??r};}).filter(r=>r.tag!==69||r.level!==block.raw_level+1);
  cells.push({...geometry,records:[first[0],...patched]});
 }
 return finish(before,block,table,records,cells,table.dimensions.rowCount,table.dimensions.colCount,table.properties.tableHeight,added);
}
function explicitTracks(table,values,axis){
 const count=table.dimensions[axis==='col'?'colCount':'rowCount'],size=axis==='col'?'width':'height';
 if(!Array.isArray(values)||values.length!==count||values.some(n=>!Number.isSafeInteger(n)||n<100||n>720000)||sum(values)>720000)fail('INVALID_TABLE_SIZES');
 if(table.cells.some(c=>sum(values,c[axis],c[axis+'Span'])!==c[size])||axis==='col'&&sum(values)!==table.properties.tableWidth)fail('TABLE_GEOMETRY_UNSUPPORTED');
 return values;
}

function prepareLayout(before,block,table,records,op){
 const resize=op.type.startsWith('resize_'),columns=op.type==='resize_table_columns',cellFormat=op.type==='format_cell',key=resize?(columns?'widths':'heights'):'props';
 if(!equal(Object.keys(op).sort(),['type','target_id','expected_old',key].sort()))fail('INVALID_OPERATION');
 let body=records.slice(),width=table.properties.tableWidth,height=table.properties.tableHeight;
 const expectedCells=table.cells.map(c=>({row:c.row,col:c.col,rowSpan:c.rowSpan,colSpan:c.colSpan,width:c.width,height:c.height}));
 let expectedProperties={...table.properties},expectedCellProperties;
 const paddings=['paddingLeft','paddingRight','paddingTop','paddingBottom'];
 if(resize){
  const values=op[key],count=table.dimensions[columns?'colCount':'rowCount'];
  if(!Array.isArray(values)||values.length!==count||values.some(n=>!Number.isSafeInteger(n)||n<100||n>720000)||sum(values)>720000)fail('INVALID_TABLE_SIZES');
  if(columns)width=sum(values);else height=sum(values);
  const control=records[table.record_index].payload.slice();view(control).setUint32(columns?16:20,columns?width:height,true);body[table.record_index]={...records[table.record_index],payload:control};
  for(const [i,c]of table.cells.entries()){
   const geometry={...c,[columns?'width':'height']:sum(values,c[columns?'col':'row'],c[columns?'colSpan':'rowSpan'])};
   const changed=retainedCell(before,records,c,geometry);body.splice(c.start,c.end-c.start,...changed,...Array(c.end-c.start-changed.length).fill(null));
   expectedCells[i][columns?'width':'height']=geometry[columns?'width':'height'];
  }
  body=body.filter(Boolean);expectedProperties={...expectedProperties,tableWidth:width,tableHeight:height};
 }else{
  const props=op.props,allowed=cellFormat?[...paddings,'applyInnerMargin','verticalAlign']:[...paddings,'cellSpacing'];
  if(!props||Object.getPrototypeOf(props)!==Object.prototype||!Object.keys(props).length||Object.keys(props).some(k=>!allowed.includes(k)))fail('INVALID_CELL_PROPERTIES');
  for(const [key,value]of Object.entries(props))if(key==='applyInnerMargin'?typeof value!=='boolean':key==='verticalAlign'?![0,1,2].includes(value):!Number.isSafeInteger(value)||value<0||value>65535)fail('INVALID_CELL_PROPERTIES');
  const selected=cellFormat?table.cells[block.cell_path.at(-1).cellIndex]:null,at=selected?.start??table.table_record,payload=records[at].payload.slice(),v=view(payload);
  for(let i=0;i<4;i++)if(Object.hasOwn(props,paddings[i]))v.setUint16((cellFormat?24:10)+i*2,props[paddings[i]],true);
  if(cellFormat){
   let flags=v.getUint32(4,true);if(Object.hasOwn(props,'applyInnerMargin'))flags=flags&~0x10000|(props.applyInnerMargin?0x10000:0);if(Object.hasOwn(props,'verticalAlign'))flags=flags&~0x60|(props.verticalAlign<<5);v.setUint32(4,flags>>>0,true);
   expectedCellProperties={cell:selected.cell,props};
  }else{if(Object.hasOwn(props,'cellSpacing'))v.setUint16(8,props.cellSpacing,true);expectedProperties={...expectedProperties,...props};}
  body[at]={...records[at],payload};
 }
 const unchanged=Buffer.from(encodeRecords(body)).equals(Buffer.from(encodeRecords(records)));
 return {records:body,table,remap:Object.fromEntries(before.blocks.map(b=>[b.id,b.id])),added:[],newRows:table.dimensions.rowCount,newCols:table.dimensions.colCount,cellCount:table.cells.length,width,height,expectedCells,expectedProperties,expectedCellProperties,layoutFormatting:true,unchanged};
}
export function complexCellProperties(records,cell){
 const h=view(records[cell.start].payload),flags=h.getUint32(4,true);
 return {width:cell.width,height:cell.height,applyInnerMargin:Boolean(flags&0x10000),verticalAlign:(flags>>>5)&3,...Object.fromEntries(['paddingLeft','paddingRight','paddingTop','paddingBottom'].map((k,i)=>[k,h.getUint16(24+i*2,true)]))};
}
