# 결제 수집·설정·알림 계약 단순화 검토

- 기준: `676731d9abda95439afc2dfd827690029d89e048`.
- 범위: `android-payment-ingestion`, `shortcut-ingestion`, `payment-configuration`, `notifications`의 Functions/Web/Android 실행 경로와 Android QuickEdit. 일반 Android Host·인증·PWA runtime 내부는 다른 담당 범위이며 여기서는 호출 경계를 확인했습니다.
- 결론: 단축어 설치를 흉내 내던 미사용 서버 계층을 제거하고 실제 발급·설정 화면 검증으로 연결했습니다. 알림 Web facade의 단순 전달 함수는 직접 re-export로 바꿨습니다. 나머지는 아래 계약별 이유로 유지합니다. Android 실행 코드는 변경하지 않았습니다.
- 이전 조사 재사용: [결제·알림 전수 목록](../simplicity-2026-10-05/capture.md), [Android 단일 flush·snapshot 정리](../../operations/android-capture-simplicity-2026-10-05.md), [보존 결정](../../operations/simplicity-retention-decisions-2026-10-05.md). 이번에는 공개 진입점·현행 호출자·Application·저장/전달 경계와 기존 검사를 다시 대조했습니다. 194개 파일 각각을 새로 전부 정독했다는 의미는 아닙니다.

## 1. 코드량과 범위

[전체 실행 파일 목록과 파일별 기준/최종 줄 수](capture-notifications-inventory.json)는 고정 기준의 Functions context·관련 Firebase/crypto Adapter·bootstrap, Web feature/service/settings, Android capture/QuickEdit/notification source를 포함합니다. 빈 줄·주석을 포함한 물리 줄 수이며 테스트·문서·생성물은 제외했습니다. 파일 이동이나 줄 압축은 없습니다.

| 범위 | 기준 | 최종 | 감소 |
|---|---:|---:|---:|
| 검토 실행 코드 전체(기준 194파일, 최종 190파일) | 24,969 | 24,671 | 298줄, 1.19% |
| 실제 변경한 실행 코드 6파일 | 362 | 64 | 298줄, 82.32% |

| 변경 파일 | 기준→최종 | 실제 변경 |
|---|---:|---|
| `functions/src/contexts/payment-capture/shortcut-ingestion/application/shortcutCredentialStorageInstallerApplication.ts` | 91→0 | 운영 호출자가 없는 lifecycle 재포장 제거 |
| 같은 모듈 `application/ports/in/shortcutCredentialStorageInstallerInputPort.ts` | 31→0 | 해당 재포장 전용 Port 제거 |
| 같은 모듈 `domain/model/shortcutCredentialStorageInstaller.ts` | 74→0 | 자체 설치 정의·중복 결과 DTO 제거 |
| 같은 모듈 `domain/policies/createShortcutInstallation.ts` | 40→0 | 사용되지 않는 가상 Shortcut 생성 제거 |
| 같은 모듈 `public.ts` | 71→45 | 위 dead surface 재노출 제거 |
| `web/src/lib/pushNotificationService.ts` | 55→19 | 기존 공개 이름으로 PWA 함수 직접 re-export |

테스트 fixture 삭제·검사 합병에 따른 줄 감소는 제품 코드 감소에 넣지 않았습니다. 특히 보안·멱등성·session 격리 코드는 감소 목표로 삼지 않았습니다.

## 2. 공개 계약별 판정

아래 표의 경로는 repository root 기준이며 상세 파일 목록은 위 inventory에 모두 있습니다. 공개 계약은 모듈 design의 Input Port를 기준으로 하고 현재 노출된 내부/클라이언트 계약을 함께 적었습니다.

### android-payment-ingestion — 유지

요구사항: `ING-001..009`, 모든 `PARSE-*`, `ING-SAVE-001..007`, `CAN-001..007`.

| 공개 계약·경계 | 현행 주요 파일 | 유지 근거·불변식 |
|---|---|---|
| 알림 수집·source gate·message 추출 | Android `service/CardNotificationListenerService.kt`, `NotificationMessageExtractor.kt`, `paymentcapture/PaymentSourceRegistry.kt`, `RawNotificationCandidateFactory.kt`, `RawNotificationForwardingPolicy.kt`, `RawNotificationGroupSummaryPolicy.kt` | 지원 package gate, 실제 message 선택, 30초 process 중복은 서버 영속 멱등성과 수명이 다릅니다. 알림 수정·그룹 summary를 모두 같은 텍스트 검사로 합치지 않습니다. |
| `SubmitRawNotification`, `QueueRawNotification`, `SubmitQueuedObservation` | Android `CaptureBatchDelivery.kt`, `CaptureDeliveryQueue.kt`, `AndroidCaptureDelivery.kt`, `CaptureDeliveryWorker.kt`, `CaptureRetryWorkScheduler.kt`, `AndroidKeystoreCaptureQueueStore.kt` | 직접/Worker 전달은 이미 같은 `flush`를 사용합니다. 네트워크와 저장 lock 분리, 원격 제출 전 journal, 고정 observation, 72시간 보존, scope/generation purge, 후속 QuickEdit 먼저 저장을 유지합니다. |
| `SubmitAndroidRawNotification` | `functions/src/bootstrap/firebaseCaptureSubmission.ts`, `androidRawNotificationSubmissionApplication.ts`, `androidProviderParserApplication.ts`, `validateAndroidCaptureSource.ts`, raw decoder/hasher | Auth·App Check 이후 서버 source/parser가 권위입니다. raw 파싱 무결과도 terminal이며 created snapshot은 실제 저장 결과입니다. 클라이언트 parser와 중복 구현하지 않습니다. |
| `SubmitCaptureEnvelopeV1` 승인·balance 독립 branch | `captureSubmissionApplication.ts`, `captureBranchSubmissionApplication.ts`, `captureTransactionGatewayApplication.ts`, `firebaseCaptureSubmissionReceiptStore.ts`, `firebaseCaptureLedgerPersistence.ts` | 승인 단독 경로는 이미 Ledger 원자 receipt를 직접 사용합니다. 다중 branch의 terminal/retryable, 서로 다른 downstream key, 동시 결과 병합은 독립 성공을 보존하므로 하나의 성공 플래그로 줄이지 않습니다. 구 APK queue 입력도 보존합니다. |
| 취소 제출·provenance | `domain/policies/capturedApprovalCancellation.ts`, `domain/value-objects/cancellationEvidence.ts`, capture gateway와 Ledger Port | 금액·정규 가맹점·카드·불변 원증거로 후보를 정하고 유일 후보만 lineage 전체 원자 취소합니다. 복수는 확인 필요, 없음은 무변경이며 후속 실제 승인 금액으로 추정 삭제하지 않습니다. |
| provider parse·`ParseCityGasBill`·연도 | `domain/parsers/*`, `parseCityGasBill.ts`, `intake/domain/policies/paymentOccurrenceYear.ts` | provider마다 다른 승인/취소/잔액 증거가 있어 범용 정규식 엔진으로 합치지 않습니다. 공유 연도·공통 문자열 처리는 이미 단일 정책입니다. |
| Diagnostic 저장·보존 | `diagnosticRetentionApplication.ts`, `firebaseNotificationDiagnostic.ts`, `firebaseDiagnosticDocumentStore.ts`, Android `NotificationDebugLogRepository.kt` | 업무 저장과 관리자 원문 진단은 권한·실패·보존 정책이 다릅니다. 진단 실패가 결제·QuickEdit을 막지 않는 best-effort 및 전송 지연을 유지합니다. |

### shortcut-ingestion — 설치 계층 정리, 나머지 유지

요구사항: `IOS-001..015`.

| 공개 계약·경계 | 주요 파일 | 판정·불변식 |
|---|---|---|
| `IssueShortcutCredential`, `ReissueShortcutCredential`, `GetShortcutCredentialStatus`, `RevokeShortcutCredential`, `Authorize` | `shortcutCredentialLifecycleApplication.ts`, lifecycle Input/Output Ports, `firebaseShortcutCredentialInfrastructure.ts`, `shortcutCredentialHouseholdCommandHandlers.ts`, `shortcutCredentialHouseholdQueryHandlers.ts` | **유지**. 최초 원문 응답, hash 저장, status 비밀 비노출, 재전송 metadata, 원자 교체, Membership·keyVersion·capability 검증은 다른 경계입니다. 발급/재발급의 작은 유사 전처리를 옵션 많은 범용 명령으로 바꾸지 않습니다. |
| 발급 후 복사·공유 Shortcut 설치 | Web `features/payment-capture/application/shortcutCredentials.ts`, `components/settings/ShortcutSettings.tsx` | **정리**. 실제 UI는 lifecycle 응답의 URL을 사용하고 서버의 가상 installation 객체를 소비하지 않았습니다. 미사용 installation 계층만 제거합니다. 기존 한 번 표시·복사 후 열기·실패 시 수동 진행·재발급 확인은 그대로입니다. |
| `ProcessShortcutRequestV1`/현행 processor | `firebaseShortcutHttp.ts`, `shortcutHttpInboundHandler.ts`, `shortcutHttpRequestProcessorApplication.ts`, `firebaseShortcutHttpInfrastructure.ts` | **유지**. wire method/content/version/size/IP 제한과 credential 제한은 인증 전후 위치가 다릅니다. receipt claim 뒤 parser/Intake 결과별 complete/abandon, 거래와 알림 결과 구분을 유지합니다. |
| 값 정규화·`ParseShortcutMessage`·연도/owner | `normalizeShortcutValue.ts`, `parseShortcutCardMessage.ts`, `shortcutCardMessageParserApplication.ts`, 공통 Intake/configuration | **유지**. 순환/배열 입력, provider 증거와 연도 정책, credential Actor의 본인 카드 판단을 유지합니다. 승인/취소는 공통 Capture로 한 번 위임하며 Shortcut 전용 취소 규칙을 추가하지 않습니다. |
| 인증 후 원문 진단·duplicate notification | `firebaseShortcutMessageDiagnostic.ts`, HTTP processor, 공통 Intake/Notifications | **유지**. parser 성공/거부 진단과 업무 결과는 독립이고 duplicate는 새 거래 없이 결정적 event를 생성합니다. 일반 로그·응답에 원문을 노출하지 않습니다. |

삭제 근거: `functions/src`, `functions/test`, `web/src`, `tools`의 사용처 검색에서 storage-installer의 소비자는 테스트 fixture뿐이었습니다. 삭제 후 해당 factory/type/definition 참조는 0건입니다. 실제 bootstrap은 lifecycle과 HTTP processor를 직접 구성합니다.

검증 경계: 제거한 installation 정의의 `POST/JSON/Authorization` 문자열 비교는 외부 iCloud Shortcut를 실행하지 않았습니다. 외부 설치물의 내부 설정을 검증했다고 주장하지 않으며 설치 요구사항을 완화하지 않았습니다. 실제 HTTP 검사는 유지하고 실제 UI의 반환 URL·복사·일회 노출을 추가 확인합니다. 기존 logout 두 검사는 아무 작업도 하지 않는 테스트 함수 호출이므로 인증 검증으로 보지 않았습니다. 실제 브라우저 logout 경로는 `authService.logOut`이며 기존 `browserAuthBootstrap.contract.test.ts`가 Firebase signOut와 Native 미호출을 검증합니다. Shortcut revoke를 호출하는 생산 경로를 추가하지 않았습니다.

### payment-configuration — 유지

요구사항: `CARD-001..005`, `MER-001..007`.

| 공개 계약·경계 | 주요 파일 | 유지 근거·불변식 |
|---|---|---|
| `RegisterCard`, `UpdateRegisteredCard`, `DeleteRegisteredCard`, `ReorderCards` | `paymentConfigurationRuntimeApplication.ts`, `registeredCardMutation.ts`, `registeredCardCommandBoundaryInputPort.ts`, `firebasePaymentConfigurationAtomicStore.ts`, command handler | 현재 구조는 실제 transaction에서 읽은 상태에 순수 mutation을 적용합니다. 소유자 변경 금지·삭제/retire·동시 정렬 version과 실패 DTO가 달라 CRUD 템플릿으로 합치지 않습니다. |
| `ListMemberCards`, `MatchRegisteredCard` | `ownCardResolution.ts`, `cardIdentity.ts`, `firebaseCaptureConfigurationQuery.ts`, Web `registeredCardService.ts`, `CardSettings.tsx` | 본인 카드만, wildcard·번호 없음·복수 match 의미를 보존합니다. Web 목록과 collectionVersion의 두 subscription은 정렬 command의 원자 version을 확보하므로 둘 다 준비된 시점만 발행합니다. |
| `CreateMerchantRule`, update/delete, `ReorderMerchantRules`, `MatchMerchantRule` | `merchantRuleMutation.ts`, `merchantRuleSelection.ts`, `merchantRuleClaims.ts`, runtime/store, Web `merchantRuleService.ts`, `MerchantRuleSettings.tsx` | 정규 keyword claim·동시 충돌·정렬·카테고리 참조가 이미 단일 mutation에 있습니다. 빈 값과 중복 키를 짧은 truthy 표현으로 합치지 않습니다. |
| 기존 거래로 규칙 기억·`RemapMerchantRuleCategoryReferences` | `rememberExistingTransactionMutation.ts`, `rememberMerchantRule.ts`, `firebaseRememberMerchantRuleParticipant.ts`, `merchantRuleCategoryRemapApplication.ts`, `merchantRuleCategoryArchiveApplication.ts`, `firebaseMerchantRuleCategoryRemapper.ts` | 거래 수정과 규칙 기억은 같은 transaction participant, 카테고리 archive는 checkpoint 기반 page로 책임이 다릅니다. 읽기 없이 쓰거나 process를 단일 CRUD로 줄이면 원자성·복구가 바뀝니다. |
| Capture 초안 보강 | `enrichPaymentDraft.ts`, `paymentDraftEnrichment.ts` | 카드/규칙 결과를 조합하는 순수 경계만 유지합니다. 원장 저장·provider parser를 이 계층으로 이동하지 않습니다. |

### notifications — Web 전달 facade 정리, 나머지 유지

요구사항: `PUSH-001..014`, Shortcut `IOS-008..009` consumer.

| 공개 계약·경계 | 주요 파일 | 판정·불변식 |
|---|---|---|
| `RegisterEndpoint`, `RemoveEndpoint`, `MarkEndpointInactive` | `mobileEndpointCommands.ts`, endpoint policies, `firebaseMobileEndpointRegistrationStore.ts`, notification command handler | **유지**. 같은 FID의 binding 원자 교체, 자기 설치 logout, stale version callback 무시는 서로 다른 명령입니다. 인증·Membership 선검증, 다른 설치 보존을 유지합니다. |
| Client 권한·등록 상태·foreground listener | Web `pushNotificationService.ts`, `NotificationSettings.tsx`, `features/notifications/application/notificationCommands.ts` | **정리**. facade가 같은 값을 그대로 반환하던 부분만 실제 PWA 함수의 별칭 export로 바꿨습니다. async/동기 구분, callback 및 unsubscribe 서명은 원래 구현과 같습니다. `Platform` 조회 두 함수는 기존 책임을 유지합니다. |
| Android FID 등록·logout·표시 | `util/FidEndpointManager.kt`, `notifications/FcmServiceComponentGate.kt`, `FidEndpointCommandPayloads.kt`, `service/FcmService.kt` | **유지**. 서버 삭제 실패 중 로컬 component 선차단·기존 알림 취소, SDK unregister·세션 없는 process 억제는 중복으로 제거할 수 없습니다. OS 표시 권한과 수집/등록/QuickEdit 설정은 별개입니다. |
| `AcceptNotificationIntent` — 자동/명시/duplicate | `notificationOutboxDispatchApplication.ts`, `deliveryAssuranceApplication.ts`, `planNotificationTargets.ts`, recipient/fanout policies, Firebase delivery Adapter | **유지**. channel별 수신자, 다중 설치 중복 제거·정렬, 멤버별 pushDelivery, 원자 Inbox/intent/claim이 필요합니다. 자동 iOS creator와 명시 요청자 제외의 정책을 옵션 분기로 뒤섞지 않습니다. |
| `DeliverNotification`, 완료·상태 조회 | `deliveryAssuranceApplication.ts`, `deliveryOutcomePolicy.ts`, `firebaseNotificationDeliveryAdapters.ts` | **유지**. 먼저 sending claim, provider 직전 Membership와 endpoint version 재확인, endpoint당 sendOne 1회, 결과 commit은 서로 다른 경쟁을 다룹니다. 불명확한 응답을 재전송하지 않으며 상태 조회는 FID를 노출하지 않습니다. |
| `GetDeliveryStatus`, endpoint/intent 목록 | 동일 Application의 비민감 view mapper와 결정적 정렬 | **유지**. 정렬과 오류·unknown·permanent를 유지하며 저장 모델을 그대로 반환하지 않습니다. |
| `HandleHouseholdMemberRemoved`, `PurgeHouseholdData` | `firebaseNotificationMemberCleanupStore.ts`, `notificationHouseholdPurgeApplication.ts`, `firebaseNotificationHouseholdPurgeStore.ts` | **유지**. 제거 member만 page별 cleanup, purge SystemActor·receipt·checkpoint 원자성은 보존합니다. 복원으로 옛 endpoint를 부활시키지 않습니다. |
| 전송 reconciliation·legacy guard·보존 | `deliveryReconciliationApplication.ts`, `firebaseNotificationReconciliation.ts`, `notificationRetentionPolicy.ts`, outbox dispatch | **유지**. 중단된 sending은 unknown terminal로 확정하고 provider를 재호출하지 않습니다. 기존 호환 완료 기록은 실제 잔존/보존 증거 없이 제거하지 않습니다. terminal 30일과 active endpoint 무기한을 구분합니다. |
| payload·안전한 click | `notificationTarget.ts`, PWA consumer와 root 소유 runtime | **유지**. version/허용 target·동일 origin을 보존하며 메시지 원문·FID가 일반 payload나 URL로 확대되지 않습니다. |

### Android QuickEdit — 유지

범위는 [android-host의 QuickEdit 계약](../../requirements/supporting-platform/modules/android-host/design.md#33-quickedit-client-계약)이며 일반 host는 root가 별도로 검토합니다. `QE-001..013` 전체를 아래와 연결합니다.

| 계약 | 주요 파일 | 유지 이유 |
|---|---|---|
| `OpenQuickEdit`, FIFO·lease·session 정리 (`QE-001,008,009,011`) | `QuickEditCoordinator.kt`, `QuickEditPendingQueue.kt`, `QuickEditPresentationRegistry.kt`, Keystore queue, `QuickEditSnapshotIntent.kt` | 현재 표시를 덮어쓰지 않는 FIFO와 created snapshot, ID-only 구버전 query, scope/generation 격리는 필요합니다. 원본 snapshot이 이미 단일 형태여서 별도 표시/명령 상태를 무리하게 합치지 않습니다. |
| `UpdateTransactionClient`, `DeleteTransactionClient`, `RequestHouseholdNotificationClient` (`QE-002,003,004,012`) | `QuickEditActivity.kt`, `QuickEditUpdatePatch.kt`, `QuickEditCommandOutbox.kt`, delivery/lifecycle/codec | 실제 변경 patch만 전달하고 빈 memo·tags []는 명시 삭제입니다. 원본 version, 고정 command envelope, durable scheduling 전 화면 유지, 업무 성공 전 성공 표시 금지를 보존합니다. 알림 요청에 미저장 편집을 넣지 않습니다. |
| `SplitTransactionClient` (`QE-005,006,007,010`) | `QuickEditActivity.kt`와 일반 Ledger Command client | 현재 form의 immutable draft·태그를 한 Split에 넣습니다. 두 항목일 때만 자동 반대 금액, 합계/양수, 원본 보존·서버 lineage·Conflict를 유지합니다. 선행 Update를 추가하지 않습니다. |
| 태그 편집·누락 호환 (`QE-013`) | `QuickEditTags.kt`, `QuickEditUpdatePatch.kt`, snapshot/Intent/outbox codec | 마지막 제거 []와 미변경/구버전 생략은 다릅니다. 기존 초과 태그를 임의 삭제하거나 수정을 막지 않고 새 입력만 정규 규칙을 적용합니다. |
| 같은 앱 즉시 반영 (`QE-002`, `T-QE-009`) | `QuickEditUpdateFeedback.kt`, `QuickEditUpdateFeedbackBridge.kt`, Web Ledger Projection consumer | durable 접수 후 pending 신호는 업무 성공이 아니며 실패 rollback/새 version/다른 session 보호가 필요합니다. 서버 구독과 feedback은 전달 시점이 달라 하나를 제거하지 않습니다. |
| `ListActiveCategoriesClient` | QuickEdit Activity와 일반 category client | 실제 shared category 조회를 사용합니다. 별도 QuickEdit category 업무 모델이나 fake catalog를 추가하지 않습니다. |

## 3. 검사와 실제 실행 범위

실행한 단위 검사:

- 변경 전 Shortcut lifecycle·storage/installer·실제 command handler: **3파일 48개 통과**.
- 변경 후 `functions`: `vitest run test/contexts/payment-capture test/contexts/notifications test/adapters/payment-capture test/adapters/firebase/notifications test/bootstrap/shortcut-credential-household-command-handlers.test.ts --reporter=dot` — **36파일 544개 통과**.
- 변경 후 `web`: `jest --runInBand src/__tests__/components/ShortcutSettings.test.tsx src/__tests__/features/shortcutCredentials.contract.test.ts src/__tests__/components/NotificationSettings.contract.test.tsx src/__tests__/platform/pwaFidEndpointLifecycle.contract.test.ts` — **4파일 37개 통과**.
- 삭제 대상의 전체 runtime/test/tools 참조 검색 — **0건**.

기존 faux installer 검사는 실제 lifecycle을 직접 호출하는 13건으로 정리했습니다. 실제 저장소의 원자성을 in-memory fixture만으로 입증했다고 표현하지 않습니다. 최초 원문·hash·Actor, 사용 시각만 변경, keyVersion·비활성 Membership, 최초 재전송, concurrent reissue·failed commit·같은 key retry·교체 replay·이전 키 거부·다른 주체 금지를 유지합니다. UI에는 복사 후 반환 URL 열기·URL 원문 비노출·화면 재진입 비노출, clipboard 실패와 수동 진행, alreadyIssued metadata 갱신 3건을 추가했습니다.

Root 통합 검증으로 전달한 실제 SDK 경로는 `functions/test/integration/firebase/shortcut-credential-rotation.integration.test.ts`입니다. 실제 Firebase 저장·동시 발급/교체·실패 rollback·secret 비저장의 기존 검사를 유지했습니다. Root가 실행한 실제 Firebase SDK 통합 검사는 이 파일을 포함하여 **4파일 33개 통과**했습니다. 전체 TypeScript/architecture·Web E2E·CI는 root 실행 결과로 완료 여부를 판단하며 여기서 실행한 것으로 세지 않습니다. Android 제품 변경과 APK 배포는 없습니다. 운영 데이터는 조회·변경하지 않았습니다.
