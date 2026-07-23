# Context 간 종단 흐름

> 상태 규약: [요구사항 문서 규약](../governance/conventions.md)  
> Context 지도: [5개 업무 Bounded Context](../README.md#2-5개-업무-bounded-context)  
> 데이터 소유권: [데이터 소유권과 Context 의존성](../cross-cutting/data-ownership.md)

## 1. 목적과 표기

기능 모듈 내부 요구사항은 `modules/` 문서가 소유한다. 이 문서는 **둘 이상의 업무 Context 또는 업무 Context와 지원·플랫폼 영역이 함께 참여하는 흐름**만 설명한다.

각 흐름은 다음을 구분한다.

- 현재 기능 모듈 흐름: 코드에서 관찰한 호출 순서
- 목표 Context 흐름: 공개 Command·Query·Event와 Writer 경계
- 같은 Context 내부 조정: 직접 HTTP가 아닌 Application Port 또는 명시적 Context Unit of Work
- Context 간 비동기 효과: Canonical 변경과 함께 저장한 Durable Outbox Event

화살표가 다른 Context의 Repository·Firestore 경로 직접 접근을 의미하지 않는다.

## 2. Web 수동 거래

### 참여 경계

```text
Access & Household
  → Household Finance [Category Catalog → Ledger]
  → Notifications
  → Reporting/Home Read Side
```

현재 기능 모듈:

[가구와 접근](../contexts/access-household/modules/household-access/requirements.md) → [카테고리와 예산](../contexts/household-finance/modules/categories-budget/requirements.md) → [거래 원장](../contexts/household-finance/modules/ledger/requirements.md) → [푸시 알림](../contexts/notifications/modules/notifications/requirements.md)

현재 흐름:

1. 사용자가 가구·멤버 범위에서 지출 또는 수입을 입력한다.
2. Web이 입력 규칙을 검증하고 거래 DTO를 만든다.
3. Web이 거래 원장 컬렉션에 직접 저장한다.
4. 월·일·카테고리 집계가 구독 결과에 반영된다.
5. createdBy가 있는 거래만 현재 trigger의 알림 대상 계산으로 이어진다.

목표 Context 흐름:

1. Web Adapter가 인증 token과 `CreateManualTransaction` Command를 보낸다.
2. Access가 ActorContext와 가구 상태를 검증한다.
3. Finance의 Category Catalog가 category reference를 제공한다.
4. Ledger가 Transaction과 `TransactionRecorded.v1` Outbox를 원자 commit한다.
5. Notifications가 Event를 멱등 소비한다. Budget·Reporting은 다음 조회 때 Ledger의 월·기간 범위 Query를 모두 읽어 계산한다.
6. Command 결과와 알림 결과를 별도 상태로 관측하고, 예산·통계 조회 실패는 거래 저장 결과와 분리한다.

관련 요구사항: HH-001~005, LED-001~007, CAT-003, PUSH-004.

교정 불변식:

- 거래 저장 성공과 알림 전달 성공은 별도 결과다.
- Web은 Canonical `expenses`를 직접 쓰지 않는다.
- 모든 신규 거래는 검증된 creatorMemberId, 업무 source, originChannel을 기록하며, 자동 알림과 명시적 `알림 보내기` 수신자는 [DEC-013](../governance/decisions.md#dec-013)에 따라 Notifications가 별도로 결정한다.

### 2.1 일반 거래 논리 삭제·운영 복구·수동 영구 정리

```text
일반 사용자 Delete
  → Ledger가 active·expectedVersion 검증
  → 같은 UoW에서 Transaction deleted 전이 + receipt + TransactionDeleted.v1
  → 목록·검색·합계는 active 집합으로 수렴

실수 삭제 복구 요청
  → 운영자/Agent가 대상·감사 사유 확인
  → Ledger RestoreDeletedTransaction
  → 같은 transactionId·provenance를 active로 복구

별도 영구 삭제 요청
  → 운영자/Agent가 종속 lineage·snapshot·dedup 자료 확인
  → Ledger PurgeDeletedTransaction
  → 필요한 재등록 방지 tombstone을 제외한 소유 데이터 원자 정리
```

교정 불변식:

- 일반 삭제는 문서 물리 삭제가 아니며 deleted 상태로 전환한 직후 모든 일반 조회·검색·집계에서 제외된다.
- deleted 거래는 자동 만료하지 않고 일반 사용자가 조회·복구할 수 없다.
- 복구·영구 정리는 일반 Web Command가 아니라 사용자의 명시적 요청을 확인한 운영자/Agent 작업이다.
- capture lineage가 있는 거래는 단일 `expenses` 문서만 지워 dedup·취소 계보를 끊지 않는다. 결제 취소 자체는 [DEC-041](../governance/decisions.md#dec-041)의 별도 흐름을 따른다.

관련 요구사항: LED-001, LED-005, LED-006, LED-009, SEA-001~004, DEC-065.

## 3. Android 승인 알림

### 참여 경계

```text
Android Delivery
  → Payment Capture [raw write-ahead journal → Functions Server Parser → Intake → Payment Configuration]
  → Household Finance [Ledger + 선택 Local Currency]
  → Notifications / QuickEdit Adapter
```

현재 기능 모듈:

[Android Host](../supporting-platform/modules/android-host/requirements.md) → [Android 결제 수집](../contexts/payment-capture/modules/android-payment-ingestion/requirements.md) → [결제 설정](../contexts/payment-capture/modules/payment-configuration/requirements.md) → [거래 원장](../contexts/household-finance/modules/ledger/requirements.md) → 선택 [지역화폐](../contexts/household-finance/modules/local-currency/requirements.md)

전환 전 기준선 흐름:

1. 알림 제목과 본문 후보를 조합한다.
2. 원문 로그 대상이면 parsing·중복 검사 전에 비동기 저장을 시도한다.
3. package와 본문 우선순위로 출처를 하나 선택한다.
4. 같은 package·본문의 30초 메모리 중복을 검사한다.
5. parser가 승인 후보를 만든다.
6. Android가 가맹점 규칙, 기본 카테고리, 등록 카드, 영속 중복을 평가한다.
7. Android가 `expenses`를 직접 저장하고 ID를 받으면 QuickEdit을 시작한다.
8. 저장 실패 여부와 무관하게 완료 broadcast를 보낼 수 있다.

현재 목표 Context 흐름:

1. Android가 등록 package의 `AndroidRawNotification.v1`과 안정 observation ID를 만들고 Keystore 키 기반 AES-256-GCM write-ahead journal에 먼저 기록한다.
2. 정상 경로는 WorkManager를 예약하지 않고 인증·App Check가 적용된 Functions에 즉시 제출한다. 임시 진단 원문은 이 경로와 경쟁하지 않도록 5초 뒤 best-effort로 전송한다.
3. Functions Server Parser가 DEC-029의 공통 연도 Policy로 미래가 아닌 결제일을 확정하고 원문을 제외한 내부 `CaptureEnvelope.v1`을 만든다. 결제 후보와 잔액 관찰 중 하나 이상이 있으면 되며 balance-only를 허용한다.
4. Payment Intake가 활성 Membership의 ActorContext와 source Policy를 검증하고 CaptureSubmissionReceipt가 idempotencyKey와 payloadHash를 claim한다.
5. 결제 branch가 있으면 Payment Configuration이 인증된 현재 멤버의 카드만 조회해 한 건 이상 일치하는지 판정하고 Category Catalog로 mapping 참조를 검증한 뒤 가맹점 mapping을 결정한다.
6. 결제 branch에서 Payment Capture가 DEC-003 fingerprint와 immutable CaptureProvenance를 생성한다.
7. Ledger가 Android 현재 멤버를 creatorMemberId로 기록하고 fingerprint claim, Transaction, capture lineage, Outbox를 한 transaction으로 commit한다.
8. 잔액 branch가 있으면 결제 parse·카드·Ledger 결과와 무관하게 Local Currency가 같은 observation key로 독립 반영한다.
9. 모든 branch 실행 결과를 안정적인 downstream command key와 함께 root receipt에 마지막 한 번 저장한다. 최종 저장 전 중단은 하위 idempotency receipt로 결과를 재생한다.
10. payment branch의 새 거래가 확정되면 응답의 `quickEditSnapshot`을 expected SessionScope의 암호화 QuickEdit FIFO에 먼저 내구화하고 capture journal을 ack/delete한 뒤 Activity를 연다. 구버전 ID-only entry만 별도 Query를 사용한다.
11. 직접 호출 실패, 일부 branch retryable 또는 follow-up enqueue 실패에서는 journal entry를 남기고 `APPEND_OR_REPLACE` WorkManager로 같은 idempotencyKey를 최대 72시간 재시도한다. Android 자동 푸시는 생성하지 않는다.

관련 요구사항: ING-001~008, PARSE-*, MER-001~006, CARD-004, ING-SAVE-001~006, BAL-*, QE-001.

교정 불변식:

- 원문 로그는 [DEC-002](../governance/decisions.md#dec-002)의 임시 Diagnostic Adapter다. 등록 source와 인증된 활성 SessionScope가 있을 때만 현재 파서 진단 필드를 best-effort 저장하고 진단 실패를 결제·잔액 실패로 바꾸지 않는다. [DEC-047](../governance/decisions.md#dec-047)에 따라 기능 제거 전까지 TTL 없이 전부 보존하고 제거 시 Writer·Rules·index·컬렉션을 함께 없앤다.
- 연도 없는 결제 시각은 [DEC-029](../governance/decisions.md#dec-029)에 따라 서울 수신 시각보다 미래가 아닌 가장 가까운 유효 연도이며 Shortcut과 같은 fixture로 검증한다.
- 로컬 write-ahead journal은 [DEC-032](../governance/decisions.md#dec-032)에 따라 암호화하고 원격 호출 전에 commit한다. terminal follow-up을 QuickEdit FIFO에 내구화한 뒤 삭제하며, 실패·partial entry만 WorkManager로 재시도하고 session 전환·72시간 만료·키 오류에서 삭제한다.
- Android는 Ledger·Payment Configuration 컬렉션을 직접 읽거나 쓰지 않는다.
- 중복 tuple은 [DEC-003](../governance/decisions.md#dec-003)을 따르고 Ledger가 원자 강제한다.
- 같은 idempotencyKey·payloadHash는 같은 결과를 재생하고, 같은 key의 다른 payloadHash는 `IdempotencyConflict`이며 어떤 downstream Command도 실행하지 않는다.
- 거래와 잔액 결과, 거래와 알림 결과를 각각 분리한다.
- 결제 후보가 거부·실패하거나 없어도 유효한 잔액 branch는 처리하고, 잔액 실패가 결제 branch를 롤백하지 않는다.
- 원 승인 증거와 capture ID는 사용자가 수정하는 가맹점·금액과 분리해 보존하고 모든 split/merge 파생 거래가 lineage를 유지한다.
- Android 거래는 creatorMemberId가 있어도 생성자 본인과 다른 가구원 모두에게 자동 푸시를 보내지 않는다.
- 타 멤버의 같은 카드사·wildcard 카드는 Android 승인 eligibility에 참여하지 않으며, 본인 카드가 여러 건 일치해도 거래 생성을 거부하지 않는다.

## 4. Android 취소 알림

### 참여 경계

```text
Android Delivery → Payment Capture → Household Finance / Ledger
```

현재 기능 모듈:

[Android 결제 수집](../contexts/payment-capture/modules/android-payment-ingestion/requirements.md) → [결제 설정](../contexts/payment-capture/modules/payment-configuration/requirements.md) → [거래 원장](../contexts/household-finance/modules/ledger/requirements.md)

현재 흐름:

1. 취소 후보를 parse하고 가맹점 mapping을 적용한다.
2. 취소일로부터 30일 범위에서 원거래를 찾는다.
3. 일반 거래 또는 월 분할 그룹 전체를 삭제 대상으로 만든다.
4. Android가 문서를 순차 삭제하고 개별 오류를 숨긴 뒤 완료 broadcast를 보낼 수 있다.

목표 Context 흐름:

1. Android가 `CancellationObservation.v1`을 Payment Capture에 전달한다.
2. Payment Capture가 source·parser·mapping을 적용한다.
3. Ledger `FindCancellationCandidates`가 captureLineageId와 원 승인 날짜·시각·금액·가맹점·카드 증거 같은 불변 원장 사실만 반환한다.
4. Payment Capture의 `CancellationMatchPolicy`가 금액·정규 가맹점·카드 완전 일치 후보만 남기고 후보의 유일성을 판정한다.
5. 유일한 완전 일치 후보만 Ledger `CancelCapturedLineage`로 전달한다. 수정·분할·합치기 파생 여부는 확인 조건이 아니다. 완전 일치 후보가 없으면 Ledger를 호출하지 않고 `NotFound`, 여러 건이면 `NeedsConfirmation`이다.
6. `NotFound`이면 대기 취소·tombstone·미래 승인 억제를 만들지 않는다. 나중에 승인이 도착하면 일반 승인 흐름으로 등록한다.
7. Ledger가 해당 lineage의 superseded 원본·활성 거래·모든 파생 지출을 삭제하고, 다른 승인 lineage와 합쳐졌다면 다른 원본을 복원하며, 최소 canceled tombstone·receipt와 Outbox를 한 UoW로 기록한다.
8. commit 뒤에만 Android 완료 상태를 갱신한다.

관련 요구사항: CAN-001~007, ING-SAVE-007, LED-008~009, SPL-003, SPL-005, DEC-041.

교정 불변식:

- 가맹점 불일치 거래는 [DEC-012](../governance/decisions.md#dec-012)에 따라 취소·확인 후보에서 모두 제외하며, 완전 일치 원거래가 없으면 아무 데이터도 변경하지 않는다.
- Ledger는 완전 일치·후보 유일성·자동 취소 판정을 소유하지 않는다.
- 월 분할 취소 오차는 [DEC-001](../governance/decisions.md#dec-001)을 따른다.
- 일부 문서 삭제 성공을 전체 성공으로 알리지 않는다.
- 취소 lineage와 무관한 다른 승인 원본은 삭제하지 않으며 공유 merge 해체·복원까지 같은 UoW에서 처리한다.
- 취소 완료 뒤 대상 원본·파생 지출은 사용자 원복 대상이 아니지만, 같은 승인·취소 재전송 방지용 최소 tombstone과 receipt는 유지한다.
- 취소 선도착으로 실제 취소된 지출이 나중에 등록되더라도 외부 알림 순서 역전을 자동 복구하지 않는다.

## 5. iOS Shortcut

### 참여 경계

```text
Shortcut HTTP Delivery
  → Payment Capture [Shortcut Parser → Intake → Payment Configuration]
  → Household Finance / Ledger
  → Notifications
```

현재 기능 모듈:

[Shortcut 결제 수집](../contexts/payment-capture/modules/shortcut-ingestion/requirements.md) → [결제 설정](../contexts/payment-capture/modules/payment-configuration/requirements.md) → [거래 원장](../contexts/household-finance/modules/ledger/requirements.md) → [푸시 알림](../contexts/notifications/modules/notifications/requirements.md)

현재 흐름:

1. POST 요청의 정적 공유 token과 필수 필드를 검증한다.
2. 입력을 정규화하고 카드 message를 parse한다.
3. 가구·카드·owner를 판정한다.
4. 중복이면 HTTP 함수가 직접 알림을 시도한다.
5. 신규이면 `expenses`를 저장한 뒤 별도 Firestore trigger가 알림을 시도한다.

목표 Context 흐름:

1. 로그인 세션에서 반자동 설치한 scoped credential을 검증하고 credential claim으로 Actor와 가구 범위를 결정한다. 요청 body의 householdId·owner로 신원을 선택하지 않는다.
2. Shortcut Adapter가 DEC-029의 공통 연도 Policy를 적용해 message를 같은 `CaptureEnvelope.v1`의 `paymentObservation`으로 변환한다. Shortcut은 `balanceObservation`을 만들지 않는다.
3. Android와 동일한 Payment Intake·Configuration·Fingerprint Policy를 사용하고, Configuration은 인증된 현재 멤버의 카드만 조회한다.
4. 본인 등록 카드가 하나도 일치하지 않으면 저장·알림 없이 거부한다. 하나 이상 일치하면 다른 가구원의 동일 카드사 등록이나 본인 카드의 복수 일치와 무관하게 Actor를 creatorMemberId로 사용하고 Ledger가 `Created` 또는 `Duplicate(existingId)`를 반환한다.
5. Notifications는 Ledger Outbox의 확정 Event를 소비해 신규 지출의 creator 본인 iPhone endpoint에 편집 링크 푸시를 보낸다.
6. HTTP 응답은 거래 결과와 알림 queued/delivery 결과를 구분한다.

관련 요구사항: IOS-001~013, PUSH-002, PUSH-004, PUSH-010.

교정 불변식:

- Android와 Shortcut이 영속 중복을 각각 구현하지 않는다.
- 같은 DEC-003 tuple의 동시 요청은 거래 한 건으로 수렴한다.
- 전역 hardcoded token을 폐기 가능한 범위 credential로 교체한다.
- iPhone 자동 알림은 QuickEdit 대체용 생성자 본인 알림이며 다른 가구원에게 전송하지 않는다.
- 카드 eligibility는 요청 owner·FCM owner가 아니라 Actor 본인 카드 집합만 사용하고, 여러 일치 중 특정 카드를 저장 순서로 임의 선택하지 않는다.
- Android와 Shortcut의 연도 없는 결제일은 같은 Policy를 사용하며 미래 연도를 선택하지 않는다.

## 6. 자산 자동 처리

### 참여 경계

```text
Operations Scheduler Adapter
  → Portfolio [Holdings / Automation → Portfolio Core]
  → Reporting Read Side
```

현재 기능 모듈:

[자산 자동화](../contexts/portfolio/modules/asset-automation/requirements.md) → [포트폴리오](../contexts/portfolio/modules/portfolio/requirements.md) ← [보유종목과 시세](../contexts/portfolio/modules/holdings-market-data/requirements.md), 지원 [외부 운영](../supporting-platform/modules/external-operations/requirements.md)

현재 흐름:

1. 자동 납입·상환이 대상 월과 실행 조건을 평가한다.
2. 같은 자산·월 명령을 한 번 반영하려고 한다.
3. 보유종목 또는 잔액 변경 후 계좌 합계를 다시 계산한다.
4. 예약 작업이 당일 Snapshot을 갱신한다.
5. 일부 흐름은 화면 방문에 의존하고 외부 실패를 성공과 구분하지 못한다.

목표 Context 흐름:

1. 자산 자동화 Scheduler Inbound Adapter는 매일 00:00 `Asia/Seoul`에 기준일과 실행 ID를 `ProcessDueAssetAutomation`에 전달하고, Application은 active이거나 중지 전 overdue를 복구 중이면서 `nextDueDate<=기준일`인 Plan page만 조회한다. 시세·배당 Scheduler는 각자의 확정 시각에 실행 ID와 대상 page를 해당 Portfolio Application Command에 전달한다.
2. 외부 Quote를 transaction 밖에서 수집하고 오류 결과를 분류한다.
3. 성공 Quote만 Position 평가 후보로 사용한다. 외화 Position은 최신 사용 가능 원 통화 Quote와 통화쌍별 최신 사용 가능 환율을 관측 시각 차이 제한 없이 조합하고 두 provenance를 평가 intent에 포함한다.
4. Portfolio Context가 자산 계정 단위 Position·Valuation 또는 Automation execution을 강한 일관성 workflow로 commit하고 Outbox를 기록한다.
5. Portfolio Core만 AssetAccount의 최종 Writer가 된다.
6. commit Event는 강한 쓰기를 완성하는 용도가 아니라 Snapshot·Reporting·운영 관측 downstream에만 전달한다.
7. Portfolio Core의 `AssetSnapshotProjector`만 commit된 조회 결과로 Snapshot을 결정적·멱등 upsert한다.
8. retry executor, 대상별 job result sink, observability Output Port가 성공·실패·retry 범위를 기록한다.

관련 요구사항: AUTO-001~003, LOAN-001~002, HOLD-003, JOB-AST-001~003, JOB-ERR-001.

교정 불변식:

- 납입·상환·평가·Snapshot Command는 멱등이다.
- 자동화 execution과 Asset 변경이 commit된 뒤에만 Plan의 nextDueDate가 다음 달로 전진하며, 실패한 월은 다음 일일 실행에서 오래된 순서로 다시 대상이 된다.
- 외부 Provider 실패는 유효한 0원과 구분한다.
- Scheduler는 Inbound Adapter이고, Operations가 Portfolio에 구현하는 Output Port는 retry·job result·observability다.
- Scheduler·Operations·Holdings·Reporting은 AssetSnapshot 저장소를 직접 쓰지 않는다.

## 7. 배당 처리

### 참여 경계

```text
Operations / Disclosure Adapter
  → Portfolio [Holdings Query → Dividends]
  → Reporting Read Side
```

현재 기능 모듈:

[보유종목과 시세](../contexts/portfolio/modules/holdings-market-data/requirements.md) → [배당](../contexts/portfolio/modules/dividends/requirements.md) → [통계](../supporting-platform/modules/reporting/requirements.md)

현재 흐름:

1. 예약 작업이 `holdingType=stock`이고 코드가 영숫자인 현재 보유종목을 ETF로 추정해 KIND 조회에 넣는다.
2. 이번 provider 결과에 다시 나타난 Event만 기준일 보유수량과 totalAmount를 확정한다.
3. 같은 현재 holding·provider loop 안에서만 지급일 당일부터 paid로 전환한다.
4. Projection map이 canonical eventId가 아닌 종목·지급일·주당금액 조합을 사용해 서로 다른 기준일 Event가 충돌할 수 있다.

목표 Context 흐름:

1. Discovery 단계는 canonical instrument가 명시적으로 KRX ETF인 현재 추적 종목만 Provider Adapter로 보내고 원문을 내부 공시 계약으로 변환한다.
2. Dividends가 `source + sourceDisclosureId`의 안정적인 결정 eventId로 DividendEvent를 upsert하고 Projection도 같은 eventId를 key로 사용한다. 기준일·지급일·주당금액은 정정 가능한 값이므로 identity에 넣지 않는다.
3. 기준일 Position history Query에서 정확한 snapshot을 우선하고, 없으면 날짜 차이가 가장 작은 snapshot을 선택하되 동률이면 이전 날짜를 우선해 적격 수량을 고정한다.
4. Lifecycle 단계는 신규 discovery 결과·현재 holding 목록과 독립적으로 기존 nonterminal Event를 page query한다. 모든 source Asset이 삭제되어도 announced는 Position history로 fixed를 시도하고, fixed는 provider NoData 뒤에도 저장된 최신 성공 값으로 지급일에 paid로 진행한다.
5. Event 상태와 Outbox를 원자 commit한다.
6. AnnualDividendProjection과 Reporting이 Event를 멱등 소비한다.

관련 요구사항: DIV-001~006, JOB-DIV-001, DEC-043.

교정 불변식:

- 기준일 누락 복구는 [DEC-014](../governance/decisions.md#dec-014)의 최근접 snapshot·이전 날짜 동률 우선 규칙을 따르며 화면에 추정 여부를 별도 표시하지 않는다.
- Web API가 Dividend Snapshot을 직접 덮어쓰지 않는다.
- KIND 형식과 retry는 Adapter·Operations 책임이고 상태 전이는 Portfolio Domain 책임이다.
- 같은 공시의 정정은 미지급 Event의 현재 값만 덮어쓰며 이전 값·revision Event를 보관하지 않는다. 기준일·금액이 바뀐 fixed Event는 Position history로 적격 수량·증거·총액을 원자 재계산한다.
- 지급 전 명시적 취소·삭제 공시는 미지급 Event와 Projection 항목을 제거한다. 공급자 `NoData`·timeout·계약 실패는 취소가 아니며 기존 Event를 변경하지 않는다.
- paid Event는 이후 정정·취소에도 불변이다. 이 정책은 [DEC-043](../governance/decisions.md#dec-043)을 따른다.

## 8. 가구 논리 삭제·복구와 수동 영구 삭제

### 참여 경계

```text
Admin 논리 삭제·복구 → Access Household lifecycle
별도 영구 삭제 요청 → Access HouseholdPurgeProcess
  → UID Membership claim server-only snapshot
  → Household Finance purge
  → Payment Capture purge
  → Portfolio purge
  → Notifications purge
  → 지원 Projection/cache purge
  → Access household-scoped purge 완료 확인
  → UID Membership claim 조건부 page 해제
  → Household purged + HouseholdPurged.v1
```

논리 삭제·복구 흐름:

1. Access가 가구를 `active → deleted`로 원자 전환하고 `HouseholdDeleted.v1`을 기록한다.
2. 모든 일반 가구 범위 Command·Query와 세션 복원을 차단한다.
3. 다른 Context의 데이터를 삭제·수정하지 않으며 alias·Membership도 복구를 위해 보존한다.
4. 승인된 복구 명령은 활성 영구 purge가 없을 때 `deleted → active`로 전환하고 기존 데이터를 그대로 다시 사용한다.

수동 영구 삭제 흐름:

1. 사용자가 별도로 데이터베이스 정리를 요청한 경우에만 관리자/에이전트 운영 도구가 `RequestPermanentHouseholdPurge`를 호출한다.
2. Access가 별도 confirmation과 권한을 확인하고 `deleted → purging`으로 전환한다.
3. Process Manager가 현재 가구 claim의 server-only `(claimKey, membershipId, claimVersion)` snapshot을 결정적 page와 checkpoint로 먼저 완성한다. `purging` 중에는 Membership·claim 변경 명령을 거부한다.
4. snapshot 완료 뒤 Finance·Capture·Portfolio·Notifications의 공개 `PurgeHouseholdData(householdId, processId, checkpoint)`를 호출한다.
5. 각 Context가 `PageProcessed`, `PurgeCompleted`, `RetryableFailure`, `PermanentFailure` 중 하나와 opaque checkpoint를 반환한다.
6. Process Manager가 Context별 checkpoint와 실패 원인을 기록하고 실패한 Context만 마지막 checkpoint부터 재시도한다.
7. 모든 Context와 Access household-scoped 데이터 정리가 완료됐는지 확인한다. 하나라도 미완료이면 UID Membership claim을 해제하지 않는다.
8. 완료 뒤 purge snapshot과 현재 householdId·membershipId·version이 일치하는 claim만 결정적 page로 조건부 해제하고 page checkpoint를 기록한다. 이미 없는 claim은 멱등 성공이며 다른 값 claim은 보존하고 운영 conflict를 기록한 뒤 고정 snapshot의 다음 entry부터 계속한다.
9. 모든 claim page가 완료되면 Household `purged`, 완료 receipt와 `HouseholdPurged.v1`을 같은 Access finalization UoW에 기록한다. 이후 사용자는 새 가계부 생성·초대 참여가 가능하다.

교정 불변식:

- 논리 삭제 시 다른 Context의 물리 삭제는 0건이며 사용자 관점의 접근 차단은 `deleted` 전환 시점부터 일관된다.
- 자동 Scheduler나 보존 기간 만료로 영구 purge를 시작하지 않는다.
- `deleted`는 복구할 수 있지만 `purging`은 부분 삭제 가능성 때문에 복구할 수 없다.
- Access가 다른 Context의 collection name을 직접 열거하지 않는다.
- Firestore 쓰기 한도를 넘는 전체 hard delete를 한 transaction으로 가장하지 않는다.
- 같은 processId·checkpoint 재호출은 동일 결과 재생 또는 안전한 no-op이며 완료된 page만 checkpoint를 전진한다.
- Notifications purge는 가구 subscription·delivery·Inbox만 제거하고 사용자 전역 device와 다른 가구 연결을 보존한다.
- 논리 삭제와 Context purge 진행 중에는 UID claim을 유지하고, 모든 Context 완료 전 claim 해제는 0건이다.
- claim finalization 중단은 완료 page를 되돌리지 않고 다음 page부터 재개하며 `purged` Event는 한 번만 기록한다.

## 9. 일일 정기 거래 처리

### 참여 경계

```text
Operations Scheduler Adapter
  → Household Finance [Recurring → ProcessRecurringMonthWorkflow → Ledger]
  → Budget / Reporting Read Side
```

현재 흐름:

1. 사용자가 Web 화면에 진입할 때 클라이언트가 정기지출 처리를 시도한다.
2. 앱을 열지 않은 달은 처리 기회를 잃고 이후 실행에서도 과거 월을 자동 복구하지 않는다.

목표 흐름:

1. 서버 Scheduler가 `Asia/Seoul` 기준 매일 00:00에 `ProcessDueRecurringPlans`를 호출한다.
2. Recurring이 `firstApplicableMonth`부터 기준일까지 execution이 없는 due month를 오래된 순서로 계산한다.
3. 각 plan/month를 `ProcessRecurringMonthWorkflow`가 독립 Finance Unit of Work로 처리한다.
4. Workflow가 RecurringExecution, Ledger Transaction, receipt와 Outbox를 원자 commit한다.
5. Operations는 page checkpoint와 실패 target을 기록하고 남은 월 또는 일시 실패 target을 자동 재개한다.
6. Budget·Reporting은 commit Event를 멱등 소비한다.

관련 요구사항: REC-002, REC-003, JOB-ERR-001.

교정 불변식:

- 브라우저 접속 여부가 정기 거래 생성 조건이 아니다.
- 같은 `planId:YYYY-MM`은 Scheduler 중복 실행과 재시도에도 거래 한 건으로 수렴한다.
- 새 계획의 `firstApplicableMonth` 이전 월은 만들지 않고 그 이후 누락 월은 자동 복구한다.
- 여러 월을 하나의 거대 transaction으로 묶지 않으며 일부 실패가 성공 월을 롤백하거나 중복 생성하지 않는다.

## 10. 카테고리 보관과 설정 참조 변경

### 참여 경계

```text
Web 설정
  → Household Finance [Category Archive Process]
      ├─ RemapRecurringCategoryReferences → Recurring
      └─ RemapMerchantRuleCategoryReferences → Payment Configuration
  → Category archived
```

목표 흐름:

1. 사용자가 현재 기본 카테고리가 아닌 카테고리의 보관을 요청한다.
2. Category/Budget이 유효한 현재 기본 카테고리를 확인하고 대상을 `archive-pending`으로 전환해 신규 참조를 막는다.
3. Category Archive Process가 Recurring과 Payment Configuration의 공개 page Command를 호출한다.
4. Recurring은 활성·비활성 정기지출 정의의 참조를 기본 카테고리로 변경하고, Payment Configuration은 활성·비활성 가맹점 규칙의 category mapping만 변경한다.
5. 각 page의 process receipt와 opaque cursor를 저장하며 실패하면 마지막 완료 checkpoint부터 재개한다.
6. 두 소비 모듈이 모두 완료된 뒤 Category/Budget이 표시 정보를 유지한 채 대상을 `archived`로 전환한다.

관련 요구사항: CAT-002, CAT-003, REC-005, MER-007, DEC-015.

교정 불변식:

- 현재 기본 카테고리의 보관 요청은 아무 상태도 바꾸지 않고 `CATEGORY_IS_DEFAULT`로 거부한다.
- 과거 Ledger 거래의 categoryId와 표시 정보는 변경하지 않는다.
- 각 모듈만 자기 저장소를 변경하며 Category Archive Process는 다른 모듈 Repository나 Firestore 경로를 직접 사용하지 않는다.
- 부분 실패 중 대상은 `archive-pending`에 머물고 신규 선택에서 제외되며, 모든 설정 참조가 기본값으로 수렴하기 전에는 `archived` 완료로 표시하지 않는다.
- `archived` 카테고리를 다시 active로 만드는 기능과 hard delete는 제공하지 않는다.

## 11. 자산 논리 삭제·복구와 수동 영구 삭제

### 참여 경계

```text
Web 자산 관리 → Portfolio Core [DeleteAsset]
관리자·승인된 운영 도구 → Portfolio Workflow [ListDeletedAssets / RestoreDeletedAsset]
  ├─ Core active 전환
  └─ Automation 삭제 구간·resume revision
별도 영구 삭제 요청 → Portfolio Core [AssetPurgeProcess]
  ├─ Holdings purge participant
  ├─ Automation purge participant
  └─ Core history purge participant
```

논리 삭제·운영 복구 흐름:

1. `DeleteAsset`이 active Asset만 `deleted`로 전환하고 lifecycle Event를 기록한다.
2. Position·history·Automation·Dividend 등 종속 데이터는 변경하지 않는다.
3. 목록·Portfolio 합계·평가·자동화·신규 배당 처리는 deleted Asset을 제외한다.
4. 일반 사용자에게 삭제 자산 목록과 복구 UI·API capability를 제공하지 않는다. 관리자·승인된 운영 주체만 감사 사유와 정확한 assetId로 `RestoreDeletedAsset`을 실행한다.
5. 운영 복구 Workflow는 영구 purge가 시작되지 않은 deleted Asset을 active로 전환하고, 삭제 전 overdue를 보존하되 삭제 기간을 제외하는 Automation resume revision을 같은 UoW에 기록한다. 복구일이 당월 실행일 이전·당일이면 당월, 이후이면 다음 달부터 재개한다.
6. Position·history·Dividend 등 보존된 종속 데이터는 다시 만들지 않고 그대로 사용한다.
7. 레거시 `isActive=false` 문서는 migration Adapter가 deleted로 변환하며 별도 비활성화 기능은 제공하지 않는다.

수동 영구 삭제 흐름:

1. 사용자가 별도로 DB 정리를 요청한 경우에만 승인된 관리자/에이전트 운영 도구가 `RequestPermanentAssetPurge`를 호출한다.
2. Portfolio Core가 confirmation과 권한을 확인하고 Asset을 `purging`으로 전환한다.
3. `AssetPurgeProcess`가 Holdings·Automation·Core의 context-private participant를 page 단위 호출하고 checkpoint를 저장한다. Dividends는 호출하지 않는다.
4. 실패한 participant만 마지막 checkpoint부터 재시도하며 모두 완료된 뒤 Asset Canonical을 정리한다.

관련 요구사항: AST-003, AST-006, AUTO-003, DEC-017, DEC-052.

교정 불변식:

- 일반 삭제에서는 종속 데이터 write가 0건이다. 운영 복구에서는 기존 Position·history·Dividend를 변경하지 않고 Automation의 삭제 구간·resume revision만 기록한다.
- 자동 Scheduler나 시간 경과로 영구 purge를 시작하지 않는다.
- deleted는 관리자·승인된 운영 주체만 복구할 수 있고 purging은 부분 삭제 가능성 때문에 누구도 복구할 수 없다.
- 각 기능 모듈만 자기 저장소를 purge하며 Process Manager가 다른 기능 Repository를 직접 사용하지 않는다.
- 기존 DividendEvent와 Annual Projection은 가구 금융 이력이므로 Asset 영구 purge 전후에도 그대로 유지하며, paid 배당 조회와 월·연간 합계가 바뀌지 않는다.

## 12. 시세 갱신과 공급자 장애 관측

```text
Firebase Scheduled Function
  → Holdings [RunDailyAssetValuation]
  → Market Provider Adapter [Naver / Nasdaq / Upbit / Physical Gold]
  ├─ 매 HTTP 시도 → Cloud Logging structured log·metric
  ├─ run 최종 결과 → Firestore ProviderHealthState
  ├─ 실패 → 기존 lastQuote·observedAt으로 평가
  └─ 즉시/연속 실패 기준 충족 → Cloud Monitoring alert
```

1. 개별 자산 화면은 해당 자산을 수동 갱신하고, 자산 메인 페이지 진입은 현재 가구 전체를 갱신하며, 별도 상시 서버 없이 Firebase 예약 함수가 매일 23:55 사용자 접속과 무관한 전체 시세 갱신과 Provider canary를 실행한다.
2. 전체 target 수는 제한하지 않고 내부 50개 page로 끝까지 처리하며, Provider 호출은 최대 5개 동시 실행·10초 timeout·retryable 총 3회로 제한한다. 같은 가구·범위의 30초 내 중복 요청은 같은 run을 재사용한다.
3. 모든 HTTP 시도는 result kind·안정 오류 code·attempt·latency를 기록하지만 원문 응답·credential·가구 ID·보유수량은 남기지 않는다.
4. 같은 예약 실행 내부 retry는 모두 log하되 provider+operation의 `consecutiveFailedRuns`는 최종 실패 한 번만 증가시킨다.
5. 실패는 Position의 마지막 성공 Quote나 observedAt을 변경하지 않으며, 성공 이력이 없을 때만 평균단가를 사용한다.
6. contract·invalid·인증·설정 실패는 첫 run에, 추적 Position의 retryable·예상 밖 NoData는 3개 예약 run 연속 실패에 경보한다.
7. 다음 성공은 Health를 healthy로 되돌리고 경보를 해제하며 장애 시작·복구 시각을 남긴다.
8. Next.js 시세 Route의 console log는 배포 위치에 종속되므로 장애 상태의 단일 원본으로 사용하지 않는다.

관련 요구사항: MARKET-004, JOB-AST-001, EXT-001~003, JOB-ERR-001, DEC-018, DEC-049.

## 13. Google 로그인과 기존 가구 키 무중단 전환

### 기존 사용자

```text
Web localStorage
  householdKey + currentMemberId + currentMemberName
  → [CaptureLegacySessionCandidate]
  → Google 로그인
  → Access [ResolveSignedInUser]
  → 기존 가계부·멤버 연결 확인
  → Access [ClaimLegacyMembership]
  → 기존 householdId·memberId + Google UID Membership
  → legacy key 로그인 상태 제거
  → 새 SessionScope를 원자 발급하고 이전 listener·cache 폐기
  → 동일한 거래·자산·카드 조회
```

1. 기존 운영 origin에서 Google 로그인 UI를 시작하기 전에 기존 localStorage 후보를 메모리에 보존한다. householdKey와 currentMemberId 중 하나라도 없으면 후보 없음으로 처리하며 Android Native 값으로 복구하지 않는다.
2. 로그인한 UID에 유일한 Membership이 이미 있으면 서버 Membership을 바로 복원하고 가계부 선택 화면을 제공하지 않으며 후보를 인증에 사용하지 않는다.
3. Membership이 없으면 기존 Household·Member의 존재와 미연결 상태를 서버 transaction에서 확인한다.
4. 같은 UID 재시도는 멱등 성공하고 다른 UID가 먼저 연결한 Member는 덮어쓰지 않는다.
5. 성공 뒤에는 기존 가구 키 로그인 상태를 제거하지만 householdId·memberId와 모든 업무 데이터는 이동·복사하지 않는다.
6. 인증된 Membership으로 `SessionScope(sessionGeneration, uid, householdId, memberId)` 전체를 발급하고 Repository·listener·cache에 명시적으로 전달한다. 같은 탭의 이전 scope와 늦은 callback을 먼저 폐기한다.
7. localStorage가 없거나 후보가 불완전·무효하면 기존 사용자를 추정하지 않고 신규 사용자의 첫 방문 흐름으로 이동한다.

예외적으로 실제 기존 사용자가 localStorage를 잃었다면 일반 화면에서는 그대로 신규 사용자로 처리한다. 소유자가 별도로 신원을 확인해 요청한 경우에만 운영자·Agent가 정확한 Google UID와 기존 householdId·memberId를 지정하여 단일 UID claim·Member 연결·Membership·receipt·감사 Event를 한 transaction으로 복구한다. UID에 기존 Membership이 있으면 두 번째 연결을 추가하지 않고 기존 claim을 명시적으로 교정하며 업무 데이터는 변경하지 않는다.

### 신규 사용자

```text
Google 로그인 + Membership 없음
  ├─ 새 가계부 생성
  │    → UID 전역 claim + Household + 자기 Member + 일반 Membership
  └─ 5분 초대 코드 입력 + 자기 이름 입력
       → UID 전역 claim + Invitation used + 자기 Member + Membership
```

초대 코드는 특정 Member를 미리 생성하지 않으며 한 번 사용하거나 발급 후 5분이 지나면 사용할 수 없다. 사용자는 자기 Member만 생성·변경할 수 있고 다른 가구원의 memberId·principalUid를 입력할 수 없다. 이미 UID 전역 Membership claim을 가진 사용자는 새 가계부 생성과 초대 가입을 모두 거부하며 Invitation도 소비하지 않는다. removed Membership만 남아 claim이 해제된 사용자는 새 가계부에 가입할 수 있다.

관련 요구사항: HH-001~009, HH-JOIN-001, ADM-002, SYS-001, DEC-021, DEC-034.

교정 불변식:

- 신규 가구 키 로그인·guest 우회 경로는 없다.
- legacy claim과 초대 가입은 Google 인증 뒤 서버 Command로만 실행한다.
- Invitation 소비와 자기 Member·Membership 생성은 한 transaction이다.
- UID 전역 claim은 가계부 생성·초대 가입·legacy 연결과 같은 transaction에서 확보하며 한 UID에 두 Membership이 생기지 않는다.
- 기존 사용자의 연결 실패가 새 빈 가계부 생성으로 조용히 대체되어서는 안 된다.

## 14. 전체 관리자에 의한 일반 가구원 제거·복구

```text
전체 관리자
  → Access [RemoveHouseholdMember]
  → Member·Membership removed + member 명의자 archived
  → PrincipalMembershipClaim 해제 + HouseholdMemberRemoved.v1 Outbox
  ├─ 모든 Context ActorContext 검증 → 즉시 접근 거부
  └─ Notifications Inbox
       ├─ 대상 member endpoint page 정리
       └─ recipient 계산·FCM 호출 직전 active Membership 재검증

전체 관리자 [RestoreRemovedHouseholdMember]
  → 다른 active UID claim 없음 확인
  → 같은 Member·Membership·명의자 프로필 active + claim 재획득
  → 과거 endpoint는 복구하지 않고 다음 모바일 로그인에서 새로 등록
```

1. 일반 가구원·가구 생성자에게 제거·복구 UI나 API를 제공하지 않고 서버가 검증한 전체 관리자 capability만 허용한다.
2. household owner role은 없으며 전체 관리자는 생성자를 포함한 모든 활성 Member를 같은 규칙으로 제거할 수 있다.
3. 제거 transaction은 상태·감사 정보·UID claim·Outbox를 함께 commit하고 거래·자산·카드·작성자·배당 기록은 변경하지 않는다.
4. 제거된 사용자는 새 가계부 생성·초대 가입이 가능하다. 이후 다른 가계부의 active claim을 얻었다면 기존 Membership 복구는 충돌로 종료한다.
5. Notifications endpoint cleanup은 at-least-once Event에 멱등하고 다른 멤버 endpoint와 기존 terminal delivery를 보존한다.
6. cleanup이 지연되어도 신규 recipient 계산과 실제 provider 호출 직전 active Membership 검증으로 제거된 사용자 전송을 막는다.
7. 마지막 활성 Member를 제거해도 Household를 자동 삭제하지 않고 모든 데이터를 보존하며, 전체 관리자가 같은 Member를 복구할 수 있다.

관련 요구사항: HH-012, PUSH-012, DEC-038, DEC-039.

교정 불변식:

- 제거·복구와 claim 해제·재획득은 각기 하나의 Access Unit of Work다.
- 제거는 업무 이력의 creator·owner 참조를 지우거나 다른 Member로 치환하지 않는다.
- 같은 UID의 다른 가구 가입과 복구가 경합해도 active Membership claim은 하나뿐이다.
- 복구는 과거 FID endpoint를 자동으로 되살리지 않는다.
- 생성자와 초대 가입자의 일반 capability 및 제거 조건은 같다.
