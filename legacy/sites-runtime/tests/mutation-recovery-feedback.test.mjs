import assert from 'node:assert/strict';
import test from 'node:test';
import { createVersionStore, StorageError, mutationOutcomeDiagnostic } from '../storage/store.mjs';
import { documentToolError } from '../host/error-feedback.mjs';

// Unit fault models, not HWP, live storage, OAuth or real provider failures.
async function reachedFailure(reason) {
  const owner = 'synthetic:recovery-feedback', document_id = crypto.randomUUID();
  const expected_version = crypto.randomUUID(), request_id = crypto.randomUUID();
  let begun = false;
  const row = { owner, document_id, expected_version, request_id, phase: 'pending', version_count: 1 };
  const db = {
    prepare(sql) { return { bind() { return {
      async first() {
        if (sql.startsWith('SELECT * FROM hwp_deletions') && begun) {
          if (reason === 'DELETE_OUTCOME_UNKNOWN') throw Error('PRIVATE_RECEIPT');
          return row;
        }
        if (sql.includes('SELECT r.fingerprint') && begun) throw Error('PRIVATE_RECEIPT');
        return null;
      },
      async all() { return { results: [{ id: expected_version,
        blob_key: `hwp-easy/v1/${owner}/${document_id}/${expected_version}.hwp` }] }; },
    }; } }; },
    async batch() { begun = true; if (reason === 'COMMIT_OUTCOME_UNKNOWN') throw Error('PRIVATE_ACK'); },
  };
  const bucket = { async put() { return {}; }, async get() {}, async delete() { throw Error('PRIVATE_DELETE'); } };
  const store = createVersionStore(db, bucket); let caught;
  await assert.rejects(() => reason === 'COMMIT_OUTCOME_UNKNOWN'
    ? store.create({ owner, request_id, bytes: Uint8Array.from([1]) })
    : store.remove({ owner, document_id, expected_version, request_id }), error => {
      caught = error; return error.code === reason;
    });
  return caught;
}
const plain = code => ({ isError: true, content: [{ type: 'text', text: code }] });

test('a reached save uncertainty reports unknown, exact retry and fixed authorization boundaries', async () => {
  const error = await reachedFailure('COMMIT_OUTCOME_UNKNOWN');
  for (const name of ['hwp_import','hwp_edit','hwp_restore']) {
    const response = documentToolError(error, name), d = response.structuredContent.data.recovery_diagnostic;
    assert.equal(response.isError, true); assert.equal(response.content[0].text, error.code);
    assert.deepEqual(JSON.parse(response.content[1].text), response.structuredContent);
    assert.equal(d.saved, null); assert.equal(d.outcome_confirmed, false);
    assert.equal(d.retry_same_request_recommended, true); assert.equal(d.new_request_id_allowed, false);
    assert.equal(d.unrequested_deletion_allowed, false);
    assert.equal(d.retry_when, 'service_available_and_original_authorization_still_applies');
    assert.equal(d.automatic_overwrite_allowed, false); assert.equal(d.automatic_version_deletion_allowed, false);
    assert.equal(d.unrequested_save_as_allowed, false); assert.match(d.message_ko, /이미 저장되었을/);
    assert(d.preserve_original.includes('expected_version_if_present'));
    assert(d.preserve_original.includes('source_version_if_present'));
  }
});
test('delete uncertainty and accepted incomplete cleanup do not claim completion', async () => {
  for (const reason of ['DELETE_OUTCOME_UNKNOWN','DELETE_INCOMPLETE_RETRY_SAME_REQUEST']) {
    const error = await reachedFailure(reason), d = documentToolError(error, 'hwp_delete').structuredContent.data.recovery_diagnostic;
    assert.equal(d.deleted, null); assert.equal(d.outcome_confirmed, false);
    assert.equal(d.cleanup_complete, reason === 'DELETE_OUTCOME_UNKNOWN' ? null : false);
    assert.equal(d.document_access_revoked, reason === 'DELETE_OUTCOME_UNKNOWN' ? null : true);
    assert.equal(d.retry_same_request_recommended, true); assert.equal(d.new_request_id_allowed, false);
    assert.deepEqual(d.preserve_original, ['request_id','document_id','expected_version','confirmation']);
    assert.match(d.message_ko, /이미 허용한 삭제 요청/);
  }
});
test('public codes, cloned errors and arbitrary fields cannot forge storage outcome diagnostics', async () => {
  for (const reason of ['COMMIT_OUTCOME_UNKNOWN','DELETE_OUTCOME_UNKNOWN','DELETE_INCOMPLETE_RETRY_SAME_REQUEST']) {
    const name = reason === 'COMMIT_OUTCOME_UNKNOWN' ? 'hwp_edit' : 'hwp_delete';
    for (const error of [new StorageError(reason), { code: reason, message: 'PRIVATE_TEXT',
      recovery_diagnostic: { saved: false, cleanup_complete: true }, token: 'PRIVATE_TOKEN' },
      { ...await reachedFailure(reason) }]) {
      assert.equal(mutationOutcomeDiagnostic(error), undefined);
      assert.deepEqual(documentToolError(error, name), plain(reason));
    }
  }
});
test('read tools, workflow probes, mismatched operations and missing context retain the plain error', async () => {
  const saved = await reachedFailure('COMMIT_OUTCOME_UNKNOWN'), deleted = await reachedFailure('DELETE_OUTCOME_UNKNOWN');
  for (const name of [undefined, 'hwp_read', 'hwp_plan', 'hwp_download', 'hwp_versions', 'hwp_workflow_probe', {}]) {
    assert.deepEqual(documentToolError(saved, name), plain(saved.code));
    assert.deepEqual(documentToolError(deleted, name), plain(deleted.code));
  }
  assert.deepEqual(documentToolError(saved, 'hwp_delete'), plain(saved.code));
  assert.deepEqual(documentToolError(deleted, 'hwp_edit'), plain(deleted.code));
});
test('private getters, caller changes and changed error codes cannot leak or reuse attestation', async () => {
  const error = await reachedFailure('COMMIT_OUTCOME_UNKNOWN');
  for (const key of ['message','stack','details','document_id','recovery_diagnostic'])
    Object.defineProperty(error, key, { get() { throw Error('PRIVATE_GETTER'); }, configurable: true });
  const first = documentToolError(error, 'hwp_edit');
  assert(!JSON.stringify(first).includes('PRIVATE_'));
  first.structuredContent.data.recovery_diagnostic.saved = true;
  first.structuredContent.data.recovery_diagnostic.preserve_original.length = 0;
  const next = documentToolError(error, 'hwp_edit').structuredContent.data.recovery_diagnostic;
  assert.equal(next.saved, null); assert.equal(next.preserve_original.length, 4);
  error.code = 'DELETE_OUTCOME_UNKNOWN';
  assert.deepEqual(documentToolError(error, 'hwp_delete'), plain(error.code));
  Object.defineProperty(error, 'code', { get() { throw Error('PRIVATE_GETTER'); } });
  assert.deepEqual(documentToolError(error, 'hwp_edit'), plain('DOCUMENT_OPERATION_FAILED'));
});
