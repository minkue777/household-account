# 실제 코드 테스트 정리 — 2026-09-11

실제 앱 코드를 실행하지 않는 계약 테스트 27개와 그 전용 참고 구현·fixture 103개를 삭제했습니다. `functions/test/reference` 75개, 전용 support 28개, Android-host 계약 17개, PWA 계약 8개, Functions에서만 실행되는 Android 중복 제거·foreground 대리 계약 2개로 총 130개 파일입니다. Kotlin이나 서비스워커 대신 TypeScript로 업무 동작을 다시 구현한 테스트가 통과해도 실제 앱의 회귀를 검출할 수 없기 때문입니다.

외부 SDK·네트워크·시간을 대역으로 교체하더라도 실제 제품 로직을 실행하는 Functions·Web·Android 단위 테스트는 유지했습니다. Firestore Rules·공유 schema·배포 설정·문서 링크 검사도 실제 운영 계약과 설정을 검증하므로 삭제 대상이 아닙니다. import 경로만으로 무조건 삭제하지 않고 해당 대역이 제품 코드를 대신 재구현했는지 확인했습니다.

후속 production 호출 감사에서 Payment·Notifications·공유 client session의 대리 계약 26개와 미사용 전용 driver 26개도 제거했습니다. [삭제별 factory·Canonical ID·실제 대체 경로](removed-notification-payment-shadow-tests.json)에 해당 파일과 근거를 남겼습니다. 원래 130개 정리와 별도 집계이며 이 문서 담당 범위에서 총 182개 파일입니다. Finance·Portfolio·Access 담당자의 추가 삭제는 각각 해당 검증 문서에 기록합니다. `shortcut-http-inbound.contract.test.ts`는 실제 배포 HTTP handler·processor와 실제 parser를 실행하므로 보존했고, 그 경계의 intake 대역에 필요한 `shortcut-payment-recording-driver.ts`도 남겼습니다. Functions `src` 파일 자체를 테스트 정리를 이유로 삭제하지 않았습니다.

## 삭제 대상과 대체 검증

아래 파일명은 삭제한 `functions/test/contexts/supporting-platform` 아래의 계약 테스트입니다. 테스트 ID를 다른 파일의 주석으로 옮겨 완료 처리하지 않습니다. 실제 Kotlin의 파일·메서드와 남은 범위는 [Native 검증 연결표](native-real-code-coverage.json)에 별도로 기록합니다.

| 삭제 파일 | 실제 코드 검증 또는 남은 범위 |
|---|---|
| android-host/android-backup-policy.contract.test.ts | 설치된 앱의 backup flag와 실제 XML resource를 읽는 `HostPlatformAdapterTest.installedBackupPolicyExcludesEveryPrivateStorageDomain`. 실제 새 기기로의 transfer 복원은 별도 필요 |
| android-host/android-capture-retry-queue.contract.test.ts | 실제 `CaptureDeliveryQueueTest`, `HostPlatformAdapterTest.captureJournalReloadRunsTheActualKotlinCodecAndKeystoreWithoutPlaintext`, Native Firebase E2E |
| android-host/android-host-access.contract.test.ts | 실제 MainActivity 권한 안내·허용·거부 및 정확한 listener component instrumentation |
| android-host/android-log-redaction.contract.test.ts | Native Firebase E2E가 실제 수집·편집·저장 흐름의 해당 앱 process logcat에서 식별자·원문·메모·토큰 비노출 검사. 모든 예외 흐름의 log 전체 검증은 아님 |
| android-host/android-notification-permission.contract.test.ts | 실제 표시 권한 거부 후 WebView 표시 및 Activity 재생성 검사 |
| android-host/android-wire-dto-conformance.contract.test.ts | 실제 `AndroidHostBridge.handle`에 JSON 전달 후 앱 버전·잘못된 계약·잘못된 operation 응답 검사. 존재하지 않는 generated Kotlin codec 실행을 주장하지 않음 |
| android-host/fid-logout-delivery-gate.contract.test.ts | 실제 `detachFidForLogout` Kotlin과 설치된 FcmService component 차단/재활성화 |
| android-host/quick-edit-command-outbox.contract.test.ts | 실제 Kotlin outbox/lifecycle/codec와 Android Keystore 저장·복원·변조·72시간 만료 instrumentation |
| android-host/quick-edit-command-outcome.contract.test.ts | 실제 QuickEdit Activity 알림·분할 command 저장, Native Firebase E2E의 메모 command 서버 반영 |
| android-host/quick-edit-fifo.contract.test.ts | 실제 `QuickEditPendingQueue` Kotlin의 FIFO·중복·lease·프로세스 복원·session 격리 |
| android-host/quick-edit-intent-mapping.contract.test.ts | 실제 서버 receipt → Coordinator가 만든 Intent → QuickEdit Activity 표시, 사용자 카테고리 ID 보존 |
| android-host/quick-edit-open-policy.contract.test.ts | 실제 수집 직후 자동 표시 및 실제 receipt에 대한 설정 off/권한 없음의 queue·표시 불변 검사 |
| android-host/quick-edit-overlay-policy.contract.test.ts | 실제 설치 Activity의 외부 진입 금지·최근 앱 제외 Intent·캡처 허용·keyguard dismiss flag 없음. 물리적인 잠금 해제 시험은 별도 필요 |
| android-host/quick-edit-split-conflict.contract.test.ts | 실제 Activity 분할 초안 + 실제 Kotlin/Keystore conflict 유지. 두 사용자의 Native 동시 분할 전체 연결은 미검증 |
| android-host/quick-edit-split-draft-policy.contract.test.ts | 실제 Activity가 버튼 시점 form을 분할 envelope에 고정. 실제 dialog에서 2항목 자동 금액 조정·3항목 독립 입력·삭제 후 재조정·취소 시 command 없음 검사 |
| android-host/session-scope-transition.contract.test.ts | 실제 `SessionMirrorTest`, 암호화 저장소, bridge의 가구·사용자별 설정 분리 |
| android-host/web-shell-navigation.contract.test.ts | 실제 WebView의 허용 origin bridge 왕복·외부 origin bridge 부재·history 뒤로가기·권한 화면 뒤로가기·권한 재확인 및 Activity 재생성 navigation 보존 |
| pwa/cache-policy.contract.test.ts | 실제 production worker와 production browser E2E에서 검증. 참고 CacheStore 삭제 |
| pwa/firebase-worker-build-config.contract.test.ts | 실제 worker build·artifact·production browser E2E. 가짜 emitter 삭제 |
| pwa/notification-navigation-policy.contract.test.ts | 실제 `pwaWorkerNotification.test.ts`와 production worker의 navigation E2E. 참고 navigation application 삭제 |
| pwa/push-payload-validation.contract.test.ts | 실제 production worker entry handler의 payload 검증. 참고 validator 삭제 |
| pwa/pwa-install-metadata.contract.test.ts | 실제 manifest·아이콘·설치 metadata 및 production browser E2E. 참고 manifest 모델 삭제 |
| pwa/pwa-root-runtime.contract.test.ts | 실제 production build에서 서비스워커 등록·scope·CSP 검증. 참고 worker 모델 삭제 |
| pwa/web-security-header-policy.contract.test.ts | 실제 production 응답 헤더 검사. 테스트용 header 생성기 삭제 |
| pwa/worker-update-session-isolation.contract.test.ts | 실제 worker와 session 관련 제품 코드 및 production browser E2E. 브라우저 업데이트·계정 전환 전체 조합은 각 실제 테스트 증거 기준으로 판정 |

PWA 삭제 대상의 Canonical ID는 `T-PWA-INSTALL-001`, `T-PWA-001`~`T-PWA-006`이며 연결 요구사항은 `PWA-001`~`PWA-008`입니다. 삭제했다는 이유만으로 이 모든 요구사항이 새 E2E에서 완전히 검증됐다고 계산하지 않습니다.

## Native Firebase E2E 실행 구조

추가 감사에서 `functions/src`에 위치해도 실제 bootstrap·Adapter에 연결되지 않은 Android 대리 구현을 발견했습니다. `notifications/android-foreground-notification.contract.test.ts`와 전용 `foreground-notification-driver.ts`는 실제 Kotlin과 무관한 TypeScript foreground 알림 모델을 검사했습니다. `android-payment-ingestion/notification-envelope-and-dedup.contract.test.ts`와 `notification-ingress-driver.ts`도 실제 Listener의 30초 cache를 호출하지 않았습니다. 이 4개 파일을 삭제하고 실제 Listener의 private 메서드를 호출하는 `HostPlatformAdapterTest.actualListenerDedupUsesInclusiveThirtySecondWindowWithoutExtendingIt`(29,999/30,000/30,001ms, window 미연장, 새 process map)과 실제 FCM 서비스 E2E로 대체했습니다. 기존 실제 parser/domain 로직 테스트는 유지합니다.

실제 `CardNotificationListenerService.onNotificationPosted`에 Android `StatusBarNotification` 입력을 전달합니다. 운영 Listener의 추출·메모리 중복 제거·암호화 Queue·인증 callable·서버 규칙·카테고리·QuickEdit·메모 저장을 이어서 실행하고, 동일 OS 입력을 반복해도 실제 서버 제출 영수증이 1개인지 확인합니다. `FcmFirebaseE2ETest`는 실제 FID 등록 callback과 서버 확인을 거쳐 Android 시스템 알림·채널·PendingIntent 및 로그아웃 차단을 검사합니다. 외부 OS/FCM callback 입력만 synthetic으로 제공하며 앱 로직과 응답은 대체하지 않습니다.

`QuickEditFirebaseE2ETest`는 실제 서버가 만든 카테고리 ID·규칙·카드 등록을 사용합니다. 미제출 raw notification을 실제 Listener의 `onNotificationPosted`에 전달하므로 production `AndroidCaptureDelivery.enqueueAndFlush`의 암호화 capture journal → 실제 Auth/Functions SDK → 서버 parser/규칙 → receipt decoder → QuickEditCoordinator → 실제 CategoryRepository/Activity → 메모 입력 → 암호화 command outbox/WorkManager → 실제 command callable → query callable의 저장 결과까지 연결됩니다. Activity나 repository에 카테고리 목록을 reflection으로 주입하지 않습니다. 첫 편집 화면을 열어 둔 상태에서 두 건을 추가 수집하고, 암호화 FIFO 순서와 첫 항목 저장·다음 항목 닫기·세 번째 항목 닫기에 따른 실제 Activity 전환을 검증합니다.

`WebStartupFirebaseE2ETest`는 정상 build lifecycle의 production Next 서버를 실행하고 임시 localhost TLS 인증서를 E2E debug에만 신뢰시킵니다. 실제 MainActivity의 권한 화면에서 시작해 허용 origin bridge와 실제 Web 첫 완성 화면까지 이어지고, 앱 방문 command의 Native 경과 시간이 실제 서버 logger에 한 번 기록되는지 검사합니다. 같은 Activity의 WebView 재로딩은 최신 서버 잔액을 표시하지만 Native 시작 시간을 중복 보고하지 않아야 합니다. 관측 script는 실제 fetch 응답·성능 mark·IndexedDB open을 읽으며 업무 응답이나 시계를 제공하지 않습니다. 이는 측정 경로와 캐시 동작 검증이며 물리 단말의 1초 성능을 입증하는 벤치마크는 아닙니다.

기존 로컬 UI instrumentation은 기본 실행에 남겨 두고, Firebase E2E만 `-PfirebaseE2e=true`의 annotation filter로 선택합니다. 기본 실행에서 해당 테스트를 skip으로 등록하지 않습니다. E2E 실행 시 fixture 누락, Emulator 연결 실패, 실제 서버 조회·저장 실패는 테스트 실패입니다.

전용 debug manifest는 Firebase 자동 초기화를 제거하고 테스트 runner가 Application attach 이후 고정된 `demo-household-account-e2e` 프로젝트를 생성합니다. Auth 9099, Firestore 8080, Functions 5001은 모두 Android Emulator host `10.0.2.2`에 연결합니다. 실제 `HouseholdAccountApplication.onCreate`와 `ApplicationStartupTasks`를 실행하므로 FCM 전달 gate 및 Quick Edit outbox 복구 작업은 유지됩니다. 외부 Play Integrity attestation만 AndroidTest 전용 App Check provider의 synthetic demo JWT로 대신하고 실제 Functions SDK가 헤더를 전송합니다. 서버의 `enforceAppCheck`와 callable 검증 경계는 유지하며 운영에서 이 토큰이 승인되는 증거로 해석하지 않습니다. 기본 debug 및 release의 Application·manifest·네트워크 정책은 변경하지 않습니다.

fixture 필드는 `projectId`, `email`, `password`, `householdId`, `memberId`, `categoryId`, `categoryName`, `rawNotification`, `expectedMerchant`, `expectedAmountInWon`입니다. 실제 사용자·운영 프로젝트의 fixture는 허용하지 않습니다. UTF-8 JSON의 Base64를 `android.testInstrumentationRunnerArguments.fixtureBase64`로 전달합니다. 성공 시에만 앱 내부 `files/native-firebase-e2e-result.json`을 생성하며, 서버 query로 확인한 거래 ID·카테고리·메모·금액·version을 후속 Web E2E가 사용합니다.

## 검증 기록

2026-09-11 기본 Android instrumentation 29개가 API 36.1 Emulator에서 모두 통과했습니다(실패 0, skip 0). 같은 최종 실행의 JVM 단위 테스트 task, lintDebug, assembleDebug, assembleRelease도 성공했습니다. JVM task는 입력 변경이 없어 up-to-date였습니다. Emulator 전용 debug APK·테스트 APK 컴파일도 성공했습니다.

같은 날 공식 Native 실행의 Android Firebase E2E 3개도 모두 통과했습니다(JUnit tests 3, failures 0, errors 0, skipped 0). 실제 OS 알림 탭·서버 등록·로그아웃 차단, 실제 수집 3건의 Quick Edit FIFO·대소문자 카테고리·메모 저장·서버 재조회·로그 비노출, 실제 WebView 첫 화면과 같은 Activity 재로딩을 검증했습니다. 새 테스트의 관측 오류는 실제 알림 접근성 트리 순회, 계속 유지되는 ActivityMonitor, 카드사 원문 형식 보존으로 수정했습니다. Espresso의 실제 입력 액션은 유지하면서 설명에 메모 값을 넣지 않도록 했으며 앱 로그 검사 범위를 줄이지 않았습니다.

다만 이 실행의 전체 명령은 후처리 실패로 종료 코드 1입니다. AGP가 테스트 앱을 먼저 제거해 Node runner가 앱 내부 결과 JSON을 읽지 못했으며, 후속 Web 1개는 실행되지 않았습니다. 로컬 AGP 8.13.2의 Stable 옵션 `android.injected.androidTest.leaveApksInstalledAfterRun`을 확인하여 E2E runner에만 적용했고 Node 구문 검사는 통과했습니다. 이 후처리 수정과 Native→Web 마지막 연결의 실행 결과는 CI에서 확인해야 합니다. Native 3개 통과를 전체 runner 통과로 계산하지 않습니다.
