# 자산 시세 갱신 조회·저장 최적화

## 확인한 지연

2026-10-29 운영 로그와 Firestore 저장 시각을 읽기 전용으로 대조했다. 당일 성공한 전체 갱신 5건의 서버 처리 시간은 평균 6,935ms, 범위 5,525~8,784ms였다. 기기 네트워크 왕복·화면 반영 시간과 별개다.

16:20 KST 또니망고네 갱신 6,024ms는 요청 준비·기존 상태 읽기 약 1,693ms, 시세 조회 약 1,708ms, 공급자 상태 기록 약 518ms, 자산 재조회·저장 약 1,604ms, 잠금 해제·완료 기록 등 약 501ms로 재구성된다. 시세 시작은 저장된 관측 시각에서 해당 요청 latency를 빼서 추정했으며 DB commit 시각과 구별한다. 공급자 조회는 모두 성공했다.

## 변경 계약

- JOB-AST-001, HOLD-003, HOLD-004: 전체 상태의 자산·명의·보유종목 조회를 함께 시작한다. 각 자산의 빈 positions subcollection까지 읽는 N개 쿼리를 가구별 collection-group 한 쿼리로 바꾼다. assetId 지정은 해당 자산 하위 조회를 유지하고, positions:false·automationPlans:false도 유지한다.
- canonical Position의 householdId가 부모 가구와 같은 writer/migration 계약을 사용한다. 반환 문서는 실제 `households/{householdId}/assets/{assetId}/positions/{positionId}` 경로와 부모 존재를 검사한다. 타 가구 식별자 위장·중첩·고아 문서는 포함하지 않는다. 쿼리 실패를 빈 성공으로 바꾸지 않는다.
- 계좌 종류 필터는 사용하지 않는다. 기존에 주식→예금 등 유형을 바꾼 계좌에도 Position이 남을 수 있으므로, cash/manual·유형 변경 후 보유종목의 평가 동작을 보존한다. ownerProfiles의 기존 소유자 정규화도 유지한다.
- 시세 조회 후 Provider Health 기록과 자산 transaction을 겹친다. Health의 동기 throw·비동기 실패는 격리하지만 작업을 버리지 않고, Health와 자산 저장의 완료·실패 정리를 기다린 뒤 lease를 한 번 해제한다.
- 저장 전 Asset·Position version 재검증, 전체 갱신 원자성, 부분 실패와 마지막 시세 보존, 재전송 receipt, Provider 동시성 5·기존 timeout/retry는 변경하지 않는다.

## 검증

- 관련 unit/contract 22파일 173개 통과. 별도 TypeScript 검사, architecture 43개, production Functions build 통과.
- 실제 Firestore Emulator 2파일 7개 통과. 새 4개 검사는 혼합 주식·예수금·수동 평가, 동일 요청 replay와 이벤트 중복 방지, 시세 대기 중 사용자 수량 수정 충돌, 유형 변경 후 평가, 잘못된 부모 경로 배제, 실제 Provider Health 저장과 지연 중 자산 commit·lease 유지를 확인한다. 외부 시세만 고정하며 운영 갱신 명령은 진단용으로 실행하지 않는다.
- 운영의 두 가구 Position 62개를 경로와 대조하여 householdId·assetId 누락/불일치 0개를 확인했다. 금융 데이터는 수정하지 않았다.
- 또니망고네 자산 19개 기준 상태 읽기 쿼리는 21→3개이고, 갱신 전후 두 번의 상태 조회는 42→6개다. 익태송희네 자산 20개는 각각 22→3개, 두 번 합계 44→6개다. 이는 읽기 호출 수이며 읽은 문서 수 또는 전체 갱신 시간의 같은 비율 감소를 뜻하지 않는다.
- 인덱스 READY 후 실제 운영 DB의 read-only transaction을 이전→변경→변경→이전 순서로 실행했다. 두 가구 모두 정렬 후 전체 상태 SHA256이 네 번 동일했다. 또니망고네 조회는 이전 458/291ms, 변경 155/192ms였고 익태송희네는 이전 271/252ms, 변경 168/189ms였다. 로컬 Admin SDK의 각 2회 표본이며 운영 서버의 전체 갱신 지연 비교는 아니다. 결과는 `%TEMP%/household-market-refresh-read-comparison-20261029.json`에 보존했다.

로그는 `%TEMP%/household-market-refresh-{unit,integration,build}-20261029.log`, 변경 전 운영 관측은 `household-market-latency-20261029.json`, `household-market-health-timing-20261029.json`에 있다.

## 배포 순서

1. 인덱스만 추가한 `e95ffbcb3588ac5887dbcf7ac054bf411afb4e9a`를 `release-20261029-market-index-e95ffbcb`로 먼저 배포했다. 기존 단일 collection 인덱스도 보존한다. 이 단계에서 서버 실행 코드는 바뀌지 않는다.
2. 인덱스 배포 API의 성공과 실제 사용 가능 상태는 다르다. 첫 운영 read-only 쿼리는 `index is not ready yet`로 거부됐다. 이후 COLLECTION_GROUP 및 기존 단일 collection 인덱스의 READY와 동일 쿼리 성공, 기존 로더 대비 전체 상태 일치를 확인한 뒤 서버 배포를 진행한다.
3. 이후 최종 서버 commit의 default·payment-capture·access-session codebase를 기존 wrapper로 배포하고 기본 smoke를 확인한다. Web·APK 변경은 없어 재발행하지 않는다. 두 commit을 함께 push한 최종 SHA의 다섯 CI 검사와 요약을 후속 확인한다.

운영 체감 개선 수치는 배포 뒤 자연스럽게 발생한 동일 범위 갱신 로그로 비교한다. 로컬 조회 속도나 제어된 병렬 검사 결과를 운영 전체 지연 감소로 보고하지 않는다.

## CI 후속: 월별 자동처리 동시 실행

`caf414dd1035490fef1fa928748dc77056a4ca61`은 세 codebase 배포와 기본 smoke를 완료했다. CI `40837415649`의 Functions unit·type·build·callable·Rules는 통과했고 실제 Firebase 통합 검사 156개 중 155개가 통과했다. 새 시세 갱신 통합 4개도 통과했다. 실패는 기존 `firebase-asset-automation-schedule.integration.test.ts:210`의 동일 월 동시 실행 한 건으로, `applied/already-processed` 대신 `applied/retryable-failure`를 받았다. 해당 실행은 실패 이력으로 유지한다.

실패 경로인 `FirebaseAssetAutomationRuntimeStore`는 이번 시세 로더를 호출하지 않는다. 에뮬레이터 로그에는 07:47:49 UTC 문서 읽기 `Transaction lock timeout` 뒤 문서·query 읽기의 `Can't swap from CLOSED to ACTIVE`, 07:47:52 query의 `Transaction is invalid or closed`가 있다. SDK는 callback 실패 시 rollback·재시도를 진행하지만 기존 `Promise.all`의 다른 read RPC는 취소하지 않는다. 이는 종료된 transaction의 후속 읽기와 부합하지만 요청별 ID가 없어 최초 오류와 정확한 인과·운영 재현 여부는 확정하지 못했다. 변경 전 로컬 같은 5개 검사는 모두 통과했다.

후속 수정은 추가 재시도 계층 대신 execution·receipt·Asset을 `getAll` 한 요청으로 읽고, claim 재생·유효성 검사 뒤 필요한 Revision query만 실행한다. 완료된 claim은 Revision 조회 장애에도 기존 결과를 재생하며, 문서 조회 실패 뒤 별도 query/write를 시작하지 않는다. 기존 같은 월 동시 2요청과 15초 제한, 성공/중복 기대값은 유지했고 receipt 1개·Outbox 2개·Asset/Plan version도 확인한다. 실패 때 결과·SDK 요청 로그·시도 횟수·최종 예외를 남긴다.

관련 unit 14개·type 검사가 통과했고 실제 Firestore Emulator의 자동처리 5개와 시세 갱신 4개가 모두 통과했다. 원래 CI 로그는 `%TEMP%/household-market-refresh-ci-40837415649.log`, artifact는 `household-market-refresh-ci-artifacts-40837415649/`, 재현/수정 검증은 `household-asset-automation-{reproduction,concurrency}-20261029.log`에 보존했다. 후속 서버 후보도 세 codebase를 배포하고 새 SHA의 전체 CI로 검증한다.
