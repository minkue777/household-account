# 시작 가구명 지연 재조사와 앱 이름 변경

## 확인한 원인

v2.0.7 후에도 가구명이 늦게 나타난다는 보고로 실제 운영 조회와 호출 경로를 다시 확인했습니다. 또니망고네의 표시용 `household.members` 3개에는 ID·이름이 있지만 `aggregateVersion`이 없었습니다. 생성 시각과 가구 이름은 존재했습니다. 운영 문서는 읽기만 했습니다.

서버의 `householdView`는 표시 목록의 버전이 하나라도 없으면 가구 metadata 전체를 생략했습니다. Web은 별도 가구 조회에서 누락 버전을 1로 읽어 이름을 표시했지만, Native는 서버 응답에 이름이 없어 암호화 SessionMirror에 저장하지 못했습니다. 따라서 한 번 접속한 뒤에도 같은 문제가 반복될 수 있었습니다. 이전 Native 검사는 이름이 있는 응답 Map을 직접 준비하여 이 실제 서버 경계를 놓쳤습니다.

Web에도 별도 표시 공백이 있었습니다. 서버 HTML은 그림과 빈 제목을 내보내고, hydration 이후에만 localStorage 이름을 채웠습니다. 인증 응답을 보류한 이전 검사는 인증보다 이름이 먼저 나오는 것만 확인했으며, 그림과 이름의 첫 프레임 일치는 확인하지 못했습니다.

## 입력·결과·실패·저장 계약

- 로그인 세션 복원 계약: 구형 embedded 표시 목록의 버전 필드가 **누락된 경우만** 응답에서 1로 정규화합니다. 현재 정상 버전을 유지하고 명시적인 잘못된 값은 종전대로 거부합니다. canonical Member·Membership의 인증과 버전 검증은 유지합니다. 데이터 migration이나 운영 쓰기는 없습니다.
- LED-001/T-LED-001: 기존 cache의 표시 이름을 초기 문서에서 안전한 텍스트로 읽어 그림과 함께 표시합니다. 인증과 금융 조회는 기존 검증 경로를 유지합니다. 추가 사용자 요청에 따라 관리자 대상 선택·저장소 거부·cache 손상·이름 없음에서는 앱 이름 `모두의 가계부`를 표시하며, 확정 로그아웃과 다른 사용자 전환에서 이전 이름을 지웁니다.
- AND-011/T-SESSION-MIRROR-001: 실제 서버의 구형 표시 metadata 응답으로 이름을 받아 기존 암호화 저장소에 보존하는지 검사합니다. 첫 접속에서 정상 이름을 저장한 다음 실행부터 Native에 선행 표시됩니다.
- 앱 표시는 Android launcher, PWA manifest의 name/short_name, Web 문서와 Apple 홈 화면 제목을 `모두의 가계부`로 통일합니다. 사용자 확인에 따라 로딩의 가구명과 `가계부 · 자산` 부제, 그림·배치·최소 2초는 유지합니다. 앱 이름 변경은 Android v2.0.8/code46으로 배포했고, 아래 가구명 없는 경우의 앱 이름 표시는 v2.0.9/code47 대상입니다.

## 검증

서버의 새 회귀는 수정 전 이름 누락으로 실패했고, 수정 후 resolver·WebView 세션 발급 44개와 타입 검사가 통과했습니다. 실제 Firestore Emulator의 온보딩 → 구형 표시 목록 → resolver → WebView 세션 응답과 기존 통합 검사 7개가 통과했습니다. 누락 버전 정규화는 저장 문서를 바꾸지 않습니다.

실제 Native 검사는 API 36.1에서 Auth SDK → Functions SDK → `NativeMembershipResolver.refresh` → 암호화 SessionMirror와 재인스턴스 저장소 읽기를 거쳐 1개 통과했습니다(1.259초). canonical Member의 updateTime 불변과 embedded 구형 데이터의 미이관도 확인했습니다. 처음에는 새 fixture에 embedded 목록 자체가 없어서 제품 경로 전에 실패했고, 실제 canonical 멤버로 구형 목록을 구성하도록 fixture를 고친 뒤 통과했습니다. 최초 실패 로그를 보존합니다. 로그는 `%TEMP%/household-startup-name-real-native-fixture-20261015.log`입니다.

앱 이름 변경을 포함한 Android release build가 통과했습니다(13초). APK package label은 `모두의 가계부`, versionName은 `2.0.8`, code는 46입니다. 11,987,782바이트, SHA-256 `811a9971264dd3b520950b8cc2586bceaf647750ffa74261b87193a22a470b9b`이며 기존 인증서의 v2 서명을 확인했습니다.

Web 관련 단위 5개 파일 57개(CSP 포함)와 타입 검사가 통과했습니다. 실제 production build·Emulator·WebKit 두 가구 검사는 2 passed(57.8초)입니다. UI가 자연스럽게 저장한 이름을 사용하고 Next JS 청크를 보류한 상태에서 그림의 첫 frame에 이름이 함께 있으며 Auth·Firestore 요청이 0인지 확인했습니다. 청크 해제 후 hydration 오류 없이 기존 인증 보류·마지막 잔액 보류·전체 홈 표시·최소 표시시간 검사를 유지했습니다. 사용자별 이름이 서버 HTML에 포함되지 않고 기존 CSP의 정확한 inline hash에 포함되는 것도 확인했습니다.

첫 prototype은 Next server compiler가 함수 내부 `typeof window` 분기를 상수평가해 직렬화한 함수가 빈 문자열만 반환하도록 바뀌어 실제 build 검사가 실패했습니다. 함수의 외부 환경 분기를 제거하고 기존 저장소 접근 예외 경계에서 SSR 빈 값을 처리하도록 수정했습니다. 최초 실패와 generated HTML을 보존하며 기대값·시간 제한을 약화하지 않았습니다. 로그는 `%TEMP%/household-startup-name-first-frame-{e2e,e2e-fixed,unit-final}-20261015.log`입니다.

이전 CI 실패/진행 이력은 성공으로 덮지 않습니다. 배포 대상은 Firebase 세 codebase·Web Git 자동배포·서명 Android APK이며 운영 가계부 데이터는 변경하지 않습니다. 배포용 기존 로그인 복원과 재시도가 `auth/network-request-failed`로 실패해 실제 Firebase 로그인 smoke가 준비되기 전에는 서버 배포 완료로 보고하지 않습니다. Web·APK는 기존 서버와 호환되므로 독립 배포합니다.

## 배포 확인과 로그인 차단

제품 후보 `91f6296e741ad0ad65f2510f2daeb8eeade2be13`의 Vercel Git 배포와 GitHub Production deployment `7089317359`가 성공했습니다. 운영 문서·서비스 워커의 정확한 SHA, 해당 build manifest의 HTTP 200, Web/Apple 제목과 PWA name/short_name의 `모두의 가계부`를 확인했습니다. v2.0.8 GitHub Release의 APK를 다시 내려받아 HTTP 200·크기·위 SHA-256·기존 v2 서명을 검증했습니다. 이전 `38712095725` CI는 다섯 검사·요약 모두 성공했습니다. 제품 후보의 CI는 `38715579310`으로 별도 추적합니다.

Firebase manifest `release-20261015-startup-name-91f6296`의 배포 전 검사는 승인됐으나 실제 배포는 시작하지 않았습니다. 로그인 재시도에서도 내장 브라우저는 `auth/network-request-failed`를 표시했고, 공개 Firebase 설정 주소를 직접 열었을 때 `net::ERR_BLOCKED_BY_CLIENT`를 반환했습니다. OS에서 같은 공개 설정 요청은 HTTP 200이며 localhost Origin/CORS와 authorizedDomains도 정상입니다. SDK·Google API script·Auth iframe도 OS에서는 HTTP 200입니다. 이는 브라우저 경로의 차단 증거이며, 정확히 어떤 설정이나 정책이 차단했는지는 아직 확정하지 않았습니다. 인증 자격을 출력하거나 다른 인증으로 smoke를 대체하지 않았습니다.

별도로 로그인 도구는 팝업 결과를 버리고 `onAuthStateChanged`에만 완료 제출을 맡기고 있었습니다. 같은 UID로 재로그인하면 SDK가 해당 이벤트를 다시 보내지 않으므로, 갱신 실패 뒤 팝업 로그인이 성공해도 제출을 놓칠 수 있었습니다. 팝업의 `result.user`를 직접 제출하고 진행 중 Promise를 공유해 최초 이벤트와 결과가 겹쳐도 갱신·제출을 한 번만 실행하도록 수정했습니다. 실제 도구 HTML 스크립트에서 두 경로를 실행하는 회귀는 수정 전 실패, 수정 후 기존 CLI 경계 포함 6개 통과했습니다. 타입·Node 문법 검사도 통과했습니다. 이 도구 수정은 브라우저 네트워크 차단을 해결하지 않으며 앱 runtime·APK를 다시 배포할 변경은 아닙니다.

## 첫 그림 frame의 빈 이름과 HTML 파싱 순서

[제품 CI 38715579310](https://github.com/minkue777/household-account/actions/runs/38715579310)에서 `ios-startup.spec.ts:393`의 또니망고네·익태송희네 두 검사가 실패했습니다. 제목은 뒤에 정상 표시됐지만, 이미지가 준비된 최초 frame 기록에 빈 제목이 있었습니다. `img.complete`·`naturalWidth`만으로 실제 paint까지 확정할 수 없으며 CI filmstrip에는 그림만 나타난 장면이 잡히지 않았습니다. 앞서 로컬에서 통과한 2건과 이번 CI 실패를 모두 유지합니다.

별도 재현은 실제 production HTML·CSP·CSS·이미지·글꼴을 사용한 WebKit에서 수행했습니다. Next JS 청크를 차단하고 body 끝 이름 스크립트 직전에서 HTML 전송을 보류하자, 그림·부제·점이 보이는데 제목은 비어 있는 스크린샷을 얻었습니다. 이때 그림은 198×198px, `visibility=visible`·`display=block`·`opacity=1`이고 글꼴도 `loaded`였습니다. HTML 뒤쪽을 재개하면 이름이 채워졌습니다. 따라서 전송·파싱 중단 위치에 따라 생기는 제품의 표시 공백은 재현됐으며, CI의 특정 frame이 실제 paint됐는지는 이 재현과 구분합니다. 운영 가구 데이터는 조회하거나 변경하지 않았습니다.

원인은 RootLayout body 끝의 동기 스크립트보다 그림 DOM이 먼저 파싱되는 순서였습니다. 최소 수정은 `AppLoadingScreen` 안의 DOM을 `h1` → 동기 스크립트 → `Image`로 배치하고 CSS `order`로 기존 그림 → 이름 → 부제 화면을 유지하는 것입니다. 별도 숨김 상태·observer·타이머는 추가하지 않습니다. 이름은 기존 reader와 `textContent`로 채우며, 클라이언트 재표시는 기존 `useSyncExternalStore`가 담당합니다. 제목 span의 로컬 텍스트와 script의 서버·클라이언트 minifier별 직렬화 차이만 hydration 경고에서 제외합니다. 그 외 hydration 오류와 CSP 위반은 계속 실패로 검사하고, CSP는 최종 HTML의 정확한 inline hash를 사용합니다.

재현 스크립트는 `%TEMP%/household-startup-split-html-proof-20261015.cjs`, 관측값은 같은 이름의 `.json`, 화면은 `%TEMP%/household-startup-{before,after}-name-proof-20261015.png`에 보존했습니다. 스크린샷 도구가 문서 끝까지 글꼴 준비를 기다리지 않도록 도구의 폰트 대기만 끄고, 실제 브라우저의 글꼴·그림 상태는 별도로 기록했습니다. 로컬 서버와 브라우저는 종료했습니다.

저장소 회귀는 실제 HTML 분할 전송 대신 이름 초기화 앞에 임시 외부 blocking script를 넣어 HTML 파서를 중단하고, 별도로 JS 청크를 보류합니다. 첫 시도는 기대한 첫 그림 frame 검사를 통과했으나 임시 script가 DOM에 남아 React hydration 418/423 오류가 발생했습니다. fixture가 실행 직후 자신을 제거하도록 수정한 뒤 production build·실제 Emulator·WebKit 두 가구 검사가 2 passed(54.1초)였습니다. 기존 인증·전체 홈 준비·최소 2초·정상 hydration·CSP 검사를 유지했습니다. 최초 실패와 수정 후 결과는 `%TEMP%/household-startup-parser-order-e2e-20261015.log`, `%TEMP%/household-startup-parser-order-e2e-fixed-20261015.log`에 보존합니다. 이전 CI `38716870276`은 익태송희네의 같은 첫 frame assertion 1건 실패·113건 통과로 끝났으며 다른 새 실패는 없었습니다.

## 가구명이 없을 때의 앱 이름 표시

사용자가 가구명이 없으면 `모두의 가계부`를 보여 달라고 요청하여 Web/PWA·Android의 시작 제목 계약을 통일합니다. 현재 확인된 가구명과 각 플랫폼의 기존 저장소에서 사용할 수 있는 이름을 우선합니다. 첫 설치·이름 없음·저장소 누락·손상·접근 거부와, Web 관리자 조회·확정 로그아웃처럼 이전 가구명을 표시하면 안 되는 상황에서는 앱 이름을 표시합니다. 이전 가구명을 복원하거나 앱 이름으로 인증 scope를 만들지 않습니다. 서버 HTML에도 개인 이름 대신 앱 이름을 넣습니다.

Native는 기존 암호화 SessionMirror를 읽고 Web은 기존 표시용 reader와 동기 초기화·store 갱신을 사용합니다. 별도 이름 cache·조회·Bridge를 만들지 않고 그림·부제·배치·최소 2초·기존 권한 검증은 유지합니다. Android 배포 후보는 v2.0.9/code47이며 Web Git 배포·APK 공개·전체 CI 결과는 해당 commit의 실행과 Release에서 확인합니다.

Web 관련 단위 검사 3파일 26개와 타입 검사가 통과했습니다. Android SessionMirror 단위 5개와 실제 API 36.1 Activity 2개(6.432초), debug/test/release build도 통과했습니다. 세로·가로에서 앱 이름이 한 줄·말줄임 없이 제목 너비 안에 표시되고, 이름 없음·공백·로그아웃에서는 앱 이름을 표시하되 SessionMirror에 가구명으로 저장하지 않는지 확인했습니다. 기존 가구명 우선·‘네’ 강조도 유지합니다. 서명 APK는 11,987,782바이트, SHA-256 `6001e3219089acad66c73d0d4ab2438c1c7ff65cc5e87983659d2b51cb1fc989`이며 기존 인증서의 v2 서명을 확인했습니다. Android 로그는 `%TEMP%/household-startup-fallback-android-{build,instrumentation}-20261015.log`입니다.

앱 이름 fallback까지 적용한 최종 production build·실제 Emulator·WebKit 검사는 4 passed(1.4분)입니다. 빈 저장소의 JS 청크 전 앱 이름, 두 가구의 파서 중단·인증 전 이름과 전체 홈 준비, 무응답 오류·재시도를 확인했습니다. 최소 표시시간과 CSP·hydration 검사는 유지했습니다. 로그는 `%TEMP%/household-startup-name-fallback-{unit,types,e2e-final}-20261015.log`이며 로컬 Emulator는 종료했습니다.

## 비대화형 smoke 전환 후 서버 배포 완료

위 로그인 차단과 당시 Firebase 배포 대기 이력은 그대로 보존합니다. 이후 사용자 요청으로 [배포 기본 smoke 계약](firebase-noninteractive-smoke-2026-10-15.md)을 변경하여 사람의 가계부 로그인 없이도 정확한 배포 marker와 비로그인 권한 거부를 확인하게 했습니다.

2026-10-15 서버 SHA `ac3da95dcb1c9a41723d2491bd1b06075ff7c537`, manifest `release-20261015-noninteractive-smoke-ac3da95`의 Firebase 세 codebase 배포를 완료했습니다. 정확한 `releaseId`·`commitSha`·`artifactSha256` marker와 기존 가구 Query의 비로그인 `AUTH_REQUIRED` 응답 smoke가 성공했습니다. 이는 실제 사용자의 운영 로그인·Membership 승인·허용된 가구 조회 성공을 검사한 결과는 아닙니다. 해당 사용자 접근은 기본 smoke에서 미검증이며 제품 인증·인가와 CI·Emulator·E2E 검증은 유지합니다.
