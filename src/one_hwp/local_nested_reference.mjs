/** Remove the selected floating plane from aligned-ancestor height readings. */
import {view,equal} from './local_complex_records.mjs';
import {reanchorFloating} from './local_floating_anchor.mjs';
import {publishVerifiedPatch} from './local_verified_patch.mjs';
import {captureRenderedLayout} from './local_rendered_layout.mjs';
export function nestedReferenceLayout(state,object,{HwpDocument,bytes,snapshot}){
 const host=state.blocks.find(b=>b.id===object.block_id),path=host.cell_path,rs=state.recordSets.get(object.section);
 const aligned=path.slice(0,-1).some((p,i)=>{const table=state.tables.find(t=>t.section===object.section&&t.paragraph===host.paragraph&&equal(t.cell_path,path.slice(0,i))&&t.control===p.controlIndex),cell=table?.cells.find(c=>c.cell===p.cellIndex);return cell&&(view(rs[cell.start].payload).getUint32(4,true)&0x60)!==0;});
 if(!aligned||object.flow.textWrap!==3||!HwpDocument||!bytes)return snapshot;
 const stripped=reanchorFloating(state,{selected:object,b:host},null);
 return captureRenderedLayout(HwpDocument,publishVerifiedPatch(bytes,state,object.section,stripped.records));
}
