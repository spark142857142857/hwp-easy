# 이전 기록

[현재 문서](../README.md) | [최신 검증](../verification.md)

현재 설치와 사용에는 상위 문서를 따릅니다. 여기는 개발 이력과 이전 구현의 기술 자료입니다. 버전별 세부 일지는 파일마다 반복해서 유지하는 대신, 아래 요약과 고정한 Git 기록에서 확인합니다. 원문과 커밋 이력은 삭제하거나 다시 쓰지 않았습니다.

## 개발 단계

| 단계 | 내용과 근거 |
| --- | --- |
| 원격 0.1.9 | 서버와 업로드 및 OAuth 경로. [당시 출시 기록](https://github.com/spark142857142857/hwp-easy/blob/baad6d4513b9918bd718bb5f1f3beb5027d43edb/docs/public-plugin-release.md), [코드와 패키지](../../plugins/archive/README.md) |
| 로컬 도입과 0.2.19 | Node/WASM 실행, 세 앱 지원과 저장 및 복구. [검증](https://github.com/spark142857142857/hwp-easy/blob/baad6d4513b9918bd718bb5f1f3beb5027d43edb/docs/local-release-0.2.19.md) |
| 0.2.20~0.2.28 | 복잡한 표와 개체, 공개 양식 및 글상자 진단. [공개 양식](https://github.com/spark142857142857/hwp-easy/blob/baad6d4513b9918bd718bb5f1f3beb5027d43edb/docs/local-release-0.2.25.md), [오류 수정](https://github.com/spark142857142857/hwp-easy/blob/baad6d4513b9918bd718bb5f1f3beb5027d43edb/docs/local-release-0.2.26.md) |
| F1 | 부동 상태의 개체 재배치. [마감](https://github.com/spark142857142857/hwp-easy/blob/baad6d4513b9918bd718bb5f1f3beb5027d43edb/docs/local-release-0.2.33.md) |
| F2 | 표 높이와 쪽 흐름, 꼬리말 및 주변 개체. [마감](https://github.com/spark142857142857/hwp-easy/blob/baad6d4513b9918bd718bb5f1f3beb5027d43edb/docs/f2-closure-0.2.42.md) |
| F3 | 미리보기 원점과 정렬, 글꼴과 쪽 이어짐. [마감](https://github.com/spark142857142857/hwp-easy/blob/baad6d4513b9918bd718bb5f1f3beb5027d43edb/docs/local-release-0.2.50.md) |
| F4 | 그룹 내부 글과 하위 그룹, 추가 필드. [마감](https://github.com/spark142857142857/hwp-easy/blob/baad6d4513b9918bd718bb5f1f3beb5027d43edb/docs/local-release-0.2.51.md) |
| 0.2.52와 I3 | 중복 필드 및 첫 제목 오류, 회전 그룹 글 표시. [리뷰](https://github.com/spark142857142857/hwp-easy/blob/baad6d4513b9918bd718bb5f1f3beb5027d43edb/docs/local-release-0.2.52.md), [I3](https://github.com/spark142857142857/hwp-easy/blob/baad6d4513b9918bd718bb5f1f3beb5027d43edb/docs/local-release-0.5.0-dev.1.md) |
| 0.5.0~0.5.1 | GitHub와 npm 공개, 세 앱 통합. [통합 기록](https://github.com/spark142857142857/hwp-easy/blob/baad6d4513b9918bd718bb5f1f3beb5027d43edb/docs/unified-release-0.5.1.md) |
| 0.5.1 후속과 0.5.2 | 새 채팅에서 B7 발견, 소스 수정과 패치. [발견 기록](https://github.com/spark142857142857/hwp-easy/blob/baad6d4513b9918bd718bb5f1f3beb5027d43edb/docs/local-install-0.5.1.md), [최신 검증](../verification.md) |

[정리 전 전체 문서](https://github.com/spark142857142857/hwp-easy/tree/baad6d4513b9918bd718bb5f1f3beb5027d43edb/docs)에서 0.2.19부터 0.2.52까지의 원문과 이전 PRD, 상태 및 남은 작업 기록을 찾을 수 있습니다. 이 자료의 미완료 표시와 설치 버전은 해당 검사 시점의 상태입니다.

## 보관한 기술 자료

| 경로 | 내용 |
| --- | --- |
| [원격 사용](remote/usage.md) | 이전 원격 실행과 파일 전달 |
| [원격 문서 계약](remote/documents.md) | 서버 문서와 편집 요청 |
| [원격 저장](remote/storage.md) | 소유권, 버전과 복구 및 보관 |
| [Python MCP](python-mcp.md) | 이전 엔진과 MCP 구성 |
| [성능 검사](performance.md) | 당시 입력 경계와 부하 검사 |
| [Cloud](cloud.md), [결과 회수](cloud-client.md) | 이전 Cloud 실증 |
| [Windows COM](windows/README.md) | 설치된 한글을 쓰는 초기 프로토타입 |

현재 구조의 지원 조건은 [지원 조건 상세](../reference/support.md)에 별도로 유지합니다. 원격 코드와 ZIP, 기존 공개 태그는 보존합니다.
