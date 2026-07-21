# 홈·환경설정 모듈 상세 설계

> 요구사항: [홈·환경설정 모듈 요구사항](requirements.md)  
> 상위 지도: [지원·읽기·플랫폼 영역](../../requirements.md)  
> 공통 형식: [모듈 상세 설계 규약](../../../governance/module-design-standard.md)  
> 목표 아키텍처: [목표 Clean Architecture 설계](../../../../architecture/target-clean-architecture.md)

## 1. 설계 목적과 추적성

이 설계는 `HOME-001~004`, `THEME-001`을 홈 Read Composition과 preference로 분리하는 기준이다. 홈 카드는 다른 모듈의 공개 조회 결과를 조합하고 표시할 지역화폐 유형을 선택하지만 원천 금액을 소유하지 않는다. 원천의 유효한 0원·NoData·failure를 합성 과정에서 보존한다. Theme은 브라우저 Presentation Adapter 안에 머물며 서버 Domain과 무관하다.

## 2. 모듈 경계와 책임

| 하위 기능 | 소유 | 비소유 |
|---|---|---|
| Home Configuration | 선택할 두 카드와 순서, 홈 표시 지역화폐 유형 | Household identity·membership, 지역화폐 잔액 |
| Home Summary | 원천 결과를 카드 상태로 조합 | 잔액·예산·거래 합계 계산 원칙 |
| Theme Preference | 유효 theme key와 local 복원·적용 | 가구 공유 설정, 서버 CSS |

가구 문서에 섞여 있는 기존 홈 필드는 migration Adapter로만 읽는다. Access 모듈의 Household Entity에 홈 계산을 추가하지 않는다.

## 3. 공개 계약

### 3.1 Home Query·Command

| 이름 | 입력 | 결과 | 상태 |
|---|---|---|---|
| `GetHomeConfiguration` Query | ActorContext, householdId | `HomeConfigurationView` | 현재 사용 |
| `GetHomeSummary` Query | ActorContext, householdId, accounting period | 카드 2개의 `HomeSummaryView` | 현재 사용 |
| `SaveHomeConfiguration` Command | envelope, left·right card selection, expectedVersion | 저장된 configuration/version 또는 ValidationError·Conflict | 모든 활성 가구원이 설정 UI에서 호출하는 목표 계약 |
| `SelectHomeLocalCurrency` Command | envelope, localCurrencyType, expectedVersion | 저장된 선택/version | HOME-002 목표 계약 |
| `ListAvailableLocalCurrencies` Query | ActorContext, householdId | 선택 가능한 유형과 표시명 목록 | Local Currency 공개 Query 소비 |

```ts
type HomeCardType =
  | 'LOCAL_CURRENCY_BALANCE'
  | 'MONTHLY_REMAINING_BUDGET'
  | 'MONTHLY_EXPENSE'
  | 'YEARLY_EXPENSE';

interface HomeConfigurationView {
  left: HomeCardType;
  right: HomeCardType;
  selectedLocalCurrencyType?: string;
  version: number;
  source: 'SAVED' | 'DEFAULT' | 'LEGACY';
}

type HomeCardState =
  | { kind: 'READY'; amountInWon: number; secondaryAmountInWon?: number; asOf: string }
  | { kind: 'NO_DATA'; reason: string }
  | { kind: 'STALE'; amountInWon: number; asOf: string }
  | { kind: 'FAILED'; code: string };
```

기본 구성은 왼쪽 `LOCAL_CURRENCY_BALANCE`, 오른쪽 `MONTHLY_REMAINING_BUDGET`다. 선택이 없고 관찰된 지역화폐가 정확히 하나면 해당 type을 조건부 저장해 자동 선택한다. 처음부터 여러 유형인데 선택이 없으면 임의 문서를 표시하지 않고 `NO_DATA(LOCAL_CURRENCY_SELECTION_REQUIRED)`를 반환한다. 원천 실패는 0원 `READY`로 바꾸지 않는다.

### 3.2 Theme 계약

```ts
type ThemeKey = 'default' | 'warm' | 'forest' | 'ocean' | 'mono';

interface ThemePreferencePort {
  load(): ThemeKey | null;
  save(theme: ThemeKey): void;
}
```

`ResolveThemePreference(raw)`는 허용 목록의 값만 반환하고 나머지는 `default`로 해석하되 잘못된 값을 유효 값처럼 다시 저장하지 않는다. `ApplyTheme`은 root element의 안정된 attribute/CSS variable set만 변경한다.

## 4. 조회 모델과 불변식

| 모델·Policy | 불변식 |
|---|---|
| `HomeConfiguration` | 정확히 left/right 두 slot, 선택적 localCurrencyType과 schema version을 가진다. 신규 저장은 서로 다른 지원 card type만 허용한다. 지원하지 않는 read 값은 default로 fallback하고 선택 통화는 현재 가구 보유 유형이어야 한다. |
| `LocalCurrencyDetailNavigationPolicy` | 클릭한 지역화폐 카드의 선택 type 하나를 navigation intent로 고정한다. `all`·다른 type 전환 capability를 상세 화면에 제공하지 않는다. |
| `HomeCardSourceResult` | Ready, NoData, Stale, Failure를 보존한다. |
| `HomeSummary` | configuration 순서를 유지하고 선택하지 않은 source는 불필요하게 조회하지 않는다. |
| `ThemeKey` | 허용된 5개 값만 Domain-free presentation 상태가 된다. |

[DEC-061](../../../governance/decisions.md#dec-061)의 `HomeCardSelectionPolicy`는 신규 저장의 `left !== right`를 강제합니다. 설정 UI는 다른 slot에서 선택한 유형을 비활성화하고, 서버도 `DUPLICATE_HOME_CARD_TYPE`으로 write 0건을 보장합니다. 기존 중복 configuration은 읽기 호환으로 두 slot을 그대로 표시하여 사용자 결과를 자동 변경하지 않지만, 다음 저장에서는 서로 다른 유형을 선택해야 합니다. `selectedLocalCurrencyType`은 같은 Preferences Aggregate에 있더라도 카드 구성과 별도 필드이며 카드 선택 Command가 변경하지 않습니다.

## 5. Application Use Case 상세

### 5.1 `GetHomeConfiguration`

1. Actor의 household 접근을 검증한다.
2. `HomeConfigurationStore`에서 현재 schema를 읽는다.
3. 없으면 `LegacyHomeConfigurationReader`로 혼합 필드를 읽는다.
4. 유효한 저장값이면 정규화하고 source를 표시한다.
5. 없거나 지원하지 않는 값이면 기본 두 카드를 반환한다.

### 5.2 `GetHomeSummary`

1. configuration을 해석한다.
2. 필요한 카드 type을 deduplicate해 각 공개 Query Port를 호출한다.
3. 지역화폐는 configuration의 `selectedLocalCurrencyType`을 Local Currency Query에 명시한다. 선택이 없고 유형이 하나뿐이면 `SelectHomeLocalCurrency`의 자동 선택 경로를 한 번 실행한다. 여러 유형이면 조회 순서로 하나를 고르지 않고 선택 필요 상태를 반환한다.
4. 월 예산은 Category/Budget Query, 월·연 지출과 수입은 Ledger Summary Query를 사용한다.
5. 각 source의 typed 상태를 해당 카드에 보존한다.
6. 두 카드 중 하나가 실패해도 다른 카드는 표시할 수 있지만 전체 결과에 partial 상태를 명시한다.

### 5.3 `SaveHomeConfiguration`

1. 설정의 홈 카드 구성 UI가 현재 configuration과 `expectedVersion`을 읽습니다.
2. 모든 활성 가구원에게 매핑된 `home-preferences.write` capability와 가구 scope를 검증합니다. 별도 owner·admin 역할을 요구하지 않습니다.
3. 두 slot이 지원 유형이고 서로 다른지 `HomeCardSelectionPolicy`로 검증합니다. 중복·unknown이면 기존 configuration을 변경하지 않습니다.
4. transaction에서 현재 version을 다시 읽어 `expectedVersion`과 다르면 `Conflict(HOME_CONFIGURATION_VERSION_MISMATCH)`로 전체 거부합니다.
5. left·right만 갱신하고 `selectedLocalCurrencyType` 등 다른 Preferences 필드는 유지하며, configuration·receipt·`HomeConfigurationChanged.v1` Outbox를 같은 transaction에 저장합니다.
6. 같은 idempotency key와 payload는 저장 결과를 재생하고 같은 key의 다른 payload는 `IDEMPOTENCY_PAYLOAD_MISMATCH`로 거부합니다.

### 5.4 `SelectHomeLocalCurrency`

1. Actor의 현재 가구 접근과 `home-preferences.write` capability를 검증한다.
2. Local Currency Query로 입력 type이 현재 가구에서 선택 가능한지 검증한다.
3. `expectedVersion`으로 다른 구성 변경과의 lost update를 막는다.
4. 선택 type과 receipt를 같은 transaction에 저장하고 변경 Event를 한 번 기록한다.
5. 이후 Home Summary는 다른 유형의 잔액이 더 최근에 갱신되어도 저장된 선택을 유지한다.

자동 선택도 같은 Command와 version 검증을 사용합니다. 동시에 두 번째 유형이 등록되어 선택 후보가 둘이 되면 자동 선택을 중단하고 `LOCAL_CURRENCY_SELECTION_REQUIRED`로 수렴합니다.

### 5.5 Theme 복원·변경

1. SSR 단계는 deterministic `default`를 사용한다.
2. client hydration 후 local Adapter에서 값을 읽는다.
3. 유효한 값만 state와 DOM에 적용한다.
4. 사용자 변경은 DOM 적용 성공 후 local storage에 저장한다.
5. storage 접근 실패는 theme 표시를 막지 않고 `default`와 telemetry를 사용한다.

## 6. Port 설계

| Port | 제공자·Adapter | 테스트 대역 |
|---|---|---|
| `HomeConfigurationStore` | 목표 Preferences Firestore Adapter | in-memory conformance Fake |
| `LegacyHomeConfigurationReader` | 기존 Household field Adapter | legacy fixture |
| `LocalCurrencyQueryPort` | Local Currency 공개 Query | Ready/NoData/Failure Stub |
| `BudgetStatusQueryPort` | Category/Budget 공개 Query | projection Stub |
| `LedgerSummaryQueryPort` | Ledger 공개 Query | 월·연 합계 Stub |
| `ThemePreferencePort` | browser localStorage | storage failure Fake |
| `ThemeDomPort` | document root Adapter | attribute Spy |
| `Clock`·`HouseholdZonePort` | Shared Kernel | FixedClock |

## 7. 저장·트랜잭션·동시성

- 목표 저장은 `households/{householdId}/homePreferences/{scopeId}`처럼 Access 원본과 분리된 Preferences writer 경로를 사용한다.
- 현재 `households` 혼합 필드는 read-through Legacy Adapter로만 접근하고 V2 backfill 뒤 제거한다.
- configuration은 schemaVersion과 aggregateVersion을 가진다.
- Save가 활성화되면 idempotency receipt, configuration, Outbox를 같은 transaction에 넣는다.
- Theme은 기기별 local state이며 household purge나 서버 동기화 대상이 아니다.
- Home Summary는 요청 시 원천 Query를 조합해 만드는 파생 결과이며 영속 cache/projection으로 저장하지 않는다.

## 8. Event·조회 연동

- Home summary용 Event consumer·Inbox·Projector는 두지 않는다. Local Currency, Budget, Ledger의 공개 Query를 요청 시 호출한다.
- `HomeConfigurationChanged.v1`은 Save 계약이 실제 활성화될 때만 producer를 등록한다.
- Theme 변경은 Integration Event가 아니며 브라우저 내부 UI event다.

## 9. 오류·보안·관측성

- Home Query는 household scope와 ActorContext를 항상 검증한다.
- source 실패·NoData를 구분하고 금액 0과 혼동하지 않는다. 조회 시 계산하므로 Projection freshness 상태는 없다.
- configuration payload의 알 수 없는 type/version은 `ContractFailure` telemetry 후 안전한 default로 표시한다.
- 카드 구성 저장의 같은 left/right는 `ValidationError(DUPLICATE_HOME_CARD_TYPE)`, stale version은 `Conflict(HOME_CONFIGURATION_VERSION_MISMATCH)`이며 둘 다 write 0건이다.
- localStorage에는 theme key만 저장하고 가구·금융 값을 저장하지 않는다.
- metric: source별 실패, partial summary, legacy fallback, invalid config, theme storage failure, obsolete response.

## 10. 목표 패키지 구조

```text
functions/src/read-side/home-preferences/
  application/queries/getHomeConfiguration.ts
  application/queries/getHomeSummary.ts
  application/commands/saveHomeConfiguration.ts
  policies/homeCardSelectionPolicy.ts
  ports/out/
  adapters/firestore/
  public.ts
web/src/features/home-preferences/
  application/homeController.ts
  presentation/
web/src/platform/theme/
  resolveThemePreference.ts
  localStorageThemeAdapter.ts
  domThemeAdapter.ts
```

Theme에 형식적인 Domain 폴더를 만들지 않는다.

## 11. 테스트 설계

| 요구사항 ID | 수준 | 테스트 대상 | 핵심 fixture·경계값 | 관찰 결과 | Canonical 테스트 ID |
|---|---|---|---|---|---|
| HOME-001 | U, Application, UI | Configuration·Summary | 저장 없음/유효/구버전, source 성공·NoData·실패, 월·연 수입 | 기본/저장 카드 2개와 typed partial 상태 | T-HOME-003 |
| HOME-002 | U, Application, UI | 지역화폐 선택·Summary·상세 navigation | 첫 단일 유형, 동시 두 유형, 유효/미보유 type, 선택 후 다른 type 갱신, version 경합, 선택 카드 클릭 | 단일 유형 자동 선택, 선택 유지, 미보유 거부, 임의 first 금지, 상세 navigation intent에 한 type 고정·내부 전환 capability 없음 | T-HOME-004 |
| HOME-003 | U, Contract, UI | HomeCardSourceResult·GetHomeSummary | 원천별 성공 0원, NoData, timeout, 한 원천만 실패 | 각 typed 상태 보존, 정상 카드 유지와 partial failure, 0원 위장 없음 | T-HOME-001 |
| HOME-004 | U, Application, Emulator, UI | HomeCardSelectionPolicy·SaveHomeConfiguration·설정 UI | 기본·서로 다른·기존 중복·unknown, 같은 유형 저장, 두 활성 가구원 version 경합, idempotency replay·payload mismatch, removed·비가구원 Actor, 지역화폐 선택값 | 기본·기존 중복 read 보존, 신규 중복·unknown·비인가 write 0건, 서로 다른 구성 receipt·Event 한 번 저장, replay 동일 결과·상이 payload Conflict, 동시 loser Conflict, 비대상 Preferences 필드 불변 | T-HOME-002 |
| THEME-001 | U, UI | Theme resolver·Adapter | 5개 값, unknown, storage/DOM 실패, hydration | 유효 테마 복원·적용, unknown 무시 | T-THEME-001 |

추가 suite:

- Home configuration Fake/Firestore Adapter conformance
- 가구 A Actor의 가구 B configuration 접근 차단
- Legacy mixed field와 V2 configuration의 shadow-read 동등성
- source 하나 실패 시 다른 카드 유지와 0원 위장 방지
- DOM snapshot보다는 theme attribute와 CSS token 계약 검증

## 12. 확정 정책과 구현 순서

- [DEC-061](../../../governance/decisions.md#dec-061): 모든 활성 가구원이 설정 UI에서 서로 다른 두 card type을 공유 configuration으로 저장하고 기존 중복 구성은 읽기만 호환
- [DEC-048](../../../governance/decisions.md#dec-048): Home Summary는 영속 Projection 없이 요청 시 원천 Query를 조합
- [DEC-057](../../../governance/decisions.md#dec-057): 선택 지역화폐 카드 상세는 클릭 시 type을 고정 전달하고 내부 전환 UI를 두지 않음

구현 순서:

1. 기존 default·저장 configuration과 5개 theme Characterization test를 작성한다.
2. Theme Adapter와 Home Composition Policy를 화면에서 추출한다.
3. Home Query Port를 도입하고 원천 service 직접 import를 제거한다.
4. V2 Preferences 저장소를 shadow-read/backfill한다.
5. HOME-002의 지역화폐 선택 UI와 Command를 연결한다.
6. `HomeCardSelectionPolicy`와 versioned `SaveHomeConfiguration`을 구현하고 설정 화면의 왼쪽·오른쪽 선택 UI를 연결한 뒤 `T-HOME-002`를 활성화한다.
