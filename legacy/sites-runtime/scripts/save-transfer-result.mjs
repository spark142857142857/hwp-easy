// Developer/client verification helper ONLY. Accept an MCP result on stdin,
// never a source path, arbitrary HWP, URL or destination chosen by a caller.
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { createRequire } from 'node:module';
import { StringDecoder } from 'node:string_decoder';
import { HwpDocument, initSync } from '@rhwp/core';
import { createDocumentEngine } from '../../../src/one_hwp/engine/document.mjs';
import { transferFixture, verifyTransferFixture, SYNTHETIC_TRANSFER_SHA256, SYNTHETIC_TRANSFER_BYTES } from '../host/synthetic-transfer.mjs';

try {
  if (process.argv.length !== 2) throw new Error();
  let input = '', size = 0;
  const decoder = new StringDecoder('utf8');
  for await (const chunk of process.stdin) {
    if ((size += chunk.length) > 128 * 1024) throw new Error();
    input += decoder.write(chunk);
  }
  input += decoder.end();
  const envelope = JSON.parse(input), result = envelope.result ?? envelope;
  const report = result.structuredContent?.data;
  if (result.isError || result.structuredContent?.stage !== 'private-development'
    || report?.status !== 'synthetic_transfer_passed' || report.scope !== 'server_pinned_synthetic_file_only'
    || report.expected_fixture_sha256 !== SYNTHETIC_TRANSFER_SHA256 || report.expected_fixture_bytes !== SYNTHETIC_TRANSFER_BYTES
    || report.server_pinned_fixture_verified !== true || report.synthetic_cleanup_complete !== true
    || report.general_uploads_enabled !== false || report.output_transport !== 'mcp_embedded_resource') throw new Error();
  const resources = result.content?.filter((c) => c.type === 'resource');
  if (resources?.length !== 1) throw new Error();
  const resource = resources[0].resource;
  if (resource?.mimeType !== 'application/x-hwp' || typeof resource.blob !== 'string' || resource.blob.length > 90000
    || !/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(resource.blob)) throw new Error();
  const received = Buffer.from(resource.blob, 'base64');
  if (received.toString('base64') !== resource.blob || !received.length || received.length > 65536) throw new Error();
  const require = createRequire(import.meta.url), runtime = pathToFileURL(require.resolve('@rhwp/core'));
  if (JSON.parse(await fs.readFile(new URL('./package.json', runtime), 'utf8')).version !== '0.8.6') throw new Error();
  initSync({ module: await fs.readFile(new URL('./rhwp_bg.wasm', runtime)) });
  const source = transferFixture(HwpDocument);
  await verifyTransferFixture(source);
  const engine = createDocumentEngine(HwpDocument), before = await engine.open(source);
  const read = before.read({ expected_sha256: before.source_sha256 });
  const targets = ['paragraph', 'cell'].map((kind) => read.blocks.find((b) => b.kind === kind && b.editable && b.text));
  if (!targets.every(Boolean) || !read.complete) throw new Error();
  const expected = await before.edit({ expected_sha256: before.source_sha256, operations: targets.map((b, i) => ({
    target_id: b.target_id, expected_old: b.text, new_text: `인증 범위 합성 편집 ${i} 😀` })) });
  // Do not trust just a caller-supplied hash or a valid HWP container. Require
  // byte-for-byte identity with the one known, independently reproduced edit.
  if (!received.equals(Buffer.from(expected.bytes))) throw new Error();
  const reopened = await engine.open(received);
  if (report.output_sha256 !== reopened.source_sha256 || report.output_bytes !== received.length
    || resource.uri !== `hwp-easy://synthetic-transfer/${reopened.source_sha256}.hwp`) throw new Error();
  const root = fileURLToPath(new URL('../../../', import.meta.url));
  const outputRoot = path.join(root, 'outputs'), directory = path.join(outputRoot, 'synthetic-transfer');
  for (const target of [outputRoot, directory]) {
    try { await fs.mkdir(target); } catch (error) { if (error.code !== 'EEXIST') throw error; }
    const stat = await fs.lstat(target);
    if (!stat.isDirectory() || stat.isSymbolicLink()) throw new Error();
  }
  const actualDirectory = await fs.realpath(directory), actualRoot = await fs.realpath(root);
  const relative = path.relative(actualRoot, actualDirectory);
  if (relative.startsWith('..') || path.isAbsolute(relative)) throw new Error();
  const destination = path.join(actualDirectory, `edited-${crypto.randomUUID()}.hwp`);
  await fs.writeFile(destination, received, { flag: 'wx' });
  console.log(JSON.stringify({ path: destination, bytes: received.length, sha256: reopened.source_sha256,
    synthetic_only: true, independently_reproduced_bytes_match: true, container_and_content_verified: true,
    native_client_transport_verified: false, layout_verified: false }));
} catch {
  console.error('Synthetic transfer result verification failed; no unverified HWP written.');
  process.exitCode = 1;
}
