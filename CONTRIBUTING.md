# 기여 안내

HWP Easy는 일반 사용자가 에이전트에 한글 없는 HWP 작업을 맡길 수 있도록 만드는 프로젝트입니다. 먼저 [AGENTS.md](AGENTS.md), [PRD](docs/PRD.md), [새 엔진 개발자 안내](docs/native-engine.md)를 확인하세요. [이전 COM 안내](docs/development.md)와 [Windows 배포안](docs/distribution-plan.md)은 보존된 이전 경로의 자료입니다.

## 변경의 기준

- 기본은 HWP 읽기·국소 편집·현재 HWP 저장입니다. 다른 이름으로 저장은 사용자 요청에만 수행합니다. 새 제품의 입력·중간 파일·출력에 PDF/DOCX/HWPX를 추가하지 않습니다.
- 허가한 같은 파일 저장은 검증·기대 버전·이전 버전 복구로 보호합니다. 무관한 기존 출력이나 다른 작업자의 변경은 덮어쓰지 않습니다. 기존 COM 경로의 새 출력 전용 동작은 보존합니다.
- 개인 스킬은 명시 호출 전용이며 `allow_implicit_invocation: false`를 유지합니다.
- 설치·MCP 등록·전역 설정·레지스트리 변경을 문서 편집 요청에 자동으로 붙이지 않습니다.
- 설치 프로그램·GUI·플러그인이 계획 단계라면 구현 또는 배포 완료로 문서화하지 않습니다.

## 커밋 메시지

[Conventional Commits 1.0.0](https://www.conventionalcommits.org/en/v1.0.0/) 형식을 사용합니다. 제목은 `type(scope): summary` 형태이며 scope는 필요할 때만 붙입니다.

| type | 용도 |
| --- | --- |
| `feat` | 새 기능 |
| `fix` | 동작 오류 수정 |
| `docs` | 문서 변경 |
| `test` | 테스트 추가·수정 |
| `build` | 빌드·의존성·배포 구성 |
| `chore` | 기타 유지보수 |

제목 예시입니다. 실행할 명령이나 완료된 기능 목록이 아닙니다.

```text
feat(core): add guarded native field edits
fix(worker): retain safe cleanup warnings
docs: explain installer availability
test(mcp): cover stdio transport failures
build: prepare reproducible wheel metadata
```

코드, 테스트, 문서, 빌드 변경은 검토할 수 있는 의미 있는 단위로 묶습니다. 서로 무관한 변경을 한 커밋에 합치지 않습니다. 호환성을 깨는 변경은 제목의 `!` 또는 `BREAKING CHANGE:` 설명으로 드러내고 영향을 설명합니다.

## 테스트와 보고

새 경로의 실행법은 [새 엔진 안내](docs/native-engine.md)를 따릅니다. 모의 회귀, 실제 WASM HWP, 이전 한글 COM 및 출력물의 시각 검토를 구분해 결과와 미검증 범위를 보고하세요. 모의 COM이나 MCP 연결 성공만으로 HWP 편집·서식 보존을 입증했다고 하지 않습니다.

실제 엔진 시험에는 코드가 생성한 합성 문서만 사용합니다. Node 테스트와 opt-in Python native 테스트는 한글을 실행하지 않습니다. `native_smoke.py` 등의 이전 COM 스모크는 별도로 선택해 실행합니다. 문제 재현에 개인 문서를 쓰지 마세요. PR에는 변경 목적, 수행한 테스트, 기존 설정·문서에 미치는 영향과 남은 제한을 적습니다.

## 저장소에 넣지 않는 것

실제 지원서·이력서·개인 문서와 그 화면·로그, 사용자 설정 백업, 토큰·비밀값, 한글 엔진, 보안 DLL, 한컴 매뉴얼을 커밋하지 않습니다. 생성된 설치 파일·wheel·네이티브 출력물도 소스 테스트 데이터처럼 추가하지 않습니다.

개인 세션의 인증 재시도·배포 일지·문서별 검사 결과는 ignored `docs/local/` 또는 `outputs/`에 보관합니다. 제품 PRD·개발자 안내·API/저장 계약·외부 라이선스 고지는 Git에 유지하며, 이를 통째로 무시하지 않습니다. 합성 HWP는 테스트 코드에서 생성합니다. `.gitignore`는 이미 추적 중인 파일이나 과거 Git 기록을 제거하지 않으므로 민감한 자료가 실제로 커밋되면 별도로 처리해야 합니다.

런타임·라이브러리·설치 파일을 묶어 배포할 때는 각 구성요소의 이용·재배포 조건을 확인해야 합니다. 한글 자동화의 이용 조건은 [한컴 공식 안내](https://developer.hancom.com/hwpautomation)를 따르며, 이 저장소에 코드를 기여하거나 공개하는 것과 한컴 엔진·DLL을 배포할 권한은 별개입니다.
