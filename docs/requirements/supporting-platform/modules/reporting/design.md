# 통계 모듈 상세 설계

> 요구사항: [통계 모듈 요구사항](requirements.md)  
> 상위 지도: [지원·읽기·플랫폼 영역](../../requirements.md)  
> 정비 기록: [실제 통계·배당 계약](../../../../operations/reporting-runtime-simplicity-2026-10-05.md)

## 1. 설계 목적과 추적성

STAT-001~006, STAT-AST-001~003을 대상으로 현재 실행 경로와 목표 명세를 구분합니다. 통계는 거래·카테고리·자산 원본을 소유하지 않습니다. 지출 편집·삭제는 Ledger 명령, 가맹점 규칙 저장은 Payment Configuration 명령으로 처리합니다.

2026-10-05: Web에서 호출하지 않는 Functions Reporting controller/query/model과 포트폴리오 대체 계산을 제거했습니다. 동일 기능의 두 구현을 유지하지 않습니다. 아래 경로가 실제 실행 경로이며 서버 Reporting Query를 별도로 도입하지 않습니다.

## 2. 모듈 경계와 책임

| 책임 | 실제 구현 |
|---|---|
| 지출·자산 기간 | [statisticsPeriod](../../../../../web/src/features/reporting/statisticsPeriod.ts) |
| 지출 원천 조회 | [expenseStatisticsReadModel](../../../../../web/src/platform/reporting/expenseStatisticsReadModel.ts) |
| 지출 캐시·확정 변경 반영 | [expenseStatisticsCache](../../../../../web/src/platform/reporting/expenseStatisticsCache.ts) |
| 지출 화면·상세 변경 | [통계 화면](../../../../../web/src/app/stats/page.tsx), Ledger·Payment Configuration 명령 |
| 자산 원천·baseline | [assetStatisticsReadModel](../../../../../web/src/platform/reporting/assetStatisticsReadModel.ts) |
| 자산 추이·배당 표시 | [자산 통계 화면](../../../../../web/src/app/assets/stats/page.tsx) |

Firebase Rules는 사용자·가구 읽기 범위를 검증합니다. 조회 adapter는 canonical 문서를 해석하고 전체 페이지가 완료되어야 화면에 반환합니다. 통계용 별도 영속 Projection은 만들지 않습니다. Portfolio 일별 Snapshot과 배당 Projection의 Writer는 각 소유 모듈에 있습니다.

## 3. 공개 계약

화면은 실제 조회 함수와 typed SDK adapter를 사용합니다. SDK 전체를 모사하는 범용 Reporting Port나 별도 서버 상태기계는 두지 않습니다. 성공한 0원, 빈 결과, 조회 실패를 구별하고 조회 실패를 빈 성공으로 대체하지 않습니다. 사용자 지정 역전 기간은 조회 전에 거부합니다.

## 4. 조회 모델과 불변식

- 날짜 기준은 Asia/Seoul입니다. 지출 3/6/12개월·완전한 사용자 지정 범위를 월 경계로 계산하며 불완전한 사용자 입력은 12개월로 대체합니다. 자산은 3/6/12개월 또는 실제 이력 전체를 사용하며 ALL에 임의 시작 연도를 넣지 않습니다.
- 지출 조회는 활성 expense만 반환합니다. 총액·카테고리 비중·월별 추이는 같은 원본을 사용하고 빈 월은 0 bucket을 유지합니다.
- 초기 추이 선택은 비동기 카테고리·예산을 기다립니다. 화면 내 토글은 기간 변경 중 보존하고 가구 변경 시 초기화합니다.
- 자산 이력은 최초 유효일·시작일 이전 baseline·0원을 보존하며 gap에 직전 성공값을 이어 표시합니다. 현재 자산이 삭제되었다고 과거 이력 dimension을 버리지 않습니다.
- 일별 증감 상세는 change===0인 행만 숨깁니다. 차트 원천·월별 집계·유효한 0원은 유지합니다.

## 5. 실행 흐름

지출은 actor/가구/기간/원격 revision으로 조회를 식별합니다. 캐시가 있으면 먼저 표시하고 서버 재검증을 합니다. 수정·삭제의 확정 응답은 기존 predecessor와 revision이 맞는 범위에 적용하며 그렇지 않으면 재조회합니다. 실패 시 편집 초안·선택 기간·기존 결과를 보존하고 오류를 안내합니다.

자산 이력은 같은 세션의 완성된 원본을 재사용하며 기간 변경은 메모리에서 처리합니다. 재진입·앱 복귀는 캐시를 즉시 표시한 뒤 서버를 확인합니다. 캐시는 Actor·원격 epoch·조회 종료일에 해당하는 마지막 완료 이력과 진행 요청 하나를 보관합니다. 모든 조회는 서버를 재확인하며 진행 중인 요청만 공유하므로 TTL·강제 갱신 옵션·범용 다중 쿼리 캐시는 두지 않습니다. 실패 시 완료값을 보존하고, 캐시 무효화·세션·epoch 변경 후 이전 요청은 결과 게시와 후속 page 조회를 중단합니다.

화면 원천 key에는 Actor·가구·원격 epoch·조회 종료일만 포함하고, 자산 변경 revision은 재조회 trigger로 사용합니다. 같은 key의 완료 이력과 확인된 현재 자산은 revision 변경 중에도 유지하며 늦은 이전 요청은 effect cleanup에서 폐기합니다. 증감 차트는 전체 이력을 필수 입력으로 받아 계산·표시만 담당합니다. 별도 조회·실패·재시도 경로를 두지 않습니다.

전체·금융·유형별 추이는 동일한 시리즈 구조로 계산합니다. 서버 읽기가 날짜순·같은 날짜의 중복 제거를 보장하며, 화면은 이력을 한 번 시리즈별로 분류하여 이 순서를 그대로 사용합니다. 각 시리즈의 전체 이력에 확인된 오늘 잔액을 한 번 합성한 뒤, 상단 추이는 선택 기간과 직전 baseline으로 잘라 사용하고 증감 차트는 전체 이력으로 독립적인 월·연도 탐색을 유지합니다. 현재 잔액을 확인하지 못하면 오늘 0원 지점을 만들지 않습니다. 전체 잔액 합성은 이력·합계·확정 여부·날짜·금융 모드에만 의존하여 이름 변경이나 합계가 같은 유형 재분배로 증감 차트 입력을 새로 만들지 않습니다. 과거 이력이나 현재 자산에 실제 존재하는 유형만 선택 목록에 포함하며, 합계 시리즈와 유형 시리즈는 같은 날짜·carry-forward·dataset 생성 경로를 사용합니다.

배당 카드는 세션 확인 직후 mount하여 이력 조회와 병렬로 세 원천을 읽고, 이력 표시가 준비되기 전에는 DOM을 표시하지 않습니다. 숨겨진 동안의 focus·visibility 재조회도 억제하며, 카드 표시 전환 자체는 재조회 사유가 아닙니다. 선택 연도와 조회 수명은 카드가 소유하므로 부모의 Promise 선조회·전달·소비 상태가 필요하지 않습니다. 자산 변경 revision은 선택 연도만 재조회하고 같은 연도의 완료값·canvas·선택을 보존합니다. Actor·원격 epoch 변경은 카드를 교체하며, 연도 전환은 이전 연도 값을 즉시 숨깁니다. 내용이 같은 응답은 기존 데이터 참조를 유지합니다.

배당 월별 합계는 snapshot.monthlyData의 확정액을 기준으로 예상액을 누적합니다. 상세 events의 재합산으로 확정액을 대체하지 않습니다. 확정·예상 상세를 합친 뒤 선택 월·연도를 한 번 필터링하며, 지급일 내림차순·확정 우선·종목명 순서를 보존합니다.

## 6. 외부 의존성과 저장 경계

단발 서버 조회는 firestoreServerReadModel을 사용합니다. 실제 SDK 인증·Rules·cursor를 유지하며 화면이 Firestore commit을 직접 대신하지 않습니다. 지출/자산 각 원천에 50,000건 상한이 있고 반복 cursor·후속 page 실패·세션 변경은 불완전 합계 대신 실패로 종료합니다.

## 7. 저장·트랜잭션·동시성

통계 자체에는 쓰기 트랜잭션이 없습니다. Ledger와 Payment Configuration이 version·receipt·Outbox를 원자적으로 저장합니다. 화면 변경과 통계 재조회를 하나의 가상 트랜잭션으로 만들지 않습니다. 이전 actor/filter/revision의 늦은 응답은 현재 화면·캐시에 적용하지 않습니다.

## 8. Event·조회 연동

지출 통계만을 위한 Event consumer·Inbox·Projector는 두지 않습니다. 서버 확정 응답과 세션 무효화 이벤트가 같은 읽기 모델을 갱신합니다. 배당의 announced→fixed→paid, 기준일 수량과 정정 정책은 실제 scheduled runtime/Firebase repository에서 검증하고 Reporting에 복제하지 않습니다.

## 9. 오류·보안·관측성

재검증 실패는 이전 차트를 보존하면서 오류로 표시합니다. 이전 가구의 데이터와 오류는 새 가구 첫 paint에도 노출하지 않습니다. 유효한 0원을 NoData로, 서버 장애를 0원으로 위장하지 않습니다. 메모·가맹점 원문은 진단 로그에 추가하지 않습니다.

## 10. 표시·성능

차트 전환은 공용 useChartMotion의 150ms와 prefers-reduced-motion을 따릅니다. 같은 결과 배열과 차트 options를 재사용해 재진입 때 애니메이션을 다시 시작하지 않습니다. 메모·카드 등 상세 변경도 비교하므로 금액만 같다는 이유로 변경을 숨기지 않습니다. 실제 성능 검사는 이 설정으로 canvas 완성까지 관측합니다.

## 11. 테스트 설계

| 계약 | 실제 검사 |
|---|---|
| 기간·월말·서울 기준 | statisticsPeriod.contract.test.ts, 실제 StatsPage 기간 선택 |
| 페이지 완료·상한·중복 cursor·오류·세션 | reportingReadAdapters.test.ts, assetStatisticsReadModel.contract.test.ts |
| 0원·빈 결과·실패·편집/삭제·늦은 응답 | statisticsPage.test.tsx, expenseStatistics* 검사 |
| baseline·오늘 잔액·과거 dimension·독립 기간·캐시·선택 보존 | assetBalanceHistory.contract.test.ts, assetProfitSource.test.tsx, assetStatsSessionRead.contract.test.tsx, assetStatisticsReadModel.contract.test.ts |
| 배당 canonical 월 합계·예상액·상세 정렬 | assetDividendChartIdentity.contract.test.tsx |
| 실제 SDK 원천과 실제 화면 | finance-search-statistics.spec.ts, portfolio-reporting.spec.ts |
| 배당 상태·동시 저장·정정·paid 보존 | firebase-dividend-schedule.integration.test.ts |

## 12. 현재 구현과 목표 명세의 차이

STAT-AST-003의 과거 owner dimension은 실제 읽기 adapter에서 보존하지만, 현재 자산 화면은 자산 유형 추이를 표시하며 별도 명의자 필터를 제공하지 않습니다. 기간 변경 시 선택을 보존하는 현행 UI 검사도 유지합니다. 과거의 독립 서버 fixture를 통과했다는 이유로 명의자 필터와 선택 초기화가 구현됐다고 주장하지 않습니다. 해당 목표 명세·DEC-058을 이번 정비에서 새 기능으로 구현하거나 삭제하지 않습니다.

STAT-006의 서버 source checkpoint를 여러 page 전체에 고정하는 목표 역시 현재 Web SDK 조회의 actor/revision 검사와 다릅니다. 현재 보장은 page 완성·cursor/건수 한도·actor/revision 격리이며, 여러 SDK 요청이 하나의 서버 snapshot이라는 보장은 없습니다. 장래 서버 조회 계약을 도입할 때 실제 경계 검사와 함께 결정합니다.
