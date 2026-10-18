/** First-row nested cells with explicit minimum room; synthetic HWP only. */
import {HwpDocument} from '@rhwp/core';
import {nestedFixture} from './local_complex_fixtures.mjs';
import {cellBoxFixture} from './local_placement_fixtures.mjs';
import {inspectLocalComplex} from '../src/one_hwp/local_complex.mjs';
import {spliceRawParagraph,view,encodeRecords} from '../src/one_hwp/local_complex_records.mjs';
import {packLocalBodyRewrite} from '../src/one_hwp/local_body_write.mjs';
import {invalidateSectionLayout} from '../src/one_hwp/local_layout_cache.mjs';

export function nestedFloatingFixture({depth=2,prefix='문항',hostText='inner label',outerCell=0,innerCell=0,padding=null,narrow=false,secondRow=false,laterParagraph=false}={}){
 let source=nestedFixture(undefined,{rows:secondRow?2:1});
 if(depth>2){const s=inspectLocalComplex(HwpDocument,source,{includeDocumentInfo:false,verifyCharacterModel:false}),r=s.recordSets.get(0),t=s.tables.find(t=>t.cell_path.length===1);view(r[t.record_index].payload).setUint32(16,20000,true);for(const c of t.cells)for(const at of [16,34])view(r[c.start].payload).setUint32(at,10000,true);source=packLocalBodyRewrite(source,s.raw,new Map([['BodyText/Section0',encodeRecords(r)]]));}
 for(let i=2;i<depth;i++)source=nestedFixture(source,{inside_nested:true});
 let bytes=cellBoxFixture({nested:true,cellRelative:true,source,depth}),state=inspectLocalComplex(HwpDocument,bytes,{includeDocumentInfo:false,verifyCharacterModel:false}),rs=state.recordSets.get(0);
 for(const table of state.tables){for(const c of table.cells){const v=view(rs[c.start].payload);v.setUint32(4,v.getUint32(4,true)&~0x60,true);if(c.row===0)v.setUint32(20,(depth-table.cell_path.length)*12000,true);if(padding){v.setUint32(4,v.getUint32(4,true)|0x10000,true);padding.forEach((n,i)=>v.setUint16(24+i*2,n,true));}}
  const heights=Array.from({length:table.dimensions.rowCount},(_,row)=>Math.max(...table.cells.filter(c=>c.row===row).map(c=>view(rs[c.start].payload).getUint32(20,true))));view(rs[table.record_index].payload).setUint32(20,heights.reduce((a,b)=>a+b,0),true);
 }
 const publish=()=>{bytes=packLocalBodyRewrite(bytes,state.raw,new Map([['BodyText/Section0',encodeRecords(rs)]]));state=inspectLocalComplex(HwpDocument,bytes,{includeDocumentInfo:false,verifyCharacterModel:false});rs=state.recordSets.get(0);};publish();
 for(let level=1;level<=depth;level++){const b=state.blocks.find(b=>b.cell_path.length===level&&b.cell_path.every(p=>p.cellIndex===0)),text=level===depth?hostText:prefix;rs=spliceRawParagraph(rs,b,0,[...b.text].length,text).records;publish();}
 const p=state.text_boxes[0].paragraphs[0];rs=spliceRawParagraph(rs,p,0,[...p.text].length,narrow?'X':'BOX').records;publish();
 if(narrow){const box=state.text_boxes[0],shape=rs[box.record_index+1],rect=rs.find((r,i)=>i>box.record_index&&i<box.records_end&&r.tag===79),base=Buffer.from(shape.payload.subarray(0,4)).equals(Buffer.from(shape.payload.subarray(4,8)))?8:4;view(rs[box.record_index].payload).setUint32(16,1500,true);for(const at of [12,20])view(shape.payload).setUint32(base+at,1500,true);for(const at of [9,17])view(rect.payload).setInt32(at,1500,true);publish();}
 function swap(table,target=1){const a=table.cells[0],b=table.cells[target],aa=rs.slice(a.start+1,a.end),bb=rs.slice(b.start+1,b.end);rs=rs.flatMap((r,i)=>i===a.start+1?bb:i===b.start+1?aa:i>a.start+1&&i<a.end||i>b.start+1&&i<b.end?[]:[r]);publish();}
 if(secondRow)swap(state.tables.find(t=>t.cell_path.length===depth-1),2);if(innerCell)swap(state.tables.find(t=>t.cell_path.length===depth-1));if(outerCell)swap(state.tables.find(t=>!t.cell_path.length));
 if(laterParagraph){const box=state.text_boxes[0],b=state.blocks.find(b=>b.id===box.block_id),table=state.tables.find(t=>t.cell_path.length===depth-1),c=table.cells.find(c=>c.blocks.some(p=>p.id===b.id)),head=rs[b.record_index].payload.slice(),v=view(head);v.setUint32(0,1,true);v.setUint32(4,0,true);for(const [at,n]of [[12,1],[14,0],[16,0]])v.setUint16(at,n,true);const shape=rs[b.shape_record].payload.slice(0,8);view(shape).setUint32(0,0,true);view(rs[c.start].payload).setUint16(0,c.blocks.length+1,true);rs.splice(b.record_index,0,{tag:66,level:b.raw_level,payload:head},{tag:67,level:b.raw_level+1,payload:Buffer.from('\r','utf16le')},{tag:68,level:b.raw_level+1,payload:shape});publish();}
 rs=invalidateSectionLayout(rs,state.blocks);publish();return bytes;
}

export const nestedFloatingProfiles=[{}, {prefix:''}, {prefix:'Label'}, {hostText:''}, {outerCell:1}, {innerCell:1}, {padding:[600,450,300,300]}, {depth:3,prefix:''}, {narrow:true}];
