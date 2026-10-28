# 개발 가이드

[문서](README.md) | [아키텍처](architecture.md) | [검증](verification.md)

개발에는 Node.js 22 이상과 Python 3.11 이상이 필요합니다. 배포한 문서 실행기에는 JS와 WASM 및 의존성을 묶으므로 실행할 때 Python이나 pip를 요구하지 않습니다.

## 환경

저장소 루트에서 의존성을 준비합니다.

```bash
npm ci --ignore-scripts --no-audit --no-fund
python -m venv .venv
```

Linux와 macOS는 `.venv/bin/python`, Windows는 `.venv/Scripts/python.exe`를 사용합니다. 해당 Python으로 `-m pip install -e ".[native,mcp]"`를 실행합니다. 실제 한글 대조를 하는 Windows 개발 환경에만 별도의 COM 의존성이 필요합니다.

이전 원격 서버의 검사를 실행할 때만 [legacy 안내](../legacy/README.md)의 추가 의존성을 설치합니다. 로컬 빌드와 회귀는 루트 의존성으로 실행합니다.

## 변경 위치

| 영역 | 경로 |
| --- | --- |
| 엔진과 로컬 편집 | `src/one_hwp/*.mjs` |
| 공통 판독과 엔진 계약 | `src/one_hwp/guard/`, `src/one_hwp/engine/` |
| 독립 검사 | `scripts/check/independent/` |
| 스킬과 요청 계약 | `plugins/hwp-easy/skills/edit-local-hwp/` |
| 앱별 설치와 복귀 | `packages/hwp-easy/lib/` |
| 빌드와 배포 | `scripts/build/` |
| 배치와 실제 한글 대조 | `scripts/check/native/`, `scripts/render/` |
| 이전 원격 서버 | `legacy/sites-runtime/` |
| 회귀와 합성 입력 | `tests/` |

전체 개발 도구의 역할과 기본 명령은 [scripts 안내](../scripts/README.md)에 정리합니다.

실행 요청 스키마는 [스킬의 요청 참조](../plugins/hwp-easy/skills/edit-local-hwp/references/requests.md), 편집 조건은 [편집 참조](../plugins/hwp-easy/skills/edit-local-hwp/references/editing.md)를 기준으로 관리합니다. 사용자 안내에 내부 요청을 중복해서 옮기지 않습니다.

## 검사

```bash
npm run test:engine
npm run test:structure
node --test tests/test_local_f4.mjs tests/test_local_drawing_render.mjs
node --test tests/test_distribution_install.mjs tests/test_agent_skill_install.mjs tests/test_unified_install.mjs
node scripts/check/check-repository.mjs
```

변경한 기능의 관련 회귀와 실제 패키지 검사를 실행합니다. 공통 비교나 저장처럼 영향이 넓은 변경은 검사 범위를 넓힙니다. 새 문서는 스테이징한 뒤 링크 검사를 실행해야 포함됩니다. 개인 문서는 테스트 입력으로 커밋하거나 CI에 올리지 않습니다.

GitHub Actions는 [Source checks](../.github/workflows/checks.yml)의 수동 실행 전용입니다. **사용자가 허용한 경우에만** 실행하며 push와 버전 변경 자체는 실행 허가가 아닙니다. 허용한 작업에서 `gh workflow run checks.yml --ref main -f scope=all`로 전체 검사를 시작할 수 있습니다. 부분 범위는 워크플로의 `scope` 선택을 따릅니다. 검사 커밋과 실제 결과를 기록합니다.

모의 설치, 실제 CLI 설치, 설치된 실행기, 모델 호출과 외부 프로그램의 배치 대조는 서로 다른 검증입니다. 실제 한글 대조는 개발 QA이며 제품 실행의 필수 조건이 아닙니다.

## 빌드와 배포

메타데이터와 npm 버전을 같이 올리고 공통 실행기를 한 번 빌드합니다.

```bash
node scripts/build/package_local_plugin.mjs
python scripts/build/archive_local_plugin.py
node scripts/build/package_agent_skills.mjs outputs/plugin-package/hwp-easy outputs/agent-packages
python scripts/build/archive_agent_skills.py outputs/agent-packages
node scripts/build/prepare_distribution.mjs outputs/plugin-package/hwp-easy outputs/release-check/marketplace
```

생성 대상은 새 폴더를 사용합니다. 배포 폴더에서 `npm pack --ignore-scripts`로 TGZ를 만들고 별도 경로에 풉니다. 이전 버전의 마켓플레이스를 준비해 신규 설치와 업데이트 및 복귀를 검사합니다.

```bash
node scripts/check/install/check-unified-install.mjs <unpacked-npm-folder> <previous-marketplace> <fresh-report-folder>
python scripts/build/archive_distribution.py <marketplace> <npm-tgz> <plugin-zip> <fresh-assets-folder> --agent-packages outputs/agent-packages
```

앱별 실행기와 WASM 해시를 대조하고 독립 판독으로 같은 파일 저장과 정확한 복구를 확인합니다. 필요하면 `check-installed-plugin.mjs`와 `check-installed-plugin.py`로 현재 설치본도 검사합니다.

검증한 배포본만 `distribution`과 새 릴리스 태그에 게시합니다. npm과 GitHub에 게시한 버전은 덮어써 재사용하지 않습니다. npm 보안 키 인증은 게시자의 터미널이나 공식 사이트에서만 완료하며 대화에 전달하지 않습니다. 게시 응답과 실제 다운로드 가능 시점이 다를 수 있으므로 공개 레지스트리의 파일과 설치도 확인합니다.

실행 자원과 검사 산출물은 `outputs/`에 두고 Git에 넣지 않습니다. 현재 사용하지 않는 검증 사본은 해시를 확인한 로컬 압축 보관으로 정리할 수 있으며 활성 설치, 런타임, 원격 보관본과 복구 자료는 별도로 확인합니다. 이전 경로의 개발 자료는 [보관 문서](archive/README.md)를 따릅니다.
