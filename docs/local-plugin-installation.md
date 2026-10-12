# HWP Easy 로컬 설치와 검증

[프로젝트 소개](../README.md) · [문서 안내](README.md) · [현재 상태](project-status.md)

이 문서는 **Codex용 로컬 플러그인의 실제 설치 기록과 개발자 재현 절차**입니다. 현재 소스·생성 패키지는 0.2.18이고, 실제 Codex에 설치해 확인한 HWP Easy는 0.2.17입니다. Claude Code·Cursor의 0.2.18 설치는 [별도 안내](agent-client-skills.md)를 따릅니다.

일반 사용자는 [처음 사용하기](quick-start.md)에서 파일 지정·편집·저장·복구를 시작하세요. 공개 다운로드와 다른 사용자의 설치 준비 상태는 [현재 상태](project-status.md)에서 확인합니다.

본문: [실제 설치](#실제-확인한-설치) · [설치본 파일 처리](#설치된-실행기의-파일-처리) · [개발자 재현](#개발자가-재현하기)

2026년 10월 12일 로컬 실행 방식의 **HWP Easy 0.2.15**를 메인으로 선택했다. 패키지 식별자는 `hwp-easy`, 표시 이름은 **HWP Easy**다. 이전 로컬 후보의 실행기와 WASM은 동일하며 원격 MCP를 묶지 않는다. 원격 0.1.9의 세 패키지 파일은 내용 변경 없이 `plugins/archive/hwp-easy-remote-0.1.9/`로 옮겼다.

## 실제 확인한 설치

Codex용 **0.2.17 설치본**을 정식 CLI 절차로 설치·활성 확인했다. 8,000바이트를 넘던 스킬 본문을 6,282바이트로 줄이고 기존 상세 지침은 참조 파일에 모두 보존했다. 설치된 21개 파일과 ZIP을 대조하고 명시적 선택 후 본문 전체 전달을 확인했다. 실행기·WASM은 0.2.16과 동일하며, 설치 실행기의 합성 파일 수정·같은 파일 저장·복구와 독립 Python 판독을 다시 통과했다. 기본 목록 숨김은 자동 호출 금지 설정에 따른 정상 동작이다. [호출 진단](local-skill-discovery.md)

후속 메인 **0.2.16**도 새 영구 폴더의 ZIP을 정식 CLI로 설치했고 `installed:true`, `enabled:true`를 확인했다. 같은 이름의 로컬 마켓플레이스 경로 갱신은 기존 등록을 제거하고 새 경로를 등록한 뒤 같은 플러그인을 설치하는 순서로 수행했다. 이전 0.2.15 패키지와 원격 보관본은 유지했다. 설치된 0.2.16 실행기의 파일 처리와 독립 판독도 통과했다. [후속 품질 검증과 남은 항목](local-plugin-quality.md)

ZIP을 새로운 영구 로컬 폴더에 풀고 `.agents/plugins/marketplace.json`을 만들었다. Codex의 `plugin marketplace add`와 `plugin add`를 사용했으며 설치 결과는 `hwp-easy@hwp-easy`, 버전 `0.2.15`였다. 이어 `plugin list --marketplace hwp-easy --json`에서 `installed: true`, `enabled: true`를 확인했다.

이는 유지관리자의 Windows Codex에 실제 설치한 결과다. 공개 디렉터리 게시, 다른 계정 설치나 새 Cloud 작업 설치를 완료한 뜻은 아니다. 후속 진단에서 기본 스킬 목록의 누락은 자동 호출 금지에 따른 정상 동작임을 확인했다. 공식 발견 목록에는 활성 스킬이 있고 정식 CLI 메뉴에서도 표시되며 선택 후 설치된 본문이 주입된다. 사용자가 제공한 화면에서 데스크톱 검색 결과와 입력창의 선택된 항목을 확인했다. 실제 전송·문서 실행은 별도 확인이 필요하다. 설치된 정식 이름은 `$hwp-easy:edit-local-hwp`이며 자동 적용 금지 설정을 유지한다. [발견·호출 진단과 검증 범위](local-skill-discovery.md)

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

검증 결과와 합성 파일은 ignored `outputs/installed-plugin-20261012/`에 보관한다. 외부 HWP 뷰어의 최종 쪽 배치와 새 채팅의 스킬 선택 동작은 이번 실행기 검사에서 확인하지 않았다. 현재 사용자 지원 조건은 [지원 기능](supported-features.md), 기능별 검사 근거는 [로컬 편집 상세](local-file-editing.md)를 따른다.

## 개발자가 재현하기

아래는 현재 소스에서 **0.2.18 패키지를 생성·설치·검사하는 절차**다. 이 절차를 적은 것만으로 Codex 0.2.18 실제 설치를 완료했다는 뜻은 아니다. [개발 환경](developer-guide.md#환경과-구성)을 먼저 준비하며 패키지 생성은 설치와 분리한다.

```powershell
node scripts/package_local_plugin.mjs
python scripts/archive_local_plugin.py
```

출력은 `outputs/plugin-package/hwp-easy/`와 `outputs/plugin-package/hwp-easy-0.2.18.zip`이다. `prepare_local_marketplace.py`는 ZIP의 경로, 런타임 해시와 명시적 호출 정책을 확인한 뒤 **새로운 폴더**에 로컬 마켓플레이스를 준비한다. 기존 설치 폴더는 덮어쓰지 않으며 설치·등록을 수행하지 않는다.

```powershell
python scripts/prepare_local_marketplace.py outputs/plugin-package/hwp-easy-0.2.18.zip '<새 마켓플레이스 경로>'
codex plugin marketplace add '<새 마켓플레이스 경로>' --json
codex plugin add hwp-easy@hwp-easy --json
codex plugin list --marketplace hwp-easy --json
node scripts/check-installed-plugin.mjs '<설치 결과의 installedPath>' outputs/installed-plugin-check
python scripts/check-installed-plugin.py outputs/installed-plugin-check
```

등록·설치 명령은 해당 사용자가 설치를 요청한 경우에만 실행한다. 일반 문서 편집은 이미 설치한 스킬을 선택해서 요청하는 흐름이다. [공식 패키지·마켓플레이스 문서](https://developers.openai.com/plugins/build/plugins)를 참고한다.
