import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { copyRuntimeNotices, verifyRuntimeNotices, noticeDigest, NOTICE_PINS } from '../../../scripts/lib/runtime-notices.mjs';

const require = createRequire(import.meta.url);
const root = fileURLToPath(new URL('../../../', import.meta.url));
function fixture(t) {
  const base = path.resolve(os.tmpdir());
  const dir = fs.mkdtempSync(path.join(base, 'hwp-easy-notices-'));
  t.after(() => {
    assert.equal(path.dirname(path.resolve(dir)), base);
    assert.ok(path.basename(dir).startsWith('hwp-easy-notices-'));
    fs.rmSync(dir, { recursive: true, force: true });
  });
  const options = { root: dir, rhwpDir: path.join(dir, 'rhwp'), pakoDir: path.join(dir, 'pako'), outputDir: path.join(dir, 'out') };
  for (const sub of ['rhwp', 'pako', 'out', 'vendor/rhwp', 'vendor/pako']) fs.mkdirSync(path.join(dir, sub), { recursive: true });
  const installed = {
    rhwp: path.dirname(require.resolve('@rhwp/core')),
    pako: path.dirname(require.resolve('pako/package.json')),
  };
  for (const name of ['rhwp', 'pako']) {
    for (const file of ['package.json', 'LICENSE']) fs.copyFileSync(path.join(installed[name], file), path.join(options[`${name}Dir`], file));
  }
  for (const file of ['vendor/rhwp/THIRD_PARTY_LICENSES.md', 'vendor/pako/ZLIB-LICENSE.txt', 'package-lock.json']) fs.copyFileSync(path.join(root, file), path.join(dir, file));
  // A mock binary checks packaging only; real engine tests/build run separately.
  fs.writeFileSync(path.join(options.outputDir, 'rhwp_bg.wasm'), Buffer.from([0, 97, 115, 109]));
  return options;
}

test('runtime bundle retains pinned upstream notices verbatim and verifies its manifest', (t) => {
  const opts = fixture(t);
  const manifest = copyRuntimeNotices(opts);
  assert.deepEqual(verifyRuntimeNotices(opts.outputDir), manifest);
  assert.deepEqual(manifest.packages, [NOTICE_PINS.rhwp, NOTICE_PINS.pako]);
  assert.equal(manifest.scope, 'pinned_package_notices_not_complete_wasm_sbom');
  for (const [source, output] of [
    [path.join(opts.rhwpDir, 'LICENSE'), 'RHWP-LICENSE.txt'],
    [path.join(opts.pakoDir, 'LICENSE'), 'PAKO-LICENSE.txt'],
    [path.join(opts.root, 'vendor/rhwp/THIRD_PARTY_LICENSES.md'), 'RHWP-THIRD-PARTY-LICENSES.md'],
    [path.join(opts.root, 'vendor/pako/ZLIB-LICENSE.txt'), 'PAKO-ZLIB-LICENSE.txt'],
  ]) assert.deepEqual(fs.readFileSync(path.join(opts.outputDir, output)), fs.readFileSync(source));
});

test('notice text hashes permit only CRLF normalization', () => {
  assert.equal(noticeDigest(Buffer.from('one\r\ntwo\r\n')), noticeDigest(Buffer.from('one\ntwo\n')));
  assert.notEqual(noticeDigest(Buffer.from('one\ntwo\n')), noticeDigest(Buffer.from('one\ntwo changed\n')));
});

for (const failure of ['missing supplement', 'altered license', 'wrong version', 'wrong lock integrity']) {
  test(`runtime bundle fails before writing any notices: ${failure}`, (t) => {
    const opts = fixture(t);
    if (failure === 'missing supplement') fs.unlinkSync(path.join(opts.root, 'vendor/rhwp/THIRD_PARTY_LICENSES.md'));
    if (failure === 'altered license') fs.appendFileSync(path.join(opts.pakoDir, 'LICENSE'), 'changed');
    if (failure === 'wrong version') {
      const file = path.join(opts.rhwpDir, 'package.json');
      const pkg = JSON.parse(fs.readFileSync(file, 'utf8')); pkg.version = '0.8.7';
      fs.writeFileSync(file, JSON.stringify(pkg));
    }
    if (failure === 'wrong lock integrity') {
      const file = path.join(opts.root, 'package-lock.json');
      const lock = JSON.parse(fs.readFileSync(file, 'utf8')); lock.packages['node_modules/pako'].integrity = 'sha512-bad';
      fs.writeFileSync(file, JSON.stringify(lock));
    }
    assert.throws(() => copyRuntimeNotices(opts));
    assert.deepEqual(fs.readdirSync(opts.outputDir), ['rhwp_bg.wasm']);
  });
}

for (const failure of ['missing notice', 'altered manifest', 'altered wasm']) {
  test(`artifact verification catches ${failure}`, (t) => {
    const opts = fixture(t); copyRuntimeNotices(opts);
    if (failure === 'missing notice') fs.unlinkSync(path.join(opts.outputDir, 'RHWP-LICENSE.txt'));
    if (failure === 'altered manifest') {
      const file = path.join(opts.outputDir, 'THIRD-PARTY-NOTICES.json');
      const manifest = JSON.parse(fs.readFileSync(file, 'utf8')); manifest.packages[0].revision = 'wrong';
      fs.writeFileSync(file, JSON.stringify(manifest));
    }
    if (failure === 'altered wasm') fs.appendFileSync(path.join(opts.outputDir, 'rhwp_bg.wasm'), Buffer.from([1]));
    assert.throws(() => verifyRuntimeNotices(opts.outputDir));
  });
}
