import { createVersionStore } from './store.mjs';
import { createDocumentService } from './service.mjs';
import { createEngineApi } from '../../../src/one_hwp/rhwp_api.mjs';
import { syntheticFixture } from '../../../src/one_hwp/synthetic_fixtures.mjs';
const check = (value) => { if (!value) throw new Error('STORAGE_PROBE_FAILED'); };
async function rejects(action, code) {
  try { await action(); } catch (error) { check(error.code === code); return; }
  throw new Error('STORAGE_PROBE_FAILED');
}
export async function runStorageProbe(db, bucket, engine, HwpDocument) {
  const namespace = crypto.randomUUID(), owner = `probe:${namespace}:a`, other = `probe:${namespace}:b`;
  const store = createVersionStore(db, bucket), service = createDocumentService(engine, store);
  let report;
  try {
    const api = createEngineApi(HwpDocument);
    const bytes = syntheticFixture(HwpDocument, api.exportChecked, { paragraphs: ['합성 저장 검증', '합성 저장 검증'] });
    const request_id = crypto.randomUUID(), created = await service.create({ owner, request_id, bytes });
    check(created.saved && !created.replayed);
    const repeated = await service.create({ owner, request_id, bytes });
    check(repeated.replayed && repeated.version_id === created.version_id && repeated.document_id === created.document_id);
    const document_id = created.document_id;
    const before = await service.open({ owner, document_id });
    const blocks = before.snapshot.read({ expected_sha256: created.sha256 }).blocks;
    const body = blocks.find((b) => b.kind === 'paragraph' && b.editable && b.text);
    const cell = blocks.find((b) => b.kind === 'cell' && b.editable && b.text);
    check(body && cell);
    const request = { expected_sha256: created.sha256, operations: [body, cell].map((b, i) => ({
      target_id: b.target_id, expected_old: b.text, new_text: `저장된 합성 수정 ${i} 😀` })) };
    const editId = crypto.randomUUID();
    const edited = await service.edit({ owner, document_id, expected_version: created.version_id, request_id: editId, request });
    const replay = await service.edit({ owner, document_id, expected_version: created.version_id, request_id: editId, request });
    check(edited.saved && edited.content_verified && edited.raw_preservation_verified
      && replay.replayed && replay.version_id === edited.version_id);
    const saved = await service.open({ owner, document_id });
    check(saved.metadata.sha256 === edited.sha256 && saved.metadata.revision === 2);
    const old = await service.open({ owner, document_id, version_id: created.version_id });
    check(old.metadata.sha256 === created.sha256);
    for (const action of [
      () => service.open({ owner: other, document_id }),
      () => service.edit({ owner: other, document_id, expected_version: edited.version_id, request_id: crypto.randomUUID(), request }),
      () => service.history({ owner: other, document_id }),
      () => service.restore({ owner: other, document_id, expected_version: edited.version_id,
        source_version: created.version_id, request_id: crypto.randomUUID() }),
    ]) await rejects(action, 'DOCUMENT_OR_VERSION_NOT_FOUND');
    const restoreId = crypto.randomUUID();
    const restored = await service.restore({ owner, document_id, expected_version: edited.version_id,
      source_version: created.version_id, request_id: restoreId });
    check(restored.sha256 === created.sha256 && restored.version_id !== created.version_id);
    const restoreReplay = await service.restore({ owner, document_id, expected_version: edited.version_id,
      source_version: created.version_id, request_id: restoreId });
    check(restoreReplay.replayed && restoreReplay.version_id === restored.version_id);
    await rejects(() => service.edit({ owner, document_id, expected_version: created.version_id,
      request_id: crypto.randomUUID(), request }), 'VERSION_CONFLICT');
    // Run TWO different requests concurrently against the same current version.
    const race = await Promise.allSettled([1, 2].map(() => service.edit({ owner, document_id,
      expected_version: restored.version_id, request_id: crypto.randomUUID(), request })));
    check(race.filter((r) => r.status === 'fulfilled').length === 1
      && race.filter((r) => r.status === 'rejected' && r.reason.code === 'VERSION_CONFLICT').length === 1);
    check((await service.history({ owner, document_id })).length === 4);
    report = { passed: true, scope: 'fixed_synthetic_documents_only', persistence: 'd1-r2',
      create_read_edit_reopen: true, original_version_retained: true, immutable_restore_revision: true,
      stale_and_aba_writes_rejected: true, concurrent_save_one_winner: true,
      persistent_request_replay: true, synthetic_owner_scope_checked: true,
      content_and_raw_preservation_verified: true, real_oauth_multi_user_verified: false,
      codex_cloud_client_verified: false, dots_client_verified: false, document_upload_supported: false,
      layout_verified: false };
  } finally {
    const results = await Promise.allSettled([owner, other].map(store.purgeSyntheticOwner));
    check(results.every((r) => r.status === 'fulfilled' && r.value.cleanup_complete));
    if (report) report.synthetic_cleanup_complete = true;
  }
  return report;
}
