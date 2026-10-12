# HWP Easy

[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](LICENSE)

한글을 설치하지 않고 에이전트에게 HWP 파일의 편집을 요청할 수 있습니다.

[English](README.en.md) | [사용 안내](docs/quick-start.md) | [문서 모음](docs/README.md)

**HWP Easy 0.2.18은 로컬 실행 방식의 메인 패키지입니다.** 에이전트가 접근할 수 있는 파일을 읽고 수정한 뒤 **같은 HWP 파일에 저장**합니다. 이전 파일은 복구용으로 보관합니다. HWP Easy 서버, 계정, 웹 업로드는 필요하지 않습니다.

Codex, Claude Code, Cursor에서 같은 엔진을 사용합니다. 스킬은 **사용자가 명시적으로 호출할 때만** 적용됩니다.

## 설치하고 사용하기

| 앱 | 설치 방법 | 호출 방법 |
| --- | --- | --- |
| Codex | HWP Easy 플러그인 설치. [설치·확인 안내](docs/local-plugin-installation.md) | 새 채팅의 스킬 메뉴에서 **HWP Easy** 선택. CLI에서는 `$`를 입력하고 `HWP` 검색 |
| Claude Code | 앱용 ZIP을 풀고 `hwp-easy` 폴더를 `~/.claude/skills/hwp-easy`에 배치 | `/hwp-easy` |
| Cursor | 앱용 ZIP을 풀고 `hwp-easy` 폴더를 `~/.cursor/skills/hwp-easy`에 배치 | `/hwp-easy` |

`~`는 사용자 홈 폴더이며 Windows에서는 `%USERPROFILE%`에 해당합니다. 기존 스킬 폴더가 있으면 덮어쓰기 전에 설치 버전을 확인하세요. 앱용 ZIP 생성과 자세한 설치 방법은 [Claude Code·Cursor 안내](docs/agent-client-skills.md)에 있습니다. 일반 사용자용 공개 다운로드 배포는 아직 준비 중입니다.

Claude Code·Cursor의 새 대화에서는 다음처럼 파일 경로와 수정 내용을 지정합니다.

> /hwp-easy C:\문서\지원서.hwp의 지원 동기 칸을 아래 내용으로 채우고 같은 파일에 저장해줘. 다른 칸은 유지해줘.

> /hwp-easy C:\문서\지원서.hwp를 방금 수정하기 전 내용으로 복구해줘.

Codex에서는 스킬 메뉴에서 **HWP Easy**를 선택한 뒤 같은 방식으로 요청합니다. 이전 파일은 옆의 `.hwp-easy-backups` 폴더에 보관하며, 복구할 때도 현재 편집본을 보관합니다. [파일 지정·저장·복구 안내](docs/quick-start.md)

## 현재 상태

| 구분 | 상태 |
| --- | --- |
| 메인 패키지 | HWP Easy 0.2.18. 텍스트, 문단, 표, 글자 서식과 그림의 지원 범위는 아래 표에 정리했습니다. |
| Codex 로컬 설치 | Windows Codex 0.2.17 설치·활성 확인과 설치된 실행기의 합성 HWP 편집, 같은 파일 저장, 재읽기, 정확한 원본 복구·독립 판독을 통과했습니다. |
| Claude Code·Cursor | Windows 개인 스킬 0.2.18 설치와 **두 CLI의 실제 `/hwp-easy` 호출**을 통과했습니다. 설치된 실행기로 본문·두 문단 표 셀 편집 → 같은 파일 저장 → 재읽기 → 별도 호출 원본 복구를 확인했습니다. 독립 판독도 통과했으며 Cursor IDE 채팅 화면 검증은 별도입니다. |
| 자동 검사 | 0.2.18 코드의 [Linux·Windows CI 10개 작업](https://github.com/spark142857142857/hwp-easy/actions/runs/38252416686)이 모두 통과했습니다. |
| 공개 배포 | 로컬 메인 패키지의 공개 디렉터리 게시와 일반 사용자 설치 검증은 아직입니다. |
| 실행 환경 | 파일 접근과 Node.js 22 이상이 필요합니다. Codex가 제공하는 런타임을 사용할 수 있으며 엔진과 WASM은 패키지에 포함됩니다. |
| Codex Cloud | 실행 환경에서 사용할 수 있는 방식입니다. 이번 로컬 메인 패키지의 새 Cloud 설치와 파일 전달 흐름은 별도 검증이 필요합니다. |
| 원격 0.1.9 | 보관용입니다. 원격 코드와 패키지, 기존 심사·운영 기록을 유지하며 기본 설치에는 포함하지 않습니다. |

스킬은 자동 적용되지 않습니다. Codex의 자동 호출 금지 설정 때문에 에이전트의 기본 스킬 목록에서는 숨겨집니다. 설치 실패를 뜻하지 않으며, 정식 CLI 선택 메뉴의 표시와 선택 후 스킬 본문 전달을 확인했습니다. 0.2.17은 호스트의 본문 크기 제한 안에 핵심 지침을 두고 상세 지침을 참조 파일에 보존해 전달 시 잘리던 문제를 고쳤습니다. 도구로 새 채팅을 만들 때 호출 이름만 넣는 방식은 본문을 전달하지 못했으므로 실제 스킬 선택과 구분합니다. 사용자 화면에서 데스크톱 메뉴 표시와 선택을 확인했으며, 데스크톱 전송·실행과 전체 쪽 배치는 별도 확인이 필요합니다. [스킬 발견과 호출 진단](docs/local-skill-discovery.md), [후속 품질 검증](docs/local-plugin-quality.md)

## 로컬에서 할 수 있는 편집

| 대상 | 지원하는 작업 |
| --- | --- |
| 텍스트와 문단 | 문구 검색, 부분 수정, 여러 줄 답변, 문단 추가와 삭제, 분리, 병합, 복제, 이동 |
| 표 | 표 생성과 이동, 지원하는 병합 표의 행과 열 변경, 셀 병합과 분리, 크기와 여백, 정렬 |
| 글자 서식 | 글꼴, 크기, 색, 굵게, 기울임, 밑줄, 취소선 |
| 그림 | 본문과 셀의 PNG/JPEG 삽입, 교체, 크기와 위치 변경, 자르기, 회전 |
| 복잡한 개체 | 누름틀 값 수정, 중첩 셀 텍스트와 글자 서식 수정, 그림 그룹 이동과 선택한 자식 그림 자르기 |

지원 여부는 문서 구조와 작업에 따라 달라집니다. 중첩 표의 구조 변경, 누름틀 생성과 삭제, 그룹 그림의 교체와 회전 등은 아직 지원하지 않습니다. 여러 수정을 한 번에 검사해 저장하며, 한 작업이라도 실패하면 일부만 저장하지 않습니다. 세부 조건과 시험 결과는 [로컬 편집 안내](docs/local-file-editing.md)를 참고하세요.

## 보관한 원격 MCP

원격 0.1.9는 서버에 올린 사본을 편집하고 내려받는 이전 방식입니다. [보관 패키지](plugins/archive/README.md), [기존 사용 안내](docs/remote-quick-start.md), [심사 기록](docs/public-plugin-release.md)을 남겼습니다. 운영 사이트 종료나 문서 삭제, 심사 철회는 이번 정리에 포함하지 않았습니다.

HWP 처리에는 [`@rhwp/core`](https://github.com/edwardkim/rhwp) **0.8.6**을 사용합니다. HWP Easy는 이 WASM 엔진에 편집 대상 확인, 독립적인 보존 검사, 저장과 에이전트 연결을 더합니다. Codex·Claude Code·Cursor 배포본은 공통 빌드의 실행기와 WASM을 포함하며, 두 파일의 해시가 같습니다.

## 저장소 구조

```text
plugins/hwp-easy/       로컬 메인 플러그인 소스
plugins/archive/        보관한 원격 0.1.9 패키지
probes/sites-runtime/  원격 Worker, 인증, D1/R2 저장, 브라우저 화면
src/one_hwp/           Node/WASM 로컬 실행기, 공통 엔진, 이전 Python MCP와 COM
tests/                 엔진과 저장, MCP 검사
scripts/               저장소 점검과 플러그인 패키징
docs/                  사용 안내와 개발 문서, 검증 기록
docs/legacy/           이전 Windows COM 안내
.github/               Linux와 Windows CI
```

개발에는 Node.js 22 이상과 Python 3.11 이상을 사용합니다. 새 엔진은 한글이나 COM, Wine, GUI 없이 실행됩니다. 환경 준비는 [개발 시작](docs/developer-guide.md), 코드 구성은 [구조 설명](docs/architecture.md)을 참고하세요. 이 개발 환경 설치를 일반 사용자에게 요구하지 않습니다. 기존 실행 경로와의 호환성을 위해 디렉터리 이름은 유지했습니다.

## 문의와 라이선스

버그와 제안은 [Issues](https://github.com/spark142857142857/hwp-easy/issues)에 남겨 주세요. 재현 자료에는 개인 문서나 토큰, 쿠키, 인증 코드를 넣지 마세요.

HWP Easy 코드는 [MIT 라이선스](LICENSE)로 제공합니다. 외부 엔진과 라이브러리의 라이선스는 [외부 의존성 고지](THIRD_PARTY_NOTICES.md)에 정리했습니다. Dots 연동은 추후 검토할 기능입니다.
