# 푸시 알림 모듈 요구사항

> 상위 Bounded Context: [Notifications](../../requirements.md)  
> 아키텍처 역할: Supporting Domain / Application  
> 상세 설계: [모듈 상세 설계](design.md)  
> 상태와 테스트 수준 표기는 [공통 문서 규칙](../../../../governance/conventions.md)을 따릅니다.

## 1. 독립 모듈 책임

이 모듈은 가구 멤버의 모바일 notification endpoint들을 등록하고 업무 event를 사용자 알림으로 변환해 전달합니다. 설치별 Firebase Installation ID(FID) endpoint 수명주기, 알림 대상 계산, payload 계약, 멱등 전송, 실패 endpoint 상태를 소유하며 거래 생성·수정과 Web·Android 화면 렌더링은 독립 모듈에 둡니다.

## 2. 포함·제외 범위

포함 범위:

- Android·iPhone 홈 화면 PWA의 FID 기반 endpoint 등록·로그아웃 삭제
- 가구·멤버별 복수 notification endpoint와 설치별 상태
- 거래 생성과 명시적 가구원 알림 요청 event의 대상 계산
- FCM payload 생성, 전송 결과와 실패 분류
- 백그라운드 Web 알림 클릭 계약과 Android foreground 표시 계약
- trigger 재전달에 안전한 멱등 전송

제외 범위:

- 거래 생성·수정 자체와 legacy `notifyPartnerAt` 기록 UI
- iOS Shortcut 메시지 파싱과 HTTP 응답
- PWA cache 전략과 Android WebView 수명주기
- 멤버 식별·권한 정책의 최종 소유권
- 브라우저 또는 Android OS가 알림을 실제 표시하는 내부 구현

## 3. 소유 데이터

| 데이터 | 이 모듈의 권한 | 비고 |
|---|---|---|
| `NotificationEndpoint` | 소유 | 목표 모델은 FID 설치별 endpoint와 현재 householdId·memberId binding, platform, metadata, 상태를 표현합니다. 한 멤버가 여러 endpoint를 가질 수 있으며 현재 `fcmTokens`는 제거할 legacy 저장소입니다. |
| 알림 payload DTO | 소유 | Web worker와 Android 수신기가 공유하는 versioned contract입니다. |
| 전송 event 멱등 키·전송 결과 | 소유 | trigger 재전달과 운영 관측에 사용합니다. 현재 저장 모델은 없습니다. |
| `expenses` | 비소유 Reader | 거래 event와 알림 요청 metadata만 소비합니다. |
| `households` | 읽기 의존 | 멤버십·가구 범위 검증에 사용합니다. |

## 4. 공개 계약·의존 모듈

공개 명령은 `RegisterNotificationEndpoint`, `RemoveNotificationEndpoint`, `NotifyExpenseCreated`, `NotifyHouseholdMembersRequested`입니다. 로그인 등록은 설치 endpoint 생성·갱신 결과를, 로그아웃 제거는 서버 endpoint 삭제 결과를 반환합니다. 별도의 endpoint 멤버 전환 명령은 없습니다. 알림 결과는 대상 없음, 전달 성공, 일부 실패, 일반 실패, provider 결과 불명, 영구 FID 실패, provider 계약 실패와 stale target을 구분해야 하며 클릭 payload에는 version과 선택 `expenseId`를 포함합니다.

의존 모듈:

- [가구·접근](../../../access-household/modules/household-access/requirements.md): 인증된 멤버십과 안정적인 memberId 검증
- [거래 원장](../../../household-finance/modules/ledger/requirements.md): 거래 생성·가구원 알림 요청 event 제공
- [iOS Shortcut 입력](../../../payment-capture/modules/shortcut-ingestion/requirements.md): owner 대상 알림 명령과 전달 결과 소비
- [Android Host](../../../../supporting-platform/modules/android-host/requirements.md): FID 등록 callback과 foreground payload 표시
- [PWA](../../../../supporting-platform/modules/pwa/requirements.md): Web messaging worker의 백그라운드 표시·클릭 처리
- FCM Adapter: 외부 전송과 오류 코드 분류

## 5. 요구사항

| ID | 상태 | 요구사항 | 경계·예외 | 근거 | 테스트 |
|---|---|---|---|---|---|
| PUSH-001 | 목표 명세 | 지원 모바일 환경은 FCM에 앱 설치를 FID 기반으로 등록하고 `onRegistered`가 전달한 Firebase Installation ID를 알림 endpoint 주소로 사용한다. | iOS는 홈 화면 설치 PWA이면서 알림 권한이 허용된 경우에만 등록하고 데스크톱은 등록하지 않는다. Android의 FID 등록과 POST_NOTIFICATIONS 표시 권한은 별도 capability다. 앱 내부 유형별 알림 설정은 없고 OS 권한이 설치의 전체 푸시 표시를 제어한다. registration token API는 사용하지 않는다. | [DEC-019](../../../../governance/decisions.md#dec-019), [DEC-026](../../../../governance/decisions.md#dec-026), 현재 legacy [pushNotificationService](../../../../../../web/src/lib/pushNotificationService.ts) | U, I, E2E |
| PUSH-002 | 목표 명세 | FID는 가구, 현재 `memberId`, platform, 최소 device metadata와 함께 설치별 `NotificationEndpoint`에 server-side로 저장한다. | 한 멤버는 여러 endpoint를 가질 수 있지만 한 endpoint는 동시에 한 household/member에만 연결한다. FID는 사용자·멤버 인증 ID가 아니며 로그인과 서버 Membership 검증 전에는 저장하지 않는다. FID 원문은 공개 Read Model과 일반 로그에 노출하지 않는다. | [DEC-019](../../../../governance/decisions.md#dec-019), [DEC-020](../../../../governance/decisions.md#dec-020), [FID endpoint manager](../../../../../../android/app/src/main/java/com/household/account/util/FidEndpointManager.kt) | C, I, 보안 E2E |
| PUSH-003 | 목표 명세 | Web/PWA는 `register()`와 `onRegistered(fid)`를, Android는 FID 기반 등록 활성화와 `onRegistered(fid)`를 사용해 로그인한 멤버의 현재 설치 endpoint를 서버에 등록한다. Web/PWA는 로그인 세션이 `ready`가 될 때마다 알림 권한이 이미 허용된 설치에서도 `register()`를 다시 호출해 서버 상태를 현재 FID로 수렴시킨다. 로그아웃은 해당 서버 endpoint를 삭제하고, `onUnregistered(fid)`는 조건부 inactive로 반영한다. Android는 로그아웃 시 서버 요청보다 먼저 FCM 수신 component를 비활성화하고 이미 표시된 앱 알림을 취소한다. | Client는 브라우저 권한 허용만으로 endpoint를 활성 상태로 표시하지 않고 서버 `RegisterEndpoint` 성공까지 확인한다. 등록 실패는 로그인과 가계부 사용을 막지 않으며 설정 화면에 재연결 상태를 표시하고, 사용자의 재연결 요청 또는 다음 로그인에서 다시 시도한다. 별도 멤버 전환 API는 없으며 `로그아웃 삭제 → 다른 멤버 로그인 등록` 순서로 소속이 바뀐다. Android의 서버 삭제·로컬 unregister·억제 상태 저장은 유한 시간 best-effort이고 실패해도 로그아웃을 막지 않으며, component 차단은 그 실패와 독립적이어야 한다. 로컬 세션 없이 시작하면 component를 차단하고, 다음 로그인은 필요한 stale unregister 뒤 component를 활성화해 등록한다. 삭제 누락 시 새 로그인 등록이 동일 FID의 낡은 binding을 원자 교체한다. 앱 재설치·데이터 삭제·새 기기 복원으로 새 FID가 생기면 기존 endpoint를 덮어쓰지 않고 추가한다. active endpoint에는 TTL이 없고 inactive endpoint는 30일 뒤 삭제 대상이다. `getToken`·`onNewToken`과 FID API를 함께 사용하지 않는다. | [DEC-019](../../../../governance/decisions.md#dec-019), [DEC-020](../../../../governance/decisions.md#dec-020), [DEC-027](../../../../governance/decisions.md#dec-027), [FID endpoint manager](../../../../../../android/app/src/main/java/com/household/account/util/FidEndpointManager.kt), [FCM component gate](../../../../../../android/app/src/main/java/com/household/account/notifications/FcmServiceComponentGate.kt) | I, UI, E2E |
| PUSH-004 | 목표 명세 | `TransactionRecorded.v1`의 `originChannel`에 따라 자동 등록 지출의 후속 UX를 결정한다. | `android-notification`은 푸시 대상 없음이며 발생 Android가 로컬 QuickEdit만 실행한다. `ios-shortcut`은 `creatorMemberId` 본인의 모든 활성 iPhone PWA endpoint를 대상으로 편집 링크 푸시를 만든다. `web-manual`, `recurring`, `system`은 거래 생성만으로 자동 푸시를 만들지 않는다. 알 수 없는 채널도 푸시는 만들지 않지만 조용한 성공이 아니라 typed `ContractFailure(UNKNOWN_ORIGIN_CHANNEL)`로 종료한다. 다른 가구원 전송은 PUSH-005의 명시적 요청에서만 수행하며 creator 누락으로 전송을 억제하는 구현은 허용하지 않는다. | [Notification Outbox consumer](../../../../../../functions/src/bootstrap/firebaseNotificationOutbox.ts), [DEC-013](../../../../governance/decisions.md#dec-013), [DEC-020](../../../../governance/decisions.md#dec-020) | U, I, E2E |
| PUSH-005 | 목표 명세 | 사용자가 지출에서 `알림 보내기`를 요청하면 요청자를 제외한 같은 가구의 활성 멤버 모두의 활성 Android·iPhone PWA endpoint에 알린다. | 인증된 requesterMemberId가 필수다. 거래 생성자와 요청자가 달라도 requester만 제외하며, requester 외 활성 endpoint가 없으면 `NoTarget`이다. 단일 partner·first-match와 데스크톱은 대상이 아니다. | 같은 근거와 [DEC-013](../../../../governance/decisions.md#dec-013), [DEC-020](../../../../governance/decisions.md#dec-020), [DEC-022](../../../../governance/decisions.md#dec-022) | U, I, E2E |
| PUSH-006 | 현재 명세 | 백그라운드 알림 클릭 시 expenseId가 있으면 편집 URL을 열고 기존 창을 포커스한다. | dismiss는 이동하지 않는다. | [Firebase messaging service worker](../../../../../../web/public/firebase-messaging-sw.js) | E2E |
| PUSH-007 | 현재 명세 | Android foreground notification payload는 ID expense_notifications, 이름 지출 알림인 기본 중요도 채널로 시스템 알림을 표시하고 MainActivity를 연다. 표시 시점의 로컬 session과 서버에서 확인된 FID household/member binding이 정확히 일치할 때만 표시한다. | data-only 메시지는 표시하지 않는다. 로그아웃·미확인 binding·억제 상태에서는 foreground 표시를 거부하고, 로그아웃 기기의 background notification 자동 표시는 비활성 `FcmService` component로 차단한다. Android 13 런타임 권한 누락은 결함이다. | [FcmService](../../../../../../android/app/src/main/java/com/household/account/service/FcmService.kt), [FCM component gate](../../../../../../android/app/src/main/java/com/household/account/notifications/FcmServiceComponentGate.kt) | U, UI, E2E |
| PUSH-008 | 목표 명세 | 한 가구 멤버는 Android·iPhone 홈 화면 PWA의 활성 endpoint를 여러 개 유지하고 수신 정책이 선택한 모든 endpoint로 fan-out한다. 같은 FID 재등록은 같은 endpoint를 갱신하고 새 FID는 별도 endpoint로 추가한다. | 로그아웃하면 해당 설치의 서버 endpoint를 삭제하고 다음 로그인에서 다시 등록한다. 한 FID는 동시에 한 household/member에만 연결하며 낡은 binding은 등록 transaction이 원자 교체한다. Application delivery worker는 claim한 endpoint별 Firebase Admin 단일 send를 정확히 한 번 호출하고 결과를 받거나 결과 불명으로 끝난 뒤에는 다시 호출하지 않는다. `404`이면서 `UNREGISTERED`이고 전송에 사용한 registration/binding version이 현재와 같을 때만 inactive로 바꾸며 다른 오류는 endpoint 상태를 유지한다. timeout·일시 오류도 자동 재전송하지 않는다. | [DEC-019](../../../../governance/decisions.md#dec-019), [DEC-020](../../../../governance/decisions.md#dec-020), [DEC-025](../../../../governance/decisions.md#dec-025) | U, I, 동시성 E2E |
| PUSH-009 | 결함 | FID 등록 API는 Firebase Auth, 활성 Membership, 존재하는 가구와 멤버, App Check, 비어 있지 않은 FID를 서버에서 검증해야 한다. | FID 자체를 인증 증명으로 신뢰하지 않는다. Auth·Membership·member binding·App Check가 모두 성공하기 전에는 endpoint Repository를 조회·생성·갱신하거나 낡은 binding을 교체하지 않는다. 기존 `saveFcmToken`의 결함은 인증된 공통 Command 경로로 교체한다. | [Notification command handler](../../../../../../functions/src/bootstrap/commands/notificationHouseholdCommandHandlers.ts), [DEC-019](../../../../governance/decisions.md#dec-019), [DEC-020](../../../../governance/decisions.md#dec-020) | C, I, 보안 E2E |
| PUSH-010 | 결함 | Firestore trigger 재전달에도 사용자에게 같은 알림을 endpoint별 한 번만 발송하는 멱등 정책이 필요하다. | 현재 푸시 event 멱등 키가 없다. 목표 delivery key는 `(eventId, recipientMemberId, endpointId)`이며 terminal Inbox·Intent·Delivery는 30일 보존한다. 30일이 지난 Event는 기록 삭제 후 재도착해도 `ExpiredEvent`로 끝낸다. | 같은 근거, [DEC-020](../../../../governance/decisions.md#dec-020), [DEC-027](../../../../governance/decisions.md#dec-027) | U, I |
| PUSH-011 | 결함 | 알림 클릭은 서버가 생성한 versioned `clickTarget` enum과 검증된 opaque ID만 사용해 같은 origin의 허용된 상대 경로로 이동해야 한다. | payload의 절대 URL·scheme·host·임의 path는 탐색 대상으로 신뢰하지 않는다. `expenseId`는 길이·문자 계약을 검증하고 URL API로 query에 넣으며 알 수 없는 target/version은 이동하지 않는다. 현재 창 focus도 같은 origin client로 제한한다. | [Firebase messaging service worker](../../../../../../web/public/firebase-messaging-sw.js) | C, E2E, 보안 E2E |
| PUSH-012 | 목표 명세 | `HouseholdMemberRemoved.v1`을 받으면 해당 householdId·memberId의 모든 endpoint를 멱등하게 정리하고 제거된 Membership을 새 알림의 recipient로 선택하지 않는다. | endpoint 정리 Event가 지연되어도 recipient 계산과 provider 전송 직전에 Access의 active Membership을 확인해 제거된 사용자에게 보내지 않는다. 복구 Event로 과거 endpoint를 되살리지 않으며 사용자가 다시 로그인한 설치만 신규 등록한다. 다른 멤버 endpoint와 기존 terminal delivery는 변경하지 않는다. | [DEC-038](../../../../governance/decisions.md#dec-038) | U, I, 동시성, 보안 E2E |
| PUSH-013 | 목표 명세 | Notifications는 승인된 Access `HouseholdPurgeProcess`의 `PurgeHouseholdData(householdId, processId, checkpoint)`에 참여해 해당 가구의 endpoint·Intent·Delivery·Inbox를 결정적 page로 제거한다. | `householdLifecycle:purge` SystemActor만 호출할 수 있고 같은 processId·checkpoint 재호출은 동일 `PurgePageResult`를 재생한다. 타 가구 데이터와 provider 전송 side effect는 변경하지 않으며 일반 논리 삭제에서는 호출하지 않는다. | [Notifications Context](../../requirements.md#6-공개-계약과-의존-방향), [DEC-040](../../../../governance/decisions.md#dec-040) | C, I, 동시성, 보안 E2E |

## 7. 정상 요구사항으로 고정하지 않을 결함

- 현재 코드는 deprecated registration token API(`getToken`, `onNewToken`, `tokens`)와 `fcmTokens` 저장소를 사용합니다. 목표 구조는 FID API와 endpoint별 `sendOne(fid)` 전송으로 교체하며 token fallback·multicast를 두지 않습니다.
- 현재 토큰 문서 ID가 가구와 멤버 이름 조합이어서 이름 변경이 여러 컬렉션을 연쇄 수정합니다.
- `saveFcmToken` callable이 인증, 가구 존재, 멤버 소속을 검증하지 않습니다.
- Firestore trigger 재전달을 식별할 멱등 키가 없어 같은 사용자 알림이 여러 번 발송될 수 있습니다.
- 현재 구현은 `createdBy` 유무를 알림 gate로 사용해 생성자 기록과 채널별 알림 정책이 결합되어 있습니다. Android·Shortcut 거래의 생성자를 항상 기록하고 source별 수신 정책으로 분리해야 합니다.
- 실패한 FCM registration token을 오류 종류와 무관하게 삭제하고 일부 `delete()` Promise 완료를 기다리지 않습니다. 목표 구현은 endpoint별 Admin send 결과를 분류하고 현재 version의 `404+UNREGISTERED` inactive transaction만 반드시 await합니다. (`PUSH-008`)
- Android 13 이상에서 알림 표시 런타임 권한 요청이 없어 payload를 받아도 표시하지 못할 수 있습니다.
- foreground Web 메시지 listener는 구현되어 있으나 운영 호출자가 없습니다.
- endpoint 등록 실패와 비동기 전송 실패를 UI·호출자에게 전달하지 않아 저장 성공과 알림 전달 성공을 구분하기 어렵습니다.

## 8. 관련 제품 결정

| 결정 | 상태 | 이 모듈에 미치는 영향 |
|---|---|---|
| [DEC-013](../../../../governance/decisions.md#dec-013) | 확정 | Android는 QuickEdit만 실행하고, iPhone Shortcut은 생성자 본인에게 푸시하며, 명시적 알림 요청은 요청자 외 모든 가구원에게 보냅니다. |
| [DEC-019](../../../../governance/decisions.md#dec-019) | 확정 | Android·PWA 등록 주소와 서버 직접 전송 대상을 FID로 통일하고 registration token API와 fallback을 제거합니다. |
| [DEC-020](../../../../governance/decisions.md#dec-020) | 확정 | 멤버별 다중 모바일 endpoint를 허용하고 로그아웃 삭제·로그인 등록·404 inactive 수명주기를 적용하며 데스크톱은 제외합니다. |
| [DEC-022](../../../../governance/decisions.md#dec-022) | 확정 | partner 저장·선택 없이 requester를 제외한 모든 활성 가구원 endpoint를 계산하며 legacy 명칭은 전환 Mapper에서만 처리합니다. |
| [DEC-025](../../../../governance/decisions.md#dec-025) | 확정 | delivery별 FCM 전송은 한 번만 시도하고 timeout·일시 오류는 최종 상태로 기록하며 자동 재전송하지 않습니다. |
| [DEC-026](../../../../governance/decisions.md#dec-026) | 확정 | 서버 Subscription과 유형별 설정 UI를 만들지 않고 OS 권한만 전체 푸시 표시를 제어하며 QuickEdit 설정은 분리합니다. |
| [DEC-027](../../../../governance/decisions.md#dec-027) | 확정 | active endpoint는 TTL 없이 유지하고 inactive endpoint와 terminal 알림 처리 기록은 30일 뒤 삭제 대상으로 표시합니다. |
| [DEC-038](../../../../governance/decisions.md#dec-038) | 확정 | 전체 관리자에 의해 제거된 가구원은 즉시 수신 대상에서 제외하고 연결 endpoint를 멱등 정리하며 복구 시 자동 복원하지 않습니다. |

## 9. 모듈 테스트 시나리오

| 테스트 ID | 종류 | Given / When / Then | 연결 요구사항 |
|---|---|---|---|
| T-PUSH-001 | 목표 | creatorMemberId가 있는 Android·iPhone Shortcut 지출 / 거래 생성 Event / Android는 `NoTarget`, iPhone은 생성자 본인의 모든 활성 iPhone PWA endpoint에 편집 푸시 | PUSH-004, DEC-013, DEC-020 |
| T-PUSH-002 | 특성화 | recurring source 생성 / trigger / 새 거래 푸시 없음 | REC-004, PUSH-004 |
| T-PUSH-003 | 목표 | 같은 trigger event 재전달, terminalAt+29일·30일 TTL 경계, 30일 지난 Event 재도착 / 실행 / 보존 중 provider 호출 한 번, 만료 뒤 `ExpiredEvent`이며 새 알림 없음 | PUSH-010, DEC-027 |
| T-PUSH-004 | 목표 | 같은 멤버의 FID A·B 등록, 같은 FID 재등록, A 로그아웃, A 삭제 누락 뒤 다른 멤버 로그인, B 전송 404·timeout, stale 404, desktop 로그인 / 실행 / A·B 모두 활성 fan-out, 재등록은 한 endpoint 갱신, 로그아웃은 A만 삭제, 새 로그인은 A binding 원자 교체, 현재 404만 inactive, timeout은 unknown으로 한 번만 시도, stale 404는 활성 유지, desktop endpoint 없음 | PUSH-001, PUSH-003, PUSH-008, DEC-019, DEC-020, DEC-025 |
| T-PUSH-005 | 목표 | Android·iOS Shortcut·Web manual·recurring·system 거래와 별도 명시 알림 요청 / Event 처리 / Android·Web·recurring·system은 자동 푸시 없음, iOS는 생성자 iPhone만, 명시 요청은 요청자 외 활성 가구원 전원 | PUSH-004, PUSH-005, DEC-013 |
| T-PUSH-006 | 목표 | endpoint A 성공, B 404+UNREGISTERED, C 404 다른 오류, D 500, E timeout, F quota, G network, H credential 오류와 B의 동시 재등록 / delivery / endpoint별 Admin send 한 번, 현재 version B만 awaited inactive, C~H·stale B는 활성, 고유 terminal 결과 보존과 재호출 없음 | PUSH-008, PUSH-010, DEC-025 |
| T-PUSH-007 | 목표·보안·동시성 | 제거 대상 Member의 endpoint A·B와 다른 Member endpoint C, 이미 queued delivery, 지연·중복 `HouseholdMemberRemoved.v1` / recipient 계산·cleanup·delivery / A·B는 제거되고 C와 기존 terminal delivery는 유지되며, cleanup 전후 모두 active Membership 재검증으로 대상 Member에 provider 호출이 없음 | PUSH-005, PUSH-012, HH-012, DEC-038 |
| T-PUSH-008 | 목표·Client·Contract | 로그인 전·후, 이미 권한이 허용된 iPhone 홈 화면 PWA의 inactive endpoint, 서버 등록 성공·실패, Android 표시 권한 거부, 일반 브라우저, desktop, `onRegistered`·`onUnregistered`, 앱 재설치 새 FID / endpoint 등록 controller와 설정 UI / 지원 모바일과 로그인 완료 뒤에만 Firebase Installation ID callback으로 등록하고, 로그인마다 같은 FID도 서버 재등록해 inactive endpoint를 복구하며, 서버 성공 전에는 활성 표시하지 않고 실패 시 재연결을 제공한다. registration token API는 surface에 없으며 설치별 endpoint·metadata·조건부 inactive·로그아웃 삭제가 수렴 | PUSH-001, PUSH-002, PUSH-003, DEC-019, DEC-020, DEC-026 |
| T-PUSH-009 | 현재 명세·Android Contract | Android 12·13의 notification payload, data-only·알 수 없는 version, 표시 권한 허용·거부 / foreground 수신 / 유효 notification만 `expense_notifications` 기본 중요도 채널에 표시하고 MainActivity를 열며 나머지는 typed 미표시 결과와 표시 0건 | PUSH-007 |
| T-PUSH-010 | 목표·Android·동시성 | 로그인된 설치에서 로그아웃, 서버 삭제·Firebase unregister·억제 상태 저장 각각의 실패·timeout, process 재시작, 같은/다른 멤버 재로그인 / endpoint detach·등록 / component 차단과 알림 취소가 항상 네트워크보다 먼저 시도되고 나머지 정리 실패가 로그아웃을 막지 않으며, 세션 없는 재시작은 차단을 유지하고 stale unregister 뒤 재등록·binding 확인에서만 현재 session foreground 표시를 허용 | PUSH-003, PUSH-007, PUSH-008, DEC-020 |
| T-PUSH-SEC-001 | 목표 | 무인증 RegisterEndpoint·rename·Shortcut·dividend save / 호출 / 모두 권한 오류와 변경 없음 | ADM-002, IOS-010, PUSH-009 |
| T-PUSH-SEC-002 | 목표 | 악성 절대 URL·외부 origin client·과대/잘못된 expenseId·알 수 없는 target/version / 알림 클릭 / 외부 이동 없음, 유효 payload만 같은 origin 편집 URL focus/open | PUSH-006, PUSH-011 |
| T-PUSH-PURGE-001 | 목표·보안·동시성 | 대상·타 가구 endpoint·Intent·Delivery·Inbox, 논리 삭제와 승인된 purge, 같은 processId·checkpoint 재전달 / page purge / 대상 page만 한 번 제거하고 같은 결과 재생, 타 가구·provider 호출 보존, 비승인·논리 삭제 호출은 변경 0건 | PUSH-013, ADM-003, DEC-040 |

추가 계약 테스트에서는 명시적 요청자 외 가구원 0·1·여러 명과 각 멤버의 endpoint 0·1·여러 개, 생성자와 요청자가 다른 경우, 동일 FID 재등록, 서로 다른 설치의 순차·동시 추가, 대상 FID 없음, 앱 재설치 후 새 FID 추가, 로그아웃 삭제, 새 로그인 binding 교체, `onUnregistered`·404의 stale version 조건부 inactive, 일시 실패·영구 실패, 일부 성공, OS 권한 on/off와 서버 Subscription 부재, QuickEdit 설정 독립, `expenseId` 유무, Android notification/data-only payload, 데스크톱 제외를 구분합니다. Client 계약 테스트는 `getToken`·`onNewToken` 호출이 없고 Application이 endpoint별 `fid` 하나로 Admin send를 한 번만 호출하는지도 검증합니다. 현재 payload version은 `notification-payload.v1` 하나뿐이며 v2를 도입할 때 지원할 이전 version과 호환 창은 별도 결정으로 확정합니다.

## 10. 코드 근거

- [알림 Outbox consumer](../../../../../../functions/src/bootstrap/firebaseNotificationOutbox.ts)
- [FID Command handler](../../../../../../functions/src/bootstrap/commands/notificationHouseholdCommandHandlers.ts)
- [Web 푸시 서비스](../../../../../../web/src/lib/pushNotificationService.ts)
- [Web 앱 초기화](../../../../../../web/src/components/AppProviders.tsx)
- [Web messaging service worker](../../../../../../web/public/firebase-messaging-sw.js)
- [Android FID endpoint 등록](../../../../../../android/app/src/main/java/com/household/account/util/FidEndpointManager.kt)
- [Android FCM 수신](../../../../../../android/app/src/main/java/com/household/account/service/FcmService.kt)
- [Android WebView host bridge](../../../../../../android/app/src/main/java/com/household/account/webhost/AndroidHostBridge.kt)
- [Android 거래 모델](../../../../../../android/app/src/main/java/com/household/account/data/Expense.kt)
- [Web 거래 서비스](../../../../../../web/src/lib/expenseService.ts)
