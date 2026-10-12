# 개발 시작

소스를 실행하거나 변경할 때 필요한 환경과 검사 명령을 정리했습니다. 일반 사용자의 플러그인 설치 방법은 [공개 출시 준비](public-plugin-release.md)에서 다룹니다.

## 환경과 구성

Node.js **22 이상**과 Python **3.11 이상**을 사용합니다. `@rhwp/core` 0.8.6과 각 lockfile의 고정 의존성을 유지합니다. 새 엔진의 실제 HWP 검사에는 한글, COM, Wine, GUI가 필요하지 않습니다.

Linux와 macOS에서는 저장소 루트에서 다음을 실행합니다.

```bash
python -m venv .venv
.venv/bin/python -m pip install -e ".[native,mcp]"
npm ci --ignore-scripts --no-audit --no-fund
```

Windows PowerShell에서는 Python 실행 경로를 바꿉니다.

```powershell
python -m venv .venv
.\.venv\Scripts\python.exe -m pip install -e ".[native,mcp]"
npm ci --ignore-scripts --no-audit --no-fund
```

원격 Worker를 변경할 때는 `probes/sites-runtime/`에서도 `npm ci --ignore-scripts --no-audit --no-fund`를 실행합니다. 개발 의존성만 설치하며 MCP 등록이나 운영 배포는 하지 않습니다.

## 변경 위치

| 작업 | 먼저 볼 위치 |
| --- | --- |
| 엔진 공통 처리, 언어별 글꼴, 스타일 | `src/one_hwp/*.mjs`와 `tests/test_rhwp_bridge.mjs` |
| 로컬 Python MCP, 안전한 파일 저장 | `src/one_hwp/native_*.py` |
| 원격 편집, 독립 보존 검사 | `probes/sites-runtime/engine/`와 `guard/` |
| MCP, 사용자 신원, 업로드, 브라우저 보기 | `probes/sites-runtime/host/`와 `worker/` |
| D1/R2 버전, 복구, 삭제 | `probes/sites-runtime/storage/`, `db/`, `drizzle/` |
| 공개 플러그인 | `plugins/hwp-easy/`와 `scripts/package_public_plugin.py` |
| 제품 범위, 사용 안내 | `docs/PRD.md`, `docs/quick-start.md` |

실제 개인 HWP는 테스트 입력으로 커밋하거나 CI에 올리지 않습니다. 합성 파일은 테스트 코드에서 생성합니다. `testdocs/`는 사용자가 제공한 로컬 문서용이며 기본 읽기 전용입니다.

## 검사

먼저 문서 링크와 개인 파일 제외 규칙을 확인하고 공통 엔진 검사를 실행합니다.

```bash
node scripts/check-repository.mjs
npm run test:engine
```

Python 엔진과 MCP 통합 검사의 실행 조건은 [로컬 엔진 테스트](native-engine.md#테스트-재현과-현재-근거)에 있습니다. 모의 COM 테스트, 실제 WASM 실행, 외부 뷰어 비교는 각각 따로 기록합니다. CI는 Linux와 Windows에서 공통 엔진, Python 회귀, Worker 검사를 실행합니다.

원격 변경에는 해당 디렉터리에서 전체 Worker 검사를 수행합니다.

```bash
cd probes/sites-runtime
npm test
```

공개 패키지는 저장소 루트에서 다음으로 검사합니다.

```bash
python -m unittest discover -s tests -p test_public_plugin_package.py -v
python scripts/package_public_plugin.py --draft
```

`--draft`는 제출 메타데이터가 아직 부족해도 초안 ZIP을 만듭니다. 이 옵션을 빼면 필수 항목의 누락을 거부합니다. 생성한 ZIP의 포털 검사와 OAuth 연결, 심사, 게시는 별도로 진행해야 합니다.

## 변경과 배포

변경 이유와 결과, 검사 방법을 적고 `feat:`, `fix:`, `docs:` 등 Conventional Commits 형식으로 커밋합니다. 다른 작업의 변경은 유지합니다. 현재 저장소 관리 방침에 따라 검증한 변경은 `main`에 직접 반영할 수 있습니다.

GitHub에 코드를 push해도 운영 사이트나 플러그인 디렉터리에 자동 배포되지는 않습니다. 배포는 별도로 요청받았을 때 진행하고 기존 운영 신원과 D1/R2 바인딩을 유지합니다. [구조 설명](architecture.md)과 [공개 출시 준비](public-plugin-release.md)를 참고하세요.
