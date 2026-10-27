<a id="claude-code와-cursor에서-hwp-easy-사용하기"></a>

# Claude Code·Cursor 설치 가이드

[프로젝트 개요](../README.md) · [문서 인덱스](README.md) · [사용 가이드](quick-start.md)

HWP Easy **0.5.1**은 Claude Code와 Cursor에서 Codex와 같은 로컬 엔진과 기능 범위를 제공합니다. Node.js 22 이상과 파일 접근 권한이 필요하며 HWP Easy 서버나 Codex CLI는 필요하지 않습니다. 에이전트 로그인과 모델 이용 조건은 각 앱을 따릅니다.

## 설치와 호출

```bash
npx hwp-easy@0.5.1 install --client claude-code
npx hwp-easy@0.5.1 install --client cursor
```

사용하는 앱의 명령 하나를 실행하고 새 대화에서 `/hwp-easy`를 호출합니다. 설치 위치는 각각 `~/.claude/skills/hwp-easy`와 `~/.cursor/skills/hwp-easy`입니다. Windows의 `~`는 사용자 프로필 폴더입니다. ZIP 수동 설치와 다른 위치 지정은 [설치 안내](distribution.md)를 따릅니다.

> /hwp-easy C:\문서\지원서.hwp의 지원 동기 칸을 “지역사회 문제를 해결하는 경험을 쌓고 싶습니다.”로 채우고 같은 파일에 저장해줘. 다른 칸은 유지해줘.

스킬은 호출한 작업에만 적용됩니다. `disable-model-invocation: true`와 `allow_implicit_invocation: false`를 유지합니다. 설명이나 설치 요청만으로 문서를 수정하지 않습니다. [Claude Code 공식 안내](https://code.claude.com/docs/en/skills), [Cursor 공식 안내](https://cursor.com/docs/skills)

## 업데이트

이미 설치했다면 위 명령의 `install`을 `update`로 바꿉니다. `status`는 설치 버전을 확인하고 `rollback`은 보관한 이전 스킬로 돌아갑니다. 앱 이름과 설치 경로를 계속 같게 지정합니다. 이전 설치는 검색 경로 밖에 보관하며 실패 시 복원합니다. [백업 위치와 복귀](distribution.md#업데이트와-복귀)

## 저장과 복구

검사를 통과한 편집은 지정한 **같은 파일에 저장**하고, 이전 바이트는 파일 옆의 `.hwp-easy-backups`에 보관합니다. 다른 작업이 파일을 바꾸면 충돌을 알리며, 실제 변화가 없으면 저장과 백업을 만들지 않습니다.

파일 지정과 수정 요청, 저장 결과 확인, 이력 조회와 복구 예시는 [공통 사용 안내](quick-start.md)를 따릅니다. Windows·WSL·첨부 사본은 서로 다른 파일 환경일 수 있으므로 접근 가능한 실제 경로를 지정합니다. 문서별 편집 조건은 [지원 기능과 제한](supported-features.md)에 정리했습니다.

<a id="구조와-검증-범위"></a>

## 실행 구조

앱마다 엔진을 분기하지 않습니다. `plugins/hwp-easy/`의 지침과 한 번 생성한 Node/WASM 빌드로 세 앱용 배포본을 만듭니다. 앱별 차이는 호출 이름, 명시적 호출 설정과 배포 대상 기록입니다. 실행기와 WASM의 SHA-256은 세 배포본에서 같습니다. 의존성도 번들에 포함되므로 문서 실행에 Python이나 pip가 필요하지 않습니다. [전체 구조](architecture.md)

## 검증 범위

기준일: **2026년 10월 27일**. 두 앱의 실제 개인 스킬을 0.2.19에서 **0.5.1**로 업데이트했습니다.

| 확인한 흐름 | 결과 |
| --- | --- |
| 신규 설치와 업데이트 | 최종 TGZ로 두 앱의 신규 설치, 0.2.19 업데이트, 이전 설치 복귀와 다시 갱신 통과 |
| 실제 모델 호출 | Windows Claude Code와 Cursor CLI에서 `/hwp-easy`로 설치 실행기를 사용해 본문과 셀 두 문단 편집, 같은 파일 저장과 재읽기, 별도 호출의 원본 복구 확인 |
| 독립 판독 | Python OLE/레코드 판독으로 요청한 내용, 비대상 내용과 서식 보존 및 원본 바이트의 정확한 복구 확인 |
| 설치 보호 | 잠금, 변조와 연결 경로 거부, 실패 시 복원, 동시 변경 보존 검사 |
| 공통 엔진 | 세 앱 실행기와 WASM 해시 일치. 엔진 코드는 0.5.0과 동일 |

Cursor의 마지막 복구는 파일 저장과 독립 판독은 통과했으나 최종 CLI 응답에서 계정 사용량 제한이 발생했습니다. 전체 호출 종료 성공과 파일 복구 성공을 구분합니다.

계정 인증과 개인 문서는 배포본에 포함하지 않습니다. Cursor IDE 채팅, 다른 PC와 현재 버전의 새 Codex 채팅 모델 호출은 이번 검사 범위에서 제외합니다. 외부 뷰어의 쪽 배치를 이번에 다시 인증하지 않았습니다. [상세 근거와 제한](unified-release-0.5.1.md)

이전 0.2.18 실제 호출과 0.2.19 설치 결과는 [당시 검증](local-release-0.2.19.md)에 보관합니다.

## 개발자 재현

공통 빌드, 앱별 패키지 생성, 격리 설치·실행 검사와 독립 판독 명령은 [개발 시작 → 클라이언트 패키지 생성과 검증](developer-guide.md#클라이언트-패키지-생성과-검증)에 모았습니다. 일반 문서 편집은 설치된 스킬을 호출해서 요청합니다.

## English

HWP Easy 0.5.1 uses one bundled local engine across Codex, Claude Code and Cursor. Install with `npx hwp-easy@0.5.1 install --client claude-code` or `--client cursor`, restart the app and explicitly invoke `/hwp-easy`. Node.js 22+ and filesystem access are required; these two targets do not require Codex CLI or an HWP Easy server.

Use `update`, `status` and `rollback` with the same client selection. Previous installations are retained outside skill discovery. Actual Windows CLI model calls edited, saved, reread and restored synthetic HWP files through installed 0.5.1 runners. Independent readers verified content preservation and exact original bytes. See the [verification report](unified-release-0.5.1.md) for evidence and limits. Cursor IDE chat and other-PC checks remain excluded.
