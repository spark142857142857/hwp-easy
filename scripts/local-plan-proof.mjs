/** Compare verified edits separately from availability of the derived thumbnail. */
import assert from 'node:assert/strict';
export function assertPlannedEdit(plan,saved,label){
 const context=JSON.stringify({label,plan_preview:plan.preview_cache,saved_preview:saved.preview_cache});
 assert.match(plan.verified_edit_sha256,/^[a-f0-9]{64}$/,context);
 assert.equal(saved.verified_edit_sha256,plan.verified_edit_sha256,context);
 if(saved.preview_cache.status===plan.preview_cache.status)assert.equal(saved.output_sha256,plan.output_sha256,context);
 else assert.deepEqual(new Set([saved.preview_cache.status,plan.preview_cache.status]),new Set(['updated','text_updated_image_unavailable']),context);
 return {verified_edit_sha256:plan.verified_edit_sha256,output_sha256_equal:saved.output_sha256===plan.output_sha256,plan_preview:plan.preview_cache.status,saved_preview:saved.preview_cache.status};
}
