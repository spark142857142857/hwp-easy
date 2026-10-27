#!/usr/bin/env node
import {fileURLToPath} from 'node:url';
import {manageInstallation} from '../lib/install.mjs';

const help=`HWP Easy 0.5.0\n\nCodex용 로컬 플러그인을 설치하고 이전 설치를 보관합니다.\n\n  hwp-easy install    신규 설치\n  hwp-easy update     업데이트 및 이전 설치 보관\n  hwp-easy rollback   직전 설치로 복귀\n  hwp-easy status     설치 상태 확인\n\n옵션: --codex <실행 파일> --codex-home <폴더> --data-dir <보관 폴더> --json\n\nNode.js 22 이상과 플러그인 명령을 지원하는 Codex CLI가 필요합니다.\n설치 후 Codex를 다시 열고 HWP Easy를 명시적으로 선택하세요.\nClaude Code와 Cursor는 이 도구에서 변경하지 않습니다.\n`;
try {
  const args=process.argv.slice(2);
  if(args.length===0 || args[0]==='--help' || args[0]==='-h') { console.log(help); }
  else if(args.length===1 && args[0]==='--version') { console.log('0.5.0'); }
  else {
    if(Number(process.versions.node.split('.')[0])<22) throw Error('Node.js 22 이상이 필요합니다.');
    const command=args.shift(), options={};
    if(!['install','update','rollback','status'].includes(command)) throw Error('지원하지 않는 명령입니다. --help를 확인하세요.');
    while(args.length) {
      const key=args.shift();
      if(!['--json','--codex','--codex-home','--data-dir'].includes(key)||Object.hasOwn(options,key)) throw Error('잘못된 옵션: '+key);
      options[key]=key==='--json'?true:args.shift();
      if(!options[key] || (typeof options[key]==='string'&&options[key].startsWith('--'))) throw Error('옵션 값이 필요합니다: '+key);
    }
    const payload=fileURLToPath(new URL('../plugins/hwp-easy',import.meta.url));
    const result=await manageInstallation({command,payload,codex:options['--codex'],codexHome:options['--codex-home'],dataDir:options['--data-dir']});
    if(options['--json']) console.log(JSON.stringify(result));
    else {
      console.log(`HWP Easy: ${result.status}${result.version?' ('+result.version+')':''}`);
      if(result.installed_path) console.log('설치 위치: '+result.installed_path);
      if(result.previous_installation) console.log('이전 설치 보관: '+result.previous_installation);
      if(result.restart_required) console.log('Codex를 다시 열고 스킬 메뉴에서 HWP Easy를 선택하세요.');
    }
  }
} catch(error) { console.error('HWP Easy: '+error.message); process.exitCode=1; }
