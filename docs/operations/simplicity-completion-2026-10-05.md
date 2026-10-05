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
