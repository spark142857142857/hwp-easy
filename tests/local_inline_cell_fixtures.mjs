/** Synthetic inline-flow profiles; no application or private corpus dependency. */
import {HwpDocument} from '@rhwp/core';
import {nestedFloatingFixture,ambiguousNestedFloatingFixture} from './local_nested_floating_fixtures.mjs';
import {inspectLocalComplex} from '../src/one_hwp/local_complex.mjs';
import {view,encodeRecords,spliceRawParagraph} from '../src/one_hwp/local_complex_records.mjs';
import {packLocalBodyRewrite} from '../src/one_hwp/local_body_write.mjs';
import {prepareComplexBoundary} from '../src/one_hwp/local_complex_boundary.mjs';
import {reanchorFloating} from '../src/one_hwp/local_floating_anchor.mjs';
import {publishVerifiedPatch} from '../src/one_hwp/local_verified_patch.mjs';
import {invalidateSectionLayout} from '../src/one_hwp/local_layout_cache.mjs';

export const inlineCellProfiles=[
 {duplicate:true,selected:0},{duplicate:true,selected:1},{duplicate:true,selected:1,ancestorAlignment:[1]},{duplicate:true,selected:1,ancestorAlignment:[2]},
 {duplicate:true,selected:1,sameLine:true},
 {prefix:'문항\n설명'},{prefix:'문항\n설명',ancestorAlignment:[1]},{prefix:'문항\n설명',ancestorAlignment:[2]},
 {prefix:'문'.repeat(24),wide:true},{prefix:'문'.repeat(24),wide:true,ancestorAlignment:[2]},
 {prior:true},{prior:true,following:true,ancestorAlignment:[1]},{prior:true,following:true,ancestorAlignment:[2]},
 {depth:3,prefix:'',prior:true,narrow:true,ancestorAlignment:[1,2]},
];
export function inlineCellFixture(options={}){
 let bytes=options.duplicate?ambiguousNestedFloatingFixture():nestedFloatingFixture(options),state=inspectLocalComplex(HwpDocument,bytes),rs=state.recordSets.get(0);
 const reload=()=>{bytes=packLocalBodyRewrite(bytes,state.raw,new Map([['BodyText/Section0',encodeRecords(rs)]]));state=inspectLocalComplex(HwpDocument,bytes);rs=state.recordSets.get(0);};
 if(options.wide||options.depth===3){const table=state.tables.at(-1),width=options.wide?12000:8000;view(rs[table.record_index].payload).setUint32(16,width,true);for(const c of table.cells)for(const at of [16,34])view(rs[c.start].payload).setUint32(at,width/2,true);if(options.depth===3){const parent=state.tables.find(t=>t.cell_path.length===1);view(rs[parent.record_index].payload).setUint32(16,19300,true);for(const c of parent.cells)for(const at of [16,34])view(rs[c.start].payload).setUint32(at,9650,true);}reload();}
 if(options.duplicate){
  const remove=state.text_boxes[options.selected===0?1:0],b=state.blocks.find(b=>b.id===remove.block_id);bytes=publishVerifiedPatch(bytes,state,0,reanchorFloating(state,{selected:remove,b},null).records);state=inspectLocalComplex(HwpDocument,bytes);rs=state.recordSets.get(0);
  const root=state.tables.find(t=>!t.cell_path.length);for(const c of root.cells.filter(c=>c.row===0))view(rs[c.start].payload).setUint32(20,36000,true);view(rs[root.record_index].payload).setUint32(20,36282,true);
  for(const t of state.tables.filter(t=>t.cell_path.length===1))if(options.sameLine){view(rs[t.record_index].payload).setUint32(16,9000,true);for(const c of t.cells)for(const at of [16,34])view(rs[c.start].payload).setUint32(at,4500,true);}
  if(options.ancestorAlignment?.length){const c=root.cells[0],v=view(rs[c.start].payload);v.setUint32(4,(v.getUint32(4,true)&~0x60)|(options.ancestorAlignment[0]<<5),true);}reload();
  if(options.sameLine){const b=state.blocks.find(b=>b.cell_path.length===1&&b.cell_path[0].cellIndex===0);rs=spliceRawParagraph(rs,b,0,[...b.text].length,'').records;reload();}
 }
 if(options.prior){
  const b=state.blocks.find(b=>b.cell_path.length===1&&b.cell_path[0].cellIndex===0);rs=spliceRawParagraph(rs,b,0,0,'앞 문단').records;reload();
  const first=state.blocks.find(b=>b.cell_path.length===1&&b.cell_path[0].cellIndex===0);rs=prepareComplexBoundary(state,first,{type:'split_paragraph',target_id:'fixture',expected_old:first.text,offset:4},'').records;reload();
  if(options.following){const t=state.tables.find(t=>t.cell_path.length===1),host=state.blocks.find(b=>b.id===t.parent_id);rs=prepareComplexBoundary(state,host,{type:'insert_paragraphs',target_id:'fixture',expected_old:host.text,paragraphs:['뒤 문단']},'').records;reload();}
 }
 rs=invalidateSectionLayout(rs,state.blocks);reload();return bytes;
}
