// Fixed synthetic data in LOCAL compiled workerd/D1/R2/WASM. Parallel client
// submissions do not prove server-side parallel execution or deployed capacity.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { pathToFileURL } from 'node:url';
import { createHash } from 'node:crypto';
import { performance } from 'node:perf_hooks';
import { Miniflare, convertV4MiniflareOptions } from 'miniflare';
import { HwpDocument, initSync } from '@rhwp/core';
import { createEngineApi } from '../../../src/one_hwp/rhwp_api.mjs';
import { syntheticFixture } from '../../../src/one_hwp/synthetic_fixtures.mjs';
import { applyTestMigrations } from './migrations.mjs';
import { auditStorageInventory } from './storage-inventory-audit.mjs';
import { sampleLocalProcessMemory } from './local-process-memory.mjs';

const measureMemory = process.argv.length === 3 && process.argv[2] === '--memory';
if (process.argv.length !== 2 && !measureMemory) throw Error('INVALID_ARGUMENTS');
const require = createRequire(import.meta.url), origin = 'https://concurrent-workload.invalid';
const digest = bytes => createHash('sha256').update(bytes).digest('hex');
const memorySamples = [], timings = [], readPhases = [];
let mf, sampling, interval, outbound = 0, calls = 0, inFlight = 0, maximumInFlight = 0;
async function memory(phase) {
  if (!measureMemory || sampling) return sampling;
  sampling = (async () => {
    const result = await sampleLocalProcessMemory();
    memorySamples.push({ phase, elapsed_ms: Math.round(performance.now() - started), ...result });
  })();
  try { await sampling; } finally { sampling = undefined; }
}
const started = performance.now();
try {
  await memory('before_fixture');
  initSync({ module: fs.readFileSync(new URL('./rhwp_bg.wasm', pathToFileURL(require.resolve('@rhwp/core')))) });
  const api = createEngineApi(HwpDocument);
  const largeTexts = ['합성', '가'.repeat(100000), '가'.repeat(99999), '가'.repeat(99999), '가'.repeat(99999), '끝'];
  assert.equal(largeTexts.reduce((n, text) => n + text.length, 0), 400000);
  const smallTexts = ['첫 합성 문단', '중간 합성 문단', '마지막 합성 문단'];
  const fixtureStart = performance.now();
  const largeBytes = syntheticFixture(HwpDocument, api.exportChecked, { table: false, paragraphs: largeTexts });
  const smallBytes = syntheticFixture(HwpDocument, api.exportChecked, { table: false, paragraphs: smallTexts });
  timings.push({ phase: 'generate_synthetic_fixtures', ms: performance.now() - fixtureStart });
  const largeOriginalHash = digest(largeBytes), smallOriginalHash = digest(smallBytes);
  await memory('after_fixture');
  mf = new Miniflare(convertV4MiniflareOptions({ compatibilityDate: '2026-10-01',
    modulesRoot: path.resolve('dist/server'), modules: [
      { type: 'ESModule', path: path.resolve('dist/server/index.js') },
      { type: 'CompiledWasm', path: path.resolve('dist/server/rhwp_bg.wasm') }],
    d1Databases: { DB: 'concurrent-workload-d1' }, r2Buckets: { BUCKET: 'concurrent-workload-r2' },
    bindings: { HWP_EASY_ORIGIN: origin, HWP_EASY_ALLOW_UPLOADS: 'true', HWP_EASY_FILE_ORIGINS: '[]' },
    outboundService: () => { outbound++; throw Error('UNEXPECTED_NETWORK'); } }));
  const identity = { 'oai-authenticated-user-id': 'synthetic-concurrent-owner',
    'oai-authenticated-user-email': 'synthetic@example.invalid' };
  const db = await mf.getD1Database('DB'), bucket = await mf.getR2Bucket('BUCKET');
  await applyTestMigrations(db);
  await memory('runtime_ready');
  if (measureMemory) interval = setInterval(() => { void memory('during_workload'); }, 1000);
  const upload = async bytes => {
    const response = await mf.dispatchFetch(origin + '/documents/import', { method: 'POST',
      headers: { ...identity, Origin: origin, 'Content-Type': 'application/x-hwp',
        'hwp-request-id': crypto.randomUUID() }, body: bytes });
    assert.equal(response.status, 200);
    const data = await response.json(); assert.equal(data.sha256, digest(bytes)); return data;
  };
  const uploadStart = performance.now();
  const large = await upload(largeBytes), small = await upload(smallBytes);
  timings.push({ phase: 'upload_two_documents', ms: performance.now() - uploadStart });
  const capture = async () => {
    const tables = {};
    for (const table of ['hwp_documents', 'hwp_versions', 'hwp_requests', 'hwp_deletions'])
      tables[table] = (await db.prepare(`SELECT * FROM ${table}`).all()).results
        .sort((a, b) => JSON.stringify(a).localeCompare(JSON.stringify(b)));
    const blobs = [];
    const listed = await bucket.list(); assert.equal(listed.truncated, false);
    for (const object of listed.objects.sort((a, b) => a.key.localeCompare(b.key)))
      blobs.push({ key: object.key, size: object.size,
        sha256: digest(new Uint8Array(await (await bucket.get(object.key)).arrayBuffer())) });
    return { tables, blobs };
  };
  const baseline = await capture();
  assert.equal(baseline.tables.hwp_documents.length, 2); assert.equal(baseline.tables.hwp_versions.length, 2);
  const call = async (name, args) => {
    calls++; inFlight++; maximumInFlight = Math.max(maximumInFlight, inFlight);
    try {
      const response = await mf.dispatchFetch(origin + '/mcp', { method: 'POST',
        headers: { ...identity, 'Content-Type': 'application/json' },
        body: JSON.stringify({ jsonrpc: '2.0', id: calls, method: 'tools/call', params: { name, arguments: args } }) });
      assert.equal(response.status, 200);
      const message = await response.json(); assert.equal(message.error, undefined); assert(message.result);
      return message.result;
    } finally { inFlight--; }
  };
  const success = async (name, args) => {
    const result = await call(name, args); assert.equal(result.isError, undefined);
    return result.structuredContent.data;
  };
  const readAll = async (version, expectedTexts) => {
    let cursor = null, pages = 0, final, first; const blocks = new Map(), cursorKeys = new Set();
    do {
      const result = await success('hwp_read', { document_id: version.document_id, version_id: version.version_id,
        max_chars: 64000, ...(cursor ? { cursor } : {}) });
      assert.equal(result.source_sha256, version.sha256);
      assert.equal(result.storage.version_id, version.version_id); assert.equal(result.target_mapping_verified, true);
      first ??= result;
      assert.equal(result.complete, result.next_cursor === null);
      assert.equal(result.all_content_supported, true);
      for (const block of result.blocks) {
        const previous = blocks.get(block.id);
        assert.equal(block.start_offset, previous ? [...previous.text].length : 0);
        if (previous) {
          assert.equal(block.target_id, previous.target_id); assert.equal(block.kind, previous.kind);
          assert.equal(block.total_chars, previous.total_chars); assert.equal(previous.fragment_complete, false);
        }
        assert.equal(block.end_offset - block.start_offset, [...block.text].length);
        blocks.set(block.id, { ...block, text: (previous?.text ?? '') + block.text });
      }
      pages++; assert(pages <= 16);
      if (result.next_cursor) {
        const key = JSON.stringify(result.next_cursor); assert(!cursorKeys.has(key)); cursorKeys.add(key);
        assert.equal(result.next_cursor.sha256, version.sha256);
      }
      cursor = result.next_cursor; final = result;
    } while (cursor);
    const completeBlocks = [...blocks.values()];
    assert.equal(final.content_complete, true); assert.equal(completeBlocks.length, first.supported_blocks);
    for (const block of completeBlocks) { assert.equal(block.fragment_complete, true); assert.equal([...block.text].length, block.total_chars); }
    assert.deepEqual(completeBlocks.map(block => block.text), expectedTexts);
    return { blocks: completeBlocks, pages };
  };
  let sourceTarget;
  for (const phase of ['first_parallel_reads', 'repeat_parallel_reads']) {
    const began = performance.now(), countBefore = calls;
    const reads = await Promise.all(Array.from({ length: 6 }, (_, i) => i % 2 === 0
      ? readAll(large, largeTexts) : readAll(small, smallTexts)));
    sourceTarget ??= reads[0].blocks.at(-1);
    // Mutating one client response must not leak into subsequent cached reads.
    reads[0].blocks[0].text = 'mutated client copy';
    assert.equal(reads[2].blocks[0].text, largeTexts[0]);
    readPhases.push({ phase, client_chains: 6, large_chains: 3, small_chains: 3,
      requests: calls - countBefore, pages_per_chain: reads.map(read => read.pages), ms: performance.now() - began,
      full_content_and_offsets_verified: true });
    assert.deepEqual(await capture(), baseline);
    await memory(phase);
  }
  const editArgs = newText => ({ document_id: large.document_id, expected_version: large.version_id,
    request_id: crypto.randomUUID(), expected_sha256: large.sha256,
    operations: [{ target_id: sourceTarget.target_id, expected_old: sourceTarget.text, new_text: newText }] });
  const edits = [editArgs('검'), editArgs('확')], raceStart = performance.now();
  const race = await Promise.all([call('hwp_edit', edits[0]), call('hwp_edit', edits[1]),
    ...Array.from({ length: 3 }, () => readAll(large, largeTexts))]);
  timings.push({ phase: 'two_competing_saves_with_three_pinned_reads', ms: performance.now() - raceStart });
  const results = race.slice(0, 2), winners = results.map((result, index) => ({ result, index })).filter(item => !item.result.isError);
  assert.equal(winners.length, 1);
  const winner = winners[0], losing = results[1 - winner.index];
  assert.equal(losing.isError, true); assert.equal(losing.content[0].text, 'VERSION_CONFLICT');
  const saved = winner.result.structuredContent.data;
  assert.equal(saved.raw_preservation_verified, true); assert.equal(saved.content_verified, true);
  assert.equal((await capture()).tables.hwp_versions.length, 3);
  const winningTexts = [...largeTexts]; winningTexts[winningTexts.length - 1] = edits[winner.index].operations[0].new_text;
  await readAll(saved, winningTexts);
  const beforeReplay = await capture(), replay = await success('hwp_edit', edits[winner.index]);
  assert.equal(replay.version_id, saved.version_id); assert.deepEqual(await capture(), beforeReplay);
  const restoreStart = performance.now();
  const restored = await success('hwp_restore', { document_id: large.document_id, expected_version: saved.version_id,
    source_version: large.version_id, request_id: crypto.randomUUID() });
  assert.equal(restored.sha256, large.sha256);
  const response = await mf.dispatchFetch(`${origin}/documents/${large.document_id}/versions/${restored.version_id}.hwp`, { headers: identity });
  assert.equal(response.status, 200); assert.deepEqual(new Uint8Array(await response.arrayBuffer()), largeBytes);
  timings.push({ phase: 'restore_and_download_original', ms: performance.now() - restoreStart });
  const history = await success('hwp_versions', { document_id: large.document_id });
  assert.equal(history.versions.length, 3); assert.equal(history.current_version, restored.version_id);
  const finalState = await capture();
  for (const table of ['hwp_documents', 'hwp_versions', 'hwp_requests', 'hwp_deletions']) {
    const belongsToSmall = row => (table === 'hwp_documents' ? row.id : row.document_id) === small.document_id;
    assert.deepEqual(finalState.tables[table].filter(belongsToSmall), baseline.tables[table].filter(belongsToSmall));
  }
  const smallKeys = new Set(baseline.tables.hwp_versions.filter(row => row.document_id === small.document_id).map(row => row.blob_key));
  assert.deepEqual(finalState.blobs.filter(blob => smallKeys.has(blob.key)), baseline.blobs.filter(blob => smallKeys.has(blob.key)));
  assert.equal(finalState.tables.hwp_versions.length, 4); assert.equal(finalState.tables.hwp_requests.length, 4);
  const rows = (await db.prepare('SELECT blob_key, byte_size FROM hwp_versions').all()).results;
  const inventory = await auditStorageInventory(rows, { listBlobPage: async cursor => {
    const page = await bucket.list({ limit: 2, ...(cursor ? { cursor } : {}) });
    return { objects: page.objects.map(object => ({ key: object.key, size: object.size })),
      truncated: page.truncated, cursor: page.truncated ? page.cursor : null };
  } });
  assert.equal(inventory.recorded_objects, 4); assert.equal(inventory.unreferenced_managed_objects, 0);
  assert.deepEqual(await capture(), finalState); assert.equal(outbound, 0); assert(maximumInFlight >= 6);
  assert.equal(digest(largeBytes), largeOriginalHash); assert.equal(digest(smallBytes), smallOriginalHash);
  await memory('after_verification');
  if (interval) { clearInterval(interval); interval = undefined; }
  if (sampling) await sampling;
  const measured = memorySamples.filter(sample => sample.measured), runtimeSamples = measured.filter(sample => sample.direct_workerd_processes > 0);
  if (measureMemory) assert(runtimeSamples.length > 0, 'No full local process sample; cannot report runtime memory');
  console.log(JSON.stringify({ status: 'passed', scope: 'local_compiled_workerd_d1_r2_wasm_mock_identity',
    synthetic_only: true, input_utf16_units: [400000, smallTexts.reduce((n, text) => n + text.length, 0)],
    input_bytes: [largeBytes.length, smallBytes.length], input_sha256: [largeOriginalHash, smallOriginalHash],
    read_phases: readPhases, requests: calls, maximum_in_flight_client_requests: maximumInFlight,
    competing_save_winners: 1, competing_save_losers: 1, loser_error: 'VERSION_CONFLICT',
    pinned_reads_during_save_verified: true, exact_replay_unchanged: true, full_restore_bytes_verified: true,
    unrelated_document_unchanged: true, versions_retained: [3, 1], inventory, timings_ms: timings,
    outbound_requests: outbound, memory: { requested: measureMemory, samples: memorySamples,
      measured_local_process_rss: runtimeSamples.length > 0,
      maximum_sampled_driver_rss_bytes: measured.length ? Math.max(...measured.map(s => s.driver_rss_bytes)) : null,
      maximum_sampled_workerd_rss_bytes: runtimeSamples.length ? Math.max(...runtimeSamples.map(s => s.direct_workerd_rss_bytes)) : null,
      maximum_sampled_combined_rss_bytes: runtimeSamples.length ? Math.max(...runtimeSamples.map(s => s.combined_process_rss_bytes)) : null,
      scope: 'driver_and_direct_workerd_children_only_excludes_sampler_and_unrelated_processes',
      exact_peak_measured: false, shared_memory_deduplicated: false, sampling_overhead_in_timings: measureMemory,
      per_request_memory_measured: false, per_isolate_memory_measured: false, deployed_worker_memory_measured: false },
    server_execution_overlap_independently_verified: false, cache_hits_independently_verified: false,
    actual_oauth_verified: false, layout_verified: false, production_limits_changed: false,
    storage_state: 'ephemeral_miniflare_disposed_after_run', elapsed_ms: performance.now() - started }));
} finally {
  if (interval) clearInterval(interval);
  if (sampling) await sampling;
  if (mf) await mf.dispose();
}
