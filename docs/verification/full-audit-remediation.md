# 전수 감사 수정 상태

기준: 2026-09-06, 수정 시작 HEAD `448f8d0`. 요구사항 244개와 지적 82개를 대상으로 작업했습니다. 아래 상태는 로컬 수정·검증 범위이며 운영 배포를 뜻하지 않습니다.

기존 82개 지적 모두 수정·검증을 반영했습니다. CAP-10은 사용자가 Q-007 권장안을 승인하여 순지출과 원승인 총액 증거를 분리하는 DEC-070으로 해결했습니다. 지적 번호 없이 검증 부족으로 남았던 24개 요구도 추가 대조하여 실제 테스트 근거와 남은 한계를 아래에 기록했습니다. 그 과정에서 통계 편집 실패의 입력 유실, 캐시의 보관 명의자 노출, QuickEdit 분할 입력 고정 시점, 정기 거래 이관의 기존 생성자 변경을 추가로 수정했습니다. CAN-006은 Q-008 권장안 승인에 따라 DEC-071로 확정하고 분할 합계로 추정하는 옛 규칙과 테스트를 제거했습니다. AND-010은 사용자가 현재 최초 진입 권한 요청 유지를 선택하여 DEC-072로 확정하고 요구·설계를 맞췄습니다. AND-005는 현재 Firebase custom token 직접 전달을 유지하는 DEC-073으로 확정했습니다. 남은 미결정 제품 정책은 0건이며 기기 검증의 한계는 아래에 별도로 기록했습니다.

## 제품 정책 결정

[Q-007~Q-010](../requirements/governance/pending-decisions.md)은 사용자 결정으로 모두 확정했습니다. Q-010은 로그인 실행 코드를 유지하고 요구사항·공개 계약·설계에서 별도 5분·1회용 교환권과 Membership receipt 보장을 제거했습니다. 실제 코드와 연결되지 않은 handle·receipt 모델의 2개 suite·33개 테스트와 보조 파일 7개를 제거하고, 실제 서버 발급 테스트의 최초 방문 권한 검증을 강화하고 Web·Native 각각의 발급 실패 검증 2개를 추가했습니다.

## 통합 검증

| 실행 경계 | 최종 결과 |
|---|---|
| Functions 필수 quality gate | 배포 준비 후 재실행: 311개 파일·2,709개 활성 테스트 통과, test:types·runtime boundary·build 통과 |
| 요구사항·아키텍처 | 10개 파일·38개 검사 통과, 런타임 경계 위반 0건, 요구사항 244개·Canonical 시나리오 ID 228개 |
| Web | 배포 준비 후 90개 suite·400개 테스트와 타입 검사를 포함한 Next production build 재실행 통과. Q-010의 Auth·HouseholdProvider 2개 suite·24개 테스트도 통과 |
| Firebase Callable | Auth→실제 HTTP wire→Functions→Firestore 3개 통과 |
| Web Firebase E2E | 로그인→가구 생성→지출 CRUD→Outbox NoTarget 종료, 1개 통과 |
| PWA production E2E | 실제 생성 HTML hydration·CSP·root worker·정적 캐시·waiting 전환, 1개 통과 |
| Android | v1.2.22(versionCode 24)에서 25개 JVM suite·109개 테스트, lintDebug, Debug/Release build·release 서명 검증 통과. instrumentation 16개는 앞선 전수 감사 실행 결과 |

일반 Functions 실행의 조건부 skip 78개는 Emulator 전용입니다. 기존 Firestore/Storage 72개와 Callable 3개를 별도 실행했으며 Q-008 수정 후 금융 명령 Emulator 16개를 재실행하여 새 수정·분할 취소 시나리오 3개도 통과했습니다. 폐기한 분할 합계 근삿값 정책 테스트 9개를 제거하고 원승인 증거 없는 그룹의 무변경 회귀 3개와 10,001원→5,000원×2의 실제 계보 전체 취소 Emulator 1개를 추가했습니다. Q-007·Q-008 변경은 Functions·계약 fixture·문서 범위이고 Q-009는 문서, Q-010은 Functions 테스트·문서 범위입니다. Web 전체 빌드와 Android 결과는 앞선 전수 감사 실행 결과입니다. 활성 계약의 skip·todo는 없습니다. production Web 산출물은 정적 HTML 12개·inline script CSP hash 25개·Firebase SDK 12.16.0·단일 root worker를 검증했습니다.

- Android: 전체 JVM 테스트·lintDebug·Debug/Release APK 빌드 성공. API 36.1 에뮬레이터 instrumentation 16개 통과, 실패·skip 0개.
- Firebase: Firestore Rules·전체 Firebase Adapter·Storage Rules Emulator 13개 파일 72개 통과, 실패·skip 0개.
- 실제 운영 배포·운영 데이터 교정·영구 삭제는 실행하지 않았습니다.

배포 준비 보완: Monitoring API에서 검증 면제인 활성 channel을 잘못 거부하던 wrapper를 공식 상태 의미에 맞추고 실제 HTTP 응답 경계 테스트 7개를 추가했습니다. CI 전에 Web이 자동 배포되지 않도록 Vercel Git 자동 배포를 끄고 같은 HEAD의 필수 CI 성공 후 명시적으로 배포하도록 설정했습니다. 위 수치는 커밋 전 로컬 검증이며 원격 CI·배포 완료와 구분합니다.

## Q-008 운영 분할 연결 확인 — 2026-09-06

프로젝트 `household-account-6f300`의 Firestore를 읽기 전용 REST query로 확인했습니다. 조회 필드는 문서 ID·가구/분할/계보 참조·날짜·생명주기·관찰 유형으로 제한했습니다. legacy `expenses`의 분할 문서 40개, canonical `ledgerTransactions` 3,065개(문서 이름 cursor로 끝까지 조회, 분할 문서 40개), `captureRecords` 607개를 확인했습니다. 두 원장 projection은 같은 문서 ID로 합쳐 중복 집계하지 않았습니다.

- 활성 분할 그룹 8개에 원거래 ID와 연결된 승인 capture가 없었습니다. 그룹 번호는 있지만 이것만으로 원승인과 연결할 수 없습니다.
- 8개 중 2개는 표시 날짜가 2026-08-07~2026-09-06 범위에 포함됩니다. 분할 표시일은 원승인일과 다를 수 있으므로 최근 30일 승인 취소 대상으로 확정한 수치는 아닙니다.
- Git 이력 `042c7c0` 이전의 `web/src/lib/utils/monthlySplitActions.ts`는 그룹 번호·순번·개월 수만 저장하고 원거래를 삭제했습니다. 현재 원거래 연결을 보존하는 분할 처리와 구분합니다.
- 조회된 정보만으로 원승인과 그룹의 연결을 입증할 수 없어 운영 데이터는 보존했습니다. 실제 복구는 연결을 확인할 원본 자료·백업이 확보된 경우에만 명시적으로 진행합니다.

## 지적별 수정 내역

| 지적 | 상태 | 수정 내용과 검증 근거 |
|---|---|---|
| <a id="acc-01"></a>ACC-01 | 수정·검증 | **일반 가구원에게 가구 삭제 권한과 공개 명령이 열려 있습니다**<br>일반 capability·공개 삭제 명령을 제거하고 관리자 전용 경로만 유지했습니다. 과거 권한이 남은 사용자도 거부합니다. [access-household-runtime-security.test.ts](../../functions/test/bootstrap/access-household-runtime-security.test.ts) |
| <a id="acc-02"></a>ACC-02 | 수정·검증 | **관리자 삭제 후에도 일반 사용자 명령이 성공합니다**<br>관리자 삭제·복구와 UID claim의 가구 상태를 같은 transaction에서 갱신합니다. 과거 누락 claim을 교정하는 명시적 운영 경로도 제공합니다. [access-household-runtime-security.test.ts](../../functions/test/bootstrap/access-household-runtime-security.test.ts) |
| <a id="acc-03"></a>ACC-03 | 수정·검증 | **Firestore Rules가 삭제된 가구의 업무 읽기를 허용합니다**<br>Rules가 Membership과 실제 가구의 active 상태를 모두 검사합니다. deleted/purging/purged 읽기 거부, 관리자 조회와 복구 후 읽기를 검증했습니다. [firestore-rules.integration.test.ts](../../functions/test/integration/firestore/firestore-rules.integration.test.ts) |
| <a id="acc-04"></a>ACC-04 | 수정·검증 | **가구 기본 초기화 실패가 화면에 전달되지 않고 재시도도 실행되지 않습니다**<br>초기화 실패를 UI에 전달하고 같은 가구의 고정 key로 재시도합니다. 생성 graph는 보존하고 완료 상태 역행·삭제 가구 재초기화를 차단했습니다. [access-household-runtime-security.test.ts](../../functions/test/bootstrap/access-household-runtime-security.test.ts) · [androidHouseholdServerFirst.contract.test.tsx](../../web/src/__tests__/platform/androidHouseholdServerFirst.contract.test.tsx) |
| <a id="acc-05"></a>ACC-05 | 수정·검증 | **무효 legacy 후보가 신규 사용자 화면으로 돌아가지 않습니다**<br>무효·종료된 legacy 후보를 제거하고 first-visit 화면으로 돌아갑니다. 실제 HouseholdProvider 경로에서 검증했습니다. [androidHouseholdServerFirst.contract.test.tsx](../../web/src/__tests__/platform/androidHouseholdServerFirst.contract.test.tsx) |
| <a id="acc-06"></a>ACC-06 | 수정·검증 | **legacy 연결 종료용 feature flag가 production 경로에 없습니다**<br>LEGACY_MEMBERSHIP_CLAIM_ENABLED=false를 resolver 응답·claim handler·Web 첫 방문 처리에 연결했습니다. [firebase-signed-in-user-resolver.test.ts](../../functions/test/adapters/firebase/firebase-signed-in-user-resolver.test.ts) · [access-household-runtime-security.test.ts](../../functions/test/bootstrap/access-household-runtime-security.test.ts) |
| <a id="acc-07"></a>ACC-07 | 수정·검증 | **수동 claim 교정과 가구 영구 purge의 운영 실행 연결이 빠져 있습니다**<br>명시적 관리자 repair/purge CLI, Firestore UoW·audit·Outbox·Context participant를 연결했습니다. claim은 별도 페이지 문서로 저장하고 모든 participant 완료 후 조건부 해제합니다. orphan 및 legacy 소유 복구를 보완했으며 운영 절차와 제약을 문서화했습니다. [firebase-access-operations.integration.test.ts](../../functions/test/integration/firebase/firebase-access-operations.integration.test.ts) · [access-recovery-and-household-purge.md](../../docs/operations/access-recovery-and-household-purge.md) |
| <a id="acc-08"></a>ACC-08 | 수정·검증 | **접속 visitId 멱등성이 128회 이후 사라집니다**<br>visitId receipt를 영구 보존하고 통계와 원자 저장해 128회 이후·재시작 뒤 중복 집계를 막았습니다. [member-access-persistent-idempotency.test.ts](../../functions/test/adapters/firebase/member-access-persistent-idempotency.test.ts) |
| <a id="acc-09"></a>ACC-09 | 수정·검증 | **운영 대시보드가 잘린 표본과 공급자 기록 부재를 정상처럼 표현할 수 있습니다**<br>기대 Provider-operation 7개와 실제 관측을 대조해 빠진 항목은 unknown·미관측으로 반환하고 가짜 성공 시각을 만들지 않습니다. 대화형 지연은 제한된 로그 조회의 일부 실패를 partial로 반환하고 관리자 화면에 누락 경고를 표시하며 실제 관측이 없는 값을 정상 지연으로 보이지 않게 했습니다. [admin-provider-observation-coverage.test.ts](../../functions/test/adapters/firebase/admin-provider-observation-coverage.test.ts) · [google-cloud-interactive-latency-reader.test.ts](../../functions/test/adapters/google-cloud-interactive-latency-reader.test.ts) · [AdminOperationsOverview.tsx](../../web/src/components/admin/AdminOperationsOverview.tsx) |
| <a id="acc-10"></a>ACC-10 | 수정·검증 | **자기 이름 변경의 실패 경로도 제거된 다른 Member를 active로 덮어씁니다**<br>자기 이름 변경은 해당 Member·profile·현재 receipt만 갱신합니다. 실패·replay에서 다른 제거 멤버와 과거 receipt TTL을 변경하지 않습니다. [access-household-runtime-security.test.ts](../../functions/test/bootstrap/access-household-runtime-security.test.ts) · [member-rename-atomic-store.test.ts](../../functions/test/adapters/firebase/member-rename-atomic-store.test.ts) |
| <a id="acc-11"></a>ACC-11 | 수정·검증 | **관리자 실제 목록·생성 UI가 계약의 최신순·생성 키 복사와 다릅니다**<br>관리자 목록은 lifecycle 내 최신 생성순을 사용하고 생성 성공 후 공유 키를 자동 복사합니다. 클립보드 실패는 생성 실패와 구분해 유지합니다. [adminCreationCopy.contract.test.tsx](../../web/src/__tests__/features/access-household/adminCreationCopy.contract.test.tsx) · [firebaseAdminDashboardReader.ts](../../functions/src/adapters/firebase/admin/firebaseAdminDashboardReader.ts) |
| <a id="cap-01"></a>CAP-01 | 수정·검증 | **Shortcut 푸시의 전송 직전 binding·멤버·수신 설정 재검증이 없습니다.**<br>`deliveryAssuranceApplication`, `firebaseNotificationDeliveryAdapters`에서 전송 직전 endpoint binding/version, 멤버 상태, 수신 설정을 같은 transaction으로 재검증합니다. membership 확인 중 각각 변경되는 경합을 실제 Firebase adapter로 검증했습니다.  |
| <a id="cap-02"></a>CAP-02 | 수정·검증 | **중복 결제 Outbox를 실제 알림 trigger가 무시합니다.**<br>`firebaseNotificationOutbox` → `notificationOutboxDispatchApplication` → 공통 DeliveryAssurance 경로로 TransactionRecorded와 CaptureDuplicateObserved를 처리합니다. 30일 만료·unknown origin ContractFailure를 저장하며 replay는 재전송하지 않습니다.  |
| <a id="cap-03"></a>CAP-03 | 수정·검증 | **HouseholdMemberRemoved endpoint 정리 consumer가 runtime에 없습니다.**<br>HouseholdMemberRemoved consumer와 `firebaseNotificationMemberCleanupStore`를 연결했습니다. 지연 제거 Event는 이후 새 등록을 지우지 않고, 복구 뒤에도 removedAt 이전 endpoint는 새 확인 전 사용할 수 없습니다.  |
| <a id="cap-04"></a>CAP-04 | 수정·검증 | **sending/in-progress 중단을 terminal로 마감할 복구 runner가 없습니다.**<br>`firebaseNotificationReconciliation`와 5분 scheduler를 추가했습니다. 중단 sending 및 이전 Shortcut in-progress를 unknown-provider-outcome+유한 TTL로 마감하며 provider 재호출이 없습니다. Root가 facade/index export를 연결했습니다.  |
| <a id="cap-05"></a>CAP-05 | 수정·검증 | **30일 지난 Shortcut Event를 새 푸시로 다시 처리할 수 있습니다.**<br>`firebaseNotificationOutbox` → `notificationOutboxDispatchApplication` → 공통 DeliveryAssurance 경로로 TransactionRecorded와 CaptureDuplicateObserved를 처리합니다. 30일 만료·unknown origin ContractFailure를 저장하며 replay는 재전송하지 않습니다.  |
| <a id="cap-07"></a>CAP-07 | 수정·검증 | **가맹점 규칙 전체 재정렬 공개 명령이 연결되지 않았습니다.**<br>`payment-configuration.reorder-merchant-rules.v1` handler, facade, Web 위/아래 UI를 연결했습니다. inactive 포함 완전 집합·고유 priority/claim·collectionVersion을 한 UoW에서 갱신하며 stale/누락/중복/foreign/replay를 검증했습니다. Root가 manifest/metadata Rules를 연결했습니다.  |
| <a id="cap-08"></a>CAP-08 | 수정·검증 | **production legacy 규칙 mapper가 malformed 문서를 임의 보정합니다.**<br>`firebaseCaptureConfigurationQuery`가 malformed legacy keyword/OR/type/category/priority를 ContractFailure로 구분합니다. canonical 문서가 있으면 legacy 중복은 먼저 제외하며 projection schema를 2로 올려 옛 보정 캐시를 재생성합니다. malformed 입력 실패 시 projection을 쓰지 않는 테스트를 추가했습니다.  |
| <a id="cap-09"></a>CAP-09 | 수정·검증 | **SMS 지역화폐가 파싱된 뒤 거래와 잔액을 잃습니다.**<br>SMS parser 결과에서 payment/balance 양쪽을 보존합니다. 지역화폐 SMS source별 parser 결과를 허용하고 도시가스 BillingTitle은 server-only parsedMemo로 Raw→Submission→Branch→Ledger까지 전달합니다. 실제 저장과 receipt replay를 검증했습니다.  |
| <a id="cap-10"></a>CAP-10 | 수정·검증 | **토스 캐시백 승인 순액과 취소 총액이 달라 취소가 누락됩니다.**<br>사용자 승인 DEC-070에 따라 원장·QuickEdit 순액 9,500원과 승인 총액 증거 10,000원을 분리했습니다. 총액 취소만 연결하고 기존 receipt 재생·원문 변경 거부·과거 금액 비추정·최소 tombstone을 검증했습니다. 실제 Firestore에서 금액·가맹점 수정 및 월 분할 뒤에도 원본·파생 전체 취소가 통과했습니다. [Raw→Ledger 회귀](../../functions/test/adapters/payment-capture/raw-capture-production-flow.test.ts) · [Firebase Emulator](../../functions/test/integration/firebase/firebase-finance-command-adapters.integration.test.ts) · [DEC-070](../requirements/governance/decisions.md#dec-070) |
| <a id="cap-11"></a>CAP-11 | 수정·검증 | **승인 뒤 가맹점 규칙 변경 시 immutable lineage 취소가 실패합니다.**<br>취소 식별은 current mapped merchant 대신 immutable originalMerchant를 사용합니다. Accepted DEC-041/CAN-007과 오래된 CAN-001/T-CAN-004 문구 충돌을 Root 확인 후 requirements/design과 준비 Application을 교정했습니다. mapping 변경 후 실제 취소를 검증했습니다.  |
| <a id="cap-12"></a>CAP-12 | 수정·검증 | **취소마다 가구 전체 capture·canonical·legacy 원장을 transaction으로 읽습니다.**<br>취소 receipt를 먼저 읽고 replay는 query 없이 반환합니다. captureRecords는 30일 범위, 실제 ledger는 lineage seed와 derived/merge graph만 탐색합니다. 관련 legacy composite index를 추가했습니다.  |
| <a id="cap-13"></a>CAP-13 | 수정·검증 | **Shortcut 재시도의 새 requestedAt이 idempotency payload 충돌을 만듭니다.**<br>Shortcut HTTP receipt에 최초 receivedAt을 보존하고 retryable 실패에도 receipt를 삭제하지 않습니다. 새 요청 시각이 달라도 실제 parser와 intake의 command/일시/payload가 같고, 완료 결과 재생은 추가 intake/진단 호출이 없음을 실제 receipt adapter로 검증했습니다.  |
| <a id="cap-14"></a>CAP-14 | 수정·검증 | **취소 후 최소 tombstone 이외 금융 원증거가 남습니다.**<br>승인·취소 captureRecords를 최소 tombstone으로 교체하여 amount/merchant/card/parser/raw hash/creator 원증거를 남기지 않습니다. 실제 저장 문서 필드를 검증했습니다.  |
| <a id="cap-15"></a>CAP-15 | 수정·검증 | **PWA endpoint 제거 실패에도 로그아웃하여 수신 경로가 남습니다.**<br>PWA logout은 endpoint 실패를 삼키지 않고 Auth/local scope를 유지합니다. pending journal과 registration barrier로 새 actor endpoint 오염을 막습니다. Root Provider와 실제 lifecycle 회귀 통과.  |
| <a id="cap-16"></a>CAP-16 | 수정·검증 | **배포 PWA worker가 payloadVersion/clickTarget 계약을 검사하지 않습니다.**<br>push payload의 version/type/clickTarget/opaque expense ID를 검증하고 동일 origin의 encoded expense edit 경로만 생성합니다. 단일 worker가 foreground/background click을 처리합니다. payload 반례·scope callback 및 production worker 회귀 통과.  |
| <a id="cap-17"></a>CAP-17 | 수정·검증 | **Shortcut 안정 parser 거부 code를 HTTP 응답·재전송 진단에서 잃습니다.**<br>parser의 안정 거부 코드를 HTTP DTO/response schema/receipt에 그대로 전달합니다. 최초 parser 진단을 보존하고 완료 요청 재생 시 새 진단으로 덮어쓰지 않습니다. 실제 parser+Firebase receipt와 기존 진단 계약 테스트를 검증했습니다.  |
| <a id="cap-18"></a>CAP-18 | 수정·검증 | **Notifications purge의 실제 저장소·Access runner 연결이 없습니다.**<br>Firebase Notifications purge adapter를 공개 factory로 제공했고 Root가 Access runtime에 연결했습니다. START→OWNERSHIP bounded scan/receipt→DATA checkpoint로 legacy Inbox owner를 보완한 뒤 삭제합니다. Outbox/Intent로 소유 확인이 불가능하면 `NOTIFICATION_LEGACY_OWNERSHIP_UNRESOLVED:<path>` 오류로 무변경 실패합니다. Access runtime이 이 오류를 permanent-failure로 매핑하며 Outbox 삭제 전에 ownership preflight를 완료합니다. 작은 페이지·재시작·다른 가구 보존·owner 불명 오류를 검증했습니다.  |
| <a id="cap-20"></a>CAP-20 | 수정·검증 | **미사용 Web 가맹점 matching 복사본이 서버와 반대 순서를 사용합니다.**<br>미사용 Web `matchesMerchant/findMatchingRule/applyRule` 중복을 제거했습니다. 서버 도메인 matching 경로만 사용합니다.  |
| <a id="cap-21"></a>CAP-21 | 수정·검증 | **다음에도 기억 저장이 거래 수정과 별도 command로 실행됩니다.**<br>Ledger repository prepare/stage participant와 PaymentConfiguration 기존 writer를 공유하여 거래·exact rule·claim·receipt를 한 Firestore UoW로 확정합니다. UI는 onSave(updates, rememberForNextTime) 한 번으로 요청합니다(Ledger/Stats). originalMerchant 사용, 기존 rule 재사용, stale/missing/income/foreign/중간 commit 실패 전부 무변경, replay를 실제 handler에서 검증했습니다. 기존 분리 저장/부분 성공 테스트를 단일 저장 계약으로 재작성했습니다.  |
| <a id="cap-22"></a>CAP-22 | 수정·검증 | **도시가스 BillingTitle memo가 최종 저장까지 전달되지 않습니다.**<br>SMS parser 결과에서 payment/balance 양쪽을 보존합니다. 지역화폐 SMS source별 parser 결과를 허용하고 도시가스 BillingTitle은 server-only parsedMemo로 Raw→Submission→Branch→Ledger까지 전달합니다. 실제 저장과 receipt replay를 검증했습니다.  |
| <a id="cap-23"></a>CAP-23 | 수정·검증 | **unknown originChannel을 typed ContractFailure 없이 무시합니다.**<br>`firebaseNotificationOutbox` → `notificationOutboxDispatchApplication` → 공통 DeliveryAssurance 경로로 TransactionRecorded와 CaptureDuplicateObserved를 처리합니다. 30일 만료·unknown origin ContractFailure를 저장하며 replay는 재전송하지 않습니다.  |
| <a id="doc-01"></a>DOC-01 | 수정·검증 | **인덱스·현재 상태·플랫폼 예외 설명이 최신 요구사항과 맞지 않습니다**<br>수동 집계 숫자를 단일 원본 기반 자동 카탈로그로 대체하고 최신성 gate를 추가했습니다. 과거 완료 선언을 이력으로 구분하고 PWA·Android logout 예외와 Q-007을 문서화했습니다. [update-catalog.mjs](../../tools/requirements/update-catalog.mjs) · [requirement-test-traceability.test.ts](../../functions/test/architecture/requirement-test-traceability.test.ts) · [catalog-summary.md](../../docs/requirements/catalog-summary.md) |
| <a id="eff-01"></a>EFF-01 | 수정·검증 | **Access 저장소가 작은 변경마다 전체 상태와 과거 receipt를 읽고 다시 씁니다**<br>관리자 단건 작업은 대상 가구만 읽고 이름 변경은 actor에 해당하는 문서와 receipt 한 건만 읽습니다. 전체 상태 재기록과 과거 TTL 연장을 제거했습니다. [firebaseAdminHouseholdStore.ts](../../functions/src/adapters/firebase/access/firebaseAdminHouseholdStore.ts) · [firebaseMemberRenameStore.ts](../../functions/src/adapters/firebase/access/firebaseMemberRenameStore.ts) |
| <a id="fin-01"></a>FIN-01 | 수정·검증 | **일반 거래 수정이 superseded 원본을 active로 되살립니다**<br>superseded ordinary CRUD/notify를 로드·commit 양쪽에서 거부 / ledger-lifecycle-regression  |
| <a id="fin-02"></a>FIN-02 | 수정·검증 | **월 분할이 capture lineage·카드 증거·시각을 새 파생 거래에서 제거합니다**<br>monthly split cardEvidence/captureLineageId/localTime 보존 / ledger lifecycle, Finance Emulator  |
| <a id="fin-03"></a>FIN-03 | 수정·검증 | **카테고리 archive를 완료할 production remap worker가 연결되지 않았습니다**<br>`merchantRuleCategoryArchiveApplication` 및 Firebase remapper factory를 제공했습니다. Finance가 category archive worker participant를 연결하고 실제 handler 회귀를 통과했습니다.  |
| <a id="fin-04"></a>FIN-04 | 수정·검증 | **카테고리·정기계획·카드·가맹점 wire가 사용자 version 대신 최신 저장 version을 주입합니다**<br>카드·가맹점 update/delete는 client expectedVersion, reorder는 expectedCollectionVersion을 HTTP DTO/공개 command/Runtime까지 전달합니다. 카드 편집·삭제·drag 시작 버전을 유지합니다. 실제 handler의 stale 및 누락 입력을 검증했습니다.  |
| <a id="fin-05"></a>FIN-05 | 수정·검증 | **검색이 목표 bounded Query를 우회해 키 입력마다 가구 원장 전체를 다운로드합니다**<br>검색 source window 재사용, 서버 snapshot 10,001개 안전 한도 검사, 50개 page와 전체/월별 합계 분리, 기간 입력·세션/cursor 검증 / ledgerSearchVisibility, searchImmediateResponse  |
| <a id="fin-06"></a>FIN-06 | 수정·검증 | **현재 선택 월 밖의 검색 결과를 수정·삭제할 때 version을 찾지 못합니다**<br>검색에서 선택한 거래 version을 수정·삭제 callback으로 전달 / Web optimistic pipeline/command  |
| <a id="fin-07"></a>FIN-07 | 수정·검증 | **일반 Ledger 논리 삭제에 deletedAt이 저장되지 않습니다**<br>삭제 deletedAt canonical·legacy 동시 보존 / ledger lifecycle  |
| <a id="fin-08"></a>FIN-08 | 수정·검증 | **항목 분할의 원본 복구 기능이 service에만 있고 공개 runtime에는 없습니다**<br>restore-item-split handler→Application→Store, manifest와 Web modal/button/service 연결 / 실제 split→restore handler, modal 관련 19개  |
| <a id="fin-09"></a>FIN-09 | 수정·검증 | **원장·통계 조회 오류가 빈 결과와 0원으로 표시됩니다**<br>range listener 오류에서 마지막 정상 Projection 유지 및 onError / ledgerSearchVisibility  |
| <a id="fin-10"></a>FIN-10 | 수정·검증 | **수입 생성에서 별도 memo가 필수 항목명을 덮습니다**<br>income itemName 변경 시 memo 동기화 / basic ledger/lifecycle  |
| <a id="fin-11"></a>FIN-11 | 수정·검증 | **시세 단가 선반올림이 저가 코인의 평가액을 0원으로 만듭니다**<br>단위시세 선반올림 제거, account 최종값 반올림 / 소수 단가×대수량 실제 adapter 회귀  |
| <a id="fin-12"></a>FIN-12 | 수정·검증 | **펀드 NAV가 미래 기준일을 최신값으로 채택합니다**<br>실제 날짜 검증 후 서울 오늘 이하 최신 fund NAV 선택 / 미래/불가능 NAV 날짜 회귀  |
| <a id="fin-13"></a>FIN-13 | 수정·검증 | **외화 평가 runtime이 독립 최신 Quote·환율 보존 계약을 구현하지 않습니다**<br>USD quote와 FX 독립 durable 저장·재사용, 미래/역행 FX 차단, provenance 유지 / cold restart, 미래/과거 FX, quote실패+FX성공 adapter 회귀  |
| <a id="fin-14"></a>FIN-14 | 수정·검증 | **Position 변경 command에 부모 Asset version 검증이 빠져 있습니다**<br>actual wire expectedVersion 필수, quote 전후 Asset/Position TX version 비교 / handler CAS, 외부 quote 중 동시 parent 변경  |
| <a id="fin-15"></a>FIN-15 | 수정·검증 | **자산 재정렬은 version map 없이 stale 순서를 덮어씁니다**<br>Position parent Asset version 및 reorder의 전체 active Asset version 검증 / 실제 handler stale parent/reorder, Web command/optimistic  |
| <a id="fin-16"></a>FIN-16 | 수정·검증 | **배당 차트가 다른 공시를 값 조합으로 중복 제거합니다**<br>confirmed eventId만 예상에서 제외, 같은 지급 사실의 다른 공시 유지, recordDate 오늘 이하 예상 제외 / 실제 AssetDividendChart 회귀  |
| <a id="fin-17"></a>FIN-17 | 수정·검증 | **확정 배당의 기준일 정정이 기존 수량과 증거를 재사용합니다**<br>fixed 공시 수정 시 새 history evidence/quantity/total 원자 갱신, 근거 없으면 기존 Event 유지 / dividend-correction-regression, Emulator  |
| <a id="fin-18"></a>FIN-18 | 수정·검증 | **삭제 자산의 보유 Position이 신규 배당 discovery 대상에 남습니다**<br>active Position의 삭제된 parent Asset 제외, canonical tombstone 우선 / active-asset regression, Emulator  |
| <a id="fin-19"></a>FIN-19 | 수정·검증 | **단건 자산 수정·예약 page가 필요 범위보다 훨씬 넓은 데이터를 반복 조회합니다**<br>명령별 scoped Asset loader, Recurring plan cursor+연속완료 checkpoint, Dividend source cursor+경계 group 완성 / bounded-runtime-read 3개: 무관 자산 100개에서도 rename 5 reads, 누락 월 복구, 배당 경계와 terminal page 진전  |
| <a id="fin-20"></a>FIN-20 | 수정·검증 | **자동화 최초 월을 포함 처리한 execution이 기록되지 않습니다**<br>included activation month 0원 execution/receipt를 plan과 같은 TX에 기록 / portfolio-runtime-store  |
| <a id="fin-21"></a>FIN-21 | 수정·검증 | **자동화 중지가 중지 전 overdue의 복구도 멈춥니다**<br>기한 지난 비활성화는 recovering-before-stop/stopEffectiveAt/statusAfterRecovery 저장 / portfolio-runtime-store  |
| <a id="fin-22"></a>FIN-22 | 수정·검증 | **일부 요구사항의 현 구현 설명이 실제 전환 상태와 다릅니다**<br>SPL-006의 메타데이터·원자 저장·내림 및 나머지 버림, AST-003의 논리 삭제, JOB-AST-003의 호환 lifecycle·원자 갱신 설명을 현재 코드·확정 결정에 맞췄습니다. [requirements.md](../../docs/requirements/contexts/household-finance/modules/ledger/requirements.md) · [requirements.md](../../docs/requirements/contexts/portfolio/modules/portfolio/requirements.md) · [requirements.md](../../docs/requirements/contexts/portfolio/modules/holdings-market-data/requirements.md) |
| <a id="fin-23"></a>FIN-23 | 수정·검증 | **거래 검색이 생성 당시 카드 증거 대신 변경 가능한 표시값만 읽습니다**<br>mutable display보다 보존된 cardEvidence로 검색 / ledgerSearchVisibility  |
| <a id="fin-24"></a>FIN-24 | 수정·검증 | **시세 refresh의 실제 retry와 실패 결과가 계약과 다릅니다**<br>지수 backoff+jitter, failedCount/failedTargets/retryCommandId, pending receipt 성공 target 보존 및 실패 target만 재시도, Web 실패 안내 / partial→retry→replay runtime, backoff; scheduler는 Platform  |
| <a id="plat-01"></a>PLAT-01 | 수정·검증 | **Android 알림 접근을 정확한 컴포넌트가 아닌 패키지 부분 문자열로 판정합니다.**<br>정확한 ComponentName으로 알림 접근 권한을 확인합니다. 실제 Android adapter instrumentation 및 lint 통과.  |
| <a id="plat-02"></a>PLAT-02 | 수정·검증 | **WebView 환경 설정과 저장된 navigation 복원이 연결되지 않았습니다.**<br>BuildConfig WEB_APP_URL·환경 버전으로 trusted origin을 구성하고 같은 환경의 WebView 저장 navigation만 복원합니다. TrustedWebOrigin JVM, 전체 Android build·lint 통과.  |
| <a id="plat-03"></a>PLAT-03 | 수정·검증 | **SessionMirror는 평문이며 actor 변경 전에 기존 Queue purge 성공을 보장하지 않습니다.**<br>Keystore encrypted SessionMirror와 versioned transition journal을 실제 Native 로그인·복구·logout에 연결했습니다. purge 전에 actor snapshot을 숨기고 실패 시 기존 actor를 복구하며 중간 commit 중단 재시작은 fail-closed입니다. actor scope snapshot·generation을 Queue/FCM에 전달하고 늦은 이전 세대 재삽입을 차단합니다. 실제 Kotlin SessionMirror·queue/lifecycle 회귀 및 Keystore instrumentation 통과.  |
| <a id="plat-04"></a>PLAT-04 | 수정·검증 | **재개된 QuickEdit FIFO는 설정과 오버레이 권한을 다시 확인하지 않습니다.**<br>QuickEdit FIFO 재개와 최종 Activity 표시 직전 overlay 설정·권한을 재검사합니다. FIFO/lifecycle JVM 및 Android 전체 gate 통과.  |
| <a id="plat-05"></a>PLAT-05 | 수정·검증 | **캐시와 Messaging worker가 분리되고 SDK·Firebase 설정이 별도로 고정됩니다.**<br>Messaging·Workbox를 단일 root sw.js로 통합했습니다. Web과 같은 Firebase public config 및 설치 SDK 12.16을 bundle하고 legacy worker를 정리합니다. worker 산출물 버전·내용 검증과 실제 Chromium production worker 등록·캐시 E2E 통과.  |
| <a id="plat-06"></a>PLAT-06 | 수정·검증 | **worker 활성화가 미저장 입력 확인 없이 reload합니다.**<br>업데이트는 사용자 입력 추적·명시적 적용·dirty 확인 후 해당 waiting worker에만 활성화를 요청합니다. 다른 client의 controllerchange는 임의 reload하지 않습니다. 실제 React 입력 보존·취소·적용/1회 reload 회귀와 production waiting worker 검증 통과.  |
| <a id="plat-07"></a>PLAT-07 | 수정·검증 | **정적 runtime cache가 최대 7일 대신 30일입니다.**<br>runtime cache를 동일 origin의 정적 경로만 7일·64개로 제한하고 query/auth/private/no-store 응답과 동적 navigation을 제외했습니다. versioned precache는 실제 build assets만 포함합니다. 실제 next-pwa configuration, production browser 캐시 검증 통과.  |
| <a id="plat-09"></a>PLAT-09 | 수정·검증 | **Web CSP·frame-ancestors와 보안 정책 build gate가 실제 설정에 없습니다.**<br>정적 Next HTML inline bytes의 CSP hash를 production routes manifest에 생성하고 CSP·HSTS·frame-ancestors 검증을 build에 연결했습니다. 동적 SSR 전환 없이 실제 production HTML hydration/CSP E2E 통과. dev 빈 headers route 오류도 실제 Node config 회귀로 수정했습니다. postbuild는 현재 BUILD_ID 외 generated worker 파일만 정리합니다.  |
| <a id="plat-10"></a>PLAT-10 | 수정·검증 | **홈 카드 구성과 여러 지역화폐 선택 UI가 없습니다.**<br>Settings에 가구 공통 카드 두 개와 별도 지역화폐 선택 UI를 추가했습니다. 첫 단일 balance 등록은 Home 소유 자동 선택 정책을 같은 source transaction에 합성하여 영속 선택하며 후속 유형은 선택을 바꾸지 않습니다. 실제 Home UI와 Home/LocalCurrency Firebase adapter 회귀 통과.  |
| <a id="plat-11"></a>PLAT-11 | 수정·검증 | **실제 홈 카드 Command는 expectedVersion을 받지 않아 stale write를 거부하지 못합니다.**<br>두 Home 명령에 expectedVersion을 필수로 적용하고 current version과 다르면 canonical·legacy·receipt·Outbox write 없이 거부합니다. 카드 저장이 지역화폐를 바꾸던 부수효과를 제거했습니다. stale/중복/idempotency 실제 Runtime+Store 및 편집 초안 버전 보존 UI 회귀 통과. DTO/resolver/cache 연결은 Root가 완료했습니다. requirements/design wire 입력표 갱신.  |
| <a id="plat-12"></a>PLAT-12 | 수정·검증 | **Storage 예외가 테마 초기화/변경 이벤트를 중단시킵니다.**<br>ThemeProvider가 storage 읽기/쓰기 예외를 처리하고 DOM 적용 성공 뒤만 theme state/저장을 변경합니다. unknown 저장값 및 DOM/storage 실패 실제 Provider 회귀 통과.  |
| <a id="plat-13"></a>PLAT-13 | 수정·검증 | **실제 Web 통계 조회가 pagination과 오래된 응답 차단을 우회합니다.**<br>통계 원천을 서버 날짜 범위·document cursor·page 50으로 읽고 50,000개 안전 상한/반복 cursor에서는 부분 합계를 반환하지 않습니다. Actor/가구/generation과 React query revision을 검증하며 명령 성공 후 권위 원천을 다시 읽습니다. 실제 mapper/adapter 여러 page 및 StatsPage stale 응답·명령 callback 회귀 통과.  |
| <a id="plat-14"></a>PLAT-14 | 수정·검증 | **자산 통계가 2020년 이전 이력·baseline·과거 dimension을 잃습니다.**<br>ALL의 2020 cutoff와 현재 자산 기반 가상 이력을 제거했습니다. canonical stable owner/type dimension 및 기간 시작 이하 baseline을 읽고 유효 0원을 carry-forward합니다. 현재 deleted/archived 여부와 무관하게 과거 catalog를 표시하고 새 기간에 없는 선택은 전체로 초기화합니다. AssetStatsPage/adapter 과거·0원·명의자·가구 전환 회귀 통과. 별도 자산 변동 차트도 자신의 월/연 조회와 stale 응답 차단·NoData/실패 처리를 연결했습니다.  |
| <a id="plat-16"></a>PLAT-16 | 수정·검증 | **PARTIAL_FAILURE 예약 작업이 성공 반환되어 재시도에 연결되지 않습니다.**<br>모든 scheduler bootstrap이 PARTIAL_FAILURE를 실패 신호로 전달합니다. 재시도는 실패 target만 다시 처리하고 성공 target은 외부 효과 전에 건너뜁니다. valuation 미해결 quote는 FAILED로 분류하고 해당 가구 snapshot 생성을 막습니다. 실제 Executor+Firebase repository+AssetValuation pages 재시도에서 성공 provider/snapshot 1회 및 실패 가구 동일 commandId 재사용 검증 통과.  |
| <a id="plat-17"></a>PLAT-17 | 수정·검증 | **만료 lease 소유자가 takeover한 새 worker의 진행과 lease를 최종 결과로 덮어쓸 수 있습니다.**<br>최종 run/result를 현재 유효 lease token으로 같은 transaction에 commit합니다. takeover 후 stale heartbeat·completion과 만료 lease를 거부합니다. monitor도 오래된 관측이 새 heartbeat·완료 상태를 덮어쓰지 못하게 조건부 변경하며 EXPECTED 누락 판정도 연결했습니다. 실제 Firebase repository fencing 회귀와 기존 monitor 계약 통과.  |
| <a id="plat-18"></a>PLAT-18 | 수정·검증 | **30초 actor cooldown과 외부 호출 비용 quota가 실제 ingress에 없습니다.**<br>서버 시간 기반 actor/가구/범위 30초 cooldown을 release 후에도 유지하며 pending receipt 재개는 허용합니다. 인증된 시세·종목 Query router가 Application 앞에서 UID+가구/IP hash quota를 원자 적용합니다(분당 actor 120, IP 600 기본값). 실제 adapter/router의 연속 요청·클라이언트 시간 조작·IP 공유·window 만료 회귀 통과.  |
| <a id="plat-19"></a>PLAT-19 | 수정·검증 | **Billing HTTP Adapter가 공통 응답 크기·redirect 보장을 우회합니다.**<br>BigQuery Billing reader를 공통 bounded HTTP transport에 연결했습니다. manual redirect·allowlist·10초·최대 응답 1MiB를 적용하며 credential redirect와 초과 응답은 provider 재호출 없이 거부합니다. 실제 Reader→Node transport 5개 테스트 통과.  |
| <a id="plat-20"></a>PLAT-20 | 수정·검증 | **필수 품질 gate 판정이 실제 Firebase 배포 명령에 강제되지 않습니다.**<br>실제 Firebase wrapper/predeploy에 전체 quality gate·정확한 HEAD의 CI 성공·보고서·project·artifact 검증을 연결했습니다. 실패·누락·skip·dirty 상태를 거부하고 child codebase 파일과 hook 이후 산출물도 검사합니다. [firebase-release-gate-runtime.test.ts](../../functions/test/bootstrap/firebase-release-gate-runtime.test.ts) · [deploy-firebase.mjs](../../functions/scripts/deploy-firebase.mjs) |
| <a id="plat-21"></a>PLAT-21 | 수정·검증 | **배포 provenance·호환 창 검증의 실제 배포/영구 저장 연결 증거가 부족합니다.**<br>호환 단계·확인된 알림 채널·실제 secret metadata·승인 actor를 확인하고 영구 approval/deployment provenance를 저장합니다. 인증된 실제 runtime build marker로 같은 산출물의 smoke 결과인지 확인합니다. [deployment-provenance-runtime.test.ts](../../functions/test/adapters/firebase/deployment-provenance-runtime.test.ts) · [deploy-firebase.mjs](../../functions/scripts/deploy-firebase.mjs) |
| <a id="plat-22"></a>PLAT-22 | 수정·검증 | **앱 버전 표시가 필수 접두 문구와 실패 대체값을 사용하지 않습니다.**<br>Settings의 Native 앱 버전을 필수 접두 문구로 표시하고 조회 실패 시 알 수 없음으로 표시합니다. 실제 Settings UI 버전 회귀 통과.  |
| <a id="sys-01"></a>SYS-01 | 수정·검증 | **Web의 오늘·월 계산이 브라우저 timezone에 의존합니다**<br>서울 날짜·월·시각 helper를 홈·원장·자산·통계·자동화 입력에 적용했습니다. 날짜 문자열의 월 라벨·요일은 단말 timezone에 따라 전날로 이동하지 않게 처리하고 미사용 정기 거래 날짜 helper를 제거했습니다. [seoulCalendarDate.test.ts](../../web/src/__tests__/platform/seoulCalendarDate.test.ts) · [date.ts](../../web/src/lib/utils/date.ts) |
| <a id="sys-02"></a>SYS-02 | 수정·검증 | **Web 원장 읽기가 알 수 없는 categoryId까지 소문자로 바꿉니다**<br>알려진 Android 기본 enum만 정규화하고 사용자 category ID를 보존합니다. 동일 JSON fixture를 Web·Functions에서 검증합니다. [category-compatibility.v1.json](../../contracts/fixtures/system/category-compatibility.v1.json) · [categoryCompatibility.contract.test.ts](../../web/src/__tests__/features/categoryCompatibility.contract.test.ts) |
| <a id="sys-03"></a>SYS-03 | 수정·검증 | **공통 Command receipt가 새 commandId를 같은 작업의 재시도로 인정하지 않습니다**<br>공통 receipt hash에서 commandId를 분리하고 replay 응답은 현재 요청 ID를 반환합니다. 기존 hash receipt도 저장된 원 commandId로 확인한 뒤 호환 전환하며 payload 변조는 거부합니다. [access-household-runtime-security.test.ts](../../functions/test/bootstrap/access-household-runtime-security.test.ts) · [firebaseHouseholdCommandInfrastructure.ts](../../functions/src/adapters/firebase/commands/firebaseHouseholdCommandInfrastructure.ts) |
| <a id="vfy-01"></a>VFY-01 | 수정·검증 | **Android lint가 최소 지원 API와 맞지 않는 메서드 호출로 실패합니다**<br>NotificationCompat MessagingStyle로 API26 호환을 확보했습니다. 실제 framework notification 추출 instrumentation 및 lintDebug 통과.  |

## 검증 부족 24개 요구의 후속 결과

실제 운영 클래스·Adapter·화면을 실행한 테스트와 참고 모델만 실행한 테스트를 구분했습니다. Android/FCM/iPhone/운영 메일의 미실행 범위는 통과로 계산하지 않았습니다.

| 요구사항 | 현재 판정 | 검증 근거·수정 및 남은 한계 |
|---|---|---|
| <a id="gap-and-005"></a>AND-005 | DEC-073 확정·실제 서버/Web 검증 | Firebase custom token 직접 전달을 유지하고 자체 handle·receipt 보장과 해당 참고 모델을 제거했다. `functions/test/bootstrap/webview-session-token.test.ts`는 실제 발급 함수·callable handler의 동일 UID·가구 claim, 최초 방문 권한 부재, 미인증·Membership 조회 실패·양쪽 중 하나의 발급 실패를 검증한다. `web/src/__tests__/platform/androidAuthBootstrap.contract.test.ts`는 actual authService의 persistence, UID 불일치 폐기, 실패·5초 timeout 복구, logout을 실행한다. `web/src/__tests__/platform/androidHouseholdServerFirst.contract.test.tsx`는 actual HouseholdProvider의 cache hit/miss, permission-denied 단일 복구, UID 변경 중 늦은 응답 폐기를 검증한다. 실제 Credential Manager Google 계정 선택·취소와 Native SDK 재인증 왕복은 미실행이다. origin 정책 함수는 실제 Kotlin JVM 테스트로 검증하지만 WebView의 외부 origin·subframe bridge 차단 전체 왕복은 이 테스트들로 검증했다고 계산하지 않는다. |
| <a id="gap-and-008"></a>AND-008 | 실제 로그 생성기 검증, 운영 수집기 한계 | `android/app/src/test/java/com/household/account/paymentcapture/CaptureLatencyRecorderTest.kt`는 production recorder의 원문 미노출, 입력 줄바꿈 주입 거부, 고정 hash correlation, sink 실패 무영향을 실행한다. Native 전체 Log 호출을 확인했으며 CategoryRepository 안정 오류 code와 CaptureLatencyTelemetry만 존재한다. 실제 운영 Crash/Analytics 수집 환경은 실행하지 않았다. 과거 Bridge/FCM 원문 로그가 현재도 남았다는 문서 설명을 제거했다. |
| <a id="gap-and-010"></a>AND-010 | 정책 확정·현재 구현 유지 | 사용자가 [DEC-072](../requirements/governance/decisions.md#dec-072)로 현재 가계부 최초 진입 요청을 선택했다. 앱 코드는 유지하고 사용자 설정 action에서만 요청한다는 설계를 정리했다. `android/app/src/androidTest/java/com/household/account/MainActivityInstrumentationTest.kt`의 기존 검증은 표시 권한 거부 상태의 WebView 진입·필수 수집 권한 유지·Activity recreate 이후 반복 강제 없음이다. 실행된 OS 회귀는 API 36.1이며 API 32 실기기 검증은 이번 범위에 없다. |
| <a id="gap-and-012"></a>AND-012 | 실제 Web Adapter·Provider 검증 | `androidHouseholdServerFirst.contract.test.tsx`, `androidAuthBootstrap.contract.test.ts`, `firestoreReadModelRecovery.contract.test.ts`, `androidNativeReadRefresh.contract.test.tsx`, `homeServerFirstRead.contract.test.ts`, `homeReadModelComposition.contract.test.tsx`가 actual modules의 비차단 metadata, cache snapshot 미방출, listener 유지·복구, auth timeout을 검증한다. production Web build와 실제 browser E2E도 수행했다. 여러 실제 Android WebView 버전의 동일 UID 영속 복원 UI는 별도 환경 검증 범위다. |
| <a id="gap-and-013"></a>AND-013 | 실제 Kotlin orchestration·OS component 검증 | `android/app/src/test/java/com/household/account/notifications/FidLogoutDetachmentTest.kt`는 production 함수의 component 차단 선행, suppression·remote·unregister 독립 실패, 동시 timeout, stale cleanup 후 등록, binding별 foreground 허용을 실행한다. 실제 `FcmServiceComponentGate` 연결은 `HostPlatformAdapterTest.kt`와 앱 instrumentation에서 검사한다. 실제 운영 FCM OS 자동 표시·재등록 왕복은 실행하지 않았다. |
| <a id="gap-and-014"></a>AND-014 | 실제 Kotlin clock·Web paint·telemetry 실패 회귀 | `ActivityStartupGatesTest.kt`의 production 단조 시계 1회 소비, `homeFirstCompletePaint.contract.test.tsx`의 actual LedgerPage 최신 서버 데이터·두 frame 이후 완료, `webStartupPerformance.contract.test.ts`의 actual mark와 지연 작업, `clientStartupObservation.contract.test.ts`의 Native 시간·2분 초과·구 bridge·일반 Web 제외를 확인했다. Native 계측 Promise 실패가 화면 오류나 성공 표본이 되지 않고 중복 bridge 요청도 발생하지 않는 actual module 회귀를 추가했다. 실제 단말별 latency 분포를 수집한 것은 아니다. |
| <a id="gap-ast-007"></a>AST-007 | 실제 경로 검증 보완 | 새 `functions/test/bootstrap/portfolio-production-demo-surface.test.ts:21`은 실제 portfolio handler registry와 공개 command manifest를 검사합니다. 정상 create-asset 명령은 존재하지만 sample/demo 생성 명령은 등록되지 않으며 검사 중 저장도 없습니다. `:34`는 Functions production export·운영/migration scripts, Web/Android UI, child codebase export를 읽어 demo/sample 자산 진입점과 demo 모듈 import가 production 실행 경계에 없는지 검사합니다. `src/demo`는 의도된 격리 Application이므로 production 호출자가 이를 참조하지 않는 경계를 확인합니다. 기존 `demo-asset-fixture-boundary.contract.test.ts`의 5개는 보존했습니다. driver가 호출하는 실제 `src/demo/portfolio/application/demoAssetFixtureApplication.ts`는 demo tenant 정책과 UoW를 사용하며 fixture 격리·멱등·실패 특성화를 계속 검증합니다. production의 부재 근거는 새 실제 registry/파일 경계 테스트로 추가했습니다. 현재 판정: 신규 2개와 기존 5개 통과입니다. 이전 참고 composition surface만으로 production 부재를 주장하던 공백을 보완했습니다. 운영 한계: 부재 검증은 현재 저장소의 production 소스·등록 계약·export·운영 스크립트 범위입니다. 저장소 밖에서 별도 Admin SDK로 실행하는 임의 운영 스크립트를 증명하지 않습니다. 실제 운영 데이터 seed는 실행하지 않았습니다. |
| <a id="gap-ast-009"></a>AST-009 | 실제 경로 검증 보완 | 새 `web/src/__tests__/features/portfolio/assetOwnerPageLifecycle.contract.test.tsx:60`은 실제 AssetsPage, AssetSummaryCard, AssetOwnerProfileModal, assetOwnerProfiles/householdCommands와 실제 cache/calculation 모듈을 연결합니다. 외부 Firestore 구독과 command transport만 통제합니다. `+` → dependent 이름 입력 → 실제 `access.create-asset-owner-profile.v1` command 전달 → 구독 반영 → profileId 필터 선택을 실행합니다. 전체 3,300/변동 300 → A 1,000/100 → dependent 2,000/200이 함께 바뀌며 직전 필터 변동을 표시하지 않습니다. hidden/archived 필터 제외와 일반 modal의 삭제·보관 버튼 부재도 확인합니다. `:88`은 실제 localStorage snapshot에서 같은 서울 날짜 재진입의 마지막 변동을 먼저 표시하고 서버 기준 계산으로 교체합니다. 서울 자정 이후 재진입 및 다른 가구 전환에서는 이전 일간 변동과 이전 가구 총액이 표시되지 않습니다. 추가 결함: `selectVisibleAssetOwnerProfiles`가 visibility만 검사해 실제 cache에 저장된 archived 프로필을 필터에 표시할 수 있었습니다. 실제 페이지 회귀에서 실패를 확인한 뒤 `web/src/features/access-household/domain/assetOwnerProfile.ts:15`를 active+visible 조건으로 수정했습니다. stable profileId와 과거 asset/snapshot 내용은 바꾸지 않았습니다. 현재 판정: 신규 실제 화면 연결 2개와 기존 profile read/cache 6개 통과, Web 전체 tsc 통과입니다. stable ownerRef 서버 검증은 기존 asset-owner-profile-lifecycle 계약 및 실제 asset handler 경로, 과거 snapshot owner/type dimension은 Platform의 reportingReadAdapters/assetStatsSessionRead 검증을 함께 참조합니다. 운영 한계: 이 테스트는 jsdom에서 실제 React/service/cache 연결을 실행하며 별도 브라우저/Cloud 네트워크/Android WebView까지 묶은 E2E는 아닙니다. dependent 서버 인가·영속화는 Access 소유 실제 handler/Emulator 검증과 결합해 판단합니다. |
| <a id="gap-bal-004"></a>BAL-004 | 핵심 자동 회귀 보완·통과, 기기 통합 E2E 미실행 | `web/src/__tests__/features/homeReadModelComposition.contract.test.tsx:598`에서 permission-denied 뒤 지역화폐의 마지막 성공값 보존·구독 종료와 재연결·새 서버값 회복을 확인했습니다. 월 전환 테스트 `web/src/__tests__/features/homeReadModelComposition.contract.test.tsx:321`에 지역화폐 listener가 계속 1개임을 추가했습니다. 실제 balanceService adapter의 `web/src/__tests__/features/localCurrencyBalance.contract.test.ts:174`를 추가하여 먼저 선택한 대전 유형 뒤에 경기 유형이 추가되어도 선택·잔액을 유지하는지 검증했습니다. 기존 `:143/:184/:205`는 선택 preference 대기·cache 배제·사라진 선택을 다른 유형으로 바꾸지 않음·0원 유효값을 검증합니다. / 실제 모바일 기기에서 인증 갱신/월·route 전환과 구독 수를 계측하는 결합 E2E는 미실행입니다. 자동 회귀에서는 실제 Provider와 실제 service를 각 외부 경계에서 검증했습니다. |
| <a id="gap-can-006"></a>CAN-006 | **정책 확정·수정·검증 / 구형 운영 기록 보존** | 사용자 승인 [DEC-071](../requirements/governance/decisions.md#dec-071)에 따라 원승인 증거와 계보로만 취소합니다. `cancellationMatch.ts`의 분할 합계 근사 판정과 폐기 정책 테스트 9개를 제거했습니다. [Firebase 회귀](../../functions/test/adapters/firebase/capture-ledger-cancellation-safety.test.ts)는 승인 증거 없는 5,000원×2 그룹에 10,000·10,001·10,002원 취소가 와도 원장·Outbox·capture·dedup 무변경과 receipt 재생을 검증합니다. [Emulator](../../functions/test/integration/firebase/firebase-finance-command-adapters.integration.test.ts)는 원승인 10,001원→5,000원×2 이후 원본·미래 월분을 모두 취소합니다. 운영 metadata 조회는 아래와 같으며 연결을 입증할 원본 자료가 없어 복구 mutation은 실행하지 않았습니다. |
| <a id="gap-cat-004"></a>CAT-004 | 실제 경로 검증 보완 | 기존 공백: Android Legacy QuickEdit의 빈값·실패 fallback과 목표 Query의 NoData/RetryableFailure 구분이 실제 adapter에 연결되지 않았습니다. 새 서버 회귀: `functions/test/adapters/firebase/category-active-query-regression.test.ts:7`은 실제 `createCategoryCatalogApplication().listActive()` → `FirebaseCategoryCatalogStore.readActiveCategories()` → Firestore transaction을 실행합니다. 빈 저장소는 no-data, transaction 실패는 CATEGORY_REPOSITORY_UNAVAILABLE retryable-failure, 회복 후 실제 custom 항목은 success입니다. 세 경우 모두 기본 카테고리/receipt/Outbox 생성이 없음을 확인합니다. 1개 통과했습니다. 새 Android 회귀: `android/app/src/androidTest/java/com/household/account/CategoryRepositoryInstrumentationTest.kt:60`은 실제 SDK의 빈 QuerySnapshot 뒤 실제 CategoryRepository를 실행하고 다섯 표시 전용 fallback의 키/빈 문서·가구 ID를 검사합니다. `:76`은 종료된 실제 SDK가 조회 예외를 반환하는 것을 확인한 뒤 같은 fallback을 검사합니다. UUID named FirebaseApp, demo project, localhost:1, network/persistence 비활성으로 격리하고 finally terminate/delete합니다. production singleton을 종료하지 않습니다. 소스 알고리즘은 변경하지 않았습니다. 현재 판정: 서버 adapter 회귀와 Android 신규 2개 모두 통과했습니다. `android/app/build/outputs/androidTest-results/connected/debug/TEST-Medium_Phone_API_36.1(AVD) - 16-_app-.xml:8`~`:9`에서 두 실제 SDK testcase의 통과를 확인했습니다(전체 16개, failures/errors/skipped 0). 운영 한계: Android 테스트는 실제 SDK의 빈 캐시·종료 오류이며 Cloud Rules permission-denied나 실제 통신망 장애를 재현하지 않습니다. Android는 명세상 아직 Legacy Adapter이므로 목표 Query와 하나의 가짜 종단 경로로 합치지 않았습니다. |
| <a id="gap-ext-001"></a>EXT-001 | KIND actual adapter·로그 경계 회귀 보완·통과, 운영 메일 미실행 | 새 `functions/test/adapters/firebase/dividend-provider-health-observation.test.ts:13`은 실제 FirebaseDividendProviderObservation + 실제 CloudMonitoringProviderAlertLogger를 호출합니다(Firestore는 InMemoryFirestore, 최종 logger sink는 spy). 일부 성공은 degraded/closed, 전체 실패 run 3회에만 open, 일부 복구는 같은 identity resolve, channel resource 전달, target/run replay 중복 방지, raw 가구·종목 ID 로그 미노출을 확인합니다. 실제 KIND HTTP adapter 6개, scheduled application 관측 종결 2개, run-health 정책 4개와 함께 총 13개 통과했습니다. / 실제 Cloud Monitoring 정책의 경보 발행·email notification channel 전달·메일함 수신을 실행하지 않았습니다. logger 전이 성공을 '메일 전달 성공'으로 간주하지 않습니다. 외부 KIND 운영 장애를 인위적으로 만들거나 실 운영 메일을 발송하지 않았습니다. |
| <a id="gap-home-003"></a>HOME-003 | 요청한 실패 주입 React 통합 회귀 충족·통과 | 이번 수정에서 이미 추가한 `web/src/__tests__/features/homeProgressiveSummary.contract.test.tsx:29`를 재실행했습니다. 실제 BalanceCards에서 지역화폐 원천 오류를 `조회 실패`로, 성공한 빈 결과를 `데이터 없음`으로, 관측된 0원을 `0`으로 구별하며 독립 카드의 성공값을 계속 표시하는지 검증합니다. `:58/:90`은 원천 도착 순서가 다른 카드까지 막지 않음을 검증합니다. 이 영역에 중복 테스트는 추가하지 않았습니다. / Firestore 서버·브라우저 네트워크 단절을 동시에 주입한 배포 환경 E2E는 아닙니다. |
| <a id="gap-ing-008"></a>ING-008 | 추가 회귀로 서버 재생 공백 해소 | `functions/test/adapters/payment-capture/raw-capture-production-flow.test.ts:43`: 실제 parser→Raw/Submission/Branch Application→Firebase configuration query/receipt/Ledger adapter로 거래·QuickEdit snapshot을 확정한 후 응답 유실을 가정하고 카드 retired·가맹점 mapping 변경 뒤 동일 raw를 재전달합니다. 최초 결과 전체가 동일하고 configuration 재조회·Ledger 변경·balance 재호출·추가 Outbox가 없음을 확인했습니다. 기존 `CaptureDeliveryQueueTest.kt:367,397`은 QuickEdit FIFO 내구화 성공 뒤 journal 삭제, 후속 저장 실패 때 journal 유지를 실제 Kotlin Queue에서 검증합니다. / 추가 Functions 회귀의 Firestore는 실제 adapter가 사용하는 in-memory SDK 대역입니다. OS process kill과 원격 callable 응답 유실을 한 번의 Android↔Emulator 시험으로 결합하지 않았습니다. 기존 Android journal/queue 회귀와 서버 replay 회귀를 연결 근거로 사용합니다. |
| <a id="gap-led-001"></a>LED-001 | 핵심 자동 회귀 보완·통과, 기기 통합 E2E 미실행 | `web/src/__tests__/features/homeReadModelComposition.contract.test.tsx:130`의 다중 소비자 구독 1개, `:149`의 route 소비자 해제 후 AppShell 구독 유지, `:264`의 지출/수입 전환, `:321`의 월 전환을 확인했습니다. 새 `:598`은 실제 LedgerReadModelProvider에 permission-denied를 주입하고 같은 가구의 remoteReadEpoch 재연결 시 값 보존·이전 구독 해제·새 구독 각 1개·오래된 callback 무시·회복을 검증합니다. `homeServerFirstRead.contract.test.ts:67/:253`은 실제 원장/카테고리 adapter의 cache 차단, `homeProgressiveSummary.contract.test.tsx:58/:90`은 독립 카드 도착, `homeFirstCompletePaint.contract.test.tsx:141`은 실제 LedgerPage의 세 원천 완료와 두 frame 완료 조건을 검증합니다. / Web/PWA/WebView 실기기에서 route 이동·권한 갱신·세 원천 도착·cache를 한 시나리오로 묶은 E2E는 실행하지 않았습니다. Provider 테스트의 Auth epoch 입력과 adapter 테스트의 Firestore SDK 응답은 경계 대역입니다. |
| <a id="gap-pwa-006"></a>PWA-006 | actual worker entry 회귀 보완·통과, iPhone 실기기 미실행 | `web/src/__tests__/platform/pwaWorkerNotification.test.ts` 15개는 실제 `web/worker/index.js` entry를 로드하여 등록된 notificationclick/push/background handler를 실행합니다. `/`, `?`, `#`, Unicode ID를 한 path segment로 인코딩하고 현재 계약의 `/expenses/{id}/edit` 경로로 동일 origin 창을 navigate/focus하는지, 없으면 openWindow하는지 검증합니다. `.`, `..`, `%2e`, `%252f`, 역슬래시, 빈 값, 제어문자와 잘못된 version/외부 clickTarget/dismiss는 탐색하지 않습니다. malformed push 차단과 SDK가 이미 표시한 notification의 중복 표시 방지도 확인합니다. 이전 helper-only 테스트를 actual handler 근거로 보완했습니다. / 실제 iPhone 설치형 PWA에 FCM을 보내고 백그라운드 알림을 눌러 화면을 여는 기기 E2E는 실행하지 않았습니다. 기존 Chromium production worker E2E 통과는 별도 근거이며 iPhone 실기기 증거로 대체하지 않습니다. |
| <a id="gap-qe-003"></a>QE-003 | Functions·Android 회귀 통과 | `functions/test/adapters/firebase/quick-edit-production-boundary.test.ts:51`: 실제 알림 Command handler→Ledger UoW→Outbox→Notifications Application/Firebase adapters. 미저장 patch는 저장되지 않고 요청자/요청시각만 기록합니다. actor 없음·빈 requester는 무변경 거부하고, creator 포함 다른 활성 멤버 2명/endpoint 3개 모두 전송하며 requester·removed는 제외하고 replay 재전송은 없습니다. `QuickEditActivityInstrumentationTest.kt:65`는 실제 form 변경 후 알림 버튼→Keystore outbox를 읽어 transactionId/expectedVersion 두 필드만 저장했음을 검사합니다. / provider는 spy여서 FCM OS 표시 성공을 뜻하지 않습니다. Activity 시험은 FirebaseAuth 없는 로컬 세션으로 실제 원격 전송을 막고 Keystore/WorkManager 접수를 확인합니다. Functions와 Android를 동일 wire 계약을 기준으로 각각 실행합니다. |
| <a id="gap-qe-006"></a>QE-006 | Functions·Android 회귀 통과 | `quick-edit-production-boundary.test.ts:77,95`: 실제 Split handler와 FirebaseItemSplitStore로 원본 같은 ID superseded, 전체 파생 생성, 카드/type/출처/creator/lineage/지역화폐/부모 링크 보존 및 replay를 확인합니다. transaction의 전체 쓰기 staging 뒤 예외를 주입하면 원본 active·파생/receipt/Outbox 0건입니다. 기존 actual Emulator `firebase-finance-command-adapters.integration.test.ts:309`도 대규모 원장에서 실제 item split의 superseded/자식 저장을 검증했고 이전 전체 Firebase 72개에 포함됐습니다. / 새 abort 주입은 실제 adapter+transaction 대역이며 서버 SDK의 commit 네트워크 장애를 강제로 발생시키지는 않았습니다. Android payload의 최신 검증은 아래 QE-010과 공유합니다. |
| <a id="gap-qe-010"></a>QE-010 | Functions·Android 회귀 통과 | `QuickEditActivity.kt:406,407,558,559`에서 category/memo도 분할 버튼 시점 값으로 고정하도록 보완했습니다. `QuickEditActivityInstrumentationTest.kt:87`는 dialog 뒤 form memo 변경이 고정 baseDraft에 섞이지 않고 전체 합·한 envelope·버전·원증거 필드 제외를 검증합니다. `quick-edit-production-boundary.test.ts:95`는 stale→무변경 거부→사용자가 최신 active version으로 새 Command를 작성한 경우 성공, superseded/deleted는 재분할 거부를 확인합니다. `QuickEditEncryptedOutboxInstrumentationTest.kt:33`은 실제 Keystore 재로딩 후 conflict payload 유지, 자동 재전송 없음, 알림 ack 뒤 삭제를 확인합니다. / 실패 알림은 최신 지출을 확인하도록 앱을 엽니다. 과거 초안을 자동 재적용하거나 병합하지 않습니다. 실제 OS 알림 클릭→Web 최신 화면→새 분할까지 한 기기에서 연결한 E2E는 이번 범위에 포함되지 않습니다. |
| <a id="gap-qe-012"></a>QE-012 | Kotlin·실제 저장소/Activity 회귀 통과 | `QuickEditCommandDeliveryLifecycleTest.kt:28`에 commit false/throw 시 예약·Accepted 없음 추가. 기존 예약 실패/동일 envelope 재접수/짧은 session 임계영역 검증 유지. `QuickEditCommandOutboxTest.kt:84,113,297`은 conflict 알림 보존·느린 서버 중 다음 접수·FIFO·72h-1ms/정확72h를 검증합니다. `QuickEditEncryptedOutboxInstrumentationTest.kt:33,56,76`은 실제 AES-256-GCM 암호화 저장/reload, ciphertext·key·codec 손상 fail-closed 및 비민감 pending flag, 정확72h를 검증합니다. 실제 Activity 시험 2개는 WorkManager DB 예약 확인 뒤 Activity 종료도 검사합니다. / WorkManager 실제 callback의 OS 스케줄 지연 자체는 보장하지 않습니다. 실패 알림 전달 실패/권한 차단은 기존 Kotlin pending 재시도 상태와 production notifier 분기 근거이며, 제조사별 OS 알림 정책을 모두 시험한 것은 아닙니다. |
| <a id="gap-rec-006"></a>REC-006 | 실제 경로 검증 보완 | 기존 공백의 상당 부분은 실제 운영 migration 경로가 이미 검증합니다. `functions/scripts/migrate-runtime.mjs:145`가 실제 FirebaseRuntimeMigrationPlanBuilder/Persistence와 migration Application을 조립합니다. collector의 `recurringCreators` 해석, 같은 가구 Member 검증, 누락 unresolved, immutable canonical creator 검사와 migration receipt 작성은 `financeRuntimeMigrationCollector.ts:473` 이후 및 `runtimeMigrationCollectorContract.ts:159`에 있습니다. 기존 실제 Emulator: `firebase-runtime-migration.integration.test.ts:266`의 dry-run→checkpoint apply→replay와 `:424`~`:426`의 명시 creator·처리 월·receipt 검증, `:476`의 누락 creator unresolved 및 apply 업무 write 0건, `:517`의 기존 creator 보존을 확인했습니다. `firebase-finance-command-adapters.integration.test.ts:500`은 실제 생성/수정/삭제가 creator를 보존하고 `:1111` 이후 실제 scheduler 생성 거래도 저장 creator를 사용합니다. 이번에 기존 Emulator suite를 별도 재실행하지 않았으며 Root의 통합 실행 결과를 사용합니다. 새 실제 handler→scheduler 회귀: `functions/test/adapters/firebase/recurring-creator-runtime-regression.test.ts:18`은 create payload에 가짜 creator를 넣고 다른 가구원으로 수정한 뒤 실제 Firebase scheduler UoW가 최초 인증된 creator의 거래를 만드는 것을 확인합니다. `:40`은 creator 없는 실제 legacy 문서를 scheduler가 현재 actor로 추정하지 않고 write 0건을 유지하는지 확인합니다. 추가 결함 재현 및 수정: canonical이 아직 없을 때 기존 유효 legacy creator보다 상충 `recurringCreators` mapping이 우선되어 최초 creator가 변경될 수 있었습니다. 새 `:50` 테스트에서 실제 FirebaseRuntimeMigrationPlanBuilder가 충돌 없이 잘못된 후보를 만드는 것을 먼저 재현했습니다. collector에 `SOURCE_DOCUMENT_INVALID / RECURRING_CREATOR_MAPPING_CONFLICT` unresolved 차단을 추가한 뒤 통과했습니다. 해당 recurring 계획과 creator receipt 후보가 생성되지 않고 원본도 보존됩니다. 현재 판정: 새 실제 경로 3개 통과, Functions 타입 검사 통과입니다. 누락 creator의 운영 관측은 migration dry-run의 `RECURRING_CREATOR_MAPPING_REQUIRED` 보고서에 있으며 scheduler의 조용한 제외를 typed 성공 거래로 해석하지 않습니다. 운영 한계: 실제 사용자 계획에 mapping을 적용하지 않았습니다. 운영자는 원본과 같은 가구 Member를 확인하여 manifest를 작성해야 하며 자동 추정은 허용하지 않습니다. |
| <a id="gap-stat-001"></a>STAT-001 | actual selector 공백 해소·통과 | `web/src/__tests__/features/statisticsPage.test.tsx:134`는 실제 StatsPage+PeriodSelector에 UTC 2026-08-31 15:00(서울 9월 1일)을 주입하여 기본 12개월·3개월·6개월·불완전 custom의 12개월 fallback·완전 custom의 월초/월말 read 인자를 검증합니다. `:150`은 역전 custom에서 오류를 표시하고 read 호출을 추가하지 않으며 이전 가구의 늦은 응답도 버리는지 검증합니다. / calendar 기준과 selector→read 요청을 실제 React 경계에서 검증했으며 브라우저 OS 시간대 변경 E2E는 아닙니다. |
| <a id="gap-stat-003"></a>STAT-003 | actual 화면 공백 보완 및 호환 기본값 수정·통과 | `web/src/__tests__/features/statisticsPage.test.tsx:108`은 처음 빈 category catalog가 비동기로 도착한 후 0원 예산을 포함한 예산 활성 category를 최초 선택하는지, 사용자 토글 후 catalog 재수신이 이를 덮지 않는지, 기간 변경 시 화면 토글을 유지하는지, 가구 변경 후 새 catalog 도착 시 재초기화하는지 검증합니다. 실제 MonthlyTrendChart control을 사용하며 canvas만 대역으로 교체했습니다. `StatsPage`의 fallback을 활성 catalog에 실제 존재하는 호환 기본 category로 제한하여 없거나 보관된 기본값을 암묵 선택하지 않도록 수정했습니다. control에 `aria-pressed`를 연결했습니다. / 원래 testGap의 '기간 변경 후 초기화'는 명세의 필수 동작이 아닙니다. reporting/requirements.md:47은 사용자 토글을 '현재 화면 생명주기 안에서만 유지'한다고 명시하므로 동일 화면의 기간 변경은 보존으로 검증했습니다. 가구/재인증 scope 변경은 초기화합니다. 새 제품 정책을 추가하지 않았습니다. |
| <a id="gap-stat-004"></a>STAT-004 | 실제 실패 결함 수정 및 actual 모달 회귀 통과 | 기존 StatsPage 테스트가 ExpenseEditModal 전체를 mock하여 놓친 결함을 찾았습니다. 실제 ExpenseEditModal은 onDelete/onSave 완료 전에 onClose하여 통계 실패 draft가 사라졌습니다. 통계에만 `preserveDraftUntilSuccess`를 전달하여 서버 완료 전 편집을 유지하고 실패 시 입력·상세·기간·revision을 보존하도록 고쳤습니다. `web/src/__tests__/features/statisticsPage.test.tsx:68`의 delete/save 2개는 실제 편집 폼과 ConfirmDialog에서 pending→실패→재시도 성공을 실행하고 메모/금액/선택 상세 보존·실패 시 read 0회·성공 후 같은 기간 read 1회를 확인합니다. `:46`은 실제 category 기억 checkbox까지 눌러 단일 update 호출에 true를 전달하는 성공 경로를 검증합니다. 기존 `expenseEditSavePipeline.contract.test.tsx` 6개도 통과하여 원장의 즉시 닫기 계약을 유지했습니다. / read/command 외부 경계는 대역입니다. 서버 receipt/Event 검증은 소유 Ledger/Payment Configuration의 별도 actual command 통합 근거와 연결해야 하며 이 화면 테스트만으로 발행까지 보증하지 않습니다. |

## 요구사항별 연결

각 행은 최초 전수 검토의 요구사항을 보존하고 관련 수정 지적 또는 검증 부족 후속 결과에 연결합니다. 추가 지적·공백이 없던 94개는 최초 구현 근거 확인 결과를 유지합니다. 실행되지 않은 운영 검증까지 완료했다는 뜻은 아닙니다.

| 요구사항 | 모듈 | 관련 수정 |
|---|---|---|
| [HH-001](../../docs/requirements/contexts/access-household/modules/household-access/requirements.md) | household-access | [ACC-05](#acc-05), [ACC-06](#acc-06) |
| [HH-002](../../docs/requirements/contexts/access-household/modules/household-access/requirements.md) | household-access | [ACC-05](#acc-05), [ACC-06](#acc-06), [ACC-07](#acc-07) |
| [HH-003](../../docs/requirements/contexts/access-household/modules/household-access/requirements.md) | household-access | [ACC-05](#acc-05), [ACC-06](#acc-06) |
| [HH-004](../../docs/requirements/contexts/access-household/modules/household-access/requirements.md) | household-access | [CAP-15](#cap-15) |
| [HH-005](../../docs/requirements/contexts/access-household/modules/household-access/requirements.md) | household-access | 추가 수정 지적 없음 (구현 근거 확인) |
| [HH-006](../../docs/requirements/contexts/access-household/modules/household-access/requirements.md) | household-access | 추가 수정 지적 없음 (구현 근거 확인) |
| [HH-007](../../docs/requirements/contexts/access-household/modules/household-access/requirements.md) | household-access | [ACC-01](#acc-01), [ACC-04](#acc-04) |
| [HH-008](../../docs/requirements/contexts/access-household/modules/household-access/requirements.md) | household-access | [ACC-01](#acc-01), [ACC-02](#acc-02), [ACC-03](#acc-03) |
| [HH-009](../../docs/requirements/contexts/access-household/modules/household-access/requirements.md) | household-access | [ACC-10](#acc-10), [EFF-01](#eff-01) |
| [HH-010](../../docs/requirements/contexts/access-household/modules/household-access/requirements.md) | household-access | 추가 수정 지적 없음 (구현 근거 확인) |
| [HH-011](../../docs/requirements/contexts/access-household/modules/household-access/requirements.md) | household-access | 추가 수정 지적 없음 (구현 근거 확인) |
| [HH-012](../../docs/requirements/contexts/access-household/modules/household-access/requirements.md) | household-access | [ACC-10](#acc-10), [CAP-03](#cap-03) |
| [HH-JOIN-001](../../docs/requirements/contexts/access-household/modules/household-access/requirements.md) | household-access | 추가 수정 지적 없음 (구현 근거 확인) |
| [ADM-001](../../docs/requirements/contexts/access-household/modules/household-access/requirements.md) | household-access | [ACC-11](#acc-11), [EFF-01](#eff-01) |
| [ADM-002](../../docs/requirements/contexts/access-household/modules/household-access/requirements.md) | household-access | [ACC-01](#acc-01) |
| [ADM-003](../../docs/requirements/contexts/access-household/modules/household-access/requirements.md) | household-access | [ACC-02](#acc-02), [ACC-03](#acc-03), [ACC-07](#acc-07) |
| [ADM-004](../../docs/requirements/contexts/access-household/modules/household-access/requirements.md) | household-access | 추가 수정 지적 없음 (구현 근거 확인) |
| [ADM-005](../../docs/requirements/contexts/access-household/modules/household-access/requirements.md) | household-access | [ACC-09](#acc-09) |
| [ADM-006](../../docs/requirements/contexts/access-household/modules/household-access/requirements.md) | household-access | [ACC-08](#acc-08) |
| [CAT-001](../../docs/requirements/contexts/household-finance/modules/categories-budget/requirements.md) | categories-budget | [ACC-04](#acc-04) |
| [CAT-002](../../docs/requirements/contexts/household-finance/modules/categories-budget/requirements.md) | categories-budget | [FIN-03](#fin-03), [FIN-04](#fin-04) |
| [CAT-003](../../docs/requirements/contexts/household-finance/modules/categories-budget/requirements.md) | categories-budget | [FIN-03](#fin-03), [FIN-04](#fin-04) |
| [CAT-004](../../docs/requirements/contexts/household-finance/modules/categories-budget/requirements.md) | categories-budget | [후속 검증·한계](#gap-cat-004) |
| [BUD-001](../../docs/requirements/contexts/household-finance/modules/categories-budget/requirements.md) | categories-budget | 추가 수정 지적 없음 (구현 근거 확인) |
| [BUD-002](../../docs/requirements/contexts/household-finance/modules/categories-budget/requirements.md) | categories-budget | 추가 수정 지적 없음 (구현 근거 확인) |
| [LED-001](../../docs/requirements/contexts/household-finance/modules/ledger/requirements.md) | ledger | [후속 검증·한계](#gap-led-001) |
| [LED-002](../../docs/requirements/contexts/household-finance/modules/ledger/requirements.md) | ledger | 추가 수정 지적 없음 (구현 근거 확인) |
| [LED-003](../../docs/requirements/contexts/household-finance/modules/ledger/requirements.md) | ledger | [FIN-10](#fin-10) |
| [LED-004](../../docs/requirements/contexts/household-finance/modules/ledger/requirements.md) | ledger | 추가 수정 지적 없음 (구현 근거 확인) |
| [LED-005](../../docs/requirements/contexts/household-finance/modules/ledger/requirements.md) | ledger | [FIN-01](#fin-01), [FIN-07](#fin-07), [FIN-06](#fin-06) |
| [LED-006](../../docs/requirements/contexts/household-finance/modules/ledger/requirements.md) | ledger | [FIN-09](#fin-09) |
| [LED-007](../../docs/requirements/contexts/household-finance/modules/ledger/requirements.md) | ledger | [FIN-01](#fin-01) |
| [LED-008](../../docs/requirements/contexts/household-finance/modules/ledger/requirements.md) | ledger | [FIN-01](#fin-01) |
| [LED-009](../../docs/requirements/contexts/household-finance/modules/ledger/requirements.md) | ledger | [FIN-01](#fin-01), [FIN-02](#fin-02), [FIN-23](#fin-23) |
| [LED-010](../../docs/requirements/contexts/household-finance/modules/ledger/requirements.md) | ledger | 추가 수정 지적 없음 (구현 근거 확인) |
| [SPL-001](../../docs/requirements/contexts/household-finance/modules/ledger/requirements.md) | ledger | [FIN-08](#fin-08) |
| [SPL-002](../../docs/requirements/contexts/household-finance/modules/ledger/requirements.md) | ledger | 추가 수정 지적 없음 (구현 근거 확인) |
| [SPL-003](../../docs/requirements/contexts/household-finance/modules/ledger/requirements.md) | ledger | [FIN-02](#fin-02) |
| [SPL-004](../../docs/requirements/contexts/household-finance/modules/ledger/requirements.md) | ledger | [FIN-02](#fin-02) |
| [SPL-005](../../docs/requirements/contexts/household-finance/modules/ledger/requirements.md) | ledger | 추가 수정 지적 없음 (구현 근거 확인) |
| [SPL-006](../../docs/requirements/contexts/household-finance/modules/ledger/requirements.md) | ledger | [FIN-22](#fin-22) |
| [MRG-001](../../docs/requirements/contexts/household-finance/modules/ledger/requirements.md) | ledger | 추가 수정 지적 없음 (구현 근거 확인) |
| [MRG-002](../../docs/requirements/contexts/household-finance/modules/ledger/requirements.md) | ledger | 추가 수정 지적 없음 (구현 근거 확인) |
| [SEA-001](../../docs/requirements/contexts/household-finance/modules/ledger/requirements.md) | ledger | 추가 수정 지적 없음 (구현 근거 확인) |
| [SEA-002](../../docs/requirements/contexts/household-finance/modules/ledger/requirements.md) | ledger | [FIN-23](#fin-23) |
| [SEA-003](../../docs/requirements/contexts/household-finance/modules/ledger/requirements.md) | ledger | [FIN-05](#fin-05), [FIN-06](#fin-06) |
| [SEA-004](../../docs/requirements/contexts/household-finance/modules/ledger/requirements.md) | ledger | [FIN-05](#fin-05) |
| [SEA-005](../../docs/requirements/contexts/household-finance/modules/ledger/requirements.md) | ledger | 추가 수정 지적 없음 (구현 근거 확인) |
| [BAL-001](../../docs/requirements/contexts/household-finance/modules/local-currency/requirements.md) | local-currency | 추가 수정 지적 없음 (구현 근거 확인) |
| [BAL-002](../../docs/requirements/contexts/household-finance/modules/local-currency/requirements.md) | local-currency | 추가 수정 지적 없음 (구현 근거 확인) |
| [BAL-003](../../docs/requirements/contexts/household-finance/modules/local-currency/requirements.md) | local-currency | 추가 수정 지적 없음 (구현 근거 확인) |
| [BAL-004](../../docs/requirements/contexts/household-finance/modules/local-currency/requirements.md) | local-currency | [후속 검증·한계](#gap-bal-004) |
| [BAL-005](../../docs/requirements/contexts/household-finance/modules/local-currency/requirements.md) | local-currency | 추가 수정 지적 없음 (구현 근거 확인) |
| [REC-001](../../docs/requirements/contexts/household-finance/modules/recurring-transactions/requirements.md) | recurring-transactions | [FIN-04](#fin-04) |
| [REC-002](../../docs/requirements/contexts/household-finance/modules/recurring-transactions/requirements.md) | recurring-transactions | [FIN-19](#fin-19) |
| [REC-003](../../docs/requirements/contexts/household-finance/modules/recurring-transactions/requirements.md) | recurring-transactions | [FIN-19](#fin-19) |
| [REC-004](../../docs/requirements/contexts/household-finance/modules/recurring-transactions/requirements.md) | recurring-transactions | 추가 수정 지적 없음 (구현 근거 확인) |
| [REC-005](../../docs/requirements/contexts/household-finance/modules/recurring-transactions/requirements.md) | recurring-transactions | [FIN-03](#fin-03) |
| [REC-006](../../docs/requirements/contexts/household-finance/modules/recurring-transactions/requirements.md) | recurring-transactions | [후속 검증·한계](#gap-rec-006) |
| [PUSH-001](../../docs/requirements/contexts/notifications/modules/notifications/requirements.md) | notifications | 추가 수정 지적 없음 (구현 근거 확인) |
| [PUSH-002](../../docs/requirements/contexts/notifications/modules/notifications/requirements.md) | notifications | 추가 수정 지적 없음 (구현 근거 확인) |
| [PUSH-003](../../docs/requirements/contexts/notifications/modules/notifications/requirements.md) | notifications | [CAP-15](#cap-15) |
| [PUSH-004](../../docs/requirements/contexts/notifications/modules/notifications/requirements.md) | notifications | [CAP-01](#cap-01), [CAP-23](#cap-23) |
| [PUSH-005](../../docs/requirements/contexts/notifications/modules/notifications/requirements.md) | notifications | 추가 수정 지적 없음 (구현 근거 확인) |
| [PUSH-006](../../docs/requirements/contexts/notifications/modules/notifications/requirements.md) | notifications | 추가 수정 지적 없음 (구현 근거 확인) |
| [PUSH-007](../../docs/requirements/contexts/notifications/modules/notifications/requirements.md) | notifications | 추가 수정 지적 없음 (구현 근거 확인) |
| [PUSH-008](../../docs/requirements/contexts/notifications/modules/notifications/requirements.md) | notifications | [CAP-04](#cap-04) |
| [PUSH-009](../../docs/requirements/contexts/notifications/modules/notifications/requirements.md) | notifications | 추가 수정 지적 없음 (구현 근거 확인) |
| [PUSH-010](../../docs/requirements/contexts/notifications/modules/notifications/requirements.md) | notifications | [CAP-04](#cap-04), [CAP-05](#cap-05) |
| [PUSH-011](../../docs/requirements/contexts/notifications/modules/notifications/requirements.md) | notifications | [CAP-16](#cap-16) |
| [PUSH-012](../../docs/requirements/contexts/notifications/modules/notifications/requirements.md) | notifications | [CAP-01](#cap-01), [CAP-03](#cap-03) |
| [PUSH-013](../../docs/requirements/contexts/notifications/modules/notifications/requirements.md) | notifications | [CAP-18](#cap-18) |
| [PUSH-014](../../docs/requirements/contexts/notifications/modules/notifications/requirements.md) | notifications | [CAP-01](#cap-01) |
| [ING-001](../../docs/requirements/contexts/payment-capture/modules/android-payment-ingestion/requirements.md) | android-payment-ingestion | 추가 수정 지적 없음 (구현 근거 확인) |
| [ING-002](../../docs/requirements/contexts/payment-capture/modules/android-payment-ingestion/requirements.md) | android-payment-ingestion | 추가 수정 지적 없음 (구현 근거 확인) |
| [ING-003](../../docs/requirements/contexts/payment-capture/modules/android-payment-ingestion/requirements.md) | android-payment-ingestion | [CAP-09](#cap-09) |
| [ING-004](../../docs/requirements/contexts/payment-capture/modules/android-payment-ingestion/requirements.md) | android-payment-ingestion | 추가 수정 지적 없음 (구현 근거 확인) |
| [ING-005](../../docs/requirements/contexts/payment-capture/modules/android-payment-ingestion/requirements.md) | android-payment-ingestion | 추가 수정 지적 없음 (구현 근거 확인) |
| [ING-006](../../docs/requirements/contexts/payment-capture/modules/android-payment-ingestion/requirements.md) | android-payment-ingestion | [CAP-09](#cap-09) |
| [ING-007](../../docs/requirements/contexts/payment-capture/modules/android-payment-ingestion/requirements.md) | android-payment-ingestion | [CAP-09](#cap-09) |
| [ING-008](../../docs/requirements/contexts/payment-capture/modules/android-payment-ingestion/requirements.md) | android-payment-ingestion | [후속 검증·한계](#gap-ing-008) |
| [ING-009](../../docs/requirements/contexts/payment-capture/modules/android-payment-ingestion/requirements.md) | android-payment-ingestion | [CAP-09](#cap-09) |
| [PARSE-KB-001](../../docs/requirements/contexts/payment-capture/modules/android-payment-ingestion/requirements.md) | android-payment-ingestion | 추가 수정 지적 없음 (구현 근거 확인) |
| [PARSE-NH-001](../../docs/requirements/contexts/payment-capture/modules/android-payment-ingestion/requirements.md) | android-payment-ingestion | 추가 수정 지적 없음 (구현 근거 확인) |
| [PARSE-NAVER-001](../../docs/requirements/contexts/payment-capture/modules/android-payment-ingestion/requirements.md) | android-payment-ingestion | 추가 수정 지적 없음 (구현 근거 확인) |
| [PARSE-TOSS-001](../../docs/requirements/contexts/payment-capture/modules/android-payment-ingestion/requirements.md) | android-payment-ingestion | [CAP-10](#cap-10) |
| [PARSE-KAKAO-001](../../docs/requirements/contexts/payment-capture/modules/android-payment-ingestion/requirements.md) | android-payment-ingestion | 추가 수정 지적 없음 (구현 근거 확인) |
| [PARSE-ONNURI-001](../../docs/requirements/contexts/payment-capture/modules/android-payment-ingestion/requirements.md) | android-payment-ingestion | 추가 수정 지적 없음 (구현 근거 확인) |
| [PARSE-PAYBOOC-001](../../docs/requirements/contexts/payment-capture/modules/android-payment-ingestion/requirements.md) | android-payment-ingestion | 추가 수정 지적 없음 (구현 근거 확인) |
| [PARSE-SAMSUNG-001](../../docs/requirements/contexts/payment-capture/modules/android-payment-ingestion/requirements.md) | android-payment-ingestion | 추가 수정 지적 없음 (구현 근거 확인) |
| [PARSE-LOTTE-001](../../docs/requirements/contexts/payment-capture/modules/android-payment-ingestion/requirements.md) | android-payment-ingestion | 추가 수정 지적 없음 (구현 근거 확인) |
| [PARSE-GYEONGGI-001](../../docs/requirements/contexts/payment-capture/modules/android-payment-ingestion/requirements.md) | android-payment-ingestion | [CAP-09](#cap-09) |
| [PARSE-DAEJEON-001](../../docs/requirements/contexts/payment-capture/modules/android-payment-ingestion/requirements.md) | android-payment-ingestion | [CAP-09](#cap-09) |
| [PARSE-SEJONG-001](../../docs/requirements/contexts/payment-capture/modules/android-payment-ingestion/requirements.md) | android-payment-ingestion | 추가 수정 지적 없음 (구현 근거 확인) |
| [PARSE-CITYGAS-001](../../docs/requirements/contexts/payment-capture/modules/android-payment-ingestion/requirements.md) | android-payment-ingestion | [CAP-22](#cap-22) |
| [PARSE-SMSBILL-001](../../docs/requirements/contexts/payment-capture/modules/android-payment-ingestion/requirements.md) | android-payment-ingestion | 추가 수정 지적 없음 (구현 근거 확인) |
| [PARSE-COMMON-001](../../docs/requirements/contexts/payment-capture/modules/android-payment-ingestion/requirements.md) | android-payment-ingestion | 추가 수정 지적 없음 (구현 근거 확인) |
| [ING-SAVE-001](../../docs/requirements/contexts/payment-capture/modules/android-payment-ingestion/requirements.md) | android-payment-ingestion | 추가 수정 지적 없음 (구현 근거 확인) |
| [ING-SAVE-002](../../docs/requirements/contexts/payment-capture/modules/android-payment-ingestion/requirements.md) | android-payment-ingestion | 추가 수정 지적 없음 (구현 근거 확인) |
| [ING-SAVE-003](../../docs/requirements/contexts/payment-capture/modules/android-payment-ingestion/requirements.md) | android-payment-ingestion | 추가 수정 지적 없음 (구현 근거 확인) |
| [ING-SAVE-004](../../docs/requirements/contexts/payment-capture/modules/android-payment-ingestion/requirements.md) | android-payment-ingestion | 추가 수정 지적 없음 (구현 근거 확인) |
| [ING-SAVE-005](../../docs/requirements/contexts/payment-capture/modules/android-payment-ingestion/requirements.md) | android-payment-ingestion | 추가 수정 지적 없음 (구현 근거 확인) |
| [ING-SAVE-006](../../docs/requirements/contexts/payment-capture/modules/android-payment-ingestion/requirements.md) | android-payment-ingestion | 추가 수정 지적 없음 (구현 근거 확인) |
| [ING-SAVE-007](../../docs/requirements/contexts/payment-capture/modules/android-payment-ingestion/requirements.md) | android-payment-ingestion | [FIN-02](#fin-02) |
| [CAN-001](../../docs/requirements/contexts/payment-capture/modules/android-payment-ingestion/requirements.md) | android-payment-ingestion | [CAP-11](#cap-11) |
| [CAN-002](../../docs/requirements/contexts/payment-capture/modules/android-payment-ingestion/requirements.md) | android-payment-ingestion | [CAP-12](#cap-12) |
| [CAN-003](../../docs/requirements/contexts/payment-capture/modules/android-payment-ingestion/requirements.md) | android-payment-ingestion | [CAP-10](#cap-10) |
| [CAN-004](../../docs/requirements/contexts/payment-capture/modules/android-payment-ingestion/requirements.md) | android-payment-ingestion | 추가 수정 지적 없음 (구현 근거 확인) |
| [CAN-005](../../docs/requirements/contexts/payment-capture/modules/android-payment-ingestion/requirements.md) | android-payment-ingestion | 추가 수정 지적 없음 (구현 근거 확인) |
| [CAN-006](../../docs/requirements/contexts/payment-capture/modules/android-payment-ingestion/requirements.md) | android-payment-ingestion | [후속 검증·한계](#gap-can-006) |
| [CAN-007](../../docs/requirements/contexts/payment-capture/modules/android-payment-ingestion/requirements.md) | android-payment-ingestion | [CAP-11](#cap-11), [CAP-14](#cap-14) |
| [CARD-001](../../docs/requirements/contexts/payment-capture/modules/payment-configuration/requirements.md) | payment-configuration | 추가 수정 지적 없음 (구현 근거 확인) |
| [CARD-002](../../docs/requirements/contexts/payment-capture/modules/payment-configuration/requirements.md) | payment-configuration | 추가 수정 지적 없음 (구현 근거 확인) |
| [CARD-003](../../docs/requirements/contexts/payment-capture/modules/payment-configuration/requirements.md) | payment-configuration | [FIN-04](#fin-04) |
| [CARD-004](../../docs/requirements/contexts/payment-capture/modules/payment-configuration/requirements.md) | payment-configuration | 추가 수정 지적 없음 (구현 근거 확인) |
| [CARD-005](../../docs/requirements/contexts/payment-capture/modules/payment-configuration/requirements.md) | payment-configuration | [FIN-04](#fin-04) |
| [MER-001](../../docs/requirements/contexts/payment-capture/modules/payment-configuration/requirements.md) | payment-configuration | [CAP-20](#cap-20) |
| [MER-002](../../docs/requirements/contexts/payment-capture/modules/payment-configuration/requirements.md) | payment-configuration | [CAP-20](#cap-20) |
| [MER-003](../../docs/requirements/contexts/payment-capture/modules/payment-configuration/requirements.md) | payment-configuration | [CAP-22](#cap-22) |
| [MER-004](../../docs/requirements/contexts/payment-capture/modules/payment-configuration/requirements.md) | payment-configuration | [FIN-04](#fin-04), [CAP-07](#cap-07) |
| [MER-005](../../docs/requirements/contexts/payment-capture/modules/payment-configuration/requirements.md) | payment-configuration | [CAP-21](#cap-21) |
| [MER-006](../../docs/requirements/contexts/payment-capture/modules/payment-configuration/requirements.md) | payment-configuration | [CAP-08](#cap-08) |
| [MER-007](../../docs/requirements/contexts/payment-capture/modules/payment-configuration/requirements.md) | payment-configuration | [FIN-03](#fin-03) |
| [IOS-001](../../docs/requirements/contexts/payment-capture/modules/shortcut-ingestion/requirements.md) | shortcut-ingestion | 추가 수정 지적 없음 (구현 근거 확인) |
| [IOS-002](../../docs/requirements/contexts/payment-capture/modules/shortcut-ingestion/requirements.md) | shortcut-ingestion | 추가 수정 지적 없음 (구현 근거 확인) |
| [IOS-003](../../docs/requirements/contexts/payment-capture/modules/shortcut-ingestion/requirements.md) | shortcut-ingestion | [CAP-17](#cap-17) |
| [IOS-004](../../docs/requirements/contexts/payment-capture/modules/shortcut-ingestion/requirements.md) | shortcut-ingestion | 추가 수정 지적 없음 (구현 근거 확인) |
| [IOS-005](../../docs/requirements/contexts/payment-capture/modules/shortcut-ingestion/requirements.md) | shortcut-ingestion | 추가 수정 지적 없음 (구현 근거 확인) |
| [IOS-006](../../docs/requirements/contexts/payment-capture/modules/shortcut-ingestion/requirements.md) | shortcut-ingestion | 추가 수정 지적 없음 (구현 근거 확인) |
| [IOS-007](../../docs/requirements/contexts/payment-capture/modules/shortcut-ingestion/requirements.md) | shortcut-ingestion | 추가 수정 지적 없음 (구현 근거 확인) |
| [IOS-008](../../docs/requirements/contexts/payment-capture/modules/shortcut-ingestion/requirements.md) | shortcut-ingestion | [CAP-01](#cap-01) |
| [IOS-009](../../docs/requirements/contexts/payment-capture/modules/shortcut-ingestion/requirements.md) | shortcut-ingestion | [CAP-02](#cap-02) |
| [IOS-010](../../docs/requirements/contexts/payment-capture/modules/shortcut-ingestion/requirements.md) | shortcut-ingestion | [CAP-17](#cap-17) |
| [IOS-011](../../docs/requirements/contexts/payment-capture/modules/shortcut-ingestion/requirements.md) | shortcut-ingestion | [CAP-13](#cap-13) |
| [IOS-012](../../docs/requirements/contexts/payment-capture/modules/shortcut-ingestion/requirements.md) | shortcut-ingestion | 추가 수정 지적 없음 (구현 근거 확인) |
| [IOS-013](../../docs/requirements/contexts/payment-capture/modules/shortcut-ingestion/requirements.md) | shortcut-ingestion | 추가 수정 지적 없음 (구현 근거 확인) |
| [IOS-014](../../docs/requirements/contexts/payment-capture/modules/shortcut-ingestion/requirements.md) | shortcut-ingestion | [CAP-17](#cap-17) |
| [IOS-015](../../docs/requirements/contexts/payment-capture/modules/shortcut-ingestion/requirements.md) | shortcut-ingestion | [CAP-11](#cap-11) |
| [AUTO-001](../../docs/requirements/contexts/portfolio/modules/asset-automation/requirements.md) | asset-automation | 추가 수정 지적 없음 (구현 근거 확인) |
| [AUTO-002](../../docs/requirements/contexts/portfolio/modules/asset-automation/requirements.md) | asset-automation | [FIN-20](#fin-20) |
| [LOAN-001](../../docs/requirements/contexts/portfolio/modules/asset-automation/requirements.md) | asset-automation | 추가 수정 지적 없음 (구현 근거 확인) |
| [LOAN-002](../../docs/requirements/contexts/portfolio/modules/asset-automation/requirements.md) | asset-automation | 추가 수정 지적 없음 (구현 근거 확인) |
| [AUTO-003](../../docs/requirements/contexts/portfolio/modules/asset-automation/requirements.md) | asset-automation | [FIN-21](#fin-21) |
| [DIV-001](../../docs/requirements/contexts/portfolio/modules/dividends/requirements.md) | dividends | 추가 수정 지적 없음 (구현 근거 확인) |
| [DIV-002](../../docs/requirements/contexts/portfolio/modules/dividends/requirements.md) | dividends | [FIN-16](#fin-16) |
| [DIV-003](../../docs/requirements/contexts/portfolio/modules/dividends/requirements.md) | dividends | 추가 수정 지적 없음 (구현 근거 확인) |
| [DIV-004](../../docs/requirements/contexts/portfolio/modules/dividends/requirements.md) | dividends | [FIN-19](#fin-19) |
| [DIV-005](../../docs/requirements/contexts/portfolio/modules/dividends/requirements.md) | dividends | 추가 수정 지적 없음 (구현 근거 확인) |
| [DIV-006](../../docs/requirements/contexts/portfolio/modules/dividends/requirements.md) | dividends | [FIN-17](#fin-17) |
| [JOB-DIV-001](../../docs/requirements/contexts/portfolio/modules/dividends/requirements.md) | dividends | [FIN-19](#fin-19) |
| [JOB-DIV-002](../../docs/requirements/contexts/portfolio/modules/dividends/requirements.md) | dividends | [FIN-18](#fin-18) |
| [HOLD-001](../../docs/requirements/contexts/portfolio/modules/holdings-market-data/requirements.md) | holdings-market-data | 추가 수정 지적 없음 (구현 근거 확인) |
| [HOLD-002](../../docs/requirements/contexts/portfolio/modules/holdings-market-data/requirements.md) | holdings-market-data | [FIN-11](#fin-11) |
| [HOLD-003](../../docs/requirements/contexts/portfolio/modules/holdings-market-data/requirements.md) | holdings-market-data | [FIN-11](#fin-11), [FIN-13](#fin-13) |
| [HOLD-004](../../docs/requirements/contexts/portfolio/modules/holdings-market-data/requirements.md) | holdings-market-data | [FIN-14](#fin-14) |
| [HOLD-005](../../docs/requirements/contexts/portfolio/modules/holdings-market-data/requirements.md) | holdings-market-data | 추가 수정 지적 없음 (구현 근거 확인) |
| [FUND-001](../../docs/requirements/contexts/portfolio/modules/holdings-market-data/requirements.md) | holdings-market-data | [FIN-12](#fin-12) |
| [GOLD-001](../../docs/requirements/contexts/portfolio/modules/holdings-market-data/requirements.md) | holdings-market-data | [FIN-11](#fin-11) |
| [GOLD-002](../../docs/requirements/contexts/portfolio/modules/holdings-market-data/requirements.md) | holdings-market-data | 추가 수정 지적 없음 (구현 근거 확인) |
| [MARKET-001](../../docs/requirements/contexts/portfolio/modules/holdings-market-data/requirements.md) | holdings-market-data | 추가 수정 지적 없음 (구현 근거 확인) |
| [MARKET-002](../../docs/requirements/contexts/portfolio/modules/holdings-market-data/requirements.md) | holdings-market-data | 추가 수정 지적 없음 (구현 근거 확인) |
| [MARKET-003](../../docs/requirements/contexts/portfolio/modules/holdings-market-data/requirements.md) | holdings-market-data | 추가 수정 지적 없음 (구현 근거 확인) |
| [MARKET-004](../../docs/requirements/contexts/portfolio/modules/holdings-market-data/requirements.md) | holdings-market-data | [FIN-13](#fin-13), [FIN-24](#fin-24) |
| [MARKET-005](../../docs/requirements/contexts/portfolio/modules/holdings-market-data/requirements.md) | holdings-market-data | 추가 수정 지적 없음 (구현 근거 확인) |
| [MARKET-006](../../docs/requirements/contexts/portfolio/modules/holdings-market-data/requirements.md) | holdings-market-data | [FIN-13](#fin-13) |
| [JOB-AST-001](../../docs/requirements/contexts/portfolio/modules/holdings-market-data/requirements.md) | holdings-market-data | [FIN-24](#fin-24), [FIN-13](#fin-13) |
| [JOB-AST-002](../../docs/requirements/contexts/portfolio/modules/holdings-market-data/requirements.md) | holdings-market-data | 추가 수정 지적 없음 (구현 근거 확인) |
| [JOB-AST-003](../../docs/requirements/contexts/portfolio/modules/holdings-market-data/requirements.md) | holdings-market-data | [FIN-22](#fin-22) |
| [AST-001](../../docs/requirements/contexts/portfolio/modules/portfolio/requirements.md) | portfolio | [FIN-19](#fin-19) |
| [AST-002](../../docs/requirements/contexts/portfolio/modules/portfolio/requirements.md) | portfolio | 추가 수정 지적 없음 (구현 근거 확인) |
| [AST-003](../../docs/requirements/contexts/portfolio/modules/portfolio/requirements.md) | portfolio | [FIN-15](#fin-15), [FIN-22](#fin-22) |
| [AST-004](../../docs/requirements/contexts/portfolio/modules/portfolio/requirements.md) | portfolio | [PLAT-14](#plat-14) |
| [AST-005](../../docs/requirements/contexts/portfolio/modules/portfolio/requirements.md) | portfolio | [PLAT-14](#plat-14) |
| [AST-006](../../docs/requirements/contexts/portfolio/modules/portfolio/requirements.md) | portfolio | [FIN-18](#fin-18) |
| [AST-007](../../docs/requirements/contexts/portfolio/modules/portfolio/requirements.md) | portfolio | [후속 검증·한계](#gap-ast-007) |
| [AST-008](../../docs/requirements/contexts/portfolio/modules/portfolio/requirements.md) | portfolio | 추가 수정 지적 없음 (구현 근거 확인) |
| [AST-009](../../docs/requirements/contexts/portfolio/modules/portfolio/requirements.md) | portfolio | [후속 검증·한계](#gap-ast-009) |
| [AND-001](../../docs/requirements/supporting-platform/modules/android-host/requirements.md) | android-host | [PLAT-01](#plat-01) |
| [AND-002](../../docs/requirements/supporting-platform/modules/android-host/requirements.md) | android-host | [PLAT-01](#plat-01) |
| [AND-003](../../docs/requirements/supporting-platform/modules/android-host/requirements.md) | android-host | [PLAT-02](#plat-02) |
| [AND-004](../../docs/requirements/supporting-platform/modules/android-host/requirements.md) | android-host | 추가 수정 지적 없음 (구현 근거 확인) |
| [AND-005](../../docs/requirements/supporting-platform/modules/android-host/requirements.md) | android-host | [후속 검증·한계](#gap-and-005) |
| [AND-006](../../docs/requirements/supporting-platform/modules/android-host/requirements.md) | android-host | 추가 수정 지적 없음 (구현 근거 확인) |
| [AND-007](../../docs/requirements/supporting-platform/modules/android-host/requirements.md) | android-host | [PLAT-22](#plat-22) |
| [AND-008](../../docs/requirements/supporting-platform/modules/android-host/requirements.md) | android-host | [후속 검증·한계](#gap-and-008) |
| [AND-009](../../docs/requirements/supporting-platform/modules/android-host/requirements.md) | android-host | 추가 수정 지적 없음 (구현 근거 확인) |
| [AND-010](../../docs/requirements/supporting-platform/modules/android-host/requirements.md) | android-host | [후속 검증·한계](#gap-and-010) |
| [AND-011](../../docs/requirements/supporting-platform/modules/android-host/requirements.md) | android-host | [PLAT-03](#plat-03) |
| [AND-012](../../docs/requirements/supporting-platform/modules/android-host/requirements.md) | android-host | [후속 검증·한계](#gap-and-012) |
| [AND-013](../../docs/requirements/supporting-platform/modules/android-host/requirements.md) | android-host | [후속 검증·한계](#gap-and-013) |
| [AND-014](../../docs/requirements/supporting-platform/modules/android-host/requirements.md) | android-host | [후속 검증·한계](#gap-and-014) |
| [QE-001](../../docs/requirements/supporting-platform/modules/android-host/requirements.md) | android-host | [PLAT-04](#plat-04) |
| [QE-002](../../docs/requirements/supporting-platform/modules/android-host/requirements.md) | android-host | 추가 수정 지적 없음 (구현 근거 확인) |
| [QE-003](../../docs/requirements/supporting-platform/modules/android-host/requirements.md) | android-host | [후속 검증·한계](#gap-qe-003) |
| [QE-004](../../docs/requirements/supporting-platform/modules/android-host/requirements.md) | android-host | 추가 수정 지적 없음 (구현 근거 확인) |
| [QE-005](../../docs/requirements/supporting-platform/modules/android-host/requirements.md) | android-host | 추가 수정 지적 없음 (구현 근거 확인) |
| [QE-006](../../docs/requirements/supporting-platform/modules/android-host/requirements.md) | android-host | [후속 검증·한계](#gap-qe-006) |
| [QE-007](../../docs/requirements/supporting-platform/modules/android-host/requirements.md) | android-host | 추가 수정 지적 없음 (구현 근거 확인) |
| [QE-008](../../docs/requirements/supporting-platform/modules/android-host/requirements.md) | android-host | [PLAT-04](#plat-04) |
| [QE-009](../../docs/requirements/supporting-platform/modules/android-host/requirements.md) | android-host | [PLAT-03](#plat-03) |
| [QE-010](../../docs/requirements/supporting-platform/modules/android-host/requirements.md) | android-host | [후속 검증·한계](#gap-qe-010) |
| [QE-011](../../docs/requirements/supporting-platform/modules/android-host/requirements.md) | android-host | 추가 수정 지적 없음 (구현 근거 확인) |
| [QE-012](../../docs/requirements/supporting-platform/modules/android-host/requirements.md) | android-host | [후속 검증·한계](#gap-qe-012) |
| [REL-001](../../docs/requirements/supporting-platform/modules/delivery-assurance/requirements.md) | delivery-assurance | [PLAT-20](#plat-20) |
| [REL-002](../../docs/requirements/supporting-platform/modules/delivery-assurance/requirements.md) | delivery-assurance | [PLAT-20](#plat-20) |
| [REL-003](../../docs/requirements/supporting-platform/modules/delivery-assurance/requirements.md) | delivery-assurance | [PLAT-21](#plat-21) |
| [REL-004](../../docs/requirements/supporting-platform/modules/delivery-assurance/requirements.md) | delivery-assurance | [PLAT-21](#plat-21) |
| [JOB-ERR-001](../../docs/requirements/supporting-platform/modules/external-operations/requirements.md) | external-operations | [PLAT-16](#plat-16) |
| [JOB-ERR-002](../../docs/requirements/supporting-platform/modules/external-operations/requirements.md) | external-operations | [PLAT-17](#plat-17) |
| [EXT-001](../../docs/requirements/supporting-platform/modules/external-operations/requirements.md) | external-operations | [후속 검증·한계](#gap-ext-001) |
| [EXT-002](../../docs/requirements/supporting-platform/modules/external-operations/requirements.md) | external-operations | [PLAT-18](#plat-18) |
| [EXT-003](../../docs/requirements/supporting-platform/modules/external-operations/requirements.md) | external-operations | [PLAT-19](#plat-19) |
| [EXT-004](../../docs/requirements/supporting-platform/modules/external-operations/requirements.md) | external-operations | 추가 수정 지적 없음 (구현 근거 확인) |
| [HOME-001](../../docs/requirements/supporting-platform/modules/home-preferences/requirements.md) | home-preferences | 추가 수정 지적 없음 (구현 근거 확인) |
| [HOME-002](../../docs/requirements/supporting-platform/modules/home-preferences/requirements.md) | home-preferences | [PLAT-10](#plat-10) |
| [HOME-003](../../docs/requirements/supporting-platform/modules/home-preferences/requirements.md) | home-preferences | [후속 검증·한계](#gap-home-003) |
| [HOME-004](../../docs/requirements/supporting-platform/modules/home-preferences/requirements.md) | home-preferences | [PLAT-10](#plat-10), [PLAT-11](#plat-11) |
| [THEME-001](../../docs/requirements/supporting-platform/modules/home-preferences/requirements.md) | home-preferences | [PLAT-12](#plat-12) |
| [PWA-001](../../docs/requirements/supporting-platform/modules/pwa/requirements.md) | pwa | [PLAT-05](#plat-05) |
| [PWA-002](../../docs/requirements/supporting-platform/modules/pwa/requirements.md) | pwa | 추가 수정 지적 없음 (구현 근거 확인) |
| [PWA-003](../../docs/requirements/supporting-platform/modules/pwa/requirements.md) | pwa | [PLAT-05](#plat-05), [CAP-15](#cap-15) |
| [PWA-004](../../docs/requirements/supporting-platform/modules/pwa/requirements.md) | pwa | [PLAT-07](#plat-07), [CAP-15](#cap-15) |
| [PWA-005](../../docs/requirements/supporting-platform/modules/pwa/requirements.md) | pwa | [PLAT-05](#plat-05) |
| [PWA-006](../../docs/requirements/supporting-platform/modules/pwa/requirements.md) | pwa | [후속 검증·한계](#gap-pwa-006) |
| [PWA-007](../../docs/requirements/supporting-platform/modules/pwa/requirements.md) | pwa | [PLAT-09](#plat-09) |
| [PWA-008](../../docs/requirements/supporting-platform/modules/pwa/requirements.md) | pwa | [PLAT-06](#plat-06), [PLAT-07](#plat-07) |
| [STAT-001](../../docs/requirements/supporting-platform/modules/reporting/requirements.md) | reporting | [후속 검증·한계](#gap-stat-001) |
| [STAT-002](../../docs/requirements/supporting-platform/modules/reporting/requirements.md) | reporting | 추가 수정 지적 없음 (구현 근거 확인) |
| [STAT-003](../../docs/requirements/supporting-platform/modules/reporting/requirements.md) | reporting | [후속 검증·한계](#gap-stat-003) |
| [STAT-004](../../docs/requirements/supporting-platform/modules/reporting/requirements.md) | reporting | [후속 검증·한계](#gap-stat-004) |
| [STAT-005](../../docs/requirements/supporting-platform/modules/reporting/requirements.md) | reporting | [FIN-09](#fin-09) |
| [STAT-006](../../docs/requirements/supporting-platform/modules/reporting/requirements.md) | reporting | [PLAT-13](#plat-13) |
| [STAT-AST-001](../../docs/requirements/supporting-platform/modules/reporting/requirements.md) | reporting | [PLAT-14](#plat-14) |
| [STAT-AST-002](../../docs/requirements/supporting-platform/modules/reporting/requirements.md) | reporting | [PLAT-14](#plat-14) |
| [STAT-AST-003](../../docs/requirements/supporting-platform/modules/reporting/requirements.md) | reporting | [PLAT-14](#plat-14) |
| [SYS-001](../../docs/requirements/system/context.md) | system | [ACC-02](#acc-02), [ACC-03](#acc-03) |
| [SYS-002](../../docs/requirements/system/context.md) | system | 추가 수정 지적 없음 (구현 근거 확인) |
| [SYS-003](../../docs/requirements/system/context.md) | system | [SYS-02](#sys-02) |
| [SYS-004](../../docs/requirements/system/context.md) | system | 추가 수정 지적 없음 (구현 근거 확인) |
| [SYS-005](../../docs/requirements/system/context.md) | system | [SYS-01](#sys-01) |
| [SYS-006](../../docs/requirements/system/context.md) | system | 추가 수정 지적 없음 (구현 근거 확인) |
| [SYS-007](../../docs/requirements/system/context.md) | system | [ACC-04](#acc-04), [ACC-10](#acc-10), [SYS-03](#sys-03) |
| [SYS-008](../../docs/requirements/system/context.md) | system | [ACC-02](#acc-02), [ACC-03](#acc-03), [PLAT-03](#plat-03) |
| [SYS-009](../../docs/requirements/system/context.md) | system | 추가 수정 지적 없음 (구현 근거 확인) |

## 검증 방식과 제약

- 순수 정책 테스트에만 의존하던 경로는 실제 Router→Application→Firebase Adapter 테스트로 보완했습니다. 중요한 원자 저장·Rules·삭제·복구는 실제 Emulator에서 확인했습니다.
- 구현이 연결되지 않은 채 항상 skip하던 PWA activation placeholder 1개와 대응 테스트 선언을 제거했습니다. PWA-002 요구사항은 유지하며 PWA-008·DEC-051과 같은 활성 worker 계약과 production browser E2E로 검증합니다.
- 입력 version을 서버 최신값으로 대신하던 테스트, 분리 저장의 부분 성공을 기대하던 테스트, 이전 PWA worker·현재 자산 기준 통계를 강제하던 테스트는 최종 계약을 검증하도록 재작성했습니다.
- Jest는 Web 단위·컴포넌트 테스트를, Playwright는 실제 production worker와 Firebase E2E를 실행합니다. 실행기가 다른 PWA E2E를 Jest 검색에서 제외했으며 CI에서 Playwright를 별도 필수 단계로 실행합니다.
- 멱등성 검증은 새 요청 ID·같은 업무 key·변조 payload·프로세스 재시작·장기 receipt를 포함합니다. 부분 실패와 과거 세대의 늦은 응답, CAS 충돌에서 무변경을 검사합니다.
- 검색은 같은 기간의 최대 10,000개 server snapshot을 재사용하고 결과 50개 페이지와 전체·월별 합계를 분리합니다. 한도를 넘으면 불완전한 합계를 표시하지 않고 기간 축소를 요청합니다.
- 통계 원천은 날짜 범위·50개 page·50,000개 안전 상한을 적용하고 부분 합계를 성공으로 표시하지 않습니다. 여러 query를 동일 read timestamp로 고정하는 전역 transaction은 사용하지 않습니다.
- 소유를 입증할 수 없는 legacy 자료는 추측으로 지우지 않습니다. [Access 운영 절차](../operations/access-recovery-and-household-purge.md)에 재개 조건과 missing-parent 참조 목록 조회 비용을 기록했습니다.
- 배포 wrapper는 정확한 HEAD의 CI 성공·artifact/호환 manifest·운영 채널·secret metadata·project lease를 확인합니다. 배포 실패 후 잠금 복구 절차는 [Firebase 배포 Runbook](../operations/firebase-release-runbook.md)을 따릅니다. 이번 작업은 commit·push·배포·운영 데이터 수정 없이 수행했습니다.
- 로컬 Functions Emulator는 설치된 Node 24를 사용했습니다. CI는 Node 22로 설정되어 있으며 이번 미커밋 변경의 CI/운영 결과를 로컬 결과로 대신하지 않습니다. PWA는 Chromium, Android는 API 36.1에서 실행했고 실제 iPhone background push·운영 Vercel 전환은 실행하지 않았습니다.
- 문서의 선언 수는 [자동 카탈로그](../requirements/catalog-summary.md)에서 집계합니다. 선언·연결 검사 통과는 모든 운영 환경 검증 완료를 뜻하지 않습니다.
