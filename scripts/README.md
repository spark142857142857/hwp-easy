# 개발 도구

[개발 가이드](../docs/developer-guide.md) | [아키텍처](../docs/architecture.md)

명령은 별도 안내가 없으면 저장소 루트에서 실행합니다. 앱에 설치되는 실행기는 `src/one_hwp/local_runner.mjs`이며, 이 폴더는 개발과 검증을 위한 도구입니다.

| 경로 | 역할 |
| --- | --- |
| `build/` | 플러그인과 앱별 스킬 빌드, 마켓플레이스 준비와 ZIP 생성 |
| `install/` | 공통 설치 도우미를 호출하는 개발용 진입점 |
| `check/install/` | 설치 보호, 패키지 검사와 설치된 실행기 검증 |
| `check/runtime/` | 합성 HWP를 통한 편집과 배치 검사 |
| `check/independent/` | Python OLE 판독과 JS/Python 결과 대조 |
| `check/native/` | 실제 한글에서 얻은 배치와 이미지 대조 |
| `check/check-repository.mjs` | 문서 링크와 공개 파일 제외 규칙 검사 |
| `render/` | SVG 및 개발 QA용 한글 렌더링 |
| `lib/` | 빌드 라이선스와 검사에 쓰는 공통 도구 |

## 기본 명령

```bash
npm run test:engine
npm run test:structure
node scripts/build/package_local_plugin.mjs
node scripts/check/install/check-local-plugin.mjs
node scripts/check/check-repository.mjs
```

검사 이름은 기능별로 유지합니다. 예를 들어 `check/runtime/check-local-f4.mjs`로 합성 결과를 만든 뒤 `check/independent/check-local-f4.py`로 독립 판독합니다. 결과 폴더는 새 ignored 경로를 지정합니다. 실제 한글과 Pillow가 필요한 도구는 개발 환경의 별도 QA이며 일반 실행의 의존성이 아닙니다.

이전 Worker와 서버 검사는 [보관 구현](../legacy/README.md)에 있습니다. 공통 엔진과 판독 코드는 `src/one_hwp/engine/`과 `src/one_hwp/guard/`에서 관리합니다.
