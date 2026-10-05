# 기능 계약별 전체 정비 결과

기준 SHA `12a582bf63bae7ad5b7c66bcfbf67ac96fb338da`에서 읽은 1,557개 파일의 정적 조사 후, [전체 후보 진행표](../verification/simplicity-2026-10-05/completion.md)의 각 항목을 구현·관련 검증 또는 근거 있는 유지 결정까지 처리했습니다. 전수 조사는 모든 코드가 무결하다는 보증이 아니며 실제 검증과 배포 상태를 구분합니다.

## 바뀐 실행 방식

- 자산·보유종목과 카테고리는 서버가 실제 확정한 결과·버전을 반환하고 Web이 이를 사용합니다. 화면에서 최종 값을 다시 추정하는 상태와 중복 조회를 줄였습니다.
- 수정 화면은 편집 시작 원본과 초안을 유지하며 늦은 저장·시세 응답을 현재 편집에 섞지 않습니다. 실패와 정상 빈 목록·0원을 구분합니다.
- 정기 거래는 대상 계획·receipt를 직접 읽고 실제 원자 저장과 Outbox를 사용합니다. 온보딩·명의 변경의 가짜 의존성, 중첩 가상 저장소를 제거했습니다.
- 수집 direct/retry는 같은 전달 함수를 사용합니다. 퀵에딧 원본은 하나의 snapshot이며 저장·분할은 현재 초안으로 계산합니다.
- 미사용 서버 정책·통계 모형·demo·API를 제거하고 실제 실행 경로로 문서·추적성을 연결했습니다. 상수 결과·별도 금융 엔진 fixture와 순차 실행하던 경합 검사는 실제 저장·동시 실행 검사로 바꿨습니다.
- 발견한 결함은 원래 저장·입력 경계에서 수정했습니다. 이름 중복, 오래된 통계 키 병합, receipt의 retryable 필드 잔류, 수동 거래 유형과 SMS 지역 오분류 등이 포함됩니다.

## 유지 결정과 범위

[호환 경로 유지 근거](simplicity-retention-decisions-2026-10-05.md)에 지역화폐 구형 자료, 배당 초기 이력, 알림 구형 guard, 관리자 혼합 날짜 조회, 실제 통계 캐시의 필요성과 제거 전제 조건을 명시했습니다. 운영 자료 이관 없이 삭제하면 기존 사용 계약이 깨지는 경로는 남겼습니다.

독립 테스트 모형만 있던 통계 명의 필터 UI·다중 page의 서버 checkpoint 보장은 실제 구현된 기능으로 보고하지 않습니다. 요구사항을 지우지 않고 [실제 통계 상세 설계](../requirements/supporting-platform/modules/reporting/design.md)에 현행 구현과 목표의 차이를 밝혔습니다. 이번 정비로 신규 통계 기능을 추가한 것은 아닙니다.

## 검증과 배포 상태

각 기능 문서가 검증 범위·로그를 보유합니다. 최종 묶음은 실제 배당 SDK 14개, 통계 Chromium 6개, iPhone WebKit 2개, Android JVM 109개·Activity/Keystore 19개·Native Firebase 4개·Native→Web 1개, 서버 입력 단위 109개·Rules/진단 SDK 17개를 통과했습니다. 최종 architecture 43개와 248개 요구사항의 추적성 생성도 통과했습니다. 앞선 기능들의 검사 결과도 진행표에서 연결했습니다.

제품 후보 cdf60b3fc98adfde43bd09094a4155e4c8ca9358을 push했습니다. Firebase `release-20261005-simplicity-final-cdf60b3`의 세 codebase와 실제 로그인·가구 Query marker 검증은 성공했습니다. 같은 SHA의 Vercel Git 배포도 성공했으며 운영 `/`, `/sw.js`의 해당 SHA와 build manifest HTTP 200을 확인했습니다.

[v1.2.34/code36](https://github.com/minkue777/household-account/releases/tag/v1.2.34)은 해당 제품 SHA를 target으로 공개했습니다. 다운로드 HTTP 200, 11,421,547 bytes, SHA256 `a673f95178d40ad5f7a0cdea4c3f9eeab4e36efd109ed5ff160d87ab87269fda`, APK v2 서명·운영 URL을 확인했습니다. 뒤의 서버 수정으로 APK를 덮어쓰지 않습니다.

CI 37268472742의 functions 실패는 새 지역 서비스명 검사에서 기존 화성지역화폐 이름을 빠뜨린 제품 결함입니다. [수정과 실제 479개 검사](server-boundary-simplicity-2026-10-05.md#ci에서-확인한-지역-명칭-호환-수정)를 기록했고 서버 후속 후보를 배포합니다. 최종 전체 CI와 이 제품의 실제 Android 검사는 후속 자동 확인에서 함께 추적합니다. 실패 이력을 성공으로 덮거나 pending을 완료로 보고하지 않습니다.

## 최종 CI의 WebKit 배당금 조회 대기 실패

서버 후속 SHA `df7ae23816c0f089c6cc27ecc00f4dcf49f95f7c`의 Firebase `release-20261005-simplicity-sms-df7ae23` 세 codebase 배포와 실제 로그인·가구 Query marker 검증은 성공했습니다. 같은 SHA의 Vercel Git 배포와 운영 `/`, `/sw.js`, build manifest도 검증했습니다. 앞선 `cdf60b3`의 CI `37268472742`는 실제 Android instrumentation·Native Firebase·성능 검사와 web-e2e가 성공했습니다. 당시 functions 실패 이력은 위 SMS 수정으로 추적하며 성공으로 덮지 않습니다.

[CI 37268915761](https://github.com/minkue777/household-account/actions/runs/37268915761)은 functions·web·android·android-instrumentation이 성공했지만 web-e2e의 후속 성능 시나리오와 요약이 실패했습니다. WebKit iteration 2의 `asset-stats.revisit`에서 30초 `PERFORMANCE_READY_TIMEOUT`이 발생했습니다. 자산 합계 7,699,000원과 추이·증감 차트 두 개는 표시됐지만 배당금 카드가 `조회 중`에 머물러 세 번째 canvas와 배당 결과가 나타나지 않았습니다. 뒤의 표본 누락은 시나리오 중단의 결과이며 별개의 170개 제품 오류가 아닙니다.

동일 실행에서 Firebase Auth의 IndexedDB `_poll` 경로가 `InvalidStateError: The database connection is closing`을 발생시켰습니다. 배당금 조회는 realtime SDK의 `getDocs` 세 개(positions·dividend_snapshots·dividend_events)를 기다리며, 표시된 자산 이력은 별도의 단발 서버 조회를 사용합니다. 그러나 기존 artifact에는 Firestore 요청 수명·대상과 오류를 낸 문서의 식별 정보가 없어 인증 저장소 오류와 배당 대기의 인과관계, 실제 중단된 조회를 확정하지 못했습니다. 정적 JS/CSS의 요청 실패나 화면 오류 alert는 관측되지 않았습니다.

후속 변경은 성능 검사의 실패 관측만 보강합니다. 실제 Emulator 요청의 시작·HTTP 상태·완료/실패 시각, Listen AID와 target ID·collection 이름, Firebase SDK 경고와 열린/닫힌 문서별 오류를 저장합니다. 인증 header·token·문서 값은 수집하지 않습니다. 같은 검사에서 배당금 조회 세 종류가 실제 관측되는지도 검증합니다. 요청 가로채기·캐시 해제·SDK 대체·오류 무시 없이 기존 동작과 30초·7개 표본·화면/저장 assertions를 유지합니다. 제품 원인이 해결됐다고 간주하지 않으며 Web/Firebase/APK 재배포는 필요하지 않습니다.

원본 CI 자료: `TEMP/household-simplicity-performance-37268915761/failures/webkit-mobile-failure-2.{json,html,png}`, `TEMP/household-simplicity-ci-37268915761-failed.log`.

로컬 production build + 실제 Auth/Functions/Firestore Emulator + WebKit에서 준비 실행 1회와 본 실행 7회가 모두 통과했습니다(1 passed, 4.5분). 33개 지표의 총 264개 관측과 배당금 세 조회 대상 관측을 확인했고, 기존 30초 실패·IndexedDB 오류는 재현되지 않았습니다. 별도 참고 성능 기준(report-only)에서는 검색 첫 진입과 자산 통계 재진입이 초과했으며 이를 숨기거나 기준을 바꾸지 않았습니다. 자산 통계 재진입의 7회 값은 375~467ms였으므로 CI의 30초 중단과 구분합니다. `tsc --noEmit`, E2E 준비의 architecture 43개, 문서 링크 검사도 통과했습니다. 로그는 `TEMP/household-simplicity-webkit-read-{prepare,diagnostics}-20261005.log`, 로컬 결과는 `TEMP/household-simplicity-webkit-read-results-20261005.json`입니다. 후속 최신 전체 CI 성공은 별도로 확인해야 합니다.
