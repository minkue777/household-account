# 정기 거래 모듈 상세 설계

> 상태: Proposed — 테스트 구현 기준  
> 소유 요구사항: [정기 거래 모듈 요구사항](requirements.md)  
> 상위 Context: [Household Finance](../../requirements.md)  
> 공통 상세 설계 규약: [모듈 상세 설계 규약](../../../../governance/module-design-standard.md)  
> 목표 아키텍처: [목표 Clean Architecture 설계](../../../../../architecture/target-clean-architecture.md)

## 1. 설계 목적과 추적성

이 설계는 `REC-001~006`을 RecurringPlan Domain과 `ProcessRecurringMonthWorkflow`로 구체화합니다. 일정 정의와 월 실행 상태는 Recurring이 소유하고, 생성된 Transaction은 Ledger가 소유합니다.

핵심 목표는 다음과 같습니다.

- 활성·양수인 일정만 월 처리 후보로 만듭니다.
- 29~31일을 대상 월 말일로 결정적으로 보정합니다.
- 같은 `planId + YYYY-MM`은 재시도·동시 실행에도 거래 한 건과 execution 한 건만 만듭니다.
- Recurring checkpoint와 Ledger posting을 하나의 Household Finance Unit of Work로 commit합니다.
- source=recurring을 wire·Event 계약에 명시하여 일반 자동 푸시와 구분합니다.
- [DEC-009](../../../../governance/decisions.md#dec-009)에 따라 매일 서버 처리하고 `firstApplicableMonth` 이후 누락 월을 자동 복구합니다.

관련 기준은 [목표 아키텍처의 정기 거래 흐름](../../../../../architecture/target-clean-architecture.md#85-정기-거래), [Context 간 종단 흐름](../../../../system/flows.md), [데이터 소유권](../../../../cross-cutting/data-ownership.md), [테스트 전략](../../../../governance/test-strategy.md)을 따릅니다.

## 2. 모듈 경계와 책임

### 2.1 소유 책임

| 책임 | 설명 |
|---|---|
| RecurringPlan | merchant, amount, categoryId, dayOfMonth, memo, active, immutable creatorMemberId, 생성·수정 version |
| Effective date | 대상 연월의 유효 실행일과 월말 보정 |
| Eligibility | 생성 시점, 활성 상태, 대상 월, 과거 누락 월의 처리 후보 판정 |
| RecurringExecution | `planId:YYYY-MM` claim, 처리 결과, 연결 ledgerTransactionId |
| Workflow participant | plan 검증·execution 변경 의도를 Finance Workflow에 제공 |
| Recurring lifecycle purge | Finance purge에 plan/execution page 제공 |

### 2.2 경계 밖

- 생성된 Transaction, source, 거래 Event는 Ledger가 최종 소유합니다.
- category 사용 가능 여부는 Category/Budget 공개 Port가 판정합니다.
- Scheduler cron, page 재시도, job 관측은 External Operations Adapter입니다.
- source=recurring Event를 실제 푸시에서 제외하는 판정과 전달은 Notifications가 소유합니다.
- 일반 거래의 이후 수정·삭제는 Ledger가 처리합니다.

`ProcessRecurringMonthWorkflow`는 Household Finance Context Application 계층에 있으며 Recurring 또는 Ledger 어느 한 모듈의 Repository를 다른 모듈에 노출하지 않습니다.

## 3. 공개 계약

공통 `CommandEnvelope`, `ActorContext`, Result union은 [공통 Application 계약](../../../../governance/module-design-standard.md#3-공통-application-계약)을 사용합니다.

### 3.1 공개 Input Port

| 이름·종류 | 호출자 | 입력 DTO | 결과 | 권한 | 일관성 | 멱등성 |
|---|---|---|---|---|---|---|
| `ManageRecurringPlan` Command v1 | Web 설정 | create/update/delete operation | `Success<RecurringPlanView>` 또는 `Success<Deleted>`, `ValidationError`, `NotFound`, `Conflict`, `Forbidden` | `recurring.manage` | Plan·receipt·Outbox 한 UoW | envelope key + planVersion |
| `ListRecurringPlans` Query | Web, Scheduler page source | active filter, cursor, limit | `Success<RecurringPlanPage>`, `NoData`, `RetryableFailure` | `recurring.read` 또는 `recurring.process` | `day ASC, merchant ASC, planId ASC` | 해당 없음 |
| `CalculateEffectiveDay` Query/Domain service | Web preview, Workflow | yearMonth, dayOfMonth | `Success<LocalDate>`, `ValidationError` | 읽기 가능 Actor 또는 내부 호출 | 순수 계산 | 해당 없음 |
| `ProcessRecurringMonth` Context Workflow Command v1 | Scheduler, 운영 재시도 | planId, targetMonth | `Success<RecurringMonthProcessed>`, `AlreadyProcessed(existingId)`, `NoData(reason)`, `Conflict`, `RetryableFailure` | `recurring.process` SystemActor 또는 허용된 사용자 | Recurring execution/checkpoint + Ledger Transaction + receipt + Outbox 한 Finance UoW | `planId:YYYY-MM` |
| `ProcessDueRecurringPlans` Scheduled Command v1 | 일일 Scheduler, 운영 재개 | asOfDate, householdZoneId, cursor, limit | `Success<RecurringBatchResult>`, `PartialFailure`, `RetryableFailure` | `recurring.process` SystemActor | 각 plan/month는 독립 Finance UoW, page checkpoint는 Operations 소유 | `recurring-daily:asOfDate:pageKey` + plan/month |
| `MapLegacyRecurringCreator` Migration Command v1 | 승인된 migration 도구·에이전트 | planId, creatorMemberId, expectedVersion | `Success<RecurringPlanView>`, `AlreadyProcessed`, `ValidationError`, `NotFound`, `Conflict`, `Forbidden` | `recurring.migrate` capability | Plan creator·migration receipt·Outbox 한 UoW | `planId:creatorMemberId:expectedVersion` |
| `RemapRecurringCategoryReferences` Process Command v1 | Category Archive Process | fromCategoryId, toDefaultCategoryId, processId, cursor, limit | `Success<CategoryReferenceRemapPage>`, `Conflict`, `RetryableFailure` | `category-reference-remap` SystemActor | 정의 page와 receipt 한 UoW | `processId:recurring:cursor` |
| `PurgeRecurringDataParticipant` Context participant | Finance purge Workflow | processId, checkpoint, page limit | 변경 의도 또는 공통 typed purge 결과 | lifecycle SystemActor | Finance purge page UoW | processId + checkpoint |

`ManageRecurringPlan` operation은 다음 versioned union입니다.

| kind | payload | 결과 |
|---|---|---|
| `create` | merchant, amountInWon, categoryId, dayOfMonth, optional memo, active | 새 plan |
| `update` | planId, patch, expectedVersion | 갱신 plan |
| `delete` | planId, expectedVersion | 삭제/tombstone 결과 |

### 3.2 DTO와 Read Model

| 타입 | 필드·규칙 |
|---|---|
| `RecurringPlanView` | planId, merchant, amountInWon, categoryId, dayOfMonth, memo, active, immutable creatorMemberId, firstApplicableMonth, createdAt, updatedAt, version |
| `RecurringMonthProcessed` | planId, targetMonth, effectiveDate, ledgerTransactionId, executionVersion |
| `RecurringExecutionView` | executionKey, targetMonth, status, ledgerTransactionId, processedAt, version |
| `RecurringPlanPage` | items, opaque cursor, sourceCheckpoint |
| `CategoryReferenceRemapPage` | processId, fromCategoryId, toDefaultCategoryId, changedCount, nextCursor 또는 null, completed |

`source`나 creatorMemberId를 Manage payload에서 받지 않습니다. create는 인증된 `ActorContext.actingMemberId`를 Plan creator로 저장하고, update와 Scheduler Workflow는 이를 바꾸지 않습니다. Workflow는 source=recurring을 고정하고 [DEC-063](../../../../governance/decisions.md#dec-063)에 따라 Plan creator를 Ledger posting에 전달합니다. SystemActor는 실행 권한이며 거래 creator가 아닙니다.

### 3.3 Batch Scheduler 계약

Scheduler Adapter는 `Asia/Seoul` timezone의 cron `0 0 * * *`로 매일 `ProcessDueRecurringPlans`를 호출합니다. Recurring Application이 page별 계획과 `firstApplicableMonth` 이후 미처리 due month를 오래된 순서로 반환하고, Adapter는 각 `planId + month`에 `ProcessRecurringMonth`을 호출합니다. 가구 전체나 여러 월을 한 transaction으로 묶지 않습니다. batch 결과는 Adapter/Operations가 `succeeded, alreadyProcessed, notDue, retryableFailed`로 집계하며, page 한도를 넘으면 checkpoint를 저장하고 자동 재개합니다. 개별 Finance UoW의 typed 결과를 성공으로 덮어쓰지 않습니다.

## 4. Domain 모델과 불변식

### 4.1 모델

| 모델 | 주요 상태 | 불변식 |
|---|---|---|
| `RecurringPlan` Aggregate | householdId, planId, merchant, MoneyWon, categoryId, dayOfMonth, memo, active, creatorMemberId, firstApplicableMonth, createdAt, version | merchant 비공백, amount 양의 정수, day 1~31, stable planId, 시작 월은 생성 전이 아님, creator는 최초 설정 뒤 불변 |
| `RecurringExecution` Aggregate | executionKey, planId, targetMonth, status, ledgerTransactionId, version | 같은 plan/month 하나, completed 결과는 뒤로 전이하지 않음 |
| `EffectiveRecurringDate` Value Object | targetMonth, requestedDay, effectiveDate | 짧은 달은 마지막 날, 다른 달로 넘기지 않음 |
| `RecurringPostingIntent` Domain result | plan snapshot, effectiveDate, source, deterministic key | commit 전 변경 의도이며 Ledger Entity를 포함하지 않음 |

legacy `lastRegisteredMonth`는 전환 호환 필드이고 목표 중복 방지 원본은 결정적 `RecurringExecution`입니다. 둘을 함께 쓰는 기간에는 execution을 권위로 두고 lastRegisteredMonth를 reconciliation 값으로 취급합니다.

### 4.2 정책

| Policy | 책임 | 상태 |
|---|---|---|
| `EffectiveDayPolicy` | year/month/day에서 월말 보정 LocalDate 계산 | 확정 |
| `RecurrenceBackfillPolicy` | firstApplicableMonth, execution history, asOfDate에서 미처리 due month를 오래된 순서로 선택 | DEC-009 Accepted |
| `RecurringCreatorPolicy` | create Actor를 최초 creator로 고정하고 Scheduler posting에는 저장된 Plan creator를 사용; legacy 미매핑 차단 | DEC-063 Accepted |
| `RecurringEligibilityPolicy` | active, amount, effectiveDate, 처리 시각에서 due/not-due 판정 | 확정 |

목표 `AutomaticBackfillPolicy`는 다음을 보장합니다.

- 지정일 이전 또는 당일 생성: 당월 후보
- 지정일 이후 생성: 다음 달부터 후보
- `firstApplicableMonth` 이전은 생성하지 않음
- `firstApplicableMonth`부터 asOfDate 기준 실행일이 도래한 월까지 execution이 없는 월을 오래된 순서로 반환
- page limit을 넘는 후보는 checkpoint 이후 다음 batch에서 계속

`LegacyNoBackfillPolicy`는 전환 비교에만 남기고 신규 Writer에서는 사용하지 않습니다. plan의 createdAt, firstApplicableMonth, requested day와 모든 execution month를 보존합니다.

## 5. Application Use Case 상세

### 5.1 ManageRecurringPlan

1. Actor household와 `recurring.manage` capability, 가구 active를 확인합니다.
2. wire schema와 idempotency payload hash를 검증합니다.
3. merchant trim, amount 양의 정수, day 1~31, memo 정규화를 적용합니다.
4. Category Reference Port로 categoryId가 사용 가능한지 확인합니다.
5. create는 Clock의 createdAt과 stable planId, `ActorContext.actingMemberId`의 immutable creatorMemberId를 설정하고, 지정일 이전·당일이면 당월, 이후이면 다음 달을 firstApplicableMonth로 저장합니다.
6. update/delete는 expectedVersion을 확인하고 creatorMemberId와 execution history를 훼손하지 않습니다. payload의 알 수 없는 creator 필드는 schema 단계에서 거부합니다.
7. Plan, receipt, `RecurringPlanChanged.v1`을 한 UoW로 commit합니다.
8. category 공급자 일시 실패는 저장하지 않고 `RetryableFailure`입니다.

### 5.2 CalculateEffectiveDay

1. targetMonth 형식과 day 1~31을 검증합니다.
2. 해당 월의 마지막 날과 requested day 중 작은 값을 선택합니다.
3. timezone·현재 시각에 의존하지 않는 LocalDate를 반환합니다.
4. 2월 윤년, 30일 월, 31일 월을 Domain Unit fixture로 검증합니다.

### 5.3 ProcessRecurringMonthWorkflow

1. Inbound Adapter가 제한된 `recurring.process` SystemActor 또는 권한 있는 Actor를 생성합니다.
2. targetMonth와 idempotency key `planId:YYYY-MM`을 검증합니다.
3. Workflow가 Plan과 기존 RecurringExecution을 읽습니다.
4. 이미 completed execution이면 연결 transactionId를 가진 `AlreadyProcessed`를 반환합니다.
5. `RecurringEligibilityPolicy`와 `RecurrenceBackfillPolicy`가 inactive/not due/처리 대상을 typed 결과로 판정합니다.
6. `RecurringCreatorPolicy`가 Plan의 creatorMemberId를 검증합니다. creator가 없는 legacy Plan은 `Conflict(LEGACY_CREATOR_MAPPING_REQUIRED)`로 해당 target만 중단하며 현재 가구원이나 SystemActor를 대입하지 않습니다.
7. Category Reference를 검증하고 `ProcessRecurringPlanParticipant`가 creatorMemberId를 포함한 `RecurringPostingIntent`를 만듭니다.
8. Ledger의 `RecordRecurringTransactionParticipant`가 source=recurring, Plan creatorMemberId를 가진 Transaction 변경 의도와 `TransactionRecorded.v1` draft를 만듭니다.
9. Finance UnitOfWork가 execution/checkpoint, Ledger Transaction, `ProcessRecurringMonthReceipt`, `TransactionRecorded.v1`, `RecurringPlanProcessed.v1`을 같은 transaction에 commit합니다.
10. commit 이후에만 `Success`를 반환합니다. Notifications는 Ledger Event를 별도 소비합니다.
11. transaction callback 재실행 시 ID와 Event ID는 결정적이고 외부 Scheduler/FCM 호출이 없습니다.

### 5.4 ProcessDueRecurringPlans

1. Scheduler SystemActor, asOfDate, householdZoneId, page cursor·limit을 검증합니다.
2. 활성 Plan page를 읽고 각 계획의 `firstApplicableMonth`와 completed execution을 조회합니다.
3. `AutomaticBackfillPolicy`가 asOfDate까지 실행일이 도래한 미처리 월을 오래된 순서로 계산합니다.
4. 각 plan/month를 독립 `ProcessRecurringMonthWorkflow`로 처리합니다.
5. 실패한 target과 다음 cursor를 `RecurringBatchResult`에 보존하며 성공 target을 다시 만들지 않습니다.
6. page limit을 넘으면 Operations checkpoint를 반환하고 후속 실행 또는 retry가 나머지를 계속합니다.
7. 브라우저 화면 진입 여부는 입력과 판정에 사용하지 않습니다.

### 5.5 MapLegacyRecurringCreator

1. `recurring.migrate` capability와 대상 Plan의 household scope, expectedVersion을 검증합니다.
2. creatorMemberId가 같은 household에 보존된 실제 Member identity인지 Access 공개 Port로 확인합니다. 표시 이름·현재 접속자·유일한 활성 멤버로 대체하지 않습니다.
3. Plan에 creator가 이미 있으면 같은 mapping은 `AlreadyProcessed`로 재생하고 다른 creator 값은 `Conflict(CREATOR_ALREADY_ASSIGNED)`로 거부합니다.
4. creator가 없는 Plan에 creatorMemberId를 설정하고 migration actor·시각·이전 version을 가진 receipt와 `RecurringPlanChanged.v1`을 한 UoW로 commit합니다.
5. 이 migration은 기존 Ledger 거래를 소급 수정하지 않습니다. mapping 성공 뒤부터 미처리 월 posting이 저장된 creator를 사용합니다.

### 5.6 RemapRecurringCategoryReferences

1. Category Archive Process 전용 SystemActor와 processId, from/to category가 서로 다른지 검증합니다.
2. `fromCategoryId`를 참조하는 정기지출 정의를 active 여부와 무관하게 안정적인 planId 순서로 한 page 읽습니다.
3. 각 정의의 categoryId를 `toDefaultCategoryId`로 변경하고 page receipt를 같은 UoW에 저장합니다.
4. 이미 같은 processId·cursor가 완료되었으면 저장된 결과를 재생하고, 일부 정의가 이미 기본 카테고리를 참조해도 성공으로 수렴합니다.
5. 이 명령은 RecurringPlan만 변경하며 이미 생성되어 Ledger가 소유하는 과거 Transaction은 조회하거나 수정하지 않습니다.
6. Repository 실패는 성공이나 빈 page로 바꾸지 않고 재시도 가능한 cursor와 함께 반환합니다.

### 5.7 실패·재시도

- Plan 저장 실패 또는 Ledger write 실패는 execution과 거래 모두 이전 상태입니다.
- checkpoint 저장 실패를 성공으로 반환하지 않습니다.
- retryable failure는 같은 `planId:month` key로 재호출합니다.
- 이미 거래는 존재하지만 receipt가 누락된 전환 edge case는 결정적 transactionId/execution을 조회해 receipt를 복구하고 두 번째 거래를 만들지 않습니다.
- inactive/not due는 `NoData(INACTIVE_PLAN|NOT_DUE)`이며 Repository 실패와 구분합니다.
- 누락 월 중 일부가 실패하면 성공한 월은 그대로 유지하고 실패 target부터 같은 plan/month key로 자동 재시도합니다.
- creator가 없는 legacy Plan은 해당 target만 `LEGACY_CREATOR_MAPPING_REQUIRED`로 남기고 다른 Plan 처리를 계속합니다. 재시도 전에 명시적 mapping이 필요합니다.

### 5.8 source=recurring

Ledger posting intent에 source=recurring과 planId/targetMonth를 서버가 설정합니다. 일반 client는 이 source를 선택할 수 없습니다. `TransactionRecorded.v1` consumer인 Notifications는 recurring source를 일반 새 지출 자동 푸시에서 제외하고, 사용자가 별도 요청한 `HouseholdNotificationRequested.v1`은 독립 처리합니다.

## 6. Port 설계

### 6.1 Output Port

| Port | 책임 | 계약 핵심 |
|---|---|---|
| `RecurringPlanRepository` | Plan과 execution 조회·mapping | household key, version, NoData/실패 구분 |
| `RecurringPlanUnitOfWork` | 일반 Plan Command의 write·receipt·Outbox | callback 재실행, rollback |
| `FinanceRecurringUnitOfWork` | Recurring + Ledger context Workflow commit | 두 기능 변경·receipt·Event 원자성 |
| `CategoryReferencePort` | category 사용 가능 상태 | NotFound/Inactive/Retryable 구분 |
| `HouseholdMemberReferencePort` | legacy creator mapping의 같은 household Member identity 검증 | active 상태를 creator 추정 근거로 사용하지 않고 cross-household 거부 |
| `ProcessRecurringPlanParticipant` | Plan 검증과 execution/checkpoint 변경 의도 준비 | 직접 commit·Repository 노출 금지 |
| `RecordRecurringTransactionParticipant` | Ledger의 persistence-neutral posting 의도 준비 | 직접 commit·Repository 노출 금지 |
| `Clock` / `IdGenerator` | createdAt, processedAt, stable IDs | month boundary fixture |
| `OutboxAppendPort` | Plan/Processed Event append | 같은 UoW 참여 |
| `ProcessReceiptRepository` | category reference remap page 결과 재생 | processId+cursor, payload 불일치 거부 |
| `ObservabilityPort` | plan/month 결과와 retry 관측 | merchant/memo 원문 로그 금지 |

### 6.2 Inbound/Context Adapter

- Callable Adapter: Plan CRUD와 사용자 수동 월 처리
- Scheduler Adapter: 매일 asOfDate·ZoneId·checkpoint를 전달하는 얇은 Inbound Adapter
- Firestore Plan Adapter
- Finance Workflow Firestore Adapter
- Legacy `recurring_expenses` Mapper

Scheduler Adapter는 cron과 checkpoint 전달만 담당하고 대상 월을 계산하지 않습니다. “오늘이 due인지”와 누락 월 범위는 Recurring Domain Policy가 판정합니다.

## 7. 저장·트랜잭션·동시성

### 7.1 논리 저장

| 데이터 | 목표 key | Writer |
|---|---|---|
| RecurringPlan | `households/{householdId}/recurringPlans/{planId}` | Recurring |
| RecurringExecution | `households/{householdId}/recurringExecutions/{planId_yyyyMM}` | Recurring participant/Finance Workflow |
| 생성 Transaction | Ledger 목표 경로의 결정적 transactionId | Ledger participant/Finance Workflow |
| `ProcessRecurringMonthReceipt` / outbox | 공통 platform 경로 | ProcessRecurringMonthWorkflow |
| Legacy creator migration receipt | 공통 migration receipt 경로 | Recurring |

Plan은 schemaVersion, aggregateVersion, immutable creatorMemberId, firstApplicableMonth, createdAt/updatedAt을 저장합니다. Execution은 targetMonth, effectiveDate, status, ledgerTransactionId, executionVersion, processedAt을 저장합니다.

### 7.2 Unit of Work

- Plan manage: Plan + receipt + `RecurringPlanChanged.v1`.
- Legacy creator mapping: Plan creator + migration receipt + `RecurringPlanChanged.v1`.
- Month process: Execution create/update + optional legacy checkpoint + Ledger Transaction + `ProcessRecurringMonthReceipt` + `TransactionRecorded.v1`/`RecurringPlanProcessed.v1`.
- Purge page: Recurring 소유 plan/execution page + purge checkpoint 의도.

같은 plan/month의 두 요청은 결정적 execution 문서 create로 경합합니다. 한 요청만 Transaction을 만들고 다른 요청은 completed execution의 결과를 재생합니다. Plan version이 처리 도중 바뀌면 `Conflict(PLAN_VERSION_MISMATCH)`로 전체 rollback합니다.

### 7.3 전환

1. Legacy Mapper가 `recurring_expenses`와 `lastRegisteredMonth`를 읽습니다.
2. amount/day validation을 Application 앞에 먼저 둡니다.
3. creator가 없는 Plan의 `planId → creatorMemberId` 명시적 mapping을 수집·검증하고 migration receipt와 함께 저장합니다. 미해결 Plan은 자동 posting 대상에서 격리합니다.
4. 결정적 execution key를 backfill하되 생성 거래와 월을 reconciliation합니다.
5. 새 Finance Workflow를 legacy 물리 경로 위에서 활성화합니다.
6. transactionId, plan month, creatorMemberId, 금액 합계를 비교한 뒤 V2 path를 shadow read합니다.
7. 화면 생명주기 호출을 매일 실행되는 Scheduler Adapter로 대체하고 legacy 직접 Ledger write를 제거합니다.

## 8. Event·Projection·외부 연동

### 8.1 생산 Event

| Event | 최소 payload | 소비자 |
|---|---|---|
| `RecurringPlanChanged.v1` | householdId, planId, active, dayOfMonth, planVersion, changeKind | 설정 Read Model·운영 |
| `RecurringPlanProcessed.v1` | householdId, planId, targetMonth, ledgerTransactionId, executionVersion | 운영 관측 |

거래 사실과 Budget/Notifications 입력은 Ledger가 같은 Finance UoW에서 생산하는 `TransactionRecorded.v1`이 단일 원본입니다. Recurring Event가 거래 Event를 복제하거나 거래 금액·memo 전체를 노출하지 않습니다.

### 8.2 외부 연동

- Scheduler: Input Adapter이며 업무 Policy를 소유하지 않습니다.
- Category: 동기 공개 Reference Port입니다.
- Ledger: Context-private participant이며 강한 일관성 Workflow에 참여합니다.
- Notifications/Reporting: Ledger Outbox Event의 비동기 consumer입니다.

### 8.3 Projection

Recurring 목록은 단순 Canonical read contract로 시작하며 별도 Projection을 만들지 않습니다. 운영용 월 처리 현황이 필요하면 execution에서 재구축 가능한 Read Model로 만들고 sourceCheckpoint/freshness를 명시합니다.

## 9. 오류·보안·관측성

### 9.1 오류 코드

| 분류 | 코드 예 |
|---|---|
| 검증 | `MERCHANT_REQUIRED`, `AMOUNT_NOT_POSITIVE_INTEGER`, `DAY_OUT_OF_RANGE`, `INVALID_TARGET_MONTH` |
| 참조 | `PLAN_NOT_FOUND`, `CATEGORY_NOT_USABLE` |
| 실행 | `INACTIVE_PLAN`, `NOT_DUE`, `EXECUTION_ALREADY_COMPLETED` |
| 정책 | `BACKFILL_POLICY_REQUIRES_CONFIRMATION`, `LEGACY_CREATOR_MAPPING_REQUIRED` |
| 충돌 | `PLAN_VERSION_MISMATCH`, `EXECUTION_CONFLICT`, `IDEMPOTENCY_PAYLOAD_MISMATCH`, `CREATOR_ALREADY_ASSIGNED` |
| migration 검증 | `CREATOR_MEMBER_NOT_IN_HOUSEHOLD` |

### 9.2 보안

- Plan CRUD는 같은 household의 `recurring.manage` capability만 허용합니다.
- Scheduler는 모든 Finance 권한이 아니라 `recurring.process`만 가진 SystemActor를 사용합니다.
- creator mapping은 일반 `recurring.manage`가 아니라 제한된 `recurring.migrate` capability를 요구하고 actor·시각·이전 version을 감사 receipt로 남깁니다.
- client는 source, creatorMemberId, processedAt, execution status를 직접 쓰지 못합니다.
- RecurringPlan read와 query는 Membership Rules를 적용합니다.
- receipt, execution 내부 metadata, Outbox는 server-only입니다.

### 9.3 관측성

planId, targetMonth, effectiveDate, result category, execution/transaction ID, creator mapping 필요 여부, attempt, transaction retry, latency를 기록합니다. memberId 원문, merchant, memo, 금액 원문은 일반 로그에서 제외합니다. batch job은 성공·이미 처리·미도래·creator mapping 필요·재시도 실패를 별도 count로 집계합니다.

## 10. 목표 패키지 구조

아직 없는 경로는 `목표`입니다.

```text
functions/src/contexts/household-finance/recurring/
  domain/
    plan/
    execution/
    policies/
  application/
    commands/
    queries/
    participants/
    ports/in/
    ports/out/
  adapters/
    out/firestore/
    out/legacy-firestore/
  public.ts

functions/src/contexts/household-finance/workflows/
  process-recurring-month/
    application/
    ports/
    adapters/

web/src/features/recurring/
  application/
  adapters/functions-api/
  presentation/
  public.ts
```

Recurring Domain은 Ledger Entity나 Firebase를 import하지 않습니다. Workflow만 두 기능의 공개 participant를 조립합니다.

## 11. 테스트 설계

### 11.1 계층별 suite

- Domain Unit: amount/day validation, 윤년·월말, due/not-due, AutomaticBackfillPolicy.
- Application: Plan 권한·category failure·creator 불변·legacy mapping receipt, Process typed Result.
- Workflow: plan/execution/Transaction/checkpoint의 원자 commit과 callback 2회.
- Contract: source=recurring, Plan/Process DTO, Notifications consumer fixture.
- Repository Conformance: Fake/Legacy/V2의 execution uniqueness와 failure 의미.
- Emulator: 같은 plan/month 동시 요청, Ledger/checkpoint 실패, Rules·Outbox.
- E2E: 설정 생성·수정·비활성, Scheduler 처리, 일반 푸시 제외.
- Process Contract: 활성·비활성 Plan category remap, page 재시도, 과거 Ledger 거래 불변.

### 11.2 요구사항 추적 표

| 요구사항 ID | 테스트 수준 | 테스트 대상 | 핵심 fixture/경계값 | 관찰 결과 | Canonical 테스트 ID |
|---|---|---|---|---|---|
| REC-001 | Domain·Application | ManageRecurringPlan·ListRecurringPlans | 전체 필드 create/update/delete, 빈 merchant, amount 0/음수/소수, day 0/1/31/32, 사용 불가 category, active filter·cursor, 저장소 실패 | 유효 Plan의 전체 필드·immutable creator·tombstone과 안정 정렬을 보존하고 invalid는 Plan·receipt·Event를 만들지 않으며 실패를 NoData로 축약하지 않음 | T-REC-003 |
| REC-002 | Domain·Workflow·Emulator | EffectiveDay/ProcessDueRecurringPlans/ProcessRecurringMonth | 31일과 2월, 일일 job 중복, 동일 plan/month 동시·재시도, 비활성·비양수 legacy Plan, 저장 실패 | 접속 없이 실제 원장 거래 생성, 월별 거래·execution·Event 한 세트, 제외 대상 0건, 실패 rollback | T-REC-001, T-REC-002, T-REC-005, T-REC-006 |
| REC-003 | Domain Policy·Application | AutomaticBackfillPolicy·ProcessDueRecurringPlans | 지정일 이전·당일·이후 생성, 7·8월 누락, 9월 기준일, page limit, 월 중간 실패·재실행 | 생성 전 월 제외, 7·8·due 9월 오래된 순 자동 복구, 성공 월 보존과 실패 월 checkpoint 재개 | T-REC-004, T-REC-005 |
| REC-004 | Contract·Outbox | source=recurring consumer contract | recurring Transaction Event, 명시적 알림 요청 없음/있음 | 일반 새 지출 자동 푸시 없음, explicit 요청은 별도 | T-REC-PUSH-001 |
| REC-005 | Application·Repository·Contract | RemapRecurringCategoryReferences | 활성·비활성 Plan, 이미 remap된 항목, page 중간 실패·재시도·동일 cursor payload 충돌 | 모든 정의는 default category로 수렴하고 동일 page 결과를 재생하며 Ledger 과거 거래는 불변 | T-CAT-004 |
| REC-006 | Domain·Application·Migration·Workflow | RecurringCreatorPolicy·MapLegacyRecurringCreator | A 생성 후 B 수정, Scheduler SystemActor, creator 없는 legacy Plan, 같은/다른 가구 mapping, 재실행, mapping 전 과거 Ledger | creator A 불변, Scheduler 거래도 A, 미매핑 write 0건, 명시적 같은 가구 mapping만 성공하며 과거 Ledger는 불변 | T-REC-003, T-REC-007 |

`T-REC-PUSH-001`과 Notifications `T-PUSH-002`는 [테스트 전략](../../../../governance/test-strategy.md#43-의미-중복-감사-대상)에 따라 하나의 producer/consumer fixture를 공유하고 같은 의미를 중복 구현하지 않습니다.

## 12. 구현 순서

1. 기존 effective day와 생성 시점 특성화 테스트를 고정합니다.
2. RecurringPlan Value Object와 typed Manage Port를 추출합니다.
3. amount 0/음수 목표 테스트를 활성화합니다.
4. immutable creatorMemberId와 `T-REC-007`을 추가하고 legacy mapping 도구·receipt로 미해결 Plan을 모두 식별합니다.
5. 결정적 RecurringExecution과 Legacy Mapper를 추가합니다.
6. Ledger recurring participant와 `ProcessRecurringMonthWorkflow`를 구현합니다.
7. transaction rollback·동시 실행·callback 2회 Emulator test를 활성화합니다.
8. 화면 진입 호출을 Scheduler Inbound Adapter로 전환합니다.
9. AutomaticBackfillPolicy와 일일 batch checkpoint·부분 실패 재개 테스트를 활성화합니다.
10. Category Archive Process용 page remap Command와 receipt를 구현하고 `T-CAT-004` 계약 fixture를 연결합니다.
11. V2 shadow read와 reconciliation 후 legacy checkpoint/direct write를 제거합니다.
