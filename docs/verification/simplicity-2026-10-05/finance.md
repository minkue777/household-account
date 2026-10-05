# 금융·포트폴리오·통계 simplicity 조사

기준 HEAD: 12a582bf63bae7ad5b7c66bcfbf67ac96fb338da. 정적 읽기 전용 조사이며 제품 코드 수정·테스트 실행·운영 자료 변경·commit은 하지 않았습니다. 요구사항은 행동 계약의 근거로만 사용했으며 현재 폴더·계층 구조를 유지하는 것을 목표로 삼지 않았습니다.

## 조사 범위

Functions의 원장·카테고리·지역화폐·정기 계획·자산·보유종목·자동화·분배금·통계와 연결된 adapter, command, query, scheduler를 검토했다. 초기 부분 검토 파일은 [서버 경계](server-boundaries.md)와 [플랫폼](platform.md) 조사에서, 관련 테스트는 [재무 테스트](finance-tests.md)와 [실제 검증 경계](test-boundaries.md)에서 본문 검토를 완료했다. 중복을 제거한 최종 파일 범위는 [files.csv](files.csv)를 따른다.

소비자 부재는 정적 삭제 후보 근거다. 삭제 전 public export·동적 등록·도구 소비자를 다시 확인한다. FIN-06·FIN-07의 구버전/이관 경로는 지원 종료와 데이터 이관 근거가 확인된 뒤 정리한다. 이번 조사에서 운영 데이터를 조회하거나 테스트를 실행하지 않았다.

## 우선순위

| 순서 | 후보 | 이유 |
| --- | --- | --- |
| 1 | FIN-09 정기 계획 단건 저장 경계 | 한 건 변경에 가구 전체 plan·receipt를 두 번 읽는 직접 실행 경로를 줄입니다. |
| 2 | FIN-01 서버 명령의 확정 업무 결과 반환 | 이미 계산한 결과를 반환해 Web의 version·시각 추정 근거를 없앱니다. 최신 snapshot guard까지 제거할 근거는 아닙니다. |
| 3 | FIN-02 실제 경로와 분리된 업무 모델 정리 | 계약 검사를 실제 경로로 옮긴 뒤 소비되지 않는 별도 모델을 없앱니다. |
| 4 | FIN-03·04·05·08 | 실제 페이지 조회·outbox·삭제목록·catalog 결과 경계를 작게 정리합니다. |
| 보류 | FIN-06·07 | 구버전 종료·자료 이관 coverage가 확인되어야 가능한 정리입니다. |

## 기능별 계약·실행 흐름·조사 상태

### 수동 지출·수입·수정·삭제

- 계약: LED-001, LED-002, LED-003, LED-004, LED-005, LED-007, LED-011
- 진입 → 판정 → 저장: HouseholdCommand actor/payload → BasicLedgerCommands의 category/tags/date/version/receipt 판정 → repository transaction의 canonical·receipt·outbox 동시 commit

### 월/항목 분할·병합·취소 lineage

- 계약: LED-008, LED-009, LED-010, LED-012
- 진입 → 판정 → 저장: bootstrap expected version map → 각 split/lineage service → Firebase store 원자 경계; 실제 capture 취소는 graph/외부 capture adapter가 연계됨

### 카테고리·예산

- 계약: CAT-001, CAT-002, CAT-003, CAT-004
- 진입 → 판정 → 저장: Command → catalog transaction의 version/state 판정 → archive process → recurring/merchant 참조 재배치 → archive 완료

### 지역화폐 잔액

- 계약: BAL-001, BAL-002, BAL-003, BAL-004, BAL-005
- 진입 → 판정 → 저장: verified capture branch → actor/envelope 검증 → observation receipt/순서 → canonical+legacy balance/첫선택/changed event commit

### 정기지출

- 계약: REC-001, REC-002, REC-003, REC-004, REC-005, REC-006
- 진입 → 판정 → 저장: scheduled page → due month/checkpoint → target UoW가 creator/version/receipt 판정 → ledger+execution+receipt+outbox

### 자산·보유종목 Command

- 계약: AST-001, AST-003, AST-006, AST-009, HOLD-001, HOLD-002, HOLD-003, HOLD-004
- 진입 → 판정 → 저장: handler → parse owner/type/numeric/expected versions → atomic runtime → canonical asset/position+수량history+automation revisions+outbox+receipt

### 자산 관리자 복구·영구삭제

- 계약: AST-006
- 진입 → 판정 → 저장: 관리자 capability → lifecycle application → restoration participant와 UoW → 복구/감사/outbox; 목록은 현재 이중 조회

### 적금·대출 자동화

- 계약: AUTO-001, AUTO-002, AUTO-003
- 진입 → 판정 → 저장: due plan page → applyNextDue → plan/execution/asset transaction → checkpoint

### 시세 갱신·종목 검색·catalog

- 계약: MARKET-001, MARKET-002, MARKET-003, MARKET-004, MARKET-005, MARKET-006, JOB-AST-001, JOB-AST-002, JOB-AST-003, FUND-001, GOLD-001, GOLD-002
- 진입 → 판정 → 저장: authorized Query/Command 또는 job → explicit market target/공급자 조회(트랜잭션 밖) → version 재확인 → Position+Asset 평가와 outbox

### 배당

- 계약: DIV-001, DIV-002, DIV-003, DIV-004, DIV-005, DIV-006
- 진입 → 판정 → 저장: active KRX ETF discovery + 별도 nonterminal event recheck → history evidence 완전성 → fixed/paid + projection 저장 repository

### 통계·자산 이력

- 계약: STAT-001, STAT-002, STAT-004, STAT-005, STAT-006, STAT-AST-001, STAT-AST-002, STAT-AST-003, AST-004, AST-005
- 진입 → 판정 → 저장: 현재 실제 경로는 Web bounded read model/cache/화면; Functions read-side의 별도 controller/query 상당수는 test-only

### 금융 이관·운영

- 계약: BAL-003, DIV-005, AST-006
- 진입 → 판정 → 저장: 명시적 migration plan → candidate 검증 → canonical/history 생성; 과거 이관의 history 복원은 현재 runtime에도 남음

## 구체적 단순화 후보

### FIN-09 · P1 · 정기 계획 한 건의 명령을 가구 전체 plans·receipts 로딩과 diff 저장에서 분리합니다

확신도: 높음. 계약: REC-001, REC-003, REC-005, REC-006.

근거:

- [functions/src/adapters/firebase/recurring/firebaseRecurringPlanManagementStore.ts:144](../../../functions/src/adapters/firebase/recurring/firebaseRecurringPlanManagementStore.ts#L144)
- [functions/src/adapters/firebase/recurring/firebaseRecurringPlanManagementStore.ts:183](../../../functions/src/adapters/firebase/recurring/firebaseRecurringPlanManagementStore.ts#L183)
- [functions/src/adapters/firebase/recurring/firebaseRecurringPlanManagementStore.ts:195](../../../functions/src/adapters/firebase/recurring/firebaseRecurringPlanManagementStore.ts#L195)
- [functions/src/adapters/firebase/recurring/firebaseRecurringPlanManagementStore.ts:206](../../../functions/src/adapters/firebase/recurring/firebaseRecurringPlanManagementStore.ts#L206)
- [functions/src/contexts/household-finance/recurring/application/recurringPlanManagementApplication.ts:266](../../../functions/src/contexts/household-finance/recurring/application/recurringPlanManagementApplication.ts#L266)

현재 흐름: Plan update → store.read가 전체 canonical plans·legacy plans·모든 command receipts 조회 → 사전 판정 → transact가 같은 전체 상태 재조회 → 한 건 수정된 배열 전체 diff → 변경 plan·receipt·outbox 저장; 목록도 read를 통해 불필요한 receipts를 읽음

문제: 명령 하나의 권한·version·멱등 판정에 가구 전체 in-memory state를 요구하는 저장 계약 때문에 전체 조회와 재판정·배열 복사·signature diff가 생깁니다. Plan 수 및 누적 receipt 수와 함께 읽기 범위가 증가하고 서로 무관한 plan도 transaction 관측 범위에 들어갑니다. 지연 정도는 이번 정적 조사에서 측정하지 않았습니다.

더 작은 설계: command용 atomic read/write를 target planId·commandId receipt·필요 category evidence로 제한하고 transaction 안에서 한 번 판정해 target plan+receipt+outbox만 저장합니다. 목록은 plans만 읽는 별도 query로 분리합니다. canonical/legacy 우선순위와 호환 쓰기는 그대로 유지해도 이 변경은 가능하며, 레거시 제거 작업과 결합하지 않습니다.

보존 계약:

- 동일 명령 replay·payload mismatch·expectedVersion 충돌 우선순위
- plan·receipt·outbox 원자 commit과 실패 시 write 0
- 인증 Actor의 immutable creatorMemberId 및 creator 없는 legacy 처리
- category 유효성·firstApplicableMonth·삭제 상태
- canonical 우선순위·legacy 호환 및 기존 목록 정렬/페이지 계약

실제 검증 단위:

- 실제 Firebase Emulator에서 무관한 plan·receipt를 많이 둔 단건 명령의 읽기/쓰기 대상 검증
- 동일 command 동시 재전달·다른 payload·같은 plan 동시 update/delete 경합
- creator 주입·다른 가구 접근·creator 없는 legacy·이미 설정된 creator 유지
- category archive 중 경합과 실패 rollback
- canonical/legacy 중복·목록 정렬·페이지·다음 scheduler 실행 결과 불변

### FIN-01 · P1 · 자산·보유종목 Command가 계산한 최종 상태를 버려 Web이 서버 상태를 추정합니다

확신도: 높음. 계약: AST-001, AST-003, AST-006, HOLD-001, HOLD-002, HOLD-003, HOLD-004.

근거:

- [functions/src/contexts/portfolio/core/application/portfolioAssetCommandApplication.ts:387](../../../functions/src/contexts/portfolio/core/application/portfolioAssetCommandApplication.ts#L387)
- [functions/src/contexts/portfolio/core/application/portfolioPositionCommandApplication.ts:231](../../../functions/src/contexts/portfolio/core/application/portfolioPositionCommandApplication.ts#L231)
- [functions/src/adapters/firebase/portfolio/firebasePortfolioRuntimeStore.ts:55](../../../functions/src/adapters/firebase/portfolio/firebasePortfolioRuntimeStore.ts#L55)
- [functions/src/contexts/portfolio/core/application/ports/out/portfolioRuntimeStorePort.ts:114](../../../functions/src/contexts/portfolio/core/application/ports/out/portfolioRuntimeStorePort.ts#L114)
- [functions/src/adapters/firebase/portfolio/firebasePortfolioRuntimeDocuments.ts:56](../../../functions/src/adapters/firebase/portfolio/firebasePortfolioRuntimeDocuments.ts#L56)

현재 흐름: HouseholdCommand → portfolio runtime → 같은 transaction에서 updated Position/nextAsset 계산 → canonical·history·outbox·receipt 저장 → success({}) 또는 ID만 반환 → Web이 expectedVersion+1/현재시각을 추정

문제: 서버가 이미 보유한 결과를 버리는 API가 Web의 command floor·시각 추정·authoritative state 보완층을 요구합니다. 전체 Record<string, unknown> 성공 타입은 실제 변경 결과의 누락을 타입으로 잡지 못합니다.

더 작은 설계: 추가 조회 없이 이미 계산한 canonical 업무 필드와 resulting versions를 typed command result로 반환하고 같은 receipt에 저장합니다. Web은 이를 기존 optimistic projection에 확인 완료로 반영합니다. 현재 계산 상태의 updatedAt은 metadata.occurredAt이지만 문서 mapper는 Firestore serverTimestamp를 저장하므로 둘을 동일한 최종 timestamp라고 반환하면 안 됩니다. 업무시각과 저장시각 계약을 구분하고, 실제 확정 저장시각이 필요하면 별도 관측 경계를 둡니다. 기존 receipt와 구버전 Web 호환은 result version으로 명시합니다.

보존 계약:

- Asset/Position/receipt/outbox/수량 history 원자성
- 멱등 payload mismatch 및 저장 결과 재생
- 서버 version conflict
- 서버 owner/금액/수량 정규화
- 응답보다 최신인 snapshot의 version guard, 세션 scope, pending overlay는 유지

실제 검증 단위:

- 서버 normalizing update 응답과 canonical 문서의 업무 필드·version 동등성 및 업무시각/저장시각 구분
- 동일 명령 replay 결과 동등성
- Position+부모 Asset 반환 및 동시 경합
- 응답 지연 중 더 최신 snapshot을 받은 Web에서 역행 없음
- 기존 receipt에 canonical view가 없는 경우의 명시적 호환

### FIN-02 · P1 · 실제 경로와 분리된 Reporting 상태기계·포트폴리오 정책을 계약 검사와 함께 정리합니다

확신도: 높음. 계약: STAT-002, STAT-004, STAT-005, STAT-006, STAT-AST-001, STAT-AST-002, STAT-AST-003, HOLD-001, JOB-AST-001, AUTO-001, DIV-001, DIV-003, DIV-005.

근거:

- [functions/src/read-side/reporting/application/reportingAuthoritativeActionController.ts:26](https://github.com/minkue777/household-account/blob/12a582bf63bae7ad5b7c66bcfbf67ac96fb338da/functions/src/read-side/reporting/application/reportingAuthoritativeActionController.ts#L26)
- [functions/src/read-side/reporting/application/reportingCategoryActionController.ts:18](https://github.com/minkue777/household-account/blob/12a582bf63bae7ad5b7c66bcfbf67ac96fb338da/functions/src/read-side/reporting/application/reportingCategoryActionController.ts#L18)
- [functions/src/read-side/reporting/application/queries/boundedReportingQuery.ts:70](https://github.com/minkue777/household-account/blob/12a582bf63bae7ad5b7c66bcfbf67ac96fb338da/functions/src/read-side/reporting/application/queries/boundedReportingQuery.ts#L70)
- [functions/src/read-side/reporting/application/queries/boundedAssetStatisticsQuery.ts:101](https://github.com/minkue777/household-account/blob/12a582bf63bae7ad5b7c66bcfbf67ac96fb338da/functions/src/read-side/reporting/application/queries/boundedAssetStatisticsQuery.ts#L101)
- [functions/test/support/reporting-authoritative-action-fixture.ts:47](https://github.com/minkue777/household-account/blob/12a582bf63bae7ad5b7c66bcfbf67ac96fb338da/functions/test/support/reporting-authoritative-action-fixture.ts#L47)
- [docs/requirements/supporting-platform/modules/reporting/design.md:9](../../../docs/requirements/supporting-platform/modules/reporting/design.md#L9)
- [functions/src/contexts/portfolio/holdings/domain/policies/assetRevaluationPolicy.ts:24](https://github.com/minkue777/household-account/blob/676731d9abda95439afc2dfd827690029d89e048/functions/src/contexts/portfolio/holdings/domain/policies/assetRevaluationPolicy.ts#L24)
- [functions/src/contexts/portfolio/automation/domain/policies/automationDueTasks.ts:37](https://github.com/minkue777/household-account/blob/12a582bf63bae7ad5b7c66bcfbf67ac96fb338da/functions/src/contexts/portfolio/automation/domain/policies/automationDueTasks.ts#L37)
- [functions/src/contexts/portfolio/dividends/domain/entities/dividendEvent.ts:215](https://github.com/minkue777/household-account/blob/12a582bf63bae7ad5b7c66bcfbf67ac96fb338da/functions/src/contexts/portfolio/dividends/domain/entities/dividendEvent.ts#L215)
- [functions/test/contexts/portfolio/dividend-state-transition-contract.contract.test.ts:62](https://github.com/minkue777/household-account/blob/12a582bf63bae7ad5b7c66bcfbf67ac96fb338da/functions/test/contexts/portfolio/dividend-state-transition-contract.contract.test.ts#L62)
- [functions/src/adapters/firebase/dividends/firebaseDividendEventRuntimeRepository.ts:266](../../../functions/src/adapters/firebase/dividends/firebaseDividendEventRuntimeRepository.ts#L266)

현재 흐름: 현재 Web 통계 → expenseStatisticsReadModel/cache + expenseService Command + 화면 revision; 별도 Functions controller/query → fixture source/가짜 owner gateway만 호출

문제: 전체 소스/테스트 검색에서 controller 2개와 boundedReporting, ledgerStatistics query는 테스트 fixture만 호출합니다. boundedAssetStatistics/getAssetSnapshotContinuity factory는 production 호출을 찾지 못했습니다. fixture가 transaction 변경·version 증가·receipt/event 생성 자체를 재구현하여 실제 Ledger/Reporting 흐름과 다른 두 번째 제품 모델을 유지합니다. 설계 문서도 2026-09-17에 이 경로가 목표 구조이며 실제 Web 경로가 아님을 명시합니다. 추가 본문 검토와 functions/src·functions/test·web/src 전체 심볼 검색에서 holdings의 applyPositionMutation/calculatePositionAccountState/selectDailyValuationTargets/buildDailyAssetSnapshotIntent/normalizeAndValueGold/normalizeValuationAssetLifecycle은 선언 외 소비자를 찾지 못했습니다. automationDueTasks와 dividendProjectionPolicy도 선언 외 호출이 없었습니다. dividendEvent의 상태 전이 함수는 별도 Map 기반 계약 fixture에서만 소비되며, 실제 FirebaseDividendEventRuntimeRepository의 가구별 v3 identity·증거·정정·paid 판정과 분리되어 있습니다. 같은 이름의 runtime repository upsertAnnouncement는 실제 사용 중이므로 삭제 대상으로 혼동하면 안 됩니다.

더 작은 설계: 계약별 fixture 사례를 실제 Web read model·화면·서버 Command adapter 검사에 이관한 뒤 미연결 factory/controller와 테스트 전용 모델/port를 제거합니다. 공유가 필요한 계산만 실제 소비자가 사용하는 순수 함수로 남깁니다. 단순히 테스트를 삭제하거나 죽은 서버 경로를 새로 연결하는 것이 목적은 아닙니다.

보존 계약:

- 0원/NoData/실패 구분
- 완전 page 조회와 row/page 상한
- 세션·가구·query revision 최신성
- 수정·삭제·규칙 저장 성공/실패 시 실제 화면 수렴
- historical dimension/baseline/0원 carry
- 실제 평가의 가격·환율 단위와 반올림, 배당 가구별 event identity·수량 증거·paid 불변

실제 검증 단위:

- STAT-* 각 fixture의 실제 호출 경로 매핑
- Web 실제 source 실패·cursor경계·오래된 응답 검사
- 실제 Command 충돌과 receipt/event를 연결한 UI E2E
- 삭제 전후 requirements traceability 누락 없음
- 삭제 후보 심볼의 production/test/public export 소비자를 다시 확정하고 실제 runtime adapter의 회귀에 계약 사례를 이관

### FIN-03 · P2 · 정기지출의 optional pagination이 테스트 때문에 무제한 조회 경로를 남깁니다

확신도: 높음. 계약: REC-002, REC-003, REC-006.

근거:

- [functions/src/contexts/household-finance/recurring/application/recurringSchedulerWorkflowApplication.ts:89](../../../functions/src/contexts/household-finance/recurring/application/recurringSchedulerWorkflowApplication.ts#L89)
- [functions/src/contexts/household-finance/recurring/application/ports/out/recurringProcessingPorts.ts:23](../../../functions/src/contexts/household-finance/recurring/application/ports/out/recurringProcessingPorts.ts#L23)
- [functions/src/adapters/firebase/recurring/firebaseRecurringFinanceUnitOfWork.ts:193](../../../functions/src/adapters/firebase/recurring/firebaseRecurringFinanceUnitOfWork.ts#L193)
- [functions/test/support/recurring-processing-fixture.ts:107](../../../functions/test/support/recurring-processing-fixture.ts#L107)

현재 흐름: Scheduler → processDue → readPlanPage가 있으면 실제 DB page; 없으면 read()로 전체 상태를 받고 filter/sort/slice

문제: production Firebase UoW는 readPlanPage를 구현하지만 fixture UoW가 구현하지 않아 application이 두 page 경로를 유지합니다. 같은 계약을 테스트가 production과 다른 경로로 확인합니다.

더 작은 설계: readPlanPage를 필수 port로 만들고 in-memory fixture에 동일한 page/cursor 계약을 구현합니다. application의 전체-read fallback 및 그 목적의 read 의존을 제거합니다. fixture의 snapshot 확인용 read는 test-only로 남길 수 있습니다.

보존 계약:

- 오래된 월부터 처리
- planId/month checkpoint 재개
- 한 page 작업량 상한
- creator immutable 및 누락 creator 거부
- 동일 execution key 멱등

실제 검증 단위:

- 동일 fixture를 메모리 page adapter와 Firebase adapter에 적용
- limit 경계에서 다음 plan/동일 plan의 다음 달 누락 없음
- 재시도 checkpoint 및 누락월 복구

### FIN-04 · P2 · 정기지출은 Outbox 원자 저장 뒤 사용하지 않는 별도 publish 경로를 유지합니다

확신도: 높음. 계약: REC-002, REC-004, LED-007.

근거:

- [functions/src/contexts/household-finance/recurring/application/recurringSchedulerWorkflowApplication.ts:63](../../../functions/src/contexts/household-finance/recurring/application/recurringSchedulerWorkflowApplication.ts#L63)
- [functions/src/operations/scheduling/recurringScheduledPages.ts:66](../../../functions/src/operations/scheduling/recurringScheduledPages.ts#L66)
- [functions/src/adapters/firebase/recurring/firebaseRecurringFinanceUnitOfWork.ts:411](../../../functions/src/adapters/firebase/recurring/firebaseRecurringFinanceUnitOfWork.ts#L411)
- [functions/test/support/recurring-processing-fixture.ts:145](../../../functions/test/support/recurring-processing-fixture.ts#L145)

현재 흐름: UoW → 거래/execution/receipt/outbox 동시 commit → committedEvents를 반환 → application events.publish → production은 빈 함수

문제: 이벤트 전달의 실체는 transactional outbox인데 별도 publisher port가 존재해 두 전달 책임처럼 읽힙니다. production에서는 noop이고 테스트만 별도 published 배열을 기록합니다.

더 작은 설계: commit 결과의 이벤트 전달 책임을 Outbox 하나로 고정하고 사용되지 않는 after-commit publisher 의존을 제거합니다. 계약 테스트는 committed outbox와 실제 consumer를 관찰하도록 바꿉니다.

보존 계약:

- 거래/execution/receipt/outbox 동일 transaction
- 정기 생성 자동 푸시 제외
- 사용자 알림 요청은 별도 전달
- 실패 시 write0·replay시 outbox중복0

실제 검증 단위:

- recurring atomicity와 notification production-flow adapter 검증
- commit 실패 시 Outbox 없음
- 동일 실행 재생의 receipt/outbox 개수 불변

### FIN-05 · P2 · 삭제 자산 목록의 ID 왕복을 없애 한 번 읽은 문서를 그대로 반환합니다

확신도: 높음. 계약: AST-006.

근거:

- [functions/src/adapters/firebase/portfolio/firebaseAssetLifecycleUnitOfWork.ts:211](../../../functions/src/adapters/firebase/portfolio/firebaseAssetLifecycleUnitOfWork.ts#L211)
- [functions/src/contexts/portfolio/core/application/assetLifecycleApplication.ts:587](../../../functions/src/contexts/portfolio/core/application/assetLifecycleApplication.ts#L587)
- [functions/src/bootstrap/admin/handlers/adminAssetAccessHandlers.ts:86](../../../functions/src/bootstrap/admin/handlers/adminAssetAccessHandlers.ts#L86)

현재 흐름: 관리자 인증 → listDeletedAssets → 전체 assets 조회/상태 mapping → ID만 반환 → handler가 ID마다 같은 canonical 문서를 재조회하고 deleted로 표시

문제: 첫 읽기에 있던 name/version/deletedAt을 domain view에서 버려 N회 재조회와 재정규화가 생깁니다. 두 읽기 사이 상태가 바뀌어도 handler는 deleted 상수를 반환하여 관찰 시점도 섞입니다.

더 작은 설계: 관리자 전용 목록 query가 authorization 후 deleted asset summary(name, version, deletedAt 포함)를 한 번에 반환하도록 계약을 좁게 바꿉니다. lifecycle 명령의 UoW와 별개로 작은 read query를 두어도 좋습니다.

보존 계약:

- 관리자 restore.read 권한
- 가구 scope
- 일반 사용자 삭제자산 미노출
- 복구 때 expectedVersion 재검증

실제 검증 단위:

- 삭제자산 여러개에서 추가 N조회 없음
- active/purging 제외
- 타가구/비관리자 거부
- 목록 이후 복구/동시변경의 expectedVersion 충돌

### FIN-08 · P2 · 종목 catalog의 업로드 전 가상 metadata를 없애 실제 저장 결과에서 한 번만 구성합니다

확신도: 높음. 계약: MARKET-005, DEC-035.

근거:

- [functions/src/contexts/portfolio/holdings/domain/policies/instrumentCatalogPolicy.ts:37](../../../functions/src/contexts/portfolio/holdings/domain/policies/instrumentCatalogPolicy.ts#L37)
- [functions/src/contexts/portfolio/holdings/application/instrumentCatalogApplication.ts:84](../../../functions/src/contexts/portfolio/holdings/application/instrumentCatalogApplication.ts#L84)
- [functions/src/adapters/firebase/portfolio/firebaseInstrumentCatalog.ts:288](../../../functions/src/adapters/firebase/portfolio/firebaseInstrumentCatalog.ts#L288)
- [functions/src/adapters/firebase/portfolio/firebaseInstrumentCatalog.ts:336](../../../functions/src/adapters/firebase/portfolio/firebaseInstrumentCatalog.ts#L336)
- [functions/src/adapters/firebase/portfolio/firebaseInstrumentCatalog.ts:370](../../../functions/src/adapters/firebase/portfolio/firebaseInstrumentCatalog.ts#L370)

현재 흐름: 공급자 source 검증 → buildCatalogPublication이 가상 generation/checksum/publishedAt·receipt 생성 → 실제 Storage adapter가 gzip·SHA256·object generation·publishedAt·manifest·receipt를 다시 생성

문제: 정책의 sha256:<date>:<count>:<identities>는 실제 SHA256이 아니며 snapshot/manifest generation과 게시시각도 가상 값입니다. 실제 adapter가 올바른 실측 metadata로 덮어써 운영 무결성 실패를 입증한 것은 아닙니다. 그러나 아직 업로드하지 않은 run의 uploadVerification을 valid로 전달·검사하고 두 층이 같은 publication 결과를 서로 다르게 만드는 모델은 실제 성공 경계를 흐립니다.

더 작은 설계: policy는 검증된 CatalogPublicationDraft(asOfDate/items/sourceCounts)만 만들고 Storage adapter가 실제 gzip bytes·upload·metadata 관측 뒤 manifest를 한 번 구성하게 합니다. 선행 uploadVerification과 실제 commit에서 사용하지 않는 사전 receipt를 실제 소비자 확인 후 없앱니다. receipt에는 실제 게시 결과만 저장합니다.

보존 계약:

- 공급자 전체 성공·최소 종목수·스키마 검증
- snapshot 불변·generation precondition·manifest CAS
- checksum과 generation 검증
- 실패 시 최신 manifest 유지·마지막 성공 cache 보존
- 최근 성공일 3개 유지와 run receipt 멱등성

실제 검증 단위:

- 실제 Storage adapter의 gzip bytes 다운로드·SHA256·generation·manifest 참조 일치
- 같은 날짜 다른 payload immutable conflict와 concurrent manifest generation conflict
- 업로드 또는 manifest 저장 실패 시 이전 manifest 보존
- fixture의 문자열 checksum 검증을 실제 adapter 무결성 검사로 대체하고 기존 계약 추적성 유지

### FIN-06 · P3-조건부 · 지역화폐 Canonical/legacy 이중 저장의 종료 계획을 명시합니다

확신도: 중간: 코드상 중복은 확실하나 운영 지원 종료는 미확인. 계약: BAL-002, BAL-003, BAL-004, BAL-005.

근거:

- [functions/src/adapters/firebase/local-currency/firebaseLocalCurrencyBalanceStore.ts:134](../../../functions/src/adapters/firebase/local-currency/firebaseLocalCurrencyBalanceStore.ts#L134)
- [functions/src/adapters/firebase/home-preferences/firebaseHomePreferenceAtomicStore.ts:161](../../../functions/src/adapters/firebase/home-preferences/firebaseHomePreferenceAtomicStore.ts#L161)
- [functions/src/adapters/firebase/local-currency/firebaseLocalCurrencyBalanceStore.ts:229](../../../functions/src/adapters/firebase/local-currency/firebaseLocalCurrencyBalanceStore.ts#L229)

현재 흐름: BalanceObservation → version/순서/receipt 판정 → canonical localCurrencyBalances와 legacy balances 둘 다 저장 → Home Preferences도 두 저장소를 조회

문제: 실제 Web은 canonical을 읽는데 신규 잔액마다 legacy 복사본도 작성하고 첫 유형 선택은 양쪽을 읽습니다. 단, 현재 Home Preferences와 legacy-unknown 조회가 실제 소비자이므로 legacy writer만 먼저 지우면 안 됩니다.

더 작은 설계: 구버전 reader 사용 여부와 기존 이관 완료를 확인한 뒤 legacy 자료를 canonical read contract로 한 번 정리하고 writer/선택 조회를 canonical 하나로 통일합니다. legacy-unknown 표시 계약은 필요한 자료의 이관 형태로 보존합니다.

보존 계약:

- 유형별 최신 관찰 순서
- 음수/0원 정수 보존
- 같은 observation 멱등 및 독립 balance branch
- 첫 유형 자동선택과 기존 사용자 선택 보존
- 유형 미상 자료를 임의 지역으로 추정하지 않음

실제 검증 단위:

- 활성 구버전/운영 데이터 분포는 별도 읽기 전용 확인 필요
- canonical-only/legacy-only/혼합 가구 fixture
- 동시 첫 observation에서 한 선택만 저장
- 이관 후 예전 reader 차단/호환 계획

### FIN-07 · P3-조건부 · 배당 조회에서 이관 계획을 매번 재해석하는 복구 경로를 1회 자료 정비로 옮깁니다

확신도: 중간: 보완 경로는 확인, 제거 선행조건은 미검증. 계약: DIV-003, DIV-005, DIV-006.

근거:

- [functions/src/adapters/firebase/portfolio/firebaseDividendHoldingQuery.ts:246](../../../functions/src/adapters/firebase/portfolio/firebaseDividendHoldingQuery.ts#L246)
- [functions/src/adapters/firebase/portfolio/firebaseMigratedPositionHistoryReader.ts:5](../../../functions/src/adapters/firebase/portfolio/firebaseMigratedPositionHistoryReader.ts#L5)
- [functions/src/adapters/firebase/migration/collectors/portfolioPositionRuntimeMigrationCollector.ts:218](../../../functions/src/adapters/firebase/migration/collectors/portfolioPositionRuntimeMigrationCollector.ts#L218)

현재 흐름: 배당 확정/정정 → Position history 조회 → 계좌 이력이 비면 완료 migration plan과 candidates를 조회·검증해 과거 수량을 합성

문제: 10월2일 누락 복구에는 필요한 안전장치였지만 금융 조회가 operations migration 저장 형식과 전체 계획 목록에 영구 의존합니다. 신규 migration collector는 초기 positionHistory를 쓰고 있어 새 자료와 옛 자료의 경로도 다릅니다.

더 작은 설계: 현재 엄격한 완료/전량적용/경로/수량 검증을 그대로 사용하는 승인된 일회성 history 이관을 마련하고, 이관 완료 증거와 모든 대상 coverage를 확인한 뒤 조회를 canonical history로 통일합니다. 이번 조사에서는 운영 자료를 변경하지 않았으며 즉시 fallback 제거를 권하지 않습니다.

보존 계약:

- 현재 수량을 과거로 소급 금지
- 모든 sourceAssetIds의 증거가 있어야 확정
- 정확일/가장가까운날/이전날 동률 우선
- paid 불변
- 기존 정상 이력이 있으면 migration 중복 근거 없음

실제 검증 단위:

- 완료/부분/미완료 plan·잘못된 path·타가구·0주 회귀
- 이관 전후 기존 공시별 적격수량/합계 동등성
- 일회성 재실행 멱등
- 원본 migration 자료 보존과 dry-run diff

## 남겨야 하는 복잡성

- 서버 Actor/household 권한, expectedVersion, 멱등 payload fingerprint/receipt/outbox의 원자 commit
- 원장 split/merge/cancel의 provenance·leaf graph·전체 version map과 실패시 write0
- recurring 및 automation 월별 execution key/checkpoint/creator 고정·삭제기간 제외
- 시세 외부조회 transaction 밖 수행·commit 시 version 재확인·마지막 성공 Quote 보존
- 배당 event identity, 모든 계좌의 수량증거, paid 불변, event/projection 동시 변경
- 통계의 0원/NoData/실패 구분 및 완전페이지·세션/가구 최신성
- 자산의 정수 money/price scale·통화별 환율 신선도·마지막 성공 가격 보존은 단순 파일 통합 대상이 아닙니다.
- automation revision/effectiveFrom/first activation 및 삭제 공백 회복은 실제 일정 계약이므로 유지합니다.
- 카테고리 보관 process의 재배치 재시도·완료 판정, legacy 별칭과 지역화폐 구버전 호환은 종료 증거 없이 제거하지 않습니다.

파일 길이·interface 개수·계층 분리 자체는 삭제 이유로 삼지 않았습니다. 특히 분할 graph의 전체 version 관측, 자동화의 날짜별 revision 및 배당의 다중 계좌 증거는 실제 실패·중복·과거 자료 정합성을 지키는 조건입니다.

## 인수 시 권장 경계

FIN-09를 단독 변경 단위로 먼저 다루고 실제 Firebase 경합·멱등 회귀를 고정하는 편이 작습니다. FIN-01은 서버 결과 계약과 Web 소비자를 함께 바꿔야 하므로 별도 변경 단위로 두십시오. FIN-02는 후보마다 실제 소비자 재확인 → 계약 검증 이관 → 미사용 코드 제거 순서로 진행하고, 목표 구조를 구현하기 위해 죽은 경로를 새로 연결하지 마십시오.
