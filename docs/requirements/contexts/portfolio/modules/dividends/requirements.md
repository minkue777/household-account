# 배당 모듈 요구사항

> 상위 Bounded Context: [Portfolio](../../requirements.md)  
> 아키텍처 역할: Domain / Projection  
> 상세 설계: [모듈 상세 설계](design.md)  
> 상태와 테스트 표기 규칙은 [공통 요구사항 규약](../../../../governance/conventions.md)을 따릅니다.  
> 이 문서는 `DIV-*`, `JOB-DIV-*` 요구사항의 단일 소유 문서입니다.

## 1. 독립 모듈 책임

배당 모듈은 보유종목의 배당 공시를 가구별 배당 이벤트로 변환하고, 발표·확정·지급 상태 전이와 연도별 12개월 합계를 소유합니다. 이벤트가 배당의 원천 데이터이고 연간 스냅샷은 이벤트에서 재생성할 수 있는 파생 조회 모델입니다.

KIND HTML 구조, Firebase Scheduler, React 차트는 모듈 내부 업무 규칙이 아닙니다. 공시 Adapter와 저장소·시계 포트를 통해 분리합니다.

## 2. 포함/제외 범위

### 포함

- 국내 ETF 분배 공시를 내부 배당 공시 계약으로 변환
- 가구·공급자·안정적인 공급자 공시 ID 기반의 결정적 이벤트 식별
- 발표(`announced`)에서 확정(`fixed`), 지급(`paid`)으로의 상태 전이
- 기준일 적격 보유수량과 총 배당액 계산
- 연도별 월 합계와 이벤트 조회
- 기준일 전 예상 배당 표시와 확정 이벤트 중복 제외
- 매일 수행되는 배당 갱신 Application job

### 제외

- 주식 보유종목 CRUD와 일반 시세: [보유종목·시장 데이터 모듈](../holdings-market-data/requirements.md)
- 자산 계정과 총자산 스냅샷: [자산 포트폴리오 모듈](../portfolio/requirements.md)
- KIND HTTP·HTML 재시도와 공통 장애 관측: [외부 운영 모듈](../../../../supporting-platform/modules/external-operations/requirements.md)
- 차트의 일반 기간 선택·표현: [통계 모듈](../../../../supporting-platform/modules/reporting/requirements.md)
- 세금·외화 환산·실제 증권사 입금 대사

## 3. 소유 데이터

| 데이터 | 소유권과 불변식 |
|---|---|
| `dividend_events` | 배당의 원천 데이터이며 배당 모듈만 씁니다. 결정적 ID로 재실행 중복을 방지합니다. |
| `dividend_snapshots` | `(householdId, year)`별 12개월 합계와 조회용 이벤트 맵입니다. 이벤트에서 재구축할 수 있는 파생 데이터입니다. |
| 적격 수량 | 기준일의 보유수량입니다. 현재 보유수량과 구분하며 기준일을 놓친 경우의 복구 정책이 필요합니다. |

`stock_holdings`는 읽기 의존 데이터이며 배당 모듈이 직접 수정하지 않습니다. 인증 없는 Web 저장 경로와 dormant 저장 함수는 단일 Writer 원칙에 포함되지 않습니다.

## 4. 공개 계약·의존 모듈

### 공개 계약

- `CollectDividendDisclosures(period)`
- `UpsertDividendAnnouncement(disclosure, householdHolding)`
- `AdvanceDividendStatus(event, asOf, eligibleQuantity?)`
- `RebuildAnnualDividendSnapshot(householdId, year)`
- `QueryDividendSnapshot(householdId, year)`
- `QueryDividendEvents(householdId, year)`
- `EstimateUpcomingDividends(holdings, announcements, confirmedEvents)`

### 의존 모듈

- 보유종목·시장 데이터 모듈: 가구별 추적 종목과 기준일 보유 이력 조회
- 가구 모듈: `householdId` 범위
- 외부 운영 모듈: KIND Adapter, 실행 결과·재시도·관측
- 주입된 `Clock`: `Asia/Seoul` 기준일과 지급일 판정

## 5. 요구사항

| ID | 상태 | 요구사항 | 경계·예외 | 근거 | 테스트 |
|---|---|---|---|---|---|
| DIV-001 | 현재 명세 | 연도별 확정 배당을 12개월 합계와 개별 이벤트로 조회한다. | 월 배열은 12개로 정규화한다. 기존 DividendEvent와 Annual Projection은 가구 금융 이력으로 유지하며 원천 Asset의 논리·영구 삭제로 변경하지 않는다. | [assetService](../../../../../../web/src/lib/assetService.ts), [AssetDividendChart](../../../../../../web/src/components/assets/AssetDividendChart.tsx), [DEC-017](../../../../governance/decisions.md#dec-017) | U, I, E2E |
| DIV-002 | 현재 명세 | 발표 상태이고 기준일 전인 배당은 현재 보유수량과 주당배당으로 예상액을 표시한다. | 같은 Canonical `eventId`의 fixed·paid 이벤트가 있으면 예상에서 제외한다. 코드·지급일·주당금액의 우연한 일치만으로 서로 다른 공시를 합치지 않는다. | [AssetDividendChart](../../../../../../web/src/components/assets/AssetDividendChart.tsx), [DEC-043](../../../../governance/decisions.md#dec-043) | U, I |
| DIV-003 | 현재 명세 | 기준일 당일 보유수량과 totalAmount를 계산해 fixed로 전환하고, 지급일 당일부터 paid로 전환한다. 연간 스냅샷에는 fixed와 paid를 모두 지급 월에 포함한다. | 이벤트 ID는 정정될 수 있는 금액·날짜가 아니라 안정적인 공급자 공시 ID로 결정해 같은 공시가 항상 같은 문서를 가리켜야 한다. | [배당 예약 작업](../../../../../../functions/src/bootstrap/firebaseDividendScheduledJob.ts), [DEC-043](../../../../governance/decisions.md#dec-043) | U, I |
| DIV-004 | 결함 | dividend_snapshots의 월 합계와 내장 events는 서로 다른 저장 경로에서 덮어쓰거나 불일치하면 안 된다. | Projection의 `events` map key는 반드시 Canonical `eventId`여야 하며 종목 코드·지급일·주당금액을 다시 조합한 별도 key를 사용하지 않는다. Canonical Event와 Projection의 활성 Writer는 Functions 배당 Application 하나이며 Web 저장 API는 두지 않는다. | [배당 예약 작업](../../../../../../functions/src/bootstrap/firebaseDividendScheduledJob.ts) | I |
| DIV-005 | 결함 | 기준일 당일 job 실패나 지연 공시가 있어도 기준일과 가장 가까운 보유 snapshot으로 적격 수량을 자동 복구해야 한다. | 정확한 기준일 snapshot을 우선하고, 없으면 날짜 차이가 최소인 snapshot을 사용하며 동률이면 기준일 이전을 우선한다. snapshot이 전혀 없거나 조회 실패이면 0으로 바꾸지 않는다. 추정 여부는 화면에 별도 표시하지 않는다. | [배당 예약 작업](../../../../../../functions/src/bootstrap/firebaseDividendScheduledJob.ts), [DEC-014](../../../../governance/decisions.md#dec-014) | U, I |
| DIV-006 | 결함 | 이미 저장된 `announced`·`fixed` 이벤트의 상태 진행과 최신 공시 반영은 당일 신규 discovery 결과와 분리해 각 시간별 예약 occurrence에서 독립적으로 처리해야 한다. | 기존 nonterminal Event는 모든 source Asset·Holding이 삭제되어도 저장된 Event와 Position history로 `announced → fixed → paid`를 진행한다. 같은 공시의 정정은 미지급 Event의 현재 값만 덮어쓰고 이전 값은 보관하지 않으며, 기준일·금액 변경 시 적격 수량·증거·총액을 원자 재계산한다. 지급 전 명시적 취소·삭제는 Event와 Projection에서 제거하고 `NoData`·실패는 삭제 근거로 쓰지 않는다. `paid`는 이후 정정·취소에도 불변이다. [DEC-062](../../../../governance/decisions.md#dec-062) | [배당 예약 작업](../../../../../../functions/src/bootstrap/firebaseDividendScheduledJob.ts), [DEC-017](../../../../governance/decisions.md#dec-017), [DEC-043](../../../../governance/decisions.md#dec-043) | U, I |
| JOB-DIV-001 | 목표 명세 | 매일 09:00부터 20:00까지 `Asia/Seoul` 매시 정각에 최근 1년 범위의 국내 ETF 분배 공시를 수집하고 기존 nonterminal Event 상태를 전이해 가구·종목별 이벤트와 연간 Projection을 갱신한다. | cron은 `0 9-20 * * *`이며 하루 12회 실행한다. 같은 날 반복 수집·상태 전이는 결정적 Event ID와 execution으로 중복 반영하지 않는다. 20:00 이후 공시는 다음 날 09:00에 수집한다. [DEC-062](../../../../governance/decisions.md#dec-062) | [배당 예약 작업](../../../../../../functions/src/bootstrap/firebaseDividendScheduledJob.ts) | U, I, 운영 계약 |
| JOB-DIV-002 | 결함 | 공시 discovery 대상은 Instrument Master 또는 Holdings 공개 Query가 `market=KRX`, `instrumentType=ETF`로 명시 분류한 활성 보유종목으로 제한해야 한다. | `holdingType=stock`이고 코드가 영숫자라는 사실만으로 국내 ETF로 추정하지 않는다. 국내 개별주식·미국주식·코인·실물 금과 분류 미확정 종목은 KIND ETF discovery에 보내지 않는다. | [배당 예약 작업](../../../../../../functions/src/bootstrap/firebaseDividendScheduledJob.ts) | U, C, I |

## 6. 모듈 결함

- `dividend_snapshots`에 Functions, 인증 없는 Web API와 dormant 서비스라는 여러 저장 경로가 있어 월 합계와 내장 이벤트가 서로 덮어써질 수 있습니다. (`DIV-004`)
- 기준일 당일 job을 놓치면 적격 수량을 복구하지 못해 이벤트가 `announced`에 영구 정체될 수 있습니다. (`DIV-005`)
- 현재 job은 공시에서 다시 발견한 현재 Holding의 Event만 상태 전이하므로 Holding 삭제·Provider NoData 뒤 기존 `fixed` Event가 `paid`에 도달하지 못할 수 있습니다. (`DIV-006`)
- 현재 대상 판정은 모든 `stock` 보유와 영숫자 코드를 사실상 국내 ETF로 취급해 KIND에 전달하며 명시적인 시장·상품 분류가 없습니다. (`JOB-DIV-002`)
- 인증 없는 배당 저장 API가 임의 가구·연도·월의 스냅샷을 덮어쓸 수 있습니다. (`DIV-004`)
- 예약 작업 내부 실패를 성공으로 반환하는 운영 결함은 [외부 운영 모듈](../../../../supporting-platform/modules/external-operations/requirements.md)의 `JOB-ERR-001`로 교정해야 합니다.

## 7. 관련 DEC

- [DEC-014](../../../../governance/decisions.md#dec-014): 기준일과 가장 가까운 보유 snapshot을 사용하고 날짜 차이가 같으면 기준일 이전 데이터를 우선합니다.
- [DEC-017](../../../../governance/decisions.md#dec-017): deleted Asset은 신규 배당 처리 대상에서 제외하지만 기존 DividendEvent·Annual Projection은 보존합니다. Asset 영구 purge도 배당 이력을 수정·재계산·삭제하지 않으며 paid 배당은 계속 조회합니다.
- [DEC-043](../../../../governance/decisions.md#dec-043): 같은 공시의 미지급 Event는 최신 값으로 덮어쓰고 이전 공시 값은 보관하지 않습니다. 지급 전 명시적 취소는 제거하지만 공급자 실패로 삭제하지 않으며 paid Event는 불변으로 유지합니다.
- [DEC-062](../../../../governance/decisions.md#dec-062): 배당 discovery와 lifecycle sweep을 매일 09:00~20:00 매시 정각 실행하고 시간별 execution key로 중복 반영을 막습니다.

## 8. 모듈 테스트 시나리오

### Canonical 테스트

| 테스트 ID | 종류 | Given / When / Then | 연결 요구사항 |
|---|---|---|---|
| T-DIV-001 | 목표 | 기준일 10일 job 실패, 9일·11일 snapshot / 다음 실행 / 9일 수량으로 fixed 전이 | DIV-005, DEC-014 |
| T-DIV-002 | 목표 | KRX ETF·국내 개별주식·미국주식·분류 미확정 stock 보유 / discovery 대상 계산 / 명시 분류된 KRX ETF만 KIND 조회 | JOB-DIV-002 |
| T-DIV-003 | 목표 | 모든 source Asset이 사라진 nonterminal Event, 같은 공시의 정정·명시적 취소, Provider NoData, paid 뒤 정정 / 시간별 lifecycle sweep / announced는 Position history로 fixed, fixed는 paid, 미지급 정정은 같은 Event 덮어쓰기·이전 값 미보관, 미지급 취소는 제거, NoData와 paid 정정은 무변경 | DIV-006, DIV-005, DEC-017, DEC-043, DEC-062 |
| T-DIV-004 | 목표 | 10개월·비정상 legacy 월 배열과 정상 12개월 canonical Event map / 연간 배당 조회 / legacy는 12개월 0원 보정과 stale 상태로 읽고 정상 map은 eventId 합계와 월 합계를 일치시킴 | DIV-001, DIV-004 |
| T-DIV-005 | 목표 | 기준일 전 announced Event와 현재 수량, 같은 canonical ID의 fixed·paid, Holdings 실패 / 예정 배당 조회 / 현재 수량으로 예상하고 확정 Event만 제외하며 원천 실패를 빈 성공으로 바꾸지 않음 | DIV-002 |
| T-DIV-006 | 목표 | 기준일·지급일 경계, 소수 수량, 같은 공시 반복, paid 역전 요청 / 배당 상태 전이 / announced→fixed→paid 순서와 원 단위 총액을 보장하고 반복은 Event 하나, 역전은 Conflict | DIV-003 |
| T-DIV-007 | 목표·아키텍처 | 같은 Event 중복·version gap·역순·미인증 직접 overwrite·stale projection / 연간 배당 Projection 갱신 / 단일 Writer만 eventId 한 건과 월 합계를 갱신하고 gap은 rebuild를 요구하며 직접 overwrite는 거부 | DIV-004, DIV-006 |
| T-JOB-DIV-001 | 목표 | 09:00·20:00 경계와 17:30 신규 공시, instrument별 성공·timeout, 같은 occurrence 재실행 / 배당 예약 갱신 / 서울 09~20시 매시 실행하고 17:30 공시는 18시에 수집하며 부분 실패 범위와 멱등 Projection을 보장 | JOB-DIV-001, DEC-062 |

### 상세 시나리오

| 시나리오 | 수준 | 연결 요구사항 |
|---|---|---|
| 월 데이터가 짧거나 비정상 값을 포함해도 0으로 보정된 12개월 배열을 반환한다. | U | DIV-001 |
| paid 배당이 있는 원천 Asset을 논리 삭제하거나 영구 purge해도 기존 이벤트와 해당 월·연간 합계가 동일하다. | I, E2E | DIV-001, AST-006, DEC-017 |
| 발표 상태이고 기준일 전인 이벤트는 현재 보유수량으로 예상하며 동일 확정 이벤트가 있으면 제외한다. | U | DIV-002 |
| 기준일 당일 수량을 고정해 총액을 계산하고 지급일부터 `paid`로 전환한다. | U, I | DIV-003 |
| 같은 안정 공시 ID는 반복 수집과 지급 전 정정 뒤에도 같은 이벤트 문서 하나만 존재하며, 정정 전 값이나 별도 revision Event는 남지 않는다. | U, I | DIV-003, DIV-006, JOB-DIV-001, DEC-043 |
| `fixed`와 `paid` 이벤트만 지급 월 합계에 포함하고 Canonical eventId를 key로 한 이벤트 합계와 스냅샷 월 합계가 일치한다. | U, I | DIV-001, DIV-003, DIV-004 |
| 모든 배당 쓰기가 단일 Application 명령을 거치며 별도 API가 스냅샷을 직접 덮어쓰지 못한다. | I | DIV-004 |
| 기준일 snapshot이 없으면 날짜 차이가 가장 작은 snapshot을 선택하고, 9일·11일 동률이면 9일 수량으로 복구한다. | U, I | DIV-005 |
| 최근 1년 KIND fixture를 두 번 처리해도 이벤트와 스냅샷 결과가 동일하다. | C, I | JOB-DIV-001 |
| discovery는 명시 분류된 KRX ETF만 조회하고 분류가 없거나 다른 시장·상품인 보유종목은 추정해 포함하지 않는다. | U, C, I | JOB-DIV-002 |
| lifecycle sweep은 discovery 결과와 별도로 `announced`·`fixed` Event를 page 처리한다. 모든 source 삭제 뒤에도 상태를 진행하고, 명시적 취소만 미지급 Event를 제거하며, 공급자 실패와 paid 뒤 정정·취소는 기존 기록을 변경하지 않는다. | U, I | DIV-006, DEC-043 |

## 9. 코드 근거

- [배당 이벤트·스냅샷 Web 서비스](../../../../../../web/src/lib/assetService.ts)
- [배당 차트와 예상액 계산](../../../../../../web/src/components/assets/AssetDividendChart.tsx)
- [배당 예약 작업](../../../../../../functions/src/bootstrap/firebaseDividendScheduledJob.ts)
- [인증 없는 배당 저장 API](../../../../../../web/src/app/api/dividend/save/route.ts)
