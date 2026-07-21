# 자산 자동화 모듈 상세 설계

> 소유 요구사항: [자산 자동화 모듈 요구사항](requirements.md) (`AUTO-*`, `LOAN-*`)  
> 상위 경계: [Portfolio Bounded Context](../../requirements.md)  
> 공통 계약: [모듈 상세 설계 규약](../../../../governance/module-design-standard.md)  
> 목표 구조: [목표 Clean Architecture 설계](../../../../../architecture/target-clean-architecture.md)

## 1. 설계 목적과 추적성

이 문서는 적금 월 납입과 대출 월 상환의 순수 정책, 월별 실행 claim, AssetAccount 변경을 함께 commit하는 `ApplyAssetAutomationWorkflow`를 정의합니다. [DEC-052](../../../../governance/decisions.md#dec-052)에 따라 매일 00:00 due Plan만 조회하고 화면 방문과 무관하게 누락 월을 복구하며, `(assetId, operationType, targetMonth)`가 정확히 한 번만 반영되는 것이 핵심입니다.

공통 envelope, `ActorContext`, typed Result, receipt·Outbox 형식은 [모듈 상세 설계 규약](../../../../governance/module-design-standard.md)을 사용합니다. [DEC-011](../../../../governance/decisions.md#dec-011)에 따라 신규·기존 자산의 자동화 최초 활성화 시점이 당월 실행일 이후이면 현재 잔액에 당월분이 포함된 것으로 보는 `FirstAutomationMonthPolicy`를 사용합니다. 추가 근거는 [자산 자동 처리 흐름](../../../../system/flows.md), [데이터 소유권](../../../../cross-cutting/data-ownership.md), [보안 경계](../../../../cross-cutting/security-privacy.md), [테스트 전략](../../../../governance/test-strategy.md)입니다.

## 2. 모듈 경계와 책임

이 모듈이 소유합니다.

- 적금 납입·대출 상환 설정의 의미와 검증
- 월말 보정된 유효 납입일, 당월 대상 여부와 원금 감소 계산
- `AssetAutomationPlan`과 결정적 월 `AutomationExecution` claim
- Plan의 effective revision, `nextDueDate`와 일일 due-plan 조회
- 최초 적용 월을 결정하는 교체 가능한 `FirstAutomationMonthPolicy`
- `ApplyAssetAutomationWorkflow`에 제공하는 자동화 transaction participant
- `AssetAutomationApplied.v1`의 단일 producer

이 모듈이 소유하지 않습니다.

- AssetAccount 잔액과 version의 최종 저장: [자산 포트폴리오](../portfolio/requirements.md)
- Position 평가와 시세: [보유종목·시장 데이터](../holdings-market-data/requirements.md)
- Scheduler runtime, 공통 retry·job run 저장: [외부 운영](../../../../supporting-platform/modules/external-operations/requirements.md)
- 실제 은행 이체, 거래 원장 posting, Firebase SDK와 UI 생명주기

Automation은 `assets` Repository를 import하지 않습니다. 자동화 계산 결과와 execution intent를 제공하고, Portfolio Core의 Asset intent와 함께 Context Workflow가 commit합니다.

## 3. 공개 계약

### 3.1 공개 DTO

```ts
type AutomationOperationV1 = 'savings-contribution' | 'loan-repayment';
type LoanRepaymentMethodV1 =
  | 'equal-principal'
  | 'equal-principal-and-interest'
  | 'bullet';

interface ConfigureAutomationPlanPayloadV1 {
  assetId: string;
  expectedPlanVersion?: number;
  operation: AutomationOperationV1;
  amount: number;
  configuredDay: number;
  annualInterestRate?: number;
  repaymentMethod?: LoanRepaymentMethodV1;
}

interface RunAutomationPayloadV1 {
  assetId: string;
  operation: AutomationOperationV1;
  targetMonth: string; // YYYY-MM, Asia/Seoul
  expectedAssetVersion?: number;
  expectedPlanVersion?: number;
}

interface EvaluateAutomationMonthQueryV1 {
  householdId: string;
  assetId: string;
  operation: AutomationOperationV1;
  targetMonth: string;
  asOf: string; // LocalDate
}

interface AutomationPlanReadModelV1 {
  schemaVersion: 1;
  assetId: string;
  householdId: string;
  operation: AutomationOperationV1;
  amount: number;
  configuredDay: number;
  annualInterestRate?: number;
  repaymentMethod?: LoanRepaymentMethodV1;
  firstActivatedOn: string; // LocalDate, 최초 한 번 고정
  firstApplicableMonth?: string;
  nextDueDate?: string; // LocalDate, Asia/Seoul
  status: 'active' | 'recovering-before-stop' | 'inactive' | 'deleted' | 'needs-attention';
  effectiveRevision: number;
  activationMonthDisposition: 'included' | 'applicable';
  aggregateVersion: number;
  updatedAt: string;
}

type AutomationEvaluationV1 =
  | { status: 'due'; effectiveDate: string; balanceDelta: number }
  | { status: 'not-due'; effectiveDate: string }
  | { status: 'already-applied'; executionId: string }
  | { status: 'unsupported-method'; method: 'bullet' };

interface AutomationAppliedV1 {
  assetId: string;
  operation: AutomationOperationV1;
  targetMonth: string;
  effectiveDate: string;
  appliedPrincipalOrContribution: number;
  resultingBalance: number;
  assetVersion: number;
  executionId: string;
}

interface DueAutomationPagePayloadV1 {
  runId: string;
  asOfDate: string; // LocalDate, Asia/Seoul
  cursor?: string;
  pageSize: number;
}

interface AutomationPageResultV1 {
  runId: string;
  asOfDate: string;
  nextCursor?: string;
  completed: boolean;
  applied: readonly { assetId: string; operation: AutomationOperationV1; targetMonth: string; executionId: string }[];
  alreadyApplied: readonly { assetId: string; operation: AutomationOperationV1; targetMonth: string; executionId: string }[];
  unsupported: readonly { assetId: string; operation: AutomationOperationV1 }[];
  needsConfirmation: readonly { assetId: string; operation: AutomationOperationV1 }[];
  retryableFailed: readonly { assetId: string; operation: AutomationOperationV1; code: string; retryKey: string }[];
  permanentFailed: readonly { assetId: string; operation: AutomationOperationV1; code: string }[];
}
```

자동 납입·상환 금액은 유한한 0 초과 원 단위 정수, configured day는 1~31, 금리는 유한한 0 이상의 퍼센트 값입니다. `targetMonth`와 `asOf`는 `Asia/Seoul` LocalDate Value Object로 parse하며 JavaScript local timezone에 의존하지 않습니다.

### 3.2 Input Port

| 이름·종류 | 호출자 | 입력 | 결과 | 권한 | 일관성 | 멱등성 |
|---|---|---|---|---|---|---|
| `ConfigureAssetAutomation` Command | Web/API | `CommandEnvelope<ConfigureAutomationPlanPayloadV1>` | `Success<AutomationPlanReadModelV1>`, `ValidationError`, `Conflict` | `portfolio.automation.write` | Plan + receipt + 필요한 Outbox | envelope key + plan version |
| `EvaluateAutomationMonth` Query | Web preview, Scheduler Application | query DTO, `ActorContext` | `Success<AutomationEvaluationV1>`, `ValidationError`, `NotFound`, `NoData` | `portfolio.automation.read` | 순수 읽기·계산 | 해당 없음 |
| `RunContribution` Command | Scheduler, 제한된 수동 재실행 | contribution 고정 `RunAutomationPayloadV1` | `Success<AutomationAppliedV1>` 또는 `Success<AutomationEvaluationV1>`, `ValidationError`, `Forbidden`, `NotFound`, `Conflict`, `AlreadyProcessed`, `RetryableFailure` | `portfolio.automation.run` | `ApplyAssetAutomationWorkflow` | execution key + receipt |
| `RunRepayment` Command | Scheduler, 제한된 수동 재실행 | repayment 고정 `RunAutomationPayloadV1` | `Success<AutomationAppliedV1>` 또는 `Success<AutomationEvaluationV1>`, `ValidationError`, `Forbidden`, `NotFound`, `Conflict`, `AlreadyProcessed`, `RetryableFailure` | `portfolio.automation.run` | `ApplyAssetAutomationWorkflow` | execution key + receipt |
| `ProcessDueAssetAutomation` Workflow | Scheduler Adapter | `CommandEnvelope<DueAutomationPagePayloadV1>` | `Success<AutomationPageResultV1>`, `PartialFailure`, `RetryableFailure` | `portfolio.job.asset-automation` SystemActor | 자산·operation·월별 UoW | runId/page + 결정 execution key |
| `PurgeAssetAutomationParticipant` Context-private Process Command | `AssetPurgeProcess` | `AssetPurgePageCommandV1` | `Success<AssetPurgePageResultV1>`, `Forbidden`, `Conflict`, `RetryableFailure` | `portfolio.asset.purge.process` SystemActor | Plan·execution page + purge receipt | processId+participant+cursor |
| `GetAutomationPlan` Query | Web, Application | assetId, operation | `Success<AutomationPlanReadModelV1>`, `NoData`, `Forbidden` | `portfolio.automation.read` | 읽기 | 해당 없음 |

`AutomationAppliedV1`은 `assetId`, operation, targetMonth, effectiveDate, appliedPrincipalOrContribution, resultingBalance, assetVersion, executionId를 반환합니다. “납입일 전”과 “지원하지 않는 만기일시”는 실패가 아니라 각각 `Success<not-due>`, `Success<unsupported-method>`로 관찰되며, 잘못된 설정은 `ValidationError`입니다.

같은 execution key가 이미 있으면 transport idempotency key가 달라도 `AlreadyProcessed(executionId)`를 반환합니다. 같은 envelope key와 같은 payload는 최초 typed 결과를 그대로 재생하고, 같은 key의 다른 payload는 `Conflict`입니다.

요구사항 문서의 `EvaluateSavingsContribution`, `CalculateEffectivePaymentDate`, `CalculateLoanPrincipalPayment`, `EvaluateLoanRepayment`은 Domain Policy·Application Query 연산입니다. 외부 wire API는 부수 효과 없는 `EvaluateAutomationMonth`로 통합하고, 단위 테스트는 각 순수 Policy를 직접 검증합니다.

### 3.3 권한과 tenant

Capability 매핑은 Access가 소유합니다. Application은 Actor household, Plan household, Asset household를 모두 비교합니다. `portfolio.job.asset-automation`은 Scheduler `SystemActor`에만 부여하고, 사용자의 수동 재실행은 단일 Asset과 명시 targetMonth로 제한합니다. 클라이언트가 전달한 “이미 처리됨” 표시는 신뢰하지 않고 execution claim을 조회합니다.

## 4. Domain 모델과 불변식

### 4.1 Aggregate와 Value Object

| 모델 | 핵심 상태 | 불변식 |
|---|---|---|
| `AssetAutomationPlan` Aggregate | householdId, assetId, operation, status, stopEffectiveAt?, firstApplicableMonth, nextDueDate, suspension intervals, effective revisions, version | Automation만 Writer이며 active 또는 중지 전 overdue 복구 상태에서 `nextDueDate<=asOfDate`인 Plan만 due 조회합니다. overdue date는 execution과 원자 commit되기 전 전진하지 않습니다. |
| `AutomationPlanRevision` | planId, revision, effectiveFrom, amount/day, loan policy, resumeFromDate? | target effectiveDate에 적용되는 최신 revision 하나를 결정하며 일반 변경·비활성·삭제로 제거하지 않습니다. 운영 복구 revision은 삭제 구간을 소급 대상에서 제외합니다. |
| `AutomationExecution` claim | executionId, key, targetMonth, applied delta, resulting Asset version | `(householdId, assetId, operation, targetMonth)`에 하나입니다. |
| `YearMonth` | `YYYY-MM` | 서울 월 경계로 비교합니다. |
| `PaymentDay` | 1~31 | 해당 월 마지막 날을 넘으면 말일로 보정합니다. |
| `ContributionAmount` | 0보다 큰 원 단위 정수 | 0 이하는 plan 검증 오류입니다. |
| `LoanTerms` | annualRate, method, monthlyPayment | method별 필수값이 유효해야 합니다. |

### 4.2 납입 Policy

`CalculateEffectivePaymentDate(yearMonth, configuredDay)`는 `min(configuredDay, daysInMonth)`를 사용합니다. 활성 적금이며 plan이 유효하고 `asOf >= effectiveDate`, targetMonth가 first applicable 범위이고 execution claim이 없을 때만 `balanceDelta = +amount`를 반환합니다.

31일 설정의 2월은 평년 2월 28일, 윤년 2월 29일에 due가 됩니다. 납입일 전, deleted·purging Asset, 아직 적용 가능하지 않은 월은 Canonical 상태를 바꾸지 않습니다.

### 4.3 대출 원금 Policy

현재 계산과 1원 단위 반올림을 유지합니다.

```text
monthlyInterest = round(balance * annualRate / 100 / 12)

equal-principal:
  principal = min(balance, monthlyPayment)

equal-principal-and-interest:
  principal = min(balance, max(0, monthlyPayment - monthlyInterest))

resultingBalance = max(0, balance - principal)
```

`bullet`은 자동 처리하지 않고 `unsupported-method`를 반환합니다. 잔액 0은 성공적인 no-op이며 음수로 내려가지 않습니다. 연이율·납입액·날짜가 유효하지 않으면 0으로 보정하지 않고 검증 오류입니다.

### 4.4 최초 월 Policy

`FirstAutomationMonthPolicy`의 결과는 다음 중 하나입니다.

```text
ApplyWhenDue(firstApplicableMonth)
MarkActivationMonthIncluded(firstApplicableMonthAfterActivation)
```

[DEC-011](../../../../governance/decisions.md#dec-011)에 따라 자동화 `firstActivatedOn`이 실행일 이전·당일이면 `ApplyWhenDue(activationMonth)`, 이후이면 `MarkActivationMonthIncluded(nextMonth)`를 반환합니다. 후자의 경우 활성화 월 execution을 금액 delta 0의 `included-in-current-balance` 상태로 기록하고 다음 달을 firstApplicableMonth로 저장합니다. 자산과 Plan을 함께 만들면 자산 생성일과 firstActivatedOn이 같고, 기존 자산에서 나중에 처음 켜면 실제 활성화일을 사용하여 그 이전 월을 소급하지 않습니다. 정책 결과는 plan에 명시적으로 저장하여 재실행 중 바뀌지 않게 합니다.

## 5. Application Use Case 상세

### 5.1 Plan 설정

1. Adapter가 인증·schema를 검증합니다.
2. Application이 tenant와 Capability, 대상 Asset의 유형·현재 잔액을 Portfolio 공개 Query로 확인합니다.
3. DTO를 Domain Value Object로 변환하고 operation별 필수값을 검증합니다.
4. Plan이 처음 만들어질 때 서버 Clock의 LocalDate를 immutable `firstActivatedOn`으로 저장하고 `FirstAutomationMonthPolicy`가 당월 effective date와 비교해 activationMonthDisposition과 firstApplicableMonth를 결정합니다.
5. 실행일 이후 최초 활성화이면 활성화 월을 현재 잔액 포함 상태로 표시하고 금액 delta를 적용하지 않습니다.
6. Plan, 선택적 활성화 월 execution, receipt, 설정 변경 Event가 필요한 경우 Outbox를 한 transaction으로 저장합니다.

Automation 설정을 다시 바꾸어도 이미 존재하는 월 execution claim을 삭제하거나 재적용하지 않습니다.

설정 변경은 기존 revision을 덮어쓰지 않고 server effective 시각을 가진 새 revision을 추가합니다. 이미 overdue인 `nextDueDate`는 새 revision 때문에 건너뛰지 않으며 당시 revision으로 먼저 처리합니다. 아직 due가 아니면 변경 이후 처음 도래하는 유효 납입일로 `nextDueDate`를 다시 계산합니다. 비활성·논리 삭제 시점 이전에 overdue가 있으면 `recovering-before-stop`과 `stopEffectiveAt`을 저장해 그 범위만 마친 뒤 inactive·deleted로 전이하고, 이후 due는 만들지 않습니다.

### 5.2 평가

`EvaluateAutomationMonth`는 Asset snapshot, Plan, execution 존재 여부, targetMonth와 asOf만 입력받는 순수 Application Query입니다. execution이 있으면 `already-applied`, first month가 unresolved면 `needs-confirmation`, 아직 날짜가 안 됐으면 `not-due`, bullet이면 `unsupported-method`, 나머지는 delta를 포함한 `due`를 반환합니다.

### 5.3 `ApplyAssetAutomationWorkflow`

1. Command의 tenant·Capability·receipt를 확인합니다.
2. `AutomationExecutionRepository`에서 결정 execution key를 확인합니다.
3. Automation participant가 Plan과 Asset snapshot을 Domain Policy에 전달해 `AutomationChangeIntent`를 만듭니다.
4. Portfolio Core의 `AssetAutomationParticipant.prepare`가 delta, expected Asset version, resulting balance를 검증해 `AssetValuationIntent`를 만듭니다.
5. Workflow가 두 intent를 `PortfolioAutomationUnitOfWork`에 전달합니다.
6. UoW는 execution claim 생성, Plan checkpoint/version, Asset balance/version, command receipt, `AssetAutomationApplied.v1`과 `AssetValuationChanged.v1` Outbox를 한 transaction으로 commit합니다.
7. commit 뒤에만 job result와 metric을 기록합니다.

participant는 직접 commit하지 않으며 transaction callback 안에서 Clock, Scheduler, 외부 API나 log를 호출하지 않습니다. transaction 경합 시 기존 계산 입력과 server Clock으로 정규화한 targetMonth를 사용해 재검증합니다.

### 5.4 운영 복구 participant

`RestoreAssetWorkflow`에서만 호출되는 context-private participant입니다. 일반 사용자용 Input Port로 export하지 않습니다.

1. Portfolio Core가 제공한 동일 가구 assetId, deletedAt, restoredOn과 Automation Plan snapshot을 검증합니다.
2. 삭제 전에 이미 effective date가 도래한 미처리 월은 복구 대기 상태로 유지합니다.
3. `[deletedAt, restoredOn)`에 effective date가 들어간 월은 suspension interval로 제외하여 이후 due scan이 소급 생성하지 않게 합니다.
4. 복구일이 당월 유효 실행일 이전·당일이면 그 실행일, 이후이면 다음 달 유효 실행일을 `resumeFromDate`로 정한 revision intent를 반환합니다.
5. Core의 active 전환 intent와 Automation resume intent를 같은 `RestoreAssetWorkflow` UoW로 commit합니다. Plan이 없으면 no-op intent를 반환하며, Asset만 먼저 active가 되는 중간 상태를 만들지 않습니다.

### 5.5 일일 due-plan job

1. Scheduler Adapter는 매일 00:00 `Asia/Seoul`에 화면 방문과 무관하게 `asOfDate`, runId, page cursor를 전달합니다. Adapter는 날짜별 대상이나 금액을 계산하지 않습니다.
2. Application은 `(status=active OR status=recovering-before-stop) AND nextDueDate<=asOfDate`인 Plan만 `(nextDueDate ASC, planId ASC)`의 결정적 cursor page로 조회합니다. 복구 상태는 `stopEffectiveAt`보다 앞서 도래한 due만 허용합니다.
3. 각 Plan은 `nextDueDate`부터 기준일까지 도래한 월을 오래된 순서로 평가합니다. 매 targetMonth에는 effectiveDate에 유효했던 Plan revision을 사용합니다.
4. due인 월만 5.3 Workflow로 독립 처리합니다. execution 생성과 Asset 변경이 성공한 같은 UoW에서 Plan의 `nextDueDate`를 다음 달 유효일로 전진시킵니다.
5. retryable 실패는 `nextDueDate`를 그대로 두고 같은 occurrence의 제한된 재시도 또는 다음 날 due query에서 다시 선택합니다. 이미 성공한 execution은 create-only key로 `AlreadyProcessed`가 되어 중복 반영되지 않습니다.
6. 잘못된 설정은 임의 보정하거나 완료하지 않고 Plan을 `needs-attention`으로 격리하며, 수정 Command가 유효 revision을 추가하면 기존 due 날짜부터 다시 평가합니다.
7. 대상별 `applied/alreadyApplied/unsupported/needsAttention/retryable/permanent`를 집계합니다. 한 run의 page·deadline을 넘은 누락 월은 checkpoint 뒤에서 후속 run이 이어가며 제품 기간 상한으로 버리지 않습니다.

여러 자산을 한 transaction으로 묶지 않습니다. 일부 실패는 `PartialFailure`이며 성공 execution을 rollback하거나 다시 적용하지 않습니다.

### 5.6 수동 영구 purge participant

`PurgeAssetAutomationParticipant`는 일반 자산 삭제 경로에서 호출되지 않습니다. 수동 `AssetPurgeProcess`에서만 Core의 `purging` 상태와 process·asset 일치를 확인하고, 해당 assetId의 Plan·Revision·Execution을 `(dataKind ASC, stableId ASC)` 결정 순서로 page 삭제합니다. 한 page 삭제와 purge receipt를 같은 UoW로 commit하고 같은 process/cursor 재호출은 최초 결과를 재생합니다. 논리 삭제 상태에서는 Plan·Revision·Execution을 그대로 보존하며 일일 due job은 `PortfolioAssetAutomationPort`의 lifecycle 결과로 대상 Asset을 건너뜁니다.

## 6. Port 설계

### 6.1 transaction participant

```text
AutomationChangeIntent =
  executionKey
  expectedPlanVersion
  planCheckpointChange
  balanceDelta
  operation + targetMonth + effectiveDate
  automationEventDraft
```

`AutomationExecutionParticipant.prepare(...)`는 위 intent 또는 typed evaluation을 반환하고 저장하지 않습니다. `ApplyAssetAutomationWorkflow`가 이를 Portfolio Core `AssetAutomationParticipant`의 Asset intent와 결합하며, 유일한 commit Port는 `PortfolioAutomationUnitOfWork`입니다.

### 6.2 Output Port

| Port | 책임 | 주요 fixture |
|---|---|---|
| `AutomationPlanRepository` | active·중지 전 복구 상태이면서 `nextDueDate<=asOfDate`인 Plan page, revision·version load | due query ordering, stop 경계, overdue, revision boundary, version conflict, legacy mapping |
| `AutomationExecutionRepository` | 결정 execution claim 조회 | absent, existing, concurrent claim |
| `PortfolioAssetAutomationPort` | Asset lifecycle·snapshot 조회와 Core participant 제공 | active, deleted, purging, wrong type, version conflict |
| `PortfolioAutomationUnitOfWork` | Plan/execution + Asset + receipt + Outbox 원자 commit | callback 2회, claim 경합, rollback |
| `AutomationPurgePageUnitOfWork` | 한 Asset의 Plan·Revision·Execution page 삭제와 purge receipt 원자 commit | replay, page 중간 실패, 타 Asset 혼입 거부 |
| `Clock` | 서울 LocalDate·YearMonth | 월말, 윤년, 자정 경계 |
| `JobResultSink`, `ObservabilityPort` | 대상별 실행 결과·metric | 부분 실패, retry checkpoint |
| `OutboxAppendPort`, `HashPort` | 공통 Event·payload hash | 중복 append, 같은/다른 payload |

`FirstAutomationMonthPolicy`와 대출 계산은 순수 Domain Policy이므로 Output Port가 아닙니다. 정책 구현은 생성자 주입 가능한 Domain 전략으로 두되 Firebase·UI에 의존하지 않습니다.

## 7. 저장·트랜잭션·동시성

### 7.1 목표 저장 모델

| 논리 데이터 | 목표 key | Writer | 동시성 |
|---|---|---|---|
| AssetAutomationPlan | `households/{householdId}/assetAutomationPlans/{assetId_operation}` | Automation | `aggregateVersion`, status+nextDueDate index |
| AutomationPlanRevision | `households/{householdId}/assetAutomationPlanRevisions/{planId_revision}` | Automation | create-only revision, effectiveFrom ordering |
| AutomationExecution | `households/{householdId}/assetAutomationExecutions/{executionKeyHash}` | Apply Workflow | create-only 결정 claim |
| command receipt | Portfolio Context receipt | Apply Workflow | idempotency key + payload hash |

논리 execution key는 `householdId:assetId:operation:YYYY-MM`이며 저장 ID에는 versioned hash를 사용할 수 있습니다. 원문 key 필드는 서버 전용 문서에 household scope와 함께 보존합니다. Execution에는 applied delta, effective date, resulting Asset version, commandId, createdAt을 기록합니다.

Plan·Revision·Execution의 Canonical Writer는 Automation이지만 Context UoW Adapter가 Plan checkpoint·Execution과 Asset을 같은 transaction에 물리 write합니다. 이는 공동 소유가 아니라 명시적 Workflow commit입니다. Asset 문서를 Automation Repository로 노출하지 않습니다. `nextDueDate`는 execution 없는 월을 건너뛰어 전진할 수 없으며, 이 불변식 덕분에 일일 job이 전체 execution history를 scan하지 않아도 가장 오래된 누락 월을 찾습니다.

동시에 다른 idempotency key로 같은 월을 처리하면 create-only execution claim 하나만 성공합니다. 패자는 transaction 재조회 후 `AlreadyProcessed`를 반환합니다. 같은 key의 다른 payload는 receipt hash로 `Conflict`입니다.

### 7.2 legacy 전환

현재 `assets`의 `recurringContribution*`, `loan*`, `lastAuto*Month`는 Legacy Mapper가 Plan·Revision·Execution view로 변환합니다. 전환 순서는 다음과 같습니다.

1. legacy 필드를 읽는 Adapter 뒤에서 새 Domain Policy를 실행합니다.
2. 화면 방문 호출과 Scheduler 호출을 같은 Application Port로 연결합니다.
3. 신규 execution claim을 별도 문서로 쓰고 기존 last month와 결과를 shadow 비교합니다.
4. Plan V2 backfill 시 자산별 설정·처리 월 hash를 검증합니다.
5. Read 전환 뒤 `assets`의 자동화 필드 write를 차단하고 호환 필드를 제거합니다.

현재 Functions production binding은 canonical `assetAutomationPlans`를
`(nextDueDate ASC, document path ASC)`로 조회하고, target 월의
`assetAutomationPlanRevisions`를 transaction 안에서 다시 선택합니다. 같은
transaction에서 canonical Asset, 결정 execution claim, receipt, 두 Outbox와
전환 기간의 legacy Asset read projection을 함께 갱신합니다. 따라서 배포 전에
기존 legacy `assets`의 자동화 설정·last month를 Plan/Revision으로 변환하는
backfill과 건수·hash reconciliation을 완료해야 합니다. Scheduler가 legacy
Asset 전체를 매일 scan하며 묵시적으로 backfill하지는 않습니다.

### 7.3 production Scheduler binding

- Firebase export: `assetAutomationDaily`
- cron/timezone: `0 0 * * *`, `Asia/Seoul`
- Application: `createAssetAutomationScheduledApplication`
- Firestore Adapter: `FirebaseAssetAutomationRuntimeStore`
- page cursor: versioned base64url `{nextDueDate, documentPath}`
- 한 outer page는 한 Plan의 가장 오래된 월부터 최대 manifest `pageSize`개를
  처리합니다. 여전히 due이면 갱신된 `nextDueDate`가 cursor 뒤에 다시 나타나
  다음 page에서 이어지고, runtime deadline을 넘으면 공통 JobRun checkpoint에서
  다음 invocation이 재개합니다.

## 8. Event·Projection·외부 연동

### 8.1 Event

`AssetAutomationApplied.v1`은 Automation이 단독 생산합니다. payload는 `assetId`, operation, targetMonth, effectiveDate, appliedAmount, executionId, resultingAssetVersion만 포함합니다. 계좌 이름·메모·금리 전체 설정은 넣지 않습니다.

같은 UoW에서 Portfolio Core가 `AssetValuationChanged.v1`을 생산합니다. 두 Event는 commit 이후 Reporting, Snapshot, 운영 관측용이며 execution이나 Asset 변경을 나중에 완성하는 용도가 아닙니다.

Consumer는 `(eventId, handlerName)`으로 중복을 막고 Asset version 순서를 검사합니다. Outbox 전달 실패 시 execution과 Asset 상태는 완료되어 있으며 downstream만 재시도합니다.

### 8.2 외부 연동

이 모듈에는 은행·시장 HTTP Port가 없습니다. Scheduler는 inbound Adapter이고, retry executor·job result·관측만 Operations Output Port로 사용합니다. Scheduler cron을 바꾸어도 Domain due 계산과 execution key는 변하지 않습니다.

AssetSnapshot은 이 모듈이 직접 기록하지 않습니다. `AssetValuationChanged.v1` 이후 Portfolio Core의 `AssetSnapshotProjector`가 확정된 Portfolio Query로 멱등 upsert합니다.

## 9. 오류·보안·관측성

### 9.1 안정 오류 코드

| typed Result | 주요 code |
|---|---|
| `ValidationError` | `INVALID_AUTOMATION_AMOUNT`, `INVALID_PAYMENT_DAY`, `INVALID_INTEREST_RATE`, `INVALID_TARGET_MONTH`, `PLAN_ASSET_TYPE_MISMATCH` |
| `Forbidden` | `HOUSEHOLD_SCOPE_MISMATCH`, `AUTOMATION_WRITE_FORBIDDEN`, `AUTOMATION_JOB_FORBIDDEN` |
| `NotFound` | `ASSET_NOT_FOUND`, `AUTOMATION_PLAN_NOT_FOUND` |
| `Conflict` | `PLAN_VERSION_MISMATCH`, `ASSET_VERSION_MISMATCH`, `IDEMPOTENCY_PAYLOAD_MISMATCH` |
| `AlreadyProcessed` | existing executionId |
| `RetryableFailure` | `UOW_RETRY_EXHAUSTED`, `JOB_CHECKPOINT_RETRYABLE` |
| `PartialFailure` | operation별 result와 retry key |

`bullet`과 아직 미도래는 오류 문자열이 아니라 안정적인 evaluation status입니다.

### 9.2 보안

- Plan 설정·실행·조회는 모두 membership과 household scope를 확인합니다.
- 일반 클라이언트는 execution claim, receipt, job checkpoint를 직접 읽거나 쓰지 못합니다.
- 사용자가 assetId와 targetMonth를 바꾸어 타 가구·과거 전체 실행을 요청해도 변경 없이 거부합니다.
- Admin SDK Adapter도 `ActorContext` 검증을 생략하지 않습니다.

### 9.3 관측성

구조화 log에는 commandId, runId, assetId, operation, targetMonth, result code, attempt, duration, executionId를 기록합니다. 자산 이름, 메모와 전체 대출 조건은 기록하지 않습니다. metric은 due/applied/alreadyApplied/notDue/unsupported/needsConfirmation, claim conflict, UoW retry, page lag를 구분합니다.

## 10. 목표 패키지 구조

```text
functions/src/contexts/portfolio/automation/            # 목표
  domain/
    entities/asset-automation-plan.ts
    value-objects/year-month.ts
    value-objects/payment-day.ts
    policies/effective-payment-date-policy.ts
    policies/savings-contribution-policy.ts
    policies/loan-principal-payment-policy.ts
    policies/first-automation-month-policy.ts
  application/
    commands/configure-asset-automation.ts
    commands/run-contribution.ts
    commands/run-repayment.ts
    queries/evaluate-automation-month.ts
    workflows/run-monthly-asset-automation.ts
    participants/automation-execution-participant.ts
    participants/purge-asset-automation-participant.ts
    ports/in/
    ports/out/
  adapters/out/firestore/
  adapters/out/legacy/
  public.ts

functions/src/contexts/portfolio/workflows/             # 목표
  apply-asset-automation/
    apply-asset-automation-workflow.ts
    portfolio-automation-unit-of-work.ts

web/src/features/portfolio/automation/                   # 목표
  adapters/functions-api/
  presentation/
```

Domain은 Firebase, React, Scheduler SDK와 Portfolio Core Entity를 import하지 않습니다. `public.ts`는 Input Port, DTO·Read Model, Event schema와 안정 오류 code만 export합니다.

## 11. 테스트 설계

| 요구사항 ID | 테스트 수준 | 테스트 대상 | 핵심 fixture/경계값 | 관찰 결과 | Canonical 테스트 ID |
|---|---|---|---|---|---|
| AUTO-001 | Domain Unit, Application, Emulator | effective date·납입 Policy·Apply Workflow | 31일/평년·윤년 2월, 납입일 전, deleted·purging, 0원, 동일 월 동시 2회 | 말일에 한 번만 +amount; 부적격은 write 없음; claim 하나 | T-AUTO-001 |
| AUTO-002 | Domain Unit, Contract | `FirstAutomationMonthPolicy` | 신규 자산과 기존 자산의 firstActivatedOn이 실행일 이전·당일·이후, 적금·대출, 월말 보정 | 이전·당일은 당월 적용; 이후는 delta 0으로 활성화 월 포함 표시하고 다음 달 first month 저장; 활성화 전 월 제외 | T-AUTO-002 |
| LOAN-001 | Domain Unit | `LoanPrincipalPaymentPolicy` | 원금 100/월 120, 원리금·금리 0/소수, 이자가 납입액 초과, 잔액 0 | 현재 round 공식, principal≤balance, 결과 0 이상 | T-LOAN-001 |
| LOAN-002 | Domain Unit, Application, Emulator | 대출 평가·Apply Workflow | equal principal, amortized, bullet, invalid rate/day/payment, 이미 처리 | 지원 방식만 due; bullet status; 잘못된 plan 오류; 월 claim 한 개 | T-LOAN-002 |
| AUTO-003 | Domain Unit, Application, Emulator, 보안 E2E | due Plan query·일일 job·운영 복구 participant·receipt·checkpoint | 3월 18일 due, 18·19일 실패/20일 성공, 여러 달 overdue, deleted 3월 20일과 운영 복구 5월 17·18·19일, 일반 사용자 Actor, callback 2회, revision 변경 경계 | due Plan만 조회, 성공 뒤에만 nextDueDate 전진, 일반 복구 0건, 삭제 전 overdue 보존·삭제 기간 제외·복구일 기준 재개, 월 claim 하나, 과거 execution 불변 | T-AUTO-003 |

추가 공통 suite는 새 테스트 ID 없이 다음을 검증합니다.

- 동일 idempotency key의 동일/상이 payload 결과 재생·Conflict
- 서로 다른 key의 같은 execution을 동시 실행해 claim 한 개와 `AlreadyProcessed` 하나
- Fake와 Firestore Plan/Execution Adapter의 동일 Conformance Suite
- 가구 A Actor의 가구 B 자동화 요청 변경 없음; 보안 Canonical은 [공통 보안 테스트](../../../../cross-cutting/security-privacy.md)에 연결
- `AssetAutomationApplied.v1` 중복·역순 전달과 Snapshot/Reporting 수렴
- DEC-017 논리 삭제에서는 Plan·Revision·Execution write 0건이고, 운영 복구 Workflow에서만 resume revision을 추가하며 일반 사용자 요청은 모든 write 0건입니다. 수동 purge에서는 해당 assetId page만 삭제하며 receipt replay가 동일합니다.
- Plan 변경 직전 이미 due인 누락 월은 이전 effective revision, 변경 뒤 처음 도래하는 월은 새 revision을 사용하며 비활성·삭제 이후 due는 생성하지 않음
- retryable 실패·Scheduler Missing·Overdue에서는 nextDueDate가 보존되고 다음 성공 run이 같은 월을 한 번만 반영

## 12. 확정 정책과 구현 순서

### 12.1 확정 정책

1. [DEC-052](../../../../governance/decisions.md#dec-052)에 따라 Scheduler는 매일 00:00 due Plan만 조회하고 `nextDueDate`를 성공 뒤에만 전진시킵니다. 누락 월은 기간 제한 없이 오래된 순서로 복구하며 과거 execution은 자동 재계산하지 않습니다.
2. [DEC-046](../../../../governance/decisions.md#dec-046)에 따라 AutomationExecution과 Plan revision에는 시간 TTL을 두지 않습니다. Plan 비활성·삭제와 Asset 논리 삭제·복구로 지우지 않고 관련 Asset 또는 가구의 수동 영구 purge에서 소유 participant만 제거합니다.
3. [DEC-017](../../../../governance/decisions.md#dec-017)에 따라 Asset 복구는 관리자·승인된 운영 주체만 실행하고, [DEC-052](../../../../governance/decisions.md#dec-052)에 따라 삭제 기간은 소급하지 않으며 복구일 이후 최초 실행일부터 재개합니다.

### 12.2 구현 순서

1. 날짜·납입·대출 계산을 Framework 밖으로 옮기고 `T-AUTO-001`, `T-LOAN-001` 특성화 테스트를 고정합니다.
2. `FirstAutomationMonthPolicy`의 신규·기존 자산 firstActivatedOn 실행일 이전·당일·이후 fixture와 현재 잔액 포함 execution을 구현합니다.
3. Plan·Revision·Execution Repository Fake와 Conformance Suite를 작성합니다.
4. `AutomationExecutionParticipant`와 Portfolio Core participant 계약을 작성한 뒤 `ApplyAssetAutomationWorkflow` 경합·rollback 테스트를 활성화합니다.
5. `nextDueDate`·effective revision을 가진 V2 Plan과 due-plan index를 backfill하고 legacy last month와 누락 없는지 검증합니다.
6. 매일 00:00 Scheduler를 `ProcessDueAssetAutomation`에 연결하고 화면 방문 자동 처리 호출을 제거합니다.
7. Writer를 V2 Plan·Revision·Execution으로 전환하고 `assets` 혼합 필드 write를 차단합니다.
8. 신규 생성 flow의 DEC-011, 일일 복구 DEC-052, 운영 전용 자산 복구의 `T-AUTO-003` 목표 테스트를 활성화합니다.
