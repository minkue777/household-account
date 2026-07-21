# Android Host·WebView·QuickEdit 모듈 상세 설계

> 요구사항: [Android Host·WebView·QuickEdit 모듈 요구사항](requirements.md)  
> 상위 지도: [지원·읽기·플랫폼 영역](../../requirements.md)  
> 공통 형식: [모듈 상세 설계 규약](../../../governance/module-design-standard.md)  
> 목표 아키텍처: [목표 Clean Architecture 설계](../../../../architecture/target-clean-architecture.md)

## 1. 설계 목적과 추적성

이 설계는 `AND-*`, `QE-*` 요구사항을 Android UI shell과 얇은 Client Adapter로 구현하기 위한 기준이다. Android Host는 거래 규칙을 판정하거나 Firestore에 직접 쓰지 않는다. OS 권한, WebView, origin 제한, local mirror와 QuickEdit 화면을 소유하고 모든 거래 변경은 Ledger 공개 Command로 위임한다.

공통 `Result`, 인증·tenant 원칙과 테스트 형식은 [상세 설계 규약](../../../governance/module-design-standard.md)을 따른다. Bridge와 QuickEdit의 wire DTO는 `contracts/` schema에서 Kotlin 타입을 생성한다.

## 2. 모듈 경계와 책임

| 내부 구성요소 | 책임 | 소유하지 않는 것 |
|---|---|---|
| Host Gate | OS 권한 상태를 capability로 변환하고 표시 화면 결정 | 결제 알림 출처 허용 정책 |
| Web Shell | 시작 URL, navigation, 뒤로가기, lifecycle | Web 업무 화면과 PWA worker |
| Secure Bridge | 허용 origin의 Web과 Native 기능 연결 | 가구 인증·인가의 최종 판정 |
| Native Auth Adapter | Credential Manager·Firebase Auth로 Google Principal 획득, 일회성 WebView session exchange 시작 | embedded WebView OAuth·Membership 판정 |
| Session Mirror | Web session을 Android 입력 기능에 전달하는 비권위 cache | Household·Member 원본 |
| QuickEdit | 저장 완료 거래의 편집 UI와 Command 호출 | 거래 분할·삭제의 서버 불변식 |
| Host Notification Adapter | foreground 알림 표시와 QuickEdit 진입 | 수신자 계산·FCM 전송 |

모듈 밖에서는 Activity, SharedPreferences 또는 WebView 구현을 import하지 않는다. Android `:app`의 Composition Root가 각 Port 구현을 조립한다.

## 3. 공개 계약

### 3.1 Host 입력 계약

| 이름·종류 | 호출자 | 입력 | 결과 | 권한·일관성 |
|---|---|---|---|---|
| `EvaluateHostAccess` Query | `MainActivity.onCreate/onResume` | OS capability snapshot, QuickEdit 설정 | `ShowPermissionGuide` 또는 `ShowWebShell` | 로컬 조회; 쓰기 없음 |
| `InitializeWebShell` Command | Activity | environment, saved navigation state | `WebShellReady(startUrl, bridgeState)` | 허용 URL 정책 검증 후 한 번만 load |
| `HandleBackNavigation` Command | Activity | 현재 화면, `canGoBack` | `NavigateWebHistory` 또는 `DelegateToActivity` | 로컬 상태 전이 |
| `SynchronizeSessionMirror` Command | 허용 origin Web page | versioned Web session snapshot | `Applied(changedKeys)` 또는 typed 거부 | 단일 local-store commit |
| `RequestNotificationDisplayPermission` Command | Host 안내 UI | API level, 현재 표시 capability, 사용자 action | `Granted`·`Denied`·`NotRequired` | API 33+에서만 OS dialog; 앱 진입 gate와 분리 |
| `BeginGoogleSignIn` Command | Android 로그인 화면 | Credential Manager 결과 | `Authenticated(principalRef)`·`Cancelled`·typed 실패 | Native Firebase Auth; Google credential 비노출 |
| `ExchangeWebViewSession` Command | 허용 origin top-level WebView | Native 인증과 Principal-bound Membership 조회 뒤 발급한 일회성 exchange handle | `SessionEstablished`·`Expired`·`AlreadyUsed` | 최대 5분 TTL·한 번 사용; householdKey나 장기 token 전달 금지 |
| `OpenQuickEdit` Command | 결제 수집 Client Adapter | 저장된 transaction ID와 표시 snapshot | `Opened`, `Queued` 또는 `Suppressed(reason)` | QuickEdit capability 판정 뒤 session 범위 FIFO에 멱등 등록 |

[DEC-004](../../../governance/decisions.md#dec-004)에 따라 Host Gate는 최초 진입과 resume 시 알림 접근·overlay capability를 모두 요구한다. 두 권한이 준비된 뒤 Web Shell을 표시한다. API 33+ 알림 표시 권한은 편의 capability일 뿐 이 gate에 포함하지 않는다. `OpenQuickEdit`은 이 OS capability와 별도로 사용자 QuickEdit 설정을 확인하며, 설정이 꺼져 있으면 `Suppressed(UserDisabled)`를 반환한다.

### 3.2 JavaScript Bridge v1

Bridge는 임의의 다수 메서드 대신 하나의 versioned message 계약으로 수렴시킨다.

```kotlin
data class BridgeRequestV1(
    val requestId: String,
    val operation: BridgeOperationV1,
    val payloadJson: String?
)

sealed interface BridgeResultV1 {
    data class Success(val requestId: String, val payloadJson: String?) : BridgeResultV1
    data class Rejected(val requestId: String, val code: String) : BridgeResultV1
    data class Failure(val requestId: String, val code: String) : BridgeResultV1
}
```

지원 operation:

- `SYNC_SESSION_MIRROR`: 서버가 발급한 짧은 일회성 Principal-bound Membership receipt를 검증·소비해 receipt의 `householdId/memberId` 동기화
- `CLEAR_HOUSEHOLD_MIRROR`: mirror 삭제 정책 실행
- `GET_QUICK_EDIT_PREFERENCE`, `SET_QUICK_EDIT_PREFERENCE`
- `GET_APP_VERSION`

Bridge 호출은 현재 top-level document의 실제 origin이 `AllowedWebOriginPolicy`에 포함될 때만 처리한다. origin 변경, redirect, subframe, 불명확한 origin은 `Rejected(ORIGIN_NOT_ALLOWED)`다. 가구 키는 호환 입력으로만 받고 인증 증명으로 사용하지 않는다.

Google 로그인 UI는 embedded WebView에서 실행하지 않습니다. Android `NativeGoogleAuthAdapter`가 Credential Manager와 Firebase Auth를 사용하고, 서버 Membership Query가 인증 Principal에 귀속된 active Membership을 조회한 뒤에만 Native mirror와 WebView exchange를 준비합니다. caller가 보낸 householdId·memberId·status는 Membership 증거로 신뢰하지 않습니다. WebView에는 서버가 검증·소비하는 최대 5분의 짧은 일회성 exchange handle만 전달합니다. exchange의 최종 token/cookie 형태는 Infrastructure 상세이지만 Google credential·장기 Firebase ID token·legacy householdKey를 범용 Bridge 메서드로 반환하는 구현은 금지합니다.

### 3.3 QuickEdit Client 계약

```kotlin
data class QuickEditSnapshotV1(
    val transactionId: String,
    val merchant: String,
    val amountInWon: Long,
    val categoryId: String?,
    val memo: String?,
    val aggregateVersion: Long?
)
```

QuickEdit Controller가 소비하는 서버 Port:

| Client Port | 서버 제공 계약 | 성공 후 UI 결과 |
|---|---|---|
| `UpdateTransactionClient` | Ledger `UpdateTransaction` | 반환된 최신 snapshot으로 화면 갱신 후 완료 |
| `DeleteTransactionClient` | Ledger `DeleteTransaction` | 삭제 확인 후 Activity 종료 |
| `SplitTransactionClient` | Ledger `SplitTransaction` | 생성된 그룹 ID·항목을 반영 후 종료 |
| `RequestHouseholdNotificationClient` | Ledger의 명시적 알림 요청 Command | 요청 receipt를 표시; 로컬 미저장 편집은 포함하지 않음 |
| `ListActiveCategoriesClient` | Category `ListActiveCategories` | 선택 목록 표시 |

모든 쓰기는 인증 token, `householdId`, `idempotencyKey`, 예상 `aggregateVersion`을 포함한다. 성공 Toast와 완료 event는 `Success` 또는 동일 요청의 `AlreadyProcessed`를 받은 뒤에만 발생한다.

## 4. 플랫폼 상태와 불변식

업무 Aggregate를 만들지 않고 다음 플랫폼 상태와 Policy를 둔다.

| 모델·Policy | 불변식 |
|---|---|
| `HostCapabilitySnapshot` | 알림 접근, overlay, 알림 표시 권한을 각각 판정한다. component 비교는 정확한 `ComponentName`으로 한다. |
| `WebShellState` | 한 Activity lifecycle에서 시작 URL을 중복 load하지 않는다. 권한 안내 화면에서는 Web history를 소비하지 않는다. |
| `AllowedWebOriginPolicy` | scheme, host, 유효 port가 모두 일치해야 한다. path 문자열 prefix로 origin을 판정하지 않는다. |
| `SessionMirror` | schemaVersion·sessionGeneration·householdId·memberId·sourceVersion·updatedAt을 Android Keystore 기반 암호화 저장소의 한 snapshot으로 저장한다. sessionGeneration은 actor scope를 교체할 때마다 새 값으로 발급하고 household/member와 함께 원자 교체한다. 일부 갱신과 표시 이름 key를 허용하지 않으며 key는 export·backup하지 않는다. |
| `SessionTransitionJournal` | Queue purge 시작 전 이전·목표 generation만 보호 저장하고 mirror commit 뒤 제거한다. purge 뒤 commit 전 중단 흔적은 재시작 시 mirror를 비워 어떤 Actor의 수집도 시작하지 않는 fail-closed 상태로 복구한다. |
| `QuickEditPreferenceKey` | `(householdId, memberId)`의 안정 ID만 사용한다. 표시 이름 변경은 key를 바꾸지 않으며 legacy 이름 key는 한 번만 이관한다. |
| `SensitiveStoragePolicy` | 인증·mirror·legacy key·WebView 민감 저장소·Queue는 backup/device transfer denylist가 아니라 기본 거부 대상이고, 비민감 설정만 allowlist한다. SessionMirror와 Queue는 Keystore-backed encryption을 사용한다. |
| `QuickEditForm` | transaction ID가 있어야 Command 가능하고 금액은 양의 원 단위 정수다. memo의 빈 문자열은 명시적 삭제 값이다. |
| `SplitDraft` | 최소 2항목, 각 항목 양수, 합계 원금 일치. 2항목일 때만 반대 금액 자동 조정한다. |
| `QuickEditQueueEntry` | `(sessionGeneration, householdId, memberId, transactionId, sequence, enqueuedAt)`만 보존한다. 같은 session·transaction ID는 중복될 수 없고 sequence는 단조 증가한다. |
| `QuickEditPresentationPolicy` | 한 번에 가장 오래된 유효 항목 하나만 표시한다. 현재 항목을 후속 거래가 덮어쓰지 않으며 성공 완료·명시 닫기 뒤에만 다음 항목으로 진행한다. 쓰기 실패에서는 진행하지 않는다. Capture 재전송 Queue와 달리 시간 TTL로 버리지 않고 stale 판정 또는 session purge 전까지 보존한다. |
| `SplitDraftSourcePolicy` | 분할 버튼을 누른 순간 현재 `QuickEditForm` 전체를 immutable draft로 고정한다. 저장 snapshot으로 되돌리거나 선행 Update를 호출하지 않는다. provenance는 포함하지 않는다. |
| `SensitiveOverlayPolicy` | DEC-045에 따라 `FLAG_SECURE`·최근 앱 마스킹은 사용하지 않고 캡처를 허용하되 keyguard 우회·외부 Activity 진입·앱 로그 민감값 기록을 금지한다. |

Client 검증은 즉시 피드백용이다. Ledger가 같은 불변식과 원자성을 서버에서 최종 검증한다.

## 5. Application Use Case 상세

### 5.1 `EvaluateHostAccess`

1. `PermissionStatePort`에서 정확한 OS capability를 읽는다.
2. `QuickEditPreferencePort`와 `OverlayPermissionPolicy`로 필요한 capability를 계산한다.
3. 누락 capability와 해당 설정 화면 action을 반환한다.
4. Web Shell 진입 가능 여부와 Android 13+ 알림 표시 capability를 별도로 표현한다.
5. `onResume`마다 재평가하되 설정 화면을 자동으로 다시 열지 않는다.

### 5.2 `InitializeWebShell`

1. `StartUrlPolicy`가 build environment에 맞는 HTTPS URL을 반환한다.
2. WebView에 JavaScript·DOM storage와 최소 보안 설정을 적용한다.
3. `SecureBridgeAdapter`를 등록하고 navigation마다 origin capability를 재계산한다.
4. 저장된 URL이 없을 때만 시작 URL을 load한다.
5. 허용하지 않은 navigation에서는 Bridge를 비활성화하고 보안 event를 기록한다.

### 5.3 `SynchronizeSessionMirror`

1. Bridge Adapter가 main-frame origin과 contract version을 검증한다.
2. 서버가 발급한 일회성 Membership receipt의 서명·만료·미사용 상태와 인증 Principal 귀속을 검증하고, caller payload의 householdId·memberId·status는 사용하지 않는다.
3. 현재 snapshot과 receipt의 householdId/memberId가 다르면 `SessionTransitionPort`로 이전 actor Queue 삭제를 먼저 요청한다.
4. Queue 삭제 실패 시 `Rejected(SESSION_TRANSITION_BLOCKED)`로 끝내고 현재 mirror를 유지한다.
5. `SessionMirrorStore`가 schemaVersion·householdId·memberId 전체를 한 commit으로 교체한다. 부분 setter는 공개하지 않는다.
6. 결제 수집 기능에는 한 번에 읽은 ID snapshot만 제공하고 권한 여부를 의미하지 않는다.
7. 로그아웃도 Queue 삭제 뒤 mirror·legacy identity를 한 clear operation으로 제거한다.
8. 재시작 시 완료되지 않은 transition journal이 있으면 mirror를 비우고 이전·목표 Actor 모두 비활성화한 뒤 재인증을 요구한다.

### 5.4 알림 표시 capability

1. `PermissionStatePort`는 알림 접근, overlay, `POST_NOTIFICATIONS`를 서로 다른 capability로 반환한다.
2. API 32 이하는 `NotRequired`, API 33 이상은 사용자 action에서만 runtime permission을 요청한다.
3. 거부 결과는 저장하되 Web Shell, 결제 알림 Listener, QuickEdit, FID 등록 capability를 거짓으로 비활성화하지 않는다.
4. 시스템 정책상 다시 물을 수 없거나 사용자가 거부한 상태에서는 dialog를 반복 실행하지 않고 설정 화면 action만 제공합니다.

### 5.5 QuickEdit 변경·삭제·알림 요청

1. 누락 transaction ID면 Command를 보내지 않고 `InvalidInput` 상태로 종료한다.
2. 표시 snapshot과 입력값으로 Command payload를 만들되 현재 Actor는 인증 세션 Adapter에서 얻는다.
3. Controller가 단일 서버 Command를 호출한다.
4. `Conflict`면 최신 snapshot 재조회 또는 재확인 상태로 전환한다.
5. 실패 시 기존 화면을 유지하고 오류 code를 표시한다.
6. 성공 확인 뒤에만 완료 event/Toast를 내보낸다.

### 5.6 QuickEdit 분할

1. 사용자가 분할을 누른 순간 `SplitDraftSourcePolicy`가 현재 form의 가맹점·금액·카테고리·memo와 현재 `aggregateVersion`을 immutable base draft로 고정한다.
2. `SplitDraftPolicy`가 현재 form 금액을 기준으로 2개 초기 금액을 몫과 나머지로 만들고 각 항목의 표시 필드를 base draft에서 초기화한다.
3. 두 항목 중 하나 변경 시 반대 항목을 `max(0, baseDraft.amount-input)`으로 갱신한다.
4. 세 항목 이상에서는 자동 조정하지 않고 새 항목을 미배분 잔액으로 시작한다.
5. 최소 개수·양수·base draft 합계 조건을 만족해야 제출을 활성화한다. 카드·출처·creator·capture lineage는 payload에 포함하지 않는다.
6. base draft, 항목 목록, expectedVersion을 서버 `SplitTransaction` 한 번으로 호출한다. 선행 Update, 원본 선삭제와 순차 생성은 금지한다.
7. `Conflict(VERSION_MISMATCH)`면 form과 분할 초안을 그대로 유지하고 최신 거래가 다른 곳에서 변경됐음을 표시한다. 사용자의 확인 없이 최신값과 자동 병합하거나 같은 payload를 새 version으로 재시도하지 않는다. 최신 대상이 active인 단순 수정이면 재확인 뒤 새 draft를 만들 수 있고, `superseded`·`deleted`면 제출을 비활성화하고 최신 파생 거래나 목록으로 이동한다.

### 5.7 `OpenQuickEdit`·FIFO 조정

1. 결제 수집의 서버 저장 성공 event에서 QuickEdit 설정·overlay capability와 현재 `SessionMirror`를 확인한다. 저장 실패 거래는 대기열에 넣지 않는다.
2. `QuickEditPendingQueuePort.enqueueIfAbsent`가 session scope와 transaction ID 중복을 제거하고 원자적으로 고유 sequence를 발급한다. 대기열에는 표시 snapshot을 저장하지 않는다.
3. 활성 QuickEdit lease가 없으면 가장 낮은 sequence의 항목을 선택하고, 있으면 현재 Activity를 유지한 채 `Queued`를 반환한다.
4. 표시 직전 `LedgerTransactionQueryClient`로 최신 snapshot을 읽고 현재 Actor의 household·member 권한과 편집 가능 상태를 검증한다. 삭제됨·접근 불가·편집 불가 항목은 해당 head만 `Skipped`로 완료하고 다음 항목을 평가한다.
5. 저장·삭제·분할 Command가 `Success` 또는 같은 요청의 `AlreadyProcessed`이면 head를 완료하고 Activity를 닫은 뒤 다음 항목을 연다. 명시적 닫기도 head를 완료한다.
6. `Conflict`, 네트워크·서버 실패, 알 수 없는 결과에서는 head와 Activity를 유지한다. 최신 snapshot 재조회 또는 재시도 전에는 다음 항목을 열지 않는다.
7. process 재시작·Activity 재생성 시 대기열에서 가장 오래된 미완료 항목을 복구한다. 동시에 둘 이상의 Activity가 열리지 않도록 process-local coordinator와 영속 active entry를 함께 조정한다.
8. 로그아웃·가구·멤버 전환은 이전 scope의 FIFO 삭제가 성공한 뒤에만 새 SessionMirror를 commit한다. 새 session에서 이전 transaction ID를 복구하지 않는다.

## 6. Port 설계

| Port | 방향 | Adapter | 테스트 대역 |
|---|---|---|---|
| `PermissionStatePort` | out | Android Settings/NotificationManager | 조합 가능한 Fake |
| `NotificationPermissionRequester` | out | Android runtime permission contract | API level·허용·거부 Fake |
| `SystemSettingsNavigator` | out | Android Intent | action Spy |
| `StartUrlPolicy` | 내부 Policy | BuildConfig-backed policy | 고정 environment |
| `WebViewPort` | out | Android WebView | navigation Fake |
| `AllowedWebOriginPolicy` | 내부 Policy | allowlist config | table fixture |
| `SessionMirrorStore` | out | 보호된 local storage | in-memory conformance Fake |
| `SessionTransitionPort` | out | session 범위 Payment·QuickEdit Queue purge coordinator | Queue별 성공·실패 Spy |
| `NativeGoogleAuthPort` | out | Credential Manager + Firebase Auth | 인증 성공·취소·실패 Fake |
| `WebViewSessionExchangePort` | out | 서버 일회성 session exchange API | 만료·재사용·origin Stub |
| `QuickEditPreferencePort` | out | local preferences | Fake |
| `QuickEditPendingQueuePort` | out | Keystore-backed encrypted local queue | ordering·dedup·crash conformance Fake |
| `QuickEditActivityCoordinator` | out | Android Activity launcher·active lease | 단일 활성 Spy |
| `LedgerCommandClient` | out | generated Functions API client | typed result Stub |
| `LedgerTransactionQueryClient` | out | generated Ledger Query client | current snapshot·stale Stub |
| `CategoryQueryClient` | out | generated Query client | category fixture |
| `HostEventSink` | out | lifecycle/Activity result | Spy |
| `SecurityTelemetryPort` | out | redacting logger/metrics | redaction Spy |
| `BackupPolicyVerifier` | build/security conformance | Manifest·data extraction rules 검사 | backup fixture |

## 7. 저장·트랜잭션·동시성

- Host 설정과 session mirror는 서로 다른 namespace로 저장한다. mirror에는 schema version과 updatedAt을 둔다.
- session mirror 변경은 원자적 local-store edit으로 적용한다. Membership 갱신 도중 household/member가 서로 다른 세대가 되면 안 된다.
- actor 전환과 로그아웃은 `SessionTransitionPort`의 이전 actor Queue 삭제가 성공한 뒤 진행한다. 삭제 실패 시 이전 mirror를 유지하고 새 actor observation을 수집하지 않는다.
- Payment Capture 전송 Queue와 QuickEdit FIFO는 책임과 schema가 다른 저장소로 분리한다. 같은 Keystore crypto 기반 구현은 재사용할 수 있지만 한 Queue의 완료·삭제가 다른 Queue 항목을 변경하면 안 된다.
- QuickEdit FIFO의 enqueue, 중복 확인, sequence 발급과 head 완료는 각각 원자적으로 처리한다. active entry는 하나뿐이며 process 재시작 뒤에도 가장 낮은 미완료 sequence가 head다.
- 로그아웃하면 householdId·memberId와 legacy householdKey·partnerName을 같은 clear operation으로 제거한다. QuickEdit 같은 기기 설정은 인증 mirror와 분리하여 유지하되 `(householdId, memberId)`로 식별하고 표시 이름을 key로 사용하지 않는다.
- 기존 Web localStorage의 householdKey·currentMemberId·currentMemberName은 Google 로그인 전에 메모리의 `LegacySessionCandidate`로 먼저 포착한다. householdKey와 currentMemberId가 모두 있는 Web 후보만 사용하고 Native SharedPreferences는 신원 복구 근거로 쓰지 않는다. 전환 성공 전에는 지우지 않고, 성공 뒤에는 Native·Web의 legacy 로그인 값을 함께 제거한다.
- backup과 device transfer는 기본 거부한다. Manifest의 `allowBackup`, Android 12+ `dataExtractionRules`, 구형 `fullBackupContent`를 함께 검증하고, 인증·SessionMirror·legacy identity·WebView cookies/storage·Keystore Queue ciphertext/metadata는 어떤 복원 경로에도 포함하지 않는다. 비민감 QuickEdit preference만 명시적 allowlist 후보입니다.
- QuickEdit은 Domain 컬렉션을 직접 쓰지 않는다. 서버 Ledger transaction이 version, receipt, canonical write, outbox를 함께 commit한다.
- UI 재생성·네트워크 재시도에도 같은 사용자 제출은 같은 idempotency key를 유지한다. 새 편집은 새 key를 사용한다.
- `SavedStateHandle`에는 민감 원문을 넣지 않고 transaction ID와 최소 표시 상태만 저장한다.

## 8. Event·Projection·외부 연동

- 결제 수집 성공은 `OpenQuickEdit(transactionId, snapshot)`이라는 프로세스 내부 Client event로 전달한다. 영속 Integration Event가 아니다.
- 위 Client event는 QuickEdit FIFO에 멱등 등록하기 위한 신호일 뿐 거래 생성의 receipt나 재시도 근거가 아니다. 대기열 복구 시 표시 snapshot은 Ledger에서 다시 읽는다.
- QuickEdit 거래 변경은 Ledger가 발행한 `TransactionChanged.v1` 등을 통해 다른 모듈에 전달된다. Android Host는 Outbox를 쓰지 않는다.
- `HouseholdNotificationRequested.v1`의 유일 producer는 Ledger이고 Notifications는 이를 소비한다. Host는 Ledger Command만 호출하며 Event를 직접 만들지 않는다.
- foreground FCM은 Notifications의 versioned payload를 Android Adapter가 표시한다. 알 수 없는 version은 `ContractFailure` telemetry 후 버린다.

## 9. 오류·보안·관측성

- Bridge API는 허용 origin, top-level frame, contract version을 모두 검증한다.
- 가구 key·householdId 원문, member 이름, FCM FID·registration token, 인증 token, 알림 원문, 거래 memo를 일반 로그·crash breadcrumb·analytics에 기록하지 않는다. 식별자는 목적별 salt의 correlation용 비가역 hash만 허용하고 redaction test를 통과해야 한다.
- `SensitiveOverlayPolicy`는 DEC-024에 따라 QuickEdit 조건 충족 시 화면 켜기와 잠금 화면 위 편집 정보 표시를 허용한다. keyguard 해제 API는 금지하고 Activity non-exported·유효 거래 ID·현재 session 조건을 함께 강제한다.
- WebView의 파일 접근, cleartext traffic, 임의 popup과 외부 scheme은 기본 차단하고 명시적 navigation policy만 허용한다.
- 관측 event: `host_gate_evaluated`, `bridge_rejected`, `mirror_sync_failed`, `quick_edit_command_failed`; 오류 code와 app/contract version만 기록한다.
- 서버 `Unauthenticated/Forbidden`을 로컬 성공으로 바꾸지 않으며 session 재연결 상태를 표시한다.

## 10. 목표 패키지 구조

```text
android/app/src/main/java/com/household/account/
  feature/web-shell/
    application/HostController.kt
    ports/PermissionStatePort.kt
    adapters/webview/SecureWebViewAdapter.kt
    adapters/bridge/SecureBridgeAdapter.kt
  feature/google-auth/
    application/NativeGoogleSignInController.kt
    ports/NativeGoogleAuthPort.kt
    ports/WebViewSessionExchangePort.kt
    adapters/firebase/FirebaseGoogleAuthAdapter.kt
  feature/quick-edit/
    application/QuickEditController.kt
    application/QuickEditQueueCoordinator.kt
    model/QuickEditForm.kt
    model/QuickEditQueueEntry.kt
    ports/QuickEditPendingQueuePort.kt
    policy/SplitDraftPolicy.kt
    adapters/ui/QuickEditActivity.kt
  core/auth-session/
    SessionMirrorStore.kt
    LegacySessionCandidate.kt
  core/contracts/generated/
  composition/AppContainer.kt
```

Activity는 화면 event를 Input Port에 전달하고 상태를 render만 한다. `LedgerCommandClient` 구현과 local store 구현은 Composition Root에서 주입한다.

## 11. 테스트 설계

| 요구사항 ID | 수준 | 테스트 대상 | 핵심 fixture·경계값 | 관찰 결과 | Canonical 테스트 ID |
|---|---|---|---|---|---|
| AND-001 | UI, E2E | Host Gate | 권한 조합, QuickEdit on/off | 올바른 guide 또는 Web Shell | `T-ANDROID-HOST-001` |
| AND-002 | U, UI | Permission Adapter | 유사 문자열 component와 정확한 component | 오탐 없이 상태·설정 action 반환 | `T-ANDROID-HOST-001` |
| AND-003 | UI, Build Conformance | Web Shell·EnvironmentConfig | fresh/saved URL, prod/dev build, URL-origin 설정 불일치 | 같은 versioned 설정의 허용 HTTPS URL만 1회 load, 오설정 빌드 실패 | `T-WEBVIEW-002` |
| AND-004 | U, UI | Back Controller | guide, canGoBack true/false | history 또는 Activity 위임 | `T-WEBVIEW-003` |
| AND-005 | U, C, 보안 UI, E2E | Native Google Auth·Principal-bound Membership receipt·일회성 Session Exchange·Legacy Candidate | 인증 성공·취소·실패, Principal 불일치·caller ID 조작, handle 최대 5분·만료·재사용·다른 origin, legacy 후보 있음·없음, Membership 확정·로그아웃 | caller 값이 아닌 서버 receipt의 동일 Principal session, Google credential 비노출, 기존 householdId·memberId 유지, mirror 원자 sync·clear | T-HH-001, T-HH-002, T-WEBVIEW-001 |
| AND-006 | 보안 UI, E2E | Secure Bridge | 허용 origin, redirect, subframe, 유사 host | 민감 operation 차단 | T-WEBVIEW-001 |
| AND-007 | U, UI | Version Presenter | 정상 versionName, package 조회 실패 | 계약 문자열 또는 unknown | `T-ANDROID-VERSION-001` |
| AND-008 | U, 보안 E2E | Redacting logger | 가구·멤버·FID·token·원문·memo가 포함된 성공/실패 | 원문 0건, 허용된 hash·오류 code만 기록 | T-ANDROID-LOG-001 |
| AND-009 | Build Conformance, 보안 E2E | BackupPolicyVerifier | cloud backup·device transfer·새 설치 restore | actor·credential·legacy·WebView 민감 상태·Queue 복원 없음 | T-ANDROID-BACKUP-001 |
| AND-010 | UI, E2E | Permission Adapter | API 32/33, 허용·거부·재요청 불가 | 33+만 요청, 거부와 앱 진입·수집·QuickEdit·FID 독립 | T-ANDROID-NOTIFICATION-PERMISSION-001 |
| AND-011 | U, I, 보안 E2E | KeystoreSessionMirrorStore·SessionTransitionPort·PreferencePort | actor 변경, Queue purge 실패, purge 뒤 process 중단, 이름 변경, legacy preference 반복 이관, key export·backup 시도 | 암호화 원자 snapshot, 중단 복구는 fail-closed, 실패 시 이전 actor 유지, stable memberId 설정 1회 이관·유지, key 비복원 | T-SESSION-MIRROR-001 |
| QE-001 | U, UI | OpenQuickEdit | 저장 성공/실패, preference, overlay | 조건 충족 때만 open | `T-QE-006` |
| QE-002 | U, I | Edit Controller | 양수 금액, 빈 memo, server failure | typed payload와 성공 후 반영 | T-QE-002 |
| QE-003 | U, I, UI | Household Notification Request | 인증 Actor 있음/없음, client requester·시각 위조, creator와 requester 동일·상이, 다른 가구원 0·1·여러 명, 미저장 입력 | requester·시각은 인증 세션·서버 clock에서만 만들고 requester 외 전원 대상, 거짓 성공·미저장 form 반영 없음 | T-QE-002 |
| QE-004 | I, UI | Delete Controller | 확인 snapshot, 실패, conflict | 성공 전 종료·Toast 없음 | T-QE-002 |
| QE-005 | U, UI | SplitDraft Policy | 2개/3개, 0·불일치 합계 | 유효 제출만 활성화 | T-QE-001 |
| QE-006 | I, Emulator | Ledger Client 계약 | callback 재실행, 첫 파생 write 뒤 중간 실패, 같은 idempotency key replay | active 원본·파생 0건 또는 superseded 원본·전체 파생만 존재하고 완료 효과 중복 없음 | T-QE-002 |
| QE-007 | U, UI | SplitDraft Policy | 2항목 변경, 3항목 변경·삭제 | 요구된 자동 조정만 수행 | T-QE-001 |
| QE-008 | UI, E2E | Intent Mapper·Sensitive Overlay | 누락 ID/필드, 잠금 상태, QuickEdit on/off, 외부 Intent | ID 없음 Command 차단, 설정 on일 때만 잠금 위 표시·화면 켜기, keyguard 유지·외부 진입 차단 | `T-QE-005` |
| QE-009 | U, UI, E2E | QuickEditPresentationPolicy·PendingQueue·ActivityCoordinator | A 표시 중 B·C 도착, 같은 ID 중복, 같은 시각 sequence, process 재시작, A 성공·실패·닫기, stale·권한 철회·편집 불가·다른 session | A 유지, 중복 없는 A→B→C, 실패 시 A 유지, 무효 head만 민감 화면 없이 skip, 이전 session 미표시 | T-QE-003 |
| QE-010 | U, UI, I | SplitDraftSourcePolicy·Split Controller | 미저장 전체 form, 현재 금액 기준 항목, 제출 직전 다른 actor의 Update·Split, active 대상 사용자 재확인 | 한 immutable draft를 단일 Command로 제출, provenance 비노출, stale 요청 write 0건·초안 유지, active만 최신 version의 새 draft로 명시 재제출 | T-QE-004 |
| QE-011 | 보안 UI, E2E | SensitiveOverlayPolicy | 잠금·최근 앱·screen capture·외부 Intent·log sink | Window에 `FLAG_SECURE` 없음, 별도 최근 앱 마스킹 없음, 캡처 허용, keyguard·export·앱 로그 보호 유지 | T-QE-005 |

추가 공통 suite:

- 생성 Kotlin DTO와 TypeScript schema의 양방향 JSON contract test
- `SessionMirrorStore` Fake/실제 Adapter conformance test
- Native Firebase Principal과 WebView에서 복원한 Principal이 일치하는지 검증하는 session exchange contract test
- 기존 localStorage 후보를 포착한 뒤 Google UID를 같은 householdId·memberId에 연결하고, 성공 후에만 legacy 값을 제거하는 Android-Web E2E
- household/member 전환 직전 Queue purge와 mirror commit 사이에 process를 중단해도 혼합 identity가 관찰되지 않는 crash-recovery test
- Android backup/restore 설정의 Manifest merge 결과와 실제 복원 제외 경로를 함께 확인하는 build·device conformance test
- redacting logger의 모든 sink(logcat, crash breadcrumb, analytics)에 같은 민감값 fixture를 적용하는 contract test
- Activity 재생성과 같은 idempotency key 재사용 test
- 가구 A session으로 가구 B transaction을 변경할 때 `Forbidden`을 표시하는 E2E

## 12. 확정 사항과 구현 순서

Human in the loop 항목은 한 목록에서 관리합니다.

QuickEdit 표시 순서와 미저장 form 분할 원천은 각각 DEC-054·DEC-055로 확정되었습니다. Android Host에 남은 별도 Human in the loop 항목은 없습니다.

WebView URL·허용 origin은 동일한 versioned 빌드 설정에서 읽고, SessionMirror는 Android Keystore 기반으로 암호화합니다. 둘은 제품 결과를 바꾸지 않는 보안·배포 설계이므로 별도 결정을 기다리지 않습니다.

구현 순서:

1. 기존 Activity/Bridge/QuickEdit Characterization test를 먼저 고정한다.
2. Port와 Controller를 추출하고 기존 구현을 Legacy Adapter로 연결한다.
3. origin 제한과 로그 redaction을 우선 교정한다.
4. Firestore 직접 Repository를 generated Ledger/Category client로 교체한다.
5. QuickEdit 분할을 서버 원자 Command로 전환한 뒤 legacy writer를 제거한다.
