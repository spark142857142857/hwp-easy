/** Expand the verified model runs without repeated upstream offset scans. */
import {GuardError} from '../../probes/sites-runtime/guard/records.mjs';
export function modelCharacterIds(block,code='TEXT_STYLE_MISMATCH'){
 const count=[...block.text].length,ids=block.style.char_shape_ids;
 if(!Array.isArray(ids)||!ids.length||block.style.profile)throw new GuardError(code);
 if(ids.length===1)return Array(count).fill(ids[0]);
 const runs=block.style.char_runs;
 if(!Array.isArray(runs)||!runs.length||runs.at(-1).end!==count||runs.some((r,i)=>r.start!==(i?runs[i-1].end:0)||!Number.isSafeInteger(r.end)||r.end<=r.start||r.end>count||!ids.includes(r.char_shape_id)))throw new GuardError(code);
 const result=Array(count);for(const r of runs)result.fill(r.char_shape_id,r.start,r.end);return result;
}
export function verifyModelCharacterIds(block,expected,emptyId,code='TEXT_STYLE_MISMATCH'){
 const actual=modelCharacterIds(block,code);if(actual.length!==expected.length||actual.some((v,i)=>v!==expected[i])||!expected.length&&(block.style.char_shape_ids.length!==1||block.style.char_shape_ids[0]!==emptyId))throw new GuardError(code);
}
