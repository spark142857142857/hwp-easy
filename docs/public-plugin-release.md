# HWP Easy 공개 플러그인 출시 준비

[문서 안내](README.md) · [현재 상태](project-status.md) · [보관 패키지](../plugins/archive/README.md)

본문: [당시 확인한 상태](#현재-확인한-상태) · [패키지 검사](#준비한-패키지와-검사) · [심사·게시 기록](#심사-제출과-게시-준비)

**보관 기록 · 2026년 10월 12일:** 원격 0.1.9는 보관용으로 전환했다. 현재 메인은 로컬 HWP Easy 0.2.18이며 [현재 상태](project-status.md)와 [실제 Codex 설치 기록](local-plugin-installation.md)을 따른다. 아래 포털·OAuth·Sites 항목은 기존 원격 경로의 기록이다. 이번 정리로 운영 사이트, 저장 문서나 기존 제출 상태를 변경하지 않았다.

2026년 10월 10일 공개 플러그인 배포를 목표로 정했다. 사용자가 ChatGPT나 Codex의 디렉터리에서 HWP Easy를 찾아 설치할 수 있어야 한다. 지인 초대나 소유자 전용 사이트의 업데이트만으로 배포가 끝난 것은 아니다.

Dots는 이번 범위에서 제외했다. 전체 플랫폼 백업과 재해 복원, 외부 키 보관은 후순위로 두었다.

## 현재 확인한 상태

- **심사 접수 완료:** 2026년 10월 10일 23:43 KST에 HWP Easy 상세 화면의 **0.1.9 · In review**, **Configured / Not published**를 확인했다. 사용자가 최종 여섯 약관, 확약에 동의한 뒤 Submit을 한 번 눌렀다. 다음 단계는 심사 결과 확인과 승인 후 게시다. 추가 유료 서버, 운영 배포, 암호 공유는 없었다.
- 운영 사이트는 버전 53, 환경 revision 9다. 도메인 확인을 위해 URL 접근을 `public`으로 전환했으며 문서, 업로드, 진단은 사용자 인증을 요구한다. 공개 접속의 19개 검사에서 익명 요청과 위조 신원 헤더의 거부를 확인했다. 기존 소유자 문서와 버전을 공개 예제로 사용하지 않았다.
- Sites는 `public` 접근으로 전환할 권한을 제공한다. 이는 URL 접근 대상 설정이며 플러그인 디렉터리 게시와 별도이다.
- 플랫폼이 만든 기존 Sites 플러그인은 비공개 연결이다. 공개 ZIP에는 이 연결의 `.app.json` ID를 재사용하지 않고 실제 HTTPS `/mcp` 주소와 OAuth resource를 선언한다. 기존 연결과 사용자 저장소의 신원, 바인딩을 유지한다.
- 사용자가 개인 신원 인증을 마쳤고 OpenAI Platform에서 **Verified**를 확인했다. 검증된 Individual 신원과 정책 URL을 반영한 초안의 메타데이터, 도메인 검사를 완료했다. 공개 출시 초안 0.1.8에서는 사용자가 승인한 현재 계정으로 실제 인증, 콜백, 13개 도구 검색을 통과했고 **Authorized / Configured / No findings in the latest MCP scan**을 확인했다. 이후 0.1.9의 심사 자료를 제출했으며 심사 승인, 게시는 미완료다.
- 사용자가 GitHub 저장소를 공개하고 문서 구조를 정리하도록 승인했다. README와 Issues를 공개 홈페이지, 지원 URL로 지정한다. 실제 익명 접근을 확인한 뒤 제출 자료로 사용하며, 개인정보, 약관 초안을 확정 정책으로 대신하지 않는다.

공식 공개 경로는 [패키지 준비](https://developers.openai.com/plugins/build/plugins) → [제출 포털의 신원 인증, ZIP 업로드, 연결 검사, 심사, 게시](https://developers.openai.com/plugins/deploy/submission)이다. 공개 패키지의 홈페이지, 지원, 개인정보, 약관 URL은 실제로 접근 가능해야 하며, 게시자 신원과 일치해야 한다. [플러그인 가이드라인](https://developers.openai.com/plugins/plugin-guidelines)의 개인정보와 MCP 요구사항도 따른다.

## 준비한 패키지와 검사

`plugins/archive/hwp-easy-remote-0.1.9/`는 공식 제출 문서가 지원하는 Codex 호환 `.codex-plugin/plugin.json`, `.mcp.json`, SVG 아이콘으로 된 MCP 전용 초안이다. Agent Plugins 1.0.0의 실제 MCP JSON Schema는 OpenAI 문서가 설명하는 서버별 OAuth `extensions`를 추가 속성으로 거부해, 초안을 호환 형식으로 준비했다. 실제 포털의 최초 업로드는 필수 `interface.developerName` 누락으로 거부됐고, 검증된 게시자 이름을 반영한 ZIP은 초안으로 수락됐다.

개인 스킬, hooks, 비공개 등록 App ID, 토큰, 클라이언트 시크릿, 개인 문서를 포함하지 않는다. 실제 `/mcp` URL과 정확한 OAuth resource를 유지하고, 미확인 grant, client ID, scope, token endpoint 인증 방법을 만들지 않는다. 기본 영문 소개와 한국어 번역에는 파일, 텍스트 한도, PC 원본과 원격 저장의 차이, 서식, 인증 갱신의 제한을 명시했다. `author.name`과 `interface.developerName`은 선택한 검증 신원과 일치한다.

홈페이지, 지원은 공개 GitHub 저장소와 Issues이며 확정한 개인정보, 약관 URL도 반영했다. 0.1.9에는 아래의 익명 다운로드 가능한 합성 녹화 URL을 반영했다.

다섯 가지 긍정 시나리오는 기능 조회, 전체 읽기, 무저장 계획, 저장, 다운로드, 이전 버전 복구다. 0.1.9의 세 가지 부정 시나리오는 틀린 원문 가드, 미지원 형식 변환, 줄바꿈이 든 전체 변경 묶음의 거부다. 다른 사용자 문서 접근 시나리오는 실제 두 계정 검증을 후순위로 둔 사용자 결정에 따라 교체했다. 사용자별 보호를 바꾸거나 두 계정 검증을 완료했다고 표시하는 변경은 아니다.

이것은 **심사용 시나리오 초안이며 전용 심사 계정으로 실행 완료한 기록이 아니다**. 기존 한 계정의 합성 검증과 혼동하지 않는다. 심사 데이터는 공개된 합성 파일만 사용한다. 두 번째 사례의 `file_attachment_urls`에 실제 fixture URL을 넣었고, 세 번째 사례는 첫 표 0행, 1열의 원문과 치환 문구를 명시한다.

0.1.8에서 완료한 현재 계정 OAuth 연결을 유지한 채 0.1.9의 업로드와 메타데이터 No findings를 확인했다.

개발자는 `python scripts/package_public_plugin.py --portable`로 root `plugin.json`, `mcp.json`, SVG의 ZIP을 만든다. 미완성 메타데이터로 준비할 때만 `--draft`를 쓴다. `--portable` 없이 실행하면 원래 Codex 호환 형식을 유지한다. 변환은 포털에서 연결에 성공한 `$schema`, `streamable-http` 선언과 한국어 메타데이터를 보존한다.

패키징은 정확히 세 파일만 허용하고 시크릿, 비공개 App 매핑, headers, hooks, symlink, 아이콘 외부 참조를 거부한다. 실제 Sites ID와 해당 resource에서 연결을 통과한 `provided / none` 선언만 허용하며 ID가 없는 이전 초안은 계속 미완료로 판정한다. 녹화 URL을 반영한 현재 소스는 패키지 메타데이터 검사를 통과한다. 심사자 자격 증명은 별도의 보안 포털 항목이므로 이 검사로 완료 여부를 인증하지 않는다. 구조, ZIP 검사는 실제 포털 검사, 두 계정 검증, 심사 승인이나 게시를 대신하지 않는다.

이 명령은 일반 사용자의 설치 방법이 아니다.

초기 준비에서 패키지 누출 방지 Python 8개, Node 529개와 로컬 Worker 회귀 검사가 통과했다. 실제 로컬 compiled workerd에서 익명, 부분 신원, 과도한 길이, 서비스 접근 헤더만 있는 진단을 401로 거부했고, 익명 저장 진단 후 D1/R2가 비어 있음을 확인했다. 정상 합성 신원으로 기존 엔진, 저장 진단과 문서 회귀 검사는 계속 통과했다. 이 결과는 모의 헤더를 쓴 로컬 검사이며 실제 OAuth 두 계정을 인증하지 않는다.

이 보호를 운영 버전 52에 반영했고 배포 성공을 확인했다. 비공개 운영 사이트에서 10개 HTTP 검사를 실행했다. 사용자 신원 없는 문서, 진단, MCP 실행과 위조 신원 헤더는 모두 401로 거부됐으며, MCP 초기화, 도구 목록은 메타데이터로 반환됐다. 환경 revision 8과 기존 비공개 접근은 유지했다. 공개 audience와 실제 두 OAuth 계정은 미검증이다.

이후 Windows CI에서 동시 저장, 읽기 검사가 `UND_ERR_SOCKET`으로 한 차례 실패했다. 동일 검사의 로컬 Windows 실행과 다음 GitHub CI의 Linux와 Windows 네 작업은 통과했지만, 최초 연결 종료의 원인을 확정하거나 재발 불가로 보장하지 않는다.

## 버전 53의 도메인 확인과 공개 접속 검사

Worker에 포털이 요구한 고정 challenge의 GET/HEAD 응답과 익명 `/documents` HTML 로그인 안내를 추가했다. challenge는 서버 환경 설정에서 읽고, 없거나 잘못된 값이면 404, 쓰기 메서드는 405로 거부한다. 로그인은 플랫폼의 고정 경로와 같은 origin의 반환 위치를 사용하며 요청의 외부 URL을 반영하지 않는다. 문서, 버전, 업로드, MCP 실행의 사용자 검사는 유지한다. Node 534개, compiled Worker, 저장 검사와 Linux와 Windows CI 네 작업이 통과했다.

실제 공개 접속의 19개 검사는 challenge의 정확한 plain-text 200, POST 405, 브라우저 로그인 안내, 익명 문서 목록, 가짜 버전 다운로드, 업로드, 진단 거부, 신원 헤더 네 조합의 문서 목록, MCP 실행 거부와 OAuth 발견 응답을 포함한다. 개인 문서 ID나 인증 정보를 사용하지 않았다.

플랫폼은 익명 MCP 초기화, 도구 목록에도 401과 protected-resource 발견 URL을 반환했다. 이 경로는 플랫폼 OAuth 보호가 적용된 결과이며 Worker 내부의 메타데이터 응답과 구분한다. 실제 두 OAuth 계정의 격리를 검증한 결과는 아니다. 배포 후 기존 계정의 읽기 전용 기능 조회는 성공했다.

포털에서 **Domain verified**를 확인하고 새로고침 후 저장 상태도 확인했다. 최초 client 등록 설정이 없는 초안에서 사용자의 실제 Connect 조작은 `MCP details save failed: OAuth client ID is required when using pre-defined OAuth client credentials.`로 거부됐다. 인증 서버의 OIDC metadata는 JSON으로 반환됐지만 CIMD 지원 표시와 DCR 등록 URL은 확인되지 않았다. 기존 비공개 연결은 동작하지만 공개용 연결은 미완료다.

### 저장된 client ID와 연결 저장 오류의 후속 조사

Sites가 반환한 실제 `auth_client_id`를 확인했다. 플랫폼의 사이트 로그인 경로는 이 ID, 사이트의 `/callback`, S256을 사용해 302를 반환했다. 리디렉션은 따라가지 않았다. 이는 사이트 로그인에 쓰는 ID라는 근거이며, 공개 MCP 연결의 콜백 허용 목록이나 등록된 token endpoint 인증 방법을 확인한 결과는 아니다.

[공식 등록 설정](https://developers.openai.com/plugins/build/plugins#configure-mcp-authentication)에 따라 별도 검사 ZIP에 `extensions.com.openai.auth.client`의 `mode=provided`와 확인한 `clientId`를 넣었다.

기존 Codex 형식 0.1.1과 공식 portable 형식 0.1.2를 같은 초안에 순서대로 업로드했고, 두 형식 모두 포털이 수락했다. 새로 불러온 MCP 설정에서도 ID가 보였다. 사용자는 **두 형식에서 모두 같은 client ID 필요 오류**를 확인했다.

현재 저장된 검사 초안은 portable 0.1.2이며 Domain verified / Authorization required / Not submitted / Not published 상태다. 인증 화면과 도구 스캔은 완료되지 않았다.

portable 검사본은 root `plugin.json`, `mcp.json`과 명시적인 `streamable-http`를 사용했다. OAuth 설정은 0.1.1과 같고, Secret, scope, 등록 방법을 추측해 추가하지 않았다. 선택 사항인 `tokenEndpointAuthMethod`를 생략한 것은 실제 등록 방법을 확인한 뜻이 아니다. 원래 `plugins/archive/hwp-easy-remote-0.1.9/`와 최종 패키징의 미완료 차단은 유지한다. 별도 검사본의 포털 수락은 Agent Plugins 기본 JSON Schema 통과나 공개 연결 성공을 인증하지 않는다.

| 조사한 경로 | 실제 확인과 한계 |
| --- | --- |
| 저장, 화면 캐시와 패키지 형식 | 다시 불러온 설정에 ID가 남았고 두 공식 형식에서 사용자가 같은 오류를 확인했다. 형식 변경으로 해결되지 않았다. |
| 기존 Sites 등록 정보 | 실제 사이트 로그인 ID는 확인했지만 native 도구와 관리 화면에서 등록 콜백, token endpoint 인증 방법을 조회할 수 없었다. |
| ChatGPT의 Plugins → 추가 → 사용자 지정 MCP 서버 → 고급 OAuth 설정 | 같은 주소의 발견이 성공했다. ID, Secret, 인증 방식 입력란, 콜백 주소, OAuth/OIDC 주소와 범위가 표시됐다. `none`은 새 폼의 기본 선택값이며 기존 Sites 클라이언트의 등록 방법을 증명하지 않는다. 새 앱 생성, ID/Secret 입력, 권한 승인은 하지 않고 폼을 닫았다. 공개 제출 초안으로 재연결하는 지원 경로는 확인되지 않았다. |
| DCR, CIMD | 새 폼에서도 등록 URL 없음과 CIMD 지원 미표시로 사용할 수 없었다. 공급자 등록, 메타데이터를 임의로 변경하지 않았다. |
| 기존 Sites 플러그인의 관리 화면 | 비공개 개발용 연결과 계정은 유지됐다. 공개 제출에 필요한 등록 설정이나 디렉터리 게시 경로는 확인되지 않았다. [Sites 플러그인 공식 안내](https://help.openai.com/en/articles/20001547-hosting-a-plugin-with-chatgpt-sites)는 개인, Pro 계정의 Sites 플러그인을 다른 사용자에게 초대나 링크로 직접 공유하는 기능이 현재 지원되지 않는다고 명시한다. 사이트 공개와 플러그인 배포는 별도다. |

2026년 10월 9일의 [동일 오류 제보](https://community.openai.com/t/plugin-dashboard-no-way-to-supply-a-pre-defined-oauth-client-id-for-a-zip-created-plugin-oauth-client-id-is-required-with-no-field-submission-blocked/1404710)는 ZIP으로 만든 공개 초안에 ID 입력란이 없고 같은 저장 오류가 난다고 보고한다. 이는 개발자의 직접 제보이며 해결책이나 플랫폼의 원인 확인은 아니다.

관련 [다른 MCP 생성 실패 논의](https://community.openai.com/t/custom-mcp-app-creation-fails-with-http-500-detail-request-timeout-before-any-request-reaches-mcp-server-both-secure-mcp-tunnel-and-public-https/1402909)에는 다른 생성 메뉴로 성공했다는 제보와 실패했다는 답변이 함께 있다. 해당 논의에서 지원팀이 확인한 것은 그 사례의 403이며 HWP Easy의 client ID 저장 오류와 같은 원인이라는 증거가 아니다.

이 시점에는 **포털의 저장된 설정과 실제 OAuth 연결 설정 사이의 반영 문제 가능성**을 조사했다. 아래 후속 실험에서 새 초안의 실제 연결을 통과했으나 원래 초안의 오류는 남았다. 공급자의 ID 거부나 callback 불일치로 단정하지 않는다. 이메일은 계속 보류한다.

## 추가 대안 조사와 로컬 OAuth 실험

현재 공개 포털의 Plugins 목록과 Upload Plugin 창을 직접 확인했다. ZIP 업로드 경로만 노출됐고, 일부 [원격 MCP 검토 안내](https://developers.openai.com/plugins/deploy/app-review)에 나오는 직접 MCP 등록 폼은 이 계정 화면에서 확인되지 않았다. 해당 안내도 [현재 제출 절차](https://developers.openai.com/plugins/deploy/submission)를 기준으로 삼으라고 명시한다. 문서의 다른 표현만으로 숨겨진 등록 API나 별도 폼이 사용 가능하다고 판단하지 않는다.

| 대안 | 확인한 범위 | 공개 출시와 남은 작업 |
| --- | --- | --- |
| 기존 Sites OAuth, 현재 공개 초안 | 기존 연결을 유지하면서 조사할 수 있으나, 제공한 ID가 실제 연결 설정에 반영되는 지원 경로와 등록 콜백, 인증 방법은 확인되지 않았다. | 포털 연결 오류가 해결돼야 한다. 같은 Connect를 반복하거나 필드 이름을 임의로 바꾸지 않는다. |
| 독립 Cloudflare Workers MCP + 자동 OAuth 등록 | 공식 라이브러리와 현재 Worker의 WASM, D1, R2 구조를 조사했다. 합성 신원의 로컬 실제 workerd에서 DCR, S256 발급, 한 번의 갱신 등 9개 검사를 통과했다. | 구현 가능한 후보다. 실제 사용자 로그인, 동의, 이메일 검증, UserInfo, 권한 철회, 두 계정 문서 격리, 실제 ChatGPT/Codex, 포털 연결은 미검증이다. 운영 전환이나 공개 심사 통과를 의미하지 않는다. |
| 별도 관리형 OAuth 공급자 | [Auth0](https://auth0.com/docs/api/authentication/dynamic-application-client-registration/dynamic-application-registration)는 DCR 엔드포인트를 문서화한다. [Cloudflare 공식 안내](https://developers.cloudflare.com/agents/model-context-protocol/protocol/authorization/)는 외부 신원 공급자와 MCP 권한을 연결하는 구성을 지원한다. | 공급자 계정, 설정과 실제 호환성 검증이 필요하다. 공급자만 바꿔 현재 Sites 관리 인증을 우회하는 방식은 구현하지 않는다. |
| GitHub marketplace를 통한 배포 | [공식 패키징 안내](https://developers.openai.com/plugins/build/plugins)와 [워크스페이스 가져오기 안내](https://help.openai.com/en/articles/20001504-importing-and-syncing-plugin-marketplaces-from-github)에 별도 설치 경로가 있다. | 공개 디렉터리와 별도다. 가져오기는 사용자 서비스 권한을 부여하지 않으며, 원격 MCP 선언도 Desktop only로 표시될 수 있다. 현재 목표인 누구나 ChatGPT, Codex에서 검색, 설치를 충족한 것으로 간주하지 않는다. |

독립 서버 후보는 [Cloudflare OAuth 라이브러리](https://github.com/cloudflare/workers-oauth-provider) **1.2.3**을 고정해 운영과 분리된 로컬 실험에서 검사했다.

사전 제공 ID, Secret 없이 `none` 방식의 DCR 등록이 성공했고, 정확한 issuer/resource 발견, S256 교환, 두 고정 합성 신원의 토큰 컨텍스트, 한 번의 refresh token 회전, 다른 resource 토큰 거부, 인증 코드 재사용 거부와 그 grant의 토큰 무효화를 확인했다. 위조 Sites 신원 헤더만으로는 접근할 수 없었다.

합성 로그인, 동의 fixture를 사용한 OAuth 프로토콜 실험이며 실제 사용자나 HWP 문서 흐름 검증이 아니다. 토큰, 코드, 쿠키는 기록이나 출력에 넣지 않았다.

추가 CIMD 실험은 지원 메타데이터 표시까지 확인했으나, 로컬 workerd의 `https://chatgpt.com/oauth/client.json` 조회가 HTTP 403으로 거부되어 문서 해석, 교환을 통과하지 못했다. 웹 조회 도구에서는 그 공개 JSON을 읽을 수 있었다. 이 차이의 원인은 미확인이고 우회하지 않았다.

[OpenAI 인증, 등록 안내](https://developers.openai.com/plugins/build/auth)와 패키징 안내는 `client.mode=cimd`와 `dcr`를 지원하지만, 현재 Sites 공급자에 없는 지원을 선언하는 것만으로 사용할 수 있지는 않다. 새 구현에서는 CIMD를 우선 검토하고 DCR을 호환 경로로 검증할 수 있으며, 두 경로의 실제 포털 동작은 별도로 검사해야 한다.

호스팅 도구 조회에서는 연결된 Cloudflare 계정과 Workers, D1 목록 읽기를 확인했다. 해당 조회에 HWP 이름의 리소스는 없었고 R2 목록 조회는 `10000: Authentication error`로 거부됐다. 일부 목록 읽기로 리소스 생성, 배포, R2 사용 권한을 확정하지 않는다. Vercel의 HWP 이름 프로젝트 조회도 성공했지만 결과는 없었다. 새 리소스, 계정, 배포, 도메인, 권한은 만들거나 변경하지 않았다.

현재 코드를 독립 서버에 그대로 노출해서는 안 된다. `authenticatedOwner`는 **Sites의 신뢰된 dispatch가 공급한 헤더**를 전제로 하므로, 독립 인증 어댑터는 실제 토큰의 issuer, audience, scope, 안정된 subject를 검증한 컨텍스트로 사용자 범위를 만들어야 한다. 엔진, 보존 검사와 저장 서비스는 재사용 후보이며, 브라우저 로그인, 세션, MCP 발견과 인증 경계는 교체, 검증 대상이다. 기존 Sites 문서를 이메일만으로 새 사용자 범위에 연결하거나 소유자 토큰을 공유하지 않는다.

이전 대안 조사는 독립 Workers + 사용자 인증 연결 + 자동 등록의 구현 가능성을 검사한 것이다. 사용자는 이후 추가 유료 서버 없이 기존 Sites를 유지하도록 요청했고, 아래 실제 연결 성공으로 그 경로를 계속한다. 독립 서버 전환은 채택하지 않았으며 이메일은 계속 보류한다.

## 추가 유료 서버 없이 기존 Sites로 연결한 결과

2026년 10월 10일 [공식 비용 안내](https://learn.chatgpt.com/docs/pricing#how-much-does-sites-cost)에서 **공개 베타 동안 적격 ChatGPT 플랜에 Sites 호스팅이 포함**됨을 확인했다. 별도 서버 계약 없이 현재 사이트를 유지할 수 있다. [Sites 안내](https://learn.chatgpt.com/docs/sites)의 플랜별 한도가 적용되며 영구 무료, 무제한이나 불특정 다수의 부하 수용을 보장하지 않는다. 새 호스팅, 유료 서비스, OAuth 공급자를 만들지 않았다.

공식 [제출 안내](https://developers.openai.com/plugins/deploy/submission)는 이미 생성된 client 등록이 설정 변경을 제한할 수 있다고 설명한다. 실제 기존 초안에서 MCP key를 바꾸려는 업로드도 새 plugin을 만들라는 오류로 거부됐다. 이에 같은 서버, resource, Sites client ID로 미게시 검사 초안을 만들었다. 등록 정보를 새로 만들거나 Sites의 인증 라우트를 바꾸지 않았다.

새 검사 초안의 0.1.3은 생략된 인증 방법 때문에 Secret 입력을 요구했다. 0.1.4에 공식 필드 `client.tokenEndpointAuthMethod=none`을 명시한 뒤 설정 저장, OpenAI 인증 화면이 열렸다.

사용자 승인 후 현재 계정의 필수 로그인 신원, 이메일 동의를 완료했고, 실제 콜백과 도구 발견 결과 **13개 도구 / Authorized / Configured / 최신 MCP 검사 No findings**를 확인했다. 이는 Secret 없이 해당 선언으로 실제 교환, 발견이 성공했다는 근거이며 공급자의 전체 등록 원장을 조회한 결과는 아니다.

`none`은 token endpoint의 클라이언트 인증 방식이며 MCP 사용자 인증을 없앤 설정이 아니다.

같은 설정을 원래 HWP Easy 초안 0.1.5에 적용한 한 번의 Connect는 여전히 client ID 필요 오류를 반환했다. 새 검사 초안과 기존 초안의 결과 차이는 저장된 연결 상태의 영향과 부합하지만 플랫폼 내부 원인은 미확정이다. 원래 초안은 오류 근거로 보존하고 표시 이름은 HWP Easy로 유지한 새 출시 초안을 생성했다.

같은 패키지 이름의 업로드는 기존 plugin으로 연결되므로 새 식별자 `hwp-easy-public`을 사용했다. 실제 출시 초안 0.1.8도 현재 계정의 인증, 콜백, 13개 도구 검색, 메타데이터와 MCP 검사 No findings, Authorized / Configured를 통과했다.

패키지 누출, 잘못된 client/resource, 중첩 시크릿 거부, portable 변환과 한국어 보존의 Python 13개 검사가 통과했다.

현재 계정의 연결, 도구 발견을 공개 디렉터리 게시, 두 실제 사용자 격리, 장시간 자동 갱신 또는 문서 편집 품질의 새 인증으로 확대하지 않는다. 운영 버전 53, 환경, 저장 바인딩과 사용자 문서는 바꾸지 않았다. 토큰, 쿠키, 암호, 인증 코드, 개인 파일은 출력, 공개 패키지, 기록에 넣지 않았다.

## 합성 시연 준비

2026년 10월 10일 기존 소유자 개발 연결에서 개인정보 없는 13,312바이트 합성 HWP를 새로 가져왔다. 전체 10블록 읽기, 첫 표의 0행, 1열 답변 셀을 `Review answer`로 바꾸는 무저장 계획, 틀린 원문 가드의 `EXPECTED_OLD_MISMATCH`, 두 번째 변경에 줄바꿈이 든 묶음의 `INVALID_OPERATION / line_breaks`와 전체 거부를 확인했다. 계획과 거부 이후 이력은 최초 한 버전 그대로였고, 정상 저장에서는 해당 셀 하나만 바뀌며 나머지 9블록이 유지됐다.

수정본을 embedded HWP로 회수하고 같은 합성 원문에서 로컬 엔진으로 재현한 전체 바이트와 대조해 일치했다. 원본 복구 회수본은 최초 파일과 전체 바이트가 같았고 원본, 수정, 복구 세 버전을 유지했다. PC 원본도 그대로였다. 이는 **현재 소유자의 기존 개발 연결에서 수행한 시연 준비 검사**이며 전용 심사 계정, 새 공개 초안 설치, 영상 제작, 서식 인증 결과가 아니다. 미지원 형식 변환의 에이전트 거부 시나리오도 이번 도구 호출로 실행한 것으로 간주하지 않는다.

실제 녹화에는 합성 업로드 → 기능 조회와 전체 읽기 설명 → 정확한 답변 셀의 무저장 계획, 거부 설명 → 정상 저장과 HWP 다운로드 → 새 버전으로 원본 복구, 세 버전 목록, 복구 원문 확인이 담겼다. 형식 변환은 범위 밖이라고 설명했으며 별도 심사 프롬프트의 실행으로 간주하지 않는다. 사용자가 제공한 4분 45초 영상은 원본을 유지하고 상단 주소, 북마크와 이전 다운로드 목록을 가린 사본으로 압축했다. 음성은 제거했고 진행 순서, 속도, 도구 결과는 재구성하지 않았다.

[영상과 합성 HWP 자료](https://github.com/spark142857142857/hwp-easy/releases/tag/review-demo-2026-10-10)는 심사 준비용 prerelease에 첨부했다.

[직접 영상 URL](https://github.com/spark142857142857/hwp-easy/releases/download/review-demo-2026-10-10/hwp-easy-demo-review.mp4)과 [합성 양식](https://github.com/spark142857142857/hwp-easy/releases/download/review-demo-2026-10-10/hwp-easy-synthetic-review.hwp)은 로그인 없는 HTTP 206와 파일 시그니처를 확인했다.

영상은 9,505,575바이트이고 합성 양식은 13,312바이트다. 1초 간격 285장 OCR와 화면 표본에서는 인증 정보나 개인 문서를 발견하지 않았지만 모든 프레임의 완전한 개인정보 무노출 인증은 아니다. 현재 소유자의 개발 연결 시연이며 공개 설치, 심사 계정 실행 검증으로 확대하지 않는다.

## 심사 제출과 게시 준비

사용자는 2026년 10월 10일 공식 제출 자료, 영상, 심사, 게시를 우선하기로 했다. 공식 문서는 로그인 필요 시 심사자가 바로 사용할 전용 테스트 접근, 긍정 5개, 부정 3개, 접근 가능한 영상 URL과 릴리스 노트를 요구한다. 실제 포털에는 사용자 이름, 암호와 reviewer email 방식이 모두 보인다. 후자는 일반 문서의 추가 이메일 인증 금지 안내와 차이가 있어, Sites 로그인에 적용 가능한지와 심사자가 추가 가입 없이 접속할 수 있는지는 아직 확인되지 않았다. 개인 OpenAI 계정 암호를 공유하거나 새 OpenAI 계정 생성이 필수라고 단정하지 않는다.

| 항목 | 현재 상태 / 완료 근거 |
| --- | --- |
| 검증된 게시자 신원과 표시 이름 | 개인 인증 완료와 포털의 검증된 Individual 선택을 확인했다. 패키지의 개발자 이름을 반영한 초안 업로드가 수락됐다. |
| 공개 홈페이지, 지원, 개인정보, 약관 | 홈페이지, 지원은 GitHub README와 Issues로 지정한다. 검증된 게시자와 사용자가 공개하도록 지정한 문의 이메일을 [개인정보처리방침](privacy-policy.md), [이용약관](terms-of-service.md)에 반영했다. 두 정책 URL의 익명 HTTP 200과 실제 내용, 포털 메타데이터 No findings를 확인했다. |
| 익명 진단 실행 제한 | 운영 버전 53의 공개 URL에서 익명 실행, 문서 접근과 위조 신원 헤더 거부를 확인했다. 실제 두 계정 검증과 구분한다. |
| 일반 사용자 설치, 인증, 권한 철회 | 같은 플랫폼 OAuth와 보호를 유지한다. 실제 다른 사용자 설치부터 파일 회수, 권한 철회까지의 검증은 사용자 결정으로 후순위다. 공식 포털의 특정한 두 계정 제출 요건으로 표현하지 않으며 완료로 표시하지 않는다. |
| 실제 두 사용자 격리 | 추가 후속 검증이며 미검증이다. 로컬 모의 헤더, 익명 요청 거부와 구분한다. 현재 심사용 부정 사례에는 한 테스트 계정에서 확인할 수 있는 틀린 원문 가드 거부를 사용한다. |
| 심사 자료 | 긍정 5개, 부정 3개와 한국어 번역을 유지하고, 0.1.9에 원문 가드 거부와 익명 다운로드 가능한 영상 URL을 반영했다. portable ZIP에는 manifest, MCP 설정, 아이콘 세 파일만 들어간다. URL 누락 시험은 실제 영상 유무와 독립적으로 누락 fixture를 구성하며 Python 13개 검사가 통과했다. 전용 심사 접근 방법과 그 계정의 시나리오 실행은 미완료다. 자격 증명은 공개 ZIP, Git에 넣지 않는다. |
| MCP 연결, 도메인 소유 확인 | 새 검사 초안에서 실제 Sites ID와 명시적인 `provided / none`으로 현재 계정의 인증, 콜백, 13개 도구 검색과 Authorized / Configured / 최신 MCP 검사 No findings를 확인했다. 도메인은 verified다. 원래 초안은 같은 선언에도 오류가 남아 패키지 식별자를 `hwp-easy-public`으로 구분한 출시 초안 0.1.8도 연결을 완료했다. |
| 인증 자동 갱신 | 기존 인증 지원 문의 조사 중. 현재 기능 조회 성공이나 1회 대기 성공으로 영구 해결을 선언하지 않는다. 공개 출시의 신뢰성 검토에 포함한다. |
| 심사와 게시 | 영상 URL을 반영한 0.1.9와 짧게 수정한 접속 안내를 제출했고 상세 화면의 In review / Not published를 확인했다. 사용자가 여섯 약관, 확약에 동의한 뒤 최종 제출을 한 번 실행했다. 심사자 접속, 사례 실행은 미검증이며 심사 승인과 게시는 다음 단계다. |

사이트 URL의 공개 전환과 도메인 확인은 완료했으며 플러그인 공개 설치, 심사, 게시의 완료로 간주하지 않는다. 현재 소유자의 개인 HWP를 공개 예제나 심사 데이터로 쓰지 않는다. 사이트의 공개 전환, 플러그인 심사 승인, 디렉터리 게시, 실제 설치 성공을 각각 기록한다.

### 심사자 접속과 앱 내부 사용의 남은 차이

현재 Sites의 공개 audience와 업로드 플래그는 유지되며 로그인한 신원의 안정된 ID로 문서 영역을 분리한다. 별도 HWP Easy 계정 가입, 암호, tenant 등록 화면은 없다. 심사용 후보 안내는 Sites `/documents`에서 OpenAI 로그인 후 같은 심사 신원으로 MCP를 연결하고, 공개 합성 파일을 자기 문서 영역에 업로드하도록 준비했다. 포털의 reviewer email 방식이 이 관리형 OpenAI 로그인에서 추가 계정 생성, 코드, 승인 없이 실제로 동작하는지는 아직 확인되지 않았다. 개발자의 개인 계정 자격 증명이나 공유 토큰을 제공하거나, 미구성 테스트 계정을 완료로 신고하지 않는다.

최초 저장 검사에서 포털은 `Test credentials is required`를 반환했다. 이후 사용자는 별도 Chrome 프로필에서 새 시험 OpenAI 계정의 Sites 로그인, 권한 승인을 직접 마쳤다. 공식 ChatGPT 확장 기능 연결 뒤 에이전트가 그 프로필의 빈 문서 목록을 직접 확인했고, 공개 합성 HWP 13,312바이트를 업로드해 저장본, 편집 범위, 기본 미리보기를 확인했다.

그 계정에서 내려받은 원본의 SHA-256은 공개 fixture와 같았다. 브라우저 로그인, 업로드, 원본 다운로드의 성공이며 MCP 연결, 전체 읽기, 편집 사례 실행이나 두 계정의 교차 접근 차단 검증으로 간주하지 않는다. 새 계정은 다른 사용자 연결 시험용이고 구글, OpenAI 암호를 심사팀에 넘겨야 한다는 요구로 해석하지 않는다.

같은 시험 계정의 ChatGPT Plugins에서 공개 제출용 0.1.9 ZIP의 `가져오기에 성공했습니다`와 HWP Easy 상세 화면을 확인했다. 상세 화면은 `데스크톱 앱에서 열기`를 제공하며 웹에서 설치, Connect 버튼은 보이지 않았다. 이 Free 계정의 대화 화면에는 `Work 업그레이드 필요`가 표시됐다. 이는 개인 ZIP 가져오기 결과이며 공개 디렉터리 설치나 MCP 인증, 실행의 성공이 아니다.

[공식 요금 안내](https://learn.chatgpt.com/docs/pricing)는 Free의 데스크톱 GPT-6 Luna 접근을 배포 대상에 따라 제공한다고 설명하고, [플러그인 사용 안내](https://learn.chatgpt.com/docs/plugins)는 지원되는 데스크톱에서 설치, 사용하는 경로를 설명한다. 시험 계정의 실제 데스크톱 가용성은 미검증이다. 사용자의 결정으로 별도 데스크톱 로그인 검사는 보류하며 추가 제출 조건으로 요구하지 않는다.

요금제 업그레이드, API 키 발급, 기존 데스크톱 계정 전환은 하지 않았고 추가 유료 서버도 만들지 않았다.

포털의 `Magic link or email code` 선택지에 공개 로그인 URL, 사용자별 문서 영역, 관리형 OpenAI 로그인 절차를 저장했다. 사용자 요청으로 접속 안내를 1,857자에서 1,021자로 45% 줄였고 다시 열어 저장된 본문을 대조했다. 서비스 기능과 세 단계의 심사 절차를 중심으로 쓰면서 심사팀 이메일 호환성과 심사 신원의 MCP 사례 실행이 미검증이라는 문장은 유지했다.

저장 뒤 `Incomplete review information`이 사라졌고, 사용자의 여섯 항목 명시적 동의 후 최종 제출을 실행해 **0.1.9 · In review**를 확인했다. **접수는 해당 로그인 방식의 심사 허용이나 심사자 접속 성공을 증명하지 않는다.** 소유자 암호, 토큰, 개인 문서, 심사팀 이메일 값은 공개 기록과 패키지에 넣지 않았다.

[전화 인증 안내](https://help.openai.com/en/articles/8983040-what-does-phone-verification-look-like)에 따르면 OpenAI 계정 생성, ChatGPT에는 전화 인증이 보통 필요하지 않지만 데스크톱 Codex 접근이나 첫 API 키 생성에는 요구될 수 있다. 새 전화번호가 반드시 필요하거나 새 계정만이 가능한 심사 경로라고 단정하지 않는다. 이번 준비에는 API 키를 만들지 않는다.

공개 심사, 게시가 완료되면 디렉터리에서 검색, 설치할 수 있는 배포가 된다. 현재 MCP의 읽기, 계획, 수정, 저장, 복구는 에이전트 대화에서 실행하지만 심사 자체가 Codex 내부의 업로드, 미리보기, 결과 첨부 UI를 생성하지 않는다. 실제 native 파일 전달을 확인한 Desktop, 저장소 Cloud의 범위와 별도 브라우저 업로드, 다운로드, 미검증 Cloud 결과 첨부 UI를 구분한다. 기존 Sites 서버는 도구 실행과 사용자별 문서 보관을 위해 계속 필요하다.
