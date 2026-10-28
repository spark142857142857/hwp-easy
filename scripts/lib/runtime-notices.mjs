// Packaging checks, not a certification of every transitive WASM license.
import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';

const projectRoot = fileURLToPath(new URL('../../', import.meta.url));
export const NOTICE_PINS = Object.freeze({
  rhwp: Object.freeze({
    name: '@rhwp/core', version: '0.8.6', license: 'MIT',
    revision: 'e8800c8def63449808a4092798442652ed460552',
    integrity: 'sha512-ZMO2QMHbR4v7t86feMWiRJ4QozjjqHDGv4PyzTT4LyMuX1LeUpmQaOHrGLQpbYMJV0IWCYjVRewKqkXx+w16XQ==',
  }),
  pako: Object.freeze({
    name: 'pako', version: '3.0.2', license: '(MIT AND Zlib)',
    revision: '32be8f8e0ead1e6e8a74a1586a34f84734382d01',
    integrity: 'sha512-uBv6IT2aT1A78iU6dpNEbf6+CyhlV/6g9JlJs9kpgjFGFhruIICVRysF/W0SLzXg5+hCl+KroH7e4YUyfEmgLg==',
  }),
});
const noticeHashes = Object.freeze({
  'RHWP-LICENSE.txt': '1c3a7d5643b163a3ead4965e1bea33b832caee5bfca265efe42afcd7bc696b5b',
  'RHWP-THIRD-PARTY-LICENSES.md': '25baf4e05f26ab6009522d47843ac7247c1be64ae45658400227497106fda79b',
  'PAKO-LICENSE.txt': 'a04665b3b2de56c66730c1f720f528175739e4104f79073614aa611da1e85539',
  'PAKO-ZLIB-LICENSE.txt': '170d7d544d380b38d5f76ab5eda29475b44ef537f4564163d6d9bece85c51c13',
});
const digest = (value) => createHash('sha256').update(value).digest('hex');
// Git may use CRLF on Windows; no other content alteration is accepted.
export const noticeDigest = (bytes) => digest(bytes.toString('utf8').replace(/\r\n/g, '\n'));

export function copyRuntimeNotices({ rhwpDir, pakoDir, outputDir,
  root = projectRoot } = {}) {
  const lock = JSON.parse(fs.readFileSync(path.join(root, 'package-lock.json'), 'utf8'));
  for (const [dir, pin] of [[rhwpDir, NOTICE_PINS.rhwp], [pakoDir, NOTICE_PINS.pako]]) {
    const installed = JSON.parse(fs.readFileSync(path.join(dir, 'package.json'), 'utf8'));
    const locked = lock.packages?.[`node_modules/${pin.name}`];
    if (installed.name !== pin.name || installed.version !== pin.version
      || installed.license !== pin.license || locked?.version !== pin.version
      || locked.integrity !== pin.integrity) throw new Error('Runtime notice package pin mismatch');
  }
  const sources = {
    'RHWP-LICENSE.txt': path.join(rhwpDir, 'LICENSE'),
    'RHWP-THIRD-PARTY-LICENSES.md': path.join(root, 'vendor/rhwp/THIRD_PARTY_LICENSES.md'),
    'PAKO-LICENSE.txt': path.join(pakoDir, 'LICENSE'),
    'PAKO-ZLIB-LICENSE.txt': path.join(root, 'vendor/pako/ZLIB-LICENSE.txt'),
  };
  // Validate every input first; failure must not create a partial notice bundle.
  const contents = Object.entries(sources).map(([name, source]) => {
    const bytes = fs.readFileSync(source);
    if (noticeDigest(bytes) !== noticeHashes[name]) throw new Error('Runtime notice content mismatch');
    return [name, bytes];
  });
  const wasm = fs.readFileSync(path.join(outputDir, 'rhwp_bg.wasm'));
  const manifest = {
    schema_version: 1,
    scope: 'pinned_package_notices_not_complete_wasm_sbom',
    packages: [NOTICE_PINS.rhwp, NOTICE_PINS.pako],
    notice_sha256_lf: noticeHashes,
    wasm_sha256: digest(wasm),
    upstream_resource_inventory_is_not_artifact_inventory: true,
  };
  for (const [name, bytes] of contents) fs.writeFileSync(path.join(outputDir, name), bytes);
  fs.writeFileSync(path.join(outputDir, 'THIRD-PARTY-NOTICES.json'), JSON.stringify(manifest, null, 2) + '\n');
  return manifest;
}

export function verifyRuntimeNotices(outputDir) {
  const actual = JSON.parse(fs.readFileSync(path.join(outputDir, 'THIRD-PARTY-NOTICES.json'), 'utf8'));
  const expected = {
    schema_version: 1,
    scope: 'pinned_package_notices_not_complete_wasm_sbom',
    packages: [NOTICE_PINS.rhwp, NOTICE_PINS.pako],
    notice_sha256_lf: noticeHashes,
    wasm_sha256: digest(fs.readFileSync(path.join(outputDir, 'rhwp_bg.wasm'))),
    upstream_resource_inventory_is_not_artifact_inventory: true,
  };
  if (JSON.stringify(actual) !== JSON.stringify(expected)) throw new Error('Runtime notice manifest mismatch');
  for (const [name, hash] of Object.entries(noticeHashes)) {
    if (noticeDigest(fs.readFileSync(path.join(outputDir, name))) !== hash) throw new Error('Runtime notice artifact mismatch');
  }
  return actual;
}
