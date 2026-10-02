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
  assert.equal(report.cloud_documents_enabled, false);
  for (const key of ['document_upload_supported', 'independent_preservation_guard_ported', 'storage_contract_verified',
    'user_isolation_verified', 'layout_verified', 'total_isolate_memory_measured']) assert.equal(report[key], false, key);
  assert.equal(report.cases.length, 2);
  const call = (body, authenticated = false) => mf.dispatchFetch('https://probe.invalid/mcp', {
    method: 'POST', headers: { 'Content-Type': 'application/json',
      ...(authenticated ? { 'oai-authenticated-user-id': 'synthetic-user' } : {}) }, body: JSON.stringify(body) });
  let rpc = await call({ jsonrpc: '2.0', id: 1, method: 'initialize', params: {} });
  assert.equal((await rpc.json()).result.serverInfo.name, 'hwp-easy-runtime-probe');
  rpc = await call({ jsonrpc: '2.0', id: 2, method: 'tools/list' });
  const discovered = (await rpc.json()).result.tools;
  assert.equal(discovered.length, 1);
  assert.equal(discovered[0].name, 'hwp_runtime_probe');
  assert.equal(discovered[0].inputSchema.additionalProperties, false);
  const request = { jsonrpc: '2.0', id: 3, method: 'tools/call', params: { name: 'hwp_runtime_probe', arguments: {} } };
  assert.equal((await call(request)).status, 401);
  rpc = await call(request, true);
  assert.equal((await rpc.json()).result.structuredContent.engine_execution_passed, true);
  rpc = await call({ ...request, params: { ...request.params, arguments: { data: 'must-not-be-accepted' } } }, true);
  assert.equal((await rpc.json()).error.code, -32602);
  assert.equal((await mf.dispatchFetch('https://probe.invalid/upload', { method: 'POST', body: 'no documents' })).status, 404);
  console.log(JSON.stringify({ local_workerd: 'passed', checks: ['runtime', 'initialize', 'discovery', 'identity_header_presence_gate',
    'tool_call', 'no_document_arguments', 'no_upload'], report }));
} finally { await mf.dispose(); }
