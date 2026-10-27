# HWP Easy 0.5.0 배포 검증

[설치와 업데이트](distribution.md) | [프로젝트 상태](project-status.md) | [남은 작업](remaining-work.md)

2026년 10월 27일, OpenAI 공개 디렉터리 접수와 독립적인 GitHub 배포 경로를 추가했습니다. npm 설치 도우미도 같은 플러그인과 엔진을 포함합니다. 이번 작업에서 엔진이나 편집 동작은 변경하지 않았습니다.

## 배포 상태

| 대상 | 상태 |
| --- | --- |
| GitHub 배포 브랜치 | `distribution`, 커밋 `05680a808b83b10213e3f947c2228cf3d421bc84` 공개 |
| 고정 릴리스 | [HWP Easy 0.5.0](https://github.com/spark142857142857/hwp-easy/releases/tag/hwp-easy-local-v0.5.0), 같은 배포 커밋을 태그로 고정 |
| 다운로드 | 플러그인 ZIP, 마켓플레이스 ZIP, 설치 도우미 TGZ와 명세, SHA256SUMS 제공 |
| npm 레지스트리 | 패키지 생성과 실제 설치 검사 완료. 최초 게시 요청은 게시자 2FA 필요 오류로 거부됐으며 본인 인증 대기 |
| OpenAI 공개 디렉터리 | 기존 스킬 전용 접수 제한과 별도. 새 심사 신청이나 게시 없음 |

로그인 없이 GitHub 배포 파일 4개를 다시 내려받아 해시를 대조했습니다. 다운로드 파일에 개인 HWP, 인증 정보나 사용자 설정은 포함하지 않았습니다.

## 실제로 확인한 항목

| 검사 | 결과 |
| --- | --- |
| 설치 도우미 회귀 | 9개 통과. 신규 설치, 중복 설치, 업데이트, 복귀, 실패 복구, 변조 및 서버 설정 거부, 잠금과 링크 경로 검사 |
| 기존 ZIP 마켓플레이스 준비 회귀 | 7개 통과. 기존 폴더 보존, 경로와 해시 검사, 프롬프트 크기와 필수 참조 검사 유지 |
| 실제 Codex CLI 신규 설치 | 별도 `CODEX_HOME`에서 0.5.0 설치와 25개 파일 일치 확인 |
| 실제 구버전 업데이트 | 보관한 0.2.19에서 0.5.0 설치, 이전 버전 보관과 복귀 후 다시 0.5.0 복귀 확인 |
| 실패 복구 | 실제 CLI 호출 중 새 플러그인 설치에 한 차례 오류를 주입. 기존 0.2.19 등록과 실행 파일 복구 확인 |
| 설정 보존 | 검사 환경의 무관한 Codex 설정 유지. 현재 사용 중인 Codex 설정과 설치본은 변경하지 않음 |
| npm TGZ 검사 | 33개 파일과 모든 바이트 대조. TGZ를 풀어 같은 실제 CLI 설치 검사를 다시 통과 |
| npm 캐시와 분리 | 설치 후 npm 패키지 원본을 사용할 수 없게 한 상태에서도 영구 등록과 설치 파일 유지 |
| 실제 npm exec | 인증 없이 받은 공개 TGZ를 npm 10.9.2로 실행해 별도 Codex 환경에 설치하고 HWP 저장, 복구와 독립 판독 확인 |
| GitHub 마켓플레이스 | 공개 `distribution` 브랜치를 실제 Codex CLI로 등록, 설치와 갱신. 캐시의 25개 파일 해시 일치 |
| 공개 ZIP 수동 설치 | 공개 마켓플레이스 ZIP을 다시 받아 풀고 별도 Codex 환경에 설치. 캐시의 25개 파일 해시 일치 |
| HWP 파일 처리 | 신규 및 업데이트 설치본과 GitHub 설치본으로 합성 본문, 여러 줄 표 셀 편집과 같은 파일 저장, 재읽기, 오래된 버전 거부, 무변경 무저장 확인 |
| 복구와 독립 판독 | 원본 전체 바이트 복구, 편집본 재복구와 다시 원본 복귀. 별도 Python OLE 및 레코드 판독으로 내용과 비대상 스트림 보존 확인 |

## 실행 자원

배포 플러그인의 25개 파일은 기존 검증한 0.5.0 ZIP과 바이트 전체가 같습니다. Git의 줄바꿈 변환으로 파일이 달라지지 않도록 배포 브랜치에서 원본 바이트를 유지합니다.

| 파일 | SHA-256 |
| --- | --- |
| `hwp-easy-0.5.0.zip` | `59b675ce3ab0184f080c8f44797b3c055ba98f71c0b09955724b3e2923747bb3` |
| `hwp-easy-marketplace-0.5.0.zip` | `f32e7f38cc83d4a1c6396c3386879fbf4a1a0f4f036d5041a812b1fd455683f4` |
| `hwp-easy-0.5.0.tgz` | `092430046f3202f7f4c740b4588209b212dbb8e2db1353c348afcf323fc7ab49` |
| `local-runner.mjs` | `a98648ea6c4e3be181b40c32c8c3d3597ec67fbde1025c287b6061b2ab0fb173` |
| `rhwp_bg.wasm` | `8000e4ce320b7994dca6bcd58be0c862144c7b805576504e523a420439da658b` |

## 검증 경계

이번 검사는 유지관리자 Windows의 별도 설정 폴더에서 수행했습니다. 다른 PC, 새 사용자 계정이나 Linux 및 macOS의 실제 설치 성공으로 기록하지 않습니다. 새 채팅의 모델 호출과 외부 HWP 프로그램의 쪽 배치를 다시 검사하지 않았습니다. 엔진이 같다는 해시 근거와 [기존 I3 배치 검증](local-release-0.5.0-dev.1.md)을 유지합니다.

Claude Code와 Cursor는 0.2.19 그대로이며 사용자 요청 전까지 갱신하지 않습니다. 원격 0.1.9도 보관합니다. GitHub Actions, computer-use와 새 채팅 생성은 이번 작업에서 실행하지 않았습니다.

실제 npm 실행 중 PowerShell의 `npm.ps1`이 추가 도우미 옵션을 소비하는 경우를 확인해 Windows 추가 옵션 예시는 `npm.cmd`로 안내합니다. 존재하지 않는 `CODEX_HOME`은 Codex CLI가 거부하므로 별도 검사 폴더를 먼저 생성했습니다. 기본 설치는 초기 실행한 Codex의 환경을 사용합니다. 두 실패를 성공으로 합산하지 않았으며 조건을 맞춘 재검사의 결과를 위에 기록합니다.

## 개발자 재현

검증한 플러그인 폴더와 새 출력 경로를 지정합니다. 배포 준비 명령은 설치나 외부 게시를 수행하지 않습니다.

```bash
node --test tests/test_distribution_install.mjs
node scripts/prepare_distribution.mjs outputs/plugin-package/hwp-easy outputs/distribution-check/marketplace
```

생성한 폴더에서 `npm pack --ignore-scripts`로 TGZ를 만듭니다. `archive_distribution.py`는 원래 플러그인 ZIP, 배포 폴더와 TGZ의 전체 파일을 대조한 뒤 새 릴리스 폴더와 SHA256SUMS를 생성합니다. 구버전 마켓플레이스가 준비돼 있으면 다음으로 실제 CLI를 검사합니다.

```bash
node scripts/check-distribution-install.mjs <생성한-npm-패키지-폴더> <보관한-0.2.19-마켓플레이스> <새-검사-출력-폴더>
```

실행 기록은 ignored `outputs/distribution-0.5.0-20261027/`의 `real-cli-check/verification.json`, `packed-cli-check/verification.json`, `github-install.json`, `github-document/verification.json`, `public-download.json`에 보관합니다. 공개 문서에는 비공개 설정 원문과 개인 문서를 복사하지 않습니다.
