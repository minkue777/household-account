# 배당 모듈 상세 설계

> 소유 요구사항: [배당 모듈 요구사항](requirements.md) (`DIV-*`, `JOB-DIV-*`)  
> 상위 경계: [Portfolio Bounded Context](../../requirements.md)  
> 공통 계약: [모듈 상세 설계 규약](../../../../governance/module-design-standard.md)  
> 목표 구조: [목표 Clean Architecture 설계](../../../../../architecture/target-clean-architecture.md)

## 1. 설계 목적과 추적성

이 문서는 공시를 결정적 `DividendEvent`로 바꾸고 `announced → fixed → paid` 상태를 강제하며, 원천 Event에서 연간 12개월 Projection을 멱등 재구축하는 계약을 정의합니다. KRX ETF 공시 discovery와 이미 저장된 nonterminal Event lifecycle sweep을 분리하고, 기준일 적격 수량은 Holdings의 공개 Position history Query만 사용하며 Position Repository나 Provider DTO에 직접 의존하지 않습니다.

공통 `CommandEnvelope`, `ActorContext`, typed Result, receipt·Outbox·Inbox 형식은 [모듈 상세 설계 규약](../../../../governance/module-design-standard.md)을 사용합니다. [DEC-014](../../../../governance/decisions.md#dec-014)의 최근접 snapshot·이전 날짜 동률 우선 규칙은 `DividendEligibilityRecoveryPolicy`에 고정합니다. 추가 근거는 [배당 종단 흐름](../../../../system/flows.md), [데이터 소유권](../../../../cross-cutting/data-ownership.md), [보안 경계](../../../../cross-cutting/security-privacy.md), [테스트 전략](../../../../governance/test-strategy.md)입니다.

## 2. 모듈 경계와 책임

이 모듈이 소유합니다.

- 공급자 중립 `DividendDisclosure` 계약과 결정적 Dividend Event 식별 정책
- `DividendEvent`의 announced·fixed·paid 상태, 적격 수량과 총 배당액
- 기준일 이후 누락 복구를 선택하는 `DividendEligibilityRecoveryPolicy`
- 연도별 12개월 `AnnualDividendProjection` schema, 단일 Projector와 rebuild
- 발표 상태 예상 배당 계산과 확정 Event 중복 제외
- 명시 분류된 KRX ETF의 최근 1년 공시 discovery와 저장된 nonterminal Event lifecycle sweep을 분리한 Application job
- `DividendEventChanged.v1`·`DividendEventRemoved.v1`의 단일 producer

이 모듈이 소유하지 않습니다.

- Position CRUD·현재/과거 수량 저장: [보유종목·시장 데이터](../holdings-market-data/requirements.md)
- AssetAccount와 자산 Snapshot: [자산 포트폴리오](../portfolio/requirements.md)
- KIND HTTP·HTML DTO, timeout·공통 retry runtime: [외부 운영](../../../../supporting-platform/modules/external-operations/requirements.md)
- 세금, 외화 환산, 증권사 입금 대사와 차트 표현

KIND Adapter는 이 모듈이 정의한 `DividendDisclosurePort`를 구현합니다. Dividends는 Holdings의 `ListHoldings`, `QueryPositionHistory` 공개 Query Port만 사용하며 Holdings Repository·Firestore path·Domain Entity를 import하지 않습니다.

[DEC-017](../../../../governance/decisions.md#dec-017)에 따라 공시 discovery와 신규 기여분 계산 전에 Portfolio Core의 최소 Asset lifecycle Query로 active 여부를 확인합니다. deleted Asset에서는 새 공시 Event를 만들지 않지만 기존 DividendEvent와 Projection 원천은 보존합니다. [DEC-043](../../../../governance/decisions.md#dec-043)에 따라 기존 nonterminal Event의 lifecycle은 모든 source Asset·Holding이 삭제되어도 보존된 Event와 Position history로 계속하며, 지급 전 명시적 공시 취소만 Event를 제거합니다. `paid` Event는 이후 정정·취소·Asset 영구 purge에도 수정·삭제하지 않습니다.

## 3. 공개 계약

### 3.1 공개 DTO

```ts
interface DividendInstrumentRefV1 {
  market: 'KRX';
  instrumentType: 'ETF';
  code: string;
  name: string;
  currency: 'KRW';
}

interface DividendDisclosureV1 {
  instrument: DividendInstrumentRefV1;
  source: 'KIND';
  sourceDisclosureId: string;
  correctsSourceDisclosureId?: string;
  disclosureState: 'active' | 'cancelled';
  recordDate: string;
  paymentDate: string;
  perShareAmount: number;
  disclosedAt: string;
  sourceReferenceHash: string;
}

type DividendStatusV1 = 'announced' | 'fixed' | 'paid';

interface DividendEventReadModelV1 {
  schemaVersion: 1;
  eventId: string;
  householdId: string;
  source: 'KIND';
  sourceDisclosureId: string;
  instrument: DividendInstrumentRefV1;
  recordDate: string;
  paymentDate: string;
  perShareAmount: number;
  status: DividendStatusV1;
  eligibleQuantity?: number;
  eligibilityContributions?: readonly {
    assetId: string;
    quantity: number;
    kind: 'record-date-position' | 'nearest-position-snapshot';
    snapshotDate: string;
    sourceVersion: string;
  }[];
  totalAmount?: number;
  paidAt?: string;
  aggregateVersion: number;
  updatedAt: string;
}

interface AnnualDividendViewV1 {
  schemaVersion: 1;
  householdId: string;
  year: number;
  monthlyAmounts: readonly number[]; // 정확히 12개
  events: Readonly<Record<string, DividendEventReadModelV1>>; // key === value.eventId
  sourceCheckpoint: string;
  lastEventId?: string;
  updatedAt: string;
  freshness: 'fresh' | 'stale' | 'rebuilding';
}

type DividendRefreshTargetRefV1 =
  | { kind: 'INSTRUMENT'; instrumentCode: string }
  | { kind: 'EVENT'; eventId: string };

type RefreshDividendPagePayloadV1 =
  | {
      phase: 'DISCOVERY';
      runId: string;
      periodFrom: string;
      periodTo: string;
      cursor?: string;
      pageSize: number;
    }
  | {
      phase: 'LIFECYCLE_SWEEP';
      runId: string;
      asOf: string;
      cursor?: string;
      pageSize: number;
    };

interface RefreshDividendPageResultV1 {
  phase: 'DISCOVERY' | 'LIFECYCLE_SWEEP';
  runId: string;
  nextCursor?: string;
  completed: boolean;
  succeeded: readonly { target: DividendRefreshTargetRefV1; changedEventIds: readonly string[] }[];
  noData: readonly { target: DividendRefreshTargetRefV1; code: string }[];
  retryableFailed: readonly { target: DividendRefreshTargetRefV1; code: string; retryKey: string }[];
  permanentFailed: readonly { target: DividendRefreshTargetRefV1; code: string }[];
  needsConfirmationEventIds: readonly string[];
  eventCounts: {
    created: number;
    changed: number;
    deleted: number;
    unchanged: number;
  };
  projectionStatus: 'queued' | 'up-to-date' | 'retryable-failure';
}

interface DividendEventPageV1 {
  items: readonly DividendEventReadModelV1[];
  nextCursor?: string;
}

interface UpcomingDividendViewV1 {
  asOf: string;
  items: readonly {
    eventId: string;
    instrument: DividendInstrumentRefV1;
    recordDate: string;
    paymentDate: string;
    estimatedQuantity: number;
    estimatedAmount: number;
  }[];
  calculatedAt: string;
}
```

날짜는 `Asia/Seoul` LocalDate, 금액은 유한한 0 이상의 원 단위 수입니다. `totalAmount = Math.round(perShareAmount × eligibleQuantity)`로 현재 원 단위 반올림을 유지합니다. `sourceDisclosureId`는 Provider가 부여한 안정 공시 식별자의 정규화 값이고 `correctsSourceDisclosureId`는 Provider가 명시한 정정 연결만 담습니다. Provider 원문 HTML은 DTO에 넣지 않고 비가역 reference hash만 선택적으로 보존합니다.

### 3.2 Input Port

| 이름·종류 | 호출자 | 입력 | 결과 | 권한 | 일관성 | 멱등성 |
|---|---|---|---|---|---|---|
| `RefreshDividendEvents` Workflow | Scheduler Adapter | `CommandEnvelope<RefreshDividendPagePayloadV1>` | `Success<RefreshDividendPageResultV1>`, `PartialFailure`, `RetryableFailure` | `portfolio.job.dividend-refresh` SystemActor | Event별 transaction, page checkpoint | runId/page + Event 결정 ID |
| `AdvanceDividendStatus` Command | Refresh workflow, 제한된 운영 재실행 | eventId, asOf, expectedVersion | `Success<DividendEventReadModelV1>`, `ValidationError`, `Forbidden`, `NotFound`, `Conflict`, `AlreadyProcessed`, `NoData`, `RetryableFailure`, `ContractFailure` | `portfolio.dividend.advance` | DividendEvent + receipt + Outbox | envelope key + event/version |
| `RebuildAnnualDividend` Command | Projector 운영/복구 | householdId, year, source checkpoint | `Success<AnnualDividendViewV1>`, `RetryableFailure`, `ContractFailure` | `portfolio.dividend.projection.rebuild` SystemActor | Projection replace | household/year/checkpoint |
| `GetAnnualDividend` Query | Web, Reporting | householdId, year | `Success<AnnualDividendViewV1>`, `NoData`, `Forbidden` | `portfolio.dividend.read` | Projection 읽기 | 해당 없음 |
| `QueryDividendEvents` Query | Web, Reporting | year, status?, cursor | `Success<DividendEventPageV1>`, `NoData`, `Forbidden` | `portfolio.dividend.read` | Canonical 읽기 | 해당 없음 |
| `EstimateUpcomingDividends` Query | Web | householdId, asOf | `Success<UpcomingDividendViewV1>`, `Forbidden`, `NoData`, `RetryableFailure`, `ContractFailure` | `portfolio.dividend.read` | Holdings 공개 Query + Event 읽기 | 해당 없음 |

`CollectDividendDisclosures`와 `UpsertDividendAnnouncement`는 각각 Output Port 호출과 context-private Application 단계입니다. 기존 호출자가 있다면 `RefreshDividendEvents`로 변환하는 inbound Facade만 두고 신규 공개 API로 노출하지 않습니다.

`RefreshDividendPageResultV1`은 `phase`, `runId`, `nextCursor`, `completed`, instrument/Event별 `succeeded/noData/retryableFailed/permanentFailed`, `eventCounts`의 생성·변경·삭제·무변경 수, `projectionStatus: queued|up-to-date|retryable-failure`를 구분합니다. discovery의 빈 공시와 공급자 실패를 같은 결과로 합치지 않습니다. lifecycle sweep은 저장된 `sourceDisclosureId`로 현재 공시를 재확인할 수 있지만 실패·NoData를 취소로 해석하지 않고 마지막 성공 값으로 상태 전이를 계속합니다.

### 3.3 권한과 tenant

Capability 매핑은 Access가 소유합니다. Application은 Actor household, Event household, Query household를 비교합니다. Scheduler·Projector는 각 최소 System capability를 사용합니다. 일반 Web 사용자는 Event·Projection을 읽을 수 있어도 상태, 적격 수량, 연간 Projection을 직접 쓸 수 없습니다.

## 4. Domain 모델과 불변식

### 4.1 DividendEvent Aggregate

결정적 event ID는 정정 가능한 업무 값이 빠진 versioned canonical tuple의 hash입니다.

```text
eventIdentityVersion
householdId
source
sourceDisclosureId
```

동일 `source + sourceDisclosureId`는 공시를 여러 번 수집하거나 날짜·금액이 정정되어도 같은 Event를 가리킵니다. Provider가 정정 공시에 새 ID를 부여한 경우 `correctsSourceDisclosureId`가 기존 공시를 명시적으로 가리킬 때만 기존 eventId로 해석합니다. 연결 근거가 없는 새 ID를 종목·날짜·금액 유사성으로 합치지 않습니다. `instrument`, `recordDate`, `paymentDate`, `perShareAmount`, `sourceReferenceHash`는 identity가 아닙니다.

| 상태 | 필수 데이터 | 허용 전이 |
|---|---|---|
| `announced` | instrument, recordDate, paymentDate, perShareAmount | 자기 자신 no-op, `fixed` |
| `fixed` | announced 필드 + eligibleQuantity, evidence, totalAmount | 자기 자신 no-op, `paid` |
| `paid` | fixed 필드 + paidAt | 자기 자신 no-op; terminal |

일반 상태 전이의 역전과 paid→fixed는 `Conflict(INVALID_DIVIDEND_STATE_TRANSITION)`입니다. `asOf < recordDate`에는 announced를 유지합니다. `asOf >= paymentDate`여도 eligibility가 없으면 paid로 건너뛰지 않습니다.

`announced`와 `fixed`는 미지급 상태이므로 같은 공시의 최신 성공 disclosure로 현재 필드를 덮어씁니다. 이전 필드 값, revision 문서, superseding correction Event는 저장하지 않습니다. `fixed`의 기준일·주당금액이 바뀌면 새 Position history로 eligibleQuantity·evidence·totalAmount를 다시 계산한 뒤 전체 변경을 한 transaction으로 commit합니다. 재계산 실패 시 기존 Aggregate를 그대로 유지합니다. 명시적 `cancelled` disclosure는 미지급 Event를 삭제하지만 `paid`는 어떠한 정정·취소에도 불변입니다.

지연 실행에서 eligibility가 복구되면 Domain은 같은 transaction 안에서 announced→fixed, 이어서 fixed→paid를 순서대로 적용할 수 있습니다. 각 transition은 연속 aggregateVersion의 `DividendEventChanged.v1` draft를 만들며 Outbox 순서를 보존합니다.

`fixed` Event는 마지막으로 성공 반영된 eligibleQuantity, totalAmount, paymentDate를 가지므로 `asOf >= paymentDate` 판정에 Holding·Asset lifecycle·공시 Provider 성공을 요구하지 않습니다. 공시 재확인 실패 시에도 저장된 최신 성공 값과 Clock만으로 전이를 완료할 수 있어야 합니다.

### 4.2 적격 수량과 DEC-014 Policy

Holdings의 공개 `QueryPositionHistory(instrument, aroundDate=recordDate)`는 보존된 snapshot의 날짜·수량·source version을 반환합니다. 현재 Canonical Position도 조회 시점 날짜의 snapshot 후보로 변환할 수 있습니다. Dividends는 Position persistence DTO를 알지 않으며 다음 중립 결과만 소비합니다.

```text
Success<PositionQuantitySnapshotPage(items[{snapshotDate, quantity, observedAt, sourceVersion}], cursor?)>
NoData(reason)
RetryableFailure(code)
ContractFailure(code)
```

`DividendEligibilityRecoveryPolicy`는 snapshot 후보를 다음 순서로 하나 선택합니다.

1. `snapshotDate == recordDate`인 정확한 snapshot
2. 정확한 snapshot이 없으면 `abs(snapshotDate - recordDate)`가 최소인 snapshot
3. 최소 날짜 차이가 같은 후보가 둘 이상이면 `snapshotDate < recordDate`인 후보
4. 선택 날짜에 snapshot이 여러 개면 `observedAt`이 가장 늦은 후보를 사용하고, 시각도 같으면 source version으로 결정 정렬

결과는 다음으로 제한합니다.

```text
Eligible(quantity, evidence)
NoData(reason)
RetryableFailure(code)
ContractFailure(code)
```

[DEC-014](../../../../governance/decisions.md#dec-014)에 따라 정확한 snapshot은 `record-date-position`, 최근접 추정은 `nearest-position-snapshot` evidence로 Asset별 저장합니다. `eligibleQuantity`는 결정적으로 정렬된 `eligibilityContributions` 수량의 합이며 화면은 evidence 종류를 별도로 표시하지 않습니다. 선택 뒤 각 Asset 기여 수량과 totalAmount는 고정되어 이후 보유수량 변경이나 재실행으로 바뀌지 않습니다. 후보가 전혀 없거나 Query가 실패하면 0주로 변환하지 않습니다.

### 4.3 AnnualDividendProjection

- 월 배열은 index 0~11의 정확히 12개입니다.
- `fixed`, `paid` Event만 paymentDate의 월에 포함합니다.
- `events` map의 key는 반드시 Canonical `DividendEvent.eventId`와 같으며 code·paymentDate·perShareAmount로 별도 projection key를 만들지 않습니다.
- 같은 eventId가 정정되거나 fixed→paid로 바뀌어도 Event map의 값을 교체하므로 두 번 더하지 않습니다.
- 미지급 공시가 명시적으로 취소되어 Canonical Event가 삭제되면 map에서도 제거하고 월 합계를 다시 계산합니다.
- 월 합계는 Projection event map에서 매번 결정적으로 계산하여 내장 events와 불일치하지 않습니다.
- announced, 다른 연도, totalAmount가 없는 Event는 제외합니다.
- Canonical 신규 write는 잘못된 월·숫자를 거부합니다. Legacy read는 짧은 배열을 0으로 채우고 비정상 값을 0으로 정규화한 뒤 `freshness=stale`로 표시하여 rebuild 대상으로 만듭니다.

### 4.4 예상 배당 Policy

`asOf < recordDate`인 announced Event에 현재 Holdings 공개 Query의 수량과 perShareAmount를 곱합니다. 같은 안정 공시 ID의 Event가 이미 fixed/paid이면 예상에서 제외합니다. 예상액은 Canonical Event나 Annual Projection에 저장하지 않는 Read Model입니다.

## 5. Application Use Case 상세

공시 discovery와 announcement upsert의 신규 기여분은 active Asset만 대상으로 합니다. `AssetLifecycleQueryPort`가 deleted·purging을 반환한 Asset은 discovery에서 건너뛰며, 다른 active Asset의 같은 종목 기여분은 계속 처리합니다. lifecycle 조회 실패는 deleted로 추정하지 않고 retryable failure로 유지합니다. 이미 저장된 Event의 lifecycle sweep은 별도 page이며 discovery 성공 목록을 입력으로 사용하지 않습니다. 특히 fixed Event의 지급 전이는 Asset lifecycle을 조회하지 않습니다.

### 5.1 announcement upsert

1. Adapter가 Provider 응답을 `DividendDisclosureV1` 또는 실패 union으로 변환합니다.
2. Application이 DTO 날짜·금액·instrument·안정 공시 ID를 검증하고 결정 event ID를 계산합니다. `correctsSourceDisclosureId`가 있으면 해당 기존 Event를 명시적으로 조회해 같은 eventId에 연결합니다.
3. active 공시의 Event가 없으면 announced Aggregate를 만듭니다. 기존 Event가 `announced`면 현재 공시 필드를 교체하고, `fixed`면 기준일·주당금액 변경 여부에 따라 Position history를 다시 조회해 적격 수량·증거·총액까지 원자 교체합니다. 이전 공시 값은 저장하지 않습니다.
4. `disclosureState=cancelled`이면 미지급 Event를 삭제하고 제거 Event를 Outbox에 기록합니다. Event가 `paid`이면 정정·취소 모두 `AlreadyProcessed(PAID_DIVIDEND_IMMUTABLE)`로 무변경 종료합니다.
5. 같은 transaction에서 Event create/update/delete, command receipt, `DividendEventChanged.v1` 또는 `DividendEventRemoved.v1` Outbox를 commit합니다.
6. 동일 공시 재처리는 기존 typed 결과를 반환하고 새 문서나 revision을 만들지 않습니다.

Provider `NoData`는 Event를 삭제하지 않습니다. retryable·contract·invalid 실패도 기존 Event 상태를 바꾸지 않습니다. 명시적 공시 상태나 correction reference 없이 유사한 종목·날짜·금액만으로 기존 Event를 정정·취소하지 않습니다.

### 5.2 상태 전이

1. `AdvanceDividendStatus`가 tenant, capability, receipt, expected version을 확인합니다.
2. Event가 `fixed`이면 저장된 최신 성공 paymentDate와 `asOf`를 비교해 due Event를 paid로 전이합니다. 사전 공시 재확인이 실패하더라도 Holding·Asset lifecycle·Provider 성공을 전이 조건으로 요구하지 않습니다.
3. Event가 `announced`이고 `asOf >= recordDate`면 source Asset lifecycle과 무관하게 Holdings의 공개 Position history Query를 transaction 밖에서 호출해 기준일 주변의 모든 보존 후보 page를 결정적으로 수집합니다. 모든 source가 deleted·purging이어도 같은 절차를 사용합니다.
4. recovery policy가 정확한 snapshot 또는 최근접 snapshot을 `Eligible`로 선택하면 수량과 totalAmount를 고정합니다. 같은 실행에서 이미 지급일도 지났으면 이어서 paid로 전이할 수 있습니다.
5. Event 변경, receipt, 전이별 Outbox를 한 transaction으로 commit합니다.
6. commit 뒤에만 운영 결과를 기록하고 Projection 갱신은 durable Event consumer가 수행합니다.

Position history 후보 없음이나 Query 실패를 수량 0으로 바꾸지 않습니다. 이 경우 Event는 announced에 남고 `NoData` 또는 retryable/contract failure를 반환합니다.

### 5.3 일일 갱신 job

Scheduler Adapter는 `Asia/Seoul` cron `0 9-20 * * *`로 매일 09:00부터 20:00까지 매시 정각에 실행합니다. 각 시간 occurrence는 `scheduledFor`를 포함한 별도 runId를 가지며, 같은 occurrence 아래 두 phase를 각각 checkpoint로 실행합니다. 하루 12회 반복하더라도 canonical Event ID와 상태 전이 receipt로 같은 공시·상태를 중복 반영하지 않습니다. 17:30에 게시된 공시는 정상 경로에서 18:00 occurrence가 수집하고, 20:00 이후 게시분은 다음 날 09:00 occurrence가 수집합니다.

1. `DISCOVERY`는 Holdings의 공개 Query에서 `market=KRX && instrumentType=ETF`가 명시된 active instrument만 결정적 page로 읽습니다. `holdingType=stock`, 코드 형태나 종목명으로 ETF를 추정하지 않습니다.
2. discovery instrument별 `DividendDisclosurePort`를 transaction 밖에서 호출하고 성공 disclosure를 eventId별 upsert합니다. 결과는 성공, NoData, retryable, permanent로 집계합니다.
3. `LIFECYCLE_SWEEP`은 SystemActor가 DividendEvent Repository의 server-only index에서 전체 tenant의 `announced|fixed` Event를 `(householdId, status, dueDate, eventId)` 순서로 직접 page 조회합니다. 가구 목록을 현재 Holdings에서 만들거나 discovery 대상·Provider 성공 목록과 join하지 않습니다. 각 Event 처리 때 envelope household scope를 다시 고정합니다.
4. sweep은 저장된 `sourceDisclosureId`로 현재 공시를 best-effort 재확인해 성공한 정정·취소를 5.1 규칙으로 먼저 반영한 뒤 Event별 `AdvanceDividendStatus`를 호출합니다. Provider 실패·NoData는 Event를 삭제하지도 lifecycle을 막지도 않습니다. fixed는 현재 Holding이 없어도 지급일이면 paid로 진행하고, announced는 모든 source 삭제 여부와 무관하게 저장된 Event와 Position history로 복구를 시도합니다.
5. 두 phase는 각각 nextCursor·실패 child key·완료 여부를 저장합니다. 한 phase 또는 한 대상 실패가 다른 성공 Event를 rollback하지 않으며 재실행은 미완료 page만 수렴시킵니다.
6. 성공 Event의 Outbox가 Annual Projector와 Reporting에 전달됩니다.

전체 1년·전체 가구를 한 transaction에 넣지 않습니다. 한 instrument의 공시 실패가 다른 instrument의 성공 Event를 rollback하지 않으며 `PartialFailure`가 정확한 재시도 범위를 반환합니다.

### 5.4 Query와 예상액

`QueryDividendEvents`는 `(paymentDate ASC, eventId ASC)`와 opaque cursor를 사용합니다. `GetAnnualDividend`는 Projection metadata와 12개월 배열을 그대로 반환하며 “Projection 없음”을 12개 0으로 가장하지 않고 `NoData`로 구분합니다. Legacy 문서가 있으면 정규화 결과와 stale freshness를 명시합니다.

`EstimateUpcomingDividends`는 현재 Holdings 수량과 announced Event를 조합하는 CQRS Query이며 Position Repository를 직접 읽지 않습니다. Holdings 실패·NoData는 빈 예상액으로 축약하지 않습니다.

### 5.5 Asset 삭제와 과거 배당 보존

Asset 논리 삭제·복구·영구 purge는 Dividends Command나 Repository write를 유발하지 않습니다. 기존 DividendEvent와 Annual Projection은 원천 Asset이 없어져도 instrument·기준일·지급일·수량·금액만으로 조회 가능한 가구 금융 이력이며, 조회 중 AssetAccount 존재 여부를 다시 요구하지 않습니다. 특히 `paid` Event와 이미 반영된 월·연간 합계는 Asset 영구 purge 전후에 완전히 같아야 합니다. `sourceAssetIds`와 `eligibilityContributions`의 assetId는 과거 계산 근거인 안정 식별자로 남기며 화면 표시를 위해 삭제된 Asset을 join하지 않습니다.

## 6. Port 설계

### 6.1 Input·Output Port

| Port | 방향 | 책임 | 주요 fixture |
|---|---|---|---|
| `DividendEventRepository` | Output | 결정 ID load/save, version precondition, year query, nonterminal due page | absent/existing, 경합, announced/fixed page, Holding 없는 fixed |
| `AnnualDividendProjectionRepository` | Output | Projector 전용 replace/upsert, Query | 짧은 legacy 배열, stale, rebuild |
| `DividendCommandUnitOfWork` | Output | Event + receipt + Outbox 원자 commit | callback 2회, rollback, 두 transition 순서 |
| `DividendDisclosurePort` | Output | 최근 기간의 공급자 중립 공시 조회 | 성공, NoData, timeout, schema drift, invalid date/amount |
| `HoldingsQueryPort` | Output | Holdings의 명시적 market·instrumentType 분류가 있는 `ListHoldings` 공개 Query 호출 | KRX ETF, 국내 개별주식, US stock, 분류 없음, page, tenant failure |
| `PositionHistoryQueryPort` | Output | Holdings `QueryPositionHistory` 공개 Query 호출 | exact, 이전·이후 동률, page 경계, NoData, stale/contract, retryable |
| `AssetLifecycleQueryPort` | Output | Portfolio Core의 최소 active/deleted/purging 조회 | active, deleted, purging, NotFound, retryable |
| `AnnualDividendProjectorInput` | context-private Input | Event handle·전체 rebuild | duplicate, reverse order, checkpoint gap |
| `InboxClaimPort`, `OutboxAppendPort` | Output | 멱등 소비·발행 | duplicate, lease failure |
| `Clock`, `HashPort`, `JobResultSink`, `ObservabilityPort` | Output | 서울 날짜, 결정 ID, job·metric | timezone boundary, partial failure |

`PositionHistoryQueryPort`와 `HoldingsQueryPort` Adapter는 Holdings의 `public.ts`만 import합니다. `stock_holdings` collection, Holdings Repository, Position Entity를 참조하는 구현은 architecture test에서 금지합니다. Dividends가 code 정규식이나 이름 suffix로 KRX ETF 여부를 다시 추론하는 것도 금지합니다.

`DividendDisclosurePort`는 Dividends가 정의하고 Market Data/KIND Adapter가 구현합니다. Adapter의 HTML selector, acceptance number와 raw DTO는 Port 바깥으로 나오지 않습니다.

KIND 검색 결과의 접수번호는 서로 달라도 viewer에서 같은 공시 문서 번호를 가리킬 수 있습니다. 따라서 Adapter는 검색 접수번호를 조회용 alias로만 사용하고, viewer가 반환한 KIND document number를 안정적인 `sourceDisclosureId`로 정규화합니다. 같은 document number가 여러 검색 행에서 발견되면 공시 한 건으로 수렴하며, 정정된 기준일·지급일·금액은 같은 Event의 현재 값만 교체하고 과거 revision 문서를 만들지 않습니다.

## 7. 저장·트랜잭션·동시성

### 7.1 목표 저장 모델

| 논리 데이터 | 목표 key | Writer | 동시성·멱등성 |
|---|---|---|---|
| DividendEvent | `households/{householdId}/dividendEvents/{eventId}` | Dividends | 결정 ID + aggregateVersion |
| AnnualDividendProjection | `households/{householdId}/dividendAnnualViews/{year}` | AnnualDividendProjector | sourceCheckpoint + lastEventId |
| command receipt | Portfolio Context receipt | Dividends Application | key + payload hash |
| Inbox receipt | handler/event key | Annual Projector | `(eventId, handlerName)` |

DividendEvent에는 `schemaVersion`, identityVersion, `source`, `sourceDisclosureId`, 현재 공시 필드, server timestamps, aggregateVersion을 둡니다. 정정 이전 값이나 revision collection은 두지 않습니다. Event state 변경·정정·삭제와 receipt, Outbox는 같은 transaction입니다. Projection은 별도 transaction에서 Inbox claim과 projection replace/checkpoint를 함께 commit하며 `events[eventId]`의 key와 value.eventId가 다르면 commit을 거부합니다.

DividendEvent는 내부적으로 공시를 발견한 `sourceAssetIds`와 fixed 시점의 `eligibilityContributions[{assetId, quantity, evidence}]`를 결정 순서로 보존합니다. 이는 같은 종목을 여러 Asset에서 보유할 때 논리 삭제가 다른 Asset의 신규 배당 처리를 막지 않게 하고, 원천 Asset이 나중에 없어져도 당시 배당 계산 근거를 재현할 수 있게 하는 역사 정보입니다.

같은 공시가 동시에 두 번 들어오면 결정 ID document create/update 경합으로 하나만 생성됩니다. 같은 상태 전이 재요청은 stored result 또는 `AlreadyProcessed(eventId)`를 반환합니다. expected version이 다르면 lost update 없이 `Conflict(DIVIDEND_VERSION_MISMATCH)`입니다.

### 7.2 Projection 재구축

Rebuild는 해당 household·year의 Canonical fixed/paid Event를 결정적 page로 읽어 event map과 monthly amounts를 새로 만들고 최종 checkpoint에서 Projection 전체를 교체합니다. 기존 Projection map과 merge하여 사라진 Event를 보존하지 않습니다. 중간 실패는 이전 완성 Projection을 유지하고 staging/checkpoint에서 재개합니다.

### 7.3 legacy 전환

1. Legacy Adapter로 현재 `dividend_events`, `dividend_snapshots`를 읽고 상태 `recorded`가 있으면 evidence가 있는 fixed 후보로 명시 변환합니다.
2. Functions Writer를 새 Application/UoW 뒤로 옮깁니다.
3. Web save route와 dormant 서비스 write를 차단하고 read-only 호환만 둡니다.
4. Event 수, event ID hash, 상태별 totalAmount, 연도·월 합계를 비교합니다.
5. V2 Projection rebuild와 shadow query가 일치한 뒤 Read를 전환하고 legacy Writer를 제거합니다.

## 8. Event·Projection·외부 연동

### 8.1 `DividendEventChanged.v1`·`DividendEventRemoved.v1`

producer는 Dividends 하나입니다. Changed payload는 `eventId`, instrument ref, recordDate, paymentDate, previous/current status, eligibleQuantity, totalAmount, eligibility evidence kind와 aggregateVersion을 포함합니다. Removed payload는 `eventId`, 마지막 paymentYear와 removal reason만 포함해 Projector가 항목을 제거하게 합니다. 정정 전 공시 값은 Event payload나 별도 revision으로 보관하지 않습니다. householdId는 envelope에 있고 Provider 원문·사용자 이름은 넣지 않습니다.

전달은 at-least-once입니다. 상태를 두 단계 진행한 transaction은 version 순서의 Event 두 개를 append합니다. Consumer가 gap 또는 역순을 발견하면 이후 Event를 임의 적용하지 않고 Event Query 기반 rebuild를 요청합니다.

### 8.2 AnnualDividendProjector

- source: `DividendEventChanged.v1`, `DividendEventRemoved.v1`
- 단일 Writer: `AnnualDividendProjector`
- key: `(householdId, paymentYear)`
- 중복: Inbox key로 no-op
- 상태 변경: Canonical eventId와 정확히 같은 map key의 값을 교체하고 12개월 합계를 전체 재계산
- 정정: 같은 eventId 값을 교체하고 전체 월 합계를 재계산
- 지급 전 명시적 취소: Removed Event로 map에서 제거하고 전체 월 합계를 재계산
- freshness: sourceCheckpoint, lastEventId, updatedAt, `fresh|stale|rebuilding`

Reporting은 공개 Event·Projection만 소비하고 `dividendAnnualViews`를 직접 쓰지 않습니다.

### 8.3 Provider 실패

`DividendDisclosurePort`는 `Success<disclosures>`, `NoData`, `RetryableFailure`, `ContractFailure`, 내부 `InvalidData`를 구분합니다. HTML selector 변경은 빈 성공이 아니라 ContractFailure입니다. HTTP 429·5xx·timeout은 RetryableFailure, 정상 응답에 대상 공시가 없음은 NoData입니다. 일부 공시 detail만 실패하면 성공 disclosure와 실패 reference를 모두 가진 `PartialFailure`로 보존합니다.

## 9. 오류·보안·관측성

### 9.1 안정 오류 코드

| typed Result | 주요 code |
|---|---|
| `ValidationError` | `INVALID_DISCLOSURE_DATE`, `INVALID_PER_SHARE_AMOUNT`, `INVALID_INSTRUMENT`, `INSTRUMENT_NOT_KRX_ETF`, `INVALID_YEAR` |
| `Forbidden` | `HOUSEHOLD_SCOPE_MISMATCH`, `DIVIDEND_WRITE_FORBIDDEN`, `DIVIDEND_JOB_FORBIDDEN` |
| `NotFound` | `DIVIDEND_EVENT_NOT_FOUND` |
| `Conflict` | `DIVIDEND_VERSION_MISMATCH`, `INVALID_DIVIDEND_STATE_TRANSITION`, `IDEMPOTENCY_PAYLOAD_MISMATCH` |
| `NoData` | `NO_DISCLOSURES`, `NO_DIVIDEND_PROJECTION`, `POSITION_HISTORY_MISSING` |
| `RetryableFailure` | `DISCLOSURE_TIMEOUT`, `DISCLOSURE_RATE_LIMITED`, `POSITION_HISTORY_RETRYABLE`, `UOW_RETRY_EXHAUSTED` |
| `ContractFailure` | `DISCLOSURE_SCHEMA_CHANGED`, `INVALID_PROVIDER_DATA`, `POSITION_HISTORY_CONTRACT_FAILURE` |
| `PartialFailure` | instrument/event별 결과와 retry key |

### 9.2 보안

- DividendEvent와 Annual Projection은 서버 전용 Writer입니다.
- 무인증 Web save route와 임의 household/year overwrite를 제거하고, 읽기에도 membership을 검증합니다.
- Admin SDK job도 SystemActor와 target household scope를 검증합니다.
- command receipt, source reference, Inbox·Outbox는 클라이언트 직접 읽기를 금지합니다.
- 예상 배당 Query도 타 가구 Holdings를 조합할 수 없도록 동일 ActorContext를 downstream Query에 전달합니다.

### 9.3 관측성

log에는 commandId, runId, phase, eventId, instrument code, status transition, result code, attempt, provider와 duration만 기록합니다. 가구 키, raw HTML, 공시 원문, 사용자 이름은 기록하지 않습니다. metric은 discovery 대상/제외 사유, disclosure success/NoData/retryable/contract drift, lifecycle sweep lag·announced age·fixed overdue age, fixed/paid transition, exact/nearest eligibility recovery, projection lag·rebuild·checksum mismatch를 구분합니다.

## 10. 목표 패키지 구조

```text
functions/src/contexts/portfolio/dividends/             # 목표
  domain/
    entities/dividend-event.ts
    value-objects/dividend-event-id.ts
    value-objects/dividend-money.ts
    policies/dividend-eligibility-recovery-policy.ts
    policies/upcoming-dividend-policy.ts
    policies/annual-dividend-policy.ts
  application/
    workflows/refresh-dividend-events.ts
    commands/advance-dividend-status.ts
    commands/rebuild-annual-dividend.ts
    queries/get-annual-dividend.ts
    queries/query-dividend-events.ts
    queries/estimate-upcoming-dividends.ts
    event-handlers/annual-dividend-projector.ts
    ports/in/
    ports/out/
  adapters/out/firestore/
  adapters/out/legacy/
  public.ts

functions/src/platform/market-data/kind/                 # 목표
  kind-dividend-disclosure-adapter.ts
  kind-dto.ts
  kind-parser.ts

web/src/features/dividends/                              # 목표
  adapters/functions-api/
  presentation/
```

Domain은 Firebase, node-fetch, HTML parser와 Holdings Entity를 import하지 않습니다. `public.ts`는 Input Port, DTO·Read Model, `DividendEventChanged.v1`·`DividendEventRemoved.v1` schema와 안정 오류 code만 export합니다.

## 11. 테스트 설계

| 요구사항 ID | 테스트 수준 | 테스트 대상 | 핵심 fixture/경계값 | 관찰 결과 | Canonical 테스트 ID |
|---|---|---|---|---|---|
| DIV-001 | Domain Unit, Repository Conformance, E2E | Annual policy·GetAnnualDividend | 10개월 legacy 배열, NaN/문자값, 12개월 fixed/paid Event | 12개로 정규화, 비정상 legacy 값 0+stale, Event·월 합계 일치 | T-DIV-004 |
| DIV-002 | Domain Unit, Application | UpcomingDividendPolicy | announced 기준일 전, current quantity, 같은 code/payment/perShare fixed Event | 예상액 계산; 확정 중복 제외; Holdings 실패를 빈 결과로 축약하지 않음 | T-DIV-005 |
| DIV-003 | Domain Unit, Emulator | 상태 전이·안정 공시 ID·UoW | 기준일/지급일 전후, quantity 소수, 동일 공시 2회, 날짜·금액 정정, 역전 전이 | announced→fixed→paid만 허용, round 총액, 정정에도 문서 하나, 역전 Conflict | T-DIV-006 |
| DIV-004 | Emulator Integration, Architecture | Annual Projector·Rules·직접 write 금지 | 같은 Event 정정·fixed→paid, 미지급 취소, 중복·역순, 무인증 save route, stale 기존 map | 단일 Writer, 정정 교체·취소 제거, 중복 합산 없음, 월/event checksum 일치, 직접 overwrite 거부 | T-DIV-007 |
| DIV-005 | Domain Unit, Contract, Application | PositionHistoryQueryPort·RecoveryPolicy | exact, 기준일 10일과 9일·11일 동률, 8일·11일, 한쪽만 존재, page 경계, NoData/retryable | exact 우선, 동률은 9일, 최소 날짜 차이 선택, 후보 없음·실패는 0 아님, 선택 뒤 수량 고정 | T-DIV-001 |
| DIV-006 | Domain Unit, Application, Emulator | nonterminal Event sweep·정정·취소·상태 전이 | 모든 source 삭제, Provider NoData, 미지급 정정·취소, paid 뒤 정정·취소, page 재실행 | source 삭제와 무관하게 진행, 미지급 최신 값만 유지, 명시적 취소만 제거, NoData·paid는 무변경, revision 없음 | T-DIV-003 |
| JOB-DIV-001 | Contract, Application, Emulator | KIND Adapter·Refresh job·Projection | 최근 1년 fixture, 동일 run 2회, instrument A 성공/B timeout, 09:00·20:00 경계, 17:30 신규 공시와 18:00 occurrence | 결정 Event 수렴, A만 commit, B retry 범위, 18:00 수집, Projection Event 처리 후 동일 | T-JOB-DIV-001 |
| JOB-DIV-002 | Domain Unit, Contract, Architecture | discovery eligibility·Holdings public DTO | KRX ETF, KRX stock, US stock, crypto, 분류 없음, 영숫자 코드 | 명시 KRX ETF만 Provider 호출, Dividends의 형태 추정 없음 | T-DIV-002 |

추가 공통 suite는 새 테스트 ID 없이 다음을 검증합니다.

- KIND 정상·NoData·429·5xx·HTML schema drift·비정상 날짜/금액 contract fixture
- `RetryingUnitOfWorkFake` callback 2회에도 Position history/provider 재호출과 Outbox 중복 없음
- Fake와 Firestore Event/Projection Adapter의 동일 Conformance Suite
- 타 가구·무인증 Event/Projection write 거부는 [공통 보안 테스트](../../../../cross-cutting/security-privacy.md)에 연결
- 전체 rebuild 결과와 incremental Projection의 event map·12개월 checksum 일치
- DEC-017 논리 삭제·복구·영구 Asset purge 모두 Event·Projection write 0건이며, 기존 paid Event와 월·연간 합계가 동일함
- 같은 공시의 미지급 정정 뒤 Event·Projection에는 최신 값만 있고 이전 값·revision·superseding Event가 없음
- 미지급 명시 취소는 Event·Projection에서 제거되지만 Provider NoData·실패와 paid 뒤 정정·취소는 기존 기록을 변경하지 않음

## 12. 확정 정책과 구현 순서

### 12.1 확정 정책과 명시적 범위

1. Holdings Position history는 [DEC-048](../../../../governance/decisions.md#dec-048)에 따라 수동 Asset·가구 purge 전까지 보존하고 정상 배당 조회에는 Event에 고정된 적격 수량·증거를 사용합니다. 보존된 후보 안에서의 선택 규칙은 DEC-014로 확정되었습니다.
2. 미지급 공시 정정·취소와 모든 source Asset 삭제 뒤 lifecycle은 [DEC-043](../../../../governance/decisions.md#dec-043)으로 확정되었습니다. 최신 값만 같은 Event에 유지하고 이전 공시 값은 보관하지 않으며, 명시적 지급 전 취소만 제거하고 paid 기록은 불변입니다.
3. 외화 배당, 세금·원천징수, 실제 입금 대사는 현재 범위 밖이며 KRW KIND Event에만 신규 write를 허용합니다. 이는 추가 결정 대기가 아닌 명시적 범위 제한입니다.

### 12.2 구현 순서

1. 현재 결정 ID·월 합계·예상액 fixture를 수집하고 잘못된 multi-writer 결과가 아닌 목표 불변식 테스트를 작성합니다.
2. `DividendEvent` 상태 전이와 Annual policy를 Framework 밖으로 분리합니다.
3. `DividendDisclosurePort` fixture suite와 KIND Adapter를 분리해 안정 공시 ID·정정 연결·명시 취소와 NoData·실패 분류를 고정합니다.
4. Event Repository/UoW Fake, receipt, Outbox 경합 테스트를 작성하고 Functions Writer를 Application 뒤로 옮깁니다.
5. `AnnualDividendProjector`를 단일 Writer로 전환하고 Web save route·dormant write를 차단합니다.
6. 명시적 KRX ETF discovery page와 Canonical nonterminal lifecycle sweep page를 분리하고 `T-DIV-002`, `T-DIV-003`을 활성화합니다.
7. 최근 1년 discovery와 부분 실패·retry contract를 연결합니다.
8. Position history Adapter와 DEC-014의 최근접·이전 날짜 동률 우선 `T-DIV-001` 목표 테스트를 활성화합니다.
