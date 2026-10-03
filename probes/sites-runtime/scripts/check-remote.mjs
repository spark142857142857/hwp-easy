// Fixed synthetic diagnostics only. The Site service credential stays in stdin
// and memory, never argv, files, logs or URLs. It does not grant user identity.
import assert from 'node:assert/strict';
const input = await new Promise((resolve, reject) => {
  let buffer = '';
  const terminal = process.stdin.isTTY;
  const finish = (error) => {
    process.stdin.removeListener('data', read);
    process.stdin.removeListener('end', end);
    if (terminal) process.stdin.setRawMode(false);
    process.stdin.pause();
    error ? reject(error) : resolve(buffer);
  };
  const read = (chunk) => {
    buffer += chunk;
    if (buffer.includes('\u0003') || buffer.length > 16384) finish(new Error('Input rejected'));
    else if (buffer.includes('\n') || buffer.includes('\r')) finish();
  };
  const end = () => finish();
  if (terminal) process.stdin.setRawMode(true);
  process.stdin.setEncoding('utf8');
  process.stdin.on('data', read);
  process.stdin.once('end', end);
  process.stderr.write('Ready for fixed Site diagnostic JSON on stdin (input is hidden).\n');
  process.stdin.resume();
});
let phase = 'input_validation';
try {
  const { url, token } = JSON.parse(input);
  const site = new URL(url);
  assert.equal(site.protocol, 'https:');
  assert.equal(site.hostname, 'hwp-easy-runtime-probe.spark142857.chatgpt.site');
  assert.equal(site.username + site.password + site.search + site.hash, '');
  assert.equal(site.pathname, '/');
  assert.equal(typeof token, 'string');
  assert(token.length > 0 && !/[\r\n\0]/.test(token));
  // A fresh deadline per request; a long storage probe must not expire all later checks.
  const options = { redirect: 'manual', get signal() { return AbortSignal.timeout(30000); } };
  const isDiagnostic = async (response) => {
    try { return (await response.json()).engine_execution_passed === true; } catch { return false; }
  };
  phase = 'anonymous_access';
  const anonymous = await fetch(new URL('/runtime-probe', site), options);
  console.log(JSON.stringify({ phase, status: anonymous.status }));
  assert([401, 403].includes(anonymous.status));
  assert.equal(await isDiagnostic(anonymous), false);
  phase = 'untrusted_identity_access';
  const spoofed = await fetch(new URL('/runtime-probe', site), { ...options,
    headers: { 'oai-authenticated-user-id': 'synthetic-untrusted-client' } });
  console.log(JSON.stringify({ phase, status: spoofed.status }));
  assert([401, 403].includes(spoofed.status));
  assert.equal(await isDiagnostic(spoofed), false);
  const authorization = { 'OAI-Sites-Authorization': `Bearer ${token}` };
  phase = 'document_private_boundary';
  const documentPath = '/documents/00000000-0000-4000-8000-000000000000/versions/00000000-0000-4000-8000-000000000000.hwp';
  for (const headers of [{}, { ...authorization, 'oai-authenticated-user-id': 'synthetic-untrusted-client',
    'oai-authenticated-user-email': 'untrusted@example.invalid' }]) {
    const denied = await fetch(new URL(documentPath, site), { ...options, headers });
    assert([401, 403].includes(denied.status));
  }
  phase = 'storage_private_boundary';
  for (const headers of [{}, { 'oai-authenticated-user-id': 'synthetic-untrusted-client' }]) {
    const denied = await fetch(new URL('/storage-probe', site), { ...options, method: 'POST', headers });
    assert([401, 403].includes(denied.status));
  }
  phase = 'authorized_synthetic_storage';
  const storage = await fetch(new URL('/storage-probe', site), { ...options, method: 'POST', headers: authorization });
  console.log(JSON.stringify({ phase, status: storage.status }));
  assert.equal(storage.status, 200);
  const storageReport = await storage.json();
  assert.equal(storageReport.passed, true);
  assert.equal(storageReport.persistence, 'd1-r2');
  assert.equal(storageReport.synthetic_cleanup_complete, true);
  assert.equal(storageReport.real_oauth_multi_user_verified, false);
  assert.equal(storageReport.dots_client_verified, false);
  assert.equal(storageReport.document_upload_supported, false);
  const rejectedInput = await fetch(new URL('/storage-probe', site), { ...options, method: 'POST',
    headers: authorization, body: 'No document input permitted' });
  assert.equal(rejectedInput.status, 400);
  phase = 'authorized_synthetic_runtime';
  const runtime = await fetch(new URL('/runtime-probe', site), { ...options, headers: authorization });
  console.log(JSON.stringify({ phase, status: runtime.status, content_type: runtime.headers.get('content-type') }));
  assert.equal(runtime.status, 200);
  const report = await runtime.json();
  assert.equal(report.engine_execution_passed, true);
  assert.equal(report.raw_preservation_probe_passed, true);
  assert.equal(report.raw_preservation_probe_scope, 'fixed_synthetic_fixtures_only');
  assert.equal(report.raw_preservation_target_mapping_scope, 'unique_old_visible_text_to_section0_tag66_ordinal');
  const portable = report.portable_document_contract_probe;
  assert.equal(portable.passed, true);
  assert.equal(portable.scope, 'in_memory_fixed_synthetic_bytes_only');
  assert.equal(portable.persistence, 'none');
  assert.equal(portable.saved, false);
  assert.equal(portable.codex_cloud_client_verified, false);
  for (const key of ['repeated_text_locations_distinguished', 'paged_full_text', 'version_conflict_rejected',
    'stale_target_rejected', 'whole_old_value_checked', 'duplicate_target_rejected',
    'content_and_raw_preservation_verified']) assert.equal(portable[key], true, key);
  assert.equal(report.cases.length, 2);
  for (const scenario of report.cases) {
    assert.equal(scenario.raw_preservation_probe_passed, true);
    assert.equal(scenario.binary_hwp, true);
    assert.equal(scenario.read_edit_reopen_svg, true);
    assert.deepEqual(scenario.raw_preservation_negative_checks, {
      non_target_record_loss_rejected: true, unknown_record_edit_rejected: true,
    });
  }
  for (const key of ['cloud_documents_enabled', 'document_upload_supported', 'independent_preservation_guard_ported',
    'storage_contract_verified', 'user_isolation_verified', 'layout_verified', 'total_isolate_memory_measured']) {
    assert.equal(report[key], false, key);
  }
  const call = (method, params) => fetch(new URL('/mcp', site), { ...options, method: 'POST',
    headers: { ...authorization, 'Content-Type': 'application/json', 'Accept': 'application/json, text/event-stream' },
    body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params }) });
  phase = 'mcp_initialize';
  const init = await call('initialize', { protocolVersion: '2025-06-18', capabilities: {},
    clientInfo: { name: 'synthetic-service-diagnostic', version: '0.2.0' } });
  console.log(JSON.stringify({ phase, status: init.status }));
  let discoveryVerified = false;
  // Sites may require user OAuth on /mcp even for initialization. A service
  // credential working on fixed diagnostics must not bypass that boundary.
  if (init.status === 200) {
    assert.deepEqual((await init.json()).result.serverInfo, { name: 'HWP Easy', version: '0.3.0' });
    phase = 'mcp_discovery';
    const listing = await call('tools/list', {});
    const tools = (await listing.json()).result.tools;
    assert.equal(tools.length, 12);
    assert.equal(tools[0].name, 'hwp_runtime_probe');
    discoveryVerified = true;
    phase = 'service_without_user';
    const tool = await call('tools/call', { name: 'hwp_runtime_probe', arguments: {} });
    console.log(JSON.stringify({ phase, status: tool.status }));
    assert([401, 403].includes(tool.status));
  } else assert([401, 403].includes(init.status));
  console.log(JSON.stringify({ remote_sites: 'passed', anonymous_status: anonymous.status,
    spoofed_identity_status: spoofed.status, mcp_service_initialize_status: init.status,
    remote_mcp_discovery_verified: discoveryVerified, user_mcp_connection_verified: false,
    checks: ['private_boundary', 'fixed_runtime', 'fixed_fixture_raw_preservation', 'raw_guard_fixed_negatives',
      'service_does_not_bypass_user_auth', 'document_user_auth_required', 'fixed_durable_storage', 'storage_no_document_input'], report, storage_report: storageReport }));
} catch {
  // Do not print exception objects, fetch request metadata or credential input.
  console.error(`Remote synthetic diagnostic failed at ${phase}; no credential or document data logged.`);
  process.exitCode = 1;
}
