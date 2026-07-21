# 공통 시스템 계약 상세 설계

> 요구사항: [시스템 컨텍스트와 공통 계약](context.md#6-공통-요구사항)  
> 종단 흐름: [Context 간 종단 흐름](flows.md)  
> 공통 형식: [모듈 상세 설계 규약](../governance/module-design-standard.md)  
> 보안 경계: [보안과 개인정보](../cross-cutting/security-privacy.md)  
> 목표 아키텍처: [목표 Clean Architecture 설계](../../architecture/target-clean-architecture.md)

## 1. 설계 목적과 추적성

이 문서는 특정 기능 모듈이 소유하지 않는 `SYS-001~009` 공통 계약을 코드·테스트 기준으로 내린다. 기능별 `design.md`가 tenant, client session, 금액, 날짜, 호환 읽기와 typed result를 서로 다르게 재정의하지 않도록 Shared Kernel과 경계 Adapter의 최소 계약만 소유한다.

## 2. 경계와 책임

공통 계층이 소유하는 것:

- tenant 범위 ID와 서버 내부 ActorContext 형식
- 원 단위 금액, LocalDate·LocalTime·Instant의 최소 Value Object
- Command metadata, typed Result와 공통 오류 분류
- legacy transaction/category/member reference의 경계 해석 규칙
- client subscription·cache·비동기 응답의 session scope와 폐기 규칙
- 운영 migration·backfill의 권한·범위·checkpoint 계약
- Clock, ID, UnitOfWork, Outbox 같은 기술 중립 Port

공통 계층이 소유하지 않는 것:

- Transaction, Category, Member 등 기능 Entity
- 월 분할, merchant normalization, 자산 평가 같은 업무 Policy
- Firebase·React·Android DTO와 Repository
- 화면 표시 문자열과 formatting

## 3. 공통 공개 계약

### 3.1 Tenant와 Actor

```ts
type HouseholdId = string & { readonly __brand: 'HouseholdId' };
type MemberId = string & { readonly __brand: 'MemberId' };

interface TenantScope {
  householdId: HouseholdId;
}

interface ClientSessionScope {
  sessionGeneration: string;
  principalUid: string;
  householdId: HouseholdId;
  memberId: MemberId;
}
```

Inbound Adapter는 인증 credential을 검증한 뒤 Access의 `ResolveActorContext`를 호출한다. payload의 uid, role, member name은 ActorContext 생성 근거로 신뢰하지 않는다. 모든 가구 범위 Command·Query는 `TenantScope`를 명시하며 Actor의 household와 일치하지 않으면 `Forbidden(TENANT_MISMATCH)`다.

Web·Android composition root는 인증과 Membership 해결이 끝난 뒤에만 `ClientSessionScope`를 발급한다. `sessionGeneration`은 로그인·로그아웃·가구/멤버 전환마다 바뀌며 Repository 요청, 실시간 구독, cache key, UI controller가 함께 보존한다. `guest`나 localStorage 문자열로 보호 범위를 대신 만들지 않는다.

### 3.2 Money·날짜·시간

```ts
interface MoneyInWon { readonly value: number }       // safe integer
interface AccountingDate { readonly value: string }  // YYYY-MM-DD
interface LocalClockTime { readonly value: string }   // HH:mm
```

- `MoneyInWon`은 JavaScript safe integer 범위의 정수다.
- 정상 거래 생성용 `PositiveMoneyInWon`은 0보다 커야 한다.
- 소수 입력을 자동 절삭하는 것은 Transport 호환 Adapter에 한정하고 신규 v2 계약은 `ValidationError(NOT_INTEGER)`로 거부한다.
- 날짜·시간은 strict calendar validation을 거친다. 정규식 통과만으로 2월 30일을 허용하지 않는다.
- 회계일, 결제 현지 시각, 시스템 `Instant`를 서로 대체하지 않는다.
- 업무 LocalDate·LocalTime·YearMonth과 오늘·월 경계는 [DEC-023](../governance/decisions.md#dec-023)에 따라 IANA `Asia/Seoul`로 고정한다. 절대 시각은 UTC Instant로 저장하고 경계에서만 서울 현지 시각으로 변환한다.
- 가구 timezone 필드·설정 UI는 만들지 않으며 실행 환경의 기본 timezone을 참조하지 않는다.

### 3.3 공통 Command·Result

Command envelope와 typed Result는 [모듈 상세 설계 규약](../governance/module-design-standard.md#3-공통-application-계약)을 단일 원본으로 사용한다. 같은 idempotency key와 동일 payload는 저장 결과를 재생하고, 다른 payload hash는 `Conflict(IDEMPOTENCY_PAYLOAD_MISMATCH)`다.

## 4. 호환 모델과 불변식

| 호환 경계 | 읽기 불변식 | 신규 쓰기 |
|---|---|---|
| 거래 유형 | 누락이면 `expense` | `transactionType` 필수 |
| 카테고리 | 누락이면 `etc`; unknown key는 값 보존 | 안정 categoryId 필수 |
| Android category enum | legacy 대문자 값을 명시적 mapper로 변환 | 생성 schema의 canonical 값 |
| 멤버 소유권 | legacy 이름을 migration index로 해석하고 원문 보존 | `memberId` 필수; 이름은 snapshot |

호환 mapper는 Domain에 `undefined`나 대소문자 변형을 흘리지 않는다. 알 수 없는 category를 `etc`로 덮어써 정보 손실을 만들지 않고 `UnknownCategoryReference(rawKey)`로 보존한다.

## 5. 공통 Use Case 처리 순서

### 5.1 Tenant-scoped Command

1. Transport schema와 contractVersion을 검증한다.
2. credential을 인증하고 Access에서 ActorContext를 해결한다.
3. envelope householdId와 Actor householdId를 비교한다.
4. 기능 Input Port가 Domain 불변식을 검증한다.
5. Unit of Work가 Canonical 변경, receipt, Outbox를 commit한다.
6. commit 이후에만 외부 side effect를 비동기로 실행한다.
7. typed Result를 Transport status로 변환한다.

### 5.2 Legacy Read

1. Persistence DTO의 schemaVersion을 확인한다.
2. 해당 version mapper만 적용한다.
3. 누락·unknown 값을 위 표대로 보존·해석한다.
4. Domain/Read Model에는 canonical 타입만 전달한다.
5. shadow-read 시 legacy와 v2 결과 차이를 개인정보 없이 관측한다.

### 5.3 Client session 전환

1. 인증·Membership 검증 전에는 보호 Query, 기본 데이터 생성, FID endpoint 등록을 시작하지 않는다.
2. 새 `ClientSessionScope`를 발급하기 전에 이전 요청을 cancel하고 실시간 listener를 unsubscribe한다.
3. 이전 세대 cache와 화면 state를 동기적으로 비운다.
4. 모든 async callback은 시작할 때의 generation과 현재 generation을 비교한다.
5. 불일치 결과는 저장·render·후속 Command 없이 폐기한다.
6. Native session mirror는 전체 scope를 versioned record 하나로 원자 교체하거나 모두 삭제한다.

### 5.4 Migration·backfill

1. 승인된 운영 actor와 대상 environment를 검증한다.
2. 명시적 household/schema scope와 dry-run을 먼저 실행한다.
3. page별 deterministic checkpoint와 idempotency receipt를 저장한다.
4. 예상 건수·금액·hash와 실제 변경을 reconciliation한다.
5. 불일치나 범위 밖 문서를 만나면 다음 page로 덮어쓰지 않고 중단한다.
6. client application에는 이 Input Port를 노출하거나 bundle에 export하지 않는다.

## 6. 공통 Port 설계

| Port | 목적 | 필수 Fake |
|---|---|---|
| `Clock` | Instant와 회계 기준 시각 주입 | `FixedClock` |
| `IdGenerator` | 안정 ID·event ID 생성 | `SequenceIdGenerator` |
| `UnitOfWork` | retry 가능한 원자 commit | callback 2회 `RetryingUnitOfWorkFake` |
| `OutboxAppendPort` | 현재 UoW에 immutable Event 추가 | envelope 검증 Spy |
| `ActorContextResolver` | 인증 주체와 membership 해결 | tenant fixture Fake |
| `PayloadHasher` | idempotency payload 비교 | deterministic Fake |
| `ClientSessionScopeProvider` | 인증 완료 session 세대 발급·현재성 비교 | generation 전환 Fake |
| `ClientSubscriptionRegistry` | 이전 세대 listener·요청 동기 폐기 | unsubscribe/cancel Spy |
| `MigrationCheckpointPort` | 운영 page·dry-run·reconciliation 기록 | idempotent page Fake |

기능 Repository와 Policy는 Shared Kernel에 두지 않는다.

## 7. 저장·트랜잭션·동시성

- 모든 Canonical 문서는 `schemaVersion`, server `createdAt/updatedAt`을 갖는다.
- 신규 Writer는 canonical 필드를 빠짐없이 쓰고 legacy 누락값을 새로 만들지 않는다.
- transaction callback 안에서 외부 HTTP, FCM, UI broadcast, 비멱등 log를 실행하지 않는다.
- callback 재실행에도 같은 ID와 변경 의도를 사용한다.
- 다중 문서 작업이 한 transaction 범위를 넘으면 checkpoint Process Manager로 전환한다.
- 부분 commit을 `Success`로 변환하지 않는다. rollback 또는 구조화된 `PartialFailure`만 허용한다.
- client cache와 listener key에는 householdId뿐 아니라 sessionGeneration을 포함하고, 세대가 종료되면 재사용하지 않는다.
- migration은 user-facing UnitOfWork와 분리하며 범위 없는 collection scan 뒤 현재 tenant를 덧씌우지 않는다.

## 8. Event와 Contract schema

- Command, Event, Read Model은 `contracts/schemas`에서 version을 관리하고 TypeScript/Kotlin을 생성한다.
- Event envelope는 [목표 Outbox 계약](../../architecture/target-clean-architecture.md#73-모든-모듈-간-비동기-효과는-durable-outbox-사용)을 따른다.
- legacy fixture와 v2 fixture를 함께 유지하되 fixture가 Policy의 원본이 되지 않게 한다.
- unknown eventVersion은 조용히 무시하지 않고 consumer contract failure/dead letter로 분류한다.

## 9. 오류·보안·관측성

- `Unauthenticated`, `Forbidden`, `ValidationError`, `Conflict`, `RetryableFailure`, `PartialFailure`를 안정 code로 구분한다.
- 로그에는 가구 key, 알림 원문, FCM FID, memo, credential을 넣지 않는다.
- 모든 trace는 commandId/correlationId와 비식별 household hash를 사용한다.
- 보안 Rules와 서버 Application 인가는 둘 다 검사한다. 한쪽을 다른 쪽의 대체물로 보지 않는다.
- legacy fallback 사용률, mapper contract failure, tenant mismatch, idempotency conflict, partial failure를 metric으로 집계한다.
- stale session callback 폐기 수와 migration dry-run/reconciliation 차이는 원문 ID 없이 metric으로 남긴다.

## 10. 목표 패키지 구조

```text
contracts/
  schemas/shared/
  fixtures/legacy-v1/
  generated/typescript/
  generated/kotlin/
functions/src/shared/kernel/
  ids.ts
  money.ts
  date-time.ts
  result.ts
functions/src/shared/application/
  actor-context.ts
  client-session-scope.ts
  command-envelope.ts
  unit-of-work.ts
  outbox-append-port.ts
```

Web·Android에는 생성 wire 타입과 각 플랫폼 mapper만 두며 서버 Domain Policy를 복사하지 않는다.

## 11. 테스트 설계

| 요구사항 ID | 수준 | 테스트 대상 | 핵심 fixture·경계값 | 관찰 결과 | Canonical 테스트 ID |
|---|---|---|---|---|---|
| SYS-001 | C, Rules, E2E | Tenant/Actor 계약 | 무인증, 같은 가구, 다른 가구, 관리자 | 허용 행렬과 tenant 불변식 | T-SEC-001 |
| SYS-002 | U, Repository C | Legacy transaction mapper | type 누락·expense·income·unknown | 누락만 expense, 신규 쓰기 명시 | T-LED-001 |
| SYS-003 | U, C | Category mapper | 누락, unknown, 대문자 Android 값 | etc fallback·unknown 보존·canonical wire | T-SYS-003 |
| SYS-004 | U, C | Money Value Object | 0, 음수, 소수, safe integer 경계 | 정상 거래는 양의 원 정수 | T-SYS-004 |
| SYS-005 | U, C | 날짜·시간 Value Object | 윤년, 월말, 잘못된 날짜·시간 | strict canonical format | T-SYS-005 |
| SYS-006 | Repository, migration I | Member reference mapper | 이름-only, 매핑 있음/없음, rename | 안정 memberId 전환과 원문 보존 | T-SYS-006 |
| SYS-007 | Application, Emulator, E2E | Result·UnitOfWork | callback 2회, 중간 실패, 외부 side effect | rollback/typed failure, 거짓 완료 없음 | T-SYS-007 |
| SYS-008 | C, UI, E2E | ClientSessionScope·subscription registry | A→B 전환, 늦은 A callback, guest/admin route, 같은 탭 logout | A state·write·render 0건, listener 해제 | T-SYS-008 |
| SYS-009 | C, I, 운영 계약 | Migration runner | client 호출, dry-run, 범위 밖 문서, page 재실행, reconciliation 차이 | client API 없음, 범위·멱등·중단 보장 | T-SYS-009 |

### 11.1 공통 시스템 Canonical 테스트 시나리오

| 테스트 ID | Given / When / Then | 연결 요구사항 |
|---|---|---|
| T-SYS-003 | 누락·대문자·미등록 category / 저장 경계 해석 / 누락은 etc, Android 대문자는 canonical 소문자, 미등록 key는 손실 없이 unknown으로 보존 | SYS-003 |
| T-SYS-004 | 양의 safe integer와 0·음수·소수·범위 초과·문자열 / Money 생성 / 양의 원 정수만 보존하고 묵시적 절삭·변환 없이 typed validation error | SYS-004 |
| T-SYS-005 | 윤년·잘못된 월말·비정규 날짜/시간과 UTC/서울 월 경계 / 날짜·시간 해석 / strict canonical format과 Asia/Seoul 결과 | SYS-005 |
| T-SYS-006 | 유일·누락·동명이인 레거시 이름 참조와 이후 rename / memberId 전환 / 유일한 경우만 안정 ID로 연결하고 원문 보존, 나머지는 수동 reconciliation | SYS-006 |
| T-SYS-007 | transaction callback 재실행과 본문·receipt·Outbox 중간 실패 / Command 실행 / 논리 결과 한 번 또는 전체 rollback, commit 전 외부 효과 없음 | SYS-007 |
| T-SYS-008 | A→B session 전환·logout 뒤 늦은 Query/listener/write / client callback 처리 / 이전 cache·구독 폐기와 state·write·render 0건 | SYS-008 |
| T-SYS-009 | client 호출, dry-run, scope 밖 문서, stale plan hash, page 실패 checkpoint / migration 실행 / 운영 경계·범위·멱등·reconciliation 보장 | SYS-009 |

Cross-cutting 인증 진입점 검증은 [T-SEC-002](../cross-cutting/security-privacy.md#7-보안-테스트-행렬)가 단일 소유한다. 시스템 suite는 이 Canonical fixture를 재사용해 무인증 Functions·Shortcut·FCM·배당 쓰기가 모두 권한 오류와 변경 없음으로 수렴하는지만 확인하고 새 테스트 ID를 만들지 않는다.

추가 공통 suite:

- TypeScript/Kotlin 생성 DTO의 같은 JSON fixture round-trip
- Fake/Firestore Adapter에 같은 legacy mapper·receipt conformance suite
- Rules와 Application 권한 행렬의 차이 검출
- transaction callback 두 번 실행 시 외부 side effect 0회
- 로그 redaction과 unknown contract version dead-letter
- session 세대 변경 중 느린 Query·listener·endpoint 등록 callback 폐기
- migration runner의 dry-run/실행 hash 일치와 client bundle export 금지 architecture test

## 12. 미결정 사항과 구현 순서

미결정 항목은 [코드 감사 후 미결정 사항](../governance/pending-decisions.md)에서 일괄 관리한다. legacy member name 매핑 실패는 운영 migration/repair가 자동 추정하지 않고 수동 연결 후보와 reconciliation report만 만든다.

구현 순서:

1. legacy fixture와 `SYS-*` Characterization/목표 test를 등록한다.
2. Shared Kernel Value Object와 생성 wire schema를 만든다.
3. ActorContext/tenant middleware와 Rules test를 먼저 적용한다.
4. Ledger 첫 vertical slice에 UnitOfWork·receipt·Outbox를 연결한다.
5. 모듈별 mapper 전환과 backfill 완료 후 legacy 쓰기를 제거한다.
