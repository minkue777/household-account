# 관리자 초기 로딩 최적화 — 2026-11-08

## 원인과 변경

기존 `get-dashboard`는 Firestore 기본 정보와 외부 Cloud Logging 성능 집계를 모두 기다린 뒤 반환했습니다. 가구 목록·운영 상태가 준비되어도 통계 조회가 페이지 전체를 막았습니다.

- `get-dashboard-overview`: 기존 기본 정보만 조회합니다.
- `get-function-latency`: 기존 최근 24시간 통계만 조회합니다.
- Web은 동시에 요청하고 기본 정보부터 표시합니다. 통계 대기·실패는 별도 영역에서 표시하고 기존 통계는 갱신 중 보존합니다.
- 구 `get-dashboard`와 systemAdmin 권한·세션 교체·중복 요청 차단은 유지합니다. 운영 데이터와 통계 계산·조회 범위는 변경하지 않습니다.

## 읽기 전용 측정

실제 운영 데이터에 로컬 Admin SDK로 접근했습니다. Cloud Functions 실행 시간이나 브라우저 전체 로딩 시간으로 해석하지 않습니다.

| 측정 시각 UTC | 경로 | 소요 |
|---|---|---:|
| 07:56:14 | 변경 전 전체 조회 | 4,218ms |
| 07:56:14 | 그중 Logging 대기 | 4,169ms |
| 08:01:22 | 같은 시점의 전체 조회 | 3,932ms |
| 08:01:22 | 같은 시점의 기본 정보 조회 | 820ms |

후속 비교는 두 경로를 같은 `generatedAt`으로 병행했습니다. `functionLatency`를 제외한 응답 전체가 deep equality로 일치했으며 가구 3개·활성 멤버 7명을 보존했습니다. 통계는 available·12개 operation입니다. 이 표본의 기본 정보 대기는 3,112ms(약 79%) 줄었습니다. 원문 데이터는 기록하지 않았습니다. 측정 증거는 로컬 TEMP의 `household-admin-load-before-20261108.json`, `household-admin-load-after-20261108.json`입니다.

## 검증과 배포

- 서버 조회·권한·payload 계약: 17개 통과. Functions architecture 43개 및 production build·테스트 타입 검사 통과.
- Web 세션·동시 조회·통계 실패·비용 표시: 20개 통과.
- Web production build 통과.
- 실제 callable 브라우저 E2E 3개 통과. 통계 응답을 보류해 가구 목록·상세·비용이 먼저 표시되고 이후 통계가 정상 표시되는지 확인했습니다. 기존 집계·복구·관리자 조회 검증을 유지합니다.
- 서버에 operation을 먼저 추가한 뒤 Web Git 배포를 진행합니다. Firebase 세 codebase 대상이며 APK 변경은 없습니다.
- 배포와 최신 전체 CI는 후보 커밋 후 확인합니다. 이전 환율 CI `42459326040`의 남은 web-e2e도 별도로 추적합니다.
