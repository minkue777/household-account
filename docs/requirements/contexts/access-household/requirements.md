# Access & Household Bounded Context 요구사항 지도

> 문서 유형: Business Bounded Context  
> 소유 기능 모듈: [가구와 접근](modules/household-access/requirements.md)  
> 소유 요구사항: `HH-*`, `HH-JOIN-*`, `ADM-*` — 16개  
> 목표 구조: [목표 Clean Architecture 설계](../../../architecture/target-clean-architecture.md#5-bounded-context와-기능-모듈)

## 1. 책임과 경계

Access & Household Context는 **누가 어느 가구에서 어떤 멤버 자격과 권한으로 동작하는지**를 결정한다. 가구·멤버·Membership·초대·일반 가구원 capability·전체 관리자 권한과 ActorContext의 의미를 소유하며, 로그인 권한과 분리된 자산 명의자 프로필의 안정적인 식별자도 관리한다.

이 문서는 Context 수준의 탐색 지도이며 상세 요구사항 문장을 복사하지 않는다. 각 ID의 사전조건·결과·예외·코드 근거·테스트는 [가구와 접근 모듈](modules/household-access/requirements.md)이 한 번만 소유한다.

포함 범위:

- Google 로그인, 가구 생성·복원·초대 참여·로그아웃과 생명주기
- 안정적인 멤버 식별자와 표시 이름
- Member 연결형·비로그인 dependent 자산 명의자 프로필
- 인증 주체와 가구 멤버의 Membership
- Role과 가구 범위 권한 판정
- 5분 일회용 초대와 기존 가구 키 세션의 일회성 계정 전환
- 관리자 가구 조회·생성·삭제 요청
- 전체 관리자 전용 일반 가구원 강제 제거·복구
- 복구 가능한 가구 논리 삭제와 수동 영구 purge Process의 시작·상태

제외 범위:

- 거래·카테고리·카드·자산·기기 endpoint의 실제 저장과 변경
- Firebase Auth, Firestore Rules, 로컬 저장소의 기술 구현
- 이름 변경을 이유로 다른 Context의 Canonical 문서를 직접 순회하는 작업
- 가구 삭제 시 다른 Context의 컬렉션 구조를 직접 열거하는 작업

## 2. 내부 기능과 요구사항

| 기능 영역 | 요구사항 | 개수 | 상세 소유 문서 |
|---|---|---:|---|
| 가구·멤버 세션, 명의자 프로필과 생명주기 | HH-001~012 | 12 | [가구와 접근](modules/household-access/requirements.md#5-요구사항) |
| 초대 참여 | HH-JOIN-001 | 1 | [가구와 접근](modules/household-access/requirements.md#5-요구사항) |
| 관리자 기능과 권한 | ADM-001~003 | 3 | [가구와 접근](modules/household-access/requirements.md#5-요구사항) |

합계는 16개이며 이 Context 밖에서 동일 ID를 다시 정의하지 않는다.

## 3. 공통 언어

| 용어 | 의미 |
|---|---|
| Principal | Firebase Auth 등 외부 인증 Adapter가 검증한 요청 주체 |
| Household | 모든 공유 데이터의 tenant 경계 |
| Member | 가구 내부의 안정적인 `memberId`를 가진 구성원 |
| Membership | Principal과 Household·자기 Member·lifecycle status의 관계. household owner role은 없음 |
| AssetOwnerProfile | 자산 명의를 나타내는 안정적인 profileId. Member 연결형과 로그인 없는 dependent 유형을 구분함 |
| Display Name | 변경 가능한 멤버 표시값이며 외래 키로 사용하지 않는 값 |
| Role | owner, admin, member, viewer 등 허용 행동을 결정하는 값 |
| Invitation | household 가입을 허용하는 5분 일회용 코드. 특정 Member를 미리 만들거나 지정하지 않음 |
| ActorContext | 검증된 Principal, Household, 자기 Membership Member와 서버 Capability의 Application 입력 |
| Legacy Session Candidate | 기존 브라우저의 householdKey·currentMemberId·currentMemberName을 첫 Google 로그인에서 기존 Membership으로 바꾸기 위한 일회성 migration 단서 |

## 4. Aggregate와 소유 데이터

| Aggregate·데이터 | 핵심 불변식 | 현재 저장 | 목표 소유 형태 |
|---|---|---|---|
| Household | 안정 ID, 이름, `active/deleted/purging/purged` 상태 | `households` | `households/{householdId}` |
| Member | memberId와 displayName 분리, 자기 Google UID의 Membership 하나와 연결 | households의 이름 배열 | `households/{id}/members/{memberId}` |
| AssetOwnerProfile | profileId와 표시 이름 분리, member/dependent 유형, 논리 보관 시 기존 참조 유지 | `assets.owner` 이름에 암묵 결합 | `households/{id}/assetOwnerProfiles/{profileId}` |
| Membership | 인증 uid, memberId, 가구, lifecycle status의 유효한 조합 | 명시 모델 없음 | owner role 없는 Access Canonical + 사용자별 Read View |
| Invitation | 5분 만료, 일회 사용, token 원문 비저장, 소비 시 자기 Member 생성 | 가구 key 기반 참여 | `householdInvitations` |
| Legacy Membership Claim | 기존 householdId·memberId를 최초 Google UID에 한 번 연결 | localStorage 가구 key·멤버 선택 | Member/Membership transaction과 migration receipt |
| HouseholdPurgeProcess | 수동 영구 삭제의 모듈별 checkpoint와 재시도 상태 | 명시 모델 없음 | Access Process Manager 상태 |
| 현재 세션 | 권위 데이터가 아닌 클라이언트 선택 상태 | localStorage, SharedPreferences | Web·Android Session Adapter |

`households.defaultCategoryKey`와 `homeSummaryConfig`는 물리적으로 같은 문서에 있더라도 각각 Household Finance와 Preferences의 정책이다. 목표 V2에서는 소유 문서로 분리한다.

## 5. Context 불변식

1. 모든 가구 범위 Command와 Query에는 검증된 householdId가 있어야 한다.
2. actingMemberId는 해당 Google UID의 Membership에 연결된 자기 Member여야 한다.
3. 클라이언트가 전달한 role·capability와 관리자 여부를 신뢰하지 않는다.
4. 표시 이름은 다른 Context의 참조 ID가 아니다.
5. 멤버 이름 변경은 memberId 참조를 바꾸지 않는다.
6. 일반 사용자는 자기 Member만 생성·변경할 수 있고 다른 Member를 미리 생성하거나 선택할 수 없다.
7. 관리자 작업은 서버 인가와 Firestore Rules를 모두 통과해야 한다.
8. 가구가 `deleted`, `purging`, `purged`이면 일반 업무 Command·Query와 세션 복원을 거부한다.
9. `deleted` 가구의 데이터는 보존하며 관리자·운영 복구 명령으로 `active` 전이할 수 있다.
10. 가구 전체 물리 삭제는 별도 수동 요청에서만 시작하고 Context별 purge 상태를 기록해 재시도할 수 있어야 한다.
11. 초대 코드는 발급 후 5분·일회 사용이며 Invitation 소비와 자기 Member·Membership 생성은 한 transaction이다.
12. legacy 가구 키는 전환 기간의 Membership claim에만 사용하고 연결 성공 후 일반 인증 자격으로 허용하지 않는다.
13. 일반 사용자용 가구원 탈퇴 기능은 없으며 로그아웃·가구 논리 삭제로 Membership을 종료하지 않는다.
14. dependent 명의자 프로필은 Member·Membership·권한·알림 대상을 만들지 않는다. 일반 사용자는 삭제할 수 없고 서버가 검증한 관리자만 논리 보관하며, 보관 후에도 기존 자산과 과거 통계의 profileId·표시 이름을 유지한다.
15. 전체 관리자만 활성 Member를 복구 가능하게 제거·복구할 수 있다. 가구 생성자도 별도 owner 권한 없이 같은 규칙을 적용하며, 제거 즉시 active Membership 판정에서 제외하고 UID claim을 해제하되 업무 기록과 안정 ID는 유지한다.
16. Household Membership에는 owner role을 두지 않고 모든 활성 가구원에게 같은 일반 capability를 적용한다. 전체 관리자·SystemActor 권한은 Membership 밖의 서버 capability로 검증한다.
17. 영구 purge는 Membership·claim 변경을 차단한 뒤 현재 UID claim의 server-only snapshot부터 page 단위로 완성하고, 그 뒤 Context purge를 시작한다. 모든 Context·Access purge 완료 뒤에만 snapshot 대상 claim을 조건부 page 해제하며, 모든 claim checkpoint가 끝나기 전에는 Household를 `purged`로 확정하지 않는다.

## 6. 공개 계약과 의존 방향

### 제공 계약

| 계약 | 책임 |
|---|---|
| `ResolveActorContext` | 인증 자격을 검증된 ActorContext로 변환한다. |
| `AuthorizeHouseholdAction` | ActorContext와 행동에 대한 허용·거부를 반환한다. |
| `ResolveSignedInUser` | Google UID의 Membership 또는 첫 방문·legacy 전환 상태를 반환한다. |
| `ClaimLegacyMembership` | localStorage 후보의 기존 Member를 최초 Google UID에 일회성으로 연결한다. |
| `CreateHouseholdWithSelf` | 가구와 호출자 자신의 Member·일반 Membership을 원자적으로 생성한다. |
| `CreateInvitationCode` | 특정 Member를 만들지 않는 5분 일회용 household 초대 코드를 생성한다. |
| `JoinHouseholdAsSelf` | 초대를 소비하면서 호출자 자신의 Member·Membership을 원자적으로 생성한다. |
| `RenameSelf` | 안정 memberId를 유지하며 호출자 자신의 표시 이름만 변경한다. |
| `CreateAssetOwnerProfile` / `RenameAssetOwnerProfile` | 활성 가구원이 비로그인 dependent 명의자의 안정적인 ID와 표시 이름을 관리한다. |
| `ArchiveAssetOwnerProfile` | 서버가 검증한 관리자만 dependent 명의자를 논리 보관하며 일반 사용자 호출을 거부한다. |
| `ListAssetOwnerProfiles` | Portfolio와 자산 UI에 활성 프로필을 가구 명의자 목록에 들어온 순서로 제공하고, 필요 시 과거 해석용 보관 프로필을 함께 제공한다. |
| `RemoveHouseholdMember` / `RestoreRemovedHouseholdMember` | 전체 관리자만 일반 Member를 복구 가능하게 제거·복구하고 UID claim 경합을 검증한다. |
| `RequestHouseholdDeletion` | 데이터를 변경하지 않고 가구를 `deleted` 상태로 바꿔 일반 접근을 차단한다. |
| `RestoreDeletedHousehold` | 물리 purge가 시작되지 않은 `deleted` 가구를 `active`로 복구한다. |
| `RequestPermanentHouseholdPurge` | 별도 사용자 요청을 확인한 관리자·운영 주체가 `deleted` 가구의 영구 purge를 수동으로 시작한다. |
| `RunHouseholdPurgeProcess` | `householdLifecycle:purge` capability를 가진 승인된 내부 system process만 claim snapshot, Context purge, 조건부 claim finalization을 재개하고 최종 `purged`를 기록한다. 외부 사용자 Command가 아니다. |
| `GetHouseholdPurgeStatus` | 수동 영구 purge의 Context별 진행 상태를 조회한다. |
| `GetMembership` / `ListHouseholds` | 자기 가구 범위·Membership 상태와 서버가 허용한 capability를 조회한다. |

### 소비 Port

- Identity Provider: Firebase Auth Principal 검증
- Session Store: Web·Android의 비권위 선택 상태
- Clock, IdGenerator, UnitOfWork
- 수동 영구 purge를 위한 각 소유 Context의 `PurgeHouseholdData` 공개 Port

다른 모든 업무 Context가 ActorContext와 Membership 계약을 소비한다. Access는 그 대가로 다른 Context의 Repository를 알지 않는다.

## 7. 공개 Event와 종단 흐름

| Event | 소비자 | 목적 |
|---|---|---|
| `MemberRenamed.v1` | 표시 이름을 비정규화한 Read Model | Canonical 외래 키 수정 없이 표시값 갱신 |
| `AssetOwnerProfileChanged.v1` | Portfolio·Reporting 표시 Read Model | Asset·Snapshot을 수정하지 않고 profileId의 표시 이름·상태만 갱신 |
| `HouseholdMemberRemoved.v1` | Notifications·세션 Adapter | 제거된 Member의 endpoint 정리와 즉시 접근·수신 차단 |
| `HouseholdMemberRestored.v1` | 세션·표시 Read Model | 동일 Member 복구 사실 전달; endpoint 자동 복원 금지 |
| `HouseholdDeleted.v1` | 세션·운영 Adapter | 논리 삭제에 따른 접근 종료; 데이터 purge 신호가 아님 |
| `HouseholdRestored.v1` | 세션·운영 Adapter | 논리 삭제 복구와 재선택 허용 |
| `HouseholdPermanentPurgeRequested.v1` | HouseholdPurgeProcess | 명시적으로 승인된 수동 영구 purge 시작 |
| `HouseholdPurged.v1` | 운영 감사 | 모든 Context의 영구 삭제 완료 |

대표 흐름:

- 기존 사용자 첫 로그인: localStorage 후보 → Google 로그인 → 기존 Member 연결 확인 → Membership claim → 같은 가계부 조회
- 신규 가구 생성: Google 로그인 → 가구·자기 Member·일반 Membership 원자 생성
- 초대 참여: Google 로그인 → 5분 invitation 검증 → 자기 이름 입력 → Invitation 소비·자기 Member·Membership 원자 생성
- 이름 변경: Member displayName 변경 → Outbox Event → 필요한 Read Model만 갱신
- 명의자 추가: 자산 도넛 필터 `+` → dependent 프로필 생성 → 자산 입력 선택지·필터 갱신
- 관리자 가구원 제거: active Member → removed Membership·Member·명의자 프로필 + claim 해제 → Notifications endpoint 정리; 복구는 동일 ID 재활성화
- 논리 삭제·복구: `active ↔ deleted`; 데이터는 그대로 보존
- 수동 영구 삭제: `deleted → purging` → UID claim snapshot page → Context별 purge checkpoint → UID claim finalization page → `purged`; `purging`부터 복구·Membership 변경 금지

상세 현재 흐름은 [시스템 종단 흐름](../../system/flows.md), 권한 위험은 [보안과 개인정보](../../cross-cutting/security-privacy.md)를 따른다.

## 8. 제품 결정과 Human in the loop

| 결정 | 이 Context에 미치는 영향 |
|---|---|
| [DEC-020](../../governance/decisions.md#dec-020) | Member는 안정적인 식별자와 Membership 검증만 제공하고 Notifications가 멤버별 다중 endpoint와 로그인·로그아웃 수명주기를 관리 |
| [DEC-013](../../governance/decisions.md#dec-013) | 거래 creatorMemberId·알림 requesterMemberId 식별 |
| [DEC-016](../../governance/decisions.md#dec-016) | 복구 가능한 논리 삭제와 별도 수동 영구 purge 분리 |
| [DEC-021](../../governance/decisions.md#dec-021) | Google 로그인, 자기 Member만 생성, 5분 초대, localStorage 기반 기존 Membership 무중단 전환 |
| [DEC-022](../../governance/decisions.md#dec-022) | 단일 partner 상태·선택을 제거하고 Access는 자기 Membership과 활성 가구원 조회만 제공 |
| [DEC-036](../../governance/decisions.md#dec-036) | 일반 사용자 탈퇴 진입점을 두지 않고 로그아웃·논리 삭제에도 Member·Membership 연결 보존 |
| [DEC-037](../../governance/decisions.md#dec-037) | 로그인 Member와 자산 명의자를 분리하고 안정 profileId와 관리자 전용 dependent 논리 보관을 Access가 소유 |
| [DEC-038](../../governance/decisions.md#dec-038) | 일반 사용자 제거 UI 없이 전체 관리자만 일반 가구원을 복구 가능하게 제거·복구하고 UID claim을 해제 |
| [DEC-039](../../governance/decisions.md#dec-039) | household owner role 없이 생성자를 포함한 모든 활성 가구원에게 같은 일반 권한을 적용하고 운영 권한은 전체 관리자 capability로 분리 |
| [DEC-040](../../governance/decisions.md#dec-040) | claim snapshot을 먼저 완성하고 모든 Context purge 완료 전 UID claim을 유지하며, 완료 후 조건부 page 해제를 끝낸 뒤에만 purged Event 확정 |

partner 선택 정책은 [DEC-022](../../governance/decisions.md#dec-022), Google UID의 Membership cardinality는 [DEC-034](../../governance/decisions.md#dec-034), 일반 사용자 탈퇴 미제공은 [DEC-036](../../governance/decisions.md#dec-036), 전체 관리자 전용 Member 제거는 [DEC-038](../../governance/decisions.md#dec-038), household owner 미도입은 [DEC-039](../../governance/decisions.md#dec-039), 영구 purge 뒤 claim 해제는 [DEC-040](../../governance/decisions.md#dec-040)으로 해소되었습니다. 한 UID에는 active Membership 하나만 허용하고 가계부 전환·탈퇴 UI를 제공하지 않습니다.

## 9. 테스트 소유권

상세 테스트 ID와 Given/When/Then은 [가구와 접근 테스트 시나리오](modules/household-access/requirements.md#8-모듈-테스트-시나리오)가 소유한다.

Context 경계 테스트는 다음을 추가로 묶어 검증한다.

- 같은 가구·다른 가구·무인증·관리자별 접근 행렬
- 가구 생성과 자기 Member·일반 Membership의 원자성, 생성자와 초대 가구원의 동일 capability
- 이름 변경 후 카드·자산·거래·endpoint의 memberId 유지
- dependent 명의자 생성이 Membership·권한·알림 endpoint를 만들지 않고 일반 사용자의 삭제는 거부되며 관리자 보관 뒤에도 profileId와 과거 이름 해석이 유지됨
- 일반 사용자의 가구원 제거 surface 부재, 관리자 제거 직후 접근·알림 차단, claim 해제·복구 경합과 업무 기록 불변
- deleted 가구의 신규 Command·Query 거부, 데이터 불변, 복구 후 재접근
- 명시적 수동 영구 purge의 checkpoint 재시도와 `purging` 복구 금지
- Context purge 실패 중 claim 불변, 완료 뒤 조건부 claim page 재개와 최종 purged Event 단일 기록
- 초대 5분 만료·재사용·다른 가구·타인 identity 지정 차단
- legacy localStorage 자동 연결·무효 후보·동시 Google UID 선점·같은 UID 재시도

## 10. 변경 경계 확인

다음 변경은 이 Context와 공개 계약 소비자의 contract test 밖으로 전파되지 않아야 한다.

- Firebase Auth Provider 교체
- 가구 참여 방식 변경
- Role 추가
- 멤버 표시 이름 정책 변경
- 논리 삭제·복구 또는 수동 영구 purge 승인 정책 변경
