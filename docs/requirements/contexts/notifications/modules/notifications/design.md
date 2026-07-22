# 푸시 알림 모듈 상세 설계

> 설계 대상: [`PUSH-001~013`](requirements.md#5-요구사항) 13개  
> 상위 Context: [Notifications](../../requirements.md)  
> 공통 형식: [모듈 상세 설계 규약](../../../../governance/module-design-standard.md)  
> 데이터 경계: [데이터 소유권](../../../../cross-cutting/data-ownership.md)  
> 목표 아키텍처: [목표 Clean Architecture 설계](../../../../../architecture/target-clean-architecture.md)

## 1. 설계 목적과 추적성

이 문서는 인증된 사용자의 기기 endpoint를 안정적인 memberId와 연결하고, 확정 업무 Event를 수신자별 알림으로 멱등 전달하기 위한 상세 계약입니다. 거래 성공과 알림 성공을 분리하고, FCM·PWA·Android 표시 구현을 교체 가능한 Adapter 뒤에 둡니다.

핵심 처리 흐름은 다음과 같습니다.

```text
Ledger / Payment Intake Outbox Event
  → Notifications Inbox claim
  → Recipient Policy
  → Endpoint 조회
  → NotificationIntent·Delivery claim
  → FCM Port
  → delivered | failed | unknown-provider-outcome | permanent-failure
```

이 문서는 [DEC-013](../../../../governance/decisions.md#dec-013)의 채널별 수신 정책, [DEC-019](../../../../governance/decisions.md#dec-019)의 FID 직접 전송 정책, [DEC-020](../../../../governance/decisions.md#dec-020)의 멤버별 다중 endpoint 수명주기, [DEC-025](../../../../governance/decisions.md#dec-025)의 endpoint별 Admin send 단일 호출, [DEC-038](../../../../governance/decisions.md#dec-038)의 제거 가구원 수신 차단을 고정합니다. endpoint는 FID에서 결정적으로 만든 비가역 endpointId로 식별하고 현재 householdId·memberId에 연결합니다. FID는 FCM Adapter의 전달 주소로만 격리해 Firebase 식별자와 기기 정책이 Access·Ledger 모델로 전파되지 않게 합니다. 11절에서 13개 `PUSH-*` ID를 모두 테스트에 연결합니다.

## 2. 모듈 경계와 책임

### 2.1 소유 책임

- 앱 설치별 `NotificationEndpoint`와 멤버별 복수 endpoint
- FID·platform·device metadata 등록, 로그아웃 삭제와 안정적인 householdId/memberId binding
- 확정 업무 Event의 Inbox claim과 수신자 계산
- `HouseholdMemberRemoved.v1`의 멱등 endpoint 정리와 전송 직전 활성 Membership 재검증
- versioned notification payload와 click target
- `(eventId, recipientMemberId, endpointId)`별 `NotificationDelivery` 단일 시도 claim과 최종 상태
- FCM 결과의 성공·일반 실패·provider 결과 불명·영구 FID 실패·계약 실패 분류
- HTTP `404`이면서 code가 `UNREGISTERED`인 endpoint의 조건부 inactive 처리와 delivery 상태 Query
- 별도 영구 purge 요청 시 household-scoped endpoint·Inbox·delivery만 page 단위 정리; 논리 삭제 시 보존

### 2.2 Adapter 책임

- Android와 iPhone 홈 화면 PWA는 로그인 뒤 FCM SDK의 `onRegistered`에서 받은 FID로 `RegisterEndpoint`를 호출합니다. 로그아웃은 `RemoveEndpoint`를 호출하며 데스크톱은 이 흐름에 참여하지 않습니다. Android는 원격 호출보다 먼저 FCM 수신 component를 차단해 로그아웃 기기의 foreground callback과 background notification 자동 표시를 모두 닫습니다.
- PWA worker는 payload 표시·클릭·기존 창 focus를 구현합니다.
- Android FCM Service는 foreground payload를 OS notification으로 표시합니다.
- FCM Adapter는 공급자 DTO·오류 code를 내부 결과로 변환합니다.

이 Adapter들은 recipient·cardinality·단일 시도 Policy를 소유하지 않습니다.

### 2.3 소유하지 않는 책임

- Ledger가 거래와 creator/source/originChannel, 명시적 가구원 알림 요청의 원본을 소유합니다.
- Payment Intake가 결제 observation·중복 결과를 소유합니다.
- Access가 Membership, memberId, lifecycle과 서버 capability를 소유합니다. household owner role은 없습니다.
- PWA/Android Host가 OS 권한 UX와 실제 화면 탐색을 소유합니다.
- Notifications는 `expenses`를 수정하거나 거래 저장 성공을 추측하지 않습니다.

## 3. 공개 계약

Command envelope, `ActorContext`, 공통 Result는 [모듈 설계 규약](../../../../governance/module-design-standard.md#3-공통-application-계약)을 그대로 사용합니다.

### 3.1 공개 DTO

```ts
interface EndpointRegistrationV1 {
  fid: string;
  platform: 'ios-pwa' | 'android';
  memberId: string;
  deviceInfo?: { model?: string; osVersion?: string; sdkVersion?: string; appVersion?: string };
}

interface NotificationPayloadV1 {
  payloadVersion: 'notification-payload.v1';
  type: 'expense-created' | 'household-notification-requested' | 'capture-duplicate';
  notification: { title: string; body: string };
  data: {
    deliveryId: string;
    clickTarget: 'expense-edit' | 'home';
    expenseId?: string;
  };
}

interface FirebaseSendOneCommandV1 {
  deliveryId: string;
  fid: string;
  payload: NotificationPayloadV1;
}

type DeliveryStatus =
  | 'queued' | 'sending' | 'delivered' | 'failed' | 'unknown-provider-outcome'
  | 'permanent-failure' | 'contract-failure' | 'stale-target' | 'no-target';

type EndpointRegistrationResult =
  | { kind: 'EndpointRegistered'; endpointId: string; result: 'created' | 'refreshed' | 'stale-binding-recovered'; registrationVersion: number };
```

FID는 Write DTO와 FCM Output Port command에만 존재하며 사용자 identity나 인증 증명으로 사용하지 않습니다. Read Model·Event·일반 로그에는 FID를 노출하지 않고 등록 결과에도 FID나 이전 기기 metadata를 반환하지 않습니다. payload는 소비 화면에 필요한 최소 정보만 가지며 Event 원문 전체를 복제하지 않습니다. `clickTarget`은 서버가 생성하는 enum이고 `expenseId`는 길이·허용 문자 계약을 통과한 opaque ID입니다. payload에 `url`, scheme, host나 임의 path를 넣지 않습니다.

### 3.2 공개 Input Port

| 이름·종류 | 호출자 | 입력 | 결과 | 권한 | 일관성·멱등성 |
|---|---|---|---|---|---|
| `RegisterEndpoint` Command | iPhone 홈 화면 PWA, Android | registration DTO | `Success<EndpointRegistered>`·`Conflict` | 인증 uid, App Check, 대상 가구 Membership | endpoint·receipt 한 transaction; 같은 command key 재생; 동일 FID의 낡은 binding은 현재 로그인으로 원자 교체 |
| `RemoveEndpoint` Command | iPhone 홈 화면 PWA, Android | memberId, FID | `Removed`·`AlreadyAbsent` | 현재 binding의 해당 멤버 Actor | 로그아웃 때 현재 FID endpoint만 삭제; 다른 설치 endpoint 보존 |
| `MarkEndpointInactive` Command | FCM result worker, SDK callback Adapter | endpointId, expected registrationVersion, reason | `Inactivated`·`StaleIgnored` | 내부 SystemActor 또는 검증된 현재 binding | 현재 FID/version 일치 시에만 inactive; inactiveAt+30일 expiresAt 설정 |
| `AcceptNotificationIntent` Event Handler | Outbox Dispatcher | versioned 업무 Event | `Queued(count)`·`NoTarget`·`AlreadyProcessed` | 등록된 producer schema | Inbox + intent + delivery claims 한 transaction; `(eventId, handlerName)` |
| `HandleHouseholdMemberRemoved` Event Handler | Outbox Dispatcher | householdId, memberId, eventId, cursor | `RemovedPage(nextCursor)`·`Completed`·`AlreadyProcessed` | Access producer schema, 내부 SystemActor | page receipt와 대상 endpoint 삭제를 한 transaction에서 처리; 중복 Event·page 재실행에 안전 |
| `DeliverNotification` Command/Worker | delivery dispatcher | `deliveryId` | `Delivered`·`Failed`·`UnknownProviderOutcome`·`PermanentFailure`·`ContractFailure` | `notifications:deliver` SystemActor | 전송 시작을 원자 claim한 뒤 endpoint 하나에 Admin send 한 번; 같은 delivery는 두 번째 provider 호출 금지 |
| `GetDeliveryStatus` Query | 허용 사용자·운영 | household, intent/delivery ID | 집계 status와 endpoint별 비민감 결과 | 같은 가구 read 또는 운영 capability | 결정적 endpoint ID 정렬; FID 비노출 |
| `PurgeHouseholdData` Process Command | Access 수동 HouseholdPurgeProcess | household, processId, opaque checkpoint | 공통 `PurgePageResult` | `householdLifecycle:purge` SystemActor | page receipt와 삭제를 원자 처리; 같은 checkpoint 결과 재생; 논리 삭제에서 호출 금지 |

### 3.3 Event 입력과 producer 소유권

| 입력 Event | 유일 producer | Notifications handler | 용도 |
|---|---|---|---|
| `TransactionRecorded.v1` | Household Finance / Ledger | `TransactionRecordedNotificationHandler` | 신규 거래 수신자 Policy 평가 |
| `HouseholdNotificationRequested.v1` | Household Finance / Ledger | `HouseholdNotificationRequestedHandler` | 요청자 외 가구원 대상 명시 알림 요청 처리 |
| `CaptureDuplicateObserved.v1` | Payment Capture / Intake | `CaptureDuplicateNotificationHandler` | IOS-009 호환 duplicate 알림; 새 거래 생성 Event로 취급하지 않음 |
| `HouseholdMemberRemoved.v1` | Access & Household | `HouseholdMemberRemovedHandler` | 제거된 member의 모든 endpoint를 page 단위 정리하고 신규 수신 대상에서 배제 |

Payment Capture는 `CaptureDuplicateObserved.v1`의 producer와 원자 Outbox 기록까지만 소유합니다. Notifications의 `CaptureDuplicateNotificationHandler`가 이 Event의 Inbox claim, endpoint 선택, Delivery와 provider 결과를 소유하며 Payment Capture Subject가 endpoint Repository나 provider outcome을 직접 받지 않습니다.

각 producer는 자기 Canonical 변경 또는 receipt와 같은 Unit of Work에서 공통 `OutboxAppendPort`로 Event를 한 번 기록합니다. payload에는 `householdId`, 안정적인 member/transaction 식별자, 업무 `source`, `originChannel`, `transactionType`, template 계산에 필요한 최소 금액·가맹점 정보만 포함하며 Shortcut/Android 알림 원문은 포함하지 않습니다.

Notifications가 선택적으로 발행하는 `NotificationDelivered.v1`, `NotificationDeliveryFailed.v1`의 유일 producer는 Notifications입니다. 운영·사용자 상태 조회에 필요한 경우에만 발행하며 Ledger를 다시 변경하지 않습니다.

## 4. Domain 모델과 불변식

### 4.1 `NotificationEndpoint`

`NotificationEndpoint`는 `endpointId`, householdId, memberId, platform, encrypted FID, FID hash, `active|inactive` 상태, device metadata, registeredAt, lastConfirmedAt, registrationVersion, bindingVersion을 가집니다.

- endpointId는 FID의 keyed hash에서 결정적으로 만들며 FID 하나에 endpoint 문서 하나만 존재합니다. 원문 FID와 hash는 server-only입니다.
- 한 멤버는 endpoint를 여러 개 가질 수 있지만 한 endpoint는 동시에 한 `(householdId, memberId)`에만 연결됩니다.
- 표시 이름은 key나 외래 키가 아니므로 이름 변경 시 endpoint를 이동하지 않습니다.
- 빈 FID는 거부하고 FID를 Actor·Membership 인증 근거로 사용하지 않습니다.
- 같은 FID 등록은 platform, device metadata, lastConfirmedAt을 갱신하고 registrationVersion을 증가시키며 inactive 상태라면 active로 복구합니다.
- 새 FID 등록은 별도 endpoint를 추가하며 같은 멤버의 기존 endpoint를 바꾸지 않습니다.
- 로그아웃은 현재 설치의 endpoint 문서를 삭제합니다. 다른 멤버 로그인은 로그아웃 뒤 새 등록으로 처리하며 별도 endpoint 멤버 전환 상태를 두지 않습니다.
- Android의 로컬 delivery gate는 endpoint 삭제 결과와 독립적입니다. component 비활성화와 현재 알림 취소를 가장 먼저 시도하고, 로컬 억제 표시 저장·서버 endpoint 삭제·Firebase Messaging unregister가 실패하거나 timeout이어도 로그아웃을 계속합니다.
- 이전 로그아웃 삭제가 유실돼 같은 FID에 낡은 binding이 남았으면, 검증된 새 로그인 등록이 한 transaction에서 householdId·memberId를 교체하고 bindingVersion을 증가시킵니다.
- deviceId나 물리 기기 identity를 추가로 저장·비교하지 않습니다. endpoint identity는 FID에 한정합니다.

### 4.2 `EndpointRegistrationPolicy`

[DEC-020](../../../../governance/decisions.md#dec-020)에 따라 순수 Policy는 FID로 식별한 현재 endpoint와 검증된 로그인 등록 입력을 받아 다음 결과 중 하나를 반환합니다.

- endpoint가 없으면 현재 household/member binding과 registrationVersion 1로 `CreateEndpoint`를 반환합니다.
- 같은 binding의 endpoint가 있으면 lastConfirmedAt·metadata를 갱신하고 registrationVersion을 증가시키는 `RefreshEndpoint`를 반환합니다.
- 다른 binding의 endpoint가 남아 있으면 현재 Actor의 새 Membership을 검증한 뒤 binding을 원자 교체하는 `RecoverStaleBinding`을 반환합니다. 이는 로그아웃 삭제 유실 복구이며 별도 사용자 기능이 아닙니다.
- 서로 다른 FID의 등록은 서로 다른 endpoint에 적용되므로 어느 하나가 다른 하나를 덮어쓰지 않습니다.
- 같은 command key 재시도는 저장된 최초 결과를 재생하므로 자기 자신 때문에 version을 반복 증가시키지 않습니다.

클라이언트는 주 기기·임시 기기·멤버 전환 상태를 표시하지 않습니다. 사용자가 보는 흐름은 로그아웃과 로그인뿐이며 endpoint binding은 Notifications 내부 구현입니다.

### 4.3 거래 생성·명시 요청 수신자 Policy

생성자 기록과 알림 판단을 결합하지 않기 위해 두 Policy를 분리합니다.

- `TransactionCreatedNotificationPolicy` 입력은 `transactionType`, `originChannel`, 필수 `creatorMemberId`입니다. `android-notification` 지출은 `NoTarget(ANDROID_USES_QUICK_EDIT)`, `ios-shortcut` 지출은 `Recipients([creatorMemberId], endpointPlatform=ios-pwa)`를 반환합니다. `web-manual`, `recurring`, `system`은 `NoTarget(AUTO_PUSH_NOT_ALLOWED_FOR_CHANNEL)`이며 알 수 없는 채널은 계약 실패입니다. iPhone Shortcut 자동 알림은 다른 가구원을 포함하지 않습니다.
- `HouseholdNotificationRequestPolicy` 입력은 필수 `requesterMemberId`와 현재 활성 household members입니다. requester를 제외한 모든 memberId를 반환하며 대상이 없으면 `NoTarget(NO_OTHER_HOUSEHOLD_MEMBER)`입니다. 거래 creator는 이 제외 기준을 바꾸지 않습니다.
- DEC-026에 따라 두 Policy는 앱 내부 Subscription이나 알림 유형별 사용자 설정을 조회하지 않습니다. OS 알림 권한은 각 Delivery Adapter가 전체 표시를 허용·차단하는 local capability이며 QuickEdit preference와도 분리합니다.
- 두 Policy 모두 `creatorMemberId` 누락을 알림 없음으로 해석하지 않습니다. 필수 Event 계약 위반으로 분류해 producer를 교정하며, 이미 저장된 거래의 성공을 되돌리지는 않습니다.
- recipient memberId를 계산한 뒤 허용 platform에 맞는 모든 active `NotificationEndpoint`로 확장합니다. Android 자동 등록은 endpoint 확장 전에 `NoTarget`이며, iPhone Shortcut은 생성자의 모든 active `ios-pwa` endpoint, 명시 요청은 요청자 외 멤버들의 모든 active Android·iPhone PWA endpoint로 fan-out합니다.
- recipient 계산 시 Access의 active Membership만 허용합니다. endpoint 정리 Event가 아직 도착하지 않았더라도 제거된 Membership은 recipient가 될 수 없으며, Delivery 직전에도 같은 Membership을 다시 확인합니다.

### 4.4 `NotificationIntent`와 `NotificationDelivery`

`NotificationIntent`는 event ID, template type/version, recipient member IDs, 최소 payload facts를 가집니다. `NotificationDelivery` key는 `(eventId, recipientMemberId, endpointId)`의 versioned hash입니다.

- 같은 업무 Event·recipient·endpoint에는 delivery 하나만 존재합니다.
- 대상 없음은 성공 전송이 아니라 `NoTarget` terminal 결과입니다.
- intent 집계는 전체 성공, 일부 실패, failed, unknown-provider-outcome을 구분합니다.
- FCM HTTP `404`와 code `UNREGISTERED`가 함께 있는 결과만 endpoint를 비활성화합니다. 404의 다른 code, 일시 provider 실패, quota, timeout, payload·credential 오류는 endpoint를 보존합니다.
- FCM 실패는 이미 commit된 Ledger transaction을 롤백하지 않습니다.

## 5. Application Use Case 상세

### 5.1 endpoint 권한·발급·등록

Client Adapter의 `NotificationCapabilityController`는 플랫폼별로 다음을 수행합니다.

- iOS Web은 홈 화면 설치 PWA에서만 초기화하고 데스크톱은 권한 요청·등록·endpoint 생성을 하지 않습니다.
- Web/PWA는 서비스 워커와 VAPID 설정을 준비하고 `onRegistered` listener를 연결한 뒤 로그인 완료 시 `register()`를 호출합니다. callback의 FID를 서버에 등록하고 `onUnregistered(fid)`는 현재 registrationVersion 조건으로 inactive 처리를 요청합니다.
- Android는 Manifest에서 `firebase_messaging_installation_id_enabled=true`를 활성화하고 `FirebaseMessagingService.onRegistered(installationId)`의 FID를 서버에 등록합니다. 자동 초기화의 최초 시작·정기 동기화·FID 변경 callback을 사용하며 수동 초기화를 선택한 경우에만 앱 시작 시 `register()`를 호출합니다.
- Web/PWA와 Android에서 deprecated `getToken`·`onNewToken` registration token 경로를 함께 사용하지 않습니다. Android의 FID 등록은 POST_NOTIFICATIONS 표시 권한과 별개이며 iOS PWA는 Web Push 권한 허용 후 등록합니다.
- OS 권한 거부·철회만으로 서버 endpoint를 삭제하거나 inactive로 전환하지 않습니다. 권한 재허용 시 같은 endpoint를 계속 사용할 수 있고 로그아웃만 `RemoveEndpoint`를 호출합니다.
- 로그인과 멤버 선택 전에는 등록하지 않습니다. Android 로그아웃은 `FcmService` component를 가장 먼저 비활성화하고 이미 표시된 앱 알림을 취소한 뒤, 로컬 억제 상태 저장과 `RemoveEndpoint`·Firebase Messaging unregister를 서로 독립적인 유한 timeout으로 시도합니다. preference 저장, 원격 삭제, unregister 중 어느 하나가 실패해도 다른 시도와 로컬 로그아웃은 계속합니다. 서버가 이미 삭제한 경우는 멱등 성공입니다.
- Android process가 로컬 session 없이 시작되면 component를 비활성화 상태로 수렴시킵니다. 다음 로그인은 억제 상태 또는 다른 binding 흔적이 있으면 먼저 stale Firebase Messaging registration을 unregister하고, 성공한 경우에만 component를 활성화해 새 등록을 시작합니다. 등록 실패 시 component를 다시 비활성화하고, 서버가 현재 household/member binding을 확인하기 전 foreground callback은 표시하지 않습니다.

서버 `RegisterEndpoint`는 다음 순서입니다.

1. Actor와 household 일치, 활성 Membership, `memberId`가 Actor에게 허용됐는지 확인합니다.
2. App Check를 검증합니다. FID는 인증 증명이 아니므로 Actor·Membership 검증을 대신하지 않습니다.
3. 앞의 검증이 모두 성공한 뒤에만 FID·device metadata를 정규화하고 FID hash를 계산합니다. 실패 경로는 endpoint Repository의 read/write와 낡은 binding 교체를 한 번도 호출하지 않습니다.
4. FID keyed hash로 endpointId를 만들고 Unit of Work에서 해당 endpoint를 읽어 `EndpointRegistrationPolicy`를 적용합니다.
5. endpoint·command receipt를 같은 transaction에서 생성 또는 갱신하고 `EndpointRegistered`를 반환합니다. 낡은 다른 binding이 있으면 같은 transaction에서 현재 로그인 binding으로 교체합니다.
6. 같은 command key와 payload는 최초 결과를 재생하고 다른 payload는 `Conflict`입니다. 같은 FID의 동시 등록은 transaction 재시도로 하나의 최신 registrationVersion에 수렴하고 서로 다른 FID는 독립 저장됩니다.
7. active endpoint에는 expiresAt을 두지 않습니다. inactive 전이 시에만 `expiresAt=inactiveAt+30일`을 설정하고 같은 FID가 다시 등록되면 inactiveAt·expiresAt을 제거합니다.
8. 실패는 typed 결과로 반환하되 기존 UI가 조용히 무시하는 동작은 Client Adapter compatibility로만 유지합니다.

로그아웃의 `RemoveEndpoint`는 다음 순서입니다.

1. Android 클라이언트는 로컬 세션을 지우기 전에 `FcmService` component 비활성화와 기존 알림 취소를 가장 먼저 시도합니다. 이 차단은 서버 상태 저장과 무관하며 OS가 notification payload를 자동 표시하는 background 경로까지 대상으로 합니다. 그 뒤 로컬 억제 상태를 best-effort로 기록합니다.
2. 클라이언트는 현재 FID와 memberId의 `RemoveEndpoint`와 Firebase Messaging unregister를 각각 같은 유한 timeout 안에서 병렬 best-effort로 시도합니다. 어느 하나의 실패도 다른 시도나 로그아웃을 막지 않습니다.
3. 서버가 Actor·Membership과 endpoint의 현재 binding을 검증합니다. FID 원문은 endpointId 계산 뒤 로그에 남기지 않습니다.
4. binding이 현재 Actor와 일치하면 endpoint 문서와 command receipt를 한 transaction에서 처리하고 `Removed`를 반환합니다. 이미 없으면 `AlreadyAbsent`를 반환합니다.
5. 다른 binding의 endpoint라면 삭제하지 않고 `Conflict`를 반환합니다. 다른 설치 endpoint는 조회하거나 변경하지 않습니다.
6. 클라이언트는 원격 결과와 무관하게 Queue·mirror·Native/Web 인증을 정리해 로그아웃을 완료합니다. 남은 서버 binding은 전송 직전 version 검증과 다음 로그인 `RegisterEndpoint`의 원자 교체로 수렴합니다.
7. 이후 다른 멤버 로그인은 일반 `RegisterEndpoint`를 호출할 뿐 별도의 endpoint 멤버 전환 명령을 호출하지 않습니다.

### 5.2 Event→Intent

1. Dispatcher가 versioned Event를 handler에 전달합니다.
2. Handler가 `(eventId, handlerName)` Inbox를 claim하고 producer/schema/version을 검증합니다.
3. Event 종류에 따라 `TransactionCreatedNotificationPolicy` 또는 `HouseholdNotificationRequestPolicy`가 recipient memberId와 허용 endpoint platform을 계산합니다.
4. Access에서 각 recipient의 active Membership을 확인한 뒤 active `NotificationEndpoint`를 모두 읽고 채널과 platform 조건에 맞는 endpoint 집합으로 확장합니다. Membership 조회가 실패하면 `NoTarget`으로 축약하지 않고 Inbox를 retryable 상태로 남기며 endpoint·delivery를 만들지 않습니다. 데스크톱 endpoint는 저장되지 않으므로 대상에 포함되지 않습니다.
5. payload factory가 type별 `NotificationPayloadV1`을 생성합니다.
6. 같은 transaction에서 Inbox 완료, intent, delivery claims를 저장합니다. 대상이 없으면 명시 `NoTarget` 결과를 저장합니다.
7. 외부 FCM 호출은 transaction 밖의 delivery worker에서만 실행합니다.

### 5.3 Delivery

1. worker가 queued delivery를 `sending(attemptedAt)`으로 원자 claim하고 expected registrationVersion·bindingVersion을 고정합니다. 이미 `sending` 또는 최종 상태면 provider를 다시 호출하지 않습니다.
2. 외부 호출 직전에 endpoint가 여전히 `active`이고 delivery의 recipientMemberId·householdId·registrationVersion·bindingVersion과 일치하며 Access Membership도 `active`인지 다시 읽습니다. 로그아웃·가구원 제거로 endpoint 또는 Membership이 사라졌거나 새 로그인으로 binding이 달라졌으면 FCM을 호출하지 않고 `StaleTarget`으로 종료합니다. Membership 조회 자체가 실패한 경우도 fail-closed하여 provider를 호출하지 않고 `Failed(MEMBERSHIP_CHECK_UNAVAILABLE)`로 최종 기록합니다.
3. Application worker는 검증된 현재 endpoint 하나의 FID, payload, 안정적인 delivery ID를 `FirebaseMessagingPort.sendOne`에 정확히 한 번 전달합니다. 한 delivery 호출에 `fid` 하나만 사용하며 여러 endpoint를 multicast 한 호출로 합치지 않습니다.
4. 결과를 `Delivered`, `Failed`, `UnknownProviderOutcome`, `PermanentFidFailure`, `ContractFailure`로 분류합니다.
5. Adapter는 provider 결과만 반환하고 endpoint 삭제·비활성화 side effect를 수행하지 않습니다. Application의 awaited result transaction이 최종 상태와 `attemptCount=1`을 기록합니다.
6. provider 결과가 HTTP `404`이면서 code가 `UNREGISTERED`인 경우에만, 전송에 사용한 FID hash·registrationVersion·bindingVersion이 현재 endpoint와 모두 같으면 같은 awaited result transaction에서 inactive로 바꿉니다. 404의 다른 code, 다른 모든 오류와 stale version은 endpoint 상태를 유지합니다.
7. 성공·실패·timeout·결과 불명 중 어떤 결과를 받았든 Application은 해당 delivery의 Admin send를 다시 호출하지 않습니다. quota·일시 network 오류도 자동 재전송하지 않으며 일부 endpoint 성공은 되돌리지 않습니다.
8. worker가 provider 호출 전후에 종료되어 결과를 확정하지 못한 `sending`은 운영 reconciliation이 `UnknownProviderOutcome`으로 마감하되 FCM을 다시 호출하지 않습니다.
9. terminal delivery와 해당 intent·Inbox·command receipt에는 `expiresAt=terminalAt+30일`을 기록합니다.
10. 필요 시 Notifications 소유 결과 Event를 Outbox로 기록합니다.

동일 Outbox Event의 재전달은 기존 Inbox·Delivery를 재생하므로 두 번째 FCM 호출을 만들지 않습니다. FCM 응답을 받지 못한 timeout은 실제 전달 여부를 증명하지 않고 `unknown-provider-outcome`으로 최종 기록합니다. payload의 `deliveryId`는 서버 관측 식별자이며 PWA·Android에 별도 중복 제거 저장소를 요구하지 않습니다.

### 5.4 가구원 제거 endpoint 정리

1. `HouseholdMemberRemovedHandler`가 `(eventId, handlerName)` Inbox를 claim하고 Access producer·schema version을 검증합니다.
2. `(householdId, memberId, endpointId)` 순서의 결정적 page로 대상 endpoint만 조회합니다.
3. page receipt·cursor와 해당 page endpoint 삭제를 한 transaction에서 처리합니다. 같은 Event나 cursor를 다시 받아도 저장된 결과를 재생합니다.
4. 다른 멤버 endpoint와 기존 terminal Intent·Delivery는 변경하지 않습니다. 이미 queued·sending인 Delivery도 5.3의 active Membership 재검증으로 provider 호출 전 차단합니다.
5. `HouseholdMemberRestored.v1`은 endpoint를 복구하지 않습니다. 복구된 사용자가 지원 모바일 환경에서 다시 로그인할 때 `RegisterEndpoint`로 새 binding을 만듭니다.

endpoint 정리는 Event 기반 비동기 cleanup이지만 접근·수신 차단의 정확성은 cleanup 완료에 의존하지 않습니다. Access의 Membership 전이가 먼저 commit되고 모든 신규 대상 계산과 실제 provider 호출이 그 상태를 확인합니다.

### 5.5 delivery status와 purge

`GetDeliveryStatus`는 endpoint별 FID를 숨기고 queued, delivered, partial, failed, unknown-provider-outcome, stale-target, no-target를 집계합니다. 목록은 `recipientMemberId`, `endpointId` 순으로 결정 정렬합니다.

`PurgeHouseholdData`는 [공통 paged purge 계약](../../../../cross-cutting/data-ownership.md#41-공통-paged-purge-계약)을 따릅니다. 논리 삭제에서는 호출하지 않으며 별도 승인된 수동 영구 purge에서만 현재 대상 household에 연결된 endpoint, intent, delivery, Inbox를 page 단위 삭제합니다.

## 6. Port 설계

| Output Port | 책임 | fixture·결과 |
|---|---|---|
| `NotificationEndpointRepository` | endpointId별 FID·현재 binding·platform·metadata·상태 | absent, same FID refresh, multiple FIDs, stale binding recovery, logout delete, inactive, concurrent registration |
| `NotificationInboxRepository` | `(eventId, handlerName)` claim과 결과 재생 | first, duplicate, previous version, dead letter |
| `DeliveryRepository` | intent·delivery 단일 시도 claim, result, status query | queued, claim contention, already-attempted, unknown, permanent, partial |
| `NotificationsUnitOfWork` | registration 및 intent claim의 다중 문서 transaction | callback 2회, rollback, write limit |
| `MembershipQueryPort` | Actor/member/household 상태 검증과 recipient 계산·provider 호출 직전 active 재확인 | active, removed, deleted, purging, missing, forbidden |
| `AppAttestationPort` | App Check 검증 | valid, missing, wrong app, expired |
| `FirebaseMessagingPort` | endpoint 하나의 provider-neutral `sendOne` | success, 404+UNREGISTERED, 404 other, invalid FID, quota, timeout, credential error |
| `OutboxAppendPort` | Notifications 결과 Event 기록 | 현재 UoW 참여, immutable envelope |
| `Clock`, `IdGenerator`, `HashingPort`, `ObservabilityPort` | 시간·ID·claim hash·trace | FID와 민감 payload 비노출 |

FCM 오류 분류는 Adapter contract fixture가 소유합니다. HTTP `404`와 `UNREGISTERED`가 함께 있을 때만 `PermanentFidFailure`, timeout은 `UnknownProviderOutcome`, quota·일시 network는 `Failed`, 404의 다른 code와 invalid payload·sender credential·payload schema 오류는 endpoint 상태 변경 없는 `ContractFailure`입니다. Adapter는 endpoint Repository를 알지 못하고 어떤 결과도 자동 provider 재호출을 예약하지 않습니다.

## 7. 저장·트랜잭션·동시성

### 7.1 논리 저장 모델

```text
notificationEndpoints/{endpointId}                         # FID 설치별 NotificationEndpoint; household/member binding 포함
households/{householdId}/notificationInboxes/{inboxKey}    # event handler claim
households/{householdId}/notificationIntents/{intentId}
households/{householdId}/notificationDeliveries/{deliveryKey}
```

물리 경로는 Adapter 내부이며 다른 모듈에 공개하지 않습니다.

### 7.2 transaction 경계

- 등록: FID 결정 endpoint와 command receipt를 한 transaction에서 생성·갱신합니다. 같은 command key는 결과를 재생하고, 같은 FID의 낡은 binding은 현재 로그인 binding으로 원자 교체하며, 서로 다른 FID는 독립 endpoint로 남습니다.
- 로그아웃: 현재 FID endpoint의 bindingVersion과 Actor를 검증하고 endpoint 문서를 삭제합니다. 다른 설치 endpoint는 변경하지 않습니다.
- Event 접수: Inbox claim, intent, 모든 delivery claim을 한 transaction에 생성합니다. endpoint 수가 한도를 넘으면 결정적 page와 intent checkpoint로 나눕니다.
- 가구원 제거 cleanup: Event Inbox/page receipt와 해당 `(householdId, memberId)` endpoint page 삭제를 한 transaction에 넣습니다. Access Membership의 즉시 차단을 전제로 하며 cleanup 완료를 권한 경계로 사용하지 않습니다.
- 전송: 단일 시도 claim transaction → FCM 외부 호출 → 결과 transaction의 세 단계이며 FCM은 transaction callback 안에서 호출하지 않습니다. claim 뒤 worker가 중단되어도 같은 delivery를 다시 호출하지 않고 unknown으로 마감합니다.
- permanent failure: `404+UNREGISTERED` delivery 결과와 endpoint inactive 전환을 같은 awaited result transaction에 넣되 실패한 FID hash·registrationVersion·bindingVersion이 현재 값과 일치할 때만 반영합니다.
- purge: 한 page의 receipt/checkpoint와 household-scoped 삭제만 원자 처리합니다.

각 문서는 schemaVersion·aggregateVersion·createdAt·updatedAt을 가지며 compare-and-set으로 stale worker와 두 번째 provider 호출을 막습니다. DEC-027에 따라 active endpoint에는 TTL이 없고 inactive endpoint와 terminal Inbox·Intent·Delivery·command receipt는 기준 시각부터 30일 `expiresAt`을 둡니다. Domain에서는 ISO 8601 문자열을 사용하지만 Firebase Adapter는 물리 `expiresAt`을 Firestore `Timestamp`로 변환하며, endpoint 재활성화 시 과거 `inactiveAt`과 `expiresAt`을 명시적으로 제거합니다. TTL 삭제는 비동기이므로 정확히 30일 시점의 삭제를 업무 조건으로 사용하지 않습니다. queued·sending은 reconciliation 전 삭제하지 않습니다. 30일보다 오래된 입력 Event는 Inbox 유무와 관계없이 `ExpiredEvent`로 종료해 새 delivery를 만들지 않습니다.

### 7.3 migration

registration token에서 FID를 계산하거나 변환할 수 없으므로 기존 `fcmTokens/{householdId_memberName}`를 새 endpoint로 backfill하지 않습니다. Android·PWA Client와 Cloud Functions를 FID 계약으로 함께 전환하고, 각 지원 모바일 설치의 로그인 후 `onRegistered`가 `notificationEndpoints/{endpointId}`를 채우게 합니다. 전환 후 `getToken`·`onNewToken`·`saveFcmToken`·`fcmTokens` writer와 token 기반 `token`·`tokens` 전송, legacy multicast helper를 제거하며 fallback이나 shadow dual-write를 두지 않습니다. legacy helper가 모든 오류 token을 삭제하고 `delete()` 완료를 기다리지 않는 동작은 이관하지 않습니다. 전환 직후 아직 다시 로그인·등록하지 않은 설치는 `NoActiveEndpoint`로 관측하고 지원 모바일 앱이 FID를 등록하면 정상 복구합니다. 데스크톱은 이관 대상이 아니며 FID는 migration log나 reconciliation report에 평문으로 출력하지 않습니다.

## 8. Event·Projection·외부 연동

### 8.1 payload 소비 계약

- PWA background click은 지원 payload version, `clickTarget=expense-edit`, 계약을 통과한 opaque `expenseId`일 때만 `new URL('/', self.location.origin)`과 `searchParams.set('edit', expenseId)`로 같은 origin URL을 만듭니다. 같은 origin의 기존 창만 focus하고 없으면 해당 상대 URL을 엽니다. payload의 절대 URL·scheme·host·임의 path, 알 수 없는 target/version, 과대·잘못된 ID는 탐색하지 않으며 dismiss도 no-op입니다.
- Android foreground Adapter는 notification payload만 `expense_notifications` ID, `지출 알림` 이름, 기본 중요도 channel로 표시하고 MainActivity를 엽니다. data-only payload를 표시하지 않는 현재 동작은 contract test로 유지합니다.
- Android 13+ POST_NOTIFICATIONS 권한 요청·거부 UX는 Android Host가 소유하지만 payload 수신과 표시 결과를 분리해 관측합니다.
- 현재 payload는 `notification-payload.v1`만 존재합니다. 알 수 없는 future version은 표시하지 않고 `ContractFailure`로 관측하며, v2를 도입할 때 지원할 이전 version과 호환 창을 별도 결정하고 그때 v1 PWA·Android consumer fixture를 고정합니다.

### 8.2 외부 연동

FCM 공급자를 바꿔도 Domain과 Ledger/Payment Capture는 수정하지 않습니다. `FirebaseMessagingPort.sendOne` Adapter만 새 구현으로 교체합니다. 한 호출은 endpoint 하나의 provider 응답을 내부 Result로 변환하고 provider 원문 DTO를 저장하지 않습니다.

Notification delivery 상태는 운영 Read Model일 뿐 거래 Canonical 상태가 아닙니다. Ledger Event를 재처리해도 Ledger 문서를 수정하지 않습니다.

## 9. 오류·보안·관측성

### 9.1 typed 오류

| 경계 | 안정 code | 결과 |
|---|---|---|
| 등록 인증 | `AUTH_REQUIRED`, `MEMBERSHIP_REQUIRED`, `APP_ATTESTATION_INVALID` | `Unauthenticated`·`Forbidden` |
| 등록 입력 | `FID_REQUIRED`, `MEMBER_REQUIRED`, `PLATFORM_REQUIRED` | `ValidationError` |
| command 멱등 | `IDEMPOTENCY_KEY_REUSED_WITH_DIFFERENT_PAYLOAD` | `Conflict`; endpoint 변경 없음 |
| Event contract | `UNKNOWN_PRODUCER`, `UNSUPPORTED_EVENT_VERSION`, `INVALID_EVENT_PAYLOAD` | `ContractFailure`·dead letter |
| 대상 계산 | `NO_RECIPIENT`, `NO_ACTIVE_ENDPOINT` | `NoData`/`NoTarget`; 성공과 구분 |
| Membership 재검증 | `RECIPIENT_MEMBERSHIP_INACTIVE` | provider 미호출, `StaleTarget` 최종 처리 |
| Membership 조회 실패 | `MEMBERSHIP_CHECK_UNAVAILABLE` | provider 미호출; Intent 생성 전이면 Inbox retryable, Delivery 직전이면 failed 최종 처리 |
| FCM | `PROVIDER_QUOTA`, `PROVIDER_TIMEOUT`, `FID_INVALID`, `FID_UNREGISTERED`, `PROVIDER_CREDENTIAL_INVALID` | failed·unknown·permanent FID·contract failure 최종 분류; 자동 재전송 없음 |
| purge | page별 retryable/permanent code | checkpoint 보존 |

### 9.2 보안·개인정보

- FID, FID hash와 민감 payload는 server-only이고 공개 Read Model과 일반 로그에서 제외합니다.
- `RegisterEndpoint`는 인증 uid, Membership, memberId와 App Check를 endpoint Repository 접근 전에 검증하며 FID 자체는 인증 수단으로 신뢰하지 않습니다.
- 다른 가구 query·register·remove·status 조회를 차단하고 가구 존재 정보도 불필요하게 노출하지 않습니다.
- 제거된 Membership은 endpoint가 아직 남아 있어도 recipient 계산과 provider 호출에서 모두 차단합니다. cleanup handler는 Access가 발행한 Event와 내부 SystemActor만 허용합니다.
- Canonical endpoint·delivery 컬렉션의 client write를 Rules로 거부합니다.
- payload에는 금융 알림 원문, 전체 카드 번호, 불필요한 멤버 표시 이름을 넣지 않습니다.
- click navigation은 서버 생성 enum·opaque ID에서 같은 origin 상대 URL만 만들고 외부 URL 입력을 받지 않습니다.

관측 필드는 event/delivery ID, producer/event version, household/member/endpoint의 비가역 hash, policy version, 대상·성공·실패·unknown count, provider class, attempt, latency입니다. `NoTarget`, partial, unknown-provider-outcome, permanent FID, contract drift, duplicate Inbox를 별도 metric으로 둡니다.

## 10. 목표 패키지 구조

```text
functions/src/contexts/notifications/                    # 목표
  domain/
    entities/member-notification-endpoint.ts
    entities/notification-delivery.ts
    policies/latest-endpoint-registration-policy.ts
    policies/household-notification-request-policy.ts
    policies/fcm-result-classifier.ts
    policies/safe-click-target-policy.ts
  application/
    commands/register-endpoint.ts
    commands/remove-endpoint.ts
    commands/deliver-notification.ts
    queries/get-delivery-status.ts
    event-handlers/transaction-recorded.ts
    event-handlers/household-notification-requested.ts
    event-handlers/capture-duplicate-observed.ts
    event-handlers/household-member-removed.ts
    ports/in/
    ports/out/
  adapters/out/firestore/
  adapters/out/fcm/firebase-send-one-adapter.ts
  public.ts

web/src/features/notifications/                         # 목표
web/src/platform/pwa/                                   # payload 소비 Adapter
android/feature/push-notifications/                     # payload 소비 Adapter
contracts/schemas/events/notifications/                 # 목표
contracts/schemas/read-models/notification-payload-v1.json
contracts/fixtures/notifications/
```

`public.ts`는 Input Port, wire DTO, Read Model, Event schema, 안정 오류 code만 export합니다. FID persistence DTO, Recipient Policy 구현, FCM provider DTO는 export하지 않습니다.

## 11. 테스트 설계

Repository Fake와 Firestore Adapter는 같은 Conformance Suite를 사용하며 `FixedClock`, `SequenceIdGenerator`, callback 2회 UoW, `InboxClaimFake`, FCM 성공·부분·일시·영구·contract drift fixture를 제공합니다.

| 요구사항 ID | 테스트 수준 | 테스트 대상 | 핵심 fixture/경계값 | 관찰 결과 | Canonical 테스트 ID |
|---|---|---|---|---|---|
| [PUSH-001](requirements.md#5-요구사항) | Client, E2E | 권한·FID capability controller | iOS 설치/미설치 PWA, desktop, Android 표시 권한 허용·거부 | 지원 환경만 FID 등록하며 registration token API 호출 없음 | `T-PUSH-004`, `T-PUSH-008` |
| [PUSH-002](requirements.md#5-요구사항) | Contract, Emulator | endpoint 등록 Mapper·저장 | 멤버 선택 전/후, platform/model/SDK, 같은 FID·다른 FID | 설치별 endpoint, 멤버별 복수 저장, 선택 전 없음, FID 비노출 | `T-PUSH-004`, `T-PUSH-008`, `T-PUSH-SEC-001` |
| [PUSH-003](requirements.md#5-요구사항) | Client, Integration | 등록·로그아웃 controller | PWA `register/onRegistered/onUnregistered`, Android `onRegistered`, 로그아웃·새 로그인, 원격·unregister·preference 실패와 timeout, process 재시작, 재설치·데이터 삭제, 권한 거부 | Android component 차단·알림 취소 선행, 정리 실패와 무관한 로그아웃, 세션 없는 시작 차단, stale unregister 뒤 재등록, 새 로그인 낡은 binding 복구, `onUnregistered` 조건부 inactive; `getToken/onNewToken` 미사용 | `T-PUSH-004`, `T-PUSH-008`, `T-PUSH-010` |
| [PUSH-004](requirements.md#5-요구사항) | Domain, Application | TransactionCreatedNotificationPolicy | Android·iPhone Shortcut·web-manual·recurring·system·unknown, creator 있음·누락, endpoint 혼재 | Android·web·recurring·system `NoTarget`, iPhone creator의 모든 active iOS PWA endpoint, unknown/creator 누락은 계약 실패 | `T-PUSH-001`, `T-PUSH-002`, `T-PUSH-005` |
| [PUSH-005](requirements.md#5-요구사항) | Domain, Application | HouseholdNotificationRequestPolicy | requester, creator≠requester, 가구원·endpoint 0·1·여러 개 | requester만 제외하고 다른 활성 가구원의 모든 모바일 endpoint, 없으면 `NoTarget` | `T-PUSH-005`, `T-PUSH-007` |
| [PUSH-006](requirements.md#5-요구사항) | PWA E2E, Contract | worker click Adapter | expenseId 있음/없음, 같은/다른 origin 기존 창, dismiss | 유효 편집 URL만 같은 origin focus/open, dismiss no-op | `T-PUSH-SEC-002` |
| [PUSH-007](requirements.md#5-요구사항) | Android UI, Contract | foreground Adapter·component gate | notification/data-only, Android 13 권한 허용/거부, 현재/다른/미확인 binding, 로그아웃·background payload | 현재 확인 binding의 notification만 지정 channel로 표시·MainActivity, 로그아웃 component 차단으로 foreground·background 모두 표시 0건 | `T-PUSH-009`, `T-PUSH-010` |
| [PUSH-008](requirements.md#5-요구사항) | Domain, Emulator, Concurrency | EndpointRegistrationPolicy·등록/삭제 UoW·단일 Delivery 시도 | endpoint 없음, 같은 FID 재등록, FID A·B 등록, A 로그아웃, 로컬 차단 뒤 삭제 누락·새 로그인, 404+UNREGISTERED·404 other·500·timeout·quota·network·credential·stale 404 | A·B 독립 활성, 동일 FID 갱신, A만 삭제, 삭제 유실 중 로컬 표시 차단과 다음 등록 수렴, endpoint별 sendOne 한 번, 현재 404+UNREGISTERED만 awaited inactive, 다른 결과 보존·재전송 없음 | `T-PUSH-004`, `T-PUSH-006`, `T-PUSH-010` |
| [PUSH-009](requirements.md#5-요구사항) | Contract, Security, Emulator | `RegisterEndpoint` 인가 | 무인증·타 가구·빈 member/FID·잘못된 App Check·다른 멤버 등록 | 권한/검증/Conflict와 endpoint Repository read/write 0회; FID를 인증으로 사용하지 않음 | `T-PUSH-SEC-001` |
| [PUSH-010](requirements.md#5-요구사항) | Application, Emulator | Inbox·Delivery idempotency | 같은 Event 재전달·worker 경합·callback 2회·send 결과 뒤 재호출 | endpoint별 delivery claim과 Admin send 정확히 한 번 | `T-PUSH-003`, `T-PUSH-006` |
| [PUSH-011](requirements.md#5-요구사항) | Domain, PWA E2E, Security | safe click Policy·worker Adapter | 절대 URL, javascript scheme, 외부 client, unknown target/version, ID 길이·문자 경계 | 외부 이동 없음, 유효 enum+ID만 URL API로 같은 origin 편집 경로 | `T-PUSH-SEC-002` |
| [PUSH-012](requirements.md#5-요구사항) | Application, Emulator, Concurrency, Security | 제거 Event cleanup·recipient/Delivery Membership gate | endpoint A·B, 다른 멤버 C, queued delivery, 지연·중복 제거 Event, 제거 뒤 복구 | A·B만 멱등 삭제, C·terminal 기록 유지, cleanup 전후 provider 호출 없음, 복구 시 endpoint 자동 부활 없음 | `T-PUSH-007` |
| [PUSH-013](requirements.md#5-요구사항) | Contract, Emulator, Concurrency, Security | `PurgeHouseholdData` participant | 대상·타 가구의 endpoint·Intent·Delivery·Inbox, 같은 process/checkpoint 재전달, 비승인 actor·논리 삭제 | 대상 page와 receipt 원자 처리·결과 재생, 타 가구·provider side effect 보존, 비승인 호출 변경 0건 | `T-PUSH-PURGE-001` |
| [IOS-009](../../../payment-capture/modules/shortcut-ingestion/requirements.md#5-요구사항) consumer | Application, Integration | `CaptureDuplicateNotificationHandler` | 생성자 iPhone endpoint 0·1, 중복 Event·delivery 재실행, provider 결과 | 새 거래 없이 기존 transaction 대상 intent, endpoint별 send 한 번, provider 실패가 원장을 변경하지 않음 | `T-IOS-NOTIFY-002` |

Context contract suite는 대상 없음·전체 성공·failed·unknown·permanent, 같은 delivery/Event 재호출 시 provider 호출 한 번, active endpoint TTL 없음, inactive·terminal 기록의 30일 expiresAt, 만료 Event의 `ExpiredEvent`, member rename 후 memberId 유지, 같은 FID 재등록, 다른 설치의 순차·동시 추가, 로그아웃 component 선차단과 원격·unregister·preference 실패 독립성, 세션 없는 process 재시작 차단, 삭제 유실 뒤 stale unregister와 새 로그인 binding 복구, 한 endpoint 404가 나머지를 비활성화하지 않음, stale 404 무시, 데스크톱 제외, 가구원 제거 cleanup 전후의 active Membership gate, endpoint별 전송 DTO가 `fid` 하나만 사용하고 multicast를 호출하지 않음, 현재 v1 payload와 알 수 없는 future version 거부, 안전한 click target, 같은 purge page 재전달을 검증합니다. 전체 무인증 함수 행렬은 [`T-SEC-002`](../../../../cross-cutting/security-privacy.md#7-보안-테스트-행렬)가 소유하고 이 모듈은 `T-PUSH-SEC-001`, `T-PUSH-SEC-002`에서 endpoint·click 경계를 검증합니다.

## 12. 미결정 사항과 구현 순서

Notifications의 제품 정책 미결정 사항은 없습니다. 보존 기간은 DEC-027로 확정되었습니다.

구현 순서는 (1) 현재 마지막 endpoint 덮어쓰기와 대상 계산·모든 오류 token 삭제·미완료 cleanup·PWA/Android payload characterization, (2) versioned payload schema·safe click consumer contract, (3) 최신 Firebase Client/Admin SDK와 FID 계약 적용, (4) Membership/App Check 선검증과 설치별 endpoint 등록·로그아웃 삭제·낡은 binding 복구 Command 및 동시성 test, (5) Ledger/Intake Event schema 및 Inbox, (6) 전체 originChannel Recipient Policy와 다중 endpoint delivery claim, (7) endpoint별 `sendOne(fid)` 한 번·awaited result transaction·현재 version의 404+UNREGISTERED 조건부 inactive·최종 status, (8) 제거 Event cleanup과 recipient·전송 직전 active Membership gate, (9) 기존 trigger를 Outbox consumer Facade로 전환, (10) FID Client와 서버를 함께 배포한 뒤 registration token writer·전송·multicast helper·`fcmTokens`를 제거, (11) paged purge 순입니다. 목표 운영 경로에는 provider 자동 retry, token fallback이나 dual-write를 남기지 않습니다.
