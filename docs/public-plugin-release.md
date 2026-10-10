# HWP Easy 공개 플러그인 출시 준비

2026년 10월 10일 사용자가 선택한 목표는 **누구나 ChatGPT·Codex의 디렉터리에서 찾아 설치하는 공개 플러그인**이다. 초대형 배포나 소유자 전용 사이트 업데이트가 완료 조건을 대신하지 않는다. Dots는 계속 제외한다. 전체 플랫폼 백업·재해 복원과 외부 키 보관은 사용자가 후순위로 둔 운영 작업이다.

## 현재 확인한 상태

- 운영 사이트는 버전 53·환경 revision 9다. 도메인 확인을 위해 URL 접근을 `public`으로 전환했으며 문서·업로드·진단은 사용자 인증을 요구한다. 공개 접속의 19개 검사에서 익명 요청과 위조 신원 헤더의 거부를 확인했다. 기존 소유자 문서와 버전을 공개 예제로 사용하지 않았다.
- Sites는 `public` 접근으로 전환할 권한을 제공한다. 이는 URL 접근 대상 설정이며 플러그인 디렉터리 게시와 별도이다.
- 플랫폼이 만든 기존 Sites 플러그인은 비공개 연결이다. 공개 ZIP에는 이 연결의 `.app.json` ID를 재사용하지 않고 실제 HTTPS `/mcp` 주소와 OAuth resource를 선언한다. 기존 연결과 사용자 저장소의 신원·바인딩을 유지한다.
- 사용자가 개인 신원 인증을 마쳤고 OpenAI Platform에서 **Verified**를 확인했다. 포털이 선택한 검증된 Individual 신원을 패키지의 개발자 이름에 반영한 뒤 ZIP 업로드로 초안을 생성했다. 개인정보·약관 URL을 반영한 다음 업로드에서는 메타데이터 **No findings**를 확인했다. 도메인 **verified**도 확인했다. 현재 **Not published / Not submitted**이며 공개용 OAuth 연결과 심사 정보는 미완료다.
- 사용자가 GitHub 저장소를 공개하고 문서 구조를 정리하도록 승인했다. README와 Issues를 공개 홈페이지·지원 URL로 지정한다. 실제 익명 접근을 확인한 뒤 제출 자료로 사용하며, 개인정보·약관 초안을 확정 정책으로 대신하지 않는다.

공식 공개 경로는 [패키지 준비](https://developers.openai.com/plugins/build/plugins) → [제출 포털의 신원 인증·ZIP 업로드·연결 검사·심사·게시](https://developers.openai.com/plugins/deploy/submission)이다. 공개 패키지의 홈페이지·지원·개인정보·약관 URL은 실제로 접근 가능해야 하며, 게시자 신원과 일치해야 한다. [플러그인 가이드라인](https://developers.openai.com/plugins/plugin-guidelines)의 개인정보와 MCP 요구사항도 따른다.

## 준비한 패키지와 검사

`plugins/hwp-easy/`는 공식 제출 문서가 지원하는 Codex 호환 `.codex-plugin/plugin.json`·`.mcp.json`·SVG 아이콘으로 된 MCP 전용 초안이다. Agent Plugins 1.0.0의 실제 MCP JSON Schema는 OpenAI 문서가 설명하는 서버별 OAuth `extensions`를 추가 속성으로 거부해, 초안을 호환 형식으로 준비했다. 실제 포털의 최초 업로드는 필수 `interface.developerName` 누락으로 거부됐고, 검증된 게시자 이름을 반영한 ZIP은 초안으로 수락됐다. 개인 스킬·hooks·비공개 등록 App ID·토큰·클라이언트 시크릿·개인 문서를 포함하지 않는다. 실제 `/mcp` URL과 정확한 OAuth resource를 유지하고, 미확인 grant·client ID·scope·token endpoint 인증 방법을 만들지 않는다. 기본 영문 소개와 한국어 번역에는 파일·텍스트 한도, PC 원본과 원격 저장의 차이, 서식·인증 갱신의 제한을 명시했다. `author.name`과 `interface.developerName`은 선택한 검증 신원과 일치한다. 홈페이지·지원은 공개 GitHub 저장소와 Issues이며 확정한 개인정보·약관 URL도 반영했다. 녹화 URL은 아직 없다.

다섯 가지 긍정 시나리오는 기능 조회, 전체 읽기, 무저장 계획, 저장·다운로드, 이전 버전 복구다. 세 가지 부정 시나리오는 다른 사용자 문서 접근, 미지원 형식 변환, 줄바꿈이 든 전체 변경 묶음의 거부다. 이것은 **심사용 시나리오 초안이며 전용 심사 계정으로 실행 완료한 기록이 아니다**. 기존 한 계정의 합성 검증과 혼동하지 않는다. 심사 데이터는 합성 파일만 사용한다.

개발자는 `python scripts/package_public_plugin.py --draft`로 초안 ZIP을 만들 수 있다. 패키징은 정확히 세 파일만 허용하고 시크릿 필드·비공개 App 매핑·headers·hooks·symlink·아이콘 외부 참조를 거부한다. 현재는 `oauth_client_registration`과 녹화 URL이 미완료로 반환되며, 기본 실행은 최종 ZIP 생성을 거부한다. 녹화 URL만 추가해도 미확인 인증 설정을 완료 처리하지 않는다. 실제 등록 방식이 확인된 뒤 설정과 검사기를 함께 갱신해야 한다. 구조·ZIP 검사는 포털 스키마 검증이나 공개 연결 인증을 대신하지 않는다. 이 명령을 일반 사용자의 설치 방식으로 안내하지 않는다.

초기 준비에서 패키지 누출 방지 Python 8개, Node 529개와 로컬 Worker 회귀 검사가 통과했다. 실제 로컬 compiled workerd에서 익명·부분 신원·과도한 길이·서비스 접근 헤더만 있는 진단을 401로 거부했고, 익명 저장 진단 후 D1/R2가 비어 있음을 확인했다. 정상 합성 신원으로 기존 엔진·저장 진단과 문서 회귀 검사는 계속 통과했다. 이 결과는 모의 헤더를 쓴 로컬 검사이며 실제 OAuth 두 계정을 인증하지 않는다.

이 보호를 운영 버전 52에 반영했고 배포 성공을 확인했다. 비공개 운영 사이트에서 10개 HTTP 검사를 실행했다. 사용자 신원 없는 문서·진단·MCP 실행과 위조 신원 헤더는 모두 401로 거부됐으며, MCP 초기화·도구 목록은 메타데이터로 반환됐다. 환경 revision 8과 기존 비공개 접근은 유지했다. 공개 audience와 실제 두 OAuth 계정은 미검증이다. 이후 Windows CI에서 동시 저장·읽기 검사가 `UND_ERR_SOCKET`으로 한 차례 실패했다. 동일 검사의 로컬 Windows 실행과 다음 GitHub CI의 Linux·Windows 네 작업은 통과했지만, 최초 연결 종료의 원인을 확정하거나 재발 불가로 보장하지 않는다.

## 버전 53의 도메인 확인과 공개 접속 검사

Worker에 포털이 요구한 고정 challenge의 GET/HEAD 응답과 익명 `/documents` HTML 로그인 안내를 추가했다. challenge는 서버 환경 설정에서 읽고, 없거나 잘못된 값이면 404, 쓰기 메서드는 405로 거부한다. 로그인은 플랫폼의 고정 경로와 같은 origin의 반환 위치를 사용하며 요청의 외부 URL을 반영하지 않는다. 문서·버전·업로드·MCP 실행의 사용자 검사는 유지한다. Node 534개, compiled Worker·저장 검사와 Linux·Windows CI 네 작업이 통과했다.

실제 공개 접속의 19개 검사는 challenge의 정확한 plain-text 200·POST 405, 브라우저 로그인 안내, 익명 문서 목록·가짜 버전 다운로드·업로드·진단 거부, 신원 헤더 네 조합의 문서 목록·MCP 실행 거부와 OAuth 발견 응답을 포함한다. 개인 문서 ID나 인증 정보를 사용하지 않았다. 플랫폼은 익명 MCP 초기화·도구 목록에도 401과 protected-resource 발견 URL을 반환했다. 이 경로는 플랫폼 OAuth 보호가 적용된 결과이며 Worker 내부의 메타데이터 응답과 구분한다. 실제 두 OAuth 계정의 격리를 검증한 결과는 아니다. 배포 후 기존 계정의 읽기 전용 기능 조회는 성공했다.

포털에서 **Domain verified**를 확인하고 새로고침 후 저장 상태도 확인했다. 최초 client 등록 설정이 없는 초안에서 사용자의 실제 Connect 조작은 `MCP details save failed: OAuth client ID is required when using pre-defined OAuth client credentials.`로 거부됐다. 인증 서버의 OIDC metadata는 JSON으로 반환됐지만 CIMD 지원 표시와 DCR 등록 URL은 확인되지 않았다. 기존 비공개 연결은 동작하지만 공개용 연결은 미완료다.

### 저장된 client ID와 연결 저장 오류의 후속 조사

Sites가 반환한 실제 `auth_client_id`를 확인했다. 플랫폼의 사이트 로그인 경로는 이 ID, 사이트의 `/callback`, S256을 사용해 302를 반환했다. 리디렉션은 따라가지 않았다. 이는 사이트 로그인에 쓰는 ID라는 근거이며, 공개 MCP 연결의 콜백 허용 목록이나 등록된 token endpoint 인증 방법을 확인한 결과는 아니다.

[공식 등록 설정](https://developers.openai.com/plugins/build/plugins#configure-mcp-authentication)에 따라 별도 검사 ZIP에 `extensions.com.openai.auth.client`의 `mode=provided`와 확인한 `clientId`를 넣었다. 기존 Codex 형식 0.1.1과 공식 portable 형식 0.1.2를 같은 초안에 순서대로 업로드했고, 두 형식 모두 포털이 수락했다. 새로 불러온 MCP 설정에서도 ID가 보였다. 사용자는 **두 형식에서 모두 같은 client ID 필요 오류**를 확인했다. 현재 저장된 검사 초안은 portable 0.1.2이며 Domain verified / Authorization required / Not submitted / Not published 상태다. 인증 화면과 도구 스캔은 완료되지 않았다.

portable 검사본은 root `plugin.json`·`mcp.json`과 명시적인 `streamable-http`를 사용했다. OAuth 설정은 0.1.1과 같고, Secret·scope·등록 방법을 추측해 추가하지 않았다. 선택 사항인 `tokenEndpointAuthMethod`를 생략한 것은 실제 등록 방법을 확인한 뜻이 아니다. 원래 `plugins/hwp-easy/`와 최종 패키징의 미완료 차단은 유지한다. 별도 검사본의 포털 수락은 Agent Plugins 기본 JSON Schema 통과나 공개 연결 성공을 인증하지 않는다.

| 조사한 경로 | 실제 확인과 한계 |
| --- | --- |
| 저장·화면 캐시와 패키지 형식 | 다시 불러온 설정에 ID가 남았고 두 공식 형식에서 사용자가 같은 오류를 확인했다. 형식 변경으로 해결되지 않았다. |
| 기존 Sites 등록 정보 | 실제 사이트 로그인 ID는 확인했지만 native 도구와 관리 화면에서 등록 콜백·token endpoint 인증 방법을 조회할 수 없었다. |
| ChatGPT의 Plugins → 추가 → 사용자 지정 MCP 서버 → 고급 OAuth 설정 | 같은 주소의 발견이 성공했다. ID·Secret·인증 방식 입력란, 콜백 주소, OAuth/OIDC 주소와 범위가 표시됐다. `none`은 새 폼의 기본 선택값이며 기존 Sites 클라이언트의 등록 방법을 증명하지 않는다. 새 앱 생성·ID/Secret 입력·권한 승인은 하지 않고 폼을 닫았다. 공개 제출 초안으로 재연결하는 지원 경로는 확인되지 않았다. |
| DCR·CIMD | 새 폼에서도 등록 URL 없음과 CIMD 지원 미표시로 사용할 수 없었다. 공급자 등록·메타데이터를 임의로 변경하지 않았다. |
| 기존 Sites 플러그인의 관리 화면 | 비공개 개발용 연결과 계정은 유지됐다. 공개 제출에 필요한 등록 설정이나 디렉터리 게시 경로는 확인되지 않았다. [Sites 플러그인 공식 안내](https://help.openai.com/en/articles/20001547-hosting-a-plugin-with-chatgpt-sites)는 개인·Pro 계정의 Sites 플러그인을 다른 사용자에게 초대나 링크로 직접 공유하는 기능이 현재 지원되지 않는다고 명시한다. 사이트 공개와 플러그인 배포는 별도다. |

2026년 10월 9일의 [동일 오류 제보](https://community.openai.com/t/plugin-dashboard-no-way-to-supply-a-pre-defined-oauth-client-id-for-a-zip-created-plugin-oauth-client-id-is-required-with-no-field-submission-blocked/1404710)는 ZIP으로 만든 공개 초안에 ID 입력란이 없고 같은 저장 오류가 난다고 보고한다. 이는 개발자의 직접 제보이며 해결책이나 플랫폼의 원인 확인은 아니다. 관련 [다른 MCP 생성 실패 논의](https://community.openai.com/t/custom-mcp-app-creation-fails-with-http-500-detail-request-timeout-before-any-request-reaches-mcp-server-both-secure-mcp-tunnel-and-public-https/1402909)에는 다른 생성 메뉴로 성공했다는 제보와 실패했다는 답변이 함께 있다. 해당 논의에서 지원팀이 확인한 것은 그 사례의 403이며 HWP Easy의 client ID 저장 오류와 같은 원인이라는 증거가 아니다.

현재는 **포털의 저장된 설정과 실제 OAuth 연결 설정 사이의 반영 문제 가능성**을 조사하고 있다. 공급자가 ID를 거부했다거나 callback 불일치가 발생했다고 단정하지 않는다. 실제 등록 정보 또는 공식적으로 지원되는 연결 설정 경로가 필요하다. 사용자의 지시에 따라 이메일은 계속 보류하며, 이번 조사는 운영 배포·접근·사용자 문서를 변경하지 않았다.

## 공개 전에 완료할 항목

| 항목 | 현재 상태 / 완료 근거 |
| --- | --- |
| 검증된 게시자 신원과 표시 이름 | 개인 인증 완료와 포털의 검증된 Individual 선택을 확인했다. 패키지의 개발자 이름을 반영한 초안 업로드가 수락됐다. |
| 공개 홈페이지·지원·개인정보·약관 | 홈페이지·지원은 GitHub README와 Issues로 지정한다. 검증된 게시자와 사용자가 공개하도록 지정한 문의 이메일을 [개인정보처리방침](privacy-policy.md)·[이용약관](terms-of-service.md)에 반영했다. 두 정책 URL의 익명 HTTP 200과 실제 내용, 포털 메타데이터 No findings를 확인했다. |
| 익명 진단 실행 제한 | 운영 버전 53의 공개 URL에서 익명 실행·문서 접근과 위조 신원 헤더 거부를 확인했다. 실제 두 계정 검증과 구분한다. |
| 일반 사용자 설치·인증·권한 철회 | 같은 플랫폼이 공급하는 OAuth를 유지한다. 실제 다른 사용자 계정으로 설치부터 파일 회수까지 검사하고 권한 철회 후 접근을 확인한다. 헤더 모의 검사는 별도다. |
| 실제 두 사용자 격리 | 서로의 문서 ID·버전·다운로드·복구·삭제 접근을 거부하고 본인 문서는 동작해야 한다. 두 실제 OAuth 계정으로 검증한 증거가 필요하다. |
| 심사 자료 | 전용 계정의 합성 데이터로 5+3 시나리오를 실행하고 접근 가능한 녹화 URL을 준비한다. 심사 계정 자격은 공개 ZIP과 Git에 넣지 않고 포털의 별도 보호된 입력에만 제공한다. |
| MCP 연결·도메인 소유 확인 | 도메인 verified 완료. 실제 ID가 저장된 Codex·portable 검사 초안에서도 ID 필요 오류가 재현됐다. 등록 정보와 포털의 연결 설정 반영을 확인해야 한다. 기존 연결의 등록 방식을 임의로 변경하지 않는다. |
| 인증 자동 갱신 | 기존 인증 지원 문의 조사 중. 현재 기능 조회 성공이나 1회 대기 성공으로 영구 해결을 선언하지 않는다. 공개 출시의 신뢰성 검토에 포함한다. |
| 심사와 게시 | 포털에 초안을 생성했고 메타데이터와 도메인 검사를 완료했다. 심사 정보·공개용 OAuth 연결과 실제 다른 계정 검증이 남았다. 필수 검사와 정책 확인 뒤 신청하고, 승인된 버전을 게시하여 실제 다른 계정의 검색·설치까지 확인한다. |

사이트 URL의 공개 전환과 도메인 확인은 완료했으며 플러그인 공개 설치·심사·게시의 완료로 집계하지 않는다. 현재 소유자의 개인 HWP를 공개 예제나 심사 데이터로 쓰지 않는다. 사이트의 공개 전환, 플러그인 심사 승인, 디렉터리 게시, 실제 설치 성공을 각각 기록한다.
