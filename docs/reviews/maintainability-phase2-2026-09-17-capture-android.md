# 2차 유지보수성 검토: 결제 수집·설정·Android

기준 커밋은 `f1ed5a8`이며 이후 이 작업의 실제 코드 변경을 함께 기록합니다. 대상은 Payment Configuration 12개, Android Ingestion 38개, Shortcut Ingestion 15개, Android Host·QuickEdit 26개 요구사항입니다. **91개는 검토 범위의 개수이며 91개 기능의 모든 동작이나 보안 경합이 검증됐다는 뜻이 아닙니다.** 운영 데이터를 조회하거나 신규 장애를 재현하지 않았습니다.

이번에는 사용 여부와 파일 수를 판단 기준으로 삼지 않았습니다. 실제 입력에서 저장·후속 효과까지 이어지는 코드, 변경 시 수정해야 하는 소유 모듈, 다른 기능에 영향을 주는 조건을 확인했습니다. 정상 결제 저장·규칙 변경·QuickEdit 접수를 중심으로 읽고, 해당 변경이 통과할 수 있는 권한·멱등·세션 경계를 함께 검토했습니다. 공급자별 원문 전체, OS 권한·WebView별 동작을 이번에 새로 실기기 검증한 것은 아닙니다.

## 실행 흐름과 변경 소유

| 변경 시나리오 | 실제 수정 소유와 호출 흐름 | 격리해야 할 영향·판정 |
|---|---|---|
| 기존 카드사의 새로운 본문 형식 | `androidProviderParserCatalog`에 연결된 `cardProviderParsers`·`walletProviderParsers`·`localCurrencyProviderParsers`의 해당 parser. 새 package일 때만 Native `PaymentSourceRegistry`와 서버 `defaultPaymentSourceRegistry`도 변경 | 금융 해석은 서버 하나가 소유합니다. Native admission에 금액·승인·취소 해석을 복제하지 않습니다. 공통 시간 helper 수정은 여러 parser에 영향을 주므로 기존 golden fixture까지 검증해야 합니다. |
| 카드 등록·끝번호 수정·정렬 | Web `CardSettings` → `registeredCardService` → `paymentConfigurationCommands` → 서버 `paymentConfigurationRuntimeApplication` → `registeredCardCommandBoundaryApplication` → `FirebasePaymentConfigurationAtomicStore` | client 정규화는 입력 편의이며 본인 소유·카드 identity·중복 claim·version 검증은 서버입니다. claim과 카드 변경, projection 무효화가 같은 transaction 안에 있어야 합니다. 전체 카드 집합은 현재 소가구 규모에서 별도 분산 인덱스 계층을 추가할 근거가 없습니다. |
| 규칙 mapping 필드 변경 | Web `MerchantRuleSettings` → command mapping patch → 서버 `merchantRuleCommandApplication` → AtomicStore의 canonical/legacy write → Capture projection 재생성 → `merchantRuleSelection`·enrichment | 미제공=유지, 빈 문자열=해당 치환 삭제, 실제 거래 memo 비우기와 규칙 삭제의 차이를 유지합니다. 상태 해석이 reader마다 갈리는 문제는 아래 잔여 항목에 따로 기록합니다. |
| 카테고리 보관·기본값 변경 | CategoryCatalogStore가 원본·projection 무효화를 소유하고 Capture·Ledger·Recurring이 Category read reference를 소비 | 기존 Capture가 Category와 다른 활성 판정을 가진 실제 결합을 수정했습니다(P2-C1). |
| QuickEdit 카테고리·메모 변경 | 서버 확정 snapshot → `QuickEditCoordinator` → `QuickEditActivity` → `buildQuickEditUpdatePatch` → `QuickEditCommandDeliveryLifecycle`/outbox → 일반 Ledger Command | category ID는 대소문자를 그대로 보존하며 변경 없는 필드를 patch에 넣지 않습니다. UI 초안의 actor를 제출 때 현재 actor로 바꾸지 않도록 수정했습니다(P2-C2). |
| 승인 이후 규칙 수정, 이어서 결제 취소 | 공통 Capture gateway → `capturedApprovalCancellation`/Firebase Ledger persistence → 원 provenance·lineage 전체 원자 변경 | 현재 표시용 치환을 취소 필수 조건으로 두지 않도록 분리했습니다(P2-C3). 카드 본인 검증과 originalMerchant는 유지합니다. |
| 로그아웃·가구·멤버 전환 | `SessionMirror` journal → Capture/QuickEdit 저장소 purge → snapshot 교체. QuickEdit admission과 purge는 같은 lifecycle lock | 표시 FIFO, Capture 재전송 WAL, 편집 command outbox는 보존 기간·완료 조건이 달라 합치지 않습니다. 초기 Capture batch와 Auth 교환 사이 경합은 별도 잔여 범위입니다. |

## 확인한 문제와 적용 결과

### P2-C1: Category 활성 상태의 복제가 자동수집에서 다른 결과를 만듭니다

`FirebaseCaptureConfigurationQuery`는 legacy와 canonical category를 순서대로 Set에 넣되 archived 문서는 건너뛰기만 했습니다. 따라서 legacy `key=food,isActive=true`가 먼저 들어가고 canonical `categoryId=food,state=archived`가 뒤에 있어도 `food`가 Set에서 없어지지 않았습니다. `archive-pending`도 이 reader에서 제외되지 않았습니다. Ledger·Recurring의 Category reference와 판정이 달랐습니다.

실제 변경은 다음과 같습니다.

- [categoryReadMapping.ts](../../functions/src/adapters/firebase/categories/categoryReadMapping.ts)에 `mergeActiveCategoryReferences`를 두어 **업무 ID 단위 canonical 우선 상태와 문서 별칭**을 함께 해석합니다. `deleted`와 과거 `lifecycle`도 같은 상태 해석에서 처리합니다.
- [firebaseCategoryReferenceReader.ts](../../functions/src/adapters/firebase/categories/firebaseCategoryReferenceReader.ts)는 업무 ID를, [firebaseCaptureConfigurationQuery.ts](../../functions/src/adapters/firebase/payment-capture/firebaseCaptureConfigurationQuery.ts)는 기존 호환에 필요한 문서 ID 별칭까지 같은 결과에서 사용합니다. 비활성 업무 ID의 legacy 별칭도 함께 제외됩니다.
- Capture 내부 projection schema를 2에서 3으로 변경했습니다. 기존 캐시의 잘못된 활성 Set을 다음 조회에 한 번 재생성하고 이후에는 여전히 projection 한 문서만 읽습니다. 외부 Command·Envelope schema는 변경하지 않았습니다.

새 추가 조회나 새로운 service 호출은 없습니다. category 저장 문서와 read reference의 소유를 Category adapter로 한정하여 다음 상태 변경은 한 곳에서 반영됩니다. 회귀는 canonical archived/archive-pending/deleted, legacy alias, 활성 legacy-only, 이전 projection 재생성과 재사용을 실제 Query 클래스로 검사합니다.

### P2-C2: QuickEdit 초안이 표시 당시 세션을 잃습니다

기존 `QuickEditCoordinator`는 queue entry의 scope를 가지고 있었지만 Intent에는 거래 표시값만 넣었습니다. `QuickEditActivity.submitCommand`는 저장 시점의 HouseholdPreferences에서 가구를 다시 읽었고, outbox admission도 현재 scope만 붙였습니다. 이전 화면을 남겨둔 채 같은 가구의 다른 멤버로 전환하면 이전 초안이 새 멤버의 명령으로 접수될 수 있었습니다. 서버는 새 멤버의 정상 가구 권한만 알기 때문에 UI 초안의 원 소유자를 복원할 수 없습니다.

- [QuickEditCoordinator.kt](../../android/app/src/main/java/com/household/account/quickedit/QuickEditCoordinator.kt)가 표시 당시 household/member/generation을 Intent에 넣습니다. launch와 완료도 해당 scope를 사용합니다.
- [QuickEditActivity.kt](../../android/app/src/main/java/com/household/account/QuickEditActivity.kt)는 Intent의 scope를 고정합니다. Activity 재생성에도 현재 actor로 바꾸지 않습니다. focus·카테고리 조회 완료·제출에서 scope가 바뀌면 기존 화면을 닫습니다. 카테고리 ID나 원래 업무 patch는 변경하지 않았습니다.
- 실제 접수 판정은 [QuickEditCommandDeliveryLifecycle.kt](../../android/app/src/main/java/com/household/account/quickedit/QuickEditCommandDeliveryLifecycle.kt)가 소유합니다. 기존 짧은 lock 안에서 expected/current scope가 같을 때만 outbox commit과 Worker 예약을 수행합니다. UI의 사전 검사만 믿지 않습니다.
- 이전 Activity의 닫기 callback이 새 세션의 FIFO를 건드리지 않도록 `completeCurrent`도 원 scope를 받습니다.

정상 입력의 추가 원격 조회는 없습니다. JVM 테스트는 가구·멤버·generation 변경과 로그아웃 각각에서 outbox 쓰기·예약이 0건인지 검증합니다. Activity 재생성 뒤 멤버를 바꾸는 instrumentation 테스트도 추가했으나 이번 로컬 작업에서는 실행하지 않았습니다. **이 수정의 실기기 반영에는 새 APK가 필요합니다.**

### P2-C3: 현재 가맹점 치환 규칙이 원 결제 취소를 막는 의존입니다

기존 [captureTransactionGatewayApplication.ts](../../functions/src/contexts/payment-capture/android-payment-ingestion/application/captureTransactionGatewayApplication.ts)는 승인·취소 모두 merchantRuleSelection의 충돌을 `MERCHANT_RULE_CONFLICT`로 거부했습니다. 실제 취소 매칭 정책과 현재 v2 fingerprint는 원 가맹점 증거를 사용하지만, 과거 SHA256 receipt는 표시용 `merchant`를 포함한 전체 command를 hash합니다. 따라서 정상 치환값을 제거하면 구형 receipt 재생 호환성이 깨집니다.

규칙 선택을 한 번 수행하고 정상 선택된 표시 가맹점은 기존대로 보존합니다. 취소는 규칙 충돌이 있어도 원 가맹점으로 진행하며, 신규 승인만 충돌을 거부한 뒤 카테고리·메모 enrichment를 수행합니다. 원 카드 검증, raw hash, downstream 멱등 key, lineage 원자성과 receipt 형식은 그대로입니다. 실제 Gateway→Firebase persistence 회귀에서 구형 SHA256 기록은 표시값 제거 시 실패하고 v2·verified-raw 기록은 성공하는 차이를 먼저 재현했습니다. 최종 수정에서는 세 형식 모두 기존 취소 결과를 원장 재조회·추가 write 없이 재생합니다. 같은 충돌 규칙에서 취소 성공과 신규 승인 거부도 함께 검증했습니다.

단, 설정 decoder 자체가 malformed 문서를 만나 실패하는 경우까지 취소 전용 reader로 분리한 것은 아닙니다. 현재 complete configuration 읽기 의존은 남습니다. 구형 SHA256 receipt가 생성된 뒤 규칙 자체가 달라져 표시값을 재구성할 수 없는 기존 한계도 이번에 해결했다고 주장하지 않습니다.

## 기능별 검토 깊이

표의 ‘경계 분석’은 실제 호출과 변경 전파를 정적으로 추적했다는 뜻입니다. ‘회귀 실행’은 아래 검증 목록에 해당하는 범위만 뜻합니다. grouped ID는 같은 변경 소유를 가진 요구사항을 묶은 것이며, 서로 다른 정책을 같은 기능으로 취급하지 않습니다.

| 요구사항 | 추적한 실사용 책임·변경 시나리오 | 판단·이번 검증 깊이 |
|---|---|---|
| CARD-001, CARD-002, CARD-003, CARD-005 | 카드 표준 label/번호 정규화 → immutable identity·claim → canonical/legacy 동시 쓰기·collection version → Web 목록 | 본인 범위와 전체 재정렬은 서버 Boundary, 저장 원자성은 AtomicStore입니다. Web은 편의 정규화·정렬만 소유합니다. 경계 분석; 별도 카드 구현을 추가하지 않습니다. |
| CARD-004 | Capture gateway → ownCardResolution → 해당 actor 카드 필터·wildcard·canonical evidence | Android·Shortcut이 같은 policy를 사용합니다. 수정은 규칙 관리 UI와 분리됩니다. gateway focused 회귀 실행. |
| MER-001, MER-002 | normalizedMerchantKeywordTokens → merchantRuleSelection의 match-type 우선과 동률 거부 | keyword 정책은 domain, 저장 claim은 command가 소유합니다. 작은 목록의 filter/sort를 새 인덱스로 바꿀 근거는 없습니다. 경계 분석 및 gateway 회귀. |
| MER-003 | UI 빈 값 → runtime mapping patch → nested mapping 전체 저장 → capture replacement/preserve | 1차 수정의 의미를 다시 추적했습니다. 미제공과 삭제 의도가 이미 분리되어 있어 이번에는 재작성하지 않았습니다. |
| MER-004 | rule mutation/claim·collection version → AtomicStore → projection invalidation | 조회 snapshot과 변경 결정을 같은 transaction에서 처리합니다. 소가구에서 전체 rule 복사 비용보다 논리 단순성과 원자성이 중요합니다. 경계 분석. |
| MER-005 | 일반 Ledger update → FirebaseRememberMerchantRuleParticipant.prepare → 원가맹점 exact rule mutation → 원장과 같은 UoW | 별도 client rule 생성이 아니므로 부분 성공을 만들지 않습니다. Ledger·규칙 양쪽을 변경할 때 participant 경계를 유지해야 합니다. 경계 분석; Ledger 담당의 검토와 연결. |
| MER-006 | AtomicStore mapper, Capture configuration mapper, Web merchantRuleService mapper | 현재 다중 reader의 정규화가 완전히 같지는 않습니다. 아래 잔여 범위에 명시하며 ‘통일 완료’로 판정하지 않습니다. |
| MER-007 | Category archive process → merchantRule reference remap → projection invalidation | 상태 소유는 Category이며 Capture가 별도 활성 의미를 만들면 안 됩니다. P2-C1 및 invalidation 회귀 실행. |
| ING-001, ING-002, ING-003, ING-006, ING-007 | Native raw snapshot/admission → server registry → 지정 parser·SMS 순서 → CaptureEnvelope | Native는 transport/privacy admission, 서버는 금융 해석입니다. 새로운 본문과 새로운 package 변경은 서로 다른 범위입니다. 레지스트리 목록 중복은 배포 플랫폼 경계 때문에 존재하며 금액 parser 복제는 없습니다. 경계 분석. |
| ING-004 | Service 후보별 최근 hash/30초 admission → observation ID → 서버 receipt | OS 중복 억제와 영속 멱등은 보장이 달라 합치지 않습니다. 일반 알림은 짧은 메모리 처리만 합니다. 경계 분석; 30초 실시간 기기 재현은 미실행. |
| ING-005, IOS-014 | Android 지연 diagnostic coroutine, Shortcut retainMessage best-effort → 별도 debug adapter | 운영 원장과 다른 저장 목적이며 로깅 실패를 업무 재시도로 만들지 않습니다. 원문 진단의 보존 정책은 요구사항을 유지했습니다. 저장소 ACL·실제 로그를 새로 감사한 것은 아닙니다. |
| ING-008 | Capture batch journal → 직접 제출 → terminal follow-up FIFO 내구화 → journal 제거, 실패만 WorkManager | 정상 경로가 Worker를 기다리지 않는 구성을 보존합니다. queue TTL과 표시 FIFO의 무기한 대기 목적은 다릅니다. 초기 batch/Auth 전환 경합은 아래 잔여 범위입니다. |
| ING-009 | balance-only 단독 branch, payment+balance 독립 receipt·downstream 결과 | 한쪽 실패가 다른 쪽 저장을 취소하지 않는 실제 병렬 branch 구조를 확인했습니다. 단일 Android 승인은 Ledger receipt로 끝나며 중복 root receipt를 만들지 않습니다. raw production-flow 회귀 실행. |
| PARSE-KB-001, PARSE-NH-001, PARSE-PAYBOOC-001, PARSE-SAMSUNG-001, PARSE-LOTTE-001 | cardProviderParsers의 공급자별 함수·pattern → 공통 amount/time helper | 업체 형식 변화의 수정 위치가 보이며 parser별 결과는 typed outcome입니다. 전 공급자의 원문을 이번에 새로 재수집·재현하지 않았습니다. parser별 모든 regex의 완전성 판정은 아닙니다. |
| PARSE-NAVER-001, PARSE-TOSS-001, PARSE-KAKAO-001, PARSE-ONNURI-001 | walletProviderParsers → 순액/원승인 증거 → gateway/원장 | 캐시백 순액과 취소 승인 총액의 책임 차이를 보존했습니다. Toss 실제 parser→원장→취소 회귀 실행; 다른 지갑은 경계 분석입니다. |
| PARSE-GYEONGGI-001, PARSE-DAEJEON-001, PARSE-SEJONG-001 | localCurrencyProviderParsers → 검증된 통화유형 → payment/balance 독립 branch | 홈의 선택된 통화로 자동 추정하지 않습니다. 경기·대전 raw production-flow 회귀 실행; 세종은 경계 분석입니다. |
| PARSE-CITYGAS-001, PARSE-SMSBILL-001 | Kakao 복합 source/cityGasPayment·SMS 마지막 billing parser → bill discriminator | 카드 수집 일반 경로의 우회가 아니라 등록된 bill 분류에만 카드 검증 예외를 둡니다. bill 위조 거부와 청구 memo 회귀 실행. |
| PARSE-COMMON-001, IOS-004 | postedAt/receivedAt → 서울 시간·주입 occurrence-year resolver | parser가 직접 Date.now/프로세스 timezone을 정책으로 쓰지 않도록 공통 helper와 주입 경계를 유지합니다. 이번에는 시간 정책을 변경하지 않았습니다. |
| ING-SAVE-001, ING-SAVE-002, ING-SAVE-003, ING-SAVE-004 | 인증 actor → 본인 card policy → rule/category enrichment → Ledger Port | origin별로 저장 정책을 복제하지 않습니다. P2-C1 및 gateway 회귀로 변경 경계를 검증했습니다. |
| ING-SAVE-005, ING-SAVE-006, ING-SAVE-007 | FirebaseCaptureLedgerPersistence의 원장·dedup·provenance·receipt·Outbox 원자 commit → 서버 snapshot QuickEdit | 최초 creator/source와 수정 가능한 표시값이 분리되어 있습니다. Android 자동 승인에서 자기 알림 push를 만들지 않는 정책은 보존합니다. raw receipt 재생·원승인 보존 회귀 실행. |
| CAN-001, CAN-002, CAN-003, CAN-004, CAN-005, CAN-006, CAN-007 | 원 provenance 검색/30일 범위 → 유일 lineage 판정 → 구조 변경 원본/파생 삭제·다른 lineage 복원 | P2-C3에서 규칙 충돌의 취소 거부를 분리하고 정상 표시 치환과 구형 receipt 호환은 보존했습니다. 실제 Firebase adapter cancellation safety와 원금/순액·구형 receipt 재생 회귀 실행. 모든 과거 migration 자료의 완전성을 검증한 것은 아닙니다. |
| IOS-001, IOS-002, IOS-010, IOS-012 | HTTP facade body/media/size → normalizer → credential/current membership → gate → processor | HTTP 호환 alias는 facade에서만 소비하고 actor 생성에는 쓰지 않습니다. rate limit은 수집 UI·parser 정책과 분리됩니다. 경계 분석. |
| IOS-003 | parseShortcutCardMessage의 카드 증거·각 레이아웃 → 공통 Capture | Android의 admission과 HTTP 문자열 입력은 달라 parser wrapper를 억지로 통합하지 않았습니다. 금액·연도 공통 정책을 수정할 때 두 클라이언트 fixture를 함께 확인해야 합니다. 경계 분석. |
| IOS-005 | legacy owner 특성화 자료 | 현재 production actor 결정에 사용하는 경로가 아닙니다. 실사용 기능 통과 수에 포함하지 않습니다. |
| IOS-006, IOS-007, IOS-011, IOS-015 | Shortcut intake adapter → 공통 gateway·persistence → 중복/승인/취소 | 별도 Shortcut 원장 CRUD가 없어 양쪽 같은 정책 수정이 가능합니다. 중복 claim·원장 생성이 동일 transaction이며 read 후 외부 add 방식이 아닙니다. 기존 receipt 재생·공통 gateway 회귀 실행. |
| IOS-008, IOS-009 | 실제 HTTP processor의 transaction/notification 분리 → Outbox → Notifications 소유 dispatch | ‘queued’가 전달 성공이 되는 것으로 바꾸지 않았습니다. Push endpoint 선택은 담당 범위 밖 Notifications에 남깁니다. processor와 저장 receipt 연결을 추적했습니다. |
| IOS-013 | 설치 UI → credential lifecycle issue/reissue → Secret Port·원자 rotate → one-time raw 응답 | 정기 로그인이나 매 요청 credential 발급이 아닙니다. UI 설치 흐름, 발급과 기존 credential 폐기 원자성의 변경 위치가 분리됩니다. Secret 저장 및 실계정 로그인 새 검증은 미실행. |
| AND-001, AND-002, AND-003, AND-004 | MainActivity permission gate → TrustedWebOrigin/WebStartupGate → WebView/history | 표준 WebView 보안 설정과 정확한 listener component 비교를 유지합니다. 단순한 권한 UI를 새 coordinator로 추출할 이유를 찾지 못했습니다. 경계 분석. |
| AND-005, AND-006, AND-011 | NativeAuthCoordinator·AndroidHostBridge·SessionMirror → purge/atomic snapshot → Web auth | origin·top-level 제한과 scope 확인은 실제 boundary에 있습니다. SessionMirror JVM 회귀 실행. Web Auth·FCM lifecycle 전체는 root 담당 검토와 분리합니다. |
| AND-007, AND-008, AND-009, AND-010, AND-013, AND-014 | bridge version/launch duration, permission prompt, backup exclusion, FCM detach | 변경 위치와 Native host 의존을 확인했습니다. 새 OS별 보안·백업 실험은 하지 않았고 FCM·성능 수집 전송의 세부 정책은 root 담당입니다. ‘모두 심층 동작 검증’이라고 표시하지 않습니다. |
| AND-012 | Native bridge 지연 생성·영속 Web Auth 재사용 → Web의 Firestore bootstrap/read model | Native가 첫 화면마다 새 membership을 강제하지 않는 호출 경계를 확인했습니다. iPhone polling·Web read 계층 변경은 root 담당입니다. |
| QE-001, QE-008, QE-009, QE-011 | overlay 설정/권한 → 서버 snapshot/FIFO → Activity 표시·명시 닫기 | snapshot 있으면 두 번째 거래 Query가 없고 구 entry만 fallback합니다. P2-C2에서 launch/complete scope를 보강했습니다. PendingQueue JVM 회귀 실행; 실기기 잠금 화면·캡처는 미실행. |
| QE-002, QE-003, QE-004, QE-012 | form patch/notify-only/delete → immutable envelope → 암호화 outbox·Worker → 일반 Ledger | UI가 자체 DB write/금융 정책을 소유하지 않습니다. 서버 성공으로 가장하는 Toast를 추가하지 않았습니다. P2-C2 및 outbox/lifecycle JVM 회귀 실행. |
| QE-005, QE-006, QE-007, QE-010 | 화면 분할 초안 → 원금 검증·2개 자동금액 조절 → 한 Split Command → 서버 lineage UoW | UI 입력 편의와 서버 원자성은 필요한 중복 검증입니다. 이번 작업은 분할 방식이나 3개 항목 자동 배분 정책을 변경하지 않았습니다. Activity 코드 및 기존 테스트 위치 확인; 분할 UI instrumentation은 새로 실행하지 않았습니다. |

## 유지하거나 추가 검토할 부분

1. **Native Capture initial batch의 세션 경합:** `CaptureDeliveryQueue.flush`는 queue mutex로 purge와 네트워크 전달을 직렬화하지만 `CaptureBatchDelivery`의 최초 batch는 journal 이후 네트워크를 lock 밖에서 진행합니다. queue commit과 QuickEdit follow-up에는 scope 검사가 있으나 각 `client.submit` 직전 현재 scope와 Native Auth token의 결합이 명시적이지 않습니다. 재시도 중 새 알림을 막지 않는 목적은 타당합니다. Auth 교환과 SessionMirror 전환 순서까지 재현해야 하므로 현재 ‘다른 actor 전송이 확정 발생’이라고 판정하지 않았습니다. 단순 비교 하나로 token 선택의 TOCTOU까지 해결했다고 주장하지 않습니다.
2. **규칙 문서 reader의 정책 차이:** AtomicStore는 unknown matchType을 과거 exactMatch로 fallback하고 빈 keyword 문서를 건너뜁니다. Capture reader는 regex/빈 keyword/잘못된 priority를 ContractFailure로 거부하며 Web reader도 별도 호환 mapping을 합니다. 정상 writer는 유효한 두 projection을 기록하므로 정상 생성·수정 경로의 즉시 장애로 단정할 수 없습니다. 향후 MER-006 정책을 바꿀 때 공통 stored-document decoder와 typed failure 의미부터 합쳐야 합니다. 잘못된 운영 문서를 임의로 보정하는 수정은 하지 않았습니다.
3. **QuickEdit CategoryRepository의 기본 목록 fallback:** 일회 조회 실패/빈 결과가 기본 카테고리 목록으로 합쳐집니다. 현재 ID를 소문자로 바꾸지는 않으나 사용자 정의 category의 label을 일시 표시하지 못할 수 있습니다. 조회 오류 UX를 바꾸려면 사용 가능한 마지막 목록을 보존할지 정책을 정해야 하며 새로운 영속 금융 cache를 도입하지 않았습니다. 미사용 실시간 API를 없애는 작업은 이번 목표가 아니므로 그대로 두었습니다.
4. **parser 등록 목록의 변경 비용:** 새 package는 Native registry, server registry와 parser supportedPackages를 함께 갱신합니다. 기존 본문 형식 수정은 서버 parser만으로 끝납니다. APK와 서버가 서로 다른 배포물인 점을 무시해 런타임 원격 레지스트리나 생성 프레임워크를 추가하는 것은 현재 3인 가구에 과합니다. 정적 목록 일치 검증을 유지하고 파일 길이만으로 공급자 정책을 잘게 쪼개지 않았습니다.
5. **AtomicStore 내 전체 상태 복사:** 카드/규칙 mutation이 작은 배열·claim을 복사하는 구현은 읽기 쉽고 원자 변경 경계를 유지합니다. `merchantMutation`의 in-memory Store adaptation과 card state 비교는 추가 단순화 후보지만, 실제 데이터 크기와 복사 비용의 병목 증거 없이 새 state framework로 바꾸지 않았습니다. 해피패스의 projection 한 문서 read를 우선 보존했습니다.

## 검증 기록

| 실제 실행 | 결과·범위 |
|---|---|
| Functions category-reference-reader, capture-configuration-projection, category-capture-projection-invalidation, payment-capture-projection-invalidation, raw-capture-production-flow | 5개 파일 20개 테스트 통과 |
| Functions capture-transaction-gateway, raw-capture-production-flow, shortcut-retry-receipt-production, capture-ledger-cancellation-safety | 구형 receipt 호환 교차검토 수정 후 4개 파일 43개 테스트 통과. 위 범위와 겹치므로 단순 합산하지 않습니다. |
| Android QuickEditCommandDeliveryLifecycleTest, QuickEditCommandOutboxTest, QuickEditPendingQueueTest, SessionMirrorTest | JVM 4개 suite 32개 테스트 통과. Android debug Kotlin/Java 컴파일 포함 |
| Activity 재생성·다른 멤버의 이전 초안 제출 instrumentation 회귀 | 테스트 코드 추가, `compileDebugAndroidTestKotlin` 통과. 로컬 에뮬레이터 실행하지 않음. 전체 CI 대상 |

격리 환경의 Vite child process/Gradle 사용자 캐시 접근 차단 후 승인된 로컬 실행으로 같은 테스트를 재실행했습니다. 운영 호출·배포·APK 릴리즈는 이 하위 작업에서 하지 않았습니다. 전체 타입·빌드·CI와 배포 확인은 통합 작업에서 수행합니다.
