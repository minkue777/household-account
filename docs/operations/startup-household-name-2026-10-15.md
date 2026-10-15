# 시작 화면의 가구명 선행 표시

## 원인과 표시 계약

v2.0.5에서 그림·가구명·부제를 분리한 뒤 Native 제목은 빈 TextView였고 Web은 `HouseholdContext.household.name`이 준비될 때만 제목을 표시했습니다. 따라서 그림과 부제가 먼저 나타나고 인증 복원 뒤 가구명이 붙었습니다. 최소 2초 표시는 이 지연의 원인이 아닙니다.

사용자는 마지막으로 확인한 가구명을 기기에 보관해 시작 화면에서 함께 표시하도록 요청했습니다. 표시용 이름은 인증이나 금융 데이터 조회 권한을 대신하지 않습니다. 현재 서버에서 확인한 이름을 우선하고, 가구 변경·로그아웃 시 이전 이름을 제거합니다. 새 설치·이름 없는 구형 저장본·손상된 저장본은 빈 제목 공간을 유지하며 임의의 가구명을 추정하지 않습니다. 기존 최소 2초와 전체 홈 준비·오류·첫 paint 계약을 유지합니다.

## 구현과 저장 경계

- Web/PWA는 별도 저장소를 만들지 않고 기존 `signedInMembershipCache`에서 이름 문자열만 읽습니다. `resolving` 동안만 표시용 fallback으로 사용하고 서버 가구명이 준비되면 즉시 우선합니다. 확정 signed-out·first-visit·error에는 이전 이름을 사용하지 않습니다. 다른 UID 또는 확정 로그아웃이 관측되면 기존 cache를 지웁니다.
- `useSyncExternalStore`는 같은 문서의 저장·삭제와 다른 창의 storage 변경을 반영합니다. snapshot은 문자열이고 SSR 값은 빈 문자열입니다. 서버 HTML부터 개인 이름을 넣는 방식이 아니라 hydration 뒤 인증 응답을 기다리지 않고 표시하는 방식입니다. 관리자 다른 가구 조회에서는 본인 가구 cache를 사용하지 않습니다. 저장소 접근 실패는 이름만 생략합니다.
- Native는 기존 서버 응답의 `household.id`가 membership의 가구 ID와 같을 때만 `household.name`을 기존 암호화 `SessionMirror`의 선택 필드로 함께 저장합니다. 새 조회·저장소·Bridge 명령은 없습니다. 구형 응답의 누락 이름은 이전 이름을 계승하지 않습니다.
- 동일 actor의 이름 변경은 session generation을 바꾸지 않습니다. 다른 가구 전환·로그아웃은 기존 원자 snapshot 교체와 queue purge 경계를 그대로 사용합니다. 구형 저장본도 이름을 모르는 상태로 읽을 수 있습니다.
- Native 시작 레이어는 저장된 이름을 Jua로 그리며 마지막 ‘네’에 기존 보라색을 적용합니다. 기존 Bridge 응답 때 시작 레이어가 보이면 로컬 이름을 다시 읽어 반영합니다. Web과 같은 공식 Jua 원본을 Android font resource로 넣고 OFL을 보존합니다.

첫 Native 표시에는 기존 암호화 세션의 최초 로컬 읽기가 필요합니다. warm process에서는 메모리 snapshot을 읽지만 cold process에는 Keystore 복호화가 포함됩니다. 서버 왕복은 추가하지 않으며, 로컬 I/O 비용이 없다고 주장하지 않습니다. 이름을 저장하지 않던 기존 APK에서 업데이트하면 한 번 정상 세션 복원 후 다음 실행부터 Native 제목을 선행 표시할 수 있습니다.

## 검증과 추적성

| 계약 | 실제 확인 |
|---|---|
| T-LED-001 · T-WEBVIEW-004 | 기존 UI로 생성한 두 가구에서 실제 Auth accounts:lookup HTTP 200 응답만 보류하고 제목·그림이 먼저 보이는지 확인합니다. 인증 완료·Membership·원장 준비 mark와 Firestore 조회가 없는 상태를 확인한 후 Auth를 해제합니다. 기존 마지막 잔액 보류·전체 홈 표시·시안·paint 검증도 유지합니다. |
| T-LED-001 | 이름 갱신·삭제, 현재 서버 이름 우선, signed-out·첫 방문, 관리자 조회, 저장소 거부와 최소 2초/느린 조회 계약을 검사합니다. |
| T-SESSION-MIRROR-001 · AND-011 | 이름 포함 저장·복원, 구형 저장본, 가구 ID 불일치, 같은 actor 이름 변경, 다른 actor 전환, 로그아웃을 검사합니다. 이름은 권한 scope나 preference key가 아닙니다. |
| T-WEBVIEW-004 | 실제 Activity와 Keystore에서 Web 준비 전 이름 표시·동일 가구 이름 갱신·가구 변경·구형 응답·로그아웃을 확인합니다. 기존 이미지 보류·회전·Web 전환 검사도 유지합니다. |

Web 관련 단위 검사 5개 파일 63개가 통과했고, 저장소 거부·다른 UID/로그아웃 경계를 추가한 뒤 영향받은 2개 파일 36개도 통과했습니다(최종 해당 5개 파일의 검사 수 65개). 실제 Emulator·production build·WebKit의 두 가구 검사도 2 passed(1.1분)입니다. 로그는 `%TEMP%/household-startup-name-{web-unit,web-boundary,e2e}-20261015.log`입니다.

배포 대상은 Web Git 자동배포와 Android v2.0.7/code45입니다. Firebase 실행 코드와 운영 데이터는 변경하지 않습니다. 이전 v2.0.6 CI `38709693760`은 실패 이력을 덮거나 무변경 재실행하지 않고 남은 결과를 확인합니다.

Android SessionMirror unit 5개와 debug·test·release 빌드가 통과했습니다(14초). 실제 API 36.1에서 Activity 2개와 Keystore 1개 총 3개가 통과했습니다(5.581초). 첫 제목 검사의 Typeface 객체 동등성 비교는 AppCompat의 별도 래핑 객체 때문에 실패했으며, 동일한 Jua 원본의 실제 문자 폭과 스타일을 검증하도록 고쳤습니다. 최초 실패 로그는 보존합니다. 최종 Native 캡처 `%TEMP%/household-startup-name-native-20261015.png`에서 그림·제목·부제·하단 점을 확인했습니다.

실제 암호화 저장소의 재인스턴스 읽기는 7.8606ms였습니다. 이는 에뮬레이터 warm Keystore에서 한 번 관측한 값이며 실제 cold 기기의 상한으로 해석하지 않습니다. 선택적 제목 조회의 저장소 오류는 빈 제목으로 한정하고, 기존 인증·원자성·권한 검사 오류는 그대로 처리합니다. 로그는 `%TEMP%/household-startup-name-native-{build,build-followup,followup}-20261015.log`입니다.

표시용 snapshot 읽기 실패 경계를 반영한 최종 Android debug·test·release 빌드도 통과했고(5초), 실제 3개 검사를 다시 실행해 모두 통과했습니다(5.665초). API 36.1 AVD와 Firebase 에뮬레이터를 정상 종료했습니다. APK는 11,987,770바이트, SHA-256 `799b1c6e0770b81d64e5ff094af50974fea303106ad2c80500fa94014ac672cf`이며 기존 인증서의 v2 서명을 확인했습니다. 최종 로그는 `%TEMP%/household-startup-name-native-build-final-20261015.log`, `household-startup-name-native-final-20261015.log`입니다.

이전 v2.0.6 CI `38709693760`은 functions·web·android와 실제 android-instrumentation이 성공했으며 web-e2e 결과는 후속 확인합니다. 요구사항 catalog 248개·test case 235개, E2E 추적 누락 0개를 확인했습니다.

사용자의 재현 보고로 구형 운영 표시 목록의 버전 누락이 서버 가구명 응답 자체를 생략하는 문제와 Web 첫 HTML의 빈 제목 구간을 추가 확인했습니다. 최초 검증이 놓친 경계와 수정은 [후속 원인·검증 기록](startup-name-legacy-metadata-2026-10-15.md)에 보존합니다. 이 문서의 최초 검증만으로 실제 운영 재실행의 이름 선행 표시가 보장되었다고 해석하지 않습니다.
