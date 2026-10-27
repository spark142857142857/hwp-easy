/** Short single-paragraph float hosts with observable ancestor spare height. */
import {cellWrapRenderFixture,cellWrapRenderProfiles} from './local_cell_wrap_render_fixtures.mjs';
import {tableAnswer} from './local_table_reflow_fixtures.mjs';
const ordinary=tableAnswer(6),rows=ordinary.split('\n');
export const ancestorAlignmentProfiles=[
 ...[0,1,2].map(ancestorAlignment=>({name:`ancestor-${ancestorAlignment}`,ancestorAlignment,alignment:ancestorAlignment,text:ordinary,rows,native_y:[153.6,...ancestorAlignment===0?[178.5]:ancestorAlignment===1?[225.1]:[271.7]]})),
 ...[1,2].map(ancestorAlignment=>({name:`deep-ancestor-${ancestorAlignment}`,depth:3,ancestorAlignment,alignment:ancestorAlignment,text:ordinary,rows,native_y:ancestorAlignment===1?[153.6,225.1,303.3]:[153.6,271.7,403.2]})),
 ...[1,2].map(ancestorAlignment=>({name:`empty-ancestor-${ancestorAlignment}`,ancestorAlignment,alignment:ancestorAlignment,prefix:'',text:ordinary,rows,native_y:[153.6,ancestorAlignment===1?225.1:271.7]})),
 {name:'korean-ancestor',ancestorAlignment:1,alignment:1,prefix:'항목',text:ordinary,rows,native_y:[153.6,225.1]},
 {...cellWrapRenderProfiles[1],name:'latin-ancestor',ancestorAlignment:1,cellWrap:true,native_y:[153.6,225.1]},
 {...cellWrapRenderProfiles[2],name:'words-ancestor',ancestorAlignment:2,cellWrap:true,native_y:[153.6,271.7]},
 {...cellWrapRenderProfiles[3],name:'hangul-deep-ancestor',ancestorAlignment:1,alignment:1,cellWrap:true,native_y:[153.6,225.1,303.3]}
];
export const ancestorAlignmentFixture=profile=>cellWrapRenderFixture(profile);
