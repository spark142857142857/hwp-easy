// Developer verification ONLY: accept this built-in diagnostic's result on
// hidden stdin, independently reproduce its bytes, and create a new synthetic
// output. Never accept a personal HWP, source/destination path or URL.
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { createRequire } from 'node:module';
import { StringDecoder } from 'node:string_decoder';
import { HwpDocument, initSync } from '@rhwp/core';
import { createDocumentEngine } from '../engine/document.mjs';
import { createEngineApi } from '../../../src/one_hwp/rhwp_api.mjs';
import { syntheticFixture } from '../../../src/one_hwp/synthetic_fixtures.mjs';
try {
  if (process.argv.length !== 2) throw new Error();
  if (process.stdin.isTTY) process.stdin.setRawMode(true);
  let input = '', size = 0; const decoder = new StringDecoder('utf8');
  for await (const chunk of process.stdin) {
    if ((size += chunk.length) > 128 * 1024) throw new Error();
    input += decoder.write(chunk);
    if (process.stdin.isTTY && input.includes('\n')) {
      const end = input.indexOf('\n'); if (input.slice(end + 1).trim()) throw new Error();
      input = input.slice(0, end); break;
    }
  }
  const envelope = JSON.parse(input + decoder.end()), result = envelope.result ?? envelope;
  const report = result.structuredContent?.data;
  if (result.isError || result.structuredContent?.stage !== 'private-development'
    || report?.scope !== 'signed_in_user_fixed_synthetic_only' || report.passed !== true
    || report.synthetic_cleanup_complete !== true || report.stored_version_embedded_hwp_verified !== true
    || report.output_transport !== 'mcp_embedded_resource') throw new Error();
  const resources = result.content?.filter((c) => c.type === 'resource');
  if (resources?.length !== 1) throw new Error();
  const resource = resources[0].resource;
  if (resource?.mimeType !== 'application/x-hwp' || typeof resource.blob !== 'string' || resource.blob.length > 90000
    || !/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(resource.blob)) throw new Error();
  const received = Buffer.from(resource.blob, 'base64');
  if (!received.length || received.length > 65536 || received.toString('base64') !== resource.blob) throw new Error();
  const require = createRequire(import.meta.url), runtime = pathToFileURL(require.resolve('@rhwp/core'));
  if (JSON.parse(await fs.readFile(new URL('./package.json', runtime), 'utf8')).version !== '0.8.6') throw new Error();
  initSync({ module: await fs.readFile(new URL('./rhwp_bg.wasm', runtime)) });
  const api = createEngineApi(HwpDocument), engine = createDocumentEngine(HwpDocument);
  const source = syntheticFixture(HwpDocument, api.exportChecked, {
    paragraphs: ['합성 에이전트 문서', '합성 에이전트 문서'], cells: [['문항', '합성 답변'], ['', '보존']],
  });
  const before = await engine.open(source), read = before.read({ expected_sha256: before.source_sha256 });
  const targets = [read.blocks.find((b) => b.kind === 'paragraph' && b.editable && b.text),
    read.blocks.find((b) => b.kind === 'cell' && b.editable && b.text), read.blocks.find((b) => b.empty_cell_fill_supported)];
  if (!read.complete || !targets.every(Boolean)) throw new Error();
  const expected = await before.edit({ expected_sha256: before.source_sha256, operations: targets.map((b, i) => ({
    target_id: b.target_id, expected_old: b.text, new_text: `인증 범위 합성 편집 ${i} 😀`,
  })) });
  if (!received.equals(Buffer.from(expected.bytes)) || report.output_sha256 !== expected.output_sha256
    || report.output_bytes !== received.length) throw new Error();
  const uuid = '[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}';
  if (!new RegExp(`^hwp-easy://documents/${uuid}/versions/${uuid}/${expected.output_sha256}\\.hwp$`).test(resource.uri)) throw new Error();
  const reopened = await engine.open(received);
  if (reopened.source_sha256 !== expected.output_sha256) throw new Error();
  const root = fileURLToPath(new URL('../', import.meta.url));
  const outputRoot = path.join(root, 'outputs'), directory = path.join(outputRoot, 'synthetic-workflow');
  for (const target of [outputRoot, directory]) {
    try { await fs.mkdir(target); } catch (error) { if (error.code !== 'EEXIST') throw error; }
    const stat = await fs.lstat(target); if (!stat.isDirectory() || stat.isSymbolicLink()) throw new Error();
  }
  const actual = await fs.realpath(directory), relative = path.relative(await fs.realpath(root), actual);
  if (relative.startsWith('..') || path.isAbsolute(relative)) throw new Error();
  const destination = path.join(actual, `edited-${crypto.randomUUID()}.hwp`);
  await fs.writeFile(destination, received, { flag: 'wx' });
  console.log(JSON.stringify({ path: destination, bytes: received.length, sha256: reopened.source_sha256,
    synthetic_only: true, independently_reproduced_bytes_match: true, local_reopen_verified: true, layout_verified: false }));
} catch {
  console.error('Fixed workflow result verification failed; no unverified HWP written.'); process.exitCode = 1;
} finally {
  if (process.stdin.isTTY) process.stdin.setRawMode(false);
}
