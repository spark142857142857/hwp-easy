# 설치와 업데이트

[프로젝트 개요](../README.md) | [사용 가이드](quick-start.md) | [검증 기록](distribution-0.5.0.md)

HWP Easy 0.5.0은 GitHub에서 Codex 플러그인으로 배포합니다. 실행기와 HWP 엔진, 미리보기 자원과 라이선스가 모두 포함됩니다. OpenAI 공개 디렉터리 게시와는 별도 배포 경로입니다. Claude Code와 Cursor의 갱신은 보류하며 이 설치 도우미에서도 변경하지 않습니다.

실행 환경에 Node.js 22 이상과 파일 접근 권한이 필요합니다. Codex를 설치하고 한 번 실행한 뒤, 플러그인 명령을 지원하는 Codex CLI를 사용합니다. GitHub 마켓플레이스 경로는 Git도 필요합니다. 설치 명령은 문서를 열거나 편집하지 않습니다.

## GitHub 마켓플레이스

처음 설치하는 경우 다음을 실행합니다.

```bash
codex plugin marketplace add spark142857142857/hwp-easy --ref distribution
codex plugin add hwp-easy@hwp-easy
```

Codex를 다시 연 뒤 스킬 메뉴에서 **HWP Easy**를 선택합니다. 설치 버전과 활성 상태는 다음으로 확인합니다.

```bash
codex plugin list --marketplace hwp-easy --json
```

`distribution` 브랜치는 검증한 배포본을 제공합니다. 특정 버전을 고정하려면 첫 명령의 `--ref distribution`을 `--ref hwp-easy-local-v0.5.0`으로 바꿉니다. 소스 브랜치인 `main`을 마켓플레이스 경로로 등록하지 않습니다.

이미 같은 이름의 마켓플레이스가 다른 경로로 등록돼 있다면 아래 설치 도우미의 `update`를 사용합니다. 기존 설치와 등록 경로를 확인하지 않고 지우지 않습니다.

## ZIP으로 설치

1. [0.5.0 릴리스](https://github.com/spark142857142857/hwp-easy/releases/tag/hwp-easy-local-v0.5.0)에서 **`hwp-easy-marketplace-0.5.0.zip`**을 내려받습니다.
2. `SHA256SUMS`의 해시와 대조하고 ZIP을 영구 폴더에 풉니다. 설치 후 이 폴더를 지우지 않습니다.
3. 해당 폴더를 마켓플레이스로 등록하고 플러그인을 설치합니다.

```powershell
codex plugin marketplace add 'C:\도구\HWP Easy' --json
codex plugin add hwp-easy@hwp-easy --json
```

위 경로는 `.agents`와 `plugins` 폴더가 바로 들어 있는 위치입니다. `hwp-easy-0.5.0.zip`은 플러그인 단독 ZIP으로, 마켓플레이스 목록을 포함하지 않습니다. 일반 수동 설치에는 마켓플레이스 ZIP을 사용합니다.

Windows에서 다운로드 해시는 `Get-FileHash '<내려받은 ZIP 경로>' -Algorithm SHA256`으로 확인할 수 있습니다.

## 설치 도우미

설치 도우미는 Node/WASM 엔진을 포함한 npm 패키지입니다. 현재 npm 레지스트리 게시는 게시자 2FA 인증을 기다리고 있습니다. 게시 전에는 아래 **GitHub에서 받은 TGZ 경로**를 사용합니다.

릴리스에서 `hwp-easy-0.5.0.tgz`를 내려받고 터미널을 다운로드 폴더에서 엽니다.

```bash
npm exec --yes --ignore-scripts --package ./hwp-easy-0.5.0.tgz -- hwp-easy install
```

플러그인은 npm 임시 캐시에서 별도 영구 폴더로 복사한 뒤 등록합니다. npm 캐시가 삭제돼도 설치한 플러그인은 유지됩니다. 도우미에는 외부 npm 의존성이나 자동 설치 스크립트가 없습니다.

npm 레지스트리 게시가 확인되면 다음 짧은 명령도 사용할 수 있습니다. 게시 전에는 아직 사용할 수 없습니다.

```bash
npx hwp-easy@0.5.0 install
```

## 업데이트와 복귀

HWP 편집을 마친 뒤 업데이트합니다. TGZ로 실행할 때는 다음을 사용합니다.

```bash
npm exec --yes --ignore-scripts --package ./hwp-easy-0.5.0.tgz -- hwp-easy status
npm exec --yes --ignore-scripts --package ./hwp-easy-0.5.0.tgz -- hwp-easy update
npm exec --yes --ignore-scripts --package ./hwp-easy-0.5.0.tgz -- hwp-easy rollback
```

`update`는 기존 플러그인을 별도 폴더에 보관하고 검증한 새 배포본을 설치합니다. 버전을 낮추는 업데이트는 거부하며, 설치가 실패하면 이전 플러그인으로 복귀합니다. `rollback`은 보관한 직전 **플러그인 버전**으로 돌아갑니다. HWP 문서 복구 명령은 아니며, 문서를 되돌릴 때는 스킬에 요청합니다.

보관 경로는 Windows의 `%LOCALAPPDATA%\HWP Easy\installer`, 다른 환경의 `~/.local/share/HWP Easy/installer`입니다. `--data-dir`로 바꿨다면 이후 업데이트와 복귀에도 같은 경로를 지정합니다. `--codex-home`으로 이미 생성한 다른 Codex 환경을 지정할 수 있으며 일반 설치에는 필요하지 않습니다. Codex 실행 파일을 자동으로 찾지 못하면 `--codex '<실행 파일 경로>'`를 지정합니다.

Windows PowerShell에서 도우미의 `--codex-home`, `--data-dir`, `--json` 같은 추가 옵션을 넘길 때는 `npm` 대신 `npm.cmd`를 사용합니다. `npm.ps1`이 옵션을 npm 쪽에서 처리해 도우미에 전달하지 않는 경우를 실제 검사에서 확인했습니다. 일반 `install`, `update`, `rollback` 명령에는 해당 추가 옵션이 필요하지 않습니다.

GitHub 마켓플레이스를 직접 등록한 사용자는 다음으로 배포 목록을 갱신한 뒤 새 버전을 설치할 수도 있습니다. 이 직접 명령에는 설치 도우미의 이전 버전 보관과 자동 복귀가 포함되지 않습니다.

```bash
codex plugin marketplace upgrade hwp-easy --json
codex plugin add hwp-easy@hwp-easy --json
```

## 문제 해결

| 표시 | 확인할 내용 |
| --- | --- |
| Codex CLI를 찾을 수 없음 | Codex 설치와 PATH를 확인하거나 `--codex`로 실행 파일 지정 |
| CODEX_HOME 경로가 존재하지 않음 | Codex를 먼저 실행. 별도 검사 환경이라면 `--codex-home`으로 지정한 폴더를 먼저 생성 |
| 플러그인 명령 또는 JSON 응답을 지원하지 않음 | Codex를 업데이트한 뒤 재실행 |
| 이미 설치돼 있음 | 신규 `install` 대신 `update` 사용 |
| HWP Easy가 비활성 상태 | Codex에서 활성화한 뒤 업데이트 |
| 설치 잠금이 존재함 | 다른 설치가 끝났는지 확인. 중단된 작업이면 실행 중인 설치가 없는지 확인한 뒤 표시된 보관 폴더의 `install.lock`만 정리 |
| 지원하지 않는 기존 마켓플레이스 | 다른 플러그인이 포함된 등록을 자동 교체하지 않음. 기존 구성을 먼저 확인 |
| 패키지 또는 백업 해시 불일치 | 덮어쓰지 않고 중단. 검증한 릴리스 파일을 다시 받거나 보관 상태 확인 |

스킬은 명시적으로 호출한 작업에만 적용됩니다. 설치 후 파일을 지정하고 편집, 저장과 복구를 요청하는 방법은 [사용 가이드](quick-start.md)를 따릅니다. 현재 PC의 별도 환경에서 확인한 범위와 미검증 항목은 [0.5.0 배포 검증](distribution-0.5.0.md)에 기록합니다.

[OpenAI 마켓플레이스 공식 안내](https://developers.openai.com/plugins/build/plugins) | [npm exec 공식 안내](https://docs.npmjs.com/cli/commands/npm-exec/)
