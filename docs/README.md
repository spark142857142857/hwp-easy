<a id="문서-모음"></a>
<a id="문서-안내"></a>

# 문서 인덱스

[프로젝트 개요](../README.md) · [English](../README.en.md)

HWP Easy의 사용, 개발 및 검증 문서입니다. 현재 기능은 지원 범위 문서, 설치·호출 결과와 후속 작업은 프로젝트 상태 문서를 기준으로 관리합니다.

<a id="처음-읽는-순서"></a>
<a id="사용-안내"></a>
<a id="사용-중-필요한-문서"></a>

## 사용 가이드

| 문서 | 내용 |
| --- | --- |
| [사용 가이드](quick-start.md) | 스킬 호출, 파일 지정, 편집 요청, 저장과 복구 |
| [지원 기능과 제한](supported-features.md) | 대상별 편집 범위, 읽기 전용 처리, 미리보기 제한 |
| [Claude Code·Cursor 설치](agent-client-skills.md) | 개인 스킬 설치 위치, 호출 정책, 실제 호스트 검증 |
| [Codex 호출 진단](local-skill-discovery.md) | 스킬 발견, 메뉴 선택과 지침 전달의 검사 기준 |
| [0.2.22 검증](local-release-0.2.22.md) | 중첩 그룹 변환·복잡한 문단 경계·넘침 진단과 같은 파일 저장·복구 |
| [0.2.21 검증](local-release-0.2.21.md) | 병합 중첩 표·개체 셀 삭제·표 배치 편집의 소스·분리 실행 검증 |
| [0.2.20 검증](local-release-0.2.20.md) | Codex 설치·새 채팅·복합 양식·개체 편집·CI와 배치 한계 |
| [0.2.19 검증](local-release-0.2.19.md) | 복잡한 양식·문단 서식·미리보기·설치·한컴 배치 근거 |
| [프로젝트 상태](project-status.md) | 현재 버전, 실제 설치·호출 결과, 남은 작업 |

<a id="개발-안내"></a>
<a id="개발과-구조"></a>

## 개발 문서

| 문서 | 내용 |
| --- | --- |
| [아키텍처](architecture.md) | 공통 엔진, 로컬 저장과 앱별 배포 구조 |
| [개발 가이드](developer-guide.md) | 환경 준비, 소스 구성, 패키지 생성과 검사 |
| [제품 요구사항](PRD.md) | 현재 제품 기준과 결정 이력 |
| [외부 의존성 고지](../THIRD_PARTY_NOTICES.md) | 엔진과 라이브러리의 라이선스 |

<a id="검증-기록과-출시-준비"></a>
<a id="세부-검증-기록"></a>

## 검증 기록

| 문서 | 검증 범위 |
| --- | --- |
| [Codex 로컬 설치](local-plugin-installation.md) | 설치·활성 상태, 설치된 실행기의 편집·저장·복구 |
| [Claude Code·Cursor 호출](agent-client-skills.md#검증-범위) | 두 CLI의 실제 호출과 독립 판독 |
| [로컬 품질 검사](local-plugin-quality.md) | 공개 복잡한 양식, 읽기 전용 처리, 지침 전달 |
| [로컬 디렉터리 등록](local-directory-submission.md) | 별도 등록 식별자, 포털 자동 검사와 접수 제한 |
| [로컬 편집 상세](local-file-editing.md) | 작업별 계약과 버전별 검사 |
| [개발·검증 이력](mvp-status.md) | 로컬 확장과 이전 원격 MVP의 진행 기록 |
| [양식 검사](first-form-check.md) | 합성·공개 양식과 외부 HWP 프로그램 비교 |
| [성능 검사](performance-check.md) | 입력 경계, CPU, 메모리와 동시 요청 |

개별 기록의 완료·미완료 표시는 검사를 수행한 버전, 문서와 실행 경로에 적용합니다. 최신 설치 상태와 후속 작업은 [프로젝트 상태](project-status.md)에 정리합니다.

<a id="이전-windows-com-경로"></a>
<a id="보관한-이전-경로"></a>

## 보관 자료

원격 0.1.9, 이전 Python MCP와 Windows COM의 자료입니다. 업로드·OAuth·서버 저장 설명은 현재 로컬 메인의 설치·사용 조건과 구분합니다.

| 경로 | 문서 |
| --- | --- |
| 원격 사용과 심사 | [원격 사용 기록](remote-quick-start.md), [출시 기록](public-plugin-release.md), [보관 패키지](../plugins/archive/README.md) |
| 원격 엔진·저장·Worker | [문서 계약](remote-documents.md), [지속 저장](durable-storage.md), [Worker 개발](../probes/sites-runtime/README.md) |
| 이전 Cloud 실증 | [Cloud 검증 기준](codex-cloud.md), [결과 회수 절차](cloud-client-check.md) |
| 이전 Python MCP | [로컬 엔진·MCP 기록](native-engine.md) |
| 원격 서비스 정책 | [개인정보처리방침](privacy-policy.md), [이용약관](terms-of-service.md), [공개 안내 초안](public-user-notices-draft.md) |
| Windows COM | [이전 문서 인덱스](legacy/README.md) |

개인 문서와 세션별 산출물은 Git에서 제외한 `testdocs/`, `outputs/`, `docs/local/`에 보관합니다. 공개 검증 문서는 합성 데이터와 명시한 검사 범위를 다룹니다.
