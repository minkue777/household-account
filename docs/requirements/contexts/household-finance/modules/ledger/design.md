# 거래 원장 모듈 상세 설계

> 상태: Proposed — 테스트 구현 기준  
> 소유 요구사항: [거래 원장 모듈 요구사항](requirements.md)  
> 상위 Context: [Household Finance](../../requirements.md)  
> 공통 상세 설계 규약: [모듈 상세 설계 규약](../../../../governance/module-design-standard.md)  
> 목표 아키텍처: [목표 Clean Architecture 설계](../../../../../architecture/target-clean-architecture.md)

## 1. 설계 목적과 추적성

이 설계는 `LED-001~010`, `SPL-001~006`, `MRG-001~002`, `SEA-001~004`를 하나의 Canonical Ledger Writer와 테스트 가능한 공개 계약으로 옮깁니다. 정책의 단일 원본은 [요구사항](requirements.md#5-요구사항)과 Accepted [DEC-001](../../../../governance/decisions.md#dec-001)·[DEC-010](../../../../governance/decisions.md#dec-010)·[DEC-056](../../../../governance/decisions.md#dec-056)·[DEC-057](../../../../governance/decisions.md#dec-057)·[DEC-059](../../../../governance/decisions.md#dec-059)입니다.

핵심 목표는 다음과 같습니다.

- Web·Android·Functions가 `expenses`를 직접 쓰지 않고 목적별 Ledger Input Port를 사용합니다.
- 거래, fingerprint claim, receipt, Outbox의 원자성 경계를 명시합니다.
- item split, monthly split, merge, unmerge, cancel의 전체 성공·전체 실패를 보장합니다.
- 구조 변경 전후에도 source·origin·creator·카드 증거와 capture dedup lineage를 불변으로 보존합니다.
- 조회 실패를 빈 목록이나 0원으로 축약하지 않습니다.
- Payment Capture는 fingerprint 의미를 소유하고 Ledger는 전달받은 claim의 유일성을 강제합니다.
- Budget·Notifications·Reporting은 Ledger Event를 소비하며 Canonical 원장을 수정하지 않습니다.

관련 설계 근거는 [데이터 소유권](../../../../cross-cutting/data-ownership.md), [수동 거래·결제·취소 흐름](../../../../system/flows.md), [보안 경계](../../../../cross-cutting/security-privacy.md), [테스트 전략](../../../../governance/test-strategy.md)을 따릅니다.

## 2. 모듈 경계와 책임

### 2.1 소유 책임

| 책임 | 설명 |
|---|---|
| Canonical Transaction | 지출·수입의 본문, 회계일·현지 시각, 금액, 표시 정보, categoryId, 업무 source, originChannel, creatorMemberId |
| Group operation | item split, monthly split/reconfigure/cancel, merge/unmerge의 원자 계획과 실행 |
| Capture lineage·claim | Payment Capture가 계산해 전달한 fingerprint를 immutable lineage에 원자 연결하고 split·merge 뒤에도 dedup을 유지 |
| Ledger Query | 기간·유형 목록, 날짜·월·연·카테고리 합계, 검색, 취소 후보의 원장 사실 |
| Explicit notification request | 지출의 요청 시각·요청자 기록과 `HouseholdNotificationRequested.v1` 생산 |
| Ledger purge participant | Finance Context purge Workflow에 Ledger 소유 page 삭제 계획 제공 |

### 2.2 소유하지 않는 책임

- category 활성·기본값·삭제 정책은 [Category/Budget](../categories-budget/requirements.md)이 소유합니다.
- 카드·가맹점 mapping과 fingerprint 정규화 의미는 Payment Capture가 소유합니다.
- 취소의 금액·정규 가맹점·카드 완전 일치와 후보 유일성 판정은 Payment Capture의 `CancellationMatchPolicy`가 소유합니다.
- recurring 일정·대상 월·checkpoint는 [Recurring](../recurring-transactions/requirements.md)이 소유합니다.
- 자동 알림과 명시적 가구원 알림의 수신자 정책은 Notifications가 소유합니다.
- 통계·홈 UI Projection은 Read Side가 소유합니다.

같은 Context의 정기 월 처리만 `ProcessRecurringMonthWorkflow`가 Recurring과 Ledger의 변경 의도를 한 Finance Unit of Work로 commit합니다. Ledger가 Recurring Repository를 import하거나 먼저 commit하지 않습니다.

## 3. 공개 계약

공통 `CommandEnvelope`, `ActorContext`, Result union은 [공통 Application 계약](../../../../governance/module-design-standard.md#3-공통-application-계약)을 참조합니다. 모든 외부 쓰기 DTO는 `contractVersion`을 가지며 transport가 ActorContext를 서버에서 생성합니다.

### 3.1 공개 Input Port

| 이름·종류 | 호출자 | 입력 DTO | 결과 | 권한 | 일관성 | 멱등성 |
|---|---|---|---|---|---|---|
| `RecordManualTransaction` Command v1 | Web | manual expense/income draft | `Success<TransactionRecorded>`, `ValidationError`, `Forbidden`, `Conflict` | `ledger.write` | Transaction·receipt·Outbox 한 UoW | envelope key |
| `RecordCapturedTransaction` Command v1 | Payment Capture | captured draft, fingerprintHash/version, transportKey | `Success<TransactionRecorded>`, `Duplicate(existingId)`, `Conflict`, `Forbidden` | `ledger.capture.record` | fingerprint claim·Transaction·receipt·Outbox 한 UoW | envelope key + fingerprint |
| `RecordRecurringTransaction` Context participant (`RecordRecurringTransactionParticipant`) | `ProcessRecurringMonthWorkflow` | recurring posting intent, deterministic plan/month key | commit 전 `PreparedPosting` 또는 typed validation error | `ledger.recurring.record` | Workflow가 소유한 Finance UoW에 참여 | `planId:YYYY-MM` |
| `Update` Command v1 | Web·QuickEdit | transactionId, patch, expectedVersion | `Success<TransactionView>`, `ValidationError`, `NotFound`, `Conflict`, `Forbidden` | `ledger.write` | Transaction·receipt·Outbox 한 UoW | envelope key + version |
| `Delete` Command v1 | Web | transactionId, expectedVersion | `Success<Deleted>`, `NotFound`, `Conflict`, `Forbidden` | `ledger.write` | Transaction/tombstone·receipt·Outbox 한 UoW | envelope key + version |
| `Split` Command v1 | Web·QuickEdit | item/monthly/reconfigure operation | `Success<SplitResult>`, `ValidationError`, `NotFound`, `Conflict`, `Forbidden` | `ledger.write` | 원본·새 그룹·receipt·Outbox 한 UoW | operation key + group versions |
| `Merge` Command v1 | Web | targetId, sourceIds, expectedVersions | `Success<MergedResult>`, `ValidationError`, `NotFound`, `Conflict` | `ledger.write` | 대상·원본 snapshot·receipt·Outbox 한 UoW | operation key + 모든 version |
| `Unmerge` Command v1 | Web | mergedTransactionId, expectedVersion | `Success<UnmergedResult>`, `NeedsConfirmation`, `NotFound`, `Conflict` | `ledger.write` | 합친 거래·복원 집합·receipt·Outbox 한 UoW | operation key + version |
| `CancelCapturedLineage` Command v1 | Payment Capture | cancellationKey, captureLineageId, expectedLineageVersion | `Success<CancelledLineageResult>`, `NotFound`, `Conflict`, `ValidationError` | `ledger.cancel` | 대상 lineage 원본·파생 삭제, 다른 lineage 복원, receipt·Outbox 한 UoW | cancellation key |
| `RequestHouseholdNotification` Command v1 | Web·QuickEdit | transactionId, expectedVersion | `Success<NotificationRequestRecorded>`, `ValidationError`, `NotFound`, `AlreadyProcessed` | `ledger.notify.request` | Transaction metadata·receipt·Outbox 한 UoW | envelope key |
| `FindCancellationCandidates` Query | Payment Capture | date range, amount, optional stored fact filters, cursor | `Success<CancellationCandidatePage>`, `NoData`, `Forbidden`, `RetryableFailure` | `ledger.cancel.read` | 읽기 전용 | 해당 없음 |
| `SearchLedger` Query | Web | transactionType, normalized query, 기간, opaque cursor, `limit≤configuredMax` | `Success<LedgerSearchResult>`, `NoData`, `Forbidden`, `RetryableFailure` | `ledger.read` | 읽기 전용 | 해당 없음 |
| `SubscribeLedger` Read Contract | Web | transactionType, date range | `LedgerReadPage` stream 또는 명시적 오류 상태 | 같은 가구 `ledger.read` | 공개 read schema + Rules | 해당 없음 |
| `GetLedgerSummary` Query | Web·Reporting | 기간, grouping | `Success<LedgerSummary>`, `NoData`, `RetryableFailure` | `ledger.read` | Canonical query 또는 소유 Projection | 해당 없음 |
| `ListLocalCurrencyTransactions` Query | Home 지역화폐 상세 | householdId, localCurrencyType, 기간, opaque cursor | `Success<LedgerPage>`, `NoData`, `Forbidden`, `RetryableFailure` | `ledger.read` | 한 가구·한 지역화폐 유형의 active 거래만 | 해당 없음 |

`RecordRecurringTransaction`은 transport endpoint가 아니며 `public.ts`의 Context Workflow용 제한 계약입니다. 이를 제공하는 Port 이름은 `RecordRecurringTransactionParticipant`입니다. participant는 commit하지 않고 검증 결과와 persistence-neutral 변경 의도만 반환합니다.

### 3.2 Command DTO

| DTO | 필수 필드 | 서버 규칙 |
|---|---|---|
| `ManualExpenseDraft` | merchant, amountInWon, categoryId, accountingDate | merchant trim 후 비어 있지 않고 amount는 양의 정수; localTime은 Clock, card 표시는 manual |
| `ManualIncomeDraft` | itemName, amountInWon, accountingDate | itemName 필수; Domain Mapper가 merchant=수입, category=etc, memo=itemName으로 정규화 |
| `CapturedTransactionDraft` | amount, merchant, categoryId, occurred local date/time/zone, source evidence, originChannel, optional card display, optional localCurrencyType | creatorMemberId·source capability·originChannel·지역화폐 type은 호출자 임의 payload가 아니라 검증된 Capture 결과에서 받음; non-local에는 type 금지 |
| `RecurringPostingIntent` | planId, targetMonth, merchant, amount, categoryId, effectiveDate, memo, creatorMemberId | source는 recurring, originChannel은 scheduler로 고정하며 일반 외부 Command에서 선택 불가 |
| `TransactionPatch` | 변경 필드 집합 | amount, memo, categoryId, merchant, accountingDate만 허용; server fields와 capture claim 변경 금지 |
| `SplitOperation` | kind와 kind별 payload | `items`, `monthly-existing`, `monthly-new-manual`, `reconfigure-monthly`, `collapse-monthly`의 discriminated union. QuickEdit item split은 현재 form base draft·items·expectedVersion을 한 payload로 전달 |
| `MergePayload` | targetId, 중복 없는 sourceIds, version map | 같은 household·expense 유형만 허용 |

`monthly-new-manual`은 수동 입력 draft 전체를 받아 `SPL-006`의 memo, manual card metadata, creatorMemberId를 보존합니다. 기존 거래의 split·merge 입력은 일반 DTO가 provenance를 다시 보내게 하지 않고 서버가 읽은 `TransactionOriginSnapshot`과 `CaptureLineageRef`를 사용합니다. 임시 원본을 먼저 commit했다가 삭제하지 않고 한 Split UoW에서 바로 그룹을 만듭니다.

QuickEdit `items` operation은 DEC-055에 따라 분할을 누른 시점의 merchant, amountInWon, categoryId, memo를 `baseDraft`로 받고 item별 허용 표시값과 expectedVersion을 함께 받습니다. 서버는 baseDraft에 없는 카드·source·originChannel·creatorMemberId·capture lineage를 원본에서 읽어 보존합니다. 선행 Update 없이 한 Split UoW로 처리하며, 원본 version 불일치에서는 `Conflict(VERSION_MISMATCH)`와 현재 version·lifecycle state를 반환하고 write하지 않습니다. `superseded`·`deleted` 원본은 새 expectedVersion으로도 일반 Update·Split하지 못합니다.

### 3.3 Read Model

`TransactionView`에는 transactionId, transactionType, amountInWon, accountingDate, localTime, zoneId, merchant, memo, categoryId, cardDisplay, source, originChannel, creatorMemberId, optional localCurrencyType, split/merge 표시 metadata, aggregateVersion을 포함합니다. capture fingerprint hash·lineage 내부 ID와 receipt는 노출하지 않습니다.

`LedgerSearchResult`는 결정적으로 정렬된 현재 `items` page, opaque `nextCursor`, 동일 검색 범위 전체를 기준으로 한 `summary`, `sourceCheckpoint`를 반환합니다. `summary`는 `totalCount`, `totalAmountInWon`, `monthly[{yearMonth, count, amountInWon}]`를 가지며 현재 page의 부분 합계가 아닙니다. 빈 결과는 `NoData`이고 성공 summary의 0원과 구분합니다.

Web `LedgerSearchController`는 서버 Query와 별개로 `actorSessionGeneration`, householdId, transactionType, normalized query, 증가하는 request revision을 함께 보관합니다. Adapter 응답이 현재 identity와 다르면 결과와 cursor를 폐기합니다. modal close·logout·가구 변경은 이전 revision을 무효화하고 가능한 요청을 취소합니다.

목록 정렬은 `accountingDate DESC, localTime DESC, transactionId DESC`로 결정하고 cursor는 opaque입니다. 날짜 합계와 검색은 householdId·transactionType 범위를 항상 포함합니다. transactionType이 없는 legacy 문서는 읽기 Mapper에서 expense로 해석합니다.

`CancellationCandidateFact`는 captureLineageId, 원 승인 date/time/amount/merchant/card evidence, 현재 transaction refs와 lineageVersion만 반환합니다. 완전 일치 여부, 정규화 결과, 취소 가능 여부는 포함하지 않습니다.

## 4. Domain 모델과 불변식

### 4.1 모델

| 모델 | 핵심 값 | 불변식 |
|---|---|---|
| `Transaction` Aggregate | householdId, type, MoneyWon, accounting date/time, merchant, categoryId, source, originChannel, creatorMemberId, optional localCurrencyType, originLineageRefs, lifecycleState, version | 정상 금액은 양의 원 단위 정수, household/type·localCurrencyType과 provenance 불변, active만 일반 조회·집계, 구조 변경 원본은 superseded로 보존, server metadata 임의 수정 금지 |
| `MonthlySplitGroup` Aggregate | groupId, original snapshot, immutable origin lineage refs, installment list, version | 개월 수 2 이상, 날짜 월말 보정, 모든 installment 동일 내림 금액, 그룹 전체 원자 변경 |
| `ItemSplitPlan` Domain result | source snapshot, item drafts | 항목 2개 이상, 각 양수, 합계가 원금과 정확히 동일 |
| `MergedTransaction` Aggregate | target common fields, 평탄한 leaf source snapshot, 중간 merge history ref, immutable origin lineage snapshot, merge version | leaf ID 유일, merge ancestry 중첩 없음, 합계 정확, DEC-010 복원 표시 필드와 숨은 capture lineage 보존 |
| `CaptureLineage` Aggregate | lineageId, rootTransactionId, source, originChannel, creatorMemberId, immutable card/capture evidence, active·superseded transaction refs, version | 구조 변경으로 사라지지 않으며 일반 거래 patch로 수정할 수 없음; 취소 완료 뒤에는 최소 canceled tombstone으로 전환 |
| `CaptureDedupClaim` | fingerprintVersion/hash, lineageId | 하나의 hash는 하나의 immutable lineage에만 연결되고 거래 split·merge·수정 후에도 유지 |
| `HouseholdNotificationRequest` | transactionId, requestedAt, requesterMemberId | expense에서만 허용, 같은 논리 요청은 한 번 |

`MoneyWon`, 날짜·시간·ID는 [Shared Kernel](../../../../../architecture/target-clean-architecture.md#123-shared-kernel-허용-범위)의 공통 의미를 사용합니다.

### 4.2 정책과 계산

| Policy | 결정 |
|---|---|
| `ItemSplitPolicy` | 항목 수·양수·원금 합계 보존 |
| `MonthlySplitPolicy` | `floor(originalAmount / months)`을 모든 달에 동일 저장하고 나머지를 반영하지 않음 |
| `MonthlySplitDatePolicy` | 원 거래 일자를 유지하되 없는 29~31일은 대상 월 말일 |
| `MergePolicy` | 대상 거래의 공통 필드를 유지하고 금액 합산, 원본별 가맹점·금액·카테고리·메모 보존 |
| `NestedMergePolicy` | DEC-056에 따라 merge 입력을 non-merge leaf까지 재귀 평탄화하고 중간 node는 history ref로만 보존; split 파생 거래는 leaf로 유지; 중복 leaf·순환·불완전 snapshot은 전체 거부 |
| `LocalCurrencyTransactionPolicy` | 검증된 capture type만 저장; 상세는 단일 required type; split은 type 보존; merge 입력의 type 집합이 정확히 하나가 아니면 전체 거부 |
| `UnmergeRestorationPolicy` | 원본별 표시 필드를 복원하고 합친 거래의 날짜·시각·거래 유형·카드 정보를 공통 적용 |
| `TransformationLineagePolicy` | 서버가 읽은 원본 lineage를 새 거래·그룹 snapshot에 연결하고 fingerprint claim을 복제·해제하지 않음 |
| `CapturedLineageCancellationPolicy` | DEC-041의 대상 lineage 원본·모든 파생 삭제와 공유 merge에서 다른 lineage 원본 복원 계획을 계산 |
| `LedgerSearchPolicy` | 가맹점·메모와 거래 생성 당시의 표준 카드사 라벨·유형·끝 네 자리 증거에 대해 별칭/마스킹 문자열을 결정적으로 매칭 |
| `LedgerSearchSummaryPolicy` | 동일 검색 범위 전체의 건수·금액과 월별 건수·금액을 계산하고 page 부분 합계와 분리 |
| `HouseholdNotificationEligibility` | 명시적 요청은 expense에서만 허용 |
| `LedgerGroupWriteLimitPolicy` | Adapter 쓰기 한도 안에서 가능한 최대 그룹 크기 검증 |

DEC-001은 Accepted이므로 `MonthlySplitPolicy`에 고정합니다. DEC-010도 Accepted이므로 `UnmergeRestorationPolicy`는 표시 모델에서 원본별 merchant·amount·categoryId·memo와 합친 거래의 공통 date·time·transactionType·cardType·cardLastFour를 조합합니다. 이 표시 복원 정책은 immutable origin/capture card evidence를 덮어쓰지 않습니다. legacy `mergedFrom`에 필수 원본 필드가 없으면 추정하지 않고 `ContractFailure(MERGE_SNAPSHOT_INCOMPLETE)`를 반환합니다.

DEC-013의 알림 수신자는 Ledger가 확정하지 않습니다. Ledger는 모든 신규 거래의 검증된 source, originChannel, creatorMemberId를 필수 보존하고 확정 거래 Event를 발행합니다. 명시적 `RequestHouseholdNotification`은 인증된 requesterMemberId를 담은 별도 요청 Event를 생산하며, Notifications가 요청자 외 가구원을 계산합니다.

## 5. Application Use Case 상세

### 5.1 RecordManualTransaction

1. Actor의 household 일치와 `ledger.write` capability를 확인합니다.
2. wire schema와 idempotency payload hash를 검증합니다.
3. expense/income draft를 Domain 입력으로 정규화합니다.
4. Category 공개 Port로 categoryId의 활성·사용 가능 상태를 조회합니다.
5. Clock과 ActorContext에서 manual 시간·creatorMemberId를 채우고 originChannel을 web으로 고정합니다.
6. Transaction을 생성하고 receipt, `TransactionRecorded.v1`과 한 transaction으로 commit합니다.
7. 성공 후 외부 알림·Projection을 동기 실행하지 않습니다.
8. 재시도는 최초 Transaction ID와 typed result를 재생합니다.

### 5.2 RecordCapturedTransaction

1. Payment Capture용 capability와 household를 검증합니다.
2. captured draft와 fingerprint version/hash의 contract를 검증하되 fingerprint 의미를 다시 계산하지 않습니다.
3. category reference와 amount/date/time 불변식을 확인합니다.
4. 신규 capture의 immutable `CaptureLineage`, fingerprint claim, Transaction, receipt와 Outbox를 같은 transaction으로 commit합니다. claim은 transactionId가 아니라 lineageId를 가리킵니다.
5. claim이 이미 있으면 lineage의 현재 transaction refs를 읽어 `Duplicate(existingId 또는 group refs)`를 반환합니다.
6. 같은 idempotency key의 다른 payload는 Conflict이고, 같은 fingerprint의 다른 채널은 Duplicate입니다.
7. transaction callback 안에서 QuickEdit, FCM, broadcast를 실행하지 않습니다.

### 5.3 Update·Delete

1. Actor, 대상 household, expectedVersion을 검증합니다.
2. Update patch의 허용 필드만 정규화하고 category 변경 시 Category Reference를 다시 확인합니다.
3. capture claim, source, creator, receipt metadata는 일반 Update로 바꾸지 않습니다.
4. Canonical 변경/삭제와 receipt, Changed/Deleted Event를 commit합니다.
5. version 경합은 `Conflict(currentVersion)`이며 일부 patch를 적용하지 않습니다.

### 5.4 Split

1. kind별 payload와 write-limit policy를 먼저 검증합니다.
2. existing source/group의 모든 문서와 aggregateVersion을 읽습니다.
3. item split은 정확 합계, monthly split은 DEC-001과 날짜 보정을 계산합니다.
4. `TransformationLineagePolicy`가 원본의 source, originChannel, creatorMemberId, card evidence와 capture lineage refs를 서버 snapshot에서 읽어 모든 새 항목과 group snapshot에 보존합니다. fingerprint claim은 새로 만들거나 삭제하지 않고 lineage의 current transaction refs만 같은 UoW에서 교체합니다.
5. 원본에 localCurrencyType이 있으면 모든 item/monthly 파생 거래와 group snapshot에 같은 값을 보존합니다.
6. `monthly-new-manual`은 manual draft의 memo, card metadata, creator를 모든 필요한 snapshot에 보존합니다.
7. `collapse-monthly`은 installment 금액 합계로 단일 거래를 만들고 날짜·category·memo는 첫 항목, 가맹점은 분할 표시를 제거한 값을 사용합니다. DEC-001에서 버린 나머지는 복원 금액에 다시 더하지 않습니다.
8. UoW가 원본 제거/tombstone, 새 항목, lineage ref 갱신, receipt와 Event 집합을 한 번에 commit합니다.
9. 한 쓰기라도 실패하면 원본·lineage와 모든 새 항목이 이전 상태를 유지합니다.
10. retry는 동일 groupId·transactionIds와 결과를 재생합니다.

### 5.5 Merge·Unmerge

1. 같은 household의 서로 다른 expense와 모든 version을 확인합니다.
2. `NestedMergePolicy`가 각 merge 입력의 서버 저장 ancestry를 재귀 탐색하여 non-merge leaf snapshot, 중간 merge history ref와 모든 immutable lineage ref를 반환합니다. item/monthly split 파생 거래는 merge가 아니므로 그 자리에서 leaf입니다.
3. 두 입력 graph에 같은 leaf ID가 있거나 cycle·누락·불완전 legacy snapshot이 있으면 `Conflict(MERGE_SOURCE_OVERLAP)` 또는 typed contract failure로 끝내고 쓰지 않습니다.
4. `LocalCurrencyTransactionPolicy`가 모든 leaf·active 입력의 localCurrencyType 집합을 검사합니다. 서로 다른 type 또는 typed/untyped 혼합이면 `Conflict(LOCAL_CURRENCY_TYPE_MISMATCH)`로 쓰지 않습니다.
5. `MergePolicy`가 이번 active 입력의 현재 금액 합계와 target 공통 필드, 평탄한 leaf 복원 snapshot을 만듭니다.
6. 대상·원본과 중간 merge node의 `superseded` 전이, 새 합친 거래, lineage current refs, receipt와 Event를 원자 commit합니다.
7. Unmerge는 평탄한 leaf만 `UnmergeRestorationPolicy`에 전달합니다. 중간 merge node는 복원하지 않습니다.
8. 확정 계획만 합친 거래 제거와 leaf 원본 복원을 한 UoW로 commit합니다.

### 5.6 FindCancellationCandidates·CancelCapturedLineage

1. Query는 household, 기간, 원 승인 amount를 필수 범위로 사용해 capture lineage의 불변 원장 사실만 반환합니다.
2. Payment Capture가 완전 일치·후보 유일성 정책을 적용한 뒤 확정 captureLineageId와 version을 `CancelCapturedLineage`에 보냅니다.
3. Ledger는 대상 lineage의 superseded 원본, active 거래, item/monthly split과 merge 파생 graph를 모두 다시 읽고 version map을 검증합니다.
4. 파생 merge가 다른 lineage도 포함하면 해당 파생 거래를 제거하고 취소되지 않은 원본을 유효한 active 거래로 복원하는 계획을 `CapturedLineageCancellationPolicy`로 계산합니다.
5. 대상 lineage의 모든 Transaction·group/merge snapshot과 capture evidence는 삭제하고 fingerprint claim과 lineage는 같은 승인 재수집을 막는 최소 canceled tombstone으로 전환합니다. tombstone은 lineageId·fingerprint hash/version·canceledAt·receipt reference만 가지며 금액·가맹점·카드·메모를 저장하지 않습니다. cancellation receipt와 Outbox에도 금융 표시 원문을 복제하지 않습니다.
6. 삭제·복원·tombstone·receipt·Outbox를 한 UoW로 commit하며, 완료 뒤 해당 lineage의 사용자 원복 Command는 `NotFound`입니다.
7. 일부 삭제·복원 성공을 Success로 반환하지 않습니다. version 불일치나 transaction 한도 초과는 write 0건의 typed 실패입니다.

### 5.7 Query·알림 요청

- `SubscribeLedger`와 `SearchLedger`는 빈 결과 `NoData`와 Repository failure를 구분합니다.
- `SearchLedger`는 household·transactionType·기간을 저장소 query에 포함하고 opaque cursor와 page limit을 강제합니다. 반환 summary는 동일 `sourceCheckpoint`의 전체 검색 범위를 기준으로 계산하며, 집계 완료 전 source window가 바뀌거나 안전 한도를 넘으면 부분 합계를 반환하지 않습니다. Web Controller는 현재 request identity와 다른 늦은 응답을 view·cache·cursor에 쓰지 않습니다.
- 카드 검색은 등록 카드의 현재 표시 설정을 다시 조회해 과거 거래를 재분류하지 않고, Ledger 거래에 보존된 표준 카드사 라벨·끝 번호 capture evidence를 사용합니다. 지원하는 모든 카드사·결제수단에 같은 규칙을 적용하며 카드사명·끝 네 자리 단독 검색과 `국민카드(2972)` 같은 정확 형식, `삼성카드(3***)` 같은 wildcard 형식은 각각 카드사 별칭과 번호 조건을 모두 만족해야 합니다.
- `ListLocalCurrencyTransactions`는 비어 있지 않은 단일 `localCurrencyType`을 필수로 받고 `all` 같은 sentinel을 허용하지 않습니다. household·type·active 상태·기간을 저장소 query에 포함하며 type 누락·`legacy-unknown` 거래는 반환하지 않습니다.
- Home Adapter는 사용자가 클릭한 카드의 `selectedLocalCurrencyType`을 route input으로 복사합니다. 상세 화면은 이 값을 자체 필터 UI로 바꾸지 않으며 일반 Ledger 목록은 별도 Query로 모든 거래를 계속 제공합니다.
- 합계는 성공적으로 읽은 거래만 계산하며 실패를 0으로 반환하지 않습니다.
- `RequestHouseholdNotification`은 expense, requester membership, version을 검증하고 metadata와 `HouseholdNotificationRequested.v1`을 commit합니다.
- 푸시 전달 실패는 이 Command를 rollback하지 않고 Notifications delivery 상태로 관찰합니다.

## 6. Port 설계

### 6.1 Output Port

| Port | 책임 | Conformance 핵심 |
|---|---|---|
| `LedgerRepository` | 단건·그룹·기간·검색 후보 조회와 persistence mapping | tenant 강제, legacy transactionType=expense, 오류/NoData 구분 |
| `LedgerUnitOfWork` | Transaction, claim, receipt, Outbox 원자 commit | callback 2회, create 경합, rollback |
| `CategoryReferencePort` | categoryId 활성·사용 가능 상태 확인 | NotFound/Inactive/RetryableFailure 구분 |
| `Clock` / `IdGenerator` | manual time, ID, occurredAt | 고정·순차 fixture |
| `OutboxAppendPort` | immutable Ledger Event append | producer/type/version 검증 |
| `LedgerReadContractPort` | 공개 read schema와 cursor query | 결정 정렬, Rules, index |
| `LedgerSearchRequestPort` | Web Query cancellation·request revision | A/B 역전, close·logout 뒤 완료 |
| `ObservabilityPort` | command/group/claim trace와 metric | 금액·메모·카드 전체값 로그 금지 |
| `PurgeParticipantPort` | Ledger 소유 데이터의 결정적 page 삭제 의도 | 같은 checkpoint 재호출 안전 |

`LedgerRepository`와 Firestore transaction handle은 `public.ts`에 export하지 않습니다. Payment Capture와 Recurring은 공개 Application Port만 사용합니다.

### 6.2 Context-private participant

`RecordRecurringTransactionParticipant`와 `PrepareLedgerPurgePage`는 Household Finance Workflow 전용입니다. 다음만 반환합니다.

- 검증된 변경 의도
- 필요한 precondition/version
- 생성할 Event draft
- typed validation/conflict 결과

participant가 직접 commit하거나 Infrastructure transaction 객체를 노출하지 않습니다.

Recurring 쪽 `ProcessRecurringPlanParticipant`, Ledger 쪽 `RecordRecurringTransactionParticipant`, `ProcessRecurringMonthReceipt`, `TransactionRecorded.v1`과 `RecurringPlanProcessed.v1`의 이름은 `ProcessRecurringMonthWorkflow` 계약 전체에서 동일하게 사용합니다.

## 7. 저장·트랜잭션·동시성

### 7.1 논리 저장 모델

| 데이터 | 목표 key | 비고 |
|---|---|---|
| Transaction | `households/{householdId}/ledgerTransactions/{transactionId}` | schemaVersion, lifecycleState(active/superseded), optional localCurrencyType, aggregateVersion, server timestamps |
| Capture lineage | `households/{householdId}/ledgerCaptureLineages/{lineageId}` | immutable origin/capture evidence, active·superseded transaction refs, aggregateVersion; 취소 뒤 최소 tombstone |
| Capture claim | `households/{householdId}/ledgerDedupKeys/{fingerprintHash}` | fingerprintVersion, lineageId, claimedAt, canceledAt?; 취소 뒤에도 재생성 차단 |
| Command receipt | context별 receipt 경로 | payloadHash, typed result, expiresAt |
| Outbox | 공통 `OutboxAppendPort` | 물리 경로를 모듈이 알지 않음 |

Monthly split은 각 파생 Transaction에 groupId, installmentIndex, installmentCount, groupVersion을 저장하고 원본 Transaction은 superseded로 보존합니다. Merge도 모든 원본을 superseded로 보존하고 파생 거래에 immutable lineage refs를 연결합니다. DEC-010의 원복 표시 정책은 보존된 원본을 같은 ID로 재활성화할 때 적용하며 외부 Read Model에는 active 표시 정보만 노출합니다.

지역화폐 상세 Query에는 `householdId + localCurrencyType + lifecycleState + accountingDate + transactionId`의 결정적 index를 사용합니다. type 없는 legacy 거래를 index 조회 뒤 client에서 숨기는 방식이 아니라 저장소 query 자체에서 제외합니다.

### 7.2 transaction 행렬

| 작업 | 같은 transaction의 변경 |
|---|---|
| Manual create | Transaction + receipt + `TransactionRecorded.v1` |
| Captured create | Capture lineage + fingerprint claim + Transaction + receipt + Event |
| Update/Delete | Transaction version/tombstone + receipt + Changed/Deleted Event |
| Split/Reconfigure | 원본 superseded 전이·기존 그룹 전체 + 새 그룹 전체 + lineage refs + receipt + Event 집합 |
| Merge/Unmerge | 모든 원본 superseded/active 전이·파생 거래 + lineage refs + receipt + Event 집합 |
| Captured lineage cancel | 대상 lineage 원본·파생 전체 삭제 + 공유 merge의 다른 원본 복원 + canceled lineage/claim tombstone + receipt + Event 집합 |
| Explicit notify | Transaction request metadata + receipt + `HouseholdNotificationRequested.v1` |

Firestore write limit을 넘을 가능성이 있으면 transaction 시작 전에 `ValidationError(GROUP_TOO_LARGE)`를 반환합니다. 정확한 최대값은 Infrastructure limit을 반영한 `LedgerGroupWriteLimitPolicy` 설정으로 테스트하며 Domain에 Firebase 숫자를 넣지 않습니다.

### 7.3 동시성

- 모든 수정 작업은 aggregateVersion 또는 version map precondition을 사용합니다.
- fingerprint claim은 create-only 경합으로 한 CaptureLineage만 허용하며, 구조 변경은 같은 lineage의 current transaction refs만 version 조건으로 바꿉니다.
- group 작업 중 한 문서라도 version이 달라지면 전체 Conflict입니다.
- 구조 변경은 관련 Transaction, group metadata, capture lineage의 version map을 모두 precondition으로 사용합니다.
- capture lineage 취소는 대상 graph와 공유 merge의 모든 lineage version을 precondition으로 사용하며 한계 초과 시 실행 전에 거부합니다.
- callback 재실행에도 ID, receipt, Event ID는 사전 생성된 결정값을 사용합니다.
- 외부 side effect는 commit 뒤 Outbox Dispatcher가 수행합니다.

### 7.4 Legacy 전환

1. 새 Application이 기존 `expenses`를 쓰는 Legacy Mapper 뒤에서 동작합니다.
2. transactionType 누락을 expense로 읽는 호환 fixture를 유지합니다.
3. source, originChannel, creatorMemberId, localCurrencyType, schemaVersion, aggregateVersion을 근거가 있는 범위에서 backfill하고 불명확한 legacy 값은 명시적인 unknown 채널로 격리합니다. localCurrencyType은 parser/capture 근거가 없으면 추정하지 않습니다.
4. legacy `notifyPartnerAt/notifyPartnerBy` 변경은 전환 Mapper가 `requestedAt/requesterMemberId`와 `HouseholdNotificationRequested.v1`로 변환하되 특정 partner 수신자를 만들지 않습니다.
5. V1/V2 문서 수·기간별 금액 합계·결정 hash를 shadow compare합니다.
6. Read 전환 후 Web·Android·기존 Functions의 직접 write를 Rules와 dependency test로 막습니다.
7. dual-write는 제거 조건과 권위 Writer를 명시합니다.

## 8. Event·Projection·외부 연동

### 8.1 생산 Event

| Event | 최소 payload | 소비자 |
|---|---|---|
| `TransactionRecorded.v1` | transactionId, type, amount, accountingDate, categoryId, source, originChannel, creatorMemberId, aggregateVersion | Budget, Notifications, Reporting |
| `TransactionChanged.v1` | transactionId, 변경 전·후 projection fact, aggregateVersion | Budget, Reporting |
| `TransactionDeleted.v1` | transactionId, 마지막 projection fact, aggregateVersion | Budget, Reporting |
| `CapturedLineageCancelled.v1` | canceled lineage opaque ID, 삭제 transaction projection facts, 복원 transaction projection facts | Budget, Reporting |
| `HouseholdNotificationRequested.v1` | transactionId, requesterMemberId, requestedAt | Notifications |

Event payload는 projection 조정에 필요한 최소 금액·날짜·category 사실만 포함하고 memo·카드 전체값 같은 불필요한 개인정보를 제외합니다. group operation은 동일 correlationId 아래 각 확정 Transaction Event를 기록합니다.

### 8.2 조회와 Projection

- 단순 월 원장 목록은 Ledger 소유 공개 Firestore Read Contract로 제공할 수 있습니다.
- Budget와 Reporting은 Event 소비 Projection이며 Ledger Repository를 import하지 않습니다.
- Read Contract는 schemaVersion, index, 결정 정렬, Membership Rules를 명시합니다.
- 실시간 listener 오류는 stream의 `failed` 상태로 전달하며 빈 snapshot으로 변환하지 않습니다.

### 8.3 외부 연동

FCM·Android broadcast·QuickEdit·HTTP Provider는 Ledger transaction에서 호출하지 않습니다. Payment Capture와 Recurring의 동기 호출은 공개 Port이며, Notifications와 Read Side는 Outbox Event를 at-least-once로 소비합니다.

## 9. 오류·보안·관측성

### 9.1 안정 오류 코드

| 분류 | 코드 예 |
|---|---|
| 입력 | `AMOUNT_NOT_POSITIVE_INTEGER`, `MERCHANT_REQUIRED`, `INCOME_ITEM_REQUIRED`, `MONTHS_BELOW_TWO` |
| 참조 | `CATEGORY_NOT_FOUND`, `CATEGORY_INACTIVE`, `TRANSACTION_NOT_FOUND` |
| 그룹 | `SPLIT_SUM_MISMATCH`, `GROUP_TOO_LARGE`, `LINEAGE_TOO_LARGE`, `GROUP_VERSION_MISMATCH`, `MERGE_SOURCE_DUPLICATE`, `LINEAGE_VERSION_MISMATCH` |
| 정책 | `UNMERGE_POLICY_UNDECIDED`, `RESTORATION_SNAPSHOT_INCOMPLETE` |
| 충돌 | `VERSION_MISMATCH`, `IDEMPOTENCY_PAYLOAD_MISMATCH` |
| 계약 | `UNSUPPORTED_CONTRACT_VERSION`, `UNSUPPORTED_FINGERPRINT_VERSION` |

Duplicate는 실패 문자열이 아니라 existingTransactionId를 가진 typed Result입니다.

### 9.2 보안

- 모든 Command와 민감 Query는 Actor household와 capability를 서버에서 검증합니다.
- Canonical write, fingerprint claim, receipt, outbox는 client direct write를 거부합니다.
- Read Contract는 같은 household Membership에 필요한 필드와 query만 허용합니다.
- creatorMemberId는 Actor 또는 검증된 SystemActor에서만 설정합니다.
- 다른 가구의 transactionId/groupId를 사용하면 NotFound로 정보 노출을 최소화합니다.
- 로그에 memo, 전체 카드 정보, merchant 원문을 기본 기록하지 않습니다.

### 9.3 관측성

commandId, correlationId, operation kind, transaction/group ID, aggregateVersion, result code, transaction retry 횟수, Event 수를 구조화 기록합니다. 금액은 운영 metric에 필요할 때만 권한 있는 집계로 처리하고 개별 금융 내용을 일반 로그에 남기지 않습니다. Outbox delivery와 거래 commit 상태는 별도 trace span입니다.

## 10. 목표 패키지 구조

아직 없는 경로는 `목표`입니다.

```text
functions/src/contexts/household-finance/ledger/
  domain/
    transaction/
    splitting/
    merging/
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

web/src/features/ledger/
  application/
  adapters/functions-api/
  adapters/firestore-read-model/
  presentation/
  public.ts
```

Domain은 Firebase·React를 import하지 않습니다. 다른 기능은 `ledger/public.ts`만 import하며 collection name과 Mapper를 알지 않습니다.

## 11. 테스트 설계

### 11.1 계층별 suite

- Domain Unit: 양의 정수, income normalization, DEC-001, 월말 날짜, item 합계, merge snapshot, 검색 alias.
- Application: 권한, category Port 실패, receipt replay/conflict, group rollback, typed Result/Event.
- Contract: manual/captured/recurring DTO 분리, Result와 Event version fixture.
- Repository Conformance: legacy Mapper와 V2 Adapter의 query·version·NoData 의미.
- Emulator: fingerprint 동시 경합, group transaction 실패, callback 2회, Rules·Outbox 원자성.
- Client: 입력 안내, 구독 failed 상태, 성공 commit 후 UI event.
- E2E: 수동 지출/수입, split/merge/cancel, 같은 가구 격리.

### 11.2 요구사항 추적 표

| 요구사항 ID | 테스트 수준 | 테스트 대상 | 핵심 fixture/경계값 | 관찰 결과 | Canonical 테스트 ID |
|---|---|---|---|---|---|
| LED-001 | Contract·Repository | SubscribeLedger | transactionType 누락, 월·기간 양끝, active 외 상태, 동일 시각 여러 ID, NoData·listener 실패 | legacy는 expense, 가구·유형·기간 범위, 날짜·시각·ID 결정 정렬, 오류 분리 | T-LED-001 |
| LED-002 | Domain·Application | RecordManualTransaction expense | 공백 merchant, 0/음수/소수, 유효 category | 검증 오류 또는 한 거래·Event | T-LED-005 |
| LED-003 | Domain·Application | RecordManualTransaction income | 빈 itemName, 양의 금액 | merchant/category/memo 정규화 | T-LED-006 |
| LED-004 | Application·Repository | manual metadata | FixedClock, 회계일과 현재 시각 차이 | HH:mm·manual metadata·서버 creator 저장 | T-LED-007 |
| LED-005 | Domain·Emulator | Update/Delete | 허용 필드 전체 patch·정상 delete, 대상 없음·타 가구·0원, stale version, 저장 실패 | 성공 시 전체 필드·상태·version·Event 확정, 실패는 typed 결과와 write 0건 | T-LED-008 |
| LED-006 | Query·Client | GetLedgerSummary | 선택일, 월·연, category, Repository 실패 | 목록·합계 정확, 실패를 0으로 축약하지 않음 | T-LED-009 |
| LED-007 | Application·Outbox | RequestHouseholdNotification | expense/income, requester와 creator 동일·상이, 가구원 1·2·3명, 중복 key, delivery 실패 | expense metadata·Event 한 번, requester 외 전원, 전달 상태 분리 | T-LED-010 |
| LED-008 | Application·Emulator·E2E | 모든 group replacement UoW | 여섯 구조 operation의 권한 없음·타 가구·누락·stale version·commit 실패, 같은 거래 Update·Split 경합 | typed Forbidden·NotFound·Conflict·RetryableFailure와 본문·claim·receipt·Event write 0건, 먼저 commit한 하나만 성공 | T-LED-002 |
| LED-009 | Domain·Application·Emulator | TransformationLineagePolicy·CapturedLineageCancellationPolicy·CaptureDedupClaim | captured item/monthly split·reconfigure·merge/unmerge, duplicate 재수집, 월 그룹 취소·replay, legacy 불완전 lineage | 원본 superseded·전체 증거·같은 ID 원복, 취소 시 대상 전체 삭제·다른 lineage 복원·claim cancelled·tombstone/Event 한 건, 불완전 legacy typed failure | T-LED-003 |
| LED-010 | Domain·Contract·Repository·UI | LocalCurrencyTransactionPolicy·ListLocalCurrencyTransactions | 검증 capture type 있음·없음, 수동 위조, update 변경/제거, 경기·대전·legacy-unknown, single type route, split·merge | 검증 type만 생성·immutable, 선택 type만 상세 표시, legacy 일반 원장 보존, split type 유지, 모호한 merge Conflict | T-LED-004 |
| SPL-001 | Domain·Emulator | item Split·restore | 1개, 0원 항목, 합계 불일치, 항목별 표시값, 두 번째 write 실패, 성공 후 원복 | 실패는 원본·claim 유지; 성공은 원본 superseded·파생 active와 증거 보존; 원복은 파생 제거·같은 원본 전체 필드 재활성화 | T-SPL-003 |
| SPL-002 | Domain Unit | monthly Split date/sequence | 2개월, 1월 31일, 윤년 2월 | 2개 이상·월말 보정·순번 표시 | T-SPL-001, T-SPL-002 |
| SPL-003 | Application·Emulator | Split collapse-monthly·captured cancel | group ID·index·count, 원본·항목 전체 metadata, 한 문서 version 경합, lineage 취소·replay | collapse는 같은 원본 복원, 취소는 원본·그룹 삭제와 claim cancelled, 경합은 그룹 전체 유지 | T-SPL-004, T-LED-003 |
| SPL-004 | Domain·Emulator | reconfigure monthly | 1개월, 새 개월 수, 원본·기존 파생의 전체 필드·상태, 기존 group 경합 | 기존 항목과 원본 superseded, 새 active group의 증거 보존과 원자 재구성 | T-SPL-005 |
| SPL-005 | Domain Unit | MonthlySplitPolicy | 10,000원/3개월, 나머지 0·1·n-1 | 각 3,333원, 1원 의도적 미반영 | T-SPL-001 |
| SPL-006 | Application·Emulator | monthly-new-manual | memo, creator, manual card metadata, 중간 실패 | 입력 metadata 유지와 한 UoW | T-SPL-006 |
| MRG-001 | Domain·Emulator | Merge·NestedMergePolicy | 대상·leaf 전체 snapshot, `A+B=M` 뒤 `M+C`, 겹치는 leaf, cycle, 불완전 graph, version map, UoW 실패·lineage 취소 | 대상 표시·합산, leaf 전체 복원 snapshot·평탄 lineage·중간 history; graph/contract/UoW 오류 rollback; 취소 시 비대상 leaf 복원 | T-MRG-001 |
| MRG-002 | Domain·Application | UnmergeRestorationPolicy | 날짜·시각·카드가 다른 leaf 전체 필드, 정상/ID·lineage 없는 legacy snapshot | 같은 leaf ID·원본별 표시/capture 필드와 merged 공통 date·time·type·display card 적용 또는 ContractFailure·무변경 | T-MRG-002 |
| SEA-001 | Domain·Query | SearchLedger | merchant 대소문자·공백, memo, 카드 증거 변형, 빈 query, 기간 양끝, 타 가구/type/state, 정렬 동률 | 빈 query NoData, 같은 범위 일치만 날짜·시각·ID 최신순 | T-SEA-001 |
| SEA-002 | Domain Unit | LedgerSearchPolicy | 설정 기반 모든 카드사 alias·유형, 끝 4자리, 카드사+정확 번호, x/별표 마스킹 | 특정 카드사 하드코딩 없이 복합 조건 모두 일치 | T-SEA-001 |
| SEA-003 | Query Contract·Client | SearchLedger·LedgerSearchController | cursor/limit 두 page·scope 변경, A slow→B fast, close, logout·가구 변경, mutation 실패·성공 | bounded page 중복·누락 없음, cursor scope 고정, obsolete 응답 폐기, 성공 mutation 뒤 새 revision 재조회 | T-SEA-002 |
| SEA-004 | Domain·Query Contract | LedgerSearchSummaryPolicy·SearchLedger | 여러 월·여러 page, 일치·불일치 카드, source window 변경·조회 한도 | 전체 검색 범위의 총·월별 건수와 금액, 부분 합계 성공 금지 | T-SEA-003 |

Ledger 요구사항의 Canonical 테스트 ID는 모두 위 추적 표와 계약 테스트 파일에 연결합니다. `describe.skip` 상태는 테스트 본문이 준비됐지만 목표 Input Port 구현과 연결되지 않았음을 뜻하며 통과로 간주하지 않습니다.

## 12. 미결정 사항과 구현 순서

### 12.1 확정된 제품 정책

도시가스 회계일은 [DEC-007](../../../../governance/decisions.md#dec-007)로 확정되어 납부마감일을 accountingDate로 수용하고 observed timestamp는 별도 추적 정보로 유지합니다. 재병합은 [DEC-056](../../../../governance/decisions.md#dec-056)에 따라 merge ancestry를 non-merge leaf까지 평탄화합니다. Ledger에 남은 별도 Human in the loop 항목은 없습니다.

### 12.2 구현 순서

1. 기존 계산과 legacy transactionType에 Characterization test를 고정합니다.
2. `RecordManualTransaction` 한 Vertical Slice에 Domain, Application, Legacy Repository, receipt, Outbox를 연결합니다.
3. Web direct write를 Facade 뒤에서 새 Command로 전환합니다.
4. Update/Delete와 공개 Read Contract를 전환합니다.
5. `T-LED-002`로 Split/Merge/Cancel 서버 UoW와 version 경합을 활성화합니다.
6. Payment Capture fingerprint claim을 `CaptureLineage`로 전환하고 migration과 `T-LED-003`을 활성화합니다.
7. 검색 매칭·전체 요약과 request revision의 `T-SEA-001~003`을 활성화합니다.
8. `ProcessRecurringMonthWorkflow` participant를 추가합니다.
9. Budget·Notifications·Reporting consumer 전환 후 V2 backfill/shadow read를 수행합니다.
10. Android/Web/기존 Functions의 `expenses` 직접 Writer를 Rules와 CI로 제거합니다.
