# Web 테스트 본문 정적 조사

기준 SHA `12a582bf63bae7ad5b7c66bcfbf67ac96fb338da`, 2026-10-05. 제품 수정·테스트 실행·build·브라우저 실행·운영 데이터 변경은 하지 않았습니다. 아래 판단은 실제 테스트의 준비, mock, 호출, assertion, cleanup과 관련 제품 경계를 읽은 결과이며 검사 통과나 장애 재현을 의미하지 않습니다.

## 범위

Web Jest·브라우저 E2E와 helper, 성능/PWA 시나리오의 본문을 검토했다. 관련 파일 160개를 분담 검토하고 통합했으며 최종 중복 제거 상태는 [files.csv](files.csv)를 따른다. 실제 브라우저 경계는 [Web E2E](web-e2e.md)와 [검증 경계](test-boundaries.md)에 함께 정리했다.

## 우선 정리 후보

### WT-01 · 원장 optimistic 수정: 읽기 전용 metadata, expectedVersion, 즉시 반영/rollback

- 근거: `web/src/__tests__/features/ledgerExpenseServiceOptimistic.contract.test.ts:219`.
- 판단: projection.current의 내부 호출을 정확히 두 번으로 고정합니다. 이미 외부 command와 metadata/최종 값 assertion이 있어 한번 조회하는 단순화도 실패시킵니다.
- 없앨 요소: prototype.current 호출 배열의 exact2 assertion.
- 남길 계약: 서버 command payload/version, provenance metadata, rollback, 늦은 응답 격리.
- 확인 단위: 같은 계약 테스트에서 canonical 필드와 pending/실패/완료 결과를 검증하고, 실제 비용 상한이 필요하면 별도 명시 계약으로 두기.
- 확신도: high; 분류: low-risk.

### WT-02 · 원본 선택·월분할 command/lineage

- 근거: `web/src/__tests__/features/expenseDetailModalOwnership.contract.test.tsx:266`.
- 판단: 월분할 helper mock에 deleteExpense:onDelete가 전달되는 구현 형태를 고정합니다. 실제 미사용 인자 제거 후보와 함께 없앨 수 있습니다.
- 없앨 요소: 미사용 deleteExpense 인자에 대한 mock 호출 assertion.
- 남길 계약: 분할 시작 거래와 version, months, 실제 command/lineage 보존.
- 확인 단위: 분할 통합/명령 테스트로 삭제·자식 생성 의미를 보존; modal stub은 소유 범위 검증으로 한정.
- 확신도: high; 분류: low-risk.

### WT-03 · 홈 설정 편집 version 고정·중복 카드 저장 거부

- 근거: `web/src/__tests__/features/homePreferencesSettings.test.tsx:4`.
- 판단: 첫 테스트가 module mockPreference.version을2로 변경한 뒤 두 번째가 이를 spread합니다. beforeEach 초기화가 없어 개별 테스트와 전체 실행의 fixture가 다릅니다. 실제 실패를 관측한 것은 아닙니다.
- 없앨 요소: 테스트 간 mutable fixture 상속.
- 남길 계약: 최신 구독 중 edit-start version 유지, 실패 초안, 지역화폐 별도 저장, 중복 카드 거부.
- 확인 단위: 각 테스트 fresh fixture와 mock reset; 개별/역순 실행해 동일한 준비조건 보장.
- 확신도: high; 분류: low-risk.

### WT-04 · PUSH-008 endpoint 등록: 서버 성공 뒤 active, 진행단계 순서

- 근거: `web/src/__tests__/platform/pwaFidEndpointLifecycle.contract.test.ts:157`.
- 판단: 동일한 registering 상태가9번/7번 나오는 exact 횟수 assertion은 뒤의 의미 있는 phase 순서 검증과 중복됩니다. 동일 상태 중복 발행 제거도 막습니다.
- 없앨 요소: 연속 동일 status의 exact 횟수 고정.
- 남길 계약: 서버 성공 전에 active 미발행, phase 순서와 안전한 오류 진단, 재등록/연결 횟수의 외부 side effect 계약.
- 확인 단위: consecutive duplicate 상태를 축약한 전이 순서 또는 active 진입 조건과 phase assertions.
- 확신도: high; 분류: low-risk.

### WT-05 · PUSH-004/PUSH-011 malformed payload 차단, actor 변경 뒤 늦은 callback 격리

- 근거: `web/src/__tests__/platform/pwaFidEndpointLifecycle.contract.test.ts:119`.
- 판단: 부정 payload 테스트는 자체 activate 없이 module-level mockForegroundHandler?.(...)를 호출합니다. handler가 없으면 호출 자체가 생략되어 알림 없음 assertion만 성립합니다. actor 변경 테스트도 이전 활성 callback 준비를 자체 수행하지 않습니다. 앞 테스트 상태에 의존하는 정적 구조이며 이번에 단독 실행은 하지 않았습니다.
- 없앨 요소: 앞 테스트가 남긴 활성 binding/callback에 의존하는 준비와 optional-call에 의한 무호출.
- 남길 계약: 실제 callback을 거친 invalid payload 거부, 이전 actor의 늦은 등록/foreground 무간섭.
- 확인 단위: 각 테스트에서 activate→callback 존재 assertion; 유효 positive control 확인→잘못된 payload 또는 scope 변경 뒤 저장한 callback 호출; 실제 SDK/background browser 검사는 별도 유지.
- 확신도: high; 분류: test-validity.

### WT-06 · 자산 조회 실패·정상 빈 값 구분(UI-01)

- 근거: `web/src/__tests__/features/portfolio/householdHoldingSnapshots.contract.test.ts:164`, `web/src/__tests__/features/portfolio/holdingManagerSnapshot.contract.test.ts:1`, `web/src/__tests__/features/portfolioAssetStartupSync.contract.test.ts:454`.
- 판단: 현재 본문은 부분 구독 setup 실패 cleanup과 자산 저장대기 rejection/rollback을 검증합니다. 이는 유효한 좁은 검사이나 listener 오류→snapshot hook→manager UI에서 실패를 0/빈 보유로 표시하지 않는다는 근거는 아닙니다.
- 없앨 요소: 제품 read 상태 소유 단순화 시 중복 ready fake에만 의존하는 포괄 성공 주장.
- 남길 계약: 부분 구독 cleanup, stale callback 무시, 대기 저장 실패와 rollback.
- 확인 단위: 실제 service→hook→manager 경로의 listener 오류/정상빈/기존snapshot보존 회귀를 추가; canonical조회 실패를 fake가 성공빈으로 대신 만들지 않기.
- 확신도: high; 분류: coverage-boundary.


가장 작은 첫 작업은 WT-01 내부 조회 exact2 제거, WT-02 미사용 분할 인자와 assertion 동시 제거, WT-03 각 테스트 fixture 초기화입니다. WT-05는 제품을 건드리지 않고도 검사 자체가 실제 callback을 호출하도록 준비를 명확히 할 수 있습니다. 어느 것도 권한·version 충돌·idempotency·rollback의 동작 검사를 줄이라는 제안은 아닙니다.

## 유지할 정당한 복잡성

- 원장/자산 projection·FIFO 검사는 응답 전에 표시, 선행 실패의 후속 취소, 두 구독의 늦은 snapshot, 가구·session 변경, query 이동, version floor를 실제 명령 payload와 최종 값으로 검증합니다. 이름이 비슷한 여러 case가 서로 다른 race를 겨냥하므로 줄 수를 근거로 합치거나 없애면 안 됩니다.
- `portfolioAssetStartupSync.contract.test.ts`의 1,333행은 캐시/권위 snapshot·안전한 비중복 필드 rebase·충돌시 한번 재시도·시세만 바뀐 position·delete/reorder FIFO를 구분합니다. 이 복잡성은 제품 상태 소유 후보를 고친 뒤에도 보존할 계약입니다.
- 원장 incremental snapshot의 data() 1회와 source2000 비교, 서버 read 페이지·횟수·최대50,000건 검사는 실제 I/O 또는 계산 비용과 completeness 계약입니다. WT-01의 우연한 내부 호출 exact2와 동일하게 취급하지 않았습니다.
- 첫 React commit의 Profiler/server-render assertion은 passive effect 전에 이전 가구 금액/명의가 잠시 보이는 문제를 검출하는 경계입니다. 단순 마지막 화면 assertion만으로 대체하지 않습니다.
- chart renderer를 data/options 캡처로 대체한 unit은 데이터와 객체 안정성 검증으로 유효합니다. canvas 실제 animation/paint 검증이라고 확대 해석하지 않습니다.
- Android bridge envelope/version/scope, 구 APK unknown operation, Web/Auth session-generation, late completion과 ack의 분리는 필요한 호환·안전 계약입니다. SDK fake를 사용했다고 삭제할 이유가 되지 않습니다.
- `pwaWorkerNotification.test.ts`는 실제 worker entry handler를 실행하되 Firebase SDK/clients 경계를 대체합니다. 실제 generated worker/SDK/CDP PushEvent를 사용하는 `e2e-pwa/worker-events.spec.ts`와 역할이 달라 중복으로 보지 않았습니다.

## 성능·PWA 4개 추가 검토

`e2e-performance/fixtures.ts`는 실제 Auth/가구·초대·가입 Command를 준비하고, 다량 합성 원장/과거 snapshot만 Emulator REST로 심습니다. 자산·position은 실제 Command로 만들며 manual quote로 외부 시세 지연을 분리합니다. catalog는 Firebase Storage 요청 URL만 실제 HTTP fixture로 바꾸며 SDK decode/gzip/checksum/cache 경로를 유지합니다. 실제 공급자 가격·네트워크 성능을 측정한 결과로 읽으면 안 됩니다.

`scenarios.spec.ts`는 fresh context와 같은 context의 새 문서를 구분하고, 초기 service-worker 설치 준비 대기를 홈 측정값에서 제외한다고 표시합니다. 36개월 원장/전체 검색·지출/자산 통계·메모/카테고리·생성/삭제까지 표시 조건과 canonical 저장 확인을 함께 둡니다. CSS selector와 DOM 준비 검사가 많다는 사실만으로 후보를 추가하지 않았습니다. 측정 도우미도 본문을 확인했으며 이 문서가 실제 기기 지연 수치를 새로 보증하지 않는다.

`production-runtime.spec.ts`는 실제 production build에 지연 HTTP proxy를 붙여 미완료 조회 중 worker 교체, CSP 차단, 제한된 static cache, version handshake를 검사합니다. 복잡한 proxy와 lifecycle 진단은 실제 worker 활성화 수명 검증을 위한 것으로 유지 판단입니다.

`worker-events.spec.ts`는 OS click 전달 일부를 합성하면서 실제 worker handler·navigate를 실행하고, focus가 사용자 활성화 부재로 거절되는 한계를 명시합니다. CDP push 수신도 단순 요청 접수 대신 실제 PushEvent 완료를 기다리고 SDK foreground/background와 malformed payload 차단을 검사합니다. 실제 OS focus/openWindow 실기기 검증으로 확대 해석하지 않습니다.

## 한계

본문 검토만 수행했다. 기존 CI 성공을 이번 정비의 검증 결과로 재사용하지 않으며 모든 race나 브라우저별 동작을 재현한 것은 아니다.
