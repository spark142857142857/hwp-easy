/** Cell relocation uses HWP column/root paragraph reference coordinates. */
import {placeNestedFloating} from './local_nested_floating.mjs';
export function placeCellFloating(HwpDocument,source,state,t,clearance,preserveOverlap=false){
 return placeNestedFloating(HwpDocument,source,state,t,clearance,preserveOverlap);
}
