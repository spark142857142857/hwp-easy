<a id="개발-시작"></a>

# 개발 가이드

[프로젝트 개요](../README.md) · [문서 인덱스](README.md) · [아키텍처](architecture.md)

소스를 변경하거나 배포 패키지를 생성할 때 필요한 환경과 검사 명령입니다. 현재 소스·검증 패키지는 **로컬 HWP Easy 0.2.43**입니다. 같은 버전의 앱별 패키지는 공통 실행기를 포함하며 실제 설치 버전은 [프로젝트 상태](project-status.md)에서 구분합니다. 파일 편집 절차는 [사용 가이드](quick-start.md), 실제 설치·호출 결과는 [프로젝트 상태](project-status.md)에 정리합니다.

## 환경과 구성

개발에는 **Node.js 22 이상**, **Python 3.11 이상**이 필요합니다. 문서 실행용 배포본에는 Node 실행 코드·WASM·JS 의존성을 묶으며 Python을 요구하지 않습니다. `@rhwp/core` 0.8.6과 각 lockfile의 고정 의존성을 유지합니다. 엔진 검사에 한글·COM·Wine·GUI가 필요하지 않습니다.

저장소 루트에서 개발 의존성을 설치합니다.

```bash
npm ci --ignore-scripts --no-audit --no-fund
python -m venv .venv
```

Python의 엔진·MCP 회귀 검사에는 플랫폼에 맞는 명령을 사용합니다.

```bash
# Linux / macOS
.venv/bin/python -m pip install -e ".[native,mcp]"
```

```powershell
# Windows PowerShell
.\.venv\Scripts\python.exe -m pip install -e ".[native,mcp]"
```

로컬 실행기 번들의 `esbuild`와 일부 의존성 고지도 `probes/sites-runtime/`을 사용합니다. 로컬 패키지 생성에도 다음 의존성 설치가 필요합니다. 원격 Worker를 배포하거나 MCP를 등록하는 명령은 아닙니다.

```bash
npm --prefix probes/sites-runtime ci --ignore-scripts --no-audit --no-fund
```

이후 Python 검사·압축 명령은 준비한 가상 환경의 Python으로 실행합니다.

## 변경 위치

| 영역 | 소스 |
| --- | --- |
| 공통 엔진 처리·글꼴·스타일 | `src/one_hwp/*.mjs`, `tests/test_rhwp_bridge.mjs` |
| 로컬 실행·같은 파일 저장·복구 | `src/one_hwp/local_runner.mjs`, `local_file.mjs`, `local_*.mjs` |
| 독립 보존 검사 | `probes/sites-runtime/guard/` |
| Codex 패키지와 공통 번들 | `plugins/hwp-easy/`, `scripts/package_local_plugin.mjs`, `scripts/archive_local_plugin.py` |
| Claude Code·Cursor 패키지·설치 검사 | `scripts/package_agent_skills.mjs`, `install_agent_skill.mjs`, `check-agent-packages.mjs` |
| 사용자 안내·요구사항 | `docs/quick-start.md`, `supported-features.md`, `project-status.md`, `PRD.md` |
| 이전 Python MCP | `src/one_hwp/native_*.py` |
| 보관한 원격 엔진·서비스 | `probes/sites-runtime/engine/`, `host/`, `worker/` |
| 보관한 원격 저장·복구 | `probes/sites-runtime/storage/`, `db/`, `drizzle/` |
| 보관한 원격 제출 패키지 | `plugins/archive/hwp-easy-remote-0.1.9/`, `scripts/package_public_plugin.py` |

개인 HWP를 테스트 입력으로 커밋하거나 CI에 올리지 않습니다. 합성 파일은 테스트 코드에서 생성합니다. `testdocs/`는 로컬 문서용이며 기본 읽기 전용입니다.

## 검사

GitHub Actions의 [Source checks](../.github/workflows/checks.yml)는 **수동 실행 전용**입니다. push·pull request마다 자동 실행하지 않으며, GitHub의 **Actions → Source checks → Run workflow** 또는 `gh workflow run checks.yml --ref main`으로 시작합니다. Windows·Linux의 기존 전체 검사 구성은 유지합니다.

전체 CI는 핵심 기능 묶음 완료, 저장·복구 공통 경로 통합, 설치본 갱신·배포 준비 등 주요 단계에서 실행합니다. 작은 수정마다 반복 실행하지 않으며, 작업 중에는 변경 범위에 맞는 로컬 검사로 확인합니다. 단계별 CI 기록에는 실행 대상 커밋과 실제 결과를 남기고, 이전 커밋의 통과 결과를 최신 소스의 통과로 기록하지 않습니다.

Windows/Linux 복합 검사는 소스·기본 패키지와 부동 개체 패키지의 두 작업으로 나눈다. 전체 18개 작업이며 각 실행 명령은 독립 단계여서 앞선 실패 뒤에 다른 명령이 계속 실행되어 오류를 숨기지 않는다. 편집 후보는 `verified_edit_sha256`으로 계획/저장을 대조하고, 파생 미리보기의 성공/시간 초과에 따라 달라질 수 있는 최종 `output_sha256`과 구분한다.

수동 실행의 기본 `scope: all`은 전체 검사를 실행한다. 표 흐름 CI만 재확인할 때는 `scope: table-flow` 또는 `gh workflow run checks.yml --ref main -f scope=table-flow`로 Windows/Linux 표 작업 2개만 실행한다. 표 사이 글·본문 호스트 검사는 `scope: table-text` 또는 `gh workflow run checks.yml --ref main -f scope=table-text`로 관련 Windows/Linux 2개 작업만 실행한다. 좁은 셀·문자 지표는 `scope: table-metrics` 또는 `gh workflow run checks.yml --ref main -f scope=table-metrics`로 관련 2개 작업만 실행한다. 필드·개체 호스트는 `scope: table-controls` 또는 `gh workflow run checks.yml --ref main -f scope=table-controls`로 기존 글/호스트 작업을 재사용해 관련 2개만 실행한다. 각 부분 실행에는 기존 표 소스 회귀도 포함한다. 부분 실행의 성공은 전체 18개 작업 성공과 구분해 기록한다. 기존 표 작업은 패키지 38건과 Windows 정리 시간을 포함해 10분을 허용하며 개별 편집·미리보기 제한은 유지한다.

문서만 변경했을 때도 아래 링크 검사는 로컬에서 실행합니다.

```bash
node scripts/check-repository.mjs
```

공통 엔진을 변경하면 엔진 검사도 실행합니다.

```bash
npm run test:engine
```

`check-repository.mjs`는 Git에 추적되는 Markdown 파일과 링크를 검사합니다. 새 문서는 스테이징한 뒤 실행해야 검사 대상에 포함됩니다. Python 회귀가 오래된 설치본을 읽지 않도록 `one_hwp.__file__`을 확인합니다. 현재 소스 검사는 해당 프로세스의 `PYTHONPATH`를 저장소 `src/`로 지정해 재현할 수 있습니다. [실행 예](code-review-2026-10-18.md#검토테스트-범위)를 참고하세요.

로컬 실행기를 바꾸면 관련 `tests/test_local_*.mjs`와 패키지 검사를 수행합니다. Python 엔진·MCP 회귀 검사의 조건은 [이전 Python 경로의 재현 안내](native-engine.md#테스트-재현과-현재-근거)를 참고하세요. 모의 COM, 실제 WASM 실행, 앱의 실제 호출, 외부 뷰어 비교는 서로 다른 검증으로 기록합니다.

## 클라이언트 패키지 생성과 검증

먼저 공통 Node/WASM 실행기를 한 번 빌드하고, 그 결과로 세 앱의 배포본을 생성합니다.

```bash
node scripts/package_local_plugin.mjs
python scripts/archive_local_plugin.py
node scripts/package_agent_skills.mjs
python scripts/archive_agent_skills.py
```

| 배포 대상 | 생성 ZIP |
| --- | --- |
| Codex | `outputs/plugin-package/hwp-easy-0.2.43.zip` |
| Claude Code | `outputs/agent-packages/hwp-easy-claude-code-0.2.43.zip` |
| Cursor | `outputs/agent-packages/hwp-easy-cursor-0.2.43.zip` |

패키지 생성은 앱 설치나 공개 게시를 수행하지 않습니다. Claude Code·Cursor의 설치 검사와 격리된 폴더에 설치한 실행기의 검증은 다음으로 재현합니다.

```bash
node --test tests/test_agent_skill_install.mjs
node scripts/check-agent-packages.mjs
python scripts/check-installed-plugin.py outputs/agent-client-check/claude-code
python scripts/check-installed-plugin.py outputs/agent-client-check/cursor
```

독립 Python 판독은 합성 HWP 내용·비대상 기록 보존·정확한 복구를 검사합니다. 이 명령이 통과해도 앱의 모델이 스킬을 호출한 결과를 대신하지는 않습니다. 실제 호스트 호출 결과는 [클라이언트 검증](agent-client-skills.md#검증-범위)에 기록합니다.

사용자가 개인 스킬 설치를 요청한 환경에서는 다음 명령을 사용할 수 있습니다. 기본 설치는 기존 폴더가 있으면 거부하며 호스트 설정이나 MCP를 등록하지 않습니다. 업데이트에는 아래 명령의 `--mode update`를 사용합니다. 먼저 새 패키지를 검증하고 기존 폴더 전체를 스킬 검색 경로 밖의 `hwp-easy-install-backups/`에 보관합니다. 같은 패키지는 변경하지 않으며 버전 다운그레이드·변조·연결 경로를 거부합니다.

```bash
node scripts/install_agent_skill.mjs --client claude-code --package outputs/agent-packages/claude-code/hwp-easy
node scripts/install_agent_skill.mjs --client cursor --package outputs/agent-packages/cursor/hwp-easy
```

공개 양식은 고정 원본·출처 해시를 갖춘 별도 입력 폴더에서 `check-local-public-corpus.mjs`와 `check-local-public-corpus.py`로 검사합니다. 개인 문서나 원시 호스트 로그를 공개 릴리스에 포함하지 않습니다.

OpenAI 포털의 기존 MCP 등록은 서버 없는 패키지로 변경할 수 없어, 로컬판에는 별도 식별자 `hwp-easy-local`을 사용합니다. 다음 명령은 검증한 ZIP에서 등록 이름·호출 안내·표시 필드만 조정하고 모든 실행 자원의 바이트 일치를 검사합니다. 업로드·설치·심사 제출을 수행하지 않습니다.

```bash
python scripts/package_directory_plugin.py outputs/plugin-package/hwp-easy-0.2.43.zip outputs/directory-package
```

포털 관측과 남은 차단 항목은 [로컬 디렉터리 등록 기록](local-directory-submission.md)에 정리합니다.

Codex의 로컬 마켓플레이스 준비·설치·설치본 검사는 [Codex 설치 재현](local-plugin-installation.md#개발자가-재현하기)을 따릅니다. 합성 검증 결과와 생성 ZIP은 `outputs/`에 두고 Git에 넣지 않습니다.

## 보관한 원격 경로 검사

아래 명령은 **원격 0.1.9 계열**을 위한 것입니다. 로컬 메인의 설치·사용에는 필요하지 않습니다.

```bash
npm --prefix probes/sites-runtime test
python -m unittest discover -s tests -p test_public_plugin_package.py -v
python scripts/package_public_plugin.py --draft
```

원격 패키지의 `--draft`는 제출 메타데이터가 부족해도 초안 ZIP을 만듭니다. 이 옵션을 빼면 필수 항목 누락을 거부합니다. 포털 검사·OAuth 연결·심사·게시는 별도 작업이며 [이전 원격 출시 기록](public-plugin-release.md)을 따릅니다.

## 변경과 배포

변경 이유·결과·검사 방법을 적고 `feat:`, `fix:`, `docs:` 등 Conventional Commits 형식으로 커밋합니다. 다른 작업의 변경은 유지하며 저장소 관리 방침에 따라 검증한 변경을 `main`에 직접 반영합니다.

GitHub push는 운영 사이트 배포나 플러그인 디렉터리 게시와 별개입니다. 배포는 별도 요청에 따라 진행하고 기존 운영 신원과 D1/R2 바인딩을 유지합니다. 현재 준비 상태는 [프로젝트 상태](project-status.md), 이전 구현은 [문서 인덱스](README.md#보관-자료)에서 찾을 수 있습니다.

### F1 부동 재배치의 로컬 회귀

```powershell
node --test tests/test_local_floating_areas.mjs
node scripts/package_local_plugin.mjs
node scripts/check-local-floating-areas.mjs outputs/local-floating-areas
python scripts/check-local-floating-areas.py outputs/local-floating-areas
```

한글이 있는 Windows에서 신뢰한 합성 파일만 네이티브 확인하려면 `scripts/render-local-reflow-native.py`와 Pillow 환경의 `scripts/check-local-floating-areas-native.py`에 같은 출력 폴더를 전달한다. 단/쪽·일반 셀 배치와 복구 이미지를 검사하며, 중첩 셀 지원 범위는 원시 HWP 기준 좌표로 계산하며 현재 WASM 표시 좌표의 차이를 별도 한계로 반환한다. 이 명령은 실제 앱 플러그인을 설치하거나 전체 CI를 실행하지 않는다. [0.2.33 범위](local-release-0.2.33.md)

### 중첩 셀 기준 좌표 회귀

```powershell
node --test tests/test_local_nested_floating.mjs
node scripts/package_local_plugin.mjs
node scripts/check-local-nested-floating.mjs outputs/local-nested-floating
python scripts/check-local-floating-areas.py outputs/local-nested-floating
```

같은 출력 폴더에 `scripts/render-local-reflow-native.py`와 Pillow 환경의 `scripts/check-local-nested-floating-native.py`를 순서대로 실행하면 실제 안쪽 셀 테두리·상자·글 분리와 복구 픽셀을 확인한다. 제품은 COM 없이 공통 Node/WASM 실행기를 유지한다. [0.2.33 검증](local-release-0.2.33.md)

### 셀·본문·구역 간 부동 재배치

```powershell
node --test tests/test_local_floating_transfer.mjs
node scripts/check-local-floating-transfer.mjs outputs/local-floating-transfer
python scripts/check-local-floating-areas.py outputs/local-floating-transfer
```

검증한 합성 파일의 실제 한글 배치는 같은 출력 폴더에 `scripts/render-local-reflow-native.py`와 Pillow 환경의 `scripts/check-local-floating-transfer-native.py`를 순서대로 적용한다. 원시 레코드 검사는 선택 개체의 두 오프셋·계층 레벨과 호스트 앵커/서식 위치만 허용하고 모든 구역의 비대상 내용·다른 스트림·정확한 복구를 대조한다. 네이티브 글 순서에서 선택 상자의 이동만 제외하며 실제 목적지 충돌과 복구 픽셀을 확인한다. 본문 원점의 엔진/한글 차이는 별도 측정값으로 남긴다.


셀 그림·그룹의 분리 패키지 검사는 다음 명령을 사용합니다. 두 번째 명령은 Node 실행기와 독립적인 OLE/레코드 판독입니다.

```sh
node scripts/check-local-cell-images.mjs outputs/local-cell-images
python scripts/check-local-floating-areas.py outputs/local-cell-images
```

신뢰한 합성 결과에 한해 Windows의 `scripts/render-local-reflow-native.py`, Pillow 환경의 `scripts/check-local-cell-images-native.py`를 같은 폴더에 순서대로 실행하면 실제 셀 테두리·이미지 틀·주변 글·복구 픽셀을 검사합니다. 네이티브 검사는 제품의 한글 설치 의존성을 뜻하지 않습니다.

### 표 높이와 쪽 이어짐

```powershell
node --test tests/test_local_table_reflow.mjs
node scripts/package_local_plugin.mjs
node scripts/check-local-table-reflow.mjs
python scripts/check-local-table-reflow.py
```

신뢰한 합성 결과의 Windows 한글 검사는 `scripts/render-local-table-reflow-native.py outputs/local-table-reflow`와 Pillow 환경의 `scripts/check-local-table-reflow-native.py outputs/local-table-reflow`를 사용한다. 파일을 저장하지 않는 분리된 자동화 API로 모든 시험 줄의 쪽 위치·셀 잉크·후속 본문·꼬리말·복구 픽셀을 대조한다. CI의 한글 없는 검사와 범위를 구분한다. [0.2.35 지원 범위](local-release-0.2.35.md)

0.2.37의 표 사이·뒤쪽 글과 본문 복수 루트 표는 `node scripts/check-local-table-text-flow.mjs`와 `python scripts/check-local-table-text-flow.py`로 검사한다. 독립 reader가 원시 앵커 순서로 문서를 순회해 UTF-16 글·글자 서식·문단 서식과 셀 문단 수·비대상 레코드를 대조한다. 실제 한글 검사는 `scripts/render-local-table-reflow-native.py outputs/local-table-text-flow`와 Pillow 환경의 `scripts/check-local-table-text-flow-native.py outputs/local-table-text-flow`를 사용한다. [문단 분할 계약과 검증](local-release-0.2.37.md)

0.2.36의 정렬 셀·복수 중첩 표 호스트는 `node scripts/check-local-table-hosts.mjs`와 `python scripts/check-local-table-sync.py outputs/local-table-hosts`로 검사한다. 같은 네이티브 스크립트에 `outputs/local-table-hosts`를 전달하면 원본 이미지·복구 픽셀에 더해 메모리에서만 글자 색을 바꾼 검사 이미지로 실제 답변 줄과 형제 표의 표시 순서·비겹침을 확인한다. HWP는 저장하지 않는다. [지원 범위](local-release-0.2.36.md)

0.2.35의 재열기 후 높이 동기화·복잡 꼬리말 검사는 `node scripts/check-local-table-sync.mjs`와 `python scripts/check-local-table-sync.py`를 사용한다. 실제 한글 검사는 같은 두 네이티브 스크립트에 `outputs/local-table-sync`를 넘긴다. 선택한 셀의 글/상속 서식과 비대상 레코드를 독립 대조하고, 꼬리말은 홀짝 적용·쪽 번호 숫자 영역 외의 고정 픽셀을 확인한다.

0.2.38 문자 지표 검사는 `node scripts/check-local-table-metrics.mjs`와 `python scripts/check-local-table-text-flow.py outputs/local-table-metrics`를 사용한다. 실제 한글에서는 `scripts/render-local-table-reflow-native.py outputs/local-table-metrics`와 Pillow 환경의 `scripts/check-local-table-metrics-native.py outputs/local-table-metrics`로 원래 색의 페이지와 각 문자 위치의 실제 줄·셀 프레임을 대조한다. 좁은 셀은 검사용 색 변경도 한글의 재조판을 유발할 수 있어 색 표시를 사용하지 않는다. [지원 경계와 검증](local-release-0.2.38.md)

0.2.39 호스트 필드/개체 검사는 `node scripts/check-local-table-controls.mjs`와 `python scripts/check-local-table-text-flow.py outputs/local-table-controls`를 사용한다. 실제 한글은 `scripts/render-local-table-reflow-native.py outputs/local-table-controls`와 Pillow 환경의 `scripts/check-local-table-text-flow-native.py outputs/local-table-controls`로 필드 값·표시 줄·실제 그림/글상자 프레임·글/표 순서를 대조한다. 새 필드/인라인 개체 검사를 기존 글/본문 호스트 CI 작업에 넣어 전체 기본 작업 수는 18개를 유지한다. [검증 범위](local-release-0.2.39.md)

### 독립 부동 개체와 표 흐름 회귀

```powershell
node --test tests/test_local_table_floating.mjs
node scripts/package_local_plugin.mjs
node scripts/check-local-table-floating.mjs outputs/local-table-floating
python scripts/check-local-table-floating.py outputs/local-table-floating
```

한글이 있는 Windows에서 신뢰한 합성 파일만 `scripts/render-local-table-reflow-native.py`로 렌더링한 뒤 Pillow 환경의 `scripts/check-local-table-floating-native.py`로 검사한다. 원래 그림 픽셀·상자/표 프레임·모든 답변 줄·후속 글과 꼬리말, 입력 해시·복구 픽셀을 대조한다. 관련 수동 CI는 `scope:table-floating`으로 기존 작업의 Windows/Linux 두 실행만 사용한다. 전체 `all`의 18개 실행은 유지한다. [0.2.42 범위](local-release-0.2.42.md)

### 행 높이 축소 검사

```powershell
node --test tests/test_local_table_compact.mjs
node scripts/package_local_plugin.mjs
node scripts/check-local-table-compact.mjs outputs/local-table-compact
python scripts/check-local-table-compact.py outputs/local-table-compact
node scripts/check-local-table-floating.mjs outputs/local-table-compact-floating compact
python scripts/check-local-table-floating.py outputs/local-table-compact-floating
```

한글이 있는 Windows의 신뢰한 합성 파일만 `render-local-table-reflow-native.py`로 렌더링한 뒤, 각각 `check-local-table-compact-native.py`와 `check-local-table-floating-native.py`로 확인한다. 쪽 수 감소뿐 아니라 실제 글·셀/상자 틀·그림·후속 본문·고정 꼬리말과 원본 복구 픽셀을 대조한다. 관련 수동 CI `scope:table-compact`는 기존 Windows/Linux 두 작업을 재사용하며 전체 18개 실행은 별도다. 일반 편집은 저장된 최소 높이를 보존하고, 명시적 `content_fit`만 높이를 재계산한다. [0.2.42 기록](local-release-0.2.42.md)

### F2 마감 회귀

8개 표 패키지 검사(기본 흐름·동기화·호스트·글·문자 지표·필드/개체·부동·축소)의 합계는 110건이다. 공개 고정 카탈로그의 복합 12건과 배치 보완 3건을 더 검사하고, 다음으로 실제 공개 중첩 표의 장문/축소와 안전한 흐름 거부 경계를 확인한다.

```powershell
node scripts/check-local-f2-public.mjs <공개-복합-결과> <새-출력-폴더>
python scripts/check-local-table-sync.py <새-출력-폴더>
```

신뢰한 공개 복사본의 선택적 Windows QA는 `render-local-table-reflow-native.py`, Pillow 환경의 `check-local-table-metrics-native.py`를 사용한다. 공개 원본의 꼬리 본문을 가짜 시험 표식으로 바꾸지 않고 `tail_labels:[]`와 실제 셀 프레임·원래 글 픽셀/커서 줄을 대조한다. 전체 `all` CI는 검사 파일/표 패키지 횟수를 보존하며 부동 사례는 기존 부동 작업, 높이 축소는 문자 지표 작업에 나눠 18개 실행과 시간 제한을 유지한다. [마감 결과/재현](f2-closure-0.2.42.md) · [지원 범위](f2-support-0.2.42.md)

### 일회용 렌더 뷰 검증

`node --test tests/test_local_render_view.mjs`, `node scripts/check-local-render-view.mjs <새-출력-폴더>`, `python scripts/check-local-render-view.py <새-출력-폴더>`로 보정 범위·실제 충돌 보존·원본/이력 무변경·배포 번들의 같은 파일 저장/복구·썸네일/SVG 일치를 확인한다. 렌더 뷰는 내보내기·저장·편집 대상 선택에 재사용하지 않는다. 신뢰한 합성 출력의 네이티브 QA는 `render-local-table-reflow-native.py` 다음 `check-local-table-floating-native.py`를 사용한다. 기존 전체 CI 18개 작업 중 복잡한 개체 작업에 새 검사만 더한다. [0.2.43 기록](local-release-0.2.43.md)
