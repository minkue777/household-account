# 시작 화면 부제 변경

사용자 요청에 따라 Web/PWA와 Android Native 시작 화면의 부제를 `가계부 · 자산관리`로 통일합니다. 문구만 변경하며 그림·가구명·폰트·배치·최소 2초·본화면 전환 조건은 유지합니다. 관리자 조회에서는 이전 변경대로 브랜드 부제와 최소시간을 생략합니다.

LED-001·AND-003의 기존 Web 시작 화면 계약, iPhone WebKit 시나리오와 실제 MainActivity 표시 검사의 기대 문구를 함께 갱신합니다. 인증·저장·조회 계약과 Firebase 실행 코드는 변경하지 않습니다. Web Git 자동배포와 Android v2.0.11/code49 서명 APK가 배포 대상입니다.

Web 관련 계약 검사 15개와 production build(정적 HTML 12개·CSP hash 26개 검증), Android release build가 통과했습니다. APK의 실제 부제·버전·앱 이름과 기존 인증서의 v2 서명을 확인했습니다. APK는 11,987,798바이트이며 SHA-256은 `cb8b9a2e1a33452c51a9e31689e13d57a314428aa64d9f4c226de91ebfab2e69`입니다. 로그는 `%TEMP%/household-startup-subtitle-web-build-20261015.log`, `%TEMP%/household-startup-subtitle-v2011-build-20261015.log`입니다.
