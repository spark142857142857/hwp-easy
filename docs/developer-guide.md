# 개발 시작

이 문서는 소스 실행·검증을 위한 개발자 안내입니다. 일반 사용자의 플러그인 설치는 [공개 출시 절차](public-plugin-release.md)가 완료된 뒤 제공하며, 사용자에게 Python·npm 설치를 요구하지 않습니다.

## 환경과 구성

Node.js **22 이상**과 Python **3.11 이상**을 사용합니다. `@rhwp/core` 0.8.6과 각 lockfile의 고정 의존성을 유지합니다. 새 엔진의 실제 HWP 검사에는 한글·COM·Wine·GUI가 필요하지 않습니다.

Linux·macOS에서는 저장소 루트에서 다음을 실행합니다.

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

원격 Worker를 변경할 때는 `probes/sites-runtime/`에서도 `npm ci --ignore-scripts --no-audit --no-fund`를 실행합니다. 이 설치는 개발 의존성 준비이며 플러그인·MCP 자동 등록이나 운영 배포를 수행하지 않습니다.

## 변경 위치

| 작업 | 먼저 볼 위치 |
| --- | --- |
| 엔진 공통 처리·언어별 글꼴·스타일 | `src/one_hwp/*.mjs`와 `tests/test_rhwp_bridge.mjs` |
| 로컬 Python MCP·안전한 파일 저장 | `src/one_hwp/native_*.py` |
| 원격 편집·독립 보존 검사 | `probes/sites-runtime/engine/`와 `guard/` |
| MCP·사용자 신원·업로드·브라우저 보기 | `probes/sites-runtime/host/`와 `worker/` |
| D1/R2 버전·복구·삭제 | `probes/sites-runtime/storage/`, `db/`, `drizzle/` |
| 공개 플러그인 | `plugins/hwp-easy/`와 `scripts/package_public_plugin.py` |
| 제품 범위·사용 안내 | `docs/PRD.md`, `docs/quick-start.md` |

실제 개인 HWP는 테스트 입력으로 커밋하거나 CI에 올리지 않습니다. 합성 파일은 테스트 코드에서 생성합니다. `testdocs/`는 사용자가 제공한 로컬 문서용이며 기본 읽기 전용입니다.

## 검사

저장소 링크·개인 파일 제외 규칙과 실제 공통 엔진을 검사합니다.

```bash
node scripts/check-repository.mjs
npm run test:engine
```

Python의 실제 엔진·MCP 통합 검사는 [로컬 엔진 테스트](native-engine.md#테스트-재현과-현재-근거)의 opt-in 환경을 사용합니다. 모의 COM 테스트와 실제 WASM 검사, 외부 뷰어 비교 결과를 구분합니다. CI는 Linux·Windows에서 공통 엔진, Python 회귀와 Worker 검사를 수행합니다.

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

이 명령은 불완전한 제출용 ZIP을 초안으로 생성합니다. `--draft`가 없으면 필수 제출 메타데이터 누락을 거부합니다. 포털 검사·실제 OAuth·심사·게시 성공을 대신하지 않습니다.

## 변경과 배포

PR에는 문제·결과·검증과 지원 범위를 적고 [기여 안내](../CONTRIBUTING.md)의 Conventional Commits를 사용합니다. 작업 중 다른 변경을 되돌리지 않습니다. 저장소 관리자는 현재 합의에 따라 검증한 변경을 `main`에 직접 반영할 수 있으며, 외부 기여자는 fork와 PR을 사용합니다.

GitHub 소스 공개·push와 운영 Sites 배포·사용자 접근 변경·플러그인 디렉터리 게시를 각각 구분합니다. 운영 저장소 신원과 D1/R2 바인딩을 재생성하지 않으며, 별도로 요청받은 배포만 진행합니다. [구조 설명](architecture.md)과 [공개 출시 준비](public-plugin-release.md)를 참고하세요.
