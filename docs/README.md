# 문서 모음

처음이라면 저장소 [README](../README.md)에서 지원 기능과 배포 상태를 확인하세요. 로컬 파일을 편집하는 방법과 원격 MCP를 사용하는 방법은 아래에 나누어 정리했습니다.

## 사용 안내

| 문서 | 알 수 있는 내용 |
| --- | --- |
| [사용 안내](quick-start.md) | 비공개 연결의 업로드, 요청, 다운로드, 복구, 삭제 |
| [로컬 직접 편집](local-file-editing.md) | 로컬 파일에 직접 저장, 새 문단/표, 여러 문단 답변과 패키지 검증 |
| [MVP 상태](mvp-status.md) | 확인한 실제 흐름과 미검증 범위 |
| [공개 플러그인 준비](public-plugin-release.md) | 누구나 설치하는 공개 배포의 남은 조건 |
| [개인정보처리방침](privacy-policy.md) | 처리 정보, 보관, 삭제와 개인정보 문의 |
| [이용약관](terms-of-service.md) | 제공 기능, 문서 권한, 저장과 이용 조건 |

## 개발 안내

| 문서 | 알 수 있는 내용 |
| --- | --- |
| [개발 시작](developer-guide.md) | 환경 준비, 검사 명령, 변경 위치 |
| [구조 설명](architecture.md) | 엔진, 검증, 저장, MCP와 브라우저의 관계 |
| [제품 요구사항](PRD.md) | 합의한 범위, 저장 방식, 제외 기능 |
| [로컬 엔진과 MCP](native-engine.md) | Node/WASM, Python 연결과 로컬 저장 계약 |
| [원격 문서 계약](remote-documents.md) | 대상, 파일 전달, 조회, 편집, 다운로드, 사용자 화면 |
| [지속 저장 계약](durable-storage.md) | 사용자 소유권, 버전, 재시도, 삭제, 복구 |
| [Worker 안내](../probes/sites-runtime/README.md) | 원격 런타임의 개발 검사와 배포 구성 |

## 검증 기록과 출시 준비

| 문서 | 알 수 있는 내용 |
| --- | --- |
| [성능 검사](performance-check.md) | 입력 경계, CPU, 메모리, 동시 요청의 관측 범위 |
| [양식 검사](first-form-check.md) | 합성, 공개 양식과 외부 HWP 프로그램 비교 |
| [Codex Cloud 기준](codex-cloud.md) | 클라이언트별 실제 확인 상태 |
| [Cloud 회수 절차](cloud-client-check.md) | 고정 합성 파일의 입력부터 결과 회수까지 |
| [공개 사용자 안내 초안](public-user-notices-draft.md) | 출시 전 검토할 데이터 처리, 지원, 이용 안내 |
| [외부 의존성 고지](../THIRD_PARTY_NOTICES.md) | 실제 사용하는 엔진, 패키지와 라이선스 고지 |

## 이전 Windows COM 경로

[이전 문서 모음](legacy/README.md)은 한글 설치가 필요한 초기 프로토타입의 자료입니다. 현재 제품의 사용법은 위 문서를 참고하세요. 이전 문서 주소에는 이동한 위치를 남겼습니다.

개인 문서와 세션별 기록은 Git에서 제외한 `testdocs/`, `outputs/`, `docs/local/`에만 둡니다. 공개 문서에는 재현 가능한 합성 데이터와 검증 범위를 기록합니다.
