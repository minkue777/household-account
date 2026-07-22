# iOS Shortcut 지출 입력 모듈 상세 설계

> 설계 대상: [`IOS-001~013`](requirements.md#5-요구사항) 13개  
> 상위 Context: [Payment Capture](../../requirements.md)  
> 공통 형식: [모듈 상세 설계 규약](../../../../governance/module-design-standard.md)  
> 종단 흐름: [iOS Shortcut](../../../../system/flows.md#5-ios-shortcut)  
> 목표 아키텍처: [목표 Clean Architecture 설계](../../../../../architecture/target-clean-architecture.md#82-androidshortcut-결제-승인)
> 운영 구성: [Shortcut 런타임 구성](runtime-configuration.md)

## 1. 설계 목적과 추적성

이 문서는 Shortcut HTTP 입력의 transport 한도·인증·정규화·message parser·owner 증거·versioned 응답을 구현 가능한 계약으로 고정합니다. Shortcut Adapter는 입력 채널만 해석하고, 카드·가맹점 설정과 [DEC-003](../../../../governance/decisions.md#dec-003) 영속 중복은 공통 Payment Intake에 위임합니다. CORS는 인증과 분리하며 정적 공유 token을 목표 신뢰 경계로 유지하지 않습니다.

```text
HTTP request
  → Shortcut transport/schema/credential
  → Shortcut value normalizer + message parser
  → CaptureEnvelope.v1(payment only)
  → Payment Intake 공개 Port
  → transaction result + notification result를 분리한 HTTP response
```

Android 금융 알림 parser와 Shortcut message parser는 서로 다른 코드입니다. 두 채널이 공유하는 것은 생성된 `CaptureEnvelope.v1` schema, enum, 오류 code와 비식별 contract fixture뿐입니다. Shortcut은 `paymentObservation`만 채우고 Android는 결제·잔액 중 하나 이상을 채웁니다. 11절은 모든 `IOS-*` 요구사항을 기존 Canonical 테스트에 연결합니다.

## 2. 모듈 경계와 책임

### 2.1 소유 책임

- POST·OPTIONS·허용 origin, versioned JSON schema, 유한 body/field/rate/quota와 scoped credential 검증
- Shortcut의 문자열·숫자·불리언·배열·객체 값 정규화
- 카드 승인 message에서 카드 라벨, 금액, 일시, 가맹점, 카드 token 추출
- 현재 owner 우선순위를 재현하는 `LegacyShortcutOwnerPolicy`와 DEC-028 전환 Adapter
- HTTP 요청·응답 DTO와 transport status mapper
- 동일 논리 HTTP retry에 안정적인 idempotency key 생성·전달
- 신규·중복 거래 결과와 알림 접수·전달 결과를 별도 필드로 관측
- Google 로그인 SessionScope 기반 Shortcut credential 발급·상태 조회·폐기와 공유 Shortcut 반자동 설치 계약

### 2.2 위임 책임

- Payment Intake가 ActorContext, source 검증, Configuration resolve, fingerprint, receipt를 소유합니다.
- Payment Configuration이 인증된 현재 멤버 범위에서 등록 카드 일치 여부와 정규 카드 evidence를 판정합니다.
- Ledger가 Transaction과 fingerprint claim을 원자 저장합니다.
- Notifications가 멤버별 복수 활성 endpoint, 대상 계산, FCM endpoint별 단일 전송 시도·404+UNREGISTERED inactive 처리를 소유합니다.
- Access가 가구 존재·멤버십과 안정적인 memberId를 판정합니다.

Shortcut Adapter가 `expenses`, `registered_cards`, `fcmTokens` 물리 경로를 읽거나 쓰는 것은 목표 구조에서 금지합니다.

## 3. 공개 계약

### 3.1 HTTP wire contract

```ts
interface ShortcutRequestV1 {
  contractVersion: 'shortcut-payment.v1';
  message: unknown;
}

interface ShortcutResponseV1 {
  contractVersion: 'shortcut-payment-response.v1';
  commandId: string;
  transaction:
    | { kind: 'created'; transactionId: string }
    | { kind: 'duplicate'; existingTransactionId: string }
    | { kind: 'rejected'; code: string }
    | { kind: 'needsConfirmation'; candidates: unknown[] };
  notification: {
    state: 'queued' | 'delivered' | 'no-target' | 'failed' | 'unknown-provider-outcome' | 'permanent-failure' | 'not-requested';
    targetMemberId?: string;
    deliveryId?: string;
  };
}

interface ShortcutErrorResponseV1 {
  contractVersion: 'shortcut-payment-response.v1';
  error: {
    code: string;
    retryable: boolean;
  };
}

interface ShortcutIngressLimitsV1 {
  maxBodyBytes: number;
  maxMessageChars: number;
  maxIdempotencyKeyChars: number;
  rate: { maxRequests: number; windowSeconds: number };
  costQuota: { maxUnits: number; windowSeconds: number };
}

interface ShortcutCredentialClaimsV1 {
  credentialId: string;
  subjectUid: string;
  memberId: string;
  householdId: string;
  capabilities: readonly ['paymentCapture:submit'];
  issuedAt: string;
  keyVersion: string;
}

interface ShortcutCredentialRecordV1 extends ShortcutCredentialClaimsV1 {
  credentialVersion: number;
  secretHash: string;
  status: 'active' | 'revoked';
  lastUsedAt?: string;
  revokedAt?: string;
  replacedByCredentialId?: string;
}
```

실행 가능한 wire 단일 원본은 [요청 JSON Schema](../../../../../../contracts/schemas/payment-capture/shortcut-payment-request.v1.schema.json), [응답 JSON Schema](../../../../../../contracts/schemas/payment-capture/shortcut-payment-response.v1.schema.json), [비식별 golden fixture](../../../../../../contracts/fixtures/payment-capture/shortcut-payment-wire.v1.json)입니다. TypeScript 예시는 의미 설명용이며 필드 추가·삭제·version 변경은 schema와 producer/consumer 계약 테스트를 먼저 변경합니다.

wire contract는 POST, `Content-Type: application/json`과 `contractVersion=shortcut-payment.v1`만 업무 요청으로 허용합니다. OPTIONS는 허용 origin의 preflight 응답만 만들고 Application을 호출하지 않습니다. `ShortcutIngressLimitsV1`의 모든 값은 양의 유한 배포 config여야 하며 누락·0·무한이면 route 시작을 거부합니다. streaming body는 maxBodyBytes를 넘기기 전에 중단하고 field와 `Idempotency-Key`도 정규화·파싱 전에 길이를 제한합니다.

인증은 body의 정적 token이 아니라 `Authorization: Bearer <shortcutCredential>`을 사용합니다. [DEC-033](../../../../governance/decisions.md#dec-033)에 따라 credential claim은 credential ID, principal/member, household, `paymentCapture:submit` capability, 발급 시각과 key version을 가지며 정기 자동 만료는 두지 않습니다. 서버는 활성 상태와 현재 Membership을 매 요청 확인하고 원문 credential을 저장·로그하지 않습니다. CORS allowlist와 preflight 성공은 credential·Membership 검증을 대신하지 않습니다. `Idempotency-Key` header를 권장하고, 없으면 `credentialId + normalizedMessage`의 versioned hash를 Adapter가 생성합니다.

request body에는 householdId·createdBy·memberName·deviceOwner·owner를 넣지 않습니다. 서버는 검증한 claim의 memberId와 householdId로 ActorContext를 만들며, 호환 Adapter가 레거시 alias를 읽더라도 신원·가구 선택이나 권한 상승에 사용하지 않습니다. Membership 상실·가구 논리 삭제·명시적 폐기·재발급으로 교체된 키는 즉시 거부합니다.

### 3.1.1 반자동 발급·설치 계약

1. Google 로그인과 활성 Membership을 검증한 설정 화면이 `IssueShortcutCredential`을 호출합니다.
2. Application은 CSPRNG로 충분한 엔트로피의 원문을 만들고 강한 단방향 hash만 저장합니다. 같은 uid/member/household의 기존 활성 credential은 같은 원자적 경계에서 `revoked`로 바꿉니다.
3. 최초 발급 응답만 원문을 반환합니다. 동일 idempotency key가 재전송되면 발급 receipt의 credentialId·credentialVersion으로 `AlreadyIssued`를 반환하고 원문·설치 URL은 재생하지 않으며 새 credential도 만들지 않습니다. receipt에는 원문이나 복호화 가능한 값을 저장하지 않습니다.
4. UI는 설정의 가구원 초대 바로 다음에 배치합니다. `iPhone 단축어 연결` 동작에서 최초 원문을 클립보드로 복사하고 고정된 공유 Shortcut 설치 URL을 엽니다. 최초 응답을 잃어 `AlreadyIssued`를 받으면 자동으로 새 자격을 만들지 않고 명시적 재발급 안내를 표시합니다. 활성 자격을 다시 조회한 화면에는 발급·최근 사용 시각, 상태 설명, 별도 폐기 버튼을 노출하지 않고 제목 오른쪽에 가구원 초대의 코드 생성 동작과 같은 크기의 재발급 버튼만 표시합니다.
5. 공유 Shortcut은 안정된 endpoint, POST·JSON, contract version, Authorization header, Shortcut Input의 message 전달, 성공·오류 분기를 미리 포함합니다. 사용자는 Apple 가져오기 질문의 credential 칸에 한 번 붙여넣습니다.
6. 제품은 별도 안내에서 iPhone 개인용 자동화를 `메시지를 받을 때 → 즉시 실행 → 설치된 가계부 Shortcut 실행`으로 한 번 연결하게 합니다. 개인용 자동화를 서버나 PWA가 설치했다고 표시하지 않습니다.
7. 설치 실패·분실·기기 변경은 로그인 설정의 새 idempotency key를 사용하는 명시적 `재발급`으로 복구합니다. 재발급은 기존 자격을 서버에서 원자 폐기하지만 사용자가 별도로 누르는 폐기 UI는 제공하지 않습니다. PWA 로그아웃만으로는 Shortcut credential을 폐기하지 않습니다.

`IssueShortcutCredential`, `RevokeShortcutCredential`, `GetShortcutCredentialStatus`는 Access의 인증된 SessionScope를 요구합니다. 원문 재조회 API는 두지 않습니다. Shortcut 자체는 편집 가능한 사용자 영역이므로 키를 별도 보안 저장소라고 표현하지 않으며, 한 사용자·가구·capability 범위와 즉시 폐기로 노출 반경을 제한합니다.

HTTP response는 원문 message, 전체 token, 내부 parser stack을 포함하지 않습니다. 기존 `success`, `duplicate`, `notificationSent`, `targetOwner` 소비자는 Legacy Response Mapper에서 위 typed 결과로부터 제한 기간 동안만 변환합니다. `notificationSent=true`는 실제 `delivered`일 때만 허용하고 `queued`를 성공 전송으로 표현하지 않습니다.

### 3.2 공개 Input Port

| 이름·종류 | 호출자 | 입력 | 결과 | 권한 | 일관성·멱등성 |
|---|---|---|---|---|---|
| `IssueShortcutCredential` Command | Web 설정 | 현재 SessionScope | 최초 `Issued(원문, credentialId, credentialVersion, 설치 URL)` 또는 재전송 `AlreadyIssued(credentialId, credentialVersion)` | Google 인증+활성 Membership의 자기 member | 기존 활성 자격 폐기·새 hash·원문 없는 receipt를 한 transaction으로 처리; 같은 key 재전송은 receipt 메타데이터만 재생 |
| `GetShortcutCredentialStatus` Query | Web 설정 | 현재 SessionScope | credentialId, credentialVersion, masked status, issuedAt, lastUsedAt | 같은 자기 member | 원문 반환 없음 |
| `RevokeShortcutCredential` Command | Web 설정 | credentialId, expectedVersion | `Revoked`·`AlreadyRevoked`·`NotFound` | 같은 자기 member | compare-and-set, 원문 불필요 |
| `ProcessShortcutRequestV1` Application | HTTP Adapter | 정규화 전 wire DTO, credential context, command metadata | `ShortcutProcessResult` | scoped credential와 같은 가구 | 순수 parse 뒤 공통 Intake receipt 사용; 같은 key 결과 재생 |
| `ParseShortcutMessage` Domain Service | Application | 정규화된 message, `Clock`, `ZoneId` | approval evidence 또는 `ParseFailure(code)` | 내부 | 순수 결정 함수 |
| `VerifyActorOwnedCard` Policy | Payment Intake | `ActorContext.actingMemberId`, card evidence | `Eligible`·`Ineligible`과 선택 canonical card evidence | 내부 | 타 멤버 카드는 조회하지 않으며 여러 본인 카드 일치도 거래를 거부하지 않음 |

`ProcessShortcutRequestV1` 내부 Result는 공통 union의 `Success`, `ValidationError`, `Unauthenticated`, `Forbidden`, `NotFound`, `Conflict`, `Duplicate`, `NeedsConfirmation`, `RetryableFailure`, `ContractFailure`만 사용하며 HTTP Adapter가 status로 변환합니다.

### 3.3 정규화 규칙

`normalizeShortcutValue(unknown)`은 다음 순서입니다.

1. string은 `trim`합니다.
2. number·boolean은 locale 비의존 `String(value)`로 변환합니다.
3. array는 각 원소를 재귀 정규화하고 빈 값을 제거해 줄바꿈으로 합칩니다.
4. object는 `string`, `text`, `value`, `plainText`, `PlainText` 순으로 첫 비어 있지 않은 string을 사용합니다.
5. 알려진 key가 없으면 안정적인 JSON 직렬화 결과를 사용하고 순환 참조·직렬화 실패는 빈 값입니다.
6. null·undefined는 빈 값입니다.

## 4. Domain 모델과 불변식

이 모듈은 영속 Aggregate가 없는 Inbound Adapter/Application 모듈입니다. Domain은 순수 parser 값과 Policy로 한정합니다.

### 4.1 `ShortcutCardMessageParserV1`

- 비어 있지 않은 첫 줄이 문자 전송 표지 `[Web발신]`이면 결제 본문에 포함하지 않습니다. 그 외 임의의 선두 줄은 조용히 건너뛰지 않습니다.
- `([0-9,]+)원` 금액과 선택 일시불·할부·체크 표기를 읽고 양의 안전 정수 원 단위로 검증합니다.
- `M/D HH:mm merchant`를 읽으며 실제 달력 날짜, `00..23` 시, `00..59` 분과 비어 있지 않은 merchant를 검증합니다.
- 지원 헤더는 삼성·신한·국민·현대·롯데·하나·우리·BC·NH와 선택 숫자 token입니다. BC→비씨, NH→농협으로 정규화합니다.
- 헤더가 없을 때 삼성으로 간주하는 현재 동작은 `LegacyShortcutCardMessageParserV1`에서만 characterization 합니다. 목표 parser는 DEC-030에 따라 카드사 헤더 누락을 `CARD_COMPANY_REQUIRED`, 미지원 헤더를 `UNSUPPORTED_CARD_COMPANY`로 거부하며 등록 카드·owner·FCM 정보로 카드사를 추정하지 않습니다.
- 연도 없는 월이 `currentMonth + 1`보다 크면 전년으로 추론하는 현재 동작은 `LegacyShortcutYearPolicy`로만 특성화합니다. 목표 parser는 DEC-029의 공통 `PaymentOccurrenceYearPolicyV1`에 월·일·시·분, `Clock`, `Asia/Seoul`을 전달하고 수신 LocalDateTime보다 미래가 아닌 가장 가까운 유효 연도를 받습니다. 같은 날짜라도 원문 시각이 수신 시각보다 뒤면 전년으로 내리며 미래 허용 오차는 없습니다.
- 카드 token은 `＊`, `*`를 `x`로 바꾸고 숫자·x만 남긴 마지막 네 자리입니다.

### 4.2 본인 소유 등록 카드 Policy

현재 동작을 보존하는 `LegacyShortcutOwnerPolicy`의 우선순위는 다음과 같습니다.

1. 요청 owner가 같은 가구의 현재 FCM owner로 확인되면 요청 owner
2. 카드 라벨·wildcard token이 맞는 첫 등록 카드 owner
3. 해당 카드사의 owner가 정확히 한 명이면 그 owner
4. 비어 있지 않은 요청 owner
5. `null`

FCM endpoint와 요청 owner는 멤버 신원의 원본이 아니며 Firestore 저장 순서도 소유자를 결정할 수 없습니다. 목표 `VerifyActorOwnedCard`는 [DEC-028](../../../../governance/decisions.md#dec-028)에 따라 `ActorContext.actingMemberId`를 필수 owner 범위로 `ResolveCard`에 전달합니다. Configuration은 이 멤버의 카드만 조회하고 다음 결과를 반환합니다.

- `Eligible(canonicalCardEvidence?)`: 본인 카드가 하나 이상 일치합니다. 하나의 카드를 입력 증거로 확정할 수 있을 때만 canonical evidence를 제공합니다.
- `Ineligible(CARD_NOT_REGISTERED_FOR_ACTOR)`: 본인 카드가 일치하지 않습니다. 타 멤버 카드의 존재 여부는 조회하거나 결과에 노출하지 않습니다.
- `Failure`: Repository·계약 장애이며 불일치로 축약하지 않습니다.

본인 카드가 여러 개 일치해도 `Eligible`이며 거래를 생성할 수 있습니다. 이때 특정 카드 하나를 저장 순서로 선택하지 않고 parser의 카드 증거를 유지합니다. 레거시 owner alias는 호환 요청을 읽는 용도일 뿐 `actingMemberId`나 카드 조회 범위를 변경하지 않습니다. 전환 전에는 `LegacyShortcutOwnerPolicy` 결과와 새 결과를 shadow 비교하되 실제 목표 Writer에는 새 Policy만 사용합니다.

### 4.3 영속 중복

Shortcut parser와 HTTP Adapter는 영속 중복 query를 하지 않습니다. 공통 Intake가 가구·현지 날짜·시간·금액·정규 가맹점의 [DEC-003 fingerprint](../../../../../architecture/target-clean-architecture.md#102-결제-fingerprint)를 계산하고 Ledger가 claim과 거래 생성을 원자 commit합니다. 카드와 source는 fingerprint에 포함하지 않습니다.

## 5. Application Use Case 상세

### 5.1 `ProcessShortcutRequestV2`

1. HTTP Adapter가 OPTIONS를 처리하고 POST 외 method는 Application을 호출하지 않고 405로 종료합니다.
2. 허용 origin을 preflight/응답 header 정책으로 평가하되 이를 인증 결과로 사용하지 않습니다. JSON content type, streaming body byte 상한과 contract version을 검증합니다.
3. coarse IP rate limit을 적용한 뒤 Credential Adapter가 서명·활성 상태·폐기·key version·household/member/capability scope를 확인해 `ActorContext`를 만듭니다. Shortcut credential에는 시간 기반 만료를 두지 않습니다.
4. credential 단위 rate limit과 비용 quota를 claim하고 초과하면 429로 종료합니다. 실패 경로는 Membership·parser·Payment Intake를 호출하지 않습니다.
5. `message`와 `Idempotency-Key`의 field별 길이 상한을 검사한 뒤 정규화합니다. 빈 message는 `ValidationError`입니다. 목표 wire body에는 householdId·owner alias가 없고 가구는 credential claim에서만 결정합니다. 구형 alias는 이 Use Case 밖의 Compatibility Facade가 소비·폐기합니다.
6. Access 공개 Port로 가구가 active이고 Actor membership이 유효하며 credential의 uid/member/household와 같은지 확인합니다.
7. parser가 금액·날짜·시간·merchant·card evidence를 만듭니다. 원문은 이후 DTO와 오류 응답에서 버립니다.
8. Shortcut Adapter는 body 값으로 owner를 결정하지 않고 카드와 비교하거나 최종 owner를 선택하지 않습니다. 호환 진단이 필요하면 Facade가 비식별 parity metric만 남기고 alias 원문을 Application에 전달하지 않습니다.
9. observation ID, `originChannel=ios-shortcut`, `sourceEvidence.kind=ios-shortcut-credential`과 credentialId의 비가역 hash, parser ID/version, `paymentObservation`을 넣어 Android 설계에 정의된 공통 `CaptureEnvelope.v1`으로 변환합니다. packageName·registryVersion을 꾸며내지 않으며 생성자 후보는 payload가 아니라 command의 `ActorContext`입니다.
10. 같은 command envelope로 `SubmitCaptureEnvelopeV1`을 한 번 호출합니다. Payment Intake는 `ActorContext.actingMemberId` 범위로 Configuration의 `ResolveCard`를 호출하며 Shortcut Adapter는 Configuration/Ledger를 따로 호출하지 않습니다.
11. 본인 등록 카드가 하나도 일치하지 않으면 거래·알림을 만들지 않습니다. 하나 이상 일치하면 `creatorMemberId=ActorContext.actingMemberId`로 고정하고 `Created`와 `Duplicate`를 분리합니다. 본인 카드 여러 건 일치는 생성 거부 사유가 아닙니다.
12. 신규 거래 알림은 Ledger Outbox Event가 Notifications로 전달하며 creator 본인의 활성 iPhone endpoint만 대상으로 편집 링크를 만듭니다. HTTP response는 `queued`와 실제 `delivered`를 구분합니다.
13. 중복 거래의 호환 알림은 Payment Intake가 receipt와 함께 한 번 기록한 `CaptureDuplicateObserved.v1`의 `followUp` 결과를 응답에 매핑합니다. Shortcut Adapter가 Notifications나 FCM을 직접 호출하지 않습니다.

### 5.2 입력 검증과 typed error

| 검증 | 실패 code | HTTP mapping |
|---|---|---|
| POST 외 method | `METHOD_NOT_ALLOWED` | 405 |
| JSON 이외 content type | `UNSUPPORTED_MEDIA_TYPE` | 415 |
| 지원하지 않는 contract version | `UNSUPPORTED_CONTRACT_VERSION` | 400 |
| streaming body byte 상한 초과 | `PAYLOAD_TOO_LARGE` | 413 |
| message·레거시 alias·idempotency key 길이 상한 초과 | `FIELD_TOO_LONG` | 400 |
| IP·credential rate/cost quota 초과 | `RATE_LIMITED`, `QUOTA_EXCEEDED` | 429 + 선택 Retry-After |
| credential 없음·서명 불일치 | `AUTH_REQUIRED` | 401 |
| credential 폐기·key version 불일치 | `CREDENTIAL_REVOKED`, `CREDENTIAL_KEY_VERSION_INVALID` | 401 |
| 타 가구·capability 없음 | `HOUSEHOLD_FORBIDDEN` | 403 |
| message 필수값·wire schema 불일치 | `REQUIRED_FIELD`, `INVALID_CONTRACT` | 400 |
| 0·음수·NaN·overflow 금액 | `INVALID_AMOUNT` | 422 |
| 실제 달력 날짜·시간 아님 | `INVALID_DATE`, `INVALID_TIME` | 422 |
| parser 불일치 | `UNSUPPORTED_MESSAGE` | 422 |
| 카드사 헤더 누락·미지원 | `CARD_COMPANY_REQUIRED`, `UNSUPPORTED_CARD_COMPANY` | 422 |
| 달력상 불가능한 월·일 | `INVALID_DATE` | 422 |
| 본인 소유 등록 카드 불일치 | `CARD_NOT_REGISTERED_FOR_ACTOR` | 422 |
| 같은 idempotency key의 다른 payload | `IDEMPOTENCY_PAYLOAD_MISMATCH` | 409 |
| 일시 저장·provider 장애 | 제공 Port의 retryable code | 503 + 선택 Retry-After |

### 5.3 신규·중복 알림 결과

거래 결과와 알림 결과는 독립 필드입니다. 신규 `Created`는 Ledger의 `TransactionRecorded.v1`이 commit되었으면 `queued`, Notifications 전달 완료를 조회했을 때만 `delivered`입니다. `Duplicate`는 공통 Capture 결과의 `followUp.outboxQueued(CaptureDuplicateObserved.v1, eventId)`를 `queued`로 매핑하며, 대상 없음·일시·영구 실패 같은 후속 상태는 Notifications의 `GetDeliveryStatus` 결과로만 갱신합니다. [DEC-013](../../../../governance/decisions.md#dec-013)의 iPhone 생성자 수신 정책은 Notifications의 `TransactionCreatedNotificationPolicy`가 소유하고 Shortcut은 endpoint를 계산하지 않습니다.

Shortcut 응답 조정기는 `Created`이면 `producer=household-finance.ledger`인 `TransactionRecorded.v1`, `Duplicate`이면 `producer=payment-capture.intake`인 `CaptureDuplicateObserved.v1`의 **이미 원자 commit된 source event receipt**만 소비합니다. event 종류·transaction ID·creator가 거래 결과와 일치할 때 typed 응답 receipt를 멱등 기록하며, Shortcut Ingestion이 이 단계에서 Transaction이나 Outbox Event를 다시 생성하는 것은 금지합니다. source event가 아직 없거나 상관관계가 다르면 대체 Event를 합성하지 않고 소비를 보류·거부합니다.

### 5.4 Legacy HTTP response 호환 창

Domain과 `ProcessShortcutRequestV2`는 typed V2 결과만 반환합니다. 구형 path를 유지하는 최외곽 `LegacyShortcutResponseMapper`만 V2의 거래 결과와 조회된 delivery 상태를 `duplicate`·`notificationSent`·`targetOwner`로 변환합니다. `notificationSent=true`는 실제 `delivered`에만 대응하며 `queued`를 전달 성공으로 위장하지 않습니다. 이 mapper는 inbound Actor 결정, Domain model, receipt, Outbox payload에 관여하지 않고 호환 창 종료 시 Facade와 함께 제거합니다.

## 6. Port 설계

| Output Port | 책임 | fixture·실패 |
|---|---|---|
| `ShortcutCredentialPort` | credential 서명·활성 상태·폐기·key version·uid/member/가구/capability scope 검증 | valid, revoked, wrong signature/key/member/household/capability |
| `ShortcutIngressLimitPort` | 환경별 양의 유한 body/field/key/rate/quota config | missing, zero, infinity, boundary |
| `ShortcutRateLimitPort`, `ShortcutQuotaPort` | coarse IP와 credential별 호출·비용 window claim | allowed, exhausted, parallel boundary |
| `MembershipQueryPort` | 가구 존재·상태·Actor/member 관계 | active, deleted, purging, missing, forbidden |
| `PaymentIntakePort` | `SubmitCaptureEnvelopeV1` 호출 | Created, Duplicate, Conflict, retryable, contract drift |
| `LegacyOwnerEvidencePort` | 전환 중 FCM owner·이름 기반 증거를 읽는 호환 Adapter | 목표 전환 후 제거; 신원 권위로 사용 금지 |
| `NotificationDeliveryStatusPort` | Capture/Ledger가 반환한 Event ID의 후속 전달 상태 조회 | no-target, queued, delivered, partial, failed, unknown, permanent; 알림 생성 명령은 제공하지 않음 |
| `Clock`, `IdGenerator`, `HashingPort` | 연도, command/observation ID, legacy idempotency hash | timezone·연말 fixture |
| `ObservabilityPort` | credential ID hash, parser version, result code | message·credential·token 원문 금지 |

Application은 Firebase Admin, Express Request/Response, FCM SDK를 import하지 않습니다.

## 7. 저장·트랜잭션·동시성

Shortcut 모듈 자체에는 Canonical 영속 Aggregate가 없습니다. 요청의 멱등성은 Payment Intake의 `CaptureSubmissionReceipt`, 거래와 중복 claim은 Ledger가 저장합니다.

- 같은 idempotency key·payload hash는 저장된 typed 결과와 같은 downstream key를 재생합니다.
- Credential 발급 receipt는 `Issued`의 credentialId·credentialVersion·결과 code만 저장합니다. 같은 발급 key 재전송은 `AlreadyIssued`로 매핑하고 원문을 재생하거나 새 자격을 만들지 않습니다. 사용자가 새 key로 재발급할 때만 새 hash 저장과 기존 활성 credential 폐기를 한 transaction으로 수행합니다.
- 같은 key의 다른 payload는 parse 이후라도 Ledger와 Notifications를 호출하지 않습니다.
- 같은 DEC-003 tuple의 Android·Shortcut 동시 요청은 Ledger fingerprint claim 경합으로 거래 한 건이 됩니다.
- 알림 요청은 transaction 안에서 FCM을 호출하지 않습니다. duplicate 호환 Event ID와 Outbox append는 Payment Intake가 `captureReceiptId:duplicate-notification:targetMemberId`에서 결정적으로 만들고 receipt Unit of Work에 포함합니다.
- Legacy Adapter만 기존 `expenses` DTO의 `source=ios-shortcut`, 빈 memo, 기본 category, 필수 creatorMemberId를 legacy `createdBy`에도 매핑합니다. Canonical 거래에는 parser evidence로 만든 완성 `cardDisplay`(예: `삼성(1876)`)를 저장하고, 기존 Web Read Model과 함께 운영하는 동안에는 같은 완성 표시 문자열을 legacy `cardLastFour`에도 기록합니다. 이 필드는 호환 표시 슬롯이지 숫자 네 자리 Domain 사실이 아닙니다. 1876의 레거시 `cardType`도 Adapter에서만 기록하며 목표 V2 Domain은 공개하지 않습니다.
- 기존 HTTP path와 response는 Facade로 유지한 뒤 새 schema 사용률과 response parity를 확인하고 제거합니다.

## 8. Event·Projection·외부 연동

- `Created`의 거래 알림은 Ledger의 `TransactionRecorded.v1` Outbox를 Notifications Inbox가 소비하며 creator 본인의 iPhone endpoint에만 편집 링크를 보냅니다.
- `CaptureDuplicateObserved.v1`의 유일 producer는 Payment Capture Intake입니다. Notifications는 이를 새 거래 Event로 해석하지 않고 duplicate template intent로 변환하며, 같은 receipt 재시도는 같은 Event·delivery key로 한 번만 전송됩니다.
- HTTP 응답은 알림 delivery를 기다리느라 거래 성공을 실패로 바꾸지 않습니다. `GetDeliveryStatus`가 필요한 경우 `deliveryId`를 반환합니다.
- Shortcut message 원문은 Event, Outbox, receipt, 알림 payload, 일반 로그에 포함하지 않습니다.
- parser contract fixture는 비식별 message와 예상 evidence를 소유하며 Android 금융 알림 fixture와 별도 디렉터리에 둡니다.

## 9. 오류·보안·관측성

[보안 경계](../../../../cross-cutting/security-privacy.md)에 따라 다음을 적용합니다.

- 전역 hardcoded token을 사용자·가구·capability 범위와 폐기·재발급 수명주기를 가진 credential로 교체하고 Secret 값을 코드·로그·응답에 노출하지 않습니다. 시간 기반 자동 만료는 두지 않습니다.
- credential의 household/member claim과 서버가 조회한 현재 Membership·ActorContext가 일치해야 합니다. 목표 request body에는 비교할 householdId가 없으며 레거시 alias가 있더라도 무시합니다.
- CORS는 배포 환경 allowlist이며 `*`를 사용하지 않습니다. CORS 허용은 인증 결과가 아니고 OPTIONS는 업무 Application을 호출하지 않습니다.
- POST JSON/version만 허용하고 body·field·idempotency key를 읽기·파싱 전에 유한하게 제한하며 IP·credential rate limit과 비용 quota를 둡니다.
- ingress limit이 누락·0·무한이면 fail-open하지 않고 route 배포/시작을 실패시킵니다.
- owner는 요청 문자열만으로 확정하지 않고 Access·Configuration evidence를 사용합니다.
- 파싱 실패 응답에 원문을 echo하지 않습니다.
- Admin SDK가 Rules를 우회하므로 모든 Application 경로에서 Membership을 검증합니다.
- HTTP 인증 진단은 Authorization 원문·credential ID를 기록하지 않고 `missing`, `malformed`, `credential-format-valid` 형태와 최종 HTTP status·typed error code만 구조화 로그로 남깁니다.

관측 필드는 command ID, credential subject hash, household hash, parser/version, normalized input kind, transaction result, notification state, delivery attempt count, latency입니다. 인증 실패, schema 실패, parser 실패, duplicate, notification no-target/failed/unknown/permanent를 별도 metric으로 둡니다.

## 10. 목표 패키지 구조

```text
functions/src/contexts/payment-capture/shortcut-adapter/      # 목표
  domain/
    shortcut-value-normalizer.ts
    shortcut-card-message-parser.ts
    shortcut-year-policy.ts
  application/
    process-shortcut-request-v1.ts
    ports/in/
    ports/out/
  adapters/in/http/
    shortcut-request-v1-handler.ts
    legacy-response-mapper.ts
  adapters/out/credential/
  public.ts

contracts/
  schemas/commands/shortcut-payment-v1.json                  # 목표
  schemas/read-models/shortcut-payment-response-v1.json
  fixtures/shortcut-payment-messages/
```

공통 Payment Intake 구현은 `functions/src/contexts/payment-capture/intake/`에 있고 Shortcut Adapter는 그 `public.ts`만 import합니다. DEC-028의 `VerifyActorOwnedCard` 조정은 Intake Application에 배치하고 실제 카드 매칭은 Payment Configuration 공개 Port에 위임합니다. Shortcut Adapter가 Configuration Port를 별도로 소비하거나 parser를 Intake·Android에 복사하지 않습니다.

## 11. 테스트 설계

| 요구사항 ID | 테스트 수준 | 테스트 대상 | 핵심 fixture/경계값 | 관찰 결과 | Canonical 테스트 ID |
|---|---|---|---|---|---|
| [IOS-001](requirements.md#5-요구사항) | Contract, Application | HTTP method·필수값·parse 분기 | POST/OPTIONS/GET, 빈 message, body의 legacy household/owner alias, 비지원 message | 입력·인증·parse 오류가 구분되고 body alias는 Actor를 바꾸지 않으며 저장 없음 | `T-IOS-002`, `T-IOS-003`, `T-IOS-SEC-002` |
| [IOS-002](requirements.md#5-요구사항) | Domain Unit | value normalizer | string·number·boolean·nested array·known/unknown object·순환 객체 | 규칙별 결정 문자열 또는 빈 값 | `T-IOS-004` |
| [IOS-003](requirements.md#5-요구사항) | Parser Golden | message parser | 지원 라벨·금액·M/D HH:mm·merchant, 헤더 누락·미지원 | 정상 evidence snapshot; 목표 parser는 누락·미지원 거부, legacy만 삼성 fallback | `T-PARSE-004` |
| [IOS-004](requirements.md#5-요구사항) | Domain, Contract | year Policy | 1월 clock+12월 message, 경계 current+1/current+2 | legacy/합의 Policy의 명시 결과 | `T-PARSE-003` |
| [IOS-005](requirements.md#5-요구사항) | Domain, Application | owner Policy 전환 | 레거시 요청 owner 유효/무효, 타 멤버 wildcard 일치 | 레거시 결과는 특성화만 하고 목표 Writer는 Actor 범위만 사용 | `T-IOS-OWNER-LEGACY-001` |
| [IOS-006](requirements.md#5-요구사항) | Domain, Context Contract | DEC-003 fingerprint | 같은 tuple 다른 카드/source·실제 동시 입력 | 후속 거래 `Duplicate`, 거래 한 건 | `T-DUP-001` |
| [IOS-007](requirements.md#5-요구사항) | Application, Legacy Mapper | 거래 초안·호환 저장 | 본인 카드 0·1·여러 건, 타 멤버 동일 카드, 1876/번호 없음 | 본인 카드 1건 이상이면 Actor creator로 저장, 타 멤버 상태 무관, 임의 카드 선택 없음 | `T-CARD-001` |
| [IOS-008](requirements.md#5-요구사항) | Context Contract, Integration, E2E | 신규 typed V2 결과와 Ledger Outbox 알림 | Created, creator의 iOS·Android·desktop endpoint 혼재, 다중 active iPhone, FCM 성공·지연·실패 | Payment Capture는 creator+capability만 발행하고 Notifications가 creator의 active iPhone만 선택, 다른 가구원 제외, 거래와 delivery 상태 분리 | `T-IOS-NOTIFY-001`, `T-IOS-COMPAT-001` |
| [IOS-009](requirements.md#5-요구사항) | Application, Integration, Outbound Compatibility | duplicate Notification Intent·legacy response mapper | target 0·1, delivery 성공·failed·unknown·permanent, 요청 재실행, V2→legacy 변환 | 새 거래 없음, event·delivery 멱등, Domain/Application은 typed V2만 사용하고 최외곽 mapper만 구형 응답 생성 | `T-IOS-NOTIFY-002`, `T-IOS-COMPAT-001` |
| [IOS-010](requirements.md#5-요구사항) | Contract, Security, Emulator | 인증·가구·금액·달력 검증 | 무인증·타 가구·0·NaN·overflow·2/30·24:00·임의 owner | 권한/field 오류와 모든 저장소 변경 없음 | `T-IOS-002`, `T-IOS-SEC-001` |
| [IOS-011](requirements.md#5-요구사항) | Emulator, Concurrency | Intake receipt·Ledger claim | 동일 요청 동시 2회, callback retry, receipt 완료 전 중단 | 거래 한 건·같은 결과 재생·알림 멱등 | `T-IOS-001` |
| [IOS-012](requirements.md#5-요구사항) | Contract, Security I | HTTP Adapter·Ingress limit | POST/GET/OPTIONS, JSON/기타, version, byte/field/key 경계, CORS-only, rate/quota 병렬 경합 | 허용 POST만 Application 한 번, 나머지는 안정 status/code와 downstream 0회 | `T-IOS-003`, `T-IOS-SEC-002` |
| [IOS-013](requirements.md#5-요구사항) | Contract, Security, UI | ShortcutCredential 발급·검증·설치·재발급 | 최초 발급, 같은 idempotency key 재전송, 응답 유실 뒤 명시적 재발급, 재발급 경합, revoked/replaced, Membership 상실, body 위조 owner/household, 원문 재조회·로그, 설치 중단, 활성 자격 설정 화면 | 최초 원문 1회, 재전송은 `AlreadyIssued` 메타데이터만, 명시적 재발급은 이전 키 원자 폐기, hash 저장, claim Actor만 사용, endpoint·POST·JSON·Authorization·typed 응답이 완성된 Shortcut+붙여넣기 1회, 가구원 초대 다음 배치·활성 화면은 제목 오른쪽의 작은 재발급 버튼만 표시 | `T-IOS-SEC-002`, `T-IOS-INSTALL-001` |

공통 contract suite는 같은 key의 동일·상이 payload, method/content type/version/body/field/key/rate/quota 경계, CORS와 credential 독립성, Created/Duplicate response schema, 원문 비노출, Android와 Shortcut이 만든 `CaptureEnvelope.v1`의 producer/consumer 호환을 검증합니다. Cross-cutting 전체 보안 행렬은 [`T-SEC-002`](../../../../cross-cutting/security-privacy.md#7-보안-테스트-행렬)가 소유하고 이 모듈은 `T-IOS-SEC-001`, `T-IOS-SEC-002`에서 Shortcut 입력 경계를 검증합니다.

## 12. 확정 정책과 구현 순서

다중 FID endpoint는 [DEC-020](../../../../governance/decisions.md#dec-020), 카드사 헤더는 [DEC-030](../../../../governance/decisions.md#dec-030), Shortcut credential 발급·반자동 설치·폐기는 [DEC-033](../../../../governance/decisions.md#dec-033)으로 확정되었습니다.

구현 순서는 (1) value normalizer·parser·owner·연도 legacy characterization, (2) DEC-029 공통 연도 Policy fixture 연결, (3) HTTP wrapper에서 순수 handler와 OPTIONS를 분리하고 유한 ingress limit을 먼저 적용, (4) DEC-033 scoped credential 발급·검증·폐기 Application과 반자동 설치 UI·공유 Shortcut·보안 목표 test, (5) `CaptureEnvelope.v1` 변환·공통 Intake Fake, (6) 실제 Intake 연결과 DEC-003 경합 test, (7) transaction/notification 분리 response, (8) duplicate 알림 멱등화, (9) Legacy Response Mapper와 직접 Firestore·FCM 접근 제거 순입니다.
