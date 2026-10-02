# Sites 합성 HWP 실행 검증

한글 없는 엔진과 독립 레코드 검사가 실제 Worker 환경에서 실행되는지 확인하는 개발용 시험이다. **사용자의 HWP를 읽고 편집하는 서비스가 아니다.** 고정 합성 문서에 좁은 보존 검사를 붙였으며, 문서 업로드·사용자 저장소·운영용 편집 도구는 포함하지 않는다. 표시 이름은 `HWP Easy`이며 기존 비공개 Site와 연결을 유지한다.

## 확인한 결과

2026년 10월 2일 Windows의 실제 workerd와 [소유자 전용 Sites 배포](https://hwp-easy-runtime-probe.spark142857.chatgpt.site)에서 같은 `@rhwp/core` 0.8.6을 실행했다. WASM은 빌드 산출물에 포함한 precompiled module로 초기화하며 런타임에서 bytes를 컴파일하지 않는다.

두 합성 사례는 세 문단과 2×2 표, 그리고 같은 구조의 한글 100,000자 문단이다. HWP 생성·읽기 → 본문과 한 셀 교체 → HWP 출력 → 재열기 → 수정하지 않은 문단과 네 셀 확인 → SVG 생성을 통과했다. 입력과 출력의 CFB magic도 검사한다. 긴 문단은 짧은 문단으로 바꾼 뒤 렌더링하므로 긴 원본의 렌더링과 큰 출력까지 시험한 결과는 아니다.

이제 WASM의 문서 모델과 별도로 CFB 스트림을 읽고, bounded raw-DEFLATE로 본문과 DocInfo를 해제한 뒤 편집 전후 레코드를 비교한다. 수정하지 않은 레코드의 삭제와 미지원 tag 1000이 포함된 입력의 편집을 거부하는 합성 실패 사례도 검사한다. `raw_preservation_probe_passed`는 이 고정 시험에만 해당한다. 대상은 fixture의 유일한 기존 문구를 raw 문단 순서에 대응시켜 찾으며, 임의 문서의 버전 기반 대상 식별이나 최종 텍스트·스타일·표 관계의 일반 검증 계약을 이식했다는 뜻이 아니다.

검사기의 현재 보수적 한도는 입력 4 MiB, 본문 해제 합계 8 MiB, DocInfo 해제 2 MiB, 본문 레코드 100,000개, directory slot 2,048개와 경로 문자 누적 65,536개다. 파일 내부의 cycle·sector 별칭·잘린 체인·확장 한도 초과를 거부한다. CFB의 모든 Unicode 정렬·트리 규칙을 검사하는 범용 복구 parser는 아니며, 이 숫자는 운영 문서의 허용 크기나 전체 isolate 메모리 적합성 인증이 아니다.

원격의 고정 `/runtime-probe`는 서비스 접근 자격으로 HTTP 200과 실제 엔진 결과를 반환했다. 비로그인 요청과 사용자가 임의로 신원 헤더만 넣은 요청은 HTTP 401이었다. 서비스 접근 자격으로 `/mcp` 초기화를 요청해도 HTTP 401이므로 사용자 OAuth를 우회하지 않는다.

같은 날 사용자가 설치한 비공개 시험 플러그인의 `hwp_runtime_probe`를 **Codex Desktop에서 실제 호출해** 두 사례의 `engine_execution_passed: true` 결과를 받았다. 직접 HTTP 요청이나 모의 신원 헤더가 아닌 설치된 연결을 통한 도구 왕복이다. 결과가 isolate에 캐시될 수 있으므로 이 호출을 새 cold 실행·자원 측정으로 해석하지 않는다. 한 사용자 호출 성공은 운영용 권한 모델 전체의 검증이 아니다. ChatGPT·Claude 연결, 개인 문서 전달·편집·저장, 권한 철회와 사용자 간 격리는 아직 미검증이다. 생성된 플러그인은 이 고정 시험 도구만 제공한다.

보존 검사기를 포함한 비공개 버전 2 게시 후에도 기존 플러그인 연결을 통해 다시 호출해 `raw_preservation_probe_passed: true`와 두 실패 사례의 거부 결과를 받았다. Site 제목과 MCP `serverInfo.name`은 `HWP Easy`이며 URL·플러그인 ID·소유자 전용 접근 대상은 유지했다. 설치 목록에 표시되는 이름의 캐시 갱신까지 별도로 확인한 것은 아니다.

초기 WASM linear memory는 2,949,120 bytes, 두 사례 후 유지된 값은 27,394,048 bytes였다. JS heap, 임시 allocation, 동시 요청과 전체 isolate의 peak를 측정한 숫자가 아니다. `free()` 이후 linear memory가 줄어든다고 가정하지 않으며, 128 MB 적합성이나 운영 파일 크기·처리 시간 한도를 입증하지 않는다. [Workers 메모리와 실행 제한](https://developers.cloudflare.com/workers/platform/limits/)

## 재현 방법

Node.js 22 이상을 준비한 개발자가 이 디렉터리에서 실행한다. 일반 사용자 설치 절차가 아니다.

```powershell
npm ci --ignore-scripts --no-audit --no-fund
node scripts/build.mjs
node --test tests/*.test.mjs
node scripts/check-workerd.mjs
```

`build.mjs`는 고정 패키지 버전을 확인하고 ESM, WASM과 라이선스 고지를 `dist/server`에 작성한다. pako 3.0.2의 low-level inflater를 런타임에 사용한다. cfb 1.2.2는 합성 시험 파일을 만드는 개발 의존성일 뿐 배포 parser가 아니다. Miniflare와 esbuild도 시험·빌드 의존성이지 배포 런타임 의존성이 아니다. Miniflare 5 alpha의 공식 V4 옵션 변환기로 명시적 ESM/WASM 모듈 목록을 전달한다.

로컬 검사는 실제 workerd 엔진 실행 외에 MCP 초기화·정확히 한 도구의 조회, **모의 신원 헤더의 존재 검사**, 빈 인수만 허용하는 호출과 upload 거부를 확인한다. 신원 헤더를 직접 넣은 로컬 검사를 실제 사용자 인증이나 tenant 격리 검증으로 해석하지 않는다.

원격 검사용 `scripts/check-remote.mjs`는 현재 시험 Site에만 접속한다. Site 도구에서 얻은 URL과 단기 서비스 자격을 숨긴 stdin으로 받고 원문이나 자격을 파일·인수·로그에 남기지 않는다. 서비스 자격은 사용자 신원이 아니므로 실제 플러그인 연결 성공을 반환하지 않는다. 이 스크립트를 일반 사용자나 문서 작업용 도구로 노출하지 않는다.

이번 Windows 회귀에서 레코드·컨테이너 합성 검사 162개와 실제 workerd 왕복이 통과했다. 저장소 루트의 고정 HWP 20종도 Python `olefile` reader와 대조해 해제된 스트림 180개, 문단 레코드 비교 60회와 DocInfo 20개가 일치했다. 이를 재현하려면 루트 npm 런타임과 Python native 의존성도 준비한 뒤 루트에서 `node probes/sites-runtime/scripts/check-python-guard.mjs`를 실행한다. 필요하면 `PYTHON`을 해당 venv 실행 파일로 지정한다. 모든 입력은 메모리에서 생성한 합성 문서이며 개인 문서 폴더를 읽지 않는다.

## 배포 경계

Site 원본은 별도 Site checkout에 있고, 해당 checkout의 `.openai/hosting.json`에 실제 `project_id`와 `capabilities: ["mcp"]`를 둔다. 이 시험 소스에는 Site ID나 자격을 넣지 않는다. 검증된 정확한 소스를 Sites 워크플로로 push·포장한 뒤 비공개로 게시했다. 로컬 검사만으로 비공개 접근 경계나 원격 WASM 모듈 전달 성공을 주장하지 않는다.

Windows에서는 워크플로 프로세스에만 Git Bash의 PATH와 `TAR_OPTIONS=--force-local`을 설정해 포장했다. Windows 드라이브 경로가 tar의 원격 대상 구문으로 해석되지 않도록 하기 위한 것이며 시스템 설정을 변경하지 않는다.

현재 고정 결과를 isolate 메모리에 캐시한다. 지속 세션·저장 receipt·멱등성 계약이 아니며 반복 warm 실행, 동시 요청, cold startup의 CPU·메모리 검사를 대신하지 않는다.

## 다음 구현 조건

운영 문서 기능을 열기 전에 아래 검사를 따로 완료한다.

1. 좁은 browser ESM 검사기를 운영 문서의 편집 계약에 연결하고 Python과의 대조·실사용 호환성 검사를 확대한다. 현재 고정 합성 성공과 bounded parser만으로 Python 로컬 경로 전체와 동등하다고 표시하지 않는다.
2. 버전 기반 대상·전체 기존 값·비대상 metadata 검사와 전체 조회 cursor를 포트한다. 동기 WASM은 `Promise.race`만으로 중단할 수 없으므로 실제 자원 한도도 검사한다.
3. upstream binding의 원문 포함 가능 `console.error` 경로를 감사한다. 고정 MCP 오류로 감쌌다는 이유만으로 원문 없는 Worker 로그를 보장하지 않는다.
4. 사용자·문서별 immutable version, 기대 현재 버전에 대한 조건부 갱신, 복구·재시도·삭제 정책과 파일 전달을 실제 저장소에서 검사한다. 로컬 파일 교체나 프로세스 lock을 분산 저장 계약으로 재사용하지 않는다.

이 조건 전에는 `cloud_documents_enabled`, `document_upload_supported`, `independent_preservation_guard_ported`, `storage_contract_verified`, `user_isolation_verified`, `layout_verified`, `total_isolate_memory_measured`를 모두 `false`로 유지한다. 별도 외부 호스팅으로의 변경은 사용자와 확인한다.
