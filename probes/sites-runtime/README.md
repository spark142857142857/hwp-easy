# Sites 합성 HWP 실행 검증

한글 없는 엔진·독립 레코드 검사·D1/R2 저장·인증한 사용자별 문서 계약을 실제 Worker에서 검증하는 개발용 시험이다. **일반 사용자용 HWP 편집 서비스가 아니다.** 시험은 개인정보 없는 합성 문서를 사용한다. 사용자 요청으로 소유자 전용 배포의 파일 가져오기를 열고 실제 Codex Desktop 업로드·읽기·편집·저장·재시도를 확인했으며, 기본 업로드 설정은 계속 비활성화다. 표시 이름은 `HWP Easy`다. [문서·전송 계약](../../docs/remote-documents.md), [현재 연결 상태](../../docs/codex-cloud.md#현재-연결-검증-상태)

## 확인한 범위

- Node와 browser ESM은 공통 `src/one_hwp/rhwp_api.mjs`를 사용한다. 고정 `@rhwp/core` 0.8.6을 precompiled WASM module로 실행하며 런타임에서 bytes를 컴파일하지 않는다.
- 합성 HWP의 본문·표 읽기, 국소 편집, HWP 출력·재열기·비대상 보존·SVG 생성 및 같은 버전의 이어 읽기를 검사한다. 긴 문단 입력을 짧게 교체한 뒤 렌더링하는 진단은 긴 원본 렌더링을 입증하지 않는다.
- 모델과 독립적으로 CFB·bounded raw-DEFLATE·본문/DocInfo 레코드를 검사한다. 미지원 tag·잘못된 체인·비대상 레코드 손실을 거부한다. 이는 좁은 지원 profile이며 범용 복구 parser나 시각 배치 인증이 아니다.
- 확인된 단일 구역의 `pgnp`를 보존 전용으로 허용한다. 해당 문단은 읽기 전용이고 다른 지원 대상만 편집한다. 합성 네 형태·잘못된 구조/연결·저장 시 제어 변조 거부와 actual workerd/D1/R2의 편집·다운로드·재열기·이전 버전 불변을 시험했다. 읽기 완료와 편집 계약을 분리하며 로컬 stdio 차단·다중 구역·시각 배치의 미검증은 유지한다. [계약](../../docs/remote-documents.md#쪽-번호-보존-전용-편집)
- actual workerd/D1/R2에서 저장·재시작·현재/이전 버전 조회·조건부 저장·재시도·복구·기록된 버전 삭제를 시험한다. 실패는 명시적으로 주입하며 신원 헤더·파일 네트워크는 모의다. 실제 OAuth 격리·운영 장애/삭제 인증으로 집계하지 않는다.
- 소유자 전용 Sites의 고정 엔진/저장 진단과 실제 Desktop·ChatGPT Work Cloud 사용자 연결의 합성 도구 왕복을 확인했다. 익명·임의 신원·서비스 자격의 사용자 문서/MCP 접근은 거부한다. 서비스 자격 진단은 사용자 MCP 연결 검증이 아니다.
- 새 로컬 대화의 13개 native 도구와 실제 고정 합성 파일 인수의 바이트 전달·embedded HWP 회수를 확인했다. 별도 로그인 Chrome에서도 고정 편집 결과를 다운로드해 native 결과와 바이트 전체 일치를 확인했다. 저장된 사용자 문서의 다운로드·두 OAuth 사용자·저장소 Codex Cloud·Dots·시각 배치는 미검증이다. 개별 배포·인증 이력은 ignored 로컬 기록에 보관한다.

컨테이너 검사의 보수적 한도는 입력 4 MiB, 본문 해제 합계 8 MiB, DocInfo 해제 2 MiB, 본문 레코드 100,000개, directory slot 2,048개와 경로 문자 누적 65,536개다. 이것은 전체 isolate 메모리·CPU 적합성 인증이 아니다. 초기 진단의 WASM linear memory는 2,949,120 bytes에서 두 사례 후 27,394,048 bytes였으나 JS heap·동시 요청·peak 측정은 아니다. [Workers 제한](https://developers.cloudflare.com/workers/platform/limits/)

## 무저장 수정 계획 검사

원격 `hwp_plan`은 `snapshot.preflight`로 HWP 후보를 메모리 안에서 생성·재열기하고 내용 및 독립 raw 보존을 검사한다. 저장 버전·바이트·후보 링크를 만들거나 반환하지 않는다. 성공은 `serialization_checked: true`를 표시하지만 `storage_checked: false`, `layout_verified: false`는 유지한다. 이후 실제 저장은 현재 버전과 보존을 다시 검사한다.

`hwp_read`는 보이지 않는 별도 글자 서식과 검증되지 않은 텍스트 레코드 구조 등 지원하지 않는 대상에 `editable: false`, `edit_restrictions`의 고정 코드·한국어 사유를 표시한다. 검증된 기존 빈 셀 문단은 `empty_cell_fill_supported`로 구분하고, 텍스트 레코드 한 개의 정확한 추가를 검사한 뒤 채운다. 새 셀·문단·서식 생성은 아니다. 다른 대상은 그대로 조회할 수 있으며 `editable: true`만으로 저장 성공을 보장하지 않는다. 제한 대상의 계획·편집은 저장 전에 거부한다. 여러 대상의 실패 요청을 임의로 분할 저장하지 않는다. [대상별 제한 계약](../../docs/remote-documents.md#조회-단계의-대상별-편집-제한), [빈 셀 채우기](../../docs/remote-documents.md#기존-빈-셀의-텍스트-채우기)

셀 목록의 0 word 보완 후 기본 압축이 후보 CFB의 기존 할당에 맞지 않으면 같은 raw 바이트를 level 9로 한 번만 다시 압축한다. 할당 수·저장 종류·내용 보존 조건은 그대로이며 여전히 맞지 않으면 저장하지 않는다. 합성 8×2 표의 경계 사례를 Node와 실제 workerd/D1/R2에서 검사한다. [셀 목록 보존 계약](../../docs/remote-documents.md#셀-목록의-0-값-보존)

원격 조회의 `cell_text_clear_supported`는 검증된 기존 일반 텍스트 셀을 비울 수 있는 원본 구조 자격이다. 정확한 텍스트 레코드 제거와 원래 문단·셀·서식의 보존을 검사하고, 채우기와 결합해도 전체 요청이 유효할 때만 저장한다. 고정 합성 workflow는 채운 셀을 다시 비우고 재열기·복구한다. Python 로컬 stdio의 기본 차단은 바꾸지 않는다. [셀 비우기 계약](../../docs/remote-documents.md#기존-셀의-텍스트-비우기)

동기 라이브러리 `snapshot.plan`은 대상·이전 값만 확인하며 `serialization_checked: false`다. writer가 셀 LIST_HEADER offset 6–7의 0 word를 `0x0400`으로 기본화하는 사례는 나머지 헤더·모델 좌표·문단 수가 일치할 때만 원래 두 바이트를 유지한다. 기존 CFB 할당을 넘으면 거부하며, 보완 후 전체 모델과 raw 검사는 필수다. 다른 메타데이터 손실은 계획·편집에서 계속 거부하고 D1/R2를 유지한다. 원문과 개인 문서 경로를 회귀 fixture로 사용하지 않는다. [정확한 보존 계약](../../docs/remote-documents.md#셀-목록의-0-값-보존)

## 재현 방법

Node.js 22 이상을 준비한 개발자가 이 디렉터리에서 실행한다. 일반 사용자 설치 절차가 아니다.

```powershell
npm ci --ignore-scripts --no-audit --no-fund
npm test
```

`npm test`는 Node 회귀 → 빌드 → actual workerd 엔진 → D1/R2 저장 → 인증 헤더/바이너리 계약 → 타인 접근·요청 ID 격리·비공개 오류 노출 차단 → 실패 정리 → 명시적 삭제와 읽기·저장 겹침 → 고정 합성 전송 → 고정 다운로드와 저장 버전 보기 계약 검사를 실행한다. 격리 검사의 신원과 삭제 겹침 시점은 모의이며 실제 OAuth 인증·철회가 아니다. 루트에서 `node probes/sites-runtime/scripts/check-python-guard.mjs`를 실행하면 합성 HWP를 Python `olefile` reader와 대조한다. 루트 런타임과 native Python 의존성이 필요하며 `PYTHON`으로 venv 실행 파일을 지정할 수 있다. 입력은 생성한 합성 문서이며 `testdocs/`를 읽지 않는다.

`build.mjs`는 ESM·WASM·검증된 라이선스 고지를 `dist/server`에, migration을 `dist/.openai/drizzle`에 작성한다. pako 3.0.2는 bounded raw-DEFLATE runtime이다. cfb는 합성 fixture writer, Drizzle은 스키마/migration 생성, Miniflare·esbuild는 시험/빌드에만 사용한다. 이들은 배포 Worker의 별도 runtime 의존성이 아니다. [외부 구성요소 고지](../../THIRD_PARTY_NOTICES.md)

## 고정 합성 파일 전달

`hwp_transfer_probe`는 일반 업로드와 별도로 고정 합성 HWP만 시험한다. 서버 지문·13,312바이트 제한·별도 `HWP_EASY_SYNTHETIC_FILE_ORIGINS`·사용자 인증을 모두 요구한다. 별도 호스트가 없으면 origin만 검사하고 다운로드하지 않는다. 후보 origin은 허가 근거가 아니며 자동 허용하지 않는다.

지문을 통과하면 조회·편집·기본 저장·재열기·복구와 생성 범위 정리를 수행하고 편집된 HWP를 MCP embedded resource로 반환한다. 로컬 모의 전달·실패 및 결과 재현 검사는 실제 native/Cloud/Dots의 첨부·다운로드 UI 완료를 뜻하지 않는다. 개발용 파일 생성·회수 helper는 새 ignored 합성 파일만 만들고 기존 파일을 덮어쓰지 않는다. [전송 계약과 한계](../../docs/remote-documents.md#고정-합성-파일-전달-진단)

업로드가 꺼진 `hwp_import`의 거부는 `isError: true`와 첫 오류 text를 유지한다. 안전한 descriptor에만 공개 origin 피드백을 추가하고 signed URL·파일명·ID·내용을 반환하지 않는다. 이 거부 경로에서는 네트워크·바이트 수신·저장을 수행하지 않는다. 명시적으로 업로드와 정확한 파일 호스트를 설정한 소유자 전용 시험에서는 일반 가져오기 도구로 합성 파일을 수신·검증·저장했다. 새 도구의 반영 지연을 숨은 쓰기로 우회하지 않는다.

## 배포 경계

`/diagnostics/stored-document`는 GET에서 생성하지 않고, 동일 origin의 명시적 POST에서 서버 지문이 고정된 합성 HWP 한 개만 D1/R2에 보관한다. 시험 form GET에만 same-origin referrer 정책을 사용해 기본 POST의 출처를 유지하며 null·누락·다른 출처는 거부한다. 이후 `/documents/{id}/versions/{version}/view`는 저장된 선택 버전의 HWP·수동 SVG·페이지와 이전 버전 링크를 표시한다. 읽기는 저장·복구·자동 삭제를 하지 않는다. `check-document-viewer.mjs`는 모의 신원의 실제 workerd/D1/R2/WASM으로 재시도·읽기 불변·MCP 편집·재시작·명시적 삭제 후 접근 차단을 시험한다. 별도로 실제 한 사용자의 Chrome 합성 문서 저장 → Codex Desktop native MCP 문단·셀 편집 → 새 버전 SVG 표시·이전/현재 HWP 다운로드·해시·재열기를 실증했다. 일반 파일·두 OAuth 사용자 격리·Cloud/Dots·서식 정확성의 인증은 아니다. [저장 버전 화면](../../docs/remote-documents.md#저장된-버전의-보기-화면)

브라우저 진단은 `/diagnostics/download`와 `/diagnostics/synthetic-result.hwp`만 제공한다. 사용자 인증 뒤 고정 편집 결과를 생성·지문 검사하며 D1/R2와 외부 파일 호스트를 사용하지 않는다. `check-synthetic-download.mjs`는 실제 workerd/WASM을 저장소 binding 없이 시험하지만 신원은 모의다. 실제 Chrome 클릭·수신 검증은 별도 기록으로 구분한다. 이 화면을 일반 저장 버전의 다운로드 UI로 소개하지 않는다. [진단 경계](../../docs/remote-documents.md#고정-합성-브라우저-다운로드)

Site 원본은 별도 checkout으로 관리한다. 실제 `.openai/hosting.json`은 그 checkout에만 있으며 project ID·D1/R2·MCP capability를 유지한다. 저장소의 probe에는 Site ID나 자격을 넣지 않는다. 공통 `rhwp_api.mjs`와 fixture를 Site의 `src/one_hwp`에 복사하고 상대 import만 조정한 뒤 정확한 소스를 Sites 워크플로로 push·포장·비공개 게시한다.

Windows 포장 때 워크플로 프로세스에만 Git Bash PATH와 `TAR_OPTIONS=--force-local`을 적용한다. 시스템 설정을 바꾸지 않는다. 원격 검사기는 확인한 시험 Site에만 접속하고 단기 서비스 자격을 숨긴 stdin으로 받는다. 자격을 인수·파일·로그에 남기거나 사용자 권한으로 해석하지 않는다.

고정 결과의 isolate 캐시는 지속 세션·저장 receipt·멱등성 계약이 아니다. warm/cold 실행·동시 요청·CPU·메모리는 별도 측정한다. 실제 클라이언트 파일 왕복과 OAuth 격리·운영 보관/삭제가 통과하기 전에는 업로드를 열지 않는다.

## 다음 구현 조건

운영 문서 기능을 열기 전에 아래 검사를 따로 완료한다.

1. 좁은 browser ESM 검사기를 운영 문서의 편집 계약에 연결하고 Python과의 대조·실사용 호환성 검사를 확대한다. 현재 고정 합성 성공과 bounded parser만으로 Python 로컬 경로 전체와 동등하다고 표시하지 않는다.
2. 메모리 내 계약과 인증한 사용자별 D1/R2 저장층의 연결은 합성 문서로 구현·검증했다. 실제 사용자 파일 입력·회수와 자원 한도는 추가 검사한다. 현재 위치 cursor는 버전과 경계만 검증하는 조회 위치이며 인증이나 지속 세션이 아니다. 동기 WASM은 `Promise.race`만으로 중단할 수 없다. 공통 모델 검사는 4,096블록·UTF-16 text 합계 2,000,000 code units를 넘으면 거부하고, 누적 style scan 800,000자를 넘는 대상은 읽기 전용으로 표시한다. 요청당 새 텍스트 합계는 500,000 코드 포인트로 제한한다. 이 한도들은 전체 isolate 메모리·CPU 인증이 아니다.
3. upstream의 `console.error` binding을 확인했고 동기 엔진 호출 중에만 차단해 `finally`에서 복원한다. 엔진의 문자열 오류는 고정 오류 코드로 감싼다. 비동기 await 중에는 전역 logger를 변경하지 않는다. 이 검사와 회귀가 원격 플랫폼 전체의 원문 없는 로그 정책·보관 정책 인증을 뜻하지 않으며 실제 배포의 로그 경계도 확인해야 한다.
4. 내부 D1/R2의 immutable 버전·조건부 갱신·복구·재시도는 고정 합성 문서로 검증했다. 사용자 파일 전달·운영 삭제 정책·실제 OAuth 격리는 추가 검사한다. 로컬 파일 교체나 프로세스 lock을 분산 저장 계약으로 재사용하지 않는다.

이 조건 전에는 `cloud_documents_enabled`, `document_upload_supported`, `independent_preservation_guard_ported`, `storage_contract_verified`, `user_isolation_verified`, `layout_verified`, `total_isolate_memory_measured`를 모두 `false`로 유지한다. 별도 외부 호스팅으로의 변경은 사용자와 확인한다.

새 Codex Cloud 작업의 연결과 파일 회수는 Sites 서버의 실행과 별도다. [Codex Cloud 지원 기준](../../docs/codex-cloud.md)의 실제 클라이언트 검증을 통과하기 전에는 클라우드 세션에서 사용자 문서를 처리할 수 있다고 표시하지 않는다. 앱 설명의 친절한 안내 문구는 핵심 작업 흐름 검증 후 마무리한다.
