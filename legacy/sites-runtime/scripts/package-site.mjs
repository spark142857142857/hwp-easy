// Offline packaging only. Source push and owner-private publication remain
// separate Sites operations. Never collect credentials or arbitrary dotfiles.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { verifyRuntimeNotices } from '../../../scripts/lib/runtime-notices.mjs';

const serverFiles = ['index.js', 'rhwp_bg.wasm', 'THIRD-PARTY-NOTICES.json',
  'RHWP-LICENSE.txt', 'RHWP-THIRD-PARTY-LICENSES.md', 'PAKO-LICENSE.txt', 'PAKO-ZLIB-LICENSE.txt'];
function readRegular(root, relative) {
  let current = root;
  for (const part of relative.split('/')) {
    current = path.join(current, part);
    const stat = fs.lstatSync(current);
    if (stat.isSymbolicLink()) throw Error('PACKAGE_SYMLINK_REJECTED');
  }
  if (!fs.statSync(current).isFile()) throw Error('PACKAGE_FILE_REQUIRED');
  return fs.readFileSync(current);
}
function migrations(root, relative = 'drizzle') {
  const stat = fs.lstatSync(path.join(root, relative));
  if (stat.isSymbolicLink() || !stat.isDirectory()) throw Error('PACKAGE_MIGRATIONS_INVALID');
  return fs.readdirSync(path.join(root, relative), { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))
    .flatMap(entry => {
      const name = `${relative}/${entry.name}`;
      if (entry.isDirectory()) return migrations(root, name);
      if (!entry.isFile() || !/\.(sql|json)$/.test(entry.name)) throw Error('PACKAGE_MIGRATIONS_INVALID');
      return [name];
    });
}
export function packageSite(root, destination) {
  root = path.resolve(root); destination = path.resolve(destination);
  if (fs.existsSync(destination)) throw Error('PACKAGE_OUTPUT_EXISTS');
  const manifest = readRegular(root, '.openai/hosting.json');
  const settings = JSON.parse(manifest.toString('utf8'));
  if (typeof settings.project_id !== 'string' || !settings.project_id.startsWith('appgprj_')
    || settings.d1 !== 'DB' || settings.r2 !== 'BUCKET' || settings.static
    || !Array.isArray(settings.capabilities) || !settings.capabilities.includes('mcp')) throw Error('PACKAGE_HOSTING_INVALID');
  if (!manifest.equals(readRegular(root, 'dist/.openai/hosting.json'))) throw Error('PACKAGE_BUILD_MANIFEST_STALE');
  const contents = [['.openai/hosting.json', manifest]];
  for (const name of migrations(root)) {
    const bytes = readRegular(root, name);
    if (!bytes.equals(readRegular(root, `dist/.openai/${name}`))) throw Error('PACKAGE_BUILD_MIGRATIONS_STALE');
    contents.push([`.openai/${name}`, bytes]);
  }
  for (const name of serverFiles) contents.push([`dist/server/${name}`, readRegular(root, `dist/server/${name}`)]);
  verifyRuntimeNotices(path.join(root, 'dist/server'));
  const stage = fs.mkdtempSync(path.join(os.tmpdir(), 'hwp-site-package-'));
  try {
    for (const [name, bytes] of contents) {
      const target = path.join(stage, name); fs.mkdirSync(path.dirname(target), { recursive: true }); fs.writeFileSync(target, bytes);
    }
    const archive = path.join(stage, 'release.tar');
    execFileSync('tar', ['-cf', archive, '-C', stage, '.openai', 'dist'], { stdio: 'pipe' });
    // COPYFILE_EXCL also closes the race with another creator of destination.
    fs.copyFileSync(archive, destination, fs.constants.COPYFILE_EXCL);
    return { archive: destination, files: contents.length, bytes: fs.statSync(destination).size,
      sha256: createHash('sha256').update(fs.readFileSync(destination)).digest('hex'),
      source_push_checked: false, deployed: false };
  } finally { fs.rmSync(stage, { recursive: true, force: true }); }
}
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    if (process.argv.length !== 3 || !path.isAbsolute(process.argv[2])) throw Error('PACKAGE_ABSOLUTE_OUTPUT_REQUIRED');
    console.log(JSON.stringify(packageSite(process.cwd(), process.argv[2])));
  } catch (error) {
    const code = /^PACKAGE_[A-Z_]+$/.test(error?.message ?? '') ? error.message : 'PACKAGE_FAILED';
    console.error(code); process.exitCode = 1;
  }
}
