# 기여 안내

HWP Easy는 일반 Windows 사용자를 위한 프로젝트입니다. 먼저 [AGENTS.md](AGENTS.md), [개발자 안내](docs/development.md), [배포 계획](docs/distribution-plan.md)을 확인하세요.

## 변경의 기준

- 기본 문서 작업은 HWP 읽기·최소 수정·새 HWP 저장입니다. PDF/DOCX 생성은 명시적인 선택으로 유지합니다.
- 원본과 기존 출력 파일, 다른 작업자의 변경을 보존합니다.
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

실행 방법은 [개발자 안내](docs/development.md)를 따릅니다. 일반 회귀 테스트, 실제 한글 엔진 테스트, 출력물의 시각 검토를 구분해 결과와 미검증 범위를 보고하세요. 모의 COM이나 CI 통과만으로 네이티브 편집·서식 보존을 입증했다고 하지 않습니다.

네이티브 테스트는 명시적으로 실행하며 코드가 생성하는 합성 문서만 사용합니다. 문제를 재현하려면 개인 문서 대신 작은 합성 사례를 만드세요. PR에는 변경 목적, 수행한 테스트, 기존 설정·문서에 미치는 영향과 남은 제한을 적습니다.

## 저장소에 넣지 않는 것

실제 지원서·이력서·개인 문서와 그 화면·로그, 사용자 설정 백업, 토큰·비밀값, 한글 엔진, 보안 DLL, 한컴 매뉴얼을 커밋하지 않습니다. 생성된 설치 파일·wheel·네이티브 출력물도 소스 테스트 데이터처럼 추가하지 않습니다.

런타임·라이브러리·설치 파일을 묶어 배포할 때는 각 구성요소의 이용·재배포 조건을 확인해야 합니다. 한글 자동화의 이용 조건은 [한컴 공식 안내](https://developer.hancom.com/hwpautomation)를 따르며, 이 저장소에 코드를 기여하거나 공개하는 것과 한컴 엔진·DLL을 배포할 권한은 별개입니다.
