# 홈·환경설정 모듈 요구사항

> 상위 Bounded Context: 없음 — [지원·읽기·플랫폼 영역](../../requirements.md)  
> 아키텍처 역할: Read Composition / Preferences  
> 상세 설계: [모듈 상세 설계](design.md)  
> 상태와 테스트 표기 규칙은 [공통 요구사항 규약](../../../governance/conventions.md)을 따릅니다.  
> 이 문서는 `HOME-*`, `THEME-*` 요구사항의 단일 소유 문서입니다.

## 1. 독립 모듈 책임

홈·환경설정 모듈은 홈 요약 카드의 구성, 홈에 표시할 지역화폐 유형, 사용자 테마 선택을 읽고 적용합니다. 지역화폐·예산·거래의 원천 데이터는 각 기능 모듈에서 조회하며, 이 모듈은 선택 상태와 카드 두 개의 조회 모델 및 시각적 환경설정만 소유합니다.

테마는 CSS 변수와 저장 Adapter 뒤에 격리하여 거래·자산 업무 규칙에 영향을 주지 않습니다.

## 2. 포함/제외 범위

### 포함

- 가구에 저장된 홈 카드 구성 또는 기본 구성 복원
- 지역화폐, 월 잔여 예산, 월 지출, 연 지출 중 두 카드의 조회 모델
- 보유 지역화폐 목록에서 홈 잔액 카드에 표시할 유형 선택·저장
- 목표 설정 화면에서 서로 다른 왼쪽·오른쪽 홈 카드 유형을 가구 공통 구성으로 저장
- 월·연 수입 합계 계산
- `default`, `warm`, `forest`, `ocean`, `mono` 테마 선택과 복원
- 잘못된 테마 저장값 무시와 CSS 변수 적용

### 제외

- 지역화폐 잔액의 수집·수정
- 예산과 거래의 저장·집계 규칙
- 가구 생성·멤버·인증 관리
- 일반 지출·자산 통계: [통계 모듈](../reporting/requirements.md)
- 테마 외의 개인별 카드 배치 설정. 목표 홈 카드 구성은 개인별이 아니라 HOME-004의 가구 공통 설정입니다.

## 3. 소유 데이터

| 데이터 | 소유권과 불변식 |
|---|---|
| 가구 홈 카드 구성 | `households` 문서의 홈 요약 설정을 논리적으로 소유하지만, 물리 저장은 가구 Repository 계약을 사용합니다. 현재 구현은 읽기만 하며 목표 HOME-004는 expectedVersion을 가진 저장 Command를 제공합니다. |
| 홈 표시 지역화폐 선택 | 가구 홈 설정의 안정적인 `localCurrencyType` code입니다. 잔액 금액은 소유하지 않으며 임의의 첫 잔액 문서로 대체하지 않습니다. |
| 테마 선택 | 기기 로컬 저장소의 유효한 테마 키를 소유합니다. 허용 목록 밖 값은 상태에 반영하지 않습니다. |
| 홈 요약 조회 모델 | 다른 모듈에서 받은 잔액·예산·거래 합계를 선택된 두 카드에 투영한 파생 데이터입니다. |

## 4. 공개 계약·의존 모듈

### 공개 계약

- `ResolveHomeCardConfiguration(savedConfiguration?)`
- `SelectHomeLocalCurrency(localCurrencyType)`, `ListAvailableLocalCurrencies`
- `BuildHomeSummary(configuration, selectedBalance, budget, expenseTotals, incomeTotals)`
- `LoadThemePreference`, `SetThemePreference`, `ApplyTheme`
- 기본 카드 구성: 왼쪽 지역화폐 잔액, 오른쪽 월 잔여 예산

### 의존 모듈

- 가구 모듈: 홈 카드 구성 조회
- 지역화폐 모듈: 잔액 조회
- 카테고리·예산 모듈: 월 잔여 예산 조회
- 거래 원장 모듈: 월·연 지출과 수입 합계 조회
- 브라우저 저장소·DOM Theme Adapter

## 5. 요구사항

| ID | 상태 | 요구사항 | 경계·예외 | 근거 | 테스트 |
|---|---|---|---|---|---|
| HOME-001 | 현재 명세 | 홈 요약은 가구 문서에 저장된 구성 또는 기본값에 따라 지역화폐, 월 잔여 예산, 월 지출, 연 지출 중 두 항목을 표시한다. | 현재 저장된 구성을 읽지만 이를 변경하는 사용자 UI는 없다. 수입은 월·연 합계를 계산한다. | [BalanceCards](../../../../../web/src/components/BalanceCards.tsx), [household types](../../../../../web/src/types/household.ts) | U, UI |
| HOME-002 | 목표 명세 | 처음 등록된 지역화폐가 하나뿐이고 선택값이 없으면 그 유형을 자동 선택한다. 여러 유형이 있으면 사용자가 홈에 표시할 하나를 선택하고 이후 홈 조회에서 그 선택을 유지한다. 지역화폐 카드 상세 진입에는 카드가 표시하던 선택 유형을 고정해 전달한다. | 선택값은 지원되는 현재 가구의 지역화폐 유형이어야 한다. 다른 유형의 추가·최근 갱신만으로 자동 전환하지 않는다. DEC-057에 따라 상세 화면에는 전체·다른 유형 전환 UI를 두지 않으며 다른 유형은 홈 선택을 먼저 바꾼 뒤 진입한다. | [DEC-008](../../../governance/decisions.md#dec-008), [DEC-057](../../../governance/decisions.md#dec-057), [BalanceCards](../../../../../web/src/components/BalanceCards.tsx) | U, I, UI |
| HOME-003 | 결함 | 각 홈 카드 원천의 유효한 0원, `NoData`, 조회 failure를 보존하고 일부 원천이 실패해도 이를 0원·빈 성공으로 표시하지 않는다. | 홈 요약은 요청 시 Canonical Query 결과로 계산하며 별도 freshness 상태나 영속 Projection을 만들지 않는다. 실패한 카드와 정상 카드를 독립 표시하되 전체 조회의 partial 상태를 명시한다. | [BalanceCards](../../../../../web/src/components/BalanceCards.tsx), [balanceService](../../../../../web/src/lib/balanceService.ts), [expenseService](../../../../../web/src/lib/expenseService.ts), [DEC-048](../../../governance/decisions.md#dec-048) | U, C, UI |
| HOME-004 | 목표 명세 | 설정의 홈 카드 구성 화면에서 모든 활성 가구원이 왼쪽·오른쪽 카드를 지역화폐 잔액·월 잔여 예산·월 지출·연 지출 중 서로 다른 두 유형으로 선택해 가구 공통 설정으로 저장할 수 있다. | 기본값은 왼쪽 지역화폐·오른쪽 월 잔여 예산이다. 같은 유형 두 개, 지원하지 않는 유형, stale version은 write 0건으로 거부한다. 기존에 저장된 중복 구성은 읽기 호환으로 그대로 표시하고 자동 보정하지 않지만, 다음 저장에서는 서로 다른 유형을 필수로 한다. 선택 지역화폐 유형은 별도 설정이며 카드 구성 저장으로 바꾸지 않는다. | [BalanceCards](../../../../../web/src/components/BalanceCards.tsx), [household types](../../../../../web/src/types/household.ts), [DEC-061](../../../governance/decisions.md#dec-061) | U, I, UI |
| THEME-001 | 현재 명세 | default, warm, forest, ocean, mono 테마를 지원하고 유효한 저장값을 복원한다. | 잘못된 저장값은 무시한다. | [ThemeContext](../../../../../web/src/contexts/ThemeContext.tsx) | U, UI |

홈 요약의 초기 왼쪽 카드는 지역화폐 잔액, 오른쪽 카드는 월 잔여 예산입니다.

## 6. 모듈 결함

- 저장된 홈 카드 구성을 읽을 수 있지만 변경 UI가 없는 것은 현재 구현의 제한입니다. 목표 HOME-004·DEC-061에서는 가구 공통 설정 화면과 저장 Command를 명시적으로 추가합니다. (`HOME-001`, `HOME-004`)
- 현재 지역화폐 카드가 여러 유형 중 첫 Firestore 문서를 임의로 표시하며, 표시 유형을 선택·유지할 수 없습니다. (`HOME-002`)
- 지역화폐·거래 원천 실패가 null·빈 배열로 축약되어 유효한 0원 또는 데이터 없음처럼 보일 수 있습니다. (`HOME-003`)

## 7. 관련 DEC

- [DEC-008](../../../governance/decisions.md#dec-008): 유형별 잔액을 독립 보관하고 Home Preferences가 홈 표시 유형 하나를 선택합니다.
- [DEC-048](../../../governance/decisions.md#dec-048): 홈 요약은 영속 Projection 없이 각 원천을 조회해 계산하고 유효한 0원·NoData·실패를 구분합니다.
- [DEC-057](../../../governance/decisions.md#dec-057): 지역화폐 카드 상세에는 현재 선택 type 하나만 전달하고 상세 내부 필터는 제공하지 않습니다.
- [DEC-061](../../../governance/decisions.md#dec-061): 모든 활성 가구원이 홈의 서로 다른 두 카드 유형을 공유 설정으로 변경하며, 기존 중복은 읽기만 호환하고 다음 저장부터 거부합니다.

## 8. 모듈 테스트 시나리오

### Canonical 테스트

| 테스트 ID | 종류 | Given / When / Then | 연결 요구사항 |
|---|---|---|---|
| T-HOME-001 | 목표 | 지역화폐·예산·월 지출 원천별 유효한 0원·NoData·RetryableFailure / 홈 요약 조합 / 카드 상태가 서로 바뀌지 않고 정상 카드는 유지되며 전체 partial 상태가 표시됨 | HOME-003, DEC-048 |
| T-HOME-002 | 목표 | 기본·서로 다른·기존 중복·알 수 없는 카드 구성, 같은 유형 저장, 활성 가구원 두 명의 동일 version 동시 저장, idempotency 동일/상이 payload, removed·비가구원 Actor, 지역화폐 선택값 / 조회·설정 UI·저장 / 기본·기존 중복은 그대로 표시하고 새 중복·unknown·비인가 요청은 write 0건, 서로 다른 유형은 receipt·Event와 한 번 저장, replay는 최초 결과를 반환하고 상이 payload는 Conflict, 동시 요청은 하나만 성공, 카드 구성 저장 뒤 지역화폐 선택값 불변 | HOME-001, HOME-004, DEC-061 |
| T-HOME-003 | 목표 | 저장 없음·유효 저장·legacy·알 수 없는 구성, 카드 원천 성공·실패와 월·연 수입 / 홈 요약 조회 / 기본 또는 저장된 카드 2개와 순서, 수입 합계, typed partial 상태를 보존 | HOME-001, HOME-003 |
| T-HOME-004 | 목표 | 첫 단일 유형·처음부터 복수 유형·유효/미보유 선택·최근 갱신·stale version·카드 클릭 / 지역화폐 선택·상세 진입 / 단일 유형만 자동 선택하고 기존 선택을 유지하며 미보유·경합은 write 0건, 상세 진입 intent에는 선택 type 하나와 내부 전환 불가 capability만 전달 | HOME-002, DEC-057 |
| T-THEME-001 | 목표 | 5개 유효 값·unknown·storage 읽기/쓰기 실패·DOM 실패·SSR hydration / 테마 복원·변경 / deterministic default와 유효 테마만 적용하며 unknown은 다시 저장하지 않고 DOM 성공 뒤에만 저장 | THEME-001 |

### 상세 시나리오

| 시나리오 | 수준 | 연결 요구사항 |
|---|---|---|
| 저장 구성이 없으면 왼쪽에 지역화폐, 오른쪽에 월 잔여 예산 카드를 표시한다. | U, UI | HOME-001 |
| 유효한 저장 구성이 있으면 지정된 두 카드와 월·연 수입 합계를 표시한다. | U, UI | HOME-001 |
| 홈 카드가 받는 원천 조회 하나가 실패하면 0원으로 위장하지 않고 실패 카드와 정상 카드를 독립 표시하며 partial 상태를 남긴다. | U, UI | HOME-003 |
| 경기·대전 잔액 중 대전을 선택하면 이후 경기 잔액이 갱신되어도 홈에는 대전 잔액을 표시한다. | U, I, UI | HOME-002 |
| 선택값 없이 첫 지역화폐 하나가 등록되면 해당 유형을 자동 선택하고, 두 번째 유형이 추가되어도 선택을 유지한다. | U, I, UI | HOME-002 |
| 현재 가구에 없는 지역화폐 유형을 선택하면 저장을 거부하고 기존 선택을 유지한다. | U, I | HOME-002 |
| 경기지역화폐가 선택된 카드를 누르면 상세 진입 intent에 경기 type만 고정 전달하고 상세 화면에 전체·다른 type 선택 capability를 제공하지 않는다. | U, UI | HOME-002, DEC-057 |
| 활성 가구원이 설정에서 왼쪽 월 지출·오른쪽 연 지출을 선택하면 두 유형이 공유 설정으로 저장되고 다른 가구원의 홈에도 같은 순서로 표시된다. | U, I, UI | HOME-004, DEC-061 |
| 같은 유형을 양쪽에 선택하거나 기존 중복 구성을 그대로 다시 저장하면 저장을 거부하고 기존 configuration과 지역화폐 선택을 유지한다. | U, I, UI | HOME-004, DEC-061 |
| 허용된 다섯 테마는 저장·복원되고 해당 CSS 변수를 적용한다. | U, UI | THEME-001 |
| 알 수 없는 저장값은 무시하고 기본 테마를 유지한다. | U, UI | THEME-001 |

## 9. 코드 근거

- [홈 요약 카드](../../../../../web/src/components/BalanceCards.tsx)
- [가구 홈 설정 타입](../../../../../web/src/types/household.ts)
- [테마 Context](../../../../../web/src/contexts/ThemeContext.tsx)
- [지역화폐 서비스](../../../../../web/src/lib/balanceService.ts)
- [카테고리·예산 서비스](../../../../../web/src/lib/categoryService.ts)
- [거래 서비스](../../../../../web/src/lib/expenseService.ts)
