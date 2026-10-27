# HWP Easy

HWP 파일을 읽고 편집하는 로컬 도구입니다. Codex, Claude Code와 Cursor에서 같은 실행기와 문서 엔진을 사용하며, 같은 파일 저장과 이전 내용 복구를 지원합니다.

Local HWP reading and editing for Codex, Claude Code and Cursor. Every client uses the same bundled Node/WASM runtime, with same-file saves and recoverable versions.

## 설치

Node.js 22 이상이 필요합니다. 사용하는 앱에 맞는 명령을 선택합니다.

```bash
npx hwp-easy@0.5.1 install --client codex
npx hwp-easy@0.5.1 install --client claude-code
npx hwp-easy@0.5.1 install --client cursor
```

한 명령은 선택한 앱의 HWP Easy만 설치합니다. `--client`를 생략하면 기존 방식대로 Codex를 선택합니다. 공개 패키지 설치에는 npm 로그인이나 2FA가 필요하지 않습니다.

Codex는 초기 실행을 마친 Codex와 플러그인 명령을 지원하는 Codex CLI가 필요합니다. Claude Code와 Cursor 설치에는 Codex CLI가 필요하지 않습니다.

| 앱 | 설치 형식 | 호출 |
| --- | --- | --- |
| Codex | 로컬 플러그인 | 스킬 메뉴에서 HWP Easy 선택 |
| Claude Code | `~/.claude/skills/hwp-easy` 개인 스킬 | `/hwp-easy` |
| Cursor | `~/.cursor/skills/hwp-easy` 개인 스킬 | `/hwp-easy` |

설치 후 해당 앱을 다시 열고 HWP Easy를 명시적으로 호출합니다. 스킬은 호출한 작업에만 적용됩니다. 설치 명령 자체는 문서를 읽거나 편집하지 않습니다.

```text
/hwp-easy C:\문서\지원서.hwp의 지원 동기 칸을 "지역사회 문제를 해결하는 경험을 쌓고 싶습니다."로 채우고 같은 파일에 저장해줘.
```

## 업데이트와 복귀

이미 설치돼 있다면 `install` 대신 `update`를 사용합니다. 아래 명령의 앱 이름을 실제 사용하는 앱으로 바꿉니다.

```bash
npx hwp-easy@0.5.1 status --client claude-code
npx hwp-easy@0.5.1 update --client claude-code
npx hwp-easy@0.5.1 rollback --client claude-code
```

업데이트는 이전 설치를 스킬 발견 경로 밖에 보관합니다. `rollback`은 보관한 직전 플러그인 또는 스킬로 복귀하며 HWP 문서를 되돌리는 명령이 아닙니다. 문서 복구는 HWP Easy 스킬에 요청합니다. 설치 실패 시 기존 설치를 복원하고, 복원이 실패하면 보관 경로를 안내합니다.

임의로 수정한 설치나 연결 경로는 자동 교체하지 않고 거부할 수 있습니다. 앱 설정이나 별도 MCP 서버는 등록하지 않습니다. 전체 옵션은 `--help`, 상세 경로와 복구 절차는 [설치 안내](https://github.com/spark142857142857/hwp-easy/blob/main/docs/distribution.md)를 따릅니다.

Windows PowerShell에서 `npm exec`로 추가 옵션을 전달할 때는 `npm.cmd exec`를 사용합니다. `npm.ps1`이 옵션을 먼저 처리하는 경우를 확인했습니다. 위의 `npx` 앱 선택 명령도 실제로 검사합니다.

## 배포와 실행

npm 패키지는 공통 엔진을 한 번 포함하고, 설치 시 선택한 앱에 맞는 스킬 설정을 생성합니다. GitHub 마켓플레이스의 Codex 플러그인과 앱별 ZIP도 같은 빌드에서 생성합니다. 설치된 앱별 사본은 서로 독립적으로 유지합니다.

문서 실행에 npm이나 Python, HWP Easy 서버는 필요하지 않습니다. 엔진과 미리보기 자원, 라이선스는 패키지에 포함됩니다. 설치 시 자동 실행 스크립트와 외부 npm 의존성은 없습니다.

지원 여부는 문서 구조에 따라 달라집니다. 미리보기의 글꼴과 줄바꿈, 쪽 배치는 다른 문서 프로그램의 결과와 다를 수 있습니다. 에이전트에 전달된 결과의 처리는 해당 서비스의 설정과 정책을 따릅니다.

[프로젝트](https://github.com/spark142857142857/hwp-easy) | [사용 안내](https://github.com/spark142857142857/hwp-easy/blob/main/docs/quick-start.md) | [지원 범위](https://github.com/spark142857142857/hwp-easy/blob/main/docs/supported-features.md) | [문제 제보](https://github.com/spark142857142857/hwp-easy/issues)
