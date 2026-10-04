# Simplicity 기능 계약 검토: Access·서버 공용 플랫폼

검토일: 2026-10-05. 제품 코드 수정·테스트 실행·commit·운영 데이터 접근은 하지 않았습니다. 저장소 정적 읽기 검토입니다. 코드·테스트·설정의 파일별 읽기 깊이는 [통합 목록](files.csv)에 기록했습니다. 전수 검토 완료가 아닙니다.

## 우선 판단

1. 가장 먼저 제거할 것은 호출되지 않는 예전 모형 구현입니다. 삭제 직전 타입·동적 import·도구 소비자까지 확인한 작은 단위부터 시작할 수 있습니다.
2. 그다음은 전체 메모리 상태를 흉내 내는 Store/reducer 추상화입니다. 실제 Firestore 조회 범위와 추상 상태가 어긋나 계약 오류를 숨기는 사례가 있습니다.
3. 구조 검사는 외부 행동 검증을 보조해야 합니다. public.ts 경로·Subject 이름·동일 파일형태 자체를 보존 목표로 삼지 않아야 합니다.
4. 멱등성·원자성·권한·보안 제한과 page/checkpoint는 코드가 길어도 이유가 분명합니다. 이를 삭제하기보다 소유 위치를 하나로 줄입니다.

## 기능 흐름 지도

| 계약 | 실제 진입 → 판정 → 저장/응답 | 조사 상태 |
|---|---|---|
| household-command.v1 | firebaseHouseholdCommand → commandRouter(auth/envelope/actor/receipt) → 기능 handler → 기능 transaction 또는 router receipt → wire response | 공용 router·Access handler와 기능별 handler 연결 확인 |
| household-query.v1 | firebaseHouseholdQuery → queryRouter(auth/scope/admin/external quota) → query handler → wire response | 공용 router·composition 읽음 |
| HH-005/HH-008 로그인·가구 접근 | resolveFirebaseSignedInUser → membership view → canonical membership/member/household → session DTO; 명령 접근은 별도 claim fast path | 상세 읽음. 관리자 제거·복구·논리삭제 및 실제 purge의 claim 변경까지 교차 확인 |
| HH-007/HH-JOIN-001 가구 생성·초대·가입 | Access handler → GoogleOnboarding Application → whole-state transact → FirebaseGoogleOnboardingStore → canonical docs/UID claim/receipt; 생성 후 category 초기화 | Application/handler/Store 전체 읽음; 원자 identity 생성과 후속 초기화 분리 확인 |
| HH-009/T-HH-004 RenameSelf | handler → renameSelf → state membership/name/version/receipt 판정 → FirebaseMemberRenameStore transaction → member/profile/view/legacy mirror/outbox | 상세 읽음, 실제 Emulator 재현 미실행 |
| EXT-003 실제 외부 HTTP | market/dividend/billing Adapter → SafeExternalTextHttpApplication → NodeExternalTextHttpTransport → bounded body/result | 실제 transport·공급자 연결과 미사용 모형 구별 |
| JOB-ERR-001/002 예약 실행 | scheduled bootstrap → runTrackedScheduledJob → execution app → page feature → Firebase lease/checkpoint/result | runner/app/Firestore Store/monitor/feature pages/cron bootstrap 본문 읽음 |
| runtime migration | CLI → dryRun plan+hash → explicit apply scope/checkpoint → bounded pages → reconciliation | Application/plan builder/persistence/5개 collector 전체 읽음, 운영 실행 미실시 |
| T-HH-RULES-001 보안 | Firebase rules active membership/admin → 허용된 read, client write 일괄 거부 | rules 전체 읽음, 실제 행렬 테스트 미실행 |
| REL-001~004 delivery | path scope → provenance baseline → plan/build/deploy/smoke | scope 일부, wrapper 초반/구조만. 완료 판정 불가 |

## 후보 A01 — 사용처 없는 서버의 클라이언트 세션 모형 삭제

- 계약: HH-005, T-SYS-008.
- 근거: `functions/src/platform/client-session/application/clientSessionScopeApplication.ts:14`는 cachedKeys/activeSubscriptions/renderedRecordIds/writes 배열만 조작합니다. 실제 브라우저/Native 저장소나 쿼리를 실행하지 않습니다. 저장소 전체 .ts/.tsx/.mjs/.cjs/.kt 검색에서 factory 호출자가 없고 `public.ts`도 타입만 재수출합니다.
- 실제 소비자: 없음(정적 심볼 및 module 경로 검색 기준). 과거 `docs/testing/removed-notification-payment-shadow-tests.json:703`도 실제 Web/Kotlin과 연결되지 않은 모형으로 이미 기록했습니다.
- 작은 설계: 디렉터리 5개 파일 전체를 제거하고 실제 Web/Kotlin 세션 구현·실제 E2E만 계약 소유자로 유지합니다. 테스트용 추상 세션 엔진을 새로 만들지 않습니다.
- 보존할 계약: UID/가구 scope 변경 때 늦은 응답 폐기, 로그아웃 구독 정리, 미인증 read/write 차단.
- 검증: 삭제 전 module graph·컴파일 확인, 실제 `web/e2e/access-household.spec.ts` 및 Android startup 계약의 해당 시나리오 확인. 경로 연결만으로 모든 행동 검증 완료라고 하지 않습니다.
- 확신: 높음(미사용); 실제 클라이언트 계약 커버리지 완전성은 별도 검토.

## 후보 A02 — 서로 다른 Safe HTTP 모형 두 개 삭제

- 계약: EXT-003/T-EXT-003.
- 근거: `safeExternalHttpApplication.ts:49`, `providerScopedSafeHttpApplication.ts:11`는 ScriptedHttpTransportPort를 사용하며 실제 소비자가 없습니다. 뒤 파일 :56은 'fixture는 response와 redirect만 지원' 오류를 던집니다. 반면 실제 코드는 `safeExternalTextHttpApplication.ts:40` + `adapters/http/nodeExternalTextHttpTransport.ts`이고, portfolio market/search, dividend pages, billing reader가 이를 호출합니다.
- 실제 소비자: 앞 두 factory는 없음; 실사용은 Text HTTP 경로.
- 작은 설계: 미사용 factory 2개, 전용 input port 2개, scripted transport port 1개 및 public 타입 재수출을 제거합니다. 실사용 `safeHttpPolicy.ts`·`httpStatus.ts`는 보존합니다.
- 보존할 계약: HTTPS/provider host/port allowlist, redirect hop마다 재검증, byte/timeout 상한, retryable만 유한 재시도. 호출부의 병렬 수 제한도 별개로 유지합니다.
- 검증: 실제 safe-external-text-http 계약과 Node transport+실제 공급자 fixture 검증; 삭제된 모형 테스트를 복구해 검증했다고 하지 않습니다.
- 확신: 높음. 기존 `docs/testing/portfolio-shadow-audit.json:423~445`도 이 모형들의 테스트만 제거하고 소스는 보존했다는 기록입니다.

## 후보 A03 — 미연결 ingress·결과분류·HTML 파서 모형 삭제

- 계약: EXT-001/002, T-EXT-002/004.
- 근거: `hardenedIngressApplication.ts:11`, `credentialIngressApplication.ts:17`, `externalResultClassificationApplication.ts:8`, `htmlQuoteParsingApplication.ts:8`는 저장소 전체 검색에서 factory 정의 외 호출자가 없습니다. 특히 hardened ingress :80 이후는 target ID를 page 배열에 옮길 뿐 실제 refresh 없이 COMPLETE를 저장합니다. htmlQuoteContract는 실제 공급자 DOM이 아닌 `data-contract=quote-v1` 예제 형식을 파싱합니다.
- 실제 소비자: 없음. 관련 public.ts는 타입만 재수출; 기존 shadow audit :375~422가 같은 미사용 사실을 기록합니다.
- 작은 설계: 이 4개 factory와 전용 ports/domain 모형의 사용처 없는 연결 그래프를 삭제합니다. 실제 router Auth/App Check/quota, 실제 provider 결과 mapping/HTML parser는 해당 실제 경로에 남깁니다. `ExternalResult` 등 타입도 전역 import 확인 후 삭제해야 합니다.
- 보존할 계약: 접근 검증, scoped credential expiry/revoke, 호출 비용 한도, 실제 supplier 결과분류. 모형 삭제는 미구현 실제 기능을 구현 완료로 만드는 작업이 아닙니다.
- 검증: entrypoint graph/빌드, 실제 ingress 보안 E2E와 provider fixture 테스트. 실제 적용되지 않은 보안 요구사항이 있다면 별도 gap으로 남겨야 합니다.
- 확신: 미사용 높음; 전용 타입 전체 삭제 범위는 마지막 graph 확인 필요.

## 후보 A04 — RenameSelf의 가짜 전체 상태 계약을 실제 transaction 입력으로 축소

- 계약: HH-009/T-HH-004, 설계 `household-access/design.md:224`(동일 가구 충돌), :142/:523. HH-009 요구사항 행 자체는 동일 이름 금지를 직접 적지 않았지만 설계와 실행 계약 테스트가 명시합니다.
- 근거: `firebaseMemberRenameStore.ts:170`은 members를 `linkedPrincipalUid == 본인`으로 제한합니다. `memberRenamePolicy.ts:39`의 displayNameExists는 state.members에서 **다른 멤버**의 같은 이름을 찾습니다. canonical member가 있으면 legacyMembers도 쓰지 않습니다. 따라서 실제 transaction에는 충돌을 판정할 다른 멤버가 없습니다.
- 테스트 차이: `member-rename.contract.test.ts:127~153`은 다른 멤버 '진선'으로 변경 시 DISPLAY_NAME_EXISTS를 요구합니다. `support/member-rename-fixture.ts:68`은 모든 가구 멤버를 배열에 넣어 실제 Store와 의미가 다릅니다. 검사한 Firebase Access integration 2개 파일에는 RenameSelf가 없고 Web E2E는 정상/권한 위조만 확인합니다.
- 추가 복잡성: Store :113 load와 :161 transact는 조회·mapping을 복제하며, 변경 후 전체 배열을 다시 diff해서 write를 만듭니다. store.read는 Application에서 사용하지 않고 메모리 fixture 관측에 주로 사용됩니다. Application :114는 항상 success를 반환하는 helper를 broad union으로 선언한 뒤 불가능한 예외를 검사합니다.
- 실제 소비자: `accessHouseholdCommandHandlers.ts:587`의 rename-self. 사용자 설정에서 실제 호출됩니다.
- 작은 설계: 본인 member/current version + 이름 충돌 + receipt를 명시적으로 읽는 rename transaction으로 좁힙니다. pure 이름 검증/변경 계산은 작은 함수로 남길 수 있으나 전체 state 복사/diff API는 제거합니다. 같은 이름이 동시에 생기는 경합까지 새 transaction 계약에서 고려해야 합니다.
- 보존할 계약: 자기멤버만 수정, 중복 이름/expectedVersion 충돌, member/profile/view 표시 동기화, stable ID/타도메인 참조 보존, receipt+outbox 원자성, 재전송 멱등.
- 검증: **수정 전 실제 Emulator에 같은 가구 멤버 두 명을 만들고 중복 rename 재현** → 수정 후 거부와 데이터/이벤트 불변 확인. 정상·동시 이름경합·staleVersion·동일 멱등key/다른 payload도 실제 Store로 검증.
- 확신: 코드와 계약 불일치 높음. 실제 운영 장애/재현은 주장하지 않습니다. 일반 리팩터보다 우선 확인할 기능 결함 후보입니다.

## 후보 A05 — 온보딩 거대 Application의 dummy dependency 제거

- 계약: HH-007/HH-JOIN-001/HH-011.
- 근거: `accessHouseholdCommandHandlers.ts:318/367/368`은 unused-household-id/member-id를 주입하고 :91/:97은 INITIALIZATION_ONLY 가짜 remapper를 주입합니다. :497/:560도 unused-profile-id입니다. 필요한 동작은 join/issue/rename인데 여러 use case를 합친 Application 생성자가 모든 dependency를 강제합니다.
- 실제 소비자: 가구 생성/가입/초대/프로필 명의 변경 handler들.
- 작은 설계: 동작별 ordinary function이 필요한 database/clock/id function만 받도록 분리합니다. DI class/port를 더 추가하는 분리는 목적이 아닙니다. 동일 파일 안의 create/join/issue 함수와 공통 값 검증으로 충분합니다. Store의 전체 상태 입출력도 기능 transaction 단위로 전환하는 것이 함께 검토할 핵심입니다.
- 보존할 계약: UID 전역 단일 claim, 초대 5분/1회 소비, 일회 원문 노출, onboarding 원자성, 기본 category 초기화 재시도.
- 검증: 실제 Firebase 온보딩 경합·재전송·초대 만료·다른 UID 선점, 신규 가구 첫 command, 초기화 실패 복구.
- 확신: dummy dependency와 경계 불일치 높음. GoogleOnboardingStore·관련 Access Store를 후속 전체 검토했습니다. 동작별로 실제 transaction 경계를 정한 뒤 옮겨야 하며 일괄 재작성은 권고하지 않습니다.

## 후보 A06 — 명령 등록·권한·멱등성 정책을 등록 위치 한 곳에서 읽게 축소

- 계약: household-command.v1, household-query.v1, HH-008, REL-003.
- 근거: command 이름은 JSON manifest, `householdCommandManifest.ts:7` 배열, 실제 handlers에 반복됩니다. scope/admin 정책은 router :23/:41, read receipt 예외는 :37, domain receipt 예외는 :213에 따로 있습니다. 새 handler가 어떤 경로를 타는지 여러 파일을 따라가야 합니다. handler 실행/오류 mapping도 router의 receiptless·receipt 경로에 반복됩니다.
- 실제 소비자: 모든 callable 명령/조회.
- 작은 설계: handler 정의 옆에 scope/read-or-write/receipt ownership을 적는 명시적 descriptor 하나를 두고 manifest는 그 정의에서 생성 또는 계약 snapshot으로 검증합니다. Router는 검증→권한→해당 실행 함수→wire mapping으로 단순화합니다. 거대한 generic command framework는 만들지 않습니다.
- 보존할 계약: wire 이름/버전, identity payload 위조 금지, tenantless allowlist, admin capability, payload mismatch·replay, domain transaction receipt. read인 resolve-signed-in-user는 기존 wire 호환을 유지할 수 있습니다.
- 검증: 서로 다른 commandId/idempotencyKey, payload mismatch, 동일 key 동시 호출, 도메인 commit 후 router receipt 실패 재전송, read receipt 미생성, 관리자/타가구 권한 행렬.
- 확신: 중간. domain receipt로 전부 일괄 전환하면 기존 client/idempotency semantics를 깨뜨릴 수 있으므로 기능별 전환만 권고합니다. 현재 read 예외가 불필요하다고 제거하는 방식은 금지합니다.

## 후보 A07 — 계약 테스트의 문법/폴더 강제를 행동 검증으로 대체

- 계약: 검증 신뢰성(도메인 전반), REL-001.
- 근거: `contract-tests-are-implementation-independent.test.ts:80~102`는 모든 계약 suite가 exported Subject interface/createSubject factory를 선언하도록 요구합니다. :34~76은 실제 SDK/Application import를 차단합니다. 그러나 fixture는 내부 구현을 import할 수 있어 실제 의미의 독립성을 보장하지 않습니다. `production-dependency-direction.test.ts:100/126`은 모든 기능 경계가 public.ts를 거치도록 합니다.
- 실제 소비자: Functions 전체 CI. RenameSelf처럼 fixture Store와 실제 query scope가 달라도 구조 검사는 통과합니다.
- 작은 설계: Subject 이름/공장 패턴은 선택으로 바꾸고 실제 기능의 public function 또는 실제 SDK/Emulator 경계 테스트를 허용합니다. 교체 가능한 행동 helper가 실제 재사용될 때만 유지합니다. import cycle/client privileged write 등 구체 위험 검사는 남깁니다.
- 보존할 계약: 핵심 결과·원자성·권한·멱등성 검증, production test 연결. 의도적 실패를 주입했을 때 관련 계약 테스트가 실패하는지 확인합니다.
- 검증: 기존 행동 assertion과 통합/E2E는 그대로 유지, 제거되는 것은 형식 강제 검사입니다. 해당 변경을 '테스트 약화'로 포장하거나 반대로 보호 행렬을 없애지 않습니다.
- 확신: 높음(구조가 목적이 되는 강제). 모든 fixture가 무가치한 것은 아니며 실제 fake DB가 의미를 충실히 제공하는 경우 유지 가능합니다.

## 후보 A08 — 운영 runner에 박힌 테스트 전용 실패 주입 제거

- 계약: JOB-ERR-001/002, T-JOB-002.
- 근거: `scheduledJobExecutionApplication.ts:57/:261`의 필수 TopLevelJobFailurePort는 운영에서 `trackedScheduledJob.ts:78` → `NoInjectedTopLevelJobFailure` 하나뿐입니다. `firebaseScheduledJobStores.ts:569` 구현은 무조건 undefined입니다. Application은 실제 pages.nextPage 예외를 이미 :152~155에서 최상위 실패로 처리합니다.
- 실제 소비자: 운영 runner는 noop, 테스트 fixture만 의도한 실패를 반환합니다.
- 작은 설계: topLevelFailure port/NoInjected adapter/분기 제거. 테스트는 실제 사용 포트인 nextPage에 실패를 발생시켜 같은 실패 저장·관측 경로를 검증합니다.
- 보존할 계약: 실패 성공오보 금지, lease 소유자만 최종 저장, checkpoint 재개, 유한 deadline/page, partial failure·retryable target 유지.
- 검증: 실패 page throw→FAILED 저장/관측, 유효 target 완료 후 실패→재시도 시 중복 처리 없음, stale lease completion 거부.
- 확신: 높음. lease/checkpoint/monitor 자체는 정당한 복잡성이며 삭제 후보가 아닙니다.

## 당장 평탄화하면 안 되는 복잡성

- Firestore/Storage rules는 allowlist와 server-only writes를 구체적으로 표현합니다. wildcard 하나로 줄이면 새 collection이 의도치 않게 노출될 수 있습니다. 반복된 allow read/write가 즉시 과도 추상화는 아닙니다.
- command receipt와 domain receipt는 crash window·동시 재전송을 다룹니다. 중복 왕복을 줄일 수 있어도 권위 트랜잭션/멱등성 자체를 제거하면 안 됩니다.
- onboarding/purge의 UID 전역 claim, 삭제 후 접근 차단, 가구/멤버 복구, purge checkpoint는 외부 Auth와 여러 저장소의 경계를 다룹니다. 큰 파일이라는 이유만으로 하나의 transaction이라고 가정할 수 없습니다.
- 실제 SafeText HTTP의 timeout, byte cap, provider ACL, 수동 redirect 검증은 서로 다른 위험을 다룹니다. 예외가 많다는 이유만으로 일반 fetch로 바꾸면 안 됩니다.
- migration은 plan hash/scope/operator/explicit confirmation/checkpoint/reconciliation 검증이 필요합니다. 운영 데이터를 읽지 않아 이미 끝난 migration/legacy fallback을 제거해도 되는지는 판단하지 않았습니다.
- deploy scope는 마지막 성공 provenance 이후 누적 diff를 보며 세 codebase를 다룹니다. 단순 HEAD diff로 줄이면 미배포 변경을 놓칠 수 있습니다.


## 후속 본문 검토: A03·A05·A08 보강

### A03에 추가: 선언과 테스트만 소비하는 작은 공용 모형

- `platform/compatibility/member-reference/memberReferenceMigration.ts:29`의 resolveLegacyMemberReference는 실제 migration CLI/collector가 호출하지 않습니다. 실제 collector는 operator mapping을 받아 `runtimeMigrationCollectorContract.ts`의 resolveMember를 사용합니다. 전자의 소비자는 `test/support/member-reference-migration-fixture.ts`뿐입니다.
- `platform/shared-kernel/categoryCompatibility.ts:6`의 mapStoredCategory, `moneyInWon.ts:9`의 createPositiveMoneyInWon도 production 소비자가 없고 shared-value-contracts.contract.test.ts와 public 재수출만 있습니다. 단, moneyInWon의 ValueValidationResult 타입은 실제 사용 중인 seoulDateTime에서 쓰이므로 파일 통삭제 대신 타입 이동/인라인 여부를 분리해야 합니다.
- 제거 가능한 것은 사용하지 않는 함수·전용 타입/fixture이며, 실제 Android 카테고리 호환·실제 command 금액 검증·실제 legacy 이관 동작은 별도 현재 코드에서 계속 보존합니다. 모형 테스트 삭제를 기능 검증 완료로 취급하면 안 됩니다.
- 검색 범위: 저장소 전체 `*.ts,*.tsx,*.js,*.mjs,*.cjs,*.kt`의 심볼 검색과 정의/재수출/테스트 구분. 런타임 동적 import 문자열까지 모든 형태를 자동 증명한 것은 아니므로 삭제 직전 build/import graph를 다시 확인합니다.

### A05에 추가: 호출 순서에 숨은 저장 정책과 불필요한 전체상태

- GoogleOnboardingStore `:142/:261~290/:322~355`는 인스턴스 필드 transactionInvocation을 세어 첫 transact만 identity graph와 receipt를 저장하고 이후 transact는 initializationStatus만 저장합니다. 일반적인 transact라는 같은 API의 의미가 호출 횟수에 따라 바뀝니다. Application의 가구 생성→외부 초기화→결과 저장 흐름을 명시적인 createIdentity/finalizeInitialization 동작으로 드러내면 이 숨은 상태와 불리언 persistIdentityGraph가 필요 없습니다.
- Google 가입/초대/가구 생성은 현재 동일한 store shape와 생성자 의존성을 공유합니다. 미사용 nextHouseholdId/initializer를 채우는 대신 각 동작에 필요한 입력·저장만 받는 함수가 작습니다. UID claim·초대 소비·identity+outbox+receipt 원자성은 유지합니다.
- MemberLifecycleUnitOfWork `:114~145`는 단일 멤버 제거/복구에도 모든 members/memberships/profiles를 읽고 모든 membership의 글로벌 UID claim을 추가 조회합니다. 이후 여러 배열을 diff하여 일부 문서만 저장합니다. 실제 입력의 target memberId와 필요한 membership/profile/claim/version/receipt로 transaction을 좁힐 수 있습니다. 모든 멤버·가구원 제거 허용과 동일 ID 복구 정책은 바꾸지 않습니다.
- AssetOwnerProfileStore `:81~83`도 profiles·members·memberships 전체 조회를 합니다. Application은 memberships와 profiles는 사용하지만 state.members를 읽지 않습니다. 사용하지 않는 members 조회·DTO mapping은 명확한 제거 후보입니다. list/rename/create/archive 동작별 조회 범위를 분리할 수 있으며, 이름 변경은 기존 stable profileId와 과거 참조를 유지해야 합니다.
- 검증 단위: 실제 Firebase 생성/초기화 실패 후 재시도; 초대 중복 소비/UID 선점; target 멤버 제거/복구 후 실제 command actor 차단/복구; profile archive 후 과거 자산 read. 쓰기 폭과 조회 폭을 관측하되 배열 구조를 그대로 요구하는 assertion을 새로 만들지 않습니다.

### A08에 추가: 실제 기능과 다른 테스트 편의용 메서드

- HouseholdLifecycleApplication의 requestHouseholdDeletion `:50`과 requestPermanentHouseholdPurge `:269`, authorizeBusinessAccess `:369`는 production에서 호출하지 않습니다. 실제 논리삭제는 AdminHouseholdConsoleApplication.deleteHousehold, 실제 영구삭제는 `functions/scripts/access-operations.mjs:47` → HouseholdPurgeProcessApplication입니다. restore만 이 lifecycle app의 실제 경로입니다.
- FirebaseHouseholdLifecycleUnitOfWork는 purgeProcess를 load/persist하지 않고 `:155` 부근 이벤트 처리에서 Deleted/Restored 외 이벤트를 건너뜁니다. 따라서 미사용 purge 메서드를 메모리 fixture로 검사해도 실제 purge adapter 행동 검증이 되지 않습니다. 앱을 단순한 restore 동작으로 줄이고 실제 삭제/purge 경로의 계약 검사를 유지하는 방향입니다.
- MemberLifecycleApplication.authorizeMember `:308`, AssetOwnerProfileApplication.resolveOwnerProfileForHistory `:311` 역시 함수 정의·port·test fixture 외 production caller가 없습니다. 실제 command authorization/자산 과거 조회를 검사하도록 대체해야 합니다.
- ScheduledJobMonitorApplication.recordRunRecovery `:118`은 실제 production caller가 없고 scheduled-job-monitor.contract.test.ts `:320`에서 사용합니다. 실제 Firebase monitor repository `:421~424`는 terminal 상태를 새로 만들지 못하도록 막고 execution repository.completeRun만 정상 완료를 저장합니다. 모형 테스트의 강제 terminal 변경을 실제 runner completion→incident resolve로 검증해야 합니다.
- Purge의 beforeStep fault 포트도 운영에서는 항상 proceed입니다. 삭제는 가능하지만 claim 읽기/participant 호출/finalization 실제 포트 실패로 같은 재개·중복방지 계약을 먼저 검증해야 합니다.
- 이름이 테스트에 등장한다는 것과 실제 제품 행동을 검증한다는 것을 분리합니다. 모든 권한 메서드를 삭제하자는 것이 아니라 production에서 사용하는 실제 경계가 계약 소유자가 되어야 한다는 의미입니다.

## 후보 A09 — 30일 접속 통계 정리가 실제 저장에서도 적용되도록 단순화

- 우선순위: A04와 함께 기능 불일치 확인 우선. 계약 ADM-006/T-ADM-005.
- 흐름: memberAccessHouseholdCommandHandlers → FirebaseMemberAccessStore.record → recordMemberAccess로 날짜·중복·누적 판정 → 통계와 visit receipt 원자 저장.
- 근거: memberAccessStats.ts `:72~76`은 오래된 dailyAccessCounts 키를 제거한 새 map을 만듭니다. FirebaseMemberAccessStore.ts `:107~117`은 해당 map을 merge:true set으로 저장합니다. Firestore의 nested map 병합에서는 생략한 예전 날짜 키가 삭제되지 않아 30일 pruning이 저장상태에 적용되지 않을 수 있습니다.
- 테스트와 실제 저장의 의미 차이: 순수 member-access-stats.contract.test.ts `:81`은 새 JS 객체만 검사합니다. adapter 테스트가 사용하는 `test/support/in-memory-firestore.ts:386~391`은 map을 재귀 병합하지 않고 top-level 값으로 교체합니다. 이 fake에서는 실제 SDK의 nested merge 문제를 볼 수 없습니다.
- 작은 설계: 알려진 statistics 문서를 필요한 기존 필드와 함께 replace하거나 dailyAccessCounts 필드를 명시적으로 map replacement하는 update/mergeFields로 저장합니다. 오래된 키마다 개별 예외/cleanup job을 덧붙이는 방향은 피합니다.
- 보존 계약: 누적 횟수·플랫폼 count·createdAt, 같은 scope visitId 영구 멱등 receipt, 통계와 receipt의 단일 transaction. 최근 128개 ID만으로 새 receipt를 대체하지 않습니다.
- 검증: 실제 Emulator에 30일 초과 키와 현재 키를 seed→실제 store.record→원문 문서를 재조회하여 제거 확인. 서울 날짜 경계·동일 visit replay·트랜잭션 실패도 확인합니다. fake를 고친다면 영향을 받는 모든 nested merge 테스트를 실제 SDK와 대조해야 합니다.
- 확신: 저장/API 의미 불일치 높음. 이 조사에서 Emulator 재현이나 운영 데이터 조회는 수행하지 않았으므로 실제 발생 건수는 모릅니다.

## 후보 A10 — 관리자 조회를 실제 조회 범위에 맞추고 만료된 통계 예외 제거

- 계약 ADM-001/T-ADM-001, ADM-005/T-ADM-004.
- 목록 흐름: admin.list-households → AdminHouseholdConsoleApplication.listHouseholds `:117~119` → store.read → 모든 가구 정렬 후 slice. FirebaseAdminHouseholdStore `:73~83`는 query.get 전체 조회입니다. limit/cursor는 반환량만 줄이고 DB 읽기량을 줄이지 못합니다.
- 작은 설계: 실제 DB orderBy(createdAt desc, stable ID)+cursor+limit 조회가 결과를 바로 돌려주도록 읽기 전용 계약을 둡니다. 현재 offset cursor wire 호환/동일시각 정렬을 유지 또는 명시적인 호환 전환이 필요합니다. 관리자 가구 수가 적다면 긴급 성능 결함이 아니라 구조 정비 후보입니다.
- dashboard는 여러 운영 collection과 가구별 member를 전부 읽는 실제 consumer라 별도 요약 조회 필요성을 결정할 수 있습니다. 측정 없이 캐시·추상 read model 계층을 추가하지 않습니다.
- 독립적인 즉시 정리 요소: GoogleCloudInteractiveLatencyReader `:78~103`의 2026-07-28/29 및 08-02 오류 표본 제외 날짜는 현재 실제 consumer FirebaseAdminDashboardReader `:223/:227/:232`가 항상 windowHours:24를 요청하므로 현재 조회에서 효과가 없는 과거 사건별 예외입니다. 제거 후 최근 24시간·재시도 correlation 축약·notifications rejected 제외의 실제 정책은 유지합니다.
- 검증: 첫/다음 cursor와 같은 createdAt tie, 삭제 가구 포함 정책, 비관리자 거부; 현재 24시간 actual latency fixture/HTTP response와 이전과 같은 결과 확인. 역사적 날짜를 입력하는 테스트만을 위해 죽은 예외를 영구 보존하지 않습니다.
- 확신: 전체 read→slice 및 과거 날짜 예외가 현재 window 밖이라는 사실 높음; 운영 사용자 체감 영향은 측정하지 않았습니다.

## 후속 조사에서 확인한 실제 계약 흐름

| 계약 | 실제 진입 → 판정 → 저장 | 판정 |
|---|---|---|
| HH-001/002 legacy 연결 | command/recovery CLI → legacy 후보·household/member·UID claim 확인 → canonical member/profile/membership/view/claim + 감사 outbox/receipt transaction | 오래된 브라우저 후보 정책은 실제 Web에 있고 서버 모형 resolve/capture가 그 경로를 대체하지 않음. 구버전 종료 근거 없이 fallback 삭제 금지 |
| HH-012 멤버 제거·복구 | 검증된 systemAdmin capability → member/version/UID claim 판정 → member/membership/profile/claim/view + receipt/outbox | 전체상태 조회 축소 후보. 원자 claim 해제/재획득과 즉시 접근차단은 유지 |
| ADM-003 가구 삭제·복구 | admin console delete / lifecycle restore → expectedVersion·상태·사유 판정 → household와 모든 claim lifecycle projection 동시 변경 | canonical 접근 fast path의 projection 동기화는 필요 |
| ADM-003 실제 purge | access-operations CLI → request + runExclusive → claim snapshot page → 5 context purge checkpoint → current claim version 비교 finalization → purged tombstone/audit | bounded page·checkpoint·fencing·충돌 보존은 정당. 자동 lease 탈취 없음은 명시적인 운영 정책 |
| ADM-006 접속/시작 계측 | visit command → scoped durable visit receipt + stats transaction → 신규 visit만 시작 진단 log | client 진단 allowlist·범위 제한·관측 실패가 업무를 막지 않는 경계는 정당. nested merge만 확인 우선 |
| ADM-005 운영 dashboard | admin query → household/member/stats/status/provider/incidents 병렬 read + 최근24h CloudLogging + billing summary → 공개 DTO | 서버 전용 정보 경계와 장애 unavailable/partial 구분 유지 |
| JOB-ERR-001/002 | tracked scheduled run → domain page → fenced run+result+summary 저장 → monitor 독립 expected occurrence·grace/heartbeat/deadline 판정 → incident | lease와 terminal 결과 소유자 한 곳 유지. monitor test-only terminal command는 제거 후보 |
| runtime migration | migrate-runtime CLI → project/household scope+operator mappings → 5 collectors+source/decision hash 계획 → 확인된 hash/checkpoint apply → 원자 page writes+receipt → target count/amount/decision 재조정 | legacy source 불변·target allowlist·참조 확인·원자 page는 정당. 이관 완료 여부를 조회하지 않아 레거시 도구 제거는 아직 판단 불가 |
| REL-002/003/004 | deploy-firebase wrapper → target/compatibility checker → build artifact hashes → deployment lease → provenance+smoke | 실제 스크립트 소비자가 있어 deployment-assurance 앱은 미사용 모형으로 분류하지 않음. wrapper 전체 본문은 도구 보고서에서 검토 |

## 최종 범위와 정비 순서

접근·공통 플랫폼·예약·이관의 실제 코드와 연결된 도구·테스트를 검토했다. 배포 wrapper·smoke·CI는 [도구](tooling.md), 테스트·fixture·실제 SDK 의미 차이는 [플랫폼 테스트](platform-tests.md)에 정리했다. 최종 파일 목록은 [files.csv](files.csv)를 따른다. 관련 요구사항은 계약 근거로 읽었으며 모든 역사 문서·ADR 전수 검토나 실제 운영/Emulator 검증을 뜻하지 않는다.

순서는 A01~03 미호출 코드, A04/A09 실제 SDK 계약 재현, A05 필요한 상태만 읽는 동작별 transaction, A08 실제 완료 경로 통합, A06/A07 등록·테스트 구조, A10 조회 범위와 만료 예외다.

추가 경계 확인: `adapters/firebase/home-preferences/firebaseHomePreferenceAtomicStore.ts`(전체 읽음)은 홈 카드 변경에서도 지역화폐 canonical/legacy balance를 모두 읽습니다. 같은 파일의 자동 선택 준비 함수는 query를 sequential로 읽어 ABORTED가 병렬 query INVALID_ARGUMENT에 가려지지 않게 했지만 일반 transact는 Promise.all query를 유지합니다. 이는 새 장애 재현이 아니라 동작별 필요한 조회를 구분하지 못한 흔적이며 A05 범위 축소 후보입니다. 현재 홈 설정의 expectedVersion·receipt·canonical/legacy mirror/outbox 원자성은 보존합니다.
