# Android·결제 수집·알림 단순화 조사 — 2026-10-05

저장소: `C:/Users/minku/Desktop/programming/ToyProject/Household-account`

이 보고서는 읽기 전용 설계 조사입니다. 제품 코드·테스트를 변경하지 않았고 테스트·빌드·배포·운영 데이터 조회를 실행하지 않았습니다. 현재 architecture 문서의 레이어 수를 목표로 삼지 않고 실제 런타임 소비자, 중복 상태 및 행동 계약을 기준으로 검토했습니다.

## 조사 범위

Android 제품 Kotlin 전체, 수집·취소·카드/규칙·Shortcut·알림의 실제 실행/저장 경계를 검토했다. provider parser·wire decoder·bootstrap은 [서버 경계](server-boundaries.md), 테스트와 fixture는 [수집 테스트](capture-tests.md), [재무 테스트](finance-tests.md), [실제 검증 경계](test-boundaries.md)에 통합했다. Android 리소스·빌드 설정도 검토했으며 최종 파일별 상태는 [files.csv](files.csv)를 따른다. 테스트 실행이나 기기 재현은 수행하지 않았다.

## 기능별 실제 흐름

| 기능·보존 계약 | 실제 진입 → 판정 → 저장 |
|---|---|
| Android 알림 수집, ING-001~009 | `CardNotificationListenerService.onNotificationPosted` → source registry/group summary/forwarding policy/중복 관찰 gate → raw envelope → `AndroidCaptureDelivery.enqueueBatchAndFlush` → 암호화 capture journal → callable → receipt 분기 → QuickEdit FIFO 내구화 → journal 완료/보류 |
| 서버 승인·취소·잔액, ING-008/CAN-001~007 | `firebaseCaptureSubmission` callable → Auth/Membership·wire/source 검증 → raw parser 또는 envelope → `captureSubmissionApplication` → 독립 transaction/balance 분기 → configuration 기반 gateway → Firebase ledger transaction/잔액 저장 |
| 실제 취소 계보 | `FirebaseCaptureLedgerPersistence.cancel` → receipt 재생 → 날짜 창·원 승인 증거로 후보 선택 → `planCaptureLineageCancellation` → 원장/계보/outbox/receipt 원자 변경 |
| QuickEdit 표시·수정·분할·태그, QE-001~013 | capture follow-up → 내구 FIFO/표시 lease → `QuickEditCoordinator` snapshot 또는 구 entry Query → Intent → Activity draft → 공용 Ledger command envelope → 암호화 command outbox+WorkManager 예약 → 창 종료/다음 FIFO → 비동기 전송·terminal feedback |
| Android 세션·인증·시작, AND-001~014 | Application startup → MainActivity one-shot/resume gate → trusted-origin WebView/bridge → NativeAuth → 서버 확정 Membership → SessionMirror → Web token/세션 refresh → FID 등록·capture 재전송 |
| Android 푸시·로그아웃, PUSH-001~003/007 | FID callback + 서버 확정 session → `FidEndpointManager` → command → binding 확인; 로그아웃은 먼저 FCM component 차단/알림 제거 → endpoint detach·local unregister·suppression best effort → session purge |
| 카드·가맹점 규칙, CARD-001~005/MER-001~007 | household command → `paymentConfigurationRuntimeApplication` 실제 transaction port → 현재 state → 도메인 판정 → adapter 원자 저장+receipt. 기존 지출 기억하기는 `rememberExistingTransactionMutation` → 같은 merchant mutation |
| Shortcut 수집·credential, IOS-002/003/005/007/012/013 | `firebaseShortcutHttp` → 인증/전용 credential·quota → stable key/receipt claim → normalize/parser → common capture intake → receipt 확정, retryable은 claim release |
| 알림 등록·대상·전송, PUSH-001~014 | notification command → 인증 actor → endpoint atomic register; outbox trigger → channel policy·Membership·endpoint 계획 → Intent/Delivery/Inbox 수락 → delivery claim → Membership·endpoint version 재확인 → provider 한 번 호출 → terminal 저장·조건부 inactive → stale reconciliation |
| 공통 intake·발생연도·wire schema | 발생연도 정책 본문 및 public import·schema 식별 |

문서 계약은 `docs/requirements/supporting-platform/modules/android-host/requirements.md`, `docs/requirements/contexts/payment-capture/modules/{android-payment-ingestion,payment-configuration,shortcut-ingestion}/requirements.md`, `docs/requirements/contexts/notifications/modules/notifications/requirements.md`에서 확인했습니다. 문서의 목표/결함 분류가 곧 현재 제품 결함의 증거는 아닙니다.

## 단순화 후보

### 1. 운영에 연결되지 않은 configuration 메모리 application 3개 제거 검토

- 근거: `functions/src/contexts/payment-capture/configuration/application/rememberMerchantRuleApplication.ts:18`, `rememberExistingTransactionApplication.ts:13`, `merchantRulePersistenceApplication.ts:74`는 자체 배열·snapshot·가상 commitOutcome 등을 유지합니다. 마지막 구현의 `createConcurrently`는 실제 transaction 경합이 아니라 명령 배열 실행 모델입니다.
- 소비자: 위 세 factory 이름을 `functions/src`, `functions/test`에서 검색하면 **정의와 configuration/public.ts:173~176 재수출 외 호출자가 없습니다**. 실제 경로는 `rememberExistingTransactionMutation.ts:9`와 `paymentConfigurationRuntimeApplication.ts:147`의 atomic mutation입니다. src의 동명 설명용 구현이 운영 구현처럼 보일 위험이 있습니다.
- 작은 설계: 공개 재수출과 미사용 구현/그 구현만 사용하는 port/model을 삭제합니다. 현재 사용 중인 `rememberMerchantRule` 순수 정책과 실제 atomic mutation은 유지합니다. 역사적 특성화가 필요하면 운영 src가 아닌 명시적 테스트 fixture로 둡니다.
- 보존: MER-004 exact claim/priority 유일성, MER-005 기존 exact rule 재사용·expectedVersion·지출과 규칙의 원자성, MER-006 migration 분리.
- 회귀: 실사용 `merchant-rule-command-boundary`, `merchant-rule-category-remap`, ledger remember/command 및 Firebase atomic adapter 계약을 유지하고 import/typecheck로 소비 누락을 확인해야 합니다. 기존 테스트를 단순 삭제해 성공률만 올려서는 안 됩니다.
- 확신: **높음**(현재 검색 범위에서 runtime 소비 없음). 전체 tools/동적 로드/패키지 외부 공개 사용 여부 확인이 삭제 전 마지막 점검입니다.

### 2. Android 미사용 단건 capture 전달 API 제거

- 근거: `android/app/src/main/java/com/household/account/paymentcapture/AndroidCaptureDelivery.kt:35~77`의 `enqueueAndFlush`는 journal→submit→follow-up→complete/retain→retry 예약을 별도로 구현합니다.
- 소비자: `enqueueAndFlush`의 Android/Functions-test 검색 결과는 정의 한 건입니다. 현재 서비스는 `CardNotificationListenerService.kt:155~160`에서 `enqueueBatchAndFlush`를 호출하고 Worker는 `flush`를 호출합니다.
- 작은 설계: 미사용 단건 메서드를 제거하고 ingress는 batch 하나, 복구는 flush 한 경로로 진입하게 합니다. 다음 후보의 전달 엔진 정리와는 별도 작은 변경으로 가능합니다.
- 보존: ING-008 최초 네트워크 전 내구화, 고정 key 재전송, branch terminal 상태, QuickEdit FIFO를 먼저 저장하는 순서.
- 회귀: `CaptureDeliveryQueueTest.kt`, `CaptureSubmissionClientTest.kt`, 실제 `QuickEditFirebaseE2ETest.kt`의 연속 수집/재전송 경로를 유지합니다.
- 확신: **높음**. 단, 구 capture envelope wire/codec는 실제 저장 queue·구 APK 소비가 있으므로 이 메서드와 함께 삭제하면 안 됩니다.

### 3. capture ingress와 retry의 두 전달 알고리즘을 한 번의 attempt로 통일

- 근거: `CaptureBatchDelivery.kt:8~55`는 enqueue 후 짧은 저장 lock 밖에서 네트워크를 호출하고 항목별로 완료를 반영합니다. 반면 `CaptureDeliveryQueue.kt:180~219`의 retry flush는 **전체 `mutex.withLock` 안에서 `client.submit`(196~201)**을 순차 대기하고 마지막에 한 번 `store.replace`합니다. 동일 receipt 판정/보류/QuickEdit 후속 동작을 두 알고리즘이 따로 조합합니다.
- 소비자: 최초 알림은 `AndroidCaptureDelivery.enqueueBatchAndFlush`, WorkManager·시작/복귀 재시도는 `AndroidCaptureDelivery.flush:116` → queue.flush입니다. retry 중 새 enqueue/purge가 같은 저장 mutex를 기다리는 구조는 코드에서 확인되며 실제 지연 사고를 이 조사에서 재현한 것은 아닙니다.
- 작은 설계: snapshot/claim은 짧은 store lock, 네트워크는 lock 밖, scope/generation을 재확인한 per-entry commit으로 단일 attempt 함수를 사용합니다. 직렬 전송이 필요하면 저장 mutex와 별도 delivery mutex로 보존합니다. 이미 QuickEdit outbox가 짧은 접수 구간과 네트워크 수명을 분리한 사례입니다.
- 보존: ING-008 branch별 terminal/retryable, 원래 envelope/key, 72시간 제한, 로그아웃 purge barrier, 이전 scope 완료의 재삽입 금지, FIFO 후속 내구화 후 capture 제거. 단순히 lock만 풀면 데이터 손실/구 scope 부활이 생길 수 있으므로 그렇게 수정하면 안 됩니다.
- 회귀: 느린 retry 요청 중 새 알림 enqueue 완료, purge와 응답 경합, partial receipt에서 같은 follow-up 재표시 금지, 프로세스 재시작/72h 경계. 기존 `CaptureDeliveryQueueTest.kt`와 Native FIFO E2E를 확장해야 합니다.
- 확신: **높음**(중복 경로·긴 lock 존재), 효과 규모는 계측/재현 필요.

### 4. 서버 FID 등록에서 가상의 client session controller 제거

- 근거: `functions/src/contexts/notifications/application/mobileFidRegistrationController.ts:35~187`는 mutable session, restoreSession, runtime/OS 권한 capability, callback 수명을 소유합니다. 그러나 실제 서버 진입 `bootstrap/commands/notificationHouseholdCommandHandlers.ts:49~67`은 매 요청 새 controller를 만들고 이미 인증된 actor에 `sessionGeneration:1`을 넣습니다. 등록 호출 103~109는 platform에서 runtime을 다시 만들고 `osNotificationPermission:'granted'`를 고정합니다.
- 소비자: 운영 사용은 이 household command handler이며 나머지는 `functions/test/support/mobile-fid-registration-driver.ts`와 계약 테스트입니다. 서버에 진짜 장기 client session이나 OS 권한 신호가 전달되는 것이 아닙니다.
- 작은 설계: 서버는 `registerEndpoint(actor, platform, fid, deviceInfo)`/조건부 remove와 같은 stateless command 판정으로 충분합니다. client의 환경 capability 규칙은 client 또는 독립 순수 정책으로 두되 서버 등록 코드를 callback controller로 연기하지 않습니다. 현재 atomic store와 identity hash를 재사용합니다.
- 보존: PUSH-001/002/003/008/009 Auth·현재 Membership 검증 선행, FID 인증 ID 오용 금지, binding 원자 교체, registration/binding version 기반 inactive/delete, stale remove 무해성, FID 비노출.
- 회귀: `mobile-fid-registration.contract.test.ts`의 환경/권한/로그인 전 등록 금지는 적절한 실제 경계로 옮겨 유지하고, 실제 household command/Firestore adapter에서 cross-household와 stale version을 검증합니다. mock controller만 통과시키는 테스트로 바꾸지 않습니다.
- 확신: **높음**(가상 상태 확인), 적용은 server command와 테스트 fixture의 책임을 함께 정리해야 합니다.

### 5. configuration의 transaction 내부 가상 store를 순수 mutation으로 축소

- 근거: `paymentConfigurationRuntimeApplication.ts:147~174`는 실제 storage transaction이 넘긴 current를 복제해 다시 `store.read/transact`를 가진 메모리 application을 구성하고 closure `next/writes`로 결과를 회수합니다. 카드 쪽 176~198은 mutable application의 `.state()`를 회수한 뒤 `JSON.stringify(state)!==JSON.stringify(current)`로 write 여부를 추론합니다. `merchantRuleCommandApplication.ts:85~190`에도 authorization/conflict/changed 결과와 transaction wrapper가 있습니다.
- 소비자: runtime의 실제 카드/가맹점 command와 기존 지출 기억하기가 사용합니다. 후보 1처럼 미사용이 아니라 운영 경로입니다.
- 작은 설계: 현재 state+typed command에서 `{state,value,writes}`를 반환하는 기존 순수 판정 함수를 직접 호출하고 transaction은 실제 adapter 경계 한 번만 둡니다. 새 generic command framework는 필요 없습니다. 카드·가맹점의 서로 다른 정책을 한 모델로 합치려는 제안도 아닙니다.
- 보존: CARD-001~005/MER-001~007 권한, expectedVersion, 순서/우선순위, exact claim, 원자 receipt·rule/transaction 변화. write 여부는 정책 결과로 명시합니다.
- 회귀: 실제 command boundary + Firebase transaction 경합·commit 실패·receipt 재전송·읽기 전용 결과에서 write 0건. 행위별 결과가 같은지 검증해야 합니다.
- 확신: **높음**(중첩 상태/추론 확인), 변경 위험은 중간이므로 후보 1·2 이후 진행 권고.

### 6. 테스트만 소비하는 legacy Shortcut owner 추론은 운영 src와 분리

- 근거: `shortcut-ingestion/domain/policies/resolveLegacyShortcutOwner.ts:40~100`는 현재 FCM owner → 첫 카드 → 카드사 유일 owner → request owner fallback 순서로 소유자를 추론합니다.
- 소비자: `resolveLegacyShortcutOwner` 검색 결과 운영 import는 없고 `functions/test/support/legacy-shortcut-owner-policy-fixture.ts`만 import합니다. 현 `shortcutHttpRequestProcessorApplication.ts`는 credential로 인증된 actor를 intake에 전달합니다. 새로운 구현은 body owner를 신뢰하지 않는 별도 IOS 보안 계약 테스트가 있습니다.
- 작은 설계: 실제 호환 endpoint가 없는지 확인 후 이 과거 정책을 역사 fixture로 이동하거나 문서 특성화 이력으로 남기고 운영 src/public 경계에서는 제거합니다. 테스트만 살아 있는 구 인증 규칙을 현행 fallback으로 재연결하지 않습니다.
- 보존: IOS-005의 역사 특성화와 현행 IOS-013/T-IOS-SEC-002 credential actor 기준·body owner 무시. 구 사용자에게 실제 배포된 endpoint 소비 증거가 있다면 제거하지 않고 명시적 별도 호환 경계로 다룹니다.
- 회귀: `shortcut-http-inbound.contract.test.ts`의 body household/createdBy/owner 무시, 본인 카드와 Membership 검증, credential별 idempotency scope를 유지합니다. legacy fixture 이동은 현재 동작 테스트를 없애는 것과 구별합니다.
- 확신: **높음**(저장소 내 운영 소비 없음), 외부 배포 entry 존재 여부는 별도 확인 필요.

### 7. QuickEdit의 original/draft/Intent 필드 복제를 한 snapshot과 draft로 정리

- 근거: `QuickEditActivity.kt:90~168` 및 `475~523`은 원본 merchant/amount/category/date/time/memo/tags/version을 개별 상태로 보유하고 patch 생성 때 다시 조립합니다. `QuickEditCoordinator.kt:237~248`도 같은 snapshot을 Intent 필드별로 복사합니다. query DTO(`HouseholdQueryClient.kt:6~18`)와 capture snapshot(`CaptureDeliveryQueue.kt:37~47`)이 편집 화면 경계에서 다시 펼쳐집니다. saved instance에는 tags를 명시 저장하지만 선택 category 등은 별도 초기화됩니다.
- 소비자: capture snapshot fast path와 snapshot 없는 기존 FIFO의 Query path 모두 같은 Activity로 들어옵니다. 회전/복귀 초안 유실은 이 조사에서 재현하지 않았으므로 확정 결함으로 부르지 않습니다.
- 작은 설계: 화면 입력용 immutable `QuickEditSnapshot`과 현재 `Draft` 두 값만 유지하고, Intent codec 한 곳에서 decode/encode합니다. patch/split은 draft에서 명시적으로 생성합니다. Activity 전체를 새 추상 UI framework로 옮길 필요는 없습니다.
- 보존: QE-002 실제 변경 필드만 patch, QE-008 누락 Intent 호환, QE-009 구 entry Query fallback, QE-010 분할의 현재 미저장 draft 고정, QE-013 tags 생략/명시 [] 구별, session scope·expectedVersion·서버 provenance.
- 회귀: 실제 Activity 재생성 전후 category/memo/tags draft, tags-only/명시 []/누락 tags, split 미저장 draft, 오래된 response 및 scope 변경. 기존 `QuickEditActivityInstrumentationTest`, tags/patch unit, `QuickEditFirebaseE2ETest` 연결을 유지해야 합니다.
- 확신: **중간**. 중복 표현은 확실하나 제품 효과와 Android 자동 view-state 복원 상호작용을 실제 검증한 후 수정해야 합니다.

### 8. 모든 알림 event에 붙은 legacy Shortcut guard의 종료 조건 명시

- 근거: `notifications/application/notificationOutboxDispatchApplication.ts:35~36`은 지원하는 모든 새 notification event에서 optional legacy completion을 조회합니다. `bootstrap/firebaseNotificationOutbox.ts:21~29`가 항상 guard를 연결하고 `adapters/firebase/notifications/firebaseNotificationReconciliation.ts:36~57`은 `shortcutNotificationInboxes`의 event hash 문서를 조회합니다. 현재형 delivery state machine 외 과거형 Inbox 상태가 공존합니다.
- 소비자: 실 outbox dispatch 및 reconciliation scheduled 경로입니다. 명시적 수동 알림을 포함한 비-Shortcut event까지 구 저장소 검사를 통과합니다.
- 작은 설계: 먼저 legacy 생산자·진행 중 Inbox·재전달 최대 보존 기간을 계측해 종료 조건을 문서화합니다. 의미가 있는 과거 Shortcut event에만 compatibility guard를 제한할 수 있는지 확인하고, 경과 후 제거합니다. 단순 무조건 삭제는 제안하지 않습니다.
- 보존: PUSH-008/010 endpoint별 provider 한 번, 결과 불명 상태 자동 재전송 금지, 30일 terminal/event 정책, 구/신 소비자의 이중 전송 방지.
- 회귀: 구 완료→새 consumer 무전송, 구 진행 중→보류/만료 처리, 새 수동 event→새 delivery만 사용, unknown-provider-outcome→재전송 없음. `notification-outbox-production-flow`와 `delivery-reconciliation.contract`를 실제 adapter 경계까지 유지합니다.
- 확신: **중간**(상시 호환 조회 존재는 확인), **제거 가능 시점은 미확정**. 운영 자료를 읽지 않았으므로 현재 구 Inbox가 0건이라고 주장하지 않습니다.

## 작은 부가 정리와 경계 교차 확인

- `CategoryRepository.kt:100`, `137`, `144`의 subscribe/find-by-label/default-key API는 Android 검색에서 정의 외 제품 호출이 없습니다. 실제 QuickEdit은 `getActiveCategories`만 씁니다. 사용하지 않는 조회 surface를 줄이는 후보입니다. 다만 hardcoded fallback 자체는 현재 instrumentation 계약에 명시되어 있어 임의 삭제하면 안 됩니다. 잘못된/없는 catalog와 진짜 빈 catalog를 같은 기본 목록으로 보이는 정책은 별도 사용자 동작 검토 대상입니다.
- Android `PaymentSourceRegistry.kt`와 서버 `defaultPaymentSourceRegistry.ts`의 package 목록은 중복 관리됩니다. 지금 바로 새 generator framework를 도입하기보다 실제 지원 source 정합성 검증 하나가 더 작은 선택일 수 있습니다. 서버 parser version·currency 정책은 Android allowlist와 역할이 달라 합칠 이유가 없습니다.
- 재무 보고서의 `ledger/application/commands/cancelCapturedLineage.ts`는 `ledger/public.ts:25` 타입 재수출 외 runtime import가 보이지 않습니다. 실제 취소는 `firebaseCaptureLedgerPersistence.ts:14,646`와 `transformationLineageService.ts:11`이 `captureLineageCancellationGraph`를 사용합니다. `service.cancelCapturedLineage(...)`라는 테스트 메서드 이름만으로 과거 동명 파일이 사용된다고 판단하면 안 됩니다. 삭제 전 실제 취소 그래프와 호출자를 구별하는 FIN-02의 조건을 적용한다.

## 유지할 정당한 복잡성

1. Capture transaction/balance의 독립 branch receipt와 원장 downstream idempotency는 서로 다른 실패 범위입니다. 한 성공이 다른 실패를 가리지 않고 재전송에서 이미 성공한 지출을 다시 만들지 않아야 합니다.
2. Capture retry journal, QuickEdit 표시 FIFO, QuickEdit command outbox는 각각 미수집 알림·미표시 거래·미전달 사용자 편집을 보존합니다. 큐가 셋이라는 이유만으로 합치면 TTL/성공 의미/장애 복구가 섞입니다.
3. SessionMirror scope/generation, purge rollback, 암호화 실패의 fail-closed, native/Web UID 검증과 trusted main-frame origin은 현재 권한 경계를 위한 비용입니다.
4. Notification delivery claim 뒤 Membership 및 endpoint version을 provider 직전에 다시 확인하는 것은 stale binding·로그아웃·멤버 제거와 경합하기 때문입니다. 중복 확인처럼 보여도 첫 조회 하나로 대체하면 안 됩니다. provider 결과 불명은 일반 네트워크 retry와 다릅니다.
5. FCM component gate·persistent suppression·서버 endpoint 삭제는 OS background 표시, 프로세스 재시작, 서버 fan-out을 각각 막습니다. 한 boolean으로 대체할 대상이 아닙니다.
6. 실제 저장 journal의 구 envelope, 구 snapshot의 tags 생략, 구 APK의 endpoint/wire는 무소비 factory와 다릅니다. 호환 종료 근거 없이 삭제하면 기존 사용자 동작이 바뀝니다.
7. 취소 매칭의 원 승인 증거와 capture lineage/provenance, 여러 provider 메시지 형식과 SMS 우선순위는 도메인 사실입니다. 정규식/정책 개수만 줄이려 하면 다시 금액/취소 오처리가 생길 수 있습니다.
8. QuickEdit 내구 lease와 실제 Activity WeakReference registry는 프로세스 복구와 화면 수명이라는 다른 문제를 해결합니다. 공통 상태 하나로 합치기 전에 재생성/죽음/늦은 callback 계약을 증명해야 합니다.

## 우선순위와 남은 조사

추천 순서는 미사용 운영 구현/API 제거(1·2·6 및 Category 작은 surface), 실제 저장 transaction을 순수 판정으로 정리(5), capture retry 엔진 통일(3), stateless FID(4), UI draft(7)입니다. legacy guard(8)는 먼저 운영 잔존 근거와 종료 조건이 필요합니다. 가장 큰 목표는 파일 수 감소가 아니라 한 기능의 현재 행동을 한 곳에서 이해할 수 있게 만드는 것입니다.

관련 소스·테스트·도구의 본문 검토는 통합 완료했다. 실제 수정 시 행동 계약 변경과 현재 동작의 단순화를 구분하며, 실행 검증은 해당 변경 단위에서 수행한다.


## 추가 본문 확인 결과

- Android 제품 Kotlin 60개와 Manifest를 모두 읽었습니다. `Expense.kt:10~114`의 Category/CardType/Expense 및 `CardLabelFormatter.kt:3~78`은 Android main/test/androidTest 검색에서 정의 외 소비자가 없습니다. 동적 Firestore model 로드 등 전체 build 확인 후 제거할 수 있는 작은 잔재이며, 실제 사용하는 CategoryRepository·LedgerTransactionSnapshot·capture codec와 혼동하면 안 됩니다. 이 확인은 후보 2의 미사용 surface 정리에 포함할 수 있습니다.
- 후보 5의 중첩 메모리 모델은 category archive에서도 확인됩니다. `merchantRuleCategoryArchiveApplication.ts:11~28`은 매 페이지의 실제 storage transaction 안에서 새 remap application을 만들고 `.state()`를 다시 읽습니다. `merchantRuleCategoryRemapApplication.ts:22~31,73~88`의 메모리 processedPages는 이 실제 경로에서는 인스턴스가 매번 새로 만들어져 durable receipt가 아닙니다. 실제 재전송 보호는 외부 atomic store receipt에 있으므로 순수 page mutation으로 줄이되 process/cursor receipt를 유지하는 쪽이 작습니다.
- 실제 configuration adapter 4개가 `adapters/firebase/payment-configuration`이라는 별도 경로에 있어 최초 경로 목록에 빠졌던 것을 발견해 추가하고 본문 전체를 읽었습니다. 최종 목록은 428개입니다. `firebaseRememberMerchantRuleParticipant.ts:9~20`은 원장 transaction 안에서 prepare/stage로 규칙 변화를 함께 저장하므로 이 경계는 보존해야 합니다.
- `firebaseCaptureConfigurationQuery.ts:218~254`의 in-flight coalescing은 완료 캐시가 아니라 동시에 시작한 동일 scope 요청만 합칩니다. 현재 canonical projection invalidation과 결합되어 있으며 일반 TTL 캐시로 바꾸면 설정 수정 뒤 이전 규칙을 적용할 수 있습니다.
- `firebaseCaptureSubmissionReceiptStore.ts:126~159,235~275`는 branch terminal 결과를 단조 병합하고 최초 terminal TTL을 보존합니다. 다른 실행의 늦은 retryable 결과가 성공을 되돌리지 않기 위한 필요한 복잡성입니다.
- `FirebaseNotificationHouseholdPurgeStore:57~98`의 구 Inbox ownership 보강은 신규 데이터 삭제와 별도 migration 단계입니다. 구 자료의 소유자를 입증할 수 없으면 멈추는 fail-closed가 필요하며 후보 8의 종료 조건과 함께 관리해야 합니다. 무조건 예외 무시하거나 타 가구 자료를 추정 삭제해서는 안 됩니다.
- Shortcut HTTP는 IP gate → credential 권한 → credential rate/quota → receipt claim을 서로 다른 경계에서 수행합니다. 실제 credential adapter는 원문을 저장하지 않고 HMAC·subject pointer·operation receipt를 사용하며, issue/reissue/revoke는 하나의 Firestore transaction에서 변합니다. 회전 receipt의 metadata 재생과 원문 최초 1회 반환은 단순화하면서 보존해야 합니다. 공급자별 골든과 실제 parser 연결은 후속 수집 테스트 보고서에서 추가 검토했다.
- 실제 검증 연결을 추가 확인했습니다: `capture-ledger-cancellation-safety.test.ts:109,135,244,279,349`의 구 receipt·원 증거·무관한 merge 보존/불완전 복원 거부, `delivery-assurance.contract.test.ts:116,310,504,558`의 한 번 전송·stale UNREGISTERED·Membership 불가·30일 경계, `QuickEditActivityInstrumentationTest.kt:84,107,130,251,336,431`의 알림만·태그·분할 draft·scope 변경·표시 복구가 해당 생산 분기와 연결됩니다. 테스트 이름과 호출 관계를 확인했으며 이번 조사에서 실행하지 않았습니다.
