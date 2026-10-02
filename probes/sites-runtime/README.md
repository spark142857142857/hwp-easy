# Sites 합성 HWP 실행 검증

한글 없는 엔진이 실제 Worker 환경에서 실행되는지 확인하는 개발용 시험이다. **사용자의 HWP를 읽고 편집하는 서비스가 아니다.** 문서 업로드, 사용자 저장소, 운영용 편집 도구와 독립 보존 검사기는 포함하지 않는다.

## 확인한 결과

2026년 10월 2일 Windows의 실제 workerd와 [소유자 전용 Sites 배포](https://hwp-easy-runtime-probe.spark142857.chatgpt.site)에서 같은 `@rhwp/core` 0.8.6을 실행했다. WASM은 빌드 산출물에 포함한 precompiled module로 초기화하며 런타임에서 bytes를 컴파일하지 않는다.

두 합성 사례는 세 문단과 2×2 표, 그리고 같은 구조의 한글 100,000자 문단이다. HWP 생성·읽기 → 본문과 한 셀 교체 → HWP 출력 → 재열기 → 수정하지 않은 문단과 네 셀 확인 → SVG 생성을 통과했다. 입력과 출력의 CFB magic도 검사한다. 긴 문단은 짧은 문단으로 바꾼 뒤 렌더링하므로 긴 원본의 렌더링과 큰 출력까지 시험한 결과는 아니다.

원격의 고정 `/runtime-probe`는 서비스 접근 자격으로 HTTP 200과 실제 엔진 결과를 반환했다. 비로그인 요청과 사용자가 임의로 신원 헤더만 넣은 요청은 HTTP 401이었다. 서비스 접근 자격으로 `/mcp` 초기화를 요청해도 HTTP 401이므로 사용자 OAuth를 우회하지 않는다. **실제 ChatGPT·Codex·Claude의 인증·도구 호출은 아직 검증하지 않았다.** 생성된 플러그인은 이 고정 시험 도구만 제공한다.

초기 WASM linear memory는 2,949,120 bytes, 두 사례 후 유지된 값은 27,394,048 bytes였다. JS heap, 임시 allocation, 동시 요청과 전체 isolate의 peak를 측정한 숫자가 아니다. `free()` 이후 linear memory가 줄어든다고 가정하지 않으며, 128 MB 적합성이나 운영 파일 크기·처리 시간 한도를 입증하지 않는다. [Workers 메모리와 실행 제한](https://developers.cloudflare.com/workers/platform/limits/)

## 재현 방법

Node.js 22 이상을 준비한 개발자가 이 디렉터리에서 실행한다. 일반 사용자 설치 절차가 아니다.

```powershell
npm ci --ignore-scripts --no-audit --no-fund
node scripts/build.mjs
node scripts/check-workerd.mjs
```

`build.mjs`는 고정 패키지 버전을 확인하고 ESM, WASM과 MIT 고지를 `dist/server`에 작성한다. Miniflare와 esbuild는 시험·빌드 의존성이지 배포 런타임 의존성이 아니다. Miniflare 5 alpha의 공식 V4 옵션 변환기로 명시적 ESM/WASM 모듈 목록을 전달한다.

로컬 검사는 실제 workerd 엔진 실행 외에 MCP 초기화·정확히 한 도구의 조회, **모의 신원 헤더의 존재 검사**, 빈 인수만 허용하는 호출과 upload 거부를 확인한다. 신원 헤더를 직접 넣은 로컬 검사를 실제 사용자 인증이나 tenant 격리 검증으로 해석하지 않는다.

원격 검사용 `scripts/check-remote.mjs`는 현재 시험 Site에만 접속한다. Site 도구에서 얻은 URL과 단기 서비스 자격을 숨긴 stdin으로 받고 원문이나 자격을 파일·인수·로그에 남기지 않는다. 서비스 자격은 사용자 신원이 아니므로 실제 플러그인 연결 성공을 반환하지 않는다. 이 스크립트를 일반 사용자나 문서 작업용 도구로 노출하지 않는다.

## 배포 경계

Site 원본은 별도 Site checkout에 있고, 해당 checkout의 `.openai/hosting.json`에 실제 `project_id`와 `capabilities: ["mcp"]`를 둔다. 이 시험 소스에는 Site ID나 자격을 넣지 않는다. 검증된 정확한 소스를 Sites 워크플로로 push·포장한 뒤 비공개로 게시했다. 로컬 검사만으로 비공개 접근 경계나 원격 WASM 모듈 전달 성공을 주장하지 않는다.

Windows에서는 워크플로 프로세스에만 Git Bash의 PATH와 `TAR_OPTIONS=--force-local`을 설정해 포장했다. Windows 드라이브 경로가 tar의 원격 대상 구문으로 해석되지 않도록 하기 위한 것이며 시스템 설정을 변경하지 않는다.

현재 고정 결과를 isolate 메모리에 캐시한다. 지속 세션·저장 receipt·멱등성 계약이 아니며 반복 warm 실행, 동시 요청, cold startup의 CPU·메모리 검사를 대신하지 않는다.

## 다음 구현 조건

운영 문서 기능을 열기 전에 아래 검사를 따로 완료한다.

1. Python의 독립 CFB·FileHeader·bounded raw-DEFLATE·레코드 경계와 보존 검사를 포트한다. WASM 재열기와 loss report만 신뢰하지 않고 기존 변조 회귀를 Python과 대조한다.
2. 버전 기반 대상·전체 기존 값·비대상 metadata 검사와 전체 조회 cursor를 포트한다. 동기 WASM은 `Promise.race`만으로 중단할 수 없으므로 실제 자원 한도도 검사한다.
3. upstream binding의 원문 포함 가능 `console.error` 경로를 감사한다. 고정 MCP 오류로 감쌌다는 이유만으로 원문 없는 Worker 로그를 보장하지 않는다.
4. 사용자·문서별 immutable version, 기대 현재 버전에 대한 조건부 갱신, 복구·재시도·삭제 정책과 파일 전달을 실제 저장소에서 검사한다. 로컬 파일 교체나 프로세스 lock을 분산 저장 계약으로 재사용하지 않는다.

이 조건 전에는 `cloud_documents_enabled`, `document_upload_supported`, `independent_preservation_guard_ported`, `storage_contract_verified`, `user_isolation_verified`, `layout_verified`, `total_isolate_memory_measured`를 모두 `false`로 유지한다. 별도 외부 호스팅으로의 변경은 사용자와 확인한다.
