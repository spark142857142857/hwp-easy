# HWP Easy

[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](LICENSE)

**Codex, Claude Code, Cursor에서 HWP(한글 문서)를 읽고 편집하는 로컬 도구입니다.**

한글을 설치하지 않고 에이전트에게 문구 수정, 표의 답변 작성, 글자 서식 변경을 요청할 수 있습니다. 검사를 통과한 결과는 **같은 HWP 파일에 저장**하고, 이전 내용은 복구용으로 보관합니다.

[English](README.en.md) · [처음 사용하기](docs/quick-start.md) · [지원 기능](docs/supported-features.md) · [문서 모음](docs/README.md)

<a id="설치하고-사용하기"></a>

## 어떻게 사용하나요?

1. 사용하는 앱에 HWP Easy를 설치하고 스킬을 선택합니다.
2. HWP 파일의 경로와 바꿀 내용을 알려 줍니다.
3. 에이전트가 대상을 확인하고 저장한 뒤 변경 결과를 알려 줍니다. 필요하면 이전 내용으로 복구합니다.

Claude Code와 Cursor에서는 다음처럼 요청합니다.

> /hwp-easy C:\문서\지원서.hwp의 지원 동기 칸을 “지역사회 문제를 해결하는 경험을 쌓고 싶습니다.”로 채우고 같은 파일에 저장해줘. 다른 칸은 유지해줘.

Codex에서는 스킬 메뉴에서 **HWP Easy**를 선택한 뒤 같은 요청을 합니다. 스킬은 사용자가 호출한 작업에만 적용됩니다.

<a id="로컬에서-할-수-있는-편집"></a>

## 어떤 작업에 쓸 수 있나요?

| 하고 싶은 일 | 예시 |
| --- | --- |
| 문서 내용 확인 | 질문과 작성할 칸 찾기, 문구 검색 |
| 답변과 본문 수정 | 지원서 표 셀 채우기, 보고서 문장 바꾸기, 여러 줄 답변 작성 |
| 문서 구성과 서식 수정 | 지원하는 문단·표의 추가와 이동, 글꼴·크기·색 변경 |
| 그림 수정 | 지원하는 위치의 PNG/JPEG 삽입, 크기 변경, 자르기와 회전 |
| 이전 내용 복구 | 수정 전 파일로 되돌리고, 필요하면 편집본 다시 복구 |

문서 구조에 따라 편집 가능한 범위가 다릅니다. 중첩 표 구조 변경, 누름틀 생성·삭제, 그룹 그림 교체·회전은 아직 지원하지 않습니다. 자세한 조건은 [지원 기능과 제한](docs/supported-features.md)을 확인하세요.

## 어떤 앱에서 시작하나요?

| 앱 | 호출 방법 | 설치·사용 안내 |
| --- | --- | --- |
| Codex | 스킬 메뉴에서 **HWP Easy** 선택 | [사용법](docs/quick-start.md), [Codex 설치 상태](docs/local-plugin-installation.md) |
| Claude Code | `/hwp-easy` | [개인 스킬 설치](docs/agent-client-skills.md) |
| Cursor | `/hwp-easy` | [개인 스킬 설치](docs/agent-client-skills.md) |

문서 처리에는 HWP Easy 서버나 계정, 웹 업로드가 필요하지 않습니다. 세 앱용 배포본은 **같은 Node/WASM 실행기와 엔진**을 사용합니다. 실행 환경에는 파일 접근 권한과 Node.js 22 이상이 필요하며, 에이전트의 로그인과 이용 조건은 해당 앱을 따릅니다.

<a id="현재-상태"></a>

## 현재 어디까지 준비됐나요?

현재 로컬 메인은 **0.2.18**입니다. Claude Code와 Cursor CLI의 실제 호출에서 편집·같은 파일 저장·재읽기·정확한 원본 복구를 확인했습니다. Codex 설치본의 실행기 검증과 [Linux·Windows CI 10개 작업](https://github.com/spark142857142857/hwp-easy/actions/runs/38252416686)도 통과했습니다.

일반 사용자용 공개 다운로드와 디렉터리 게시는 준비 중입니다. Cursor IDE 채팅 화면, 새 Codex Cloud 작업의 전체 흐름과 임의 문서의 최종 쪽 배치는 별도 확인이 필요합니다. 버전별 설치 상태와 남은 작업은 [현재 상태](docs/project-status.md)에 정리했습니다.

<a id="저장소-구조"></a>

## 더 알아보기

| 알고 싶은 내용 | 읽을 문서 |
| --- | --- |
| 파일 지정, 수정 요청, 저장과 복구 | [처음 사용하기](docs/quick-start.md) |
| 할 수 있는 편집과 문서별 제한 | [지원 기능](docs/supported-features.md) |
| 엔진·저장·클라이언트의 관계 | [구조 설명](docs/architecture.md) |
| 소스 실행, 패키지 생성과 검사 | [개발 시작](docs/developer-guide.md) |
| 세부 검증과 이전 구현 기록 | [문서 모음](docs/README.md) |

<a id="보관한-원격-mcp"></a>

원격 **0.1.9**와 Windows COM 프로토타입은 보관한 이전 경로입니다. 관련 코드·패키지·심사 기록은 문서 모음에서 찾을 수 있습니다.

## 문의와 라이선스

버그와 제안은 [Issues](https://github.com/spark142857142857/hwp-easy/issues)에 남겨 주세요. 재현 자료에는 개인 문서나 인증 정보를 넣지 마세요.

HWP Easy는 [MIT 라이선스](LICENSE)로 제공합니다. 문서 처리에는 [`@rhwp/core`](https://github.com/edwardkim/rhwp) 0.8.6을 사용하며, 외부 의존성의 라이선스는 [고지](THIRD_PARTY_NOTICES.md)에 정리했습니다.
