# QuickEdit 수정의 즉시 목록 반영 — 2026-09-28

## 요구사항과 범위

사용자는 QuickEdit에서 수정한 뒤 같은 앱의 지출 목록에 반영되기까지 약 2~3초 걸리는 현상을 일반 Web 수정과 같은 방식으로 바꾸도록 요청하셨습니다. QuickEdit은 암호화 outbox 접수 뒤 화면을 닫지만 Web 원장은 서버 응답·구독 결과가 도착할 때까지 로컬 수정 내용을 모릅니다. 이 변경은 Native에서 접수한 UPDATE를 같은 앱의 기존 `ledgerOptimisticProjection`에 전달하여 서버 응답 전에 표시하는 작업입니다.

Android Host `QE-002`·`QE-012`, Ledger `LED-001`·`LED-005`와 `T-QE-009`로 추적합니다. `beginUpdate` → 서버 Canonical 결과의 `commitUpdate` 또는 해당 mutation의 `rollback`을 일반 수정과 공유합니다. 메모·카테고리·금액·가맹점·태그의 기존 Update patch를 전달하며 태그 생략/빈 배열 계약도 유지합니다.

즉시 반영 범위는 같은 기기의 같은 인증 Principal·가구·멤버가 제출한 UPDATE입니다. 삭제·분할·알림 요청과 다른 기기의 변경은 기존 서버 응답·구독 경로를 사용합니다. 서버 성공 전 성공 Toast·업무 완료 event를 금지하는 기존 계약은 유지합니다. 여기서 전달하는 pending 상태는 사용자 입력이 로컬에 접수되었다는 표시 힌트입니다.

## 상세 설계

1. Native는 기존처럼 session을 확인하고 고정 `commandId`·`idempotencyKey`·`expectedVersion`을 포함한 envelope를 암호화 outbox에 commit한 뒤 WorkManager 영속 예약을 완료합니다. 둘 중 하나라도 실패하면 Activity를 유지하며 즉시 표시 힌트를 확정하지 않습니다.
2. 접수된 UPDATE를 같은 session의 feedback snapshot에 `pending`으로 노출합니다. 암호화 commit만 끝났거나 WorkManager 예약이 실패한 항목은 아직 공개하지 않습니다. Web은 초기 연결·Activity resume·변경 알림 때 trusted bridge로 snapshot을 가져옵니다. 데이터를 담지 않는 `household-account:quick-edit-updates-changed` event는 snapshot을 다시 읽으라는 신호입니다. 인증 복구로 `remoteReadEpoch`가 바뀌면 같은 identity에서도 feedback 연결을 다시 시작합니다.
3. Web은 `commandId`를 자신의 projection mutation ID에 한 번만 연결하고 기존 `beginUpdate`를 호출합니다. 같은 snapshot을 반복해서 받아도 변경을 중복 생성하지 않습니다. 기존 월·연·검색 등 같은 가구 projection 소비자는 일반 수정과 같은 배열을 관찰합니다.
4. Native 전송이 retryable이면 pending을 유지합니다. 성공이면 실제 서버 응답의 Canonical 거래를 `succeeded`에 연결하고 Web은 이를 기존 `commitUpdate`로 확정합니다. 영구 거부·버전 충돌·계약 실패·만료이면 `failed`로 전달하여 해당 command의 overlay만 `rollback`합니다.
5. 공통 Projection은 Native `expectedVersion`을 조건으로 사용하여 더 최신 서버 version이나 이후 사용자 편집을 과거 pending·성공·실패 결과가 덮어쓰지 않게 합니다. source 목록에 이미 없는 거래는 pending이나 완료 Canonical로 재삽입하지 않습니다. 첫 서버 목록 이전의 pending은 보류한 뒤 실제 source가 publish되면 적용하고, source보다 먼저 도착한 완료 결과는 ack하고 기존 server-first 조회로 수렴합니다. Web은 현재 identity뿐 아니라 pull을 시작한 Web scope 객체의 수명까지 재검증하며 session 종료 때 연결된 mutation을 폐기합니다.
6. Web이 성공·실패 결과를 적용한 뒤 명시적으로 ack하면 Native는 해당 완료 feedback을 메모리에서 제거합니다. ack는 원장 Command를 재전송하거나 취소하지 않고, outbox와 실패 알림 수명을 변경하지 않습니다.

Native의 기존 FIFO, 15분 재예약, 72시간 재시도 상한과 서버 성공 시 outbox 즉시 삭제를 유지합니다. 완료 결과를 전달하려고 암호화 outbox의 성공 항목을 남겨 두지 않습니다. 성공 Canonical 거래와 완료 feedback은 현재 프로세스 메모리에서만 보존하고 Web ack·session 종료 또는 최대 256개·72시간 상한에 따라 정리합니다. 이 상한은 표시 힌트만 정리하며 서버 원장이나 pending outbox의 수명을 바꾸지 않습니다. 같은 Native 거래의 후행 DELETE·SPLIT이 성공하면 앞선 UPDATE 완료 힌트를 제거하여 과거 Canonical로 삭제된 거래가 되살아나지 않게 합니다.

프로세스가 재시작되면 남아 있는 암호화 outbox의 pending UPDATE를 복구 예약 성공 또는 실제 Worker 전송 시작 뒤 표시 힌트로 공개합니다. 이미 성공해 outbox에서 제거된 항목의 완료 메모리는 복구하지 않습니다. 그 경우 새 Web 문서의 기존 server-first 원장 조회가 Canonical 상태를 읽어 수렴합니다. 별도의 영속 원장 cache나 완료 거래 저장소를 추가하지 않습니다.

## Bridge 계약

| operation·event | 입력·출력 | 의미 |
|---|---|---|
| `quick-edit.get-update-feedback` | 입력 `principalUid`, `householdId`, `memberId`; 출력 `quick-edit-update-feedback.v1` snapshot | Native Auth·SessionMirror와 요청 identity가 일치하는 scope의 UPDATE만 반환합니다. |
| `quick-edit.ack-update-feedback` | 같은 identity와 snapshot의 `nativeSessionGeneration`, 처리한 `commandIds` | 현재 Native session의 완료 feedback만 ack합니다. 이전 session의 늦은 ack, 다른 command, pending의 영속 payload에는 영향을 주지 않습니다. |
| `household-account:quick-edit-updates-changed` | payload 없는 Web event | 접수·전송 결과 변경을 알려 pull을 유도하는 로컬 표시 신호입니다. 업무 성공 event나 Canonical 데이터의 원본이 아닙니다. |

응답은 `contractVersion: "quick-edit-update-feedback.v1"`, `principalUid`, `householdId`, `memberId`, `nativeSessionGeneration`, `updates` 배열을 같은 최상위 object에 둡니다. `scope` 중첩 object는 만들지 않습니다. 각 update는 `commandId`, `transactionId`, `expectedVersion`, 원래 `patch`, `state: "pending" | "succeeded" | "failed"`와 선택적 `transaction`을 가집니다. `succeeded`의 Canonical 거래는 실제 Ledger Command 결과를 사용하며 patch로 성공 결과를 합성하지 않습니다. 같은 wire를 Native·Web Adapter 계약 테스트로 검증합니다.

Native generation과 Web generation은 서로 다른 lifecycle 식별자입니다. 두 값을 직접 비교하지 않습니다. identity를 먼저 검증하고 Native generation은 동일 Native snapshot·ack 세대 확인에, Web generation은 비동기 bridge 응답이 현재 Web session에 속하는지 확인하는 데 사용합니다. get·ack 모두 기존 허용 origin·top-level frame·현재 WebView 검증을 유지하며 event 자체만으로 거래를 변경하지 않습니다.

이 operation을 모르는 구버전 APK의 `UNKNOWN_OPERATION`은 feedback 기능 미지원으로 처리합니다. 기존 원장 구독을 유지하며 앱 로그인·목록 표시를 실패시키지 않습니다. 새 API를 지원한다고 추정해 Native Command를 Web에서 다시 제출하지 않습니다.

## 테스트 추적성

다음은 추가된 실제 테스트와 관찰 범위입니다. 실행 통과와 아직 남아 있는 기기/E2E 검증은 다음 절에서 구분합니다.

| 요구사항 / 테스트 | 실제 테스트 | 관찰 범위 |
|---|---|---|
| QE-002·QE-012 / T-QE-009 | [QuickEditUpdateFeedbackTest](../../android/app/src/test/java/com/household/account/quickedit/QuickEditUpdateFeedbackTest.kt), [QuickEditCommandDeliveryLifecycleTest](../../android/app/src/test/java/com/household/account/quickedit/QuickEditCommandDeliveryLifecycleTest.kt) | 영속 예약 전 비노출·접수 후 patch 공개, 서버 지연 pending, 성공 outbox 삭제와 Canonical 메모리 인계, 실패/재시도 구분, 재시작 복구 예약, ack·session purge·256개/72시간 상한, 후행 DELETE/SPLIT의 과거 완료 힌트 제거 |
| QE-012 / T-QE-007 | [QuickEditCommandOutboxTest](../../android/app/src/test/java/com/household/account/quickedit/QuickEditCommandOutboxTest.kt), [QuickEditCommandOutboxJsonCodecTest](../../android/app/src/test/java/com/household/account/quickedit/QuickEditCommandOutboxJsonCodecTest.kt) | 기존 영속 envelope·FIFO·서버 결과·실패 알림·codec 회귀. 단위 검사 통과를 실제 Android Keystore 또는 네트워크 E2E 실행으로 보지 않음 |
| QE-002·AND-005·AND-006·AND-011 / T-QE-009 | [QuickEditUpdateFeedbackBridgeTest](../../android/app/src/test/java/com/household/account/quickedit/QuickEditUpdateFeedbackBridgeTest.kt), [androidQuickEditUpdates.contract.test.ts](../../web/src/__tests__/platform/androidQuickEditUpdates.contract.test.ts) | flat wire·Auth/mirror identity·Native generation·Web scope 교체, 지연 응답 무시, 타 identity/손상 Canonical 거절, 변경 중 재조회, 성공 적용 뒤 ack, 구 APK 구독 유지 |
| LED-001·LED-005 / T-QE-009 | [quickEditLedgerFeedback.contract.test.ts](../../web/src/__tests__/features/quickEditLedgerFeedback.contract.test.ts) | 실제 공통 Projection의 즉시 표시·Canonical 확정·실패 overlay만 복구, 최신 version·일반 Web 편집 보존, 첫 source 전 pending 보류, 서버 삭제 전후의 늦은 완료로 거래 재삽입 금지, 세션 reset 뒤 이전 observer가 새 원장을 변경하지 않음 |
| QE-002·AND-005 / T-QE-009 | [androidNativeReadRefresh.contract.test.tsx](../../web/src/__tests__/platform/androidNativeReadRefresh.contract.test.tsx) | 같은 identity의 인증 복구에서도 새 Web scope와 `remoteReadEpoch`로 feedback 연결 재시작 |
| AND-006·QE-002·QE-012 / T-QE-009 | [MainActivityInstrumentationTest](../../android/app/src/androidTest/java/com/household/account/MainActivityInstrumentationTest.kt)의 `quickEditFeedbackChangesReachRealWebViewAfterResumeAndRecreationWithoutTransactionData`, `realWebViewQuickEditFeedbackOperationsRejectForeignIdentityAndStayOriginBound` | API 36.1 AVD에서 두 검사 모두 통과했습니다(4.17초). 무데이터 event·resume·재생성·identity·origin 검증 기준을 유지했습니다. |
| QE-002·LED-005 / T-QE-009 | [QuickEditWebFeedbackFirebaseE2ETest](../../android/app/src/androidTest/java/com/household/account/e2e/QuickEditWebFeedbackFirebaseE2ETest.kt)의 `acceptedUpdateAppearsBeforeServerRequestAndConflictRestoresCanonicalList` | API 36.1 AVD의 실제 Native→WebView→Emulator 경로에서 1개 통과했습니다(11.858초, failures/errors 0). 서버 요청 전달 전 메모·태그 목록 표시와 서버 원본 미변경, 전달 해제 후 Canonical/ack, 별도 실제 명령의 version 선점 뒤 failed/rollback을 확인했습니다. |

단위·bridge 계약 대역은 실제 기기의 표시·서버 저장 E2E를 대신하지 않습니다. 실제 서버 수락과 데이터 변경을 검사할 때 운영 지출을 사용하지 않습니다.

## 검증·배포 상태

요구사항·계약·상세 설계를 먼저 작성한 뒤 구현과 다음 로컬 검증을 확인했습니다.

- 관련 Web Jest 5개 파일·51개 검사와 `npx tsc --noEmit` 재검사 통과. 세션 reset 뒤 이전 observer의 새 원장 간섭을 막는 회귀를 포함합니다.
- Native focused 5개 suite·42개 검사 통과: feedback 10개, bridge 6개, 기존 outbox 17개·lifecycle 5개·codec 4개. test-results XML에서 failures/errors 0을 확인했습니다.
- Android Debug 실행 코드의 Kotlin/Java 컴파일 통과. 허용된 TEMP 출력/cache에서 표준 Gradle 8.13과 정식 의존성을 사용했으며 Kotlin daemon의 권한 오류는 도구 내장 in-process fallback으로 처리했습니다. 이 결과는 instrumentation 기기 실행이나 서명 APK 공개를 뜻하지 않습니다.
- Native 추적성 manifest에 `T-QE-009`의 실제 단위 테스트 두 파일과 MainActivity instrumentation 두 메서드를 연결했습니다. `node tools/requirements/e2e-coverage.mjs --write`와 catalog 재생성 후 `node tools/requirements/update-catalog.mjs --check`를 통과했습니다. 선언 집계는 요구사항 248개·Canonical 테스트 ID 234개이며 실행 통과 개수가 아닙니다. 이 정적 추적성 확인은 아래 Functions architecture 실행을 대체하지 않습니다.
- MainActivity instrumentation 신규 2개를 작성하고 `compileDebugAndroidTestKotlin`을 통과했습니다(22초). 최초 확인에서는 연결 기기가 없어 실행하지 못했으나 재개 후 API 36.1 AVD에서 두 검사 모두 통과했습니다(4.17초). 최초 event 검사 실패는 `LocalWebViewDocument`의 HTTP-intercept fixture에 `loadDataWithBaseURL`을 혼용한 테스트 준비 문제였습니다. 기존 harness에 맞게 `loadUrl`로 변경했으며 기존 5초 제한과 event·resume·재생성·identity·origin 검증 기준을 모두 유지했습니다.
- `QuickEditWebFeedbackFirebaseE2ETest.acceptedUpdateAppearsBeforeServerRequestAndConflictRestoresCanonicalList`는 API 36.1 AVD에서 실제 실행하여 1개 통과했습니다(11.858초, failures/errors 0). 결과 JSON의 `pendingBeforeForward`·`successCanonical`·`conflictRollback`이 모두 `true`입니다. 실제 서버 요청 전달 전에 목록의 메모·태그가 바뀌고 서버 원본은 그대로인 상태, 전달 해제 뒤 Canonical 반영과 ack, 별도 실제 명령이 version을 선점한 뒤 서버 충돌과 해당 overlay의 최신 Canonical 복구를 확인했습니다.
- 위 종단 검사는 production Web build를 포함했습니다. Gradle은 42초에 `BUILD SUCCESSFUL`, runner 종료 code는 0이며 Firebase Emulator도 정상 종료했습니다. 준비 단계의 Functions architecture 45개도 재통과했습니다.
- loopback 요청 gate의 보류·abort·retry·timeout을 포함한 HTTP 검사 6개가 통과했습니다. 이 gate 6개와 새 Native→Web E2E를 기존 CI 실행 경로에 연결했습니다. 로컬 통과가 후속 커밋의 원격 CI 완료를 뜻하지는 않습니다.
- 실행 로그는 `%TEMP%/household-quickedit-feedback-e2e-20260928.log`, 준비 로그는 `%TEMP%/household-quickedit-feedback-e2e-prepare-20260928.log`입니다.
- 최초 Web production build는 webpack 컴파일의 `spawn EPERM`, Functions architecture는 Vite config `externalize-deps` 단계의 `child_process.spawn EPERM`으로 중단됐습니다. 당시 실패는 제품 assertion 실패와 구분하며 검증 기준을 바꾸지 않았습니다.
- 배포 재개 후 Functions architecture 10개 파일·45개 검사와 `npm --prefix web run build`가 통과했습니다. Web production build는 13개 route를 만들었고 artifact 검증에서 HTML 12개·CSP hash 25개·Firebase 12.16.0을 확인했습니다.
- 최종 읽기 전용 감사에서 추가 배포 차단 문제는 발견하지 않았습니다.
- 구현 커밋 `0b6a286bc1dd1cdb41c1b74fb3205003200ac717`을 commit·push했습니다. [CI 36394421689](https://github.com/minkue777/household-account/actions/runs/36394421689)는 `functions`·`web`·`android` 성공, `web-e2e`·`android-instrumentation` 및 요약 실패로 끝났습니다. Android는 위에서 재현·보완한 event 문서 fixture 준비 실패 1개(44개 통과)이며 제품 신호 단계 전 실패입니다. Web은 97개 통과·1개 실패로, `finance-categories.spec.ts:121`의 가구 준비 중 `signInTestAccount`가 Auth Emulator `127.0.0.1:9099` 로그인 요청의 `socket hang up`으로 중단됐습니다. 원장·예산 assertion 이전의 전송 오류이며 연결 종료 원인까지 확정하거나 제품 오류를 해결했다고 주장하지 않습니다. 원 실행을 무변경 재실행하지 않고 실제 테스트 보강 커밋의 전체 CI에서 후속 결과를 확인합니다. 실패 로그는 `%TEMP%/household-quickedit-feedback-ci-36394421689.log`입니다.
- 실제 E2E 추적성 보완 뒤 `npm --prefix functions run test:requirement-traceability` 1개 파일·12개 검사도 통과했습니다.
- 같은 SHA의 [Vercel Git 자동배포](https://vercel.com/irubias-projects/minkue777-household-account/BpKRYe7C5zuwf3T3RmekkzqHcje6)와 GitHub Production deployment `6705116320`이 성공했습니다. 운영 `/`·`/sw.js`의 HTTP 200과 해당 SHA 포함, `/_next/static/0b6a286bc1dd1cdb41c1b74fb3205003200ac717/_buildManifest.js`의 HTTP 200을 확인했습니다.
- Android 서명 `assembleRelease`가 1분 6초에 성공했고 APK v1.2.31/versionCode 33과 `apksigner` v2 서명을 확인했습니다. APK 크기는 11,421,551 bytes, SHA-256은 `ae565d17aa92653a6e039c0a19b8588c025e005f58de89130f8d087f4a971c21`입니다. 신규 feedback class·get/ack operation·변경 event·운영 Web URL이 DEX에 포함됨을 확인했습니다.
- 실제 기기 계측과 Native→Web E2E는 통과했으며 APK 공개는 준비 중입니다. 현재 문서 갱신 시점에는 아직 APK를 공개하지 않았습니다. 구현 SHA 이후의 테스트·검증 보완을 후속 커밋으로 반영할 예정이며 서명 빌드·로컬 검증·GitHub Release 공개·최종 SHA의 원격 CI를 구분합니다.

실행 코드 변경은 Web과 Android이며 Firebase 서버 명령은 기존 계약을 재사용합니다. 최초 환경에서는 `.git` 읽기 전용 때문에 commit·push를 시도하지 않았고 `gh release` 목록 조회도 proxy `127.0.0.1:9`의 연결 거절로 실패했습니다. 이는 당시 환경 제한 이력이며 배포 재개 후 `git fetch`·네트워크 접근, 구현 commit·push와 Web 배포가 완료됐습니다. Firebase 재배포는 필요하지 않습니다. 현재 남은 항목은 테스트·검증 보완의 후속 커밋 반영, Android APK 공개와 최종 SHA의 전체 CI 확인입니다. 운영 금융 데이터는 수정하지 않았습니다.
