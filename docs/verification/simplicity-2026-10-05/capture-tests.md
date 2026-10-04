# 결제 수집 계약 테스트 후속 정적 검토

- 범위: `functions/test/contexts/payment-capture/`의 22개, 7,798줄. 모든 파일 본문을 읽었습니다. 파일별 상태는 [files.csv](files.csv)에 있습니다.
- 제품 수정, 테스트 실행, 네트워크·배포는 하지 않았습니다. fixture 근거는 [재무 테스트](finance-tests.md)와 통합했다.
- 선언 외 소비자 검색 범위: `functions/src`, `functions/test`, `web/src`. 이 보고서는 실제 운영 장애 재현 결과가 아닙니다.

## 계약별 실제 검증 경로

| 계약 | 테스트 진입 → 대상 → 관측 | 판단 |
|---|---|---|
| AND 수집·T-PARSE·ING-SAVE | golden/raw-notification driver → 실제 parser/raw submission application → typed 결과·downstream 입력 | 원문 경계·서버 parser 선택·PII 제거·현재 메시지 우선·도시가스 날짜 검증은 유효 |
| CAN·CAPTURE receipt | Capture submission application → receipt store fake + 별도 ledger 모형 → receipt/취소/이벤트 | receipt 재전송 계약은 필요하나 취소·fingerprint 모형을 실제 정책 검증으로 세면 안 됨 |
| branch finalization | 실제 application + 지연 gateway/receipt port → 동시 시작·최종 저장·재시도 | fake clock와 장애 주입의 정당한 사용. branch 독립 성공·terminal 결과 재사용·ledger-only 무receipt 경로 보존 |
| MER-001~007 | 실제 selection/enrichment/command/remap application → in-memory store → 규칙·claim·version | 순수 우선순위 테스트는 실제 제품 코드. remap과 registered-card도 runtime 소비 확인되어 test-only라 분류하지 않음 |
| CARD-001~005 | own-card policy / card command boundary → 결과·claim·기존 evidence | 소유자·가구 경계, mask/wildcard 불확실성, version·원자성 보존 |
| IOS-SEC·IOS-013 | lifecycle/storage installer application → fake credential store → issue/auth/revoke/status | 일반 수명주기 검증과 별개로 경합·로그 비노출의 관측 결함 존재 |
| IOS HTTP·IOS-001~015 | 실제 request processor/handler → auth/rate-limit/intake doubles → 응답·호출 횟수 | auth와 quota 순서, transport 상한, actor 위조 무시, idempotency 및 오류 mapping은 필요 |
| 진단 보존 | 실제 DiagnosticRetentionApplication → allowlist를 가진 fake store → 문서/권한 | 제품 저장 adapter의 schema 검증을 대체하지 않음. 시간 인자가 무시되므로 실제 TTL 서비스 검사가 아님 |

## 우선 후보

### CT01 — 경합이라고 이름 붙인 검사가 순차 실행입니다. P1, 확신 높음

- 근거: `shortcut-ingestion/shortcut-credential-storage-and-installer.contract.test.ts:315`의 `Promise.all([await subject.reissue(...), await subject.reissue(...)])`입니다. 첫 호출을 완료한 뒤 두 번째를 시작하므로 경합이 없습니다. :320~327은 순차 version conflict와 active 1개만 확인합니다.
- 더 작은 검증: 배열 내부 await를 없애 실제 overlap을 만들고, fake store 직렬화 여부와 별개로 실제 credential store의 동시 CAS/transaction 계약을 Emulator에서 확인합니다. 단순히 테스트 이름만 유지한 병렬 문법이 없어야 합니다.
- 보존 계약: 동시에 같은 기존 credential을 교체해도 active 1개, loser 무원문 반환, 실패 시 기존 credential 보존, 이미 확정한 idempotency 재생입니다.
- 삭제 가능한 요소: 실행을 겹치지 않으면서 경합을 주장하는 중복 포장입니다. 보안 검사 자체를 삭제하자는 제안이 아닙니다.

### CT02 — 로그·원문 비저장의 일부 검사가 상수 빈 배열을 읽습니다. P1, 확신 높음

- 근거: 같은 계약 :164는 `rawSecretsAtRest === []`, :166은 `auditLogs.join(...)`에 secret이 없는지 검사합니다. `functions/test/support/shortcut-credential-storage-installer-fixture.ts:73~74`는 두 필드를 항상 `[]`로 반환합니다. logger나 실제 storage 관측이 아닙니다.
- 실제 credential storage의 secretHash 필드와 response 직렬화 비교는 의미가 있으므로 남깁니다. `secretHash.kind`도 fixture가 붙이는 이름이므로 강한 해시 알고리즘의 증거로 해석하지 않습니다.
- 더 작은 검증: 고정 관측 필드를 제거하고 실제 저장 adapter의 읽기 결과와 주입한 logger의 호출만 수집합니다. 테스트 하나가 실제 저장값/로그/응답 각 경계를 명확히 검증하도록 합칩니다.
- 보존 계약: raw credential은 최초 발급 응답 외 재노출 금지, 강한 일방향 hash만 영속화, 로그 민감정보 비노출입니다.

### CT03 — receipt 조율 테스트가 취소·해시 별도 구현까지 유지합니다. P2, 확신 높음

- 소비 근거: `android-payment-ingestion/capture-submission-receipt.contract.test.ts:366`과 :403의 성공 취소 재생·취소 후 미래 승인 테스트입니다. `functions/test/support/capture-submission-receipt-driver.ts:210~224`는 취소 대상을 같은 날짜·분·금액·가맹점·카드 문자열로 독자 검색하고 :234 이후 삭제·event를 직접 수행합니다. :473은 fixture의 `Sha256CapturePayloadFingerprint`를 생성합니다.
- [재무 테스트 FT-02](finance-tests.md)와 연결: fixture 해시는 실제 Firebase fingerprint의 verifiedRawInput/paymentKind/billDueDate/접두사 분기와 다른 모형입니다. 해당 해셔 자체의 전체 검토는 finance 보고서 근거를 참조합니다.
- 더 작은 설계: receipt-only 조율 테스트에는 `cancelled/notFound/recorded`를 반환하는 명시적 gateway stub와 opaque fingerprint를 씁니다. 실제 취소 대상 판정과 재전송 후 원장 상태는 실제 ledger application/store 통합 검사에서 검증합니다. 실제 fingerprint 테스트는 실제 순수 해셔를 사용합니다.
- 보존 계약: 부분 성공 재시도에서 완료 branch를 다시 쓰지 않음, 취소 receipt 재생, 취소가 미래 승인을 막지 않음, payload 충돌 거부. 새 취소 알고리즘을 fake에 다시 구현하지 않습니다.

### CT04 — golden 결과 상수를 다시 검사하는 테스트를 행동 검증과 분리합니다. P3, 확신 높음

- `android-provider-parser-golden.contract.test.ts:127~136`은 실제 parser 결과를 fixture expected와 비교합니다. 이후 :141~151, :266~290, :297~340의 일부 검사는 `caseById(...).expected`만 검사합니다. `shortcut-card-message-parser-golden.contract.test.ts:60~69`도 실제 parse를 수행하지만 :89의 카드사 coverage 검사는 fixture 상수를 봅니다.
- 더 작은 검증: 모든 원문→실제 parser golden 케이스는 유지하고, fixture coverage 의도는 한 개 coverage assertion/메타데이터로 합칩니다. 상수 재검사를 새 제품 행동 커버리지로 세지 않습니다.
- Android golden :156 이후 postedAt/timezone/input 변형을 실제 parser에 넣는 검사는 단순 상수 검사가 아니므로 제거 후보에서 제외합니다.

## 삭제 대상으로 삼지 않은 복잡성

- HTTP 입력 길이를 trim 전에 확인하고 bearer 인증을 credential quota 전에 수행하는 순서, invitation과 credential의 인증 경계, 사용자·가구 분리, 취소의 편집 알림 억제는 실제 계약입니다.
- Merchant exact OR token claim/priority 유일성, 전체 ID 재정렬, 실패 시 write 0건과 카드 retired 이력 보존은 간단한 CRUD로 축약하면 안 됩니다. 다만 fake의 원자성 검사가 실제 Firestore 경합을 증명하는 것은 아닙니다.
- receipt conflict/branch partial success/final terminal merge와 raw-notification envelope 관측은 실제 application을 대상으로 하는 필요 검사입니다.
- `merchantRuleCategoryRemapApplication`은 `merchantRuleCategoryArchiveApplication`이, `registeredCardCommandBoundaryApplication`은 `paymentConfigurationRuntimeApplication`이 소비합니다. 파일 이름만 보고 테스트 전용 제품 코드라 판단하지 않았습니다.

## 범위와 한계

이 디렉터리 22개는 본문 검토 완료입니다. fixture와 생산 구현 전체 완독은 이 후속 범위 밖이며 finance 본 감사 보고서와 합쳐야 합니다. 추가 확인한 source excerpt를 해당 파일 전체 완독으로 등록하지 않았습니다. 실제 테스트 결과나 운영 버그 발생 여부는 이 정적 검토로 확정하지 않았습니다.
