# 자산 포트폴리오 모듈 상세 설계

> 소유 요구사항: [자산 포트폴리오 모듈 요구사항](requirements.md) (`AST-001`~`AST-009`)  
> 상위 경계: [Portfolio Bounded Context](../../requirements.md)  
> 공통 계약: [모듈 상세 설계 규약](../../../../governance/module-design-standard.md)  
> 목표 구조: [목표 Clean Architecture 설계](../../../../../architecture/target-clean-architecture.md)

## 1. 설계 목적과 추적성

이 문서는 AssetAccount의 단일 Writer, 자산 합계, AssetSnapshot 조회 계약을 테스트 가능한 Port와 불변식으로 구체화합니다. 공개 Command의 공통 envelope, `ActorContext`, typed Result, receipt와 Outbox 형식은 [공통 상세 설계 규약](../../../../governance/module-design-standard.md)을 그대로 사용하며 이 문서에서 별도 변형하지 않습니다.

설계 근거는 다음과 같습니다.

- 요구사항: [AST 요구사항과 Canonical 테스트](requirements.md)
- 데이터 소유권: [자산·스냅샷의 단일 Writer](../../../../cross-cutting/data-ownership.md)
- 보안: [가구 격리와 서버 전용 데이터](../../../../cross-cutting/security-privacy.md)
- 종단 흐름: [자산 자동 처리](../../../../system/flows.md)
- 테스트 원칙: [요구사항 기반 테스트 전략](../../../../governance/test-strategy.md)

## 2. 모듈 경계와 책임

이 모듈이 소유합니다.

- `AssetAccount`의 이름, 유형·세부 유형, `household | profileId`로 구분한 안정적인 `ownerRef`, 표시 통화, 현재 평가액, 원가, 메모, 순서, `active/deleted/purging` 생명주기와 version
- active 자산의 부호 있는 총·금융·유형별·소유자별 합계 정책
- 복구 가능한 논리 삭제와 별도 승인된 수동 영구 purge Process
- `AssetSnapshot` schema와 Query 계약 및 `AssetSnapshotProjector` 단일 Writer
- production 사용자 가구에서 sample/demo write 진입점을 제거하는 배포·capability 경계
- 다른 기능이 계산한 평가·자동화 변경을 AssetAccount에 적용하기 위한 context-private transaction participant

이 모듈이 소유하지 않습니다.

- Position과 시세 선택·환율 변환: [보유종목·시장 데이터](../holdings-market-data/requirements.md)
- 납입·상환 시점과 금액: [자산 자동화](../asset-automation/requirements.md)
- 배당 상태와 연간 배당 Projection: [배당](../dividends/requirements.md)
- 차트 기간과 표현: [통계](../../../../supporting-platform/modules/reporting/requirements.md)
- Firebase SDK, Scheduler, 외부 Provider 및 HTTP DTO

Holdings와 Automation은 Asset Repository를 import하지 않습니다. 함께 성립해야 하는 변경은 각각 `RevalueAssetWorkflow`, `ApplyAssetAutomationWorkflow`가 Portfolio Context Unit of Work로 commit하고, 이 모듈의 participant는 검증된 Asset 변경 의도만 반환합니다.

## 3. 공개 계약

### 3.1 공개 DTO

Wire DTO는 Domain Entity가 아니며 `contractVersion`별 schema로 검증합니다.

```ts
type AssetTypeDto = 'savings' | 'stock' | 'crypto' | 'property' | 'gold' | 'loan';
type AssetLifecycleStateDto = 'active' | 'deleted' | 'purging';
type AssetOwnerRefDto =
  | { kind: 'household' }
  | { kind: 'profile'; profileId: string };
type AssetOwnerRefKey = 'household' | `profile:${string}`;

interface CreateAssetPayloadV1 {
  name: string;
  type: AssetTypeDto;
  subType?: string;
  ownerRef: AssetOwnerRefDto;
  currency: string;
  currentBalance: number;
  costBasis?: number;
  memo?: string;
  order?: number;
}

interface UpdateAssetPayloadV1 {
  assetId: string;
  expectedVersion: number;
  patch: Partial<Omit<CreateAssetPayloadV1, 'order'>>;
}

interface ReorderAssetsPayloadV1 {
  orderedAssetIds: readonly string[];
  expectedVersions: Readonly<Record<string, number>>;
}

interface DeleteAssetPayloadV1 {
  assetId: string;
  expectedVersion: number;
}

interface RestoreDeletedAssetPayloadV1 {
  assetId: string;
  expectedVersion: number;
}

interface RequestPermanentAssetPurgePayloadV1 {
  assetId: string;
  expectedVersion: number;
  confirmationRef: string;
}

interface ApplyAssetValuationPayloadV1 {
  assetId: string;
  expectedVersion: number;
  currentBalance: number;
  costBasis?: number;
  valuationAsOf: string;
  reason: 'position-revalue' | 'manual-adjustment' | 'automation';
}

interface AssetReadModelV1 {
  schemaVersion: 1;
  assetId: string;
  householdId: string;
  name: string;
  type: AssetTypeDto;
  subType?: string;
  ownerRef: AssetOwnerRefDto;
  currency: string;
  currentBalance: number;
  costBasis?: number;
  memo?: string;
  order: number;
  lifecycleState: AssetLifecycleStateDto;
  aggregateVersion: number;
  createdAt: string;
  updatedAt: string;
}

interface AssetPageV1 {
  items: readonly AssetReadModelV1[];
  nextCursor?: string;
}

interface PortfolioTotalsV1 {
  schemaVersion: 1;
  total: number;
  financial: number;
  byType: Readonly<Record<AssetTypeDto, number>>;
  byOwnerRefKey: Readonly<Record<AssetOwnerRefKey, number>>;
  sourceAssetVersions: Readonly<Record<string, number>>;
  calculatedAt: string;
}

interface AssetHistoryPointV1 {
  localDate: string;
  total: number;
  financial: number;
  byType: Readonly<Record<string, number>>;
  byOwnerRefKey: Readonly<Record<AssetOwnerRefKey, number>>;
  source: 'stored-snapshot' | 'live-today';
}

interface AssetHistoryViewV1 {
  schemaVersion: 1;
  points: readonly AssetHistoryPointV1[];
  dimensions: {
    typeKeys: readonly string[];
    ownerRefKeys: readonly AssetOwnerRefKey[];
  };
  sourceCheckpoint: string;
  updatedAt: string;
  freshness: 'fresh' | 'stale' | 'rebuilding';
}
```

`currentBalance`, `costBasis`는 유한한 원 단위 정수로 정규화합니다. 대출도 저장 시 양의 잔액 크기를 유지하고 합계에서만 `-abs(balance)`를 적용합니다. 통화 간 환산 규칙은 이 모듈이 추측하지 않으며, 평가 Command를 호출하는 기능이 계약상 Portfolio 표시 금액을 제공해야 합니다.

### 3.2 Input Port

| 이름·종류 | 호출자 | 입력 | 결과 | 권한 | 일관성 | 멱등성 |
|---|---|---|---|---|---|---|
| `CreateAsset` Command | Web/API | `CommandEnvelope<CreateAssetPayloadV1>`, `ActorContext` | `Success<AssetReadModelV1>`, `ValidationError`, `Forbidden`, `Conflict` | `portfolio.asset.write` | Asset + receipt + 필요한 Outbox | envelope key와 payload hash |
| `UpdateAsset` Command | Web/API | `CommandEnvelope<UpdateAssetPayloadV1>` | `Success<AssetReadModelV1>`, `ValidationError`, `NotFound`, `Conflict` | `portfolio.asset.write` | 단일 Asset | key replay + expected version |
| `ReorderAssets` Command | Web/API | `CommandEnvelope<ReorderAssetsPayloadV1>` | `Success<readonly AssetReadModelV1[]>`, `ValidationError`, `Conflict` | `portfolio.asset.write` | 전달된 Asset 집합 | key replay + 전체 version precondition |
| `DeleteAsset` Command | Web/API | `CommandEnvelope<DeleteAssetPayloadV1>` | `Success<AssetReadModelV1>`, `Forbidden`, `NotFound`, `Conflict` | `portfolio.asset.write` | Asset `deleted` + receipt + Outbox; 종속 데이터 write 없음 | key replay + expected version |
| `RestoreDeletedAsset` Command | 관리자·agent 운영 도구 전용 | `CommandEnvelope<RestoreDeletedAssetPayloadV1>` + 감사 사유 | `Success<AssetReadModelV1>`, `Forbidden`, `NotFound`, `Conflict` | `portfolio.asset.restore.deleted` | Core Asset `active` + Automation resume revision + receipt + Outbox | key replay + expected version |
| `RequestPermanentAssetPurge` Command | 별도 요청을 수행하는 Admin·agent 운영 도구 | `CommandEnvelope<RequestPermanentAssetPurgePayloadV1>` | `Success<AssetPurgeAccepted>`, `Forbidden`, `NotFound`, `Conflict` | `portfolio.asset.purge.permanent` | Asset `purging` + Process + receipt + Outbox | key replay + expected version |
| `ContinueAssetPurge` Process Command | 영구 purge worker·운영 재개 | processId, participant, cursor, limit | `Success<AssetPurgeStatus>`, `PartialFailure`, `RetryableFailure` | `portfolio.asset.purge.process` SystemActor | participant page와 Process checkpoint | processId+participant+cursor |
| `ApplyAssetValuation` Command | Context workflow, 제한된 관리 경로 | `CommandEnvelope<ApplyAssetValuationPayloadV1>` | `Success<AssetReadModelV1>`, `ValidationError`, `Forbidden`, `NotFound`, `Conflict`, `RetryableFailure` | `portfolio.valuation.apply` | Position 변경이 없을 때 단일 Asset; Position과 함께면 Workflow 전용 | key replay + asset version |
| `ListAssets` Query | Web, 다른 Portfolio 기능 | household scope, cursor | `Success<AssetPageV1>`, `NoData`, `Forbidden` | `portfolio.asset.read` | active만 읽기 | 해당 없음 |
| `ListDeletedAssets` Query | 관리자·agent 운영 도구 전용 | household scope, cursor | `Success<AssetPageV1>`, `NoData`, `Forbidden` | `portfolio.asset.restore.read` | deleted만 읽기; purging 제외 | 해당 없음 |
| `QueryPortfolio` Query | Web, Reporting, Projector | scope, `asOf` | `Success<PortfolioTotalsV1>`, `Forbidden`, `RetryableFailure` | `portfolio.asset.read` 또는 내부 projection capability | 읽기 snapshot | 해당 없음 |
| `QueryAssetHistory` Query | Web, Reporting | period, scope | `Success<AssetHistoryViewV1>`, `NoData`, `Forbidden` | `portfolio.asset.read` | Projection 읽기 | 해당 없음 |

`AssetPageV1`은 `(order ASC, assetId ASC)`로 정렬하고 opaque cursor를 사용합니다. `PortfolioTotalsV1`은 `total`, `financial`, `byType`, `byOwnerRefKey`, `sourceAssetVersions`, `calculatedAt`을 포함합니다. 활성 Asset이 0개인 것은 `NoData`가 아니라 모든 합계와 dimension map이 0·빈 값인 정상 `Success`입니다. 원천 조회 실패만 `RetryableFailure`로 구분합니다. `AssetHistoryViewV1`은 `schemaVersion`, `sourceCheckpoint`, `updatedAt`, `freshness`, 결정적 날짜순 point와 같은 baseline·window에서 수집한 type/owner dimension key를 반환합니다. `AssetOwnerRefKey`는 공동 명의의 `household`과 개인 명의의 `profile:{profileId}`를 충돌 없이 구분하는 내부·Projection key이며 표시 이름을 포함하지 않습니다.

요구사항 문서의 `CalculatePortfolioTotals(assets)`는 `PortfolioTotalsPolicy`의 내부 순수 연산 이름으로 유지하고 외부 wire API로 노출하지 않습니다. Canonical 결과가 필요한 호출자는 `QueryPortfolio`를 사용하며, 테스트와 Web 호환 Facade는 같은 Policy fixture를 재사용합니다.

`RecordAssetSnapshot`은 일반 공개 Command가 아닙니다. `AssetSnapshotProjector`의 context-private Event/rebuild Input Port만 Snapshot을 쓸 수 있습니다.

`SeedDemoAssets`는 production `public.ts` 계약에 존재하지 않습니다. 개발 fixture가 필요하면 별도 demo build와 격리 tenant 전용 Adapter가 `portfolio.demo.seed` capability를 확인하고, 모든 문서에 demo dataset ID를 붙여 한 Unit of Work로 생성·제거합니다. 일반 `CreateAsset`를 반복 호출해 실제 가구에 sample을 만드는 UI는 허용하지 않습니다.

### 3.3 권한과 tenant

Role에서 Capability로의 매핑은 Access Context가 소유합니다. 이 모듈은 `ActorContext.householdId == CommandEnvelope.householdId`와 대상 문서의 household를 모두 확인합니다. Scheduler와 Projector는 각각 필요한 최소 Capability만 가진 `SystemActor`를 사용합니다. 클라이언트가 보낸 owner 이름, uid, memberId, role은 권한 근거로 사용하지 않습니다. 새 profile 참조를 선택할 때는 Access 공개 Port로 같은 가구의 active `AssetOwnerProfile`인지 검증합니다.

## 4. Domain 모델과 불변식

### 4.1 Aggregate와 Value Object

| 모델 | 핵심 상태 | 규칙 |
|---|---|---|
| `AssetAccount` Aggregate | id, householdId, name, type/subType, ownerRef, currency, balance, costBasis, memo, order, lifecycleState, deletedAt, version | Portfolio Core만 생성·변경합니다. 일반 Command는 `active→deleted`, 영구 purge는 `deleted→purging`, 운영 전용 Workflow만 `deleted→active`를 허용합니다. |
| `AssetPurgeProcess` Aggregate | processId, assetId, confirmationRefHash, participant별 cursor/status, version | 별도 승인 후에만 생성하며 완료 page를 되돌리지 않고 purging 이후 복구를 금지합니다. 모든 participant 완료 뒤 `purged` 종료 결과와 최소 비식별 receipt만 남깁니다. |
| `AssetName` | trim된 문자열 | 비어 있으면 `ValidationError(ASSET_NAME_REQUIRED)`입니다. |
| `AssetBalance` | 0 이상의 원 단위 정수 크기 | NaN·Infinity·음수 입력은 거부합니다. 대출 부호는 합계 Policy가 담당합니다. |
| `AssetOrder` | 0 이상의 정수 | 재정렬 명령은 현재 가구의 대상 집합을 중복·누락 없이 한 번씩 포함합니다. |
| `AssetOwnerRef` | `household` 또는 같은 가구의 안정 profileId | 공동 명의와 사람 명의를 타입으로 구분하고 표시 이름·memberId를 Asset 외래 키로 저장하지 않습니다. |
| `AssetScope` | total, financial, type, owner | Snapshot과 Query에서 같은 scope 표현을 사용합니다. |

세부 유형은 요구사항의 예금·적금·보험, 실물 금·금 주식, 신용·주택담보·전세 대출만 해당 부모 유형에서 허용합니다. 레거시 자유 문자열은 Mapper가 호환 값으로 읽되 신규 Command는 schema enum으로 제한합니다.

### 4.2 계산 불변식

`PortfolioTotalsPolicy`는 다음 순수 규칙을 한 곳에서 수행합니다.

1. `lifecycleState == active`만 모든 합계에 포함합니다. 레거시 `isActive` 누락·true는 active, false는 운영 복구 가능한 deleted로 변환합니다.
2. 대출은 `-abs(currentBalance)`, 나머지는 저장 값 그대로 더합니다.
3. 금융자산은 부동산과 대출을 제외합니다.
4. 유형별·소유자별 합계에도 같은 활성·부호 규칙을 사용합니다.
5. 유효하지 않은 숫자를 0으로 바꾸지 않고 Command 경계에서 거부합니다.
6. 소유자별 key는 `household` 또는 `profile:{profileId}`이며 프로필 이름 변경·보관으로 바뀌지 않습니다.

`AssetSnapshot`과 차트의 오늘 point는 Aggregate가 아니라 파생 Read Model입니다. 저장 point와 오늘 실시간 point의 LocalDate가 같으면 오늘 point 하나로 치환하여 중복을 만들지 않습니다.

## 5. Application Use Case 상세

### 5.1 생성·수정·재정렬

1. Adapter가 schema·인증을 검증하고 `ActorContext`를 만듭니다.
2. Application이 tenant와 Capability, idempotency receipt를 확인합니다.
3. ownerRef가 `profile`이면 Access의 `AssetOwnerProfileReferencePort`로 같은 household의 active profile인지 검증합니다. 공동 자산은 별도 가짜 profile 없이 `household`를 사용합니다.
4. 기존 Asset의 ownerRef를 바꾸지 않는 수정은 해당 프로필이 이후 archived가 되었더라도 허용하고 참조를 보존합니다. archived profile로 새로 지정하거나 다른 자산에서 선택하는 요청만 거부합니다.
5. DTO를 trim·enum·유한 정수로 정규화합니다.
6. Domain이 Asset을 생성하거나 expected version 기준 patch·순서를 적용합니다.
7. 같은 transaction에서 Asset, receipt, 합계에 영향을 준 경우 `AssetValuationChanged.v1` Outbox를 기록합니다.
8. retry는 최초 typed result를 재생하고 같은 key의 다른 payload는 `Conflict(IDEMPOTENCY_PAYLOAD_MISMATCH)`를 반환합니다.

이름·메모·순서만 바뀐 경우에는 valuation Event를 만들지 않습니다. 신규 Update DTO는 생명주기 상태 변경을 허용하지 않으며, 삭제·복구는 전용 Command만 사용합니다. 유형, ownerRef, balance 또는 생명주기가 바뀌면 Snapshot/Reporting이 새 합계를 계산할 수 있도록 Event를 기록합니다.

### 5.2 평가 적용 participant

`AssetValuationParticipant.prepare`는 `RevalueAssetWorkflow`의 context-private participant 연산입니다.

1. Asset과 expected version을 검증합니다.
2. 성공한 Position 후보가 계산한 balance·costBasis만 `AssetValuationIntent`로 변환합니다.
3. 직접 저장하지 않고 `assetId`, before/after, expectedVersion, event draft를 반환합니다.
4. Workflow가 Position intent와 함께 `PortfolioRevaluationUnitOfWork`로 commit합니다.

`AssetAutomationParticipant.prepare`도 같은 방식으로 자동화 delta와 execution month를 검증하고 Asset 변경 의도만 반환합니다. Automation execution claim은 `AutomationExecutionParticipant`가 소유합니다.

### 5.3 삭제

#### 5.3.1 논리 삭제

1. `DeleteAsset`은 대상 Asset의 가구, active 상태, expectedVersion을 검증합니다.
2. Asset만 `deleted`로 전환하고 deletedAt, receipt, `AssetLifecycleChanged.v1`을 같은 UoW로 기록합니다.
3. Position·position history, Asset history, Automation plan·execution, Dividend data는 조회하거나 수정하지 않습니다.
4. 일반 Asset Query, Portfolio 합계, 평가·자동화·신규 배당 Use Case는 deleted를 대상에서 제외합니다.
5. 동일 요청은 최초 결과를 재생하고 이미 deleted인 Asset의 다른 key 요청은 현재 상태를 포함한 Conflict 또는 명시적 AlreadyProcessed로 일관되게 반환합니다.

#### 5.3.2 운영 복구

1. 일반 사용자용 Web·앱에는 삭제 자산 목록과 복구 action을 제공하지 않습니다. 서버도 일반 `portfolio.asset.write`로 복구를 허용하지 않고 별도 운영 capability를 검증합니다.
2. `RestoreDeletedAsset`은 감사 사유, 정확한 assetId, expectedVersion, 대상이 deleted인지와 활성 `AssetPurgeProcess`가 없는지 검증합니다.
3. `RestoreAssetWorkflow`는 Core Asset을 active로 전환하고 Automation에 삭제 구간과 복구일 기반 resume revision을 추가하여 receipt·`AssetLifecycleChanged.v1`과 한 UoW로 commit합니다. 자동화 Plan이 없으면 Automation participant는 변경 의도 없이 성공합니다.
4. 삭제 전 실행일이 이미 지난 미처리 자동화는 보존하고, 삭제 effective 시점부터 복구일까지의 실행 월은 제외합니다. 복구일이 당월 유효 실행일 이전·당일이면 당월, 이후이면 다음 달을 resumeFromDate로 정합니다.
5. Position·history·Dividend는 재생성·remap하지 않고 보존 자료를 그대로 사용합니다. 현재 Portfolio Snapshot만 재계산하고 과거 Snapshot은 삭제하지 않습니다.

#### 5.3.3 수동 영구 purge

1. 자동 Scheduler와 일반 사용자 삭제는 영구 purge를 시작할 수 없습니다.
2. 사용자가 별도로 DB 정리를 요청했을 때만 Admin·agent 운영 도구가 `portfolio.asset.purge.permanent` capability와 confirmationRef로 `RequestPermanentAssetPurge`를 호출합니다.
3. deleted Asset을 purging으로 전환하고 `AssetPurgeProcess`를 생성한 뒤 Holdings·Automation·Core participant를 page 단위 호출합니다. 배당은 가구 금융 이력이므로 Dividends participant를 두거나 호출하지 않습니다.
4. 각 participant는 자기 데이터만 삭제하고 processId+cursor receipt를 저장합니다. 실패한 participant만 마지막 checkpoint부터 재개합니다.
5. 모든 participant 완료 뒤 Asset Canonical과 상세 Process 데이터를 제거하고, 재실행 차단에 필요한 processId·완료 시각·결과 hash의 최소 비식별 `purged` receipt만 남깁니다. purging부터는 부분 삭제 가능성 때문에 복구를 허용하지 않습니다.

외부 호출과 비멱등 로그는 transaction callback 안에서 실행하지 않습니다.

### 5.4 조회와 Snapshot Projector

`QueryPortfolio`는 같은 snapshot에서 활성 Asset을 읽고 Domain 합계 Policy를 실행합니다. `AssetSnapshotProjector`는 valuation Event 또는 명시적 rebuild 요청을 Inbox로 claim한 뒤, 확정된 `QueryPortfolio` 결과를 `(householdId, localDate)` 결정 key로 upsert합니다. 같은 날짜 재실행은 `createdAt`을 보존하고 source checkpoint만 전진시킵니다.

현재 범위에서 사라진 owner·type은 직전 Snapshot scope와 현재 scope의 합집합에 0을 기록하여 오래된 차트 값이 남지 않게 합니다. 자산이 전혀 없는 가구도 total·financial 0 Snapshot을 만들 수 있습니다.

`QueryAssetHistory`는 기간 안의 point와 시작일 이하 최근 baseline을 같은 request revision으로 끝까지 읽고, 그 결과에 실제 존재하는 `byType`·`byOwnerRefKey` key의 합집합을 정렬된 dimension catalog로 반환합니다. 명시적 0원 key도 포함하고, 현재 Asset 목록이나 active Profile Query를 사용해 key를 제거하지 않습니다. owner 표시 이름 해석은 Reporting이 Access historical-display Port로 수행합니다.

### 5.5 Demo fixture 경계

1. production composition root와 사용자 navigation에는 demo seed Adapter를 bind하지 않습니다.
2. demo build는 격리 tenant와 `portfolio.demo.seed` capability를 모두 확인합니다.
3. seed 계획은 dataset ID, 결정적 Asset ID, `isDemo=true`를 포함하고 전체 Asset·receipt를 한 Unit of Work로 commit합니다.
4. 일부 생성 실패는 전체 rollback하며 제거는 같은 dataset ID만 대상으로 합니다.
5. production artifact 검사에서 sample label, seed public export 또는 demo capability binding을 발견하면 build를 실패시킵니다.

### 5.6 자산 명의자 필터 UI

1. Presentation은 `ListAssetOwnerProfiles(active)`와 `QueryPortfolio` 결과를 조합해 도넛 위에 `전체`, 활성 명의자 프로필, `+` 순서의 필터를 렌더링합니다. 공동 자산 scope가 필요하면 `가구 공동`을 typed household 항목으로 표시합니다.
2. `+`는 Access의 `CreateAssetOwnerProfile`을 호출하는 이름 입력 modal만 열며 Member·초대·로그인 설정을 함께 노출하지 않습니다.
3. 생성 성공 뒤 목록을 갱신해 같은 profileId를 자산 생성·수정 명의자 선택지와 필터에 사용합니다. 실패하면 임시 이름 chip이나 로컬 전용 profile을 만들지 않습니다.
4. 일반 자산 UI에는 이름 변경만 제공하고 삭제 버튼이나 archive API 호출을 두지 않습니다. 삭제는 관리자 화면이 Access의 관리자 전용 Command를 호출하며, archived profile은 활성 필터·신규 선택에서 빠지지만 기존 Asset이나 조회 기간의 과거 Snapshot이 참조하면 archived 포함 Query로 표시 이름을 해석합니다.
5. UI 문구와 시각적 `+` 아이콘의 접근성 이름은 `자산 명의자 추가`로 고정합니다.

## 6. Port 설계

### 6.1 Input·participant Port

- 공개 Input Port: 3.2 표의 Command·Query만 `public.ts`에서 export합니다.
- `PositionRevaluationParticipant`(Holdings) + `AssetValuationParticipant`(Core): `RevalueAssetWorkflow`의 두 participant입니다.
- `AutomationExecutionParticipant`(Automation) + `AssetAutomationParticipant`(Core): `ApplyAssetAutomationWorkflow`의 두 participant입니다.
- `AssetSnapshotProjectorInput`: Event 소비·전체 rebuild 전용이며 Context 밖에 공개하지 않습니다.
- `AssetPurgeParticipant`: 수동 영구 purge에서 각 Portfolio 기능이 자기 소유 데이터를 page 단위 삭제하고 opaque cursor를 반환합니다. 논리 삭제에서는 호출하지 않습니다.

`AssetPurgeProcess`와 participant가 공유하는 계약은 특정 모듈의 Entity나 Repository 타입을 포함하지 않는 Portfolio Context-private 계약입니다.

```ts
type AssetPurgeParticipantNameV1 = 'holdings' | 'automation' | 'core';

interface AssetPurgePageCommandV1 {
  processId: string;
  householdId: string;
  assetId: string;
  participant: AssetPurgeParticipantNameV1;
  cursor?: string;
  limit: number;
}

interface AssetPurgePageResultV1 {
  processId: string;
  participant: AssetPurgeParticipantNameV1;
  deletedCount: number;
  nextCursor?: string;
  completed: boolean;
  pageChecksum: string;
}
```

각 participant는 Asset이 동일 process의 `purging` 상태인지 확인하고, 자기 저장소의 결정적 page만 삭제합니다. page 삭제와 receipt 저장은 같은 모듈 UoW에서 commit하며, `(processId, participant, cursor ?? 'start')` 재호출은 최초 `AssetPurgePageResultV1`을 재생합니다. `completed=true`가 된 participant를 다시 시작하거나 다른 assetId로 같은 processId를 재사용할 수 없습니다.

### 6.2 Output Port

| Port | 책임 | 금지 사항 |
|---|---|---|
| `AssetRepository` | 단일 Asset load/save와 version precondition | 다른 기능 collection 접근 |
| `PortfolioQueryRepository` | tenant별 결정적 Asset page·합계 원천 읽기 | 합계 업무 규칙 복제 |
| `AssetSnapshotRepository` | Projector 전용 upsert·period query | Scheduler·Web에 노출 |
| `DemoAssetFixturePort` | 개발·demo build 전용 원자 seed/remove | production composition·실제 가구 접근 |
| `AssetCommandUnitOfWork` | Asset + receipt + Outbox commit | 외부 HTTP 호출 |
| `PortfolioRevaluationUnitOfWork` | Position intent + Asset intent + receipt + Outbox 원자 commit | 기능 Repository 공개 |
| `PortfolioAutomationUnitOfWork` | execution/plan intent + Asset intent + receipt + Outbox 원자 commit | transaction 밖 side effect |
| `AssetPurgeProcessRepository` | participant별 opaque cursor·상태와 process version | 일반 삭제에서 Process 생성 |
| `AssetPurgeParticipantPort` | Holdings·Automation·Core의 page purge 조정 | 다른 기능 Repository 직접 접근, Dividends 호출 |
| `AssetOwnerProfileReferencePort` | 같은 가구의 profile 존재·active 여부와 과거 표시용 archived 조회 | 표시 이름·memberId를 identity로 사용, Access Repository 직접 import |
| `OutboxAppendPort`, `Clock`, `IdGenerator`, `HashPort` | 공통 경계 | Framework 타입 노출 |

Repository Fake와 Firestore Adapter는 같은 Conformance Suite를 통과해야 합니다.

## 7. 저장·트랜잭션·동시성

### 7.1 목표 저장 모델

| 논리 데이터 | 목표 key | Canonical Writer | 동시성 |
|---|---|---|---|
| AssetAccount | `households/{householdId}/assets/{assetId}` | Portfolio Core | `aggregateVersion` compare-and-swap |
| AssetSnapshot | `households/{householdId}/assetSnapshots/{localDate}` | `AssetSnapshotProjector` | source checkpoint·last event precondition |
| Command receipt | context receipt key | 해당 Application/UoW | idempotency key + payload hash |
| AssetPurgeProcess | `households/{householdId}/assetPurgeProcesses/{processId}` | Portfolio Core | process version + participant cursor |

Asset 문서에는 `schemaVersion`, server `createdAt/updatedAt`, `aggregateVersion`을 둡니다. Domain과 Firestore DTO 사이에는 Mapper를 두고 Timestamp·FieldValue를 Domain에 노출하지 않습니다.

일반 Command transaction은 Canonical Asset write, receipt, 필요한 Outbox를 함께 commit합니다. `RevalueAssetWorkflow`와 `ApplyAssetAutomationWorkflow`에서는 이 모듈이 별도 commit하지 않고 Context UoW 하나만 호출합니다. callback 재실행 시 participant는 순수하게 같은 intent를 반환합니다.

### 7.2 전환

1. Access 전환이 Member별 `member` 프로필과 기존 비로그인 이름의 `dependent` 프로필을 먼저 준비합니다. Legacy Adapter는 현재 `assets.owner`를 별도 reconciliation mapping으로 `ownerRef`에 연결합니다. 공동 표식은 `household`, 유일한 Member 이름은 연결 프로필, 그 밖의 아이·비로그인 이름은 dependent profile을 사용하며 동명이인·중복 후보는 자동 추측하지 않습니다.
2. 기존 Web·Functions Writer를 Application Command 뒤로 이동합니다.
3. `schemaVersion`, version, receipt를 추가한 뒤 V2 경로를 dual-read/shadow-read합니다.
4. 레거시 `isActive` 누락·true는 active, false는 deleted로 변환하고 문서 수, active·부호 합계, 유형·ownerRef 합계, 날짜 Snapshot hash를 비교합니다.
5. Read 전환 뒤 구 Writer와 dormant Snapshot Writer를 차단합니다.

## 8. Event·Projection·외부 연동

### 8.1 Event

`AssetValuationChanged.v1`은 이 모듈이 단독 생산합니다. payload는 `assetId`, `assetType`, `ownerRef`, `lifecycleState`, `previousSignedBalance`, `currentSignedBalance`, `valuationAsOf`, `reason`과 event envelope의 aggregate version만 포함합니다. `AssetLifecycleChanged.v1`은 delete/restore 전이와 before/after state를 전달합니다. 메모와 명의자 표시 이름은 넣지 않습니다.

Event는 Asset 변경과 같은 transaction의 Outbox에 추가합니다. Position과 Asset의 강한 일관성을 Event 왕복으로 완성하지 않습니다. 전달 실패 시 Canonical 상태는 이미 완결되어 있고 Projector·Reporting만 재시도합니다.

### 8.2 AssetSnapshot Projection

- source: `AssetValuationChanged.v1`과 운영용 전체 rebuild 요청
- key: `(householdId, Asia/Seoul localDate)`
- writer: `AssetSnapshotProjector` 하나
- metadata: `schemaVersion`, `sourceCheckpoint`, `lastEventId`, `updatedAt`, `freshness`
- 중복: `(eventId, handlerName)` Inbox claim 후 동일 문서 upsert
- 순서 역전: asset aggregateVersion이 checkpoint보다 작으면 no-op, gap이면 해당 날짜 전체 rebuild
- rebuild: Canonical Asset Query에서 연도·기간을 다시 계산하며 Scheduler·Reporting은 물리 저장소를 쓰지 않음

이 모듈에는 외부 HTTP Port가 없습니다. 통화·시세 실패를 해석하거나 Provider fallback을 만들지 않습니다.

## 9. 오류·보안·관측성

### 9.1 안정 오류 코드

| typed Result | 주요 code |
|---|---|
| `ValidationError` | `ASSET_NAME_REQUIRED`, `INVALID_ASSET_TYPE`, `INVALID_ASSET_SUBTYPE`, `INVALID_MONEY`, `INVALID_ORDER_SET`, `ASSET_RESTORE_AUDIT_REASON_REQUIRED`, `ASSET_PURGE_CONFIRMATION_REQUIRED`, `INVALID_PURGE_PAGE_LIMIT` |
| `Forbidden` | `HOUSEHOLD_SCOPE_MISMATCH`, `ASSET_READ_FORBIDDEN`, `ASSET_WRITE_FORBIDDEN`, `ASSET_RESTORE_FORBIDDEN`, `DELETED_ASSET_LIST_FORBIDDEN`, `ASSET_PURGE_FORBIDDEN`, `ASSET_PURGE_PROCESS_FORBIDDEN`, `DEMO_SEED_FORBIDDEN` |
| `NotFound` | `ASSET_NOT_FOUND`, `OWNER_PROFILE_NOT_FOUND` |
| `Conflict` | `ASSET_VERSION_MISMATCH`, `IDEMPOTENCY_PAYLOAD_MISMATCH`, `ASSET_NOT_ACTIVE`, `ASSET_NOT_DELETED`, `ASSET_PURGE_ALREADY_STARTED`, `ASSET_PURGING_NOT_RESTORABLE`, `ASSET_PURGE_PROCESS_MISMATCH`, `PURGE_CHECKPOINT_MISMATCH`, `PURGE_PARTICIPANT_ALREADY_COMPLETED`, `OWNER_PROFILE_ARCHIVED` |
| `RetryableFailure` | `UNIT_OF_WORK_RETRY_EXHAUSTED`, `SNAPSHOT_REBUILD_RETRYABLE` |

클라이언트는 오류 문자열이 아니라 code와 typed payload를 분기합니다.

### 9.2 보안

- 모든 쓰기는 서버 Input Port를 거치며 클라이언트의 Canonical Asset·Snapshot 직접 쓰기를 금지합니다.
- 다른 가구 ID, 누락 household, 다른 가구 profileId와 표시 이름·memberId를 ownerRef처럼 전달하는 요청은 변경 없이 거부합니다.
- Snapshot·receipt·Outbox는 서버 전용입니다. 실시간 Asset Read Contract를 제공한다면 Rules에서 membership, household path와 허용 필드를 동시에 검증합니다.
- 영구 purge, 복구, 삭제 자산 조회와 Projector capability는 일반 사용자 role에 부여하지 않습니다. 일반 사용자는 `portfolio.asset.write`로 논리 삭제만 할 수 있고, 복구는 서버가 만든 관리자·승인된 운영 Actor의 전용 capability로만 실행합니다.
- `portfolio.demo.seed`는 production identity와 production composition에 존재하지 않으며 실제 사용자 가구를 demo tenant로 간주하지 않습니다.

### 9.3 관측성

구조화 log·metric에는 `commandId`, hash된 household 식별자, assetId, useCase, result code, attempt, duration, aggregateVersion을 기록합니다. 자산 이름·메모·owner 표시 이름은 기록하지 않습니다. 주요 metric은 command conflict, receipt replay, snapshot lag, projector rebuild, 논리 삭제·복구 횟수와 수동 purge page 진행률입니다.

## 10. 목표 패키지 구조

```text
functions/src/contexts/portfolio/core/                 # 목표
  domain/
    entities/asset-account.ts
    value-objects/asset-balance.ts
    policies/portfolio-totals-policy.ts
  application/
    commands/create-asset.ts
    commands/update-asset.ts
    commands/reorder-assets.ts
    commands/delete-asset.ts
    commands/restore-deleted-asset.ts
    commands/request-permanent-asset-purge.ts
    commands/continue-asset-purge.ts
    commands/apply-asset-valuation.ts
    queries/list-assets.ts
    queries/query-portfolio.ts
    queries/query-asset-history.ts
    event-handlers/asset-snapshot-projector.ts
    participants/asset-valuation-participant.ts
    participants/asset-automation-participant.ts
    ports/in/
    ports/out/
  adapters/out/firestore/
  public.ts

functions/src/contexts/portfolio/workflows/            # 목표
  revalue-asset/
  apply-asset-automation/
  asset-purge/
    contracts.ts
    asset-purge-process.ts

web/src/features/portfolio/                            # 목표
  application/
  adapters/functions-api/
  adapters/firestore-read-model/
  presentation/
```

Domain은 Firebase·React와 다른 기능 Entity를 import하지 않습니다. 다른 모듈은 `core/public.ts`의 DTO, Input Port, Read Model, Event schema만 import합니다.

## 11. 테스트 설계

| 요구사항 ID | 테스트 수준 | 테스트 대상 | 핵심 fixture/경계값 | 관찰 결과 | Canonical 테스트 ID |
|---|---|---|---|---|---|
| AST-001 | Domain Unit, Contract, Application | AssetName·DTO schema·CreateAsset | 6개 유형과 허용 세부 유형, 활성 동일 가구 ownerRef, 통화·잔액·메모·순서, 빈 이름, NaN·Infinity·숫자 문자열·stale ownerRef | 정상 입력은 손실 없이 보존하고 잘못된 이름·숫자·통화·순서·ownerRef는 기본값 저장 없이 `ValidationError` | T-AST-007 |
| AST-002 | Domain Unit | `PortfolioTotalsPolicy` | active 예적금 100, 부동산 500, 대출 30, deleted 자산 | 총 570, 금융 100, deleted는 모든 scope에서 제외 | T-AST-001 |
| AST-003 | Legacy Adapter Characterization, Application | ReorderAssets·레거시 물리 DeleteAsset·목표 논리 DeleteAsset | 중복/누락 순서, stale version, 종속 Position 삭제 실패 | 잘못된 순서·stale version은 전체 무변경, 현재 물리 삭제의 부분 실패 위험을 기록하되 목표 Writer는 논리 삭제만 수행 | T-AST-008 |
| AST-004 | Domain Unit, Repository Conformance, E2E | QueryPortfolio·QueryAssetHistory·Snapshot mapper | total/financial/type/owner scope, 대출·deleted, owner가 사라지는 날, 과거·baseline에만 있는 type/owner | 동일 합계 정책, 사라진 scope 0 전이, 현재 목록과 무관한 안정 dimension catalog | T-AST-001, T-AST-006 |
| AST-005 | Domain Unit, Client | QueryAssetHistory·오늘 point 합성 | 저장 마지막 날짜=오늘/어제, 기간 시작 이력 없음, 중간 gap, 명시적 0원 | 오늘 point 중복 없음; 최초 Snapshot 전은 빈 값, 이후 gap은 직전 값 유지 | T-AST-009 |
| AST-006 | Domain·Application·Emulator·보안 E2E | DeleteAsset·RestoreAssetWorkflow·ListDeletedAssets·RequestPermanentAssetPurge | 레거시 isActive=false, Position·자동화·paid 배당 이력, 일반/관리자 Actor, 삭제 전 overdue·삭제 기간·복구일 경계, 감사 사유 없음, purge page 실패 | false→deleted, 삭제 시 종속 write 0·처리 제외, 일반 사용자 목록·복구 0건, 운영 복구 후 active·이력 재사용과 삭제 기간 비소급, 별도 승인 전 purge 0건, purging 복구 거부, 영구 purge 후 paid Event·연간 합계 불변 | T-AST-002, T-AUTO-003 |
| AST-007 | Contract·Build·보안 E2E | production composition·DemoAssetFixturePort | 실제 빈 가구, production/demo artifact, seed 중간 실패, dataset 제거 | production seed surface/write 0건, demo만 표식 있는 원자 seed·remove | T-AST-003 |
| AST-008 | Domain·Projector·E2E | AssetSnapshotProjector | 전날만 존재한 owner/type, 오늘 자산 0개, 유효 0원 | 직전·현재 scope 합집합의 명시적 0 snapshot, NoData와 구분 | T-AST-004 |
| AST-009 | Domain·Contract·Client·보안 E2E | AssetOwnerRef·ProfileReferencePort·자산 도넛 필터 | household/member/dependent, 일반/관리자 archive, 다른 가구·archived profile, `+` 추가 | 일반 삭제 surface 없음, 안정 ownerRef 집계, 신규 archived 선택 거부, 기존·과거 조회 보존 | T-AST-005 |

추가 공통 suite는 새 테스트 ID를 만들지 않고 제공 fixture에 연결합니다.

- 같은 idempotency key의 동일 payload는 결과 재생, 다른 payload는 `Conflict`
- 가구 A Actor로 가구 B Asset 요청 시 변경 없음; 보안 Canonical은 [T-SEC-001](../../../../cross-cutting/security-privacy.md)
- `RetryingUnitOfWorkFake`가 callback을 두 번 실행해도 Outbox와 receipt가 한 번
- Fake·Legacy·V2 Repository가 같은 Conformance Suite를 통과
- 동일 Snapshot Event 중복·순서 역전·전체 rebuild가 같은 hash로 수렴

## 12. 확정 정책과 구현 순서

### 12.1 정책 상태

1. [DEC-053](../../../../governance/decisions.md#dec-053)과 [DEC-060](../../../../governance/decisions.md#dec-060)에 따라 표시 통화가 KRW가 아닌 자산은 Holdings의 `ForeignCurrencyValuationPolicy`가 최신 사용 가능 원 통화 값과 Frankfurter 마지막 성공 환율을 시각 차이·환율 경과 기간 제한 없이 조합합니다. Core는 사용한 Quote observedAt·provider와 환율 rateDate·observedAt·provider가 있는 명시적 KRW valuation만 받고 환율을 직접 조회·추정하지 않습니다.
2. [DEC-048](../../../../governance/decisions.md#dec-048)에 따라 `HistoryGapPolicy`는 최초 Snapshot 전 구간을 비워 두고, 이후 누락 날짜는 직전 Snapshot 값을 별도 표시 없이 유지합니다. 명시적 0원 Snapshot은 유효한 기준이며 현재값으로 과거를 채우지 않습니다.
3. [DEC-011](../../../../governance/decisions.md#dec-011)은 CreateAsset 자체가 아니라 신규·기존 자산의 Automation plan 최초 활성화 시 `FirstAutomationMonthPolicy`에서 처리합니다.

### 12.2 구현 순서

1. 현재 계산을 고정하는 `PortfolioTotalsPolicy` 특성화 테스트와 Legacy Mapper를 만듭니다.
2. DTO schema, Domain Value Object, Repository Fake/Conformance Suite를 만듭니다.
3. Create·Update·Reorder Command를 Facade 뒤로 옮기고 receipt/version을 활성화합니다.
4. `RevalueAssetWorkflow`와 `ApplyAssetAutomationWorkflow` participant/UoW contract test를 먼저 작성합니다.
5. 모든 Asset Writer를 서버 Application 뒤로 모은 뒤 직접 Firestore write를 차단합니다.
6. `AssetSnapshotProjector`를 단일 Writer로 전환하고 사라진 scope 0 전이 `T-AST-004`와 중복·rebuild test를 활성화합니다.
7. production navigation·service export에서 sample seed를 제거하고 demo fixture Adapter의 build 격리와 `T-AST-003`을 활성화합니다.
8. 레거시 물리 Delete Writer를 논리 Delete로 교체하고, 일반 UI에 복구 surface가 없으며 운영 전용 `RestoreAssetWorkflow`만 존재하는 `isActive=false → deleted` migration과 `T-AST-002`를 활성화합니다.
9. 일반 삭제와 분리된 수동 `RequestPermanentAssetPurge`·participant checkpoint를 구현합니다.
10. Access 명의자 프로필 backfill manifest로 레거시 owner를 typed ownerRef로 전환하고 `T-AST-005`와 도넛 `+` UI 테스트를 활성화합니다.

### 12.3 삭제 자산 운영 복구 런타임

- 삭제 자산 목록과 복구는 일반 Portfolio command/query manifest에 넣지 않고 `systemAdmin` 전용 `admin-access.v1` operation으로만 제공합니다.
- `FirebaseAssetLifecycleUnitOfWork`는 canonical Asset, 레거시 Asset projection, 자동화 재개 상태, receipt, 감사 기록, `AssetLifecycleChanged.v1` Outbox를 한 Firestore transaction에서 변경합니다.
- 복구에는 공백이 아닌 감사 사유와 정확한 `expectedVersion`이 필요합니다. `purging` 자산과 stale version은 변경 없이 거부합니다.
- 자동화 Plan이 있으면 복구일과 납입일 정책으로 `resumeFromDate`를 계산해 별도 resume revision을 기록합니다. 삭제 전 overdue는 유지하고 삭제 기간은 소급 생성하지 않습니다.
- 일반 자산 UI에는 삭제 자산 목록과 복구 버튼을 제공하지 않으며, 영구 purge도 관리자 일반 UI/API 범위에 포함하지 않습니다.
