// Synthetic-only developer helper: one bounded JSON bundle on stdin; no URL,
// source/destination arguments, OAuth credentials, uploads or document edits.
import fs from 'node:fs/promises';
import { createRequire } from 'node:module';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { HwpDocument, initSync } from '@rhwp/core';
import { readSyntheticChunkInput, saveSyntheticChunkResult } from '../client/synthetic-chunk-result.mjs';
try {
  if (process.argv.length !== 2) throw new Error();
  const input = await readSyntheticChunkInput(process.stdin);
  const require = createRequire(import.meta.url), runtime = pathToFileURL(require.resolve('@rhwp/core'));
  if (JSON.parse(await fs.readFile(new URL('./package.json', runtime), 'utf8')).version !== '0.8.6') throw new Error();
  initSync({ module: await fs.readFile(new URL('./rhwp_bg.wasm', runtime)) });
  const root = fileURLToPath(new URL('../../../', import.meta.url));
  console.log(JSON.stringify(await saveSyntheticChunkResult(input, HwpDocument, root)));
} catch {
  console.error('Fixed synthetic chunk verification failed; no unverified HWP published.');
  process.exitCode = 1;
}
