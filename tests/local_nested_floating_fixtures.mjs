/** First-row nested cells with explicit minimum room; synthetic HWP only. */
import {HwpDocument} from '@rhwp/core';
import {parseRecords} from '../src/one_hwp/guard/records.mjs';
import {publishVerifiedPatch} from '../src/one_hwp/local_verified_patch.mjs';
import {nestedFixture} from './local_complex_fixtures.mjs';
import {cellBoxFixture} from './local_placement_fixtures.mjs';
import {inspectLocalComplex} from '../src/one_hwp/local_complex.mjs';
import {spliceRawParagraph,view,encodeRecords} from '../src/one_hwp/local_complex_records.mjs';
import {packLocalBodyRewrite} from '../src/one_hwp/local_body_write.mjs';
import {prepareComplexBoundary} from '../src/one_hwp/local_complex_boundary.mjs';
import {invalidateSectionLayout} from '../src/one_hwp/local_layout_cache.mjs';

export function nestedFloatingFixture({depth=2,prefix='문항',hostText='inner label',outerCell=0,innerCell=0,padding=null,narrow=false,secondRow=false,laterParagraph=false,rowRoom=false,alignment=0,ancestorAlignment=[],merge=null,room=12000,emptyLineFontSize=null}={}){
 let source=nestedFixture(undefined,{rows:secondRow||rowRoom?2:1,merge});
 if(depth>2){const s=inspectLocalComplex(HwpDocument,source,{includeDocumentInfo:false,verifyCharacterModel:false}),r=s.recordSets.get(0),t=s.tables.find(t=>t.cell_path.length===1);view(r[t.record_index].payload).setUint32(16,20000,true);for(const c of t.cells)for(const at of [16,34])view(r[c.start].payload).setUint32(at,10000,true);source=packLocalBodyRewrite(source,s.raw,new Map([['BodyText/Section0',encodeRecords(r)]]));}
 for(let i=2;i<depth;i++)source=nestedFixture(source,{inside_nested:true});
 let bytes=cellBoxFixture({nested:true,cellRelative:true,source,depth}),state=inspectLocalComplex(HwpDocument,bytes,{includeDocumentInfo:false,verifyCharacterModel:false}),rs=state.recordSets.get(0);
 for(const table of state.tables){for(const c of table.cells){const v=view(rs[c.start].payload);v.setUint32(4,v.getUint32(4,true)&~0x60,true);if(c.row===0||rowRoom)v.setUint32(20,(depth-table.cell_path.length)*room*c.rowSpan,true);if(padding){v.setUint32(4,v.getUint32(4,true)|0x10000,true);padding.forEach((n,i)=>v.setUint16(24+i*2,n,true));}}
  const heights=Array.from({length:table.dimensions.rowCount},(_,row)=>Math.max(...table.cells.filter(c=>row>=c.row&&row<c.row+c.rowSpan).map(c=>view(rs[c.start].payload).getUint32(20,true)/c.rowSpan)));view(rs[table.record_index].payload).setUint32(20,heights.reduce((a,b)=>a+b,0),true);
 }
 const publish=()=>{bytes=packLocalBodyRewrite(bytes,state.raw,new Map([['BodyText/Section0',encodeRecords(rs)]]));state=inspectLocalComplex(HwpDocument,bytes,{includeDocumentInfo:false,verifyCharacterModel:false});rs=state.recordSets.get(0);};publish();
 for(let level=1;level<=depth;level++){const b=state.blocks.find(b=>b.cell_path.length===level&&b.cell_path.every(p=>p.cellIndex===0)),text=level===depth?hostText:prefix;rs=spliceRawParagraph(rs,b,0,[...b.text].length,text).records;publish();}
 const p=state.text_boxes[0].paragraphs[0];rs=spliceRawParagraph(rs,p,0,[...p.text].length,narrow?'X':'BOX').records;publish();
 if(narrow){const box=state.text_boxes[0],shape=rs[box.record_index+1],rect=rs.find((r,i)=>i>box.record_index&&i<box.records_end&&r.tag===79),base=Buffer.from(shape.payload.subarray(0,4)).equals(Buffer.from(shape.payload.subarray(4,8)))?8:4;view(rs[box.record_index].payload).setUint32(16,1500,true);for(const at of [12,20])view(shape.payload).setUint32(base+at,1500,true);for(const at of [9,17])view(rect.payload).setInt32(at,1500,true);publish();}
 function swap(table,target=1){const a=table.cells[0],b=table.cells[target],aa=rs.slice(a.start+1,a.end),bb=rs.slice(b.start+1,b.end);rs=rs.flatMap((r,i)=>i===a.start+1?bb:i===b.start+1?aa:i>a.start+1&&i<a.end||i>b.start+1&&i<b.end?[]:[r]);publish();}
 if(secondRow)swap(state.tables.find(t=>t.cell_path.length===depth-1),2);if(innerCell)swap(state.tables.find(t=>t.cell_path.length===depth-1));if(outerCell)swap(state.tables.find(t=>!t.cell_path.length));
 if(laterParagraph){const box=state.text_boxes[0],b=state.blocks.find(b=>b.id===box.block_id);rs=prepareComplexBoundary(state,b,{type:'split_paragraph',target_id:'fixture',expected_old:b.text,offset:0},'').records;publish();}
 if(emptyLineFontSize){const box=state.text_boxes[0],b=state.blocks.find(b=>b.cell_path.length===depth&&b.cell_path.slice(0,-1).every((p,i)=>JSON.stringify(p)===JSON.stringify(box.cell_path[i]))&&b.cell_path.at(-1).cellIndex===box.cell_path.at(-1).cellIndex&&b.text===''),defs=[...parseRecords(state.raw.streams.get('DocInfo'))].map(r=>({...r,payload:r.payload.slice()})),shapes=defs.filter(r=>r.tag===21),font=shapes[0].payload.slice();view(font).setUint32(42,emptyLineFontSize,true);view(defs.find(r=>r.tag===17).payload).setUint32(36,shapes.length+1,true);defs.splice(defs.indexOf(shapes.at(-1))+1,0,{tag:21,level:shapes[0].level,payload:font});rs=rs.map(r=>({...r,payload:r.payload.slice()}));view(rs[b.shape_record].payload).setUint32(4,shapes.length,true);bytes=publishVerifiedPatch(bytes,state,0,rs,encodeRecords(defs));state=inspectLocalComplex(HwpDocument,bytes,{includeDocumentInfo:false,verifyCharacterModel:false});rs=state.recordSets.get(0);}
 if(alignment){const box=state.text_boxes[0],c=state.tables.flatMap(t=>t.cells).find(c=>c.blocks.some(b=>b.id===box.block_id)),v=view(rs[c.start].payload);v.setUint32(4,(v.getUint32(4,true)&~0x60)|(alignment<<5),true);publish();}
 for(const [depth,align]of ancestorAlignment.entries()){const box=state.text_boxes[0],table=state.tables.find(t=>t.cell_path.length===depth&&JSON.stringify(t.cell_path)===JSON.stringify(box.cell_path.slice(0,depth))),c=table.cells.find(c=>c.cell===box.cell_path[depth].cellIndex),v=view(rs[c.start].payload);v.setUint32(4,(v.getUint32(4,true)&~0x60)|(align<<5),true);publish();}
 rs=invalidateSectionLayout(rs,state.blocks);publish();return bytes;
}

export const nestedFloatingProfiles=[{}, {prefix:''}, {prefix:'Label'}, {hostText:''}, {outerCell:1}, {innerCell:1}, {padding:[600,450,300,300]}, {depth:3,prefix:''}, {narrow:true}];
export const extendedNestedProfiles=[{secondRow:true,rowRoom:true},{laterParagraph:true},{alignment:1,hostText:'X',room:18000},{alignment:2},{merge:[0,0,0,1]},{rowRoom:true,merge:[0,0,1,0]},{laterParagraph:true,emptyLineFontSize:2000,hostText:'inner answer😀',room:18000}];
export const alignedAncestorProfiles=[{ancestorAlignment:[1]},{ancestorAlignment:[2]},{ancestorAlignment:[1],prefix:''},{depth:3,ancestorAlignment:[1,2],prefix:''},{ancestorAlignment:[2],padding:[600,450,300,300]},{ancestorAlignment:[2],outerCell:1},{ancestorAlignment:[1],innerCell:1}];
export function ambiguousNestedFloatingFixture(){
 const bytes=nestedFloatingFixture(),state=inspectLocalComplex(HwpDocument,bytes),table=state.tables.find(t=>t.cell_path.length===1),host=state.blocks.find(b=>b.id===table.parent_id),rs=state.recordSets.get(0),start=table.record_index;let end=start+1;while(end<rs.length&&rs[end].level>rs[start].level)end++;
 const addition=rs.slice(start,end).map(r=>({...r,payload:r.payload.slice()})),anchor=Buffer.from([11,0,32,108,98,116,0,0,0,0,0,0,0,0,11,0]),text=Buffer.concat([rs[host.text_record].payload.subarray(0,-2),anchor,Buffer.from('\r','utf16le')]),header=rs[host.record_index].payload.slice();view(header).setUint32(0,((view(header).getUint32(0,true)&0x80000000)|text.length/2)>>>0,true);
 const records=rs.flatMap((r,i)=>[...(i===end?addition:[]),i===host.record_index?{...r,payload:header}:i===host.text_record?{...r,payload:text}:r]);if(end===rs.length)records.push(...addition);
 return packLocalBodyRewrite(bytes,state.raw,new Map([['BodyText/Section0',encodeRecords(records)]]));
}
export function siblingNestedFloatingFixture(){
 const bytes=nestedFloatingFixture(),state=inspectLocalComplex(HwpDocument,bytes,{includeDocumentInfo:false,verifyCharacterModel:false}),box=state.text_boxes[0],b=state.blocks.find(b=>b.id===box.block_id),rs=state.recordSets.get(0),a=b.tokens.find(t=>t.code===11),raw=rs[b.text_record].payload,anchor=raw.slice(a.unit*2,(a.unit+8)*2),text=Buffer.concat([raw.subarray(0,-2),anchor,Buffer.from('\r','utf16le')]),head=rs[b.record_index].payload.slice(),subtree=rs.slice(box.record_index,box.records_end).map(r=>({...r,payload:r.payload.slice()}));
 view(head).setUint32(0,((view(head).getUint32(0,true)&0x80000000)|text.length/2)>>>0,true);view(subtree[0].payload).setUint32(36,101,true);view(subtree[0].payload).setInt32(12,3756,true);view(subtree[0].payload).setInt32(8,8520,true);
 const records=rs.flatMap((r,i)=>[...(i===b.records_end?subtree:[]),i===b.record_index?{...r,payload:head}:i===b.text_record?{...r,payload:text}:r]);if(b.records_end===rs.length)records.push(...subtree);
 return packLocalBodyRewrite(bytes,state.raw,new Map([['BodyText/Section0',encodeRecords(records)]]));
}
