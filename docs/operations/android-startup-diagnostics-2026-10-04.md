# Android 첫 홈 구간별 계측

## 요구사항과 범위

AND-014 / T-ANDROID-STARTUP-001, ADM-006 / T-ADM-005: 기존 Activity 생성부터 첫 전체 홈 표시까지의 총시간을 유지하면서 Native 준비·Web 로그인·서버 조회·paint를 구분한다. 계측만 추가하며 초기 Lite 조회는 계속 iPhone PWA에만 적용한다. 추가 사용자 자료 조회, 금융 자료 수정, 화면 완료 기준 변경은 없다.

## 상세 설계와 계약

- 기존 `performance.get-app-launch-duration` 응답의 `durationMs`는 유지한다. 선택 `startupTimingsMs.webViewReady`는 WebView 설정 완료, `navigationRequested`는 최초 navigation 복원 또는 URL 로드를 요청하기 직전이다. 모두 Activity clock 시작 기준 ms이며 최초 한 번 기록하고 총시간 소비 뒤에는 변경하지 않는다. 권한 화면 대기는 두 mark 사이에 포함될 수 있다. process 시작이나 실제 네트워크 요청 시각으로 해석하지 않는다.
- `clientStartupDiagnostics` v1의 기존 `timingsMs`, visibility, cache는 Web navigation 기준이다. Android에서만 선택 `android`를 추가하며 `webDurationMs`는 첫 paint의 Web 시각, `bridgeRoundTripMs`는 기존 Native 시간 요청 왕복, 선택 `nativeTimingsMs`는 위 Native 관측이다. Native clock과 Web clock을 차감하여 WebView 준비 시간을 추정하지 않는다.
- 기존 총시간은 Native bridge 처리까지 포함하는 관측 의미를 유지한다. Web 진단은 bridge 응답을 기다리기 전에 동결한다. bridge 대기 중 도착한 snapshot이나 visibility 전환은 첫 paint 구간에 추가하지 않는다.
- Android 진단은 Web 시각을 `webDurationMs` 안에서, Native mark를 기존 `durationMs` 안에서 각각 검사한다. 각 시간과 bridge 왕복은 0~120초의 유한 숫자만 허용하고 Native mark의 순서를 검증한다. URL·토큰·사용자/가구/거래 식별자·금액·메모와 임의 키는 허용하지 않는다. 손상 진단은 생략하고 기존 접속·총시간은 보존한다.
- 구 APK의 총시간만 있는 응답도 Web 구간을 기록하며 없는 Native mark를 0으로 채우지 않는다. 구 Web/진단 없는 payload와 iPhone v1은 그대로 지원한다. 같은 Activity reload의 소비된 총시간은 새 표본을 만들지 않는다. 일반 Web은 대상이 아니다.
- 기존 `clientStartup` total 로그 하나와 접속 명령을 재사용한다. 새로운 네트워크 요청·Firestore 진단 문서·주기 작업은 추가하지 않는다. 서버 allowlist를 선행 배포한 뒤 Web Git 자동배포와 새 서명 APK를 공개한다.

## 검증과 추적성

| 계약 | 검증 |
|---|---|
| Native mark 최초 기록·단조 시계·총시간 소비 뒤 동결 | ActivityStartupGatesTest |
| Android Web 구간·두 시계 분리·bridge 지연 중 동결·구 APK 호환·계측 실패 무간섭 | clientStartupDiagnostics / clientStartupObservation 계약 검사 |
| Android 상세 진단을 켜도 Lite 추가 조회 미실행 | initialHomeRead 계약 검사 |
| allowlist·범위·순서·구버전·손상 진단 생략·실제 logger·중복 방문 억제 | client-startup-diagnostics / member-access-app-visit-latency 서버 검사 |
| 실제 Activity→origin 제한 bridge→Web→Emulator Command→서버 로그의 동일 진단, 최신 홈과 reload 1회 계측 | WebStartupFirebaseE2ETest 및 native-firebase runner |
| 기존 iPhone 초기 조회와 진단 | ios-startup WebKit E2E |

로컬 Web 관련 6파일 54개(최초 50개와 추가 손상 Native 관측 4개), 서버 2파일 110개, Native 준비 2suite 8개 및 Web 타입 검사가 통과했다. Emulator 준비의 Functions architecture 45개와 세 codebase 빌드가 통과했다. Android v1.2.32/code34 release 빌드와 APK v2 서명을 확인했다. 실제 Native→Web→서버 및 WebKit 회귀는 별도로 수행한다. 실기기 효과를 측정하는 작업이며 로컬 Emulator의 절대시간을 운영 성능으로 보고하지 않는다.

로그는 저장소 밖 TEMP/household-android-diagnostics-{web-unit,functions-unit,native-unit,prepare,apk,native-e2e,ios-e2e}-20261004.log에 둔다.

첫 Native 실행은 실제 Android E2E 4개가 통과했으나 runner의 신규 로그 대조에서 실패했다. Firebase CLI가 runtime JSON 뒤에 metadata JSON을 이어 쓰는 형식을 한 JSON으로 해석한 관측 도구 오류다. 따옴표·escape·중첩을 유지하며 첫 JSON 객체만 읽는 parser와 형식 회귀 3개를 추가하고, 실제 서버 진단 전체 동등성·1회 로그 assertion을 유지한다.

Web 전체 단위 검사 123파일 882개가 통과했다. 서버 `9528a559e1660c60e01259f7526c423ce9fdef4e`는 release-20261004-android-startup-9528a55로 세 codebase 배포, 실제 로그인·가구 Query·release marker 및 provenance 기록을 완료했다. 두 번째 Native 실행도 Android 검사 4개는 통과했으나 동시 실행한 배포 도구가 공용 firebase-debug.log를 정리하여 로그 대조만 실패했다. 이후 배포와 Emulator 검사를 순차 실행한다. 후속 Web 보정은 진단 동결 작업을 bridge 왕복 구간에서 제외하며 서버 재배포나 APK 내용 변경은 없다.
