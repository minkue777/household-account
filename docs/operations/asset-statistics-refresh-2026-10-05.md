# 자산 통계 표시 후 깜빡임

## 원인과 계약

자산 목록은 첫 서버 자산 수신 후 `refreshAllMarketValues`를 시작합니다. 그 요청이 통계 진입 후 완료되면 Portfolio Command가 통계 캐시를 무효화합니다. 통계 화면은 갱신 revision을 원천 식별 key에 포함했기 때문에 같은 세션의 완료 이력을 버리고 전체 차트를 unmount했습니다. 현재 자산 구독도 갱신마다 초기화됐습니다. 배당 카드는 focus/visibility 재조회에서도 loading 상태로 canvas를 제거했습니다.

같은 Actor·가구·원격 epoch의 갱신은 현재 합계·차트·선택을 유지하면서 최신 데이터를 적용합니다. 다른 세션·가구·원격 epoch 또는 배당 연도는 이전 값을 숨기고, 오류를 0원·빈 성공으로 바꾸지 않습니다. 재조회 자체와 늦은 응답 차단은 유지합니다. 관련 계약은 STAT-005·STAT-006입니다.

## 설계와 검증 계획

- 표시 원천의 identity와 재조회 revision을 분리합니다. 확인된 현재 자산도 원천 key로 보관합니다.
- 배당 카드의 여러 데이터·loading state를 연도별 완료 결과와 실패 상태로 모으고, 같은 연도 재조회는 기존 canvas를 보존합니다.
- 완료된 화면에서 갱신을 보류해 첫 React commit부터 차트·선택·합계 유지, 동일/변경 응답, 실패 복구와 세션 격리를 검증합니다.
- 실제 Emulator 시세 갱신 응답을 보류한 채 자산 목록에서 통계로 이동하고, 응답 해제 뒤 실제 canvas identity·연도/기간/상세 선택 보존과 새 원천 반영을 검사합니다. 운영 자료는 변경하지 않습니다.

## 배포 범위

Web 실행 코드 변경으로 Vercel Git 자동배포만 필요합니다. Firebase와 APK는 변경하지 않습니다.

## 검증 결과

수정 전 새 회귀 두 개가 실패했습니다. 완료 화면의 캐시 무효화 첫 commit에서 통계가 내려갔고, 연속 focus/visibility에서 배당 조회가 중복됐습니다. 수정 후 기존 세션·가구·epoch 격리, 0원·실패, 늦은 응답 폐기와 선택한 배당 연도 유지까지 포함한 관련 Jest 3개 파일 63개, `tsc --noEmit`이 통과했습니다.

Production build와 실제 Auth/Functions/Firestore Emulator를 사용하는 Chromium의 기존 자산·배당 6개 검사는 통과했습니다. 새 시나리오의 첫 실행은 보류 URL을 가구 하위 `:runQuery?key=...`와 다르게 지정한 테스트 오류로 실패했습니다. 실제 trace URL에 맞춰 수정한 후 재현 시나리오가 1 passed(28초)로 통과했습니다. 실제 시세 명령 성공 응답을 늦춘 뒤 이력 재조회를 보류한 동안에도 원래 canvas 3개가 제거되지 않았으며, 6개월·월별 상세 펼침·이전 배당 연도를 유지했습니다. 응답 해제 후 증감 20,000→40,000원·배당 50→75원을 실제 저장 원천에서 반영했습니다. 원천 응답을 만들어 주거나 검사 조건을 낮추지 않았습니다.

E2E 준비의 architecture 43개, 문서 링크·요구사항 추적성 13개와 248개 요구사항 catalog/E2E coverage 생성도 통과했습니다. 로그: `TEMP/household-asset-stats-flicker-{before,unit,prepare,e2e,e2e-recheck}-20261005.log`. 로컬 Emulator는 정상 종료했습니다. 이 변경은 이전 CI에서 관측한 원인 미확정 WebKit 30초 배당 조회 대기를 해결했다는 증거가 아닙니다.

## 조회·갱신 계약 단순화 후속

기능·실패·세션 격리 계약을 유지하면서 실제 실행 코드량을 줄입니다. 줄바꿈 축소나 다른 파일로의 이동은 성과로 세지 않고, 가독성과 책임 분리를 유지합니다.

실행 코드 6개 파일은 1,673줄에서 1,581줄로 92줄(5.5%) 줄었습니다. 테스트와 문서 줄 수는 이 계산에 포함하지 않습니다.

- 증감 차트는 부모의 전체 이력을 필수 입력으로 받아 계산·표시만 담당합니다. 운영 호출자가 없는 독립 조회·상태·재시도를 제거하고, 화면 전용 현재 지점에 가짜 저장 문서 필드를 만들지 않습니다.
- 이력 캐시는 마지막 완료값과 진행 요청 한 개로 표현합니다. 실제 경로는 항상 서버를 재확인하므로 30초 TTL·8개 Map·범용 타입·강제 갱신 옵션·미사용 시작일 조회를 제거합니다. Actor·epoch·종료일과 요청 객체 식별로 무효화·동일 Actor 복귀 후 늦은 응답도 차단합니다.
- 배당 카드는 이력과 병렬로 조회를 시작하되 표시 조건이 열리기 전에는 DOM을 표시하지 않습니다. 부모의 선조회 Promise·상태와 자식의 소비 ref·effect를 제거합니다. 이전 연도 선택 중 변경 완료 시 올해까지 다시 읽던 원천 조회 6회를 선택 연도의 3회로 줄입니다. 화면 표시 전 focus·visibility는 추가 조회하지 않습니다.
- 배당 초기 연도는 모듈 로드 시점이 아닌 화면 진입 시점에 계산합니다. 연말부터 앱을 열어 둔 뒤 새해에 통계로 들어오는 경우도 검증합니다.

요구사항과 설계는 reporting의 `STAT-005`, `STAT-006`, `STAT-AST-002`에 연결했습니다. 미사용 독립 조회·TTL 검사는 제거/변경하고, +200원/+25% 계산·baseline·0원/NoData·진행 요청 공유·실패 보존·세션 격리·화면 유지 검사는 유지합니다. 동일 Actor로 돌아오는 요청, 종료일·epoch별 캐시 격리, 선택 연도 단일 조회와 새해 진입 검사를 보강했습니다.

선택 연도만 갱신하는 새 검사는 수정 전 실패했습니다. 변경 후 관련 Jest 7개 파일 92개가 통과했고, 후속 새해 진입 검사까지 해당 파일 2개가 통과하여 총 93개를 확인했습니다. `tsc --noEmit`, E2E 준비의 architecture 43개, 문서 링크·추적성 13개도 통과했습니다. 실제 Emulator와 production build를 사용하는 `portfolio-reporting.spec.ts`의 7개 브라우저 검사가 48.5초에 통과했습니다. 서버 응답을 보류하는 기존 시나리오에서 canvas 3개·선택을 보존하며 실제 이력·배당 갱신값을 반영했습니다. 로그는 `TEMP/household-stats-simplicity-{before,unit,year,types,prepare,e2e}-20261005.log`입니다. Web만 Vercel Git 자동배포하며 전체 CI는 해당 커밋으로 추적합니다.

## 시리즈·계산 계약의 추가 단순화

전체·금융 합계와 유형별 추이를 같은 시리즈 구조로 계산합니다. 별도 분류·정렬·실시간 합성·날짜 수집·dataset 생성 경로를 통합하고, 사용하지 않는 요약 중간 객체를 제거했습니다. 시리즈 선택 버튼도 동일한 시리즈를 사용하며 기존 글꼴·색상·선택 의미를 보존합니다.

`withCurrentAssetBalance`는 날짜순으로 분류된 단일 시리즈에 오늘 잔액을 한 번 반영합니다. 읽기 경계의 날짜순·날짜 중복 제거 계약을 사용하며, 화면은 전체 이력을 한 번만 분류합니다. 상단은 기간과 baseline을 잘라 표시하고 증감 차트는 전체 이력으로 독립적인 월·연도 탐색을 합니다. helper는 저장 문서의 가짜 id·createdAt을 생성하지 않으며 입력 이력을 변경하지 않습니다. 미확정 현재값과 확정된 0원을 구분하고, 오늘이 첫 이력일 때 원래 changeAmount에서 baseline을 복원합니다.

배당은 확정 월 합계에 예상액을 직접 누적하고 상세 연월 필터·연간 합계를 한 번 계산합니다. snapshot.monthlyData와 상세 events 합계가 달라도 canonical 월 합계를 그대로 사용하며, 발표 상태·기준일·확정 ID 제외·반올림·지급일/확정 우선/종목명 정렬을 유지합니다.

새 helper 25줄을 포함한 실행 코드 합계는 1,406줄입니다. 직전 1,581줄 대비 175줄, 최초 1,673줄 대비 267줄(16.0%) 감소입니다. 파일 이동·테스트·문서는 감소량에 포함하지 않으며 20% 달성으로 보고하지 않습니다.

최종 관련 Jest 8개 파일 106개와 타입 검사가 통과했습니다. 새 시나리오는 희소한 유형별 baseline·확정 0원·금융자산 제외·상단 기간과 독립적인 과거 월/연도 탐색·원본 불변 및 배당 합계/상세 계약을 확인합니다. 페이지 검사 작성 중 현재 모드 버튼 이름을 반대로 선택한 테스트 오류를 실제 `전체자산` 버튼으로 수정했습니다. Jest role 선택자에 잘못 넣은 Playwright식 `exact` 옵션도 제거했습니다(문자열 name은 기본적으로 정확히 일치합니다). 변경 전후 실제 추이 계산을 추출한 최종 코드의 고정 seed 1,500개 입력 비교에서 값·선택·dataset 옵션이 모두 일치했습니다. 이 비교는 UI·SDK 검사를 대체하지 않습니다. 로그는 `TEMP/household-stats-series-{unit,types,page,equivalence,prepare,e2e}-20261005.log`입니다.

중간 구현의 시리즈별 전체 필터·정렬이 긴 이력에서 반복되는 것을 측정으로 확인하여 한 번 분류·날짜 위치 삽입으로 정리했습니다. helper의 임의 비정렬 입력 지원은 내부 계약에서 제거하고, 날짜순·유일 원천을 보장하는 기존 SDK 조회 검사는 유지했습니다. 오늘 포인트의 맨 앞·중간·끝 삽입 검사를 추가했습니다. 자산 이름이나 유형별 금액만 바뀌어 전체 합계가 같을 때에는 전체 이력의 메모 참조를 유지합니다. 이 참조 회귀 검사는 중간 구현에서 실패했고 합계 합성의 의존성을 별도로 명시한 최종 구현에서 통과했습니다.

실제 이전/현재 page 계산부와 helper를 추출한 데스크톱 Node 24 측정에서 365일 중앙값은 0.793→0.375ms, 1,825일은 1.555→1.305ms, 49,999일/599,988 entry는 21.173→21.322ms였습니다. 7개 시리즈를 모두 선택하고 3개월을 표시하며, 준비 실행 후 일반 이력 41회·상한 근처 11회를 교차 측정했습니다. 상한 근처에서도 더 빠르다고 주장하지 않으며, 기기·렌더·네트워크 시간을 포함하지 않은 로컬 계산 비교입니다. 스크립트는 `TEMP/household-asset-statistics-pipeline-performance-20261005.cjs`, 최종 결과는 `TEMP/household-stats-series-performance-final-20261005.log`입니다. 최종 Jest·타입 로그는 `TEMP/household-stats-series-{unit,types}-final-20261005.log`, 수정 전 참조 회귀는 `TEMP/household-stats-series-reference-before-20261005.log`입니다.

최종 production build와 실제 Auth/Functions/Firestore Emulator 기반 Chromium `portfolio-reporting.spec.ts` 7개가 44.7초에 통과했습니다. 실제 시세 응답·이력 읽기를 보류한 동안 세 canvas와 기간·상세·배당 연도 선택을 유지하고 해제 후 저장된 갱신값을 반영했습니다. E2E 준비 architecture 43개, 최종 문서 링크·요구사항 추적성 13개도 통과했습니다. 로그는 `TEMP/household-stats-series-e2e-final-20261005.log`와 `TEMP/household-stats-series-docs-final-20261005.log`이며 로컬 Emulator는 정상 종료했습니다. 배포 대상은 Web Git 자동배포뿐입니다. 직전 `37f7d40`의 CI `37282200572` 다섯 검사·요약과 Web 배포 성공을 확인했습니다.

## f0d8149a 전체 CI 후속 확인

[CI 37286076199](https://github.com/minkue777/household-account/actions/runs/37286076199)는 functions·web·android·android-instrumentation이 성공했고 web-e2e는 101 passed/1 failed, 요약은 실패했습니다. 실패는 iOS WebKit `notification-deeplink.spec.ts:13`의 `page.goto()`에서 `WebKit encountered an internal error`로 문서 이동이 약 2.104초 만에 거절된 것입니다. 이동 전 거래 생성·원장 재조회는 성공했지만 편집 URL의 document 요청은 status -1·본문 없음이며 편집 화면 검증에 도달하지 못했습니다. Chromium 딥링크, 다른 WebKit 딥링크와 자산 통계 Chromium 7개는 통과했습니다.

브라우저/navigation 경계의 실패로 관측됐으나 내부 원인은 미확정입니다. navigation 실패 약 15ms 뒤 Auth IndexedDB connection-closing 오류가 있었지만 인과를 확정할 수 없습니다. 이전 배당 조회 30초 대기와는 단계가 다릅니다. 제품 코드를 바꾸거나 검사를 완화·재시도할 근거가 없어 무변경 재실행하지 않고, 다음 지출 차트 변경 SHA의 동일 전체 CI에서 후속 확인합니다. 이 실패 이력을 성공으로 덮지 않습니다. 증거는 `TEMP/household-asset-stats-ci-37286076199/trace-extracted/1-trace.{trace,network}`와 `test.trace`입니다.
