# Payment Capture Bounded Context 요구사항 지도

> 문서 유형: Business Bounded Context  
> 소유 기능 모듈: 결제 설정, Android 결제 수집, Shortcut 결제 수집  
> 소유 요구사항: 63개  
> 목표 구조: [목표 Clean Architecture 설계](../../../architecture/target-clean-architecture.md#5-bounded-context와-기능-모듈)

## 1. 책임과 경계

Payment Capture Context는 **외부 결제·잔액 관찰을 신뢰 가능한 거래 생성·취소와 잔액 갱신 의도로 변환하는 과정**을 소유한다. 등록 카드와 가맹점 규칙을 기준정보로 관리하고, Android 알림과 iOS Shortcut이라는 서로 다른 입력 채널을 하나의 채널 중립 `CaptureEnvelope.v1`으로 수렴시킨다. Envelope는 선택적 `paymentObservation`·`balanceObservation` 중 하나 이상을 가지며 Shortcut은 payment branch만 사용한다.

논리적으로는 하나의 업무 Context지만 물리 실행 위치는 나뉜다.

- Android: OS 알림 접근, 출처 선택, 공급자별 parser, 로컬 Queue
- Functions Shortcut Adapter: HTTP 인증·정규화·Shortcut parser
- Functions Payment Intake: ActorContext, 설정 조회, fingerprint, 승인·취소 조정

포함 범위:

- 등록 카드와 가맹점 mapping 규칙
- Android 알림 envelope·출처·공급자별 승인/취소 parser
- Shortcut 요청 검증·정규화·카드 message parser
- 채널 중립 CaptureEnvelope와 branch별 CaptureDecision
- 카드·가맹점 설정을 적용한 거래 초안
- DEC-003 결제 fingerprint 정책
- 취소 후보 탐색 요청과 신뢰도 판정
- 임시 parser Diagnostic Adapter

제외 범위:

- Transaction의 최종 저장·분할·그룹 취소 원자성
- Category Catalog와 LocalCurrencyBalance의 최종 저장
- FCM 대상·전송·실패 endpoint 정리
- QuickEdit UI와 Android 오버레이 권한
- 알림 원문을 영구 업무·감사 데이터로 승격하는 작업

## 2. 내부 기능과 요구사항

| 기능 모듈 | 요구사항 | 개수 | 독립 책임 | 상세 소유 문서 |
|---|---|---:|---|---|
| 결제 설정 | CARD-*, MER-* | 12 | Card Registry, MerchantRuleSet, 카테고리 참조 변경 | [결제 설정](modules/payment-configuration/requirements.md) |
| Android 결제 수집 | ING-*, PARSE-*, ING-SAVE-*, CAN-* | 38 | Android source·parser·암호화 Queue·승인·취소 후보 | [Android 결제 수집](modules/android-payment-ingestion/requirements.md) |
| Shortcut 결제 수집 | IOS-* | 13 | HTTP 입력·정규화·Shortcut parser·응답 | [Shortcut 결제 수집](modules/shortcut-ingestion/requirements.md) |
| 합계 |  | 63 |  |  |

## 3. 공통 언어

| 용어 | 의미 |
|---|---|
| Payment Observation | `CaptureEnvelope.v1.paymentObservation`에 들어가는 승인 또는 취소 증거 branch. 독립 최상위 wire 계약이 아님 |
| Source Evidence | package, source type, parser ID처럼 출처 신뢰를 판단하는 정보 |
| Card Evidence | 카드사와 마스킹 번호 등 등록 카드 판정에 쓰는 최소 정보 |
| Merchant Mapping | 규칙에 따른 가맹점·카테고리·메모 치환 결과 |
| Payment Fingerprint | 가구·날짜·시간·금액·정규 가맹점으로 만든 DEC-003 중복 key |
| Capture Decision | Created, Duplicate, Ignored, NeedsConfirmation, Failed 결과 |
| Cancellation Candidate Facts | Ledger가 반환한 거래 ID·그룹 ID·날짜·시각·금액·저장 가맹점 등의 원장 사실 |
| Cancellation Match Policy | Candidate Facts와 취소 관찰을 비교해 금액·정규 가맹점·카드 완전 일치와 후보 유일성을 판정하는 Capture 정책 |
| Parser Fixture | 개인정보를 제거한 parser 회귀 입력 |
| Diagnostic Adapter | parser 안정화 기간에만 원문을 제한 수집하는 제거 예정 기술 경계 |

## 4. Aggregate와 소유 데이터

| 기능 모듈 | Aggregate·데이터 | 핵심 불변식 | 현재 저장 |
|---|---|---|---|
| Payment Configuration | CardRegistry | 가구·member·card company·last digits 유일성, 안정 순서 | `registered_cards` |
| Payment Configuration | MerchantRuleSet | 좁은 match type 우선, exact token 유일성, non-exact 유형별 고유 priority | `merchant_rules` + uniqueness claims |
| Android Capture | Parser Registry·fixture | 같은 입력에 결정적인 Observation | 코드·테스트 자료 |
| Shortcut Capture | Request/Response·parser contract | 인증·필수 입력·오류·응답 구분 | Functions HTTP 계약 |
| Payment Intake | CaptureEnvelope·Fingerprint | schemaVersion·idempotencyKey·payloadHash를 가진 채널 중립 입력, 독립 payment/balance branch와 단일 중복 정책 | Envelope는 영속 Aggregate가 아닌 Application 값 |
| Payment Intake | CaptureSubmissionReceipt | 가구·idempotencyKey별 payloadHash와 처리 상태·typed result를 연결 | 목표 `captureSubmissionReceipts` |
| Payment Intake | CancellationMatchPolicy | Ledger 사실과 Observation에서 완전 일치·후보 유일성·처리 결정을 계산 | 저장소가 없는 Domain Policy |
| Diagnostic Adapter | 파서 진단 원문·actor scope·수집 시각 | Domain/Event 비승격, 기능 제거 전까지 전부 보존 | 임시 `notification_debug_logs` |

Ledger의 Transaction과 fingerprint claim 문서는 Household Finance가 최종 저장한다. Payment Capture는 fingerprint의 의미와 거래 초안을 소유하고 Ledger의 `RecordCapturedTransaction`을 호출한다.

CaptureSubmissionReceipt는 원문을 저장하지 않고 정규화된 최소 payload의 hash, schema/parser version, downstream command key, 최종 typed result만 보존한다. 같은 `(householdId, idempotencyKey)`와 같은 payloadHash는 기존 처리 상태 또는 결과를 재생하고, 같은 key에 다른 payloadHash가 들어오면 `IdempotencyConflict`를 반환하며 Ledger·Local Currency를 호출하지 않는다.

## 5. Context 불변식

1. 알려진 parser 결과도 서버 ActorContext와 가구 범위를 통과해야 한다.
2. 알림 출처와 message parser 결과를 서로 다른 증거로 보존한다.
3. 카드 번호는 숫자 마지막 네 자리 등 공개 계약에 따라 정규화한다.
4. 등록 카드와 가맹점 mapping 결과는 Web·Android에서 같은 fixture에 동일해야 한다.
5. Merchant Rule은 대소문자·공백을 정규화하고 `exact → startsWith → endsWith → contains`의 좁은 match type을 priority보다 먼저 적용한다. exact keyword token과 같은 non-exact match type의 priority는 가구 안에서 중복될 수 없다.
6. Android와 Shortcut은 영속 거래 중복을 각자 판정하지 않는다.
7. fingerprint는 DEC-003 tuple에 카드와 source를 포함하지 않는다.
8. 거래 생성과 fingerprint claim의 최종 원자성은 Ledger가 보장한다.
9. 거래 결과와 지역화폐 잔액 결과는 별도로 관측한다.
10. 저장이 확인되기 전에 성공 broadcast나 QuickEdit을 실행하지 않는다.
11. 금액·정규 가맹점·카드 완전 일치 후보가 없으면 아무 원장 데이터도 변경하지 않고, 완전 일치 후보가 여러 건이면 임의 자동 삭제 대신 `NeedsConfirmation`을 표현해야 한다.
12. 알림 원문은 Wire Contract, Outbox, Domain Event에 포함하지 않는다.
13. 같은 idempotencyKey·payloadHash 재시도는 같은 Capture 결과로 수렴한다.
14. 같은 idempotencyKey에 다른 payloadHash가 들어오면 `IdempotencyConflict`이며 어떤 Canonical 데이터도 변경하지 않는다.
15. 취소의 완전 일치·후보 유일성 판정은 `CancellationMatchPolicy`만 소유하고 Ledger query는 원장 사실만 제공한다.
16. 가구 purge는 같은 processId·checkpoint 재호출에 안전하며 receipt·설정·가구 범위 진단 표본을 page 단위로 정리한다.
17. Android·Shortcut 카드 승인은 인증된 현재 멤버의 등록 카드만 대상으로 일치 여부를 판단하며, 다른 가구원의 카드 등록 상태는 결과에 영향을 주지 않는다.
18. 연도 없는 결제 시각은 서울 수신 시각보다 미래가 아닌 가장 가까운 연도로 추론하며 Android·Shortcut이 같은 versioned Policy와 fixture를 사용한다.
19. Shortcut 카드사 헤더가 없거나 지원하지 않는 카드사이면 추정하지 않고 입력을 거부한다.
20. 원거래 없는 취소는 아무 데이터도 변경하지 않고 종료하며 보류·억제 기록 없이 이후 승인을 일반 입력으로 처리한다.
21. Android 결제 observation은 Keystore 키 기반 AES-256-GCM 로컬 Queue에 최대 72시간만 보관하고 terminal·로그아웃·멤버/가구 변경·만료 시 삭제한다.
22. 완전 일치하는 유일한 취소 대상은 같은 capture lineage의 원본·모든 파생 지출을 자동 원자 삭제하며, 다른 승인 lineage와 합쳐졌다면 다른 원본은 보존·복원한다.

## 6. 공개 계약과 의존 방향

### 제공 계약

| 기능 | 공개 계약 |
|---|---|
| 설정 | `RegisterCard`, `ManageCards`, `ResolveCard`, `ManageMerchantRules`, `ResolveMerchantMapping`, `RemapMerchantRuleCategoryReferences` |
| 공통 Intake | `SubmitCaptureEnvelopeV1` |
| Android | `ParseNotification`, `QueueObservation`, `SubmitQueuedObservation` |
| Shortcut | `ProcessShortcutRequestV1`과 versioned HTTP response |
| Context Lifecycle | `PurgeHouseholdData(householdId, processId, checkpoint)` → 공통 `PurgePageResult` |

`PurgeHouseholdData`는 일반 가구 논리 삭제에서 호출하지 않으며 별도 승인된 Access `HouseholdPurgeProcess`의 수동 영구 삭제 요청만 허용한다.

### 소비 계약

- Access & Household: ActorContext와 Membership
- Category Catalog: **Payment Configuration**이 Merchant Rule mapping의 category reference와 기본값을 검증할 때 소비하고, Category Archive Process에는 설정 참조 변경 Command를 제공
- Ledger: `RecordCapturedTransaction`, 사실 전용 `FindCancellationCandidates`, `CancelCapturedLineage`
- Local Currency: `RecordBalanceObservation`
- Notifications: 현재 호환 응답의 전달 상태 또는 비동기 Notification Intent
- Clock, Queue, HTTP credential

### 내부 소비 Output Port

- `DiagnosticSink.WriteDiagnosticSample`: [DEC-002](../../governance/decisions.md#dec-002)의 임시 Diagnostic Adapter만 구현한다. 다른 Context나 클라이언트에 공개하지 않으며 실패가 승인·취소 결과를 바꾸지 않는다.
- Capture Receipt Repository: idempotency claim·payloadHash 충돌·typed result 재생을 담당한다.
- 공통 purge 저장 Port: Capture가 소유한 household-scoped page만 처리하고 [공통 paged purge 결과](../../cross-cutting/data-ownership.md#41-공통-paged-purge-계약)를 반환한다.

Input Adapter가 Finance Repository를 직접 알지 못하고 Payment Intake Application Port를 호출한다.

## 7. 승인·취소 종단 흐름

### 승인

```text
Android/Shortcut input
  → channel parser
  → CaptureEnvelope.v1(paymentObservation? + balanceObservation?)
  → ActorContext·source policy
  → CaptureSubmissionReceipt claim·payloadHash 검증
  → ResolveCard + ResolveMerchantMapping
  → PaymentFingerprint 생성
  → Ledger.RecordCapturedTransaction
  → Created | Duplicate
  → CaptureSubmissionReceipt typed result 확정
  → 선택 BalanceObservation 독립 반영
  → 채널별 typed result
```

Ledger는 fingerprint claim, Transaction, Outbox를 한 Firestore transaction으로 저장한다. 같은 Android 이벤트 재전송과 Android·Shortcut 교차 채널 동시 요청 모두 거래 한 건으로 수렴해야 한다.

동일 idempotencyKey의 재호출은 receipt 상태를 재조정해 동일한 downstream command key를 사용한다. key는 같지만 payloadHash가 다르면 fingerprint 비교 이전에 `IdempotencyConflict`로 종료한다.

### 취소

```text
CancellationObservation
  → source/parser/mapping
  → Ledger.FindCancellationCandidates (원장 사실)
  → Capture.CancellationMatchPolicy (완전 일치·후보 유일성)
  → 확정: Ledger.CancelCapturedLineage
  → 애매함: NeedsConfirmation
  → 없음: NotFound
```

Payment Capture가 완전 일치와 후보 유일성 등 처리 의미를 정하지만 실제 원본·파생 지출 삭제와 다른 lineage 복원은 Ledger만 수행한다. Ledger는 Capture의 가맹점 일치 정책을 알지 않는다.

상세 흐름은 [Android 승인·취소와 Shortcut 종단 흐름](../../system/flows.md#3-android-승인-알림)을 따른다.

## 8. 제품 결정과 Human in the loop

| 결정 | 영향 |
|---|---|
| [DEC-001](../../governance/decisions.md#dec-001) | 월 분할 거래 취소 시 원장 금액 정책 소비 |
| [DEC-002](../../governance/decisions.md#dec-002) | Diagnostic Adapter의 격리와 제거 |
| [DEC-003](../../governance/decisions.md#dec-003) | fingerprint tuple과 중복 결과 |
| [DEC-005](../../governance/decisions.md#dec-005) | 허용 package/source 정책 |
| [DEC-007](../../governance/decisions.md#dec-007) | 도시가스 accounting date와 due date |
| [DEC-012](../../governance/decisions.md#dec-012) | 가맹점 불일치 후보 제외와 원거래 부재 시 무변경 |
| [DEC-013](../../governance/decisions.md#dec-013) | Android·iPhone Shortcut의 필수 creator와 채널별 후속 UX |
| [DEC-023](../../governance/decisions.md#dec-023) | parser의 현재 날짜·연말 판정과 회계 LocalDate를 Asia/Seoul로 고정 |
| [DEC-028](../../governance/decisions.md#dec-028) | Android·Shortcut 카드 승인은 호출자 본인 소유 등록 카드가 하나 이상 일치할 때만 생성하며 타 멤버 카드는 후보에서 제외 |
| [DEC-029](../../governance/decisions.md#dec-029) | 연도 없는 결제 시각은 서울 수신 시각보다 미래가 아닌 가장 가까운 연도로 추론하고 채널별 휴리스틱 제거 |
| [DEC-030](../../governance/decisions.md#dec-030) | Shortcut 카드사 헤더 누락·미지원은 삼성 등으로 추정하지 않고 입력 거부 |
| [DEC-031](../../governance/decisions.md#dec-031) | 원거래 없는 취소는 무변경 종료하고 이후 승인을 억제·재조정하지 않음 |
| [DEC-032](../../governance/decisions.md#dec-032) | Android 로컬 Queue는 원문 없이 암호화하고 최대 72시간 보관하며 명시 삭제 조건 적용 |
| [DEC-041](../../governance/decisions.md#dec-041) | 완전 일치하는 유일한 취소는 같은 capture lineage의 원본·모든 파생 지출을 자동 삭제하고 다른 결제 lineage를 보존 |
| [DEC-042](../../governance/decisions.md#dec-042) | 가맹점 mapping은 좁은 match type을 먼저 적용하고 exact token·non-exact 유형별 priority 중복을 원자 차단 |
| [DEC-046](../../governance/decisions.md#dec-046) | terminal CaptureSubmissionReceipt는 30일 보존하고 fingerprint claim·cancellation tombstone은 업무 수명주기를 적용 |
| [DEC-047](../../governance/decisions.md#dec-047) | `notification_debug_logs`는 TTL 없이 전부 보존하고 진단 기능 제거 시 수집 경로와 컬렉션을 함께 제거 |

Notifications의 [DEC-020](../../governance/decisions.md#dec-020)에 따라 Shortcut 생성자의 모든 활성 iPhone 홈 화면 PWA endpoint가 대상이 되며, 이 Context는 endpoint 등록·로그아웃·상태 정책을 소유하지 않는다.

남은 정책은 [미결정 사항 단일 목록](../../governance/pending-decisions.md)에서 관리합니다. Shortcut credential은 [DEC-033](../../governance/decisions.md#dec-033), 파생 거래 취소는 [DEC-041](../../governance/decisions.md#dec-041), 가맹점 규칙 선택은 [DEC-042](../../governance/decisions.md#dec-042), 서버 receipt 보존은 [DEC-046](../../governance/decisions.md#dec-046), 임시 진단 보존은 [DEC-047](../../governance/decisions.md#dec-047), 등록 카드 identity와 수정·퇴역 범위는 [DEC-059](../../governance/decisions.md#dec-059)로 확정되었습니다.

## 9. 테스트 소유권

상세 테스트는 각 기능 문서가 소유한다.

- [Payment Configuration 테스트](modules/payment-configuration/requirements.md#8-모듈-테스트-시나리오)
- [Android Capture 테스트](modules/android-payment-ingestion/requirements.md#9-모듈-테스트-시나리오)
- [Shortcut Capture 테스트](modules/shortcut-ingestion/requirements.md#9-모듈-테스트-시나리오)

Context 경계에서 추가로 묶어 검증한다.

- 같은 Observation의 Queue 재시도 → 같은 결과 재생
- 같은 idempotencyKey·같은 payload → 저장 결과와 downstream command key 재생
- 같은 idempotencyKey·다른 payload → `IdempotencyConflict`, Ledger·잔액 변경 없음
- Android·Shortcut 같은 DEC-003 tuple 동시 전송 → Ledger 거래 한 건
- 같은 card/rule 동시 생성 → uniqueness claim 한 건
- 낮은 priority exact와 높은 priority contains 동시 일치 → exact, 겹치는 contains → 고유 최고 priority 한 건
- exact token·non-exact priority 동시 생성/재정렬 → 충돌 규칙 0건 또는 전체 고유 순서 commit
- 동일 JSON fixture의 TypeScript·Kotlin DTO 호환
- 저장 실패 → QuickEdit·성공 broadcast 없음
- 같은 Ledger candidate facts에 가맹점 정규화 규칙만 변경 → Ledger 결과는 같고 Capture의 일치 판정만 변경
- 취소 그룹 일부 실패 → 모든 원거래 유지
- 수정·분할·합치기 파생 취소 → 같은 lineage 전체 삭제, 다른 lineage 복원, 최소 receipt 유지
- Diagnostic TTL·권한·마스킹·제거 fixture 전환
- purge page 재전달 → receipt·카드·규칙은 멱등 삭제되고 다른 Context 데이터는 유지

## 10. 변경 경계 확인

- 새 Android parser 추가가 Ledger·Web·Firestore schema를 수정하지 않아야 한다.
- Shortcut HTTP 인증 변경이 Android parser에 영향을 주지 않아야 한다.
- Merchant Rule 변경이 Budget Domain으로 이동하지 않아야 한다.
- 결제 중복 정책 변경은 Payment Fingerprint Policy와 Ledger contract test로 국소화되어야 한다.
