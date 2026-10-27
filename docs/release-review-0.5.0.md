# HWP Easy 0.5.0 제출 전 검토

[남은 작업](remaining-work.md) | [개인정보처리방침](privacy-policy.md) | [이용약관](terms-of-service.md)

HWP Easy 이름과 기존 GitHub 저장소를 유지합니다. 설명은 실제 제공 기능을 중심으로 고쳤고, 다른 제품의 설치 여부를 비교하는 문구와 가운뎃점을 뺐습니다. 이름이나 설명 중 어떤 부분이 기존 반려의 원인인지는 특정되지 않았으므로 이번 수정이 승인된다는 보장은 없습니다.

현재 PC의 Codex에는 0.5.0을 설치했습니다. 이후 사용자 승인으로 포털 업로드와 자동 검사를 시작했습니다. [포털 결과](portal-check-0.5.0.md)에서 스킬 전용 접수 제한과 진행 중인 스킬 검사를 구분합니다. OpenAI 심사 신청과 디렉터리 게시는 하지 않았습니다. 후속 사용자 요청으로 [GitHub 배포와 설치 도우미](distribution-0.5.0.md)를 별도로 공개했습니다. 정책 두 문서는 OpenAI 제출용 최종 검토가 남아 있습니다.

## 표시 이름

HWP Easy

## 짧은 설명

HWP 파일을 읽고 편집합니다

영문 설명: Read and edit HWP files

제출용 ZIP의 짧은 설명은 포털 글자 수 제한에 맞춰 한국어 한 줄로 넣었습니다. 자세한 설명은 한국어를 먼저 두고 영어를 아래에 두었습니다.

## 자세한 설명

선택한 HWP 파일을 읽고 문서 내용을 수정합니다. 표와 그림, 글자 모양도 지원 범위 안에서 바꿀 수 있습니다. 변경 사항은 같은 파일에 저장하며 저장 전 내용은 복구할 수 있습니다.

파일 처리는 사용 중인 에이전트의 실행 환경에서 이루어집니다. HWP Easy에 문서를 업로드하거나 별도 계정을 만들 필요는 없습니다. 실행 환경에는 파일 접근 권한과 Node.js 22 이상이 필요합니다.

지원 여부는 문서 구조에 따라 달라집니다. 미리보기의 글꼴과 줄바꿈, 쪽 배치는 다른 문서 프로그램에서 보는 결과와 다를 수 있습니다. HWP Easy는 개인 개발자가 제공하는 독립 문서 편집 도구입니다.

Read a selected HWP file and edit its contents. Supported changes include tables, pictures and character formatting. Save changes to the same file and restore the contents from before a save.

Files are processed in your agent's execution environment. No document upload to HWP Easy or separate HWP Easy account is required. The execution environment needs filesystem access and Node.js 22 or later.

Support depends on the document structure. Preview fonts, line breaks and page layout may differ from those in other document applications. HWP Easy is an independent document editing tool provided by an individual developer.

## 제출 파일

업로드할 파일은 **`hwp-easy-local-0.5.0.zip`**입니다. 로컬 설치용 ZIP과 혼동하지 않도록 별도 폴더에 준비했습니다.

- 경로: `outputs/release-0.5.0-20261027/directory/hwp-easy-local-0.5.0.zip`
- 표시 이름: HWP Easy
- 내부 등록 이름: `hwp-easy-local`
- 유형: skills only, desktop execution required
- 게시자 표기: 원석 유. 실제 디렉터리 게시자는 제출 포털에서 선택한 검증된 신원을 따릅니다.
- 제출 ZIP SHA-256: `7c97974491113e7182b9873a80c0b20088fb0f6ef871af07c1e2c290e423e580`

기존 원격 등록과 로컬 제출을 분리하기 위해 내부 등록 이름만 다릅니다. 사용자에게 보이는 이름은 HWP Easy로 유지합니다. 원격 0.1.9 코드와 ZIP은 변경하지 않았습니다.

## 제출 순서

1. 이 문서의 이름과 설명, 개인정보처리방침과 이용약관을 검토합니다. 정책이 확정되면 검토본 표기를 정리합니다.
2. [플러그인 제출 포털](https://platform.openai.com/plugins)을 엽니다. 본인의 검증된 게시자 신원을 선택합니다.
3. 기존 로컬 `hwp-easy-local` 초안이 있으면 그 초안을 사용합니다. 없으면 MCP 서버 없는 skills-only 플러그인으로 준비합니다. 보관 중인 원격 MCP 제출본을 로컬 패키지와 혼동하지 않습니다.
4. 위 제출용 ZIP을 업로드합니다. 표시 이름, 버전 0.5.0, 설명, 정책 링크와 Desktop only 표시를 확인합니다.
5. 자동 검사가 끝나면 실제 결과를 확인합니다. 문제가 있으면 내용을 복사해 수정한 ZIP으로 다시 검사합니다. 로컬 검사 통과만으로 이 단계를 통과한 것으로 처리하지 않습니다.
6. 게시자가 확인해야 하는 약관과 확약을 읽고 심사를 신청합니다. 승인 뒤 공개 게시가 별도로 남습니다.

[공식 제출 안내](https://developers.openai.com/plugins/deploy/submission)와 [데스크톱 전용 스킬 안내](https://developers.openai.com/plugins/deploy/desktop-only)를 기준으로 준비했습니다. 이 패키지는 MCP 서버를 포함하지 않으며 `requires_local_executor:true`를 선언합니다.

<details>
<summary>패키지와 설치 검사 기록</summary>

## 로컬 설치

- 버전 0.5.0, `hwp-easy@hwp-easy`, 설치와 활성 상태 확인
- 설치 캐시의 25개 파일이 로컬 설치 ZIP과 바이트 일치
- 새 호스트의 `skills/list`에서 설치된 스킬 1개 발견, 발견 오류 0개
- `allow_implicit_invocation:false` 유지
- 기본 설치 실행기의 본문과 셀 편집, 같은 파일 저장, 오래된 버전 거부, 무변경 무저장, 정확한 복구와 편집본 재복구 통과
- 기본 저장 결과는 독립 Python 판독도 통과
- 설치 실행기로 회전 그룹 20종의 편집과 같은 파일 저장, 정확한 복구 통과
- 저장 전과 편집 후, 복구 후의 60개 HWP가 이전 실제 한글 검증 파일과 바이트 일치. 해당 파일의 네이티브 결과를 재사용하며 이번에 한글을 다시 실행했다고 기록하지 않음
- 새 사용자 채팅의 실제 모델 호출은 이번 검사에 포함하지 않음
- 이전 설치와 ZIP 보관, HWP Easy 마켓플레이스 참조 외 설정과 다른 플러그인 불변

## 엔진과 배포

실행기와 WASM은 I3를 검증한 0.5.0-dev.1과 같습니다. 기능 회귀 963개와 엔진 회귀 34개, 실제 한글 비교 결과는 [I3 검증 기록](local-release-0.5.0-dev.1.md)을 따릅니다. 그 결과를 이번 버전의 전체 회귀 재실행으로 표시하지 않습니다.

- 로컬 설치 ZIP: `outputs/plugin-package/hwp-easy-0.5.0.zip`
- 로컬 ZIP SHA-256: `59b675ce3ab0184f080c8f44797b3c055ba98f71c0b09955724b3e2923747bb3`
- 실행기 SHA-256: `a98648ea6c4e3be181b40c32c8c3d3597ec67fbde1025c287b6061b2ab0fb173`
- WASM SHA-256: `8000e4ce320b7994dca6bcd58be0c862144c7b805576504e523a420439da658b`

포털용 패키지는 내부 등록 이름과 호출 참조를 바꾸고 짧은 설명을 한국어 한 줄로 제한했습니다. 엔진, 미리보기 자원과 스킬 본문은 로컬 설치 ZIP과 같습니다. 제출용 ZIP을 별도 폴더에 풀어 기본 편집과 같은 파일 저장, 정확한 복구와 독립 판독도 확인했습니다. 지원 범위와 화면 배치의 제한은 유지합니다.

GitHub Actions는 실행하지 않았습니다. 다른 PC 검증은 사용자 요청으로 생략했고 Claude Code와 Cursor 갱신은 보류했습니다. 산출물과 세부 로그는 로컬 `outputs/release-0.5.0-20261027/`에 보관합니다.

</details>
