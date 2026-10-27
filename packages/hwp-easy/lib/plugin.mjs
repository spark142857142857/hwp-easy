import fs from 'node:fs/promises';
import path from 'node:path';
import {createHash} from 'node:crypto';

export const sha256 = bytes => createHash('sha256').update(bytes).digest('hex');
const skill = 'skills/edit-local-hwp';
export const pluginFiles = [
  'LICENSE', 'plugin.json', 'assets/hwp-easy.svg', 'build-manifest.json',
  `${skill}/SKILL.md`, `${skill}/agents/openai.yaml`,
  ...['requests.md', 'editing.md'].map(name => `${skill}/references/${name}`),
  ...['local-runner.mjs', 'rhwp_bg.wasm', 'resvg_bg.wasm', 'NanumGothic-Regular.ttf',
    'RHWP-LICENSE.txt', 'RHWP-THIRD-PARTY-LICENSES.md', 'PAKO-LICENSE.txt',
    'PAKO-ZLIB-LICENSE.txt', 'THIRD-PARTY-NOTICES.json'].map(name => `${skill}/scripts/${name}`),
  ...['THIRD_PARTY_NOTICES.md', 'RHWP-LICENSE.txt', 'RHWP-THIRD-PARTY-LICENSES.md',
    'PAKO-LICENSE.txt', 'PAKO-ZLIB-LICENSE.txt', 'CFB-LICENSE.txt', 'RESVG-LICENSE.txt',
    'NANUM-OFL.txt'].map(name => `licenses/${name}`)
].sort();

export function catalog() {
  return {name:'hwp-easy', interface:{displayName:'HWP Easy'}, plugins:[{
    name:'hwp-easy', source:{source:'local', path:'./plugins/hwp-easy'},
    policy:{installation:'AVAILABLE', authentication:'ON_INSTALL'}, category:'Productivity'
  }]};
}

export async function checkedDirectory(directory, create = false) {
  const absolute = path.resolve(directory);
  let current = path.parse(absolute).root;
  for (const part of absolute.slice(current.length).split(path.sep).filter(Boolean)) {
    current = path.join(current, part);
    if (create) { try { await fs.mkdir(current, {mode:0o700}); } catch (e) { if (e.code !== 'EEXIST') throw e; } }
    const stat = await fs.lstat(current);
    if (!stat.isDirectory() || stat.isSymbolicLink()) throw Error('Linked or non-directory installation path: '+current);
  }
  return absolute;
}

export async function inspectPlugin(directory) {
  const root = await checkedDirectory(directory), names = [];
  async function walk(relative = '') {
    for (const entry of await fs.readdir(path.join(root, relative), {withFileTypes:true})) {
      const name = relative ? relative+'/'+entry.name : entry.name;
      if (entry.isSymbolicLink()) throw Error('Plugin symlinks are not allowed');
      if (entry.isDirectory()) await walk(name);
      else if (entry.isFile()) names.push(name);
      else throw Error('Plugin contains a special file');
    }
  }
  await walk();
  if (JSON.stringify(names.sort()) !== JSON.stringify(pluginFiles)) throw Error('Plugin has unexpected or missing files');
  const files = {}, bytes = {}; let total = 0;
  for (const name of pluginFiles) {
    const stat = await fs.lstat(path.join(root, name));
    if (stat.size > 16*1024*1024 || (total += stat.size) > 32*1024*1024) throw Error('Plugin exceeds package size limit');
    bytes[name] = await fs.readFile(path.join(root, name));
    files[name] = sha256(bytes[name]);
  }
  const metadata = JSON.parse(bytes['plugin.json']), manifest = JSON.parse(bytes['build-manifest.json']);
  if (metadata.name !== 'hwp-easy' || manifest.package !== 'hwp-easy' || metadata.version !== manifest.version
      || !/^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/.test(metadata.version)) throw Error('Invalid plugin identity or version');
  const local = metadata.extensions?.['com.openai']?.requires_local_executor;
  // Preserved 0.2.x packages predate the directory-only desktop declaration.
  if (local !== true && !(metadata.version.startsWith('0.2.') && local === undefined)) throw Error('Local execution declaration is required');
  if (!/^\s+allow_implicit_invocation: false\s*$/m.test(bytes[`${skill}/agents/openai.yaml`].toString())) throw Error('Explicit-only invocation is required');
  if (bytes[`${skill}/SKILL.md`].length > 8000) throw Error('Skill prompt exceeds 8000 bytes');
  for (const [name, digest] of [
    ['local-runner.mjs', manifest.runner_sha256], ['rhwp_bg.wasm', manifest.wasm_sha256],
    ['resvg_bg.wasm', manifest.local_preview?.renderer?.wasm_sha256],
    ['NanumGothic-Regular.ttf', manifest.local_preview?.font?.sha256]
  ]) if (files[`${skill}/scripts/${name}`] !== digest) throw Error('Plugin runtime hash mismatch: '+name);
  const digest = sha256(JSON.stringify(files));
  return {version:metadata.version, files, digest, manifest};
}

// A marketplace is immutable once created; copy only the audited plugin files.
export async function writeMarketplace(plugin, destination) {
  const before = await inspectPlugin(plugin);
  await checkedDirectory(path.dirname(destination),true);
  await fs.mkdir(destination, {mode:0o700});
  for (const name of pluginFiles) {
    const target = path.join(destination, 'plugins/hwp-easy', name);
    await fs.mkdir(path.dirname(target), {recursive:true});
    await fs.copyFile(path.join(plugin, name), target, fs.constants.COPYFILE_EXCL);
  }
  const after = await inspectPlugin(path.join(destination, 'plugins/hwp-easy'));
  if (before.digest !== after.digest) throw Error('Plugin changed while copying');
  const target = path.join(destination, '.agents/plugins/marketplace.json');
  await fs.mkdir(path.dirname(target), {recursive:true});
  await fs.writeFile(target, JSON.stringify(catalog(), null, 2)+'\n', {flag:'wx'});
  return before;
}
