# 한글 없는 HWP 엔진과 로컬 MCP 개발자 안내

상태: 2026년 10월 2일의 1차 개발 구현. 일반 사용자용 설치·연결 안내가 아니다.

이 경로는 **바이너리 HWP 5.x를 읽고, 본문 문단이나 표 셀을 지정해 수정하고, 현재 HWP에 저장**한다. 한글·COM·Wine·GUI를 실행하지 않으며 PDF·DOCX·HWPX를 입력·중간 파일·출력으로 만들지 않는다. 기존 `one-hwp`와 `one-hwp-mcp` COM 경로는 [이전 안내](development.md)에 별도로 보존한다.

## 구현 구조와 지원 범위

`native_mcp.py`가 고정된 도구를 제공하고, `native_service.py`가 버전·대상·조회 범위와 편집 결과를 검사한다. `native_engine.py`는 독립적인 HWP 컨테이너·레코드 검사와 제한 시간 내 Node 실행을 맡는다. 고정된 `rhwp_bridge.mjs`가 `@rhwp/core` 0.8.6의 WASM API로 파싱·편집·저장·SVG 생성을 수행하며, `native_storage.py`가 권한 경로·백업·충돌 검사와 파일 게시를 담당한다. 문서 요청으로 실행 파일, 코드, COM 액션이나 런타임 경로를 지정할 수 없다.

처음부터 새 parser와 writer를 만든 것이 아니라 [rhwp 엔진](https://github.com/edwardkim/rhwp)을 재사용하는 검증·저장 어댑터다. npm 버전은 `package-lock.json`의 무결성 값으로 고정하고 실행 시 버전도 확인한다. npm provenance의 소스는 `e8800c8def63449808a4092798442652ed460552`이며, 같은 번호의 네이티브 Git 태그와 소스가 같다고 가정하지 않는다. 이용·재배포 고지는 [THIRD_PARTY_NOTICES.md](../THIRD_PARTY_NOTICES.md)에 기록한다.

| 기능 | 현재 범위와 제한 |
| --- | --- |
| 입력 | 비암호화 HWP 5.x. FileHeader는 압축 여부 외 플래그를 허용하지 않는다. 암호화·배포 문서·스크립트·DRM 등 보안/선택 기능은 거부한다. |
| 내용 조회 | 본문 문단과 최상위 표 셀 문단. 행·열·병합 span과 표·셀 관계를 반환한다. 긴 단일 문단도 조각으로 끝까지 조회한다. |
| 편집 | 식별한 기존 문단/셀의 전체 텍스트 교체. 대상 내부의 글자 스타일이 균일한 경우만 허용한다. 표를 소유한 본문 문단은 읽기 전용이며 셀을 개별 지정한다. |
| 편집 제한 | 혼합 글자 스타일, 대상 안의 기존 줄바꿈, 새 줄바꿈·제어문자 삽입, 필드, 중첩 표, 머리말·꼬리말, 이미지 편집은 지원하지 않는다. 비기본 스타일 대상을 빈 값으로 만드는 작업도 거부한다. |
| 저장 | 검증 후 현재 HWP 저장이 기본이다. 별도 `output`은 요청한 Save As에만 사용한다. 읽기·검색·계획·미리보기는 저장하지 않는다. |
| 미리보기 | 현재 버전의 0부터 시작하는 페이지 번호로 직접 SVG 반환. 활성 요소·외부 자원 참조를 거부한다. 표시 화면이나 정확한 글꼴·줄바꿈·쪽 나눔 인증은 없다. |
| 연결 | 이 문서 처리 경로는 로컬 stdio MCP만 구현. 별도 Sites 시험은 고정 합성 문서만 처리하며, 운영 문서의 원격 인증·격리·업로드·다운로드·자동 등록은 없다. |

미지원 요소가 있으면 `unsupported`와 조회 범위를 알린다. 조회 가능한 본문을 반환하더라도 전체 문서를 지원한다고 표시하지 않는다. 안전한 보존을 확인할 수 없는 문서는 편집을 거부하고 기존 COM 엔진이나 다른 형식으로 몰래 우회하지 않는다.

현재 기본 처리 한도는 입력 16 MiB, 본문 레코드 압축 해제 합계 64 MiB, 1,000,000개 본문 레코드, 개별 엔진 호출 45초이다. Node에는 256 MiB V8 old-space 한도를 설정한다. 이는 WASM 메모리와 프로세스 전체의 하드 메모리 한도나 운영체제 보안 샌드박스가 아니다. 읽기 응답은 기본 8,000자, 최대 64,000자와 128블록이다. 편집은 한 대상 100,000자, 요청당 최대 100개 작업으로 제한한다. 처리 한도를 넘으면 거부하며 무한 크기 지원을 약속하지 않는다.

공통 모델 검사는 문서당 최대 64구역·4,096블록·본문 및 지원 셀의 UTF-16 text 합계 2,000,000 code units로 제한한다. 스타일 확인은 누적 800,000 코드 포인트 범위에서 수행하고 예산이 부족한 대상은 읽기 전용으로 표시한다. 이는 Node와 browser ESM에서 공유하는 방어적 작업량 한도이며 입력 바이트 한도나 전체 프로세스 메모리 한도를 대신하지 않는다.

## 개발 환경 준비

Node.js 22 이상과 Python 3.11 이상이 필요하다. 아래는 저장소 루트에서 실행할 **개발자용 명령**이며, 실행 환경과 폴더를 승인하는 서버 관리자를 위한 것이다. 사용자에게 Python/pip 설치를 요구하는 완성된 배포물이 아니다.

```powershell
python -m venv .venv
.\.venv\Scripts\python.exe -m pip install -e ".[native,mcp]"
npm ci --ignore-scripts --no-audit --no-fund
```

Linux에서도 같은 소스를 사용하며 Python 실행 파일은 `.venv/bin/python`이다. 의존성을 준비한 이후 문서 처리 코드는 네트워크 요청을 사용하지 않는다. 이 사실을 공개 서비스의 네트워크 차단·인증·격리 검증으로 해석하지 않는다.

wheel에는 Python 코드와 고정 `.mjs` 브리지만 들어 있다. Node 실행 파일, npm 의존성, WASM과 글꼴을 묶은 일반 사용자용 패키지는 아직 없다. 설치된 wheel처럼 브리지와 npm 런타임의 위치가 다르면 서버 관리자가 `HWP_EASY_RUNTIME_DIR`을 `package.json`과 `node_modules`가 있는 절대 경로로 설정한다. Python 라이브러리에서는 `RhwpEngine(runtime_root=...)`도 사용할 수 있다. 문서 도구의 인수로 해당 경로를 바꿀 수는 없다.

## 로컬 MCP 실행

다음은 가상의 문서 폴더 예시다. 허용 폴더는 미리 존재해야 하며 여러 폴더를 각각 지정할 수 있다. 백업 폴더는 서버 관리자가 접근 권한을 보호한 별도 절대 경로로 설정한다.

```powershell
$env:HWP_EASY_RUNTIME_DIR = (Get-Location).Path
.\.venv\Scripts\python.exe -m one_hwp.native_mcp `
  --allow-root "C:\Work\hwp-demo" `
  --allow-root "C:\Work\hwp-templates" `
  --backup-dir "C:\Work\hwp-backups"
```

설치된 console entrypoint는 `hwp-easy-mcp`이다. `--allow-root`와 `--backup-dir`은 서버 실행 설정이지 사용자가 문서를 편집하는 CLI가 아니다. 서버는 표준 입출력 프로토콜로 통신하며 실행·설치만으로 Codex나 Claude 설정을 추가하지 않는다. 문서 편집 요청에는 설치·전역 설정 변경·포트 공개를 자동으로 붙이지 않는다.

경로는 명시적으로 허용한 폴더 안의 절대 `.hwp` 경로여야 한다. 심볼릭 링크·Windows 접합점/재분석 지점·하드링크 별칭과 `..` 경로는 보수적으로 거부한다. 여러 폴더를 허용할 수 있다는 뜻이 PC 전체에 대한 권한을 자동 부여한다는 뜻은 아니다. 이 경로 정책은 운영체제 격리와 클라우드 사용자 권한을 대신하지 않는다.

## 에이전트 도구

| 도구 | 주요 입력 | 역할 |
| --- | --- | --- |
| `hwp_capabilities` | 없음 | 엔진·지원 범위·실행 한도·조회/재시도 상태의 수명 확인 |
| `hwp_read` | `source`, 선택 `expected_sha256`, `cursor`, `max_chars` | 버전과 본문/셀 블록·표 관계·지원 상태를 조회 |
| `hwp_search` | `source`, `expected_sha256`, `query`, 선택 `cursor`, `max_results` | 반복 문구의 위치와 대상 식별자를 구분해 조회 |
| `hwp_plan` | `source`, `expected_sha256`, `operations` | 저장 없이 편집 전제 조건 검사 |
| `hwp_edit` | `source`, `expected_sha256`, `operations`, `request_id`, 선택 `output`, `expected_destination_sha256` | 검증 후 기본 같은 파일 저장, 요청 시 별도 저장 |
| `hwp_preview` | `source`, `expected_sha256`, 선택 `page` | 해당 버전의 직접 SVG 미리보기 |
| `hwp_restore` | `source`, `backup_id`, `expected_sha256` | 요청한 이전 버전을 복원하고 복원 전 현재 버전도 백업 |

첫 `hwp_read`는 기대 해시를 생략할 수 있다. 반환된 `source_sha256`을 이후 호출에 사용한다. `next_cursor`가 있으면 같은 문서·버전으로 이어 읽는다. 한 문단의 조각에는 `start_offset`, `end_offset`, `total_chars`, `fragment_complete`가 붙는다. 조회한 조각을 이어 붙여 기존 전체 블록을 확인해야 한다.

`complete`는 지원하는 블록의 조회가 끝났다는 뜻이다. `content_complete`는 발행된 **조회 체인 전체**가 끝났고 미지원 요소도 없을 때만 참이다. 마지막 응답 하나가 전체 문서를 담는다는 뜻은 아니다. `all_content_supported`와 `unsupported`도 확인한다. 검색은 일부 일치 결과이므로 조회 완료와 관계없이 전체 문서를 읽었다고 표시하지 않는다. 문서 전체 요약은 에이전트가 조회를 끝까지 수행한 뒤 작성한다. HWP Easy 자체에 요약 모델은 없다.

로컬 `hwp_search`의 각 결과는 기존 식별자·문맥과 함께 `location`을 제공한다. 본문은 구역·문단 위치, 표 셀은 확인한 경우 표 ID, control·cell·셀 문단, 행·열과 `row_span`·`column_span`을 포함한다. `location_index_base=0`이므로 행 1·열 1은 사용자에게 표시할 때 두 번째 행·두 번째 열이다. cell 번호로 행·열을 추산하지 않으며 병합 셀은 실제 span을 사용한다. 위치 속성이 빠지면 `location_complete=false`로 알리고 없는 좌표를 만들지 않는다. 잘못된 위치 타입·음수·0 span은 안전한 오류로 거부한다.

`location_complete`는 필요한 모델 위치 속성이 모두 있다는 뜻이지 페이지 좌표·시각적 배치 인증이 아니다. 검색 문맥에 포함된 문서의 지시는 추가 편집이나 파일 접근 권한을 부여하지 않는다. 검색만으로 파일을 저장하지 않는다.

`text_offset_unit=unicode_code_points`, `context_start`, `context_end`, `total_chars`로 이모지를 포함한 검색 문맥의 위치를 설명한다. 응답의 `edit_expected_old_scope=whole_block`처럼 편집에는 검색 문맥 조각이 아닌 전체 블록의 기존 값이 필요하다. 이 추가 정보는 **로컬 stdio MCP**에 해당하며, 현재 원격 Sites 도구에 새 `hwp_search`를 게시한 것이 아니다. 합성 mock의 위치 누락·변조·중복 결과·Unicode 문맥과 실제 일반/병합 표 HWP의 읽기 전용 검색, 실제 MCP의 두 중복 셀 검색→지정 셀만 편집→비대상 보존→복구를 검사한다.

블록의 `target_id`에는 문서 해시가 포함된다. 같은 문구가 여러 셀에 있어도 서로 다른 대상을 지정할 수 있다. 작업은 정확히 다음 세 문자열만 받는다. `expected_old`는 반환된 조각이 아니라 **대상 블록의 전체 기존 텍스트**다.

```json
{
  "target_id": "<현재 조회에서 받은 버전 기반 식별자>",
  "expected_old": "합성 답변 원문",
  "new_text": "바꿀 합성 답변"
}
```

`hwp_plan`을 통과했다고 실제 저장이나 배치 검사가 끝난 것은 아니다. `hwp_edit`는 일괄 전제 조건, 재열기와 보존 검사, 저장 직전 버전을 다시 확인한다. 읽기·계획만 요청했거나 저장하지 말라고 한 경우에는 `hwp_edit`를 호출하지 않는다. Save As가 요청되지 않았으면 `output`을 생략한다. 별도 기존 출력 교체는 그 대상의 최신 `expected_destination_sha256`도 필요하다.

`request_id` 재시도 결과와 커서는 제한된 프로세스 메모리에만 있다. 서버 재시작·캐시 퇴거 후에도 유지되는 멱등성, 인증 토큰이나 세션은 아니다. 저장 후 통신이 끊기면 현재 파일 버전을 읽고 결과를 확인한다. 무조건 새 ID로 같은 작업을 반복하지 않는다. MCP 오류는 고정된 범주·메시지를 사용해 원문과 입력값이 예외에 노출되는 것을 막는다. 원문 조회·변경 계획·SVG는 요청한 클라이언트에 실제 내용을 전달하므로 그 앱의 데이터 처리 조건은 별도 확인해야 한다.

## 보존·저장 검사와 남은 위험

편집 전에 CFB와 FileHeader, 연속된 본문 구역, 압축 해제 한도와 레코드 경계를 검사한다. WASM이 모르는 레코드를 읽은 뒤 아무 경고 없이 저장에서 버리는 사례를 재현했으므로, 엔진 자체의 무손실 보고만 신뢰하지 않는다. 독립 검사에서 미검증 태그와 문단 조회 누락을 알리고 편집을 차단한다.

편집 결과는 다시 열어 목표 값과 비대상 텍스트·표 관계·스타일 참조를 비교한다. Python은 스트림 목록, 비본문 스트림 및 본문의 비대상 레코드 payload·순서·제어 슬롯을 별도로 비교한다. DocInfo의 저장된 커서 위치 12바이트, 미리보기 스트림, 대상 텍스트에서 유도한 길이·스타일 run 위치, 재생성되는 줄 geometry는 제한적으로 예외 처리한다. 이 예외와 좁은 레코드 프로필은 모든 HWP 의미·확장 데이터의 보존 인증이 아니다. 줄 geometry와 미리보기 생성은 배치 인증으로 표시하지 않는다.

저장은 같은 디렉터리의 임시 파일에 쓰고 동기화·바이트 검증한 뒤 직전 버전의 백업과 메타데이터를 준비한다. 현재 버전을 다시 검사하고 기존 파일을 교체한다. 새 출력은 무덮어쓰기 하드링크로 게시하며 지원하지 않는 파일시스템에서 위험한 복사로 우회하지 않는다. 기존 출력 교체도 그 직전 버전을 백업한다. 복원은 백업의 대상 경로·해시와 현재 기대 해시를 확인한다.

아직 남은 제한은 다음과 같다.

- 프로세스 내 저장은 직렬화하지만, 비협조적인 다른 프로그램의 마지막 해시 확인 직후 쓰기까지 원자적 compare-and-swap으로 차단하지 못한다.
- 성공한 저장의 디렉터리 동기화와 신규 출력 임시 파일 정리 경고는 공개 결과의 `warnings`에 포함한다. 저장·백업 실패 경로에서는 남은 임시 파일의 알림과 정리를 모두 보장하지 못한다. 전원 차단·프로세스 강제 종료에서 모든 파일시스템의 복구를 인증하지 않았다.
- POSIX 파일 권한을 보호하되 Windows ACL의 완전한 보존·격리와 원격 사용자별 권한은 별도 출시 검증이 필요하다.
- 백업은 원문과 경로 메타데이터를 포함한다. 자동 만료·삭제·용량 정책은 아직 없다. 신뢰할 수 있는 관리자가 백업 폴더 접근을 보호해야 하며 개인 문서·백업·메타데이터를 Git에 추가하지 않는다.
- 입력 제한, Node 시간 제한과 SVG 검사만으로 적대적 문서의 보안 격리를 주장하지 않는다. 인증되지 않은 원격 서비스로 이 서버를 노출하지 않는다.

## 테스트 재현과 현재 근거

다음 명령은 새 엔진 경로의 실제 합성 HWP 검사를 활성화한다. 기존 COM 스모크는 실행하지 않는다.

```powershell
npm run test:engine
$env:PYTHONPATH = (Join-Path (Get-Location).Path "src")
$env:HWP_EASY_NATIVE_TESTS = "1"
$env:HWP_EASY_RUNTIME_DIR = (Get-Location).Path
.\.venv\Scripts\python.exe -B -m unittest discover -s tests -p "test_*.py" -v
```

Linux에서는 `PYTHONPATH="$PWD/src" HWP_EASY_NATIVE_TESTS=1 HWP_EASY_RUNTIME_DIR="$PWD" .venv/bin/python -B -m unittest discover -s tests -p 'test_*.py' -v`로 실행한다. `PYTHONPATH`는 이미 설치한 이전 wheel이 아니라 현재 수정 중인 소스를 검사하기 위한 설정이다. Python 패키지와 선택 의존성이 해당 venv에 설치돼 있어야 SDK의 별도 stdio 자식 프로세스도 모듈을 찾을 수 있다. opt-in 환경변수가 없으면 실제 WASM 통합만 건너뛰고 모의·경로·검증 회귀는 계속 실행한다.

Node 34개 검사는 합성 HWP 20종의 읽기·무수정 저장·재열기·SVG, 10개 편집 사례 및 4개 미지원/오류 사례로 구성된다. 코퍼스에는 한글, 다국어, emoji, 긴 문단, 빈 값, 반복 문구, 균일 bold, 일반/병합 표와 한 셀의 여러 문단이 포함된다. 혼합 스타일과 머리말은 거부 사례이며, 여러 구역·필드·이미지가 포함된 실사용 양식 전체를 검증한 코퍼스가 아니다.

Python은 경로·백업·저장 실패·버전 충돌·조회 조각·재시도·MCP 메타데이터/오류를 검사한다. 실제 HWP 통합은 읽기·미리보기, 본문과 셀 편집, 보안 플래그 거부, 긴 문단 전체 조회, 기본 저장/Save As/복구, 실제 SDK stdio 왕복과 내부 레코드 손실 거부를 포함한다. 한 독립 `hwp-cli` reader에서도 생성·편집한 합성 HWP 1개의 형식과 본문·셀 값을 확인했다. 20종 전체를 독립 reader나 한글에서 시각 검증한 결과는 아니다.

Windows의 Node 22.17.0/Python 3.13.2와 WSL2 Linux의 Node 22.23.3/Python 3.12.3에서 실제 검사를 통과했다. 두 환경 모두 Node 34개가 통과했다. Windows 전체 Python 회귀는 240개 실행, 실패 0개와 환경별 skip 3개였다. Linux에서는 새 경로의 Python 124개를 실행해 실패 0개, Windows 접합점 전용 skip 1개를 확인했다. 이 숫자는 서로 다른 테스트 범위이며 합산한 호환성 성공률이 아니다.

Python wheel을 빌드해 저장소 전용 venv에 설치한 뒤 소스 경로를 제외한 import, 명시적 npm 런타임 위치, 실제 HWP 읽기·균일 스타일 편집·재열기·SVG도 확인했다. Linux에서도 명시적 런타임 위치로 실제 capabilities를 조회했다. 테스트 의존성은 MCP 1.30.0과 olefile 0.47이었다. Linux 시험은 화면 없는 WSL에서 이루어졌다. 소스를 push한 뒤 [GitHub CI의 Windows·Ubuntu 검사](https://github.com/spark142857142857/hwp-easy/actions/runs/37011081648)도 모두 통과했다. Docker 컨테이너와 운영 문서 경로의 개별 클라이언트 설치 검증은 남아 있다.

별도 [Sites 실행 시험](../probes/sites-runtime/README.md)은 실제 workerd와 비공개 Sites에서 동일 WASM의 합성 HWP 두 사례를 확인했다. 사용자가 설치한 시험용 플러그인의 도구를 Codex Desktop에서 실제 호출하고 성공 결과를 받았다. Node와 browser ESM은 공통 `rhwp_api.mjs`를 사용하며, browser ESM에는 메모리 내 버전·대상·이어 읽기·계획·편집 보존 계약이 있다. 그 위의 개발용 원격 host에는 인증 사용자 범위의 D1/R2 지속 버전 저장·복구 계약도 구현했다. 메모리 엔진 자체가 지속 저장이나 사용자 격리를 제공한다는 뜻은 아니다. 본 로컬 경로와 동등한 운영용 원격 편집 기능으로 설명하지 않는다. 개인 문서의 업로드와 저장은 비활성 상태이며 실제 Codex Cloud·다른 클라이언트 연결과 운영 권한·격리는 미검증이다.

## 로컬 실사용 문서 검사

사용자가 제공하는 HWP는 저장소의 `testdocs/`에 둔다. 폴더 전체를 Git에서 제외하며, 로컬 검사에 사용한 파일을 Site·CI·다른 원격 서비스로 전달하지 않는다. 합성 fixture는 이 폴더와 분리한다.

내부 검사기는 최상위 `.hwp`만 읽어 구조와 미지원 요소 수를 확인한다. 편집·저장하지 않으며 검사 전후 원본 해시가 같은지 확인한다. 선택한 첫 페이지 미리보기도 메모리에서 생성 가능 여부만 확인한 뒤 버린다. 결과는 Git에서 제외되는 `outputs/local-corpus.json`에 쓰고, 파일명·경로·본문·SVG·해시값·upstream 오류 문구를 기록하지 않는다. 이는 적대적인 파일시스템 교체에 대한 OS sandbox나 시각적 배치 인증은 아니다.

개발자용 실행은 아래와 같다. 일반 사용자는 Codex에 로컬 검사 요청을 하면 되며 이 명령을 익힐 필요가 없다.

```powershell
$env:PYTHONPATH = (Join-Path (Get-Location).Path "src")
.\.venv\Scripts\python.exe -B tests\local_corpus.py
# 첫 페이지만 메모리에서 렌더 가능 여부를 확인할 때
.\.venv\Scripts\python.exe -B tests\local_corpus.py --preview
```

빈 폴더·부분 지원·실패는 종료 코드 2를 반환한다. `no_documents`는 호환성 검사 성공이 아니라 검사할 문서가 없다는 뜻이다. 실제 문서 편집 시험은 사용자가 요청한 경우에만 별도 복사본과 복구·검증 조건을 정하고 수행한다.

### 압축 꼬리 호환성

본문과 DocInfo의 raw-DEFLATE 뒤에 **정확히 8바이트이며 해제 결과의 CRC32·길이가 모두 일치하는 꼬리**를 허용한다. [RFC 1952 §2.3.1](https://www.rfc-editor.org/rfc/rfc1952#section-2.3.1)의 little-endian CRC32/ISIZE 구조와 같지만 gzip 헤더는 없다. 모든 HWP 스트림의 표준 형식이라고 일반화하지 않는다.

기존 본문 전용 zero padding 허용은 유지하고 DocInfo에는 적용하지 않는다. 임의 nonzero 꼬리, 잘못된 CRC/길이, 추가 member, 잘린 deflate와 압축 해제 한도 초과는 거부한다. CRC 검사가 안전한 편집·인증·레코드 보존을 대체하지 않는다. 이 변형의 실제 합성 HWP로 조회·본문/셀 편집·저장·재열기·비대상 보존·원본 복구를 검사하며 browser ESM에도 같은 규칙을 적용한다. 개인 문서별 결과는 ignored 보고서에만 보관한다.

## 다음 제품 단계

메모리 내 버전·편집 계약과 개발용 D1/R2 지속 저장·복구는 합성 HWP로 연결해 검증했다. 다음 단계는 실제 자원 한도, OAuth 사용자 격리, 클라이언트 파일 입력·HWP 회수, 운영 보관·삭제와 원문 없는 로그, 실제 Codex Cloud·Dots 연결을 검증하는 것이다. [원격 저장 계약](durable-storage.md)과 [클라이언트 완료 조건](codex-cloud.md)을 따르며 합성 성공을 운영 지원으로 표시하지 않는다. 일반 사용자가 명령 없이 연결할 배포물은 이 조건을 통과한 뒤 만든다. 로컬 stdio 서버에 HTTP transport만 켜서 원격 제품으로 배포하지 않는다.
