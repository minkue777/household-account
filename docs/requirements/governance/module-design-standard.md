# 모듈 상세 설계 규약

> 상태: Accepted — 테스트와 구현의 공통 형식  
> 상위 요구사항 규약: [요구사항 문서 규약](conventions.md)  
> 목표 아키텍처: [목표 Clean Architecture 설계](../../architecture/target-clean-architecture.md)  
> 테스트 원칙: [요구사항 기반 테스트 전략](test-strategy.md)

## 1. 목적과 설계 권위

각 모듈의 `design.md`는 요구사항을 코드와 테스트로 옮기기 위한 상세 설계의 단일 원본이다. 다음을 결정한다.

- 모듈이 외부에 제공하는 Input Port와 versioned wire API
- Use Case의 입력, 출력, 오류, 권한, 멱등성 경계
- Domain 모델, 불변식, 상태 전이와 Policy 교체 지점
- Output Port, 저장 모델, Unit of Work와 동시성 제어
- Integration Event와 Projection 계약
- 패키지 배치와 허용 의존성
- 요구사항 ID와 자동화 테스트의 일대일 추적

문서 충돌 시 권위 순서는 `Accepted 제품 결정/requirements.md → 목표 아키텍처 → design.md → 현재 코드`다. 상세 설계는 요구사항을 바꾸지 않는다. 요구사항만으로 결정할 수 없는 제품 정책은 임의로 확정하지 않고 명명된 Policy Port로 격리한 뒤 [미결정 사항 단일 목록](pending-decisions.md)의 질문 번호를 링크한다.

## 2. 모듈 문서 배치

```text
modules/<module>/
  requirements.md   # 무엇을 보장해야 하는가
  design.md         # 어떤 경계와 계약으로 구현·검증하는가
```

- 요구사항 ID와 Canonical 테스트 ID는 `requirements.md`만 소유한다.
- `design.md`는 ID를 링크하고 테스트 단위·fixture·관찰 결과를 구체화한다.
- 공통 타입과 오류를 각 모듈 문서에 복사하지 않고 이 규약과 목표 아키텍처를 참조한다.
- 코드 경로는 목표 경로를 적고, 아직 없는 경로에는 `목표`라고 표시한다.

## 3. 공통 Application 계약

### 3.1 Command envelope

모든 외부 쓰기 요청은 다음 의미를 공유한다.

```ts
interface CommandEnvelope<TPayload> {
  contractVersion: string;
  commandId: string;         // trace와 correlation
  idempotencyKey: string;    // 같은 논리 요청의 재시도
  householdId: string;       // 명시적 tenant 범위
  payload: TPayload;
}
```

`principalUid`, `role`, `capabilities`는 클라이언트 payload에서 받지 않는다. Inbound Adapter가 인증 정보를 검증해 서버 내부 `ActorContext`를 생성한다.

```ts
interface ActorContext {
  principalUid: string;
  householdId: string;
  actingMemberId: string;
  role: string;
  capabilities: ReadonlySet<string>;
}
```

Scheduler는 최소 Capability를 가진 `SystemActor`를 사용한다. 같은 `idempotencyKey + payload hash`는 저장된 typed result를 재생하고, 같은 key의 다른 payload는 `Conflict`다.

### 3.2 공통 Result와 오류

각 Input Port는 예외를 transport 밖으로 던지는 대신 필요한 항목만 아래 union에서 선택한다.

```text
Success<T>
ValidationError(fieldErrors)
Unauthenticated
Forbidden(code)
NotFound(resource, id)
Conflict(code, currentVersion?)
Duplicate(existingId)
AlreadyProcessed(existingId?)
NeedsConfirmation(candidates)
NoData(reason)
RetryableFailure(code, retryAfter?)
ContractFailure(code)
PartialFailure(succeeded, failed)
```

Transport Adapter만 이를 HTTP/callable status로 변환한다. 테스트는 메시지 문자열보다 안정적인 오류 `code`와 typed payload를 검증한다.

### 3.3 Query 계약

- Query는 `ActorContext`와 명시적 tenant 범위를 받는다.
- 목록은 결정적 정렬 기준과 opaque cursor를 갖는다.
- `NoData`, 권한 실패, 공급자 실패를 빈 배열이나 0으로 합치지 않는다.
- 실시간 Firestore Read Contract는 읽기 전용 schema, Rules, index와 데이터 관찰 시각을 명시한다.
- 영속 Projection Query는 필요에 따라 `schemaVersion`, `sourceCheckpoint`, `updatedAt`, `freshness`를 반환한다. 요청 시 Canonical 원천에서 계산하는 View에는 인위적인 Projection freshness를 추가하지 않는다.

## 4. Port와 의존성 규칙

### 4.1 공개 Input Port

공개 Port 표에는 다음 열을 사용한다.

| 항목 | 기록 내용 |
|---|---|
| 이름·종류 | Command, Query, Event Handler, Workflow |
| 호출자 | Web, Android, Scheduler, 다른 모듈의 공개 Port |
| 입력 | DTO와 필수 metadata |
| 결과 | typed Result와 Read Model |
| 권한 | Capability 또는 Role |
| 일관성 | 단일 Aggregate, Context Unit of Work, Process Manager |
| 멱등성 | key, receipt, replay 결과 |

다른 모듈은 `public.ts`의 Input Port, DTO, Read Model, Event schema만 import한다. Domain Entity, Repository, Firestore Mapper, 공급자 DTO는 공개하지 않는다.

### 4.2 Output Port 생성 기준

다음 실제 경계에만 Interface를 둔다.

- Repository와 Unit of Work
- 다른 모듈의 공개 Port
- Clock, ID, hashing, transaction runner
- Firebase, FCM, OS, local storage, 외부 HTTP 공급자
- Outbox append, Inbox claim, observability

순수 계산을 재사용한다는 이유만으로 Interface나 `shared/utils`를 만들지 않는다. 업무 Policy는 소유 모듈 Domain에 둔다.

### 4.3 Context Workflow

같은 Context의 둘 이상 모듈을 강한 일관성으로 변경할 때만 Context Application Workflow가 Unit of Work를 소유한다.

- `ProcessRecurringMonthWorkflow`: Recurring + Ledger
- `RevalueAssetWorkflow`: Holdings + Portfolio Core
- `ApplyAssetAutomationWorkflow`: Asset Automation + Portfolio Core

기능별 participant는 검증 결과와 변경 의도만 제공하며 직접 commit하지 않는다. Context를 넘는 후속 효과는 Outbox/Saga를 사용한다.

## 5. 저장·동시성·이벤트 규약

### 5.1 저장 모델

각 설계는 다음을 명시한다.

- Aggregate와 Canonical Writer
- 논리 문서 key와 tenant prefix
- Domain ↔ persistence mapper 경계
- `aggregateVersion` 또는 precondition
- idempotency receipt와 보존 조건
- 같은 transaction에 포함할 Canonical write, receipt, outbox
- migration/backfill 중 legacy read/write 처리

Firestore path와 document DTO는 Domain 타입이 아니다. 다른 모듈은 소유 모듈의 물리 collection name을 사용하지 않는다.

[DEC-046](decisions.md#dec-046)의 공통 보존 기준을 모든 모듈에 적용한다. 정상 terminal receipt·완료 Outbox/Inbox·JobRun은 terminalAt부터 30일, unresolved 상태는 해결 전까지 보존한다. 업무 중복 방지 claim·tombstone과 AutomationExecution은 일반 운영 receipt TTL로 삭제하지 않으며 해당 Aggregate·수동 purge 수명주기를 따른다. release manifest는 자동 TTL 없이 장기 보존한다.

### 5.2 Integration Event

모듈 간 비동기 효과는 Canonical 변경과 같은 transaction에서 `OutboxAppendPort`로 기록한다.

```text
eventId
eventType + eventVersion
householdId
aggregateId + aggregateVersion
occurredAt
correlationId + causationId
payload
```

- `eventType + eventVersion`의 producer는 하나다.
- payload는 확정 사실과 소비자에게 필요한 최소 식별자만 포함한다.
- 금융 알림 원문과 불필요한 개인정보를 포함하지 않는다.
- Consumer는 `(eventId, handlerName)`으로 멱등 처리하고 순서가 중요하면 `aggregateVersion`을 검사한다.

## 6. 상세 설계 필수 목차

모든 `design.md`는 다음 목차를 사용한다. Domain이 없는 플랫폼 모듈은 4번을 플랫폼 상태·정책으로 바꿀 수 있다.

1. 설계 목적과 추적성
2. 모듈 경계와 책임
3. 공개 계약
4. Domain 모델과 불변식
5. Application Use Case 상세
6. Port 설계
7. 저장·트랜잭션·동시성
8. Event·Projection·외부 연동
9. 오류·보안·관측성
10. 목표 패키지 구조
11. 테스트 설계
12. 미결정 사항과 구현 순서

`Application Use Case 상세`에는 최소한 다음을 적는다.

- 사전조건과 권한
- 입력 정규화와 검증
- Domain 실행 순서
- Unit of Work에 포함되는 변경
- 성공 결과와 가능한 typed error
- retry 시 관찰 가능한 결과
- 생성 Event와 외부 부수 효과의 실행 시점

## 7. 테스트 설계 규약

### 7.1 추적성

`design.md`의 테스트 표에는 다음 열을 사용한다.

| 요구사항 ID | 테스트 수준 | 테스트 대상 | 핵심 fixture/경계값 | 관찰 결과 | Canonical 테스트 ID |
|---|---|---|---|---|---|

- 모든 소유 요구사항 ID가 적어도 한 행에 등장해야 한다.
- `requirements.md`에 Canonical 테스트 ID가 있으면 그대로 연결한다.
- Canonical ID가 없는 요구사항은 새 ID를 임의로 만들지 않고 `추가 예정`으로 표시한다.
- 결함 요구사항은 잘못된 현재 결과가 아니라 목표 불변식을 검증한다.
- 같은 의미의 테스트를 소비자 모듈에서 다시 구현하지 않고 제공자 fixture와 contract suite를 사용한다.

### 7.2 계층별 책임

| 계층 | 검증 내용 | 금지 사항 |
|---|---|---|
| Domain Unit | Value Object, Policy, 상태 전이, 경계값 | Firebase·React·Android SDK |
| Application | 권한, Port 조정, rollback, typed result, Event | 실제 외부 HTTP |
| Contract | wire schema, enum, 오류, 이전 version fixture | 공급자 내부 DTO 노출 |
| Repository Conformance | Fake와 Firestore Adapter의 같은 동작 | Adapter별 별도 의미 |
| Emulator Integration | Rules, transaction 경합, Outbox/Inbox | 운영 데이터 사용 |
| Client | Controller/ViewModel/parser/Bridge 상태 | 서버 업무 판정 복사 |
| E2E | 핵심 사용자 흐름과 tenant 격리 | 모든 조합의 중복 검증 |

### 7.3 필수 Fake와 fixture

모듈이 사용하는 경계에 따라 다음을 제공한다.

- `FixedClock`, `SequenceIdGenerator`
- callback을 두 번 실행할 수 있는 `RetryingUnitOfWorkFake`
- Repository In-memory Fake + 공통 Conformance Suite
- `OutboxAppendSpy`, `InboxClaimFake`
- 성공, `NoData`, retryable, permanent, contract drift 공급자 fixture
- 같은 idempotency key의 동일/상이 payload fixture
- 가구 A의 Actor가 가구 B를 요청하는 tenant 격리 fixture

### 7.4 구현 전 계약 테스트 등록과 활성화

- 목표 코드가 아직 없을 때도 공개 Input Port의 최소 구조를 테스트 쪽 `Subject` interface로 선언하고 Given/When/Then 본문을 완성합니다.
- 미구현 suite는 `describe.skip` 또는 `test.todo`로 등록하되, skip은 통과가 아니며 활성·대기 개수를 별도로 보고합니다.
- 실제 구현을 시작할 때 production `public.ts`의 Input Port를 얇은 subject factory로 연결하고 같은 suite를 활성화합니다. 테스트를 구현 클래스에 맞춰 다시 쓰지 않습니다.
- 계약 테스트는 typed Result, 공개 Read Model, 최종 Canonical 상태와 공개 Event만 관찰합니다. Firestore 경로·SDK 호출 순서·private class·함수 분해 방식은 검증하지 않습니다.
- Repository Fake와 Firestore Adapter에는 동일한 Conformance Suite를 적용하되, 테스트 driver의 seed·경합·fault injection API는 제품 공개 계약으로 내보내지 않습니다.
- 루트 `contracts/`에는 TypeScript·Kotlin처럼 둘 이상의 런타임이 공유하는 wire schema와 golden fixture만 둡니다. 한 모듈 안에서만 쓰는 Domain builder와 Fake는 해당 모듈 테스트 폴더가 소유합니다.

## 8. 구현 준비 완료 기준

다음 조건을 모두 만족해야 테스트 코드 작성을 시작한다.

1. 모든 요구사항 ID가 테스트 설계 표에 매핑돼 있다.
2. 공개 Input Port의 DTO·Result·권한·멱등성 규칙이 정해져 있다.
3. Aggregate, Canonical Writer와 transaction 경계가 정해져 있다.
4. 다른 모듈과의 동기 Port와 비동기 Event가 구분돼 있다.
5. 외부 시스템은 Output Port와 contract fixture 뒤에 있다.
6. Pending 제품 결정은 교체 가능한 Policy로 격리돼 있다.
7. 실패·중복·재시도·부분 실패가 typed result로 관찰 가능하다.
8. 목표 패키지에서 Domain이 Framework를 import하지 않는다.
9. Characterization test와 목표 test의 활성화 순서가 적혀 있다.
