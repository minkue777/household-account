# 실제 동작을 보호하는 테스트 경계

기준 SHA `12a582bf63bae7ad5b7c66bcfbf67ac96fb338da`. 본문을 읽은 정적 조사이며 테스트를 실행한 결과가 아니다. 파일별 범위는 [files.csv](files.csv), 세부 후보는 [재무 테스트](finance-tests.md), [플랫폼 테스트](platform-tests.md), [Web 테스트](web-tests.md), [수집 테스트](capture-tests.md)를 따른다.

## TB-01 — 저장 결과가 같다는 검사와 읽기·쓰기 비용 검사를 구별한다

`functions/test/integration/firebase/firebase-finance-command-adapters.integration.test.ts:425`와 `:519`는 대량 원장의 월 분할·항목 분할을 실제 Firebase 경로로 검사한다. 금액·계보·version·취소 결과 검증은 유효하다. 다만 무관 문서 하나의 `data()`와 version이 그대로라는 assertion(`:513`, `:605`)만으로 ‘전체 원장을 읽거나 재저장하지 않음’까지 입증하지 못한다. 같은 값을 다시 쓰거나 전체 조회한 뒤 일부만 변경해도 통과할 수 있다.

정비 시 저장 의미 검사는 유지하고, 조회 범위·반환 문서 수·쓰기 대상 또는 무관 문서의 updateTime을 실제 SDK 경계에서 관측한다. 내부 helper 호출 횟수를 고정하는 대신 기능의 데이터 접근 상한을 검사한다. 현재 제품이 전체 원장을 다시 저장한다는 발견은 아니다.

## TB-02 — 공유 schema 검사를 생산자·소비자 실행 검사로 부르지 않는다

`functions/test/contracts/payment-capture/capture-envelope.contract.test.ts:122`의 ‘producer 결과와 Payment Intake의 branch 해석이 일치’ 검사는 JSON fixture의 envelope와 같은 fixture의 expectedConsumer를 비교한다. JSON Schema/Ajv 검사와 예제 일관성 검사로는 가치가 있지만 실제 parser나 Payment Intake 실행이 아니다.

schema 검사는 그 역할에 맞게 이름과 추적성을 좁힌다. 실제 공급자 파싱·승인/취소/잔액 분기 보장은 기존 production-flow·adapter 검사와 `web/e2e/payment-capture.spec.ts`에 연결한다. fixture 전용 타입·해석 로직을 제품의 별도 복제 구현으로 키우지 않는다.

## 기능별로 유지할 실행 경계

| 계약 단위 | 현재 의미 있는 검사 경계 | 정비 시 유지할 것 |
|---|---|---|
| 지출·수입 수정/삭제 | Web UI → 실제 명령 HTTP 보류 → Emulator 저장 또는 version 충돌 | 응답 전 표시, 실패 rollback, 원래 초안, 늦은 응답 격리 |
| 분할·병합·취소 | 실제 application/store 및 Web 명령 → 원장·계보·receipt 재조회 | 월말·내림·태그·원승인 증거·자식 원자 변경·무관 거래 보존 |
| Android QuickEdit | 실제 Activity/Intent·Keystore·내구 outbox → 실제 Native Firebase → Web 조회 | 앱 종료/재시작, 태그/분할 초안, 실제 명령 지연·충돌, FIFO 후속 전달 |
| 가구·명의·권한 | 실제 Auth/Callable/Rules → 멤버·claim·profile·원장 조회 | 자기 UID, 일회 초대, 논리 삭제·복구, 다른 가구 거부, 참조 ID 보존 |
| 결제 수집 | 실제 HTTP/Auth/parser → 원장·잔액·provenance·receipt | 원문과 카드 증거, 부분 실패만 재시도, 동일 요청 멱등, 취소 후 승인 재생 금지 |
| 카드·규칙 | 설정 UI → 실제 command → 다음 raw 수집 | 과거 카드 표시, 우선순위, exact 기억 정책, category archive 원자 반영 |
| Shortcut | 실제 credential 발급/회전 → 실제 HTTP/parser/store | 구 키 즉시 거절, 비밀값 비저장, 정상 거절과 시스템 실패 분리 |
| 자산·보유·예약 | UI/명령·실제 exported scheduler → Firestore | 부모 평가/version, stale position 거부, 같은 월 중복 반영 금지, 삭제 후 이력 보존 |
| 시세·분배금 | 외부 HTTP 원문만 fixture → 실제 provider adapter/scheduler/store | 시장별 계산, 마지막 성공값, 공시·기준일 수량, fixed→paid 및 삭제 후 기록 |
| 종목 검색 | 실제 provider adapter·Storage SDK·gzip/checksum·IndexedDB → 검색 UI | 신규 종목·ETF 구분, 500개 결과 접근, 검색 초기화, 원격 실패 시 검증된 캐시 |
| 통계 | 실제 SDK → 유효/손상 문서 변환 → 화면 | 실패와 실제 0원 구분, 기간 baseline, 캐시 재사용, 분배금 이력 |
| 홈·PWA | 실제 Listen 응답 관측 / production worker·SDK·지연 proxy | 저장값 전달, worker 교체·미저장 입력·static cache·현재 build ID |
| 이관·정리·배포 | 공개 CLI subprocess → demo Emulator / artifact·scope guard | 원본 hash, 승인 범위, 부분 재개, drift 거부, 정밀 Timestamp·비밀값 보호 |

외부 공급자 HTTP fixture는 외부 서비스의 현재 가용성 검사가 아니다. 브라우저의 합성 push/click과 Android emulator 역시 실제 OS·실기기 성능을 전부 증명하지 않는다. 준비 상태와 보장 범위를 정확히 표현하면서 실제 앱 경로의 검사는 보존한다.

## 테스트도 단순하게 정리하는 순서

1. 상수 `0`·빈 배열·고정 문자열 목록을 돌려주는 관측은 실제 저장/전송 경계의 검사와 연결한 뒤 제거한다.
2. 내부 함수 이름·폴더·줄 수·우연한 호출 횟수를 고정하는 assertion은 행동·비용 계약으로 바꾼다.
3. 앞 테스트의 callback·mutable fixture를 재사용하는 준비는 각 테스트가 직접 만들게 한다.
4. fixture 안의 취소·중복·해시·권한 엔진을 줄인다. 순수 정책은 실제 제품 함수를 호출하고 외부 경계만 작은 대역으로 둔다.
5. 실제 거래/receipt/outbox의 원자성, 경쟁 수정, 복구 검사는 같은 계약의 정비가 끝날 때 함께 검증한다.

더 큰 범용 테스트 프레임워크를 만드는 작업은 제안하지 않는다. 실제 Activity 내부의 private 함수를 reflection으로 부르는 준비도 해당 기능을 정비할 때 필요한 실제 저장 상태를 준비하는 방식으로 줄일 수 있지만, 테스트 편의만을 위해 제품에 새 추상화 층을 넣지 않는다.
