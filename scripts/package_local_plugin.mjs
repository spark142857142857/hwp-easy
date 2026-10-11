/** Build a self-contained skill runtime. Does not install or submit the plugin. */
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';
import { build } from '../probes/sites-runtime/node_modules/esbuild/lib/main.js';
import { copyRuntimeNotices, verifyRuntimeNotices } from '../probes/sites-runtime/scripts/runtime-notices.mjs';
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const out=path.join(root,'outputs','local-plugin-20261011','hwp-easy-local');
const source=path.join(root,'plugins','hwp-easy-local');
const scripts=path.join(out,'skills','edit-local-hwp','scripts');
await fs.mkdir(scripts,{recursive:true});
for(const file of ['plugin.json','skills/edit-local-hwp/SKILL.md','skills/edit-local-hwp/agents/openai.yaml','skills/edit-local-hwp/references/requests.md']) {
  const destination=path.join(out,file);await fs.mkdir(path.dirname(destination),{recursive:true});await fs.copyFile(path.join(source,file),destination);
}
await build({entryPoints:[path.join(root,'src/one_hwp/local_runner.mjs')],outfile:path.join(scripts,'local-runner.mjs'),bundle:true,
  platform:'node',format:'esm',target:'node22',logLevel:'warning',legalComments:'eof'});
await fs.copyFile(path.join(root,'node_modules/@rhwp/core/rhwp_bg.wasm'),path.join(scripts,'rhwp_bg.wasm'));
copyRuntimeNotices({rhwpDir:path.join(root,'node_modules/@rhwp/core'),pakoDir:path.join(root,'probes/sites-runtime/node_modules/pako'),
  outputDir:scripts,root:path.join(root,'probes/sites-runtime')});
verifyRuntimeNotices(scripts);
await fs.mkdir(path.join(out,'licenses'),{recursive:true});
for(const [file,from] of [
  ['THIRD_PARTY_NOTICES.md','THIRD_PARTY_NOTICES.md'],
  ['RHWP-LICENSE.txt','node_modules/@rhwp/core/LICENSE'],
  ['RHWP-THIRD-PARTY-LICENSES.md','probes/sites-runtime/licenses/rhwp/THIRD_PARTY_LICENSES.md'],
  ['PAKO-LICENSE.txt','probes/sites-runtime/node_modules/pako/LICENSE'],
  ['PAKO-ZLIB-LICENSE.txt','probes/sites-runtime/guard/ZLIB-LICENSE.txt'],
])await fs.copyFile(path.join(root,from),path.join(out,'licenses',file));
const hash=data=>createHash('sha256').update(data).digest('hex');
const metadata=JSON.parse(await fs.readFile(path.join(source,'plugin.json'),'utf8'));
const manifest={package:'hwp-easy-local',version:metadata.version,runtime:'Node >=22; bundled JS and WASM; no npm or Python at execution time',
  engine:'@rhwp/core 0.8.6',wasm_sha256:hash(await fs.readFile(path.join(scripts,'rhwp_bg.wasm'))),
  runner_sha256:hash(await fs.readFile(path.join(scripts,'local-runner.mjs'))),
  global_registration_changed:false,remote_deployment_changed:false,portal_submission:'NOT_RUN',directory_publication:'NOT_DONE'};
await fs.writeFile(path.join(out,'build-manifest.json'),JSON.stringify(manifest,null,2)+'\n');
console.log(JSON.stringify({directory:out,...manifest}));
