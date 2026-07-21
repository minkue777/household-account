# 통계 모듈 상세 설계

> 요구사항: [통계 모듈 요구사항](requirements.md)  
> 상위 지도: [지원·읽기·플랫폼 영역](../../requirements.md)  
> 공통 형식: [모듈 상세 설계 규약](../../../governance/module-design-standard.md)  
> 목표 아키텍처: [목표 Clean Architecture 설계](../../../../architecture/target-clean-architecture.md)

## 1. 설계 목적과 추적성

이 설계는 `STAT-001~006`, `STAT-AST-001~003` 요구사항을 Cross-context Query Read Side와 얇은 화면 Controller로 구현하는 기준이다. 통계는 거래·카테고리·자산 원본을 수정하지 않으며, 기간과 집계 Policy를 Framework 밖에서 단독 소유한다. 거래 변경과 가맹점 규칙 저장은 각 제공 모듈의 공개 Command를 호출한다. 원천의 0원·NoData·failure를 보존하고 bounded query와 request revision으로 세션 사이 결과 혼입을 막는다.

## 2. 모듈 경계와 책임

| 내부 책임 | 입력 소유자 | 출력 |
|---|---|---|
| 지출 기간 계산 | Reporting | `StatisticsPeriod` |
| 지출 총액·월별·카테고리 집계 | Ledger·Category Read Contract | `LedgerStatisticsView` |
| 초기 추이 카테고리 선택 | Category | category ID 목록 |
| 카테고리 상세 조합 | Ledger | `CategoryDetailView` |
| 자산 기간·금융자산 필터·추이 | Portfolio | `AssetStatisticsView` |
| 화면 변경 action 조정 | Ledger·Payment Configuration | 최신 화면 상태 또는 typed error |

Reporting은 Ledger·Portfolio Repository나 Firestore collection을 직접 import하지 않는다. [DEC-048](../../../governance/decisions.md#dec-048)에 따라 지출 통계용 영속 Projection을 만들지 않고 소유 모듈의 공개 Query를 요청 시 조합한다.

## 3. 공개 계약

### 3.1 Query Port

| 이름 | 입력 | 성공 결과 | 오류·권한 |
|---|---|---|---|
| `GetLedgerStatistics` | ActorContext, householdId, preset/custom range, trend category IDs, source page policy | `LedgerStatisticsView` | `Forbidden`, `ValidationError`, `NoData`, `RetryableFailure`, `ContractFailure` |
| `GetCategoryDetail` | ActorContext, householdId, categoryId, period, cursor | paged `CategoryDetailView` | 같은 tenant·cursor 검증 |
| `GetAssetStatistics` | ActorContext, householdId, preset, financialOnly, source page policy | `AssetStatisticsView` | `NoData`·원천 실패·조회 한도 초과 구분 |

```ts
type ExpensePeriodPreset = 'LAST_3_MONTHS' | 'LAST_6_MONTHS' | 'LAST_12_MONTHS' | 'CUSTOM';
type AssetPeriodPreset = 'LAST_3_MONTHS' | 'LAST_6_MONTHS' | 'LAST_1_YEAR' | 'ALL';

interface StatisticsPeriod {
  startDate: string; // LocalDate inclusive
  endDate: string;   // LocalDate inclusive
  resolvedFrom: string;
}

interface LedgerStatisticsView {
  period: StatisticsPeriod;
  totalExpenseInWon: number;
  monthly: ReadonlyArray<{ yearMonth: string; amountInWon: number }>;
  categories: ReadonlyArray<{ categoryId: string; label: string; amountInWon: number; ratio: number }>;
  trendCategoryIds: ReadonlyArray<string>;
  sourceCheckpoint?: string;
  updatedAt: string;
}

type ReportingSourceState =
  | { kind: 'READY'; sourceCheckpoint: string; observedAt: string }
  | { kind: 'NO_DATA' }
  | { kind: 'FAILED'; code: string; retryable: boolean };

interface ReportingRequestIdentity {
  actorSessionGeneration: string;
  householdId: string;
  queryKey: string;
  queryRevision: number;
}
```

금액은 원 단위 정수이며 `ratio`는 표시용 파생값이다. 합계의 SSOT는 금액이고 반올림된 ratio 합계를 다시 금액으로 사용하지 않는다.

### 3.2 화면 Action 계약

`ReportingController`는 다음 소비 Port만 사용한다.

- Ledger: `UpdateTransaction`, `DeleteTransaction`
- Payment Configuration: `ManageMerchantRules`의 save command

각 action은 독립 사용자 Command다. 성공하면 반환 snapshot 또는 해당 상세 Query 재실행으로 화면을 갱신하고, 실패하면 기존 Read Model을 보존한다. Reporting이 낙관적으로 원본을 확정하지 않는다.

## 4. 조회 모델과 불변식

### 4.1 `StatisticsPeriod`

- 기준 timezone은 [DEC-023](../../../governance/decisions.md#dec-023)의 고정 `Asia/Seoul`이며 `Clock`과 분리한다.
- 끝은 현재 월의 말일이다.
- 최근 3개월은 현재 월을 포함한 3개 월, 6개월은 6개 월, 12개월은 12개 월이다.
- 사용자 지정 범위는 시작 월 1일과 종료 월 말일로 정규화한다.
- custom 시작·종료 중 하나라도 없으면 최근 12개월로 fallback한다.
- 시작이 종료보다 늦으면 `ValidationError(INVALID_PERIOD_ORDER)`로 처리하며 조용히 뒤집지 않는다.

### 4.2 지출 집계

- `type=expense`만 포함하고 income은 지출 합계에서 제외한다.
- 기간 밖, 삭제·취소 상태, 다른 household 데이터는 제외한다.
- 모든 월 bucket을 결정적 순서로 만들고 거래가 없는 월은 0으로 표시할 수 있다.
- category ID로 집계하며 표시 이름 변경이 과거 집계 key를 바꾸지 않는다.
- `READY` 원천이 빈 거래 목록을 반환하면 유효한 0원 통계다. Aggregator가 빈 배열만 보고 `NoData`를 만들지 않으며, `NoData`는 Source Port가 명시적으로 반환한 경우에만 그대로 전달한다.
- 초기 trend category는 예산이 설정된 활성 카테고리 순서, 없으면 호환 기본 category resolver 결과다.

### 4.3 자산 집계

- 기본 기간은 최근 3개월이다.
- `financialOnly=true`이면 property와 loan을 제외한다.
- `ALL`은 저장소의 가장 오래된 유효 snapshot부터 현재까지이며 고정 연도를 사용하지 않는다. 유효 snapshot이 없으면 `NoData`다.
- 제한 기간은 `startDate` 이하에서 가장 가까운 유효 snapshot 한 건을 baseline으로 조회하고, 기간 안의 첫 point 앞에도 해당 값을 적용한다.
- baseline 또는 기간 point의 명시적 0원은 유효한 값이다. 유효 snapshot 부재와 공급자·저장소 실패를 0원으로 합성하지 않는다.
- 기간 중 누락 날짜는 직전 성공값을 carry-forward하되, 아직 성공 point가 한 번도 없던 구간은 0으로 추정하지 않는다.
- 같은 날짜·자산의 중복 snapshot은 schema version과 최신 aggregateVersion으로 결정한다.
- `HistoricalAssetScopeVisibilityPolicy`는 선택 기간의 window와 시작 baseline에 나타난 type·ownerRef key의 합집합을 필터 catalog로 만든다. 현재 Asset/Profile 활성 상태와 금액 0 여부로 dimension을 제거하지 않는다.
- ownerRef 표시명은 Access historical-display Query로 해석하고, archived 프로필도 반환한다. 표시명 조회 실패를 해당 dimension 부재로 바꾸지 않고 stable key와 실패 상태를 보존한다.

### 4.4 bounded query와 화면 최신성

- Source Port의 page size와 한 Query의 최대 page·row 수는 Infrastructure 설정으로 제한하고 응답에 cursor와 source window identity를 포함한다.
- 기간 통계는 소유 모듈의 서버 범위 Query를 사용한다. household·type·date index 범위를 강제하고 전체 lifetime 자료를 무제한 client 조회하지 않는다.
- Client는 `ReportingRequestIdentity`가 현재 Actor session, household, filter와 모두 일치할 때만 결과를 commit한다.
- filter 변경, logout·가구 변경, 화면 종료는 이전 request revision을 무효화하고 가능한 Adapter 요청을 취소한다.

## 5. Application Use Case 상세

### 5.1 `GetLedgerStatistics`

1. Actor의 household 접근을 검증한다.
2. `ExpensePeriodPolicy`로 기간을 계산한다.
3. `LedgerStatisticsSourcePort`에서 기간별 최소 거래 Read DTO를 가져온다.
4. `CategoryReferencePort`에서 활성 category와 예산 설정을 읽는다.
5. 지출만 정규화·집계하고 월 bucket과 category ratio를 만든다.
6. 집계에 필요한 cursor를 끝까지 소비하고 동일 source window의 결과만 조합한다. 최대 안전 한도 또는 window 변경은 `RetryableFailure(SOURCE_WINDOW_INCOMPLETE)`이며 부분 합계를 반환하지 않는다.
7. 원천 중 하나가 실패하면 0/빈 성공이 아니라 typed failure를 반환한다.

### 5.2 `GetAssetStatistics`

1. 기간 preset과 Actor를 검증한다.
2. `PortfolioStatisticsSourcePort`에서 `ALL`이면 최초 유효 point, 제한 기간이면 `startDate` 이하 최근 baseline 한 건과 bounded 기간 snapshot page를 조회한다.
3. 잘못된 숫자·schema는 `ContractFailure`로 격리한다.
4. financialOnly filter 후 날짜별 합계와 유형별 series를 만든다.
5. baseline부터 gap을 carry-forward하되 유효 0원과 NoData를 구분한다.
6. `ALL`의 실제 시작점과 계산 시각을 결과에 명시한다. 중간 공백은 직전 Snapshot을 별도 경고 없이 이어 표시한다.
7. 같은 baseline·window page에서 `HistoricalAssetScopeVisibilityPolicy`가 type·owner dimension catalog를 만들고, 현재 선택이 catalog에 없으면 `전체`로 초기화한다.

### 5.3 화면 Query 조정

1. `ReportingController`가 Actor session generation, household, 정규 filter로 `queryKey`와 증가하는 revision을 만든다.
2. 새 Query를 시작하면 같은 화면의 이전 요청을 취소하거나 obsolete로 표시한다.
3. 응답의 request identity가 현재 값과 다르면 store에 반영하지 않는다.
4. 화면 종료·logout·가구 변경은 현재 revision을 폐기하고 이전 결과와 cursor를 비운다.
5. category detail action은 Command 성공을 기다린 뒤 새 revision으로 재조회한다. 실패한 mutation 뒤 성공한 것처럼 refresh하지 않는다.

### 5.4 카테고리 상세 Action

1. 상세 Query가 transaction ID와 aggregateVersion을 포함한 행을 반환한다.
2. 수정·삭제는 해당 version과 새 idempotency key로 Ledger Command를 호출한다.
3. 규칙 저장은 merchant 원문이 아니라 Payment Configuration이 요구하는 정규화 전 후보 DTO를 보낸다.
4. 성공 결과로 현재 상세 view를 patch하거나 Query를 invalidate한다.
5. 실패·Conflict면 기존 view를 유지하고 재조회 action을 제공한다.

## 6. Port 설계

| Port | 제공자·Adapter | 테스트 대역 |
|---|---|---|
| `LedgerStatisticsSourcePort` | Ledger 공개 bounded Query/Read Adapter | cursor·checkpoint 거래 fixture Stub |
| `CategoryReferencePort` | Category 공개 Query | category fixture |
| `PortfolioStatisticsSourcePort` | Portfolio baseline+window snapshot Query | 0·NoData·failure·cursor history fixture |
| `AssetOwnerHistoricalDisplayPort` | Access archived 포함 ownerRef 표시 조회 | active·archived·failure Stub |
| `LedgerCommandPort` | Ledger `public.ts` | typed result Fake |
| `MerchantRuleCommandPort` | Payment Configuration `public.ts` | command Spy |
| `Clock`·`HouseholdZonePort` | Shared Kernel/Access 설정 | 고정 날짜·zone |
| `ReportingRequestCancellationPort` | Web AbortController/generation Adapter | 늦은 응답 Fake |

순수 기간·집계 Policy에는 Port를 만들지 않는다.

## 7. 저장·트랜잭션·동시성

- 소유 모듈의 Read Contract를 조합해 매 요청마다 계산하고 Reporting 전용 Canonical collection이나 영속 Projection을 만들지 않는다.
- 한 요청의 page는 동일 source window identity를 가져야 하며, 변경을 발견하면 처음부터 재시도하거나 명시적 실패로 종료한다.
- 화면 action과 통계 재조회를 하나의 cross-context transaction으로 묶지 않는다. Command 성공 뒤 새 query revision으로 다시 계산한다.
- 같은 화면의 응답 순서는 네트워크 완료 순서가 아니라 `ReportingRequestIdentity.queryRevision`으로 결정한다. obsolete 응답은 화면 상태나 다음 cursor를 변경하지 않는다.

## 8. Event·조회 연동

Reporting은 Ledger, Category, Portfolio가 제공하는 공개 Query만 호출합니다. 지출 통계를 갱신하기 위한 Event consumer·Inbox·Projector는 두지 않습니다. 자산 통계는 Portfolio가 매일 생성한 Canonical `AssetSnapshot` 조회 계약을 사용하며 Snapshot 자체의 Writer는 Portfolio에만 있습니다.

## 9. 오류·보안·관측성

- 모든 Query는 ActorContext와 household filter를 강제하고 cross-household row를 발견하면 결과에서 숨기는 데 그치지 않고 보안 오류를 기록한다.
- `NoData`와 원천 장애를 별도 UI 상태로 반환한다.
- query page/row 상한 도달과 obsolete response 폐기 횟수를 관측하되 가구·검색 조건 원문을 로그에 남기지 않는다.
- custom date, category ID, cursor는 schema 검증 후 사용한다.
- metric: query latency, source failure, page/window incomplete, obsolete response, category/asset contract failure.
- 거래 memo·merchant 원문을 집계 로그에 남기지 않는다.

## 10. 목표 패키지 구조

```text
functions/src/read-side/reporting/
  application/queries/getLedgerStatistics.ts
  application/queries/getAssetStatistics.ts
  ports/out/
  policies/expensePeriodPolicy.ts
  policies/ledgerAggregationPolicy.ts
  policies/assetAggregationPolicy.ts
  adapters/firestore/
  public.ts
web/src/features/reporting/
  application/reportingController.ts
  adapters/functions-api/
  presentation/
```

데이터 규모가 작은 단계에서는 순수 Policy를 Web에서 재사용하지 않고 서버 Query를 권위 계약으로 삼는다. Web은 생성 DTO와 표시 formatting만 소유한다.

## 11. 테스트 설계

| 요구사항 ID | 수준 | 테스트 대상 | 핵심 fixture·경계값 | 관찰 결과 | Canonical 테스트 ID |
|---|---|---|---|---|---|
| STAT-001 | U | ExpensePeriodPolicy | 월말·윤년, 3/6/12, incomplete custom, 역전 범위 | 정확한 inclusive 월 경계 또는 ValidationError | T-STAT-PERIOD-001~005 |
| STAT-002 | U, I | Ledger Aggregator | expense/income, 빈 월, 취소, category | 지출만 총액·월별·비중 일치 | T-STAT-003 |
| STAT-003 | U, UI | Trend Category Policy | 예산 category 있음/없음, 비활성 category | 결정적 초기 목록과 비영속 토글 | T-STAT-004 |
| STAT-004 | Application, E2E | Reporting Controller | update/delete/rule 성공·실패·Conflict와 소유 모듈 receipt·Event | 성공 후 권위 view·단조 query revision 수렴, 실패 시 기존 상태·revision·receipt/Event 0건 | T-STAT-005 |
| STAT-005 | U, Contract, UI | Source result mapper·화면 state | 성공 0, NoData, timeout, contract drift | 0원 READY와 나머지 typed 상태가 서로 바뀌지 않음 | T-STAT-001 |
| STAT-006 | Contract, I, UI | Ledger·Portfolio bounded Source Port·ReportingController | 단일/다중 page, cursor 누락·중복·끝/상한, checkpoint 변경, A→B filter, logout 뒤 A 응답 | page 구성과 무관한 결과 동등성, 상한 준수·불완전 typed failure·obsolete 결과 write 0건 | T-STAT-002 |
| STAT-AST-001 | U, I, UI | Asset Period Policy·Aggregator | 3/6/12/ALL 정확한 월 경계, 2019 최초 snapshot, property/loan | preset별 포함 범위 일치, 실제 최초 snapshot부터 ALL, financial filter 일치 | T-STAT-AST-001, T-STAT-AST-003 |
| STAT-AST-002 | U, Repository, UI | baseline+window Query·carry policy | 시작 전 여러 후보·직전 0/양수·미래 후보, 첫 기간 point 없음, gap, page 경계, NoData, retryable/contract failure | 시작일 이하 가장 가까운 baseline 포함, gap carry, 0/NoData/두 failure 구분 | T-STAT-AST-001 |
| STAT-AST-003 | U, Contract, I, UI | HistoricalAssetScopeVisibilityPolicy·기간 Controller | deleted type, archived owner, 0 baseline, 현재 목록 부재, 기간 변경 | Snapshot dimension 필터 보존, current UI 미노출, 없는 선택은 전체 초기화 | T-STAT-AST-002 |

필수 공통 suite:

- 동일 fixture를 단일 page와 다중 page Query에 적용해 결과 동등성 검증
- cursor 중복·누락, source window 변경과 안전 상한 초과
- FixedClock/Asia/Seoul로 자정·월 경계 검증
- 가구 A Actor로 가구 B 통계 조회 차단
- source failure가 0원 chart로 변환되지 않는 Client test

## 12. 확정 정책과 구현 순서

현재 Reporting 범위는 총지출·월별·카테고리별 통계이며 카드별로 미리 분류한 별도 통계 차원·화면은 추가하지 않습니다. 다만 카드별 지출 확인 요구는 제거하지 않고 Ledger의 카드 식별 문자열 검색과 검색 결과 전체·월별 합계 계약으로 제공합니다. 이후 전용 카드 통계가 필요해지면 표시 문자열을 암묵적인 집계 key로 재사용하지 않고 별도 요구사항과 안정 identity를 새로 결정합니다.

- [DEC-048](../../../governance/decisions.md#dec-048): 지출 통계는 조회 시 계산하고 자산 Snapshot gap은 직전 성공값을 일반 값으로 이어 표시
- [DEC-058](../../../governance/decisions.md#dec-058): `HistoricalAssetScopeVisibilityPolicy`는 선택 기간 Snapshot의 type·owner dimension을 사용하고 현재 자산 목록과 분리

category archive 뒤 과거 이름은 [DEC-015](../../../governance/decisions.md#dec-015)에 따라 보존합니다. Reporting 영속 Projection은 DEC-048에 따라 도입하지 않으며, 성능은 소유 모듈의 서버 범위 Query·index·내부 pagination으로 해결합니다.

구현 순서:

1. 현재 기간·집계를 Characterization test로 고정한다.
2. 2020 고정 ALL과 시작 직전 baseline 결함을 `T-STAT-AST-001`로 재현한다.
3. 순수 Policy와 baseline+window·bounded Source Port를 화면에서 추출한다.
4. typed source state와 request revision을 가진 공개 Query Handler·Controller를 연결한다.
5. STAT-004 직접 저장을 Ledger/Payment Configuration Client로 교체한다.
6. 성능 측정 후 필요한 projection만 추가한다.
