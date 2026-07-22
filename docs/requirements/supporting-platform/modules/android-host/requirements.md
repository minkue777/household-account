# Android Host·WebView·QuickEdit 모듈 요구사항

> 상위 Bounded Context: 없음 — [지원·읽기·플랫폼 영역](../../requirements.md)  
> 아키텍처 역할: Android Delivery / Platform Shell  
> 상세 설계: [모듈 상세 설계](design.md)  
> 상태와 테스트 수준 표기는 [공통 문서 규칙](../../../governance/conventions.md)을 따릅니다.

## 1. 독립 모듈 책임

이 모듈은 Android 앱 프로세스의 UI shell을 소유합니다. OS 권한 안내, WebView 수명주기, 허용된 Web origin과 Native 기능 사이의 bridge, 자동 등록 직후의 QuickEdit 화면을 담당합니다. 금융 알림 해석, 거래 업무 규칙, FCM 대상 계산은 별도 모듈에 둡니다.

## 2. 포함·제외 범위

포함 범위:

- 알림 접근·오버레이·알림 표시 권한 상태 확인과 시스템 설정 이동
- WebView 초기화, 고정/환경별 시작 URL, navigation과 뒤로가기
- Android Credential Manager 기반 Google 로그인과 WebView의 제한된 인증 세션 교환
- 허용 origin에 한정된 JavaScript bridge
- Web localStorage와 Native host 설정의 동기화
- 전환용 가구 키·현재 멤버, QuickEdit 설정·앱 버전의 Native API
- 저장된 지출을 편집·삭제·분할하고 다른 가구원에게 명시적 알림을 요청하는 QuickEdit UI

제외 범위:

- 시스템 알림의 공급자 선택과 결제 parser
- 거래 생성·분할·삭제의 업무 규칙과 원자성 구현
- 카테고리·가구·멤버 aggregate 소유권
- FCM FID registry, 대상 계산, 서버 전송
- PWA cache·messaging worker 수명주기

## 3. 소유 데이터

| 데이터 | 이 모듈의 권한 | 비고 |
|---|---|---|
| Android host 설정 | 소유 | 시작 URL 환경, QuickEdit 활성화, UI 권한 상태를 포함합니다. |
| Native 가구·멤버 mirror | 비권위 cache | Web의 권위 상태를 Android 입력 모듈에 전달하기 위한 local mirror입니다. |
| 앱 버전·WebView navigation 상태 | 소유 | Host UI에 한정됩니다. |
| `expenses` | 비소유 Writer | QuickEdit은 거래 원장 명령 포트만 사용합니다. |
| `categories` | 비소유 Reader | 활성 카테고리 조회 포트를 사용합니다. |

현재 `SharedPreferences`의 가구 키는 권위 있는 인증 정보로 사용하면 안 되며, 민감 데이터의 저장 보호와 삭제 범위는 별도 보안 계약으로 다룹니다.

## 4. 공개 계약·의존 모듈

JavaScript bridge의 목표 공개 계약은 서버가 발급한 Principal-bound Membership receipt를 사용한 SessionMirror 동기화, QuickEdit 설정, 앱 버전 조회입니다. 모든 민감 API는 허용된 Web origin에서만 노출되고, SessionMirror 동기화는 origin 확인과 별개로 Membership receipt를 검증·소비해야 하며 값의 부재·실패를 명시적으로 표현해야 합니다. 기존 가구 key·자기 멤버 값은 Google 로그인 전에 Web localStorage에서 일회성 `LegacySessionCandidate`로 포착하는 전환 전용 Adapter 입력일 뿐 범용 JavaScript Bridge API가 아닙니다. legacy partner API도 목표 계약에 포함하지 않습니다.

QuickEdit의 입력은 저장 완료된 거래 ID와 표시용 snapshot입니다. 저장·삭제·분할·가구원 알림 요청은 client 검증 뒤 암호화 command outbox에 접수하며, 로컬 접수와 서버 업무 성공을 별도 결과로 다룹니다. 서버 성공이 확인되기 전 업무 완료 event나 성공 Toast를 내보내면 안 됩니다.

의존 모듈:

- [Android 결제 알림 수집](../../../contexts/payment-capture/modules/android-payment-ingestion/requirements.md): 저장 성공한 거래 ID와 표시 snapshot 제공
- [거래 원장](../../../contexts/household-finance/modules/ledger/requirements.md): 편집·삭제·원자적 분할·가구원 알림 요청 명령
- [카테고리·예산](../../../contexts/household-finance/modules/categories-budget/requirements.md): 활성 카테고리 조회
- [가구·접근](../../../contexts/access-household/modules/household-access/requirements.md): Web의 가구·멤버 선택 상태
- [푸시 알림](../../../contexts/notifications/modules/notifications/requirements.md): Android FID 등록 callback과 foreground 표시
- [PWA](../pwa/requirements.md): WebView에서 제공하는 Web application

## 5. 요구사항

### 5.1 권한과 WebView

| ID | 상태 | 요구사항 | 경계·예외 | 근거 | 테스트 |
|---|---|---|---|---|---|
| AND-001 | 현재 명세 | 앱 생성·resume 시 알림 접근과 다른 앱 위 표시 권한을 검사하고 둘 다 있을 때 WebView를 표시한다. | 최초 권한 화면에서 두 권한을 필수로 받는 것은 의도한 정책이다. 진입 후 QuickEdit 표시 여부는 별도 설정으로 끌 수 있다. | [MainActivity](../../../../../android/app/src/main/java/com/household/account/MainActivity.kt), [DEC-004](../../../governance/decisions.md#dec-004) | UI, E2E |
| AND-002 | 현재 명세 | 권한 버튼은 해당 시스템 설정을 열고 허용된 권한을 체크 상태로 표시한다. | 알림 접근을 문자열 contains로 확인하는 것은 결함이다. | 같은 근거 | UI |
| AND-003 | 결함 | WebView 시작 URL과 허용 origin은 같은 versioned 환경 설정에서 읽고, 현재 빌드 환경에 허용된 HTTPS URL을 최초 한 번만 load한다. | 저장된 navigation이 있으면 중복 load하지 않는다. 현재 production URL 하드코딩과 별도 origin 목록은 환경 오접속을 막지 못하므로 목표 동작이 아니다. URL·origin 값은 배포 설정이며 제품 정책 결정 대상이 아니다. | 같은 근거와 [REL-002](../delivery-assurance/requirements.md#5-요구사항) | UI, Build Conformance |
| AND-004 | 현재 명세 | WebView 뒤로가기가 가능하면 history로 이동하고 아니면 Activity 기본 동작을 사용한다. | 권한 화면에서는 WebView 뒤로가기를 쓰지 않는다. | 같은 근거 | UI |
| AND-005 | 목표 명세 | Android 앱은 Credential Manager와 Firebase Auth Native SDK로 Google 로그인하고, Web Auth가 없는 최초 설치·로그아웃 뒤 로그인에서 서버의 짧고 일회성 custom-token 계약으로 동일 Principal을 WebView에 전달한다. 최초 교환에 성공한 WebView는 Firebase Auth local persistence와 같은 UID의 마지막 검증 Membership·가구 화면 cache를 보존한다. 다음 앱 실행에는 Web Auth를 즉시 재사용하고 반복적인 Native session exchange를 생략하며 Firebase SDK token refresh와 서버 read로 수렴한다. Native SessionMirror 확인은 첫 화면 이후 idle 시간에 같은 binding 기준 최대 하루 한 번 수행한다. | local Membership·가구 snapshot은 화면 선표시 hint일 뿐 권한 증거가 아니며 Firestore Rules와 Functions가 실제 read/write를 검증한다. 평문 localStorage에 가구명·가구원명이 남는 위험은 소수의 신뢰된 사용자 환경에서 허용하는 성능 절충이다. UID·가구·멤버가 달라지거나 first visit·권한·authoritative household 부재가 확인되면 cache와 SessionScope를 폐기한다. 로그아웃은 Native/Web 인증과 local cache를 제거한다. | [AndroidHostBridge](../../../../../android/app/src/main/java/com/household/account/webhost/AndroidHostBridge.kt), [Web Auth Adapter](../../../../../web/src/lib/authService.ts), [Membership cache](../../../../../web/src/features/access-household/application/signedInMembershipCache.ts), [HouseholdContext](../../../../../web/src/contexts/HouseholdContext.tsx), [HouseholdPreferences](../../../../../android/app/src/main/java/com/household/account/util/HouseholdPreferences.kt), [Firebase Android Google 로그인](https://firebase.google.com/docs/auth/android/google-signin), [DEC-021](../../../governance/decisions.md#dec-021), [DEC-022](../../../governance/decisions.md#dec-022) | U, C, 보안 UI, E2E |
| AND-006 | 결함 | JavaScript bridge는 허용된 origin에서만 노출되어야 한다. | 현재 다른 origin으로 이동해도 가구 키 API가 노출된다. | [MainActivity](../../../../../android/app/src/main/java/com/household/account/MainActivity.kt) | 보안 UI, E2E |
| AND-007 | 현재 명세 | 앱 버전은 현재 앱 버전 뒤에 versionName을 붙여 표시하고 실패 시 알 수 없음을 사용한다. | 표시 문자열은 Web과 계약으로 관리한다. | [AndroidHostBridge](../../../../../android/app/src/main/java/com/household/account/webhost/AndroidHostBridge.kt) | UI |
| AND-008 | 목표 명세 | Android 일반 로그·crash breadcrumb·analytics에는 가구 key·householdId 원문, 멤버 이름, FID·registration token, 인증 token, 알림 원문, 거래 memo를 기록하지 않는다. | 상관관계가 필요하면 목적별 salt를 사용한 비가역 hash와 안정 오류 code만 기록한다. 현재 Bridge와 FCM callback이 가구 key·token 원문을 로그에 남기는 것은 결함이다. | [AndroidHostBridge](../../../../../android/app/src/main/java/com/household/account/webhost/AndroidHostBridge.kt), [FcmService](../../../../../android/app/src/main/java/com/household/account/service/FcmService.kt), [FID endpoint manager](../../../../../android/app/src/main/java/com/household/account/util/FidEndpointManager.kt) | U, 보안 E2E |
| AND-009 | 목표 명세 | 인증 상태, SessionMirror, legacy 가구 key, WebView의 민감 저장소, 암호화 결제 Queue와 그 metadata는 Android cloud backup·기기 간 이전에서 기본 거부한다. | 비민감 QuickEdit 표시 설정처럼 복원 가치가 확인된 항목만 명시적 allowlist로 허용한다. 현재 `allowBackup=true`이고 제외 규칙이 없는 상태는 결함이다. | [Android Manifest](../../../../../android/app/src/main/AndroidManifest.xml), [HouseholdPreferences](../../../../../android/app/src/main/java/com/household/account/util/HouseholdPreferences.kt), [DEC-032](../../../governance/decisions.md#dec-032) | 보안 E2E |
| AND-010 | 목표 명세 | Android 13(API 33) 이상에서는 시스템 알림 표시가 필요한 시점에 `POST_NOTIFICATIONS` 런타임 권한을 요청하고 허용·거부 상태를 별도 capability로 표시한다. | 거부해도 WebView 진입, 알림 접근 기반 결제 수집, QuickEdit, FID endpoint 등록을 막지 않는다. API 32 이하는 런타임 요청하지 않으며 거부 사용자를 반복 강제하지 않는다. | [Android Manifest](../../../../../android/app/src/main/AndroidManifest.xml), [MainActivity](../../../../../android/app/src/main/java/com/household/account/MainActivity.kt), [PUSH-001·007](../../../contexts/notifications/modules/notifications/requirements.md#5-요구사항) | UI, E2E |
| AND-011 | 목표 명세 | SessionMirror는 schemaVersion·householdId·안정적인 memberId를 Android Keystore 기반 암호화 저장소의 한 snapshot으로 원자 교체·삭제하고 QuickEdit 기기 설정도 표시 이름이 아닌 householdId·memberId로 식별한다. | actor가 바뀌면 기존 actor의 암호화 Queue 삭제가 성공한 뒤 mirror를 교체한다. purge 뒤 commit 전 process 중단은 재시작 시 mirror를 비워 fail-closed로 복구한다. legacy 표시 이름 설정은 stable ID key로 한 번만 이관한다. 이름 변경은 같은 설정을 유지하며, household와 member가 서로 다른 세대인 중간 상태를 관찰할 수 없어야 한다. 암호화 key는 export·backup하지 않는다. | [MainActivity](../../../../../android/app/src/main/java/com/household/account/MainActivity.kt), [HouseholdPreferences](../../../../../android/app/src/main/java/com/household/account/util/HouseholdPreferences.kt), [ING-008](../../../contexts/payment-capture/modules/android-payment-ingestion/requirements.md#51-수집출처-선택중복-처리), [DEC-032](../../../governance/decisions.md#dec-032) | U, I, 보안 E2E |
| AND-012 | 현재 명세 | Android WebView는 single-tab, 일반 브라우저와 PWA는 multiple-tab IndexedDB `persistentLocalCache`를 사용한다. 동일 Firebase UID의 검증 Membership·가구 localStorage snapshot이 있으면 IndexedDB와 Native 세션 재교환보다 먼저 화면을 표시하고 서버 결과로 갱신한다. 사용자 데이터가 없는 정적 navigation shell은 Service Worker가 최대 7일 `StaleWhileRevalidate`로 보존한다. 월 원장·자산 snapshot은 같은 로그인 세대와 조회 key에서 메모리에 유지하며, 자산 read model은 인증 직후 idle 시간에 미리 구독한다. | localStorage에는 빠른 shell에 필요한 가구명·가구원·화면 설정만 저장하고 거래·자산 금액은 Firestore cache에 둔다. cached HTML은 즉시 표시하고 최신 배포본은 백그라운드 갱신한다. retained snapshot과 local cache는 로그아웃·가구/멤버 전환 때 폐기한다. 서버가 authoritative household 부재·permission·계약·불변식 오류를 반환하면 cache 화면을 유지하지 않는다. 숨겨진 모달·차트·검색 UI 코드는 최초 bundle의 선행 조건으로 내려받지 않는다. | [Web Auth Adapter](../../../../../web/src/lib/authService.ts), [Firestore 초기화](../../../../../web/src/lib/firebase.ts), [Optimistic read projection](../../../../../web/src/platform/read-model/optimisticEntityProjection.ts), [가구 cache-first 조회](../../../../../web/src/lib/householdService.ts), [AppProviders](../../../../../web/src/components/AppProviders.tsx), [HouseholdContext](../../../../../web/src/contexts/HouseholdContext.tsx) | U, WebView E2E |
| AND-013 | 목표 명세 | Android 로그아웃은 네트워크보다 먼저 `FcmService` component를 비활성화하고 이미 표시된 앱 알림을 취소한 뒤, 로컬 억제 상태 저장·서버 endpoint 삭제·Firebase Messaging unregister를 유한 시간 best-effort로 수행한다. | component 차단이나 preference 저장이 실패해도 나머지 정리를 시도하고, 원격 삭제·unregister 실패 또는 timeout은 로그아웃을 막지 않는다. 로컬 session 없이 process가 시작되면 component를 차단하며, 재로그인은 stale unregister가 필요하면 이를 먼저 수행하고 component 활성화·등록을 시작한다. 서버가 현재 household/member binding을 확인하기 전 foreground payload는 표시하지 않고 등록 실패는 다시 component를 차단한다. | [FID endpoint manager](../../../../../android/app/src/main/java/com/household/account/util/FidEndpointManager.kt), [FCM component gate](../../../../../android/app/src/main/java/com/household/account/notifications/FcmServiceComponentGate.kt), [FCM 수신](../../../../../android/app/src/main/java/com/household/account/service/FcmService.kt), [DEC-020](../../../governance/decisions.md#dec-020) | U, I, 보안 E2E |

### 5.2 QuickEdit

| ID | 상태 | 요구사항 | 경계·예외 | 근거 | 테스트 |
|---|---|---|---|---|---|
| QE-001 | 현재 명세 | 자동 지출 저장 후 사용자별 설정이 켜져 있고 오버레이 권한이 있으면 QuickEdit을 연다. | 기본 설정은 true이다. | [알림 수집 Service](../../../../../android/app/src/main/java/com/household/account/service/CardNotificationListenerService.kt), [HouseholdPreferences](../../../../../android/app/src/main/java/com/household/account/util/HouseholdPreferences.kt) | UI, E2E |
| QE-002 | 현재 명세 | QuickEdit은 지출 ID와 표시 필드를 받아 가맹점, 양의 정수 금액, 카테고리, 메모를 편집하고 원본과 실제로 다른 필드만 Update patch에 포함한다. | 빈 memo는 기존 memo를 지우는 명시적 변경이다. 변경 필드가 없으면 서버 Command를 만들지 않는다. | [QuickEditActivity](../../../../../android/app/src/main/java/com/household/account/QuickEditActivity.kt) | U, UI, I |
| QE-003 | 목표 명세 | 인증된 현재 멤버가 `알림 보내기`를 실행하면 해당 지출에 요청 시각과 안정적인 requesterMemberId를 기록한다. | 현재 편집 중인 미저장 값은 저장하지 않는다. 요청자가 없으면 실패로 처리하며, Notifications는 단일 partner 없이 요청자를 제외한 활성 가구원 모두에게 알린다. | 같은 근거와 [DEC-013](../../../governance/decisions.md#dec-013), [DEC-022](../../../governance/decisions.md#dec-022) | U, UI, I |
| QE-004 | 현재 명세 | 삭제는 원 가맹점·금액 확인 후 문서를 삭제한다. | 실패를 성공 Toast로 표시하면 안 된다. | 같은 근거 | UI, I |
| QE-005 | 현재 명세 | 나누기는 최소 두 양수 항목이며 합계가 원금과 같을 때만 확정한다. | 첫 두 항목은 몫과 나머지로 초기화한다. | 같은 근거 | U, UI |
| QE-006 | 결함 | QuickEdit 분할은 원본을 같은 ID의 `superseded` 상태로 보존하고 모든 파생 거래를 생성하는 한 원자적 변경이어야 하며 원본의 카드·유형·분할 메타데이터 보존 정책을 따라야 한다. | 원본을 물리 삭제하지 않는다. 현재 원본 선삭제·순차 생성·필드 유실은 목표 동작이 아니며, 중간 실패에서는 원본 active 상태와 파생 0건 또는 완료된 전체 분할 중 하나만 관찰되어야 한다. | [QuickEdit](../../../../../android/app/src/main/java/com/household/account/QuickEditActivity.kt), [원장 Command Client](../../../../../android/app/src/main/java/com/household/account/ledger/HouseholdCommandClient.kt) | I |
| QE-007 | 특성화 | 두 분할 항목 중 하나의 금액을 바꾸면 다른 하나를 max(0, 원금-입력값)으로 자동 조정한다. | 세 항목 이상에서는 자동 조정하지 않고, 새 항목은 현재 미배분 잔액으로 시작하며 두 항목 아래로 삭제할 수 없다. | [QuickEdit](../../../../../android/app/src/main/java/com/household/account/QuickEditActivity.kt) | U, UI |
| QE-008 | 현재 명세 | QuickEdit Intent의 누락값은 빈 문자열·금액 0·카테고리 etc이며 ID가 없으면 저장·삭제·분할 작업을 끝낸다. QuickEdit 조건이 충족되면 화면을 켜고 잠금 화면 위에 가맹점·금액·카테고리·메모 편집 화면을 표시한다. | 팝업은 외부 터치로 닫히지 않는다. keyguard를 해제·우회하지 않고 Activity는 외부에 export하지 않으며 QuickEdit 설정이 꺼져 있으면 잠금 화면 표시도 실행하지 않는다. | 같은 근거와 [DEC-024](../../../governance/decisions.md#dec-024) | UI, E2E |
| QE-009 | 목표 명세 | 여러 자동 등록 거래가 연속 도착하면 QuickEdit은 현재 거래 하나만 유지하고 후속 거래를 저장 완료 순서의 내구성 있는 FIFO로 보존하며, 현재 거래가 명시적으로 닫히거나 command outbox commit과 WorkManager 영속 예약이 완료된 뒤 다음 거래를 표시한다. | 거래 저장, 표시 FIFO, command outbox는 독립적이다. 표시 대기열에는 session scope·거래 ID·고유 sequence만 저장하고 process 재시작에도 복구한다. Capture 재전송 Queue의 72시간 TTL을 표시 FIFO에는 적용하지 않는다. outbox 쓰기·예약 실패에서는 진행하지 않으며 표시 직전 최신 거래와 actor 권한을 검증하고, 로그아웃·가구·멤버 전환 시 이전 scope의 두 QuickEdit 저장소를 제거한다. | 같은 근거와 [DEC-054](../../../governance/decisions.md#dec-054), [DEC-067](../../../governance/decisions.md#dec-067) | U, UI, E2E |
| QE-010 | 목표 명세 | QuickEdit의 미저장 편집 상태에서 분할을 누르면 현재 화면의 가맹점·금액·카테고리·memo 전체를 immutable 분할 초안으로 고정하고 한 번의 원자적 Split Command로 제출한다. | 분할 합계는 현재 form 금액을 기준으로 한다. 카드·출처·creator·capture lineage는 client form에서 받지 않고 서버 원본에서 보존한다. 다른 변경으로 expectedVersion이 달라졌으면 전체 Conflict로 거부하고 암호화 outbox 초안을 실패 알림 전달 전까지 `needs-attention`으로 유지하며 자동 덮어쓰기·자동 병합하지 않는다. 알림 전달 뒤 payload를 삭제하고, 최신 대상이 active면 사용자가 최신값을 확인해 새 version으로 다시 작성한다. 이미 분할·병합·삭제된 원본에는 재제출하지 않는다. | 같은 근거와 [DEC-055](../../../governance/decisions.md#dec-055), [DEC-067](../../../governance/decisions.md#dec-067) | U, UI, I |
| QE-011 | 현재 명세 | QuickEdit에는 `FLAG_SECURE`나 별도 최근 앱 마스킹을 적용하지 않아 스크린샷·화면 녹화·시스템 미리보기를 허용한다. | 캡처 허용과 별개로 keyguard 우회·외부 export를 금지하고 QuickEdit 민감값을 앱 로그에 남기지 않는다. | 같은 근거와 [DEC-024](../../../governance/decisions.md#dec-024), [DEC-045](../../../governance/decisions.md#dec-045) | 보안 UI, E2E |
| QE-012 | 목표 명세 | QuickEdit은 별도 업무 규칙을 소유하지 않는 Android 입력·전달 Adapter이며, 일반 Ledger의 저장·삭제·분할·가구원 알림 요청 Command를 그대로 사용한다. versioned payload와 고정 `commandId`·`idempotencyKey`를 Keystore 암호화 outbox에 commit하고 WorkManager 영속 예약까지 완료한 뒤 Activity를 닫아 비동기 전달한다. commit부터 예약·접수 판정까지는 session purge와 하나의 짧은 임계 구역이며 서버 왕복은 그 밖에서 수행한다. | 서버 성공 전 성공 Toast·업무 완료 event는 없다. 느린 서버 응답이 다음 QuickEdit 로컬 접수를 막으면 안 된다. retryable 결과는 같은 envelope로 접수 시각부터 정확히 72시간 전까지 FIFO 재시도한다. 충돌·영구 거부·계약 실패·재시도 만료는 Command를 자동 재시도하지 않고 실패 알림 전달 전까지만 `needs-attention`으로 보존한다. 알림 차단·실패는 완료로 보지 않고 재시도하며 성공 뒤 payload를 삭제한다. 암호문·key·codec 손상은 payload를 fail-closed 삭제하되 비민감 손상 플래그와 실패 알림을 남긴다. outbox commit 또는 WorkManager 예약 실패는 화면을 유지한다. | [QuickEdit command outbox](../../../../../android/app/src/main/java/com/household/account/quickedit/QuickEditCommandOutbox.kt), [delivery lifecycle](../../../../../android/app/src/main/java/com/household/account/quickedit/QuickEditCommandDeliveryLifecycle.kt), [versioned codec](../../../../../android/app/src/main/java/com/household/account/quickedit/QuickEditCommandOutboxJsonCodec.kt), [DEC-067](../../../governance/decisions.md#dec-067) | U, UI, I, E2E |

## 7. 정상 요구사항으로 고정하지 않을 결함

- 알림 접근 허용 여부를 component name의 문자열 `contains`로 판정합니다.
- WebView 시작 URL이 production 주소로 고정되어 환경별 배포·테스트 계약이 없습니다.
- JavaScript bridge가 navigation 이후 origin을 제한하지 않아 다른 origin에서도 가구 키 등 민감 API에 접근할 수 있습니다.
- Native 로그에 가구 키·멤버명·FCM registration token이 기록되고, `SharedPreferences` 가구 키가 암호화되지 않습니다. 목표 구조에서는 FID도 같은 민감 전달 주소 정책을 적용합니다.
- Manifest의 `allowBackup=true`에 민감 저장소 제외 규칙이 없어 legacy identity·WebView 상태·향후 Queue가 백업 또는 기기 이전에 포함될 수 있습니다.
- 가구 키 삭제가 멤버 mirror와 legacy partnerName을 함께 정리하지 않아 오래된 identity가 남습니다.
- household key와 member name을 별도 Bridge 호출로 저장하고 QuickEdit 설정을 표시 이름으로 식별하여, 세션 전환 중 혼합 identity와 이름 변경 후 설정 초기화가 발생할 수 있습니다.
- QuickEdit에서 빈 memo로 기존 memo를 지울 수 없고, 멤버가 없어도 알림 요청 성공을 표시할 수 있습니다.
- QuickEdit 분할이 원본을 먼저 삭제하고 새 문서를 순차 생성하며 카드·유형·분할 metadata를 잃습니다.
- Android 13 이상에서 시스템 알림 표시를 위한 런타임 권한 요청이 없습니다.

## 8. 관련 제품 결정

| 결정 | 상태 | 이 모듈에 미치는 영향 |
|---|---|---|
| [DEC-004](../../../governance/decisions.md#dec-004) | 확정 | 최초 진입에는 오버레이 권한이 필요하며, 진입 후 QuickEdit 자동 표시는 별도 설정으로 끌 수 있습니다. |
| [DEC-013](../../../governance/decisions.md#dec-013) | 확정 | Android 자동 등록은 QuickEdit만 표시하며, QuickEdit의 `알림 보내기`는 별도 명시 요청으로 요청자 외 모든 가구원에게 전달합니다. |
| [DEC-019](../../../governance/decisions.md#dec-019) | 확정 | Android FID callback을 Notifications 등록 Adapter로 전달하고 registration token API를 제거합니다. |
| [DEC-020](../../../governance/decisions.md#dec-020) | 확정 | 로그인 후 설치 endpoint를 등록하고 로그아웃 때 해당 endpoint를 삭제합니다. Android는 원격 정리 전에 FCM 수신 component를 차단하며 정리 실패가 로그아웃을 막지 않습니다. 멤버별 다중 endpoint fan-out은 Notifications가 소유합니다. |
| [DEC-021](../../../governance/decisions.md#dec-021) | 확정 | Google UID의 자기 Membership만 사용하고 기존 localStorage key/member는 최초 계정 연결 뒤 폐기합니다. Android 로그인은 WebView OAuth가 아니라 Native Credential Manager Adapter가 담당합니다. |
| [DEC-022](../../../governance/decisions.md#dec-022) | 확정 | partnerName·partnerMemberId를 목표 Native session과 Bridge에서 제거하며 알림 대상을 Android가 저장하지 않습니다. |
| [DEC-024](../../../governance/decisions.md#dec-024) | 확정 | QuickEdit 조건 충족 시 화면을 켜고 잠금 화면 위에 거래 편집 정보를 표시하되 keyguard는 해제하지 않습니다. |
| [DEC-045](../../../governance/decisions.md#dec-045) | 확정 | QuickEdit 화면 캡처는 차단하지 않고 keyguard·외부 진입·앱 로그 보호만 유지합니다. |
| [DEC-054](../../../governance/decisions.md#dec-054) | 확정 | 연속 QuickEdit은 현재 편집을 보호하고 후속 거래를 내구성 있는 FIFO로 보존하여 하나씩 표시합니다. |
| [DEC-055](../../../governance/decisions.md#dec-055) | 확정 | 미저장 QuickEdit form 전체를 분할 초안으로 사용하고 다른 변경과 경합하면 stale Command 전체를 거부합니다. |
| [DEC-067](../../../governance/decisions.md#dec-067) | 확정 | QuickEdit은 일반 Ledger Command의 Android Adapter로서 암호화 outbox commit과 WorkManager 예약 뒤 화면에서 분리하고, 같은 멱등 key로 최대 3일 FIFO 전달하며 실패 알림 성공 전까지 terminal payload를 보존합니다. |

WebView URL·허용 origin은 배포 환경별 versioned 설정으로 고정하고 SessionMirror는 Android Keystore 기반으로 암호화하므로 별도 제품 결정을 요구하지 않습니다. 화면 캡처는 DEC-045, 연속 QuickEdit 표시는 DEC-054, 미저장 form 분할 원천은 DEC-055로 확정했습니다.

## 9. 모듈 테스트 시나리오

| 테스트 ID | 종류 | Given / When / Then | 연결 요구사항 |
|---|---|---|---|
| T-QE-001 | 특성화 | 2항목과 3항목 분할 / 한 금액 변경 / 2항목만 반대 금액 자동 조정 | QE-005, QE-007 |
| T-QE-002 | 목표 | 인증 Actor 부재·client requester 위조, 분할 중간 실패·동일 idempotency key 재실행 / QuickEdit 작업·서버 처리 / 서버 성공 전 Toast·업무 완료 event가 없고 requester·시각은 인증 Actor·서버 clock에서만 생성되며 부분 분할·중복 완료 효과 없음 | QE-002~006, SYS-007 |
| T-QE-003 | 목표 | 열린 QuickEdit A 중 B·C 연속 도착, 같은 ID 재전달, process 재시작, A outbox commit·예약 성공/실패·명시 닫기, stale·권한 철회·편집 불가 거래, session 전환 / FIFO 표시 조정 / A 유지, 접수 성공 직후 중복 없이 A→B→C, outbox 쓰기·예약 실패 시 A 유지, 무효 head만 민감 화면 없이 건너뛰고 다른 session 거래 미표시 | QE-009, QE-012, DEC-054, DEC-067 |
| T-QE-004 | 목표 | 가맹점·금액·카테고리·memo를 미저장 수정한 뒤 분할, 제출 직전 다른 사용자의 수정·분할 / 원자 Split 제출 / 현재 form과 payload 일치, provenance 서버 보존, 먼저 commit한 한 요청만 성공하고 stale 요청은 write 0건·로컬 초안 유지 | QE-010, QE-006, DEC-055 |
| T-QE-005 | 현재 명세 | 잠금 화면·스크린샷·화면 녹화·최근 앱·외부 Intent·로그 sink / QuickEdit 표시 / 화면 캡처와 시스템 미리보기는 허용하되 keyguard 우회·외부 진입·앱 로그 민감값 기록은 없음 | QE-008, QE-011, DEC-024, DEC-045 |
| T-QE-006 | 현재 명세 | 저장 성공·실패, 설정 기본/on/off, overlay 권한 있음·없음, 다른 QuickEdit 표시 중 / 자동 등록 후 열기 / 확정된 편집 가능 거래만 즉시 열거나 FIFO 대기하고 그 밖에는 화면·대기열 변경 없음 | QE-001 |
| T-QE-007 | 목표 | outbox commit·WorkManager 영속 예약 성공·실패, commit 뒤 예약 전 session purge 경합, 느린 서버 전송 중 다음 접수, process 종료·startup Worker, retryable→success, 앞 retryable과 뒤 명령, conflict·영구 거부·계약 실패, 정확히 72시간 만료, 실패 알림 성공·권한/채널 차단, 암호문·codec 손상 / 일반 Ledger Command의 Android 전달 / commit·예약·Accepted 사이 purge 진입 없음, 서버 왕복 중 다음 로컬 접수 성공, 성공 뒤 화면 종료, 같은 commandId·idempotencyKey FIFO 재시도, terminal·만료는 알림 전까지만 확인 필요 보존하고 알림 성공 뒤 payload 삭제, 손상은 비민감 실패 신호, 다른 actor 전송·Worker 자기 증식 없음 | QE-012, AND-009, AND-011, DEC-067 |
| T-ANDROID-HOST-001 | 현재 명세 | 정확한·유사 listener component, overlay 권한, QuickEdit on/off / 앱 생성·resume gate / 두 필수 권한일 때만 Web Shell, 누락 권한별 정확한 시스템 설정 action | AND-001, AND-002 |
| T-WEBVIEW-001 | 목표 | Native 인증 session 교환과 허용하지 않은 origin·redirect·subframe·유사 host / bridge 접근 / 일회성 동일 Principal 교환 뒤 민감 API 비노출·차단 | AND-005, AND-006 |
| T-WEBVIEW-002 | 목표 | fresh·저장 navigation, production/development 환경, HTTP URL·origin 불일치 / Web Shell 초기화 / 같은 versioned 설정의 허용 HTTPS URL만 fresh에서 한 번 load하고 오설정 빌드 거부 | AND-003 |
| T-WEBVIEW-003 | 현재 명세 | 권한 guide, Web Shell history 있음·없음 / 뒤로가기 / Web history 또는 Activity 기본 동작으로 위임 | AND-004 |
| T-WEBVIEW-004 | 현재 명세 | Android 재실행의 동일 UID 영속 Auth·검증 Membership·가구 cache, cache 없음, Native 교환 지연, Firestore 성공·무응답, 원장↔자산 재진입 / 세션과 화면 복원 / cache가 있으면 Native 교환 전에 화면을 열고 같은 조회 snapshot을 즉시 재표시하며 서버값으로 수렴하고, cache 없는 무응답은 오류·재시도로 종료하며 로그아웃·세션 전환 뒤 이전 snapshot은 노출하지 않음 | AND-012 |
| T-ANDROID-VERSION-001 | 현재 명세 | 정상 versionName·값 부재·package 조회 실패 / 버전 표시 / 계약 문자열 또는 알 수 없음 | AND-007 |
| T-ANDROID-LOG-001 | 목표 | 가구·멤버·FID·token·알림·memo가 포함된 성공·실패 흐름 / log sink 관찰 / 원문 없음, 허용된 hash·오류 code만 존재 | AND-008 |
| T-ANDROID-BACKUP-001 | 목표 | 로그인·legacy 전환·Queue 적재 뒤 cloud backup과 device transfer 복원 / 새 설치 시작 / actor·credential·legacy key·Queue·WebView 민감 상태가 복원되지 않음 | AND-009 |
| T-ANDROID-WIRE-001 | 목표·계약 | Bridge·QuickEdit TypeScript DTO와 generated Kotlin codec, unknown version·비정수 금액 / JSON decode·reencode / nullable 필드와 versioned 의미를 손실 없이 왕복하고 알 수 없는 schema를 추정하지 않음 | AND-005, AND-006, QE-002 |
| T-ANDROID-NOTIFICATION-PERMISSION-001 | 목표 | API 32·33에서 표시 권한 허용·거부 / 요청·앱 진입·수집 / API 33만 요청하고 거부해도 WebView·수집·QuickEdit·FID 등록 유지 | AND-010 |
| T-SESSION-MIRROR-001 | 목표 | 가구·멤버 전환, Queue 삭제 실패·성공, 멤버 이름 변경 / mirror 동기화 / 혼합 snapshot 없음, 삭제 실패 시 이전 actor 유지, 이름 변경 뒤 QuickEdit 설정 유지 | AND-011 |
| T-ANDROID-FCM-LOGOUT-001 | 목표·동시성·보안 | 활성 FID에서 로그아웃, component·preference·원격 삭제·unregister 각각의 실패와 timeout, process 재시작·재로그인 / FCM detach·등록 / component 차단이 네트워크보다 먼저이며 모든 정리 시도가 독립적으로 실행되고 로그아웃은 완료, 세션 없는 시작은 차단 유지, stale unregister 뒤 등록과 현재 binding 확인에서만 표시 허용 | AND-005, AND-013, PUSH-003, PUSH-007 |

추가 UI·instrumentation 테스트에서는 권한 조합별 첫 화면, Native Google 로그인 성공·취소·실패, WebView 일회성 세션 교환·재사용 차단, legacy localStorage 전환, QuickEdit 비활성 사용자의 오버레이 권한 부재, bridge 허용 origin과 navigation 이후 차단, WebView 뒤로가기, 빈 memo 삭제, 누락 Intent, 잠금 화면 정책을 검증합니다.

## 10. 코드 근거

- [MainActivity와 권한·WebView](../../../../../android/app/src/main/java/com/household/account/MainActivity.kt)
- [WebView host bridge](../../../../../android/app/src/main/java/com/household/account/webhost/AndroidHostBridge.kt)
- [Native 저장소](../../../../../android/app/src/main/java/com/household/account/util/HouseholdPreferences.kt)
- [QuickEdit](../../../../../android/app/src/main/java/com/household/account/QuickEditActivity.kt)
- [원장 Command Client](../../../../../android/app/src/main/java/com/household/account/ledger/HouseholdCommandClient.kt)
- [알림 수집 Service](../../../../../android/app/src/main/java/com/household/account/service/CardNotificationListenerService.kt)
- [FCM 수신](../../../../../android/app/src/main/java/com/household/account/service/FcmService.kt)
- [Android Manifest](../../../../../android/app/src/main/AndroidManifest.xml)
