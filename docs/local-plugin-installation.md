# HWP Easy 로컬 설치와 검증

2026년 10월 12일 로컬 실행 방식의 **HWP Easy 0.2.15**를 메인으로 선택했다. 패키지 식별자는 `hwp-easy`, 표시 이름은 **HWP Easy**다. 이전 로컬 후보의 실행기와 WASM은 동일하며 원격 MCP를 묶지 않는다. 원격 0.1.9의 세 패키지 파일은 내용 변경 없이 `plugins/archive/hwp-easy-remote-0.1.9/`로 옮겼다.

## 실제 확인한 설치

ZIP을 새로운 영구 로컬 폴더에 풀고 `.agents/plugins/marketplace.json`을 만들었다. Codex의 `plugin marketplace add`와 `plugin add`를 사용했으며 설치 결과는 `hwp-easy@hwp-easy`, 버전 `0.2.15`였다. 이어 `plugin list --marketplace hwp-easy --json`에서 `installed: true`, `enabled: true`를 확인했다.

이는 유지관리자의 Windows Codex에 실제 설치한 결과다. 공개 디렉터리 게시, 다른 계정 설치나 새 Cloud 작업 설치를 완료한 뜻은 아니다. 현재 채팅의 설치 전 스킬 목록은 새 채팅에서 갱신해야 할 수 있다. 새 채팅의 스킬 메뉴에서 **HWP Easy**를 선택하거나 `$edit-local-hwp`로 명시해서 사용한다. 자동 적용 금지 설정은 유지한다.

실행 환경에 파일 접근 권한과 Node.js 22 이상이 필요하다. Codex의 번들 런타임을 사용할 수 있다. HWP 엔진, JS 의존성과 WASM은 설치 패키지에 들어 있으며 문서 처리 시 Python, pip, npm 설치나 HWP Easy 서버·계정·업로드가 필요하지 않다.

## 설치된 실행기의 파일 처리

[검증 스크립트](../scripts/check-installed-plugin.mjs)는 소스 실행기나 빌드 폴더 대신 **Codex가 설치한 캐시 폴더의 실행기**를 호출한다. 개인 문서를 사용하지 않고 한글·공백 경로의 합성 HWP를 생성했다. 설치된 JS와 WASM의 해시가 빌드 명세와 같은지도 확인했다.

| 검사 | 결과 |
| --- | --- |
| 읽기와 저장 전 계획 | 계획 후 원본 바이트와 복구 사본 수가 그대로다. |
| 본문과 여러 줄 셀 답변 | 한 묶음으로 같은 경로에 저장하고 저장 해시와 재읽기 결과를 확인했다. 셀의 두 줄은 실제 HWP 문단이다. |
| 오래된 버전으로 저장 | 충돌을 거부하고 현재 파일과 복구 사본 수를 유지했다. |
| 바뀌지 않는 수정 | 재저장과 새 복구 사본을 만들지 않았다. |
| 이력과 기본 미리보기 | 원본 복구 사본의 해시를 검증하고 SVG를 반환했다. |
| 원본 복구 | 최초 파일과 전체 바이트가 같았다. 복구 직전의 편집본도 보관했다. |
| 복구 취소와 다시 원본 복구 | 보관된 편집본을 정확히 되살린 뒤 원본으로 다시 돌아갔다. |
| 독립 판독 | Python olefile과 독립 HWP 레코드 판독으로 본문, 셀 문단, 비대상 내용·스트림과 기존 글꼴·스타일 정의를 확인했다. |

개인 HWP와 운영 사이트, 원격 저장 문서와 기존 심사 제출은 변경하지 않았다. 설치 명령이 추가한 로컬 플러그인과 마켓플레이스 설정은 사용자 요청에 따른 변경이다. 원격 MCP 등록은 추가하지 않았다.

검증 결과와 합성 파일은 ignored `outputs/installed-plugin-20261012/`에 보관한다. 외부 HWP 뷰어의 최종 쪽 배치와 새 채팅의 스킬 선택 동작은 이번 실행기 검사에서 확인하지 않았다. 기존 문서별 지원 조건은 [로컬 편집 안내](local-file-editing.md)를 따른다.

## 개발자가 재현하기

패키지 생성은 설치와 분리한다.

```powershell
node scripts/package_local_plugin.mjs
python scripts/archive_local_plugin.py
```

출력은 `outputs/plugin-package/hwp-easy/`와 `outputs/plugin-package/hwp-easy-0.2.15.zip`이다. `prepare_local_marketplace.py`는 ZIP의 경로, 런타임 해시와 명시적 호출 정책을 확인한 뒤 **새로운 폴더**에 로컬 마켓플레이스를 준비한다. 기존 설치 폴더는 덮어쓰지 않으며 설치·등록을 수행하지 않는다.

```powershell
python scripts/prepare_local_marketplace.py outputs/plugin-package/hwp-easy-0.2.15.zip '<새 마켓플레이스 경로>'
codex plugin marketplace add '<새 마켓플레이스 경로>' --json
codex plugin add hwp-easy@hwp-easy --json
codex plugin list --marketplace hwp-easy --json
node scripts/check-installed-plugin.mjs '<설치 결과의 installedPath>' outputs/installed-plugin-check
python scripts/check-installed-plugin.py outputs/installed-plugin-check
```

등록·설치 명령은 해당 사용자가 설치를 요청한 경우에만 실행한다. 일반 문서 편집은 이미 설치한 스킬을 선택해서 요청하는 흐름이다. [공식 패키지·마켓플레이스 문서](https://developers.openai.com/plugins/build/plugins)를 참고한다.
