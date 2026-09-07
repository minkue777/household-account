# 자주 쓰는 지출 수정 경로 최적화

## 조사 범위와 기준

메모 추가, 카테고리 변경, Android QuickEdit의 화면 반응·서버 저장·통계 후속 조회를 조사했다. 기존 로컬 최적화는 유지했고 운영 데이터 수정, 알림 발송, 커밋·push·배포는 수행하지 않았다.

기존에 확보한 운영 로그의 `ledger.update-transaction.v1` 성공 표본은 7건이며, 서버 total 평균은 486.0 ms, 최대 943.3 ms였다. 메모/카테고리별·클라이언트별 식별 정보가 없으므로 이 값을 특정 수정 방식의 평균으로 해석하지 않는다.

그중 공통 command receipt가 별도로 실행된 한 건은 다음과 같다. 2026-09-07 21:05:34 KST, Functions revision 35, 프로세스 내 첫 호출이다.

| 단계 | 소요 시간 |
| --- | ---: |
| 권한·멤버십 확인 | 270.825 ms |
| 공통 receipt claim | 98.535 ms |
| 실제 ledger handler | 221.090 ms |
| 공통 receipt complete | 68.962 ms |
| 서버 total | 662.298 ms |

두 공통 receipt 단계 합계는 167.497 ms다. 이중 기록 경로가 실제 발생했고 비용이 있다는 근거이며, 해당 요청이 Android였다는 증거나 배포 후 평균 167 ms가 줄었다는 증거는 아니다. 서버 total은 기기의 전체 네트워크·화면 표시 시간과도 다르다. 재분석한 자료는 로컬 임시 디렉터리의 `household-admin-latency-stages-20260907.json`이다.

## 확인한 병목

### 카테고리 검사와 거래 조회

카테고리를 바꾸는 명령은 handler에서 활성 카테고리 목록을 먼저 모두 읽은 뒤 domain receipt와 거래를 조회했다. 카테고리 검증은 이 두 조회의 결과에 의존하지 않는다. 메모만 바꾸는 명령은 기존에도 카테고리를 조회하지 않았다.

### QuickEdit의 이중 영수증

기존 Android envelope factory는 `commandId=android:<operationId>`, `idempotencyKey=android-quick-edit:<operationId>`를 사용한다. 서버는 domain receipt를 가진 UPDATE/DELETE에서도 두 키가 다르면 공통 receipt를 추가 실행한다. 서버 권위 전환 당시 도입된 prefix 관례와 이후 추가된 단일 receipt 경로의 조건이 맞지 않았다.

기존 outbox 항목의 식별자를 바꾸면 재시도 계약을 훼손할 수 있으므로, 신규 UPDATE/DELETE의 생성 방식만 바꾸고 이미 저장된 envelope는 그대로 사용해야 한다. 앱 업데이트 직후 동일한 pending 작업이 다시 제출되는 경우에도 기존 저장본을 보존해야 한다.

### 통계의 후속 재조회

메모·카테고리 수정 성공도 통계의 모든 완성된 범위를 무효화했다. 통계 화면 안의 저장/삭제 handler는 명령 계층의 공유 무효화에 더해 페이지 자체 강제 새로고침도 요청했다. 동시에 시작하면 진행 중 조회를 공유하지만, 첫 조회가 먼저 완료되면 추가 전체 조회가 발생할 수 있다.

## 변경하지 않은 경로

- 웹 수정 화면은 이미 바뀐 필드만 전송하고 로컬 원장에 즉시 반영한다. 실패 시 원복과 오류 안내를 유지한다.
- QuickEdit는 결제 수집 응답의 snapshot이 있으면 거래를 다시 조회하지 않는다. 변경 없는 저장은 명령을 전송하지 않는다.
- QuickEdit 화면 닫기는 서버 완료가 아니라 암호화 outbox 저장과 WorkManager의 영속 예약을 기다린다. 이를 더 앞당기면 저장 유실 가능성이 생기므로 유지한다.
- 서버는 기본 수정마다 전체 가구 설정이나 가맹점 규칙을 읽지 않는다. 가맹점 기억 옵션을 선택한 경우에만 규칙 충돌 검사에 필요한 조회를 수행한다.
- Android 복귀 시 멤버십 확인·원장 재구독은 추가 후보로 남겼다. 다른 기기의 수정과 세션 권한 변경을 확인하는 역할이 있어 이번에는 갱신 간격이나 최신성 정책을 바꾸지 않는다.

## 구현과 확인 결과

### 카테고리 변경

요청 안에서만 사용하는 비동기 카테고리 검증을 receipt·거래 조회와 함께 시작한다. 카테고리 100 ms + 거래 100 ms의 제어 검사에서 commit 시작까지 100 ms가 걸린다. 기존 직렬 순서는 200 ms가 필요하다. 과금되는 카테고리 문서 수는 같으며 서버 권한 검증 이전에는 이 조회들을 시작하지 않는다.

완료된 domain receipt는 현재의 카테고리 조회 실패·지연과 무관하게 재생하도록 보완했다. 이는 기존 handler에서 카테고리 장애가 이미 성공한 명령의 재시도까지 실패시키던 동작을 의도적으로 바꾸는 것이다. 새로운 명령의 카테고리 조회 실패와 거래 오류 우선순위, 버전 충돌 검사는 유지한다. 동기 throw와 늦은 Promise 거부도 관찰하므로 미처리 rejection을 만들지 않는다.

### QuickEdit

신규 UPDATE/DELETE만 두 식별자를 `android:<operationId>`로 통일한다. 분할·알림·단말 등록 등 다른 명령은 기존 형식을 유지한다. 구버전 pending 요청의 재접수는 scope·거래·command·payload·기타 envelope 필드가 모두 동일하고 구형 prefix에서 신형 prefix로의 전환만 있는 경우에 한해 이미 수락된 것으로 처리한다. 기존 저장 envelope와 접수 시각, 재시도 식별자는 변경하지 않는다.

실제 Router→ledger handler→Firebase 저장소 어댑터를 연결한 테스트에서, 동일 키의 재실행은 domain receipt를 재생하고 다른 payload는 `IDEMPOTENCY_PAYLOAD_MISMATCH`로 거부한다. 공통 receipt I/O는 0회이며 도메인 receipt와 outbox 사건은 각각 1개만 저장된다. 운영 로그의 167.497 ms는 과거 한 표본의 해당 단계 비용이고 새로운 APK의 실측 개선값은 아니다.

### 메모·카테고리 수정 후 통계

완성된 캐시에 수정 대상의 정확한 직전 버전이 있고, 서버의 성공 응답이 그 다음 버전이며 가구·거래 ID·활성 상태·날짜·금액·거래 유형·가맹점이 일치할 때만 memo/category/version을 반영한다. 카드·분할·병합 메타데이터, 캐시의 기존 수신 시각과 세션/remote epoch는 보존한다. 다른 필드를 수정하거나 증명 조건을 만족하지 못하면 기존 전체 무효화를 사용한다.

진행 중인 조회가 하나라도 있으면 부분 갱신하지 않는다. 복귀 시 시작한 최신성 확인을 중단한 뒤 과거 캐시를 최신처럼 재사용하는 상황을 방지하기 위해서다. TTL은 늘리지 않고, 첫 진입·재진입·포커스·복귀 시 서버 확인도 유지한다. 따라서 주요 효과는 통계 화면에서 바로 수정한 경우의 후속 전체 조회 제거와 재진입 즉시 표시할 내용의 정확성이다.

페이지의 저장·삭제 handler가 별도로 요청하던 강제 갱신을 제거하고 명령 계층의 공유 revision을 사용한다. 첫 갱신이 폼 종료보다 빨리 끝나는 조건에서 발생하던 추가 조회 1회를 막았다. 원격 실패 시 입력·선택 기간·상세 화면 보존과 재시도는 유지한다.

실제 ledgerCommands→통계 캐시→통계 페이지를 연결한 UI 검사에서 메모와 카테고리 각각 저장 후 추가 원격 조회는 0회이며, 다음 편집은 갱신된 version 2로 저장한다. 포커스 복귀 시에는 다시 조회한다. 이는 모의 서버 응답을 사용한 호출 수 검증이며 실제 휴대전화의 시간 측정은 아니다.

## 로컬 검증

- Functions 전체 `test:quality-gate`: 319개 suite / 2,778개 검사 통과, 기존 별도 integration용 78개 skip. 테스트 타입 검사·런타임 경계·architecture 38개 및 production build 통과.
- Web 전체: 97개 suite / 592개 검사 통과. 이 중 통계 페이지의 실제 편집 UI 연결 검사 19개와 확인 응답 기반 캐시 갱신 검사를 포함한다.
- Firebase Emulator 브라우저 E2E: 로그인·지출 CRUD·통계 기간 전환·알림 편집 주소 진입 흐름 1개 통과. 호스트 Node 24를 사용한 로컬 검증이며 운영 설정은 Node 22다.
- Web production build와 별도 TypeScript 검사 통과. 정적 HTML 12개·CSP hash 25개·root worker 1개 산출물 검증과 해당 빌드의 PWA E2E 2개도 통과.
- Android: `testDebugUnitTest` 25개 class / 114개 검사, `lintDebug`, `assembleDebug`, `assembleRelease` 통과.
- Android `connectedDebugAndroidTest`: 격리 API 36.1 에뮬레이터에서 16개 통과, 실패·오류·skip 0. CI의 API 34와는 환경이 다르다. 테스트 후 에뮬레이터는 종료하고 기존 AVD 데이터는 보존했다.

주요 로그는 로컬 임시 디렉터리의 `frequent-edit-functions-gate.log`, `frequent-edit-web-tests.log`, `frequent-edit-web-page-tests.log`, `quick-edit-identity-android-gate.log`, `quick-edit-identity-android-instrumentation.log`다. Android의 구버전 pending 재접수·payload/scope/명령 차이·terminal 상태 거부와 기존 FIFO/만료 정책을 포함해 검증했다.

최종 브라우저·빌드 로그는 같은 디렉터리의 `frequent-edit-web-e2e.log`, `frequent-edit-web-build.log`, `frequent-edit-web-pwa.log`에 있다. 기준 Git HEAD는 `5d66067147807a3e542833f53939318d4c8ac834`이며 변경은 로컬 작업 트리에만 있다. 실제 운영 개선 폭은 배포 후 같은 명령·클라이언트·성공 여부 조건으로 비교해야 한다. QuickEdit의 신규 식별자 경로는 수정된 APK를 설치한 뒤 생성하는 요청부터 적용된다.
