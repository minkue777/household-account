# Household Finance 계약별 정비

기준 SHA: `676731d9abda95439afc2dfd827690029d89e048`. 공개 계약 목록은 Ledger 15개, Categories/Budget 8개, Recurring 8개, Local Currency 4개로 고정했습니다. 각 모듈 설계의 공개 Input Port 표를 기준으로 실제 handler→application→저장소와 Web 서비스 소비자를 대조했습니다. ExpenseEditModal의 화면 생명주기는 root 담당이며 이 보고서의 실행 코드 집계에서 제외합니다.

## 구현한 단순화와 코드량

집계 범위는 네 `functions/src/contexts/household-finance/` 모듈, 대응 `adapters/firebase/{ledger,recurring,categories,local-currency}` 전체, Ledger/Recurring/Category command handler입니다. 기준 SHA에 존재하는 75개 실행 파일 전체를 동일하게 집계하며 삭제 파일의 현재 값은 0입니다. 새 실행 파일·helper·코드 이동은 없습니다. 줄 수는 마지막 개행/말미 빈 줄을 제외한 물리 줄 수이며 테스트·문서·다른 담당자의 실행 코드와 Web 서비스는 포함하지 않습니다. 파일별 원장은 [finance-code-scope.json](finance-code-scope.json)입니다.

| 계약 소유 범위 | 파일 수 | 이전 | 현재 | 감소 |
|---|---:|---:|---:|---:|
| Ledger | 29 | 4,899 | 4,484 | 415 |
| Recurring | 24 | 2,663 | 2,253 | 410 |
| Categories/Budget 서버 | 12 | 1,492 | 1,422 | 70 |
| Local Currency 서버 | 10 | 853 | 853 | 0 |
| 합계 | 75 | 9,907 | 9,012 | **895 (9.0%)** |

1. **Ledger 조회의 미사용 구현 제거.** `ledgerPeriodQuery`, `ledgerReadSelection`, `ledgerReadSource`, `ledgerReadFact`와 `basicLedgerService.summary`/repository 전체 목록 메서드는 실제 handler·Web·테스트 호출자가 없었습니다. 현재 월/기간 조회는 Web `expenseService`→공개 Firestore read model, 표시와 합계는 `ledgerReadVisibility`와 Reporting 소비자에 있습니다. 미구현 목표 계약은 삭제하지 않고 실행 경로만 명확히 했습니다.
2. **Ledger 구조 변경의 시험용 중복 제거.** `transformationLineageService.splitItems/update`는 계약 fixture에서만 호출되며 실제 명령은 `itemSplitRestorationService`/`basicLedgerService`가 처리합니다. 분할의 증거 보존·원자 실패는 실제 QuickEdit handler 검사가 계속 담당하고, Update/Split 경합은 실제 SDK 검사로 옮겼습니다. Merge/Unmerge와 **CAN-007 지정 계보 복구 `cancelCapturedLineage`는 유지**합니다. 후자는 실제 SDK 운영 복구 회귀의 호출자이며 일반 capture 취소와 입력 권한·선택 방식이 다릅니다.
3. **Recurring 작성자 관리의 미사용 섬 제거.** 호출자 없는 `recurringCreatorApplication`과 두 port/receipt state를 제거했습니다. 작성자 불변성은 실제 관리 application·handler·월 처리 UoW, 승인된 legacy 작성자 지정은 실제 migration collector/persistence가 소유합니다. 작성자 없는 계획에 임의 작성자를 넣는 fallback은 만들지 않았습니다.
4. **Category 표시용 서버 모형 제거.** 실제 호출자 없는 `listActive`, `legacyQuickEditCategories`, `defaultForManualEntry`와 이에만 쓰이던 read port/adapter 메서드를 제거했습니다. Web의 실제 `categoryService`→`CategoryProvider` 검사로 active 정렬·기본값·빈 값/조회 실패 구분을 검증하고, Android 실제 `CategoryRepositoryInstrumentationTest`의 표시 전용 fallback 검사는 유지합니다. 카탈로그 command와 catalogVersion receipt 계약은 그대로입니다.

이는 호출되지 않는 계산·상태와 중복 실행 경로 제거입니다. 운영 read/write 수 또는 기기 체감 성능 개선을 주장하지 않습니다. 별도 범용 mapper/트랜잭션 엔진으로 책임을 합치지 않았습니다.

## Ledger — 15개 공개 계약

소유 파일: `ledger/application/commands/{basicLedgerService,itemSplitRestorationService,monthlySplitLifecycleService,transformationLineageService}.ts`, 대응 Firebase 저장소, `ledgerHouseholdCommandHandlers.ts`, 태그·분할·계보 정책. Web 소비자는 `expenseService.ts`, `ledgerCommands.ts`, `ledgerExpenseMapping.ts`, `ledgerOptimisticProjection.ts`, `ledgerReadVisibility.ts`입니다.

| 공개 계약 / 요구사항 | 현재 경계와 보존 불변식 | 정비 결정·검증 |
|---|---|---|
| RecordManualTransaction / LED-002·003·004·011 | handler 허용 DTO→basic service→원장+receipt+outbox 한 transaction. creator·시각은 서버, 양의 정수/카테고리·태그 검증 | 유지. 수입/지출의 의미가 다른 정규화를 합치지 않음. T-LED-005~008·011 및 실제 금융 명령 |
| RecordCapturedTransaction / LED-009·010 | 검증 Capture→FirebaseCaptureLedgerPersistence→claim·원장·receipt·outbox | Capture 담당과 경계 공유. 동일 금액만으로 중복/취소 추정 금지, 승인 증거·취소 tombstone 유지. 실제 persistence/safety 검사 |
| RecordRecurringTransactionParticipant / REC-002·006 | `recurringPosting` 변경 의도→RecurringFinanceUnitOfWork에서 원장·execution·receipt·event 원자 저장 | 유지. participant 단독 commit 없음. 실제 recurring SDK 검사 |
| Update / LED-005·011 | basic service→단건 원장 재조회→version 비교→허용 patch만 commit | transformation의 중복 Update 제거. 메모/태그 생략과 명시 제거, provenance 불변, 실패 write 0 유지. T-LED-002·008·011 |
| Delete / LED-005 | active 거래를 deleted/deletedAt/version으로 전이 | 유지. 물리 삭제·임의 복구로 축약하지 않음. 실제 delete/receipt/outbox 검사 |
| Split / SPL-001~006·LED-012 | item: itemSplitRestorationService, 월: monthlySplitLifecycleService→각 실제 저장소 | 중복 splitItems만 제거. 원본 superseded·같은 ID 복원, 전체 증거·태그, 월말·버림 나눗셈, 그룹 완전성·version map 보존. 실제 QuickEdit/태그/월 그룹/T-LED-002 |
| Merge / MRG-001·LED-012 | transformation service→선택 ID/leaf graph 조회→새 ID·원본 snapshot·receipt·outbox | 유지. 중첩 leaf/cycle/겹침 검증과 실제 반환 ID는 필요한 복잡성. 실제 merge·취소·bounded read 검사 |
| Unmerge / MRG-002 | transformation service→원본별 필드 복구와 merge 공통 표시 적용→한 UoW | 유지. 불완전 legacy snapshot은 무변경 실패. 실제 unmerge 검사 |
| CancelCapturedLineage / LED-009·CAN-007 | 지정 lineage 복구→그래프 판정→대상 전체 삭제·비대상 leaf 복원·claim cancelled | 유지. 실제 CAN-007 SDK 호출자가 있으며 같은 금액의 과거 거래·최신 잔액을 보존하는 별도 복구 계약. 일반 알림 취소 경로와 합치지 않음 |
| RequestHouseholdNotification / LED-007 | basic service→version·expense 판정→요청 metadata·receipt·event | 유지. 전달 성공과 원장 저장 성공을 혼합하지 않음. T-LED-010/Notifications 소비자 |
| FindCancellationCandidates / CAN-003 | 실제 capture persistence의 기간·금액·저장 증거 bounded 조회→후보 판정 | 유지/실제 경로 명시. 목표 Query 이름을 위해 별도 전체 목록 repository를 남기지 않음. capture cancellation safety/실제 SDK |
| SearchLedger / SEA-001~006 | Web expenseService의 검색창별 source promise·paged server query→matcher→전체 일치 목록/합계 | 유지. 닫힘/가구·세션 변경 token, 검색창 내 원본 공유, 태그 부분 검색, 카드 별칭·마스킹은 행동 계약. 미사용 server query만 제거 |
| SubscribeLedger(구현 SubscribeMonthlyLedgerSource) / LED-001 | 월 원본 하나→incremental snapshot mapper→낙관적 projection→수입/지출 소비자 | 유지. Lite 최초 서버 읽기와 listener cache cursor는 달라 별도 최초 event 처리가 필요. 실패 뒤 cursor 재구축·세션 격리 유지 |
| GetLedgerSummary / LED-006 | 실제 Web 월/연 원본·Reporting 계산에서 목록과 합계 파생 | 미사용 basic summary/query/types 제거. 실패를 빈 목록·0원으로 바꾸지 않음. 기존 Web summary/read visibility 검사 유지 |
| ListLocalCurrencyTransactions / LED-010 | 실제 Web 지역화폐 상세는 canonical 원장에서 선택 type으로 필터 | 미사용 기간 query 제거. immutable type, legacy 일반 원장 보존, 모호한 merge 거절 유지 |

운영자 전용 RestoreDeletedTransaction/PurgeDeletedTransaction은 일반 사용자용 공개 API가 아닌 목표 운영 계약입니다. 이번에 새 transport 또는 우회 복구 API를 만들지 않았습니다.

## Categories/Budget — 8개 공개 계약

소유 파일: `categoryCatalogApplication`, `categoryCatalogPolicy`, `categoryCatalogDocument`, `firebaseCategoryCatalogStore`, `categoryHouseholdCommandHandlers`, `firebaseCategoryReferenceReader`. 실제 읽기·예산은 Web `categoryService`, `CategoryProvider`, `monthlyBudget`, Android `CategoryRepository`가 담당합니다.

| 공개 계약 / 요구사항 | 현재 경계와 보존 불변식 | 정비 결정·검증 |
|---|---|---|
| InitializeDefaultCategories / CAT-001 | handler/onboarding→비어 있는 catalog만 다섯 stable ID·default 초기화→receipt/outbox | 유지. 일부 항목이 있다고 자동 보충하지 않음. T-CAT-001·002 |
| UpdateCategoryCatalog / CAT-002·003 | create/update/reorder/archive→policy→단일 catalog transaction | 유지. 기존 정비에서 확정 catalogVersion을 반환했으므로 추가 상태 추정 제거 불필요. category/version·전체 순서 집합·문서 상한·alias 불변 유지 |
| ContinueCategoryArchiveProcess / CAT-003 | archive-pending→Recurring/merchant page remap→완료 catalog | 유지. page 재전송·진행 checkpoint는 원자성을 여러 모듈 전체 transaction으로 가장하지 않기 위한 경계. 과거 거래는 불변. T-CAT-004 |
| SetDefaultCategory / CAT-003 | active category·catalogVersion 검증→catalog/receipt/outbox | 유지. 서버 내 별도 표시용 defaultForManualEntry는 삭제하고 실제 저장값/Provider 기본값 관측. T-CAT-004·Web Provider |
| GetCategoryReference / CAT-002·003 | 실제 readUsableCategoryIds→권위 catalog와 historical alias | 유지. 같은 업무 ID와 옛 문서 ID의 호환 검증을 제거하지 않음. actual handler/recurring transaction 검사 |
| ListActiveCategories / CAT-004 | Web canonical document mapper/Provider; Android canonical SDK mapper | 미사용 Functions 조회·legacy 표시 모형 제거. T-CAT-005·006는 실제 Web mapper/Provider 및 기존 Native SDK 관측으로 보존 |
| GetMonthlyBudget / BUD-002 | Web monthlyBudget에 active category와 월 expense 원본 전달 | 유지. 0원도 설정된 예산, null만 미설정. 이미 단일 합산이며 새 read/cache 계층 불필요 |
| GetBudgetStatus / BUD-001 | 같은 monthlyBudget의 진행률·초과액 파생 | 유지. 진행률은 양수 예산에만 의미가 있어 잔여예산 규칙과 억지로 합치지 않음 |

## Recurring — 8개 공개 계약

소유 파일: `recurringPlanManagementApplication`, `recurringSchedulerWorkflowApplication`, `recurringCategoryRemapApplication`, schedule/processing 정책, 대응 Firebase stores, `recurringHouseholdCommandHandlers`. 작성자 migration의 실제 소비자는 `financeRuntimeMigrationCollector`와 migration persistence입니다.

| 공개 계약 / 요구사항 | 현재 경계와 보존 불변식 | 정비 결정·검증 |
|---|---|---|
| ManageRecurringPlan / REC-001·006 | handler 검증→management→대상 plan/receipt/catalog 한 transaction | 미사용 creator 별도 application 제거. 앞선 단건 whole-state 저장 정비를 유지. creator 불변·expectedVersion·category active·receipt replay/payload 충돌·canonical/legacy 동시 저장 보존 |
| ListRecurringPlans / REC-001 | 설정은 Web recurringExpenseService, Scheduler는 bounded readPlanPage | 유지. Web이 실제 legacy 호환 컬렉션을 읽으므로 dual-write 삭제 금지. 목록 조회에 receipt를 다시 추가하지 않음 |
| CalculateEffectiveDay / REC-002 | requested day/월 검증→월말 최소값 순수 계산 | 유지. 윤년/월말·생성일 이후 최초 월 의미가 달라 일반 Date helper로 압축하지 않음. T-REC-001·002·004 |
| ProcessRecurringMonth / REC-002·006 | 권한·계획 판정→plan/month execution key→FinanceUnitOfWork | 유지. 원장·execution·receipt·outbox·checkpoint 원자 저장, missing creator 임의 대체 금지. 실제 SDK 원자성/재전송 검사 |
| ProcessDueRecurringPlans / REC-002·003·004 | 필수 plan page→미처리 월 오래된 순→월별 독립 commit→Operations checkpoint | 유지. 앞선 whole-read fallback/noop publisher 제거 완료 상태. 과거 성공 월 보존·실패 월 재개·자동 알림 억제 보존 |
| MapLegacyRecurringCreator / REC-006 | 승인 migration manifest→collector member/기존 creator 판정→plan·migration receipt | 미사용 대체 application/ports 삭제. 현재 경로는 실제 migration 도구이며 독립 목표 endpoint를 구현한 것으로 주장하지 않음. T-REC-007 actual migration/creator runtime 검사 |
| RemapRecurringCategoryReferences / REC-005 | archive process→category remap policy→bounded plan page/receipt 저장 | 유지. active/inactive 계획 모두 수렴, Ledger 과거 데이터 무변경, 같은 cursor 다른 payload 충돌 보존. T-CAT-004 |
| PurgeRecurringDataParticipant | householdPurgeRuntime의 finance participant→scoped purge page와 남은 household collection 정리 | 유지. 독립 recurring purge application을 새로 만들지 않음. 실제 공통 purge 경계는 platform 담당 검증 |

## Local Currency — 4개 공개 계약

소유 파일: `balanceObservationIntakeApplication`, `localCurrencyBalanceApplication`, envelope/latest-observation 정책, `firebaseLocalCurrencyBalanceStore`, Web `balanceService`. **실행 코드 변경 없음.**

| 공개 계약 / 요구사항 | 현재 경계와 보존 불변식 | 유지 이유·검증 |
|---|---|---|
| RecordBalanceObservation / BAL-001·002·003·005 | actor/schema/parser fact 검증→observation 순서 판정→잔액/receipt/조건부 event 한 UoW | envelope와 내부 balance 검증은 신뢰 경계가 다름. 같은 시각 ID 결정 순서·음수/0·stale receipt·독립 capture branch 보존. T-BAL-001~003·005·007·008 |
| GetBalance / BAL-003·004 | type selector→canonical 또는 명시적 legacy-unknown reader→NoData/실패 구분 | canonical+legacy 쓰기는 이 reader와 실제 이전 소비자 때문에 유지. 마이그레이션·외부 호환 종료 없이 삭제할 수 없음 |
| SubscribeBalance / BAL-004 | Web 잔액+홈 선택 원본→둘 다 준비된 뒤 선택된 유형 하나 표시 | 선택 type 우선·유형 하나의 무모호 fallback·가구 epoch·오류 보존 필요. prepared first selection은 같은 서버 transaction에서 처리하며 플랫폼 담당 변경과 연결 |
| PurgeLocalCurrencyDataParticipant | 실제 household purge의 finance page 및 잔여 household collection 정리 | 공통 권한·checkpoint·문서 소유권을 재사용. 별도 미사용 participant 클래스 생성 불필요 |

## 검증과 한계

- 최종 Functions `test:types`, 원장/정기/지역화폐/카테고리·실제 Firebase adapter 단위·architecture **33파일 285개**와 `git diff --check` 통과했습니다. 삭제된 카테고리 표시 모형의 네 사례는 실제 Web/기존 Native 소비자 검증으로 대체했습니다.
- Web 실제 카테고리 mapper/Provider/명령 계약 1파일 4개 통과. Android 실행 코드·기존 Native 카테고리 검사는 변경하지 않았습니다.
- root가 실제 Firestore SDK 통합 **4파일 33개**를 실행하여 통과했습니다. 새 T-LED-002는 Update/Split 두 승자 순서 모두 실제 조회 뒤 패자만 보류하고, 저장 충돌 `LEDGER_CONCURRENT_WRITE`, canonical version/상태, 패자 receipt·outbox 0건을 확인합니다. gate 진입 전 명령 종료도 즉시 실패로 드러냅니다.
- 기존 QuickEdit 실제 handler 분할의 권위 증거·태그·replay·stale/deleted/superseded/commit-abort 무부분쓰기 검사는 유지했습니다. 대체 구현을 없애기 위해 이 동작 검사를 약화하지 않았습니다.
- 문서·코드의 목표 계약과 현재 구현은 구분합니다. 전체 CI·브라우저 E2E·배포 상태는 root의 통합 결과를 따릅니다. 운영 데이터 변경, 직접 배포, commit/push는 수행하지 않았습니다.
