/** Raw section page definitions; values are HWP units, not rendered pixels. */
import {view,fail} from './local_complex_records.mjs';
export const sameProperties=(a,b)=>a&&b&&Object.getPrototypeOf(a)===Object.prototype&&Object.keys(a).length===Object.keys(b).length&&Object.keys(b).every(k=>Object.hasOwn(a,k)&&a[k]===b[k]);
const keys=['width','height','marginLeft','marginRight','marginTop','marginBottom','marginHeader','marginFooter','marginGutter','attributes'];
export function pageProperties(record){if(record?.tag!==73||record.payload.length!==40)fail('PAGE_PROFILE_UNSUPPORTED');const p=view(record.payload);return Object.fromEntries(keys.map((key,i)=>[key,p.getUint32(i*4,true)]));}
export function sectionPages(state){return [...state.recordSets].flatMap(([section,rs])=>{const pages=rs.filter(r=>r.tag===73);if(pages.length!==1||pages[0].payload.length!==40)return [];return [{section,properties:pageProperties(pages[0])}];});}
