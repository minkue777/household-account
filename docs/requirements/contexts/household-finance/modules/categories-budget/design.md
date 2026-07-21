# 카테고리·예산 모듈 상세 설계

> 상태: Proposed — 테스트 구현 기준  
> 소유 요구사항: [카테고리·예산 모듈 요구사항](requirements.md)  
> 상위 Context: [Household Finance](../../requirements.md)  
> 공통 상세 설계 규약: [모듈 상세 설계 규약](../../../../governance/module-design-standard.md)  
> 목표 아키텍처: [목표 Clean Architecture 설계](../../../../../architecture/target-clean-architecture.md)

## 1. 설계 목적과 추적성

이 설계는 `CAT-001~004`와 `BUD-001~002`를 Category Catalog Command Domain과 조회 시 계산하는 Budget Query로 분리합니다. 요구사항의 상태와 기대 결과는 [requirements.md](requirements.md)가 소유하며, 이 문서는 API·Domain·저장·테스트 경계를 구체화합니다.

설계 목표는 다음과 같습니다.

- categoryId, 이름, 예산, 정렬, 활성 상태, 기본 category 참조의 최종 Writer를 하나로 만듭니다.
- 기본 다섯 category 초기화를 동시 실행해도 한 집합만 생성합니다.
- 참조 중 category 삭제는 명시적 정책 없이 진행하지 않습니다.
- Ledger는 category reference만 동기 조회하고 Budget은 Ledger의 공개 기간 Query를 통해 월 거래를 읽습니다.
- Budget 조회 실패·데이터 없음과 실제 지출 0원을 구분합니다.
- Android QuickEdit은 정상적인 빈 Catalog와 Repository 실패를 구분합니다.

관련 기준은 [데이터 소유권](../../../../cross-cutting/data-ownership.md), [수동 거래 흐름](../../../../system/flows.md#2-web-수동-거래), [테스트 전략](../../../../governance/test-strategy.md), [보안 경계](../../../../cross-cutting/security-privacy.md)를 따릅니다.

## 2. 모듈 경계와 책임

### 2.1 내부 기능

| 기능 | 책임 | 일관성 경계 |
|---|---|---|
| Category Catalog | 초기화, 생성, 수정, archive 준비, 정렬 | 가구 Catalog version과 영향 category 문서 |
| Default Category | active categoryId를 가구 기본 참조로 설정 | Catalog settings + receipt + Outbox |
| Category Reference | Ledger·Recurring·Payment Configuration에 안정 ID와 사용 가능 상태 제공 | 읽기 일관성 |
| Budget Domain | category별 사용액·비율·초과액, 월 잔여 예산 계산 | 순수 계산 |
| Budget Query | 요청 월의 Ledger page를 모두 읽어 월·category별로 계산 | 한 요청의 일관된 source window |

### 2.2 경계 밖

- Transaction의 categoryId와 지출 사실은 Ledger가 소유합니다.
- merchant mapping은 Payment Configuration이 소유합니다.
- recurring plan의 categoryId 참조는 Recurring이 소유합니다.
- 홈 카드 구성과 시각 표현은 Home Preferences/Web Presentation이 소유합니다.
- 기존 `households.defaultCategoryKey`의 물리 위치가 Access 소유권을 의미하지 않습니다. 목표 V2에서는 Category settings로 분리합니다.

[DEC-015](../../../../governance/decisions.md#dec-015)에 따라 삭제 요청은 과거 참조를 보존하는 archive입니다. `CategoryRetirementPolicy`는 기본 카테고리 삭제를 거부하고, 다른 카테고리의 과거 거래는 유지하면서 정기지출·가맹점 규칙 같은 설정 참조만 현재 기본 카테고리로 변경합니다. hard delete·과거 거래 remap·재활성화는 제공하지 않습니다.

## 3. 공개 계약

공통 `CommandEnvelope`, `ActorContext`, Result union은 [공통 Application 계약](../../../../governance/module-design-standard.md#3-공통-application-계약)을 사용합니다. Category Entity와 Firestore DTO는 공개하지 않습니다.

### 3.1 공개 Input Port

| 이름·종류 | 호출자 | 입력 DTO | 결과 | 권한 | 일관성 | 멱등성 |
|---|---|---|---|---|---|---|
| `InitializeDefaultCategories` Command v1 | 가구 온보딩 handler, Web 설정 | catalogVersion | `Success<CategoryCatalogView>`, `AlreadyProcessed`, `Conflict`, `Forbidden` | `category.manage` 또는 제한된 onboarding actor | 기본 category 집합·settings·receipt·Outbox 한 UoW | `householdId:catalogVersion` |
| `UpdateCategoryCatalog` Command v1 | Web 설정 | create/update/archive/reorder operation | `Success<CategoryCatalogView>`, `Accepted<ArchiveProcessView>`, `ValidationError`, `NotFound`, `Conflict` | `category.manage` | 일반 변경 UoW 또는 재개 가능한 archive process | envelope key + catalogVersion |
| `ContinueCategoryArchiveProcess` Process Command v1 | archive worker, 운영 재개 | processId, page limit | `Success<ArchiveProcessView>`, `PartialFailure`, `RetryableFailure`, `Conflict` | `category.archive.process` SystemActor | 소비 모듈별 page UoW와 Category checkpoint UoW | processId+consumer+cursor |
| `SetDefaultCategory` Command v1 | Web 설정 | categoryId, expectedCatalogVersion | `Success<DefaultCategoryView>`, `ValidationError`, `NotFound`, `Conflict` | `category.manage` | settings·receipt·Outbox 한 UoW | envelope key + version |
| `GetCategoryReference` Query | Ledger, Recurring, Payment Configuration | categoryId, requiredUsage | `Success<CategoryReference>`, `NotFound`, `Conflict(CATEGORY_NOT_USABLE)`, `RetryableFailure` | 가구 범위 내부 capability | 읽기 일관성 | 해당 없음 |
| `ListActiveCategories` Query/Read Contract | Web, Android, Payment Capture | optional cursor/limit | `Success<CategoryPage>`, `NoData`, `RetryableFailure`, `Forbidden` | `category.read` | `sortOrder ASC, categoryId ASC` | 해당 없음 |
| `GetMonthlyBudget` Query | Web·Home·Reporting | `YYYY-MM` | `Success<MonthlyBudgetView>`, `NoData`, `RetryableFailure`, `ContractFailure` | `budget.read` | Ledger 기간 Query의 모든 page 완료 뒤 계산 | 해당 없음 |
| `GetBudgetStatus` Query | Web | month, optional categoryId | `Success<BudgetStatusView>`, `NoData`, `RetryableFailure`, `ContractFailure` | `budget.read` | 같은 월 Query 결과에서 계산 | 해당 없음 |

`UpdateCategoryCatalog`의 operation은 versioned discriminated union입니다.

| kind | payload | 추가 규칙 |
|---|---|---|
| `create` | name, color, optional budgetInWon | 새 categoryId는 서버 생성 |
| `update` | categoryId, 변경 필드, expectedCategoryVersion | budget 미설정은 null, 숫자 아님·음수 거부 |
| `archive` | categoryId, expectedCategoryVersion | default이면 거부; 설정 참조는 현재 default로 변경; 과거 거래 유지 |
| `reorder` | 전체 categoryId 순서, expectedCatalogVersion | 누락·중복·타 가구 ID 거부 |

### 3.2 Read Model

| 타입 | 필드 |
|---|---|
| `CategoryReference` | categoryId, displayName, active, usableFor, categoryVersion |
| `CategoryView` | categoryId, name, color, budgetInWon 또는 null, active, sortOrder, version |
| `CategoryCatalogView` | householdId, categories, defaultCategoryId 또는 null, catalogVersion |
| `CategoryBudgetStatus` | categoryId, budget, spent, progress 또는 null, overrun |
| `MonthlyBudgetView` | month, category statuses, totalBudget, budgetedCategoryExpense, totalExpense, remainingBudget, calculatedAt |

예산 결과는 저장된 Projection이 아니라 요청 시 계산한 값입니다. 따라서 `freshness`나 `rebuilding` 상태를 반환하지 않습니다. 유효한 0원, `NoData`, `RetryableFailure`, `ContractFailure`를 서로 합치지 않습니다.

### 3.3 Android QuickEdit 계약

Android는 `ListActiveCategories`의 typed 상태를 그대로 ViewModel에 전달합니다.

- `Success(non-empty)`: 서버 순서의 category를 표시합니다.
- `NoData`: 온보딩/초기화 유도 또는 명시된 호환 기본 목록을 표시할 수 있습니다.
- `RetryableFailure`: 오류·재시도 상태를 표시하며 기본 목록으로 위장하지 않습니다.
- 로컬 cache가 있더라도 조회 실패를 성공으로 바꾸지 않고 실패 사실을 유지합니다.

## 4. Domain 모델과 불변식

### 4.1 Category Catalog

| 모델 | 주요 상태 | 불변식 |
|---|---|---|
| `CategoryCatalog` Aggregate | householdId, catalogVersion, ordered category IDs, defaultCategoryId | 순서 목록에 중복·타 가구 category 없음; default는 active category |
| `Category` Entity | categoryId, name, color, budget, status(active·archive-pending·archived), sortOrder, version | 이름 비공백, budget은 null 또는 0 이상 정수, stable ID, archived도 표시 정보 보존 |
| `DefaultCategorySettings` | defaultCategoryId, version | 없는/archived category를 참조하지 않음 |
| `CategoryArchiveProcess` | processId, categoryId, defaultCategoryId, historical reference count, 설정 remap checkpoint, status | target≠default, 과거 참조 유지, 설정 참조는 default로 변경, 완료 뒤 archived, 재활성화·hard delete 없음 |

기본 초기화 정의는 다음 stable key와 순서를 가진 Domain fixture입니다: `living`, `childcare`, `fixed`, `food`, `etc`. 초기 default는 현재 명세의 `etc`입니다. Catalog가 완전히 비어 있을 때만 한 번 생성하고, 일부만 존재하면 누락분을 자동 보충하지 않습니다.

### 4.2 Budget

`MonthlyBudgetCalculator`는 다음 규칙을 소유합니다.

- category별 `spent`는 해당 월 Ledger expense의 합입니다.
- budget이 null 또는 0 이하이면 progress는 null입니다.
- budget보다 spent가 크면 `overrun = spent - budget`, 아니면 0입니다.
- `totalBudget`은 budget이 설정된 active category의 합입니다.
- `budgetedCategoryExpense`는 budget이 설정된 active category에 속한 expense만 합합니다.
- `remainingBudget = totalBudget - budgetedCategoryExpense`입니다.
- budget 없는 category의 expense도 `totalExpense`에는 포함합니다.

Money 계산은 정수 원 단위만 사용하며 NaN/Infinity는 wire schema 단계에서 거부합니다.

### 4.3 정책

| Policy/Port | 책임 | 상태 |
|---|---|---|
| `CategoryRetirementPolicy` | target/default 동일 여부와 유효 default를 검사해 Reject 또는 ArchivePlan 선택 | DEC-015 확정 |
| `CategoryUsageQueryPort` | Ledger historical count, Recurring·Payment Configuration 설정 참조 page를 공개 계약으로 조회 | 구현 필요 |
| `CategoryReferenceRemapPort` | Recurring·Payment Configuration 공개 Command로 설정 참조를 defaultCategoryId로 멱등 변경 | 구현 필요 |
| `CatalogWriteLimitPolicy` | reorder/초기화의 transaction 크기 검증 | 기술 설정 |
| `BudgetSourceWindowPolicy` | 요청 월의 시작·끝, cursor 상한, source window 일관성 검증 | DEC-048 확정 |

archive 요청에서 target이 현재 default이면 `Conflict(CATEGORY_IS_DEFAULT)`, 유효한 active default가 없으면 `Conflict(DEFAULT_CATEGORY_REQUIRED)`입니다. 그 외에는 target을 `archive-pending`으로 전환해 신규 참조를 막고, RecurringPlan·MerchantRule 등 설정 참조를 현재 defaultCategoryId로 page 단위 변경하는 `ArchiveCategoryProcess`를 시작합니다. 과거 Ledger 거래는 조회만 하고 categoryId를 변경하지 않습니다. 모든 설정 remap이 완료된 뒤 target을 `archived`로 전이합니다. 중간 실패는 process checkpoint에서 재개하며 archived를 다시 active로 바꾸는 Command는 없습니다.

## 5. Application Use Case 상세

### 5.1 InitializeDefaultCategories

1. Actor와 가구 active 상태, capability를 검증합니다.
2. catalogVersion과 idempotency payload hash를 확인합니다.
3. Catalog가 비어 있는지 transaction 안에서 다시 읽습니다.
4. 완전히 비어 있으면 결정적 category IDs로 기본 다섯 Entity와 settings를 만듭니다.
5. 일부 또는 전체가 있으면 추가 문서를 만들지 않고 `AlreadyProcessed`와 현재 Catalog를 반환합니다.
6. category 문서, settings version, receipt, `CategoryCatalogChanged.v1`을 한 UoW로 commit합니다.
7. 동시 두 요청은 같은 결정 ID 경합으로 한 집합에 수렴합니다.

### 5.2 UpdateCategoryCatalog

1. operation schema, expected catalog/category version, 권한을 검증합니다.
2. create/update는 이름·색·budget Value Object를 생성합니다.
3. reorder는 Catalog에 속한 전체 ID가 정확히 한 번씩 있는지 확인합니다.
4. archive는 target과 현재 default를 `CategoryRetirementPolicy`에 전달합니다. 둘이 같거나 default가 유효하지 않으면 아무것도 변경하지 않고 Conflict입니다.
5. target을 결정적 process ID로 `archive-pending` 전이해 신규 참조를 차단하고 `ArchiveCategoryProcess`를 생성합니다.
6. Ledger historical usage는 보존 근거로만 기록하고, `CategoryReferenceRemapPort`가 Recurring·Payment Configuration의 설정 참조를 defaultCategoryId로 page 단위 멱등 변경합니다.
7. 모든 remap checkpoint가 완료되면 표시 정보를 유지한 채 target을 `archived`로 전이하고 catalogVersion, receipt, `CategoryArchived.v1`을 commit합니다. 실패는 다음 실행에서 같은 processId로 이어서 처리합니다.

`ContinueCategoryArchiveProcess`는 `RemapRecurringCategoryReferences`와 `RemapMerchantRuleCategoryReferences`만 호출합니다. 각 응답의 opaque cursor를 소비 모듈별 checkpoint로 저장하고, 한 소비 모듈의 실패를 다른 모듈의 완료로 위장하지 않습니다. 다른 모듈의 Repository나 Firestore 경로에는 접근하지 않습니다.

### 5.3 SetDefaultCategory

1. Actor와 expected catalogVersion을 검증합니다.
2. `GetCategoryReference`와 동일한 Domain 판정으로 대상이 active인지 확인합니다.
3. settings와 catalogVersion, receipt, Event를 한 UoW로 commit합니다.
4. Web manual과 Android captured flow는 이후 같은 `GetCategoryReference(default)` 계약을 사용합니다.
5. retry는 최초 result를 재생합니다.

### 5.4 List/Get Reference

- Repository 오류를 `NoData`로 변환하지 않습니다.
- 목록은 active만 `sortOrder, categoryId` 순으로 반환하므로 archived는 신규 거래·수정·QuickEdit 선택에 나타나지 않습니다.
- `GetCategoryReference(requiredUsage=historical-display)`는 archived의 displayName·color를 반환하지만 `new-transaction`, `default`, `recurring`, `merchant-mapping` usage는 `Conflict(CATEGORY_NOT_USABLE)`입니다.
- Reference는 Entity 전체가 아니라 사용 가능 여부와 최소 표시값만 반환합니다.
- 가구 A Actor가 가구 B categoryId를 조회하면 정보 노출 없이 NotFound/Forbidden 정책을 일관 적용합니다.

### 5.5 GetMonthlyBudget

1. Actor, householdId, `YYYY-MM`을 검증하고 가구 시간대로 월 시작·끝을 계산합니다.
2. Category Catalog의 현재 예산 설정과 필요한 과거 표시 정보를 읽습니다.
3. Ledger 공개 Query에 householdId와 월 날짜 범위를 전달하고 opaque cursor로 page를 순회합니다. Category 모듈이 Ledger Repository나 Firestore 경로를 직접 읽지 않습니다.
4. 모든 page가 같은 source window에 속하는지 확인하고 전체 page를 수집한 뒤 `MonthlyBudgetCalculator`로 한 번 계산합니다.
5. 중간 page 실패, cursor 이상, source window 변경, 안전 상한 초과는 부분 합계를 반환하지 않고 typed failure로 종료합니다.
6. 거래가 없더라도 Category 예산이 존재하면 유효한 0원 사용액을 가진 `Success`이며, Category와 거래가 모두 없을 때만 `NoData`입니다.

## 6. Port 설계

### 6.1 Output Port

| Port | 책임 | 계약 핵심 |
|---|---|---|
| `CategoryCatalogRepository` | Catalog/settings/category 조회와 persistence mapping | stable ID, version, NoData/실패 구분 |
| `CategoryUnitOfWork` | Catalog 변경·receipt·Outbox 원자 commit | callback 재실행, 결정 ID 경합 |
| `CategoryUsageQueryPort` | 소비 모듈의 historical count·설정 참조 page 조합 | consumer 내부 Repository 비노출 |
| `CategoryReferenceRemapPort` | Recurring·Payment Configuration remap Command 조정 | processId+consumer+page key 멱등, 부분 진행 checkpoint |
| `LedgerBudgetSourcePort` | 월 범위 Ledger page Query | 결정 cursor, 동일 source window, 전체 page 완료 |
| `OutboxAppendPort` | `CategoryCatalogChanged.v1` append | immutable envelope |
| `Clock` / `IdGenerator` | timestamp와 사용자 category ID | 고정 fixture |
| `ObservabilityPort` | catalog/query trace | category 이름·금융 상세 최소화 |

`CategoryUsageQueryPort`는 직접 collection query가 아니라 Ledger의 historical reference count와 Recurring·Payment Configuration의 설정 참조 page를 공개 Query 계약으로 조합합니다. `CategoryReferenceRemapPort`도 각 모듈의 공개 Command만 호출하며 Repository를 import하지 않습니다. hard delete, 과거 거래 remap, archived→active Port는 제공하지 않습니다.

### 6.2 Adapter

- Firestore Catalog Adapter와 Legacy settings Mapper
- Ledger 월 범위 Query Adapter
- callable Command/Query Adapter
- Web Firestore Read Model Adapter
- Android API Category Adapter

각 Adapter는 공급자 예외를 typed Result로 변환할 뿐 category/budget 정책을 결정하지 않습니다.

## 7. 저장·트랜잭션·동시성

### 7.1 논리 저장

| 데이터 | 목표 key | Writer |
|---|---|---|
| Category | `households/{householdId}/categories/{categoryId}` | Category Catalog |
| Catalog settings | `households/{householdId}/categorySettings/default` | Category Catalog |
| receipt/outbox | 공통 platform 경로 | 각 Category Command Port |

Catalog settings는 catalogVersion, ordered IDs, defaultCategoryId를 갖습니다. Category 문서는 categoryVersion, schemaVersion, server timestamps를 갖습니다. `MonthlyBudgetView`는 요청 결과이므로 저장 경로가 없습니다.

### 7.2 UoW와 경합

- 초기화: 결정적 기본 문서 전체 + settings + receipt + Outbox.
- category create/update/reorder: 영향 문서 + settings version + receipt + Outbox.
- default 설정: settings + receipt + Outbox.

같은 빈 가구 초기화 동시 두 번은 결정 ID와 catalogVersion precondition으로 한 집합에 수렴합니다. reorder는 expectedCatalogVersion이 다르면 전체 Conflict입니다. Budget Query는 저장을 수행하지 않으며 같은 원천 page 집합에 대해 항상 같은 계산 결과를 만듭니다.

### 7.3 Legacy 전환

1. Legacy Catalog Adapter가 현재 `categories`와 `households.defaultCategoryKey`를 읽습니다.
2. 새 Application만 legacy 경로에 쓰도록 Writer를 먼저 통합합니다.
3. categoryId 안정성, budget 숫자, sortOrder를 backfill·검증합니다.
4. `categorySettings/default`를 dual-read하고 shadow compare합니다.
5. Transaction/Recurring/Merchant 참조 usage report를 생성합니다.
6. V2 read 전환 후 household 혼합 필드와 client direct write를 제거합니다.

Legacy default field 접근은 전환 Adapter 하나로 제한하고 목표 패키지의 다른 모듈에 household collection name을 노출하지 않습니다.

## 8. Event·Query 연동

### 8.1 생산 Event

| Event | 최소 payload | 소비자 |
|---|---|---|
| `CategoryCatalogChanged.v1` | householdId, catalogVersion, changedCategoryIds, changeKind | Payment Configuration, Web read model |
| `DefaultCategoryChanged.v1` | householdId, categoryId, catalogVersion | Payment Capture, UI cache |

Event에 전체 Catalog나 거래 내역을 넣지 않습니다. consumer는 필요하면 `GetCategoryReference`를 호출하고 eventId Inbox로 멱등 처리합니다.

### 8.2 Ledger Query 계약

Budget은 Ledger의 공개 월 범위 Query만 사용합니다. householdId·날짜 범위·결정적 정렬·opaque cursor를 전달하고 마지막 cursor까지 모두 처리한 뒤 계산합니다. Ledger 내부 Entity나 Firestore 경로를 읽지 않으며 Event consumer와 Projection 저장소를 두지 않습니다.

## 9. 오류·보안·관측성

### 9.1 오류 코드

| 분류 | 코드 예 |
|---|---|
| 검증 | `CATEGORY_NAME_REQUIRED`, `INVALID_COLOR`, `BUDGET_NOT_NON_NEGATIVE_INTEGER`, `ORDER_IDS_MISMATCH` |
| 참조 | `CATEGORY_NOT_FOUND`, `CATEGORY_NOT_ACTIVE`, `CATEGORY_IS_DEFAULT` |
| 정책 | `CATEGORY_IS_DEFAULT`, `DEFAULT_CATEGORY_REQUIRED`, `CATEGORY_NOT_USABLE` |
| 충돌 | `CATALOG_VERSION_MISMATCH`, `CATEGORY_VERSION_MISMATCH`, `IDEMPOTENCY_PAYLOAD_MISMATCH` |
| Query | `SOURCE_WINDOW_INCOMPLETE`, `SOURCE_PAGE_LIMIT_EXCEEDED`, `SOURCE_CONTRACT_INVALID` |

### 9.2 보안

- Catalog write는 서버 Command와 `category.manage` capability만 허용합니다.
- 공개 category read와 Budget Query는 같은 household Membership만 읽습니다.
- receipt와 Outbox는 server-only입니다.
- client가 householdId, sortOrder, server timestamp를 우회 변경하지 못하게 Rules를 둡니다.
- 타 가구 categoryId와 cursor로 query 범위를 넓히는 요청을 Emulator에서 거부합니다.

### 9.3 관측성

Catalog command result, catalogVersion, 변경 kind/개수, Budget query page 수·latency·불완전 원인을 기록합니다. category 이름과 개별 거래 내용은 일반 운영 로그에 남기지 않습니다.

## 10. 목표 패키지 구조

아직 없는 경로는 `목표`입니다.

```text
functions/src/contexts/household-finance/category-budget/
  domain/
    catalog/
    budget/
    policies/
  application/
    commands/
    queries/
    ports/in/
    ports/out/
  adapters/
    out/firestore-catalog/
    out/ledger-budget-query/
    out/legacy-settings/
  public.ts

web/src/features/category-budget/
  application/
  adapters/functions-api/
  adapters/firestore-read-model/
  presentation/
  public.ts

android/feature/payment-ingestion/
  adapters/category-api/
```

Budget Domain은 Ledger Domain을 import하지 않고 공개 월 범위 Query DTO만 사용합니다.

## 11. 테스트 설계

### 11.1 계층별 suite

- Domain Unit: category Value Object, budget null/0/초과, remaining budget, reorder.
- Application: 초기화·수정·archive·default 권한과 receipt, default archive 거부, 설정 remap checkpoint·재시도.
- Contract: Category Reference, Android state, Ledger Budget Source page 계약.
- Repository Conformance: Fake/V1/V2의 정렬·version·NoData 의미.
- Emulator: 초기화 경합, reorder rollback, Rules, 월 범위 Query와 cursor.
- Query: 다중 page 완전 집계, source window 변경·상한·중간 실패 시 부분 결과 금지.
- Client: QuickEdit와 Budget의 Success/NoData/Failure 상태.

### 11.2 요구사항 추적 표

| 요구사항 ID | 테스트 수준 | 테스트 대상 | 핵심 fixture/경계값 | 관찰 결과 | Canonical 테스트 ID |
|---|---|---|---|---|---|
| CAT-001 | Domain·Emulator | InitializeDefaultCategories | empty, partial, complete, 동시 두 요청 | empty만 기본 다섯 개, partial 보충 없음, 중복 없음 | T-CAT-001, T-CAT-002 |
| CAT-002 | Domain·Application·Emulator | UpdateCategoryCatalog·ArchiveCategoryProcess | null·0·음수·NaN budget, historical-only, 정기·가맹점 참조, remap page 실패·재시도 | 과거 거래·표시 보존, 설정은 default로 수렴, 완료 뒤 archived, 재활성화 없음 | T-CAT-003, T-CAT-004 |
| CAT-003 | Application·Contract | SetDefaultCategory/Reference | active, archived, 없는 category, default category archive, default 없음 | active만 default 가능, 현재 default archive Conflict, 유효 default 없이 archive 없음 | T-CAT-004 |
| CAT-004 | Legacy Adapter Characterization·Contract·Client | Legacy QuickEdit category Adapter·ListActiveCategories·Get historical reference | 정상 목록, legacy empty/failure, archived historical display, 목표 NoData·Repository 실패, cache | legacy만 기본 다섯 개 표시 fallback·write 없음, 목표 선택 목록은 active만, 과거 표시는 archived 이름 유지, 오류와 빈 상태 구분 | T-CAT-005, T-CAT-006 |
| BUD-001 | Domain·Query | CategoryBudgetStatus | null/0 budget, 경계 일치, 1원 초과 | progress null 또는 정확 비율·초과액 | T-BUD-001 |
| BUD-002 | Domain·Query | MonthlyBudgetView | 예산/무예산 category expense, inactive category, 다중 page·중간 실패 | 모든 page 완료 때만 budgeted expense·total을 계산하고 부분 합계 금지 | T-BUD-001 |

### 11.3 추가 경계 fixture

기존 Canonical ID를 새로 만들지 않고 다음 case를 해당 suite에 포함합니다.

- cursor page 중복·누락과 source window 변경
- transaction이 요청 월 경계 안팎에 정확히 포함되는 날짜 조건
- 가구 A Actor의 가구 B category read/write
- 같은 idempotency key의 동일/상이 payload

## 12. 미결정 사항과 구현 순서

### 12.1 확정 정책

[DEC-048](../../../../governance/decisions.md#dec-048)에 따라 Budget은 영속 Projection과 freshness 상태를 만들지 않고 요청 월 원천을 모두 읽어 계산합니다.

부분 legacy Catalog는 요구사항대로 자동 보충하지 않습니다. 누락 default를 추정해 사용자 catalog를 바꾸는 대신 reconciliation report와 명시적 운영 migration만 허용하므로 별도 제품 결정을 기다리지 않습니다.

### 12.2 구현 순서

1. 기존 초기화·budget 계산·QuickEdit 상태에 Characterization test를 붙입니다.
2. Category Value Object와 `ListActiveCategories` typed contract를 추출합니다.
3. `InitializeDefaultCategories`를 결정 ID와 transaction으로 전환합니다.
4. Create/Update/Reorder/Default Command를 서버 Writer로 통합합니다.
5. category reference를 Ledger·Recurring·Payment Configuration에 연결합니다.
6. Ledger 월 범위 Query Adapter와 `GetMonthlyBudget`를 만들고 다중 page·실패·상한 테스트를 활성화합니다.
7. V2 settings를 shadow compare하고 `households.defaultCategoryKey`와 client direct write를 제거합니다.
8. DEC-015 archive process와 historical display, default archive 거부, 설정 참조 default remap·재시도 테스트를 활성화합니다.
