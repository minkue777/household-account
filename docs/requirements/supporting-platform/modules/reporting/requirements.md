# 통계 모듈 요구사항

> 상위 Bounded Context: 없음 — [지원·읽기·플랫폼 영역](../../requirements.md)  
> 아키텍처 역할: Cross-context Query / Read Side  
> 상세 설계: [모듈 상세 설계](design.md)  
> 상태와 테스트 표기 규칙은 [공통 요구사항 규약](../../../governance/conventions.md)을 따릅니다.  
> 이 문서는 `STAT-*`, `STAT-AST-*` 요구사항의 단일 소유 문서입니다.

## 1. 독립 모듈 책임

통계 모듈은 거래·카테고리·자산 이력의 조회 결과를 기간과 차원별로 집계해 지출 및 자산 통계 조회 모델을 만듭니다. 원천 데이터를 소유하거나 직접 수정하지 않으며, 통계 화면에서 발생한 거래 수정·삭제와 가맹점 규칙 저장은 해당 기능 모듈의 공개 명령에 위임합니다.

기간 계산과 집계는 React·Firestore와 분리된 순수 정책으로 제공하여 원천 모듈 변경이 통계 계산에 전파되지 않게 합니다.

## 2. 포함/제외 범위

### 포함

- 최근 3개월·6개월·12개월·사용자 지정 지출 통계 기간 계산
- 총지출·월별 추이·카테고리별 비중 집계
- 예산 설정을 반영한 초기 추이 카테고리 선택
- 카테고리 상세 조회 모델과 위임 명령 후 화면 상태 동기화
- 3개월·6개월·1년·전체 자산 통계 기간
- 부동산·대출을 제외한 금융자산 전용 조회
- 기간 시작 직전 기준 snapshot과 기간 내 carry-forward를 포함한 자산 추이
- 원천의 유효한 0원·데이터 없음·실패를 보존하는 조회 상태
- cursor·최대 조회량이 있는 원천 조회와 오래된 비동기 응답 폐기

### 제외

- 거래 CRUD와 거래 저장소 소유
- 카드별로 미리 나눈 전용 통계 차원·화면. 카드 문자열 검색과 검색 결과의 전체·월별 합계는 [Ledger 검색 계약](../../../contexts/household-finance/modules/ledger/requirements.md#검색)이 소유한다.
- 카테고리·예산과 가맹점 규칙의 저장
- 자산·스냅샷의 생성과 수정: [자산 포트폴리오 모듈](../../../contexts/portfolio/modules/portfolio/requirements.md)
- 배당 이벤트 상태 전이: [배당 모듈](../../../contexts/portfolio/modules/dividends/requirements.md)
- 홈 요약 카드: [홈·환경설정 모듈](../home-preferences/requirements.md)

## 3. 소유 데이터

통계 모듈은 별도 Firestore 컬렉션을 소유하지 않습니다.

| 데이터 | 소유권과 불변식 |
|---|---|
| 통계 기간 값 객체 | 시작일과 종료일이 월 경계로 정규화된 일시적 조회 조건입니다. |
| 지출 통계 조회 모델 | 원천 거래와 카테고리에서 계산한 총액·월별·카테고리별 파생 값입니다. |
| 자산 통계 조회 모델 | 자산 스냅샷에서 계산한 기간별·유형별 파생 값입니다. |
| 사용자 토글 | 현재 화면 생명주기 안에서만 유지하며 영구 설정 데이터로 소유하지 않습니다. |

## 4. 공개 계약·의존 모듈

### 공개 계약

- `ResolveExpenseStatisticsPeriod(preset, customRange, now)`
- `BuildExpenseStatistics(expenses, categories, period)`
- `ResolveInitialTrendCategories(categories)`
- `BuildAssetStatistics(history, assets, period, financialOnly)`
- `BuildCategoryDetail(categoryKey, expenses)`

통계 화면의 수정 동작은 `UpdateTransaction`, `DeleteTransaction`, `SaveMerchantRule`을 각 소유 모듈에 호출하고 성공 결과를 조회 모델에 반영합니다.

### 의존 모듈

- 거래 원장 모듈: 기간별 지출 조회와 거래 변경 명령
- 카테고리·예산 모듈: 카테고리와 예산 설정 조회
- 가맹점 규칙 모듈: 규칙 저장 명령
- 자산 포트폴리오 모듈: 자산과 기간별 스냅샷 조회
- 배당 모듈: 자산 통계 화면에 조합할 연도별 배당 조회 모델
- 주입된 `Clock`: 현재 월 기준 기간 계산

## 5. 요구사항

| ID | 상태 | 요구사항 | 경계·예외 | 근거 | 테스트 |
|---|---|---|---|---|---|
| STAT-001 | 현재 명세 | 지출 통계는 최근 3개월, 6개월, 12개월, 사용자 지정 기간을 지원한다. | 사용자 지정 날짜가 불완전하면 12개월로 대체한다. | [stats page](../../../../../web/src/app/stats/page.tsx) | U, E2E |
| STAT-002 | 현재 명세 | 선택 기간 총지출, 월별 추이, 카테고리별 비중을 표시한다. | 지출만 집계한다. | 같은 근거 | U, I, E2E |
| STAT-003 | 현재 명세 | 추이 카테고리 초기값은 예산 설정 카테고리이며 없으면 생활비·육아비·식비이다. | 사용자 토글은 현재 영구 저장하지 않는다. | 같은 근거 | U, UI |
| STAT-004 | 현재 명세 | 카테고리 상세에서 거래를 수정·삭제하고 가맹점 규칙을 저장할 수 있다. | 수정 결과는 화면 상태에도 반영한다. | 같은 근거 | I, E2E |
| STAT-005 | 결함 | 지출·자산 통계 원천의 유효한 0원, `NoData`, `RetryableFailure`·`ContractFailure`를 서로 다른 결과와 화면 상태로 보존한다. | 지출 통계는 조회 시 계산하므로 Projection freshness 상태를 만들지 않는다. 원천 하나가 실패해도 빈 배열·0원 성공으로 바꾸지 않는다. | [stats page](../../../../../web/src/app/stats/page.tsx), [asset stats](../../../../../web/src/app/assets/stats/page.tsx), [assetService](../../../../../web/src/lib/assetService.ts), [DEC-048](../../../governance/decisions.md#dec-048) | U, C, UI, E2E |
| STAT-006 | 목표 명세 | 통계 원천 조회는 서버 날짜 범위와 cursor·page limit으로 제한하고, 집계에 필요한 모든 page를 읽은 뒤에만 완전한 결과를 반환한다. 화면은 현재 Actor·가구·query revision과 일치하는 응답만 반영한다. | 전체 원장을 무제한 client 조회하거나 설정 상한에 걸린 부분 합계를 완전한 값처럼 표시하지 않는다. 필터·세션·가구 변경 또는 화면 종료 뒤 도착한 이전 응답은 폐기한다. | [expenseService](../../../../../web/src/lib/expenseService.ts), [assetService](../../../../../web/src/lib/assetService.ts), [stats page](../../../../../web/src/app/stats/page.tsx), [DEC-048](../../../governance/decisions.md#dec-048) | C, I, UI |
| STAT-AST-001 | 결함 | 자산 통계는 3개월, 6개월, 1년, 전체 기간과 금융자산 전용 토글을 제공하며 전체 기간은 가장 오래된 유효 snapshot부터 시작한다. | 기본 기간은 3개월이며 금융자산 토글은 부동산·대출을 제외한다. 현재 `ALL`은 2020-01-01로 고정되어 그 이전 snapshot을 누락한다. | [asset stats](../../../../../web/src/app/assets/stats/page.tsx) | U, UI, E2E |
| STAT-AST-002 | 목표 명세 | 기간 통계는 시작일 이하의 가장 가까운 유효 snapshot을 기준값으로 포함하고 기간 중 snapshot이 없는 날은 직전 성공값을 유지한다. | 기준값 0원은 유효하며 `NoData`와 다르다. 시작일 이전에도 유효 snapshot이 전혀 없으면 `NoData`이고 공급자·저장소 실패는 별도 실패다. | [asset stats](../../../../../web/src/app/assets/stats/page.tsx), [assetService](../../../../../web/src/lib/assetService.ts) | U, I, UI |
| STAT-AST-003 | 목표 명세 | 자산 통계의 유형·명의자 필터는 선택 기간의 snapshot과 시작 baseline에 실제 존재하는 안정 dimension key로 구성한다. | 현재 자산이 모두 deleted이거나 명의자 프로필이 archived여도 기간 결과에 있으면 표시한다. 기간 변경 후 선택 dimension이 새 catalog에 없으면 `전체`로 초기화하며 현재 자산·active profile 목록으로 과거 필터를 제한하지 않는다. | [asset stats](../../../../../web/src/app/assets/stats/page.tsx), [DEC-058](../../../governance/decisions.md#dec-058) | U, Contract, I, UI |

지출 통계 기간은 현재 월 말일을 끝으로 삼습니다. 3개월은 두 달 전 1일, 6개월은 다섯 달 전 1일, 12개월은 전년도 같은 월의 다음 달 1일부터 시작합니다. 사용자 지정 시작·종료일은 각각 해당 월의 1일과 말일로 정규화합니다.

## 6. 모듈 결함

- 자산 통계의 `ALL` 시작일이 2020-01-01로 고정되어 더 오래된 유효 snapshot을 누락합니다. (`STAT-AST-001`)
- 기간 시작 직전 snapshot을 조회하지 않아 첫 기간 내 snapshot이 늦게 생기면 변화량과 차트 시작값이 왜곡됩니다. (`STAT-AST-002`)
- 원천 조회 실패를 빈 배열·0원 또는 현재값만 있는 성공 결과로 바꾸는 경로가 있어 “데이터 없음”과 장애를 구분할 수 없습니다. (`STAT-005`)
- 기간·검색 이력을 가구 전체 조회 뒤 client에서 필터링하는 경로와, 늦게 도착한 이전 요청을 폐기하지 않는 화면 경로가 있습니다. (`STAT-006`)
- 카테고리 상세 화면이 거래와 가맹점 규칙을 직접 저장하는 구현 결합은 공개 Application 명령 위임으로 분리해야 합니다. (`STAT-004`)
- 추이 카테고리 토글은 현재 영구 저장되지 않습니다. 이는 현재 명세의 경계이며 저장 기능을 암묵적으로 추가하지 않습니다. (`STAT-003`)

## 7. 관련 DEC

- [DEC-058](../../../governance/decisions.md#dec-058): 과거 자산 통계 필터는 현재 자산이 아니라 선택 기간 Snapshot의 유형·owner dimension으로 구성합니다.

## 8. 모듈 테스트 시나리오

| 테스트 ID | 시나리오 | 수준 | 연결 요구사항 |
|---|---|---|---|
| T-STAT-PERIOD-001 | 고정된 현재 날짜에서 3개월·6개월·12개월의 시작일과 현재 월 말일을 정확히 계산한다. | U | STAT-001 |
| T-STAT-PERIOD-002 | 사용자 지정 시작·종료일을 각각 해당 월 1일과 말일로 정규화한다. | U | STAT-001 |
| T-STAT-PERIOD-003 | 사용자 지정 시작·종료 중 하나가 없으면 최근 12개월로 대체한다. | U | STAT-001 |
| T-STAT-PERIOD-004 | 사용자 지정 시작 월이 종료 월보다 늦으면 조용히 뒤집지 않고 ValidationError로 거부한다. | U | STAT-001 |
| T-STAT-PERIOD-005 | UTC 날짜가 다른 자정 경계에서도 Asia/Seoul의 현재 월을 기준으로 기간을 계산한다. | U | STAT-001, DEC-023 |
| T-STAT-003 | 같은 기간에 지출과 수입·취소 거래·빈 월이 있으면 활성 지출만 총액·월별·카테고리별 집계에 포함한다. | U, I | STAT-002 |
| T-STAT-004 | 예산 설정 활성 카테고리가 있으면 예산 순서의 초기 추이 목록으로, 없으면 존재하는 호환 기본 카테고리를 사용하며 토글은 저장하지 않는다. | U, UI | STAT-003 |
| T-STAT-005 | 카테고리 상세에서 거래 변경·삭제·규칙 저장 성공 후 소유 모듈의 receipt·Event와 권위 조회 모델로 수렴하고 query revision을 전진시키며, 실패·Conflict면 기존 상태·revision을 유지한다. | Application, I, E2E | STAT-004 |
| T-STAT-001 | 0원 원천, 데이터 없음, 저장소·공급자 실패를 각각 반환하면 통계와 화면이 세 상태를 그대로 구분한다. | U, C, UI | STAT-005, DEC-048 |
| T-STAT-002 | Ledger·자산 원천의 단일/여러 cursor page, cursor 누락·중복·checkpoint 변경·안전 상한 초과, 필터·Actor가 바뀐 뒤 이전 응답 / 통계 조회 / 같은 사실은 page 구성과 무관하게 같은 결과이고 전체 page 완료 뒤만 집계하며 불완전 조회와 오래된 응답은 완전한 결과로 반영하지 않음 | C, I, UI | STAT-006, DEC-048 |
| T-STAT-AST-003 | 자산 통계 3개월·6개월·1년의 정확한 월 경계와 기본 3개월, `ALL` 최초 유효 snapshot, 금융자산 토글 / 기간 조회 / preset별 포함 snapshot이 정확하고 금융자산 토글 시 부동산과 대출을 제외한다. | U, UI | STAT-AST-001 |
| T-STAT-AST-001 | 2020년 이전 snapshot이 있는 전체 기간, 시작일 전 여러 후보·직전 0원·양수 baseline·미래 후보 및 기간 내 gap / 자산 통계 조회 / 시작일 이하 가장 가까운 baseline을 원천 page 전체에서 선택하고 최초 유효일부터 시작하며 0원을 포함한 직전 성공값을 유지한다. | U, I, E2E | STAT-AST-001, STAT-AST-002 |
| T-STAT-AST-002 | 현재 모두 deleted인 stock 유형과 archived 지아 profile의 과거·0원 snapshot, 기간 변경 / 통계 dimension 조회·필터 / 해당 기간에는 stock·지아 필터 표시, 현재 목록에는 미노출, 새 기간에 dimension이 없으면 전체로 초기화 | U, C, I, UI | STAT-AST-003, AST-004, AST-009, DEC-058 |

## 9. 코드 근거

- [지출 통계 화면과 현재 집계](../../../../../web/src/app/stats/page.tsx)
- [자산 통계 화면과 현재 집계](../../../../../web/src/app/assets/stats/page.tsx)
- [거래 서비스](../../../../../web/src/lib/expenseService.ts)
- [가맹점 규칙 서비스](../../../../../web/src/lib/merchantRuleService.ts)
- [자산 서비스](../../../../../web/src/lib/assetService.ts)
