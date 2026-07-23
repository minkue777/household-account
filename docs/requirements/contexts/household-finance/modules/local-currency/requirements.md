# 지역화폐 잔액 모듈 요구사항

> 상위 Bounded Context: [Household Finance](../../requirements.md)  
> 아키텍처 역할: Independent Aggregate / Application  
> 상세 설계: [모듈 상세 설계](design.md)  
> 상태와 테스트 수준의 의미는 [공통 규약](../../../../governance/conventions.md)을 따릅니다.  
> 이 문서는 `BAL-*` 요구사항의 단일 소유 문서입니다.

## 1. 독립 모듈 책임

지역화폐 잔액 모듈은 금융 알림에서 관찰된 경기·대전·세종 지역화폐 잔액을 가구 범위의 최신 잔액으로 저장하고 조회하는 책임을 가집니다. 결제 거래와 잔액은 서로 다른 Aggregate로 다루며, 알림 수집 모듈에서 검증된 잔액 관찰 결과만 입력받습니다.

이 모듈이 보장할 핵심 불변식은 다음과 같습니다.

- 잔액은 가구와 통화 유형의 조합으로 식별합니다.
- 같은 식별자에는 최신 잔액 문서 하나만 존재합니다.
- 잔액은 원 단위 정수이며 관찰 시각과 함께 저장합니다.
- 거래 저장 성공 여부와 무관하게 유효한 잔액 관찰은 독립적으로 반영할 수 있습니다.
- Repository 실패와 아직 잔액이 없는 상태를 구분합니다.

[DEC-008](../../../../governance/decisions.md#dec-008)에 따라 잔액 identity는 `가구 ID + 지역화폐 유형`이며, 홈 표시 유형의 선택은 Home Preferences가 소유합니다.

## 2. 포함·제외 범위

### 포함

- 검증된 지역화폐 잔액 관찰 명령 수신
- 가구·통화 유형별 잔액 생성 또는 갱신
- 잔액·통화 유형·갱신 시각 조회와 실시간 구독
- 구형 통화 유형 누락 문서의 기본값 호환

### 제외

- Android 알림 패키지·본문 출처 판별
- 각 지역화폐 메시지 원문 파싱
- 카드 결제 거래 생성·취소
- 지역화폐 충전·사용 이력 원장
- 외부 지역화폐 사업자 API 연동
- 홈 화면의 카드 배치와 표현

## 3. 소유 데이터

| 데이터 | 소유 범위 | 비고 |
|---|---|---|
| `households/{householdId}/localCurrencyBalances/{localCurrencyType}` | 가구, `localCurrency` 유형, 정수 잔액, 관찰·갱신 시각 | 현재 Writer와 Web이 사용하는 Canonical 경로입니다. 최상위 `balances`는 migration·reconciliation 전용 Legacy 데이터이며 Web이 직접 읽지 않습니다. |
| 잔액 식별자 | 가구와 통화 유형의 유일 조합 | 서로 다른 지역화폐 유형은 독립된 최신 문서를 가집니다. |
| 최신 잔액 조회 모델 | 잔액, 통화 유형, 갱신 시각, 없음·오류 상태 | UI가 저장소 문서 순서에 의존하지 않도록 합니다. |

결제 `expenses`와 알림 원문은 이 모듈이 소유하지 않습니다.

## 4. 공개 계약·의존 모듈

### 외부에 제공하는 계약

| 계약 | 입력 | 결과 |
|---|---|---|
| `RecordBalanceObservation` | 가구 ID, 통화 유형, 정수 잔액, 관찰 시각과 branch key | 생성·갱신된 최신 잔액 또는 이미 처리됨 |
| `GetBalance` | 가구 ID, 선택 통화 유형 | 최신 잔액, 없음 또는 Repository 오류 |
| `SubscribeBalance` | 가구 ID, 선택 통화 유형 | 최신 잔액 typed 상태 스트림 |

### 의존 모듈·포트

- [가구·접근 모듈](../../../access-household/modules/household-access/requirements.md): 유효한 가구 범위를 제공합니다.
- [Android 결제 수집 모듈](../../../payment-capture/modules/android-payment-ingestion/requirements.md): 출처와 본문을 검증한 잔액 관찰 명령을 제공합니다.
- Clock: 관찰·갱신 시각을 주입합니다.
- Balance Repository: 가구·통화 유형 유일 키를 원자적으로 upsert합니다.

[거래 원장 모듈](../ledger/requirements.md)과는 저장 의존성이 없습니다. 하나의 알림에서 결제와 잔액이 함께 추출되어도 두 공개 계약의 결과를 각각 관측합니다.

Android 알림의 package·title·body 판별과 경기·대전·세종 원문 parsing은 [Android 결제 수집 모듈의 `PARSE-GYEONGGI-001`, `PARSE-DAEJEON-001`, `PARSE-SEJONG-001`](../../../payment-capture/modules/android-payment-ingestion/requirements.md#52-지원-입력-형식)이 소유하고 Canonical `T-PARSE-001`로 검증합니다. 이 모듈의 경계는 parser가 만든 원문 없는 `BalanceObservation.v1`부터 시작하며 parser 규칙을 반복 구현하지 않습니다. 거래·잔액 branch 조정과 부분 재시도는 같은 모듈의 `ING-009`·`T-ING-BAL-001`이 소유하고, Local Currency는 전달받은 balance branch key의 독립 commit·receipt·result replay를 보장합니다.

## 5. 요구사항

| ID | 상태 | 요구사항 | 경계·예외 | 근거 | 테스트 |
|---|---|---|---|---|---|
| BAL-001 | 목표 명세 | 검증된 경기·대전·세종 `BalanceObservation.v1`을 받으면 contract version, 확정 localCurrencyType, 정수 잔액, 관찰 시각, source·parser metadata와 SystemActor의 가구 scope를 검증한 뒤 저장한다. | 알림 원문과 package 판별 결과를 입력받거나 서버에서 재parse하지 않는다. 가구 scope가 없거나 지원하지 않는 type/version, 정수가 아닌 잔액은 Balance·receipt·Event를 만들지 않는다. 원문 parsing 결과의 Canonical 검증은 Payment Capture의 `T-PARSE-001`이다. | [Android 결제 수집 상세 설계](../../../payment-capture/modules/android-payment-ingestion/design.md#41-sourceparser-domain), [지역화폐 상세 설계](design.md#32-balanceobservationv1) | C, I |
| BAL-002 | 목표 명세 | 가구 ID와 지역화폐 유형을 유일 identity로 사용하여 유형별 최신 잔액 문서를 원자적으로 upsert한다. | 한 가구의 경기·대전·세종 잔액은 서로 덮어쓰지 않는다. 현재 가구당 첫 문서를 갱신하는 동작은 결함이다. | [AndroidCaptureDelivery](../../../../../../android/app/src/main/java/com/household/account/paymentcapture/AndroidCaptureDelivery.kt), [DEC-008](../../../../governance/decisions.md#dec-008) | I |
| BAL-003 | 현재 명세 | 잔액 문서에는 가구, localCurrency 유형, 정수 잔액, 통화 유형, 관찰·갱신 시각을 저장한다. | 레거시 통화 유형 누락은 `legacy-unknown`·표시명 `지역화폐`로 읽고 특정 지역화폐 유형으로 추정하지 않는다. 음수 전용 거부·0원 보정·마지막 정상값 대체는 하지 않고 정수 관찰값을 그대로 저장한다. | 같은 근거, [DEC-044](../../../../governance/decisions.md#dec-044), [DEC-057](../../../../governance/decisions.md#dec-057) | I |
| BAL-004 | 현재 명세 | Web은 Canonical 가구 하위 경로에서 Home Preferences가 선택한 지역화폐 유형의 최신 잔액·통화 유형·갱신 시각을 직접 구독해 표시한다. 유형이 하나뿐이면 그 유형을 자동 표시한다. | 별도 localStorage 잔액 캐시나 Background Projection을 만들지 않는다. 여러 유형인데 선택이 없을 때 임의의 첫 문서를 표시하지 않으며 transient Auth·네트워크·listener 오류만으로 이미 표시한 정상값을 지우지 않는다. | [balanceService](../../../../../../web/src/lib/balanceService.ts), [DEC-008](../../../../governance/decisions.md#dec-008) | I, UI |
| BAL-005 | 목표 명세 | `RecordBalanceObservation`은 거래 생성·카드 매칭·가맹점 mapping을 입력으로 요구하지 않고 독립된 balance branch key와 receipt로 commit하며 balance-only 입력을 허용한다. | 거래·잔액 branch의 호출 순서·부분 재시도는 Payment Capture `ING-009`가 소유한다. 거래 branch가 없거나 거부·실패해도 유효한 잔액은 독립 commit되고, 잔액 일시 실패는 이미 확정된 거래를 되돌리지 않는다. 같은 observation 재생은 저장된 결과를 반환하고 잔액 version·Event를 중복 증가시키지 않는다. | [Android 결제 수집 ING-009](../../../payment-capture/modules/android-payment-ingestion/requirements.md#51-수집출처-선택중복-처리), [DEC-008](../../../../governance/decisions.md#dec-008) | U, I, C |

## 6. 모듈 결함

- 최상위 Legacy `balances`에는 과거 중복·유형 누락 문서가 남아 있어 reconciliation 후 운영 Agent가 정리해야 합니다. Web 읽기 경로에서는 이미 제외했습니다.
- Android Repository 오류가 호출자에게 일관된 실패로 전달되지 않을 수 있습니다.
- 잔액 파싱과 저장 호출이 Android 알림 Service에 결합되어 독립 계약 테스트가 어렵습니다.

## 7. 관련 DEC 링크

- [DEC-008: 지역화폐 잔액의 식별 단위](../../../../governance/decisions.md#dec-008) — `BAL-002`의 유일 키를 가구·유형으로 확정하고 Web 선택 계약을 Home Preferences에 연결합니다.
- [DEC-057: 선택 지역화폐 상세 범위](../../../../governance/decisions.md#dec-057) — 홈에서 선택한 한 유형의 지출만 상세 조회하며 상세 화면 내부의 전체·다른 유형 전환 UI는 두지 않습니다. 거래 type과 상세 Query는 Ledger가 소유합니다.
- [DEC-044: 지역화폐 음수 잔액 비고려](../../../../governance/decisions.md#dec-044) — 금액은 정수만 검증하고 음수 전용 보정·거부·경고 상태를 추가하지 않습니다.

## 8. 모듈 테스트 시나리오

| 테스트 ID | 종류 | Given / When / Then | 연결 요구사항 |
|---|---|---|---|
| T-BAL-001 | 목표 | Payment Capture가 생성한 경기·대전·세종 `BalanceObservation.v1`, 가구 scope 없음, 지원하지 않는 type/version·비정수 금액 / intake / 유효 DTO만 Balance·receipt·Event로 commit하고 원문은 받거나 재parse하지 않음 | BAL-001, T-PARSE-001 |
| T-BAL-002 | 목표 | 같은 가구·같은 유형의 잔액 문서 없음·있음 / 저장 / 유형 identity 문서 생성·최신값 갱신 | BAL-002 |
| T-BAL-003 | 호환 | 통화 유형이 없는 기존 잔액 문서와 부호 있는 정수 관찰값 / 저장·조회 / 누락 유형은 `legacy-unknown`·표시명 `지역화폐`로 읽고 특정 유형으로 추정하지 않으며, 금액은 음수 전용 보정·경고 없이 동일 정수로 유지 | BAL-003, DEC-044, DEC-057 |
| T-BAL-004 | 현재 | 선택 유형의 최신 잔액 변경, 유형 하나, 여러 유형·선택 없음, 문서 없음 / Web Canonical 구독 / 가구 하위 경로만 사용하고 선택 유형 또는 유일 유형을 직접 반영하며 별도 잔액 캐시를 만들지 않음 | BAL-004 |
| T-BAL-005 | 목표 | 한 가구에 경기·대전·세종 잔액 알림 / 저장·유형별 조회 / 세 유형의 최신값을 독립 유지하고 서로 덮어쓰지 않음 | BAL-002, DEC-008 |
| T-BAL-006 | 목표 | Balance Repository·listener 조회 실패 / Web·Android 조회 / 잔액 없음과 구분되는 오류이며 Web은 transient 오류만으로 마지막 성공 표시값을 지우지 않음 | BAL-004 |
| T-BAL-007 | 목표 | 같은 가구·통화 잔액을 동시에 두 번 upsert / 저장 / 유일 문서 하나에 마지막 정책의 값 반영 | BAL-002, BAL-003 |
| T-BAL-008 | 목표 | balance-only, 거래 거부·실패+유효 잔액, 거래 성공+잔액 retry, terminal observation 재생 / Payment Capture branch coordinator와 RecordBalanceObservation / 성공 branch rollback·재호출 없이 실패 branch만 같은 key로 재시도하고 Balance version·Event 중복 증가 없음 | BAL-005, ING-009, T-ING-BAL-001 |

## 9. 코드 근거

### Android

- [알림 수집 Service](../../../../../../android/app/src/main/java/com/household/account/service/CardNotificationListenerService.kt)
- [지역화폐 관찰 전달 Adapter](../../../../../../android/app/src/main/java/com/household/account/paymentcapture/AndroidCaptureDelivery.kt)

### Web

- [지역화폐 잔액 서비스](../../../../../../web/src/lib/balanceService.ts)
- [홈 잔액 카드](../../../../../../web/src/components/BalanceCards.tsx)
