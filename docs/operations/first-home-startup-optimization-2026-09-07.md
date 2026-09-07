# 모바일 첫 홈 로딩 경로 개선

2026-09-07 작업 트리에서 Android 앱과 iPhone PWA의 반복 실행 경로를 조사했다. 기존 최적화 작업은 보존하며, 관리자 조회 배너의 검은 영역 현상은 사용자가 재현하지 못해 보류했다. 이번 조사에서 운영 데이터는 변경하지 않았다.

## 확인한 병목과 변경

### iPhone PWA 인증 복원

기존 `authService`의 일반 브라우저 경로는 Firebase `getAuth(app)`의 기본 popup resolver를 설치했다. 설치된 SDK는 모바일·Safari 환경에서 기존 사용자 복원 전에 해당 resolver의 외부 GApi 스크립트와 iframe 초기화를 기다릴 수 있다. 이미 로그인된 사용자의 첫 홈에도 팝업용 준비가 선행했다.

`initializeAuth`에 기존 persistence 순서인 IndexedDB → localStorage → sessionStorage만 전달하고, 팝업 resolver는 실제 `signInWithPopup` 호출의 세 번째 인자로 옮겼다. Firebase가 공식적으로 설명하는 [모바일 초기화 최적화 방식](https://firebase.google.com/docs/auth/web/custom-dependencies)이며 [팝업 로그인 API](https://firebase.google.com/docs/reference/js/auth#signinwithpopup)의 공개 인자를 사용한다. 계정 lookup·토큰 검증·observer·로그아웃은 그대로이며, Android의 localStorage persistence도 유지한다.

실제 설치 SDK를 별도 browser bundle로 만든 제어 실험에서 iPhone User-Agent를 설정한 Chromium과 같은 가짜 영속 로그인 사용자를 사용했다. 계정 조회는 같은 유효한 모의 응답을 반환하고 GApi 요청만 1,500 ms 뒤 실패시켰다. 외부 요청은 모두 로컬 테스트에서 가로챘으며 운영 인증 정보는 사용하지 않았다.

| 관찰 | 기존 `getAuth` | 변경한 `initializeAuth` |
| --- | ---: | ---: |
| Auth observer까지 | 1,531.3 ms | 14.3 ms |
| 팝업용 GApi 요청 | 1 | 0 |
| 계정 lookup 요청 | 1 | 1 |
| 같은 사용자 복원 | 성공 | 성공 |

이는 불필요한 외부 준비 대기를 제거했다는 증거다. 실제 Safari·iPhone 기기의 성능이나 전체 앱 로딩 감소 폭을 뜻하지 않는다. 정상 네트워크에서 항상 1.5초가 줄어드는 것도 아니다. 실험 스크립트와 결과는 로컬 임시 디렉터리의 `first-home-auth-probe-20260907/run.cjs`, `results.json`에 있다.

### Android 메인 스레드의 세션 읽기

`MainActivity.showWebView`가 캡처 재전송을 예약하기 전에 `HouseholdPreferences`를 메인 스레드에서 읽었다. 첫 snapshot 접근은 SessionMirror 초기화, 디스크 읽기와 Keystore 복호화에 도달하며, Application의 IO 초기화가 같은 lock을 가지고 있으면 메인 스레드가 기다릴 수도 있었다.

세션 조건 확인을 기존 process IO coroutine의 예약 검사 안으로 옮겼다. 한 snapshot의 존재와 memberName을 검사하므로 기존 조건과 같으며, 조건 확인 → 미전송 큐 확인 → WorkManager 예약 순서를 유지한다. 새 coroutine scope나 캐시는 만들지 않았고 Activity가 종료되어도 기존 process 작업은 유지한다.

WebView bridge를 만들 때 NativeAuthCoordinator를 즉시 생성하던 것도 첫 `auth.sign-in`·`auth.sign-out`·`session.refresh` 호출 시점으로 옮겼다. 앱 버전·시작 시간 조회는 Native 인증 객체를 생성하지 않는다. 초기화 시점만 옮겼으며 필요한 인증 작업을 생략하지 않는다. 이후 session refresh가 호출되면 인증 객체는 생성되므로 전체 앱에서 초기화 횟수가 사라졌다는 의미는 아니다.

### 홈 설정 조회의 불필요한 Command 코드

홈은 `useHomePreferences`로 설정을 읽지만 같은 파일의 static import 때문에 Command transport와 Firebase Functions 코드까지 초기 bundle에 포함됐다. 두 저장 함수에서만 기존 Command runtime을 동적으로 불러오도록 바꿨다.

이 변경만 반영한 production manifest의 `/layout`과 `/page` JS 파일을 중복 제거하여 비교하면 원본 JS 합계는 1,089,704 → 1,074,938 bytes, 파일별 gzip 합계는 322,534 → 317,251 bytes로 줄었다. gzip 기준 5,283 bytes(약 1.6%)의 작은 개선이며 서버 호출이나 실제 기기 시간 감소를 뜻하지 않는다. 별도 동적 chunk까지 포함한 전체 앱 다운로드 크기는 아니다. 결과는 임시 디렉터리의 `first-home-bundle-before-20260907.json`, `first-home-bundle-after-20260907.json`에 남겼다.

## 유지한 동작

- 동일 사용자 bootstrap cache가 있으면 서버 Membership 재해석은 이미 생략하며 가구 metadata 갱신도 원장과 병렬이다. 이 경로에 추가 인증 캐시를 만들지 않았다.
- 월 원장·카테고리·지역화폐는 첫 서버 snapshot 이후 표시한다. 오래된 금융 데이터를 먼저 보여주거나 성공 측정 시점을 앞당기지 않았다.
- 첫 홈 완료 뒤 실행하는 방문 기록·다른 route 및 인접 월 미리 읽기는 유지한다.
- 자주 쓰는 지출 추가·수정 UI는 첫 클릭의 chunk 대기를 다시 만들지 않도록 현재 정적 구성을 유지한다.

## 검증과 반영 상태

- Web 전체 활성 테스트: 99개 suite / 606개 통과. 브라우저 인증 초기화·팝업 성공/취소/차단 후 재시도·로그아웃 검사를 포함한다.
- Firebase Emulator 브라우저 E2E: 로그인, 가구 생성, 첫 월 원장, 지출 CRUD, 통계 기간 전환과 알림 편집 진입 검사 1개 통과.
- 최종 Web production build 통과. 정적 HTML 12개·CSP hash 25개·root worker 1개 산출물 검증 및 해당 빌드의 PWA E2E 2개 통과.
- Android 단위 테스트 114개와 API 36.1 에뮬레이터 검사 18개 통과. 신규 검사는 세션 조건 확인이 실제 메인 스레드 밖에서 실행되고, bridge의 metadata 조회가 인증 객체를 만들지 않으며 실제 인증 경로에서 생성이 시작되는지 확인한다. lintDebug, assembleDebug, assembleRelease 통과.
- `git diff --check` 통과. Android 에뮬레이터는 검증 후 종료했다.

Web 로그는 로컬 임시 디렉터리의 `first-home-web-tests-final-20260907.log`, `first-home-web-e2e-20260907.log`, `first-home-web-build-final-20260907.log`, `first-home-web-pwa-20260907.log`에 있다. Android 결과는 `android/app/build/test-results/testDebugUnitTest`와 `android/app/build/outputs/androidTest-results/connected/debug`에 있다.

실제 iPhone Safari/PWA에서 Google 최초 로그인·취소·재로그인은 아직 확인하지 않았다. 해당 동작은 공개 SDK API와 단위 테스트로 검증했으며, 실제 기기 사용성과 성능 검증을 대신하지 않는다.

이번 변경은 아직 커밋·push·Vercel 배포·APK 릴리스하지 않았다. 실제 개선 폭은 Web 변경 반영과 새 APK 설치 후 같은 기기·비슷한 네트워크의 운영 표본으로 확인해야 한다.
