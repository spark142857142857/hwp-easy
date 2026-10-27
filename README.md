# HWP Easy

[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](LICENSE)

HWP Easy는 에이전트가 HWP 파일을 읽고 편집하도록 돕는 로컬 도구입니다. 변경 사항은 같은 파일에 저장하고 이전 내용은 복구용으로 보관합니다. Codex 플러그인에 실행기와 문서 엔진을 함께 배포합니다.

문서 처리는 에이전트의 파일 환경에서 이루어집니다. 별도 HWP Easy 서버나 계정이 필요하지 않습니다. 실제 HWP 처리는 [`@rhwp/core`](https://github.com/edwardkim/rhwp) 기반 엔진과 로컬 실행기가 수행하며 `SKILL.md`는 에이전트의 작업 절차를 안내합니다.

[English](README.en.md) | [설치](docs/distribution.md) | [사용 가이드](docs/quick-start.md) | [문서](docs/README.md) | [남은 작업](docs/remaining-work.md)

## 주요 기능

- 본문과 표 셀 읽기, 검색과 SVG 미리보기
- 텍스트와 문단, 지원하는 표 구조와 글자 모양 편집
- 지원하는 그림과 글상자, 그룹 내부 글과 필드 편집
- 내용에 따른 표 높이와 쪽 흐름 조정, 부동 개체 재배치
- 충돌 검사와 보존 검사를 거친 같은 파일 저장
- 이전 내용 복구와 복구 직전 편집본 보관

지원 여부는 문서 구조에 따라 달라집니다. 검증하지 못한 구조는 읽기 전용으로 처리하거나 편집을 거부할 수 있습니다. 미리보기와 외부 문서 프로그램의 글꼴, 줄바꿈과 쪽 배치가 항상 같지는 않습니다. [지원 기능과 제한](docs/supported-features.md)에 작업별 조건을 정리했습니다.

## 설치

현재 Codex 배포 버전은 **0.5.0**입니다. 플러그인 명령을 지원하는 Codex CLI와 Git이 있으면 다음으로 설치합니다. 실행 환경에는 Node.js 22 이상이 필요합니다.

```bash
codex plugin marketplace add spark142857142857/hwp-easy --ref distribution
codex plugin add hwp-easy@hwp-easy
```

설치 후 Codex를 다시 열고 스킬 메뉴에서 **HWP Easy**를 선택합니다. 이미 HWP Easy가 설치돼 있다면 [업데이트 절차](docs/distribution.md#업데이트와-복귀)를 먼저 확인합니다.

[0.5.0 릴리스](https://github.com/spark142857142857/hwp-easy/releases/tag/hwp-easy-local-v0.5.0)에는 마켓플레이스 ZIP과 npm 설치 도우미 TGZ, SHA-256을 제공합니다. **npm 레지스트리 게시는 게시자 인증 대기 중**이며, TGZ를 내려받아 설치 도우미를 실행할 수 있습니다. [설치와 업데이트](docs/distribution.md)에서 각 경로를 설명합니다. OpenAI 공개 디렉터리 게시는 별도 절차이며 아직 완료하지 않았습니다.

Claude Code와 Cursor의 공개 패키지와 설치본은 **0.2.19**를 유지합니다. 두 앱의 최신 버전 갱신은 보류하며 이번 설치 도우미에서도 변경하지 않습니다. [기존 앱별 설치 안내](docs/agent-client-skills.md)

## 사용법

HWP Easy를 명시적으로 선택한 뒤 파일 경로와 바꿀 내용을 요청합니다. 스킬은 호출한 작업에만 적용됩니다.

```text
C:\문서\지원서.hwp를 읽고 질문과 작성할 칸을 정리해줘. 파일은 수정하지 마.
```

```text
C:\문서\지원서.hwp의 지원 동기 칸을 "지역사회 문제를 해결하는 경험을 쌓고 싶습니다."로 채우고 같은 파일에 저장해줘. 다른 칸은 유지해줘.
```

```text
C:\문서\지원서.hwp를 방금 수정하기 전 내용으로 복구해줘.
```

저장 전 파일 버전과 수정 대상을 확인하며 이전 바이트는 파일 옆의 `.hwp-easy-backups`에 보관합니다. 첨부 사본이나 Cloud 환경의 파일은 PC 원본과 자동 동기화되지 않습니다. [사용 가이드](docs/quick-start.md)

## 구성

| 구성 | 역할 |
| --- | --- |
| `SKILL.md`와 `references/` | 파일 읽기와 편집, 저장과 복구 절차 및 지원 조건 |
| `local-runner.mjs` | 엔진 호출, 편집 검사와 로컬 저장 및 복구 |
| HWP와 미리보기 WASM, 글꼴 | 문서 처리와 미리보기 자원 |
| `plugin.json` | 플러그인 이름과 설명, 아이콘과 버전 |
| 설치 도우미 | 같은 플러그인의 설치, 업데이트와 이전 버전 복귀 |

GitHub와 npm 배포본은 같은 플러그인 파일과 엔진을 사용합니다. npm은 배포와 설치 경로이며 문서 처리용 서버가 아닙니다. `SKILL.md`만 복사하면 실행기와 엔진이 빠져 작동하지 않습니다. [아키텍처](docs/architecture.md)

## 문서

- [설치와 업데이트](docs/distribution.md): GitHub, ZIP과 설치 도우미
- [사용 가이드](docs/quick-start.md): 파일 지정, 편집과 복구 요청
- [지원 기능과 제한](docs/supported-features.md): 지원 조건과 미리보기 경계
- [프로젝트 상태](docs/project-status.md): 배포와 실제 검증 결과
- [문서 인덱스](docs/README.md): 개발, 상세 검증과 보관 자료

## 개발

소스는 `main`, 완성된 배포본은 `distribution` 브랜치에서 관리합니다. 실행기를 바꿀 때 공통 빌드를 검증하고 그 결과를 배포합니다. [개발 가이드](docs/developer-guide.md)에 환경과 패키지 생성 명령을 정리했습니다. GitHub Actions는 사용자 명시 요청 때만 실행합니다.

버그와 기능 제안은 [Issues](https://github.com/spark142857142857/hwp-easy/issues)에서 관리합니다. 재현 자료에는 개인 문서나 인증 정보를 포함하지 않습니다.

## 프로젝트 상태

0.5.0의 GitHub 신규 설치와 0.2.19에서의 업데이트, 설치 실패 복구와 이전 플러그인 복귀를 검증했습니다. 설치된 실행기의 합성 HWP 편집, 같은 파일 저장과 정확한 원본 복구도 통과했습니다. [배포 검증](docs/distribution-0.5.0.md)에 실제 검사와 미검증 항목을 구분했습니다.

OpenAI 디렉터리는 스킬 전용 접수 제한으로 보류합니다. 원격 0.1.9와 Windows COM 프로토타입은 [이전 구현](docs/README.md#보관-자료)으로 보관합니다. 앞으로의 작업은 [remaining-work](docs/remaining-work.md)에서 관리합니다.

## 라이선스

[MIT 라이선스](LICENSE)로 제공합니다. 외부 엔진과 글꼴 등의 라이선스는 [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md)와 각 배포본에 포함합니다.
