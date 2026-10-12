/** Package the same checked local runtime as explicitly invoked standalone skills. */
import fs from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {createHash} from 'node:crypto';

const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const base=path.join(root,'outputs/plugin-package/hwp-easy');
const manifest=JSON.parse(await fs.readFile(path.join(base,'build-manifest.json'),'utf8'));
const metadata=JSON.parse(await fs.readFile(path.join(root,'plugins/hwp-easy/plugin.json'),'utf8'));
if(manifest.version!==metadata.version)throw Error('Rebuild the common local plugin before packaging other clients');
const original=path.join(base,'skills/edit-local-hwp');
const description='명시적으로 지정한 로컬 HWP를 읽고 편집해 같은 파일에 저장하고 이전 내용을 복구합니다.\nRead and edit an explicitly selected local HWP, saving checked changes in place with recovery.';
const body=(await fs.readFile(path.join(original,'SKILL.md'),'utf8')).replace(/^---\r?\n[\s\S]*?\r?\n---\r?\n/,'');
const prompt=`---\nname: hwp-easy\ndescription: ${JSON.stringify(description)}\ndisable-model-invocation: true\n---\n${body}`;
if(Buffer.byteLength(prompt)>8000)throw Error('Skill instructions exceed the host prompt limit');
const sha=bytes=>createHash('sha256').update(bytes).digest('hex');
async function filesIn(directory,prefix='') {
 const result=[];
 for(const item of await fs.readdir(path.join(directory,prefix),{withFileTypes:true})) {
  const name=path.posix.join(prefix,item.name);
  if(item.isSymbolicLink())throw Error('A package must not contain symlinks');
  if(item.isDirectory())result.push(...await filesIn(directory,name));else result.push(name);
 }
 return result.sort();
}
for(const client of ['claude-code','cursor']) {
 const output=path.join(root,'outputs/agent-packages',client,'hwp-easy');
 await fs.mkdir(output,{recursive:true});
 await fs.cp(original,output,{recursive:true});
 await fs.copyFile(path.join(base,'LICENSE'),path.join(output,'LICENSE'));
 await fs.cp(path.join(base,'licenses'),path.join(output,'licenses'),{recursive:true});
 await fs.writeFile(path.join(output,'SKILL.md'),prompt);
 const policy=(await fs.readFile(path.join(original,'agents/openai.yaml'),'utf8')).replaceAll('$hwp-easy:edit-local-hwp','$hwp-easy');
 await fs.writeFile(path.join(output,'agents/openai.yaml'),policy);
 const files={};
 for(const name of await filesIn(output))if(name!=='build-manifest.json')files[name]=sha(await fs.readFile(path.join(output,name)));
 if(files['scripts/local-runner.mjs']!==manifest.runner_sha256||files['scripts/rhwp_bg.wasm']!==manifest.wasm_sha256)throw Error('Client package changed the shared engine');
 const distribution={...manifest,distribution:{type:'agent_skill',client,skill_name:'hwp-easy',invocation:'/hwp-easy',explicit_only:true},files};
 await fs.writeFile(path.join(output,'build-manifest.json'),JSON.stringify(distribution,null,2)+'\n');
 console.log(JSON.stringify({client,directory:output,version:manifest.version,skill_bytes:Buffer.byteLength(prompt),runner_sha256:manifest.runner_sha256,wasm_sha256:manifest.wasm_sha256,files:Object.keys(files).length+1}));
}
