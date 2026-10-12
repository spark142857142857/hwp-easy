# HWP Easy

[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](LICENSE)

HWP Easy는 Codex, Claude Code, Cursor에서 HWP(한글 문서)를 읽고 편집하는 로컬 플러그인·스킬입니다.

[`@rhwp/core`](https://github.com/edwardkim/rhwp) 기반 Node/WASM 실행기로 한글 설치나 HWP Easy 서버 없이 문서를 처리합니다. 검증을 통과한 수정은 같은 HWP 파일에 저장하고, 이전 내용은 복구용으로 보관합니다. 세 앱용 배포본은 공통 소스와 실행기를 사용합니다.

[English](README.en.md) · [사용 가이드](docs/quick-start.md) · [문서](docs/README.md)

<a id="로컬에서-할-수-있는-편집"></a>
<a id="어떤-작업에-쓸-수-있나요"></a>

## 주요 기능

- 본문·표 셀 조회, 문구 검색, 현재 문서의 SVG 미리보기
- 텍스트 치환, 여러 줄 답변 작성, 문단 추가·삭제·복제·이동
- 지원하는 표 구조 변경과 글꼴·크기·색·정렬 등 서식 편집
- PNG/JPEG 삽입·교체·크기 조정·자르기·회전
- 충돌 검사와 비대상 내용 보존 검사를 거친 같은 파일 저장
- 복구 이력 조회, 이전 버전 복구, 복구 전 편집본 보관

편집 지원 범위는 문서 구조와 대상에 따라 다릅니다. 중첩 표 구조 변경, 누름틀 생성·삭제, 그룹 그림 교체·회전 등은 미지원입니다. 작업별 조건은 [지원 기능과 제한](docs/supported-features.md)에 정리되어 있습니다.

<a id="어떤-앱에서-시작하나요"></a>

## 설치

실행 환경에는 Node.js 22 이상과 대상 파일의 접근 권한이 필요합니다. 문서 엔진·WASM·JS 의존성은 배포본에 포함됩니다. 에이전트의 로그인과 이용 조건은 각 앱을 따릅니다.

| 클라이언트 | 배포 형식 | 설치 안내 |
| --- | --- | --- |
| Codex | 로컬 플러그인 | [설치 기록과 재현 절차](docs/local-plugin-installation.md) |
| Claude Code | 개인 스킬 | [설치와 호출](docs/agent-client-skills.md#설치와-호출) |
| Cursor | 개인 스킬 | [설치와 호출](docs/agent-client-skills.md#설치와-호출) |

현재 소스·생성 패키지 버전은 **0.2.18**입니다. 일반 사용자용 공개 다운로드와 디렉터리 게시는 준비 중이며, 실제 설치 버전과 검증 범위는 [프로젝트 상태](docs/project-status.md)에서 확인할 수 있습니다.

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

Claude Code와 Cursor CLI의 실제 호출에서 편집·같은 파일 저장·재읽기·정확한 원본 복구를 검증했습니다. Codex 설치본의 실행기 검사와 0.2.18 코드의 [Linux·Windows CI](https://github.com/spark142857142857/hwp-easy/actions/runs/38252416686)도 통과했습니다. Cursor IDE 채팅 화면, Codex 데스크톱의 선택 후 실행, 새 Cloud 작업의 전체 흐름과 다른 사용자의 설치는 추가 검증 대상입니다.

원격 **0.1.9**와 Windows COM 프로토타입은 이전 구현으로 보관합니다. 코드·패키지·심사 기록은 [보관 자료](docs/README.md#보관-자료)에 있습니다.

<a id="문의와-라이선스"></a>

## 라이선스

HWP Easy는 [MIT 라이선스](LICENSE)로 제공합니다. `@rhwp/core` 0.8.6을 포함한 외부 의존성의 라이선스는 [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md)에 기록합니다.
