# 2차 유지보수성 검토: 가계부와 지출 통계

기준 HEAD: `f1ed5a8`. 검토일: 2026-09-17. 대상은 Ledger, Category/Budget, Recurring, Local Currency, 지출 Reporting의 5개 모듈입니다. requirements/design의 소유 요구사항 46개를 아래 기능 묶음에 연결했습니다. 1차의 실행 경로 확인에서 더 나아가 **구체적인 기능 변경을 할 때 수정할 위치, 함께 영향을 받는 상태, 보존할 계약과 조회 비용**을 검토했습니다.

`검토 완료`는 표에 적은 변경 시나리오의 실제 경계를 읽고 판정했다는 의미입니다. 모든 운영 상태의 완전 검증이라는 뜻은 아닙니다. `부분`은 핵심 경계만 확인한 항목입니다. 새로 실행한 테스트와 기존 근거 테스트는 구분했습니다. LedgerPage 자체와 그 분리 hook, 권한·알림 전달은 다른 담당자가 검토하며 여기서 수정하지 않았습니다. commit/push/배포·운영 조회·새 데이터 migration은 수행하지 않았습니다.

## 확인한 문제와 적용 결과

### F2-1 · P2 · 원장 수정의 낙관적 갱신 절차가 두 공개 함수에 복제되어 있었습니다

기준 코드 `web/src/lib/expenseService.ts:467`의 일반 수정과 `:597`의 카테고리 수정은 가구 확인 → 현재 UI metadata 보관 → beginUpdate → 명령 → canonical 응답 변환 → commitUpdate/rollback을 각각 구현했습니다. 예를 들어 서버 응답에 없는 지역화폐·분할 provenance 보존 규칙이나 실패 복원 절차를 바꾸면 두 곳을 함께 고쳐야 했습니다.

[expenseService](../../web/src/lib/expenseService.ts)의 모듈 내부 `updateExpenseWithCommand`로 이 절차만 합쳤습니다. 일반 수정과 카테고리 변경의 공개 command는 그대로 유지하여 `rememberForNextTime`, wire payload, version 규칙을 바꾸지 않았습니다. 생성·삭제·구조 변경까지 억지로 같은 범용 실행기에 넣지 않았습니다.

낙관적 상태의 실제 소유자는 [LedgerOptimisticProjection](../../web/src/features/ledger/application/ledgerOptimisticProjection.ts)과 [OptimisticEntityProjection](../../web/src/platform/read-model/optimisticEntityProjection.ts)입니다. 동일 거래의 미확정 명령 차단, 여러 구독의 canonical 수렴, 실패 시 최신 서버 base 위에서 해당 mutation만 제거하는 동작을 유지했습니다. reset이 mutation ID→scope 연결도 지우므로 예전 성공·실패 응답은 새 세션의 projection에 적용되지 않습니다. 두 수정 경로의 늦은 성공/실패를 각각 실행하는 회귀 4개를 추가했습니다.

### F2-2 · P2 · 통계 읽기가 decoder를 사용하려고 원장 명령 서비스를 import했습니다

기준 `web/src/platform/reporting/expenseStatisticsReadModel.ts:3`은 `mapDocToExpense` 하나를 위해 `expenseService` 전체를 import했습니다. 그 서비스는 optimistic singleton과 세션 reset 등록, command client ID 생성, 검색·mutation 코드를 함께 불러옵니다. 읽기 형식 변경과 명령 실행 의존성이 이 import에서 불필요하게 연결됩니다.

[ledgerExpenseMapping](../../web/src/features/ledger/application/ledgerExpenseMapping.ts)에 문서 해석·카드 표시·명령 응답 변환을 옮겼습니다. 이 파일의 Firestore/명령/Expense 의존성은 타입 import이며, 실행 시 순수 category 정규화만 사용합니다. [통계 read adapter](../../web/src/platform/reporting/expenseStatisticsReadModel.ts)는 이제 이 mapper에 직접 의존합니다. `expenseService`의 기존 `mapDocToExpense`/`resolveExpenseCardDisplay` export는 호환용 재export로 유지했습니다. 복제한 decoder는 없습니다.

### F2-3 · P2 · 수동 등록 handler가 Domain의 receipt 우선 규칙보다 먼저 카테고리를 조회했습니다

기준 `functions/src/bootstrap/commands/ledgerHouseholdCommandHandlers.ts:240`은 Category catalog를 먼저 await한 뒤 `recordManualExpense`를 호출했습니다. Domain은 receipt 재생을 먼저 처리하지만 실제 handler의 선행 조회가 실패하면 이미 성공한 명령도 결과를 재생하지 못했습니다. 정상 재시도에서도 필요 없는 catalog read가 발생했습니다.

[Ledger handler](../../functions/src/bootstrap/commands/ledgerHouseholdCommandHandlers.ts)의 수동 등록에 기존 update와 같은 lazy Category reader를 주입했습니다. Domain에서 receipt가 없을 때만 카테고리를 검증합니다. 실제 handler를 호출하여 저장 receipt 결과가 재생되고 category read가 0건임을 확인했습니다. 신규 명령의 활성 카테고리 검증은 유지합니다.

### F2-4 · P2 · 정기지출 read adapter가 실패를 정상 빈 목록으로 해석했습니다

기준 `web/src/lib/recurringExpenseService.ts:97`의 error callback은 `callback([])`를 호출했습니다. 따라서 UI는 실패를 성공한 0건으로 해석하고 기존 목록을 지웠습니다. 읽기 상태 표현을 개선하려면 UI만 수정해서는 안 되고 adapter의 정보 손실까지 고쳐야 하는 경계였습니다. 같은 파일의 일회성 `getRecurringExpenses`는 사용처 없이 구독 decoder를 복제했습니다.

[recurringExpenseService](../../web/src/lib/recurringExpenseService.ts)는 오류를 별도 `onError`로 전달하고 정상 빈 snapshot만 `[]`로 전달합니다. [RecurringExpenseSettings](../../web/src/components/settings/RecurringExpenseSettings.tsx)는 마지막 정상 목록을 보존하며 실패와 다시 시도를 표시합니다. 종료된 구독의 늦은 callback은 무시합니다. 사용처 없는 일회성 조회 함수와 decoder 복제를 제거했습니다. 생성/수정/삭제 API와 scheduler 계약은 바꾸지 않았습니다.

### F2-5 · P2 · 지역화폐 조회의 실제 구현과 사용되지 않는 서버 구독 모델이 함께 남았습니다

기준 `functions/src/contexts/household-finance/local-currency/application/balanceSubscriptionApplication.ts`는 미리 받은 occurrence 배열에서 상태 목록을 구성하는 모델이었습니다. src/test 소비자는 없고 전용 Port와 public type export만 남았습니다. 유형 선택·조회 실패의 의미를 이 파일에서 고쳐도 실제 홈은 달라지지 않습니다.

이 Application과 전용 input/source Port 2개 및 public export를 제거했습니다. 실제 [balanceService](../../web/src/lib/balanceService.ts) → [LedgerReadModelContext](../../web/src/contexts/LedgerReadModelContext.tsx)를 구독 경로로 design에 명시했습니다. 서버 관측 intake·잔액 저장·독립 receipt·Home 최초 유형 선택의 transaction 참여는 그대로입니다.

## 기능별 변경 시나리오와 판정

### 1. Ledger

| 요구사항·검토 상태 | 적용한 변경 시나리오 | 실제 수정 소유와 후속 영향 | 보존 보장·비용·판정 |
|---|---|---|---|
| LED-002, LED-003, LED-004 · 완료 | 수동 거래 필드 또는 카드 표시 변경, 동일 생성 명령 재시도 | AddExpenseModal/expenseForm → expenseService.addExpense → ledgerCommands.record → Ledger handler → basicLedgerService → FirebaseLedgerCommandRepository → canonical/legacy·receipt·Outbox. Web 읽기는 ledgerExpenseMapping을 사용합니다. | 입력·업무검증은 서버, 낙관적 생성 ID와 표시 수렴은 Web입니다. 수입 고정 필드와 서울 시각은 서버에서 결정합니다. F2-3으로 receipt 재생에서 Category 조회를 제거했습니다. |
| LED-005 · 완료 | 메모·카테고리 수정, 날짜 이동, 삭제, 가맹점 규칙 기억 | 편집 UI → expenseService 공통 update 경계 → ledgerCommands의 허용 patch 변환·통계 통지 → basicLedgerService → Repository의 version 재검증·선택적 merchant participant. | UI metadata는 command 응답에 없으므로 mapper가 보존합니다. 삭제는 lifecycle/deletedAt이며 출처·lineage를 제거하지 않습니다. 기억 선택은 같은 서버 UoW participant이므로 Web 후속 별도 쓰기로 분리하지 않습니다. F2-1 적용. |
| LED-001, LED-006 · 부분 | 목록 정렬/월 이동/다른 구독에서 늦은 snapshot 수신 | 서비스의 월 source와 incremental decoder, LedgerOptimisticProjection, 공통 projection의 reconciliation을 확인했습니다. shell 월 보관·prefetch·연 구독은 root 담당입니다. | 한 subscription의 최신값만 보고 전체 pending을 해제하지 않습니다. 현재 월 query 하나와 연간 필요 구독을 구별합니다. generic store의 순회는 현재 가구 규모에서 복잡한 entity index보다 단순하며 비용 문제를 확정하지 않았습니다. |
| LED-007 · 부분 | 알림 요청 성공 뒤 통계 재조회 여부 | ledgerCommands.requestNotification → basicLedgerService.requestNotification → version/요청자/expense 검증·Outbox. 실제 수신자·전송은 Notifications 담당입니다. | 통계 mutation 통지에서 알림 요청을 제외합니다. 원장 값이 바뀌지 않는 요청에 전체 통계를 다시 읽지 않는 경계가 적절합니다. |
| LED-008, LED-009, SPL-001, SPL-002, SPL-003, SPL-004, SPL-005, SPL-006, MRG-001, MRG-002 · 부분 | 월 분할 취소·재구성, merge 뒤 일반 수정 경합 | expenseService의 구조 변경 명령 → itemSplitRestoration/monthlySplitLifecycle/transformationLineage Service → 전용 Firebase Store. Web은 expectedVersions와 결정 ID를 넘기며 server transaction이 최종 권위를 가집니다. | 파생 ID만 응답하는 split은 UI가 원본을 먼저 지워 빈 목록을 만들지 않고 snapshot 교체를 기다립니다. merge는 두 원본을 새 aggregate로 교체합니다. 실제 repository 읽기효율 회귀를 실행했지만 모든 modal 입력·lineage 조합의 E2E를 2차에서 다시 실행하지 않았으므로 부분입니다. |
| LED-010 · 부분 | 지역화폐 유형 추가, typed/untyped 원장 merge | metadata 저장/mapper, localCurrencyTypeCompatibility 정책, BalanceCards→LocalCurrencyModal의 선택 유형 필터를 확인했습니다. | 신규 유형의 Android parsing과 Capture 변환은 별도 소유입니다. immutable metadata를 일반 patch에 추가하지 않아야 합니다. 전체 유형 추가는 계약 확장이므로 이번에는 변경하지 않았습니다. |
| SEA-001, SEA-002, SEA-003, SEA-004, SEA-005 · 부분 | 카드사+마스킹 번호 검색 규칙 변경 또는 결과 mutation | expenseService의 exact-card/search matching·bounded source·window/cursor, Ledger 명령으로 수정되는 경계를 확인했습니다. | 검색 정책과 source decoder는 같은 것이 아닙니다. mapper 분리 후 검색은 서비스에 유지했습니다. 10,000건 source 상한·revision 전체 UI와 모든 검색 조합은 이번 집중 테스트에 포함하지 않았습니다. 새 검색엔진 도입 근거는 없습니다. |

**basicLedgerService의 해피패스 판단:** `existingOrLoad`와 `update`의 비동기 실패 포장은 단순한 예외 남용으로 판정하지 않았습니다. receipt·거래·Category를 병렬로 읽으면서 저장 receipt가 즉시 이기고, 늦은 rejection을 소비하며, 신규 명령은 Category read 실패 → 거래 read 실패/부재 → version conflict → 업무검증 순서를 지켜야 합니다. `basic-ledger-read-concurrency`가 이 우선순위와 100ms 병렬, 메모 수정의 Category 0회 조회를 직접 검증합니다. 순차화는 신규 수정 지연을 늘리고 `Promise.all` 치환은 receipt 재생을 다른 조회 실패에 종속시킵니다. 이 복잡도는 보존하고 F2-3의 bootstrap 선행조회만 제거했습니다.

### 2. Category/Budget

| 요구사항·검토 상태 | 변경 시나리오 | 실제 수정 소유와 후속 영향 | 보존 보장·비용·판정 |
|---|---|---|---|
| CAT-001 · 완료 | 신규 가구 기본 카테고리 변경 | onboarding이 Category Application의 별도 initialize UoW를 호출하며 CategoryCatalogStore가 canonical과 가구별 legacy projection을 함께 씁니다. | 일부 catalog에 기본값을 자동 보충하지 않습니다. UI의 빈 목록을 초기화 트리거로 삼지 않는 경계가 적절합니다. |
| CAT-002, CAT-003 · 완료 | 이름/색/예산/기본값 수정, 카테고리 archive | CategorySettings → CategoryContext/service/commands → category handler → CategoryCatalogApplication → Store; archive는 archive-pending 저장 후 Recurring/merchant 소유 remapper를 호출하고 완료 상태를 저장합니다. | 과거 Ledger를 remap하지 않고 표시용 category를 남깁니다. expected category/catalog version과 UI의 실패 draft 보존이 분리되어 있습니다. Category는 소비 모듈의 원장 repository를 직접 수정하지 않습니다. |
| CAT-002, REC-005 교차 · 완료 | archive 도중 remap 실패·재시도 | Category completeArchive → firebaseRecurringCategoryRemapper → Recurring remap Application의 page receipt. merchant도 같은 소비자 경계를 사용합니다. | adapter가 매 page canonical+legacy plan을 읽는 것은 대규모에서 개선 여지가 있지만 현재 3인 가구에서 page100/멱등 경계를 버리거나 서버 검색 인프라를 늘릴 이유는 없습니다. partial 이관 catalog 때문에 canonical만 읽는 최적화도 하지 않았습니다. |
| BUD-001, BUD-002 · 완료 | 0원/null 예산, archive 후 잔여 예산 변화 | Category catalog listener가 표시 상태를 갱신하고 `features/category-budget/monthlyBudget.ts`가 활성 key 기준 합계·진행률을 계산합니다. BalanceCards/CategorySummary는 결과를 표시합니다. | null만 미설정, 0원도 해당 지출 차감, 진행률은 양수 예산만이라는 현재 정책을 보존합니다. 예산 변경은 지출 원천을 바꾸지 않으므로 Reporting 거래를 다시 읽을 필요가 없습니다. 별도 서버 예산 projection도 불필요합니다. |
| CAT-004 · 부분 | Android QuickEdit fallback 제거 | 서버 listActive의 NoData/Failure 구분과 CategoryReferenceReader는 확인했습니다. Android Adapter 전환·화면 동작은 이번 담당 범위 밖입니다. | Android fallback을 Web이나 서버 정상 catalog 생성으로 확장하지 않습니다. |

Category의 canonical 우선 active 판정과 Capture projection 중복은 Capture 담당에게 확인해 공유했습니다. 그 담당자가 공통 snapshot merge 정책으로 처리하며 이 보고서의 코드 수정과 분리합니다. 운영에서 canonical 이관 완료를 증명하는 marker가 없다는 1차 비용 판단은 유지합니다.

### 3. Recurring

| 요구사항·검토 상태 | 변경 시나리오 | 실제 수정 소유와 후속 영향 | 보존 보장·비용·판정 |
|---|---|---|---|
| REC-001 · 완료 | 일정 수정 또는 설정 listener 실패 | RecurringExpenseSettings → recurringExpenseService/recurringCommands → handler → RecurringPlanManagementApplication/Store; 최종 UI는 legacy read projection snapshot으로 갱신합니다. | form input과 서버 normalizeUpdatedFields의 책임을 구별합니다. 서버 receipt·expectedVersion·creator 보호가 최종 권위입니다. F2-4로 read 실패 의미를 UI까지 보존하고 dormant 중복 조회를 제거했습니다. |
| REC-002, REC-003 · 완료 | 31일의 짧은 달 실행, 여러 달 누락과 중간 실패 | Scheduler Workflow가 recurringSchedule로 due months를 계산하고 plan/month execution마다 Finance UoW를 호출합니다. 1차 Ledger posting 정책과 저장 mapper를 재사용합니다. | planId:month 결정 key, old→new 순서, processedThroughMonth/checkpoint로 재시도 범위를 보존합니다. execution/receipt/거래/Outbox는 같은 transaction입니다. 각 화면에서 등록을 재시도하는 부작용을 만들지 않습니다. |
| REC-005, REC-006 · 완료 | category archive와 creator 없는 과거 plan | Category는 Recurring remap command만 조정하며 active/inactive 정의를 처리합니다. 최초 creator는 관리 Application에서 인증 actor로 고정하고 scheduler는 그대로 사용합니다. | 과거 생성 원장은 바꾸지 않습니다. creator 없는 과거 plan을 현재 멤버로 추정하지 않습니다. 금액 정책 변경은 plan normalization과 scheduler 방어 검증을 함께 검토해야 합니다. 각 검증은 입력/오래된 데이터라는 다른 경계를 보호합니다. |
| REC-004 · 부분 | 자동 생성과 수동 알림 구분 | Ledger posting의 source/origin=recurring과 기존 소비 계약을 확인했습니다. 최종 push recipient/dispatch는 Notifications 담당입니다. | 별도의 Web 자동 통지나 이중 event 발행을 추가하지 않았습니다. |

### 4. Local Currency

| 요구사항·검토 상태 | 변경 시나리오 | 실제 수정 소유와 후속 영향 | 보존 보장·비용·판정 |
|---|---|---|---|
| BAL-001, BAL-003 · 완료 | 지원 유형/관측 payload·음수 잔액 규칙 변경 | balanceObservationIntakeApplication이 actor/envelope를 검증하고 latestBalanceObservation이 정수와 순서를 검증합니다. Android raw parsing은 다른 소유입니다. | 음수도 정수 관측값으로 저장하고 0원 보정하지 않습니다. DTO validation과 observation ordering은 다른 책임이어서 하나의 무거운 validator로 합치지 않았습니다. |
| BAL-002, BAL-005 · 완료 | 순서가 뒤바뀐 잔액 알림, 동일 branch 재시도 | LocalCurrencyBalanceApplication → FirebaseLocalCurrencyBalanceStore가 household/type canonical·legacy, receipt, Event를 원자 저장합니다. | stale/replay는 version/Event를 증가시키지 않습니다. Home 최초 선택 데이터는 실제 balance write가 있을 때만 읽고 같은 transaction에서 준비합니다. Ledger transaction 생성과 독립된 branch 보호를 유지합니다. |
| BAL-004 · 완료 | 선택 유형 변경, 원천 실패, 한 유형만 있는 legacy 가구 | Web balanceService의 balances/preference 두 listener → LedgerReadModelContext의 scope/error 상태 → BalanceCards. 선택 UI는 HomePreference command를 사용합니다. | 명시 선택이 한 유형 자동 표시보다 우선합니다. 한 유형일 때 preference 조회 생략은 저장된 다른 선택의 의미를 바꿀 수 있어 하지 않았습니다. 실패와 null/no-data를 구분하고 최초 cache snapshot을 표시하지 않습니다. F2-5로 미사용 서버 구독 모델을 정리했습니다. |

새 유형 추가는 Android·Capture·서버 DTO·선택 UI에 걸친 명시적 계약 확장입니다. 이번 범위에서 새 유형이나 저장 migration을 추가하지 않았습니다. 3인 가구에서 작은 balances map과 두 listener를 범용 구독 조정기로 바꿀 근거도 없습니다.

### 5. 지출 Reporting

| 요구사항·검토 상태 | 변경 시나리오 | 실제 수정 소유와 후속 영향 | 보존 보장·비용·판정 |
|---|---|---|---|
| STAT-001, STAT-002, STAT-003 · 완료 | 3/6/12개월·사용자 기간 변경, category 기본 토글 변경 | stats page → Web statisticsPeriod → expenseStatisticsCache → expenseStatisticsReadModel → Ledger 순수 mapper; 차트는 읽은 목록을 계산합니다. | 완료된 큰 범위는 작은 범위에 재사용하고 pending 큰 범위에도 합류합니다. 기간 계산·read cache·차트 선택은 독립입니다. 서버 Reporting prototype으로 연결하지 않았습니다. |
| STAT-004 · 완료 | 일반 편집/카테고리 수정 후 통계 갱신 | 모든 성공 Ledger command가 한 `executeLedgerCommand` 경계에서 통계 revision을 알립니다. notifier는 시작 actor와 현재 actor를 비교하고, page 자체는 중복 invalidate하지 않습니다. | memo/category만 변경하면 cache가 exact predecessor version·동일금액/날짜/가맹점·expense를 검증한 뒤 확정 응답으로 갱신합니다. 다른 mutation 또는 증명 실패는 전체 invalidation입니다. 이 정책은 Reporting cache가 소유하며 UI optimistic 성공만으로 통계를 확정하지 않습니다. |
| STAT-005, STAT-006 · 완료(현재 Web 계약) | 다른 actor로 전환, 늦은 page, 중간 page 실패, resume | cache identity는 actor/sessionGeneration/accessMode+remoteReadEpoch+revision이며 obsolete/generation이 늦은 응답을 막습니다. read adapter는 date+documentId cursor로 전 page를 완성한 뒤만 반환합니다. | source page5,000·총50,000 안전 한도, cache 완료범위 최대4개/60초입니다. 예상 규모에 맞는 세션 메모리이며 서버 projection 도입 근거는 없습니다. 실패를 빈 성공으로 cache하지 않습니다. F2-2로 순수 decode 의존성을 확보했습니다. |

통계 cache의 메모/카테고리 부분 갱신은 모든 retained range가 exact predecessor를 포함해야 허용됩니다. 범위가 분리되어 있거나 version을 증명할 수 없으면 재조회하는 보수적 동작을 유지했습니다. 소규모에서 적은 조회를 위해 임의의 cache patch를 허용할 이유가 없습니다. 명시적 server checkpoint snapshot을 통한 다중 page 일관성은 현재 Web read가 제공하지 않는 목표 계약이며 새로 충족했다고 주장하지 않습니다.

## 검증과 남은 범위

이번에 실행한 focused 검증은 다음과 같습니다.

| 검증 | 결과 |
|---|---|
| Web: ledgerExpenseServiceOptimistic, ledgerOptimisticProjection, ledgerCommands, ledgerReadCardDisplay, ledgerIncrementalSnapshot, reportingReadAdapters, expenseStatisticsCache, statisticsPage | 최초 8 suite 78개 통과. 이후 wrapper late reset 회귀 4개를 추가하고 해당 suite를 다시 실행해 통과했습니다. |
| Web: recurringReadFailure | 실제 read adapter와 설정 화면 연결 3개 통과. 최초 실패·마지막 정상 목록 보존·재시도·종료 callback·정상 빈 결과를 구분합니다. |
| Functions: ledger-household-command-category-read, basic-ledger-read-concurrency, basic-ledger-commands, ledger-mutation-read-efficiency | 4개 파일 62개 통과. 실제 handler의 저장 receipt replay→catalog0건을 포함합니다. |
| 담당 변경 `git diff --check` | 통과. 전체 타입검증/아키텍처/clean build는 root의 중앙 검증으로 관리합니다. |

Web의 최종 고유 focused 테스트는 9 suite 85개입니다. Functions Vitest는 sandbox child-process EPERM 이후 동일한 로컬 명령을 허용된 환경에서 실행했습니다. 실제 운영 조회는 하지 않았습니다.

추가 정적 근거로 `category-catalog`, `category-active-query-regression`, `category-reference-reader`, `category-capture-projection-invalidation`, `recurring-plan-management`, `recurring-schedule`, `recurring-scheduler-workflow`, `recurring-processing-atomicity`, `recurring-category-remap`, `recurring-creator-runtime-regression`, `balance-observation`, `balance-branch-integration`, `local-currency-balance-read-efficiency`의 보호 대상과 실제 adapter 연결을 확인했습니다. 이 2차 작업에서 모두 다시 실행했다는 뜻은 아닙니다.

다음은 **미검증 또는 별도 후속**입니다.

1. Android QuickEdit 전환, raw notification parser, 실제 디바이스/네트워크 재연결, 운영 migration 상태는 검증하지 않았습니다.
2. Ledger의 모든 split/merge/검색 UI 조합과 장기간 다중 page 동시 수정은 이번 focused suite로 완전 검증되지 않습니다. 이번 보고서는 해당 행을 부분으로 명시했습니다.
3. 정기지출 설정의 쓰기 실패 UX와 모든 중복 클릭 제어는 이번 read 실패 개선과 별도입니다. 서버 version/receipt 보호는 유지하며, 동일 UI 변경을 확대할 때 form draft/쓰기 중 상태를 함께 검토해야 합니다.
4. Reporting 서버의 테스트 전용 Query/Controller 전체를 실제 Web 계약으로 이관하는 1차 잔여 작업은 여전히 별도입니다. source checkpoint·빈 데이터·과거 차원 계약을 정렬하지 않고 한 번에 삭제하지 않았습니다.
5. 서버 Category read 비용을 canonical-only로 줄이려면 이관 완료 계약 또는 필요한 key만 조회하는 별도 API 근거가 필요합니다. 근거 없이 partial legacy 지원을 생략하지 않았습니다.

## 독립 교차검토 보완

Portfolio 담당의 독립 diff/실제 호출 검토에서 정기지출의 마지막 성공 목록이 다른 가구에도 남는 회귀를 확인하여 수정했습니다. 가구 A 성공 뒤 B로 전환하고 B 조회가 실패하면 A 목록과 편집 대상이 다시 표시될 수 있었습니다. `RecurringExpenseSettings`는 householdKey가 바뀔 때 목록·편집 폼·삭제 확인 대상을 폐기하고, 같은 가구의 remoteReadEpoch 복구와 사용자 재시도에서는 마지막 정상 목록을 보존합니다. 이전 구독 callback의 active guard도 유지합니다. `recurringReadFailure.contract.test.tsx`에 실제 UI의 A 성공→B 실패와 같은 가구 epoch/재시도 실패를 추가하여 5건 전부 통과했습니다. 위 최초 3건 결과 이후의 보완 검증입니다.
