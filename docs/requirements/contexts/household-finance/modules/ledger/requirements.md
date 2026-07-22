# 거래 원장 모듈 요구사항

> 상위 Bounded Context: [Household Finance](../../requirements.md)  
> 아키텍처 역할: Core Domain / Application  
> 상세 설계: [모듈 상세 설계](design.md)  
> 상태와 테스트 수준의 의미는 [공통 규약](../../../../governance/conventions.md)을 따릅니다.  
> 이 문서는 `LED-*`, `SPL-*`, `MRG-*`, `SEA-*` 요구사항의 단일 소유 문서입니다.

## 1. 독립 모듈 책임

거래 원장 모듈은 가구의 지출·수입 원장과 그 수명주기를 소유합니다. 거래 생성·조회·수정·삭제, 검색, 항목 분할, 월 분할, 합치기·해제를 하나의 원장 경계에서 처리합니다.

이 모듈이 보장할 핵심 불변식은 다음과 같습니다.

- 거래는 하나의 가구와 하나의 거래 유형에 속합니다.
- 정상 거래 금액은 원 단위 양의 정수입니다.
- 항목 분할은 합계 보존, 월 분할은 [DEC-001](../../../../governance/decisions.md#dec-001)의 내림 정책을 적용합니다.
- 원본을 교체하는 다중 문서 작업은 전체 성공 또는 전체 실패여야 합니다.
- 거래 생성 경로가 Web·Android·Functions 중 어디인지와 무관하게 동일한 원장 계약을 사용합니다.
- 검색과 집계는 거래를 변경하지 않는 조회 모델입니다.

## 2. 포함·제외 범위

### 포함

- 지출·수입의 등록·조회·수정·삭제
- 월·일·카테고리별 원장 조회와 합계
- 가맹점·메모·카드 정보 검색
- 한 거래의 항목 분할과 월 단위 분할
- 월 분할 그룹 조회·재구성·취소
- 여러 지출의 합치기와 합치기 해제
- 명시적 가구원 알림 요청 시각·요청자 메타데이터 기록
- 자동 수집·정기지출 등 외부 모듈이 사용할 거래 생성 계약

### 제외

- 금융 알림과 iOS 메시지 파싱
- 가맹점 자동 분류 규칙과 카드 식별 규칙
- 카테고리 정의·예산 정책
- 정기지출 일정과 자동 생성 시점 결정
- 푸시 대상 계산과 전송
- 자산·잔액·배당 원장

## 3. 소유 데이터

| 데이터 | 소유 범위 | 비고 |
|---|---|---|
| `expenses` | 지출·수입 본문, 날짜·시각, 금액, 가맹점, 메모, 카테고리 참조, 카드 표시 정보 | 이 모듈의 Aggregate입니다. |
| 분할 메타데이터 | 월 분할 그룹 ID·순번·전체 개월 수 | 같은 원장 트랜잭션 안에서만 생성·변경합니다. |
| 합치기 복원 데이터 | `mergedFrom`의 원본별 가맹점·금액·카테고리·메모 | 날짜·시간·거래 유형·카드 정보는 합친 거래의 공통 값을 사용합니다. |
| 명시적 가구원 알림 요청 | `requestedAt`, `requesterMemberId` | 실제 수신자·전달은 알림 모듈이 담당합니다. legacy `notifyPartnerAt/By`는 전환 Mapper에서만 읽습니다. |
| 생성 출처·주체 | 업무 `source`, `originChannel`, `creatorMemberId`, 거래 유형 | 필수 공통 계약으로 관리하며 legacy `createdBy`는 Mapper에서만 읽습니다. `source`와 입력 채널을 한 문자열로 겸용하지 않습니다. |

카테고리 이름·예산, 카드 등록 정보, 가맹점 규칙은 참조할 뿐 소유하지 않습니다.

## 4. 공개 계약·의존 모듈

### 외부에 제공하는 계약

| 계약 | 입력 | 결과 |
|---|---|---|
| `RecordManualTransaction` | 수동 지출·수입 draft와 인증된 ActorContext | 생성된 거래와 version |
| `RecordCapturedTransaction` | 검증된 capture draft, fingerprint와 provenance | 생성된 거래 또는 기존 중복 거래 |
| `RecordRecurringTransactionParticipant` | 정기 거래 posting intent와 plan/month key | Finance UoW가 commit할 검증된 변경 의도 |
| `Update` | 거래 ID, 변경 가능한 필드, expected version | 갱신된 거래 |
| `Delete` | 거래 ID, expected version | 삭제 결과 |
| `SubscribeLedger` | 가구 ID, 거래 유형, 기간 | 날짜 내림차순 거래 스트림 |
| `SearchLedger` | 가구 ID, 거래 유형, 검색어, 기간·cursor | 최신 날짜순 page와 검색 전체·월별 건수 및 합계 |
| `Split` | 항목·월 분할·재구성·collapse operation | 원자적으로 교체된 항목 또는 월 분할 그룹 |
| `Merge` | 대상 ID, 원본 ID 집합과 expected versions | 합계 거래와 복원 스냅샷 |
| `Unmerge` | 합친 거래 ID와 expected version | 정책에 따른 원본 거래 집합 |
| `CancelCapturedLineage` | 취소 key와 capture lineage ID·version | 대상 lineage의 원본·파생 삭제와 다른 lineage 복원 결과 |
| `FindCancellationCandidates` | 기간·금액·선택 원장 사실·cursor | 정책 판단을 포함하지 않은 원장 후보 page |
| `RequestHouseholdNotification` | 거래 ID, 요청 멤버, 시각 | 알림 요청 메타데이터가 기록된 거래 |

### 의존 모듈·포트

- [가구·접근 모듈](../../../access-household/modules/household-access/requirements.md): 가구 범위와 안정적인 생성자 멤버 ID를 제공합니다.
- [카테고리·예산 모듈](../categories-budget/requirements.md): 유효 카테고리 참조와 기본 카테고리를 제공합니다.
- [알림 모듈](../../../notifications/modules/notifications/requirements.md): 거래 생성·알림 요청 이벤트를 소비합니다.
- [Android 결제 수집 모듈](../../../payment-capture/modules/android-payment-ingestion/requirements.md)과 [Shortcut 입력 모듈](../../../payment-capture/modules/shortcut-ingestion/requirements.md): `RecordCapturedTransaction`과 취소 lineage 계약을 사용합니다.
- [정기 거래 모듈](../recurring-transactions/requirements.md): 결정적 plan/month key로 `RecordRecurringTransactionParticipant`를 사용합니다.
- Clock·ID 생성기·원장 Repository: 테스트 가능한 Port로 주입합니다.

다른 모듈은 `expenses`를 직접 쓰지 않고 원장 Application API를 사용합니다.

## 5. 요구사항

### 등록·조회·수정·삭제

| ID | 상태 | 사전조건 / 행동 / 결과 | 경계·예외 | 근거 | 테스트 |
|---|---|---|---|---|---|
| LED-001 | 현재 명세·목표 보완 | 선택 월과 거래 유형별로 일반 조회 가능한 거래를 날짜·시각·ID 결정 순서로 제공한다. 브라우저 Web은 공개 Read Contract를 실시간 구독하고 Android WebView는 인증된 기간 Query를 최초 진입·성공 mutation 직후·앱 복귀·최대 30초 주기로 갱신한다. | Android 조회는 검증된 SessionScope와 기간·유형만 사용하고 20초 안에 성공 또는 실패 상태로 끝나 무한 loading을 허용하지 않는다. transactionType 누락 문서는 지출, lifecycleState 누락 문서는 active로 호환한다. `superseded`, `deleted` 또는 legacy `deletedAt`이 있는 문서는 목록·검색·합계에서 제외한다. | [expenseService](../../../../../../web/src/lib/expenseService.ts), [Ledger Query Handler](../../../../../../functions/src/bootstrap/queries/ledgerHouseholdQueryHandlers.ts), [DEC-065](../../../../governance/decisions.md#dec-065) | U, Contract, I, E2E |
| LED-002 | 현재 명세 | 수동 지출은 가맹점, 양의 정수 금액, 카테고리, 날짜를 입력해 생성한다. | 가맹점 공백은 거부한다. | [expenseForm](../../../../../../web/src/lib/utils/expenseForm.ts), [AddExpenseModal](../../../../../../web/src/components/expense/AddExpenseModal.tsx) | U, UI, E2E |
| LED-003 | 현재 명세 | 수입은 양의 금액과 필수 항목명으로 생성한다. | 저장 시 가맹점은 수입, 카테고리는 etc, 항목명은 memo에 둔다. | [AddExpenseModal](../../../../../../web/src/components/expense/AddExpenseModal.tsx), [ledgerDisplay](../../../../../../web/src/lib/utils/ledgerDisplay.ts) | U, UI, E2E |
| LED-004 | 현재 명세 | 단건 수동 거래는 현재 시각을 HH:mm, 카드 유형을 manual, 카드 표시를 `수동`으로 저장하고 Web 상세 화면도 `수동`으로 표시한다. | 거래 날짜와 생성 시각은 서로 다를 수 있다. Canonical `cardDisplay`를 우선 읽으며 기존 `cardLastFour`가 없는 수동 거래도 빈칸으로 표시하지 않는다. 신규 월 분할 경로에는 저장 시각 규칙이 적용되지 않는다. | [수동 거래 Domain](../../../../../../functions/src/contexts/household-finance/ledger/application/commands/basicLedgerService.ts), [Web Read Adapter](../../../../../../web/src/lib/expenseService.ts) | U, I |
| LED-005 | 현재 명세·목표 보완 | active 거래의 금액, 메모, 카테고리, 가맹점, 날짜를 수정할 수 있다. 일반 사용자의 삭제는 본문·출처·lineage를 보존한 채 `deleted` 상태와 `deletedAt`으로 전환하는 논리 삭제이며 즉시 일반 조회·검색·집계에서 제외한다. | 금액은 0보다 커야 하고 expectedVersion을 필수로 검증한다. deleted 거래는 일반 Update·Delete·Split 대상에서 NotFound로 취급하며 일반 사용자 복구 UI/API와 자동 hard purge를 제공하지 않는다. 실수 삭제 복구와 영구 삭제는 명시적 요청을 받은 운영자/Agent 전용 작업으로만 수행한다. 결제 취소에 의한 lineage 삭제는 DEC-041의 별도 정책을 따른다. | [expenseForm](../../../../../../web/src/lib/utils/expenseForm.ts), [expenseService](../../../../../../web/src/lib/expenseService.ts), [DEC-055](../../../../governance/decisions.md#dec-055), [DEC-065](../../../../governance/decisions.md#dec-065) | U, I, E2E |
| LED-006 | 현재 명세 | 선택 날짜 목록, 월·연 합계, 카테고리별 합계를 제공한다. | 연 합계는 필요한 화면에서만 구독한다. | [LedgerPage](../../../../../../web/src/components/home/LedgerPage.tsx), [CategorySummary](../../../../../../web/src/components/CategorySummary.tsx) | U, I, E2E |
| LED-007 | 목표 명세 | 지출에서 `알림 보내기`를 요청하면 요청 시각과 인증된 requesterMemberId를 기록한다. | 수입에서는 이 기능을 제공하지 않는다. 실제 수신자는 Notifications가 단일 partner 없이 요청자를 제외한 활성 가구원 전체로 계산한다. | [ExpenseItem](../../../../../../web/src/components/expense/ExpenseItem.tsx), [partnerNotificationService](../../../../../../web/src/lib/partnerNotificationService.ts), [DEC-013](../../../../governance/decisions.md#dec-013), [DEC-022](../../../../governance/decisions.md#dec-022) | U, I, E2E |
| LED-008 | 결함 | 원본을 교체하거나 여러 문서를 변경하는 split·reconfigure·collapse·merge·unmerge·capture lineage cancel은 서버 Application의 단일 Unit of Work에서 대상 전체를 다시 읽고 expected version map을 검증한 뒤 전부 commit하거나 전부 rollback한다. | 중간 실패·누락·타 가구 ID·한 문서 version 불일치가 있으면 write 0건과 typed `NotFound`·`Forbidden`·`Conflict`를 반환한다. 일반 Update와 구조 변경이 경합해도 서버 transaction에서 먼저 version 검증·commit한 하나만 성공하고 stale 요청은 자동 병합·덮어쓰기하지 않는다. 취소 시 다른 lineage 복원도 같은 UoW에 포함한다. 현재 Web 경로 일부는 client snapshot으로 계획하거나 여러 create 뒤 원본을 삭제해 부분 성공이 가능하다. | [expenseService](../../../../../../web/src/lib/expenseService.ts), [monthlySplitActions](../../../../../../web/src/lib/utils/monthlySplitActions.ts), [DEC-041](../../../../governance/decisions.md#dec-041), [DEC-055](../../../../governance/decisions.md#dec-055) | Application, Emulator, E2E |
| LED-009 | 결함 | split·merge·unmerge 등 구조 변경은 원본 거래를 일반 조회·집계에서 제외되는 `superseded` 상태로 보존하고, 업무 `source`, `originChannel`, `creatorMemberId`, 카드 증거와 immutable capture lineage를 유지하며 dedup claim을 다시 열거나 복제하지 않는다. | 사용자가 명시적으로 변경한 금액·날짜·표시 필드만 바꾼다. lineage는 일반 수정 API로 변경할 수 없고 원복은 보존된 같은 ID 원본을 재활성화한다. 결제 취소가 확정되면 DEC-041에 따라 대상 lineage의 superseded 원본과 모든 파생 지출은 삭제한다. 재병합은 DEC-056에 따라 merge ancestry만 최종 non-merge leaf까지 평탄화하고 중간 merge node는 감사 이력으로 보존한다. | [expenseService](../../../../../../web/src/lib/expenseService.ts), [monthlySplitActions](../../../../../../web/src/lib/utils/monthlySplitActions.ts), [DEC-013](../../../../governance/decisions.md#dec-013), [DEC-041](../../../../governance/decisions.md#dec-041), [DEC-056](../../../../governance/decisions.md#dec-056) | U, Application, Emulator |
| LED-010 | 목표 명세 | 지역화폐 결제 거래는 검증된 capture의 `localCurrencyType`을 immutable metadata로 저장하고, 지역화폐 상세 Query는 홈 카드에서 전달받은 한 유형만 조회한다. | 상세 화면에 전체·다른 유형 전환 UI를 두지 않는다. 유형 누락·`legacy-unknown` 거래는 일반 원장에 보존하되 특정 유형 상세에서 제외한다. 분할은 유형을 보존하고 서로 다른 유형 또는 typed/untyped 거래의 merge는 전체 Conflict다. | [DEC-057](../../../../governance/decisions.md#dec-057), [expenseService](../../../../../../web/src/lib/expenseService.ts) | U, Contract, I, UI |

### 항목 분할·월 분할·합치기

| ID | 상태 | 요구사항 | 경계·예외 | 근거 | 테스트 |
|---|---|---|---|---|---|
| SPL-001 | 결함 | 하나의 지출을 둘 이상의 항목으로 분할하고 원본은 `superseded` 상태로 보존한다. | 모든 항목의 금액은 양수이고 합계는 원금과 같아야 한다. 가맹점·카테고리는 항목별로 달라도 되며 명시적으로 바꾸지 않은 생성 출처·카드·capture lineage는 `LED-009`에 따라 보존한다. 원복은 파생 항목을 제거하고 같은 원본 ID를 재활성화한다. 현재 분할은 원본을 물리 삭제하고 provenance 일부를 누락한다. | [ExpenseSplitModal](../../../../../../web/src/components/expense/ExpenseSplitModal.tsx), [expenseService](../../../../../../web/src/lib/expenseService.ts), [DEC-041](../../../../governance/decisions.md#dec-041) | U, I, E2E |
| SPL-002 | 현재 명세 | 월 분할은 2개월 이상을 입력받아 원 거래일부터 월 단위 거래를 만들고 가맹점에 순번/전체를 표시한다. | 29~31일은 대상 월 말일로 보정한다. | [splitMonths](../../../../../../web/src/lib/utils/splitMonths.ts), [monthlySplitDate](../../../../../../web/src/lib/utils/monthlySplitDate.ts) | U, I, E2E |
| SPL-003 | 결함 | 월 분할 항목은 그룹 ID, 순번, 전체 개월 수로 연결하고 원본 거래는 `superseded`로 보존해 그룹 전체를 같은 원본으로 원복할 수 있다. | immutable capture lineage와 source·origin·creator·카드 증거는 `LED-009`에 따라 보존한다. 결제 취소는 원본과 그룹 전체를 삭제한다. 현재 복원은 분할 항목에서 새 거래를 추정 생성하여 원본 ID와 provenance 일부를 잃는다. | [expenseService](../../../../../../web/src/lib/expenseService.ts), [DEC-041](../../../../governance/decisions.md#dec-041) | U, I, E2E |
| SPL-004 | 현재 명세 | 월 분할 그룹의 개월 수를 변경하면 기존 그룹을 새 그룹으로 재구성한다. | UI는 2개월 이상을 검증하지만 서비스 경계에는 같은 검증이 없다. | [expenseService](../../../../../../web/src/lib/expenseService.ts) | U, I |
| SPL-005 | 현재 명세 | 월 분할의 각 항목 금액은 원금을 개월 수로 나눈 값을 내림해 동일하게 저장한다. | 나머지 0~개월 수-1원은 의미 없는 오차로 보고 의도적으로 반영하지 않으므로 분할 합계가 원금보다 작을 수 있다. DEC-001에서 현 로직 유지를 확정했다. | [monthlySplitActions](../../../../../../web/src/lib/utils/monthlySplitActions.ts), [expenseService](../../../../../../web/src/lib/expenseService.ts) | U, I |
| SPL-006 | 결함 | 신규 거래를 바로 월 분할해도 사용자가 입력한 memo, 수동 카드 메타데이터, createdBy와 합계 보존 규칙을 유지해야 한다. | 현재 경로는 time 09:00, cardType main으로 저장하고 memo·createdBy를 누락하며 순차 쓰기한다. | [LedgerPage](../../../../../../web/src/components/home/LedgerPage.tsx) | U, I, E2E |
| MRG-001 | 결함 | 같은 목록의 서로 다른 지출을 대상 거래로 합치고 대상의 표시 정보를 유지하며 금액을 합산하되 모든 원본은 `superseded`로 보존한다. | 원본별 표시 정보와 immutable capture lineage를 보관하고, 동시 변경은 `LED-008`의 version map으로 충돌 처리한다. 이미 합쳐진 입력은 DEC-056에 따라 merge가 아닌 leaf 원본까지 평탄화하며 겹치는 leaf·순환·불완전 snapshot은 전체 거부한다. 한 lineage가 취소되면 합친 파생 거래를 제거하고 취소되지 않은 leaf 원본을 복원한다. 현재는 source 문서 물리 삭제, client 값 기반 lost update와 lineage 누락이 가능하다. | [useDragAndDrop](../../../../../../web/src/components/expense/hooks/useDragAndDrop.ts), [expenseService](../../../../../../web/src/lib/expenseService.ts), [DEC-041](../../../../governance/decisions.md#dec-041), [DEC-056](../../../../governance/decisions.md#dec-056) | U, I, E2E |
| MRG-002 | 결함 | 합친 거래를 원본 목록으로 되돌릴 때 보존된 원본 ID를 재활성화하고 가맹점·금액·카테고리·메모는 원본별 값으로, 날짜·시각·거래 유형·표시 카드 정보는 합친 거래의 값을 공통 적용하되 immutable capture lineage는 원본별로 보존한다. | 원본의 개별 표시 날짜·시각·카드 snapshot은 복원하지 않는 의도된 정책이지만 숨은 capture evidence까지 덮어쓰지 않는다. 현재 legacy `mergedFrom`에는 원본 ID와 lineage가 없다. | [expenseService](../../../../../../web/src/lib/expenseService.ts), [DEC-010](../../../../governance/decisions.md#dec-010), [DEC-041](../../../../governance/decisions.md#dec-041) | I, E2E |

### 검색

| ID | 상태 | 요구사항 | 경계·예외 | 근거 | 테스트 |
|---|---|---|---|---|---|
| SEA-001 | 현재 명세 | 같은 가구·거래 유형에서 가맹점, 메모, 카드 정보로 검색하고 최신 날짜순으로 반환한다. | 빈 검색어는 빈 결과를 반환한다. | [expenseService](../../../../../../web/src/lib/expenseService.ts) | U, I, E2E |
| SEA-002 | 현재 명세 | 지원하는 모든 카드사·결제수단에 대해 거래 생성 당시 보존한 표준 라벨·카드 유형·마지막 네 자리 증거를 검색 대상으로 포함한다. 카드사명·별칭·끝 네 자리 단독 검색, `카드사(4자리)` 형식과 x·별표 마스킹 검색을 지원한다. | 특정 카드사를 하드코딩하지 않는다. `국민카드(2972)`는 카드사와 네 자리가 모두 일치해야 하고, `삼성카드(3***)`는 카드사와 번호 패턴이 모두 일치해야 한다. 이후 카드 설정의 끝 번호 수정·퇴역은 과거 거래의 검색 증거를 바꾸지 않는다. | [expenseService](../../../../../../web/src/lib/expenseService.ts), [DEC-059](../../../../governance/decisions.md#dec-059) | U |
| SEA-003 | 결함 | 검색 화면은 `Actor session generation + householdId + transactionType + normalized query + request revision`이 현재 값과 일치하는 최신 응답만 표시하고, cursor와 page limit으로 결과를 제한한다. | 검색어·유형 변경, 닫기, logout·가구 변경 뒤 도착한 응답은 폐기한다. 검색 결과에서 mutation 후에는 Command 성공을 기다린 뒤 새 revision으로 재조회한다. | [SearchModal](../../../../../../web/src/components/search/SearchModal.tsx), [expenseService](../../../../../../web/src/lib/expenseService.ts) | U, C, UI, E2E |
| SEA-004 | 현재 명세·목표 보완 | 검색 결과의 전체 건수·금액과 월별 건수·금액을 표시한다. 목표 Query가 page를 반환하더라도 합계는 현재 page만이 아니라 동일한 가구·거래 유형·검색어·기간에 일치하는 전체 결과를 기준으로 계산한다. | 검색 원천 실패·안전 조회 한도 초과·source window 변경은 부분 합계를 성공으로 표시하지 않고 typed failure로 반환한다. 이 합계는 별도 카드별 통계 화면이 아니라 사용자가 입력한 검색 조건의 결과 요약이다. | [SearchResultList](../../../../../../web/src/components/search/SearchResultList.tsx) | U, C, I, UI |

## 6. 모듈 결함

- Web·Android 일부 분할은 원본을 먼저 삭제하고 새 문서를 순차 생성해 부분 성공할 수 있습니다.
- 신규 월 분할은 `memo`, 수동 카드 메타데이터, `createdBy`를 잃고 `09:00`, `main`으로 저장합니다.
- 월 분할 서비스 경계가 2개월 이상 조건을 강제하지 않습니다.
- 수동 거래 생성 경로 간 `createdBy` 저장 여부가 다릅니다.
- 여러 입력 채널이 `expenses`를 직접 써 공통 불변식과 오류 계약이 우회됩니다.
- 조회 실패를 빈 목록이나 0으로 바꾸는 경로가 데이터 없음과 장애를 구분하지 못합니다.
- 저장·삭제 실패에도 성공 UI 이벤트가 발생할 수 있습니다.
- split·merge·group 재구성 일부가 최신 원장을 transaction 안에서 다시 읽지 않거나 여러 create 후 원본을 삭제해 동시 수정과 중간 실패에 취약합니다. (`LED-008`)
- item/monthly split과 취소·재구성이 creator/source/origin/cardLastFour 같은 원본 provenance를 누락하고 capture dedup lineage를 명시적으로 보존하지 않습니다. (`LED-009`)
- 검색 요청을 취소하거나 request revision을 검사하지 않아 이전 검색·이전 세션의 늦은 응답이 최신 결과를 덮을 수 있습니다. (`SEA-003`)

DEC-001의 의도적인 월 분할 나머지 미반영은 결함이 아닙니다.

## 7. 관련 DEC 링크

- [DEC-001: 월 분할 내림·나머지 미반영 정책](../../../../governance/decisions.md#dec-001) — `SPL-005`에 확정 반영되었습니다.
- [DEC-010: 합치기 해제 시 원본 복원 범위](../../../../governance/decisions.md#dec-010) — 원본별 표시 필드와 합친 거래의 공통 날짜·시각·카드 적용을 확정합니다.
- [DEC-013: 거래 생성자와 채널별 알림 정책](../../../../governance/decisions.md#dec-013) — 모든 거래의 필수 `creatorMemberId`·`source`·`originChannel`을 보존하고 수신자 선택은 Notifications에 위임합니다.
- [DEC-022: 단일 partner 개념 제거](../../../../governance/decisions.md#dec-022) — Ledger는 requester 사실만 저장하고 partner·수신자 목록을 저장하지 않습니다.
- [DEC-041: 결제 취소 시 원본과 모든 파생 지출 자동 삭제](../../../../governance/decisions.md#dec-041) — 구조 변경 원본은 취소 전까지 superseded로 보존하고 완전 일치 취소 시 대상 lineage 전체를 원자 삭제하며 다른 lineage는 복원합니다.
- [DEC-056: 재병합 merge 계보 평탄화](../../../../governance/decisions.md#dec-056) — merge ancestry는 non-merge leaf 원본까지 펼치고 중간 merge node는 감사 이력으로만 보존합니다.
- [DEC-057: 선택 지역화폐 상세 범위](../../../../governance/decisions.md#dec-057) — 홈 카드가 선택한 한 유형만 상세 조회하고 별도 전환 UI와 legacy 임의 귀속을 두지 않습니다.
- [DEC-065: 일반 거래 논리 삭제와 운영 정리](../../../../governance/decisions.md#dec-065) — 일반 삭제는 복구 가능한 `deleted` 전이이며 정상 조회에서 즉시 제외하고, 자동 영구 삭제와 일반 사용자 복구를 두지 않습니다.

## 8. 모듈 테스트 시나리오

| 테스트 ID | 종류 | Given / When / Then | 연결 요구사항 |
|---|---|---|---|
| T-LED-001 | 호환·현재 명세 | transactionType 없는 기존 문서, 월·양끝 포함 기간, 같은 시각 여러 ID, active 외 상태, NoData·원천 실패 / 지출 조회 / legacy 지출 포함, 가구·유형·상태 범위와 결정적 내림차순을 지키며 실패를 빈 결과로 축약하지 않음 | LED-001, SYS-002 |
| T-LED-002 | 목표 | split·reconfigure·collapse·merge·unmerge·capture cancel의 권한 없음·타 가구·대상 누락·version 불일치·UoW 실패와 같은 target의 Update·Split 경합 / 실행 / typed Forbidden·NotFound·Conflict·RetryableFailure, 본문·claim·receipt·Event write 0건, 먼저 commit한 하나만 성공 | LED-005, LED-008, DEC-055 |
| T-LED-003 | 목표 | captured 거래의 item/monthly split·merge·unmerge, 월 분할 원본·그룹 취소, 같은 capture 재수집·원복·취소 replay / 구조 변경·취소 / 원본 ID와 증거는 superseded 보존·같은 ID 원복, 취소 시 대상 lineage 원본·파생 전체 삭제·다른 lineage 복원·claim cancelled·dedup tombstone과 Event 한 건 유지 | LED-009, SPL-003, DEC-041 |
| T-LED-004 | 목표 | 검증된 지역화폐 capture type 있음·없음, 수동 type 위조, 일반 필드 수정·type 변경/제거, 경기·대전·legacy 거래와 typed/untyped merge / 생성·수정·상세 조회·구조 변경 / 검증 type만 생성, immutable 유지, 선택 type만 표시, split 보존, 모호한 merge와 type 변경 write 0건 | LED-010, LED-009, DEC-057 |
| T-LED-005 | 목표 | 정상 수동 지출과 공백 가맹점·0/음수/소수 금액·비활성 카테고리 / 생성 / 정상 입력만 한 거래와 Event를 만들고 잘못된 입력은 write 0건 | LED-002, SYS-004 |
| T-LED-006 | 목표 | 정상·빈 수입 항목명과 양의·잘못된 금액 / 수입 생성 / 정상 입력은 merchant=수입·category=etc·memo=항목명으로 정규화하고 잘못된 입력은 write 0건 | LED-003, SYS-004 |
| T-LED-007 | 목표 | 회계일과 다른 FixedClock 시각, 인증된 Actor / 수동 거래 생성 / localTime=현재 HH:mm, manual 카드 metadata와 creatorMemberId를 서버에서 저장 | LED-004, SYS-005 |
| T-LED-008 | 목표 | 모든 허용 필드 정상 patch와 active 거래 delete, 대상 없음·타 가구·0원·stale version·이미 deleted·저장 실패 / Update·Delete / 정상 삭제는 본문·provenance를 유지한 deleted 상태·deletedAt·version·Event를 확정하고 즉시 목록·검색·집계에서 사라지며, 나머지는 NotFound·Conflict·ValidationError·RetryableFailure와 write 0건 | LED-001, LED-005, SYS-007, DEC-065 |
| T-LED-009 | 목표 | 여러 날짜·월·연·카테고리의 active/inactive 거래와 원천 실패 / 합계 조회 / 선택 범위 목록·월·연·카테고리 합계가 일치하고 실패를 0원 성공으로 축약하지 않음 | LED-006 |
| T-LED-010 | 목표 | expense·income, 인증 requester와 creator 동일·상이, 중복 key / 알림 요청 / expense에 requester·시각과 Event를 한 번 기록하고 income은 거부하며 실제 대상·전달 결과는 저장 성공과 분리 | LED-007, DEC-013, DEC-022 |
| T-SPL-001 | 특성화 | 10,000원과 3개월 / 월 분할 / 각 3,333원이고 합계 9,999원으로 나머지 1원 미반영 | SPL-002, SPL-005, DEC-001 |
| T-SPL-002 | 특성화 | 1월 31일 거래 / 3개월 분할 / 2월 말일, 3월 31일로 보정 | SPL-002 |
| T-SPL-003 | 목표 | 항목 1개·0원·합계 불일치, 정상 항목별 표시값, 저장 실패, 성공 뒤 원복 / 항목 분할·복원 / 잘못된 입력과 실패는 원본·claim 유지, 성공은 원본 superseded·파생 active와 불변 증거 보존, 원복은 파생 제거·같은 원본 ID와 전체 필드 재활성화 | SPL-001, LED-008, LED-009, SYS-007 |
| T-SPL-004 | 목표 | 원본과 월 분할 그룹, 한 항목 version 경합, captured 월 그룹 취소 / collapse·lineage cancel / collapse는 파생 제거·같은 원본 ID 재활성화, 취소는 원본·그룹 전체 삭제와 claim cancelled, 경합 시 그룹 전체 유지 | SPL-003, LED-008, LED-009, DEC-041 |
| T-SPL-005 | 목표 | 월 분할 그룹의 1개월·새 유효 개월 수·전체 원본/파생 필드와 stale version / 재구성 / 1개월 거부, 기존 그룹 superseded·원본 superseded 유지, 새 active 그룹은 날짜·순번 외 source·origin·creator·카드·lineage·지역화폐 type 보존, stale이면 전체 유지 | SPL-004, LED-008, LED-009, LED-010 |
| T-SPL-006 | 목표 | memo·manual 카드·creator가 있는 신규 수동 지출과 UoW 중간 실패 / 즉시 월 분할 / 모든 항목이 입력 metadata와 내림 금액을 유지하고 실패 시 아무 항목도 생성하지 않음 | SPL-006, SPL-005, SYS-007 |
| T-MRG-001 | 목표 | 대상·source 전체 표시/capture 필드와 version map, `A+B=M` 뒤 `M+C`, leaf overlap·cycle·불완전 snapshot·UoW 실패 / 합치기 / 대상 표시·금액 합산, leaf별 전체 복원 snapshot과 lineage 평탄 보존, graph/contract/UoW 오류는 전체 rollback | MRG-001, LED-008, LED-009, DEC-056 |
| T-MRG-002 | 목표 | 날짜·시각·카드가 다른 leaf 전체 필드와 정상·ID/lineage 없는 legacy snapshot / 합치기 해제 / 같은 leaf ID, 원본별 merchant·amount·category·memo·capture evidence와 합친 거래의 공통 날짜·시각·유형·표시 카드 적용, 불완전 legacy는 ContractFailure·무변경 | MRG-002, LED-009, DEC-010, DEC-056 |
| T-SEA-001 | 현재 명세 | 대소문자·공백이 다른 가맹점, 메모, 설정 기반 모든 카드사 별칭·유형·끝 네 자리·정확/별표/x 마스킹, 빈 query, 기간 양끝, 타 가구·유형·상태 / 검색 / 같은 범위 일치만 날짜·시각·ID 최신순, 빈 query는 NoData, 카드사+번호 조건은 모두 일치 | SEA-001, SEA-002 |
| T-SEA-002 | 목표 | limit·opaque cursor 두 page와 scope 변경, 느린 A→빠른 B, modal close·logout, 검색 결과 mutation 실패·성공 / paging·응답 처리 / 중복·누락 없는 bounded page, 다른 scope cursor 거부, 최신 revision만 표시, Command 성공 뒤 새 revision 재조회 | SEA-003 |
| T-SEA-003 | 현재 명세·목표 | `삼성카드(3***)`에 여러 월의 일치·불일치 거래와 여러 page가 존재 / 검색 / 카드사·마스킹 번호가 모두 일치한 전체 결과의 총 건수·금액과 월별 건수·금액을 반환하고 현재 page 부분 합계를 전체 합계로 표시하지 않음 | SEA-002, SEA-004 |

## 9. 코드 근거

### Web

- [거래 서비스](../../../../../../web/src/lib/expenseService.ts)
- [거래 폼 규칙](../../../../../../web/src/lib/utils/expenseForm.ts)
- [거래 표시 규칙](../../../../../../web/src/lib/utils/ledgerDisplay.ts)
- [월 분할 동작](../../../../../../web/src/lib/utils/monthlySplitActions.ts)
- [월 분할 날짜](../../../../../../web/src/lib/utils/monthlySplitDate.ts)
- [월 분할 계산](../../../../../../web/src/lib/utils/splitMonths.ts)
- [원장 화면](../../../../../../web/src/components/home/LedgerPage.tsx)
- [거래 추가 화면](../../../../../../web/src/components/expense/AddExpenseModal.tsx)
- [항목 분할 화면](../../../../../../web/src/components/expense/ExpenseSplitModal.tsx)
- [합치기 상호작용](../../../../../../web/src/components/expense/hooks/useDragAndDrop.ts)
- [레거시 알림 요청 서비스](../../../../../../web/src/lib/partnerNotificationService.ts)

### Android·Functions

- [Android 원장 Command Client](../../../../../../android/app/src/main/java/com/household/account/ledger/HouseholdCommandClient.kt)
- [Functions 원장 Command 입력](../../../../../../functions/src/bootstrap/commands/ledgerHouseholdCommandHandlers.ts)
- [Functions 알림 Outbox consumer](../../../../../../functions/src/bootstrap/firebaseNotificationOutbox.ts)
