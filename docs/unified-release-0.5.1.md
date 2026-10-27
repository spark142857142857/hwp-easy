# 0.5.1 통합 배포 검증

[프로젝트 상태](project-status.md) | [설치와 업데이트](distribution.md) | [남은 작업](remaining-work.md)

기준일: **2026년 10월 27일**. Codex, Claude Code와 Cursor를 같은 **0.5.1** 버전으로 정리했습니다. npm 0.5.0은 이미 게시돼 내용을 바꿀 수 없으므로 새 버전을 사용합니다. 기존 0.5.0과 0.2.19 배포 및 원격 0.1.9는 보존합니다.

## 변경 사항

공통 npm 패키지에 `--client codex|claude-code|cursor`를 추가했습니다. 선택한 앱만 설치하거나 갱신합니다. 생략하면 이전 명령과 호환되도록 Codex를 선택합니다. Claude Code와 Cursor 설치에는 Codex CLI가 필요하지 않습니다.

npm에는 공통 플러그인과 엔진을 한 번 포함합니다. 개인 스킬은 설치할 때 같은 파일에서 호출 이름과 명시 호출 정책을 갖춰 생성합니다. GitHub의 앱별 ZIP도 같은 생성 함수를 사용합니다. 앱마다 엔진 소스를 분기하지 않으며 설치된 사본은 독립적으로 관리합니다.

기존 설치는 발견 경로 밖에 보관합니다. 잠금과 설치 직전 재검사, 검증한 후보 게시와 상태 기록, 실패 복원 및 이전 설치 복귀를 제공합니다. 다른 프로세스가 만든 설치나 변경한 파일을 자동으로 덮어쓰지 않습니다. 앱 설정과 MCP 서버를 추가하지 않습니다.

Windows Codex의 LocalAppData 경로가 데스크톱 앱의 실제 경로로 변환될 때 같은 폴더를 다른 설치로 오인하던 문제도 수정했습니다. 폴더 문자열만 비교하던 검사를 실제 파일 시스템 식별 정보 비교로 바꿨고 현재 PC에서 업데이트 성공을 확인했습니다.

## 확인한 결과

| 검사 | 결과 |
| --- | --- |
| 설치 관련 Node 검사 | **34개 통과**. 기존 개인 스킬 보호 17개, Codex 배포 10개, 통합 설치 7개 |
| 마켓플레이스 Python 검사 | **7개 통과**. 해시와 경로, 지침 크기 및 기존 목적지 보호 |
| 최종 TGZ 격리 설치 | **세 앱 통과**. 신규 설치, 0.2.19 업데이트, 이전 버전 복귀와 다시 갱신 |
| 실패와 동시 변경 | 후보 게시 실패 및 상태 기록 실패 시 기존 설치 복원. 동시 생성된 설치와 이전 설치 보존. 변조 백업과 연결 경로 거부 |
| 설치된 실행기 | 본문과 두 문단 셀 편집, 같은 파일 저장과 재읽기, 오래된 해시의 저장 거부, 무변경 무저장, 이력 및 원본과 편집본 복구 통과 |
| 독립 판독 | 별도 Python OLE/레코드 판독으로 요청한 내용과 셀 문단, 비대상 내용과 스트림 및 글꼴 정의 보존, 정확한 원본 복구 확인 |
| 현재 PC 설치 | **세 앱 모두 0.5.1**. Codex의 0.5.0과 두 개인 스킬의 0.2.19 이전 설치 보관 |
| Claude Code 실제 모델 | 설치된 개인 스킬 호출로 본문과 셀 편집, 같은 파일 저장과 재읽기. 별도 호출의 이력 조회 및 정확한 원본 복구와 편집본 보관 확인 |
| Cursor CLI 실제 모델 | 자체 `.cursor` 스킬로 편집과 저장 및 재읽기 통과. 첫 별도 복구 호출은 완료 응답까지 성공. 재편집 후 두 번째 복구도 실행기 성공 결과와 원본 바이트를 확인했으나 CLI 최종 응답은 계정 사용량 제한으로 실패 |
| 배포 파일 | npm **36개 파일**, 마켓플레이스 **37개**, Codex 플러그인 **25개**, 각 개인 스킬 **23개**. 공통 엔진과 배포 파일 대조 |
| 공개 GitHub TGZ의 npx 설치 | npm 사용자 설정과 캐시를 분리한 세 환경에서 공개 다운로드 TGZ로 앱 선택 설치, 설치 실행기의 저장과 복구 및 독립 판독 통과 |
| 공개 npm의 npx 설치 | **세 앱 통과**. `hwp-easy@0.5.1`을 각각 새 캐시와 빈 사용자 설정에서 설치하고 실제 설치 실행기의 편집, 같은 파일 저장 및 복구와 독립 판독 확인 |

테스트 문서는 코드로 만든 합성 HWP입니다. 개인 문서나 인증 정보, 원시 호스트 로그는 공개 자료에 포함하지 않습니다. 첫 Cursor 편집 호출이 다른 앱의 동일 엔진을 사용한 사실을 확인해 자체 `.cursor` 설치 경로로 편집과 복구를 다시 검사했습니다. 마지막 복구는 파일 처리 성공과 CLI 전체 호출 종료를 구분합니다. 사용량 제한 후 추가 모델 호출이나 계정 변경은 하지 않았습니다.

## 공통 엔진

엔진은 `@rhwp/core` **0.8.6**이며 실행 코드와 WASM은 검증한 0.5.0과 바이트가 같습니다. 이번 변경은 설치와 배포 경로입니다.

| 자원 | SHA-256 |
| --- | --- |
| `local-runner.mjs` | `a98648ea6c4e3be181b40c32c8c3d3597ec67fbde1025c287b6061b2ab0fb173` |
| `rhwp_bg.wasm` | `8000e4ce320b7994dca6bcd58be0c862144c7b805576504e523a420439da658b` |
| 최종 npm TGZ | `1a181fa9eddd8c1b187f17880deeb1dc247e2bbc479754fa608f91ee41caacc4` |

합성 원본과 복구본의 SHA-256은 `f9c867d379e3735f6ba012f81da4cf9f7bde2027521c5c822a81b26ce300db70`, 편집본은 `2e345fe4efaf560d69e2a43bed9a763a4b7f72051ca0c106a4e782470b98db82`입니다. 두 셀 문단을 실제 HWP 문단으로 저장했으며 단순 표시 문자열 비교만 수행한 것이 아닙니다.

## 게시 기록

GitHub의 `distribution`을 `b90f148807dfbee2cbdecd02a98ea366d8bb4d22`로 갱신하고 [0.5.1 릴리스](https://github.com/spark142857142857/hwp-easy/releases/tag/hwp-easy-local-v0.5.1)를 공개했습니다. 공개 파일 7개를 다시 내려받아 검증한 배포본과 모두 바이트 일치를 확인했습니다. 기존 0.5.0 공개 이력은 보존합니다.

npm 게시자 보안 키 인증 후 **[hwp-easy@0.5.1](https://www.npmjs.com/package/hwp-easy/v/0.5.1) 공개와 `latest: 0.5.1`을 확인했습니다**. 공개 레지스트리의 TGZ를 인증 없이 내려받아 최종 배포본과 바이트 및 SHA-512 integrity 일치, 파일 36개 일치를 확인했습니다. 이후 빈 npm 사용자 설정과 앱별 새 캐시에서 실제 `npx hwp-easy@0.5.1 install --client <앱>`을 실행했습니다. 세 앱 모두 설치와 설치된 실행기의 편집, 같은 파일 저장 및 정확한 복구와 독립 판독을 통과했습니다.

최초 게시 응답은 HTTP 202와 CLI 종료 코드 0이었고 처리 대기 중 `npm stage list hwp-easy --json`의 추가 승인 항목은 없었습니다. 공개 다운로드 성공을 확인한 뒤 게시 완료로 기록했습니다. [npm 공식 게시 검사 안내](https://github.blog/changelog/2026-07-28-npm-publish-time-malware-scanning-and-dual-use-metadata/)처럼 게시 응답과 실제 다운로드 가능 시점은 다를 수 있습니다. 대기 중 중복 게시나 보안 설정 변경은 하지 않았습니다.

## 검증 경계

GitHub Actions와 computer-use는 사용하지 않았습니다. Cursor IDE 채팅과 다른 PC 및 새 사용자 환경, Cloud 전체 흐름은 이번 검사에서 제외합니다. 현재 0.5.1의 새 Codex 채팅 모델 호출은 수행하지 않았으며 설치 실행기 검사와 구분합니다.

외부 한글 프로그램의 실제 쪽 배치는 이번에 다시 검사하지 않았습니다. 엔진이 같은 이전 [I3 실제 배치](local-release-0.5.0-dev.1.md)와 [0.5.0 설치 검토](release-review-0.5.0.md)의 근거를 유지하며, 모든 HWP 구조와 글꼴의 인쇄 배치가 동일하다고 주장하지 않습니다. 확정 기능 조건은 [지원 기능](supported-features.md)을 따릅니다.

## 개발자 재현

준비된 Node.js 22 이상과 개발 가상 환경에서 실행합니다. 아래 명령은 게시나 현재 사용자 설치를 수행하지 않습니다.

```bash
node --test tests/test_distribution_install.mjs tests/test_agent_skill_install.mjs tests/test_unified_install.mjs
python -m unittest discover -s tests -p test_local_marketplace.py -v
node scripts/package_local_plugin.mjs
python scripts/archive_local_plugin.py
node scripts/package_agent_skills.mjs outputs/plugin-package/hwp-easy outputs/agent-packages
python scripts/archive_agent_skills.py outputs/agent-packages
node scripts/prepare_distribution.mjs outputs/plugin-package/hwp-easy outputs/release-check/marketplace
```

새 배포 폴더에서 `npm pack --ignore-scripts`로 TGZ를 만들고 별도 폴더에 풉니다. 기존 0.2.19 마켓플레이스 폴더와 함께 전체 설치 검사를 실행합니다.

```bash
node scripts/check-unified-install.mjs <unpacked-npm-folder> <old-0.2.19-marketplace> <fresh-report-folder>
python scripts/archive_distribution.py <marketplace> <npm-tgz> <plugin-zip> <fresh-assets-folder> --agent-packages outputs/agent-packages
```

개별 실행 결과와 독립 판독 결과는 보고서 폴더에 남습니다. 모의 설치 실패 검사, 실제 Codex CLI 설치, 설치된 엔진 검사와 실제 앱 모델 호출은 별개 근거로 기록합니다. 앱 모델 호출에는 해당 사용자의 로그인과 이용 권한이 필요합니다.
