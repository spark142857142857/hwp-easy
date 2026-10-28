# 이전 구현

[현재 아키텍처](../docs/architecture.md) | [보관 문서](../docs/archive/README.md)

`sites-runtime/`은 이전 원격 서버의 Worker, 저장과 인증, 전달 및 관련 검사를 보관합니다. 현재 로컬 실행기와 npm 패키지는 이 폴더를 참조하지 않습니다. 원격 실험에서도 필요한 공통 엔진과 보존 검사는 `src/one_hwp/engine/`과 `src/one_hwp/guard/`를 사용합니다.

이전 서버를 로컬에서 검사할 때만 루트의 `npm ci`에 더해 `npm --prefix legacy/sites-runtime ci --ignore-scripts --no-audit --no-fund`를 실행합니다. 당시 서버 기록은 [원격 문서](../docs/archive/remote/documents.md)를 따릅니다.

원격 0.1.9의 플러그인 보관본은 [plugins/archive](../plugins/archive/README.md)에 있습니다. 코드 위치 정리는 원격 서비스 배포나 중지, 서버 문서와 복구 자료의 삭제를 수행하지 않습니다.
