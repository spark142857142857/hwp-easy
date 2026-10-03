# Sites 합성 HWP 실행 검증

한글 없는 엔진과 독립 레코드 검사, D1/R2 저장 및 인증한 사용자별 문서 계약이 실제 Worker 환경에서 실행되는지 확인하는 개발용 시험이다. **일반 사용자용 HWP 편집 서비스가 아니다.** 고정 합성 문서로 보존·저장·전송을 시험하며, 개인 파일 업로드는 꺼 둔다. 표시 이름은 `HWP Easy`이며 기존 비공개 Site와 연결을 유지한다. [개발용 문서 도구와 파일 전달](../../docs/remote-documents.md)

## 확인한 결과

2026년 10월 2일 Windows의 실제 workerd와 [소유자 전용 Sites 배포](https://hwp-easy-runtime-probe.spark142857.chatgpt.site)에서 같은 `@rhwp/core` 0.8.6을 실행했다. WASM은 빌드 산출물에 포함한 precompiled module로 초기화하며 런타임에서 bytes를 컴파일하지 않는다.

두 합성 사례는 세 문단과 2×2 표, 그리고 같은 구조의 한글 100,000자 문단이다. HWP 생성·읽기 → 본문과 한 셀 교체 → HWP 출력 → 재열기 → 수정하지 않은 문단과 네 셀 확인 → SVG 생성을 통과했다. 입력과 출력의 CFB magic도 검사한다. 긴 문단은 짧은 문단으로 바꾼 뒤 렌더링하므로 긴 원본의 렌더링과 큰 출력까지 시험한 결과는 아니다.

WASM의 문서 모델과 별도로 CFB 스트림을 읽고, bounded raw-DEFLATE로 본문과 DocInfo를 해제한 뒤 편집 전후 레코드를 비교한다. 수정하지 않은 레코드의 삭제와 미지원 tag 1000이 포함된 입력의 편집을 거부하는 합성 실패 사례도 검사한다. `raw_preservation_probe_passed`는 원래 두 고정 시험에만 해당하며, 해당 fixture의 유일한 기존 문구로 raw 문단을 찾는다.

별도의 `portable_document_contract_probe`는 공통 메모리 내 계약을 실제 Worker에서 시험한다. 같은 문구가 반복되는 본문·표에서 전체 내용을 7번 이어 읽고, 문서 버전과 연결된 문단·셀 두 위치만 수정한다. 오래된 버전·대상, 전체 기존 값 불일치와 중복 대상을 거부하고 모델·raw 보존·재열기·SVG를 확인한다. 저장은 하지 않으며 `saved: false`, `persistence: none`, `codex_cloud_client_verified: false`를 반환한다. 원격 도구 인수와 업로드 경계는 그대로다.

Node와 browser ESM은 `src/one_hwp/rhwp_api.mjs`의 같은 읽기·편집·미리보기 코드를 사용한다. `engine/document.mjs`는 입력 복사, SHA-256 대상, 이어 읽기, 계획 검사와 독립 raw 검사를 연결한다. raw 문단을 전체 순서·텍스트·본문/셀 nesting level과 대조하므로 유일한 문구를 요구하지 않는다. 불일치가 있으면 읽기의 범위 경고를 반환하고 편집은 비활성화한다. 편집 후에도 raw 텍스트와 재열기 모델을 대조한다. 이는 좁은 지원 profile의 검증이며 임의 문서·페이지 배치 인증이 아니다.

검사기의 현재 보수적 한도는 입력 4 MiB, 본문 해제 합계 8 MiB, DocInfo 해제 2 MiB, 본문 레코드 100,000개, directory slot 2,048개와 경로 문자 누적 65,536개다. 파일 내부의 cycle·sector 별칭·잘린 체인·확장 한도 초과를 거부한다. CFB의 모든 Unicode 정렬·트리 규칙을 검사하는 범용 복구 parser는 아니며, 이 숫자는 운영 문서의 허용 크기나 전체 isolate 메모리 적합성 인증이 아니다.

원격의 고정 `/runtime-probe`는 서비스 접근 자격으로 HTTP 200과 실제 엔진 결과를 반환했다. 비로그인 요청과 사용자가 임의로 신원 헤더만 넣은 요청은 HTTP 401이었다. 서비스 접근 자격으로 `/mcp` 초기화를 요청해도 HTTP 401이므로 사용자 OAuth를 우회하지 않는다.

같은 날 사용자가 설치한 비공개 시험 플러그인의 `hwp_runtime_probe`를 **Codex Desktop에서 실제 호출해** 두 사례의 `engine_execution_passed: true` 결과를 받았다. 직접 HTTP 요청이나 모의 신원 헤더가 아닌 설치된 연결을 통한 도구 왕복이다. 결과가 isolate에 캐시될 수 있으므로 이 호출을 새 cold 실행·자원 측정으로 해석하지 않는다. 한 사용자 호출 성공은 운영용 권한 모델 전체의 검증이 아니다. ChatGPT·Claude 연결, 개인 문서 전달·편집·저장, 권한 철회와 사용자 간 격리는 아직 미검증이다. 생성된 플러그인은 이 고정 시험 도구만 제공한다.

보존 검사기를 포함한 비공개 버전 2 게시 후에도 기존 플러그인 연결을 통해 다시 호출해 `raw_preservation_probe_passed: true`와 두 실패 사례의 거부 결과를 받았다. Site 제목과 MCP `serverInfo.name`은 `HWP Easy`이며 URL·플러그인 ID·소유자 전용 접근 대상은 유지했다. 설치 목록에 표시되는 이름의 캐시 갱신까지 별도로 확인한 것은 아니다.

메모리 내 계약을 포함한 비공개 버전 4의 게시와 원격 합성 시험도 성공했다. 같은 플러그인 ID와 소유자 한 명의 접근 범위를 유지했고 비로그인·임의 신원·서비스 자격의 MCP 접근은 401이었다. 다만 이번 Codex 세션의 설치된 도구 호출은 `UNAUTHORIZED`와 재인증 요청을 반환했다. 버전 4의 서버 실행 성공은 확인했지만, 이 세션의 새 사용자 MCP 왕복은 재인증 후 다시 검증해야 한다. 서비스 자격으로 사용자 인증을 우회하지 않았다.

초기 WASM linear memory는 2,949,120 bytes, 두 사례 후 유지된 값은 27,394,048 bytes였다. JS heap, 임시 allocation, 동시 요청과 전체 isolate의 peak를 측정한 숫자가 아니다. `free()` 이후 linear memory가 줄어든다고 가정하지 않으며, 128 MB 적합성이나 운영 파일 크기·처리 시간 한도를 입증하지 않는다. [Workers 메모리와 실행 제한](https://developers.cloudflare.com/workers/platform/limits/)

## 재현 방법

2026년 10월 3일에는 내부 `storage/service.mjs`와 `storage/store.mjs`를 추가했다. 실제 로컬 workerd의 D1/R2에서 저장 후 runtime을 폐기·재생성해 현재 HWP·이전 버전·요청 영수증을 다시 읽고 복구했다. 동시 저장의 한 요청만 성공하는 조건부 저장, 복구 후 새 UUID 버전과 ABA 차단, 같은 요청 재시도도 검사한다. 주입한 DB 응답 유실·영수증 조회 실패·R2 실패와 실제 blob 손상은 고정 오류로 처리한다. 이 실패 주입과 합성 소유자 범위 시험은 실제 OAuth 두 사용자 격리·운영 장애 인증이 아니다. [저장 계약](../../docs/durable-storage.md)

새 `/storage-probe`는 개인 문서나 소유자 인수를 받지 않는 개발용 POST 진단이다. 생성한 두 합성 이름공간만 쓰고 시험 종료 시 그 데이터만 지운다. 기존 MCP의 읽기 전용 `hwp_runtime_probe`에 쓰기 부작용을 추가하지 않았다. 메모리 내 진단과 별개로 실행하며 사용자 업로드와 운영 지원 플래그는 아직 꺼져 있다.

같은 날 비공개 버전 5에서도 D1/R2 합성 저장·편집·이전 버전 조회·복구·동시 저장·재시도를 통과했고 시험 데이터 정리가 완료됐다. 비로그인과 임의 신원 헤더의 storage 요청은 401, 입력 본문은 400이었다. 기존 메모리 내 runtime 진단도 200으로 통과했으며 서비스 자격의 MCP 초기화는 여전히 401이다. 첫 통합 진단은 전체 요청에 공유한 30초 deadline이 뒤의 runtime 호출을 취소해 실패했고, 개발용 검사기에 요청별 deadline을 적용한 재검사에서는 전 과정이 통과했다. 소유자 전용 접근, 플러그인 ID·주소는 유지했다.

버전 5 검증 때 설치된 MCP 연결은 `UNAUTHORIZED`와 재인증 요청을 반환했다. 2026년 10월 3일 사용자가 기존 연결을 재인증한 뒤 이 세션의 실제 `hwp_runtime_probe` 호출은 정상 결과를 반환했다. 표시 이름 변경과 만료의 인과관계는 확인하지 못했다. 이것은 기존 합성 도구의 사용자 왕복 확인이지 파일 전달이나 새 도구 반영의 증거는 아니다. Dots 지원 목표와 검증 기준은 [클라이언트 안내](../../docs/codex-cloud.md)에 반영했다.

같은 날 인증한 사용자 범위의 개발용 문서 도구 10개를 추가했다. 실제 로컬 workerd·D1/R2에서 합성 HWP 입력 → MCP 조회·계획·같은 문서 편집·저장 → 바이너리 다운로드·재열기·SVG → 복구를 통과했다. 로컬 사용자 헤더와 `fileParams` 네트워크 응답은 모의 입력이다. 고정 `hwp_workflow_probe`는 서버 내부의 소유자 범위 handler를 시험한 뒤 생성한 문서만 정리하며 외부 HTTP 다운로드·네이티브 첨부·실제 두 사용자·Cloud·Dots는 미검증으로 표시한다. 운영 보관·삭제 정책과 실제 전달 호스트를 확인할 때까지 개인 파일 입력을 비활성화한다.

비공개 버전 6 게시가 성공했고 업로드 비활성화·빈 파일 origin 설정을 적용했다. 원격 고정 엔진·저장 시험과 시험 데이터 정리가 통과했으며, 비로그인 요청·임의 신원 및 서비스 자격에 임의 신원을 섞은 문서 경로 접근은 401이었다. 서비스 자격의 MCP 초기화도 401이었다. 게시 후 설치된 기존 `hwp_runtime_probe`를 다시 실제 호출해 성공했다. 당시 세션의 설치된 도구 목록에는 새 문서 도구가 아직 반영되지 않아 새 도구의 사용자 호출과 workflow 진단은 원격에서 미검증이었다. 연결과 접근 대상을 바꾸거나 재인증을 우회하지 않았다.

후속 세션에는 새 도구가 반영돼 총 11개를 확인했다. 첫 읽기 전용 `hwp_capabilities` 호출은 `UNAUTHORIZED`와 `oauth_token_invalid_grant` 재인증 요청을 반환했다. 서버 권한을 완화하거나 다른 인증으로 사용자 신원을 대신하지 않았다.

같은 날 파일 스트림의 메모리·조각 수 제한과 reader 해제를 보강하고 버전 목록에 현재 포인터를 명시했다. 합성 workflow의 첫 저장 전에 생성 범위를 추적해 commit 응답·영수증 조회·blob 응답 유실과 읽기 실패에서도 그 문서만 정리한다. 정리 근거가 불확실하거나 다른 문서의 키가 섞이면 삭제를 멈춘다. 로컬 전체 검사 206개, D1/R2 저장 검사 14개, 호스트 계약 검사 18개와 실패 주입 7개가 통과했다. 실패 주입과 모의 신원을 실제 OAuth·운영 장애나 외부 파일 첨부 검증으로 표시하지 않는다.

비공개 버전 7 배포와 원격 고정 엔진·D1/R2 저장 시험이 성공했고 합성 시험 데이터 정리가 완료됐다. 비로그인·임의 신원과 서비스 자격의 사용자 문서 경로 및 MCP 접근 거부도 통과했다. 기존 소유자 한 명·외부 방문자 없음, 업로드 비활성화와 빈 파일 origin 설정을 유지했다.

기존 연결을 다시 재인증한 뒤 실제 Codex Desktop에서 `hwp_capabilities`, `hwp_runtime_probe`, `hwp_workflow_probe`가 성공했다. 로그인한 사용자 범위의 합성 문서를 8번 이어 읽고 계획·같은 문서 저장·재시도·내부 재열기·SVG·복구 및 시험 문서 정리를 확인했다. 로컬 합성 HWP를 실제 `hwp_import` 파일 인수로 전달했을 때에는 인수 검사 뒤 업로드 비활성화 오류를 받았다. 파일 descriptor 전달만 확인한 것으로, 다운로드 호스트·바이트 수신·외부 다운로드·Cloud·Dots·실제 두 사용자 격리는 미검증이다. [상세 검증 기록](../../docs/remote-documents.md)

Node.js 22 이상을 준비한 개발자가 이 디렉터리에서 실행한다. 일반 사용자 설치 절차가 아니다.

기본 보관은 사용자가 직접 삭제할 때까지로 정했다. 시간 경과나 작업 종료에 따른 자동 만료는 추가하지 않았다. 명시적 `hwp_delete`와 삭제 영수증을 추가해 현재 버전·소유자·재시도 근거를 확인하고 논리 문서와 기록된 버전을 제거한다. 미게시·진행 중 저장의 바이트 GC는 미검증이며 개인 업로드는 계속 꺼 둔다. 로컬 전체 208개 검사, 저장 14개, 호스트 22개, 합성 실패 주입 7개와 명시적 삭제 8개 검사가 통과했다.

비공개 버전 8 게시가 성공했다. 게시 후 실제 Codex Desktop의 기능 조회와 합성 workflow가 추가 재인증 없이 성공했고 기록된 버전의 명시적 삭제와 시험 데이터 정리도 통과했다. OAuth 클라이언트 ID·플러그인 ID·주소·접근 대상과 런타임 환경 revision은 유지했다. 새 삭제 도구 자체의 직접 네이티브 호출과 실제 첨부 바이트 왕복·운영 GC는 아직 미검증이다. [상세 검증 기록](../../docs/remote-documents.md)

이후 같은 버전 8에서 기존 ChatGPT Work Cloud 연결의 첫 기능 조회가 인증 오류로 실패했다. 사용자가 재인증한 뒤 native 기능 조회·고정 엔진 진단·합성 workflow 세 가지가 모두 성공했고, 이어서 Desktop 기능 조회도 성공했다. 그 사이 재배포하지 않았으며 개인 업로드·인증·접근 설정도 바꾸지 않았다. 실제 첨부 바이트·외부 HWP 다운로드·저장소 Codex Cloud·Dots·시각 배치는 미검증으로 남긴다. [Cloud 진단 기록](../../docs/codex-cloud.md#2026-10-03-chatgpt-work-cloud-native-진단)

후속 로컬 소스 개선에서 raw-DEFLATE 뒤의 정확한 8바이트 CRC32/ISIZE가 해제 결과와 일치할 때만 허용했다. 본문과 DocInfo에 같은 규칙을 쓰며 임의 nonzero 꼬리·잘못된 checksum/size·추가 member·확장 한도 초과는 계속 거부한다. Node 전체 214개, D1/R2 저장 14개, 호스트 23개, 실패 주입 7개와 명시적 삭제 8개가 통과했다. 호스트 검사에는 해당 꼬리를 가진 실제 합성 HWP의 workerd 입력 → 읽기·계획·본문/셀 편집 → 다운로드·재열기 → 정확한 원본 복구가 포함된다. 시험 fixture는 Node 표준 라이브러리로 생성 문서 사본의 여유 mini-sector에만 꼬리를 추가한다. 입력 원본은 바꾸지 않으며 CFB 트리·스트림 집합도 그대로 유지한다. 개인 `testdocs/`는 Worker에 전달하지 않는다. 당시에는 비공개 버전 8에 재게시하지 않았고 후속 버전 9에 반영했다. 모의 신원 검사를 실제 OAuth·Cloud·Dots 연결 근거로 사용하지 않는다. [로컬 호환성 결과](../../docs/native-engine.md#2026-10-03-압축-꼬리-호환성-개선)

### 비공개 버전 9: 전송 시간 제한과 호환성 반영

2026년 10월 3일 Site source `553061e973add0a3e8a150052f934363e7c76218`의 압축 꼬리 규칙과 전송 개선을 같은 비공개 Site에 게시했다. 본문 reader는 전체 수신에 30초 deadline을 적용하며 조각마다 제한을 다시 시작하지 않는다. 멈춘 스트림·끝나지 않는 취소·취소 거부에서도 고정 오류를 반환하고 reader 잠금을 해제한다. 외부 fetch의 응답 헤더 대기, OAuth, 엔진과 저장 작업 전체의 시간 제한은 별도다. 기능 조회는 `transfer_body_timeout_ms: 30000`을 반환한다.

저장소 probe의 Node 222개 검사가 통과했다. 7개 새 Node 회귀와 6가지 스트림 시나리오를 실행하는 실제 workerd 검사 1개가 포함된다. 배포 checkout의 220개 검사는 같은 런타임 코드와 회귀를 사용하며 저장소 경로용 fixture helper 검사 2개는 포함하지 않는다. 실제 workerd/D1/R2 저장 14개, 호스트 23개, 실패 주입 7개와 명시적 삭제 8개도 통과했다. 시간 제한 검사는 개인정보·OAuth·외부 네트워크 없이 만든 스트림이며 인증 오류의 해결 근거가 아니다.

게시 뒤 원격 고정 엔진·저장·시험 자료 정리와 비로그인·임의 신원·서비스 자격의 사용자 문서/MCP 접근 거부가 통과했다. 실제 Desktop의 기능 조회·합성 workflow와 기존 ChatGPT Work Cloud의 기능 조회·엔진·workflow native 호출도 성공했다. 양쪽 모두 추가 재인증이 없었으며 OAuth 클라이언트·플러그인 ID·주소·접근 revision·환경 revision 1을 유지했다. 개인 업로드는 계속 꺼져 있고 허용 파일 origin도 비어 있다. CRC 꼬리 HWP의 바이트 왕복은 로컬 workerd 근거로 구분하며 실제 첨부 바이트·외부 HWP 회수·두 OAuth 사용자 격리·저장소 Codex Cloud·Dots·시각 배치는 미검증이다. [Cloud 기록](../../docs/codex-cloud.md#비공개-버전-9-배포-뒤-재검증)

```powershell
npm ci --ignore-scripts --no-audit --no-fund
node scripts/build.mjs
node --test tests/*.test.mjs
node scripts/check-workerd.mjs
node scripts/check-storage.mjs
node scripts/check-host.mjs
node scripts/check-host-failures.mjs
node scripts/check-deletion.mjs
```

`build.mjs`는 고정 패키지 버전을 확인하고 ESM, WASM과 라이선스 고지를 `dist/server`에 작성한다. 생성된 migration은 `dist/.openai/drizzle`에도 포함한다. Drizzle은 개발용 스키마·migration 생성에만 사용하고 Worker 쿼리는 raw D1 prepared statement와 원자적인 batch를 사용한다. pako 3.0.2의 low-level inflater를 런타임에 사용한다. cfb 1.2.2는 합성 시험 파일을 만드는 개발 의존성일 뿐 배포 parser가 아니다. Miniflare와 esbuild도 시험·빌드 의존성이지 배포 런타임 의존성이 아니다. Miniflare 5 alpha의 공식 V4 옵션 변환기로 명시적 ESM/WASM 모듈 목록을 전달한다.

로컬 검사는 실제 workerd 엔진 실행 외에 MCP 초기화·13개 도구의 조회, **모의 신원 헤더의 존재 검사**, 합성 문서 계약과 기본 upload 거부를 확인한다. 신원 헤더를 직접 넣은 로컬 검사를 실제 사용자 인증이나 tenant 격리 검증으로 해석하지 않는다.

## 고정 합성 파일 전달 준비

`hwp_transfer_probe`는 일반 업로드를 켜지 않고 `make-transfer-fixture.mjs`의 정확한 합성 HWP만 시험하는 별도 진단이다. 서버 지문·13,312바이트 제한·별도 `HWP_EASY_SYNTHETIC_FILE_ORIGINS`·사용자 인증을 모두 요구한다. 별도 호스트가 없으면 origin만 검사하며 다운로드를 하지 않는다. 원격에는 이 별도 설정도 아직 없으므로 실제 바이트 전송을 활성화하지 않았다.

지문을 통과한 경우 실제 조회·편집·기본 저장·재열기·복구와 생성 범위 정리를 수행하고 편집된 합성 HWP를 MCP embedded resource로 반환한다. 로컬 actual workerd의 7개 모의 전달·실패 시나리오는 통과했다. 결과 저장 helper는 고정 편집을 독립적으로 재현해 동일 바이트만 새 ignored 파일로 회수한다. 일반 사용자용 명령·공개 파일 URL·다운로드 UI나 실제 native/Cloud/Dots 완료를 의미하지 않는다. [계약과 한계](../../docs/remote-documents.md#고정-합성-파일-전달-진단)

### 비공개 버전 10 배포 기록

2026년 10월 3일 Site source `459c4266c92f97597446f49ad6d78728ff599fa7`을 비공개 버전 10으로 게시했고 배포 상태는 `succeeded`였다. 원격 고정 합성 엔진·D1/R2 저장 및 자료 정리가 통과했다. 익명·임의 신원 요청과 서비스 자격의 MCP 접근은 401로 거부됐다. 서비스 자격의 진단을 실제 사용자 MCP 연결 성공으로 집계하지 않는다.

기존 OAuth 클라이언트·플러그인·MCP resource·접근 정책과 환경 revision 1은 유지했다. 일반 업로드는 `false`, 일반 파일 origin은 `[]`이고 별도 합성 전달 origin도 설정하지 않았다. 이 단계 첫 Desktop 기능 조회는 **새 배포 전** `oauth_token_invalid_grant`로 실패해 재인증을 요청했고 해당 연결의 후속 호출은 중단했다. 버전 10의 사용자 native 진단·첨부 수신과 결과 회수는 아직 미검증이다.

루트의 Node 단위 검사 228개, Site checkout의 222개 및 실제 workerd 저장·호스트·실패·삭제·합성 전달 검사가 통과했다. 차이는 로컬 전용 파일 생성·회수 helper 검사 6개다. 구현 commit `828506ef2372a8c22e28675f19e7b38633e409ef`의 [Windows·Linux CI 4개 작업](https://github.com/spark142857142857/hwp-easy/actions/runs/37105622024)도 모두 성공했다. 개인 `testdocs`는 이 시험에 사용하거나 업로드하지 않았다.

원격 검사용 `scripts/check-remote.mjs`는 현재 시험 Site에만 접속한다. Site 도구에서 얻은 URL과 단기 서비스 자격을 숨긴 stdin으로 받고 원문이나 자격을 파일·인수·로그에 남기지 않는다. 서비스 자격은 사용자 신원이 아니므로 실제 플러그인 연결 성공을 반환하지 않는다. 이 스크립트를 일반 사용자나 문서 작업용 도구로 노출하지 않는다.

이번 Windows 회귀에서 레코드·컨테이너 합성 검사 162개, 메모리 내 문서 계약 검사 32개와 실제 workerd 왕복이 통과했다. 계약 검사는 고정 HWP 20종의 전체 조회·대상 편집·재열기, 긴 문단 끝까지의 조회, snapshot 변경 방지, 부분 오류·요청 한도·미지원·로그 복구 사례를 포함한다. 공통 모델 작업량 한도는 별도 빠른 mock 검사로 확인하며 이를 실제 HWP 호환성 시험 수로 해석하지 않는다. 저장소 루트의 고정 HWP 20종도 Python `olefile` reader와 대조해 해제된 스트림 180개, 문단 레코드 비교 60회와 DocInfo 20개가 일치했다. 이를 재현하려면 루트 npm 런타임과 Python native 의존성도 준비한 뒤 루트에서 `node probes/sites-runtime/scripts/check-python-guard.mjs`를 실행한다. 필요하면 `PYTHON`을 해당 venv 실행 파일로 지정한다. 모든 입력은 메모리에서 생성한 합성 문서이며 개인 문서 폴더를 읽지 않는다.

## 배포 경계

### 비공개 버전 11: 기존 첨부 도구의 안전한 실패 피드백

2026년 10월 3일 재인증 뒤 Desktop 기능 조회와 합성 workflow 및 기존 ChatGPT Work Cloud 기능 조회가 성공했다. 양쪽 native 도구 목록에는 12개가 있으며 새 `hwp_transfer_probe`는 아직 없었다. 인증 오류와 목록 반영 대기를 구분하고 새 tool 이름을 추측 호출하거나 서비스 자격으로 사용자 신원을 대신하지 않았다.

Site source `24aecb0817b2b8f433b0274b56209bf2f488ab17`을 같은 소유자 전용 Site의 버전 11로 게시했다. 기존 `hwp_import`가 업로드를 거부할 때 공개 HTTPS origin만 추가로 알려주며 첫 오류 text와 `isError`, 입력 schema, 실제 작업 거부는 유지한다. arbitrary error 속성을 응답에 싣지 않고 signed URL·파일명·ID·내용을 노출하지 않는다. 루트 단위 검사 231개와 Site 단위 검사 225개, actual workerd 저장·호스트·실패·삭제 및 합성 전달 8개 시나리오가 통과했다.

게시 뒤 Desktop native 기능 조회와 새 고정 합성 HWP 파일 인수 전달은 추가 재인증 없이 완료됐다. 후보 origin만 반환하고 `network_request_made`, `input_file_bytes_received`, `stored`, `general_uploads_enabled`는 모두 `false`였다. OAuth 클라이언트·플러그인·MCP resource·접근 revision과 환경 revision 1은 유지했다. 일반 업로드 `false`, 일반 allowlist `[]`와 미설정 합성 allowlist도 그대로다. 실제 바이트 왕복과 HWP 결과 회수, 두 OAuth 사용자·저장소 Codex Cloud·Dots·배치는 미검증이다. [클라이언트 기록](../../docs/codex-cloud.md#재인증-뒤-버전-1011-확인과-도구-목록-대기)

버전 11의 원격 고정 엔진·D1/R2 저장·합성 자료 정리와 익명·임의 신원·서비스 자격의 사용자 문서/MCP 접근 거부도 통과했다. 게시 뒤 Desktop의 native 합성 workflow가 8회 전체 조회·계획·같은 문서 저장·재열기·복구·기록된 버전 삭제·정리를 성공했다. 구현 commit `b195b840868c15e5c8e6c677e358632e6d136e8a`의 [Windows·Ubuntu CI 4개 작업](https://github.com/spark142857142857/hwp-easy/actions/runs/37107733442)은 모두 성공했다. 후보 전달 호스트를 허용 목록에 추가하지 않았고 개인 파일도 시험하지 않았다.

Site 원본은 별도 Site checkout에 있고, 해당 checkout의 `.openai/hosting.json`에 실제 `project_id`와 `capabilities: ["mcp"]`를 둔다. 이 시험 소스에는 Site ID나 자격을 넣지 않는다. Site checkout은 이 probe 디렉터리를 루트로 사용하므로 공통 `rhwp_api.mjs`와 합성 fixture를 그 checkout의 `src/one_hwp`에 그대로 복사하고 해당 import의 상대 위치만 조정한다. 검증된 정확한 Site 소스를 Sites 워크플로로 push·포장한 뒤 비공개로 게시한다. 로컬 검사만으로 비공개 접근 경계나 원격 WASM 모듈 전달 성공을 주장하지 않는다.

Windows에서는 워크플로 프로세스에만 Git Bash의 PATH와 `TAR_OPTIONS=--force-local`을 설정해 포장했다. Windows 드라이브 경로가 tar의 원격 대상 구문으로 해석되지 않도록 하기 위한 것이며 시스템 설정을 변경하지 않는다.

현재 고정 결과를 isolate 메모리에 캐시한다. 지속 세션·저장 receipt·멱등성 계약이 아니며 반복 warm 실행, 동시 요청, cold startup의 CPU·메모리 검사를 대신하지 않는다.

## 다음 구현 조건

운영 문서 기능을 열기 전에 아래 검사를 따로 완료한다.

1. 좁은 browser ESM 검사기를 운영 문서의 편집 계약에 연결하고 Python과의 대조·실사용 호환성 검사를 확대한다. 현재 고정 합성 성공과 bounded parser만으로 Python 로컬 경로 전체와 동등하다고 표시하지 않는다.
2. 메모리 내 계약과 인증한 사용자별 D1/R2 저장층의 연결은 합성 문서로 구현·검증했다. 실제 사용자 파일 입력·회수와 자원 한도는 추가 검사한다. 현재 위치 cursor는 버전과 경계만 검증하는 조회 위치이며 인증이나 지속 세션이 아니다. 동기 WASM은 `Promise.race`만으로 중단할 수 없다. 공통 모델 검사는 4,096블록·UTF-16 text 합계 2,000,000 code units를 넘으면 거부하고, 누적 style scan 800,000자를 넘는 대상은 읽기 전용으로 표시한다. 요청당 새 텍스트 합계는 500,000 코드 포인트로 제한한다. 이 한도들은 전체 isolate 메모리·CPU 인증이 아니다.
3. upstream의 `console.error` binding을 확인했고 동기 엔진 호출 중에만 차단해 `finally`에서 복원한다. 엔진의 문자열 오류는 고정 오류 코드로 감싼다. 비동기 await 중에는 전역 logger를 변경하지 않는다. 이 검사와 회귀가 원격 플랫폼 전체의 원문 없는 로그 정책·보관 정책 인증을 뜻하지 않으며 실제 배포의 로그 경계도 확인해야 한다.
4. 내부 D1/R2의 immutable 버전·조건부 갱신·복구·재시도는 고정 합성 문서로 검증했다. 사용자 파일 전달·운영 삭제 정책·실제 OAuth 격리는 추가 검사한다. 로컬 파일 교체나 프로세스 lock을 분산 저장 계약으로 재사용하지 않는다.

이 조건 전에는 `cloud_documents_enabled`, `document_upload_supported`, `independent_preservation_guard_ported`, `storage_contract_verified`, `user_isolation_verified`, `layout_verified`, `total_isolate_memory_measured`를 모두 `false`로 유지한다. 별도 외부 호스팅으로의 변경은 사용자와 확인한다.

새 Codex Cloud 작업의 연결과 파일 회수는 Sites 서버의 실행과 별도다. [Codex Cloud 지원 기준](../../docs/codex-cloud.md)의 실제 클라이언트 검증을 통과하기 전에는 클라우드 세션에서 사용자 문서를 처리할 수 있다고 표시하지 않는다. 앱 설명의 친절한 안내 문구는 핵심 작업 흐름 검증 후 마무리한다.
