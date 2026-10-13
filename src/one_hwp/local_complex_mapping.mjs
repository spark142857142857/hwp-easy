/** Bind model body/cell identities to raw hierarchy; never select by text. */
import {fail,view,equal} from './local_complex_records.mjs';

const controlId=r=>Buffer.from(r.payload.subarray(0,4)).toString('ascii');
const samePath=(a,b)=>equal(a,b);
function extent(records,start,limit=records.length){
 const level=records[start].level;let end=start+1;
 while(end<limit&&records[end].level>level)end++;
 return end;
}

export function mapComplexBlocks(recordSets,blocks,cursor){
 const mapped=new Map(),visited=new Set();
 for(const [section,records]of recordSets){
  const roots=records.map((r,i)=>r.tag===66&&r.level===0?i:-1).filter(i=>i>=0);
  const body=blocks.filter(b=>b.section===section&&b.kind==='paragraph');
  if(roots.length!==body.length)fail('TARGET_MAPPING_UNVERIFIED');
  const ordinals=new Map();let ordinal=0;
  records.forEach((r,i)=>{if(r.tag===66)ordinals.set(i,ordinal++);});
  function visit(block,start,end){
   if(mapped.has(block)||records[start]?.tag!==66||records[start].level!==block.cell_path.length*2)fail('TARGET_MAPPING_UNVERIFIED');
   mapped.set(block,{start,end,ordinal:ordinals.get(start)});
   const para=block.kind==='paragraph'?block.paragraph:block.cell_paragraph;
   const lists=cursor.lists.filter(l=>l.isCell&&l.sectionIndex===section&&l.hostListId===block.list_id&&l.hostPara===para);
   const controls=[];for(let i=start+1;i<end;i++)if(records[i].tag===71&&records[i].level===records[start].level+1)controls.push(i);
   const byControl=Map.groupBy(lists,l=>l.controlIndex);
   for(const [control,cellLists]of byControl){
    const at=controls[control],header=records[at];
    if(!header||controlId(header)!==' lbt')fail('TARGET_MAPPING_UNVERIFIED');
    const stop=extent(records,at,end),level=header.level+1;
    const tables=[],cells=[];
    for(let i=at+1;i<stop;i++)if(records[i].level===level){
     if(records[i].tag===77)tables.push(i);
     if(records[i].tag===72&&records[i].payload.length>=34)cells.push(i);
    }
    if(tables.length!==1||records[tables[0]].payload.length<18||cells.length!==cellLists.length||cells.some(i=>i<tables[0]))fail('TARGET_MAPPING_UNVERIFIED');
    const table=view(records[tables[0]].payload),rows=table.getUint16(4,true),columns=table.getUint16(6,true);
    if(!rows||!columns||rows>512||columns>512)fail('TARGET_MAPPING_UNVERIFIED');
    for(const list of cellLists){
     if(visited.has(list.listId)||!Number.isSafeInteger(list.cellIndex)||list.cellIndex<0||list.cellIndex>=cells.length||list.cellCount!==cells.length)fail('TARGET_MAPPING_UNVERIFIED');
     visited.add(list.listId);
     const cell=cells[list.cellIndex],next=cells[list.cellIndex+1]??stop,p=view(records[cell].payload);
     if(p.getUint16(0,true)!==list.paraCount||p.getUint16(8,true)!==list.col||p.getUint16(10,true)!==list.row||p.getUint16(12,true)!==list.colSpan||p.getUint16(14,true)!==list.rowSpan||list.row<0||list.col<0||list.rowSpan<1||list.colSpan<1||list.row+list.rowSpan>rows||list.col+list.colSpan>columns)fail('TARGET_MAPPING_UNVERIFIED');
     const paragraphs=[];for(let i=cell+1;i<next;i++)if(records[i].tag===66&&records[i].level===level)paragraphs.push(i);
     if(paragraphs.length!==list.paraCount)fail('TARGET_MAPPING_UNVERIFIED');
     for(let p=0;p<paragraphs.length;p++){
      const path=[...block.cell_path,{controlIndex:control,cellIndex:list.cellIndex,cellParaIndex:p}];
      const child=blocks.find(b=>b.section===section&&b.paragraph===block.paragraph&&b.list_id===list.listId&&samePath(b.cell_path,path));
      if(!child)fail('TARGET_MAPPING_UNVERIFIED');
      visit(child,paragraphs[p],extent(records,paragraphs[p],next));
     }
    }
   }
  }
  body.forEach((b,p)=>visit(b,roots[p],extent(records,roots[p])));
 }
 if(mapped.size!==blocks.length)fail('TARGET_MAPPING_UNVERIFIED');
 return mapped;
}
