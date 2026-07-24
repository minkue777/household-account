# 보유종목·시장 데이터 모듈 요구사항

> 상위 Bounded Context: [Portfolio](../../requirements.md)  
> 아키텍처 역할: Position Domain / Market Data Anti-Corruption Layer  
> 상세 설계: [모듈 상세 설계](design.md)  
> 상태와 테스트 표기 규칙은 [공통 요구사항 규약](../../../../governance/conventions.md)을 따릅니다.  
> 이 문서는 `HOLD-*`, `FUND-*`, `GOLD-*`, `MARKET-*`, `JOB-AST-*` 요구사항의 단일 소유 문서입니다.

## 1. 독립 모듈 책임

보유종목·시장 데이터 모듈은 주식·ETF·펀드·현금성 수동 종목·코인·실물 금의 보유수량과 원가를 관리하고, 시장별 공급자에서 검색·시세를 받아 평가액을 계산합니다. 시장 데이터의 실패는 0원이라는 유효한 데이터와 구분하며, 계산된 계좌 잔액과 원가는 자산 포트폴리오 모듈의 공개 계약으로 반영합니다.

매일 수행되는 자산 시세·계좌 평가·스냅샷 명령의 업무 오케스트레이션도 이 모듈에 포함하되, 스케줄러 런타임과 공통 오류 보고는 외부 운영 모듈에 위임합니다.

## 2. 포함/제외 범위

### 포함

- 국내·미국 주식, ETF, 수동·현금 보유종목 CRUD와 평가
- 지원 펀드의 실제 보유좌수, 평균 매입 기준가, 일별 기준가를 이용한 평가
- Upbit KRW 코인 보유종목 CRUD와 평가
- 실물 금, KRX 금현물 종목, 금 ETF의 서로 다른 평가 방식
- 국내·미국 주식과 코인 검색
- 시장별 시세 공급자 선택과 공급자 응답의 내부 시세 계약 변환
- 보유종목 변경·시세 갱신 후 부모 계좌 평가액과 원가 재계산
- 매일 자산 시세 갱신과 총·금융·유형별·소유자별 스냅샷 생성 명령

### 제외

- 자산 계정 자체의 CRUD와 최종 잔액 저장: [자산 포트폴리오 모듈](../portfolio/requirements.md)
- 자동 적금 납입과 대출 상환: [자산 자동화 모듈](../asset-automation/requirements.md)
- 배당 공시 수집과 배당 상태 전이: [배당 모듈](../dividends/requirements.md)
- HTTP·HTML 처리, 재시도, 공통 장애 관측 구현: [외부 운영 모듈](../../../../supporting-platform/modules/external-operations/requirements.md)
- 차트 기간·표현 방식: [통계 모듈](../../../../supporting-platform/modules/reporting/requirements.md)

## 3. 소유 데이터

| 데이터 | 소유권과 불변식 |
|---|---|
| `stock_holdings` | 주식·ETF·펀드·수동·현금 보유종목의 코드, 이름, 수량, 평균단가, 현재가와 가격 단위를 소유합니다. |
| `crypto_holdings` | Upbit KRW 마켓 보유종목의 코드, 이름, 수량, 평균단가, 현재가를 소유합니다. |
| 시장 시세 DTO | 공급자 응답을 통화·원시 가격·환율·현재가·전일 대비가 명시된 내부 계약으로 정규화합니다. 영속 Domain 데이터로 공급자 원문을 소유하지 않습니다. |
| 계좌 평가 결과 | `currentBalance`와 `costBasis`를 계산하지만 `assets` 문서를 직접 소유하지 않습니다. 포트폴리오 명령을 통해 반영합니다. |
| 자산 스냅샷 명령 | 스냅샷 값을 계산하지만 `asset_history` 저장은 포트폴리오의 기록 계약에 위임합니다. |

## 4. 공개 계약·의존 모듈

### 공개 계약

- `AddHolding`, `UpdateHolding`, `DeleteHolding`, `ListHoldings(assetId)`
- `SearchStocks(query)`, `SearchCrypto(query)`
- `GetStockQuote(instrument)`, `GetFundNav(instrument)`, `GetCryptoQuote(marketCode)`, `GetGoldQuote()`
- `CalculateHoldingValue`, `CalculateAccountValuation`
- `RefreshAccountPrices(assetId)`
- `RunDailyAssetValuation(asOf, idempotencyKey)`

공급자 Adapter는 `NaverDomesticMarketPort`, `NasdaqUsMarketPort`, `ExchangeRatePort`, `UpbitMarketPort`, `GoldMarketPort`처럼 시장별로 분리합니다. Web과 예약 작업은 같은 평가 정책을 호출해야 합니다.

### 의존 모듈

- 자산 포트폴리오 모듈: 계좌 정보 조회, 평가 결과와 스냅샷 저장
- 가구 모듈: `householdId` 범위
- 외부 운영 모듈: 외부 응답 상태, 재시도와 실행 결과 보고
- 시계: `Asia/Seoul` 기준 실행일과 결정적 멱등 키 생성

## 5. 요구사항

| ID | 상태 | 요구사항 | 경계·예외 | 근거 | 테스트 |
|---|---|---|---|---|---|
| HOLD-001 | 현재 명세 | 국내·미국 주식과 수동·현금 보유종목을 수량, 평균단가, 현재가로 추가·수정·삭제한다. | 현재가가 없으면 평균단가를 평가가로 사용한다. 수정 patch에서 생략한 필드는 기존 값을 유지하며, 종목 코드와 instrumentType이 없던 레거시 수동·현금 항목도 내부의 안정적인 식별자와 holdingType으로 정규화하여 수정할 수 있어야 한다. | [stock holding manager](../../../../../../web/src/lib/utils/useStockHoldingManager.ts), [assetService](../../../../../../web/src/lib/assetService.ts) | U, I, E2E |
| HOLD-002 | 현재 명세 | Upbit KRW 코인을 수량, 평균단가, 현재가로 평가하고 계좌 합계와 원가를 정수 반올림해 저장한다. | 외부 시세 실패를 데이터 0과 구분해야 한다. | [crypto holding manager](../../../../../../web/src/lib/utils/useCryptoHoldingManager.ts), [assetService](../../../../../../web/src/lib/assetService.ts) | U, I, E2E |
| HOLD-003 | 현재 명세 | 보유종목 변경과 시세 갱신 후 부모 계좌 currentBalance와 costBasis를 재계산한다. | 같은 계산을 Web과 예약 작업이 다르게 구현하면 안 된다. Position과 부모 Asset 갱신은 Portfolio Command의 같은 원자 경계에서 처리하며 강한 일관성은 `HOLD-004`가 소유한다. | [assetService](../../../../../../web/src/lib/assetService.ts), [Portfolio Command handler](../../../../../../functions/src/bootstrap/commands/portfolioHouseholdCommandHandlers.ts) | U, C, I |
| HOLD-004 | 결함 | Position 추가·수정·삭제와 그 결과인 부모 Asset의 currentBalance·costBasis·두 Aggregate version·receipt·Outbox는 서버 `RevalueAssetWorkflow`의 한 Portfolio Unit of Work로 commit한다. | 외부 Quote 조회는 transaction 밖에서 끝내고 성공 Quote와 기존 정상 Quote로 평가 intent를 만든다. Position 또는 Asset version이 하나라도 다르거나 저장 하나가 실패하면 전체 write 0건과 `Conflict`·typed failure를 반환한다. | [AssetAddModal](../../../../../../web/src/components/assets/AssetAddModal.tsx), [assetService](../../../../../../web/src/lib/assetService.ts) | Application, Emulator, E2E |
| HOLD-005 | 목표 명세 | 자산 계좌 상세는 가구 단위로 이미 관찰한 Position snapshot을 즉시 필터링해 첫 화면을 표시하며, 모달을 열 때 계좌별 Firestore 재구독·목록 초기화·보유종목별 외부 조회를 시작하지 않는다. | 배당 정보는 사용자가 선택한 한 종목에 대해서만 상세 동작 뒤 비동기로 조회한다. 계좌 재진입은 마지막 가구 snapshot을 즉시 재사용하고 서버 관찰 결과로 수렴한다. | [holding snapshot](../../../../../../web/src/lib/utils/useHouseholdHoldingSnapshots.ts), [StockHoldingList](../../../../../../web/src/components/assets/StockHoldingList.tsx) | U, UI |
| FUND-001 | 현재 명세 | 미래에셋 국민참여형 국민성장펀드 C-e(`EW001`, `K55301EW0012`, 미래에셋 class `539502`)를 주식 계좌에서 검색·보유할 수 있고, 사용자가 입력한 실제 보유좌수와 미래에셋 공식 일별 기준가로 평가한다. | 기준가는 1,000좌당 가격이므로 평가액과 원가는 각각 `보유좌수 × 기준가 ÷ 1,000`, `보유좌수 × 평균 매입 기준가 ÷ 1,000`이다. C 또는 모펀드 기준가를 대신 사용하지 않으며 오늘보다 미래가 아닌 가장 최근 정상 기준일을 선택한다. | [시세 공급자 Adapter](../../../../../../functions/src/adapters/firebase/portfolio/firebasePortfolioMarketData.ts), [평가 Policy](../../../../../../web/src/lib/assets/holdingValuation.ts) | U, C, I |
| GOLD-001 | 현재 명세 | 실물 금은 돈 단위 수량과 원/돈 시세로, `KRXGOLD1KG`·`KRXGOLD100G` 금현물 Position은 g 단위 수량과 네이버 KRX 금시장 원/g 시세로, 금 ETF는 일반 KRX 주식 방식으로 평가한다. | 구형 memo의 N돈 표현을 실물 금 수량으로 읽는다. 금현물 Position의 시세에 돈 환산 배수 3.75를 적용하지 않는다. | [시세 공급자 Adapter](../../../../../../functions/src/adapters/firebase/portfolio/firebasePortfolioMarketData.ts), [평가 Policy](../../../../../../web/src/lib/assets/holdingValuation.ts) | U, C, I |
| GOLD-002 | 결함 | 시세 공급자 실패 시 추정값을 실제 시세처럼 자산 잔액에 반영하면 안 된다. | 현재 고정 fallback 값은 요구사항으로 고정하지 않는다. | [시세 공급자 Adapter](../../../../../../functions/src/adapters/firebase/portfolio/firebasePortfolioMarketData.ts) | C, I |
| MARKET-001 | 현재 명세 | Web의 시세·코인 검색·배당 조회는 App Check·Auth·가구 Membership을 검증한 Household Query를 통해 국내 주식을 Naver 주식 API, KRX 금현물 종목과 실물 금을 Naver KRX 금시장 페이지, 미국 종목을 Nasdaq와 USD/KRW 환율, 코인을 Upbit에서 조회하고, 배당 카드는 가구별 배당 Projection을 읽는다. 공개 기준정보인 주식 종목 카탈로그 동기화만 읽기 전용 Cloud Storage 경계를 사용한다. | 공급자별 시세 계약은 서로 다른 Adapter로 다루고 Web은 Quote 공급자를 직접 호출하지 않는다. KRX 금현물 종목을 일반 주식 API로 보내지 않는다. 공개 카탈로그 읽기는 자산·가구 데이터 접근 권한을 부여하지 않는다. | [Portfolio Query 경계](../../../../../../functions/src/bootstrap/queries/portfolioMarketHouseholdQueryHandlers.ts), [기기 카탈로그](../../../../../../web/src/features/portfolio/instrument-catalog/application/localStockInstrumentCatalog.ts) | C, I |
| MARKET-002 | 결함 | 예약 보유종목 갱신은 시장에 맞는 공급자를 선택해야 한다. | 시장 분류가 확인된 target만 해당 공급자로 보내며 마지막 성공 시세를 보존한다. | [자산 평가 예약 작업](../../../../../../functions/src/bootstrap/firebaseAssetValuationScheduledJob.ts) | U, I |
| MARKET-003 | 현재 명세 | 주식 검색은 기기에 동기화된 최근 성공 Cloud Storage Catalog Snapshot의 국내·미국 종목을 합쳐 관련도순 최대 10개를 즉시 반환하고, 코인 검색은 인증된 Query로 Upbit KRW 마켓만 최대 10개를 반환한다. | 주식의 빈 검색어는 빈 결과이며 타이핑 검색은 Cloud Function·Quote 공급자를 호출하지 않는다. 코드·이름·별칭 관련도와 결과 계약은 서버 호환 검색과 같아야 한다. | [기기 카탈로그](../../../../../../web/src/features/portfolio/instrument-catalog/application/localStockInstrumentCatalog.ts) | U, C, I |
| MARKET-004 | 목표 명세 | 시세 갱신 실패 기간과 무관하게 마지막 성공 Quote를 평가에 계속 사용하고, 공급자별 연속 실패와 복구 상태를 구조화 로그·지표·영속 Health 상태·경보로 관측할 수 있어야 한다. | 실패는 Quote의 가격·observedAt을 바꾸지 않는다. contract·invalid·인증·설정 실패는 즉시, 추적 Position의 retryable·예상 밖 NoData는 예약 갱신 3회 연속 실패 시 경보하며 성공 시 상태를 초기화한다. | [DEC-018](../../../../governance/decisions.md#dec-018), [시세 공급자 Adapter](../../../../../../functions/src/adapters/firebase/portfolio/firebasePortfolioMarketData.ts) | U, C, I, 운영 계약 |
| MARKET-005 | 현재 명세 | 국내·미국 주식·ETF·ETN 종목 카탈로그를 매일 06:00 `Asia/Seoul`에 생성해 Cloud Storage에 서로 다른 최근 성공일 3일치를 보관하고, Web은 검증된 snapshot을 IndexedDB와 메모리에 캐시해 로컬 검색한다. | snapshot 검증 뒤 `latest`를 원자 교체하고 성공 후에만 서로 다른 성공일 기준 이전본을 3개까지 정리한다. 기기는 최대 5분 간격으로 manifest를 확인하고 generation·SHA-256·schema·종목 수가 모두 맞는 새 snapshot만 교체한다. 실패 시 마지막 성공 기기 cache를 계속 사용하며 `stocks.json` fallback·빈 성공은 금지한다. 기기 cold cache에서 Storage를 읽지 못하면 명시적 실패다. | [DEC-035](../../../../governance/decisions.md#dec-035) | U, C, I, 운영 계약 |
| MARKET-006 | 목표 명세 | 외화 자산의 KRW 평가는 최신 사용 가능 원 통화 Quote와 Frankfurter v2의 최신 성공 환율을 각각 선택하고 두 관측 시각 차이에 별도 상한을 두지 않는다. 환율은 성공 후 경과 기간과 무관하게 다음 성공까지 계속 사용한다. | 환산 결과에 Quote provider·observedAt과 환율 provider=`frankfurter-v2`·rateDate·observedAt을 보존하고 화면 경고는 표시하지 않는다. 환율 성공 이력과 이전 정상 KRW 환산이 모두 없으면 `NoData(EXCHANGE_RATE_NOT_OBSERVED)`이며 고정·평균·1:1 환율을 추정하지 않는다. 실패·더 오래된 rateDate는 저장된 환율을 덮어쓰지 않는다. 보조 공급자와 네이버 HTML 환율 fallback은 두지 않는다. | [DEC-053](../../../../governance/decisions.md#dec-053), [DEC-060](../../../../governance/decisions.md#dec-060) | U, C, I, 운영 계약 |
| JOB-AST-001 | 결함 | 각 시세 연동 자산은 개별 수동 갱신을 제공하고, 자산 메인 페이지 진입 즉시 및 visible 동안 30초마다 실행되는 갱신과 매일 23:55 `Asia/Seoul` 예약 작업은 현재 가구 또는 전체 active 가구의 국내·미국 주식·ETF·ETN, 지원 펀드, KRW 코인, 실물 금을 모두 갱신한다. 페이지 반복 갱신은 이탈·hidden 상태에서 중단한다. 예약 작업은 모든 내부 page가 terminal 결과에 도달한 뒤 최신 성공 Quote 또는 보존된 마지막 성공 Quote로 평가하고 당일 자산 Snapshot을 요청한다. | 사용자가 다루는 전체 종목 수 상한은 없다. 한 번의 전체 갱신 결과는 모든 계좌를 한 원자적 단위로 반영한다. 내부 처리·중복 실행·timeout·retry는 DEC-049를 따르고, 일부 실패는 성공 범위를 되돌리지 않으며 Snapshot은 같은 날짜에 멱등이다. | [자산 평가 예약 작업](../../../../../../functions/src/bootstrap/firebaseAssetValuationScheduledJob.ts), [assets page](../../../../../../web/src/app/assets/page.tsx), [DEC-049](../../../../governance/decisions.md#dec-049) | U, C, I, E2E |
| JOB-AST-002 | 결함 | 총자산, 금융자산과 현재·직전 snapshot에 존재하는 소유자별·유형별 scope의 전일 대비 변화량을 계산하고, 사라진 scope와 자산이 없는 가구에는 명시적 0원 snapshot intent를 요청한다. | 활성 자산만 포함하고 대출은 음수이다. 실제 snapshot 저장 불변식은 Portfolio `AST-008`이 소유한다. | [자산 평가 예약 작업](../../../../../../functions/src/bootstrap/firebaseAssetValuationScheduledJob.ts), [assetService](../../../../../../web/src/lib/assetService.ts), [AST-008](../portfolio/requirements.md#5-요구사항) | U, I |
| JOB-AST-003 | 결함 | Web과 예약 작업은 레거시 자산 생명주기를 동일하게 해석하고, 일부 가격 갱신 뒤 실패해도 일관된 복구 상태를 가져야 한다. | `isActive` 누락·true는 active, false는 deleted로 변환한다. 현재 job의 true query는 누락 문서를 제외하며 다단계 갱신도 원자적이지 않다. | 같은 근거 | U, I |

## 6. 모듈 결함

- 금 시세 실패가 고정 추정값의 성공 응답으로 바뀌어 실제 자산 잔액을 덮어쓸 수 있습니다. (`GOLD-002`)
- 예약 작업이 미국 종목에도 Naver 국내 시세 경로를 사용합니다. (`MARKET-002`)
- Web과 Functions에 계좌 평가 계산이 중복되어 변경 시 결과가 달라질 수 있습니다. (`HOLD-003`)
- Position write와 부모 Asset 평가 반영이 분리되어 동시 보유종목 추가·수정·삭제 또는 중간 실패 시 부모 합계와 Position 집합이 달라질 수 있습니다. (`HOLD-004`)
- Web과 예약 작업이 `isActive` 누락·false 레거시 자산의 active/deleted 상태를 다르게 해석합니다. (`JOB-AST-003`)
- 시세·보유종목·부모 계좌·스냅샷의 다단계 갱신이 원자적이지 않아 부분 성공 상태가 남을 수 있습니다. (`JOB-AST-001`, `JOB-AST-003`)
- 자산이 없어진 범위의 0원 스냅샷을 만들지 않아 마지막 owner·유형의 차트가 이전 값을 유지할 수 있습니다. (`JOB-AST-002`)
- 시세 API가 계속 실패해도 공급자별 마지막 성공·연속 실패 상태와 경보가 없어 실물 금·주식 시세 장애를 장기간 발견하지 못할 수 있습니다. (`MARKET-004`)

## 7. 관련 DEC

- [DEC-014: 배당 기준일 누락 복구](../../../../governance/decisions.md#dec-014) — 배당 모듈이 기준일과 가장 가까운 snapshot을 결정적으로 고를 수 있도록 날짜·수량·source version이 있는 Position history를 제공합니다.
- [DEC-017: 자산 삭제와 복구](../../../../governance/decisions.md#dec-017) — deleted Asset의 Position·history는 보존하고 평가 대상에서 제외하며 별도 수동 purge에서만 제거합니다.
- [DEC-018: 시세 실패 시 평가와 공급자 장애 관측](../../../../governance/decisions.md#dec-018) — 마지막 성공 시세는 기간 제한 없이 평가에 사용하고, 모든 실패와 연속 장애·복구를 기록하고 경보합니다.
- [DEC-035: Cloud Storage 종목 카탈로그와 기기 캐시](../../../../governance/decisions.md#dec-035) — 최근 성공 3일치 immutable snapshot, `latest` manifest, IndexedDB·메모리 read model과 `stocks.json` 제거를 고정합니다.
- [DEC-048: Position history 보존](../../../../governance/decisions.md#dec-048) — 정상 화면에서는 일일 Snapshot과 Event에 고정된 근거를 사용하되 Position history는 복구·감사·재구축용으로 수동 Asset·가구 purge 전까지 보존합니다.
- [DEC-049: 전체 시세 갱신과 외부 호출 한도](../../../../governance/decisions.md#dec-049) — 개별·자산 페이지 진입 및 visible 동안 30초 주기·23:55 전체 갱신, 전체 종목 수 무제한, 내부 50개 page·병렬 5·10초 timeout·총 3회 시도와 single-flight를 고정합니다.
- [DEC-053: 외화 Quote·환율 조합](../../../../governance/decisions.md#dec-053) — 최신 사용 가능 두 관측을 시각 차이 제한 없이 조합하고 사용한 가격·환율의 시각과 출처를 보존합니다.
- [DEC-060: Frankfurter 단일 환율 공급자와 무기한 마지막 성공값](../../../../governance/decisions.md#dec-060) — 보조 공급자 없이 Frankfurter v2만 사용하고 실패 기간과 무관하게 마지막 성공 환율을 평가에 계속 사용합니다.

## 8. 모듈 테스트 시나리오

### Canonical 테스트

| 테스트 ID | 종류 | Given / When / Then | 연결 요구사항 |
|---|---|---|---|
| T-MARKET-001 | 목표 | 마지막 성공 금·주식 Quote와 서로 다른 실패 결과 / 예약 갱신 3회 실패 후 성공 / 평가액과 observedAt은 마지막 성공값을 유지하고 매 시도 log·health가 누적되며 즉시·연속 실패 경보가 열리고 성공 시 해제됨 | MARKET-004, EXT-001, JOB-ERR-001, DEC-018 |
| T-MARKET-002 | 목표 | 서로 다른 정상 snapshot 성공일 4개와 같은 날짜 재실행, 갱신 실패, 동일·변경 generation, 기기 cache hit/cold cache / catalog publish·동기화·검색 / 서로 다른 최근 성공일 3개, 원자 latest, cache hit 즉시 검색, 최대 5분 manifest 확인, 변경 때만 reload, 마지막 성공 기기본 유지, cold 실패, `stocks.json` 접근 0회 | MARKET-005, EXT-001, JOB-ERR-001, DEC-035 |
| T-MARKET-003 | 목표 | Frankfurter 정상 JSON의 USD/KRW 1,400·rateDate, 어제 100 USD Quote, 주말 같은 rateDate, 더 오래된 응답, timeout·schema drift·0/음수, 장기 실패, 환율 최초 실패, 이전 정상 환산 / Web·23:55 평가 / 140,000원과 Quote·환율 provenance 보존, skew·stale 거부 없음, 더 오래된 응답은 무변경, 최초 환율 부재만 NoData, 장기 실패는 마지막 성공값 유지·Health 경보, 네이버·보조 공급자 호출 0회 | MARKET-001, MARKET-004, MARKET-006, DEC-053, DEC-060 |
| T-HOLD-001 | 목표 | 같은 Asset에 Position 두 건을 동시에 추가하거나 코드·instrumentType이 없는 레거시 예수금을 수정하고, 부모 Asset write 직전 실패·version 경합 / ManagePosition·RevalueAssetWorkflow / 레거시 예수금은 현재가와 version이 갱신되고 Position·부모 평가·receipt·Outbox가 모두 한 번 commit되거나 모두 이전 상태 | HOLD-001, HOLD-003, HOLD-004 |
| T-JOB-AST-001 | 목표 | 국내·미국 주식·ETF·펀드·코인·실물 금과 전날 마지막 owner·type 자산, 100개 초과 종목, 일부 timeout / 페이지 진입 즉시·visible 동안 30초 주기·23:55 전체 평가와 snapshot intent / 한 run의 모든 계좌를 원자 반영하고 모든 내부 page를 처리하며 성공 Quote와 실패 대상 마지막 Quote로 평가한다. hidden에서는 반복하지 않고 사라진 scope는 0원이며 중복 run은 없다. | JOB-AST-001, JOB-AST-002, AST-008, DEC-049 |
| T-HOLD-002 | 목표 | 동일한 국내·미국 주식·펀드·코인 Position fixture / Web 진입과 23:55 job의 공통 계좌 평가 / currentBalance·costBasis가 같은 정책과 반올림으로 동일 | HOLD-003 |
| T-HOLD-003 | 목표 | Quote 미관측·성공 0원·실패 뒤 마지막 Quote·소수 코인 합계 / Position·계좌 평가 / 미관측만 평균단가를 쓰고 0원과 실패를 구분하며 계좌 최종 합계를 원 단위 반올림 | HOLD-001, HOLD-002 |
| T-PERF-HOLD-001 | 목표 | 가구 Position snapshot이 있고 여러 배당 지원 종목을 보유 / 계좌 상세를 열고 한 종목을 선택 / 계좌 목록은 추가 구독·일괄 배당 조회 없이 즉시 표시되고 선택한 종목의 배당만 비동기 조회 | HOLD-005 |
| T-FUND-001 | 목표 | `EW001`·`K55301EW0012`·`539502` C-e identity, C 클래스·모펀드·미래·과거 NAV, 30,000,000좌·1,001.19원 기준가와 잘못된 priceScale / 검색·공식 NAV 선택·펀드 평가 / 정확한 C-e만 검색·선택하고 비미래 최신 일별 NAV와 1,000좌당 scale로 평가액 30,035,700원·원가 30,000,000원을 계산하며 대체 클래스·잘못된 scale은 거부 | FUND-001 |
| T-GOLD-001 | 목표 | 구형 `3돈`·`3 돈`, 정규 quantity, `KRXGOLD1KG` 171g, 금 ETF / 금 Position 정규화·평가 / 실물 금만 원/돈 시세를 쓰고 KRX 금현물은 Naver 금시장 원/g 시세를 그대로 쓰며 ETF는 일반 주식 수량 계약을 사용 | GOLD-001 |
| T-GOLD-002 | 목표 | 금 공급자 timeout·5xx·schema drift / 금 가격 갱신 / 추정 성공·0원으로 바꾸지 않고 기존 정상 평가를 유지하며 typed 실패를 반환 | GOLD-002 |
| T-MARKET-004 | 목표 | 같은 code의 KRX·NASDAQ·NYSE·AMEX·UPBIT_KRW·fund·physical gold와 KRX ETF 배당 / 시장 라우팅 / code 형태가 아닌 명시 market·exchange로 정확한 Adapter 하나만 호출하고 배당 공시는 Quote와 분리 | MARKET-001, MARKET-002 |
| T-MARKET-005 | 목표 | 국내 주식·ETF·ETN과 미국 중복 검색 결과 11건, exact code·code prefix·name prefix·name contains 동률, KRW·비KRW 코인, 빈 검색어 / 종목 검색 / exact→code prefix→name prefix→name contains와 market·code tie-break로 결정적 최대 10개, KRW 코인만 반환하며 주식의 빈 검색은 빈 결과, 서버 코인 Query의 빈 검색은 typed error | MARKET-003 |
| T-JOB-AST-002 | 목표 | `isActive` 누락·true·false 자산, 대상별 성공·timeout, 재실행과 version 경합 / 일일 평가 lifecycle 처리 / Web과 job 생명주기가 동일하고 완료 대상은 중복 변경하지 않으며 실패·경합 대상만 재시도로 수렴 | JOB-AST-003 |

### 상세 시나리오

| 시나리오 | 수준 | 연결 요구사항 |
|---|---|---|
| 현재가가 없는 주식은 평균단가로 평가하고 현금 보유종목도 같은 계좌 합계에 포함한다. | U | HOLD-001 |
| 코드·instrumentType이 없는 레거시 예수금의 금액을 수정하면 생략한 평균단가는 보존하고 새 현재가·Position version·부모 계좌 합계를 한 번에 반영한다. | UI, C, I | HOLD-001, HOLD-003, HOLD-004 |
| 국민성장펀드 C-e 30,000,000좌와 기준가 1,001.19원을 입력하면 평가액은 30,035,700원이며 주식 계좌 합계와 예약 평가가 같은 값을 만든다. | U, C, I | FUND-001, HOLD-003 |
| 코인 평가액과 원가는 계산 뒤 정수로 반올림하며 시세 조회 실패를 0원 시세와 구분한다. | U, C | HOLD-002 |
| 같은 fixture를 Web 경로와 예약 작업 경로에 입력하면 계좌 `currentBalance`와 `costBasis`가 동일하다. | U, C | HOLD-003 |
| 구형 `memo`의 `N돈`과 정규화된 수량 필드가 동일한 실물 금 평가액을 만든다. | U | GOLD-001 |
| 금 시세 공급자가 실패하면 계좌 잔액을 갱신하지 않고 실패 상태를 반환한다. | C, I | GOLD-002 |
| 일반 국내 종목은 Naver 주식 API, KRX 금현물은 Naver 금시장 페이지, 미국 종목은 Nasdaq·환율, 코인은 Upbit Adapter로 라우팅한다. | U, C | MARKET-001, MARKET-002 |
| 어제의 100 USD Quote와 오늘의 1,400 KRW/USD 환율은 관측 시각 차이와 무관하게 140,000원으로 평가하고 두 관측 시각을 보존한다. | U, C, I | MARKET-006, DEC-053 |
| 새 USD Quote만 성공하거나 새 환율만 성공해도 각 최신 성공 관측을 독립 보존하고, 상대 입력의 마지막 사용 가능 관측과 다음 평가에서 조합한다. | U, C, I | MARKET-004, MARKET-006 |
| 환율을 한 번도 성공하지 못한 USD Position은 임의 환산하지 않고 NoData로 남기며, 이전 정상 KRW 환산이 있으면 새 부분 실패로 덮어쓰지 않는다. | U, C, I | MARKET-006 |
| 주식 검색은 국내·미국 결과를 관련도순 최대 10개로 합치고 코인은 KRW 마켓만 최대 10개를 반환한다. | U, C | MARKET-003 |
| 종목 snapshot 네 번째 성공 후 최근 성공 3개만 남고, 갱신 실패·부분 업로드는 `latest`를 바꾸지 않으며, 검색 cache는 같은 generation을 다시 내려받지 않는다. | U, C, I, 운영 계약 | MARKET-005, DEC-035 |
| 같은 날짜의 자산 job을 두 번 실행하면 같은 스냅샷 ID를 사용하고 `createdAt`을 보존한다. | I | JOB-AST-001 |
| 100개 시세 연동 종목은 한 번의 사용자 동작으로 모두 처리하되 내부적으로 최대 50개씩 page 처리하고 Provider 호출은 최대 5개만 동시에 실행한다. | C, I, E2E | JOB-AST-001, DEC-049 |
| 대출과 deleted 자산이 섞인 fixture에서 총·금융·소유자·유형별 스냅샷과 전일 변화량을 검증한다. | U, I | JOB-AST-002, AST-006 |
| `isActive` 누락·true는 active, false는 deleted로 변환해 Web과 job이 같은 방식으로 처리한다. | U, I | JOB-AST-003, AST-006 |
| 중간 공급자 실패가 발생하면 갱신된 범위와 실패한 범위를 보고하고 재실행으로 수렴한다. | I | JOB-AST-003 |
| 마지막 성공 뒤 시세 갱신이 장기간 실패해도 같은 가격·observedAt으로 평가하고 매 실패를 기록하며, contract failure는 즉시, retryable 실패는 3회째 경보하고 다음 성공이 health와 경보를 복구한다. | U, C, I, 운영 계약 | MARKET-004, EXT-001, JOB-ERR-001 |

## 9. 코드 근거

- [자산·보유종목 타입](../../../../../../web/src/types/asset.ts)
- [자산과 보유종목 서비스](../../../../../../web/src/lib/assetService.ts)
- [주식 보유종목 관리자](../../../../../../web/src/lib/utils/useStockHoldingManager.ts)
- [코인 보유종목 관리자](../../../../../../web/src/lib/utils/useCryptoHoldingManager.ts)
- [실물 금 관리자](../../../../../../web/src/lib/utils/useGoldHolding.ts)
- [종목 검색 Adapter](../../../../../../functions/src/adapters/firebase/portfolio/firebasePortfolioInstrumentSearch.ts)
- [시세 공급자 Adapter](../../../../../../functions/src/adapters/firebase/portfolio/firebasePortfolioMarketData.ts)
- [보유종목 평가 Policy](../../../../../../web/src/lib/assets/holdingValuation.ts)
- [Portfolio Query 경계](../../../../../../functions/src/bootstrap/queries/portfolioMarketHouseholdQueryHandlers.ts)
- [Web Portfolio Query Client](../../../../../../web/src/features/portfolio/application/portfolioQueries.ts)
- [자산 평가 예약 작업](../../../../../../functions/src/bootstrap/firebaseAssetValuationScheduledJob.ts)
