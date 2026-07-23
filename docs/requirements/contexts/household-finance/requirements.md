# Household Finance Bounded Context 요구사항 지도

> 문서 유형: Business Bounded Context  
> 소유 기능 모듈: 거래 원장, 카테고리·예산, 정기 거래, 지역화폐  
> 소유 요구사항: 40개  
> 목표 구조: [목표 Clean Architecture 설계](../../../architecture/target-clean-architecture.md#5-bounded-context와-기능-모듈)

## 1. 책임과 경계

Household Finance Context는 **가구의 일상적인 금전 기록과 분류·계획·지역화폐 최신 잔액**을 관리한다. 거래 원장을 Canonical 재무 기록으로 두고, 카테고리 카탈로그, 조회 시 계산하는 월 예산, 정기 거래 계획, 지역화폐 잔액을 독립 경계로 구성한다.

이 문서는 Context 수준의 경계와 상호작용을 정리한다. 40개 상세 요구사항은 아래 네 기능 문서가 한 번씩만 소유한다.

포함 범위:

- 지출·수입 CRUD와 월·일·카테고리 조회
- 항목 분할, 월 분할, 합치기·해제, 취소
- 카테고리 정의·정렬·기본값과 월 예산 계산
- 정기 거래 정의, 월말 보정, 일일 서버 처리와 누락 월 자동 복구
- 지역화폐 최신 잔액과 관찰 시각

제외 범위:

- Android·Shortcut 원문 parsing과 결제 출처 신뢰 정책
- 등록 카드와 가맹점 자동 mapping
- FCM 대상과 실제 전송
- 자산·보유종목·배당 원장
- 통계·홈 화면의 표현과 기간 UI

## 2. 내부 기능과 요구사항

| 기능 모듈 | 요구사항 | 개수 | 독립 책임 | 상세 소유 문서 |
|---|---|---:|---|---|
| 거래 원장 | LED-*, SPL-*, MRG-*, SEA-* | 23 | 거래 생명주기와 원자적 그룹 작업 | [거래 원장](modules/ledger/requirements.md) |
| 카테고리·예산 | CAT-*, BUD-* | 6 | Category Catalog와 Budget Query | [카테고리와 예산](modules/categories-budget/requirements.md) |
| 정기 거래 | REC-* | 6 | RecurringPlan, 월 처리 checkpoint, 카테고리 참조 변경 | [정기 거래](modules/recurring-transactions/requirements.md) |
| 지역화폐 | BAL-* | 5 | LocalCurrencyBalance 최신 상태 | [지역화폐](modules/local-currency/requirements.md) |
| 합계 |  | 40 |  |  |

## 3. 공통 언어

| 용어 | 의미 |
|---|---|
| Transaction | 한 가구의 지출 또는 수입 Canonical 기록 |
| Ledger | Transaction의 생성·변경·조회 규칙과 저장 경계 |
| Item Split | 원금 합계를 보존하면서 한 거래를 여러 항목으로 교체하는 작업 |
| Monthly Split | 원금을 여러 달의 내림 금액으로 나누는 [DEC-001](../../governance/decisions.md#dec-001) 정책 |
| Split Group | 월 분할 재구성·취소를 함께 수행하는 거래 집합 |
| Merge Snapshot | 합치기 해제에 필요한 원본 거래 정보 |
| Category Catalog | 안정 categoryId, 이름, 색, 예산, 순서, 기본값의 가구 단위 집합 |
| Monthly Budget View | Category와 요청 월 Transaction에서 조회 시 계산하는 사용액·잔여액 |
| RecurringPlan | 월간 거래 생성 규칙과 마지막 처리 상태 |
| LocalCurrencyBalance | 가구·통화 유형별 최신 관찰 잔액 |

## 4. Aggregate와 소유 데이터

| 기능 모듈 | Aggregate·데이터 | 핵심 불변식 | 현재 컬렉션 |
|---|---|---|---|
| Ledger | Transaction | 양의 원 단위 금액, 가구·유형·source·creator | `expenses` |
| Ledger | MonthlySplitGroup | DEC-001, 그룹 전체 재구성·취소 원자성 | `expenses` 분할 문서 |
| Ledger | MergedTransaction | 합계 거래와 복원 snapshot | `expenses.mergedFrom` |
| Ledger | Capture Dedup Claim | Payment fingerprint 한 번 | 목표 `ledgerDedupKeys` |
| Category/Budget | CategoryCatalog | 안정 ID, 순서, 기본 참조, 예산 값 | `categories`, 현재 household 일부 필드 |
| Category/Budget | MonthlyBudgetView | 원천 수정 권한 없는 요청 단위 계산 결과이며 영속 저장하지 않음 | 현재 클라이언트 계산 |
| Recurring | RecurringPlan | plan/month 한 번, 월말 보정 | `recurring_expenses` |
| Local Currency | LocalCurrencyBalance | 원 단위 정수, 관찰 시각, 없음·오류 구분 | `balances` |

`expenses`, `categories`, `recurring_expenses`, `balances`에는 각각 위 기능 모듈 하나만 최종 Writer가 된다.

## 5. Context 불변식

1. 모든 Canonical 데이터는 householdId 범위와 ActorContext 인가를 가진다.
2. 정상 거래 금액은 0보다 큰 원 단위 정수다.
3. Item Split은 원금 합계를 보존한다.
4. Monthly Split은 모든 달에 내림 금액을 저장하고 나머지를 반영하지 않는다.
5. split·merge·unmerge·cancel은 전체 성공 또는 전체 실패다.
6. 같은 Payment fingerprint는 Transaction 한 건에만 연결된다.
7. Category 참조는 안정 ID를 사용하며 삭제·비활성화 정책을 통과한다.
8. Budget Query는 Ledger 원본을 수정하지 않고 요청 월의 모든 page를 읽은 뒤 계산한다.
9. 같은 RecurringPlan·대상 월은 재실행해도 거래 한 건만 생성한다.
10. 정기 거래 생성과 plan checkpoint 갱신은 하나의 Finance Unit of Work다.
11. 유효한 지역화폐 잔액 관찰은 거래 저장 성공 여부와 독립적으로 반영할 수 있다.
12. Repository 실패를 빈 목록, 0원, 이미 처리됨으로 위장하지 않는다.
13. 가구 purge는 같은 processId·checkpoint 재호출에 안전하며, 한 페이지 실패가 다음 페이지 완료로 기록되지 않는다.

## 6. 공개 계약과 의존 방향

### Context 내부 제공 계약

| 기능 모듈 | 주요 공개 계약 |
|---|---|
| Ledger | `RecordManualTransaction`, `RecordCapturedTransaction`, `RecordRecurringTransaction`, `Update`, `Delete`, `Split`, `Merge`, `Unmerge`, `CancelCapturedLineage`, `FindCancellationCandidates`, `SearchLedger`, `SubscribeLedger`, `ListLocalCurrencyTransactions` |
| Category/Budget | `GetCategoryReference`, `ListActiveCategories`, `UpdateCategoryCatalog`, `ContinueCategoryArchiveProcess`, `SetDefaultCategory`, `GetMonthlyBudget`, `GetBudgetStatus` |
| Recurring | `ManageRecurringPlan`, `CalculateEffectiveDay`, `ProcessRecurringMonth`, `ProcessDueRecurringPlans`, `RemapRecurringCategoryReferences` |
| Local Currency | `RecordBalanceObservation`, `GetBalance`, `SubscribeBalance` |
| Context Lifecycle | `PurgeHouseholdData(householdId, processId, checkpoint)` → 공통 `PurgePageResult` |

### 상위·외부 의존

- Access & Household: ActorContext, Membership, active/deleted/purging 상태
- Clock, IdGenerator, UnitOfWork, Repository Port
- Payment Capture Intake: Ledger와 Local Currency Command의 주요 소비자
- Payment Configuration: Category Catalog의 category reference·기본값을 소비해 Merchant Rule mapping을 검증하고, Category Archive Process에는 `RemapMerchantRuleCategoryReferences`를 제공
- Notifications: Ledger Event 소비자
- Reporting·Home Preferences: 공개 Finance Query 소비자

Ledger는 Category Reference를 동기 조회할 수 있다. Budget Query는 Ledger 구현을 import하지 않고 공개 월 범위 Query를 cursor로 모두 소비하여 순환 의존을 피한다.

`FindCancellationCandidates`는 가구 범위·조회 기간에 해당하는 거래 ID, 분할 그룹 ID, 저장된 날짜·시각·금액·가맹점 같은 **원장 사실만** 반환한다. 완전 일치·후보 유일성·자동 취소 여부는 계산하지 않으며, 해당 정책은 Payment Capture의 `CancellationMatchPolicy`가 소유한다.

`PurgeHouseholdData`는 Finance 내부 기능의 Canonical 데이터와 Projection을 결정적인 page로 삭제하고 [공통 paged purge 결과 계약](../../cross-cutting/data-ownership.md#41-공통-paged-purge-계약)을 반환한다. 일반 논리 삭제에서는 호출하지 않으며, 별도 승인된 Access `HouseholdPurgeProcess`만 영구 삭제 목적으로 호출한다. 같은 processId·checkpoint 재시도는 동일 결과 재생 또는 안전한 no-op으로 수렴해야 한다.

## 7. 공개 Event와 종단 흐름

| Event | 소유 모듈 | 주요 소비자 |
|---|---|---|
| `TransactionRecorded.v1` | Ledger | Budget, Notifications, Reporting |
| `TransactionChanged.v1` | Ledger | Budget, Reporting |
| `TransactionDeleted.v1` | Ledger | Budget, Reporting |
| `HouseholdNotificationRequested.v1` | Ledger | Notifications |
| `CategoryCatalogChanged.v1` | Category/Budget | Payment Configuration, UI Read Model |
| `LocalCurrencyBalanceChanged.v1` | Local Currency | 필요한 외부 관측 소비자; Home은 직접 Query 사용 |
| `RecurringPlanProcessed.v1` | Recurring | 운영 관측; 거래 사실은 Ledger Event가 소유 |

Context 내부 대표 흐름:

- Web 수동 거래: Category Reference → Ledger transaction + Outbox → Read Contract
- 월 분할: 원본 조회 → DEC-001 계획 → 그룹 전체 원자 교체
- 정기 거래: 일일 Scheduler → 누락 due month page → plan/month별 Ledger posting + checkpoint + Outbox 원자 commit
- 예산: 요청 월 → Ledger 범위 Query 전체 page → 월별 예산 계산
- 지역화폐: 검증된 balance observation → 결정적 잔액 upsert

Context를 넘는 결제·취소 흐름은 [Payment Capture Context](../payment-capture/requirements.md), 전체 종단 순서는 [시스템 종단 흐름](../../system/flows.md)을 따른다.

## 8. 제품 결정과 Human in the loop

| 결정 | 소유 기능 | 영향 |
|---|---|---|
| [DEC-001](../../governance/decisions.md#dec-001) | Ledger | 월 분할 금액과 취소 합계 |
| [DEC-008](../../governance/decisions.md#dec-008) | Local Currency | Balance Aggregate 식별자 |
| [DEC-009](../../governance/decisions.md#dec-009) | Recurring | 매일 서버 처리와 firstApplicableMonth 이후 누락 월 자동 복구 |
| [DEC-010](../../governance/decisions.md#dec-010) | Ledger | 합치기 해제 시 원본별 표시 필드와 합친 거래의 공통 날짜·시각·카드 적용 |
| [DEC-013](../../governance/decisions.md#dec-013) | Ledger/Notifications | 필수 creatorMemberId·source와 채널별 자동·명시 알림 |
| [DEC-015](../../governance/decisions.md#dec-015) | Category Catalog | 과거 참조 보존, 설정 참조의 기본 카테고리 변경, 기본 카테고리 archive 금지 |
| [DEC-041](../../governance/decisions.md#dec-041) | Ledger | 구조 변경 원본을 취소 전까지 보존하고 결제 취소 시 같은 lineage 원본·파생 전체 삭제와 다른 lineage 복원을 원자 처리 |
| [DEC-044](../../governance/decisions.md#dec-044) | Local Currency | 잔액은 정수만 검증하고 음수 전용 거부·보정·경고 상태를 추가하지 않음 |
| [DEC-046](../../governance/decisions.md#dec-046) | 공통 UoW | 일반 terminal receipt·완료 Outbox/Inbox는 30일, 업무 claim·tombstone은 Aggregate 수명주기 적용 |
| [DEC-048](../../governance/decisions.md#dec-048) | Category/Budget·Local Currency | 예산은 요청 월 원천을 모두 읽어 계산하고 Balance는 최신 관찰을 직접 조회하며 영속 Home·Budget Projection을 두지 않음 |
| [DEC-056](../../governance/decisions.md#dec-056) | Ledger | 재병합의 merge ancestry를 non-merge leaf까지 평탄화하고 중간 merge node는 감사 이력으로 보존 |
| [DEC-057](../../governance/decisions.md#dec-057) | Ledger·Local Currency, Home 소비 | 선택된 한 지역화폐 유형만 상세 조회하고 내부 전환 UI·legacy 임의 귀속을 두지 않음 |
| [DEC-063](../../governance/decisions.md#dec-063) | Recurring·Ledger | Plan 최초 등록자를 immutable creator로 보존하고 Scheduler 거래에 사용하며 legacy는 명시 mapping 전 처리 차단 |

남은 제품·운영 정책은 [미결정 사항 단일 목록](../../governance/pending-decisions.md)에서 관리합니다. 조회 시 예산·홈·통계 계산은 DEC-048, 처리·운영 기록 보존은 DEC-046, 파생 거래 취소는 DEC-041, 지역화폐 음수 전용 정책 미도입은 DEC-044, 재병합 계보 평탄화는 DEC-056, 선택 지역화폐 상세 범위는 DEC-057, 정기 거래 creator는 DEC-063으로 확정되었으며, 나머지 결정 전에는 임의 0 보정·현재값 위장을 하지 않습니다.

## 9. 테스트 소유권

상세 테스트는 각 기능 문서가 소유한다.

- [Ledger 테스트](modules/ledger/requirements.md#8-모듈-테스트-시나리오)
- [Category/Budget 테스트](modules/categories-budget/requirements.md#8-모듈-테스트-시나리오)
- [Recurring 테스트](modules/recurring-transactions/requirements.md#8-모듈-테스트-시나리오)
- [Local Currency 테스트](modules/local-currency/requirements.md#8-모듈-테스트-시나리오)

Context 경계에서 추가로 묶어 검증한다.

- 같은 Payment fingerprint 동시 2회 → Ledger 거래 한 건
- 같은 plan/month 동시·재시도 → 거래와 checkpoint 한 번
- transaction callback 2회 실행 → 외부 side effect 없음
- Budget 월 범위 다중 page·중간 실패 → 전체 page 완료 때만 정확한 결과, 부분 합계 없음
- split·merge·cancel 부분 실패 → 원본 전체 유지
- 정상 split·merge 뒤 → 원본은 superseded로 보존, 취소 완료 뒤 → 대상 lineage 원본·파생 0건·다른 lineage 유지
- cancellation query의 같은 원장 사실 → Capture 정책 변경과 무관하게 동일 결과
- purge 두 번째 page 실패·재시도 → 첫 checkpoint 보존, 완료 page만 전진, 같은 page 중복 삭제 부작용 없음

## 10. 변경 경계 확인

- 월 분할 정책 변경은 Ledger Domain과 테스트만 바뀌어야 한다.
- Budget 화면 변경은 Transaction Canonical schema를 바꾸지 않아야 한다.
- 정기 거래 일정 변경은 일반 거래 CRUD를 수정하지 않아야 한다.
- 지역화폐 유형 추가는 Portfolio나 Ledger Aggregate를 수정하지 않아야 한다.
