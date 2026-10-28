# 설치와 업데이트

[프로젝트 개요](../README.md) | [사용 가이드](quick-start.md) | [검증 기록](verification.md)

HWP Easy **0.5.2**는 Codex, Claude Code와 Cursor에 같은 엔진을 제공합니다. 실행기와 HWP 엔진, 미리보기 자원과 라이선스를 함께 배포하며 HWP Easy 서버는 필요하지 않습니다. OpenAI 공개 디렉터리 게시와는 별도 배포 경로입니다.

## npm으로 설치

Node.js 22 이상과 파일 접근 권한이 필요합니다. 사용하는 앱에 맞는 명령 하나를 실행합니다.

```bash
npx hwp-easy@0.5.2 install --client codex
npx hwp-easy@0.5.2 install --client claude-code
npx hwp-easy@0.5.2 install --client cursor
```

한 명령은 선택한 앱만 설치합니다. `--client`를 생략하면 기존 방식대로 Codex를 선택합니다. 공개 패키지 설치에는 npm 로그인이나 2FA가 필요하지 않습니다. 외부 npm 의존성과 자동 설치 스크립트는 없습니다.

| 앱 | 추가 조건 | 설치와 호출 |
| --- | --- | --- |
| Codex | 초기 실행을 마친 Codex와 플러그인 명령을 지원하는 Codex CLI | 영구 마켓플레이스와 플러그인 캐시에 설치. 앱을 다시 열고 HWP Easy 선택 |
| Claude Code | Claude Code의 개인 스킬 지원 | `~/.claude/skills/hwp-easy`에 설치. 새 대화에서 `/hwp-easy` |
| Cursor | Cursor의 개인 스킬 지원 | `~/.cursor/skills/hwp-easy`에 설치. 새 대화에서 `/hwp-easy` |

Claude Code와 Cursor를 설치할 때 Codex CLI는 필요하지 않습니다. 앱 로그인과 모델 이용 조건은 각 서비스를 따릅니다. 설치 명령은 HWP를 열거나 편집하지 않으며 다른 앱의 HWP Easy나 MCP 설정을 변경하지 않습니다. npm 캐시를 삭제해도 설치본은 유지됩니다.

## 업데이트와 복귀

HWP 편집을 마친 뒤 `--client`에 실제 사용하는 앱을 지정합니다.

```bash
npx hwp-easy@0.5.2 status --client claude-code
npx hwp-easy@0.5.2 update --client claude-code
npx hwp-easy@0.5.2 rollback --client claude-code
```

`update`는 기존 설치를 스킬 검색 경로 밖에 보관하고 새 배포본을 검증해 설치합니다. 같은 버전의 같은 파일은 변경하지 않습니다. 버전 다운그레이드와 임의로 수정한 설치, 해시가 맞지 않는 백업과 연결 경로는 거부합니다. 설치가 실패하면 기존 설치로 복귀하며 복원에도 실패하면 보관 경로를 안내합니다.

`rollback`은 보관한 직전 **플러그인 또는 스킬 버전**으로 돌아갑니다. HWP 문서 복구는 스킬에 별도로 요청합니다. 문서 백업과 설치 백업은 서로 다릅니다.

| 대상 | 설치 백업과 상태 |
| --- | --- |
| Codex | Windows `%LOCALAPPDATA%\HWP Easy\installer`, 다른 환경 `~/.local/share/HWP Easy/installer` 아래 영구 패키지와 상태 |
| Claude Code | 기본 `~/.claude/hwp-easy-install-backups`에 이전 스킬 보관 |
| Cursor | 기본 `~/.cursor/hwp-easy-install-backups`에 이전 스킬 보관 |

두 개인 스킬의 설치 상태와 잠금은 공통 installer 폴더 아래 앱과 설치 경로별로 나눠 기록합니다. `--data-dir`로 상태 위치를 바꿨다면 이후 업데이트와 복귀에도 같은 값을 사용합니다. 개인 스킬 위치를 바꾸려면 `--skills-root '<skills 폴더>'`를 사용합니다. 백업은 그 폴더의 상위 `hwp-easy-install-backups`에 둡니다.

Codex만 `--codex-home`과 `--codex '<실행 파일>'` 옵션을 사용합니다. 잘못된 앱의 옵션은 거부합니다. 전체 옵션은 `npx hwp-easy@0.5.2 --help`로 확인합니다.

## GitHub 마켓플레이스

Codex는 GitHub의 배포 브랜치를 직접 등록할 수도 있습니다. 이 경로에는 Git과 Codex CLI가 필요합니다.

```bash
codex plugin marketplace add spark142857142857/hwp-easy --ref distribution
codex plugin add hwp-easy@hwp-easy
codex plugin list --marketplace hwp-easy --json
```

`distribution`은 완성된 배포본입니다. 특정 버전을 고정하려면 `--ref hwp-easy-local-v0.5.2`을 사용합니다. 소스 브랜치 `main`을 마켓플레이스로 등록하지 않습니다. 같은 이름으로 이미 등록했다면 설치 도우미의 `update`를 사용합니다.

직접 등록 경로의 갱신은 다음과 같습니다. 아래 직접 명령에는 도우미의 이전 버전 보관과 실패 복귀가 포함되지 않습니다.

```bash
codex plugin marketplace upgrade hwp-easy --json
codex plugin add hwp-easy@hwp-easy --json
```

## ZIP과 TGZ

[0.5.2 릴리스](https://github.com/spark142857142857/hwp-easy/releases/tag/hwp-easy-local-v0.5.2)의 `SHA256SUMS`와 다운로드 해시를 대조합니다. Windows에서는 `Get-FileHash '<파일 경로>' -Algorithm SHA256`으로 확인할 수 있습니다.

| 파일 | 용도 |
| --- | --- |
| `hwp-easy-marketplace-0.5.2.zip` | Codex 수동 설치. `.agents`와 `plugins`가 들어 있는 영구 폴더를 마켓플레이스로 등록 |
| `hwp-easy-0.5.2.zip` | Codex 플러그인 단독 ZIP. 마켓플레이스 목록 없음 |
| `hwp-easy-claude-code-0.5.2.zip` | Claude Code 개인 스킬. 내부 `hwp-easy`를 `~/.claude/skills/`에 배치 |
| `hwp-easy-cursor-0.5.2.zip` | Cursor 개인 스킬. 내부 `hwp-easy`를 `~/.cursor/skills/`에 배치 |
| `hwp-easy-0.5.2.tgz` | npm과 같은 공통 설치 도우미 |

기존 개인 스킬을 ZIP으로 교체할 때는 폴더 전체를 `skills` 밖에 먼저 보관합니다. 검색 경로 안에서 이름만 바꾸면 중복 발견될 수 있습니다. 자동 백업과 복귀가 필요하면 npm 도우미를 사용합니다.

```powershell
# Codex 마켓플레이스 ZIP을 푼 영구 폴더
codex plugin marketplace add 'C:\도구\HWP Easy' --json
codex plugin add hwp-easy@hwp-easy --json

# 다운로드한 TGZ로 선택한 앱 설치
npm.cmd exec --yes --ignore-scripts --package ./hwp-easy-0.5.2.tgz -- hwp-easy install --client cursor
```

Windows PowerShell에서 `npm exec`로 추가 옵션을 넘길 때는 `npm.cmd exec`를 사용합니다. `npm.ps1`이 옵션을 먼저 처리하는 경우를 확인했습니다. 위 `npx` 앱 선택 명령은 별도로 검사했습니다.

## 문제 해결

| 표시 | 확인할 내용 |
| --- | --- |
| Codex CLI를 찾을 수 없음 | Codex 대상이면 설치와 PATH 또는 `--codex` 확인. 다른 앱은 정확한 `--client` 지정 |
| 플러그인 명령 또는 JSON 응답을 지원하지 않음 | Codex 업데이트 후 재실행 |
| 이미 설치돼 있음 | `install` 대신 `update` 사용 |
| 설치 잠금이 존재함 | 실행 중인 설치 확인. 중단된 작업이면 다른 설치가 없는지 확인한 뒤 표시된 `install.lock`만 정리 |
| 패키지 또는 백업 해시 불일치 | 덮어쓰지 않고 중단. 검증한 릴리스나 보관 상태 확인 |
| 지원하지 않는 마켓플레이스 | 다른 플러그인을 포함한 등록은 자동 교체하지 않음. 기존 구성 확인 |

스킬은 명시적으로 호출한 작업에만 적용됩니다. [사용 가이드](quick-start.md), [설치 형식과 호출](#npm으로-설치), [실제 검증과 제한](verification.md)을 참고하세요.
