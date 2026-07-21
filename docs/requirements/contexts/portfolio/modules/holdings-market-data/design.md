# 보유종목·시장 데이터 모듈 상세 설계

> 소유 요구사항: [보유종목·시장 데이터 모듈 요구사항](requirements.md) (`HOLD-*`, `GOLD-*`, `MARKET-*`, `JOB-AST-*`)  
> 상위 경계: [Portfolio Bounded Context](../../requirements.md)  
> 공통 계약: [모듈 상세 설계 규약](../../../../governance/module-design-standard.md)  
> 목표 구조: [목표 Clean Architecture 설계](../../../../../architecture/target-clean-architecture.md)

## 1. 설계 목적과 추적성

이 문서는 Position의 단일 Writer, `HOLD-004`의 Position+부모 Asset 원자 평가 commit, 공급자 중립 Market Data ACL과 일일 평가 job을 테스트 가능한 계약으로 정의합니다. 외부 Provider의 성공·데이터 없음·일시 실패·계약 실패·유효하지 않은 데이터를 서로 다른 결과로 보존하고, 실패를 0원이나 빈 성공으로 바꾸지 않는 것이 핵심입니다. [DEC-018](../../../../governance/decisions.md#dec-018)에 따라 마지막 성공 Quote는 기간 제한 없이 평가에 사용하되 공급자 장애가 숨지 않도록 모든 시도와 연속 실패·복구를 관측합니다.

공통 `CommandEnvelope`, `ActorContext`, typed Result, Outbox·Inbox 형식은 [모듈 상세 설계 규약](../../../../governance/module-design-standard.md)을 사용합니다. 추가 근거는 [Portfolio Context 불변식](../../requirements.md), [자산 자동 처리 흐름](../../../../system/flows.md), [데이터 소유권](../../../../cross-cutting/data-ownership.md), [보안 경계](../../../../cross-cutting/security-privacy.md), [테스트 전략](../../../../governance/test-strategy.md)입니다.

## 2. 모듈 경계와 책임

이 모듈이 소유합니다.

- 주식·ETF·펀드·채권·현금·수동·코인·실물 금 Position의 수량, 평균단가, 가격 단위, 마지막 정상 시세와 version
- Position과 Quote를 이용한 보유 평가액·계좌 원가·계좌 평가액 계산 Policy
- instrument 검색과 시장별 Quote의 공급자 중립 내부 계약
- 시장에 맞는 Provider 선택, 외부 응답 정규화와 실패 분류
- `RevalueAssetWorkflow`의 Position participant와 자산별 일일 평가 Application job
- `PositionChanged.v1`의 단일 producer

이 모듈이 소유하지 않습니다.

- AssetAccount의 최종 balance·costBasis·활성 상태와 Snapshot 저장: [자산 포트폴리오](../portfolio/requirements.md)
- 자동 납입·상환: [자산 자동화](../asset-automation/requirements.md)
- 배당 상태 전이와 KIND 원문 parsing 계약: [배당](../dividends/requirements.md)
- Scheduler runtime, 공통 retry·dead letter·관측 구현: [외부 운영](../../../../supporting-platform/modules/external-operations/requirements.md)
- Naver·Nasdaq·Upbit·금 시세의 원문 DTO와 SDK 타입

Position 변경과 부모 Asset valuation은 Event 왕복으로 맞추지 않습니다. 두 기능 participant가 만든 intent를 `RevalueAssetWorkflow`가 하나의 Portfolio Unit of Work로 commit합니다.

현재 Web 호환 경로처럼 Position을 먼저 쓰고 부모 Asset을 별도로 재계산하거나 여러 Position mutation을 `Promise.all`로 실행하는 방식은 목표 Adapter에서 금지합니다. 이 경로는 migration 중 Characterization test로만 유지하고 새 `ManagePosition`이 연결된 뒤 제거합니다.

## 3. 공개 계약

### 3.1 공개 DTO와 Market 결과

```ts
type InstrumentMarketV1 =
  | 'KRX'
  | 'US'
  | 'KOFIA_FUND'
  | 'UPBIT_KRW'
  | 'MANUAL'
  | 'PHYSICAL_GOLD';

type InstrumentExchangeV1 =
  | 'KOSPI'
  | 'KOSDAQ'
  | 'KONEX'
  | 'NASDAQ'
  | 'NYSE'
  | 'AMEX';

type InstrumentTypeV1 =
  | 'STOCK'
  | 'ETF'
  | 'ETN'
  | 'FUND'
  | 'BOND'
  | 'CASH'
  | 'CRYPTO'
  | 'PHYSICAL_GOLD'
  | 'MANUAL';

type PositionKindV1 =
  | 'stock'
  | 'etf'
  | 'etn'
  | 'fund'
  | 'bond'
  | 'cash'
  | 'manual'
  | 'crypto'
  | 'physical-gold';

interface InstrumentRefV1 {
  market: InstrumentMarketV1;
  exchange?: InstrumentExchangeV1;
  instrumentType: InstrumentTypeV1;
  code: string;
  name: string;
  currency: string;
  priceScale: number; // 가격 한 단위가 나타내는 수량, 일반 종목 1·국내 펀드 기준가 1,000
}

interface PositionMutationPayloadV1 {
  operation: 'add' | 'update' | 'delete';
  assetId: string;
  positionId?: string;
  expectedAssetVersion: number;
  expectedPositionVersion?: number;
  kind?: PositionKindV1;
  instrument?: InstrumentRefV1;
  quantity?: number;
  averagePrice?: number;
  manualCurrentPrice?: number;
}

interface MarketQuoteObservationV1 {
  instrument: InstrumentRefV1;
  sourcePrice: number;
  sourcePreviousClose: number;
  sourceCurrency: string;
  observedAt: string;
  provider: string;
}

interface ExchangeRateObservationV1 {
  pair: string; // USD/KRW
  rate: number; // quote currency per base currency
  rateDate: string; // Frankfurter 응답의 YYYY-MM-DD 기준일
  observedAt: string; // 응답을 검증해 수신한 UTC Instant
  provider: 'frankfurter-v2';
}

interface QuoteV1 {
  sourceQuote: MarketQuoteObservationV1;
  exchangeRate?: ExchangeRateObservationV1; // sourceCurrency=KRW면 없음
  priceInWon: number;
  previousCloseInWon: number;
  quoteObservedAt: string;
  exchangeRateDate?: string;
  exchangeRateObservedAt?: string;
}

interface PositionReadModelV1 {
  schemaVersion: 1;
  positionId: string;
  assetId: string;
  householdId: string;
  kind: PositionKindV1;
  instrument: InstrumentRefV1;
  quantity: number;
  averagePrice?: number;
  lastSourceQuote?: MarketQuoteObservationV1;
  lastQuote?: QuoteV1;
  evaluatedPriceSource: 'quote' | 'average-price';
  evaluatedAmountInWon: number;
  costBasisInWon: number;
  aggregateVersion: number;
  updatedAt: string;
}

interface InstrumentSearchItemV1 {
  instrument: InstrumentRefV1;
  relevanceRank: number;
}

interface InstrumentSearchPageV1 {
  items: readonly InstrumentSearchItemV1[];
  truncated: boolean;
  catalogAsOf?: string;
  catalogVersion?: string;
  stale?: boolean;
}

interface InstrumentCatalogManifestV1 {
  schemaVersion: 1;
  catalogVersion: string;
  snapshotObject: string;
  snapshotGeneration: string;
  asOfDate: string;
  publishedAt: string;
  sha256: string;
  itemCount: number;
  sources: readonly { provider: string; asOfDate: string; itemCount: number }[];
}

interface AccountValuationResultV1 {
  assetId: string;
  currentBalance: number;
  costBasis: number;
  assetVersion: number;
  updatedPositionIds: readonly string[];
  noDataPositionIds: readonly string[];
  failed: readonly { positionId: string; code: string; retryable: boolean }[];
}

interface DailyValuationPagePayloadV1 {
  runId: string;
  asOf: string;
  cursor?: string;
  pageSize: number;
}

interface DailyValuationPageResultV1 {
  runId: string;
  asOf: string;
  nextCursor?: string;
  completed: boolean;
  succeeded: readonly string[];
  noData: readonly { assetId: string; code: string }[];
  retryableFailed: readonly { assetId: string; code: string; retryKey: string }[];
  permanentFailed: readonly { assetId: string; code: string }[];
  snapshotProjectionStatus: 'queued' | 'up-to-date' | 'retryable-failure';
}
```

Market Data Output Port는 다음 union을 사용합니다. 이는 공급자 Adapter와 Application 사이의 내부 계약이며 Provider 원문을 노출하지 않습니다.

```text
Success<MarketQuoteObservationV1 | ExchangeRateObservationV1>
NoData(reason: INSTRUMENT_NOT_FOUND | QUOTE_NOT_PUBLISHED | MARKET_CLOSED_NO_QUOTE | EXCHANGE_RATE_NOT_OBSERVED)
RetryableFailure(code: TIMEOUT | RATE_LIMITED | PROVIDER_UNAVAILABLE, retryAfter?)
ContractFailure(code: AUTH_REJECTED | RESPONSE_SCHEMA_CHANGED | UNSUPPORTED_MARKET)
InvalidData(code: NON_FINITE_PRICE | NEGATIVE_PRICE | INVALID_EXCHANGE_RATE)
```

`Success`의 0원 가격은 공급자가 명시적으로 반환한 유효 데이터로 보존합니다. `NoData`나 실패를 0원 Quote로 생성하지 않습니다. 공개 Query에서는 `InvalidData`를 `ContractFailure(INVALID_PROVIDER_DATA)`로 안정화하되 운영 detail에는 원래 분류를 보존합니다.

### 3.2 Input Port

| 이름·종류 | 호출자 | 입력 | 결과 | 권한 | 일관성 | 멱등성 |
|---|---|---|---|---|---|---|
| `ManagePosition` Command | Web/API | `CommandEnvelope<PositionMutationPayloadV1>` | `Success<PositionReadModelV1>`, `ValidationError`, `NotFound`, `Conflict` | `portfolio.position.write` | `RevalueAssetWorkflow`: Position + Asset + receipt + Outbox | envelope key + 두 aggregate version |
| `RevaluePositions` Command | Web refresh, Scheduler | assetId, expected asset version, quote batch | `Success<AccountValuationResultV1>`, `PartialFailure`, `Conflict` | `portfolio.position.revalue` | 자산 하나의 Context UoW | quote batch key + versions |
| `RefreshAccountPrices` Command | Web | assetId, requestedAt | `Success<AccountValuationResultV1>`, `PartialFailure`, `RetryableFailure` | `portfolio.position.revalue` | 외부 조회 뒤 자산 하나씩 UoW | envelope key; Provider 호출 결과는 transaction 밖 cache |
| `RefreshHouseholdPrices` Workflow | 자산 메인 페이지 | householdId, requestedAt; target 목록은 서버 도출 | `Success<DailyValuationPageResultV1>`, `PartialFailure`, `RetryableFailure` | `portfolio.position.revalue` | active 시세 연동 자산 전체를 내부 page 처리 | household+scope single-flight, 30초 window |
| `RunDailyAssetValuation` Workflow | Scheduler Adapter | `CommandEnvelope<DailyValuationPagePayloadV1>` | `Success<DailyValuationPageResultV1>`, `PartialFailure`, `RetryableFailure` | `portfolio.job.daily-valuation` SystemActor | 자산별 commit, page checkpoint | runId + page cursor; 자산별 child key |
| `PublishInstrumentCatalog` Workflow | 06:00 Scheduler Adapter | runId, `asOfDate` | `Success<InstrumentCatalogManifestV1>`, `PartialFailure`, `Conflict(CATALOG_GENERATION_CHANGED)`, `RetryableFailure`, `ContractFailure` | `portfolio.job.instrument-catalog` SystemActor | snapshot upload → manifest publish → retention 정리 | `asOfDate:catalogSchemaVersion` |
| `PurgeAssetHoldingsParticipant` Context-private Process Command | `AssetPurgeProcess` | `AssetPurgePageCommandV1` | `Success<AssetPurgePageResultV1>`, `Forbidden`, `Conflict`, `RetryableFailure` | `portfolio.asset.purge.process` SystemActor | Position·history page + purge receipt | processId+participant+cursor |
| `ListHoldings` Query | Web, Dividends | assetId, cursor | `Success<PositionPageV1>`, `NoData`, `Forbidden` | `portfolio.position.read` | 읽기 | 해당 없음 |
| `QueryPositionHistory` Query | Dividends, 운영 | instrument, `aroundDate`, cursor | `Success<PositionHistoryPageV1>`, `NoData`, `RetryableFailure`, `ContractFailure` | `portfolio.position.history.read` | 선택적 Projection 읽기 | 해당 없음 |
| `SearchInstruments` Query | Web | market scope, query, limit≤10 | `Success<InstrumentSearchPageV1>`, `ValidationError`, `NoData`, `RetryableFailure`, `ContractFailure` | `portfolio.market.read` | catalog snapshot 읽기; Quote 외부 호출 없음 | 해당 없음 |
| `GetQuote` Query | Web, Application | instrument | `Success<QuoteV1>`, `NoData`, `RetryableFailure`, `ContractFailure` | `portfolio.market.read` | 외부 조회 | 해당 없음 |

`SearchStocks`, `SearchCrypto`, `GetStockQuote`, `GetCryptoQuote`, `GetGoldQuote`는 기존 호출자를 위한 V1 inbound Facade이며 위 두 Query DTO로 변환합니다. 신규 소비자는 통합 계약을 사용합니다. 빈 검색어는 신규 계약에서 `ValidationError(SEARCH_QUERY_REQUIRED)`이며, 레거시 Facade만 전환 기간에 빈 결과로 매핑할 수 있습니다.

`DailyValuationPageResultV1`은 `runId`, `asOf`, `nextCursor`, `completed`, `succeeded[]`, `noData[]`, `retryableFailed[]`, `permanentFailed[]`, `snapshotProjectionStatus`를 구분합니다. 실패한 대상의 재시도 key를 성공 대상과 분리합니다.

요구사항 문서의 `CalculateHoldingValue`, `CalculateAccountValuation`은 Domain Policy의 순수 연산이며 외부 wire API가 아닙니다. Web·Scheduler Application은 같은 Policy를 호출하고 외부 소비자는 `RevaluePositions` 결과를 사용합니다.

### 3.3 권한과 tenant

Role→Capability 매핑은 Access가 소유합니다. 모든 Query·Command는 `ActorContext.householdId`와 대상 Asset·Position의 household 일치를 검증합니다. `portfolio.job.daily-valuation`은 Scheduler `SystemActor`만 가지며 일반 클라이언트는 임의 runId·asOf로 전체 가구 job을 실행할 수 없습니다.

## 4. Domain 모델과 불변식

### 4.1 Position Aggregate

| 모델 | 상태 | 불변식 |
|---|---|---|
| `Position` Aggregate | id, householdId, assetId, kind, instrument, quantity, averagePrice, lastQuote, version | Holdings만 Writer이며 Asset 존재·가구 범위가 일치해야 합니다. |
| `Quantity` | 0 이상의 유한 수 | 삭제 외 mutation에서 음수·NaN·Infinity를 거부합니다. |
| `UnitPrice` | 0 이상의 유한 원 단위 값 | 0은 유효 값, 부재와 실패는 별도 상태입니다. |
| `MarketQuoteObservation` | 원 통화 가격 + observedAt + provider | 환율 성공 여부와 독립적으로 최신 성공값을 보존하고 Provider 원문·fallback 추정값을 포함하지 않습니다. |
| `ExchangeRateObservation` | pair + 양의 rate + rateDate + observedAt + `frankfurter-v2` | 통화쌍마다 최신 성공 관측 하나를 기간 제한 없이 제공하며 임의 고정·평균·1:1 값과 보조 Provider 결과를 만들지 않습니다. |
| `WonValuationQuote` | 원 Quote 관측 + 선택적 환율 관측 + KRW 가격 | 외화 환산은 사용한 두 observedAt을 보존하고 둘 사이의 최대 skew를 검증하지 않습니다. |
| `InstrumentRef` | market + 선택 exchange + instrumentType + 정규 code | 넓은 market이 Provider routing의 근거이고 exchange는 종목 정체성·표시 정보입니다. Provider 이름을 market identity로 사용하지 않습니다. |

Position에 Quote가 한 번도 없으면 평가가는 평균단가를 사용합니다. Quote 갱신 실패 시 기존 `lastQuote`를 지우거나 0으로 바꾸지 않고, 성공 후 시간이 얼마나 지났는지와 무관하게 그 가격과 원래 `quoteObservedAt`·선택적 `exchangeRateObservedAt`을 계속 사용합니다. 해당 refresh 결과에는 실패 상태를 남기며 공급자가 성공으로 반환한 0원만 lastQuote로 저장하고 실제 0원 평가로 관찰합니다.

외화 Position은 `lastSourceQuote`와 통화쌍별 `ExchangeRateObservation`을 독립적으로 갱신합니다. [DEC-053](../../../../governance/decisions.md#dec-053)의 `ForeignCurrencyValuationPolicy`는 각 입력이 자체 사용 가능 정책을 통과하면 두 관측의 시간 차이를 추가로 제한하지 않고 결합합니다. [DEC-060](../../../../governance/decisions.md#dec-060)에 따라 환율 성공 관측은 기간 제한 없이 사용 가능하며, Frankfurter 호출 실패나 응답 `rateDate`가 저장값보다 오래되면 저장된 관측을 변경하지 않습니다. 환율 성공 이력이 전혀 없고 이전 정상 `lastQuote`도 없을 때만 `NoData(EXCHANGE_RATE_NOT_OBSERVED)`이며, 이전 정상 환산이 있으면 부분 실패로 그 값을 유지합니다.

### 4.2 평가 Policy

- 주식·ETF·ETN·채권·수동·현금: `quantity × (lastQuote.price ?? averagePrice)`
- 펀드: `quantity × (lastQuote.price ?? averagePrice) ÷ priceScale`; 국민성장펀드 C-e의 `priceScale`은 기준가 공시 단위인 1,000좌입니다.
- 코인: 같은 식을 적용하되 Position 중간값의 정밀도를 보존합니다.
- 실물 금: 정규화한 돈 단위 수량 × 원/돈 금 시세입니다.
- 금 ETF: KRX 주식 Position과 같은 방식을 사용합니다.
- cost basis: 일반 종목은 `quantity × averagePrice`, 펀드는 `quantity × averagePrice ÷ priceScale`; 값이 없으면 0으로 명시하되 잘못된 숫자와 0 이하 `priceScale`은 거부합니다.

`CalculateAccountValuationPolicy`가 Web과 Scheduler의 유일 계산 구현입니다. 각 항목을 Provider 실패로 0 처리하지 않고 기존 정상 Quote 또는 “Quote가 전혀 없음”일 때만 평균단가 fallback을 사용합니다. Position 중간값은 필요한 정밀도를 유지하고, Asset에 반영하는 계좌 `currentBalance`와 `costBasis` 합계는 이 Policy의 마지막 단계에서 각각 `Math.round`해 원 단위 정수로 만듭니다.

외화 환산은 `ForeignCurrencyValuationPolicy(sourceQuote, exchangeRate)`의 단일 구현을 사용합니다. `priceInWon = round(sourcePrice × rate)`, `previousCloseInWon = round(sourcePreviousClose × rate)`이며, 결과에는 `quoteObservedAt`, `exchangeRateDate`, `exchangeRateObservedAt`을 각각 기록합니다. KRW Quote에는 환율을 적용하지 않습니다. 화면·수동 갱신·23:55 job이 서로 다른 환산 공식을 구현하지 않습니다.

구형 `memo`의 `N돈`은 Domain 규칙이 아니라 `LegacyGoldQuantityMapper`가 `Quantity`로 정규화합니다. 정규 수량 필드가 있으면 그것이 우선이며, migration 후 memo parsing을 제거합니다.

### 4.3 검색·routing Policy

`MarketRoutingPolicy`는 KRX→Naver 국내, US→미국 종목 Quote Adapter+USD/KRW, KOFIA_FUND→해당 운용사 기준가 Adapter, UPBIT_KRW→Upbit, PHYSICAL_GOLD→Gold provider로 라우팅합니다. 현재 미국 Adapter 구현·공급자 이름이 Nasdaq이더라도 `exchange=NYSE|NASDAQ|AMEX`인 미국 종목 전체를 `market=US`로 다루며 Provider 이름을 종목 market으로 저장하지 않습니다. 금 ETF는 PHYSICAL_GOLD가 아니라 KRX instrument입니다. Quote routing과 종목 검색 catalog는 분리하며 검색 요청에서 거래소 공급자를 실시간 fan-out하지 않습니다.

주식·ETF·ETN 검색은 DEC-035의 정규화된 최신 성공 `InstrumentCatalogSnapshot`만 입력으로 사용합니다. exact code, code prefix, name prefix, name contains 순으로 점수를 매기고 market·code로 안정 tie-break하여 최대 10개를 반환합니다. 응답에는 `catalogAsOf`, `catalogVersion`, `stale`을 포함할 수 있으며 오래된 snapshot을 빈 결과로 바꾸지 않습니다. 코인은 별도 Upbit catalog에서 `KRW-` market만 허용합니다.

## 5. Application Use Case 상세

### 5.1 `ManagePosition`과 `RevalueAssetWorkflow`

1. Inbound Adapter가 인증·schema를 검증합니다.
2. Application이 tenant, capability, receipt를 확인하고 Portfolio 공개 Query로 대상 Asset과 version을 읽습니다.
3. mutation DTO와 기존 Position을 Domain에 전달해 `PositionChangeIntent`를 만듭니다.
4. 변경 후 자산의 전체 Position 집합을 `CalculateAccountValuationPolicy`로 계산합니다.
5. Portfolio Core의 `AssetValuationParticipant.prepare`가 `AssetValuationIntent`를 만듭니다.
6. `RevalueAssetWorkflow`가 두 intent, receipt, `PositionChanged.v1`, `AssetValuationChanged.v1`을 `PortfolioRevaluationUnitOfWork`에 전달합니다.
7. UoW가 Position·Asset version을 다시 확인하고 한 transaction으로 commit합니다.

participant는 Firestore transaction handle을 받거나 직접 commit하지 않습니다. version 경합이면 최신 상태로 intent를 다시 계산하되, 수동 mutation payload와 이미 수집한 Quote만 재사용합니다.

Position write가 성공하고 Asset write가 실패한 상태, 또는 그 반대 상태는 성공 결과가 될 수 없습니다. 두 Aggregate 중 하나의 version mismatch도 전체 `Conflict(REVALUATION_VERSION_MISMATCH)`이며 write set을 적용하지 않습니다.

### 5.2 Quote 조회와 계좌 갱신

1. Position 목록을 읽고 market별 요청을 묶습니다.
2. 외부 Provider를 Firestore transaction 밖에서 호출합니다.
3. ACL이 원 통화 Quote와 환율 응답을 서로 독립된 Market 결과 union으로 정규화하고, Operations Adapter가 시도별 구조화 log·metric과 provider+operation Health 상태를 기록합니다.
4. 각 `Success` 관측은 상대 Provider 결과와 무관하게 자신의 최신 성공 저장 intent가 됩니다. `ForeignCurrencyValuationPolicy`는 저장된 최신 사용 가능 원 Quote·환율을 읽어 skew 제한 없이 KRW Quote intent를 만듭니다.
5. 환율 성공 이력이 없으면 해당 외화 환산을 NoData로 남기고, 한쪽 실패 시 기존 정상 KRW Quote를 0원·미완성 새 Quote로 덮어쓰지 않습니다. 성공·실패가 섞여도 자산 하나의 전체 평가액은 “새 정상 환산 + 실패 Position의 기존 정상 Quote/허용된 최초 fallback”으로 한 번 계산합니다.
6. 자산 하나의 Position 변경과 Asset valuation을 Workflow로 원자 commit합니다.
7. 결과는 대상별 상태를 보존한 `Success` 또는 `PartialFailure`입니다.

transaction callback 재실행은 Provider를 다시 호출하지 않습니다. 공급자 실패가 전부이면 Position·Asset Canonical write 없이 실패 결과만 반환하지만, transaction 밖의 운영 log·Health 상태·필요한 경보는 반드시 남깁니다.

`RefreshAccountPrices`는 개별 자산 수동 갱신, `RefreshHouseholdPrices`는 자산 메인 페이지 진입 시 전체 갱신입니다. 전체 갱신은 target 총수 상한 없이 서로 다른 Quote target을 50개씩 page 처리하고, 한 run에서 외부 호출 최대 5개·요청당 timeout 10초·retryable 결과 총 3회 제한을 적용합니다. 같은 가구·범위의 30초 내 요청은 실행 중이거나 직전에 완료된 동일 run을 재사용합니다.

### 5.3 `RunDailyAssetValuation`

1. Scheduler Adapter는 매일 23:55 `Asia/Seoul`에 runId, asOf, page cursor만 전달합니다.
2. Application은 Portfolio의 active Asset page를 조회합니다. Portfolio Mapper는 레거시 `isActive` 누락·true를 active, false를 deleted로 변환하므로 Web과 job이 같아지고 deleted는 평가 대상에서 제외됩니다.
3. 국내·미국 주식·ETF·ETN, 지원 펀드, KRW 코인, 실물 금의 서로 다른 Quote target을 결정적으로 정렬해 50개씩 page 처리하고, 각 page에서 최대 5개 Provider 호출로 5.2 절을 실행합니다.
4. 각 자산 commit은 독립적이며 결과를 `succeeded/noData/retryable/permanent`로 집계합니다.
5. 마지막 page까지 모든 target이 success·NoData·permanent failure·retry 소진 중 하나의 terminal 결과에 도달한 뒤 context-private `AssetSnapshotProjectorInput`에 해당 날짜 projection을 요청합니다. Projector는 최신 성공 Quote와 실패 target의 마지막 성공 Quote가 반영된 Portfolio Query를 읽고 현재·직전 owner/type의 합집합을 upsert하며, 사라진 scope와 자산 0개 가구에는 명시적 0원을 기록합니다.
6. 실패한 자산만 고유 child idempotency key로 재시도하고 완료된 자산은 receipt 결과를 재생합니다.

전체 가구를 하나의 transaction으로 묶지 않습니다. Snapshot 결과는 성공 자산만이 아니라 해당 시점의 모든 Canonical Asset을 읽으므로 부분 성공 뒤에도 내부적으로 일관된 합계를 가집니다.

Production composition은 `RefreshAccountPrices`·`RefreshHouseholdPrices`와 동일한
`PortfolioRuntimeApplication.refreshMarketValues`를 23:55 Adapter에서도 재사용합니다.
예약 실행은 가구별 refresh phase를 먼저 끝내고 별도 snapshot phase로 넘어가므로,
중단 시 저장된 Operations checkpoint 이전에는 Snapshot을 만들지 않습니다. Quote target은
Application 내부에서 50개 page·동시성 5·retryable 결과 총 3회로 처리하고, 실패 target은
마지막 성공 Quote를 그대로 둔 terminal 결과로 기록합니다. Snapshot Projector는
`households/{householdId}/assetSnapshots/{localDate}`를 Canonical key로 upsert하면서
전환 기간의 `asset_history` Projection도 같은 transaction에서 갱신합니다. 같은 입력의
재실행은 Canonical payload를 비교해 write 없이 replay하고 최초 `createdAt`을 보존합니다.

### 5.4 조회

`ListHoldings`는 `(instrument.market, instrument.code, positionId)`의 결정 정렬과 opaque cursor를 사용합니다. `QueryPositionHistory(aroundDate)`는 보존된 snapshot을 `snapshotDate ASC, observedAt ASC, sourceVersion ASC`로 page 조회하며 현재 Canonical Position도 조회 시점 날짜의 후보로 포함할 수 있습니다. Holdings는 과거 수량을 자체 추정하지 않고 날짜·수량·observedAt·source version 사실만 반환합니다. Dividends가 [DEC-014](../../../../governance/decisions.md#dec-014)의 최근접 날짜, 이전 날짜 동률 우선, 선택 날짜의 최종 관찰 규칙을 소유합니다.

### 5.5 `PublishInstrumentCatalog`와 검색 cache

1. 06:00 Scheduler가 국내·미국 catalog source를 호출하고 Provider DTO를 `InstrumentRefV1` 집합으로 정규화합니다.
2. 중복 code·market, 필수 필드, 허용 instrument kind, 최소 종목 수, source별 count와 checksum을 검증합니다. 하나라도 contract failure이면 publish하지 않습니다.
3. `market-catalog/v1/snapshots/{asOfDate}/{catalogVersion}.json.gz` immutable 객체를 업로드하고 다시 metadata·checksum을 검증합니다.
4. 검증된 객체를 가리키는 `market-catalog/v1/latest.json` manifest를 generation precondition으로 교체합니다. 검색은 이 단계 전 snapshot을 보지 않습니다.
5. manifest 교체 성공 뒤 서로 다른 최근 성공일 3개의 일별 snapshot만 남기고 이전 객체를 정리합니다. 같은 성공일의 멱등 재실행은 보존 개수를 늘리지 않습니다. 실패한 run은 기존 manifest와 snapshot을 유지합니다.
6. 검색 함수의 `InstanceMemoryCatalogCache`는 `{manifestGeneration, loadedAt, snapshot}`을 모듈 전역에 둡니다. `loadedAt + 5분` 전에는 그대로 사용하고, 이후 manifest만 읽어 generation이 같으면 TTL만 연장합니다.
7. generation이 바뀌면 새 snapshot의 schema·checksum·itemCount 검증 후 cache reference를 한 번에 교체합니다. 교체 실패 시 기존 cache가 있으면 `stale=true`로 제공하고, cold cache이면 `RetryableFailure(CATALOG_UNAVAILABLE)`를 반환합니다.

이 cache는 코드로 구현해야 하지만 Redis·Firestore cache 문서·별도 상시 서버를 만들지 않습니다. Cloud Functions/Vercel 같은 서버리스 인스턴스가 제공하는 프로세스 메모리를 사용할 뿐이며, 언제든 사라질 수 있다는 전제로 Storage Adapter가 항상 재구축 경로를 제공합니다. `stocks.json` import는 목표 Composition Root와 테스트에서 금지합니다.

### 5.6 수동 영구 purge participant

`PurgeAssetHoldingsParticipant`는 일반 자산 삭제 경로에서 호출되지 않습니다. 수동 `AssetPurgeProcess`가 전달한 processId·householdId·assetId와 Core의 `purging` 상태를 확인한 뒤, `(dataKind ASC, stableId ASC)` 결정 순서로 해당 Asset의 Position과 Position history를 page 삭제합니다. 한 page의 삭제와 receipt를 같은 UoW로 commit하고, 완료 page 재호출은 저장된 결과를 재생합니다. 다른 Asset의 Position이나 같은 종목의 타 Asset history는 조회·삭제하지 않습니다.

## 6. Port 설계

### 6.1 Context-private participant

`PositionRevaluationParticipant.prepare(command, positions, quoteResults)`는 다음 값만 반환합니다.

```text
PositionRevaluationIntent =
  positionWrites[]
  expectedPositionVersions
  accountValuation(currentBalance, costBasis)
  positionEventDrafts[]
  perTargetResults[]
```

`RevalueAssetWorkflow`는 `PositionRevaluationParticipant`의 결과를 Portfolio Core `AssetValuationParticipant`의 `AssetValuationIntent`와 결합합니다. 유일한 commit Port는 두 모듈이 공유하는 `PortfolioRevaluationUnitOfWork`입니다.

### 6.2 Output Port

| Port | 책임 | contract fixture |
|---|---|---|
| `PositionRepository` | tenant·asset별 Position, version precondition | Fake/Firestore 공통 CRUD·경합 suite |
| `PortfolioAssetQueryPort` | Asset 존재·active/deleted/purging·version과 평가 적용 participant 접근 | active, deleted, purging, missing, version conflict |
| `PortfolioRevaluationUnitOfWork` | Position + Asset + receipt + Outbox 원자 commit | callback 2회, conflict, rollback |
| `HoldingsPurgePageUnitOfWork` | 한 Asset의 Position·history page 삭제와 purge receipt 원자 commit | replay, page 중간 실패, 타 Asset 혼입 거부 |
| `DomesticMarketPort` | KRX 검색·Quote | 성공, NoData, timeout, HTML/schema drift, 0원 |
| `UsMarketPort` | 미국 전체 종목 검색·USD Quote | 같은 실패군 + 잘못된 exchange·currency |
| `DomesticInstrumentCatalogSourcePort`, `UsInstrumentCatalogSourcePort` | 일별 국내·미국 전체 종목 원천 수집 | 정상, 빈 목록, 중복, 일부 source 실패, schema drift |
| `InstrumentCatalogSnapshotStorePort` | immutable gzip snapshot 업로드·조회, latest manifest 조건부 교체, 서로 다른 최근 성공일 3개 정리 | generation conflict, checksum mismatch, 네 번째 성공일, 같은 날짜 재실행, publish 전 실패 |
| `InstrumentCatalogCachePort` | 인스턴스 메모리 snapshot 재사용과 원자 reference 교체 | 5분 전/후, 같은·변경 generation, warm failure, cold failure, 동시 reload |
| `FundNavPort` | 펀드 클래스별 일별 기준가 | 미래 날짜 제외, 클래스 불일치, HTML/schema drift, 기준가 단위 |
| `ExchangeRatePort` | Frankfurter v2 USD/KRW 관찰값 | 정상 JSON, base·quote 불일치, 미래·과거·같은 rateDate, 0/음수, timeout·429·schema drift |
| `ExchangeRateObservationRepository` | 통화쌍별 최신 성공 환율 관측 | 최초 부재, 독립 갱신, version conflict, 더 오래된 rateDate, 장기 보존 |
| `CryptoMarketPort` | Upbit KRW 검색·Quote | KRW 필터, rate limit, malformed number |
| `GoldMarketPort` | 원/돈 실물 금 Quote | 성공, 실패, 고정 fallback 금지 |
| `PositionHistoryPort` | 오늘의 current Position 또는 선택적 과거 as-of 수량 Query/Projection | current exact, history disabled, exact past, gap, stale |
| `AssetSnapshotProjectorInput` | page 완료 후 context-private projection 요청 | 중복 요청, 부분 성공, rebuild |
| `JobResultSink`, `ObservabilityPort`, `ProviderHealthRecorderPort`, `Clock` | 운영 결과·시도별 구조화 관측·provider health·서울 날짜 | 대상별 결과, 연속 실패·복구, clock boundary |

Market Data Adapter는 기능이 정의한 Port를 구현합니다. Operations Scheduler는 이 모듈의 Input Port를 호출할 뿐 Provider 선택이나 평가 계산을 구현하지 않습니다.

## 7. 저장·트랜잭션·동시성

### 7.1 목표 저장 모델

| 논리 데이터 | 목표 key | Writer | version/key |
|---|---|---|---|
| Position | `households/{householdId}/assets/{assetId}/positions/{positionId}` | Holdings | `aggregateVersion` |
| ExchangeRateObservation | `marketData/exchangeRates/{pair}` 또는 동등한 server-only Context 저장소 | Holdings Market Data | pair별 version + rateDate + observedAt; Provider 원문 없음 |
| Position history | `.../positionHistory/{snapshotId}` | Holdings projector, DEC-014에 따라 활성화 | instrument + LocalDate + source version |
| Revaluation receipt | Context command receipt | RevalueAssetWorkflow | idempotency key + payload hash |
| Instrument catalog snapshot | Cloud Storage `market-catalog/v1/snapshots/{asOfDate}/{catalogVersion}.json.gz` | `PublishInstrumentCatalog` | immutable object generation + sha256 |
| Instrument catalog latest manifest | Cloud Storage `market-catalog/v1/latest.json` | `PublishInstrumentCatalog` | manifest generation precondition |

Position DTO에는 `schemaVersion`, server timestamp, aggregateVersion을 둡니다. Provider 이름은 Quote provenance로 보존할 수 있지만 원문 payload·HTML은 저장하지 않습니다.

자산 하나의 revaluation transaction은 성공 Position write, Asset valuation/version, receipt, 두 Event의 Outbox를 포함합니다. 실패 Quote는 write set에 넣지 않습니다. expected Position/Asset version이 하나라도 다르면 전체를 rollback하고 `Conflict(REVALUATION_VERSION_MISMATCH)`를 반환합니다.

### 7.2 job과 checkpoint

- page cursor는 정렬된 Asset ID 범위를 나타내는 opaque token입니다.
- page 완료 뒤에만 next cursor를 job result sink에 기록합니다.
- 자산별 child key는 `runId:assetId:quoteBatchId`이며, 완료 receipt가 있으면 Provider를 다시 호출하지 않고 결과를 재생할 수 있습니다.
- Provider 결과 cache 보존 시간이 끝났다면 새 quoteBatchId로 다시 조회하되 이미 commit된 asset/version은 중복 적용하지 않습니다.

### 7.3 전환

Legacy Mapper는 `stock_holdings`, `crypto_holdings`, Asset의 구형 금 필드를 읽습니다. 먼저 Web과 Functions의 평가 계산을 Domain Policy 하나로 교체한 뒤 Writer를 Workflow로 모읍니다. V1/V2 shadow read에서는 Position 수량·원가·마지막 시세, Asset 합계, 활성 해석, 동일 fixture의 Web/job 결과 hash를 비교합니다. 종목 검색은 Cloud Storage snapshot과 기존 `stocks.json` 결과를 일시 shadow 비교하되, MARKET-005 contract 통과 뒤 `stocks.json` reader와 파일을 함께 제거하며 fallback으로 남기지 않습니다.

## 8. Event·Projection·외부 연동

### 8.1 Event

`PositionChanged.v1`의 producer는 Holdings 하나입니다. payload는 `assetId`, `positionId`, instrument ref, kind, previous/current quantity, evaluatedAmountInWon, quoteObservedAt, changeReason과 aggregate version만 포함합니다. Provider 원문·사용자 메모를 넣지 않습니다.

같은 `RevalueAssetWorkflow` transaction에서 Portfolio Core가 `AssetValuationChanged.v1`도 생산합니다. 두 Event는 Reporting, 선택적 Position history, AssetSnapshot 같은 downstream 전용이며 강한 쓰기를 완성하는 명령으로 사용하지 않습니다.

### 8.2 Position history

Position history를 활성화하면 `PositionChanged.v1` Consumer가 `(eventId, handlerName)`으로 멱등 처리하고 Position aggregateVersion을 검사합니다. [DEC-048](../../../../governance/decisions.md#dec-048)에 따라 자동 TTL 없이 보존하고 정상 화면 조회에서는 사용하지 않으며, 배당 복구·감사·재구축에만 제공합니다. 해당 Asset 또는 가구의 명시적 수동 영구 purge에서만 제거하고 현재 수량 fallback으로 위장하지 않습니다.

### 8.3 Market Data ACL

Provider Adapter는 transport status, timeout, parse 결과를 내부 Market union으로 변환합니다. Naver 실패를 Nasdaq·추정값으로 조용히 대체하거나 금 실패를 고정 가격 성공으로 바꾸지 않습니다. 특히 환율 `ExchangeRatePort`의 목표 Adapter는 Frankfurter v2 하나뿐이며 수출입은행·네이버 HTML·다른 무료 API로 fallback하지 않습니다. 다른 Quote 유형에 fallback Provider를 도입하려면 별도 `QuoteSourceSelectionPolicy`가 provenance와 freshness를 포함한 성공 기준을 명시해야 합니다.

Frankfurter Adapter는 `GET /v2/rate/USD/KRW`의 `date`, `base`, `quote`, `rate`만 읽습니다. `base=USD`, `quote=KRW`, 유한 양수 rate, 서울 현재일보다 미래가 아닌 ISO LocalDate를 검증하고, 검증 시각을 `observedAt`으로 기록합니다. 저장값보다 과거인 `rateDate`는 `InvalidData(STALE_EXCHANGE_RATE_RESPONSE)`이며 정상 관측을 덮어쓰지 않습니다. 같은 `rateDate`의 정상 응답은 재조회 성공으로 인정하되 rate가 바뀐 경우 새 version으로 보존하여 공급자 정정을 반영합니다.

배당 공시는 배당 모듈이 정의한 `DividendDisclosurePort`를 Market Data 플랫폼 Adapter가 구현합니다. Holdings는 KIND DTO나 공시 상태를 공개하지 않습니다.

### 8.4 서버리스 장애 관측

별도 상시 서버를 도입하지 않습니다. 기존 `dailyAssetSnapshot` 계열 Firebase Scheduled Function이 Naver·Nasdaq·Frankfurter·Upbit·실물 금 Provider의 시세 갱신과 canary 상태 점검을 실행하고, `firebase-functions/logger` 구조화 로그를 Cloud Logging으로 보냅니다. Web의 Next.js 시세 Route 로그는 배포 위치에 종속되므로 장애 판정의 단일 원본으로 사용하지 않습니다.

Operations Adapter는 provider+operation별 최신 상태를 Firestore `operations/runtime/providerHealth/{provider_operation}`에 upsert합니다. 이 문서는 가격·보유수량·가구 ID를 저장하지 않고 `lastAttemptAt`, `lastSuccessAt`, `consecutiveFailedRuns`, `failureStartedAt`, `lastResultKind`, `lastErrorCode`, `alertState`, `recoveredAt`만 가집니다. Cloud Monitoring은 구조화 log·metric을 기준으로 즉시 또는 연속 실패 경보를 보내며, Firestore 상태는 운영 조회와 에이전트 진단용입니다.

금 시세 Route가 실패를 고정 가격 성공으로 바꾸면 Health Recorder까지 성공으로 오염되므로 목표 Adapter에서는 이 fallback을 제거하고 `RETRYABLE_FAILURE`, `CONTRACT_FAILURE`, `INVALID_DATA` 중 하나로 반환합니다.

## 9. 오류·보안·관측성

### 9.1 안정 오류 코드

| typed Result | 주요 code |
|---|---|
| `ValidationError` | `INVALID_QUANTITY`, `INVALID_AVERAGE_PRICE`, `INVALID_INSTRUMENT`, `SEARCH_QUERY_REQUIRED`, `UNSUPPORTED_POSITION_KIND` |
| `Forbidden` | `HOUSEHOLD_SCOPE_MISMATCH`, `POSITION_WRITE_FORBIDDEN`, `VALUATION_JOB_FORBIDDEN` |
| `NotFound` | `ASSET_NOT_FOUND`, `POSITION_NOT_FOUND` |
| `Conflict` | `POSITION_VERSION_MISMATCH`, `ASSET_VERSION_MISMATCH`, `REVALUATION_VERSION_MISMATCH`, `IDEMPOTENCY_PAYLOAD_MISMATCH` |
| `NoData` | `QUOTE_NOT_PUBLISHED`, `INSTRUMENT_NOT_FOUND`, `EXCHANGE_RATE_NOT_OBSERVED`, `HISTORY_NOT_ENABLED` |
| `RetryableFailure` | `MARKET_TIMEOUT`, `MARKET_RATE_LIMITED`, `MARKET_UNAVAILABLE`, `UOW_RETRY_EXHAUSTED` |
| `ContractFailure` | `MARKET_SCHEMA_CHANGED`, `INVALID_PROVIDER_DATA`, `STALE_EXCHANGE_RATE_RESPONSE`, `UNSUPPORTED_MARKET`, `HISTORY_UNAVAILABLE` |
| `PartialFailure` | 자산·instrument별 typed 결과와 retry key |

### 9.2 보안

- 모든 Position write와 전체 job은 서버 Command를 거칩니다.
- 타 가구 Asset ID를 이용한 직접 Position path 접근을 Rules와 Application 양쪽에서 거부합니다.
- Market credential, 원문 응답, command receipt, job checkpoint는 클라이언트에 노출하지 않습니다.
- 실시간 Position Read Contract를 제공하면 membership, parent asset household, 허용 schema 필드를 Rules로 검증합니다.

### 9.3 관측성

metric은 provider/operation/market/result 분류, quote latency·마지막 성공 이후 경과 시간, 연속 실패 수, fallback-to-average count, revaluation conflict, 자산별 job 성공·실패, snapshot lag를 기록합니다. 모든 시도는 runId, target hash, provider, operation, result kind, stable error code, attempt, latency, observedAt을 구조화 log로 남기며 가구 키·assetId 원문·자산 이름·보유수량·응답 원문·credential은 남기지 않습니다. `ContractFailure`, `InvalidData`, 인증·설정 오류는 첫 실패에 즉시 경보하고 추적 Position의 예상 밖 `NoData`·`RetryableFailure`는 예약 갱신 3회 연속 실패 시 경보합니다. 다음 성공은 Health 상태와 열린 경보를 복구합니다.

## 10. 목표 패키지 구조

```text
functions/src/contexts/portfolio/holdings/             # 목표
  domain/
    entities/position.ts
    value-objects/instrument-ref.ts
    value-objects/quote.ts
    policies/account-valuation-policy.ts
    policies/market-routing-policy.ts
    policies/instrument-search-ranking-policy.ts
  application/
    commands/manage-position.ts
    commands/refresh-account-prices.ts
    workflows/run-daily-asset-valuation.ts
    queries/list-holdings.ts
    queries/search-instruments.ts
    queries/get-quote.ts
    participants/position-revaluation-participant.ts
    participants/purge-asset-holdings-participant.ts
    event-handlers/position-history-projector.ts
    ports/in/
    ports/out/
  adapters/out/firestore/
  adapters/out/legacy/legacy-gold-quantity-mapper.ts
  public.ts

functions/src/contexts/portfolio/workflows/revalue-asset/ # 목표
functions/src/platform/market-data/                       # 목표 Provider Adapter
  naver/
  nasdaq/
  upbit/
  gold/
  exchange-rate/

web/src/features/portfolio/adapters/                      # 목표
  functions-api/
  firestore-read-model/
```

Domain은 Firebase·node-fetch·HTML parser를 import하지 않습니다. `public.ts`는 Input Port, DTO, Read Model, `PositionChanged.v1` schema와 안정 오류 code만 export합니다.

## 11. 테스트 설계

| 요구사항 ID | 테스트 수준 | 테스트 대상 | 핵심 fixture/경계값 | 관찰 결과 | Canonical 테스트 ID |
|---|---|---|---|---|---|
| HOLD-001 | Domain Unit, Application | Position·평가 Policy·ManagePosition | Quote 없음, 평균단가 100, 현금/수동, quantity 0, version conflict | Quote 미존재 시 평균단가 평가; Position+Asset 전체 commit/rollback | T-HOLD-001, T-HOLD-003 |
| HOLD-002 | Domain Unit, Contract | 코인 평가·Upbit ACL | 소수 quantity, 정수 경계 .49/.5, 성공 0원, timeout | 합계·원가는 최종 `Math.round`; 0원과 실패 결과가 다름 | T-HOLD-003, T-MARKET-001 |
| HOLD-003 | Domain Unit, Contract | 공통 `CalculateAccountValuationPolicy` | 동일 Position fixture를 Web/자산 job 경계에서 호출 | 동일 currentBalance·costBasis 계산 결과 | T-HOLD-002 |
| HOLD-004 | Application, Emulator, E2E | ManagePosition·PortfolioRevaluationUnitOfWork | Position 동시 추가, Asset/Position version 경합, 부모 write 실패, callback 2회 | 두 Aggregate·receipt·Outbox가 한 번 commit되거나 write 0건 | T-HOLD-001 |
| GOLD-001 | Domain Unit, Mapper Conformance | 금 subtype·LegacyGoldQuantityMapper | `3돈`, `3 돈`, 정규 quantity, 금 ETF | 실물 금은 돈 시세, ETF는 KRX 주식; 정규 필드 우선 | T-GOLD-001 |
| GOLD-002 | Contract, Application, Emulator | GoldMarketPort·RefreshAccountPrices | timeout, 5xx, schema drift, 고정 fallback fixture | Asset/Position 미변경, 실패 분류 반환, 추정값 성공 없음 | T-GOLD-002 |
| MARKET-001 | Contract | 시장별 ACL과 routing | KRX, US(NASDAQ·NYSE·AMEX)+USD/KRW, UPBIT_KRW, 금, 배당 disclosure fixture | 정확한 Adapter 한 개 호출, 공급자 이름과 종목 market 분리, 공급자 DTO 비노출 | T-MARKET-004 |
| MARKET-002 | Domain Unit, Application | MarketRoutingPolicy·daily job | 동일 code를 가진 KRX/US instrument | US는 Nasdaq+환율, 국내는 Naver; 시장 혼선 없음 | T-MARKET-004 |
| MARKET-003 | Domain Unit, Contract | 검색 ranking·filter | 국내 주식·ETF·ETN+미국 catalog 중복, exact/code prefix/name prefix/name contains 동률, 11건, 빈 query, 비-KRW 코인 | 네 단계 관련도 뒤 market·code tie-break로 결정적 최대 10, KRW만, 빈 query typed error | T-MARKET-005 |
| MARKET-004 | Domain Unit, Contract, Application, Operations Integration | Quote fallback·ProviderHealthRecorder | 마지막 성공 뒤 retryable 10회, NoData 3회, contract/invalid 1회, 이후 성공, 오래된 observedAt | 마지막 가격·observedAt 불변, 매 시도 log, health 누적, 즉시·3회 경보, 성공 시 해제 | T-MARKET-001 |
| MARKET-005 | Domain Unit, Contract, Application, Operations Integration | PublishInstrumentCatalog·SnapshotStore·Cache | 서로 다른 성공일 4개, 같은 날짜 재실행, 부분 실패, generation 경합, 5분 경계, warm/cold Storage 실패, checksum drift | 서로 다른 최근 성공일 3개 보존, latest 원자 교체, 같은 generation 재다운로드 없음, warm stale/cold failure, `stocks.json` 접근 없음 | T-MARKET-002 |
| MARKET-006 | Domain Unit, Contract, Application, Emulator, Operations Integration | FrankfurterExchangeRateAdapter·ForeignCurrencyValuationPolicy·ExchangeRateObservationRepository | 정상 JSON, base·quote 불일치, 주말 같은 rateDate, 더 오래된·미래 date, 0/음수, timeout·schema drift, 장기 실패, 최초 부재·이전 정상 KRW Quote | Frankfurter만 호출, rateDate·observedAt 보존, 더 오래된 응답 무변경, 장기 실패에도 마지막 성공값 사용·경보, 최초 부재만 NoData, 화면 경고·fallback 없음 | T-MARKET-003 |
| JOB-AST-001 | Application, Emulator, E2E | RefreshAccountPrices·RefreshHouseholdPrices·RunDailyAssetValuation·Snapshot 요청 | 개별 수동, 페이지 진입, 23:55 서울, 101 targets, 국내·미국·펀드·코인·금, 같은 날짜 2회, 일부 timeout | 전체 50개 page·병렬 5, 30초 중복 run 1개, 마지막 page 뒤 Snapshot, child receipt·createdAt 보존 | T-JOB-AST-001 |
| JOB-AST-002 | Domain Unit, Emulator | Portfolio 합계 연동·Projector contract | 대출/deleted, 마지막 owner·type 제거, 자산 0개 | 총·금융·owner·type과 전일 변화량 일치; 사라진 scope 0 | T-JOB-AST-001 |
| JOB-AST-003 | Mapper, Application, Emulator | legacy lifecycle 정규화·부분 실패 수렴 | isActive 누락·true·false, 자산 A 성공/B timeout, version 경합 | active/deleted가 Web/job에서 동일; 결과 범위 명시; 실패 자산 재시도로 수렴 | T-JOB-AST-002 |

추가 공통 suite는 새 ID 없이 다음을 검증합니다.

- Market Port별 성공·NoData·retryable·contract drift·invalid·유효 0원 fixture
- Provider를 transaction 밖에서 한 번만 호출하고 `RetryingUnitOfWorkFake` callback 2회에도 side effect 없음
- Fake와 Firestore Position Repository의 동일 Conformance Suite
- 타 가구 Position read/write 거부는 [공통 보안 테스트](../../../../cross-cutting/security-privacy.md)에 연결
- 같은 `PositionChanged.v1` 중복·역순 전달 시 History/Reporting 수렴
- DEC-017 논리 삭제·복구에서는 Holdings write 0건, 수동 purge에서는 해당 assetId page만 삭제하며 같은 process/cursor 재실행 결과가 동일
- DEC-018·DEC-060 장기 실패에도 lastQuote 가격·quoteObservedAt·exchangeRateDate·exchangeRateObservedAt 불변, ProviderHealth Fake/Firestore conformance, 구조화 log redaction과 경보 open/resolve
- DEC-053 원 Quote·환율 성공 순서와 observedAt 차이를 바꿔도 같은 최신 사용 가능 조합으로 수렴하고 임의 환율·별도 skew 거부가 없음

## 12. 확정 정책과 구현 순서

### 12.1 정책 상태

1. `PositionHistoryPort`는 [DEC-048](../../../../governance/decisions.md#dec-048)에 따라 수동 Asset·가구 purge 전까지 보존합니다. 누락 배당의 후보 선택은 DEC-014로 확정되었으며 Holdings는 보존된 사실만 제공합니다.
2. 마지막 성공 Quote를 기간 제한 없이 평가에 쓰는 정책은 DEC-018, 개별·페이지 진입·23:55 갱신과 내부 호출 한도는 [DEC-049](../../../../governance/decisions.md#dec-049)로 확정했습니다.
3. [DEC-053](../../../../governance/decisions.md#dec-053)에 따라 미국 등 외화 Quote와 환율은 각각의 최신 사용 가능 관측을 시간 차이 상한 없이 결합하고 두 provenance를 보존합니다.
4. 종목 catalog stale·보존·cache·fallback은 DEC-035로 확정했습니다. 환율은 [DEC-060](../../../../governance/decisions.md#dec-060)에 따라 Frankfurter v2 단일 Provider와 기간 제한 없는 마지막 성공 관측만 사용하며 두 입력 사이의 skew gate나 보조 Provider를 만들지 않습니다.

### 12.2 구현 순서

1. Web·Functions의 평가 fixture를 수집해 순수 Position·account valuation 특성화 테스트를 작성합니다.
2. Market 결과 union과 Naver·Nasdaq·Upbit·Gold contract fixture를 만들고 실패 분류를 고정합니다.
3. `MarketRoutingPolicy`와 공통 평가 Policy로 Web/job 중복 계산을 교체합니다.
4. Frankfurter v2 `ExchangeRatePort` Adapter, 통화쌍별 ExchangeRateObservation Repository와 `ForeignCurrencyValuationPolicy`를 만들고 `T-MARKET-003`으로 Web·job의 독립 관측 결합·장기 실패·단일 공급자를 고정합니다. 전환 뒤 `naverUsdKrwRate.ts`와 환율 HTML parser를 제거합니다.
5. Repository Fake와 `PositionRevaluationParticipant`를 만든 뒤 `T-HOLD-001`의 `RevalueAssetWorkflow` UoW·경합·rollback 테스트를 먼저 활성화합니다.
6. Position Writer와 Asset 반영을 Workflow 뒤로 모으고 직접 `assets` 쓰기를 차단합니다.
7. 일일 job을 page·child receipt·부분 실패 계약으로 전환하고 사라진 scope 0 intent의 `T-JOB-AST-001`과 Snapshot Projector 요청을 연결합니다.
8. Firebase Scheduled Function의 구조화 logger, ProviderHealthStore와 Cloud Monitoring 경보를 연결해 `T-MARKET-001`을 활성화합니다.
9. DEC-035의 catalog publisher·Cloud Storage snapshot/manifest Adapter·5분 memory cache를 구현하고 `T-MARKET-002` 통과 뒤 `stocks.json` reader와 파일을 제거합니다.
10. DEC-014 확정 뒤에만 Position history 저장·보존과 배당 recovery contract test를 활성화합니다.
