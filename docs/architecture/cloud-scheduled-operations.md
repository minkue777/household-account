# Cloud 예약 작업 목표 설계와 운영 검증 기준

> 상태: Proposed — 요구사항 구현·테스트·배포 검증 기준  
> 기준일: 2026-07-19  
> 대상 프로젝트: `household-account-6f300`  
> 기준 시간대: `Asia/Seoul`  
> 상위 설계: [목표 Clean Architecture](target-clean-architecture.md)  
> 운영 공통 계약: [외부 연동·운영 상세 설계](../requirements/supporting-platform/modules/external-operations/design.md)

## 1. 결론

요구사항을 모두 반영한 목표 구조에는 **업무 예약 작업 5개**와 **독립 운영 감시 작업 1개**가 필요합니다.

| 서울 시각 | 목표 job | 소유 기능 | 호출할 Application Input Port | 핵심 결과 |
|---|---|---|---|---|
| 매일 00:00 | `recurring-daily` | Household Finance / Recurring | `ProcessDueRecurringPlans` | 실행일이 도래한 정기지출과 과거 누락 월을 월별 한 건으로 생성 |
| 매일 00:00 | `asset-automation-daily` | Portfolio / Asset Automation | `ProcessDueAssetAutomation` | 적금 납입·대출 상환의 due 월을 오래된 순서로 반영 |
| 매일 06:00 | `instrument-catalog-daily` | Portfolio / Holdings·Market Data | `PublishInstrumentCatalog` | 국내·미국 주식·ETF·ETN 검색 snapshot 발행 |
| 매일 09:00~20:00 매시 정각 | `dividend-hourly` | Portfolio / Dividends | `RefreshDividendEvents` | KRX ETF 공시 discovery와 기존 Event lifecycle sweep |
| 매일 23:55 | `asset-valuation-daily` | Portfolio / Holdings·Market Data | `RunDailyAssetValuation` | 전체 시세 갱신·평가 후 당일 자산 Snapshot 요청 |
| 기본 5분 간격 | `scheduled-job-monitor` | Supporting Platform / External Operations | `DetectMissingOrOverdueRuns` | 미시작 `Missing`, 정체 `Overdue`, 복구 감지와 경보 |

`scheduled-job-monitor`의 5분 간격은 제품 정책이 아니라 최초 운영 기본값입니다. 기능 job의 cron은 요구사항으로 고정하지만, monitor 간격과 job별 grace·deadline·heartbeat timeout은 유한한 versioned 배포 설정으로 관리하고 실제 실행시간을 바탕으로 조정합니다.

같은 00:00에 시작하는 정기지출과 자산 자동화는 하나의 함수로 합치지 않습니다. 서로 다른 기능의 공개 Port를 호출하는 독립 job이며, 어느 한쪽의 실패·재시도·배포가 다른 쪽의 실행 상태를 바꾸지 않아야 합니다.

## 2. 하루 실행 시간선

```text
00:00  recurring-daily ───────────────┐
       asset-automation-daily ────────┤ 서로 독립적으로 실행
06:00  instrument-catalog-daily       │
09~20  dividend-hourly (매시 정각)   │
23:55  asset-valuation-daily ── 모든 page terminal ── AssetSnapshot 요청

매 5분 scheduled-job-monitor ── 위 occurrence의 미시작·heartbeat 정체·복구 감시
```

모든 업무 날짜는 함수가 실제로 끝난 시각이 아니라 Scheduler occurrence의 `scheduledFor`를 `Asia/Seoul` LocalDate로 변환해 얻습니다. 예를 들어 23:55 평가가 자정을 넘어 끝나도 Snapshot의 `asOfDate`는 시작 occurrence의 날짜입니다.

## 3. 공통 실행 아키텍처

모든 예약 함수는 같은 얇은 Inbound Adapter 형태를 사용합니다.

```text
Cloud Scheduler
  → Scheduled Function Adapter
    → scheduler credential을 최소 Capability의 SystemActor로 변환
    → RunScheduledJob(jobName, executionKey, checkpoint)
      → 기능 Application Input Port
        → 기능별 Domain Policy와 Unit of Work
      → JobRun / target result / heartbeat / checkpoint 저장
    → COMPLETE | PARTIAL_FAILURE | FAILED를 Cloud 실행 결과에 반영
```

Scheduler Adapter가 해서는 안 되는 일:

- Firestore 업무 컬렉션을 직접 조회하거나 수정
- due 날짜·금액·배당 상태·시세 Provider를 직접 결정
- 자산 Snapshot이나 연간 배당 Projection을 직접 작성
- 내부 실패를 `null`·빈 배열·고정값으로 바꿔 성공 반환
- 여러 가구나 전체 page를 하나의 Firestore transaction으로 처리

### 3.1 occurrence와 실행 키

| job | occurrence execution key | child 멱등 키 또는 checkpoint |
|---|---|---|
| 정기지출 | `recurring-daily:{asOfDate}` | `planId:YYYY-MM`, 결정 cursor |
| 자산 자동화 | `asset-automation-daily:{asOfDate}` | `householdId:assetId:operation:YYYY-MM`, `nextDueDate` cursor |
| 종목 카탈로그 | `instrument-catalog:{asOfDate}:{schemaVersion}` | immutable snapshot generation·checksum |
| 배당 | `dividend-hourly:{scheduledHour}` | `DISCOVERY`와 `LIFECYCLE_SWEEP`별 cursor, canonical `eventId` |
| 자산 평가 | `asset-valuation-daily:{asOfDate}` | `runId:assetId:quoteBatchId`, 자산 cursor, 날짜·scope별 Snapshot ID |
| 감시 | `scheduled-job-monitor:{scheduledMinute}` | `jobName:scheduledFor` occurrence key |

같은 occurrence가 중복 전달되어도 `jobName + executionKey`는 JobRun 하나로 수렴합니다. lease 소유자만 heartbeat와 checkpoint를 갱신하며, lease가 만료된 뒤에만 다른 worker가 takeover합니다. 완료 target receipt가 있으면 Provider 호출이나 업무 반영을 반복하지 않습니다.

### 3.2 공통 완료 판정

| 상태 | 판정 |
|---|---|
| `COMPLETE` | 모든 target이 성공·이미 처리됨·의도적 skip 중 하나이고 남은 cursor가 없음 |
| `PARTIAL_FAILURE` | 성공 target은 commit됐지만 실패 또는 미처리 target과 재시도 key가 남아 있음 |
| `FAILED` | 시작·page 조회·checkpoint 등 job 자체가 실패해 정상 처리 범위를 확정할 수 없음 |
| `MISSING` | grace가 지났는데 해당 occurrence의 JobRun이 없음 |
| `OVERDUE` | JobRun은 시작했지만 heartbeat timeout 또는 deadline을 넘김 |

함수 process가 `ok`로 끝났다는 사실과 업무 job이 `COMPLETE`라는 사실을 분리합니다. `PARTIAL_FAILURE`·`FAILED`를 최상위 성공으로 축약하지 않으며, 구조화된 실패 범위와 retryability를 JobRun에 남기고 Scheduler/재개 경로가 실패를 인식하게 합니다.

### 3.3 재시도는 새 일일 job이 아니다

- Provider의 retryable HTTP 실패는 같은 target 실행 안에서 정해진 횟수만 재시도합니다. 시세 갱신은 최초 시도 포함 총 3회입니다.
- page 중단·lease 만료·일부 target 실패는 같은 occurrence execution key와 checkpoint를 사용하는 `ResumeJob`으로 이어갑니다. 별도의 `retry-daily` cron을 만들지 않습니다.
- 초기 Adapter는 Scheduled Function 재전달과 JobRun lease로 구현하고, 실행량이나 lease 경합이 커질 때만 동일 계약 뒤의 지연 실행 Adapter를 Cloud Tasks로 교체할 수 있습니다.
- 다음 날 정기지출·자산 자동화 occurrence도 여전히 due인 누락 월을 찾으므로 최종 복구 안전망이 됩니다. 이미 성공한 월은 execution claim 때문에 다시 반영되지 않습니다.
- monitor는 실패 run을 표시하고 경보할 뿐 업무 handler를 직접 재실행하지 않습니다.

## 4. job별 상세 동작

### 4.1 `recurring-daily` — 매일 00:00

근거: [정기 거래 요구사항 REC-002·REC-003](../requirements/contexts/household-finance/modules/recurring-transactions/requirements.md), [상세 설계](../requirements/contexts/household-finance/modules/recurring-transactions/design.md)

1. Adapter는 `asOfDate`, `Asia/Seoul`, runId, cursor만 `ProcessDueRecurringPlans`에 전달합니다.
2. Recurring Application이 활성 Plan page를 읽고 `firstApplicableMonth` 이후 실행일이 도래했지만 execution이 없는 월을 오래된 순서로 계산합니다.
3. 각 `planId + YYYY-MM`을 독립 `ProcessRecurringMonthWorkflow`로 처리합니다.
4. Recurring execution/checkpoint, Ledger Transaction, receipt, Outbox를 하나의 Household Finance UoW로 commit합니다.
5. 짧은 달의 29~31일은 말일로 보정합니다.
6. 특정 월이 실패하면 성공한 월은 유지하고 실패 월부터 같은 키로 재시도합니다. 제품상 소급 기간 상한은 없습니다.
7. 브라우저 접속과 `LedgerPage` 생명주기는 입력이 아닙니다.

정기지출로 생성된 거래는 일반 자동 푸시를 보내지 않지만, 사용자의 명시적 `알림 보내기`는 별도 흐름으로 처리합니다.

### 4.2 `asset-automation-daily` — 매일 00:00

근거: [자산 자동화 요구사항 AUTO-003](../requirements/contexts/portfolio/modules/asset-automation/requirements.md), [상세 설계](../requirements/contexts/portfolio/modules/asset-automation/design.md)

1. Adapter는 `asOfDate`, runId, cursor만 `ProcessDueAssetAutomation`에 전달합니다.
2. Application은 `(active 또는 recovering-before-stop) AND nextDueDate <= asOfDate`인 Plan만 결정적 순서로 page 조회합니다.
3. Plan별로 가장 오래된 due 월부터 당시 effective revision을 적용합니다.
4. 적금은 납입액을 더하고, 대출은 확정된 원리금 정책으로 원금을 줄입니다. 대출 잔액은 0 아래로 내려가지 않습니다.
5. execution claim, Asset 변경, Plan의 다음 due date, receipt, Outbox를 하나의 Portfolio Automation UoW로 commit합니다.
6. 성공했을 때만 `nextDueDate`를 전진시킵니다. 18·19일 실패 후 20일 성공처럼 다음 일일 실행에서 계속 복구합니다.
7. 잘못된 Plan은 0원 성공으로 가장하지 않고 `needsAttention`으로 격리합니다.
8. 과거 execution과 Plan revision은 자동 재계산·삭제하지 않습니다.

이 job은 정기지출 job과 같은 시각에 실행되지만 데이터 소유권과 UoW가 다르므로 실행 순서 의존성이 없습니다.

Functions의 실제 export 이름은 `assetAutomationDaily`입니다. page cursor는
`nextDueDate + canonical document path`를 versioned opaque 값으로 보존하고,
SDK의 예약 함수 제한 안에서 `scheduledFunctionTimeoutSeconds`를 사용합니다.
기존 데이터는 배포 전에 legacy 자동화 설정과 last month를 canonical
Plan/Revision으로 backfill하고 reconciliation해야 합니다. 일일 job 자체는 due
Plan만 조회하며 legacy Asset 전체 scan을 backfill 수단으로 사용하지 않습니다.

### 4.3 `instrument-catalog-daily` — 매일 06:00

근거: [시장 데이터 요구사항 MARKET-005](../requirements/contexts/portfolio/modules/holdings-market-data/requirements.md), [상세 설계](../requirements/contexts/portfolio/modules/holdings-market-data/design.md)

1. 국내·미국 주식·ETF·ETN catalog source를 호출해 `InstrumentRefV1`로 정규화합니다.
2. 중복 market/code, 필수 필드, 허용 상품 종류, source별 최소 개수와 checksum을 검증합니다.
3. 전부 유효할 때만 `market-catalog/v1/snapshots/{asOfDate}/{catalogVersion}.json.gz`를 immutable 객체로 올립니다.
4. 업로드 객체를 다시 검증한 뒤 `latest.json` manifest를 generation precondition으로 교체합니다.
5. manifest 교체 성공 뒤에만 서로 다른 최근 **성공일 3개**의 일별 snapshot을 남기고 과거 객체를 정리합니다. 같은 날짜 재실행은 보존 개수를 늘리지 않습니다.
6. 실패·빈 성공·부분 업로드는 현재 `latest`를 바꾸지 않습니다.
7. 검색 함수는 generation을 확인하는 5분 인스턴스 메모리 cache를 사용합니다. 이는 Scheduler job이 아니라 조회 최적화입니다.
8. warm cache에서 Storage 조회가 실패하면 기존 snapshot을 `stale=true`로 제공하고, cold cache이면 `RetryableFailure`입니다.
9. `stocks.json`은 fallback으로 사용하지 않으며 목표 전환 완료 후 reader와 파일을 함께 제거합니다.

### 4.4 `dividend-hourly` — 매일 09:00~20:00 매시 정각

근거: [배당 요구사항 DIV-003~006·JOB-DIV-001~002](../requirements/contexts/portfolio/modules/dividends/requirements.md), [상세 설계](../requirements/contexts/portfolio/modules/dividends/design.md)

cron은 `0 9-20 * * *`이며 하루 12회 실행합니다. 각 시간 occurrence는 `scheduledFor`를 포함한 별도 runId를 사용하고, 같은 occurrence 아래 두 phase를 별도 checkpoint로 실행합니다. 17:30 공시는 18:00에 수집하며 20:00 이후 공시는 다음 날 09:00에 수집합니다.

#### Phase A — `DISCOVERY`

1. Holdings 공개 Query가 `market=KRX && instrumentType=ETF`로 명시한 active instrument만 결정적 page로 읽습니다.
2. 코드 모양, 종목명 또는 `holdingType=stock`으로 ETF를 추정하지 않습니다.
3. KIND Adapter가 최근 1년 공시를 조회하고 성공·NoData·retryable·contract failure를 구분합니다.
4. 검색 접수번호가 달라도 KIND viewer의 document number가 같으면 동일 공시로 정규화하고, `source + sourceDisclosureId(document number)` 기반 canonical `eventId`로 upsert합니다. 정정 가능한 기준일·지급일·금액을 ID에 넣지 않습니다.
5. 같은 미지급 공시의 정정은 동일 Event의 현재 값만 교체하며 이전 값을 별도 보관하지 않습니다.

#### Phase B — `LIFECYCLE_SWEEP`

1. discovery 결과나 현재 보유 목록과 독립적으로 저장된 전체 `announced|fixed` Event를 page 조회합니다.
2. `announced`가 기준일에 도달하면 보존된 Position history에서 정확한 기준일을 우선하고, 없으면 날짜 차이가 가장 작은 snapshot을 선택하며 동률이면 이전 날짜를 사용합니다.
3. snapshot이 없거나 조회에 실패하면 수량 0으로 바꾸지 않고 Event를 `announced`에 남깁니다.
4. `fixed`는 현재 Holding·Asset이 사라졌거나 Provider가 실패해도 저장된 지급일이 되면 `paid`로 전이합니다.
5. 지급 전 명시적 취소만 Event와 Projection에서 제거합니다. NoData·Provider 실패는 삭제 근거가 아니며 `paid`는 이후 정정·취소에도 불변입니다.
6. Event 변경은 Outbox로 전달하고 `AnnualDividendProjector`만 연간 Projection을 갱신합니다.

두 phase 중 하나 또는 일부 instrument/Event가 실패해도 다른 성공을 rollback하지 않습니다. 실패 child와 cursor만 재시도하며 전체 1년·전체 가구를 한 transaction으로 묶지 않습니다.

### 4.5 `asset-valuation-daily` — 매일 23:55

근거: [시장 데이터 요구사항 JOB-AST-001~003](../requirements/contexts/portfolio/modules/holdings-market-data/requirements.md), [상세 설계](../requirements/contexts/portfolio/modules/holdings-market-data/design.md)

1. 전체 active 가구의 active Asset을 조회합니다. legacy `isActive` 누락과 `true`는 active, `false`는 deleted로 동일하게 해석합니다.
2. 국내·미국 주식·ETF·ETN, 지원 펀드, KRW 코인, 실물 금의 Quote target을 결정적으로 정렬해 최대 50개씩 page 처리합니다. 전체 target 수에는 제품 상한을 두지 않습니다.
3. 한 run에서 Provider 호출은 최대 5개만 병렬 실행하고, 요청당 timeout은 10초, retryable 실패는 총 3회까지만 시도합니다.
4. 시장별 Adapter를 사용합니다. 국내는 Naver, 미국은 Nasdaq와 Frankfurter v2 USD/KRW, 코인은 Upbit, 지원 펀드는 전용 NAV Adapter, 금은 실물 금 Provider를 사용합니다.
5. 실패 target의 가격을 0이나 고정값으로 만들지 않고 마지막 성공 Quote와 원래 `observedAt`을 기간 제한 없이 유지합니다. 환율도 Frankfurter v2 마지막 성공값을 유지하며 보조 환율 Provider는 호출하지 않습니다.
6. 자산별 평가 commit은 독립 UoW이며 성공·NoData·retryable·permanent 결과를 집계합니다.
7. 모든 page가 terminal 상태가 된 뒤에만 `AssetSnapshotProjectorInput`으로 해당 `asOfDate`의 Snapshot을 요청합니다.
8. Snapshot은 총자산·금융자산·소유자·유형 scope를 결정적으로 upsert합니다. 현재와 직전 scope의 합집합을 사용해 사라진 scope와 자산이 없는 가구도 0원으로 기록합니다.
9. 같은 날짜 재실행은 같은 Snapshot ID로 수렴하고 최초 `createdAt`을 보존합니다.
10. 일부 Quote가 실패해도 성공 범위를 되돌리지 않고 마지막 성공 Quote가 반영된 현재 Canonical Portfolio로 Snapshot을 계산합니다.

개별 자산 수동 갱신과 자산 메인 페이지 진입 시 가구 전체 갱신은 같은 평가 Workflow를 재사용하지만 Cloud 예약 작업 수에는 포함하지 않습니다.

Repository의 production composition에서는 `assetValuationDaily`가 위 계약을 담당합니다.
tracked run의 첫 phase는 active 가구별 동일 refresh Workflow를 호출하고, 모든 가구 cursor가
terminal이 된 뒤 두 번째 phase에서 Canonical Portfolio를 다시 읽어 Snapshot을 투영합니다.
Provider retry를 모두 소진한 target은 마지막 성공값 유지로 terminal 처리하되 Provider Health와
구조화 로그에는 실패 run을 남깁니다. 이 구현 상태는 아래 2026-07-19의 실제 배포 상태 감사와
별개이며, 배포 전에는 운영 함수가 바뀐 것으로 간주하지 않습니다.

### 4.6 `scheduled-job-monitor` — 기본 5분 간격

근거: [외부 운영 요구사항 JOB-ERR-002](../requirements/supporting-platform/modules/external-operations/requirements.md), [예약 누락·정체 상세 설계](../requirements/supporting-platform/modules/external-operations/design.md#55-예약-누락정체-감지)

1. versioned `ScheduledJobDefinition`에서 job별 cron, timezone, grace, deadline, heartbeat interval을 읽습니다.
2. grace 이후에도 JobRun이 없으면 결정적 occurrence key로 `MISSING`을 기록하고 한 번만 경보합니다.
3. 실행 중 heartbeat timeout 또는 deadline을 넘으면 `OVERDUE`를 기록합니다.
4. 만료 lease의 run은 재개 후보로 표시하지만 monitor가 업무 handler나 업무 Repository를 직접 호출하지 않습니다.
5. 이후 정상 완료되면 같은 alert identity에 `recoveredAt`을 기록하고 복구 알림을 보냅니다.
6. monitor 자체가 실행되지 않는 장애는 Cloud Monitoring의 별도 absence metric/alarm으로 감지합니다.

## 5. 외부 Provider와 장애 경보

| job | Provider | 실패 시 업무값 | 경보 기준 |
|---|---|---|---|
| 종목 카탈로그 | 국내·미국 catalog source | 기존 `latest` 유지 | contract·invalid·설정 실패 즉시, retryable은 운영 Health 정책 |
| 배당 | KIND | 기존 Event 유지, lifecycle은 가능한 범위에서 계속 | schema 변경 즉시, retryable/예상 밖 NoData 연속 실패 관측 |
| 자산 평가 | Naver, Nasdaq, Frankfurter v2, Upbit, 펀드 NAV, 실물 금 | 각 Provider의 마지막 성공 관측 유지 | contract·invalid·인증·설정 첫 실패, 추적 대상 retryable·예상 밖 NoData는 예약 run 3회 연속 실패 |

각 HTTP 시도는 `provider`, `operation`, execution key hash, target hash, result kind, stable error code, attempt, latency, observedAt만 구조화 로그로 남깁니다. API key, 응답 원문, 가구 ID 원문, 사용자 이름, 보유수량은 기록하지 않습니다.

Provider별 최종 실행 결과는 `operations/runtime/providerHealth/{provider_operation}`에 저장합니다. 한 job 내부 HTTP 재시도 3회는 연속 실패 run 3회가 아니라 같은 execution key의 실패 1회로 계산합니다. 다음 성공과 `expectedData=false`인 정상 NoData는 연속 실패 수를 0으로 만들고 같은 Cloud Monitoring alert를 resolve합니다. `expectedData=true`의 예상 밖 NoData만 실패 run으로 계산합니다. 이메일 주소는 코드나 Firestore가 아니라 배포된 notification channel resource에만 둡니다.

## 6. 예약 작업이 아닌 동작

다음은 Cloud에서 실행될 수 있어도 cron job으로 만들지 않습니다.

| 동작 | 실행 방식 |
|---|---|
| Android·Shortcut 결제 등록 | 인증된 HTTP/Callable Command |
| 새 거래·명시적 알림 전송 | Transactional Outbox/Event consumer |
| FCM endpoint 비활성화 | 전송 결과 Event 또는 로그아웃 Command |
| AssetSnapshot 실제 저장 | 23:55 평가 완료 뒤 Projector 호출 |
| 연간 배당 Projection 갱신 | Dividend Event Outbox consumer |
| 자산 페이지 진입 전체 갱신 | 사용자 Command, 30초 single-flight |
| 종목 검색의 5분 cache | 서버리스 인스턴스 메모리 TTL |
| 완료 JobRun·receipt 30일 정리 | Firestore TTL 인프라 |
| 가구·자산 영구 purge | 사용자에게 제공하지 않는 명시적 관리자/에이전트 Command |

특히 가구·자산·거래의 영구 삭제를 주기적으로 수행하는 cleanup job은 두지 않습니다. 사용자가 요청한 복구 가능 논리 삭제와 “영구 삭제는 나중에 관리자 에이전트가 명시적으로 수행” 정책을 지킵니다.

## 7. 배포본 기준 운영 상태 스냅샷 — 2026-07-19

Firebase CLI로 실제 배포 상태와 최근 Cloud Logging을 읽기 전용 조회했습니다.

> 이 절과 다음 간극 표는 **2026-07-19 당시 배포본의 역사적 기준선**입니다. 2026-07-21 로컬 소스에는 아래 목표 예약 함수와 공통 JobRun·ProviderHealth가 구현되어 있지만, 아직 운영 배포·backfill·외부 설정 검증을 수행했다는 뜻은 아닙니다. 최신 소스 전환 상태는 [서버 권위형 런타임 전환 상태](runtime-migration-status.md)를 따릅니다.

| 항목 | 현재 확인 결과 |
|---|---|
| Firebase 프로젝트 | `household-account-6f300` |
| 예약 함수 | `dailyAssetSnapshot`, `dailyDividendSnapshot` 두 개만 배포됨 |
| 런타임 | 두 함수 모두 Cloud Functions 1세대, Node.js 22, `asia-northeast3`, timeout 60초 |
| 자산 예약 | 소스 cron `55 23 * * *`, `Asia/Seoul`; 최근 23:55 실행 로그 존재 |
| 배당 예약 | 소스 cron `0 17 * * *`, `Asia/Seoul`; 당일 17:00 실행 로그 존재 |
| 정기지출 00:00 | 예약 함수 없음; 현재 `LedgerPage` 방문 시 Web에서 처리 |
| 자산 자동화 00:00 | 예약 함수 없음; 현재 자산 화면 방문 시 Web에서 처리 |
| 종목 카탈로그 06:00 | 예약 함수 없음; 현재 검색 Route가 `stocks.json`을 직접 import |
| 예약 누락·정체 monitor | 없음 |
| JobRun·heartbeat·lease·checkpoint | 없음 |
| ProviderHealth·Cloud Monitoring 이메일 경보 | 목표 계약 미구현 |

최근 로그의 함수 실행은 `ok`로 끝났지만 이것만으로 업무 완료를 증명할 수는 없습니다. 현재 두 함수는 대상별·최상위 예외를 잡고 `null`을 반환하므로 내부 실패가 있어도 Cloud Functions 실행 상태가 성공이 될 수 있습니다.

### 7.1 종목 카탈로그 운영 전환 — 2026-07-22

`instrumentCatalogDaily`를 Cloud Functions 2세대에 배포하고 `Asia/Seoul` 기준 매일 06:00 실행하도록 연결했습니다. 배포 직후 수동 실행으로 Cloud Storage의 `market-catalog/v1/latest.json`과 일일 압축 snapshot 생성을 확인했으며, 최초 snapshot은 국내 4,408개와 미국 13,021개, 총 17,429개 종목을 포함합니다. 검색 런타임은 이 snapshot을 읽고 메모리에 5분간 캐시하며 `stocks.json` fallback은 사용하지 않습니다.

## 8. 2026-07-19 배포본과 목표 사이의 핵심 간극

| 영역 | 현재 코드 | 목표 교정 |
|---|---|---|
| Scheduler 경계 | 함수 안에서 Provider 호출·업무 계산·Firestore write를 모두 수행 | 얇은 Adapter → Operations runner → 기능 Input Port |
| 실패 표현 | catch 뒤 `return null`, Provider 실패는 `null` | typed result, `PARTIAL_FAILURE/FAILED`, 실패 child·retry key |
| 대량 처리 | 전체 컬렉션 조회와 순차 loop, checkpoint 없음 | 결정 cursor page, heartbeat, lease, 중단 후 재개 |
| 정기지출 | 화면 방문 시 당월만 처리 | 매일 00:00, 생성 이후 모든 due 누락 월 복구 |
| 자산 자동화 | 자산 화면 방문 시 처리 | 매일 00:00 due index, 성공 뒤에만 다음 due 전진 |
| 종목 카탈로그 | `stocks.json` 정적 import | 06:00 Storage snapshot·원자 manifest·성공본 3개 |
| 자산 Provider | 모든 stockCode를 Naver로 조회하고 지원 펀드만 별도 처리 | 명시적 market/type routing과 모든 지원 자산 처리 |
| 활성 자산 | `isActive == true` query가 누락 필드를 제외 | 누락·true는 active, false는 deleted인 공통 Mapper |
| 자산 Snapshot | 함수가 `asset_history`를 직접 작성하고 현재 owner만 생성 | 모든 page terminal 뒤 Projector가 현재·직전 scope 합집합 upsert |
| 배당 discovery | 영숫자 stock과 기본 `holdingType=stock`을 ETF처럼 조회 | 명시적인 KRX ETF만 KIND 조회 |
| 배당 ID | 기준일·지급일·금액을 문서 ID에 포함 | 안정적인 공급자 공시 ID 사용, 미지급 정정은 같은 Event 교체 |
| 배당 lifecycle | 현재 Holding과 당일 discovery 결과에 묶임 | canonical nonterminal Event 독립 sweep |
| 배당 수량 | 기준일 당일 현재 수량만 capture | 정확한 snapshot, 없으면 최근접·동률 이전 날짜 복구 |
| Projection | 예약 함수가 snapshot을 merge | Event consumer 단일 Writer가 canonical map 전체 재계산 |
| 관측 | 문자열 로그와 Cloud process 성공 여부 | JobRun·target·Health·Missing/Overdue·장애/복구 경보 |

## 9. 구현·전환 순서

예약 함수를 여섯 개 동시에 다시 쓰지 않고 공통 실행 뼈대를 먼저 검증한 뒤 기능별로 전환합니다.

아래 구현은 2026-07-21 로컬 소스에서 완료됐습니다. 운영에서는 migration dry-run·reconciliation과 외부 설정 확인 후 같은 순서로 Writer를 하나씩 활성화합니다.

1. `JobRunStore`, execution claim, heartbeat, lease, checkpoint와 `RunScheduledJob`을 구현합니다.
2. `scheduled-job-monitor`와 Cloud Monitoring의 monitor-absence 경보를 먼저 연결합니다.
3. 현재 23:55 자산 job을 `RunDailyAssetValuation`으로 전환해 page·부분 실패·Provider Health·Snapshot 후행 조건을 검증합니다.
4. 현재 17:00 하루 1회 배당 job을 09:00~20:00 매시 정각 schedule로 바꾸고 `DISCOVERY`와 `LIFECYCLE_SWEEP`으로 분리합니다.
5. 00:00 정기지출 job을 추가하고 화면 방문 자동 처리를 제거합니다.
6. 00:00 자산 자동화 job을 추가하고 화면 방문 자동 처리를 제거합니다.
7. 06:00 종목 카탈로그 발행을 추가하고 shadow 검증 뒤 `stocks.json` reader와 파일을 제거합니다.
8. 모든 job에서 최상위 성공 축약을 제거하고 Cloud Monitoring 장애·복구 이메일을 실제로 시험합니다.

각 단계는 기존 Writer와 신규 Writer를 동시에 활성화하지 않습니다. 먼저 Characterization/목표 테스트와 shadow read로 결과를 비교하고, 한 기능의 단일 Writer를 전환한 뒤 다음 job으로 이동합니다.

## 10. 필수 테스트와 배포 검증

### 10.1 자동 테스트

| 범위 | Canonical 테스트 |
|---|---|
| 정기지출 00:00·7/8월 누락·중복 실행 | `T-REC-005`, `T-REC-006` |
| 자산 자동화 실패 후 다음 날 복구·nextDueDate | AUTO-003 상세 시나리오 |
| 카탈로그 원자 publish·성공본 3개·cache | `T-MARKET-002` |
| 전체 시세 Provider·100개 초과·부분 실패·Snapshot | `T-JOB-AST-001`, `T-MARKET-001`, `T-MARKET-003` |
| 배당 최근접 수량·KRX ETF 한정·독립 sweep | `T-DIV-001`, `T-DIV-002`, `T-DIV-003` |
| job 부분 실패·중복 execution key | `T-JOB-001` |
| Missing·Overdue·lease takeover·checkpoint 재개 | `T-JOB-002` |
| 외부 HTTP timeout·retry·allowlist | `T-EXT-003` |

### 10.2 Emulator 통합 검증

- 같은 occurrence를 동시에 두 번 호출해 JobRun과 업무 결과가 하나인지 확인
- page commit 직후 process를 강제 종료하고 다음 worker가 다음 cursor부터 이어가는지 확인
- heartbeat를 멈춰 `OVERDUE`, 함수 호출 자체를 막아 `MISSING`이 되는지 확인
- 한 Provider만 timeout시켜 성공 target은 유지되고 실패 target만 재시도되는지 확인
- 23:55 job을 자정 이후 완료시켜도 전날 `asOfDate` Snapshot에 수렴하는지 확인
- Projector Event를 중복·역순 전달해 중복은 no-op, gap은 rebuild 요청인지 확인
- 로그·JobRun·Health 문서에 가구 ID 원문, 보유수량, 응답 원문, credential이 없는지 확인

### 10.3 배포 후 운영 검증

1. 배포된 함수 목록과 실제 Scheduler job의 cron·timezone·enabled 상태가 이 문서와 일치하는지 확인합니다.
2. 각 job을 비업무 fixture 또는 안전한 dry-run 대상으로 수동 실행해 JobRun이 생성되는지 확인합니다.
3. 같은 execution key 재실행에서 완료 target과 업무 데이터가 중복되지 않는지 확인합니다.
4. 의도적으로 한 Provider를 실패시켜 `PARTIAL_FAILURE`, Health 증가, 재시도 범위를 확인합니다.
5. contract failure 1회와 retryable failure 3회로 장애 이메일이 열리고, 다음 성공에서 복구 이메일이 오는지 확인합니다.
6. 한 occurrence를 비활성화해 monitor가 `MISSING`을 감지하고, 재활성화 뒤 resolve하는지 확인합니다.
7. 06:00 publish 실패에서도 이전 catalog `latest`가 검색되는지 확인합니다.
8. 한 시간의 discovery 결과가 비어 있어도 기존 fixed Event만 있는 fixture에서 lifecycle sweep과 지급일 전이가 진행되는지 확인합니다.
9. 23:55 일부 Quote 실패에서도 마지막 성공값으로 당일 Snapshot이 한 번만 만들어지는지 확인합니다.

## 11. 배포 전 남은 운영 설정

제품 정책상 예약 시각과 업무 결과는 모두 확정되어 있습니다. 최초 배포 SLO는
[`scheduled-job-definitions.v1`](../../contracts/fixtures/operations/scheduled-job-definitions.v1.json)에 버전으로 고정합니다.

| job | start grace | deadline | heartbeat timeout | lease | page × 최대 page |
|---|---:|---:|---:|---:|---:|
| recurring-daily | 5분 | 8분 | 3분 | 5분 | 100 × 100 |
| asset-automation-daily | 5분 | 8분 | 3분 | 5분 | 100 × 100 |
| instrument-catalog-daily | 5분 | 8분 | 5분 | 5분 | 1,000 × 10 |
| dividend-hourly | 5분 | 8분 | 5분 | 5분 | 50 × 200 |
| asset-valuation-daily | 5분 | 8분 | 5분 | 5분 | 50 × 1,000 |
| scheduled-job-monitor | 2분 | 4분 | 2분 | 5분 | 200 × 20 |

현재 설치된 `firebase-functions` 7.x는 `onSchedule`을 event function으로 검증하며 배포 timeout 상한을 540초로 제한합니다. 따라서 업무 처리 deadline은 480초, 결과·checkpoint 저장을 포함한 함수 timeout은 510초로 둡니다. Google Cloud의 더 긴 플랫폼 상한에 기대어 SDK 검증을 우회하지 않습니다. 한 occurrence가 이 예산에 수렴하지 않으면 deadline을 늘리지 않고 checkpoint를 보존한 continuation으로 분리합니다. 실측 결과에 따라 다음 버전에서 조정할 수 있지만 0·무한값이나 코드 곳곳의 개별 하드코딩은 허용하지 않습니다. catalog/KIND/SafeExternalHttpClient의 최대 응답 byte와 provider별 rate quota도 같은 배포 설정 경계에서 관리합니다. Cloud Monitoring notification channel은 `minkue777@gmail.com`에 연결하되 주소를 애플리케이션 코드나 Firestore에 저장하지 않습니다.
