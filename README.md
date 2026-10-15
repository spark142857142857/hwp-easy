# HWP Easy

[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](LICENSE)

HWP Easy는 Codex, Claude Code, Cursor에서 HWP(한글 문서)를 읽고 편집하는 로컬 도구입니다. Codex에는 플러그인으로, Claude Code·Cursor에는 실행기와 엔진을 포함한 개인 스킬 패키지로 배포합니다.

[`@rhwp/core`](https://github.com/edwardkim/rhwp) 기반 엔진으로 한글 설치나 HWP Easy 서버 없이 문서를 처리합니다. HWP Easy는 여기에 편집 대상·비대상 보존 검사, 충돌 검사, 같은 파일 저장과 복구 기능을 추가합니다. 검증을 통과한 수정만 저장하고, 이전 내용은 복구용으로 보관합니다.

[English](README.en.md) · [사용 가이드](docs/quick-start.md) · [문서](docs/README.md) · [개선·남은 작업](docs/remaining-work.md)

<a id="로컬에서-할-수-있는-편집"></a>
<a id="어떤-작업에-쓸-수-있나요"></a>

## 주요 기능

- 본문·표 셀 조회, 문구 검색, 현재 문서의 SVG 미리보기
- 텍스트 치환, 여러 줄 답변 작성, 문단 추가·삭제·복제·이동
- 지원하는 표 구조 변경과 글꼴·크기·색·정렬 등 서식 편집
- 지원하는 본문·표 셀 위치의 일반 PNG/JPEG 그림 삽입·교체·크기 조정·자르기·회전
- 충돌 검사와 비대상 내용 보존 검사를 거친 같은 파일 저장
- 복구 이력 조회, 이전 버전 복구, 복구 전 편집본 보관
- 저장 후 내장 미리보기 텍스트와 첫 쪽 썸네일 갱신

편집 지원 범위는 문서 구조와 대상에 따라 다릅니다. 공개 0.2.19의 후속 검증에서 [0.2.20](docs/local-release-0.2.20.md)은 중첩 표·누름틀·그룹 그림 편집을, [0.2.21](docs/local-release-0.2.21.md)은 병합 중첩 표와 개체 셀 삭제를 확장했습니다. 현재 메인 소스·검증 패키지 [0.2.24](docs/local-release-0.2.24.md)는 기존 편집에 더해 부동 상태를 유지하는 개체 재배치, 고정 바닥 영역 보호, 단순 사각형 글상자 편집과 배치 진단을 지원 조건 안에서 확장했습니다. Codex 설치본은 0.2.20, Claude Code·Cursor는 0.2.19를 유지합니다. 구조를 검증하지 못하는 문서는 부분 읽기 전용으로 처리하거나 작업을 거부하며, 부분 읽기 결과에는 일부 개체의 내용이 빠질 수 있습니다.

현재 문서의 SVG 미리보기와 저장 후 재읽기는 외부 한글 프로그램과의 정확한 글꼴·줄바꿈·쪽 배치를 보장하지 않습니다. 작업별 조건과 미리보기 제한은 [지원 기능과 제한](docs/supported-features.md)에 정리되어 있습니다.

## 구성

`SKILL.md`는 AI에게 편집 절차를 알려 주는 지침입니다. 실제 HWP 처리는 함께 배포하는 실행기와 엔진이 수행합니다. 스킬 폴더에는 다음 파일이 포함됩니다.

| 구성 | 역할 |
| --- | --- |
| `SKILL.md` | 파일 읽기, 대상 선택, 편집·저장·복구의 실행 절차 |
| `references/` | 지원 작업, 요청 형식과 작업별 제한 |
| `scripts/local-runner.mjs` | 엔진 호출, 편집 검사, 로컬 저장·백업·복구를 수행하는 JS 번들 |
| `scripts/rhwp_bg.wasm` | HWP 내부 구조를 읽고 수정본과 SVG를 만드는 엔진 |
| 미리보기 WASM·폰트·고지 | 저장 후 내장 BMP 썸네일 생성과 미리보기 글꼴 대체 |

Codex 플러그인은 이 스킬과 실행 자원에 `plugin.json`, 이름·아이콘·설명·버전 등 설치 목록용 정보를 더한 패키지입니다. 같은 버전으로 생성한 세 앱 패키지는 같은 소스·실행기·WASM과 지원 조건을 사용합니다. 실제 설치 버전의 차이는 프로젝트 상태에 기록합니다. `SKILL.md` 하나만 복사해서는 HWP Easy를 실행할 수 없습니다. 세부 구조는 [아키텍처](docs/architecture.md)를 참조하세요.

<a id="어떤-앱에서-시작하나요"></a>

## 설치

실행기와 엔진을 포함한 앱별 패키지 전체를 설치합니다. 실행 환경에는 Node.js 22 이상과 대상 파일의 접근 권한이 필요하며, 문서 엔진·WASM·JS 의존성은 배포본에 포함됩니다. 에이전트의 로그인과 이용 조건은 각 앱을 따릅니다.

| 클라이언트 | 배포 형식 | 설치 안내 |
| --- | --- | --- |
| Codex | 로컬 플러그인 | [설치 기록과 재현 절차](docs/local-plugin-installation.md) |
| Claude Code | 개인 스킬 패키지 | [설치와 호출](docs/agent-client-skills.md#설치와-호출) |
| Cursor | 개인 스킬 패키지 | [설치와 호출](docs/agent-client-skills.md#설치와-호출) |

Codex의 현재 설치 검증 버전은 **0.2.20**이며, 공개 배포와 Claude Code·Cursor 설치본은 **0.2.19**입니다. [공개 릴리스](https://github.com/spark142857142857/hwp-easy/releases/tag/hwp-easy-local-v0.2.19)에서 앱별 ZIP과 SHA-256을 받을 수 있습니다. OpenAI 디렉터리 게시는 별도 진행하며, 실제 설치와 검증 범위는 [프로젝트 상태](docs/project-status.md)에서 확인할 수 있습니다.

<a id="설치하고-사용하기"></a>
<a id="어떻게-사용하나요"></a>

## 사용법

Codex에서는 스킬 메뉴에서 **HWP Easy**를 선택합니다. Claude Code와 Cursor에서는 `/hwp-easy`를 명시적으로 호출합니다. 스킬은 호출한 작업에만 적용됩니다.

Claude Code·Cursor 요청 예시:

```text
/hwp-easy C:\문서\지원서.hwp를 읽고 질문과 작성할 칸을 정리해줘. 파일은 수정하지 마.

/hwp-easy C:\문서\지원서.hwp의 지원 동기 칸을 "지역사회 문제를 해결하는 경험을 쌓고 싶습니다."로 채우고 같은 파일에 저장해줘.

/hwp-easy C:\문서\지원서.hwp를 방금 수정하기 전 내용으로 복구해줘.
```

기본 저장 대상은 지정한 파일의 원래 경로이며, 이전 바이트는 파일 옆의 `.hwp-easy-backups`에 보관합니다. 파일 지정, 저장 결과 확인과 복구 절차는 [사용 가이드](docs/quick-start.md)를 참조하세요.

<a id="저장소-구조"></a>
<a id="더-알아보기"></a>

## 문서

- [사용 가이드](docs/quick-start.md): 파일 지정, 편집 요청, 저장과 복구
- [지원 기능과 제한](docs/supported-features.md): 작업별 지원 범위와 미리보기 제한
- [아키텍처](docs/architecture.md): 공통 엔진, 로컬 저장, 클라이언트 배포 구조
- [프로젝트 상태](docs/project-status.md): 설치·호출 검증과 남은 작업
- [문서 인덱스](docs/README.md): 개발 가이드, 상세 검증과 이전 구현 기록

## 개발

개발 환경, 소스 구성, 패키지 생성과 검사 명령은 [개발 가이드](docs/developer-guide.md)를 참조하세요. 버그와 기능 제안은 [Issues](https://github.com/spark142857142857/hwp-easy/issues)에서 관리합니다. 재현 자료에는 개인 문서나 인증 정보를 포함하지 않습니다.

<a id="현재-상태"></a>
<a id="현재-어디까지-준비됐나요"></a>
<a id="보관한-원격-mcp"></a>

## 프로젝트 상태

Codex 0.2.20 설치본을 새 독립 채팅에서 명시적으로 사용해 두 합성 문서를 편집·같은 파일 저장·재읽기하고, 별도 후속 요청으로 정확히 복구했습니다. 0.2.20 코드의 Windows·Linux CI 10개 작업도 통과했습니다. Claude Code·Cursor는 0.2.19 설치본을 유지하며 이전 0.2.18의 실제 AI 호출 기록과 구분합니다. 공개 양식 12개의 복합 편집과 대표 배치는 [0.2.20 검증 기록](docs/local-release-0.2.20.md), 이후 CI는 [Actions](https://github.com/spark142857142857/hwp-easy/actions)를 참조하세요. 다른 사용자의 설치와 Cloud 전체 흐름은 후속 작업입니다.

원격 **0.1.9**와 Windows COM 프로토타입은 이전 구현으로 보관합니다. 코드·패키지·심사 기록은 [보관 자료](docs/README.md#보관-자료)에 있습니다.

<a id="문의와-라이선스"></a>

## 라이선스

HWP Easy는 [MIT 라이선스](LICENSE)로 제공합니다. `@rhwp/core` 0.8.6을 포함한 외부 의존성의 라이선스는 [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md)에 기록합니다.
