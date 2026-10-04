# Finance·Capture·Portfolio·Reporting·알림 테스트 보강 조사

2026-10-05, 읽기 전용 검토입니다. 제품 파일 수정, 테스트 실행, 빌드, 운영 데이터 접근은 하지 않았습니다. [재무](finance.md)와 [서버 경계](server-boundaries.md)에 같은 후보를 반복하지 않고 테스트 소비 경로에서 확인한 추가 근거를 기록합니다.

## 범위

관련 테스트·fixture 186개를 분담해 본문 검토했다. 전체 파일의 최종 상태는 [files.csv](files.csv)를 따른다. 추가 후보와 기존 FIN 후보의 테스트 연결만 아래에 남겼다.

## 추가 후보

### FT-01 / P2: 실제 동작과 연결되지 않는 상수 관측을 없애기

**확신도 높음.** API 표면·삭제 여부·재전송 여부를 증명하는 듯한 일부 assertion이 실제 호출이나 저장 효과가 아니라 fixture의 고정값을 검사합니다.

| 계약 | 근거 | 확인한 문제 |
| --- | --- | --- |
| CAT-002 / T-CAT-003 | `functions/test/support/category-catalog-fixture.ts:207`; `functions/test/contexts/household-finance/categories-budget/category-catalog.contract.test.ts:190` | `publicCommands()`가 fixture 안의 문자열 7개를 반환하며 실제 handler registry를 소비하지 않습니다. 또한 `not.toEqual(arrayContaining([A, B]))`는 A와 B가 동시에 있지 않음만 검사해서 하나만 추가되어도 통과합니다. |
| AST-006 / T-AST-002/T-AST-008 | `functions/test/support/asset-lifecycle-workflow-driver.ts:527`; `functions/test/contexts/portfolio/asset-lifecycle-workflow.contract.test.ts:133` | `physicalDeleteAttemptsFromUserDelete()`가 항상 0을 반환합니다. |
| PUSH-008/PUSH-010 | `functions/test/support/delivery-reconciliation-driver.ts:157`; `functions/test/contexts/notifications/delivery-reconciliation.contract.test.ts:71` | `providerSendCalls()`가 고정 `[]`입니다. reconciliation 자체에는 provider port가 없다는 설계는 맞지만 이 assertion만으로 실제 dispatcher/runner의 재전송을 검증하지 못합니다. |
| Shortcut credential 보안 | `functions/test/support/shortcut-credential-storage-installer-fixture.ts:73` | `rawSecretsAtRest`와 `auditLogs`가 고정 `[]`입니다. 실제 소비 계약과 재발급 경합 문제는 [수집 테스트](capture-tests.md)로 연결합니다. |

더 작은 설계는 별도 상태 관측 API를 유지하지 않고 **실제 경계에서 관측하는 검사 하나로 모으는 것**입니다. 카테고리는 실제 등록된 command 이름과 금지 명령의 dispatch 결과를 검사하고, 삭제는 실제 Firebase store의 write/delete 효과를, 재전송은 실제 composition의 provider spy를 검사합니다. 이미 `functions/test/adapters/firebase/portfolio-runtime-store.test.ts:571`에서 실제 runtime→store를 통해 논리 삭제 후 position/history/dividend/automation 보존을 검사하고, `functions/test/adapters/firebase/notifications/notification-outbox-production-flow.test.ts:154`에서 실제 reconciliation 및 provider spy를 검사합니다. 이 실경계 검증은 보존하면서 상수 관측 helper와 중복 assertion을 줄일 수 있습니다.

필요 검증: 금지 카테고리 명령 각각을 등록했을 때 실패하는 검사, soft delete 시 종속 문서의 실제 잔존과 lifecycle/version, 중단 sending 복구를 반복해도 provider 호출 0건, credential 저장 필드·실제 logger 인자에 원문이 없는지. 상수 assertion을 지우는 것으로 검증을 완료했다고 보지 않아야 합니다.

### FT-02 / P2: Capture 조율용 fixture가 별도 금융 엔진을 구현하는 범위 줄이기

**확신도 높음.** 조율 계약을 검증하는 fixture 안에 실제 제품과 다른 취소·중복·잔액·fingerprint 계산을 유지합니다.

- `functions/test/support/capture-submission-receipt-driver.ts:154`의 `CaptureLedgerFixture`는 거래 생성, fingerprint claim, 취소 대상 선택, lineage 삭제, event 생성까지 구현합니다. `:210`의 취소는 같은 날짜와 분, 현재 금액, 가맹점, 카드 표기를 일치시킵니다. 제품 취소 경로는 기간 내 후보·불변 원거래 금액/카드 증거·구조 변경 그래프를 판정하므로 동작이 이미 다릅니다. `:353`의 잔액 fixture도 실제 stale/version 정책과 별도의 모형입니다.
- `functions/test/support/capture-branch-receipt-fixture.ts:99`는 production 클래스와 같은 이름인 `Sha256CapturePayloadFingerprint`를 별도로 정의하고 `:153`에서 자체 배열 해시를 계산합니다. 실제 `functions/src/adapters/firebase/payment-capture/firebaseCaptureSubmissionReceiptStore.ts:88`는 verifiedRawInput 분기, paymentKind/billDueDate, `sha256:` 접두사를 포함합니다. fixture는 이 계약을 따르지 않습니다.
- 조율 fixture는 이 해셔를 `capture-submission-receipt-driver.ts:473`와 `balance-branch-integration-driver.ts:243`에서 사용합니다. 실제 fingerprint·CAS는 별도 `functions/test/adapters/firebase/capture-submission-receipt-store.test.ts`가 production 구현을 소비해 검사하고 있습니다.

더 작은 설계: branch receipt 조율 단위 검사는 downstream port가 반환할 `recorded/rejected/retryable/cancelled` 결과와 호출 관측을 명시적으로 제공하고, 내부 금융 상태를 재구현하지 않습니다. fingerprint 계약을 검사하는 경우 실제 순수 production 해셔를 사용하고, 조율만 검사하는 경우 의미를 명확히 한 opaque fingerprint stub으로 둡니다. 생성·중복·취소·잔액 결과의 실제 연결은 기존 production-flow/store 검사에서 확인합니다.

보존 계약: ING-009/BAL-005의 동일 root key payload 충돌, terminal branch 재호출 금지, 부분 실패 branch만 재시도, 원장 멱등성, 취소 시 불변 원거래 증거 및 lineage 보존. 실제 제품 경로를 통과하는 `capture-ledger-cancellation-safety.test.ts`, `capture-ledger-persistence.test.ts`, `raw-capture-production-flow.test.ts`, `capture-submission-receipt-store.test.ts`를 유지해야 합니다. 특히 Samsung/지역화폐 취소의 30일 경계와 gross/net, 부분취소 아닌 전체 취소, 카드 증거와 잘못된 lineage 거절 검증을 fixture 교체 과정에서 축소하면 안 됩니다.

## 기존 주요 후보에 추가한 근거

**FIN-09 및 FIN-03/04: 정기 계획 whole-state 저장·조회 대체 경로.** `functions/test/support/recurring-plan-management-fixture.ts:75`는 전체 plans/receipts/events를 복제해 read/transact하며 bounded list API를 제공하지 않습니다. `recurring-plan-management.contract.test.ts`의 목록·cursor 검사는 이 경로를 소비합니다. `functions/test/support/recurring-processing-fixture.ts:56`도 전체 상태 transaction/read와 별도 publishedEvents 배열을 제공하고, `:91`은 세 종류의 저장 실패를 실제 저장 지점이 아니라 같은 commit 이전 분기로 흉내 냅니다. 따라서 단순화할 때 fixture 때문에 제품에 남은 선택적 whole-state fallback과 no-op publish 포트를 함께 정리할 근거가 있습니다. 다만 이들은 실제 application을 호출하므로 전부 독립 제품 모형이라고 부르지는 않습니다. 원자성의 최종 증거는 이미 있는 실제 Firebase adapter/Emulator 검사이며, 해당 검증은 [실제 검증 경계](test-boundaries.md)의 보존 대상이다.

필요한 검증 단위는 작은 계획 단일 변경에서 대상 계획+receipt만 조회/쓰기하는지, 실패 시 계획/receipt/outbox 전체 무변경, 동일 plan/month 중복 없음, bounded due page의 한 계획 내 다음 월 checkpoint 보존입니다. `functions/test/adapters/firebase/finance-bounded-runtime-read-regression.test.ts`가 실제 bounded 경로의 보존 대상입니다.

**FIN-02: 현재 UI와 분리된 reporting 모형.** 추가 support 3개도 읽었습니다. authoritative-action fixture는 자체 transactions/version/receipt/event를 만드는 gateway이고, bounded-reporting fixture는 queryKey별 응답을 제공합니다. 이는 기존에 확인한 생산자/소비자 연결 부재의 추가 근거이며 별도 새 후보로 세지 않습니다. 삭제 또는 현행 경로로 이동하기 전에 [Web 경로 검토](web.md)와 함께 결정해야 합니다.

## 유지해야 할 복잡성과 조사 결론

- Ledger 분할·병합·원복은 실제 application을 통과하며 원금 내림, 월말 보정, stale version, 원본 provenance, leaf 평탄화, 불완전 복원 fail-closed, 사용자 삭제 leaf의 재생성 방지 등을 검증합니다. 구조가 긴 것은 이 계약을 설명하는 데 필요한 부분입니다.
- Capture receipt의 CAS 병합·terminal 불변·완료 후 TTL, 취소의 immutable evidence/과거 graph 처리, 실제 handler의 authority와 카드 설정 재조회 실패 분류는 유지해야 합니다.
- Local Currency의 signed integer, observedAt/observationId 순서, stale receipt만 확정, 유형 미상 legacy를 임의 지역으로 바꾸지 않음, 거래와 잔액 branch 독립 완료를 유지해야 합니다.
- Notifications의 전송 직전 membership/binding 재확인, provider 결과 불명 시 재전송 금지, TTL, 요청자 제외 fan-out, 푸시 수신 제외, 다른 가구 purge 보존은 실제 테스트의 가치가 높습니다. provider 모형을 쓰는 것 자체는 문제가 아니며 고정 관측값만 구분해야 합니다.
- 시세 갱신의 lease/실패 후 재개, 동일 종목 중복 호출 방지, FX 공유와 시장별 quote identity, 자산 삭제 시 이력 보존을 유지해야 합니다.
- 저장소 통합 테스트는 실제 운영 스크립트의 순수 검증을 호출해 timestamp 나노초·0원·기존 priority·알 수 없는 필드·불일치 시 무변경을 검증합니다. 오래된 이관 지원이라는 이유만으로 삭제하지 않습니다.

읽은 122개에서 위 FT-01/FT-02 외에는 새로운 단순화 후보를 억지로 늘리지 않았습니다. 실행해 실패를 재현한 감사는 아니며, 현재 동작 회귀나 운영 오류가 있다고 단정하지 않습니다. 개별 파일의 검토 상태는 통합 files.csv에 기록했다.
