# Notifications Bounded Context 요구사항 지도

> 문서 유형: Business Bounded Context  
> 소유 기능 모듈: [푸시 알림](modules/notifications/requirements.md)  
> 소유 요구사항: `PUSH-*` — 13개  
> 목표 구조: [목표 Clean Architecture 설계](../../../architecture/target-clean-architecture.md#5-bounded-context와-기능-모듈)

## 1. 책임과 경계

Notifications Context는 **업무 Event를 올바른 가구 멤버의 활성 endpoint들에 멱등하게 전달하는 과정**을 소유한다. 설치별 endpoint 등록·삭제, 수신 대상 정책, versioned payload, 전송 결과, 실패 endpoint 상태를 담당한다.

상세 요구사항은 [푸시 알림 모듈](modules/notifications/requirements.md)이 한 번만 소유한다. PWA worker와 Android FCM Service는 이 Context의 payload 계약을 소비하는 Delivery Adapter이며 대상 계산과 전송 정책을 소유하지 않는다.

포함 범위:

- 사용자·기기 endpoint 등록과 제거
- 가구·멤버에 연결된 복수 notification endpoint와 OS 표시 capability
- 거래 생성·명시적 가구원 알림 요청 Event의 수신 대상 정책
- payload version과 클릭 목적지
- FCM 전송, 결과 분류, 영구 실패 endpoint 정리
- Event 재전달에 안전한 delivery claim과 endpoint별 단일 전송 시도
- 제거된 가구원의 endpoint 멱등 정리와 recipient·전송 직전 활성 Membership 재검증

제외 범위:

- 거래 생성·수정과 creator 정책의 최종 소유권
- Shortcut·Android 결제 parser
- PWA cache와 Android WebView 수명주기
- OS가 알림을 표시하는 내부 구현
- Access의 멤버 생명주기와 Role 정책

## 2. 내부 기능과 요구사항

| 기능 영역 | 요구사항 | 개수 | 상세 소유 문서 |
|---|---|---:|---|
| FCM FID endpoint 등록 | PUSH-001~003, PUSH-008~009 | 5 | [푸시 알림](modules/notifications/requirements.md#5-요구사항) |
| 거래 생성·명시적 가구원 알림 대상과 전송·멤버 lifecycle | PUSH-004~007, PUSH-010~012 | 7 | [푸시 알림](modules/notifications/requirements.md#5-요구사항) |
| 가구 영구 purge 참여 | PUSH-013 | 1 | [푸시 알림](modules/notifications/requirements.md#5-요구사항) |
| 합계 |  | 13 |  |

## 3. 공통 언어

| 용어 | 의미 |
|---|---|
| Firebase Installation ID (FID) | Firebase 앱 설치 인스턴스의 FCM 직접 전송 주소. 사용자·가구원 identity가 아니며 인증 수단으로 사용하지 않음 |
| Notification Endpoint | 하나의 Android 또는 iPhone 홈 화면 PWA 설치에 대응하는 FID 전달 주소와 현재 멤버 binding, platform, metadata, 상태 |
| Endpoint Binding | 하나의 endpoint를 현재 로그인한 하나의 `(householdId, memberId)`에 연결한 관계 |
| Notification Intent | 업무 Event에서 생성한 수신자·template·payload 의도 |
| Recipient | 안정적인 memberId로 표현한 수신 대상 |
| Delivery | Intent를 특정 endpoint로 전달하려는 멱등 실행과 결과 |
| Permanent Failure | FID 미등록·폐기처럼 endpoint를 조건부 비활성화할 최종 실패 |
| Unknown Provider Outcome | timeout처럼 실제 전달 여부를 알 수 없지만 자동 재전송하지 않는 최종 결과 |
| Delivery Failure | quota·일시 network·계약 오류처럼 endpoint를 비활성화하지 않고 자동 재전송도 하지 않는 최종 실패 |
| Payload Version | PWA·Android Adapter가 호환 처리해야 하는 Wire Contract 버전 |

## 4. Aggregate와 소유 데이터

| Aggregate·데이터 | 핵심 불변식 | 현재 저장 | 목표 소유 형태 |
|---|---|---|---|
| NotificationEndpoint | 설치 FID 하나와 현재 householdId·memberId binding, platform·metadata·상태 | 멤버 이름 기반 registration token 문서 | endpointId 기반 복수 FID endpoint |
| NotificationDelivery | event·recipient·endpoint 한 번, 단일 전송 시도와 최종 결과 | 명시 저장 없음 | delivery claim/status |
| Payload Contract | version, type, 선택 expenseId, click target | Web/Android에 분산 | 생성 DTO와 contract test |

각 `(householdId, memberId)`는 [DEC-020](../../governance/decisions.md#dec-020)에 따라 Android와 iPhone 홈 화면 PWA의 활성 `NotificationEndpoint`를 여러 개 가질 수 있습니다. [DEC-019](../../governance/decisions.md#dec-019)에 따라 전달 주소는 FID만 허용합니다. 같은 FID 재등록은 해당 endpoint의 확인 시각·metadata·registration version을 갱신하고, 새 FID는 기존 endpoint를 덮어쓰지 않고 별도 endpoint로 추가합니다. 데스크톱 브라우저는 endpoint를 등록하지 않습니다.

NotificationEndpoint는 Notifications가 소유합니다. 하나의 endpoint는 동시에 한 `(householdId, memberId)`에만 연결되며, 가구 purge는 현재 그 household에 연결된 endpoint와 Delivery, Inbox/recipient 상태만 제거합니다.

식별자 역할은 다음처럼 구분합니다.

```text
memberId = 알림을 받을 사람
NotificationEndpoint = 특정 앱 설치의 알림 주소록 한 칸
FID = 그 endpoint가 FCM에 사용하는 전달 주소
```

예를 들어 같은 멤버가 Android 설치 A의 `FID-A`와 iPhone PWA 설치 B의 `FID-B`를 등록하면 두 endpoint가 모두 활성 상태로 남고 둘 다 알림을 받을 수 있습니다. 멤버를 바꾸는 별도 기능은 없습니다. 설치 B에서 로그아웃하면 `FID-B` endpoint를 서버에서 삭제하고, 다른 멤버로 로그인하면 같은 `FID-B`를 새 멤버 endpoint로 등록합니다. 이전 삭제가 네트워크 문제로 누락된 경우에도 새 로그인 등록이 동일 FID의 binding을 원자적으로 교체하여 이중 연결을 막습니다.

## 5. Context 불변식

1. endpoint 등록은 인증된 Principal과 허용된 Household/Member 관계를 검증한다.
2. 표시 이름이 아니라 안정적인 memberId를 수신자 식별자로 사용한다.
3. 한 멤버는 활성 endpoint를 여러 개 가질 수 있고, 각 endpoint는 동시에 한 household/member에만 연결된다.
4. 같은 FID 재등록은 같은 endpoint의 확인 시각·metadata·registration version을 갱신하며, 새 FID 등록은 별도 endpoint를 추가한다.
5. 거래 생성 자동 알림과 사용자가 명시한 `알림 보내기` 요청을 서로 다른 수신자 정책으로 처리한다.
6. Android 자동 등록은 푸시 없이 발생 기기의 QuickEdit만 사용하고, iPhone Shortcut 자동 등록은 생성자 본인의 모든 활성 iPhone PWA endpoint에 편집 푸시를 보낸다.
7. 명시적 `알림 보내기`는 인증된 요청자를 제외한 활성 가구원 전체의 모든 활성 모바일 endpoint를 대상으로 한다.
8. 동일 업무 Event·수신자·endpoint 조합은 한 번만 전달한다.
9. 대상 없음, 전체 성공, 일부 실패, 일반 실패, provider 결과 불명, 영구 FID 실패를 구분하며 자동 재전송하지 않는다.
10. FCM 실패가 Ledger transaction을 롤백하지 않는다.
11. `404 UNREGISTERED`는 전송에 사용한 endpoint의 FID와 registration version이 여전히 일치할 때만 해당 endpoint를 `inactive`로 전환한다. 일시 장애·quota·timeout·payload·credential 오류에는 endpoint 상태를 바꾸지 않는다.
12. payload version과 click target은 PWA·Android contract test를 통과해야 한다.
13. FID와 민감 payload를 일반 로그나 공개 Read Model에 노출하지 않는다.
14. 가구 purge는 같은 processId·checkpoint 재호출에 안전하고 household-scoped 상태만 page 단위로 삭제한다.
15. 가구 purge는 현재 해당 가구에 연결된 endpoint만 삭제한다.
16. Android·PWA Client는 FID 등록 API만 사용하고, FCM Adapter는 `fid`·`fids` 전송 필드만 사용한다. registration token API와 fallback을 함께 운영하지 않는다.
17. 앱 내부 Subscription·알림 유형별 설정은 없으며 OS 알림 권한만 해당 설치의 전체 푸시 표시를 제어한다. QuickEdit 설정은 푸시와 분리한다.
18. active endpoint는 TTL 없이 유지하고 inactive endpoint와 terminal Inbox·Intent·Delivery·command receipt는 30일 보존한다. 30일이 지난 Event는 새 delivery를 만들지 않는다.
19. 제거된 Membership은 endpoint cleanup 완료 여부와 무관하게 recipient 계산과 provider 호출 직전 모두 제외하며, 복구 시 과거 endpoint를 되살리지 않는다.

## 6. 공개 계약과 의존 방향

### 제공 계약

| 계약 | 책임 |
|---|---|
| `RegisterEndpoint` | 로그인 뒤 인증된 멤버의 FID endpoint를 생성·갱신한다. 동일 FID의 낡은 binding이 남았으면 현재 멤버로 원자 교체한다. |
| `RemoveEndpoint` | 로그아웃할 때 현재 설치의 서버 endpoint를 삭제한다. |
| `MarkEndpointInactive` | `onUnregistered` 또는 FCM `404 UNREGISTERED`를 registration version 조건으로 반영한다. |
| `AcceptNotificationIntent` | 수신 대상과 template을 delivery 집합으로 변환한다. |
| `DeliverNotification` | FCM Adapter 호출과 결과 상태를 관리한다. |
| `GetDeliveryStatus` | queued, no-target, delivered, partial, failed, unknown-provider-outcome, permanent-failure, contract-failure, stale-target을 구분해 조회한다. |
| `HandleHouseholdMemberRemoved` | Access의 제거 Event를 받아 해당 member의 endpoint를 page 단위로 멱등 삭제한다. |
| `PurgeHouseholdData(householdId, processId, checkpoint)` | 해당 가구의 endpoint·delivery·Inbox 상태를 page 단위로 제거하고 공통 `PurgePageResult`를 반환한다. |

### 소비 계약

- Access & Household: Membership, memberId, active/removed/deleted/purging 상태와 `HouseholdMemberRemoved.v1`
- Ledger Outbox Event: TransactionRecorded, HouseholdNotificationRequested
- Firebase Messaging Port
- Clock, observability
- PWA·Android Delivery Adapter는 payload 계약의 소비자

Notifications는 Transaction 저장 성공을 추측하거나 `expenses`를 수정하지 않는다.

`PurgeHouseholdData`는 [공통 paged purge 결과 계약](../../cross-cutting/data-ownership.md#41-공통-paged-purge-계약)을 따릅니다. 일반 가구 논리 삭제에서는 호출하지 않고 별도 승인된 Access `HouseholdPurgeProcess`의 수동 영구 삭제에서만 대상 household의 endpoint와 delivery 상태를 제거합니다.

## 7. Event와 전달 흐름

```text
Ledger canonical commit + Outbox
  → TransactionRecorded / HouseholdNotificationRequested
  → Notifications Inbox claim
  → recipient policy
  → member active notification endpoints
  → delivery claim
  → FCM Adapter
  → delivered | failed | unknown-provider-outcome | permanent failure
```

Outbox 전달은 at-least-once이므로 `(eventId, handlerName)` Inbox와 `(eventId, recipient, endpoint)` Delivery key로 중복을 막는다.

공개 Event:

- `NotificationDelivered.v1`
- `NotificationDeliveryFailed.v1`

이 Event는 운영·사용자 상태 조회에 필요할 때만 발행하며 Ledger 원본을 다시 변경하지 않는다.

## 8. 제품 결정과 Human in the loop

| 결정 | 영향 |
|---|---|
| [DEC-013](../../governance/decisions.md#dec-013) | Android·iPhone Shortcut 자동 등록과 명시적 알림 요청의 수신 정책 |
| [DEC-019](../../governance/decisions.md#dec-019) | endpoint 전달 주소와 FCM 직접 전송 대상을 FID로 통일하고 registration token을 제거 |
| [DEC-020](../../governance/decisions.md#dec-020) | 멤버별 다중 endpoint, 로그아웃 삭제·로그인 등록, 404 inactive, 데스크톱 제외 |
| [DEC-022](../../governance/decisions.md#dec-022) | 단일 partner 상태를 제거하고 명시 요청은 requester 외 모든 활성 가구원에게 fan-out |
| [DEC-025](../../governance/decisions.md#dec-025) | endpoint별 한 번만 전송하고 timeout·일시 오류를 자동 재전송하지 않음 |
| [DEC-026](../../governance/decisions.md#dec-026) | 앱 내부 Subscription 없이 OS 권한으로 설치 전체 푸시 표시를 on/off |
| [DEC-027](../../governance/decisions.md#dec-027) | active endpoint 유지, inactive endpoint·terminal 알림 처리 기록 30일 보존 |
| [DEC-038](../../governance/decisions.md#dec-038) | 제거된 일반 가구원 endpoint 정리와 cleanup 전후 active Membership 기반 발송 차단 |

이 Context의 제품 정책 미결정 사항은 없습니다.

## 9. 테스트 소유권

상세 테스트는 [푸시 알림 테스트 시나리오](modules/notifications/requirements.md#9-모듈-테스트-시나리오)가 소유한다.

Context 경계에서 추가로 묶어 검증한다.

- 같은 Ledger Event 중복 전달 → endpoint별 푸시 한 번
- 한 endpoint 일시 실패 → 성공 endpoint 유지, 실패 endpoint는 최종 실패로 기록하고 자동 재전송하지 않음
- 영구 FID 오류 → 해당 endpoint만 비활성화
- 멤버 이름 변경 → endpoint의 memberId 유지
- 무인증·타 가구 endpoint 등록 → 거부와 변경 없음
- 같은 FID 재등록 → 같은 endpoint 한 개와 갱신 시각·registration version update
- 설치 A 등록 뒤 설치 B 등록 → 서로 다른 endpoint 두 개 모두 활성
- 설치 A 로그아웃 → A endpoint 삭제, B endpoint 유지
- 설치 A에서 다른 멤버 로그인 → 같은 FID가 새 멤버 하나에만 연결
- 이전 로그아웃 삭제 누락 뒤 다른 멤버 로그인 → 등록 transaction이 낡은 binding 교체
- 데스크톱 로그인 → endpoint 등록·권한 요청·푸시 없음
- stale 404 결과 → 더 최신 registration version 유지
- 현재 v1 payload를 PWA·Android가 처리하고 알 수 없는 future version은 typed failure로 거부; v2 도입 시 이전 version 호환 창을 별도 결정
- 같은 purge page 재전달 → 동일 checkpoint 결과로 수렴하고 delivery 중복 side effect 없음
- 앱 재설치·데이터 삭제 후 새 FID 등록 → 새 endpoint 추가, 폐기된 이전 FID는 404 확인 후 inactive
- stale `onUnregistered` callback → 더 최신 registration version의 endpoint 유지
- 같은 멤버의 endpoint 중 하나만 404 → 해당 endpoint만 inactive, 나머지는 계속 전달
- 가구원 제거 Event 지연·중복 → endpoint cleanup 전후 recipient와 실제 provider 호출에서 제외, 다른 멤버 endpoint·기존 terminal 기록 유지
- 가구원 복구 → 과거 endpoint는 복구하지 않고 새 로그인 등록만 허용
- 같은 purge processId·checkpoint 재전달 → 같은 page 결과를 재생하고 대상 가구 데이터만 삭제, 타 가구와 provider side effect 보존

## 10. 변경 경계 확인

- FCM을 다른 전달 Provider로 바꿔도 Ledger와 Payment Capture를 수정하지 않아야 한다.
- FID endpoint 수명주기나 보존 정책을 바꿔도 Member와 Transaction schema를 바꾸지 않아야 한다.
- PWA 클릭 UI를 바꿔도 수신 대상 Domain Policy를 수정하지 않아야 한다.
