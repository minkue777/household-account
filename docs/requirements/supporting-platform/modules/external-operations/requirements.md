# 외부 연동·운영 모듈 요구사항

> 상위 Bounded Context: 없음 — [지원·읽기·플랫폼 영역](../../requirements.md)  
> 아키텍처 역할: Infrastructure / Operations  
> 상세 설계: [모듈 상세 설계](design.md)  
> 상태와 테스트 표기 규칙은 [공통 요구사항 규약](../../../governance/conventions.md)을 따릅니다.  
> 이 문서는 `JOB-ERR-*`, `EXT-*` 요구사항의 단일 소유 문서입니다.

## 1. 독립 모듈 책임

외부 연동·운영 모듈은 시세·공시 등 외부 공급자 호출과 예약 작업에서 공통으로 필요한 결과 분류, 재시도, 관측 가능성을 제공합니다. 외부 호출의 `성공`, `데이터 없음`, `일시 실패`, `영구 계약 실패`, `잘못된 데이터`를 구분하고, 여러 대상을 처리하는 job은 부분 실패 범위와 재시도 가능성을 숨기지 않습니다.

이 모듈은 공급자별 업무 의미나 자산·배당 데이터를 소유하지 않습니다. 기능 모듈이 정의한 포트를 HTTP·HTML·Scheduler Adapter로 구현하고 표준 실행 결과를 반환합니다.

## 2. 포함/제외 범위

### 포함

- 외부 호출 결과와 오류 분류
- HTTP 상태·타임아웃·비정상 숫자·형식 변경의 표준 매핑
- 기록된 fixture 기반 공급자 계약 테스트 지원
- 예약 작업의 대상별 성공·실패 집계
- 예약 시각별 시작 heartbeat, 실행 중 heartbeat, deadline·lease·checkpoint와 missing/overdue 감지
- 정기 거래 등 기능별 예약 Input Port의 사용자 접속과 독립된 cron 호출
- 재시도 가능성, 멱등 키, 실행 시간과 실패 범위 관측
- 최상위 예외의 실패 전파와 운영 지표
- Firebase Scheduled Function의 공급자 상태 점검, Cloud Logging 구조화 로그, Firestore 최신 Health 상태와 Cloud Monitoring 경보
- 공개 HTTP ingress의 인증·App Check·유한 입력/호출 한도와 안전한 외부 HTTP client 정책

### 제외

- 시장별 종목 검색·가격 평가 정책: [보유종목·시장 데이터 모듈](../../../contexts/portfolio/modules/holdings-market-data/requirements.md)
- 배당 이벤트 상태 전이: [배당 모듈](../../../contexts/portfolio/modules/dividends/requirements.md)
- 자산 스냅샷 계산: [자산 포트폴리오 모듈](../../../contexts/portfolio/modules/portfolio/requirements.md)
- 자동 납입·상환 업무 규칙: [자산 자동화 모듈](../../../contexts/portfolio/modules/asset-automation/requirements.md)
- Firebase·Next.js 런타임에 종속된 개별 진입점 외의 Domain 규칙

## 3. 소유 데이터

업무 Domain 컬렉션은 소유하지 않지만 다음 서버 전용 운영 상태를 소유합니다.

| 데이터 | 소유권과 불변식 |
|---|---|
| 외부 호출 결과 | 성공 값, 데이터 없음, 재시도 가능 실패, 영구 계약 실패, 잘못된 데이터를 구별하는 값 객체입니다. |
| job 실행 결과 | 실행 ID, 시작·종료 시각, 전체 대상 수, 성공·실패·건너뜀 범위, 재시도 가능 여부를 표현합니다. |
| 예약 실행 상태 | job별 예상 예약 시각, 시작·최근 heartbeat·deadline, 현재 lease와 checkpoint를 저장해 미시작·정체 실행을 구분합니다. |
| 운영 로그·지표 | 민감 원문을 포함하지 않고 공급자·작업·대상 범위·오류 분류를 구조화합니다. |
| ProviderHealthState | provider+operation별 마지막 시도·성공, 연속 실패, 실패 시작, 마지막 오류, 경보 상태의 최신 요약입니다. 가격·가구·보유수량은 저장하지 않습니다. |
| 공급자 fixture | 외부 HTML·JSON 형식의 계약 회귀 테스트 자료이며 사용자 금융 Domain 데이터가 아닙니다. |

## 4. 공개 계약·의존 모듈

### 공개 계약

- `ExternalResult<T> = Success<T> | NoData | RetryableFailure | ContractFailure | InvalidData`
- `JobExecutionResult = Complete | PartialFailure | Failed`
- `ExecuteWithRetry(operation, retryPolicy, idempotencyKey)`
- `RecordJobOutcome(jobName, scope, result)`
- `HeartbeatJobRun(runId, lease, checkpoint)`
- `DetectMissingOrOverdueRuns(asOf)`
- `RecordProviderAttempt(provider, operation, result, metadata)`
- `RecordProviderRunOutcome(provider, operation, executionKey, finalResult)`
- `GetProviderHealth(provider?, operation?)` — 관리자·운영 전용
- 공급자 Adapter 공통 메타데이터: 공급자, 요청 종류, 관측 시각, 응답 신선도

기능 모듈은 HTTP 응답이나 HTML parser를 직접 알지 않고 자신이 정의한 Provider port를 호출합니다. 이 모듈의 Adapter가 외부 형식을 기능 모듈 계약으로 변환합니다.

### 의존 모듈

- 주입된 HTTP client, Scheduler, Logger, Metrics, Clock
- 보유종목·시장 데이터 모듈의 시장별 Provider port
- 배당 모듈의 공시 Provider port
- 자산 자동화 및 기타 예약 Application handler

## 5. 요구사항

| ID | 상태 | 요구사항 | 경계·예외 | 근거 | 테스트 |
|---|---|---|---|---|---|
| JOB-ERR-001 | 결함 | 예약 작업 일부가 실패하면 성공으로 보고하지 않고 실패 범위와 재시도 가능성을 관측할 수 있어야 한다. | 시세 갱신은 DEC-049에 따라 전체 target 수를 제한하지 않고 50개 page·최대 병렬 5로 끝까지 처리한다. retryable 실패만 최대 2회 추가 재시도하며 현재 최상위 catch 후 success 반환은 요구사항으로 고정하지 않는다. | Functions scheduled jobs, [DEC-049](../../../governance/decisions.md#dec-049) | I, 운영 계약 |
| JOB-ERR-002 | 결함 | 각 예약 occurrence는 예상 시각, 시작·최근 heartbeat, deadline, lease, checkpoint와 최종 상태를 서버 전용 저장소에 남기고, grace 내 시작하지 않은 실행은 `Missing`, heartbeat·deadline이 지난 실행은 `Overdue`로 감지해야 한다. | 실행 함수 내부 로그만으로는 함수가 호출되지 않은 경우를 알 수 없다. lease 소유자만 heartbeat/checkpoint를 갱신하며 만료 lease만 takeover한다. Missing·Overdue 감지는 별도 monitor occurrence가 수행하고 장애·복구 경보를 남긴다. | Functions scheduled jobs | I, 동시성, 운영 계약 |
| EXT-001 | 결함 | 외부 공급자 Adapter는 성공, 데이터 없음, 일시 실패, 비정상 숫자, 형식 변경을 구분하고 시도별 구조화 로그와 공급자별 연속 실패·복구 상태를 남겨야 한다. | 현재 null·빈 배열·고정 금 시세 성공 응답 등으로 서로 다른 실패가 합쳐진다. HTML scraping은 fixture 계약 테스트와 관측 지표가 필요하다. Firebase Function이 Cloud Logging·Firestore Health 상태·Cloud Monitoring 경보를 연결한다. 장애 open·복구 resolve 이메일의 notification channel resource reference는 환경별 배포 config로 주입하며 이메일 주소를 소스나 업무 DB에 하드코딩하지 않는다. | Functions 외부 공급자 Adapter, [DEC-018](../../../governance/decisions.md#dec-018) | C, I, 운영 계약 |
| EXT-002 | 결함 | 인터넷에 노출되는 HTTP Function·API Route는 호출 유형에 맞는 Firebase Auth·service account 또는 만료·폐기 가능한 scoped credential을 검증하고, 지원 앱 호출에는 App Check를 추가 검증해야 한다. | 시세 전체 갱신은 같은 가구·범위를 single-flight로 합치고 같은 actor·가구·범위에서 30초에 한 번만 새 외부 호출을 시작한다. 사용자 전체 종목 수는 제한하지 않고 내부 50개 page로 처리한다. 그 밖의 body·field·period 상한과 credential·IP 비용 quota도 Application 호출 전에 적용한다. | 인증된 Household Query·HTTP Functions, [DEC-049](../../../governance/decisions.md#dec-049) | C, I, 보안 E2E |
| EXT-003 | 결함 | 모든 외부 HTTP Adapter는 공통 `SafeExternalHttpClient`를 통해 HTTPS와 provider별 host/port allowlist, redirect 목적지 재검증, 요청 timeout, 최대 응답 byte를 강제해야 한다. | 시세 Provider는 한 refresh run에서 최대 5개 동시 호출, 요청당 10초 timeout, retryable 결과의 최대 2회 추가 재시도를 강제한다. 사용자 입력 전체 URL, HTTP downgrade, allowlist 밖 redirect, 무제한 응답 stream을 허용하지 않는다. | Functions 외부 공급자 Adapter, [DEC-049](../../../governance/decisions.md#dec-049) | U, C, 보안 I |

## 6. 모듈 결함

- 예약 작업의 최상위 `catch`가 내부 실패 후에도 성공을 반환하여 재시도와 경보가 동작할 근거를 잃습니다. (`JOB-ERR-001`)
- Firestore·외부 API 실패를 빈 목록, `null`, 0 또는 고정 추정값으로 바꾸어 데이터 없음과 장애를 구분하지 못합니다. (`EXT-001`)
- HTML scraping 형식 변경을 명시적 계약 실패로 분류하고 관측할 공통 규칙이 없습니다. (`EXT-001`)
- 다중 대상 job의 일부만 성공했을 때 완료 범위와 실패 범위를 구조적으로 반환하지 않습니다. (`JOB-ERR-001`)
- 예약 함수가 아예 시작되지 않거나 실행 중 멈추면 이를 검출할 독립 heartbeat·missing/overdue 상태가 없습니다. (`JOB-ERR-002`)
- Web Route의 로컬 `console.error`만으로는 공급자 장애의 지속 여부와 복구를 알 수 없고 배포 위치마다 로그가 갈라집니다. (`EXT-001`, `MARKET-004`)
- 일부 공개 API는 CORS·정적 token 또는 요청값에 의존하고 요청 크기·기간·대상 수·호출량의 유한 상한이 없습니다. (`EXT-002`)
- 외부 URL·redirect·응답 크기·timeout의 공통 강제 경계가 없어 Adapter별로 SSRF·resource exhaustion 방어 수준이 달라질 수 있습니다. (`EXT-003`)

## 7. 관련 DEC

- [DEC-009](../../../governance/decisions.md#dec-009)에 따라 정기 거래 공개 Port를 `Asia/Seoul` 기준 매일 00:00에 호출하고 실패·누락 page checkpoint를 자동 재개합니다. 어떤 월을 생성할지는 Recurring이 결정합니다.
- [DEC-018](../../../governance/decisions.md#dec-018)에 따라 Firebase Scheduled Function을 시세 Provider 관측의 기준점으로 사용하고, 마지막 정상 시세 사용과 별개로 시도별 로그·최신 Health 상태·연속 실패 경보를 남깁니다.
- [DEC-046](../../../governance/decisions.md#dec-046)에 따라 완료 JobRun·target receipt는 30일 보존하고 unresolved run·dead letter는 해결 전까지 삭제하지 않으며, 해결 뒤 30일을 적용합니다.
- [DEC-049](../../../governance/decisions.md#dec-049)에 따라 시세 전체 갱신은 전체 target 수를 제한하지 않고 내부 page 50, 병렬 5, timeout 10초, retryable 총 3회, 30초 single-flight window로 실행합니다.
- [DEC-052](../../../governance/decisions.md#dec-052)에 따라 자산 자동화 공개 Port를 매일 00:00에 호출합니다. 어떤 Plan·월을 처리하고 `nextDueDate`를 언제 전진할지는 Automation이 결정하며 이 모듈은 occurrence·checkpoint·실패·재시도만 관리합니다.
- [DEC-060](../../../governance/decisions.md#dec-060)에 따라 환율 외부 호출은 Frankfurter v2 host만 허용하고, Operations는 보조 공급자 선택 없이 retry·Health·이메일 경보만 담당합니다. 마지막 성공 환율의 사용 가능 여부와 저장은 Holdings가 소유합니다.
- 기준일 job 복구와 같은 기능별 정책은 각 모듈 DEC를 따르며, 이 모듈은 실패·재시도 사실만 보존합니다.

## 8. 모듈 테스트 시나리오

### Canonical 테스트

| 테스트 ID | 종류 | Given / When / Then | 연결 요구사항 |
|---|---|---|---|
| T-JOB-001 | 목표 | 미국 종목·isActive 누락 자산·101개 target·중간 공급자 실패 / job / 시장별 처리, 50개 page 완주, 최대 병렬 5와 일관된 부분 실패 결과 | MARKET-002, JOB-AST-001, JOB-AST-003, JOB-ERR-001, DEC-049 |
| T-JOB-002 | 목표 | 예약 시각 미시작, 실행 중 heartbeat 정지, lease 경합·만료 takeover, page 완료 뒤 재개 / monitor·runner / Missing·Overdue 경보와 checkpoint 이후 한 번만 처리 | JOB-ERR-002 |
| T-EXT-002 | 목표 | 무인증·removed actor·잘못된 App Check·비허용 CORS origin, 유효/만료/폐기/scope 누락 credential·service account, credential/IP quota, 101개 시세 target·30초 내 중복 / 공개 API 호출 / 모든 선검증 실패는 Application 미호출, route별 검증 context만 생성하고 전체 target은 내부 page 처리하며 중복은 같은 run 재사용 | EXT-002, DEC-049 |
| T-EXT-003 | 목표 | HTTP URL·provider별 host/비허용 port·다른 provider host·외부 redirect·redirect loop/hop 초과·10초 timeout·429·5xx·초과 응답 / Provider 호출 / 매 hop에서 같은 provider ACL을 재검증하고 최대 병렬 5, retryable만 총 3회, 나머지는 bounded security/contract 결과로 제한 | EXT-003, DEC-049 |
| T-EXT-004 | 목표 | 유효 0원·명시적 부재·timeout·408·429·5xx·401·403·schema drift·NaN·Infinity와 금 공급자 실패 / 결과 매핑·재시도 / Success·NoData·Retryable·Contract·Invalid를 구분하고 retryable만 최대 3회 호출하며 가짜 금 시세 성공은 없음 | EXT-001 |

### 상세 시나리오

| 시나리오 | 수준 | 연결 요구사항 |
|---|---|---|
| 공급자가 정상 값을 반환하면 `Success`, 정상 응답에 데이터가 없으면 `NoData`로 구분한다. | C | EXT-001 |
| 타임아웃·429·5xx는 재시도 가능 실패로, 비정상 숫자는 잘못된 데이터로, HTML selector 변경은 계약 실패로 분류한다. | U, C | EXT-001 |
| 금 시세 공급자 실패가 고정 가격의 성공 값으로 변환되지 않는다. | C, I | EXT-001 |
| 금·주식 Provider의 contract/invalid 실패는 첫 시도에, retryable·예상 밖 NoData는 예약 갱신 3회째에 경보하고 다음 성공 시 Health 상태와 경보를 복구한다. | C, I, 운영 계약 | EXT-001, MARKET-004, DEC-018 |
| Frankfurter USD/KRW 정상·timeout·429·schema drift·잘못된 base/quote/rate/date / 외부 호출·Health 기록 / 허용 host 하나만 호출하고 실패 시 보조 Provider를 부르지 않으며 즉시·연속 실패 경보와 성공 복구가 적용된다. | C, I, 운영 계약 | EXT-001, EXT-003, MARKET-006, DEC-060 |
| 구조화 로그와 ProviderHealthState에 API key·응답 원문·가구 ID·보유수량이 없고 관리자만 Health Query를 호출한다. | C, Rules | EXT-001, MARKET-004, DEC-018 |
| 기록된 Naver·Nasdaq·Upbit·KIND fixture로 정상·빈 결과·형식 변경 계약을 검증한다. | C | EXT-001 |
| 대상 10개 중 2개가 실패하면 job 결과는 `PartialFailure`이고 실패 대상과 재시도 가능성을 포함한다. | I | JOB-ERR-001 |
| 최상위 예외가 발생하면 Scheduler 진입점이 성공을 반환하지 않고 실패 결과와 구조화 로그를 남긴다. | I | JOB-ERR-001 |
| 같은 멱등 키로 재시도했을 때 이미 완료한 대상은 중복 반영하지 않고 실패 대상만 수렴시킨다. | I | JOB-ERR-001 |
| 완료 JobRun·receipt는 terminalAt+30일 `expiresAt`을 갖고 unresolved run·dead letter는 만료되지 않으며 해결 뒤에만 30일 TTL이 시작된다. | I, 운영 계약 | JOB-ERR-001, JOB-ERR-002, DEC-046 |
| 사용자가 접속하지 않아도 일일 정기 거래 job이 실행되고, 7·8월 누락 target이 있으면 checkpoint를 따라 처리한 뒤 재실행에도 중복 생성하지 않는다. | I, E2E | JOB-ERR-001, REC-002, REC-003 |
| 자산 자동화 3월 18일 occurrence와 19일 재실패 뒤 20일 실행 / due-plan page와 checkpoint 재개 / 성공 전 nextDueDate가 유지되고 3월 execution·잔액 변경은 최종 한 번만 반영 | I, E2E, 운영 계약 | JOB-ERR-001, JOB-ERR-002, AUTO-003, DEC-052 |
| 예약 occurrence가 grace 안에 시작되지 않으면 Missing, 시작 후 heartbeat·deadline이 지나면 Overdue이며 다음 정상 occurrence에서 복구 경보를 남긴다. | I, 운영 계약 | JOB-ERR-002 |
| lease owner만 heartbeat와 checkpoint를 갱신하고 만료 takeover 뒤에도 완료 target은 다시 업무 반영하지 않는다. | I, 동시성 | JOB-ERR-002 |
| CORS 허용 origin에서 호출해도 인증·App Check가 없으면 거부하고 body·page·기간·대상·호출량 한도를 넘으면 기능 Port를 호출하지 않는다. | C, I, 보안 E2E | EXT-002 |
| 외부 HTTP는 HTTPS allowlist 밖 직접 URL·redirect를 거부하고 timeout과 최대 응답 byte를 초과하면 bounded 실패로 끝난다. | U, C, 보안 I | EXT-003 |
| 장애 open과 복구 resolve 이메일은 배포 config의 notification channel로 전달되며 주소 literal이 소스·Firestore·일반 로그에 나타나지 않는다. | C, 운영 계약 | EXT-001 |

## 9. 코드 근거

- [자산 평가 예약 작업](../../../../../functions/src/bootstrap/firebaseAssetValuationScheduledJob.ts)
- [배당 예약 작업](../../../../../functions/src/bootstrap/firebaseDividendScheduledJob.ts)
- [시세 공급자 Adapter](../../../../../functions/src/adapters/firebase/portfolio/firebasePortfolioMarketData.ts)
- [종목 Catalog Adapter](../../../../../functions/src/adapters/firebase/portfolio/firebaseInstrumentCatalog.ts)
- [종목 검색 Adapter](../../../../../functions/src/adapters/firebase/portfolio/firebasePortfolioInstrumentSearch.ts)
- [인증된 Portfolio Query 경계](../../../../../functions/src/bootstrap/queries/portfolioMarketHouseholdQueryHandlers.ts)
- [Web Portfolio Query Client](../../../../../web/src/features/portfolio/application/portfolioQueries.ts)
- [배당 저장 API](../../../../../web/src/app/api/dividend/save/route.ts)
