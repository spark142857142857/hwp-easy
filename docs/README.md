<a id="문서-모음"></a>

# 문서 안내

[프로젝트 소개](../README.md) · [English overview](../README.en.md)

HWP Easy는 에이전트가 HWP를 읽고 편집해 같은 파일에 저장하는 로컬 도구입니다. 처음 사용할 때는 아래 세 문서부터 읽으면 됩니다.

## 처음 읽는 순서

| 순서 | 문서 | 알 수 있는 내용 |
| --- | --- | --- |
| 1 | [프로젝트 소개](../README.md) | 어떤 문제를 해결하고 어떤 앱에서 쓰는지 |
| 2 | [처음 사용하기](quick-start.md) | 스킬 호출 → 파일 지정 → 편집 → 저장 → 복구 |
| 3 | [지원 기능과 제한](supported-features.md) | 내 문서에서 요청할 수 있는 작업과 제한 |

Claude Code·Cursor에 설치하려면 [개인 스킬 설치 안내](agent-client-skills.md)를, 준비 상태를 확인하려면 [현재 상태](project-status.md)를 읽으세요.

<a id="사용-안내"></a>

## 사용 중 필요한 문서

| 필요한 것 | 문서 |
| --- | --- |
| Claude Code·Cursor의 설치 위치와 호출 | [개인 스킬 설치](agent-client-skills.md) |
| 저장과 복구, 읽기 전용 문서의 처리 | [처음 사용하기](quick-start.md) |
| Codex 메뉴에서 스킬이 보이지 않는 문제 | [스킬 발견과 호출 진단](local-skill-discovery.md) |
| 실제로 검증된 앱·버전과 남은 작업 | [현재 상태](project-status.md) |

<a id="개발-안내"></a>

## 개발과 구조

| 문서 | 목적 |
| --- | --- |
| [구조 설명](architecture.md) | 공통 엔진, 로컬 저장과 앱별 배포의 관계 |
| [개발 시작](developer-guide.md) | 환경 준비, 소스 변경, 패키지 생성과 검사 |
| [제품 요구사항](PRD.md) | 현재 요구사항과 그동안의 결정 이력 |
| [외부 의존성 고지](../THIRD_PARTY_NOTICES.md) | 엔진과 라이브러리의 라이선스 |

<a id="검증-기록과-출시-준비"></a>

## 세부 검증 기록

실제 확인 범위와 검사 근거가 필요할 때 읽는 자료입니다. 일반 사용법은 위의 안내 문서를 따릅니다.

| 기록 | 다루는 범위 |
| --- | --- |
| [Codex 로컬 설치](local-plugin-installation.md) | 설치·활성 상태, 설치된 실행기의 편집·저장·복구 |
| [Claude Code·Cursor 검증](agent-client-skills.md#검증-범위) | 두 CLI의 실제 호출과 독립 판독 |
| [로컬 후속 품질](local-plugin-quality.md) | 공개 복잡한 양식과 읽기 전용 처리, 지침 전달 |
| [로컬 편집 상세](local-file-editing.md) | 기능별 조건, 요청 계약과 버전별 검사 |
| [개발·검증 이력](mvp-status.md) | 로컬 확장과 이전 원격 MVP의 진행 기록 |
| [양식 검사](first-form-check.md) | 합성·공개 양식과 외부 HWP 프로그램 비교 |
| [성능 검사](performance-check.md) | 입력 경계, CPU, 메모리와 동시 요청 |

<a id="이전-windows-com-경로"></a>

## 보관한 이전 경로

**원격 0.1.9와 Windows COM은 현재 로컬 메인과 다른 경로입니다.** 아래의 업로드·OAuth·서버 저장 설명을 로컬 설치의 필수 준비로 읽지 마세요.

| 경로 | 자료 |
| --- | --- |
| 원격 사용과 공개 심사 | [원격 사용 기록](remote-quick-start.md), [출시 기록](public-plugin-release.md), [보관 패키지](../plugins/archive/README.md) |
| 원격 엔진·저장·Worker | [문서 계약](remote-documents.md), [지속 저장](durable-storage.md), [Worker 개발](../probes/sites-runtime/README.md) |
| 이전 Cloud 연결 실증 | [Cloud 검증 기준](codex-cloud.md), [결과 회수 절차](cloud-client-check.md) |
| 이전 Python MCP | [로컬 엔진과 MCP 개발 기록](native-engine.md) |
| 원격 서비스 정책 | [개인정보처리방침](privacy-policy.md), [이용약관](terms-of-service.md), [공개 안내 초안](public-user-notices-draft.md) |
| 한글 설치가 필요한 Windows COM | [이전 문서 모음](legacy/README.md) |

현재 사용 상태는 [현재 상태](project-status.md), 합의한 제품 방향은 [제품 요구사항](PRD.md)을 기준으로 확인합니다. 개별 검증 기록의 “후보”, “미설치”, “심사 중”은 기록 당시의 상태입니다.

개인 문서와 세션별 자료는 Git에서 제외한 `testdocs/`, `outputs/`, `docs/local/`에 보관하며 공개 문서는 합성 데이터와 검증 범위를 다룹니다.
