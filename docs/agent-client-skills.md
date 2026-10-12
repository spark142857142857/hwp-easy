# Claude Code와 Cursor에서 HWP Easy 사용하기

HWP Easy **0.2.18**은 Codex와 같은 로컬 실행기를 Claude Code와 Cursor용 개인 스킬로 제공합니다. 문서 처리와 저장에 HWP Easy 서버, 원격 MCP, 한글 설치가 필요하지 않습니다. 에이전트의 로그인과 이용 조건은 해당 앱을 따릅니다. 실행 환경에 파일 접근 권한과 Node.js 22 이상이 필요합니다.

## 설치와 호출

앱에 맞는 ZIP을 풀고 안의 `hwp-easy` 폴더를 아래 위치에 둡니다. 같은 이름의 스킬이 있으면 덮어쓰지 말고 기존 설치와 버전을 먼저 확인합니다. 공개 다운로드 배포는 아직 별도이며, 현재 패키지는 이 저장소에서 생성합니다.

| 앱 | 개인 스킬 위치 | 호출 |
| --- | --- | --- |
| Claude Code | Windows: `%USERPROFILE%\.claude\skills\hwp-easy`; 다른 환경: `~/.claude/skills/hwp-easy` | `/hwp-easy` |
| Cursor | Windows: `%USERPROFILE%\.cursor\skills\hwp-easy`; 다른 환경: `~/.cursor/skills/hwp-easy` | `/hwp-easy` |

새 대화에서 스킬을 선택하거나 `/hwp-easy`를 입력하고, 파일의 실제 경로와 원하는 수정을 알려 줍니다.

> /hwp-easy C:\문서\지원서.hwp의 지원 동기 칸을 아래 내용으로 채우고 같은 파일에 저장해줘. 다른 칸은 유지해줘.

> /hwp-easy C:\문서\지원서.hwp의 복구 이력을 보여줘. 아직 복구하지 마.

> /hwp-easy C:\문서\지원서.hwp를 방금 수정하기 전 내용으로 복구해줘.

두 스킬은 `disable-model-invocation: true`이므로 일반 작업에서 자동 적용되지 않습니다. Codex용 `agents/openai.yaml`의 `allow_implicit_invocation: false`도 유지합니다. 설명이나 설치를 요청한 것만으로 문서를 수정하지 않습니다. 앱의 스킬 메뉴와 실행 권한은 해당 앱의 설정을 따릅니다. [Claude Code 공식 안내](https://code.claude.com/docs/en/skills), [Cursor 공식 안내](https://cursor.com/docs/skills)

## 저장과 복구

지정한 파일을 읽고 대상·원문·현재 해시를 확인한 뒤 저장 전 검사를 수행합니다. 지원하는 수정을 **같은 파일에 저장**하며, 이전 바이트는 파일 옆의 `.hwp-easy-backups`에 보관합니다. 다른 작업이 파일을 바꾸면 오래된 버전의 저장을 거부합니다. 실제 변화가 없는 요청은 저장과 백업을 만들지 않습니다.

복구도 현재 파일을 보관하므로 되돌리기 직전의 편집본을 다시 복구할 수 있습니다. 첨부 사본과 PC 원본, Windows와 WSL은 서로 다른 파일 환경일 수 있습니다. 지정한 접근 가능한 경로를 기준으로 처리합니다. 지원 기능과 문서별 제한은 [로컬 편집 안내](local-file-editing.md)를 따릅니다.

## 구조와 검증 범위

엔진을 앱마다 분기하지 않습니다. `plugins/hwp-easy/`의 지침과 공통 Node/WASM 빌드로 두 배포본을 생성합니다. 앱별 차이는 호출 이름과 명시적 호출 설정, 배포 대상 기록입니다. 실행기와 WASM의 SHA-256은 두 앱용 패키지와 Codex용 공통 패키지에서 같습니다. 엔진과 의존성은 번들에 포함되며 문서 실행에 Python이나 pip가 필요하지 않습니다.

2026년 10월 12일 두 Windows 개인 스킬 폴더에 0.2.18을 실제 설치했습니다. **설치된 실행기**에서 합성 HWP의 본문과 두 문단 표 셀 편집, 같은 파일 저장, 재읽기, 충돌 거부, 무변경 무저장, 이력, 원본의 정확한 바이트 복구와 편집본 재복구를 통과했습니다. 별도 Python OLE/레코드 판독으로 내용, 비대상 스트림, 글꼴·서식 보존과 원본 복구를 확인했습니다.

**실제 호스트 호출도 통과했습니다.** Windows의 Claude Code 2.1.296과 Cursor CLI 2026.10.01-e373342에서 `/hwp-easy`를 명시적으로 호출했습니다. 각 호스트가 설치된 참조와 실행기를 사용해 본문과 두 문단 셀을 같은 파일에 저장하고 재읽었으며, 별도 `/hwp-easy` 호출로 이력을 확인해 원본을 복구했습니다. 독립 Python 판독과 전체 파일 해시로 내용·비대상 보존·정확한 복구를 확인했습니다. 복구 전 편집본도 유지됐습니다. 실행 권한은 테스트 세션에만 지정했고 사용자 계정이나 토큰은 배포본·공개 기록에 포함하지 않았습니다.

설치 검사 10개는 기존 설치 보존, 해시 변조, 자동 호출 허용으로 변경한 지침, 필수 복구 참조 누락, 서버 설정, 추가 실행 파일과 잘못된 경로를 검사합니다. 격리 설치·실행 검사와 독립 판독은 Linux/Windows CI에서도 수행합니다. Cursor CLI 검증을 Cursor IDE 채팅 화면 검증으로 확대하지 않습니다. 임의 문서의 모든 편집과 외부 뷰어의 최종 쪽 배치를 인증한 것은 아닙니다.

## 개발자 재현

저장소의 고정 의존성을 설치한 환경에서 실행합니다. Node 실행기는 공통 빌드에서 한 번 생성합니다.

```bash
node scripts/package_local_plugin.mjs
node scripts/package_agent_skills.mjs
python scripts/archive_agent_skills.py
node --test tests/test_agent_skill_install.mjs
node scripts/check-agent-packages.mjs
python scripts/check-installed-plugin.py outputs/agent-client-check/claude-code
python scripts/check-installed-plugin.py outputs/agent-client-check/cursor
```

ZIP은 `outputs/agent-packages/hwp-easy-claude-code-0.2.18.zip`과 `outputs/agent-packages/hwp-easy-cursor-0.2.18.zip`에 생성됩니다. 개발용 검증 설치 명령은 다음과 같습니다. 기본 대상에 기존 폴더가 있으면 거부하며 호스트 설정과 MCP를 등록하지 않습니다.

```bash
node scripts/install_agent_skill.mjs --client claude-code --package outputs/agent-packages/claude-code/hwp-easy
node scripts/install_agent_skill.mjs --client cursor --package outputs/agent-packages/cursor/hwp-easy
```

## English

HWP Easy 0.2.18 provides explicitly invoked personal skills for Claude Code and Cursor. Both use the same bundled local Node/WASM runtime as the Codex distribution. HWP processing requires no HWP Easy server, remote MCP or Hancom installation; the agent's account requirements still apply. The environment needs filesystem access and Node.js 22+.

Extract the appropriate ZIP and place its `hwp-easy` folder in `~/.claude/skills/` or `~/.cursor/skills/`. Preserve an existing installation rather than overwriting it. In a new conversation, invoke `/hwp-easy`, specify the HWP path and requested edits. `disable-model-invocation: true` prevents automatic activation. Verified edits save in place and retain adjacent backups; recovery also keeps the edited version.

Both installed Windows runtimes passed synthetic editing, same-file saving, conflict rejection, history and exact-byte recovery, independently checked with an OLE/record reader. Actual `/hwp-easy` invocations in Claude Code 2.1.296 and Cursor CLI 2026.10.01-e373342 also edited, saved, reread and restored the synthetic file through the installed runner. A separate reader verified their outputs and exact original bytes. Packaging and isolated runtime checks run in Linux/Windows CI. Cursor IDE chat UI, public distribution and external-viewer layout certification remain separate.
