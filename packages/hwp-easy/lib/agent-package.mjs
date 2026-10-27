/** Produce an explicitly invoked skill from the one common plugin payload. */
import fs from 'node:fs/promises';
import path from 'node:path';
import {inspectPlugin,pluginFiles,checkedDirectory,sha256} from './plugin.mjs';
import {inspectSkill} from './agent-skill.mjs';

export async function createAgentPackage(plugin,client,output) {
  if(!['claude-code','cursor'].includes(client)) throw Error('Unknown skill client');
  const checked=await inspectPlugin(plugin);
  await checkedDirectory(path.dirname(output),true);
  await fs.mkdir(output);
  for(const name of pluginFiles) {
    const relative=name.startsWith('skills/edit-local-hwp/')?name.slice('skills/edit-local-hwp/'.length)
      :name==='LICENSE'||name.startsWith('licenses/')?name:null;
    if(!relative) continue;
    const target=path.join(output,relative);await fs.mkdir(path.dirname(target),{recursive:true});
    await fs.copyFile(path.join(plugin,name),target,fs.constants.COPYFILE_EXCL);
  }
  const body=(await fs.readFile(path.join(output,'SKILL.md'),'utf8')).replace(/^---\r?\n[\s\S]*?\r?\n---\r?\n/,'');
  const description='명시적으로 지정한 로컬 HWP를 읽고 편집해 같은 파일에 저장하고 이전 내용을 복구합니다.\nRead and edit an explicitly selected local HWP, saving checked changes in place with recovery.';
  const prompt=`---\nname: hwp-easy\ndescription: ${JSON.stringify(description)}\ndisable-model-invocation: true\n---\n${body}`;
  if(Buffer.byteLength(prompt)>8000) throw Error('Skill instructions exceed the host prompt limit');
  await fs.writeFile(path.join(output,'SKILL.md'),prompt);
  const policy=(await fs.readFile(path.join(output,'agents/openai.yaml'),'utf8')).replaceAll('$hwp-easy:edit-local-hwp','$hwp-easy');
  await fs.writeFile(path.join(output,'agents/openai.yaml'),policy);
  const files={};
  async function walk(prefix='') {
    for(const entry of (await fs.readdir(path.join(output,prefix),{withFileTypes:true})).sort((a,b)=>a.name.localeCompare(b.name,'en'))) {
      const name=prefix?prefix+'/'+entry.name:entry.name;
      if(entry.isDirectory()) await walk(name);else files[name]=sha256(await fs.readFile(path.join(output,name)));
    }
  }
  await walk();
  const manifest={...checked.manifest,distribution:{type:'agent_skill',client,skill_name:'hwp-easy',invocation:'/hwp-easy',explicit_only:true},files};
  await fs.writeFile(path.join(output,'build-manifest.json'),JSON.stringify(manifest,null,2)+'\n',{flag:'wx'});
  await inspectSkill(output,client);
  if(files['scripts/local-runner.mjs']!==checked.manifest.runner_sha256||files['scripts/rhwp_bg.wasm']!==checked.manifest.wasm_sha256)
    throw Error('Client package changed the common engine');
  return manifest;
}
