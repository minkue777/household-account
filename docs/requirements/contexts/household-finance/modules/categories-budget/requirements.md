# 카테고리·예산 모듈 요구사항

> 상위 Bounded Context: [Household Finance](../../requirements.md)  
> 아키텍처 역할: Command Domain / Query Calculation  
> 상세 설계: [모듈 상세 설계](design.md)  
> 상태와 테스트 수준의 의미는 [공통 규약](../../../../governance/conventions.md)을 따릅니다.  
> 이 문서는 `CAT-*`, `BUD-*` 요구사항의 단일 소유 문서입니다.

## 1. 독립 모듈 책임

카테고리·예산 모듈은 가구가 거래를 분류하는 기준과 월 예산 정책을 소유합니다. 카테고리 초기화·추가·수정·삭제·정렬·활성화, 가구 기본 카테고리 선택, 카테고리별 지출과 예산 진행률 계산을 담당합니다.

이 모듈이 보장할 핵심 불변식은 다음과 같습니다.

- 카테고리 키는 가구 안에서 거래와 자동 분류가 참조할 수 있는 안정적인 식별자입니다.
- 예산 미설정은 `null`이며, 유효한 예산은 음수가 아닌 원 단위 값입니다.
- 기본 카테고리와 거래가 참조 중인 카테고리를 삭제할 때 참조 정책을 먼저 적용합니다.
- 카테고리별 사용액은 원장 조회 결과로 계산하며 원장 문서를 직접 수정하지 않습니다.
- 데이터 없음과 Repository 조회 실패를 구분합니다.

## 2. 포함·제외 범위

### 포함

- 기본 다섯 카테고리 초기화
- 카테고리 이름·색상·활성 상태·순서 관리
- 카테고리별 월 예산 설정
- 가구 기본 카테고리 선택 계약
- 카테고리별 사용액·예산 비율·초과액 계산
- 활성 예산 카테고리를 기준으로 한 월 잔여 예산 계산
- Android 카테고리 조회용 공개 계약

### 제외

- 거래 생성·수정과 원장 합계 저장
- 가맹점 자동 매칭 규칙
- 정기지출 일정과 생성
- 홈 화면 배치와 시각 표현
- 자산 예산과 지역화폐 잔액

## 3. 소유 데이터

| 데이터 | 소유 범위 | 비고 |
|---|---|---|
| `categories` | 키, 이름, 색상, 월 예산, 순서, 기본 여부, 활성 여부 | 가구 범위 Aggregate입니다. |
| 기본 카테고리 정의 | `living`, `childcare`, `fixed`, `food`, `etc`의 초기 이름·색상·순서 | 최초 초기화 정책입니다. |
| 가구 기본 카테고리 참조 | `household.defaultCategoryKey`의 유효성 정책 | 물리 필드는 `households`에 있으므로 가구 모듈 Port를 통해 변경합니다. |
| 예산 조회 모델 | 카테고리별 사용액·비율·초과액, 월 잔여 예산 | [거래 원장 모듈](../ledger/requirements.md)의 조회 결과에서 계산합니다. |

거래의 `category` 값과 가맹점 규칙의 category mapping은 이 모듈의 식별자를 참조하지만 해당 문서는 각 소유 모듈이 관리합니다.

## 4. 공개 계약·의존 모듈

### 외부에 제공하는 계약

| 계약 | 입력 | 결과 |
|---|---|---|
| `InitializeDefaultCategories` | 가구 ID | 기본 카테고리 집합 또는 이미 초기화됨 |
| `ListActiveCategories` | 가구 ID | 순서대로 정렬된 활성 카테고리 |
| `UpdateCategoryCatalog` | create·update·archive·reorder operation과 expected version | 갱신된 카탈로그 또는 재개 가능한 archive process |
| `ContinueCategoryArchiveProcess` | process ID와 page cursor·limit | 소비 모듈별 참조 변경 checkpoint와 완료 상태 |
| `SetDefaultCategory` | 가구 ID, 카테고리 키 | 가구 기본 카테고리 참조 |
| `GetCategoryReference` | 카테고리 ID와 사용 목적 | 안정 ID와 활성·사용 가능 상태 |
| `GetMonthlyBudget` | 대상 월 | 모든 원장 page를 반영한 사용액·비율·초과액·잔여 예산 |
| `GetBudgetStatus` | 대상 월과 선택 카테고리 | 카테고리 또는 월 예산 상태 |

### 의존 모듈·포트

- [가구·접근 모듈](../../../access-household/modules/household-access/requirements.md): 가구 범위와 기본 카테고리 참조 저장 Port를 제공합니다.
- [거래 원장 모듈](../ledger/requirements.md): 기간·카테고리별 지출 조회 모델을 제공합니다.
- [결제 설정 모듈](../../../payment-capture/modules/payment-configuration/requirements.md): 가맹점 mapping이 참조할 카테고리 유효성을 확인합니다.
- [Android 결제 수집 모듈](../../../payment-capture/modules/android-payment-ingestion/requirements.md): 자동 등록 시 활성·기본 카테고리를 조회합니다.
- [정기 거래 모듈](../recurring-transactions/requirements.md): 정기지출 정의가 참조할 카테고리를 검증합니다.

## 5. 요구사항

| ID | 상태 | 요구사항 | 경계·예외 | 근거 | 테스트 |
|---|---|---|---|---|---|
| CAT-001 | 현재 명세 | 가구에 카테고리가 하나도 없으면 생활비, 육아비, 고정비, 식비, 기타를 초기화한다. | 일부만 있으면 누락 기본값은 자동 보충하지 않는다. | [categoryService](../../../../../../web/src/lib/categoryService.ts) | I |
| CAT-002 | 목표 명세 | 카테고리의 이름, 색상, 월 예산을 추가·수정하고 순서를 저장하며, 삭제 요청은 과거 참조를 보존하는 archive로 처리한다. | 예산 미입력은 null이고 음수·NaN은 거부한다. 과거 거래의 categoryId와 표시 정보는 변경하지 않는다. 설정 참조는 현재 기본 카테고리로 변경하고 archived 카테고리를 신규 선택 목록에서 제외한다. 재활성화와 hard delete는 제공하지 않는다. | [CategorySettings](../../../../../../web/src/components/settings/CategorySettings.tsx), [categoryService](../../../../../../web/src/lib/categoryService.ts), [DEC-015](../../../../governance/decisions.md#dec-015) | U, I, E2E |
| CAT-003 | 목표 명세 | 가구 기본 카테고리를 설정할 수 있으며 현재 기본 카테고리는 삭제하거나 archive할 수 없다. | 기본 카테고리는 항상 active여야 한다. Web 수동 등록 폼도 이를 사용하며, 다른 카테고리 archive 시 정기지출·가맹점 규칙의 참조를 이 카테고리로 변경한다. | [CategorySettings](../../../../../../web/src/components/settings/CategorySettings.tsx), [expenseForm](../../../../../../web/src/lib/utils/expenseForm.ts), [DEC-015](../../../../governance/decisions.md#dec-015) | U, I, E2E |
| CAT-004 | 특성화·목표 교정 | Legacy Android QuickEdit Adapter는 활성 카테고리 조회가 실패하거나 비면 표시 전용 기본 다섯 카테고리로 fallback하는 현재 동작을 배포 호환 기간에 특성화한다. 목표 `ListActiveCategories` 공개 Query는 `NoData`와 `RetryableFailure`를 구분하며 기본 카테고리를 임의 생성하거나 성공으로 위장하지 않는다. | fallback은 Legacy Adapter 밖으로 전파하지 않고 QuickEdit이 목표 Query로 전환되면 제거한다. 두 경계의 결과를 같은 테스트로 혼동하지 않는다. | [QuickEditActivity](../../../../../../android/app/src/main/java/com/household/account/QuickEditActivity.kt) | U, UI, I |
| BUD-001 | 현재 명세 | 카테고리별 사용액, 예산 비율, 초과액을 표시한다. | 예산이 null 또는 0 이하이면 진행률을 표시하지 않는다. | [CategorySummary](../../../../../../web/src/components/CategorySummary.tsx) | U, UI |
| BUD-002 | 현재 명세 | 월 잔여 예산은 예산이 있는 활성 카테고리 예산 합계에서 해당 카테고리 지출만 차감한다. | 예산 없는 카테고리 지출도 월 지출 총액에는 포함한다. | [BalanceCards](../../../../../../web/src/components/BalanceCards.tsx) | U |

예산 조회는 [DEC-048](../../../../governance/decisions.md#dec-048)에 따라 별도 월별 Projection을 저장하지 않습니다. 요청한 월의 Ledger 거래를 서버 날짜 범위와 내부 cursor로 모두 조회한 뒤 계산하며, 조회를 완성하지 못한 경우 부분 합계나 0원을 성공으로 반환하지 않습니다.

## 6. 모듈 결함

- 카테고리 예산에 음수·`NaN`을 저장할 수 있는 경로가 있습니다.
- 현재 카테고리 hard delete는 기존 거래의 분류 표시를 잃게 하고 `household.defaultCategoryKey` 같은 활성 참조를 깨뜨릴 수 있습니다.
- 기본 카테고리 삭제 금지를 UI 설명에만 두고 서비스 경계에서 강제하지 않습니다.
- 기본 카테고리 초기화가 check-then-write라 동시 요청에서 중복 문서를 만들 수 있습니다.
- 일부 카테고리만 있는 경우 누락된 기본값을 자동 보충하지 않습니다. 이는 현재 명세지만 마이그레이션 정책이 필요할 수 있습니다.
- Web 수동 거래는 가구 기본 카테고리를 사용하지 않지만 Android 자동 거래는 사용합니다.
- Android QuickEdit은 조회 실패와 실제 빈 카테고리를 같은 기본 다섯 항목으로 표시합니다.
- 구독 오류를 빈 목록으로 바꾸는 경로가 데이터 없음과 장애를 구분하지 못합니다.

## 7. 관련 DEC 링크

- [DEC-015: 사용 중인 카테고리 삭제](../../../../governance/decisions.md#dec-015) — 과거 참조는 보존하고, 설정 참조는 현재 기본 카테고리로 변경하며, 기본 카테고리 자체는 archive하지 않습니다.
- [DEC-048: 조회 시 예산 계산](../../../../governance/decisions.md#dec-048) — 월 예산은 영속 Projection 없이 요청 월의 Canonical 거래를 모두 조회한 뒤 계산합니다.

## 8. 모듈 테스트 시나리오

| 테스트 ID | 종류 | Given / When / Then | 연결 요구사항 |
|---|---|---|---|
| T-CAT-001 | 현재 명세 | 카테고리가 없는 가구 / 초기화 / 기본 다섯 카테고리가 지정 순서로 한 번만 생성 | CAT-001 |
| T-CAT-002 | 목표 | 같은 빈 가구에 초기화 명령 두 번 동시 실행 / 처리 / 기본 키마다 문서 한 개 | CAT-001 |
| T-CAT-003 | 목표 | 음수·NaN 예산 / 생성 또는 수정 / 검증 오류이며 저장 없음 | CAT-002 |
| T-CAT-004 | 목표 | 기본 카테고리, 다른 카테고리의 과거 거래·정기지출·가맹점 규칙 참조 / archive / 기본은 Conflict, 다른 카테고리는 과거 거래 유지·설정 참조를 기본값으로 변경 후 보관 | CAT-002, CAT-003, REC-005, DEC-015 |
| T-CAT-005 | 특성화 | 정상 활성 목록과 legacy 조회의 빈 값·실패 / Android QuickEdit Legacy Adapter / 정상은 저장 순서·활성 필터 유지, 빈 값·실패는 표시 전용 기본 다섯 개이며 영속 write 없음 | CAT-004 |
| T-CAT-006 | 목표 | Repository 조회 실패 / `ListActiveCategories` / 데이터 없음·기본 다섯 개 성공과 구분되는 오류 상태 | CAT-004 |
| T-BUD-001 | 현재 명세 | 예산 카테고리와 예산 없는 카테고리 지출, 여러 cursor page / 월 계산 / 모든 page를 반영해 잔여 예산에는 전자만 차감하고 총지출에는 모두 포함하며 조회 실패를 0원으로 바꾸지 않음 | BUD-001, BUD-002, DEC-048 |

## 9. 코드 근거

### Web

- [카테고리 서비스](../../../../../../web/src/lib/categoryService.ts)
- [카테고리 설정](../../../../../../web/src/components/settings/CategorySettings.tsx)
- [카테고리 요약](../../../../../../web/src/components/CategorySummary.tsx)
- [예산·잔액 카드](../../../../../../web/src/components/BalanceCards.tsx)
- [거래 폼 규칙](../../../../../../web/src/lib/utils/expenseForm.ts)

### Android

- [카테고리 Repository](../../../../../../android/app/src/main/java/com/household/account/data/CategoryRepository.kt)
- [QuickEdit](../../../../../../android/app/src/main/java/com/household/account/QuickEditActivity.kt)
