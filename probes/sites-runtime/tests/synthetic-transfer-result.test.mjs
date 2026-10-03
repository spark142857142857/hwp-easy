import assert from 'node:assert/strict';
import test from 'node:test';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { createRequire } from 'node:module';
import { execFile } from 'node:child_process';
import { HwpDocument, initSync } from '@rhwp/core';
import { transferFixture, verifyTransferFixture, syntheticOutputResource, SYNTHETIC_TRANSFER_SHA256, SYNTHETIC_TRANSFER_BYTES } from '../host/synthetic-transfer.mjs';
import { createDocumentEngine } from '../engine/document.mjs';
const require = createRequire(import.meta.url);
initSync({ module: await fs.readFile(new URL('./rhwp_bg.wasm', pathToFileURL(require.resolve('@rhwp/core')))) });
const source = transferFixture(HwpDocument), engine = createDocumentEngine(HwpDocument);
const before = await engine.open(source), read = before.read({ expected_sha256: before.source_sha256 });
const targets = ['paragraph', 'cell'].map((kind) => read.blocks.find((b) => b.kind === kind && b.editable && b.text));
const edited = await before.edit({ expected_sha256: before.source_sha256, operations: targets.map((b, i) => ({
  target_id: b.target_id, expected_old: b.text, new_text: `인증 범위 합성 편집 ${i} 😀` })) });
const output = await engine.open(edited.bytes);
const result = { structuredContent: { stage: 'private-development', data: {
  status: 'synthetic_transfer_passed', scope: 'server_pinned_synthetic_file_only',
  expected_fixture_sha256: SYNTHETIC_TRANSFER_SHA256, expected_fixture_bytes: SYNTHETIC_TRANSFER_BYTES,
  server_pinned_fixture_verified: true, synthetic_cleanup_complete: true, general_uploads_enabled: false,
  output_transport: 'mcp_embedded_resource', output_sha256: output.source_sha256, output_bytes: edited.bytes.length,
} }, content: [syntheticOutputResource(edited.bytes, output.source_sha256)] };
const script = fileURLToPath(new URL('../scripts/save-transfer-result.mjs', import.meta.url));
const run = (input, args = []) => new Promise((resolve) => {
  const child = execFile(process.execPath, [script, ...args], { maxBuffer: 128 * 1024 }, (error, stdout, stderr) => resolve({ error, stdout, stderr }));
  child.stdin.on('error', () => {}); child.stdin.end(input);
});
test('fixture pin rejects changed bytes, shorter input and an offset view with different data', async () => {
  assert.equal(await verifyTransferFixture(source), SYNTHETIC_TRANSFER_SHA256);
  const changed = source.slice(); changed[changed.length - 1] ^= 1;
  for (const bytes of [changed, source.subarray(1), new Uint8Array(source.length), 'not bytes']) {
    await assert.rejects(() => verifyTransferFixture(bytes), (e) => e.code === 'SYNTHETIC_FIXTURE_REQUIRED');
  }
});
test('returned MCP synthetic HWP is reproduced, saved as a new artifact and reopened', async () => {
  const saved = await run(JSON.stringify({ jsonrpc: '2.0', id: 1, result }));
  assert.equal(saved.error, null); assert.equal(saved.stderr, '');
  const report = JSON.parse(saved.stdout);
  const root = fileURLToPath(new URL('../../../', import.meta.url));
  assert.equal(path.dirname(report.path), path.join(await fs.realpath(root), 'outputs', 'synthetic-transfer'));
  assert.match(path.basename(report.path), /^edited-[0-9a-f-]{36}\.hwp$/);
  try {
    assert.deepEqual(new Uint8Array(await fs.readFile(report.path)), edited.bytes);
    assert.equal((await engine.open(new Uint8Array(await fs.readFile(report.path)))).source_sha256, output.source_sha256);
    assert.equal(report.independently_reproduced_bytes_match, true);
    assert.equal(report.native_client_transport_verified, false);
  } finally { await fs.unlink(report.path); }
});
test('result helper refuses arbitrary HWP bytes even with a matching caller hash and synthetic label', async () => {
  const forged = structuredClone(result);
  forged.content = [syntheticOutputResource(source, before.source_sha256)];
  forged.structuredContent.data.output_sha256 = before.source_sha256;
  forged.structuredContent.data.output_bytes = source.length;
  const rejected = await run(JSON.stringify(forged));
  assert.equal(rejected.error.code, 1); assert.equal(rejected.stdout, '');
  assert(!rejected.stderr.includes('58ed8'));
});
test('result helper refuses incomplete envelopes, extra resource, malformed base64 and path arguments', async () => {
  const extra = structuredClone(result); extra.content.push(extra.content[0]);
  const malformed = structuredClone(result); malformed.content[0].resource.blob = 'bad signed-url-secret';
  const incomplete = structuredClone(result); incomplete.structuredContent.data.synthetic_cleanup_complete = false;
  for (const input of ['invalid', JSON.stringify(extra), JSON.stringify(malformed), JSON.stringify(incomplete), ' '.repeat(128 * 1024 + 1)]) {
    const rejected = await run(input); assert.equal(rejected.error.code, 1); assert.equal(rejected.stdout, '');
    assert(!rejected.stderr.includes('signed-url-secret'));
  }
  assert.equal((await run(JSON.stringify(result), ['personal.hwp'])).error.code, 1);
});
