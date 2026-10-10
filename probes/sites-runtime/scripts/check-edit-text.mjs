// Actual local compiled Worker/D1/R2/WASM, synthetic text and mock identity only.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { pathToFileURL } from 'node:url';
import { createHash } from 'node:crypto';
import { HwpDocument, initSync } from '@rhwp/core';
import { Miniflare, convertV4MiniflareOptions } from 'miniflare';
import { createEngineApi } from '../../../src/one_hwp/rhwp_api.mjs';
import { syntheticFixture } from '../../../src/one_hwp/synthetic_fixtures.mjs';
import { createDocumentEngine } from '../engine/document.mjs';
import { EDIT_TEXT_CONSTRAINTS } from '../guard/edit-text.mjs';
import { readHwp } from '../guard/container.mjs';
import { parseRecords } from '../guard/records.mjs';
import { applyTestMigrations } from './migrations.mjs';

const require = createRequire(import.meta.url);
initSync({ module: fs.readFileSync(new URL('./rhwp_bg.wasm', pathToFileURL(require.resolve('@rhwp/core')))) });
const origin = 'https://edit-text.invalid';
const owner = { 'oai-authenticated-user-id': 'edit-text-a', 'oai-authenticated-user-email': 'a@example.invalid' };
const api = createEngineApi(HwpDocument), engine = createDocumentEngine(HwpDocument);
const sha = bytes => createHash('sha256').update(bytes).digest('hex');
const mf = new Miniflare(convertV4MiniflareOptions({ compatibilityDate: '2026-10-01',
  modulesRoot: path.resolve('dist/server'), modules: [
    { type: 'ESModule', path: path.resolve('dist/server/index.js') },
    { type: 'CompiledWasm', path: path.resolve('dist/server/rhwp_bg.wasm') }],
  d1Databases: { DB: 'edit-text-d1' }, r2Buckets: { BUCKET: 'edit-text-r2' },
  bindings: { HWP_EASY_ORIGIN: origin, HWP_EASY_ALLOW_UPLOADS: 'true', HWP_EASY_FILE_ORIGINS: '[]' },
  outboundService: () => { throw new Error('UNEXPECTED_NETWORK'); } }));
try {
  const db = await mf.getD1Database('DB'), bucket = await mf.getR2Bucket('BUCKET');
  await applyTestMigrations(db);
  const state = async () => {
    const listing = await bucket.list(); assert.equal(listing.truncated, false);
    return { tables: await Promise.all(['hwp_documents', 'hwp_versions', 'hwp_requests', 'hwp_deletions'].map(async table =>
      (await db.prepare(`SELECT * FROM ${table} ORDER BY owner, ${table === 'hwp_deletions' ? 'document_id' : 'id'}`).all()).results)),
      blobs: await Promise.all(listing.objects.sort((a, b) => a.key.localeCompare(b.key)).map(async object =>
        ({ key: object.key, sha256: sha(new Uint8Array(await (await bucket.get(object.key)).arrayBuffer())) }))) };
  };
  const rpc = async (name, args) => {
    const response = await mf.dispatchFetch(`${origin}/mcp`, { method: 'POST', headers: { ...owner, 'Content-Type': 'application/json' },
      body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name, arguments: args } }) });
    assert.equal(response.status, 200); return (await response.json()).result;
  };
  const call = async (...args) => { const result = await rpc(...args); assert(!result.isError); return result.structuredContent.data; };
  const download = async version => {
    const link = await call('hwp_download', { document_id: version.document_id, version_id: version.version_id });
    const response = await mf.dispatchFetch(link.download_url, { headers: owner }); assert.equal(response.status, 200);
    return new Uint8Array(await response.arrayBuffer());
  };
  const readAll = async version => {
    let cursor, pages = 0; const found = new Map();
    do {
      const result = await call('hwp_read', { document_id: version.document_id, version_id: version.version_id,
        max_chars: 29, max_blocks: 2, ...(cursor ? { cursor } : {}) });
      assert.equal(result.source_sha256, version.sha256);
      assert.deepEqual(result.replacement_text_constraints, EDIT_TEXT_CONSTRAINTS);
      for (const block of result.blocks) {
        const old = found.get(block.id);
        assert.equal(block.start_offset, old ? [...old.text].length : 0);
        if (old) { assert.equal(old.fragment_complete, false); assert.equal(old.target_id, block.target_id); }
        assert.equal(block.text.isWellFormed(), true);
        found.set(block.id, { ...block, text: (old?.text ?? '') + block.text });
      }
      cursor = result.next_cursor;
      assert.equal(result.complete, !cursor); assert(++pages < 1000);
      if (!cursor) assert.equal(result.content_complete, true);
    } while (cursor);
    assert([...found.values()].every(b => b.fragment_complete));
    return { blocks: [...found.values()], pages };
  };
  const capabilities = await call('hwp_capabilities', {});
  assert.equal(capabilities.replacement_text_rejection_diagnostic_available, true);
  assert.deepEqual(capabilities.replacement_text_constraints, EDIT_TEXT_CONSTRAINTS);
  const bytes = syntheticFixture(HwpDocument, api.exportChecked, {
    paragraphs: ['합성 입력 품질', '보존 문단', '반복 답변'],
    cells: [['문항 A', '반복 답변\n반복 답변'], ['문항 B', ''], ['문항 C', '비울 답변'], ['문항 D', '반복 답변']],
  });
  const uploaded = await mf.dispatchFetch(`${origin}/documents/import`, { method: 'POST', headers: {
    ...owner, Origin: origin, 'Content-Type': 'application/x-hwp', 'hwp-request-id': crypto.randomUUID() }, body: bytes });
  assert.equal(uploaded.status, 200); const first = await uploaded.json();
  const before = await readAll(first), baseline = await state();
  const body = before.blocks.find(b => b.kind === 'paragraph' && b.text === '반복 답변');
  const empty = before.blocks.find(b => b.empty_cell_fill_supported);
  const clear = before.blocks.find(b => b.cell_text_clear_supported && b.text === '비울 답변');
  const repeated = before.blocks.filter(b => b.kind === 'cell' && b.row === 0 && b.column === 1);
  assert.equal(repeated.length, 2); assert.deepEqual(repeated.map(b => b.cell_paragraph), [0, 1]);
  assert.notEqual(repeated[0].target_id, repeated[1].target_id);
  const operation = (b, new_text) => ({ target_id: b.target_id, expected_old: b.text, new_text });
  const cases = [
    ['문구\n다음', 'line_breaks'], ['문구\r\n다음', 'line_breaks'], ['문구\r다음', 'line_breaks'],
    ['\n', 'line_breaks'], ['문구\u0000끝', 'control_characters'], ['문구\u000b끝', 'control_characters'],
    ['문구\u001b끝', 'control_characters'], ['문구\ud800끝', 'ill_formed_unicode'],
    ['문구\udc00끝', 'ill_formed_unicode'], ['문구\t끝', 'empty_cell_tab'],
  ];
  let rejectedCalls = 0;
  for (const [newText, reason] of cases) {
    const edits = { expected_sha256: first.sha256, operations: [operation(body, '부분 저장 금지'), operation(empty, newText)] };
    for (const tool of ['hwp_plan', 'hwp_edit']) {
      const args = tool === 'hwp_plan' ? { document_id: first.document_id, version_id: first.version_id, ...edits }
        : { document_id: first.document_id, expected_version: first.version_id, request_id: crypto.randomUUID(), ...edits };
      const rejected = await rpc(tool, args), d = rejected.structuredContent.data.edit_diagnostic;
      assert.equal(rejected.isError, true); assert.equal(rejected.content[0].text, 'INVALID_OPERATION');
      assert.equal(d.reason, reason); assert.equal(d.operation_number, 2);
      assert.equal(d.saved, false); assert.equal(d.file_changed, false); assert.equal(d.entire_operation_batch_rejected, true);
      assert.equal(d.retry_same_request_recommended, false); assert.equal(d.automatic_text_normalization_allowed, false);
      assert.equal(d.automatic_partial_save_allowed, false); assert.deepEqual(await state(), baseline);
      rejectedCalls++;
    }
  }
  assert.deepEqual(await download(first), bytes);
  const operations = [operation(body, '  한글·English 日本語 中文 e\u0301 👩‍💻 🇰🇷 “인용” <태그> & 공백  '),
    operation(repeated[0], '첫 문단만 수정'), operation(repeated[1], '둘째 문단만 수정 🙂'),
    operation(empty, '긴 답변 원문 유지: '.repeat(80) + '끝'), operation(clear, '')];
  const edits = { expected_sha256: first.sha256, operations };
  const plan = await call('hwp_plan', { document_id: first.document_id, version_id: first.version_id, ...edits });
  assert.equal(plan.saved, false); assert(plan.raw_preservation_verified); assert.deepEqual(await state(), baseline);
  const args = { document_id: first.document_id, expected_version: first.version_id, request_id: crypto.randomUUID(), ...edits };
  const saved = await call('hwp_edit', args); assert(saved.saved); assert(saved.raw_preservation_verified);
  const savedState = await state(), replay = await call('hwp_edit', args);
  assert(replay.replayed); assert.equal(replay.version_id, saved.version_id); assert.deepEqual(await state(), savedState);
  const after = await readAll(saved), output = await download(saved), reopened = await engine.open(output);
  const expected = before.blocks.map(b => [b.id, operations.find(op => op.target_id === b.target_id)?.new_text ?? b.text]);
  assert.equal(sha(output), saved.sha256); assert.deepEqual(after.blocks.map(b => [b.id, b.text]), expected);
  assert.deepEqual(reopened.read({ expected_sha256: saved.sha256 }).blocks.map(b => [b.id, b.text]), expected);
  assert.deepEqual((await readAll(first)).blocks.map(b => [b.id, b.text]), before.blocks.map(b => [b.id, b.text]));
  const fontRecords = file => [...parseRecords(readHwp(file).streams.get('DocInfo'))]
    .filter(r => [19, 21, 25, 26].includes(r.tag)).map(r => [r.tag, r.level, [...r.payload]]);
  assert.deepEqual(fontRecords(output), fontRecords(bytes));
  const restoreArgs = { document_id: first.document_id, expected_version: saved.version_id,
    source_version: first.version_id, request_id: crypto.randomUUID() };
  const restored = await call('hwp_restore', restoreArgs);
  assert.deepEqual(await download(restored), bytes);
  const history = await call('hwp_versions', { document_id: first.document_id }), versions = history.versions;
  assert.equal(versions.length, 3); assert.equal(history.current_version, restored.version_id);
  const finalState = await state();
  assert.equal((await call('hwp_restore', restoreArgs)).version_id, restored.version_id);
  assert.deepEqual(await state(), finalState);
  console.log(JSON.stringify({ edit_text_worker: 'passed', real_workerd_d1_r2_hwp: true,
    synthetic_documents: 1, rejected_cases: cases.length, rejected_plan_and_edit_calls: rejectedCalls,
    exact_preserved_blocks: after.blocks.length, successful_operations: operations.length,
    before_read_pages: before.pages, after_read_pages: after.pages,
    rejected_batches_preserved_all_tables_and_blobs: true, repeated_text_and_cell_paragraph_selection_verified: true,
    requested_unicode_spacing_and_punctuation_preserved: true, long_empty_cell_fill_and_clear_verified: true,
    font_and_style_definitions_preserved: true, pinned_original_read_verified: true,
    edit_and_restore_exact_retries: true, retained_versions: versions.length, restored_bytes_identical: true,
    identity_headers_are_mocks_not_oauth: true, production_deployment_verified: false,
    external_network_used: false, layout_verified: false }));
} finally { await mf.dispose(); }
