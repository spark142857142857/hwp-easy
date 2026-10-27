/** Prepare an allowlisted Git marketplace and dependency-free npm package. No publishing or installation. */
import fs from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {inspectPlugin,writeMarketplace,sha256} from '../packages/hwp-easy/lib/plugin.mjs';

const root=fileURLToPath(new URL('..',import.meta.url));
const [pluginArg,outputArg]=process.argv.slice(2);
if(!pluginArg||!outputArg||process.argv.length!==4) throw Error('Usage: node scripts/prepare_distribution.mjs <verified-plugin-folder> <fresh-destination>');
const plugin=path.resolve(pluginArg),output=path.resolve(outputArg),metadata=await inspectPlugin(plugin);
const source=path.join(root,'packages/hwp-easy');
const npm=JSON.parse(await fs.readFile(path.join(source,'package.json'),'utf8'));
if(npm.version!==metadata.version || npm.name!=='hwp-easy') throw Error('npm and plugin versions must match');
await writeMarketplace(plugin,output);
for(const name of ['package.json','bin/hwp-easy.mjs','lib/install.mjs','lib/plugin.mjs','README.md']) {
  const target=path.join(output,name);await fs.mkdir(path.dirname(target),{recursive:true});
  await fs.copyFile(path.join(source,name),target,fs.constants.COPYFILE_EXCL);
}
await fs.copyFile(path.join(root,'LICENSE'),path.join(output,'LICENSE'),fs.constants.COPYFILE_EXCL);
await fs.chmod(path.join(output,'bin/hwp-easy.mjs'),0o755);
// Git clones on Windows and Linux must preserve the audited package bytes.
await fs.writeFile(path.join(output,'.gitattributes'),'* -text\n',{flag:'wx'});
const release={version:metadata.version,plugin_digest:metadata.digest,plugin_files:metadata.files,
  runner_sha256:metadata.manifest.runner_sha256,wasm_sha256:metadata.manifest.wasm_sha256,
  source_commit:process.env.HWP_EASY_SOURCE_COMMIT || null,engine_rebuilt:false};
await fs.writeFile(path.join(output,'release-manifest.json'),JSON.stringify(release,null,2)+'\n',{flag:'wx'});
console.log(JSON.stringify({directory:output,version:metadata.version,files:Object.keys(metadata.files).length,
  plugin_digest:metadata.digest,release_manifest_sha256:sha256(await fs.readFile(path.join(output,'release-manifest.json'))),publication:'NOT_RUN'}));
