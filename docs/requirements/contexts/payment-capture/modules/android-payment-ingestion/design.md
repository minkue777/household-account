# Android 결제 알림 수집 모듈 상세 설계

> 설계 대상: [`ING-*`, `PARSE-*`, `ING-SAVE-*`, `CAN-*` 요구사항](requirements.md#5-요구사항) 38개  
> 상위 Context: [Payment Capture](../../requirements.md)  
> 공통 형식: [모듈 상세 설계 규약](../../../../governance/module-design-standard.md)  
> 종단 흐름: [Android 승인](../../../../system/flows.md#3-android-승인-알림), [Android 취소](../../../../system/flows.md#4-android-취소-알림)  
> 목표 아키텍처: [목표 Clean Architecture 설계](../../../../../architecture/target-clean-architecture.md#82-androidshortcut-결제-승인)

## 1. 설계 목적과 추적성

이 설계는 Android OS 알림을 잃지 않고 해석하되, 서버만 카드·가맹점 설정, 영속 중복, 거래 생성·취소를 최종 판정하도록 경계를 고정합니다. 기능 모듈 하나가 두 런타임에 걸쳐 있으므로 다음 두 부분을 명시적으로 분리합니다.

```text
Android Edge
  NotificationEnvelope → source 선택 → 공급자 parser
  → CaptureEnvelope.v1(payment? + balance?) → 암호화 Queue

Functions Payment Intake
  ActorContext → source Policy → receipt → Configuration → fingerprint/cancellation Policy
  → Ledger/Local Currency 공개 Port → typed Capture result
```

목표 운영 경로에서 서버 Intake는 금융 알림 원문을 다시 parse하지 않으며 Android가 정규화한 `CaptureEnvelope.v1`만 처리합니다. 마이그레이션 기간의 TypeScript parser는 기존 Kotlin parser와 동일한 입력 계약을 검증하기 위한 실행 가능한 호환성 기준이며 서버 Intake의 원문 parsing 책임이 아닙니다. 반대로 Android는 Payment Configuration, Ledger, Local Currency 저장소를 직접 읽거나 쓰지 않습니다. 이 책임 분리가 [목표 SSOT](../../../../../architecture/target-clean-architecture.md#122-typescriptkotlin-사이의-공유)입니다.

11절은 이 모듈이 소유한 38개 요구사항 ID를 모두 포함하며 Canonical `T-*`에 연결합니다.

## 2. 모듈 경계와 책임

### 2.1 Android Edge 책임

- Android 알림 필드에서 결정적인 `NotificationEnvelope`를 만듭니다.
- package 증거와 본문 패턴을 분리해 보존하고 우선순위상 parser 하나를 선택합니다.
- 공급자별 승인·취소 parser와 비식별 golden fixture를 소유합니다.
- 프로세스 수명 30초 중복 cache를 소유하되 이를 영속 거래 중복으로 사용하지 않습니다.
- 원문 없는 `CaptureEnvelope.v1`과 존재하는 결제·잔액 branch별 안정 idempotency key를 암호화 Queue에 저장하고 재전송합니다.
- 확정 서버 결과가 온 뒤에만 Queue 확정, 완료 broadcast, QuickEdit 후속 효과를 실행합니다.
- [DEC-002](../../../../governance/decisions.md#dec-002)의 원문 수집을 제거 가능한 `DiagnosticSink` 뒤에 둡니다.

### 2.2 Functions Payment Intake 책임

- 인증 자격을 서버 `ActorContext`로 바꾸고 가구 범위와 [DEC-005](../../../../governance/decisions.md#dec-005) source Policy를 검증합니다.
- `CaptureSubmissionReceipt`로 transport 멱등성과 payload 충돌을 판정하고 거래·잔액 branch의 stage와 typed result를 독립 보존합니다.
- Payment Configuration의 공개 Port로 카드·가맹점 mapping을 한 번만 판정합니다.
- [DEC-003](../../../../governance/decisions.md#dec-003)의 versioned fingerprint를 한 번만 계산합니다.
- Ledger의 공개 Port로 거래 생성, 후보 조회, 원자 취소를 요청합니다.
- 지역화폐 잔액 관찰을 거래 결과와 분리해 Local Currency Port로 보냅니다. balance-only와 거래 거부+잔액 성공을 정상 조합으로 지원합니다.
- 취소 candidate facts에 `CancellationMatchPolicy`를 적용해 금액·정규 가맹점·카드 완전 일치 후보만 남기고, 없으면 원장 변경 없이 `NotFound`로 종료합니다.

### 2.3 소유하지 않는 책임

- Ledger가 Transaction, fingerprint claim, 분할 그룹 취소의 Canonical Writer입니다.
- Payment Configuration이 카드와 가맹점 Policy를 소유합니다.
- Local Currency가 잔액 Aggregate를 소유합니다.
- Android Host가 알림 접근·오버레이 권한과 QuickEdit UI를 소유합니다.
- Notifications가 [DEC-013](../../../../governance/decisions.md#dec-013)의 채널별 수신 대상과 FCM 전달을 소유합니다. Intake는 creator를 `ActorContext.actingMemberId`에서 필수로 도출하고 업무 source 및 `originChannel=android-notification`과 함께 Ledger에 전달할 뿐 수신자를 선택하지 않습니다.

## 3. 공개 계약

공통 envelope, `ActorContext`, Result union은 [상세 설계 규약](../../../../governance/module-design-standard.md#3-공통-application-계약)을 참조하며 여기서 복제하지 않습니다.

### 3.1 Android 내부 계약

```kotlin
data class NotificationEnvelope(
    val packageName: String,
    val postedAt: Instant?,
    val title: String?,
    val text: String?,
    val bigText: String?,
    val textLines: List<String>,
    val selectedBody: String,
    val parseText: String,
)

data class ParsedNotificationObservation(
    val transactionCandidate: ParsedTransactionCandidate?,
    val balanceCandidate: BalanceCandidate?,
)

sealed interface ParsedTransactionCandidate {
    data class Approval(val evidence: PaymentCandidateEvidence) : ParsedTransactionCandidate
    data class Cancellation(val evidence: CancellationCandidateEvidence) : ParsedTransactionCandidate
}
```

`selectedBody`는 비어 있지 않은 `textLines.joinToString("\n")` → `bigText` → `text` 순입니다. `parseText`는 비어 있지 않은 제목을 첫 줄로 두고 `selectedBody`를 이어 붙입니다. 둘 다 비면 `Ignored(EMPTY_NOTIFICATION)`입니다.

### 3.2 `CaptureEnvelope.v1`

```ts
interface CaptureEnvelopeV1 {
  contractVersion: 'capture-envelope.v1';
  observationId: string;
  originChannel: 'android-notification' | 'ios-shortcut';
  sourceEvidence:
    | {
        kind: 'android-registered-package';
        sourceType: string;
        packageName: string;
        registryVersion: string;
      }
    | {
        kind: 'ios-shortcut-credential';
        sourceType: 'ios-shortcut';
        credentialIdHash: string;
      };
  observedAt: string;
  parser: { parserId: string; parserVersion: string };
  rawPayloadHash: string;
  paymentObservation?: {
    branchId: string;
    observationType: 'approval' | 'cancellation';
    amountInWon: number;
    occurredLocalDate?: string;
    occurredLocalTime?: string;
    zoneId: 'Asia/Seoul';
    merchantEvidence: { rawCandidate: string };
    cardEvidence?: { companyLabel: string; maskedToken?: string };
    localCurrencyType?: string;
    dueDate?: string;
  };
  balanceObservation?: {
    branchId: string;
    currencyType: string;
    balanceInWon: number;
    observedAt: string;
  };
}
```

거래·잔액 branch 중 하나 이상이 있어야 합니다. `branchId`와 branch idempotency key는 최초 parse 때 한 번 만들고 retry에서 바꾸지 않습니다. 지역화폐 parser가 payment branch의 유형을 검증한 경우에만 `localCurrencyType`을 함께 전달하며 홈 선택값이나 balance branch의 존재만으로 추정하지 않습니다. `rawCandidate`는 parser가 추출한 가맹점 후보이지 전체 알림 원문이 아닙니다. 제목, 전체 본문, `textLines`는 Wire DTO, Queue payload, receipt, Domain Event, 일반 로그에 포함하지 않습니다. `rawPayloadHash`는 기기 안에서 원문으로 계산한 versioned hash이며 역추적 가능한 원문은 저장하지 않습니다.

### 3.3 공개 Input Port

| 이름·종류 | 호출자 | 입력 | 결과 | 권한 | 일관성·멱등성 |
|---|---|---|---|---|---|
| `ParseNotification` Android Use Case | Notification Listener Adapter | `NotificationEnvelope` | `ParsedNotificationObservation` 또는 `Ignored` | OS listener capability | 순수 계산 + 30초 process cache; 영속 쓰기 없음 |
| `QueueObservation` Android Command | parser application | observation, queue key | `Queued(queueEntryId)`·`AlreadyQueued`·local failure | Android authenticated session | 암호화 local store transaction; `observationId` 유일 |
| `SubmitQueuedObservation` Android Use Case | WorkManager | queue entry | confirmed·duplicate·rejected·needs-review·retryable | 유효 API credential | 최초 key를 모든 retry에서 재사용 |
| `SubmitCaptureEnvelopeV1` Server Command | Android Queue·Shortcut Adapter | 공통 envelope + 선택 payment/balance branch | `CaptureSubmissionResult` | `paymentCapture:submit`와 같은 가구 Actor | receipt claim·branch별 downstream stable key·결과 재생; Shortcut은 payment branch만 사용 |

### 3.4 Capture 결과

```ts
interface CaptureSubmissionResult {
  observationId: string;
  transactionResult?: TransactionBranchResult;
  balanceResult?: BalanceBranchResult;
  completion: 'terminal' | 'partial-retryable';
}

type TransactionBranchResult =
  | { kind: 'created'; transactionId: string; editable: true; captureLineageId: string }
  | {
      kind: 'duplicate';
      existingTransactionId: string;
      editable: boolean;
      followUp:
        | { kind: 'outboxQueued'; eventType: 'CaptureDuplicateObserved.v1'; eventId: string }
        | { kind: 'notRequested' };
    }
  | { kind: 'cancelled'; transactionIds: string[]; groupId?: string }
  | { kind: 'ignored'; code: string }
  | { kind: 'rejected'; code: string }
  | { kind: 'needsConfirmation'; candidates: CancellationCandidateView[] }
  | { kind: 'notFound'; resource: 'cancellationTarget' }
  | { kind: 'retryableFailure'; code: string; retryAfter?: string };

type BalanceBranchResult =
  | { kind: 'recorded'; balanceId: string; status: 'created' | 'updated' | 'staleIgnored' }
  | { kind: 'rejected'; code: string }
  | { kind: 'retryableFailure'; code: string; retryAfter?: string };
```

존재하는 branch 결과만 포함합니다. 거래 branch가 거부되고 잔액 branch가 성공하거나, 거래가 성공하고 잔액만 retryable인 결과도 유효합니다. `completion=terminal`은 존재하는 모든 branch가 terminal일 때만 사용하고 일부만 retryable이면 `partial-retryable`입니다. 같은 `(householdId, rootIdempotencyKey)`와 같은 canonical payload hash는 branch별 저장 결과를 그대로 재생합니다. 같은 key의 다른 hash는 `Conflict(IDEMPOTENCY_PAYLOAD_MISMATCH)`이며 설정·Ledger·잔액 Port를 호출하지 않습니다.

## 4. Domain 모델과 불변식

### 4.1 Source·Parser Domain

`SourceSelector`는 먼저 `PaymentSourceRegistry`에서 package를 조회합니다. 등록되어 있으면 매핑된 source와 전용 parser 하나를 반환하고, 등록되어 있지 않으면 본문을 검사하지 않고 `UnsupportedPackage`를 반환합니다. 알려진 package가 선택된 뒤 parser가 실패해도 다른 source parser로 fallback하지 않습니다. 기존의 package 또는 본문 우선순위 선택은 `LegacySourceSelectionPolicy`와 characterization test로 격리한 뒤 제거합니다.

`AllowedPaymentSourcePolicy`는 [DEC-005](../../../../governance/decisions.md#dec-005)에 따라 package와 Registry version을 받아 `Allowed(source, parserId)` 또는 `Denied(UnsupportedPackage)`를 반환합니다. content evidence는 package 허용을 우회할 수 없습니다. Android observation에는 `sourceEvidence.kind=android-registered-package`, 원래 package와 Registry version을 보존하여 설정 변경과 오판을 추적합니다. Shortcut은 package를 꾸며내지 않고 서버가 검증한 credential의 비가역 식별 hash를 가진 `ios-shortcut-credential` evidence를 사용합니다.

각 `PaymentParser`는 순수 함수이며 `parserId`, `parserVersion`, 지원 source, `parse(envelope, Clock)`를 가집니다. 유효한 `envelope.postedAt`을 `Asia/Seoul`로 변환한 값을 모든 수신 날짜·시간·연도 추론의 기준으로 사용하고, 게시 시각이 없거나 유효하지 않을 때만 주입 `Clock`을 사용합니다. `ZoneId.systemDefault()`, `LocalDate.now()`, `LocalDateTime.now()` 같은 process 전역 시간 접근은 금지합니다. 등록 source의 parser 실패는 다른 source로 fallback하지 않고 `Ignored(stableReasonCode)`로 종료하며 Queue·서버 Capture·Canonical 변경은 만들지 않습니다. `Rejected`는 인증된 서버 제출 뒤 source 정책·입력·업무 규칙이 거부한 결과에만 사용합니다.

연도 없는 월·일·시·분은 parser별 휴리스틱으로 결정하지 않고 DEC-029의 `PaymentOccurrenceYearPolicyV1`을 사용합니다. Policy는 위에서 확정한 서울 기준 수신 시각을 입력받고 수신 연도의 후보가 수신 시각보다 미래면 전년으로 내립니다. 윤년처럼 후보가 유효하지 않으면 유효하면서 미래가 아닌 가장 가까운 과거 연도까지 탐색합니다. 같은 날짜의 미래 시각에도 허용 오차를 두지 않으며 불가능한 날짜·시각은 `INVALID_DATE` 또는 `INVALID_TIME`입니다. Kotlin과 TypeScript 구현은 `T-PARSE-003` JSON fixture로 계약을 공유합니다.

SMS Adapter는 후보마다 KB → NH → NaverPay → Toss → KakaoPay → DigitalOnnuri → Paybooc → Samsung → Lotte → Gyeonggi → Daejeon 순으로 첫 성공을 선택하고, 모두 실패하면 `SmsCardMessageParser`를 마지막에 실행합니다. Sejong과 CityGas는 이 내부 순서에 포함하지 않습니다. 순서는 이름으로 발견한 parser 목록이나 DI 등록 순서에 맡기지 않고 versioned `SmsParserOrderPolicy`와 `T-SMS-ORDER-001` fixture로 고정합니다.

CityGas parser의 최소 성공 조건은 도시가스 청구 문구와 총액입니다. 청구 제목은 선택이며 없으면 서울 수신 월과 빈 memo를 사용합니다. 납부마감일은 accounting date 후보이고 없거나 유효하지 않을 때 서울 수신일로 fallback합니다. 현재 구현은 마감일 문구가 없을 때만 fallback하고 형식은 맞지만 유효하지 않은 날짜에서 전체 parse가 실패하므로 `T-CITYGAS-001`로 교정합니다.

### 4.2 30초 process 중복

`RecentNotificationCache` key는 versioned hash `(packageName, parseText)`입니다. 최초 처리 시각부터 30,000ms 이하 재입력은 중복이고 30,001ms부터 다시 처리합니다. cache는 process 재시작 때 사라지며 서버 fingerprint나 Queue idempotency를 대체하지 않습니다.

### 4.3 Payment Intake Policy

- `MerchantNormalizationPolicyV1`은 Unicode NFC, 앞뒤 공백 제거, 연속 공백 축약, locale-neutral 소문자화를 적용합니다.
- `PaymentFingerprintPolicyV1`은 `householdId`, `occurredLocalDate`, `occurredLocalTime`, `amountInWon`, `normalizedMerchant`를 version과 함께 hash합니다. 카드, source, parser는 포함하지 않습니다.
- 카드·가맹점 결과는 Payment Configuration의 공개 결과를 그대로 사용합니다. Intake에 복사한 matching 함수는 금지합니다.
- 도시가스 외 승인은 `ActorContext.actingMemberId`를 필수 owner 범위로 전달한 `ResolveCard`가 `Eligible`이어야 합니다. 본인 카드가 하나 이상 일치하면 충분하고 타 멤버 카드는 조회하지 않습니다. 본인 카드가 여러 건 일치해도 승인하되 canonical card를 임의 선택하지 않습니다. 도시가스는 카드 match 없이 진행할 수 있습니다.
- 가맹점 mapping이 있으면 merchant/category/memo의 `replace` 항목만 반영합니다. 규칙이 없으면 도시가스는 parser의 fixed category를 유지하고 그 외는 Category Catalog의 기본 참조를 사용합니다.
- `AccountingDatePolicy`는 [DEC-007](../../../../governance/decisions.md#dec-007)에 따라 도시가스의 파싱된 due date를 accounting date로 선택합니다. due date가 없을 때만 observed date를 fallback으로 사용하며, 원래 observed timestamp는 추적 정보로 별도 보존합니다.

### 4.4 취소 Policy

`CancellationMatchPolicy` 입력은 취소 observation과 Ledger의 사실 전용 후보입니다. 후보에는 transaction/group ID, 저장 날짜·시각, 금액, 원 가맹점, 카드 증거, split count, group total과 불변 captureLineageId·capture provenance가 들어갑니다. 편집 가능한 현재 가맹점·금액을 원 승인 증거로 덮어쓰지 않습니다.

- 검색 범위는 파싱된 취소일부터 30일 전까지이며 날짜 파싱 실패 시 당일 범위입니다.
- 금액·정규 가맹점·카드가 모두 일치하는 후보만 취소할 수 있습니다.
- 월 분할 그룹은 `cancelAmount - groupTotal`이 `0..splitCount-1`원이면 [DEC-001](../../../../governance/decisions.md#dec-001) 오차로 금액 일치입니다.
- 금액·카드가 같아도 정규 가맹점이 다르면 후보에서 제외합니다. 완전 일치 후보가 없으면 [DEC-012](../../../../governance/decisions.md#dec-012)에 따라 확인 후보를 만들거나 Ledger를 호출하지 않고 `NotFound`입니다.
- 완전 일치 후보가 둘 이상이면 저장 순서로 선택하지 않고 `NeedsConfirmation`입니다.
- 완전 일치 후보가 없으면 DEC-031에 따라 `NotFound`로 끝내고 대기 취소·tombstone·미래 승인 억제 key·재조정 job을 만들지 않습니다. 이후 승인 observation은 이전 취소와 연결하지 않고 일반 승인 경로로 처리합니다.
- 일반·월 분할 후보 조회는 같은 30일 범위를 사용합니다. 현재 Android의 직접 일치 없는 split fallback이 취소 당일만 seed로 조회하는 동작은 Legacy Adapter 결함으로만 특성화합니다.
- capture lineage에 수정·항목 분할·월 분할·합치기 파생 거래가 연결되어 있어도 [DEC-041](../../../../governance/decisions.md#dec-041)의 `CancellationLineagePolicy`는 완전 일치하는 유일한 lineage를 자동 취소 대상으로 확정합니다. `NeedsConfirmation`은 완전 일치 lineage 후보가 여러 개일 때만 반환합니다.

### 4.5 Capture provenance·lineage

승인 Intake는 observationId, sourceType, parser ID/version, 원 amount, 정규화 전 merchant candidate, 최소 card evidence, occurredAt을 `CaptureProvenanceV1`으로 만들어 `RecordCapturedTransaction`에 전달합니다. Ledger가 반환한 `captureLineageId`는 QuickEdit 수정과 모든 분할·합치기 파생 거래가 유지해야 하는 내부 참조입니다.

- provenance는 append-only 내부 snapshot이며 일반 거래 수정 Command의 patch 대상이 아닙니다.
- 전체 알림 원문, title, textLines, 가구 key, 전체 카드 번호는 포함하지 않습니다.
- capture fingerprint와 provenance는 목적이 다릅니다. fingerprint는 중복 claim용 hash이고 provenance는 취소 후보 사실 복원용 최소 증거입니다.
- 파생 거래 취소는 provenance와 lineage가 모두 완전해야 하며 `CancellationLineagePolicy`가 대상 lineage를 확정합니다. 불완전 legacy lineage는 추정 삭제하지 않고 typed failure입니다.

## 5. Application Use Case 상세

### 5.1 알림 parse·Queue

1. Notification Adapter가 모든 알림 필드를 envelope로 복사하고 본문 우선순위를 적용합니다.
2. Android `DiagnosticSink`는 원문 필드와 게시 시각만 App Check·Firebase Auth가 적용된 `submitNotificationDiagnostic` callable에 best-effort로 보냅니다. 서버는 body의 actor·source 주장을 받지 않고 유일한 활성 membership과 서버 소유 진단 source registry로 household·member·source를 확정합니다. Firestore Adapter는 수집 시각을 서버에서 추가하며 시간 TTL이나 표본 삭제 metadata를 만들지 않고, 실패는 결제 parse·Queue·submit 결과와 분리합니다.
3. Source Selector가 source 하나를 선택하고 30초 cache를 claim합니다.
4. 선택 parser가 선택적인 승인·취소 후보와 선택적인 잔액 후보를 만듭니다. 거래 금액은 양의 원 단위 정수여야 하며 필수 가맹점·날짜 조건을 parser별로 검증합니다. 잔액만 유효해도 결과를 버리지 않습니다.
5. observation ID와 존재 branch별 ID·idempotency key를 한 번 생성하고 원문 없는 DTO를 암호화 Queue에 원자 저장합니다.
6. Queue 저장 실패 시 성공 broadcast나 서버 submit을 실행하지 않습니다.

### 5.2 독립 branch submit

1. HTTP Adapter가 schema·credential을 검증하고 `ActorContext`를 생성합니다.
2. Intake가 household 일치, source Policy, parser metadata와 최소 한 branch 존재를 검증합니다.
3. canonical payload hash로 root receipt를 claim하고 존재 branch별 stable downstream key와 `pending` stage를 한 번 기록합니다. 완료 branch는 결과를 재생하고 다른 payload면 즉시 `Conflict`입니다.
4. transaction branch가 있으면 금액·날짜·시간을 검증하고 `ResolveCard(ownerMemberId=ActorContext.actingMemberId)`, `ResolveMerchantMapping`, 필요 시 기본 Category Query를 호출해 거래 초안을 만듭니다. 도시가스 외 입력에서 본인 카드가 하나도 일치하지 않으면 transaction branch만 `rejected(CARD_NOT_REGISTERED_FOR_ACTOR)`로 완료합니다.
5. 승인 transaction branch는 Fingerprint V1, `CaptureProvenanceV1`, 안정적인 downstream command key를 계산하고 creatorMemberId와 함께 Ledger `RecordCapturedTransaction`을 호출합니다. Ledger는 fingerprint claim, Transaction, lineage, receipt, Outbox를 자기 transaction에서 원자 commit합니다.
6. balance branch가 있으면 transaction branch 결과와 무관하게 Local Currency `RecordBalanceObservation`을 branch key로 호출합니다. balance-only이면 Payment Configuration과 Ledger를 호출하지 않습니다.
7. 한 branch가 terminal이고 다른 branch가 retryable이면 terminal 결과를 receipt에 보존하고 미완료 branch만 같은 key로 재시도합니다. 성공 branch를 재호출하거나 다른 branch 실패로 rollback하지 않습니다.
8. `ios-shortcut`의 Duplicate처럼 호환 알림 요구가 있는 경우 Payment Intake가 `CaptureDuplicateObserved.v1`을 transaction branch 완료와 같은 Unit of Work의 Outbox에 한 번 기록합니다. Android Duplicate는 기본 `notRequested`이며 채널 Adapter가 FCM을 직접 호출하지 않습니다.
9. 존재 branch가 모두 terminal일 때 root receipt를 `completed`로, 하나라도 retryable이면 `partial-retryable`로 기록합니다. downstream commit 뒤 receipt 갱신이 실패하면 retry가 같은 branch key로 각 결과를 복구합니다.
10. Android는 terminal transaction result가 `created` 또는 `duplicate`이고 `editable=true`인 ID가 있을 때만 QuickEdit을 엽니다. balance-only·거래 거부·미확정 결과에서는 열지 않으며 모든 존재 branch가 terminal 전에는 Queue entry를 삭제하지 않습니다.

외부 FCM 전송은 이 Use Case에 없습니다. Ledger Outbox의 확정 Event를 Notifications가 소비하더라도 `android-notification` source는 `NoTarget(ANDROID_USES_QUICK_EDIT)`이며 Android가 확정 결과로 로컬 QuickEdit만 실행합니다.

### 5.3 취소 submit

1. 승인과 같은 인증·source·receipt 검증을 수행합니다.
2. Payment Configuration mapping을 적용한 뒤 Ledger `FindCancellationCandidates`에 일반·분할 공통 30일 날짜 범위와 최소 facts·capture lineage 조건을 보냅니다.
3. `CancellationMatchPolicy`가 원 capture provenance 기준 금액·정규 가맹점·카드 완전 일치 여부와 후보의 유일성·파생 여부를 판정합니다.
4. 완전 일치 후보가 없으면 `NotFound`, 둘 이상이면 `NeedsConfirmation`으로 receipt를 완료하며 Ledger 쓰기 Port는 호출하지 않습니다.
5. 유일한 완전 일치 후보의 captureLineageId, stable cancellation key와 expected lineage version을 Ledger `CancelCapturedLineage`에 전달합니다. 수정·분할·합치기 파생 여부는 사용자 확인 조건이 아닙니다.
6. Ledger가 대상 lineage의 원본·모든 파생 지출 삭제, 공유 merge의 다른 lineage 복원, 최소 canceled tombstone·receipt와 Outbox를 원자 commit한 뒤 `Cancelled`를 반환합니다.
7. commit 결과를 receipt에 기록한 후 Android 완료 상태를 갱신합니다. 일부 삭제를 성공으로 표현하지 않습니다.

### 5.4 retry 관찰 결과

Queue root 상태는 `queued → submitting → completed | partial-retryable | rejected | needs-review`이며 거래·잔액 branch는 각각 `pending → submitting → terminal | retryable` stage를 가집니다. retryable branch만 같은 key로 `queued`에 돌아가고 terminal branch result는 재생합니다. 인증 만료는 `awaiting-auth`와 영구 `rejected`를 구분합니다. `ignored`, `rejected`, `needsConfirmation`, balance-only 결과도 receipt로 재생합니다.

## 6. Port 설계

### 6.1 Android Output Port

| Port | 책임 | 실패 의미 |
|---|---|---|
| `ObservationQueuePort` | 원문 없는 observation과 branch별 key 암호화 저장, lease, branch 상태 전이 | 저장 실패는 처리 실패; 같은 ID 중복은 `AlreadyQueued`; terminal branch 재호출 금지 |
| `PaymentCaptureApiPort` | versioned schema로 서버 submit | HTTP/인증/contract/retryable을 구분 |
| `DiagnosticSink` | 원문 필드·게시 시각만 인증된 callable로 전달하고, 서버가 등록 source·actor scope·수집 시각을 확정해 기록 | 항상 비차단; actor 없음·미등록 source는 미수집; client actor/source 주장 금지; TTL·표본 삭제 없음; 실패가 parse·submit 결과를 변경하지 않음 |
| `Clock`, `IdGenerator`, `HashingPort` | 날짜 fallback, cache, observation/key/hash | 고정 fixture 사용 |
| `QuickEditResultPort` | 확정된 편집 가능 ID 전달 | 서버 commit 후에만 호출 |
| `CaptureBroadcastPort` | 확정 처리 결과 broadcast | transaction/receipt callback 안에서 호출 금지 |

### 6.2 Server Intake Output Port

| Port | 책임 | 계약 경계 |
|---|---|---|
| `CaptureReceiptRepository` | root key claim, payload hash 충돌, 거래·잔액 branch별 단계·typed result 재생 | household tenant prefix, branch compare-and-set version |
| `PaymentConfigurationPort` | `ResolveCard`, `ResolveMerchantMapping` | 공개 DTO만 사용; Repository import 금지 |
| `CategoryReferencePort` | 기본 category와 mapping 참조 확인 | missing과 provider failure 구분 |
| `LedgerCapturePort` | `RecordCapturedTransaction`, `FindCancellationCandidates`, `CancelCapturedLineage` | fingerprint·취소 대상 의미는 Capture, claim·lineage 삭제/복원 원자성은 Ledger |
| `LocalCurrencyPort` | `RecordBalanceObservation` | 거래와 독립 typed result |
| `CaptureUnitOfWork` | receipt 자체 claim·상태 변경 | Ledger transaction handle을 받거나 노출하지 않음 |
| `ObservabilityPort` | trace, parser/source version, receipt stage, latency | 원문·전체 token·카드 번호 금지 |

## 7. 저장·트랜잭션·동시성

### 7.1 Android 로컬 상태

- 30초 cache는 메모리 전용입니다.
- Queue key는 설치 범위 무작위 `observationId`이고 root key는 `android:{installationId}:{observationId}`, branch key는 이 root와 `transaction|balance`를 결합한 안정 hash입니다.
- Queue payload는 원문 없는 최소 observation이며 entry별 무작위 96-bit IV를 사용하는 `AES-256-GCM`으로 암호화합니다. 설치 전용 non-exportable 키는 Android Keystore alias로 생성하고, 백그라운드 WorkManager 실행을 위해 사용자 인증 요구 조건을 붙이지 않습니다.
- Queue lease와 branch 상태 변경은 원자적이며 WorkManager가 중복 실행돼도 한 entry를 같은 key로 전송합니다. 서버 receipt가 반환한 terminal branch는 로컬에도 표시해 다시 실행하지 않습니다.
- `expiresAt = queuedAt + 72시간`이며 WorkManager는 만료 entry를 복호화·전송하지 않고 삭제합니다. 존재하는 모든 branch가 `confirmed`, `duplicate`, 영구 `rejected`, `needs-review` 등 terminal일 때만 즉시 삭제하고 retryable branch가 하나라도 있으면 만료 전까지 해당 key를 유지합니다.
- 로그아웃·멤버 변경·가구 변경은 Queue 전체 삭제를 먼저 완료한 뒤 session을 전환합니다. entry를 새 Actor에 재연결하지 않습니다.
- Keystore 키 손실·무효화, GCM 인증 실패, schema 손상은 entry를 전송하지 않고 삭제하는 terminal local failure입니다. 관측 로그에는 entry ID hash와 오류 code만 남기고 payload를 기록하지 않습니다.

### 7.2 Server receipt

목표 `captureSubmissionReceipts/{observationKey}`의 논리 key는 `(householdId, rootIdempotencyKey)` hash입니다. 문서는 payload hash, observation ID, schema/parser version, root state와 거래·잔액 branch별 downstream command key·stage·typed result·version·timestamps를 보존하며 원문은 저장하지 않습니다.

root 상태는 `claimed → processing → completed | partial-retryable` 또는 terminal `ignored/rejected/needs-review`입니다. transaction branch는 `absent | pending → ledger-pending → terminal | retryable`, balance branch는 `absent | pending → balance-pending → terminal | retryable`입니다. 한 branch의 terminal 전이는 다른 branch stage를 덮어쓰지 않으며 각 전이는 compare-and-set version을 사용합니다.

Capture receipt와 Ledger Transaction·Local Currency Balance는 서로 다른 Context의 문서이므로 하나의 Infrastructure transaction으로 결합하지 않습니다. 대신 branch별 stable downstream key와 각 Context receipt로 중단 지점을 복구합니다. root receipt가 없거나 한 branch가 pending이라고 이미 terminal인 다른 branch를 다시 호출하지 않습니다.

### 7.3 Canonical Writer와 migration

- Android의 `expenses`, `merchant_rules`, `registered_cards`, `balances` 직접 접근을 제거합니다.
- Ledger만 Transaction/fingerprint claim을, Configuration만 카드·규칙을, Local Currency만 잔액을 씁니다.
- 기존 Android 직접 writer를 Facade 뒤에 둔 채 server shadow decision을 비교하고, 금액·ID·fingerprint 결과가 일치한 뒤 server writer로 전환합니다.
- `notification_debug_logs`는 V2로 이관하지 않고 DEC-002 종료 조건에서 Writer, Rules, index, collection을 함께 제거합니다.

## 8. Event·Projection·외부 연동

- Ledger가 `TransactionRecorded.v1` 또는 `CapturedLineageCancelled.v1`을 Canonical 변경과 같은 transaction의 Outbox에 기록합니다. Capture는 거래 저장·취소 Event를 중복 발행하지 않습니다.
- Payment Intake는 IOS-009 호환 duplicate 알림이 필요한 경우에만 `CaptureDuplicateObserved.v1`을 Capture receipt와 같은 Unit of Work에서 발행하는 유일 producer입니다. Event에는 기존 transaction ID와 안정적인 recipient evidence만 포함하고 새 거래가 생성됐다고 표현하지 않습니다.
- Notifications는 Ledger Event를 소비하고 [DEC-013](../../../../governance/decisions.md#dec-013)의 `TransactionCreatedNotificationPolicy`로 Android 자동 등록을 푸시 대상 없음으로 판정합니다. Android/Intake는 FCM endpoint를 조회하지 않습니다.
- Local Currency 결과와 거래 결과는 한 response에서 별도 필드이며 한쪽 실패가 다른 쪽 성공을 되돌리지 않습니다.
- Diagnostic 원문은 Event, Projection, Capture receipt, Outbox로 전달하지 않습니다.
- parser fixture는 개인정보를 제거한 단일 파일이며 Kotlin parser와 마이그레이션용 TypeScript 호환성 parser가 각각 직접 소비합니다. 두 구현의 공개 정규화 결과가 모두 일치해야 하며, 운영 서버 Intake가 이 호환성 parser로 원문을 다시 해석하지는 않습니다.

## 9. 오류·보안·관측성

### 9.1 안정 오류 code

| 경계 | code 예시 | 처리 |
|---|---|---|
| Android envelope/parser | `EMPTY_NOTIFICATION`, `UNSUPPORTED_SOURCE`, `PARSE_FAILED`, `INVALID_AMOUNT`, `INVALID_DATE`, `INVALID_TIME` | Queue하지 않는 `Ignored(code)`이며 별도 진단 대상이 될 수 있음; `Rejected`로 매핑하거나 다른 parser로 fallback하지 않음 |
| Source Policy | `SOURCE_DENIED`, `SOURCE_APPROVAL_REQUIRED` | `Rejected` 또는 `NeedsConfirmation` |
| 인증·tenant | `AUTH_REQUIRED`, `HOUSEHOLD_FORBIDDEN`, `ACTOR_MISMATCH` | downstream 호출 없음 |
| receipt | `IDEMPOTENCY_PAYLOAD_MISMATCH`, `RECEIPT_BUSY` | `Conflict` 또는 retryable |
| Configuration | `CARD_NOT_REGISTERED_FOR_ACTOR`, `CATEGORY_REFERENCE_INVALID` | 저장 없음; 다른 멤버 카드 존재 여부는 응답에 노출하지 않음 |
| Ledger·balance | 제공 Port의 duplicate/not found/conflict/retryable code | typed 결과 유지 |
| cancellation | `CANCELLATION_AMBIGUOUS`, `CANCELLATION_TARGET_NOT_FOUND` | 확인 후보 또는 not found |

### 9.2 개인정보와 진단

[보안 정책](../../../../cross-cutting/security-privacy.md#5-임시-알림-원문-정책)과 [DEC-047](../../../../governance/decisions.md#dec-047)에 따라 Diagnostic Adapter는 인증된 household·member와 등록 source를 선행 gate로 사용하고 관리자/진단 역할만 읽을 수 있게 합니다. package·source·title·text·bigText·textLines·fullText·시각과 actor scope를 기능 제거 전까지 TTL·sampling·dedupe 삭제 없이 보존합니다. 인증 token, FCM FID, 가구 접근 자격 같은 별도 Secret은 추가하지 않습니다. 진단 저장 실패는 업무 성공률 지표와 분리하고, 제거 시 Writer·Rules·index·collection 전체를 함께 정리합니다. 일반 로그에는 원문을 남기지 않습니다.

관측 항목은 observation ID hash, command/correlation ID, source type, parser ID/version, queue age·attempt, 거래·잔액 branch별 receipt stage, fingerprint version, lineage 존재 여부, typed result code, downstream latency입니다. `created`, `duplicate`, `ignored`, `rejected`, `needs-review`, `retryable`, balance-only와 branch 부분 실패를 별도 metric으로 집계합니다.

## 10. 목표 패키지 구조

```text
android/feature/payment-parser/                              # 목표
  domain/
    notification-envelope.kt
    parsed-payment-candidate.kt
    source-selector.kt
    parsers/
  application/
    parse-notification.kt
    queue-observation.kt
    submit-queued-observation.kt
  ports/
    observation-queue-port.kt
    payment-capture-api-port.kt
    diagnostic-sink.kt
  adapters/
    notification/
    api/
    workmanager/
    diagnostics/

functions/src/contexts/payment-capture/intake/               # 목표
  domain/
    policies/payment-fingerprint-policy.ts
    policies/cancellation-lineage-policy.ts
    policies/merchant-normalization-policy.ts
    policies/cancellation-match-policy.ts
    policies/allowed-payment-source-policy.ts
  application/
    commands/submit-capture-envelope-v1.ts
    ports/in/
    ports/out/
  adapters/out/firestore/capture-receipt-repository.ts
  public.ts

contracts/schemas/commands/payment-capture/                  # 목표
contracts/fixtures/payment-notifications/                    # 비식별 golden fixture
```

Android `NotificationListenerService`와 WorkManager는 얇은 Adapter입니다. Functions HTTP/callable handler는 schema·transport 변환만 하고 업무 계산은 Intake Application에 두며 `public.ts`만 외부 import를 허용합니다.

## 11. 테스트 설계

parser golden fixture에는 정상 승인, 지원 취소, 빈 필드, 0원·음수, 연말·연초, 마스킹 변형을 포함합니다. Kotlin과 TypeScript 호환성 suite는 같은 fixture 파일을 독립적으로 읽어 parser 선택, 승인·취소, 금액, 가맹점, 카드 라벨·토큰, 발생 일시, 지역화폐 잔액의 공개 결과를 비교합니다. 공통 Fake는 `FixedClock`, `SequenceIdGenerator`, callback을 두 번 실행하는 UoW, Queue/API Fake, receipt Repository Conformance Suite, Ledger/Configuration/Local Currency Port Spy입니다.

| 요구사항 ID | 테스트 수준 | 테스트 대상 | 핵심 fixture/경계값 | 관찰 결과 | Canonical 테스트 ID |
|---|---|---|---|---|---|
| [ING-001](requirements.md#51-수집출처-선택중복-처리) | Client Unit | envelope builder | text·bigText·textLines·title·모두 빈 값 | textLines 우선, 제목 첫 줄, 빈 입력 무시 | `T-ING-001` |
| [ING-002](requirements.md#51-수집출처-선택중복-처리) | Domain Unit | Source Registry와 source Policy | 등록 KB package+KB 본문, 등록 KB package+토스 본문, 미등록 package+KB 본문 | KB 성공; KB parse 실패 뒤 fallback 없음; 미등록 package는 parser 미실행 | `T-ING-003` |
| [ING-003](requirements.md#51-수집출처-선택중복-처리) | Application | parse 분기 | 승인·취소·실패·거래 없음 | 승인/취소 Port만 호출, 실패 시 Canonical 변경 없음 | `T-PARSE-001`, `T-PARSE-002` |
| [ING-004](requirements.md#51-수집출처-선택중복-처리) | Domain Unit | recent cache | 29,999·30,000·30,001ms, process restart | 앞 둘 중복, 마지막·재시작 후 재처리 | `T-ING-002` |
| [ING-005](requirements.md#51-수집출처-선택중복-처리) | Adapter Integration, Security | DiagnosticSink | actor 없음, 등록·미등록 source, 같은 원문 반복, 쓰기 실패, 비관리자, 장기 경과 | gate 밖 미수집·업무 결과 불변·접근 거부·기능 제거 전 모든 진단 문서 유지·별도 Secret 비수집 | `T-DIAG-001` |
| [ING-006](requirements.md#51-수집출처-선택중복-처리) | Parser Unit | SMS 후보 생성 | Google·Samsung·MMS, 0·1·2행 제거 | 지원 결제 형식에서만 SMS parser 실행 | `T-PARSE-001`, `T-PARSE-002` |
| [ING-007](requirements.md#51-수집출처-선택중복-처리) | Parser Unit | SmsParserOrderPolicy | 여러 parser와 청구가 동시에 맞는 후보, 세종 후보 | 명시 순서의 첫 성공 하나, 청구는 마지막, 세종 미포함 | `T-SMS-ORDER-001` |
| [ING-008](requirements.md#51-수집출처-선택중복-처리) | Android Integration, Security, Clock | 암호화 Queue·WorkManager | offline·재시작, 71:59:59·72:00:00, 한 branch terminal/다른 branch retryable, logout·멤버/가구 변경, 키 무효화 | ciphertext만 저장, branch별 같은 key 재시도, terminal branch 재호출 없음, 모두 terminal·만료·session 전환 뒤 삭제 | `T-QUEUE-001`, `T-ING-BAL-001` |
| [ING-009](requirements.md#51-수집출처-선택중복-처리) | Application, Context Contract | 독립 branch coordinator·receipt | balance-only, 카드 거부+잔액, 거래 성공+잔액 실패, 거래 실패+잔액 성공 | 결과·stage·key 독립, 성공 branch rollback·재호출 없음 | `T-ING-BAL-001` |
| [PARSE-KB-001](requirements.md#52-지원-입력-형식) | Parser Golden | KB parser | 승인·취소·요약형·게시시각 없음 | 요구 Parse candidate snapshot | `T-PARSE-001`, `T-PARSE-002` |
| [PARSE-NH-001](requirements.md#52-지원-입력-형식) | Parser Golden | NH parser | 승인·승인취소·M/D·농협 token | 금액·일시·가맹점·카드·취소 구분 | `T-PARSE-001`, `T-PARSE-002` |
| [PARSE-NAVER-001](requirements.md#52-지원-입력-형식) | Parser Golden | Naver parser | 승인 문장·게시시각·clock fallback | 승인 후보와 결정 시각 | `T-PARSE-001` |
| [PARSE-TOSS-001](requirements.md#52-지원-입력-형식) | Parser Golden | Toss parser | 승인·취소·가승인·캐시백이 총액 초과 | 승인 max(total-cashback,0), 취소 총액, 가승인 제외 | `T-PARSE-001`, `T-PARSE-002` |
| [PARSE-KAKAO-001](requirements.md#52-지원-입력-형식) | Parser Golden | KakaoPay parser | 완료 제목·가맹점·금액·시각 없음 | 게시시각 또는 clock으로 승인 | `T-PARSE-001` |
| [PARSE-ONNURI-001](requirements.md#52-지원-입력-형식) | Parser Golden | Onnuri parser | 상품권 결제·시각 없음 | 승인과 시각 fallback | `T-PARSE-001` |
| [PARSE-PAYBOOC-001](requirements.md#52-지원-입력-형식) | Parser Golden | Paybooc parser | 인라인·분리·취소·0원·빈 merchant | 유효 양수 승인/취소와 카드 정규화 | `T-PARSE-001`, `T-PARSE-002` |
| [PARSE-SAMSUNG-001](requirements.md#52-지원-입력-형식) | Parser Golden | Samsung parser | 승인·취소·MM/DD HH:mm·번호 | 요구 evidence snapshot | `T-PARSE-001`, `T-PARSE-002` |
| [PARSE-LOTTE-001](requirements.md#52-지원-입력-형식) | Parser Golden | Lotte parser | 승인·취소·일시불·할부 | 메타데이터·가맹점·카드·취소 구분 | `T-PARSE-001`, `T-PARSE-002` |
| [PARSE-GYEONGGI-001](requirements.md#52-지원-입력-형식) | Parser Golden, Application | 경기 parser | 지출+잔액, 잔액만 | local_currency 승인과 독립 balance result | `T-PARSE-001` |
| [PARSE-DAEJEON-001](requirements.md#52-지원-입력-형식) | Parser Golden, Application | 대전 parser | 상세·fallback·잔액 | 카드·가맹점·잔액 evidence | `T-PARSE-001` |
| [PARSE-SEJONG-001](requirements.md#52-지원-입력-형식) | Parser Golden, Application | 세종 parser | 결제 완료·보유 잔액 | 승인과 독립 balance observation | `T-PARSE-001` |
| [PARSE-CITYGAS-001](requirements.md#52-지원-입력-형식) | Parser Golden, Policy | 도시가스 parser | 제목 있음/없음, 마감일 정상/없음/유효하지 않음, 총액 없음 | 월·memo fallback과 observed/due date 보존, invalid due date는 수신일 fallback, 총액 없음 실패 | `T-CITYGAS-001`, `T-PARSE-001` |
| [PARSE-SMSBILL-001](requirements.md#52-지원-입력-형식) | Parser Golden | NH 문자 청구 parser | 정상 납부·유사 비결제 문장 | 정상 납부만 승인 | `T-PARSE-001` |
| [PARSE-COMMON-001](requirements.md#52-지원-입력-형식) | Parser Contract, Clock | 모든 parser 시간 Adapter | 서울/타 timezone, postedAt 있음·없음, 지연 재처리, 연말·연초 | 서울 postedAt 우선·주입 Clock fallback, 기기 timezone·실행 시각 무관 | `T-PARSE-TIME-001`, `T-PARSE-003` |
| [ING-SAVE-001](requirements.md#53-승인-저장) | Application, Security | submit authorization | 가구 없음·타 가구·유효 Actor | 저장 없음과 구분된 오류 | `T-ING-AUTH-001` |
| [ING-SAVE-002](requirements.md#53-승인-저장) | Application Contract | merchant/default category 조정 | mapping 있음·없음·도시가스·invalid category | mapping 우선, 도시가스 fixed, 그 외 default | `T-MER-ENRICH-001` |
| [ING-SAVE-003](requirements.md#53-승인-저장) | Application Contract | owner-scoped card resolve 소비 | 도시가스, 본인 0·1·여러 건, 타 멤버 동일 카드, wildcard, 라벨 호환 | 도시가스 외 본인 `Eligible`만 Ledger 호출; 타 멤버 상태 무관 | `T-CARD-001` |
| [ING-SAVE-004](requirements.md#53-승인-저장) | Contract | 정규 카드 번호 반영 | 양쪽 token 있음·없음·wildcard·본인 최상위 후보 여러 건 | canonical evidence가 유일할 때만 반영하고 아니면 parser 증거 유지 | `T-CARD-001` |
| [ING-SAVE-005](requirements.md#53-승인-저장) | Domain, Emulator | fingerprint·Ledger 경합 | 같은 tuple 다른 카드/source, 동시 2회 | 카드/source 무관 거래 한 건 | `T-DUP-001` |
| [ING-SAVE-006](requirements.md#53-승인-저장) | Application, Client, Context Contract | creator 원자 저장·result 후속 효과 | creator 있음·없음, Created·editable Duplicate·Rejected·network 실패, Ledger Event 소비 | creator 없으면 Ledger write 없음, 거래와 creator가 함께 확정된 편집 ID에서만 QuickEdit/broadcast, Android 자동 푸시 `NoTarget` | `T-ING-FOLLOWUP-001`, `T-ING-PROV-001` |
| [ING-SAVE-007](requirements.md#53-승인-저장) | Contract, Application, Emulator | CaptureProvenanceV1·Ledger lineage | 생성 후 편집·항목/월 분할·합치기, retry | 최초 원 증거·creator 원자 저장, 모든 파생에 같은 lineage, 원문 비저장 | `T-ING-PROV-001`, `T-CAPTURE-LINEAGE-001` |
| [CAN-001](requirements.md#54-취소) | Application | mapping과 candidate query | 가구 없음, mapping 있음·없음 | 가구 없으면 중단, mapped evidence로 조회 | `T-CAN-004` |
| [CAN-002](requirements.md#54-취소) | Domain, Application | 취소 검색 범위 | 일반·월 분할, 당일 seed 없음, 30일/31일 경계, 날짜 parse 실패 | 모든 후보 유형 30일 포함 검색, 실패 시 당일만 | `T-CAN-003` |
| [CAN-003](requirements.md#54-취소) | Domain Unit, Application | CancellationMatchPolicy | 유일한 완전 일치, merchant 불일치만 존재, 취소 선도착 후 승인, 완전 일치 동률 | 유일한 완전 일치만 취소 가능, 없음은 무변경 `NotFound`·보류 없음, 후속 승인은 정상 생성, 동률은 `NeedsConfirmation` | `T-CAN-002` |
| [CAN-004](requirements.md#54-취소) | Application, Emulator | `CancelCapturedLineage` 조정 | 일반 거래·월 분할·수정·합치기 lineage | 대상 lineage 전체 삭제와 다른 lineage 보존 결과 | `T-CAN-001` |
| [CAN-005](requirements.md#54-취소) | Emulator Integration | Ledger 원자 취소 | 중간 실패·stale version·callback retry | 전부 취소 또는 전부 유지, 성공 후만 완료 | `T-CAN-001` |
| [CAN-006](requirements.md#54-취소) | Domain Unit | 분할 내림 오차 | splitCount 1·2·12, 차이 count-1/count | count-1까지 match, count부터 불일치 | `T-CAN-006` |
| [CAN-007](requirements.md#54-취소) | Domain Unit, Application | CancellationLineagePolicy | 단일 미변경, 수정·분할, 다른 승인과 합치기, 불완전 legacy, 후보 없음·완전 일치 동률, commit 실패 | 현재 표시값이 아닌 provenance로 유일 lineage를 자동 취소하고 다른 lineage 복원, 불완전 lineage typed failure, 없음은 NotFound, 동률만 NeedsConfirmation, 실패는 전체 rollback | `T-CAN-LINEAGE-001` |

추가 Context contract test는 같은 idempotency key의 동일·상이 payload, receipt 완료 전 중단, Android·Shortcut 교차 채널 동시 fingerprint, balance 부분 실패, source Policy 교체 전후, transaction callback 2회 실행에서 외부 side effect 0회를 검증합니다.

모든 연도 없는 날짜를 다루는 `PARSE-*` parser는 Shortcut과 동일한 `T-PARSE-003` fixture를 추가로 소비합니다. 1월의 `12/31`, 12월의 `01/01`, 같은 날짜의 미래 시·분, 윤년 `02/29`, 불가능한 월·일을 Kotlin·TypeScript에서 같은 결과로 검증합니다.

## 12. 미결정 사항과 구현 순서

다음은 Policy·Port로 격리했으며 구현 활성화 전 Human in the loop가 필요합니다.

- 수정·분할·합치기 파생 거래 자동 취소 범위는 [DEC-041](../../../../governance/decisions.md#dec-041)로 확정되었습니다. `CancellationLineagePolicy`는 유일한 완전 일치 lineage를 자동 선택하고 실제 전체 삭제·다른 lineage 복원은 Ledger에 위임합니다.
- 서버 terminal receipt는 [DEC-046](../../../../governance/decisions.md#dec-046)에 따라 30일 보존하고 업무 중복 방지 claim·tombstone은 Aggregate 수명주기를 따릅니다. 임시 진단 문서는 [DEC-047](../../../../governance/decisions.md#dec-047)에 따라 기능 제거 전까지 TTL 없이 전부 보존합니다. Android 로컬 Queue는 DEC-032, 취소 선도착은 DEC-031, 연도 추론은 DEC-029, timezone은 DEC-023으로 확정되었습니다.

구현 순서는 (1) 현재 parser와 source 선택 golden characterization, (2) envelope·parser 순수화와 DiagnosticSink 분리, (3) `CaptureEnvelope.v1` schema·TS/Kotlin contract, (4) branch-aware 암호화 Queue와 API Fake, (5) 서버 receipt·Configuration/Ledger/Local Currency Port seam, (6) fingerprint·provenance 및 승인 vertical slice, (7) 취소 Policy와 원자 Ledger Port, (8) 독립 balance branch·QuickEdit 후속 효과, (9) Android 직접 Firestore writer 제거, (10) DEC-002 진단 Adapter 제거 순입니다.
