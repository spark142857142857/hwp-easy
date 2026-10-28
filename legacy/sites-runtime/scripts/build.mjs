// Build artifacts only: source and fixed engine code remain unchanged.
import fs from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';
import { build } from 'esbuild';
import { copyRuntimeNotices, verifyRuntimeNotices } from '../../../scripts/lib/runtime-notices.mjs';
const require = createRequire(import.meta.url);
const core = require.resolve('@rhwp/core');
const version = JSON.parse(fs.readFileSync(path.join(path.dirname(core), 'package.json'), 'utf8')).version;
if (version !== '0.8.6') throw new Error('Pinned engine version required');
fs.mkdirSync('dist/server', { recursive: true });
await build({ entryPoints: ['worker/index.js'], bundle: true, format: 'esm',
  platform: 'browser', target: 'es2022', external: ['./rhwp_bg.wasm', 'cloudflare:workers'],
  outfile: 'dist/server/index.js', legalComments: 'eof' });
fs.copyFileSync(path.join(path.dirname(core), 'rhwp_bg.wasm'), 'dist/server/rhwp_bg.wasm');
copyRuntimeNotices({ rhwpDir: path.dirname(core),
  pakoDir: path.dirname(require.resolve('pako/package.json')), outputDir: 'dist/server' });
verifyRuntimeNotices('dist/server');
if (fs.existsSync('.openai/hosting.json')) {
  fs.mkdirSync('dist/.openai', { recursive: true });
  fs.copyFileSync('.openai/hosting.json', 'dist/.openai/hosting.json');
}
fs.mkdirSync('dist/.openai', { recursive: true });
fs.cpSync('drizzle', 'dist/.openai/drizzle', { recursive: true });
console.log('Pinned ESM + precompiled WASM module artifact built');
