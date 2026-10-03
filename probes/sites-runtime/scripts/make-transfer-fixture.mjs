// Generate only a personal-data-free HWP for native fileParams transport checks.
// Never accept a source file or overwrite any existing artifact.
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { createRequire } from 'node:module';
import { createHash } from 'node:crypto';
import { HwpDocument, initSync } from '@rhwp/core';
import { createEngineApi } from '../../../src/one_hwp/rhwp_api.mjs';
import { syntheticFixture } from '../../../src/one_hwp/synthetic_fixtures.mjs';
import { createDocumentEngine } from '../engine/document.mjs';

if (process.argv.length !== 2) throw new Error('This synthetic-only helper accepts no source or destination arguments');
const root = fileURLToPath(new URL('../../../', import.meta.url));
const require = createRequire(import.meta.url), runtime = pathToFileURL(require.resolve('@rhwp/core'));
if (JSON.parse(await fs.readFile(new URL('./package.json', runtime), 'utf8')).version !== '0.8.6') {
  throw new Error('Pinned engine version required');
}
initSync({ module: await fs.readFile(new URL('./rhwp_bg.wasm', runtime)) });
const outputRoot = path.join(root, 'outputs'), directory = path.join(outputRoot, 'synthetic-transfer');
for (const target of [outputRoot, directory]) {
  try { await fs.mkdir(target); } catch (error) { if (error.code !== 'EEXIST') throw error; }
  const stat = await fs.lstat(target);
  if (!stat.isDirectory() || stat.isSymbolicLink()) throw new Error('Synthetic output directories must not be symlinks');
}
const bytes = syntheticFixture(HwpDocument, createEngineApi(HwpDocument).exportChecked, {
  paragraphs: ['HWP Easy 합성 첨부 시험', '개인정보 없는 고정 테스트 문서', '끝까지 조회 확인'],
});
const snapshot = await createDocumentEngine(HwpDocument).open(bytes);
const inspected = snapshot.read({ expected_sha256: snapshot.source_sha256 });
if (!inspected.complete || !inspected.content_complete || !inspected.target_mapping_verified) {
  throw new Error('Synthetic fixture validation failed');
}
const actualDirectory = await fs.realpath(directory), actualRoot = await fs.realpath(root);
const relative = path.relative(actualRoot, actualDirectory);
if (relative.startsWith('..') || path.isAbsolute(relative)) throw new Error('Synthetic output directory escapes this repository');
const destination = path.join(actualDirectory, `fixture-${crypto.randomUUID()}.hwp`);
await fs.writeFile(destination, bytes, { flag: 'wx' });
console.log(JSON.stringify({ path: destination, bytes: bytes.length,
  sha256: createHash('sha256').update(bytes).digest('hex'), synthetic_only: true,
  container_and_content_verified: true, layout_verified: false, native_transfer_verified: false }));
