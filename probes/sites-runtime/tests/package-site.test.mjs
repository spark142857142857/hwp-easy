import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';
import { packageSite } from '../scripts/package-site.mjs';
import { copyRuntimeNotices } from '../scripts/runtime-notices.mjs';
const require = createRequire(import.meta.url);
const repo = fileURLToPath(new URL('..', import.meta.url));
function fixture(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'hwp-package-test-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  for (const dir of ['.openai', 'dist/.openai/drizzle/meta', 'dist/server', 'drizzle/meta']) fs.mkdirSync(path.join(root, dir), { recursive: true });
  const manifest = JSON.stringify({ project_id: 'appgprj_synthetic', d1: 'DB', r2: 'BUCKET', capabilities: ['mcp'] });
  for (const name of ['.openai/hosting.json', 'dist/.openai/hosting.json']) fs.writeFileSync(path.join(root, name), manifest);
  for (const prefix of ['', 'dist/.openai/']) {
    fs.writeFileSync(path.join(root, prefix + 'drizzle/0000_test.sql'), 'CREATE TABLE synthetic(id TEXT);');
    fs.writeFileSync(path.join(root, prefix + 'drizzle/meta/_journal.json'), '{}');
  }
  fs.writeFileSync(path.join(root, 'dist/server/index.js'), 'export default {fetch(){return new Response("synthetic")}}');
  // Packaging fixture only, not a claim that this mock module is a real HWP engine.
  fs.writeFileSync(path.join(root, 'dist/server/rhwp_bg.wasm'), Buffer.from([0, 97, 115, 109, 1, 0, 0, 0]));
  copyRuntimeNotices({ root: repo, outputDir: path.join(root, 'dist/server'),
    rhwpDir: path.dirname(require.resolve('@rhwp/core')), pakoDir: path.dirname(require.resolve('pako/package.json')) });
  return { root, archive: path.join(root, 'release.tar') };
}
test('archive uses supported Worker and migration paths and excludes arbitrary local files', t => {
  const { root, archive } = fixture(t);
  for (const name of ['.env', '.openai/private.json', 'dist/server/private.txt']) fs.writeFileSync(path.join(root, name), 'PRIVATE_SENTINEL');
  const result = packageSite(root, archive); assert.equal(result.deployed, false); assert.equal(result.source_push_checked, false);
  const entries = execFileSync('tar', ['-tf', archive], { encoding: 'utf8' }).split(/\r?\n/).filter(Boolean);
  assert(entries.includes('.openai/hosting.json')); assert(entries.includes('dist/server/index.js'));
  assert(entries.includes('.openai/drizzle/0000_test.sql')); assert(entries.includes('.openai/drizzle/meta/_journal.json'));
  assert(!entries.some(x => x.includes('private') || x.includes('.env') || x.startsWith('server/')));
  assert(!fs.readFileSync(archive).includes(Buffer.from('PRIVATE_SENTINEL')));
  assert.equal(execFileSync('tar', ['-xOf', archive, 'dist/server/index.js'], { encoding: 'utf8' }),
    fs.readFileSync(path.join(root, 'dist/server/index.js'), 'utf8'));
});
test('stale manifest, stale migrations and missing runtime reject before creating output', t => {
  for (const failure of ['manifest', 'migrations', 'runtime']) {
    const { root, archive } = fixture(t);
    if (failure === 'manifest') fs.appendFileSync(path.join(root, '.openai/hosting.json'), ' ');
    if (failure === 'migrations') fs.appendFileSync(path.join(root, 'drizzle/0000_test.sql'), '\n-- changed');
    if (failure === 'runtime') fs.unlinkSync(path.join(root, 'dist/server/index.js'));
    assert.throws(() => packageSite(root, archive)); assert(!fs.existsSync(archive));
  }
});
test('existing output is preserved without overwriting it', t => {
  const { root, archive } = fixture(t);
  fs.writeFileSync(archive, 'keep existing output');
  assert.throws(() => packageSite(root, archive), /PACKAGE_OUTPUT_EXISTS/);
  assert.equal(fs.readFileSync(archive, 'utf8'), 'keep existing output');
});
