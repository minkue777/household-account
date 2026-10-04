# Android 첫 홈 서버 조회와 실시간 구독 전환

## 근거와 요구사항

2026-10-04 22:25 KST 운영 재실행 3건의 전체 시간은 2,319 / 2,251 / 1,656ms였다. 로그인 복원은 1,278.3 / 354.5 / 360.7ms, 주요 데이터 수신 대기는 421.6 / 1,521.1 / 877.2ms였고 준비 후 paint는 12.3~17ms였다. 인증 갱신 이후 대기와 Firestore 연결·서버·전송 내부 원인을 각각 확정한 것은 아니다. 운영 효과는 후속 상세 로그로 비교한다.

AND-012 / T-WEBVIEW-004, AND-014 / T-ANDROID-STARTUP-001, SYS-008 / T-SYS-008의 첫 서버 자료·최신 값·계측 기준을 유지하면서 iPhone의 초기 Lite 조회를 Android WebView 첫 홈에도 적용한다. 이번 변경은 로그인 복원이나 Native 준비 시간을 바꾸지 않는다.

## 상세 설계와 계약

- 현재 월 원장, 카테고리, 홈 설정, 지역화폐 잔액을 기존 Auth·Rules를 공유하는 Firestore Lite로 조회한다. 각 조회의 실제 서버 결과를 기존 mapper와 optimistic projection에 반영한 뒤 같은 원본의 실시간 구독을 연다. 공유 홈 설정의 조회·구독도 하나를 유지한다.
- 초기 조회는 첫 홈이 준비되기 전 문서 실행당 원본별 한 번이다. 일반 브라우저, 다른 route, 이후 월 이동·재연결은 기존 구독을 즉시 시작한다. 가구 metadata는 기존 병렬 비차단 갱신을 유지한다.
- 동적 코드 로드 포함 예산은 Android 2,000ms, iPhone 750ms이다(아래 후속 조정 근거 참조). 초과·조회/해석 실패면 기존 구독으로 한 번 복귀하며 늦게 끝난 Lite 응답을 영구 폐기한다. 조회·해석 실패는 예산을 기다리지 않는다. 구독 시작 전 취소·세션/가구 scope 변경은 timer와 응답을 무효화한다. 무응답 시 Android 구독 시작이 최대 2,000ms 늦어지는 비용과 첫 홈의 추가 읽기 비용은 운영 평가에 포함한다. 네 조회는 병렬이며 예산이 합산되지 않는다.
- Lite보다 먼저 구독을 열어 이전 서버값이 새 값을 덮는 race를 만들지 않는다. 첫 watch cache는 무시하고 실제 서버 snapshot부터 적용한다. 수정·삭제 pending과 실패 rollback, QuickEdit feedback은 기존 projection을 통과한다.
- 기존 InitialReadStarted/Received/Fallback을 Android 상세 진단에도 기록한다. Native/Web 시간 기준, 첫 최신 홈 paint와 동일 Activity 1회 총시간 규칙을 유지한다. 서버는 해당 필드를 이미 지원한다. 운영 자료·로그 필드·APK 계약 변경은 없다.

## 계약 테스트와 추적성

| 요구사항 / 계약 | 검증 |
|---|---|
| AND-012 / T-WEBVIEW-004: 양쪽 모바일의 성공→구독 순서, Android 2,000ms/iPhone 750ms 복귀, 늦은 응답·해제·세션 교체, 문서당 1회, 일반 Web 제외 | initialHomeRead.contract.test.ts의 iPhone/Android 계약 |
| 수정·삭제 pending/rollback, cache 무시, 설정 공유·구독 복구 | 같은 계약 파일의 실제 projection·공유 read model 검사 |
| AND-014 / T-ANDROID-STARTUP-001: 실제 Android Activity/bridge/Auth/Lite/서버 로그, Listen 대기 중 최신 첫 홈, 구독 전환 뒤 최신 변경, reload 계측 1회 | WebStartupFirebaseE2ETest 및 native-firebase runner |
| SYS-008 / T-SYS-008: iPhone의 기존 초기 조회·구독 전환·로그인·paint 유지 | ios-startup.spec.ts 실제 WebKit/Emulator 검사 |

요구사항·설계와 계약을 먼저 갱신한다. Web Git 자동배포만 필요하며 Firebase와 APK 재배포는 필요하지 않다. 검증 결과는 로컬 TEMP/household-android-initial-* 로그 및 해당 커밋 CI로 확인한다. 에뮬레이터의 절대시간을 실기기 성능 개선으로 주장하지 않는다.

## 로컬 검증

변경 전 성공→구독 순서 검사를 Android/iPhone에 실행하여 Android 실패와 iPhone 통과를 확인했다. 구현 후 초기 조회·진단·시계·Android runtime 관련 4파일 50개, `tsc --noEmit`, 요구사항 catalog와 E2E 추적성 생성이 통과했다. 실제 Native 전송 보류·구독 전환 및 iPhone 회귀는 production build와 Emulator로 별도 검증한다.

실제 API 36.1 Android/production Web/Firebase Emulator 검사 4개, 후속 Native→Web Chromium 1개, iPhone WebKit 회귀 3개가 통과했다. Android에서 실제 Listen 전송을 보류한 동안 네 Lite 조회 성공으로 첫 홈을 표시하고, 해제 후 지역화폐 변경과 reload 최신 값·동일 Activity 계측 1회를 검증했다. 실제 서버 logger와 기기 진단 전체 동등성 및 로그 1회도 통과했다. 운영 `cbe4b52f2e5cb891f86a17eaafc60248d532e052`의 Git 자동배포와 `/`, `/sw.js`, build manifest HTTP 200 및 버전을 확인했다.

## 후속 CI 관측 보강

CI 37206047688의 Web 단위 검사는 통과했으나 기존 PWA worker 활성화 검사에서 15초 뒤에도 controller URL이 `/sw.js`여서 `?candidate=2` 기대와 달랐다. trace에서 후보 script HTTP 200, waiting 존재, 버전 handshake 응답과 활성화 메시지 전송은 확인했다. 당시 active/waiting/installing 상태는 없어 활성화 중단 원인을 확정하지 못했으며 Android Lite의 제품 결함으로 단정하지 않는다. 같은 production 빌드의 로컬 원본 검사 2개는 통과해 실패가 재현되지 않았다.

기존 CSP·cache·잘못된 버전 거부 검사를 유지하며 후보 waiting URL, 실제 active/controller의 정확한 후보 URL·activated 상태를 검증한다. 15초 제한이나 재시도는 바꾸지 않는다. worker statechange/controllerchange의 읽기 전용 관측과 최종 registration 상태를 첨부하여 재발 시 설치·활성화·제어권 전환을 구분한다. 원인 해결로 표현하지 않고 새 CI 결과와 과거 실패 이력을 함께 유지한다.

관측 보강 뒤 production PWA 검사 5개(15.6초)와 타입 검사가 통과했다. 이 후속 변경은 테스트·문서뿐이며 추가 제품 배포 대상은 없다. 원 실행의 실제 Android instrumentation과 남은 Web E2E도 함께 추적한다. 관련 로그는 TEMP/household-android-initial-{native-e2e,ios-e2e,pwa-build,pwa-repro,pwa-observation}-20261004.log, CI 원본과 trace는 TEMP/household-android-initial-ci-{web,pwa}-37206047688에 보관한다.

### Native 성공 경로와 복귀 경로의 분리

원 실행의 실제 Native startup 검사는 Listen을 보류한 상태에서 첫 홈 완료를 90초 기다리다 실패했다. API 34/WebView 113 로그에 보류된 Listen의 10초 offline·45초 transport timeout이 남았으며 초기 Lite별 완료·fallback은 첫 paint 이전 실패라 전송되지 않았다. 어느 초기 자료가 750ms를 넘겼거나 세션 교체로 취소됐는지는 원 자료만으로 확정하지 않는다. 단, 성공 경로 검사가 최초 로그인·코드 준비를 함께 수행하면서 fallback의 유일한 Listen 경로까지 보류한 구조는 정상 fallback을 검증할 수 없었다.

실제 앱의 일반 최초 실행이 최신 첫 홈과 방문 Command까지 완료되는 것을 먼저 확인한 뒤, 새 Activity 재실행에서 Listen을 보류하고 네 Lite 성공·750ms 기준·서버 snapshot 없는 첫 홈 assertion을 그대로 검사한다. 같은 Activity reload에서는 반대로 실제 Lite 응답만 보류하고 기존 구독이 최신 잔액 36,890원을 표시해야 한다. 구독으로 47,901원까지 변경한 뒤 보류된 이전 Lite 응답을 전달해도 최신 값이 유지되는지 추가 검증한다. 숫자는 고정 demo fixture이며 운영 자료를 사용하지 않는다. 지연된 실제 응답만 전달하며 가짜 데이터·시간·성공값을 주입하지 않는다.

제품의 750ms 예산·코드·90초 검사 제한은 변경하지 않는다. 실패 시 자료 본문 없이 실제 요청 종류·시각·응답 상태, 보류 수와 준비 mark를 logcat에 남긴다. 이 변경은 테스트 시나리오 보강이며 원 CI의 Lite 내부 지연 원인이나 운영 제품 결함을 해결했다고 표현하지 않는다.

### 카테고리 SDK fixture의 비동기 수명 충돌

후속 CI 37207879143의 Android 실패는 초기 조회 검사에 도달하기 전 기본 instrumentation에서 발생했다. 카테고리 검사 3개가 통과한 직후 `TokenRefresher` 스레드가 `FirebaseApp was deleted`로 프로세스를 종료했다. 따라서 이 실행은 앞선 Native 첫 홈 시간 초과의 재현도, 새 초기 조회 시나리오의 성공 증거도 아니다.

`CategoryRepositoryInstrumentationTest`는 별도 demo FirebaseApp을 만들고 Firestore 종료 직후 앱을 삭제했다. 실제 설치된 Auth 24.2.0의 `zzar.run`은 이름으로 앱을 가져온 뒤 `zzad.zza(app)`에서 앱 component에 접근하며, CI stack은 이 두 단계 사이 앱이 삭제된 경우와 일치한다. 테스트 소스의 FirebaseApp 삭제 지점은 이 fixture뿐이다. Firestore 종료는 별도 Auth 작업까지 끝났다는 보장이 아니므로 임시 앱 두 개의 수명을 instrumentation 프로세스 종료까지 유지한다. Firestore는 계속 종료·await하고 종료 예외를 삼키던 코드를 제거한다. Auth도 명시적으로 로컬 endpoint에 연결하여 고유 이름·demo 프로젝트·네트워크 비활성 Firestore 격리를 유지한다.

CAT-004 / T-CAT-005의 실제 SDK 빈 목록·조회 실패·기본 다섯 개·write 없음 assertion과 모든 Activity 검사를 유지한다. 테스트 fixture 수명만 변경하며 제품 코드·750ms 예산·검사 제한·배포는 바꾸지 않는다. 실패 로그와 artifact는 TEMP/household-android-initial-ci-native-{failure-}37207879143, 로컬 전후 검증은 TEMP/household-category-sdk-lifecycle-{before,after}-20261004.log에 보관한다.

수정 후 로컬 API 36.1에서 카테고리·호스트 실제 SDK/Keystore 검사 10개가 통과했다(`focused` 로그). 기존 로컬 기기의 전체 검사에서는 수정 전 알림 권한 revoke에 의한 프로세스 종료, 수정 후 별도 Activity CREATED 전환 대기와 QuickEdit의 비로그인 전제 실패가 관측됐다. Auth 로그에는 검사 중 실제 로그인 이벤트가 있어 이전 사용 계정이 있는 로컬 기기의 환경과 CI의 새 기기를 구분한다. 이 결과를 45개 전체 성공이나 원 CI 오류의 로컬 재현으로 기록하지 않는다. CI 37207879143의 나머지 functions·web·web-e2e·android는 성공했고 요약은 Android 실패로 실패했다.

### Android 초기 조회 예산 조정

CI 37209273668에서는 위 fixture 수정 뒤 기본 Android 검사 45개가 통과했다. 실제 Native E2E의 일반 첫 실행도 완료됐으나 Listen을 보류한 재실행에서 네 Lite 응답이 요청 후 1,228~1,231ms에 모두 HTTP 200으로 도착했다. 750ms 예산 뒤 결과는 폐기됐고, 대체 경로인 Listen을 테스트가 보류해 첫 홈이 끝나지 않았다. 이번 관측으로 정상 응답의 조기 폐기와 검사 정체의 연결을 확인했다. 약 1.23초 중 서버·전송 내부 비중을 확정한 것은 아니다.

사용자가 과도한 750ms 기준은 늘리도록 허용했다. Android 초기 조회 예산만 2,000ms로 늘려 이번 정상 응답에 약 770ms 여유를 둔다. iPhone은 변경 근거가 없어 750ms를 유지한다. 최적값이나 p95로 주장하지 않으며 배포 뒤 기존 InitialReadReceived/Fallback과 전체 시작 시간을 비교한다. Android 무응답 시 기존 구독 시작이 종전보다 최대 1,250ms 늦어지는 비용이 있다. 타이머는 동적 import 이전부터 계속 시작하고 실패·scope 종료·오래된 응답 폐기 계약은 유지한다.

계약 검사는 Android 1,230ms 성공, 1,999ms 미복귀·2,000ms 정확히 한 번 복귀와 이후 성공 응답 폐기를 고정한다. iPhone 750ms 경계도 별도로 검사한다. 변경 전 새 Android 검사 2개가 실패했고 변경 후 전체 28개가 통과했다. 실제 Native 재실행은 성공한 SDK 응답의 전달만 요청 시작 후 최소 1,250ms까지 보류하여 이전 750ms 예산으로는 성공할 수 없던 경로를 검증한다. 서버 응답·SDK·시간을 대체하지 않으며 기존 네 원본 성공→구독 순서, fallback/서버 snapshot 없는 첫 홈, 실제 구독 갱신과 reload의 지연 응답 폐기 assertion을 모두 유지한다. 일반 첫 실행과 reload에는 이 최소 지연을 적용하지 않는다. 90초 전체 검사 제한과 Native 계측용 navigation 전 750ms 대기는 변경하지 않는다.

요구사항·설계·진단 필드 설명과 T-ANDROID-STARTUP-001 추적성을 함께 갱신한다. Web Git 자동배포 대상이며 Firebase·APK 변경은 없다. 로컬 로그는 TEMP/household-android-read-budget-{before,after,native}-20261004.log이다.

조정 후 API 36.1의 실제 Android/Firebase E2E 4개와 후속 Native→Web Chromium 1개가 production build를 포함해 통과했다. 지연한 네 응답은 초기 조회 시작 후 약 1,268~1,275ms에 반영됐고 fallback 없이 Listen으로 전환됐다. 같은 Activity reload의 2초 복귀로 잔액 36,890원이 표시됐으며, 이후 47,901원으로 바뀐 값은 보류한 이전 Lite 응답을 해제해도 유지됐다. 실제 서버 시작 로그 1회와 Native/Web 진단 동등성도 통과했다. 이는 의도적으로 응답을 지연한 회귀 검증이며 실기기 성능 측정값이 아니다. 타입 검사와 요구사항·E2E 추적성 생성도 통과했다.
