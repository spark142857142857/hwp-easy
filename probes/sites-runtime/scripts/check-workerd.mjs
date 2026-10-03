import assert from 'node:assert/strict';
import path from 'node:path';
import { Miniflare, convertV4MiniflareOptions } from 'miniflare';
const mf = new Miniflare(convertV4MiniflareOptions({
  compatibilityDate: '2026-10-01', modulesRoot: path.resolve('dist/server'),
  modules: [{ type: 'ESModule', path: path.resolve('dist/server/index.js') },
    { type: 'CompiledWasm', path: path.resolve('dist/server/rhwp_bg.wasm') }] }));
try {
  const result = await mf.dispatchFetch('https://probe.invalid/runtime-probe');
  assert.equal(result.status, 200);
  const report = await result.json();
  assert.equal(report.engine_execution_passed, true);
  assert.equal(report.raw_preservation_probe_passed, true);
  assert.equal(report.raw_preservation_probe_scope, 'fixed_synthetic_fixtures_only');
  assert.equal(report.raw_preservation_target_mapping_scope, 'unique_old_visible_text_to_section0_tag66_ordinal');
  assert.equal(report.cloud_documents_enabled, false);
  const portable = report.portable_document_contract_probe;
  assert.equal(portable.passed, true);
  assert.equal(portable.scope, 'in_memory_fixed_synthetic_bytes_only');
  assert.equal(portable.saved, false);
  assert.equal(portable.persistence, 'none');
  assert.equal(portable.codex_cloud_client_verified, false);
  assert.ok(portable.pages > 1);
  for (const key of ['repeated_text_locations_distinguished', 'paged_full_text', 'version_conflict_rejected',
    'stale_target_rejected', 'whole_old_value_checked', 'duplicate_target_rejected',
    'content_and_raw_preservation_verified']) assert.equal(portable[key], true, key);
  for (const key of ['document_upload_supported', 'independent_preservation_guard_ported', 'storage_contract_verified',
    'user_isolation_verified', 'layout_verified', 'total_isolate_memory_measured']) assert.equal(report[key], false, key);
  assert.equal(report.cases.length, 2);
  for (const scenario of report.cases) {
    assert.equal(scenario.raw_preservation_probe_passed, true);
    assert.equal(scenario.binary_hwp, true);
    assert.equal(scenario.read_edit_reopen_svg, true);
    assert.deepEqual(scenario.raw_preservation_negative_checks, {
      non_target_record_loss_rejected: true, unknown_record_edit_rejected: true,
    });
  }
  const call = (body, authenticated = false) => mf.dispatchFetch('https://probe.invalid/mcp', {
    method: 'POST', headers: { 'Content-Type': 'application/json',
      ...(authenticated ? { 'oai-authenticated-user-id': 'synthetic-user' } : {}) }, body: JSON.stringify(body) });
  let rpc = await call({ jsonrpc: '2.0', id: 1, method: 'initialize', params: {} });
  assert.deepEqual((await rpc.json()).result.serverInfo, { name: 'HWP Easy', version: '0.3.0' });
  rpc = await call({ jsonrpc: '2.0', id: 2, method: 'tools/list' });
  const discovered = (await rpc.json()).result.tools;
  assert.equal(discovered.length, 12);
  assert.equal(discovered[0].name, 'hwp_runtime_probe');
  assert.equal(discovered[0].inputSchema.additionalProperties, false);
  const request = { jsonrpc: '2.0', id: 3, method: 'tools/call', params: { name: 'hwp_runtime_probe', arguments: {} } };
  assert.equal((await call(request)).status, 401);
  rpc = await call(request, true);
  const toolReport = (await rpc.json()).result.structuredContent;
  assert.deepEqual(toolReport, report);
  rpc = await call({ ...request, params: { ...request.params, arguments: { data: 'must-not-be-accepted' } } }, true);
  assert.equal((await rpc.json()).error.code, -32602);
  assert.equal((await mf.dispatchFetch('https://probe.invalid/upload', { method: 'POST', body: 'no documents' })).status, 404);
  console.log(JSON.stringify({ local_workerd: 'passed', checks: ['runtime', 'fixed_fixture_raw_preservation', 'raw_guard_fixed_negatives',
    'initialize', 'discovery', 'identity_header_presence_gate',
    'tool_call', 'no_document_arguments', 'no_upload'], report }));
} finally { await mf.dispose(); }
