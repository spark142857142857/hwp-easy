/** Build a self-contained skill runtime. Does not install or submit the plugin. */
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';
import { build } from 'esbuild';
import { copyRuntimeNotices, verifyRuntimeNotices } from '../lib/runtime-notices.mjs';
import {localCfbNotices} from '../lib/local-cfb-notices.mjs';
import {localPreviewNotices} from '../lib/local-preview-notices.mjs';
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'../..');
const out=path.join(root,'outputs','plugin-package','hwp-easy');
const source=path.join(root,'plugins','hwp-easy');
const scripts=path.join(out,'skills','edit-local-hwp','scripts');
const skillPrompt=await fs.readFile(path.join(source,'skills/edit-local-hwp/SKILL.md'));
if(skillPrompt.byteLength>8000)throw Error('Plugin SKILL.md exceeds the host 8000-byte prompt limit; move details to references');
await fs.mkdir(scripts,{recursive:true});
await fs.copyFile(path.join(root,'LICENSE'),path.join(out,'LICENSE'));
for(const file of ['plugin.json','assets/hwp-easy.svg','skills/edit-local-hwp/SKILL.md','skills/edit-local-hwp/agents/openai.yaml','skills/edit-local-hwp/references/requests.md','skills/edit-local-hwp/references/editing.md']) {
  const destination=path.join(out,file);await fs.mkdir(path.dirname(destination),{recursive:true});await fs.copyFile(path.join(source,file),destination);
}
const cfbNotice=localCfbNotices(root);
const previewNotice=localPreviewNotices(root);
const built=await build({entryPoints:[path.join(root,'src/one_hwp/local_runner.mjs')],outfile:path.join(scripts,'local-runner.mjs'),bundle:true,
  platform:'node',format:'esm',target:'node22',logLevel:'warning',legalComments:'eof',metafile:true});
if(Object.keys(built.metafile.inputs).some(file=>/(?:^|\/)legacy\//.test(file)))throw Error('Local runtime must not depend on legacy code');
if(Object.keys(built.metafile.inputs).some(file=>/node_modules\/(adler-32|crc-32)\//.test(file)))throw Error('Unexpected CFB transitive dependency in local bundle');
await fs.copyFile(path.join(root,'node_modules/@rhwp/core/rhwp_bg.wasm'),path.join(scripts,'rhwp_bg.wasm'));
await fs.copyFile(path.join(root,'node_modules/@resvg/resvg-wasm/index_bg.wasm'),path.join(scripts,'resvg_bg.wasm'));
await fs.copyFile(path.join(root,'vendor/local-preview/NanumGothic-Regular.ttf'),path.join(scripts,'NanumGothic-Regular.ttf'));
copyRuntimeNotices({rhwpDir:path.join(root,'node_modules/@rhwp/core'),pakoDir:path.join(root,'node_modules/pako'),
  outputDir:scripts,root});
verifyRuntimeNotices(scripts);
await fs.mkdir(path.join(out,'licenses'),{recursive:true});
for(const [file,from] of [
  ['THIRD_PARTY_NOTICES.md','THIRD_PARTY_NOTICES.md'],
  ['RHWP-LICENSE.txt','node_modules/@rhwp/core/LICENSE'],
  ['RHWP-THIRD-PARTY-LICENSES.md','vendor/rhwp/THIRD_PARTY_LICENSES.md'],
  ['PAKO-LICENSE.txt','node_modules/pako/LICENSE'],
  ['PAKO-ZLIB-LICENSE.txt','vendor/pako/ZLIB-LICENSE.txt'],
  ['CFB-LICENSE.txt','vendor/cfb/LICENSE.txt'],
  ['RESVG-LICENSE.txt','vendor/local-preview/RESVG-LICENSE.txt'],
  ['NANUM-OFL.txt','vendor/local-preview/OFL.txt'],
])await fs.copyFile(path.join(root,from),path.join(out,'licenses',file));
const hash=data=>createHash('sha256').update(data).digest('hex');
const metadata=JSON.parse(await fs.readFile(path.join(source,'plugin.json'),'utf8'));
const manifest={package:metadata.name,version:metadata.version,runtime:'Node >=22; bundled JS and WASM; no npm or Python at execution time',
  local_cfb_writer:cfbNotice,
  local_preview:previewNotice,
  engine:'@rhwp/core 0.8.6',wasm_sha256:hash(await fs.readFile(path.join(scripts,'rhwp_bg.wasm'))),
  runner_sha256:hash(await fs.readFile(path.join(scripts,'local-runner.mjs'))),
  global_registration_changed:false,remote_deployment_changed:false,portal_submission:'NOT_RUN',directory_publication:'NOT_DONE'};
await fs.writeFile(path.join(out,'build-manifest.json'),JSON.stringify(manifest,null,2)+'\n');
console.log(JSON.stringify({directory:out,...manifest}));
