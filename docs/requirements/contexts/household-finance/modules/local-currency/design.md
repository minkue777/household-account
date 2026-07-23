# 지역화폐 잔액 모듈 상세 설계

> 상태: Proposed — 테스트 구현 기준  
> 소유 요구사항: [지역화폐 잔액 모듈 요구사항](requirements.md)  
> 상위 Context: [Household Finance](../../requirements.md)  
> 공통 상세 설계 규약: [모듈 상세 설계 규약](../../../../governance/module-design-standard.md)  
> 목표 아키텍처: [목표 Clean Architecture 설계](../../../../../architecture/target-clean-architecture.md)

## 1. 설계 목적과 추적성

이 설계는 `BAL-001~004`를 채널 중립 `BalanceObservation.v1` 입력과 독립 `LocalCurrencyBalance` Aggregate로 옮깁니다. Android는 출처·본문을 검증하고 잔액 관찰을 만들며, 서버 Local Currency 모듈은 원문을 다시 parse하지 않고 최신 상태의 저장·조회만 소유합니다.

핵심 목표는 다음과 같습니다.

- 거래 Transaction과 잔액 Aggregate를 서로 다른 결과와 Unit of Work로 처리합니다.
- 가구·잔액 식별 단위별로 결정적인 최신 문서 하나를 보장합니다.
- 원 단위 정수와 관찰 시각·통화 유형 증거를 보존합니다.
- 조회 실패와 아직 관찰된 잔액이 없는 상태를 구분합니다.
- 같은 observation의 재전송과 동시 upsert에 안정적입니다.
- [DEC-008](../../../../governance/decisions.md#dec-008)에 따라 가구·지역화폐 유형별 identity를 사용합니다.

관련 기준은 [Android 승인 흐름](../../../../system/flows.md#3-android-승인-알림), [데이터 소유권](../../../../cross-cutting/data-ownership.md), [보안 경계](../../../../cross-cutting/security-privacy.md), [테스트 전략](../../../../governance/test-strategy.md)을 따릅니다.

## 2. 모듈 경계와 책임

### 2.1 소유 책임

| 책임 | 설명 |
|---|---|
| Balance observation intake | 검증된 versioned 관찰 DTO의 schema·권한·멱등성 검증 |
| LocalCurrencyBalance | 논리 identity별 최신 금액·통화 유형·관찰 시각·version |
| Latest observation policy | 늦게 도착한 관찰과 동시 관찰의 결정적 적용 순서 |
| Balance Query/Read Contract | 최신값, 없음, 오류를 구분 |
| Balance Event | 실제 최신값 변경 시 `LocalCurrencyBalanceChanged.v1` 생산 |
| Local Currency purge | Finance purge에 이 모듈 소유 page 제공 |

### 2.2 경계 밖

- Android package/title/body 출처 판별과 경기·대전·세종 parser는 Payment Capture Android Adapter가 소유합니다.
- 금융 알림 원문은 이 모듈 Command, Event, 저장 모델에 들어오지 않습니다.
- 결제 거래 생성·취소·fingerprint는 Payment Capture/Ledger가 소유합니다.
- 지역화폐 충전·사용 이력 원장은 범위 밖입니다.
- 홈 카드 구성과 표현은 Home Preferences/Web Presentation이 소유합니다.

같은 알림에서 Transaction과 BalanceObservation이 만들어져도 Payment Capture는 Ledger와 Local Currency Port를 각각 호출하고 `transactionResult`와 `balanceResult`를 따로 반환합니다. 한쪽 실패가 다른 쪽의 이미 commit된 결과를 거짓 rollback하지 않습니다.

원문 producer의 Canonical 계약은 [Android 결제 수집의 `T-PARSE-001`](../../../payment-capture/modules/android-payment-ingestion/requirements.md#9-모듈-테스트-시나리오)이며 경기·대전·세종의 `PARSE-*-001`을 함께 소유합니다. branch 조정·부분 재시도의 Canonical 계약은 같은 문서의 `T-ING-BAL-001`입니다. Local Currency의 `T-BAL-001`은 그 producer가 만든 `BalanceObservation.v1`의 consumer intake부터, `T-BAL-008`은 조정 결과에서 Local Currency의 독립 commit·replay 결과만 검증합니다.

## 3. 공개 계약

공통 `CommandEnvelope`, `ActorContext`, Result union은 [공통 Application 계약](../../../../governance/module-design-standard.md#3-공통-application-계약)을 사용합니다.

### 3.1 공개 Input Port

| 이름·종류 | 호출자 | 입력 DTO | 결과 | 권한 | 일관성 | 멱등성 |
|---|---|---|---|---|---|---|
| `RecordBalanceObservation` Command v1 | Payment Capture Intake | `BalanceObservation.v1` | `Success<BalanceRecordedResult>`, `AlreadyProcessed`, `ValidationError`, `Conflict`, `Forbidden`, `RetryableFailure` | `local-currency.record` SystemActor | Balance·receipt·조건부 Outbox 한 UoW | envelope key + observationId |
| `GetBalance` Query | Web·Home, Payment Capture | Balance selector | `Success<LocalCurrencyBalanceView>`, `NoData`, `Forbidden`, `RetryableFailure` | `local-currency.read` | 최신 관찰 문서 | 해당 없음 |
| `SubscribeBalance` Read Contract | Web | Balance selector | `BalanceReadState` stream | 같은 가구 `local-currency.read` | 공개 read schema + Rules | 해당 없음 |
| `PurgeLocalCurrencyDataParticipant` Context participant | Finance purge Workflow | processId, checkpoint, page limit | 변경 의도 또는 공통 typed purge 결과 | lifecycle SystemActor | Finance purge page UoW | processId + checkpoint |

계약 이름은 목표 아키텍처의 `RecordBalanceObservation`, `GetBalance`, `SubscribeBalance`를 사용합니다. 기존 `RecordLocalCurrencyBalance` 등의 이름은 Legacy Facade에서만 유지하고 공개 계약의 동의어로 늘리지 않습니다.

### 3.2 BalanceObservation.v1

| 필드 | 의미·검증 |
|---|---|
| `observationId` | Android Queue와 서버 재시도에서 유지하는 안정 ID |
| `localCurrencyType` | 경기·대전·세종 등 parser가 식별한 versioned type code; 원문 표시 문자열 아님 |
| `balanceInWon` | 원 단위 정수 |
| `observedAt` | 알림/수집에서 확정한 Instant |
| `sourceType` | 검증된 지역화폐 source code |
| `parserId / parserVersion` | producer contract 추적 |
| `rawPayloadHash` | 선택적 비가역 진단 상관값; 원문 미포함 |

`householdId`는 공통 envelope와 ActorContext에서 일치 여부를 확인합니다. 클라이언트가 “검증됨” boolean이나 capability를 payload로 보낼 수 없습니다.

### 3.3 Result와 Read Model

`BalanceRecordedResult`는 balanceId, identityVersion, balanceVersion, 적용 status를 반환합니다.

| status | 의미 |
|---|---|
| `created` | 논리 identity의 첫 최신값 생성 |
| `updated` | 더 최신인 observation으로 값 변경 |
| `staleIgnored` | 유효하지만 현재보다 오래된 관찰이라 Canonical 값 미변경 |

같은 observationId의 동일 payload 재시도는 저장된 typed result를 replay하고, 다른 payload는 `Conflict(IDEMPOTENCY_PAYLOAD_MISMATCH)`입니다.

`LocalCurrencyBalanceView`는 balanceId, localCurrencyType, balanceInWon, observedAt, updatedAt, balanceVersion, schemaVersion을 반환합니다. legacy type 누락 문서는 `localCurrencyType=legacy-unknown`과 `displayName=지역화폐`로 읽되, 이를 새로운 확정 type으로 추정하지 않습니다.

`BalanceReadState`는 `loading | data(view) | noData | failed(code, retryable)`를 구분합니다. failed를 null로 변환하지 않습니다. 최신 관찰을 직접 읽으므로 Projection freshness 상태는 두지 않습니다.

## 4. Domain 모델과 불변식

### 4.1 모델

| 모델 | 주요 상태 | 불변식 |
|---|---|---|
| `BalanceObservation` Value Object | observationId, type, MoneyWon integer, observedAt, source/parser metadata | 원문 없음, type 비공백·지원 schema, 금액 정수 |
| `BalanceIdentity` Value Object | householdId와 `BalanceIdentityPolicy`가 선택한 scope key | 같은 policy version에서 결정적 |
| `LocalCurrencyBalance` Aggregate | identity, 현재 type·amount·observedAt, lastObservationId, version | identity별 문서 하나, version 단조 증가 |
| `ObservationOrder` Value Object | observedAt, observationId | 최신 비교의 전체 순서 제공 |

[DEC-044](../../../../governance/decisions.md#dec-044)에 따라 Domain은 잔액의 원 단위 정수 여부만 검증합니다. 음수 전용 거부·0원 보정·마지막 정상값 대체·별도 이상 상태를 추가하지 않으며, 부호 있는 정수 관찰값은 같은 저장·조회 흐름을 사용합니다.

### 4.2 정책

| Policy | 책임 | 상태 |
|---|---|---|
| `BalanceIdentityPolicy` | 가구 ID와 지역화폐 type으로 identity key 생성 | DEC-008 Accepted |
| `LatestBalanceObservationPolicy` | `observedAt, observationId` 순으로 최신 관찰 선택 | 확정 |
| `SupportedLocalCurrencyTypePolicy` | versioned type code와 legacy unknown 처리 | producer contract와 동기화 |

`BalanceIdentityPolicy`는 `householdId:localCurrencyType` 형식의 결정적 key를 반환합니다. household singleton 구현은 목표 경로에서 사용하지 않으며 Legacy Adapter에서 기존 문서를 읽고 유형별 문서로 이관할 때만 다룹니다.

### 4.3 상태 전이

- 없음 + observation → created(version 1).
- 현재보다 최신 observation → updated(version N+1) + Event.
- 같은 observation replay → 저장된 result replay.
- 현재보다 오래된 observation → staleIgnored, balance version/Event 변경 없음.
- 같은 idempotency key/observationId의 다른 payload → Conflict, 변경 없음.

## 5. Application Use Case 상세

### 5.1 RecordBalanceObservation

1. Payment Capture용 `local-currency.record` capability와 Actor household를 검증합니다.
2. contractVersion, payload hash, observationId, type, 정수 금액, observedAt, sourceType, parserId·parserVersion을 검증합니다.
3. `BalanceIdentityPolicy`가 policyVersion과 결정적 identity key를 만듭니다.
4. transaction 안에서 receipt와 현재 Balance를 읽습니다.
5. 같은 key·같은 hash receipt가 있으면 최초 typed result를 반환합니다.
6. `LatestBalanceObservationPolicy`가 created/updated/staleIgnored를 결정합니다.
7. created/updated이면 Balance, receipt, `LocalCurrencyBalanceChanged.v1`을 한 transaction에 commit합니다.
8. staleIgnored이면 receipt만 저장하고 Canonical Balance/Event는 바꾸지 않습니다.
9. commit 후 결과를 반환하며 Home/FCM 같은 부수 효과를 직접 실행하지 않습니다.

### 5.2 독립 결과

Payment Capture가 Ledger write와 이 Port를 함께 조정하더라도 두 transaction의 결과를 별도로 보존합니다.

- 거래 실패 + 유효 balance 성공: balanceResult=updated를 유지합니다.
- 거래 성공 + balance 일시 실패: transactionResult=created, balanceResult=retryableFailure입니다.
- balance-only 알림: Ledger를 호출하지 않고 RecordBalanceObservation 결과만 반환할 수 있습니다.
- Android Queue receipt는 두 결과를 각각 확인하며 balance retry key를 바꾸지 않습니다.
- Payment Capture root receipt가 재실행되어도 이미 terminal인 balance branch는 저장된 `RecordBalanceObservation` result를 replay하고 Aggregate version을 다시 증가시키지 않습니다.

### 5.3 GetBalance

1. Actor household와 read capability를 검증합니다.
2. selector의 type을 보존해 `BalanceIdentityPolicy`에 전달합니다.
3. 문서 없음은 `NoData(BALANCE_NOT_OBSERVED)`입니다.
4. Repository timeout/permission/index 오류는 `RetryableFailure` 또는 `ContractFailure`입니다.
5. legacy 문서의 currencyType 누락은 호환 Mapper가 `legacy-unknown/지역화폐`로 반환합니다.
6. 중복 legacy 문서가 발견되면 임의 first를 성공으로 확정하지 않고 관측 경고와 migration-required 상태를 남깁니다.

### 5.4 SubscribeBalance

Read Adapter는 Membership-protected 공개 schema만 구독합니다. snapshot이 비면 noData, listener 오류면 failed를 전달합니다. 여러 identity가 허용되는 정책이면 selector별 독립 stream을 만들고 물리 문서 “첫 번째” 순서에 의존하지 않습니다.

### 5.5 Purge participant

Finance purge Workflow에 Local Currency 소유 identity 문서의 결정적 page와 precondition을 제공합니다. 같은 processId/checkpoint 재호출은 같은 결과 replay 또는 안전한 no-op이며, 완료 page에서만 checkpoint를 전진합니다.

## 6. Port 설계

### 6.1 Output Port

| Port | 책임 | 계약 핵심 |
|---|---|---|
| `LocalCurrencyBalanceRepository` | identity별 Balance 조회와 persistence mapping | 유일 key, legacy duplicate 감지, NoData/실패 구분 |
| `LocalCurrencyBalanceUnitOfWork` | Balance·receipt·Outbox 원자 commit | create 경합, callback 2회, stale receipt |
| `BalanceReadContractPort` | Membership-protected query/subscription | data/noData/failed |
| `OutboxAppendPort` | Balance changed Event append | created/updated에만 호출 |
| `Clock` | server updatedAt | observedAt을 덮어쓰지 않음 |
| `ObservabilityPort` | identity/version/result metric | 금액과 원문 비노출 |
| `PurgeParticipantPort` | Local Currency page 삭제 의도 | opaque checkpoint |

Android parser와 package source 검증은 Output Port가 아니라 Payment Capture 제공 계약입니다. 이 모듈은 Android SDK나 parser 구현을 import하지 않습니다.

### 6.2 Adapter

- Payment Capture → Local Currency in-process public Port Adapter
- Firestore V2 Balance Adapter
- Legacy root `balances` Mapper
- Web Firestore Read Model Adapter
- Finance purge participant Adapter

Legacy Adapter는 query의 “첫 문서”를 Domain 규칙으로 승격하지 않습니다. 기존 fixture를 읽는 동안 중복을 탐지하고 reconciliation 대상으로 보고합니다.

## 7. 저장·트랜잭션·동시성

### 7.1 논리 저장

| 데이터 | 목표 key | Writer |
|---|---|---|
| Balance | `households/{householdId}/localCurrencyBalances/{balanceIdentity}` | Local Currency |
| command receipt | context별 receipt 경로 | Local Currency Application |
| Outbox | 공통 append-only 경로 | `OutboxAppendPort` |

목표 아키텍처의 `{currencyType}` 경로는 DEC-008의 확정된 type별 identity를 사용합니다. 물리 ID는 정규화된 versioned type code에서 결정적으로 만들고 표시 문자열을 key로 사용하지 않습니다.

Balance persistence DTO는 identityPolicyVersion, localCurrencyType, balanceInWon, observedAt, lastObservationId, aggregateVersion, schemaVersion, createdAt/updatedAt을 갖습니다.

### 7.2 transaction과 경합

- created/updated: Balance + receipt + Outbox.
- staleIgnored: receipt만, Balance/Event 없음.
- replay: 기존 receipt read, write 없음.
- purge: Finance Workflow가 정한 page + checkpoint.

같은 identity에 동시 observation이 오면 Firestore transaction이 재실행되고 `ObservationOrder`가 최종 최신값을 다시 계산합니다. 도착 순서가 달라도 더 최신인 `observedAt, observationId` 값으로 수렴합니다. 같은 identity 문서 create 경합은 한 문서로 수렴합니다.

### 7.3 Legacy 전환

1. 현재 root `balances` 문서를 읽는 Legacy Mapper와 Characterization test를 둡니다.
2. household/type별 문서 수, currencyType 누락, 중복, 최신 updatedAt을 reconciliation report로 수집합니다.
3. 모든 Android write를 `RecordBalanceObservation`으로 통합합니다.
4. `BalanceIdentityPolicy`와 V2 유형별 결정 key를 활성화합니다.
5. backfill 결과의 문서 수·최신 금액·시각을 legacy와 비교합니다.
6. **완료:** Web read를 V2 Read Contract로 전환하고 root direct read와 first-document 동작을 제거했습니다.
7. Legacy root는 migration·reconciliation 도구에서만 읽고, 정리 검증 후 운영 Agent가 별도로 삭제합니다.

Web read 전환은 완료됐지만 V2 physical migration 전체는 유형별 backfill·중복 reconciliation 검증이 끝난 뒤에만 완료된 것으로 간주합니다.

## 8. Event·Projection·외부 연동

### 8.1 생산 Event

| Event | 최소 payload | 소비자 |
|---|---|---|
| `LocalCurrencyBalanceChanged.v1` | householdId, balanceId, localCurrencyType, balanceInWon, observedAt, aggregateVersion | 필요한 외부 관측 소비자; Home은 직접 Query 사용 |

Event는 실제 최신값이 created/updated일 때만 Canonical write와 같은 transaction에 append합니다. source 알림 원문, package 전체값, parser 원문을 포함하지 않습니다.

### 8.2 직접 조회와 구독

- Local Currency의 최신 Balance 자체는 Aggregate이며 Projection이 아닙니다.
- Home은 별도 Projection을 만들지 않고 이 모듈의 최신 Balance Query를 직접 사용합니다.
- Web 직접 구독은 Local Currency가 공개한 읽기 전용 schema/Rules를 사용할 수 있습니다.
- 구독은 schemaVersion, observedAt, updatedAt을 제공하되 UI용 Projection freshness 상태를 만들지 않습니다.
- Web은 `households/{householdId}/localCurrencyBalances`와 `homePreferences/home`만 구독하며 최상위 Legacy `balances`를 직접 읽지 않습니다.
- Home Preferences가 선택한 유형을 표시하고, 관찰된 유형이 하나뿐이면 그 유형을 자동 표시합니다. 여러 유형인데 선택이 없으면 임의의 첫 문서를 고르지 않습니다.
- 가구별 마지막 정상 잔액·유형·갱신 시각 한 건을 localStorage 표시 Snapshot으로 보관해 첫 렌더 전에 복원합니다. 별도 스케줄·Background Projection·다건 이력은 만들지 않습니다.
- 표시 Snapshot은 권위 판정에 사용하지 않고 Canonical snapshot이 도착하면 즉시 교체합니다. transient Auth·네트워크·listener 오류는 이미 표시한 정상값을 지우지 않으며, 정상 snapshot이 잔액 없음 또는 선택 대상 부재를 확인한 경우에만 `NoData`로 수렴합니다.

### 8.3 Producer contract

Android parser는 Payment Capture가 소유한 비식별 경기·대전·세종 fixture에서 `BalanceObservation.v1`을 생성합니다. Local Currency consumer contract는 해당 DTO snapshot만 공유하며 알림 원문 fixture나 parsing 정책을 소유·복제하지 않습니다. 지원하지 않는 type/version은 `ContractFailure(UNSUPPORTED_LOCAL_CURRENCY_TYPE)`이며 원문 저장으로 fallback하지 않습니다.

## 9. 오류·보안·관측성

### 9.1 오류 코드

| 분류 | 코드 예 |
|---|---|
| 검증 | `BALANCE_MUST_BE_INTEGER`, `OBSERVATION_ID_REQUIRED`, `LOCAL_CURRENCY_TYPE_REQUIRED`, `INVALID_OBSERVED_AT`, `SOURCE_TYPE_REQUIRED`, `PARSER_METADATA_REQUIRED`, `RAW_PAYLOAD_NOT_ALLOWED` |
| 계약 | `UNSUPPORTED_OBSERVATION_VERSION`, `UNSUPPORTED_LOCAL_CURRENCY_TYPE`, `IDENTITY_POLICY_VERSION_MISMATCH` |
| 충돌 | `IDEMPOTENCY_PAYLOAD_MISMATCH`, `BALANCE_VERSION_MISMATCH` |
| 저장 | `LEGACY_DUPLICATE_BALANCES`, `BALANCE_REPOSITORY_UNAVAILABLE` |
| 조회 | `BALANCE_NOT_OBSERVED`, `BALANCE_READ_CONTRACT_FAILURE` |

### 9.2 보안

- Record Command는 일반 client가 아니라 검증된 Payment Capture SystemActor만 호출합니다.
- householdId는 Actor와 일치해야 하며 parser가 보낸 tenant 값을 신뢰하지 않습니다.
- Canonical write, receipt, Outbox는 server-only입니다.
- Read Contract는 같은 household Membership과 selector 범위를 Rules로 강제합니다.
- 금융 알림 원문, package/title/body, 개별 잔액을 일반 로그에 기록하지 않습니다.
- diagnostic 원문 정책은 [DEC-002](../../../../governance/decisions.md#dec-002)의 Android Diagnostic Adapter에만 적용됩니다.

### 9.3 관측성

observationId의 비가역 표기, balance identity hash, type code, result status, aggregateVersion, 오래된 관찰 무시 횟수와 repository retry를 기록합니다. 금액은 metric label이나 trace attribute에 넣지 않습니다. legacy duplicate 발견은 migration metric과 제한된 운영 경고로 남깁니다.

## 10. 목표 패키지 구조

아직 없는 경로는 `목표`입니다.

```text
functions/src/contexts/household-finance/local-currency/
  domain/
    balance/
    observation/
    policies/
  application/
    commands/
    queries/
    participants/
    ports/in/
    ports/out/
  adapters/
    out/firestore/
    out/legacy-firestore/
  public.ts

web/src/features/local-currency/
  application/
  adapters/firestore-read-model/
  presentation/
  public.ts

contracts/schemas/
  commands/balance-observation-v1.schema.json
  events/local-currency-balance-changed-v1.schema.json
  read-models/local-currency-balance-v1.schema.json
```

Android는 생성된 observation DTO만 공유하고 LocalCurrencyBalance Domain이나 Firestore DTO를 복제하지 않습니다.

## 11. 테스트 설계

### 11.1 계층별 suite

- Domain Unit: 정수 금액, identity policy contract, observation 최신 순서, stale 처리.
- Application: capability, receipt replay/conflict, 독립 transaction result, typed failure.
- Contract: Payment Capture producer가 공개한 경기·대전·세종 DTO snapshot, intake schema, legacy type default.
- Repository Conformance: Fake/Legacy/V2의 NoData·duplicate·version 의미.
- Emulator: 같은 identity 동시 upsert, callback 2회, Balance+receipt+Outbox 원자성, Rules.
- Client: data/noData/failed stream.
- E2E: balance-only, 거래 성공/잔액 실패, 거래 실패/잔액 성공.

### 11.2 요구사항 추적 표

| 요구사항 ID | 테스트 수준 | 테스트 대상 | 핵심 fixture/경계값 | 관찰 결과 | Canonical 테스트 ID |
|---|---|---|---|---|---|
| BAL-001 | Consumer Contract·Application | BalanceObservation.v1 intake | Payment Capture가 생성한 경기·대전·세종 DTO, household 없음, 비정수·지원하지 않는 type/version·원문 혼입 | 검증된 정수/type DTO만 Balance·receipt·Event로 commit하며 parser 재실행 없음 | T-BAL-001; producer는 T-PARSE-001 |
| BAL-002 | Policy·Repository·Emulator | BalanceIdentity/upsert | 없음·있음, 경기·대전·세종, 같은/다른 유형 동시 observation, legacy 중복 | 가구·유형 identity별 결정 문서 하나와 독립 최신값 | T-BAL-002, T-BAL-005, T-BAL-007 |
| BAL-003 | Contract·Repository | persistence Mapper | currencyType 있음/누락, 양수·0·음수 정수, observed/updatedAt | 모든 필드와 정수 부호 보존, 누락 type은 legacy-unknown/지역화폐, 음수 전용 상태 없음 | T-BAL-003, T-BAL-007 |
| BAL-004 | Read Contract·Client | GetBalance/SubscribeBalance | 마지막 정상 표시 Snapshot, 선택 type, 유형 하나, 최신 변경, 선택 없음, NoData, listener/Repository 실패, 여러 문서 | 가구별 표시값을 첫 렌더 전에 복원하고 Canonical 가구 하위 경로로 수렴하며 transient 오류에는 이미 표시한 정상값을 보존 | T-BAL-004, T-BAL-006 |
| BAL-005 | Application·Context Contract·Emulator | 독립 RecordBalanceObservation receipt와 branch 종단 fixture | balance-only, 거래 거부/실패+잔액 성공, 거래 성공+잔액 retry, 같은 key replay | 성공 branch rollback·재호출 없이 실패 branch만 재시도하고 version/Event 중복 없음 | T-BAL-008; coordinator는 T-ING-BAL-001 |

`T-BAL-005`는 DEC-008의 유형별 identity를 Canonical 동작으로 검증합니다. household singleton 구현은 신규 Writer의 Conformance 대상에서 제외하고 migration fixture로만 검증합니다.

## 12. 미결정 사항과 구현 순서

### 12.1 확정·미결정 정책

| 정책 | 격리 지점 | 동작 |
|---|---|---|
| [DEC-048](../../../../governance/decisions.md#dec-048)의 직접 조회 원칙 | `BalanceReadContractPort` | 최신 관찰 문서를 직접 읽고 Projection freshness를 만들지 않음 |
| [DEC-057](../../../../governance/decisions.md#dec-057)의 선택 지역화폐 상세 범위 | Ledger `ListLocalCurrencyTransactions`, Home detail navigation | 홈 카드의 단일 선택 type만 전달하고 상세 내부 전환 UI·legacy 임의 귀속 없음 |

### 12.2 구현 순서

1. Payment Capture의 경기·대전·세종 `T-PARSE-001` producer fixture를 Canonical 선행 계약으로 연결하고 이 모듈에서는 parser를 구현하지 않습니다.
2. `BalanceObservation.v1` consumer schema와 TS/Kotlin DTO snapshot conformance를 추가합니다.
3. `RecordBalanceObservation` Application과 Legacy Repository Adapter를 도입해 Android direct write를 대체합니다.
4. NoData/Failure가 분리된 `GetBalance`·`SubscribeBalance` contract를 활성화합니다.
5. receipt·latest observation·동시 upsert·Outbox Emulator test를 활성화합니다.
6. 유형별 V2 key로 duplicate reconciliation/backfill/shadow read를 수행합니다.
7. **완료:** Web read를 선택 유형 기반 Canonical 경로로 전환하고 root `balances` direct access와 first-document 동작을 제거합니다. 가구별 마지막 정상값 한 건만 첫 표시용으로 복원하고 권위 구독으로 교체합니다.
