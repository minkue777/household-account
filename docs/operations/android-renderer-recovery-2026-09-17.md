# Android WebView renderer 종료 자동 복구

## 확인 범위

사용자는 Android 앱 진입 직후 종료되고 재실행하면 정상인 증상을 하루 두 번 보고했다. 기기 종료 로그를 확보하지 못했으므로 실제 두 사건의 원인을 확정하지 않는다. 기존 `MainActivity`가 `onRenderProcessGone`을 처리하지 않아 renderer 종료가 앱 종료로 이어질 수 있는 경로를 보완한다. 별도로 발견한 Quick Edit 복구·캡처 예약 예외 경로는 이번 변경에 포함하지 않는다.

## v1.2.27의 동작

- 종료된 WebView의 참조와 bridge coroutine을 해제하고 View에서 분리한 뒤 파기한다. 손상된 renderer에 상태 저장·메시지·로딩 중지를 요청하지 않는다.
- 같은 Activity에서 마지막 허용 URL을 새 WebView로 복구한다. 같은 보안 설정과 허용 origin bridge를 적용하고, 로그인 쿠키·저장소는 삭제하지 않는다.
- 백그라운드 종료는 Lifecycle이 실제 RESUMED가 될 때까지 기다린다. `onResume` 본문에서는 아직 STARTED일 수 있으므로 `withResumed`를 사용한다.
- 사용자 요청에 따라 별도 안내 화면·재시도 버튼을 추가하지 않는다. 반복 종료도 자동 복구하되 재생성 사이에 최소 1초만 둔다. 정상 시작이나 일반 백그라운드 복귀에 새 대기를 추가하지 않는다.
- renderer 메모리에만 있던 미저장 입력을 복구한다고 보장하지 않는다. API·거래 저장·인증 계약은 변경하지 않는다.

## 검증

API 36.1 Android AVD에서 실제 `MainActivityInstrumentationTest` 15개가 통과했다. 실패·오류·skip은 각각 0개이며 계측 실행은 약 26초였다.

1. `chrome://crash`로 실제 renderer를 크래시시킨 뒤 같은 Activity의 생존, 이전 WebView 단 한 번 해제, 마지막 허용 URL 요청, 새 renderer의 bridge 응답과 영속 cookie 보존을 확인했다.
2. 배경에서 실제 renderer 프로세스를 종료하고, 배경에서는 새 View를 만들지 않으며 같은 Activity의 전경 복귀 후 자동 복구되는지 확인했다.
3. renderer를 연속 두 번 종료하고 버튼 클릭·Activity 재생성 없이 자동 복구되는지 확인했다.
4. 기존 권한·navigation·정상 종료·재생성 검사를 유지했다.

검사는 제품 callback을 직접 호출하거나 대체하지 않는다. 테스트용 HTML은 복구된 실제 renderer와 제품 bridge를 검증하며 외부 서버 응답과 분리한다. 이는 사용자 휴대폰의 사건 재현이 아니라 확인된 종료 경로의 회귀 검증이다.

Android release APK 빌드가 통과했다. versionName은 `1.2.27`, versionCode는 `29`다. Firebase 변경은 없다.
