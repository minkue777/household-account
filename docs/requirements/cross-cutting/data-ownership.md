# 데이터 소유권과 Context 의존성

> 상태 규약: [요구사항 문서 규약](../governance/conventions.md)  
> Context 지도: [현재 시스템 요구사항 인덱스](../README.md#2-5개-업무-bounded-context)  
> 목적: 논리 데이터·필드와 변경 규칙에 하나의 소유 Context와 하나의 최종 Writer 기능을 지정한다.

## 1. 소유권 원칙

- Bounded Context는 업무 언어와 일관성 경계를 소유한다.
- 기능 모듈은 Aggregate·논리 데이터·필드의 최종 Writer다.
- 같은 물리 문서에 서로 다른 기능의 필드가 섞여 있으면 컬렉션 전체를 공동 소유하지 않고 논리 필드별 소유자를 기록한다.
- 다른 기능과 Context는 소유자의 Command, Query, Projection 또는 versioned Integration Event를 사용한다.
- Read Model은 소비 화면에 맞게 만들 수 있지만 원본 변경 권한을 복제하지 않는다.
- 전환 기간의 기존 Writer와 dormant 함수는 현재 상태일 뿐 목표 소유권으로 인정하지 않는다.
- 임시 진단 데이터는 Domain Aggregate·영구 Audit 데이터로 승격하지 않는다.
- Canonical 변경과 Context 간 Event는 같은 Unit of Work의 Outbox에 기록한다.
- 공통 Outbox 물리 저장소는 여러 producer가 불변 Event를 추가하는 append-only 플랫폼 예외다. 각 `eventType + version`의 논리 Writer는 하나의 producer 기능이며, 모든 producer는 공통 `OutboxAppendPort`만 사용한다.

## 2. 논리 데이터·필드 책임 지도

| 현재 위치·논리 데이터 | 현재 Writer | 현재 Reader | 소유 Context | 최종 Writer 기능 | 목표 형태·전환 위험 |
|---|---|---|---|---|---|
| `households`의 가구 이름·상태 | Web, Functions | Web, Android, Functions | [Access & Household](../contexts/access-household/requirements.md) | [가구와 접근](../contexts/access-household/modules/household-access/requirements.md) | 안정 householdId와 생명주기; 인증 없는 쓰기 제거 |
| `households`의 멤버 이름 배열 | Web, Functions | 대부분 기능 | [Access & Household](../contexts/access-household/requirements.md) | [가구와 접근](../contexts/access-household/modules/household-access/requirements.md) | `members/{memberId}`와 role 없는 Google UID Membership; 신규 자기 Member만 생성, legacy Member만 전환 전 미연결; 생성자·초대 가입자 동일 권한; 전체 관리자 제거는 `removed` 보존·claim 해제, 복구는 같은 ID 재활성화; 이름 외래 키 제거 |
| 자산 명의자 프로필 | 신규 목표 Writer | Portfolio, Web | [Access & Household](../contexts/access-household/requirements.md) | [가구와 접근](../contexts/access-household/modules/household-access/requirements.md) | `assetOwnerProfiles/{profileId}`; Member 연결형과 비로그인 dependent를 구분하고 일반 삭제 금지·관리자 논리 보관·profileId와 보관된 표시 이름 유지를 강제; Portfolio는 공개 Query로만 검증·표시 |
| localStorage `householdKey/currentMemberId/currentMemberName` | Web legacy session | Web | [Access & Household](../contexts/access-household/requirements.md) | [가구와 접근](../contexts/access-household/modules/household-access/requirements.md) | householdKey+currentMemberId 완전 후보만 첫 Google 로그인의 `LegacySessionCandidate`로 읽고 기존 householdId·memberId Membership claim 뒤 key 로그인 상태 제거; 값이 없거나 불완전하면 신규 사용자; 업무 데이터 복사 없음 |
| localStorage 마지막 검증 session·가구·현재 월 원장·가구별 카테고리 표시 snapshot | Web Auth/Firestore Read Adapter | Web 첫 화면 | 공통 시스템·Access·Household Finance Read Model | [Android Host](../supporting-platform/modules/android-host/requirements.md) 표시 cache Adapter | DEC-068의 비권위·재구축 가능한 표시 hint; 마지막 검증 UID·household·월·거래 유형 또는 household category 범위로 묶고 Auth·App Check·Rules·Membership을 대체하지 않음; 불일치·권위 거부에서는 화면 사용 중단 |
| 5분 초대 코드와 Invitation 상태 | 목표 서버 Writer | 가입 온보딩 | [Access & Household](../contexts/access-household/requirements.md) | [가구와 접근](../contexts/access-household/modules/household-access/requirements.md) | code hash·expiresAt·usedAt만 저장; 소비와 호출자 자기 Member·Membership 원자 생성 |
| `households.defaultCategoryKey` | Web | Web, Android | [Household Finance](../contexts/household-finance/requirements.md) | [카테고리·예산](../contexts/household-finance/modules/categories-budget/requirements.md) | Category Catalog 설정으로 분리 |
| `households.homeSummaryConfig` | Web | Web | [지원·플랫폼](../supporting-platform/requirements.md) | [홈 환경설정](../supporting-platform/modules/home-preferences/requirements.md) | Home Preferences 소유 문서로 분리 |
| `expenses` 거래 본문·분할·합치기·source·creator | Web, Android, Functions | 대부분 기능 | [Household Finance](../contexts/household-finance/requirements.md) | [거래 원장](../contexts/household-finance/modules/ledger/requirements.md) | 모든 Command Writer를 Ledger Application 뒤로 통합 |
| 거래의 immutable capture reference·split/merge lineage | 현재 일부 필드만 복사 | Payment Capture, Ledger 취소 | Payment Capture가 증거·취소 대상 의미, Household Finance가 원본·파생 거래와 lineage 저장·삭제를 소유 | Payment Capture receipt + [거래 원장](../contexts/household-finance/modules/ledger/requirements.md) | 표시·편집 필드와 분리한 observation/capture ID, 원 금액·가맹점·카드·시각·parser version; 구조 변경 원본은 superseded 보존, DEC-041 취소 시 대상 lineage 전체 삭제·다른 lineage 복원 |
| `expenses`의 명시적 가구원 알림 요청 metadata | Web | Functions | [Household Finance](../contexts/household-finance/requirements.md) | [거래 원장](../contexts/household-finance/modules/ledger/requirements.md) | Ledger가 requesterMemberId·requestedAt 사실을 소유하고 Notifications는 Event 소비; legacy `notifyPartner*`는 전환 Mapper에서만 읽음 |
| 결제 fingerprint claim | Android·Functions의 query 기반 판정 | Android, Functions | [Household Finance](../contexts/household-finance/requirements.md) | [거래 원장](../contexts/household-finance/modules/ledger/requirements.md) | fingerprint claim + Transaction + Outbox 원자 저장; 의미는 Payment Capture Policy |
| `categories` | Web | Web, Android | [Household Finance](../contexts/household-finance/requirements.md) | [카테고리·예산](../contexts/household-finance/modules/categories-budget/requirements.md) | 안정 categoryId, 기본 카테고리 archive 금지, 과거 표시 보존 |
| 월 예산 사용액·잔여액 | Web client 계산 | Web | [Household Finance](../contexts/household-finance/requirements.md) | [카테고리·예산](../contexts/household-finance/modules/categories-budget/requirements.md) | Ledger 공개 월 범위 Query를 모두 읽어 요청 시 계산, 영속 Projection 없음 |
| `recurring_expenses`와 처리 월 | Web | Web | [Household Finance](../contexts/household-finance/requirements.md) | [정기 거래](../contexts/household-finance/modules/recurring-transactions/requirements.md) | plan/month execution, Ledger posting, category archive page remap의 단일 Writer |
| `balances` | Android | Web | [Household Finance](../contexts/household-finance/requirements.md) | [지역화폐](../contexts/household-finance/modules/local-currency/requirements.md) | 가구·currencyType 결정 key; DEC-008 적용 |
| `registered_cards` | Web | Web, Android, Functions | [Payment Capture](../contexts/payment-capture/requirements.md) | [결제 설정](../contexts/payment-capture/modules/payment-configuration/requirements.md) | ownerName을 memberId로 전환, uniqueness claim |
| `merchant_rules` | Web | Web, Android | [Payment Capture](../contexts/payment-capture/requirements.md) | [결제 설정](../contexts/payment-capture/modules/payment-configuration/requirements.md) | Web·Android 중복 Policy와 category archive page remap을 서버 계약으로 통합 |
| Android parser registry·fixture | Android 코드 | Android | [Payment Capture](../contexts/payment-capture/requirements.md) | [Android 결제 수집](../contexts/payment-capture/modules/android-payment-ingestion/requirements.md) | 순수 parser와 비식별 fixture |
| Shortcut 요청·응답·parser 계약 | Functions | Shortcut client | [Payment Capture](../contexts/payment-capture/requirements.md) | [Shortcut 결제 수집](../contexts/payment-capture/modules/shortcut-ingestion/requirements.md) | scoped credential과 `CaptureEnvelope.v1`의 payment branch 변환 |
| CaptureEnvelope·CaptureSubmissionReceipt | Android Queue·Functions의 암묵 재시도 | Payment Intake | [Payment Capture](../contexts/payment-capture/requirements.md) | Payment Intake Application | Envelope는 원문 없는 선택적 payment/balance 입력 값이고 최소 한 branch가 필수; receipt는 householdId·idempotencyKey·payloadHash·branch별 typed result를 소유하고 충돌을 거부 |
| `notification_debug_logs` | Android | 저장소 내 Reader 없음 | [Payment Capture](../contexts/payment-capture/requirements.md) | Android Diagnostic Adapter | Domain 밖 임시 민감 데이터; DEC-047에 따라 기능 제거 전 TTL 없이 전부 보존하고 V2 이관 없이 DEC-002로 Writer·Rules·index·컬렉션 공동 제거 |
| `assets`의 계정 본문·명의자 참조·잔액·순서·생명주기 상태 | Web, Functions | Web, Functions | [Portfolio](../contexts/portfolio/requirements.md) | [포트폴리오](../contexts/portfolio/modules/portfolio/requirements.md) | Portfolio Core만 최종 Asset Writer; ownerRef는 household 또는 Access profileId, 표시 이름 저장 금지; false 레거시는 deleted, 논리 삭제 시 종속 데이터 보존 |
| `assets`의 자동 납입·상환 설정·checkpoint | Web, Functions | Web, Functions | [Portfolio](../contexts/portfolio/requirements.md) | [자산 자동화](../contexts/portfolio/modules/asset-automation/requirements.md) | effective AutomationPlanRevision·Plan status/nextDueDate·월 Execution 소유 문서로 분리; execution과 같은 UoW에서만 due 전진 |
| `asset_history` | Functions 활성, Web dormant | Web | [Portfolio](../contexts/portfolio/requirements.md) | [포트폴리오](../contexts/portfolio/modules/portfolio/requirements.md)의 `AssetSnapshotProjector` | commit된 Portfolio 조회 결과의 결정적 날짜 Snapshot; Scheduler·Holdings·Reporting 직접 쓰기 금지 |
| `stock_holdings`, `crypto_holdings` | Web, Functions | Web, Functions | [Portfolio](../contexts/portfolio/requirements.md) | [보유종목과 시세](../contexts/portfolio/modules/holdings-market-data/requirements.md) | Position 소유; Asset 논리 삭제 시 보존, 별도 수동 Asset purge에서만 제거 |
| Market Quote·Provider DTO | Next API, Functions | Holdings job | [Portfolio](../contexts/portfolio/requirements.md)의 Port | [외부 운영 Adapter](../supporting-platform/modules/external-operations/requirements.md) 구현 | Provider 원문을 Domain에 저장하지 않고 Quote 계약으로 변환 |
| 통화쌍별 최신 성공 환율 관측 | Frankfurter Adapter를 호출하는 Web API·Functions | Holdings 평가 | [Portfolio](../contexts/portfolio/requirements.md) | [보유종목과 시세](../contexts/portfolio/modules/holdings-market-data/requirements.md) | pair·rate·`frankfurter-v2`·rateDate·observedAt 단일 관측; 기간 제한 없이 사용하고 원 Quote와 독립 갱신하며 KRW 환산 결과에 두 provenance 보존 |
| Cloud Storage 종목 catalog snapshot·latest manifest | 목표 Scheduled Function | 종목 검색 서버 함수 | [Portfolio](../contexts/portfolio/requirements.md) | [보유종목과 시세](../contexts/portfolio/modules/holdings-market-data/requirements.md)의 `PublishInstrumentCatalog` | DEC-035 최근 성공 3일치 immutable snapshot이 단일 원본; `stocks.json` fallback 없음 |
| `dividend_events` | Functions | Web, Functions | [Portfolio](../contexts/portfolio/requirements.md) | [배당](../contexts/portfolio/modules/dividends/requirements.md) | 결정 ID와 announced→fixed→paid 상태; Asset별 계산 근거를 역사 정보로 보존하며 Asset 논리·영구 삭제에서도 Event와 Annual Projection을 변경하지 않음 |
| `dividend_snapshots` | Functions 활성, Web API·dormant 경로 | Web, Functions | [Portfolio](../contexts/portfolio/requirements.md) | [배당](../contexts/portfolio/modules/dividends/requirements.md) | Event에서 재구축 가능한 Annual Projection |
| legacy `fcmTokens`의 멤버별 registration token | Web callable, Android, Functions rename | Functions | [Notifications](../contexts/notifications/requirements.md) | 제거 대상 legacy 저장소 | FID 전환 뒤 backfill 없이 writer·reader·rename cascade와 함께 제거 |
| 설치별 FID notification endpoint의 현재 가구·멤버 binding과 delivery·Inbox 상태 | 현재 이름 기반 token 문서·delivery 저장 없음 | Functions·운영 | [Notifications](../contexts/notifications/requirements.md) | [푸시 알림](../contexts/notifications/modules/notifications/requirements.md) | endpointId 기반 server-only 상태; active endpoint TTL 없음, inactive endpoint·terminal Inbox/Intent/Delivery/receipt 30일; 로그아웃 즉시 삭제; Member 제거 Event로 멱등 정리하고 cleanup 전후 active Membership gate; 현재 binding 기준 가구 purge 대상 |
| Android 로컬 FID binding 확인·로그아웃 억제와 `FcmService` component 상태 | Android FID Adapter | Android | [Notifications](../contexts/notifications/requirements.md) | [푸시 알림](../contexts/notifications/modules/notifications/requirements.md) | 현재 household/member/registrationVersion 확인과 억제 표지만 저장; 로그아웃은 component 선차단 뒤 best-effort 정리, cloud backup·기기 이전 제외; FID는 일반 로그·공개 Read Model에 비노출 |
| 지출·자산 통계 | Web client 계산 | Web | [지원·플랫폼](../supporting-platform/requirements.md) | [통계](../supporting-platform/modules/reporting/requirements.md) | 원천 수정 권한 없는 재구축 가능 Read Model |
| job run·dead letter·외부 오류 결과 | Functions log·암묵 결과 | 운영 | [지원·플랫폼](../supporting-platform/requirements.md) | [외부 운영](../supporting-platform/modules/external-operations/requirements.md) | 대상별 성공·실패·retry checkpoint와 구조화 관측 |
| `operations/runtime/providerHealth`·run receipt | 명시 저장 없음 | 관리자·운영 도구·에이전트 | [지원·플랫폼](../supporting-platform/requirements.md) | [외부 운영](../supporting-platform/modules/external-operations/requirements.md) | provider+operation별 최신 장애·복구 상태와 run 멱등성; 가격·가구 ID·보유수량·원문 응답 저장 금지 |
| release candidate·gate·deployment record | 현재 명시 저장 없음 | CI·승인된 운영 주체 | [지원·플랫폼](../supporting-platform/requirements.md) | [배포 안전성](../supporting-platform/modules/delivery-assurance/requirements.md) | commit·artifact·contract·Rules·index hash와 smoke 결과; Secret 원문 저장 금지 |

## 3. 비영속·플랫폼 상태

| 상태 | 소유 영역 | 권위 여부 | 규칙 |
|---|---|---|---|
| Web/Android 현재 가구·멤버 세션 | Access Session Adapter | 비권위 mirror | DEC-034의 유일한 Membership에서 검증된 `SessionScope(sessionGeneration, householdId, memberId)` 한 record로 교체·삭제하며 서버 ActorContext를 대체하지 않음; 일반 가계부 선택값은 두지 않음 |
| Android Payment write-ahead journal·실패 Queue | Payment Capture Android Adapter | 전송 대기 상태 | 원격 호출 전 `AndroidRawNotification.v1`을 Keystore 암호화 선기록; terminal follow-up을 QuickEdit FIFO에 내구화한 뒤 ack/delete; 실패·partial만 같은 idempotencyKey로 최대 72시간 WorkManager 재시도 |
| Android QuickEdit FIFO | Android Host | 비권위 표시 대기 상태 | DEC-054·068에 따라 session scope·transaction ID·고유 sequence와 선택적 서버 확정 `quickEditSnapshot`을 Keystore 암호화 저장; 새 snapshot은 즉시 표시하고 ID-only legacy만 Ledger 재조회; Capture journal·Command outbox와 lifecycle 분리 |
| Android QuickEdit Command Outbox | Android Host | 일반 Ledger Command의 비권위 전달 상태 | DEC-067에 따라 session scope·transaction ID·고정 commandId·idempotencyKey·versioned payload를 별도 Keystore 암호화 저장하고 WorkManager 영속 예약; Success·AlreadyProcessed는 즉시 삭제하고 terminal·72시간 만료는 실패 알림 전달 전까지만 needs-attention 보존한 뒤 알림 성공 시 payload 삭제, 복호화·codec 손상은 payload fail-closed 삭제와 비민감 진단 플래그로 분리 |
| Android WebView·권한·QuickEdit 설정 | Android Host | 플랫폼 로컬 상태 | 업무 Aggregate에 포함하지 않음 |
| PWA cache·worker version | PWA | 플랫폼 cache | Canonical 업무 저장소가 아니며 인증·가구·금융 API 응답을 cache하지 않음. 현재 build의 정적 navigation shell과 공개 아이콘·폰트·이미지만 최대 7일 보존하고 session 종료 시 파생 상태 폐기 |
| 종목 catalog 인스턴스 메모리 cache | Market Data 서버 Adapter | 비권위 성능 cache | 5분마다 latest manifest generation을 확인하고 변경 때만 snapshot을 교체; 인스턴스 종료 시 유실 가능, Storage snapshot이 단일 원본 |
| Web theme | Home Preferences Web Adapter | 사용자 로컬 표현 | 거래·가구 Domain에 영향 없음 |

## 4. Context 제공·소비 계약

| 제공 Context·영역 | 제공 계약 | 주요 소비자 | 통신 방식 |
|---|---|---|---|
| Access & Household | ActorContext, Membership, AssetOwnerProfile, 일반 Member 관리자 제거·복구, Household lifecycle | 모든 업무 Context, Portfolio·자산 UI, Notifications | 동기 Query/Command + `HouseholdMemberRemoved/Restored` lifecycle Event |
| Household Finance / Ledger | Record·Update·Delete·Split·Merge·Cancel, Ledger Query | Web/Android Adapter, Payment Capture, Recurring, Reporting | 동기 Command/Query + Transaction Event |
| Household Finance / Category | Category Reference, Catalog Command, Category Archive Process, Monthly Budget Query | Ledger, Recurring, Payment Configuration, Home, Reporting | 동기 Query/Command + 재개 가능한 Process |
| Household Finance / Recurring | RecurringPlan, ProcessMonth, Category Reference Remap | Web, Scheduler, Category Archive Process | 동기 Command; Ledger와 Finance UoW; page remap |
| Household Finance / Local Currency | Balance Observation, Balance Query | Payment Capture, Home | 동기 Command/Query + Event |
| Household Finance / Lifecycle | `PurgeHouseholdData(householdId, processId, checkpoint)` | Access 수동 영구 Purge Process | 멱등 paged Command/Result; 논리 삭제에서는 호출 금지 |
| Payment Capture / Configuration | Card·Merchant Rule Command/Resolve | Web settings, Payment Intake | 동기 Command/Query |
| Payment Capture / Intake | Submit Payment/Cancellation Observation, idempotency receipt/result replay | Android Queue, Shortcut HTTP Adapter | versioned Command/Result; 같은 key의 다른 payload는 conflict |
| Payment Capture / Lifecycle | `PurgeHouseholdData(householdId, processId, checkpoint)` | Access 수동 영구 Purge Process | 멱등 paged Command/Result; 논리 삭제에서는 호출 금지 |
| Portfolio Core | Asset Command, Valuation, Snapshot Query; 단일 `AssetSnapshotProjector` | Holdings, Automation, Reporting | 동기 Command/Query + commit 이후 Event |
| Portfolio / Holdings·Automation·Dividends | Position, Automation, Dividend Command/Query | Scheduler Inbound Adapter, Portfolio Core, Reporting | 강한 변경은 Context UoW; commit Event는 downstream 전용 |
| Portfolio / Asset Lifecycle | 사용자 `DeleteAsset`; 운영 전용 `ListDeletedAssets`, `RestoreDeletedAsset`, `RequestPermanentAssetPurge`; context-private Automation resume·purge participant | Web 자산 관리, 승인된 관리자/에이전트 운영 도구 | 삭제는 Core UoW, 복구는 Core+Automation Workflow UoW, 수동 영구 삭제만 participant별 paged Process |
| Portfolio / Lifecycle | `PurgeHouseholdData(householdId, processId, checkpoint)` | Access 수동 영구 Purge Process | 멱등 paged Command/Result; 논리 삭제에서는 호출 금지 |
| Notifications | Member Notification Endpoint, Notification Intent, Delivery Status, `HandleHouseholdMemberRemoved`, `PurgeHouseholdData` | Web/Android, Ledger·Access Event handler, Access 수동 영구 Purge Process | 동기 endpoint Command + Outbox consumer + 제거 endpoint 멱등 cleanup + paged purge |
| Reporting | Ledger·Portfolio 통계 Query | Web | 요청 시 계산하는 bounded Query; Portfolio 일일 Snapshot 소비 |
| Home Preferences | Home configuration·summary Query | Web | 설정 Command + 요청 시 원천 Query 조합 |
| Android Host | Bridge·QuickEdit Inbound Adapter | Web shell·사용자 | Context 공개 Command 소비 |
| PWA | worker·notification click Adapter | Web·Notifications | payload contract 소비 |
| External Operations | retry executor, job-result sink, observability, ProviderHealth 기록·조회·경보 | Portfolio·Dividends 등의 Output Port, 승인된 운영 도구 | 업무 Port의 Infrastructure 구현; Scheduler는 별도 Inbound Adapter |
| Delivery Assurance | release gate, 명시적 environment/project resolve, compatibility plan, deployment/smoke record | CI·승인된 배포 작업 | 업무 데이터를 쓰지 않는 release control 계약 |

### 4.1 공통 paged purge 계약

일반 가구 논리 삭제는 아래 계약을 호출하지 않고 모든 데이터를 보존한다. 사용자가 별도로 영구 삭제를 요청한 경우에만 Access & Household의 `HouseholdPurgeProcess`가 다른 Context의 저장 구조를 알지 않은 채 다음 lifecycle 계약을 호출한다.

```text
PurgeHouseholdData(householdId, processId, checkpoint)

PurgePageResult =
  | PageProcessed(nextCheckpoint, deletedCount)
  | PurgeCompleted(finalCheckpoint, deletedCount)
  | RetryableFailure(retryCheckpoint, errorCode)
  | PermanentFailure(failedCheckpoint, errorCode)
```

- 첫 호출의 checkpoint는 `null`이며 이후 값은 제공 Context만 해석하는 opaque token이다.
- 한 page는 Firestore 쓰기 한도를 넘지 않는 결정적 범위이며 `PageProcessed`에서만 checkpoint를 전진한다.
- 같은 householdId·processId·checkpoint 재호출은 같은 결과를 재생하거나 이미 처리된 page를 안전한 no-op으로 확인해야 한다.
- 실패 결과는 재시작할 checkpoint를 보존하며 부분 처리된 page를 완료로 보고하지 않는다.
- 각 Context는 자신이 소유한 household-scoped 데이터만 삭제한다. Notifications는 현재 해당 가구에 연결된 endpoint·delivery·Inbox만 제거한다.
- Access는 `purging` 전환 뒤 Membership·claim 변경 명령을 막고, 현재 UID claim의 server-only `(claimKey, membershipId, claimVersion)` snapshot을 page 단위로 먼저 완성한다. snapshot 완료 전에는 다른 Context의 purge를 호출하지 않는다.
- Access는 Context별 checkpoint와 오류를 저장한다. 모든 Context와 Access household-scoped purge가 `PurgeCompleted`가 되기 전에는 UID Membership claim을 해제하지 않는다.
- 완료 뒤 대상 householdId·membershipId·version과 여전히 일치하는 UID claim만 결정적 page로 조건부 삭제하고 checkpoint를 남긴다. 모든 claim page가 끝난 뒤에만 Household `purged`, 완료 receipt와 `HouseholdPurged.v1`을 최종 UoW에 기록한다.

### 4.2 자산 paged purge 계약

자산 논리 삭제는 종속 데이터를 변경하지 않습니다. 일반 사용자는 복구할 수 없고, 관리자·승인된 운영 주체의 복구 Workflow만 Core active 전환과 Automation 삭제 구간·resume revision을 한 UoW로 기록합니다. 사용자가 별도로 영구 삭제를 요청한 경우에만 Portfolio Core의 `AssetPurgeProcess`가 Holdings·Automation·Core participant를 호출합니다. 공통 Command·Result와 재실행 규칙의 단일 정의는 [Portfolio Core 상세 설계](../contexts/portfolio/modules/portfolio/design.md#61-inputparticipant-port)에 두며, 각 participant는 자기 저장소만 page 단위 삭제합니다. Dividends는 자산별 purge participant를 제공하지 않고 기존 Event·Annual Projection을 가구 금융 이력으로 보존합니다.

## 5. 금지할 직접 의존

- Web·Android·Shortcut Adapter가 `expenses`, `assets`, `fcmTokens` 등 Canonical 컬렉션을 직접 쓰는 구조
- Payment Capture가 Ledger Repository나 `expenses` 경로를 직접 사용하는 구조
- Access가 이름 변경·가구 삭제를 위해 카드·자산·알림 저장 구조를 순회하는 구조
- Holdings·Automation이 `assets`를 직접 덮어쓰는 구조
- Notifications가 거래 저장 성공을 추측하거나 Transaction을 수정하는 구조
- Reporting·Home이 거래·자산 원본을 수정하는 구조
- Context 밖에서 다른 Context의 Infrastructure, Repository, Domain Entity를 import하는 구조
- 외부 Provider 응답을 Domain 문서에 그대로 저장하는 구조
- `notification_debug_logs`를 Domain Event·감사 Aggregate로 승격하는 구조
- Web/Android 서비스가 localStorage·부분 Native preference를 직접 tenant 권위로 읽거나 `guest`를 보호 데이터의 fallback tenant로 쓰는 구조
- 일반 client bundle이 전역 collection migration·repair·운영 샘플 writer를 export하는 구조
- 공급자 응답의 임의 absolute URL을 allowlist 검증 없이 서버가 fetch하는 구조
- compile 또는 implicit Firebase default project만으로 운영 배포를 승인하는 구조

## 6. 데이터 전환 검증

Writer 또는 물리 경로를 바꿀 때 다음을 확인한다.

1. 논리 필드의 소유 Context와 최종 Writer 기능을 먼저 확정한다.
2. 새 Application이 기존 schema를 쓰는 Legacy Adapter 단계와 물리 V2 migration을 분리한다.
3. 이전 Writer와 신규 Writer의 문서 수, 금액 합계, 결정적 hash를 비교한다.
4. dual-write는 가능하면 같은 server transaction에 넣고, 불가능하면 권위 Writer와 reconciliation queue를 명시한다.
5. 읽기 전환과 쓰기 전환을 별도 배포한다.
6. 호환 필드를 제거하기 전에 구형 fixture와 운영 데이터 잔존 여부를 확인한다.
7. Projection은 전체 rebuild와 Event checkpoint 비교를 검증한다.
8. memberName→memberId, 혼합 household/asset 필드 분리를 별도 reconciliation report로 확인한다.
9. `notification_debug_logs`는 migration하지 않고 [DEC-002](../governance/decisions.md#dec-002)의 종료 조건에 따라 제거한다.
10. migration runner 자체는 사용자 client와 분리하고 scope·dry-run·page checkpoint·reconciliation report를 배포 전에 검증한다.
