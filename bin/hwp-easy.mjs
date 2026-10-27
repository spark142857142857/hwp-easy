#!/usr/bin/env node
import fs from 'node:fs/promises';
import {fileURLToPath} from 'node:url';
import {manageInstallation} from '../lib/install.mjs';

const {version}=JSON.parse(await fs.readFile(new URL('../package.json',import.meta.url),'utf8'));
const help=`HWP Easy ${version}

Codex, Claude Code와 Cursor에 같은 로컬 HWP 엔진을 설치합니다.

  hwp-easy install --client codex
  hwp-easy install --client claude-code
  hwp-easy install --client cursor

명령: install | update | rollback | status
--client를 생략하면 기존 방식대로 codex를 선택합니다.
공통 옵션: --data-dir <보관 폴더> --json
Codex 옵션: --codex <실행 파일> --codex-home <폴더>
Claude Code / Cursor 옵션: --skills-root <스킬 상위 폴더>

Node.js 22 이상이 필요합니다. Codex 설치에는 Codex CLI를 사용합니다.
설치 후 해당 앱을 다시 열고 HWP Easy를 명시적으로 호출하세요.
`;
try {
 const args=process.argv.slice(2);
 if(args.length===0||args[0]==='--help'||args[0]==='-h')console.log(help);
 else if(args.length===1&&args[0]==='--version')console.log(version);
 else {
  if(Number(process.versions.node.split('.')[0])<22)throw Error('Node.js 22 이상이 필요합니다.');
  const command=args.shift(),options={};
  if(!['install','update','rollback','status'].includes(command))throw Error('지원하지 않는 명령입니다. --help를 확인하세요.');
  while(args.length){
   const key=args.shift();
   if(!['--json','--client','--codex','--codex-home','--skills-root','--data-dir'].includes(key)||Object.hasOwn(options,key))throw Error('잘못된 옵션: '+key);
   options[key]=key==='--json'?true:args.shift();
   if(!options[key]||(typeof options[key]==='string'&&options[key].startsWith('--')))throw Error('옵션 값이 필요합니다: '+key);
  }
  const client=options['--client']||'codex';
  if(!['codex','claude-code','cursor'].includes(client))throw Error('지원하지 않는 앱: '+client);
  if(client==='codex'&&options['--skills-root'])throw Error('--skills-root는 Claude Code와 Cursor용입니다.');
  if(client!=='codex'&&(options['--codex']||options['--codex-home']))throw Error('선택한 앱에는 Codex 옵션을 사용하지 않습니다.');
  const result=await manageInstallation({command,client,payload:fileURLToPath(new URL('../plugins/hwp-easy',import.meta.url)),
   codex:options['--codex'],codexHome:options['--codex-home'],skillsRoot:options['--skills-root'],dataDir:options['--data-dir']});
  if(options['--json'])console.log(JSON.stringify(result));
  else {
   console.log(`HWP Easy: ${result.status}${result.version?' ('+result.version+')':''} [${client}]`);
   if(result.installed_path||result.skill_path)console.log('설치 위치: '+(result.installed_path||result.skill_path));
   if(result.previous_installation)console.log('이전 설치 보관: '+result.previous_installation);
   if(result.restart_required)console.log('해당 앱을 다시 열고 HWP Easy를 명시적으로 호출하세요.');
  }
 }
}catch(error){console.error('HWP Easy: '+error.message);process.exitCode=1;}
