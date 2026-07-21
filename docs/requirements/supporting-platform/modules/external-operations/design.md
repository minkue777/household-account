# 외부 연동·운영 모듈 상세 설계

> 요구사항: [외부 연동·운영 모듈 요구사항](requirements.md)  
> 상위 지도: [지원·읽기·플랫폼 영역](../../requirements.md)  
> 공통 형식: [모듈 상세 설계 규약](../../../governance/module-design-standard.md)  
> 목표 아키텍처: [목표 Clean Architecture 설계](../../../../architecture/target-clean-architecture.md)

## 1. 설계 목적과 추적성

이 설계는 `JOB-ERR-001~002`, `EXT-001~003`, `MARKET-004`의 운영 경계를 공통 Infrastructure로 구현하는 기준이다. 외부 공급자 장애를 빈 값·0·고정 추정 성공으로 숨기지 않고, 예약 occurrence의 미시작·정체와 다중 대상 job의 완료·실패·재시도 범위, 공급자별 연속 장애·복구를 영속 결과와 구조화 관측으로 남긴다. 공개 HTTP ingress와 outbound HTTP의 유한 보안 경계도 공통 Adapter로 강제한다. 이 모듈은 시세·배당·자산 업무 규칙을 소유하지 않는다.

## 2. 모듈 경계와 책임

| 소유 | 기능 모듈 소유 |
|---|---|
| HTTP timeout·status·parse 실패의 기술 분류 | `NoData`의 업무 의미와 유효 값 검증 |
| retry 실행과 backoff·jitter | 어떤 작업을 언제 실행할지 |
| job run/heartbeat/lease/checkpoint/부분 실패와 missing·overdue 기록 | 자산 평가·배당 전이·정기 처리 |
| Scheduler wrapper와 SystemActor 연결 | 기능 Application Input Port |
| redacted log·metric·dead letter | Integration Event payload와 Domain Entity |
| ingress 인증 방식 연결·유한 limit 실행, 안전한 outbound HTTP | route별 업무 schema·capability와 Provider payload 의미 |

Provider Adapter는 `platform/operations`에 배치할 수 있지만 구현하는 Output Port와 반환 업무 DTO는 소비 기능 모듈이 정의한다.

## 3. 공개 계약

### 3.1 외부 호출 결과

```ts
type ExternalResult<T> =
  | { kind: 'SUCCESS'; value: T; observedAt: string; freshness?: string }
  | { kind: 'NO_DATA'; reason: string; observedAt: string }
  | { kind: 'RETRYABLE_FAILURE'; code: string; retryAfterMs?: number }
  | { kind: 'CONTRACT_FAILURE'; code: string; providerVersion?: string }
  | { kind: 'INVALID_DATA'; code: string; field?: string };
```

기본 기술 분류:

| 관찰 | 결과 |
|---|---|
| 2xx + 유효 payload | `SUCCESS` |
| 2xx + 공급자가 명시한 정상적 부재 | 기능 Adapter가 승인한 `NO_DATA` |
| timeout, network, 408, 429, 5xx | `RETRYABLE_FAILURE` |
| 401/403 또는 명백한 잘못된 설정 | `CONTRACT_FAILURE` 또는 운영 설정 실패 |
| selector/schema/필수 필드 변경 | `CONTRACT_FAILURE` |
| NaN, Infinity, 범위 밖 숫자 | `INVALID_DATA` |

빈 배열이나 `null`을 공통 계층이 자동으로 `NO_DATA`로 만들지 않는다. 해당 공급자 Port Adapter가 명시적으로 판단한다.

### 3.2 Retry Executor

```ts
interface RetryRequest<T> {
  operationName: string;
  idempotencyKey: string;
  policy: { maxAttempts: number; baseDelayMs: number; maxDelayMs: number; jitter: boolean };
  execute: () => Promise<ExternalResult<T>>;
}
```

`ExecuteWithRetry`는 retryable 결과만 재실행하고 `NoData`, contract failure, invalid data를 자동 재시도하지 않는다. operation이 멱등하다는 계약 없이 쓰기 외부 호출에 적용하지 않는다.

시세 Quote 호출의 기본 `RetryPolicy`는 [DEC-049](../../../governance/decisions.md#dec-049)에 따라 `maxAttempts=3`, 요청 전체 `timeoutMs=10000`, 지수 backoff+jitter입니다. 한 refresh run의 `ConcurrencyLimiter`는 active Provider 호출을 최대 5개로 제한합니다. 이 수치는 배포 Config로 주입하지만 누락·0·무한 값은 허용하지 않습니다.

### 3.3 Job Runner

```ts
type TargetOutcome =
  | { targetId: string; kind: 'SUCCEEDED' | 'SKIPPED'; receipt?: string }
  | { targetId: string; kind: 'FAILED'; code: string; retryable: boolean };

interface JobExecutionResult {
  runId: string;
  jobName: string;
  status: 'COMPLETE' | 'PARTIAL_FAILURE' | 'FAILED';
  checkpoint?: string;
  totals: { target: number; succeeded: number; skipped: number; failed: number };
  failures: ReadonlyArray<
    | { scope: 'target'; targetIdHash: string; code: string; retryable: boolean }
    | { scope: 'job'; code: string; retryable: boolean }
  >;
  startedAt: string;
  finishedAt: string;
}

interface ScheduledOccurrenceStateV1 {
  jobName: string;
  executionKey: string;
  scheduledFor: string;
  graceUntil: string;
  deadlineAt: string;
  startedAt?: string;
  lastHeartbeatAt?: string;
  lease?: { ownerId: string; expiresAt: string; attempt: number };
  checkpoint?: string;
  status: 'EXPECTED' | 'RUNNING' | 'COMPLETE' | 'PARTIAL_FAILURE' | 'FAILED' | 'MISSING' | 'OVERDUE';
  recoveredAt?: string;
}
```

| 입력 Port | 호출자 | 입력 | 결과 |
|---|---|---|---|
| `RunScheduledJob` | Scheduler Adapter | SystemActor, jobName, executionKey, initial checkpoint | `JobExecutionResult` |
| `ResumeJob` | retry scheduler/operator | runId, expected checkpoint | `Resumed(JobExecutionResult)`·`LeaseProtected(JobRunView)`·`StaleCheckpoint(JobRunView)` |
| `GetJobRun` | 운영 조회 | runId | redacted 상태·실패 범위 |
| `HeartbeatJobRun` | 현재 lease owner | runId, lease token, expected checkpoint | 갱신 상태 또는 `StaleLease` |
| `DetectMissingOrOverdueRuns` | 독립 schedule monitor | asOf, job definition page | missing·overdue·recovered occurrence 목록 |

`DetectMissingOrOverdueRuns`의 Scheduler SystemActor는 최소 `operations.job.monitor` capability만 가집니다. 이 capability는 기능 job 실행 권한을 포함하지 않으며 monitor가 업무 handler를 대신 호출할 수 없습니다.

기능별 `ListTargets`와 `ProcessTarget`는 해당 기능의 공개 scheduled Input Port다. Operations가 기능 Repository를 조회하지 않는다.

정기 거래 job은 [DEC-009](../../../governance/decisions.md#dec-009)에 따라 `Asia/Seoul` timezone의 cron `0 0 * * *`로 `ProcessDueRecurringPlans(asOfDate, householdZoneId, cursor, limit)`을 호출합니다. Operations는 cron·SystemActor·checkpoint·재시도만 소유하고, due month와 복구 범위는 Recurring의 반환 결과를 그대로 사용합니다.

각 배포 환경은 jobName, timezone/cron, grace, deadline, heartbeat interval을 가진 유한 `ScheduledJobDefinition`을 등록합니다. monitor는 실행 job과 분리된 occurrence에서 예상 시각별 run 존재 여부와 heartbeat를 검사합니다. 같은 Scheduler 장애 도메인 때문에 monitor까지 실행되지 않는 경우는 Cloud Monitoring의 별도 absence metric/alarm이 보완합니다.

### 3.4 Provider Health

```ts
interface ProviderAttemptObservationV1 {
  provider: string;
  operation: string;
  executionKey: string;
  resultKind: 'SUCCESS' | 'NO_DATA' | 'RETRYABLE_FAILURE' | 'CONTRACT_FAILURE' | 'INVALID_DATA';
  errorCode?: string;
  expectedData: boolean;
  attempt: number;
  latencyMs: number;
  observedAt: string;
  targetHash?: string;
}

interface ProviderHealthStateV1 {
  provider: string;
  operation: string;
  status: 'healthy' | 'degraded' | 'outage';
  lastAttemptAt: string;
  lastSuccessAt?: string;
  consecutiveFailedRuns: number;
  failureStartedAt?: string;
  lastResultKind: ProviderAttemptObservationV1['resultKind'];
  lastErrorCode?: string;
  alertState: 'closed' | 'open';
  recoveredAt?: string;
  version: number;
}
```

| 입력 Port | 호출자 | 입력 | 결과 |
|---|---|---|---|
| `RecordProviderAttempt` | Retry Executor·Provider Adapter | 시도별 `ProviderAttemptObservationV1` | 구조화 log·metric 기록 결과 |
| `RecordProviderRunOutcome` | 시세 갱신 Application | executionKey의 최종 결과 | `ProviderHealthStateV1` |
| `GetProviderHealth` | 관리자·운영 도구·에이전트 | provider?, operation? | redacted Health 목록 |

HTTP retry 한 번마다 Attempt log는 남기지만 `consecutiveFailedRuns`는 같은 executionKey의 최종 실패에서 한 번만 증가합니다. 따라서 한 예약 실행의 내부 재시도 3회가 “예약 갱신 3회 연속 실패”로 잘못 계산되지 않습니다.

`NO_DATA`는 `expectedData`로 의미를 구분합니다. `expectedData=true`의 예상 밖 NoData는 실패 run으로 계산하지만, `expectedData=false`의 정상 NoData는 Provider가 유효하게 응답한 성공 run으로 취급해 `consecutiveFailedRuns=0`으로 초기화하고 열린 장애가 있으면 같은 identity로 resolve합니다. 두 경우 모두 기존 Quote를 0이나 빈 값으로 덮어쓰지 않습니다.

장애 open과 복구 resolve는 같은 alert identity를 사용합니다. 이메일 수신 주소는 코드·Firestore Health 문서·일반 환경 변수의 평문 값이 아니라 배포 환경이 관리하는 Cloud Monitoring notification channel resource reference로 주입합니다. Application은 channel 주소를 알지 않고 `ProviderAlertPort.open/resolve`만 호출합니다.

### 3.5 공개 HTTP ingress boundary

```ts
interface IngressLimitsV1 {
  maxBodyBytes: number;
  maxFieldChars: number;
  maxPageSize: number;
  maxPeriodDays: number;
  maxTargets: number;
  rate: { maxRequests: number; windowSeconds: number };
  costQuota: { maxUnits: number; windowSeconds: number };
}

interface VerifiedIngressContextV1 {
  actor: ActorContext | SystemActor;
  credentialIdHash: string;
  appAttestation: 'VERIFIED' | 'NOT_APPLICABLE';
  limitsVersion: string;
}
```

공개 HTTP Function·API Route는 transport Adapter에서 다음 순서를 강제합니다.

1. 허용 method, `application/json` content type과 schema version을 검사합니다.
2. streaming body를 `maxBodyBytes`보다 많이 읽기 전에 중단합니다.
3. Firebase Auth/service account 또는 만료·폐기 가능한 scoped credential을 검증하고, 지원 앱 호출은 App Check를 추가 검증합니다.
4. 요청 household·member·capability와 Actor scope를 비교합니다.
5. field/page/period/target의 유한 상한과 credential·IP rate limit, 비용 quota를 통과한 뒤에만 기능 Application Port를 호출합니다.

CORS allowlist와 preflight 성공은 브라우저의 교차 origin 정책일 뿐 `VerifiedIngressContextV1`을 만들지 않습니다. OPTIONS는 업무 Application을 호출하지 않으며 허용 origin에서도 인증·인가·App Check를 생략하지 않습니다. 모든 limit 값은 양의 유한 수여야 하고 누락·0·무한 설정이면 Composition Root가 해당 공개 route 시작을 거부합니다.

### 3.6 `SafeExternalHttpClient`

```ts
interface SafeHttpRequestV1 {
  provider: string;
  method: 'GET' | 'POST';
  url: URL;
  timeoutMs: number;
  maxResponseBytes: number;
  redirectPolicy: { maxHops: number; revalidateEveryLocation: true };
}
```

provider Adapter는 provider별 배포 config의 HTTPS host·port allowlist 안에서만 URL을 구성합니다. client는 최초 URL과 모든 redirect `Location`을 같은 정책으로 다시 검증하고 HTTP downgrade, userinfo, 비허용 host/port와 redirect hop 초과를 거부합니다. timeout은 연결·전체 응답 소비를 포함하며 `Content-Length`가 없더라도 읽은 byte가 상한을 넘는 즉시 stream을 중단합니다. 사용자 입력의 전체 URL을 그대로 전달하지 않으며 제한 위반은 `SECURITY_POLICY_VIOLATION` 또는 `CONTRACT_FAILURE`, timeout은 `RETRYABLE_FAILURE`로 분류합니다.

## 4. 플랫폼 모델과 불변식

업무 Domain 대신 다음 운영 모델을 둔다.

| 모델 | 불변식 |
|---|---|
| `JobRun` | 같은 `jobName+executionKey`는 하나의 run으로 수렴한다. |
| `TargetExecution` | target+operation key의 성공은 재시도해도 한 번만 반영된다. |
| `RetryPolicy` | 최대 시도·delay가 양수이며 무한 retry를 허용하지 않는다. |
| `ExternalFailure` | 안정 code, retryability, provider/operation metadata를 가지며 민감 payload를 포함하지 않는다. |
| `Checkpoint` | 완료한 범위 뒤에서 재개 가능하고 성공 target을 다시 업무 반영하지 않는다. |
| `ProviderHealthState` | provider+operation당 하나이며 같은 executionKey는 연속 실패 수를 한 번만 변경한다. 성공은 0으로 초기화하고 실패 시작·복구 시각을 보존한다. |
| `ScheduledOccurrenceState` | expected occurrence마다 하나이며 Missing·Overdue·완료·복구 시각과 현재 lease/checkpoint가 단조롭게 진행한다. |
| `IngressLimits` | 모든 상한과 window가 양의 유한 수이고 인증·App Check·한도 검증 전 Application을 호출하지 않는다. |
| `SafeHttpPolicy` | HTTPS allowlist와 redirect 재검증, timeout, 최대 응답 byte가 없는 외부 요청을 실행하지 않는다. |

`JobRun.status=COMPLETE`는 모든 target이 성공 또는 의도적으로 skip된 경우에만 가능하다.

## 5. Application Use Case 상세

### 5.1 `ExecuteWithRetry`

1. operation name, key, retry policy를 검증한다.
2. 각 시도 전에 timeout과 trace context를 구성한다.
3. 결과를 분류하고 retryable일 때만 backoff를 적용한다.
4. 성공·NoData·영구 실패는 즉시 반환한다.
5. 최대 시도 소진 시 마지막 retryable code와 attempt 수를 반환한다.
6. 원문 payload를 로그하지 않고 latency·status class·result kind만 기록한다.

### 5.2 `RunScheduledJob`

1. Scheduler credential을 최소 Capability의 SystemActor로 변환한다.
2. `ScheduledJobDefinition`의 occurrence와 deadline을 계산하고 `JobRunStore.claim(jobName, executionKey, lease)`로 중복 실행을 합친다. 유효 lease가 있으면 새 worker는 처리하지 않는다.
3. 시작 heartbeat를 기록한 뒤 기능 Input Port에서 page 단위 target/checkpoint를 받는다.
4. 각 target의 업무 handler를 idempotency key와 함께 호출한다.
5. 매 page 경계와 설정된 최대 interval 안에 outcome, next checkpoint, heartbeat와 lease 연장을 compare-and-set으로 함께 저장한다.
6. deadline을 넘기거나 lease를 잃으면 새 target 처리를 중단하고 `OVERDUE` 또는 `StaleLease`를 기록한다.
7. 실패 target이 있으면 `PARTIAL_FAILURE` 또는 `FAILED`를 반환하고 retryability를 보존한다.
8. 최상위 예외도 실패 run으로 기록한 뒤 Scheduler Adapter가 실패 status를 내보내게 한다.

자산 자동화 occurrence는 [DEC-052](../../../governance/decisions.md#dec-052)에 따라 `Asia/Seoul` 매일 00:00으로 등록하고 `asOfDate`만 `ProcessDueAssetAutomation`에 전달합니다. Operations는 전체 자산을 읽거나 납입일·금액·누락 월을 계산하지 않습니다. Automation이 `nextDueDate<=asOfDate`인 Plan page를 반환하면 target별 결과와 checkpoint를 기록하고, retryable 실패는 완료로 바꾸지 않아 다음 occurrence에서도 due 상태가 유지되게 합니다.

### 5.3 `ResumeJob`

1. 저장된 run과 checkpoint를 읽고 완료 run이면 기존 결과를 재생한다.
2. 현재 lease가 만료됐는지 확인하고 새 owner가 compare-and-set takeover합니다. 유효 lease이면 `LeaseProtected`를 반환하고 강탈하지 않습니다.
3. retryable failure 또는 미처리 target만 선택한다.
4. 이미 성공한 target receipt는 재사용한다.
5. 요청 expected checkpoint가 현재 저장 checkpoint보다 오래됐으면 `StaleCheckpoint`를 반환하고 완료 범위를 되돌리지 않습니다. 그 밖에는 새 결과·heartbeat·checkpoint를 기존 run에 합쳐 성공으로 수렴하거나 영구 실패 상태를 유지합니다.

### 5.4 Provider 장애 기록과 경보

1. Firebase Scheduled Function과 Provider Adapter는 각 HTTP 시도를 `RecordProviderAttempt`로 Cloud Logging과 metric에 기록합니다.
2. 기능 Application은 executionKey의 최종 결과를 `RecordProviderRunOutcome`에 한 번 전달합니다.
3. Adapter는 provider+operation Health 문서를 transaction으로 갱신하고 같은 executionKey replay를 no-op 처리합니다.
4. 성공과 `expectedData=false`인 정상 NoData는 `healthy`, 연속 실패 0, alert closed로 전환하고 이전 장애가 있었다면 복구 log를 남깁니다.
5. contract·invalid·인증·설정 실패는 첫 run에 `outage`와 경보를 엽니다.
6. 추적 Position의 예상 밖 NoData·retryable은 1~2회 `degraded`, 3회째 `outage`와 경보를 엽니다.
7. Cloud Monitoring Adapter는 log-based metric 또는 custom metric에 경보 상태를 반영하고 배포 config의 notification channel resource로 장애 open·복구 resolve 이메일을 전달합니다. Alert 전달 실패는 Health 저장을 rollback하지 않고 별도 운영 실패로 재시도합니다.

이 흐름은 별도 상시 서버를 요구하지 않습니다. 기존 Firebase Scheduled Function이 canary와 실제 갱신을 실행하며 Next.js Route의 배포 위치별 console log는 보조 진단으로만 사용합니다.

### 5.5 예약 누락·정체 감지

1. `DetectMissingOrOverdueRuns`가 등록된 `ScheduledJobDefinition`과 현재 시각으로 검사할 expected occurrence page를 계산합니다.
2. `graceUntil`이 지났는데 occurrence/run이 없으면 결정적 occurrence key로 `MISSING`을 기록합니다.
3. run이 `RUNNING`인데 `lastHeartbeatAt + heartbeatTimeout` 또는 `deadlineAt`이 지났으면 `OVERDUE`를 기록합니다.
4. lease가 만료된 overdue run은 resume 후보로 표시하되 monitor가 업무 handler를 직접 실행하지 않습니다.
5. 동일 occurrence 재검사는 같은 상태·경보 receipt를 재생합니다. 이후 run이 정상 완료되면 recoveredAt과 resolve 경보를 한 번 기록합니다.
6. monitor 자신의 absence는 Cloud Monitoring의 독립 absence metric으로 감지해 같은 job runtime에만 의존하는 사각지대를 줄입니다.

### 5.6 ingress와 outbound HTTP 실행

`HardenedIngressAdapter`는 method/content type/version/body bound → 호출자 credential·App Check → scope → 유한 field/page/period/target bound → rate/cost quota 순서로 검증하고 성공한 `VerifiedIngressContextV1`만 기능 Handler에 전달합니다. 인증 실패·한도 초과에서는 Repository와 기능 Port를 호출하지 않습니다.

시세 전체 갱신은 클라이언트 target 목록을 입력받지 않고 검증된 household scope에서 서버가 active Quote target을 도출하므로 target 수 초과를 거부하지 않습니다. `RefreshRunCoordinator`가 서로 다른 Quote target을 최대 50개씩 cursor page로 나누고 끝까지 처리합니다. 동일 actor·household·scope에서 30초 안에 들어온 요청은 새 run을 만들지 않으며 실행 중이면 같은 Promise/JobRun, 완료됐으면 직전 결과를 반환합니다. 이 single-flight·window는 읽기 자체를 막는 rate limit이 아니라 중복 Provider fan-out을 막는 정책입니다.

외부 Provider Adapter는 `SafeExternalHttpClient`에 provider ID와 상대적인 업무 parameter만 전달합니다. client가 allowlist URL을 구성·검증하고 redirect마다 동일 검증을 반복하며 timeout·응답 byte 상한 안에서만 원문을 Provider parser에 전달합니다. parser가 성공 값을 만들기 전의 제한 위반을 빈 목록·NoData로 축약하지 않습니다.

## 6. Port 설계

| Port | Adapter | 테스트 대역 |
|---|---|---|
| `SafeExternalHttpClientPort` | HTTPS allowlist·redirect 재검증·timeout·max-byte Adapter | scripted URL/redirect/stream fixture |
| `RetrySchedulerPort` | Cloud Tasks/Scheduler delay | virtual scheduler |
| `JobRunStore` | Firestore Operations Adapter | heartbeat·lease·checkpoint 경합을 포함한 in-memory conformance Fake |
| `ScheduledJobDefinitionPort` | 환경별 versioned job schedule config | fixed occurrence definition |
| `ScheduleMonitorPort` | Cloud Scheduler + Cloud Monitoring absence metric | missing/overdue/recovery Spy |
| `ScheduledFeaturePort` | Recurring/Portfolio/Dividends public Input Port | target outcome Stub |
| `Clock`·`IdGenerator` | Shared Kernel | fixed/sequence Fake |
| `OperationsTelemetryPort` | structured logger/metrics/tracing | redaction Spy |
| `ProviderHealthStore` | Firestore server-only Adapter | in-memory conformance Fake |
| `ProviderAlertPort` | Cloud Monitoring log/custom metric + 배포 notification channel Adapter | open/resolve/email-channel Spy |
| `IngressAuthenticatorPort`, `AppAttestationPort` | Firebase Auth/service account/scoped credential, App Check | valid/expired/revoked/wrong-app Fake |
| `IngressRateLimitPort`, `IngressQuotaPort` | server-side credential/IP window와 비용 quota | boundary/parallel Fake |
| `DeadLetterStore` | Firestore server-only Adapter | in-memory Fake |

Provider별 parser/mapper는 해당 Context가 정의한 Port contract suite를 통과해야 한다. 범용 `ExternalDataService`를 만들지 않는다.

## 7. 저장·트랜잭션·동시성

목표 논리 경로:

```text
operations/runtime/jobRuns/{runId}
operations/runtime/jobRuns/{runId}/targets/{targetKey}
operations/runtime/scheduledOccurrences/{occurrenceKey}
operations/runtime/deadLetters/{deliveryId}
operations/runtime/providerHealth/{provider_operation}
operations/runtime/providerHealthReceipts/{executionKeyHash}
```

- `runId`는 `jobName+executionKey` uniqueness claim과 연결한다.
- page 처리에서는 target receipt, next checkpoint, heartbeat와 lease version을 함께 commit한다.
- 대량 job 전체를 한 Firestore transaction에 넣지 않는다.
- lease에는 owner, expiresAt, attempt를 두고 만료된 lease만 takeover한다.
- occurrence key는 `jobName+scheduledFor`의 versioned hash이며 Missing/Overdue와 recovery alert receipt를 한 상태 기계로 수렴시킨다.
- 같은 target key와 다른 payload hash는 `Conflict`로 기록한다.
- [DEC-046](../../../governance/decisions.md#dec-046)에 따라 완료 JobRun·target/execution receipt는 `terminalAt + 30일`의 `expiresAt`을 갖습니다. Firebase Adapter는 이를 Firestore `Timestamp`로 저장합니다. pending·partial·running run과 unresolved dead letter에는 TTL을 두지 않고 해결·폐기 승인으로 terminal이 된 뒤 30일을 계산합니다.
- ProviderHealth는 최신 상태 한 건을 upsert하고 가격·가구·보유수량·응답 원문을 저장하지 않습니다. 문서 수·용량, unresolved age, TTL backlog를 metric으로 남깁니다.

## 8. Event·Projection·외부 연동

- Scheduler wrapper는 cron 해석만 하고 기능 Port를 호출한다.
- 정기 거래 일일 job은 브라우저 접속이나 화면 lifecycle과 무관하게 실행하며, page가 남으면 checkpoint로 자동 재개한다.
- schedule monitor는 expected occurrence의 시작·heartbeat·deadline을 검사하고 기능 handler나 업무 Repository를 직접 호출하지 않는다.
- Operations는 기능 Event를 생산하지 않는다. 운영용 `JobRunCompleted` telemetry와 업무 Integration Event를 구분한다.
- Outbox Dispatcher의 retry/dead letter infrastructure와 공통 관측을 공유할 수 있지만, Inbox 업무 handler를 실행하지 않는다.
- Naver, Nasdaq, Frankfurter v2, Upbit, KIND, 금 시세 Adapter는 정상·NoData·timeout·형식 변경 fixture를 별도로 가진다. Frankfurter 환율 Adapter에는 base·quote·rateDate·rate 검증과 네이버·보조 Provider 호출 0회 fixture를 추가한다.
- 시세 Provider canary는 기존 Firebase Scheduled Function에서 실행하며 Health 상태를 만들기 위해 Next.js Route에 의존하지 않는다.

## 9. 오류·보안·관측성

- Scheduler endpoint는 일반 사용자 token을 허용하지 않고 지정 service account/Cloud Scheduler claim을 검증한다.
- 공개 HTTP ingress는 CORS와 무관하게 호출 유형별 인증·인가·App Check와 유한 body/field/page/period/target/rate/cost limit을 통과해야 하며 검증 실패에서 기능 Application을 호출하지 않는다.
- 시세 전체 갱신은 사용자 target 총수를 제한하지 않고 내부 page 50·동시 호출 5·30초 single-flight window를 적용한다.
- 외부 HTTP는 `SafeExternalHttpClient`의 HTTPS provider allowlist, redirect별 재검증, timeout과 최대 응답 byte 없이는 실행하지 않는다.
- 로그에는 provider, operation, runId/executionKey hash, target hash, result kind, stable error code, attempt, latency, observedAt만 기록한다.
- API key·응답 원문·종목 보유량·가구 ID 원문을 기록하지 않는다.
- 시세 alert 기준은 DEC-018에 따라 contract·invalid·인증·설정 첫 실패와 retryable·예상 밖 NoData의 예약 run 3회 연속 실패입니다. 그 밖의 job failure ratio, retry queue age, lease stuck, checkpoint 무진전 threshold는 별도 운영 설정입니다.
- 장애·복구 이메일 주소는 소스나 Firestore에 저장하지 않고 환경별 배포 config의 Cloud Monitoring notification channel resource로 관리합니다.
- `PartialFailure`를 HTTP 200의 무조건 성공 body로 숨기지 않는다. Scheduler 재시도와 운영 UI가 상태를 판별할 수 있어야 한다.

## 10. 목표 패키지 구조

```text
functions/src/platform/operations/
  application/runScheduledJob.ts
  application/resumeJob.ts
  application/detectMissingOrOverdueRuns.ts
  retry/executeWithRetry.ts
  model/externalResult.ts
  model/jobExecutionResult.ts
  model/providerHealthState.ts
  ports/
  adapters/firestore/jobRunStore.ts
  adapters/firestore/providerHealthStore.ts
  adapters/http/
    safeExternalHttpClient.ts
  adapters/ingress/
    hardenedIngressAdapter.ts
  adapters/scheduler/
  observability/
    firebaseStructuredLogger.ts
    cloudMonitoringProviderAlert.ts
```

업무 Entity가 없으므로 `domain/` 폴더를 만들지 않는다. 공급자 Adapter 파일은 어떤 기능 Port를 구현하는지 이름에 드러낸다.

## 11. 테스트 설계

| 요구사항 ID | 수준 | 테스트 대상 | 핵심 fixture·경계값 | 관찰 결과 | Canonical 테스트 ID |
|---|---|---|---|---|---|
| JOB-ERR-001 | Application, I | Job Runner | 101개 중 2개 실패, 최상위 예외, retry, 중복 executionKey | 50개 page·최대 병렬 5, partial/failed 범위·checkpoint·재시도 수렴 | T-JOB-001 |
| JOB-ERR-002 | Application, Store Conformance, Operations I | occurrence monitor·JobRunStore | 미시작, heartbeat 정지, deadline, lease 경합/만료, checkpoint 뒤 takeover, recovery | Missing/Overdue 한 번 경보, 유효 lease 보호, 완료 target 미재처리, 복구 resolve | T-JOB-002 |
| EXT-001 | U, C, I | External Result Mapper·Retry | 정상, 빈 정상, timeout/429/5xx, NaN, selector 변경, 금 공급자 실패 | 다섯 결과 종류 구분, 가짜 성공 없음 | T-EXT-004 |
| EXT-002 | Contract, Security I | HardenedIngressAdapter·RefreshRunCoordinator | method/content/version, user/service/scoped credential의 만료·폐기·scope, active Actor, App Check, CORS origin, credential/IP quota, 101 targets, 30초 중복 | 모든 선검증 실패 Application 호출 0회, route별 Verified Context만 생성, 전체 target page 처리, 중복 run 1개 | T-EXT-002 |
| EXT-003 | U, Contract, Security I | SafeExternalHttpClient·ConcurrencyLimiter | HTTPS/HTTP, provider별 host·port, 다른 provider host, redirect loop/hop, 10초 timeout, 429/5xx, 동시 6개, chunked 초과 body | 같은 provider ACL을 매 hop 재검증, 최대 병렬 5·retryable 총 3회와 bounded 종료 | T-EXT-003 |
| MARKET-004 | Application, Store Conformance, Operations I | Provider Attempt·Run Outcome·Alert | 내부 retry 3회인 run 1개, 실패 run 3개, contract 1개, recovery, replay | attempt log 전부, failed run은 1씩 증가, 즉시·3회 경보, 성공 reset/resolve, 민감값 없음 | T-MARKET-001 |

필수 contract suite:

- Provider별 기록 fixture의 정상·NoData·contract drift
- `JobRunStore` Fake/Firestore conformance와 lease 경합
- expected occurrence의 미시작·heartbeat 정지·deadline·lease takeover·recovery와 monitor absence alarm
- 같은 executionKey 동시 2회에서 하나의 run
- callback/handler 재실행에도 성공 target 한 번 반영
- 로그·metric에 secret과 금융 원문이 없는 redaction test
- Functions Scheduler Adapter가 `PARTIAL_FAILURE/FAILED`를 성공으로 축약하지 않는 integration test
- 매일 정기 거래 job의 중복 executionKey, 7·8월 누락 page 재개, 이미 성공한 plan/month 미재처리 contract test
- Firebase logger structured field와 ProviderHealthStore Fake/Firestore conformance, AlertPort open/resolve·전달 실패 재시도
- 배포 notification channel resource가 open·resolve에 사용되고 이메일 literal이 소스·상태·로그에 없는 config contract test
- 공개 ingress의 CORS-only 거부, 인증·App Check·scope·유한 limit·rate/quota 경계와 실패 시 기능 Port 0회
- outbound URL 최초·redirect별 HTTPS allowlist, timeout, Content-Length 유무별 최대 응답 byte contract suite

## 12. 확정 정책과 구현 순서

확정된 제품·운영 결정은 중앙 목록에 연결합니다.

- [DEC-046](../../../governance/decisions.md#dec-046): 완료 JobRun·receipt 30일, unresolved run·dead letter 해결 전 보존과 해결 후 30일
- [DEC-049](../../../governance/decisions.md#dec-049): 시세 갱신 page 50, 최대 병렬 5, timeout 10초, retryable 총 3회, 30초 single-flight window
- [DEC-050](../../../governance/decisions.md#dec-050): 단일 production project와 명시적 project·alert channel binding, 로컬 Emulator 검증

Cloud Tasks 도입 여부는 부하와 lease contention으로 판단하는 Infrastructure 선택이며 현재는 Scheduled Functions+JobRun lease를 기본 Adapter로 사용합니다. 수동 replay는 관리자 capability와 새 receipt를 요구합니다. 공급자 fixture는 ToS가 명시적으로 허용하지 않으면 원문을 저장하지 않고 비식별 contract fixture만 유지합니다.

구현 순서:

1. 현재 scheduler의 거짓 성공을 재현하는 Characterization/목표 test를 추가한다.
2. `ExternalResult` mapper와 provider fixture suite를 만든다.
3. Scheduler wrapper에서 업무 handler를 분리한다.
4. JobRunStore·heartbeat·checkpoint·lease를 도입해 한 job을 전환하고 `T-JOB-002`를 활성화한다.
5. 독립 occurrence monitor와 Cloud Monitoring absence alarm을 연결한다.
6. `HardenedIngressAdapter`와 `SafeExternalHttpClient`를 도입해 공개 route와 Provider Adapter를 순차 전환한다.
7. Firebase Scheduled Function에 structured logger·ProviderHealthStore·환경별 email notification channel을 참조하는 Cloud Monitoring Adapter를 연결하고 `T-MARKET-001`을 활성화한다.
8. 모든 job 전환 후 최상위 성공 축약과 고정 fallback을 제거한다.
