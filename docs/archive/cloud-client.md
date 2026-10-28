> 이전 구현의 기술 자료입니다. 현재 사용은 [문서 인덱스](../README.md)를 따릅니다.

# Codex Cloud의 합성 HWP 파일 왕복 검사

[문서 인덱스](../README.md) · [Cloud 검증 기준](cloud.md) · [프로젝트 상태](../project-status.md)

**이전 원격 경로의 개발 검증 절차**입니다. 현재 로컬 메인 0.2.18의 일반 사용자 설치 안내나 새 Cloud 전체 검증 완료로 적용하지 않습니다.

저장소를 준비한 Codex Cloud 작업에서 합성 HWP를 입력하고 결과를 받는 개발 검증 절차다. 로컬 Codex나 Linux CI, ChatGPT Work Cloud의 서버 내부 진단 결과와는 따로 기록한다. 아래 명령은 검증용이며 일반 사용자 설치 방법은 아니다. 개인 HWP나 데스크톱에서 캡처한 응답은 사용하지 않는다.

## 환경 준비

Cloud 환경에서 이 저장소를 선택해 게시한 뒤 새 작업을 시작한다. 작업마다 별도 파일 영역을 사용하므로 환경 준비 후 실제 작업에서 연결을 검사해야 한다. [공식 Cloud 환경 안내](https://learn.chatgpt.com/docs/environments/cloud-environments)

Node 22 이상과 저장소의 고정 의존성을 준비한다. 원격 문서 검사만 수행할 때 Python, 한글, COM, GUI는 필요 없다. 저장소 루트에서:

```sh
npm ci --prefix probes/sites-runtime --ignore-scripts --no-audit --no-fund
node --test probes/sites-runtime/tests/document-chunks.test.mjs probes/sites-runtime/tests/synthetic-chunk-result.test.mjs
node probes/sites-runtime/scripts/make-transfer-fixture.mjs
```

마지막 명령은 작업 환경 안의 `outputs/synthetic-transfer/`에 새 합성 HWP를 만들고 경로, 크기, 해시만 출력한다. 13,312바이트와 SHA-256 `58ed8fc70a3f6c497f6450e617b9a7f54b8abbb389991feeb75f7582468eee66`을 확인한다. 로컬 PC 절대 경로나 `testdocs/`는 사용하지 않는다.

## 실제 native 도구 검사

1. Cloud 작업에 HWP Easy 도구가 실제로 제공되는지 확인한다. `hwp_capabilities`를 한 번 호출하고 인증, 파일 가져오기 및 조각 회수 기능을 기록한다. 도구가 없으면 환경의 연결 단계에서 막힌 것으로 기록한다. `UNAUTHORIZED`이면 문서 작업을 멈추고 사용자 재연결을 기다린다. 설정 파일에 임의 토큰, 신원 헤더를 넣지 않는다.
2. **이 Cloud 작업에서 생성한 합성 파일**을 `hwp_import`의 실제 `file` 인수로 전달한다. 가져오기 전에 요청 UUID를 기록하고 재시도에는 동일 UUID, 파일을 사용한다. `FILE_URL_NOT_ALLOWED`이면 실제 전달 origin을 민감정보 없이 기록하고 중단한다. 호스트 허용 목록, OAuth, 전역 설정을 시험 때문에 자동 변경하지 않는다. 확인되지 않은 URL을 수동 fetch해서 입력 성공으로 대체하지 않는다.
3. 반환된 문서, 버전, 해시를 고정한다. `hwp_read`를 처음부터 끝까지 이어 읽고 문단, 표 셀, 끝 문구 및 반복 셀의 서로 다른 대상을 확인한다. `complete`, `content_complete`와 미지원 항목을 구분한다. `hwp_versions`로 현재 버전을 확인한다.
4. 원본 버전의 `hwp_download`를 `delivery: "chunk"`, `offset: 0`, `max_bytes: 1024`, 원본 전체 `expected_sha256`으로 호출한다. 첫 응답을 한 번 같은 인수로 즉시 재요청한다. 실제 resource의 base64를 도구 결과에서 보존하고 본문을 채팅에 출력하지 않는다.
5. 읽은 목록에서 첫 **editable이며 비어 있지 않은 paragraph**와 첫 **editable이며 비어 있지 않은 cell**을 선택한다. 문단을 `인증 범위 합성 편집 0 😀`, 셀을 `인증 범위 합성 편집 1 😀`로 바꾸는 두 연산을 `hwp_plan`으로 검사한다. 원래 값과 `target_id`는 조회 결과를 그대로 사용한다. 계획 성공 뒤에만 `hwp_edit`로 같은 원격 문서에 저장한다. 기대 현재 버전, 해시와 기록된 새 요청 UUID를 사용한다. 동일 편집 요청의 정확한 재시도에서 같은 저장 버전이 반환되는지 확인한다.
6. 저장 후에도 처음 고정한 **원본 버전, 해시**의 `next_offset`을 따라 원본 회수를 완료한다. 현재 버전으로 중간에 바꾸지 않는다. 그다음 편집 버전을 별도의 버전, 해시, 크기로 고정해 처음부터 조각 회수한다. 두 버전을 한 bundle에 섞지 않는다. 편집본은 13,312바이트와 SHA-256 `1d3f1472a2637a5fed2672109de946843acd07034756a4273b7fcd43ef159286`이어야 한다.
7. 아래 회수 도구로 두 bundle을 각각 재조립, 재열기하고 고정 합성 원본 및 편집본과 전체 바이트가 일치하는지 확인한다. 이미 받았던 Desktop bundle로 대신 실행하지 않는다. 조각을 파일로 저장하거나 완성본으로 제시하지 않는다.
8. `hwp_restore`로 이번 합성 문서의 원본을 **같은 문서의 새 버전**으로 복구하고, 기대 현재 버전과 기록한 요청 UUID를 사용한다. 복구본 해시, 현재 버전, 이전 편집본의 보존과 회수를 확인한다. 원본, 편집본, 복구본의 버전 수와 revision을 기록한다. 이미 저장된 시험 문서는 별도 삭제 요청 전까지 보관한다.
9. Cloud의 실제 결과 파일 기능으로 검증된 편집 HWP를 사용자에게 제공한다. 파일 표시, 다운로드 조작 성공은 사용자 확인 또는 실제 클라이언트 관찰 근거로 따로 기록한다. helper가 로컬 파일을 만들었다는 사실만으로 앱의 첨부 UI, 다운로드 완료를 통과 처리하지 않는다.

기본 작은 합성 흐름만 실행한다. `diagnostic: large_chunks` 같은 무거운 서버 진단이나 그 timeout의 재시도는 이 절차에 포함하지 않는다. 임의 개인 문서 수정, 삭제, 업로드, 신규 Dot 및 상시 자동화 생성도 포함하지 않는다.

## 결과 첨부가 막힌 경우

현재 작업에 실제로 제공된 산출물 도구와 출력 경로 지침을 먼저 확인한다. 지정 폴더가 없거나 쓸 수 없으면 HWP 생성, 바이트 회수 실패와 구분해 기록한다. 임의 경로를 반복 추측하거나 권한, 인증, 전송 호스트를 바꿔 해결하지 않는다. 다른 API의 출력 폴더 계약을 현재 앱에 적용된 것으로 간주하지 않는다. 읽을 수 있는 검증 파일은 보존하되, 서버 또는 helper가 파일을 만들었다는 사실만으로 앱의 첨부 카드를 검증 완료 처리하지 않는다.

대신 실제 `hwp_download`, `hwp_preview` 응답의 보호된 불변 버전 `viewer_url`과 HWP 링크를 제공할 수 있다. 같은 사용자로 보기 화면을 열고 문서, 선택 버전, 크기, 해시, 이전/현재 저장본 표시와 보존 버전을 확인한다.

미리보기 이미지의 실제 로딩과 선택 버전의 수정 텍스트 표시를 확인하고, **이 버전 HWP 다운로드** 버튼으로 받은 파일을 전체 해시, 독립 생성 바이트, 고정 엔진 재열기와 비교한다. 원본 복구 후에도 편집 버전과 복구된 현재 버전의 링크가 각기 올바른 파일을 주는지 검사한다. 이때 브라우저 회수, 기본 미리보기 성공과 Cloud 첨부 UI, 외부 뷰어, 서식 정확성은 각각 기록한다.

보기, 다운로드를 위해 문서를 다시 가져오거나 편집, 삭제하지 않는다.

## 조각 bundle과 회수 도구

[save-chunk-result.mjs](../../probes/sites-runtime/scripts/save-chunk-result.mjs)는 한 JSON bundle을 stdin으로 받는다. 호출 인수로 입력/출력 경로, URL, 토큰을 받지 않는다. bundle은 작업의 ignored 파일 영역에만 보관한다. JSON은 최대 256 KiB, 응답은 최대 32개다. 1,024바이트 조각의 고정 fixture 13개와 첫 응답의 정확한 재시도가 들어갈 수 있다.

```json
{
  "schema_version": 1,
  "pin": {
    "document_id": "<실제 가져온 문서 UUID>",
    "version_id": "<회수할 불변 버전 UUID>",
    "sha256": "<해당 버전의 전체 SHA-256>",
    "byte_size": 13312
  },
  "results": [
    "여기에 실제 MCP 도구 응답 객체들을 순서대로 넣는다"
  ]
}
```

`results`의 항목은 문자열 예시가 아니라 실제 `structuredContent`와 `content` resource를 포함한 MCP 결과 객체다. `{ "result": <MCP 결과> }` 래퍼도 허용한다. 텍스트 설명에서 base64를 추측하거나 새 resource, 해시를 만들어 넣지 않는다. 이 작업의 실제 도구 응답 resource가 클라이언트에 전달되지 않으면 그 단계를 실패/미검증으로 기록한다.

Cloud의 Bash에서 작업 루트 기준으로 실행한다:

```sh
node probes/sites-runtime/scripts/save-chunk-result.mjs < outputs/source-chunks.json
node probes/sites-runtime/scripts/save-chunk-result.mjs < outputs/edited-chunks.json
```

라이브러리는 문서, 버전, 해시, 길이를 고정하고, 조각별 해시, 정규 base64, 순서, 누락, 겹침, 재시도를 검사한다. 전체 해시와 실제 HWP 엔진 재열기를 확인한 뒤 알려진 합성 원본 또는 편집 결과를 독립 생성해 전체 바이트를 비교한다. 다른 문서는 유효한 HWP여도 거부한다. 성공한 완성본만 `outputs/synthetic-chunks/retrieved-<UUID>.hwp`로 게시한다.

중간 `.part`를 fsync, 재검사한 뒤 무덮어쓰기 hardlink로 게시하고 정리한다. symlink 출력 폴더는 거부하며 hardlink 미지원 저장소에서는 성공으로 표시하지 않는다. 생성 결과의 path만 artifact로 제공한다.

helper의 `native_client_transport_verified`, `native_file_attachment_verified`, `codex_cloud_client_verified`, `dots_client_verified`, `layout_verified`는 항상 `false`다. 캡처한 JSON만으로 실행 클라이언트나 실제 사용자 조작을 증명할 수 없기 때문이다. 실제 native 호출, 환경, 파일 전달 근거와 helper 검사 결과를 별도 보고서에서 결합한다.

## 결과 기록

개별 실행은 ignored `docs/local/` 또는 해당 Cloud 작업의 비공개 결과 파일로 남긴다. 최소한 아래 항목을 분리한다:

| 항목 | 완료 근거 |
| --- | --- |
| 실행 환경 | 실제 Cloud 작업 ID, 저장소 commit, Node, 엔진 버전, 실행 위치 |
| 인증과 native 도구 | 기능 조회 결과, 노출된 도구 입력 schema, 안전한 오류 코드 |
| 입력 | Cloud에서 생성한 합성 파일 경로, 해시, 실제 import 반환, 요청 replay |
| 편집과 저장 | 전체 읽기, 두 대상, 무저장 plan, 같은 문서 save, 저장 replay |
| 불변 버전 회수 | 원본, 편집본의 각 pin, 조각 수, 재시도, 실제 resource 수신 |
| HWP 검사 | 조각/전체 해시, 독립 생성 바이트 일치, 실제 재열기, 복구 |
| 사용자 파일 회수 | 완성 HWP 제공 방식과 앱에서의 실제 표시, 다운로드 확인 |
| 남은 제한 | 시각 양식, 다른 OAuth 사용자, 일반 개인 문서를 따로 미검증 표시. Dots는 MVP 제외, 추후 확장으로 구분 |

이 절차의 준비, mock 단위 검사 또는 Desktop에서 같은 helper를 통과한 결과는 실제 Codex Cloud 파일 왕복 성공이 아니다. [공통 완료 기준](cloud.md#실제-codex-cloud-완료-조건)을 함께 적용한다.

## Cloud 작업에 보낼 시작 요청

```text
이 저장소의 HWP Easy를 실제 Codex Cloud 작업에서 검증해줘.
docs/developer-guide.md와 docs/cloud-client-check.md를 읽고, 그 절차에 따라 이 Cloud
작업에서 만든 고정 합성 HWP의 native import → 전체 읽기 → 문단/셀
plan과 같은 문서 저장 → 버전 고정 조각 회수 → save-chunk-result.mjs를 통한
독립 바이트 검사와 재열기 → 이전 버전 복구 → 편집 HWP 결과 파일 제공까지
실행해줘. 실제 Cloud 호출과 Linux/mock/Desktop 검사를 구분해 기록해줘.
도구가 보이지 않거나 재인증이 필요하거나 전달 host가 차단되면 해당 단계와 안전한 오류를 남겨줘.
개인 HWP는 쓰지 말고, 인증/호스트/전역 설정 변경, 자동 삭제, 무거운 진단은
하지 마. 입력과 각 변경 요청의 UUID를 먼저 기록하고 정확한 재시도만 해줘.
```
