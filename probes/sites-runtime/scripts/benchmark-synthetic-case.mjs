// Internal child of benchmark-synthetic.mjs: fixed cases only; stdout is numeric
// aggregates, never text, identifiers, HWP bytes or arbitrary engine errors.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { createRequire } from 'node:module';
import { pathToFileURL } from 'node:url';
import { performance } from 'node:perf_hooks';
import { createHash } from 'node:crypto';
import { HwpDocument, initSync } from '@rhwp/core';
import { createEngineApi } from '../../../src/one_hwp/rhwp_api.mjs';
import { createDocumentEngine } from '../engine/document.mjs';
import { makePerformanceFixture, performanceCases } from './performance-fixtures.mjs';
import { profileSyntheticEngine } from './synthetic-engine-profile.mjs';

const name = process.argv[2];
const requestSessions = process.argv.length === 4 && name === 'entropy1200k' && process.argv[3] === '--single-large-requests';
const singleLarge = requestSessions || (process.argv.length === 4 && name === 'entropy1200k' && process.argv[3] === '--single-large');
if ((!singleLarge && process.argv.length !== 3) || !performanceCases.includes(name)) throw Error('INVALID_ARGUMENTS');
const require = createRequire(import.meta.url), runtime = pathToFileURL(require.resolve('@rhwp/core'));
assert.equal(JSON.parse(fs.readFileSync(new URL('./package.json', runtime))).version, '0.8.6');
const started = performance.now();
process.send?.({ phase: 'init' });
const wasm = initSync({ module: fs.readFileSync(new URL('./rhwp_bg.wasm', runtime)) });
const init_ms = performance.now() - started;
const memory = () => ({ ...process.memoryUsage(), wasm_linear_bytes: wasm.memory.buffer.byteLength,
  process_peak_rss_bytes: process.resourceUsage().maxRSS * 1024 });
const profiler = singleLarge ? profileSyntheticEngine(HwpDocument) : null;
const Document = profiler?.Document ?? HwpDocument;
const engine = createDocumentEngine(Document), api = createEngineApi(Document);
process.send?.({ phase: 'fixture' });
profiler?.setPhase('fixture');
const fixtureStart = performance.now(), bytes = makePerformanceFixture(name, Document, api);
const fixture_ms = performance.now() - fixtureStart;
process.send?.({ completed_phase: 'fixture', duration_ms: fixture_ms, memory: memory() });
const hash = (input) => createHash('sha256').update(input).digest('hex');
const originalHash = hash(bytes);
global.gc();
const baseline_after_fixture_gc = memory(), samples = [];

function readAll(snapshot) {
  let cursor = null, pages = 0, total_chars = 0, last;
  const blocks = new Map();
  do {
    last = snapshot.read({ expected_sha256: snapshot.source_sha256, cursor, max_chars: 8000, max_blocks: 128 });
    assert.equal(last.target_mapping_verified, true);
    for (const block of last.blocks) {
      const previous = blocks.get(block.id);
      assert.equal(block.start_offset, previous?.end_offset ?? 0);
      const text = (previous?.text ?? '') + block.text;
      blocks.set(block.id, { ...block, text });
      total_chars += [...block.text].length;
    }
    assert.equal(last.complete, last.next_cursor === null);
    if (last.next_cursor) assert(last.next_cursor.block_index > last.page_starts_at.block_index
      || last.next_cursor.offset > last.page_starts_at.offset);
    cursor = last.next_cursor;
    assert(++pages < 4096);
  } while (cursor);
  assert.equal(last.content_complete, true);
  assert.equal(blocks.size, last.supported_blocks);
  for (const block of blocks.values()) assert.equal([...block.text].length, block.total_chars);
  return { blocks: [...blocks.values()], pages, total_chars };
}

async function cycle() {
  const timings_ms = {}, checkpoints = {};
  const timed = async (phase, action) => {
    process.send?.({ phase });
    profiler?.setPhase(phase);
    const start = performance.now();
    try { return await action(); }
    finally {
      timings_ms[phase] = performance.now() - start; checkpoints[phase] = memory();
      process.send?.({ completed_phase: phase, duration_ms: timings_ms[phase], memory: checkpoints[phase] });
    }
  };
  if (name === 'content_limit2000k') {
    await timed('open', () => assert.rejects(() => engine.open(bytes),
      (error) => error.code === 'RAW_TEXT_LIMIT_EXCEEDED'));
    assert.equal(hash(bytes), originalHash);
    return { timings_ms, checkpoints, status: 'expected_rejection',
      reason_code: 'RAW_TEXT_LIMIT_EXCEEDED', raw_text_guard_verified: true,
      scope: 'hosted_adapter_rejects_synthetic_external_cfb_rewrite', source_unchanged: true };
  }
  const snapshot = await timed('open', () => engine.open(bytes));
  const before = await timed('read_all', () => readAll(snapshot));
  // Edit a small target even when the first paragraph exceeds the edit limit.
  const target = before.blocks.find((block) => block.kind === 'cell' && block.cell === 2 && block.editable)
    ?? before.blocks.find((block) => block.editable && block.text && block.total_chars < 100);
  assert(target);
  const request = { expected_sha256: snapshot.source_sha256, operations: [{ target_id: target.target_id,
    expected_old: target.text, new_text: '합성 성능 검사 완료 😀' }] };
  let preflight, edited;
  if (requestSessions) {
    // Each old request independently opened a snapshot, then reopened the same
    // source to mutate it. Compare that full per-request cost with the direct
    // path on identical bytes/operations, including independent result reopen.
    const previousPlan = await timed('preflight_before', async () => (await engine.open(bytes)).preflight(request));
    const previousEdit = await timed('edit_before', async () => (await engine.open(bytes)).edit(request));
    preflight = await timed('preflight_after', () => engine.preflight(bytes, request, originalHash));
    edited = await timed('edit_after', () => engine.edit(bytes, request, originalHash));
    assert.deepEqual(preflight, previousPlan);
    assert.deepEqual(edited, previousEdit);
  } else {
    preflight = await timed('preflight', () => snapshot.preflight(request));
    edited = await timed('edit', () => snapshot.edit(request));
  }
  assert.equal(preflight.serialization_checked, true);
  assert.equal(preflight.saved, false);
  assert.equal(edited.raw_preservation_verified, true);
  assert.equal(edited.content_verified, true);
  assert.equal(edited.saved, false);
  const reopened = await timed('reopen', () => engine.open(edited.bytes));
  const after = await timed('read_after', () => readAll(reopened));
  assert.deepEqual(after.blocks.map(({ id, text }) => ({ id, text })),
    before.blocks.map(({ id, text }) => ({ id, text: id === target.id ? request.operations[0].new_text : text })));
  // Bound this experiment: rendering very long single paragraphs is a separate
  // workload. Never interpret a skipped preview as layout verification.
  if (['small', 'form45'].includes(name)) {
    const preview = await timed('preview_first_page', () => reopened.preview({ expected_sha256: reopened.source_sha256, page: 0 }));
    assert(preview.svg.includes('<svg'));
  }
  assert.equal(hash(bytes), originalHash);
  return { timings_ms, checkpoints, status: 'passed', read_pages: before.pages,
    blocks: before.blocks.length, total_chars: before.total_chars, edited_bytes: edited.bytes.length,
    source_unchanged: true, target_and_non_target_text_verified: true, raw_preservation_verified: true,
    preview_measured: ['small', 'form45'].includes(name), layout_verified: false };
}

const iterations = singleLarge || name === 'content_limit2000k' ? 1 : ['small', 'form45'].includes(name) ? 5 : 3;
for (let iteration = 0; iteration < iterations; iteration++) {
  const sample = await cycle();
  global.gc();
  samples.push({ iteration, ...sample, after_gc: memory() });
  process.send?.({ completed_iteration: iteration });
}
console.log(JSON.stringify({ case: name, input_bytes: bytes.length, init_ms, fixture_ms,
  comparison: requestSessions ? 'full_per_request_open_and_checked_edit_vs_direct_checked_session' : 'snapshot_workflow',
  baseline_after_fixture_gc, samples, final: memory(), synthetic_only: true,
  ...(profiler ? { engine_calls: profiler.report(), call_timing_overhead_included: true } : {}),
  scope: 'node_hosted_engine_adapter_not_deployed_worker', total_isolate_memory_measured: false }));
