# HWP Easy

HWP 파일을 읽고 편집하는 로컬 도구입니다. Codex에 플러그인으로 설치하며 같은 파일 저장과 이전 내용 복구를 지원합니다. 문서 처리는 사용 중인 에이전트의 파일 환경에서 이루어집니다.

Local HWP reading and editing for Codex, with same-file saves and recoverable versions. The package includes the same Node/WASM engine as the HWP Easy plugin.

## 설치

Node.js 22 이상과 플러그인 명령을 지원하는 Codex CLI가 필요합니다. 아래 명령은 HWP Easy 플러그인과 마켓플레이스만 등록합니다. 문서는 열거나 수정하지 않습니다.

```bash
npx hwp-easy@0.5.0 install
```

설치 후 Codex를 다시 열고 스킬 메뉴에서 HWP Easy를 선택합니다. 대상 HWP의 경로와 바꿀 내용을 알려 주세요. 스킬은 선택한 작업에만 적용됩니다.

```text
C:\문서\지원서.hwp의 지원 동기 칸을 "지역사회 문제를 해결하는 경험을 쌓고 싶습니다."로 채우고 같은 파일에 저장해줘.
```

## 업데이트와 복귀

```bash
npx hwp-easy@0.5.0 status
npx hwp-easy@0.5.0 update
npx hwp-easy@0.5.0 rollback
```

업데이트는 기존 플러그인을 발견 경로 밖에 보관합니다. `rollback`은 보관한 직전 플러그인으로 돌아가며 HWP 문서를 되돌리는 명령이 아닙니다. 문서 복구는 HWP Easy 스킬에 요청합니다. 업데이트 실패 시 이전 플러그인 등록과 설치를 복원하며, 복원이 실패하면 보관 경로를 안내합니다.

Windows의 기본 보관 경로는 `%LOCALAPPDATA%\HWP Easy\installer`, 다른 환경은 `~/.local/share/HWP Easy/installer`입니다. `--data-dir`로 변경할 수 있습니다. `--codex-home`은 별도 Codex 환경 검사에 사용하며 일반 설치에는 필요하지 않습니다. `--codex`로 CLI 실행 파일을 지정할 수 있습니다. 전체 옵션은 `--help`를 확인하세요.

## GitHub에서 설치

npm 없이 배포 브랜치를 마켓플레이스로 등록할 수도 있습니다. 이 경로는 Codex CLI와 Git을 사용합니다.

```bash
codex plugin marketplace add spark142857142857/hwp-easy --ref distribution
codex plugin add hwp-easy@hwp-easy
```

기존에 다른 경로의 `hwp-easy` 마켓플레이스가 등록돼 있다면 먼저 [업데이트 안내](https://github.com/spark142857142857/hwp-easy/blob/main/docs/distribution.md)를 확인하세요.

## 실행과 지원 범위

엔진, 미리보기 자원과 라이선스는 패키지에 포함됩니다. 설치 도우미에는 외부 npm 의존성이나 설치 시 자동 실행 스크립트가 없습니다. 문서 실행에 npm이나 Python, HWP Easy 서버가 필요하지 않습니다. Claude Code와 Cursor의 설치는 이 도구에서 변경하지 않습니다.

지원 여부는 문서 구조에 따라 달라집니다. 미리보기의 글꼴과 줄바꿈, 쪽 배치는 다른 문서 프로그램의 결과와 다를 수 있습니다. 문서 내용이 에이전트에 전달되는 방식은 해당 에이전트의 설정과 정책을 따릅니다.

[프로젝트와 사용 안내](https://github.com/spark142857142857/hwp-easy) | [지원 범위](https://github.com/spark142857142857/hwp-easy/blob/main/docs/supported-features.md) | [문제 제보](https://github.com/spark142857142857/hwp-easy/issues)
