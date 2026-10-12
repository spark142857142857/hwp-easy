<a id="claude-code와-cursor에서-hwp-easy-사용하기"></a>

# Claude Code·Cursor 설치 가이드

[프로젝트 개요](../README.md) · [문서 인덱스](README.md) · [사용 가이드](quick-start.md)

HWP Easy **0.2.18**을 Claude Code와 Cursor에서 설치하고 호출하는 방법입니다. 두 앱은 Codex용 배포본과 **같은 로컬 엔진**을 사용합니다. HWP Easy 서버·원격 MCP·한글 설치가 필요하지 않으며, 실행 환경에 파일 접근 권한과 Node.js 22 이상이 필요합니다. 에이전트의 로그인과 이용 조건은 해당 앱을 따릅니다.

## 설치와 호출

1. 사용하는 앱에 맞는 ZIP을 준비합니다. 현재 패키지는 저장소에서 생성하며 일반 사용자용 공개 다운로드는 준비 중입니다. 직접 빌드하려면 [개발 안내](developer-guide.md#클라이언트-패키지-생성과-검증)를 따릅니다.
2. ZIP을 풀고 안의 `hwp-easy` 폴더를 아래 위치에 둡니다. 같은 이름의 스킬이 이미 있으면 기존 설치와 버전을 먼저 확인하고 보관합니다.
3. 새 대화에서 `/hwp-easy`를 호출하고 파일 경로와 바꿀 내용을 알려 줍니다.

| 앱 | ZIP 이름 | 개인 스킬 위치 |
| --- | --- | --- |
| Claude Code | `hwp-easy-claude-code-0.2.18.zip` | Windows: `%USERPROFILE%\.claude\skills\hwp-easy`; 다른 환경: `~/.claude/skills/hwp-easy` |
| Cursor | `hwp-easy-cursor-0.2.18.zip` | Windows: `%USERPROFILE%\.cursor\skills\hwp-easy`; 다른 환경: `~/.cursor/skills/hwp-easy` |

> /hwp-easy C:\문서\지원서.hwp의 지원 동기 칸을 “지역사회 문제를 해결하는 경험을 쌓고 싶습니다.”로 채우고 같은 파일에 저장해줘. 다른 칸은 유지해줘.

스킬은 사용자가 호출한 작업에만 적용됩니다. 두 앱의 `disable-model-invocation: true`와 Codex의 `allow_implicit_invocation: false`를 유지하며, 설명이나 설치를 요청한 것만으로 문서를 수정하지 않습니다. 스킬 메뉴와 실행 권한은 앱 설정을 따릅니다. [Claude Code 공식 안내](https://code.claude.com/docs/en/skills), [Cursor 공식 안내](https://cursor.com/docs/skills)

## 저장과 복구

검사를 통과한 편집은 지정한 **같은 파일에 저장**하고, 이전 바이트는 파일 옆의 `.hwp-easy-backups`에 보관합니다. 다른 작업이 파일을 바꾸면 충돌을 알리며, 실제 변화가 없으면 저장과 백업을 만들지 않습니다.

파일 지정과 수정 요청, 저장 결과 확인, 이력 조회와 복구 예시는 [공통 사용 안내](quick-start.md)를 따릅니다. Windows·WSL·첨부 사본은 서로 다른 파일 환경일 수 있으므로 접근 가능한 실제 경로를 지정합니다. 문서별 편집 조건은 [지원 기능과 제한](supported-features.md)에 정리했습니다.

<a id="구조와-검증-범위"></a>

## 실행 구조

앱마다 엔진을 분기하지 않습니다. `plugins/hwp-easy/`의 지침과 한 번 생성한 Node/WASM 빌드로 세 앱용 배포본을 만듭니다. 앱별 차이는 호출 이름, 명시적 호출 설정과 배포 대상 기록입니다. 실행기와 WASM의 SHA-256은 세 배포본에서 같습니다. 의존성도 번들에 포함되므로 문서 실행에 Python이나 pip가 필요하지 않습니다. [전체 구조](architecture.md)

## 검증 범위

기준일: **2026년 10월 12일**. 유지관리자의 Windows에서 두 개인 스킬 폴더에 0.2.18을 실제 설치했습니다.

| 확인한 흐름 | 결과 |
| --- | --- |
| 설치된 실행기의 파일 처리 | 합성 HWP의 본문·두 문단 셀 편집, 같은 파일 저장·재읽기, 충돌 거부, 무변경 무저장, 이력 조회를 통과했습니다. |
| 원본과 편집본 복구 | 원본의 정확한 바이트 복구와 보관한 편집본 재복구를 통과했습니다. |
| Claude Code 실제 호출 | Windows Claude Code **2.1.296**의 `/hwp-easy` 호출로 편집·저장·재읽기를 수행하고, 별도 호출로 이력 확인과 원본 복구를 통과했습니다. |
| Cursor 실제 호출 | Windows Cursor **CLI 2026.10.01-e373342**에서 같은 편집·저장·복구 흐름을 통과했습니다. |
| 독립 판독 | 별도 Python OLE/레코드 판독과 전체 파일 해시로 요청한 내용, 비대상 스트림·서식 보존과 정확한 복구를 확인했습니다. |
| 패키지와 설치 검사 | 기존 설치 보존, 해시 변조, 자동 호출 허용, 필수 복구 참조 누락, 서버 설정과 잘못된 파일·경로를 검사합니다. 격리 실행·독립 판독은 Linux·Windows CI에서도 수행합니다. |

실제 호스트는 설치된 참조와 실행기를 사용했으며 복구 전 편집본도 유지됐습니다. 계정·토큰과 개인 문서는 배포본과 공개 기록에 포함하지 않았습니다.

Cursor IDE 채팅 화면은 별도 검증 대상입니다. 위 결과가 임의 문서의 모든 편집이나 외부 뷰어의 최종 쪽 배치를 인증하는 것은 아닙니다. 다른 사용자의 설치와 공개 배포를 포함한 남은 작업은 [프로젝트 상태](project-status.md)에 기록합니다.

## 개발자 재현

공통 빌드, 앱별 패키지 생성, 격리 설치·실행 검사와 독립 판독 명령은 [개발 시작 → 클라이언트 패키지 생성과 검증](developer-guide.md#클라이언트-패키지-생성과-검증)에 모았습니다. 일반 문서 편집은 설치된 스킬을 호출해서 요청합니다.

## English

HWP Easy 0.2.18 provides explicitly invoked personal skills for Claude Code and Cursor. Both use the same bundled local Node/WASM runtime as the Codex distribution. HWP processing requires no HWP Easy server, remote MCP or Hancom installation. The environment needs filesystem access and Node.js 22+; the agent's account requirements still apply.

Extract the matching ZIP and place its `hwp-easy` folder in `~/.claude/skills/` or `~/.cursor/skills/`. Preserve an existing installation before replacing it. In a new conversation, invoke `/hwp-easy` with the HWP path and requested edits. `disable-model-invocation: true` prevents automatic activation. Verified edits save in place and retain adjacent backups; recovery also keeps the edited version.

Actual `/hwp-easy` calls in Windows Claude Code 2.1.296 and Cursor CLI 2026.10.01-e373342 edited, saved, reread and restored a synthetic HWP through the installed runner. An independent OLE/record reader verified the requested changes, preservation and exact original bytes. Packaging and isolated runtime checks also run in Linux/Windows CI. Cursor IDE chat UI, public distribution and external-viewer layout verification remain separate. See the [project status](project-status.md) and [developer guide](developer-guide.md) for details; these guides are primarily in Korean.
