# HWP Easy 로컬 설치와 검증

[프로젝트 개요](../README.md) · [문서 인덱스](README.md) · [프로젝트 상태](project-status.md)

일반 설치는 [설치와 업데이트](distribution.md)를 따릅니다. 현재 세 앱의 설치는 **0.5.1**이며 최신 신규 설치, 업데이트와 실패 복구는 [통합 배포 검증](unified-release-0.5.1.md)에 기록합니다. 아래 0.5.0과 이전 버전의 검사는 당시 이력입니다.

이 문서는 Codex용 로컬 플러그인의 이전 설치 기록과 개발자 재현 절차입니다. 0.5.0 준비 단계에서 현재 PC 설치를 **0.5.0**으로 갱신했습니다. 파일 25개 일치와 새 호스트 스킬 발견, 기본 저장과 복구 및 회전 그룹 20종을 확인했습니다. 이번 검증은 새 사용자 채팅의 모델 호출을 포함하지 않습니다. [당시 기록](release-review-0.5.0.md)이며 당시 Claude Code와 Cursor는 0.2.19를 유지했습니다.

파일 지정·편집·저장·복구 절차는 [사용 가이드](quick-start.md)에 정리합니다. 공개 다운로드와 다른 사용자의 설치 검증 상태는 [프로젝트 상태](project-status.md)를 따릅니다.

목차: [실제 설치](#실제-확인한-설치) · [설치본 파일 처리](#설치된-실행기의-파일-처리) · [개발자 재현](#개발자가-재현하기)

2026년 10월 12일 로컬 실행 방식의 **HWP Easy 0.2.15**를 메인으로 선택했다. 패키지 식별자는 `hwp-easy`, 표시 이름은 **HWP Easy**다. 이전 로컬 후보의 실행기와 WASM은 동일하며 원격 MCP를 묶지 않는다. 원격 0.1.9의 세 패키지 파일은 내용 변경 없이 `plugins/archive/hwp-easy-remote-0.1.9/`로 옮겼다.

## 실제 확인한 설치

0.5.0 ZIP의 25개 파일과 설치 캐시가 일치하며 설치와 활성 상태를 확인했습니다. 설치된 실행기로 편집과 같은 파일 저장, 정확한 복구를 검사했습니다. I3의 20종도 설치된 실행기에서 통과했고, 생성한 HWP 60개가 이전 실제 한글 검증 파일과 바이트 일치했습니다. 기존 설치와 ZIP을 보관했습니다. 현재 공개 다운로드는 [0.5.0](https://github.com/spark142857142857/hwp-easy/releases/tag/hwp-easy-local-v0.5.0)입니다. OpenAI 공개 디렉터리 게시나 다른 PC 검증을 완료한 것은 아닙니다.

## 이전 설치 기록

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

당시 0.2.51 설치와 새 채팅의 결과 및 합성 파일은 ignored `outputs/codex-0.2.51-20261027/`에 보관합니다. 설치 실행기의 별도 파일 검사와 새 채팅의 실제 모델 검사를 구분합니다. 후속 네이티브 검사는 한컴 자동화 API와 저장한 이미지로 확인했으며 computer-use는 0회입니다. 이는 해당 합성 문서의 확인 결과이며 임의 문서의 인쇄 배치 인증은 아닙니다. [검증 기록](local-install-0.2.51.md)을 따릅니다.

## 개발자가 재현하기

아래는 **이미 검증한 0.2.51 ZIP을 재사용**하는 설치 준비·검사 절차입니다. 이번 갱신에서는 ZIP/실행기를 다시 생성하지 않았습니다. [기록된 해시](local-install-0.2.51.md#자원과-근거)를 먼저 대조합니다. 새 빌드는 [개발 환경](developer-guide.md#환경과-구성)에서 별도로 다룹니다. 이는 당시 0.2.51 설치를 재현하는 기록이며 현재 배포본의 설치는 [설치 안내](distribution.md)를 따릅니다.

`prepare_local_marketplace.py`는 ZIP 경로·런타임 해시·명시 호출 정책을 검사하고 새로운 영구 폴더를 준비합니다. 기존 폴더는 덮어쓰지 않으며 그 자체로 등록/설치하지 않습니다.

```powershell
python scripts/prepare_local_marketplace.py outputs/plugin-package/hwp-easy-0.2.51.zip '<새 영구 마켓플레이스 경로>'
# 같은 이름의 등록이 있으면 이전 경로·설치본을 보관한 뒤 참조만 교체합니다.
# codex plugin marketplace remove hwp-easy --json
codex plugin marketplace add '<새 영구 마켓플레이스 경로>' --json
codex plugin add hwp-easy@hwp-easy --json
codex plugin list --marketplace hwp-easy --json
node scripts/check-installed-plugin.mjs '<설치 결과의 installedPath>' outputs/installed-plugin-check
python scripts/check-installed-plugin.py outputs/installed-plugin-check
```

등록·설치 명령은 해당 사용자가 설치를 요청한 경우에만 실행한다. 일반 문서 편집은 이미 설치한 스킬을 선택해서 요청하는 흐름이다. [공식 패키지·마켓플레이스 문서](https://developers.openai.com/plugins/build/plugins)를 참고한다.
