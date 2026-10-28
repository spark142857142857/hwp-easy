/** Build both app skills from the same verified plugin and shared adapter. */
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {createAgentPackage} from '../../packages/hwp-easy/lib/agent-package.mjs';
const root=fileURLToPath(new URL('../..',import.meta.url));
const base=path.resolve(process.argv[2]||path.join(root,'outputs/plugin-package/hwp-easy'));
const output=path.resolve(process.argv[3]||path.join(root,'outputs/agent-packages'));
if(process.argv.length>4)throw Error('Usage: node package_agent_skills.mjs [verified-plugin-folder] [fresh-output-root]');
for(const client of ['claude-code','cursor']){
 const directory=path.join(output,client,'hwp-easy');
 const manifest=await createAgentPackage(base,client,directory);
 console.log(JSON.stringify({client,directory,version:manifest.version,runner_sha256:manifest.runner_sha256,wasm_sha256:manifest.wasm_sha256}));
}
