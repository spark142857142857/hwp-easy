// Actual compiled Worker/D1/R2, fixed synthetic HWP and mocked identities only.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { pathToFileURL } from 'node:url';
import { createHash } from 'node:crypto';
import { Miniflare, convertV4MiniflareOptions } from 'miniflare';
import { HwpDocument, initSync } from '@rhwp/core';
import { createDocumentEngine } from '../engine/document.mjs';
import { readHwp } from '../guard/container.mjs';
import { parseRecords } from '../guard/records.mjs';
import { mixedFixture, MIXED_TEXT, MIXED_REPLACEMENT } from '../tests/mixed-style-fixtures.mjs';
import { applyTestMigrations } from './migrations.mjs';
const require = createRequire(import.meta.url);
initSync({ module: fs.readFileSync(new URL('./rhwp_bg.wasm', pathToFileURL(require.resolve('@rhwp/core')))) });
const origin = 'https://mixed.invalid';
const owner = { 'oai-authenticated-user-id': 'mixed-a', 'oai-authenticated-user-email': 'a@example.invalid' };
const other = { ...owner, 'oai-authenticated-user-id': 'mixed-b' };
const sha = bytes => createHash('sha256').update(bytes).digest('hex');
const mf = new Miniflare(convertV4MiniflareOptions({ compatibilityDate: '2026-10-01',
  modulesRoot: path.resolve('dist/server'), modules: [
    { type: 'ESModule', path: path.resolve('dist/server/index.js') },
    { type: 'CompiledWasm', path: path.resolve('dist/server/rhwp_bg.wasm') }],
  d1Databases: { DB: 'mixed-d1' }, r2Buckets: { BUCKET: 'mixed-r2' },
  bindings: { HWP_EASY_ORIGIN: origin, HWP_EASY_ALLOW_UPLOADS: 'true', HWP_EASY_FILE_ORIGINS: '[]' },
  outboundService: () => { throw new Error('UNEXPECTED_NETWORK'); } }));
const checks = [];
try {
  const db = await mf.getD1Database('DB'), bucket = await mf.getR2Bucket('BUCKET');
  await applyTestMigrations(db);
  const state = async () => ({
    tables: await Promise.all(['hwp_documents', 'hwp_versions', 'hwp_requests', 'hwp_deletions'].map(async table =>
      (await db.prepare(`SELECT * FROM ${table} ORDER BY owner, ${table === 'hwp_deletions' ? 'document_id' : 'id'}`).all()).results)),
    blobs: await Promise.all((await bucket.list()).objects.sort((a, b) => a.key.localeCompare(b.key)).map(async object =>
      ({ key: object.key, sha256: sha(new Uint8Array(await (await bucket.get(object.key)).arrayBuffer())) }))),
  });
  const rpc = async (name, args, identity = owner) => {
    const response = await mf.dispatchFetch(`${origin}/mcp`, { method: 'POST', headers: { ...identity, 'Content-Type': 'application/json' },
      body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name, arguments: args } }) });
    assert.equal(response.status, 200); return (await response.json()).result;
  };
  const call = async (...args) => { const result = await rpc(...args); assert(!result.isError); return result.structuredContent.data; };
  const download = async v => {
    const link = await call('hwp_download', { document_id: v.document_id, version_id: v.version_id });
    const response = await mf.dispatchFetch(link.download_url, { headers: owner }); assert.equal(response.status, 200);
    return new Uint8Array(await response.arrayBuffer());
  };
  const shapes = bytes => [...readHwp(bytes).streams].filter(([name]) => name.startsWith('BodyText/')).map(([name, raw]) =>
    [name, [...parseRecords(raw)].filter(r => r.tag === 68).map(r => [r.level, [...r.payload]])]);
  assert.equal((await call('hwp_capabilities', {})).mixed_style_same_length_edit_available, true);
  const engine = createDocumentEngine(HwpDocument);
  for (const [kind, merged] of [['paragraph', false], ['cell', false], ['cell', true]]) {
    const bytes = mixedFixture(HwpDocument, kind, { merged });
    const response = await mf.dispatchFetch(`${origin}/documents/import`, { method: 'POST', headers: {
      ...owner, Origin: origin, 'Content-Type': 'application/x-hwp', 'hwp-request-id': crypto.randomUUID() }, body: bytes });
    assert.equal(response.status, 200); const first = await response.json();
    const version = { document_id: first.document_id, version_id: first.version_id };
    const before = await call('hwp_read', version), target = before.blocks.find(b => b.text === MIXED_TEXT);
    assert(target.mixed_style_same_length_supported); assert.equal(before.editability_summary.mixed_style_same_length_candidates, 1);
    const baseline = await state();
    const viewer = await mf.dispatchFetch(`${origin}/documents/${first.document_id}/versions/${first.version_id}/view`, { headers: owner });
    assert.equal(viewer.status, 200); assert.match(await viewer.text(), /혼합 글자 서식의 제한된 치환 후보: 1곳/);
    const edits = { expected_sha256: first.sha256, operations: [{ target_id: target.target_id, expected_old: target.text, new_text: MIXED_REPLACEMENT }] };
    const planned = await call('hwp_plan', { ...version, ...edits });
    assert(planned.serialization_checked); assert(planned.raw_preservation_verified); assert.equal(planned.saved, false);
    assert.deepEqual(await state(), baseline);
    const editArgs = { document_id: first.document_id, expected_version: first.version_id, request_id: crypto.randomUUID(), ...edits };
    const saved = await call('hwp_edit', editArgs); assert(saved.saved); assert(saved.raw_preservation_verified);
    const savedState = await state();
    const replay = await call('hwp_edit', editArgs); assert(replay.replayed); assert.equal(replay.version_id, saved.version_id);
    assert.deepEqual(await state(), savedState);
    const output = await download(saved), opened = await engine.open(output);
    const after = opened.read({ expected_sha256: saved.sha256 });
    assert.equal(sha(output), saved.sha256); assert.deepEqual(shapes(output), shapes(bytes));
    assert.deepEqual(after.blocks.map(b => [b.id, b.text, b.style]),
      before.blocks.map(b => [b.id, b.id === target.id ? MIXED_REPLACEMENT : b.text, b.style]));
    assert.deepEqual(await download(first), bytes);
    assert.equal((await call('hwp_versions', { document_id: first.document_id })).versions.length, 2);
    const current = { document_id: saved.document_id, version_id: saved.version_id };
    const newTarget = after.blocks.find(b => b.id === target.id), adjacent = after.blocks.find(b => b.text === '비대상 보존 문단');
    const unchanged = await state();
    for (const text of ['', MIXED_REPLACEMENT + '추가', '이름: 김철수 😀', '성명: 홍길동 가']) {
      const rejected = { expected_sha256: saved.sha256, operations: [
        { target_id: adjacent.target_id, expected_old: adjacent.text, new_text: '일부 저장 금지' },
        { target_id: newTarget.target_id, expected_old: newTarget.text, new_text: text }] };
      for (const [name, args] of [['hwp_plan', { ...current, ...rejected }], ['hwp_edit', {
        document_id: saved.document_id, expected_version: saved.version_id, request_id: crypto.randomUUID(), ...rejected }]]) {
        const result = await rpc(name, args); assert(result.isError); assert.equal(result.content[0].text, 'MIXED_STYLE_EDIT_UNSUPPORTED');
        const d = result.structuredContent.data.edit_diagnostic;
        assert.equal(d.saved, false); assert.equal(d.retry_same_request_recommended, false);
        assert.equal(d.automatic_partial_save_allowed, false); assert.equal(d.unrequested_edits_allowed, false);
        assert.deepEqual(await state(), unchanged);
      }
    }
    for (const [name, args] of [['hwp_read', current], ['hwp_edit', { ...editArgs, request_id: crypto.randomUUID() }]]) {
      const result = await rpc(name, args, other); assert(result.isError); assert.equal(result.content[0].text, 'DOCUMENT_OR_VERSION_NOT_FOUND');
      assert.deepEqual(await state(), unchanged);
    }
    const restored = await call('hwp_restore', { document_id: saved.document_id, expected_version: saved.version_id,
      source_version: first.version_id, request_id: crypto.randomUUID() });
    assert.equal(restored.sha256, first.sha256); assert.deepEqual(await download(restored), bytes);
    assert.equal((await call('hwp_versions', { document_id: first.document_id })).versions.length, 3);
    checks.push({ kind, merged, plan_no_mutation: true, exact_style_anchors: true, versioned_save_restore: true,
      rejected_requests_no_partial_save_or_receipts: true, exact_replay: true, other_owner_denied: true });
  }
  console.log(JSON.stringify({ mixed_style_worker: 'passed', real_workerd_d1_r2_hwp: true,
    identity_headers_are_mocks_not_oauth: true, external_network_used: false, checks }));
} finally { await mf.dispose(); }
