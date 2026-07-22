# 가구·접근 모듈 상세 설계

> 상태: Proposed — 테스트 구현 기준  
> 소유 요구사항: [가구·접근 모듈 요구사항](requirements.md)  
> 상위 Context: [Access & Household](../../requirements.md)  
> 공통 상세 설계 규약: [모듈 상세 설계 규약](../../../../governance/module-design-standard.md)  
> 목표 아키텍처: [목표 Clean Architecture 설계](../../../../../architecture/target-clean-architecture.md)

## 1. 설계 목적과 추적성

이 설계는 `HH-001~012`, `HH-JOIN-001`, `ADM-001~003`을 서버 권위의 Access Application과 Web·Android 세션 Adapter로 옮기기 위한 테스트 경계를 정합니다. 요구사항 문장을 다시 정의하지 않으며, 상태와 제품 의도는 [요구사항](requirements.md#5-요구사항)과 [결정 기록](../../../../governance/decisions.md)을 따릅니다.

설계 기준은 다음과 같습니다.

- 가구 키나 클라이언트의 관리자 표시는 인증 자격이 아닙니다.
- `principalUid`, `householdId`, `memberId`, 표시 이름을 서로 다른 개념으로 유지합니다.
- 로그인 Member와 자산 명의자 `profileId`를 분리하고 dependent 프로필에 접근 권한을 부여하지 않습니다.
- 다른 Context는 검증된 `ActorContext`와 공개 Access Port만 사용합니다.
- 로컬 세션은 비권위 mirror이며 서버의 Membership 판정을 대신하지 않습니다.
- DEC-034에 따라 Google UID마다 전역 claim을 보유한 Membership은 최대 하나이며 일반 사용자는 가계부를 선택하지 않습니다. removed Membership은 claim 없이 감사·복구용으로만 남습니다.
- 이름 변경은 Access Canonical 데이터만 바꾸고 다른 Context의 memberId 참조를 유지합니다.
- 일반 삭제는 데이터에 손대지 않는 복구 가능한 상태 전이입니다. 영구 삭제만 별도 승인 뒤 Context별 checkpoint를 가진 Process Manager로 실행합니다.

관련 공통 계약은 [데이터 소유권](../../../../cross-cutting/data-ownership.md), [보안 경계](../../../../cross-cutting/security-privacy.md), [가구 삭제·복구 흐름](../../../../system/flows.md#8-가구-논리-삭제복구와-수동-영구-삭제), [테스트 전략](../../../../governance/test-strategy.md)을 참조합니다.

## 2. 모듈 경계와 책임

### 2.1 내부 책임

| 영역 | 책임 | 최종 Writer |
|---|---|---|
| Access Domain | Household, Member, Membership, Invitation, Legacy Membership Claim의 불변식과 상태 전이 | 이 모듈 |
| Access Application | Actor 해석, 권한 판정, 가구·멤버 Command와 Query 조정 | 이 모듈 |
| Household lifecycle | `active ↔ deleted` 논리 삭제·복구와 `deleted → purging → purged` 수동 영구 삭제 | 이 모듈 |
| HouseholdPurgeProcess | 명시적으로 승인된 영구 삭제의 Context별 purge checkpoint | 이 모듈 |
| Session Application | 유일한 Membership 복원, 서버 재검증, 현재 SessionScope 저장·삭제 | Web·Android의 비권위 Adapter |
| Admin Inbound Adapter | 인증된 관리자 Command/Query를 공개 Port로 변환 | 이 모듈의 Application을 호출 |

### 2.2 경계 밖 책임

- Category 기본 집합과 홈 기본 설정의 Canonical write는 각각 Category/Budget과 Home Preferences가 소유합니다.
- 카드·자산·거래·알림 데이터는 memberId를 참조하며 Access가 직접 순회하거나 수정하지 않습니다.
- Firebase Auth, Firestore, 로컬 저장소는 Output Adapter입니다.
- 푸시 endpoint와 수신자 선택은 Notifications가 소유합니다. [DEC-019](../../../../governance/decisions.md#dec-019)의 FID 정책과 [DEC-020](../../../../governance/decisions.md#dec-020)의 멤버별 다중 endpoint·로그인/로그아웃 수명주기를 Access가 중복 구현하지 않습니다.
- 각 Context의 물리 삭제 방법과 checkpoint 형식은 해당 Context가 소유합니다.

`HH-007`의 기본 카테고리·홈 설정은 가구 생성 transaction에 타 Context 문서를 끼워 넣지 않습니다. `HouseholdCreated.v1`을 Outbox에 기록하고 각 소유 모듈이 멱등 초기화합니다. 사용자 흐름은 초기화 상태를 별도로 관찰하며, Access의 생성 성공과 후속 초기화 전달 성공을 같은 결과로 위장하지 않습니다.

## 3. 공개 계약

공통 `CommandEnvelope`, `ActorContext`, Result union의 정의는 [공통 Application 계약](../../../../governance/module-design-standard.md#3-공통-application-계약)을 그대로 사용합니다. Wire DTO에는 `principalUid`, Role, Capability를 받지 않습니다.

### 3.1 공개 Input Port

| 이름·종류 | 호출자 | 입력 DTO | 결과 | 권한 | 일관성 | 멱등성 |
|---|---|---|---|---|---|---|
| `ResolveActorContext` Query | 인증 Inbound Adapter, 모든 Context Handler | 검증된 Principal, householdId | `Success<ActorContext>`, `Unauthenticated`, `Forbidden`, `NotFound`, `Conflict(HOUSEHOLD_NOT_ACTIVE)` | 유효 Principal과 자기 Member Membership | 읽기 일관성 | 해당 없음 |
| `AuthorizeHouseholdAction` Query | 다른 Context Application | ActorContext, capability | `Success<AuthorizationDecision>` 또는 `Forbidden(code)` | 검증된 ActorContext | 읽기 일관성 | 해당 없음 |
| `ResolveSignedInUser` Query | Web·Android Session Application | 검증된 Google Principal | `MembershipFound`·`LegacyClaimAvailable`·`FirstVisitRequired`·`RetryableFailure` | 인증 Principal | UID 전역 claim과 legacy 후보 검증, 쓰기 없음; 실패 시 캡처한 legacy 후보 보존 | 해당 없음 |
| `ClaimLegacyMembership` Command v1 | 전환 온보딩 | legacy householdKey, currentMemberId, 확인한 Google Principal | `MembershipLinked`·`AlreadyLinked`·`Conflict(PRINCIPAL_ALREADY_JOINED|MEMBER_ALREADY_LINKED)` | 인증 Principal, migration feature flag | 기존 Member 연결·UID 전역 claim·Membership·receipt·Outbox 한 UoW | envelope key + principal/household/member claim |
| `RepairLegacyMembershipClaim` Command v1 | 신원 확인을 마친 운영자·Agent | 정확한 principalUid, householdId, memberId, reason | `Success<MembershipView>`, `Conflict`, `NotFound`, `Forbidden` | `admin.membership-claims.repair` | 기존 claim compare-and-set·Membership·감사 기록 한 UoW; 업무 데이터 복사 없음 | envelope key + principal/household/member claim |
| `CreateHouseholdWithSelf` Command v1 | 첫 방문 온보딩 | householdName, selfDisplayName | `Success<HouseholdCreatedResult>`, `ValidationError`, `Conflict(PRINCIPAL_ALREADY_JOINED)`, `Forbidden` | 인증 Principal, 기존 Membership 없음 | UID 전역 claim·Household·자기 Member·일반 Membership·receipt·Outbox 한 UoW | envelope key + principal claim |
| `CreateInvitationCode` Command v1 | 가구 설정 | householdId | `Success<InvitationCodeIssued>`, `Forbidden` | 활성 Membership과 invite capability | 5분 expiry Invitation·receipt 한 UoW | envelope key |
| `JoinHouseholdAsSelf` Command v1 | 첫 방문 join | invitationCode, selfDisplayName | `Success<MembershipAcceptedResult>`, `ValidationError`, `Conflict(INVITATION_EXPIRED_OR_USED|PRINCIPAL_ALREADY_JOINED)`, `Forbidden` | 인증 Principal, 전체 가계부 Membership 없음 | UID 전역 claim·Invitation used·자기 Member·Membership·receipt·Outbox 한 UoW | envelope key + invitation hash + principal claim |
| `RenameSelf` Command v1 | Web 설정 | displayName, expectedVersion | `Success<MemberView>`, `ValidationError`, `NotFound`, `Conflict`, `Forbidden` | 자기 Membership | 자기 Member·receipt·`MemberRenamed.v1` 한 UoW | envelope key + aggregateVersion |
| `CreateAssetOwnerProfile` Command v1 | 자산 화면 `+` | displayName | `Success<AssetOwnerProfileView>`, `ValidationError`, `Conflict`, `Forbidden` | `household.asset-owner-profile.write` | dependent 프로필·receipt·Outbox 한 UoW | envelope key + payload hash |
| `RenameAssetOwnerProfile` Command v1 | 명의자 관리 | profileId, displayName, expectedVersion | `Success<AssetOwnerProfileView>`, `ValidationError`, `NotFound`, `Conflict`, `Forbidden` | `household.asset-owner-profile.write` | dependent 프로필·receipt·Outbox 한 UoW | envelope key + aggregateVersion |
| `ArchiveAssetOwnerProfile` Command v1 | 관리자 화면 | profileId, expectedVersion | `Success<AssetOwnerProfileView>`, `NotFound`, `Conflict`, `Forbidden` | `admin.asset-owner-profile.archive` | dependent 프로필 archived·receipt·Outbox 한 UoW | envelope key + aggregateVersion |
| `ListAssetOwnerProfiles` Query | Portfolio·자산 UI | householdId, includeArchived?, cursor | `Success<AssetOwnerProfilePage>`, `NoData`, `Forbidden` | 활성 Membership 또는 내부 참조 capability | tenant 일관 읽기 | 해당 없음 |
| `RemoveHouseholdMember` Command v1 | 전체 관리자 화면 | householdId, memberId, reason, expectedMembershipVersion | `Success<MemberRemovalResult>`, `NotFound`, `Conflict`, `Forbidden` | `admin.household-members.remove` | Member·Membership·member profile removed/archive + UID claim 해제 + receipt + Outbox 한 UoW | envelope key + member/version |
| `RestoreRemovedHouseholdMember` Command v1 | 전체 관리자 화면 | householdId, memberId, expectedMembershipVersion | `Success<MemberRestorationResult>`, `NotFound`, `Conflict`, `Forbidden` | `admin.household-members.restore` | UID claim 재획득 + 같은 Member·Membership·profile active + receipt + Outbox 한 UoW | envelope key + principal claim + version |
| `RequestHouseholdDeletion` Command v1 | Admin | reason, expectedVersion | `Success<HouseholdDeletedResult>`, `AlreadyProcessed`, `Conflict`, `Forbidden` | `household.delete` | Household `deleted` 전이·receipt·Outbox 한 UoW; 다른 Context write 없음 | envelope key + householdVersion |
| `RestoreDeletedHousehold` Command v1 | Admin·승인된 운영 도구 | reason, expectedVersion | `Success<HouseholdRestoredResult>`, `AlreadyProcessed`, `Conflict`, `Forbidden` | `household.restore` | Household `active` 전이·receipt·Outbox 한 UoW | envelope key + householdVersion |
| `RequestPermanentHouseholdPurge` Command v1 | 별도 요청을 수행하는 Admin·agent 운영 도구 | confirmation, expectedVersion | `Success<PurgeAccepted>`, `Conflict`, `Forbidden` | `household.purge.permanent` | Household `purging` 전이·Process·receipt·Outbox 한 UoW | envelope key + householdVersion |
| `GetHouseholdPurgeStatus` Query | Admin·운영 도구 | processId | `Success<PurgeStatusView>`, `NotFound`, `Forbidden` | `household.purge.read` | Process snapshot | 해당 없음 |
| `GetMembership` Query | Session Application, 다른 Context | householdId | `Success<MembershipView>`, `NotFound`, `Forbidden` | 자기 Membership 또는 `membership.read` | 읽기 일관성 | 해당 없음 |
| `ListHouseholds` Query | Admin·승인된 운영 도구 | scope, cursor, limit | `Success<HouseholdPage>`, `Forbidden`, `NoData` | `admin.households.read` | `createdAt DESC, householdId ASC` 결정 정렬 | 해당 없음 |

`HouseholdCreatedResult`는 Access 생성 ID와 `initializationStatus: pending | completed | failed`를 구분할 수 있어야 합니다. 후속 Context 초기화 실패는 가구 생성 rollback으로 표현하지 않고 재시도 가능한 상태로 관찰합니다.

### 3.2 내부 System Process Port

| 이름 | 호출자 | 입력 | 결과 | 권한·불변식 |
|---|---|---|---|---|
| `RunHouseholdPurgeProcess` | 승인된 Access Process Runner | processId, 현재 opaque checkpoint | `Progressed<PurgeStatusView>`, `RetryableFailure`, `Completed`, `AlreadyCompleted`, `OperationalConflict` | `householdLifecycle:purge` SystemActor만 호출한다. 외부 사용자 Command가 아니며 snapshot 완료 전 Context 호출, Context 완료 전 claim finalization, 모든 checkpoint 완료 전 `purged` 확정을 금지한다. |

### 3.3 Client Session Input Port

로컬 저장 요구사항은 서버 Wire API가 아니라 Client Application Port로 둡니다.

| Port | 단계 | 관찰 결과 |
|---|---|---|
| `CaptureLegacySessionCandidate` | Google 로그인 UI를 시작하기 전에 localStorage의 householdKey·currentMemberId·currentMemberName을 메모리 snapshot으로 읽음 | householdKey+currentMemberId가 모두 있을 때만 완전한 후보; 값 없음·불완전 후보는 `Absent`로 정규화하여 신규 사용자로 처리 |
| `RestoreSignedInSession` | Google 로그인 → `ResolveSignedInUser` → Membership이 있으면 이전 listener·cache·요청을 폐기하고 서버 결과로 새 versioned SessionSnapshot을 원자 저장 | `Restored`, `LegacyConfirmationRequired`, `FirstVisitRequired`, `RetryableFailure`; 이전 generation callback은 무시 |
| `ClaimLegacySession` | 기존 가계부·멤버 확인 → `ClaimLegacyMembership` → 성공 후 legacy 로그인 key 제거·새 SessionSnapshot 저장 | 기존 householdId·memberId 유지; 다른 UID 선점이면 자동 변경 없음 |
| `JoinWithInvitationCode` | Google 로그인 → 코드 trim·schema 검증 → 자기 이름 입력 → `JoinHouseholdAsSelf` → 성공 후 저장 | 실패 시 Member·Membership·세션 변경 없음 |
| `CreateHouseholdForSelf` | Google 로그인 → 가구 이름·자기 이름 입력 → `CreateHouseholdWithSelf` → 성공 후 저장 | 다른 Member 입력 없음; 후속 endpoint 등록 실패는 생성 rollback 아님 |
| `LogoutHouseholdSession` | Notifications 공개 Port에서 현재 설치 endpoint `Removed` 또는 `AlreadyAbsent` 확인 → 가구·멤버·Bridge mirror 제거 | endpoint 삭제 실패 시 로컬 상태를 유지하고 재시도; 별도 endpoint 멤버 전환 명령 없음 |

기존 household key는 `LegacyHouseholdKeyAdapter`가 [DEC-021](../../../../governance/decisions.md#dec-021)의 전환 기간에 localStorage에서만 읽습니다. 새 사용자 입력 UI나 invitation으로 재사용하지 않습니다. Google 로그인과 사용자 확인 뒤 `ClaimLegacyMembership`의 일회성 단서로만 전달하고 성공하면 legacy 로그인 상태를 제거합니다.

### 3.4 주요 DTO와 Read Model

| 타입 | 필수 필드 | 규칙 |
|---|---|---|
| `HouseholdView` | householdId, name, lifecycleState, createdAt, aggregateVersion | legacy key와 Membership 목록 전체를 노출하지 않음 |
| `MemberView` | memberId, displayName, status, linkedPrincipal 여부, aggregateVersion | principalUid·제거 사유는 관리자 capability가 없으면 제외 |
| `AssetOwnerProfileView` | profileId, displayName, profileType, linkedMemberId?, lifecycleState, aggregateVersion | principalUid·권한을 포함하지 않으며 archived도 기존·과거 명의 해석을 위해 조회 가능 |
| `MembershipView` | householdId, memberId, capabilities, status | household role 필드는 없으며 서버가 계산한 capability만 반환 |
| `SelfMemberSession` | householdId, memberId, displayName | memberId는 서버 Membership에서만 결정하고 다른 Member·partner 선택 입력을 받지 않음 |
| `InvitationView` | invitationId, householdId, expiresAt, status | code 원문은 생성 응답에서만 한 번 노출하고 저장·조회 모델에서 제외 |
| `LegacySessionCandidate` | householdKey, currentMemberId, currentMemberName? | Web localStorage의 householdKey+memberId 완전 후보만 생성; currentMemberName은 확인 표시용; 어떤 값도 서버 인증·인가를 대체하지 않음 |
| `PurgeStatusView` | processId, householdState, contextCheckpoints, retryableFailures, updatedAt | 수동 영구 purge의 opaque checkpoint를 UI가 해석하지 않음 |
| `SessionSnapshot` | sessionGeneration, principalUid, householdId, actingMemberId, displayName, validatedAt, schemaVersion | 전체 record를 원자 교체·삭제하고 Role·capability를 권위 값으로 저장하지 않음 |

Wire schema는 `contractVersion`으로 versioning하고, TypeScript·Kotlin DTO는 공통 schema에서 생성합니다.

## 4. Domain 모델과 불변식

### 4.1 Aggregate와 Value Object

| 모델 | 핵심 상태 | 불변식 |
|---|---|---|
| `Household` Aggregate | householdId, name, lifecycleState, deletedAt·deletedBy?, version | `active↔deleted`, `deleted→purging→purged`; active 외 일반 Command·Query 거부; purging 이후 복구 금지 |
| `Member` Entity | memberId, displayName, linkedPrincipalUid, status, removedAt?, version | 신규 Member는 호출자 UID에만 연결; legacy Member만 전환 전 일시적으로 미연결 가능; removed도 과거 ID·표시를 보존 |
| `AssetOwnerProfile` Aggregate | profileId, householdId, displayName, profileType, linkedMemberId?, lifecycleState, version | member 프로필은 Member와 1:1이며 별도 보관 금지; dependent는 Membership·Role 없음; `active→archived` 뒤 기존 참조와 이름 유지 |
| `Membership` Aggregate | principalUid, householdId, memberId, status, removedAt·removedBy·reason?, version | household role 없음; active는 UID 전역 `PrincipalMembershipClaim`과 1:1이며 같은 household의 active Member와 연결; removed는 claim 없이 감사·복구용으로 보존 |
| `PrincipalMembershipClaim` Aggregate | principalUid, membershipId, householdId, status, version | principalUid당 단일 문서/유일 key; 생성·가입·legacy 연결에서 확보하고 관리자 Member 제거 시 해제·복구 시 재획득; 영구 purge에서는 모든 Context 완료 후 DEC-040 finalization만 조건부 page 해제 |
| `Invitation` Aggregate | invitationHash, householdId, expiry, usedAt, usedByUid?, version | 발급 후 5분 안에 한 Principal만 소비; 특정 Member 사전 지정과 code 원문 저장 금지 |
| `HouseholdPurgeProcess` Aggregate | processId, confirmationRef, context별 checkpoint/status, server-only paged claim snapshot·claimCheckpoint, attempts | 수동 승인 뒤에만 생성; 완료된 Context는 재시도하지 않고 실패 Context·claim page만 마지막 checkpoint에서 재개 |

Value Object는 `HouseholdName`, `MemberDisplayName`, `AssetOwnerProfileName`, `InvitationCodeHash`, `LegacyMemberClaimKey`, `LifecycleState`를 둡니다. ID, 시간, Result 같은 공통 타입은 [Shared Kernel 허용 범위](../../../../../architecture/target-clean-architecture.md#123-shared-kernel-허용-범위)를 사용하고 이 모듈에 복제하지 않습니다.

### 4.2 정책

| Policy | 책임 | 상태 |
|---|---|---|
| `AccessCapabilityPolicy` | active Membership에는 동일한 일반 capability를, 전체 관리자·SystemActor에는 Membership 밖의 서버 capability를 계산 | DEC-039; 서버 단일 구현, 생성자 특권 없음 |
| `MemberDisplayNamePolicy` | trim·정규화·빈 값·동일 가구 중복 판정 | 자기 생성/RenameSelf에 동일 적용 |
| `InvitationAcceptancePolicy` | 5분 만료·일회 사용·대상 가구·미가입 Principal 검증 | 서버 단일 구현 |
| `HouseholdCommandAvailabilityPolicy` | lifecycleState별 허용 Command·Query | deleted는 restore/permanent purge만, purging은 purge 조회·재개만 허용 |
| `LegacyMembershipClaimPolicy` | localStorage 후보의 기존 Member를 최초 Google UID에 멱등 연결 | DEC-021; feature flag 기간에만 활성, 다른 UID binding 덮어쓰기 금지 |
| `MembershipCardinalityPolicy` | Google UID 전역에서 claim을 보유한 Membership 최대 하나 강제 | DEC-034·038; removed는 claim 없음, 가계부 선택·전환 없음, 기존 claim 자동 덮어쓰기·합치기 금지 |
| `MembershipExitPolicy` | 일반 사용자 탈퇴 Command 부재와 Membership 보존 | DEC-036; 로그아웃·논리 삭제로 종료 금지, 관리자 제거는 별도 Policy |
| `AdminMemberRemovalPolicy` | 전체 관리자 제거·복구, claim 해제·재획득, 마지막 Member 데이터 보존 | DEC-038·039; 생성자를 포함한 모든 Member에 동일 적용, 일반 사용자 surface 없음, 다른 active claim이 있으면 복구 충돌 |
| `PurgeClaimFinalizationPolicy` | purging 뒤 claim snapshot 선행, 모든 Context 완료 확인, 대상 claim 조건부 page 해제, purged 최종화 | DEC-040; snapshot 전 Context purge와 부분 실패 중 해제 금지, expected household/membership/version 불일치 보존 |
| `AssetOwnerProfilePolicy` | Member 연결형 1:1, dependent 이름·생명주기와 신규 선택 가능 여부 | DEC-037; dependent는 권한·알림 없음, archived는 신규 선택 제외·과거 해석 허용 |

`DEC-020`의 `EndpointRegistrationPolicy`는 Notifications의 Policy이므로 Access Domain에 구현하지 않습니다. Access는 안정적인 memberId와 로그인 등록에 필요한 Membership 검증만 제공합니다. 별도의 endpoint 멤버 전환 Use Case를 Access에 두지 않습니다.

### 4.3 상태 전이

- 가구 생성: Membership 없음 → Household active + 호출자 자기 Member/일반 Membership.
- 초대: issued → used 또는 expired. 같은 hash·같은 Principal 재호출은 최초 결과를 재생하고 다른 Principal이면 Conflict입니다.
- legacy claim: unlinked Member → Google UID Membership linked. 같은 UID 재호출은 멱등 성공이고 다른 UID는 Conflict입니다.
- 이름 변경: version N → N+1. memberId와 linked Principal은 유지합니다.
- 일반 로그아웃·탈퇴 시도: Membership 상태 전이 없음. 공개 `LeaveHousehold` Command가 없으며 재로그인은 같은 Membership을 복원합니다.
- 관리자 강제 제거: Member·Membership `active→removed`, 연결 member 명의자 프로필 `active→archived`, UID claim 삭제. 복구는 claim을 다시 획득한 뒤 같은 ID를 active로 되돌립니다.
- 명의자 프로필: Member 생성·legacy 연결 시 같은 memberId에 연결된 member 프로필을 보장합니다. dependent는 active로 생성하고 관리자 삭제만 archived로 전이하며 Member 프로필은 관리자도 archive하지 않습니다.
- 논리 삭제: active → deleted. 같은 UoW에서 접근을 차단하지만 다른 Context 데이터는 변경하지 않습니다.
- 복구: deleted → active. 영구 purge가 시작되지 않은 경우에만 허용합니다.
- 영구 삭제: 별도 사용자 요청과 운영 확인 뒤 deleted → purging. 모든 Context purge 완료 뒤 claim finalization을 실행하고 모든 page가 끝나야 purged가 되며 purging 이후에는 복구할 수 없습니다.

## 5. Application Use Case 상세

### 5.1 Google 첫 방문·CreateHouseholdWithSelf

1. Inbound Adapter가 Google Principal을 인증하고 기존 Membership을 조회합니다.
2. Membership도 유효한 legacy 후보도 없으면 `FirstVisitRequired(create|join)`을 반환합니다.
3. 가구 생성 선택 시 가구 이름과 자기 표시 이름을 정규화하고 서버가 householdId·memberId를 생성합니다.
4. Household, 호출자 UID에 연결된 자기 Member, 같은 memberId의 member 명의자 프로필, 일반 Membership을 생성합니다. 생성자 전용 role·capability는 저장하지 않고 다른 Member 입력도 받지 않습니다.
5. 같은 UoW에 command receipt와 `HouseholdCreated.v1`, `MemberJoined.v1`을 기록합니다.
6. `Success`는 commit된 householdId·memberId를 반환합니다. 후속 기본 설정·Notifications endpoint 등록은 별도 상태입니다.
7. transaction callback 재실행 시 ID와 Event ID는 바뀌지 않으며 외부 초기화 호출을 실행하지 않습니다.

### 5.2 기존 가구 키 무중단 전환

1. 기존 운영 origin에 배포한 Client Adapter는 Google 로그인 전에 localStorage의 `householdKey`, `currentMemberId`, `currentMemberName`을 메모리 후보로 읽되 신뢰하지 않습니다. householdKey와 currentMemberId 중 하나라도 없으면 `Absent`이며 Android Native 값으로 보완하지 않습니다.
2. Google 로그인 뒤 `ResolveSignedInUser`가 기존 Membership을 먼저 조회합니다. 있으면 legacy 후보를 무시하고 서버 Membership으로 복원합니다.
3. Membership이 없고 후보가 유효하면 UI에 기존 가계부와 멤버 이름을 보여주고 연결 확인을 받습니다. currentMemberName은 표시용입니다.
4. `ClaimLegacyMembership`은 Household active, Member 존재, memberId의 기존 UID binding을 transaction에서 검증합니다.
5. 미연결이면 기존 memberId와 Google UID Membership을 연결하고 같은 memberId의 member 명의자 프로필을 보장합니다. 같은 UID면 최초 결과를 재생하고 다른 UID면 `MEMBER_ALREADY_LINKED`로 끝냅니다.
6. currentMemberId가 없거나 무효하면 Member를 추정·선택하게 하지 않고 `FirstVisitRequired`로 전환하여 신규 사용자 흐름을 표시합니다.
7. 성공 뒤 legacy householdKey 로그인 상태를 지우고 Membership 기반 `SessionSnapshot`과 Android mirror를 저장합니다. 기존 데이터는 이동·복사하지 않습니다.

#### 5.2.1 localStorage 유실 사용자의 운영 복구

1. 일반 Client에는 복구 화면·가구 키 입력·Member 선택 API를 제공하지 않습니다.
2. 소유자가 별도 채널에서 사용자의 Google UID와 연결할 기존 householdId·memberId를 확인한 뒤 운영자·Agent 작업을 요청합니다.
3. 운영 작업은 Household와 Member가 active인지, Member가 미연결인지, 같은 household에서 UID·memberId Membership이 각각 유일한지 검사합니다.
4. 한 transaction에서 Member의 linkedPrincipalUid, `memberships/{principalUid}`, command receipt와 감사 Event를 기록합니다. `users/{uid}/householdMembershipViews`는 같은 Event를 소비하는 Access Projector가 갱신하거나 즉시 재구축합니다.
5. 같은 UID·Member 조합은 멱등 성공하고 다른 UID 또는 다른 Member가 이미 점유했으면 변경 없이 충돌로 종료합니다.
6. 거래·자산·카드·배당·알림 이력은 수정하거나 복사하지 않습니다. 수동 DB 편집이 필요하더라도 이 작업 단위를 빠뜨린 부분 갱신은 금지합니다.

### 5.3 초대 코드 생성·JoinHouseholdAsSelf

1. 설정 Presentation Adapter는 `테마` 카드 바로 다음에 `가구원 초대` 카드를 배치하고 `5분간 유효한 초대 코드`라는 보조 문구와 생성 동작을 제공합니다. 이 문구는 표시를 간결하게 한 것이며 서버의 일회용 정책은 유지합니다.
2. 활성 Membership과 invite capability를 확인하고 CSPRNG로 추측하기 어려운 코드를 생성합니다.
3. code hash, householdId, `expiresAt=issuedAt+5분`, unused 상태를 저장하고 원문은 생성 응답에 한 번만 반환합니다.
4. 가입자는 Google 로그인 뒤 코드와 자기 표시 이름을 제출합니다. 다른 memberId·principalUid 입력은 받지 않습니다.
5. 서버는 코드 hash, 5분 만료, unused, household active, 호출자 미가입을 검증합니다.
6. Invitation used 전이, 호출자 자기 Member, member 명의자 프로필, Membership, receipt, `MemberJoined.v1`을 한 transaction에서 생성합니다.
7. 만료·재사용·경합·이미 가입은 Member를 만들지 않고 typed 실패를 반환합니다.

### 5.4 RenameSelf

1. Actor의 Membership과 가구 active 상태를 검증하고 대상 memberId는 Membership에서만 가져옵니다.
2. `MemberDisplayNamePolicy`가 표시 이름을 정규화하고 동일 가구 충돌을 판정합니다.
3. 자기 Member의 expectedVersion을 검증합니다. 클라이언트가 다른 memberId를 지정할 수 없습니다.
4. Rename UoW는 Member와 연결된 member 명의자 프로필, receipt, `MemberRenamed.v1`을 함께 변경합니다.
5. 카드·자산·거래·FCM Repository를 호출하지 않습니다.
6. 동시 변경은 하나만 성공하고 나머지는 `Conflict(currentVersion)`입니다.

### 5.5 자산 명의자 프로필 관리

1. Member 생성·초대 가입·legacy 연결 UoW는 해당 memberId에 연결된 `member` 프로필이 없으면 함께 생성하고, 이미 있으면 같은 profileId를 재사용합니다.
2. 자산 도넛 그래프의 `+`는 이름 하나만 받는 `CreateAssetOwnerProfile`을 호출합니다. 성공한 dependent 프로필은 자산 명의자 선택지와 필터 목록에 나타나지만 Member·Membership·Invitation·NotificationEndpoint를 만들지 않습니다.
3. 일반 자산 UI는 이름 변경만 제공하며 삭제 버튼과 `ArchiveAssetOwnerProfile` 호출 경로를 포함하지 않습니다. archive Command는 관리자 화면에서만 노출하고 Application도 `admin.asset-owner-profile.archive` capability를 다시 검증합니다.
4. 관리자는 dependent 프로필만 archived로 전이할 수 있습니다. member 프로필은 `RenameSelf` 결과에 따라 같은 Access UoW에서 표시 이름만 맞추고 관리자 archive도 거부합니다.
5. archived dependent 프로필은 기본 목록과 신규 자산 선택에서 제외합니다. `includeArchived` 조회는 기존 Asset과 과거 Snapshot의 profileId를 표시 이름으로 해석하는 용도로만 허용합니다.
6. 이름 변경·보관 Event에는 profileId와 상태만 전달하며 Portfolio Asset·Snapshot을 순회 수정하지 않습니다.
7. 일반 자산 화면의 활성 명의자 목록은 `households/{householdId}/assetOwnerProfiles` Firestore Read Model을 직접 구독합니다. Android WebView에서는 영속 로컬 캐시 값을 먼저 표시하고 같은 listener가 서버 상태로 수렴하며, 일시적인 구독 오류가 이미 표시한 목록을 빈 값으로 덮지 않습니다. 생성·이름 변경·보관은 기존 Access Command 경계를 유지하고 관리자·과거 해석용 `includeArchived` 조회는 서버 Query를 사용합니다.

### 5.6 관리자 가구원 제거·복구

1. Admin Adapter와 Application이 각각 전체 관리자 capability를 검증하고 대상 Household·Member·Membership을 같은 tenant에서 조회합니다. 가구 생성자를 포함한 일반 가구원용 route나 버튼은 만들지 않습니다.
2. `RemoveHouseholdMember`는 대상이 active Member인지와 expected version이 맞는지 확인합니다. 생성 시점이나 마지막 활성 Member 여부를 제거 금지 조건으로 사용하지 않습니다.
3. 한 Access UoW에서 Member·Membership을 removed로, 연결 member 명의자 프로필을 archived로 전환하고 UID 전역 claim을 해제하며 receipt와 `HouseholdMemberRemoved.v1`을 기록합니다. 다른 Context Repository는 호출하지 않습니다.
4. commit 직후부터 `ResolveActorContext`, `ResolveSignedInUser`, active member Query는 removed Membership을 거부합니다. Notifications endpoint cleanup 지연 여부와 무관하게 recipient Query에서도 제외됩니다.
5. `RestoreRemovedHouseholdMember`는 UID 전역 claim이 비어 있을 때만 이를 다시 확보하고 같은 Member·Membership·profile을 active로 복구하며 `HouseholdMemberRestored.v1`을 기록합니다. 이미 다른 가구에 가입했다면 `PRINCIPAL_ALREADY_JOINED`로 끝냅니다.
6. 복구는 Notifications endpoint를 다시 만들지 않습니다. 사용자가 로그인한 각 모바일 설치가 기존 등록 절차로 새 endpoint를 등록합니다.
7. 같은 제거·복구 command 재호출은 receipt 결과를 재생하고 제거와 다른 가구 가입·복구 경합은 UID claim precondition으로 하나만 성공합니다.
8. 마지막 활성 Member가 제거되면 Household는 자동 삭제하지 않고 `active` 상태의 빈 가구로 보존합니다. 일반 접근 주체는 없으며 전체 관리자만 복구·논리 삭제·영구 purge 절차를 수행할 수 있습니다.

### 5.7 RequestHouseholdDeletion

1. 서버가 `household.delete` capability와 expectedVersion을 검증합니다.
2. active Household를 `deleted`로 전환하고 deletedAt·deletedBy를 기록합니다.
3. receipt와 `HouseholdDeleted.v1`을 같은 transaction에 기록합니다.
4. 세션·일반 목록·모든 업무 Context는 이후 `HOUSEHOLD_NOT_ACTIVE`로 접근을 거부합니다.
5. Finance, Capture, Portfolio, Notifications Port를 호출하지 않으며 Canonical·Projection·receipt를 포함한 가구 범위 데이터는 한 건도 삭제하지 않습니다.
6. 같은 멱등 요청은 최초 논리 삭제 결과를 재생합니다.

### 5.8 RestoreDeletedHousehold

1. 서버가 `household.restore` capability와 expectedVersion을 검증합니다.
2. Household가 `deleted`인지, 활성 영구 purge Process가 없는지 확인합니다.
3. Household를 `active`로 전환하고 deletedAt·deletedBy를 비우며 receipt와 `HouseholdRestored.v1`을 한 UoW로 기록합니다.
4. 보존 데이터는 재생성하거나 remap하지 않고 기존 Canonical 데이터를 그대로 다시 사용합니다.
5. 다음 Google 로그인에서 서버의 유일한 active Membership으로 세션을 자동 복원합니다. 가구·멤버 선택 UI는 두지 않으며 서버 Membership 검증을 다시 통과해야 합니다.

### 5.9 RequestPermanentHouseholdPurge

1. 서버가 일반 삭제보다 강한 `household.purge.permanent` capability, 별도 사용자 요청의 confirmation, expectedVersion을 검증합니다.
2. `deleted` Household만 `purging`으로 전환하고 processId, claim snapshot checkpoint와 Context checkpoint 초기값을 가진 Process를 만듭니다. active·purging·purged는 거부합니다.
3. receipt와 `HouseholdPermanentPurgeRequested.v1`을 같은 transaction에 기록합니다. 삭제 요청 UoW에서는 claim을 조회하거나 업무 Context를 호출하지 않습니다.
4. 외부 사용자 요청과 분리된 승인 내부 `RunHouseholdPurgeProcess`가 먼저 현재 해당 가구를 가리키는 claim을 결정적 page로 읽어 server-only `(claimKey, membershipId, claimVersion)` snapshot entry, page receipt와 checkpoint를 같은 transaction에 기록합니다. `purging` 상태에서는 Membership·claim을 바꾸는 일반 명령을 모두 거부하므로 snapshot 원본 집합이 변하지 않습니다.
5. claim snapshot의 모든 page가 완료된 뒤에만 각 Context의 purge Port를 page 단위로 호출합니다. `PageProcessed`에서만 해당 Context checkpoint를 전진하고 retryable 실패는 같은 checkpoint를 보존합니다.
6. 모든 Context와 Access household-scoped purge checkpoint가 `PurgeCompleted`인지 검증합니다. 하나라도 미완료·실패이면 `PrincipalMembershipClaim`을 한 건도 해제하지 않습니다.
7. 완료 뒤 server-only process snapshot에 고정한 `(claimKey, membershipId, claimVersion)` 목록을 결정적 page로 읽고, 현재 claim의 householdId·membershipId·version이 모두 일치할 때만 조건부 삭제합니다. claimKey와 UID 원문은 공개 View·Event·로그에 노출하지 않습니다. 이미 없으면 멱등 성공이고 다른 값이면 삭제하지 않은 채 conflict를 기록합니다.
8. claim finalization page receipt와 checkpoint를 해당 page의 조건부 삭제와 같은 transaction에 기록합니다. 중단되면 완료 page를 되돌리지 않고 다음 page부터 재개합니다.
9. 모든 claim page와 Access 최종 정리가 완료된 뒤 Household `purged`, 완료 receipt와 `HouseholdPurged.v1`을 한 최종 UoW에서 기록합니다. 이후 사용자는 새 가계부 생성·초대 참여가 가능합니다.
10. 자동 Scheduler는 영구 purge를 시작하지 않으며, `purging` 이후에는 일부 데이터가 이미 제거됐을 수 있으므로 restore를 거부합니다.

### 5.10 Admin 조회·명령

1. Admin Adapter도 일반 인증과 Actor 해석을 거칩니다.
2. 이메일 allowlist나 UI 표시값이 아니라 `admin.households.read/write` capability를 확인합니다.
3. 목록은 opaque cursor와 결정 정렬을 사용합니다.
4. 키 복사는 Presentation 책임이며 API가 clipboard를 다루지 않습니다.
5. 논리 삭제 확인은 UI가 수행하되 서버 인가와 idempotency를 대체하지 않습니다. 영구 purge 확인은 일반 삭제 확인과 별개의 운영 계약입니다.
6. 가구 목록의 `가계부 열기`는 현재 탭의 `sessionStorage`에 대상 ID·표시 이름만 보관하고 일반 화면으로 이동합니다. Google ID token의 `systemAdmin: true`를 강제 재확인한 뒤에만 `administrator-readonly` ClientSessionScope를 만들며 Membership과 `actingMemberId`를 생성하지 않습니다.
7. 관리자 조회 SessionScope는 Firestore의 공개 업무 Read Model과 관리자 허용 Query만 읽습니다. 일반 Household Command, 시세 자동 갱신과 Notification endpoint 등록은 실행하지 않으며 Shortcut credential 같은 서버 전용 자료는 일반 조회 화면에 공개하지 않습니다.
8. Firestore Rules는 `systemAdmin`에 명시한 업무 컬렉션의 read만 허용하고 client write는 계속 전부 거부합니다. 서버 Query는 별도의 `admin.household-data.read` capability allowlist를 적용하며 임의 Query가 관리자 권한을 상속하지 않습니다.
9. 화면 상단에 관리자 조회 상태와 대상 가구 이름을 고정 표시합니다. `/admin`으로 돌아오거나 로그아웃하면 탭의 선택값과 관리자 조회 SessionScope를 제거하고, 이후 일반 화면은 관리자의 실제 Membership을 다시 해석합니다.

## 6. Port 설계

### 6.1 Output Port

| Port | 메서드 의미 | 계약 테스트 핵심 |
|---|---|---|
| `PrincipalVerifierPort` | Firebase token 또는 scoped credential을 검증 | 만료·폐기·잘못된 issuer를 Unauthenticated로 변환 |
| `AccessRepository` | Household, Member, Membership, AssetOwnerProfile, Invitation, legacy claim receipt, 수동 Purge Process 조회 | tenant key 강제, version precondition, NotFound/실패 구분 |
| `AccessUnitOfWork` | Access Canonical write·receipt·Outbox 원자 commit | callback 2회 실행에도 Event/receipt 하나 |
| `SessionStorePort` | Web·Android 비권위 SessionSnapshot 저장·삭제 | 부분 삭제 없이 snapshot 단위 교체 |
| `BridgeSessionPort` | 허용 origin에 최소 가구·member selection 전달 | Role·token·invitation 원문 비노출 |
| `NotificationSessionPort` | 자기 Membership memberId의 endpoint 등록·동기화를 Notifications 공개 계약에 위임 | 실패를 로그인·가입 rollback으로 합치지 않음 |
| `Clock` / `IdGenerator` / `SecureCodeGenerator` / `HashingPort` | 5분 만료, 안정 ID, 초대 code·legacy claim hash | 고정 fixture와 CSPRNG Adapter 분리 |
| `OutboxAppendPort` | Access Event append | Event envelope와 producer 검증 |
| `FinancePurgePort` | Finance `PurgeHouseholdData` 호출 | 공통 PurgePageResult fixture |
| `CapturePurgePort` | Capture purge 호출 | opaque checkpoint 보존 |
| `PortfolioPurgePort` | Portfolio purge 호출 | retryable/permanent 구분 |
| `NotificationsPurgePort` | 가구 subscription/delivery purge 호출 | 전역 device 보존 contract |
| `ObservabilityPort` | 보안 감사·trace·metric 기록 | 초대 code·legacy key·displayName 원문 마스킹 |

다른 Context는 `AccessRepository`를 import하지 않고 `ResolveActorContext`와 공개 lifecycle Port만 사용합니다.

### 6.2 Inbound Adapter

- Firebase callable/HTTP Adapter: schema와 인증을 검증하고 공개 Input Port를 호출합니다.
- Web Access Controller: Session Application Port를 호출하고 UI 상태만 관리합니다.
- Android Pairing/Session Adapter: 안전한 pairing 결과를 저장하며 WebView localStorage를 Native 자격으로 쓰지 않습니다.
- Outbox Runner Adapter: 영구 purge Event로 Process Manager를 재개하되 Domain 결정을 포함하지 않습니다. 논리 삭제 Event는 purge를 시작하지 않습니다.
- Admin Route Adapter: capability 기반 결과를 화면 모델로 변환합니다.

## 7. 저장·트랜잭션·동시성

### 7.1 논리 저장

| 논리 데이터 | 목표 key | Canonical Writer |
|---|---|---|
| Household | `households/{householdId}` | Access |
| Member | `households/{householdId}/members/{memberId}` | Access |
| AssetOwnerProfile | `households/{householdId}/assetOwnerProfiles/{profileId}` | Access |
| Membership | `households/{householdId}/memberships/{principalUid}` | Access |
| 사용자 가구 목록 | `users/{uid}/householdMembershipViews/{householdId}` | Access Projector |
| Invitation | `householdInvitations/{invitationHash}` | Access |
| Legacy claim receipt | `legacyMembershipClaims/{claimKeyHash}` 또는 Access command receipt | Access |
| 영구 Purge Process | `households/{householdId}/purgeProcesses/{processId}` | Access |
| Command receipt | 공통 context별 receipt 경로 | Access Application |

Persistence DTO는 `schemaVersion`, `aggregateVersion`, 서버 `createdAt/updatedAt`을 갖습니다. Domain Mapper가 legacy 이름 배열과 목표 Member 문서를 분리합니다.

### 7.2 Unit of Work

- Create self household: Household + 호출자 자기 Member + member 명의자 프로필 + 일반 Membership + receipt + Outbox.
- Invite issue: 5분 expiry Invitation + receipt.
- Join self: Invitation used 전이 + 호출자 자기 Member + member 명의자 프로필 + Membership + receipt + Outbox.
- Legacy claim: 기존 Member UID 연결 + 연결 명의자 프로필 보장 + Membership + claim receipt + Outbox.
- Rename self: 자기 Member와 연결 명의자 프로필 표시 이름 변경 + receipt + Outbox.
- Create/Rename/Archive dependent owner profile: 대상 프로필 + receipt + Outbox; Portfolio write 없음.
- Remove member: 일반 Member·Membership removed + 연결 member profile archived + UID claim 삭제 + receipt + `HouseholdMemberRemoved.v1`.
- Restore removed member: UID claim 재획득 + 같은 Member·Membership·profile active + receipt + `HouseholdMemberRestored.v1`; Notifications endpoint write 없음.
- Logical delete: Household deleted + receipt + `HouseholdDeleted.v1`; 다른 데이터 write 없음.
- Restore: Household active + receipt + `HouseholdRestored.v1`; 기존 데이터 write 없음.
- Permanent purge request: Household purging + HouseholdPurgeProcess + receipt + Outbox.
- Claim snapshot page: server-only claim snapshot entry + page receipt + claim snapshot checkpoint.
- Process checkpoint: HouseholdPurgeProcess의 한 Context checkpoint와 version만 원자 갱신.
- Claim finalization page: 대상 claim의 expected household/membership/version 조건부 삭제 + page receipt + claim checkpoint.
- Purge completion: 모든 Context·claim checkpoint 완료 precondition + Household purged + 완료 receipt + `HouseholdPurged.v1`.

idempotency receipt는 key, payload hash, typed result, 만료 시각을 저장합니다. 같은 key·같은 hash는 결과를 재생하고 다른 hash는 `Conflict(IDEMPOTENCY_PAYLOAD_MISMATCH)`입니다.

### 7.3 경합

- 같은 invitation 동시 수락은 version/precondition으로 한 Principal만 성공합니다.
- 같은 legacy Member를 서로 다른 Google UID가 동시에 claim하면 Member/Membership precondition으로 한 UID만 성공합니다.
- 같은 Google UID가 가구 생성·초대 참여를 동시에 요청하면 household별 Membership 유일성 제약으로 자기 Member 하나만 성공합니다.
- `purging` 전환 뒤에는 Member 제거·복구·가입처럼 Membership이나 claim을 바꾸는 일반 명령을 거부하여 page 단위 claim snapshot의 원본 집합을 고정합니다.
- 멤버 rename은 expected aggregateVersion으로 lost update를 막습니다.
- 관리자 제거와 다른 가구 가입·복구가 경합하면 UID 전역 claim transaction으로 하나만 성공하며 다른 활성 claim을 덮어쓰지 않습니다.
- 논리 삭제와 복구 경합은 expectedVersion으로 한 전이만 성공합니다.
- 영구 Purge Process는 lease와 process version을 사용하며 완료된 checkpoint를 뒤로 돌리지 않습니다.
- Context purge 미완료와 claim finalization 시작이 경합하면 완료 precondition 때문에 claim write는 0건입니다. claim이 이미 없으면 멱등 처리하고 다른 값으로 바뀌었으면 compare-and-delete가 이를 보존해 운영 conflict를 기록하되, 고정 snapshot의 다음 entry부터 finalization을 계속합니다.

### 7.4 전환

1. 배포 전 기존 `households` 멤버 배열의 안정 memberId 존재 여부를 조사하고 누락 ID만 backfill합니다. 기존 household 문서 ID와 memberId는 바꾸지 않습니다.
2. 새 Client는 기존 운영 origin에서 Google 로그인 전에 `householdKey/currentMemberId/currentMemberName`을 `LegacySessionCandidate`로 포착합니다. 완전한 Web 후보만 사용하며 기존 앱 데이터·Web origin을 선제 삭제하거나 변경하지 않습니다.
3. Google Auth·Member/Membership V2·`ClaimLegacyMembership`을 기존 물리 schema 위에 추가하고 같은 UID 재시도·다른 UID 선점 테스트를 먼저 활성화합니다.
4. 첫 로그인에서 기존 householdId·memberId를 Membership에 연결하고 legacy 로그인 상태를 제거합니다. 거래·자산·카드·알림 데이터는 복사하지 않습니다.
5. Membership이 생긴 요청부터 Rules와 서버 Command Writer만 허용하고 localStorage 값은 session mirror로만 사용합니다.
6. legacy claim 사용량과 충돌을 관측합니다. 전환 기간이 끝날 때까지 claim feature flag는 유지하되 신규 가구 키 입력 UI는 제공하지 않습니다.
7. 기존 사용자 전환이 확인되면 별도 배포에서 claim endpoint와 key-only read/write를 제거합니다.
8. Portfolio 전환 전에 기존 Member마다 member 명의자 프로필을 만들고, 레거시 `assets.owner`에만 존재하는 비로그인 이름은 dependent 프로필로 준비한 reconciliation manifest를 생성합니다. Access는 Portfolio 저장소를 직접 읽거나 수정하지 않습니다.

## 8. Event·Projection·외부 연동

### 8.1 생산 Event

| Event | 최소 payload | 소비자 |
|---|---|---|
| `HouseholdCreated.v1` | householdId, creatorMemberId, initializationVersion | Category 초기화, Home Preferences |
| `MemberJoined.v1` | householdId, memberId | 필요한 member display Read Model |
| `MemberRenamed.v1` | householdId, memberId, newDisplayName | 표시 이름을 비정규화한 Read Model |
| `AssetOwnerProfileChanged.v1` | householdId, profileId, profileType, lifecycleState, newDisplayName? | Portfolio·Reporting의 명의자 표시 Read Model; Asset·Snapshot 변경 금지 |
| `HouseholdMemberRemoved.v1` | householdId, memberId, principalRefHash, removedAt, membershipVersion | Notifications endpoint cleanup·세션 차단; 제거 사유 원문 제외 |
| `HouseholdMemberRestored.v1` | householdId, memberId, restoredAt, membershipVersion | 세션·표시 Read Model; endpoint 자동 복원 금지 |
| `HouseholdDeleted.v1` | householdId, deletedAt, deletedByHash | Session·운영 Adapter; purge consumer 금지 |
| `HouseholdRestored.v1` | householdId, restoredAt, restoredByHash | Session·운영 Adapter |
| `HouseholdPermanentPurgeRequested.v1` | householdId, processId, confirmationRefHash | 영구 Purge Process Runner |
| `HouseholdPurged.v1` | householdIdHash, processId, purgedAt, releasedClaimCount | 모든 Context·claim finalization 완료 뒤 운영 감사; 재가입 시작 가능 신호 |

Event는 Canonical 변경과 같은 transaction에서 append하며 invitation code, Firebase token, legacy household key 원문을 담지 않습니다. 각 consumer는 `(eventId, handlerName)` Inbox receipt로 멱등 처리합니다.

### 8.2 Projection

`householdMembershipViews`는 Principal의 가구 목록을 위한 Access 소유 Projection입니다.

- 단일 Writer: Access Membership Projector
- 원천: Membership create/change와 Household lifecycle Event
- checkpoint: eventId와 aggregateVersion
- 정렬: household updatedAt 내림차순, householdId 오름차순
- rebuild: Canonical Membership을 Principal별 page로 재생성
- freshness: `schemaVersion`, `sourceCheckpoint`, `updatedAt`을 반환

### 8.3 외부 연동

Firebase Auth와 local storage의 예외를 그대로 노출하지 않습니다. Provider 오류는 `Unauthenticated` 또는 `RetryableFailure(code)`로 정규화합니다. 다른 Context 초기화는 Outbox 뒤에서 실행하며 부분 실패를 Access Household 생성 실패로 합치지 않습니다.

## 9. 오류·보안·관측성

### 9.1 안정 오류 코드

| 분류 | 코드 예 |
|---|---|
| 검증 | `INVALID_HOUSEHOLD_NAME`, `INVALID_MEMBER_NAME`, `INVALID_OWNER_PROFILE_NAME`, `INVALID_INVITATION_CODE` |
| 인증·인가 | `GOOGLE_AUTH_REQUIRED`, `MEMBERSHIP_REQUIRED`, `CAPABILITY_REQUIRED`, `SELF_MEMBER_ONLY`, `ADMIN_MEMBER_REMOVE_REQUIRED` |
| 충돌 | `MEMBER_ALREADY_LINKED`, `MEMBERSHIP_ALREADY_EXISTS`, `DISPLAY_NAME_EXISTS`, `OWNER_PROFILE_ARCHIVED`, `MEMBER_PROFILE_IMMUTABLE`, `OWNER_REMOVAL_REQUIRES_TRANSFER`, `PRINCIPAL_ALREADY_JOINED`, `MEMBER_NOT_REMOVED`, `VERSION_MISMATCH`, `HOUSEHOLD_NOT_ACTIVE` |
| 초대 | `INVITATION_NOT_FOUND`, `INVITATION_EXPIRED_OR_USED` |
| 삭제 | `DELETION_ALREADY_RUNNING`, `PURGE_RETRYABLE`, `PURGE_PERMANENT_FAILURE` |
| 계약 | `UNSUPPORTED_CONTRACT_VERSION`, `IDEMPOTENCY_PAYLOAD_MISMATCH` |

Transport 문자열이 아니라 Result 종류와 code를 테스트합니다.

### 9.2 보안

- 모든 서버 Command는 Firebase ID token 또는 scoped credential을 요구합니다.
- householdId는 Actor Membership과 일치해야 하며 클라이언트 Role을 무시합니다.
- Canonical write, invitation, legacy claim, receipt, outbox, deletion process는 server-only입니다.
- 공개 Read Contract도 동일 가구 Membership과 query 범위를 Rules에서 강제합니다.
- Admin SDK Handler는 Application 인가를 생략하지 않습니다.
- 초대 code, legacy 가구 키, displayName, 전체 Membership은 로그에 기록하지 않습니다.
- T-SEC-001/002와 기능 보안 테스트의 의미 중복은 [테스트 전략](../../../../governance/test-strategy.md#43-의미-중복-감사-대상)에 따라 Canonical 소유자를 정리합니다.

### 9.3 관측성

모든 Command에 commandId, correlationId, householdId의 비가역 표기, principal의 비가역 표기, result code, retry count를 기록합니다. legacy claim은 성공·이미 연결·다른 UID 충돌 count만, 초대는 발급·만료·소비 count만 기록합니다. 수동 영구 Purge Process는 Context, checkpoint hash, page count, deletedCount, attempt, next retry를 metric으로 남깁니다. displayName, invitation code, legacy key 원문은 구조화 로그에 포함하지 않습니다.

## 10. 목표 패키지 구조

아직 없는 경로는 모두 `목표`입니다.

```text
functions/src/contexts/access/
  domain/
    household/
    member/
    membership/
    asset-owner-profile/
    invitation/
    policies/
  application/
    commands/
    queries/
    ports/in/
    ports/out/
  workflows/
    household-deletion/
  adapters/
    in/callable/
    in/outbox/
    out/firestore/
    out/firebase-auth/
  public.ts

web/src/features/access/
  application/session/
  adapters/functions-api/
  adapters/local-session/
  presentation/
  public.ts

android/core/auth-session/
  application/
  adapters/
```

의존 방향은 Adapter → Application → Domain입니다. 다른 Functions Context는 `functions/src/contexts/access/public.ts`만 import합니다. Web·Android는 생성된 wire DTO와 자기 runtime의 Controller만 사용합니다.

## 11. 테스트 설계

### 11.1 계층별 suite

- Domain Unit: 표시 이름, 초대 만료·일회 사용, lifecycle 상태 전이, capability 정책.
- Application: 인가, idempotency replay/conflict, UoW rollback, 이름 변경 Event, 관리자 Member 제거·복구, 논리 삭제·복구, 수동 purge checkpoint.
- Contract: Command/Result version fixture, TypeScript·Kotlin DTO, legacy invitation URL.
- Repository Conformance: In-memory Fake와 Firestore Adapter의 version·NotFound·query 의미.
- Emulator: Rules 권한 행렬, legacy member claim·invitation 경합, transaction callback 재실행, Outbox 원자성.
- Client: 유효/무효/일시 실패 세션 복원, 성공 후에만 local/Bridge 갱신.
- E2E: 초대 참여, 관리자 가구 관리, deleted 접근 차단·복구·데이터 불변, 별도 수동 purge 재시도.

필수 fixture는 `FixedClock`, `SequenceIdGenerator`, `RetryingUnitOfWorkFake`, 초대 5분 경계, 같은 legacy Member의 서로 다른 UID 동시 claim, 같은 idempotency key의 동일/상이 payload, 가구 A Actor의 가구 B 접근을 포함합니다.

### 11.2 요구사항 추적 표

| 요구사항 ID | 테스트 수준 | 테스트 대상 | 핵심 fixture/경계값 | 관찰 결과 | Canonical 테스트 ID |
|---|---|---|---|---|---|
| HH-001 | Client·Application | CaptureLegacySessionCandidate·ResolveSignedInUser | 후보 있음/없음, Membership 있음, Repository 일시 실패 | 서버 Membership 우선, legacy 확인 또는 첫 방문 분기, 실패 시 후보 보존 | T-HH-001, T-HH-002 |
| HH-002 | Domain·Emulator·E2E | ClaimLegacyMembership·RepairLegacyMembershipClaim | 유효·무효 memberId, 같은 UID 재시도, UID의 다른 Membership, 다른 UID 동시 claim, memberId 없음, 검증된 운영 복구·무권한 호출 | 기존 ID 연결·멱등 성공·UID/Member 선점 충돌·신규 사용자 전환을 구분하고, 운영 복구만 정확한 단일 claim과 감사 기록을 원자 생성하며 기존 업무 데이터 불변 | T-HH-001, T-HH-002 |
| HH-003 | Client·E2E | FirstVisitController | Membership·legacy 후보 없음 | 초대 코드 또는 새 가계부 생성만 표시, 가구 키 입력 없음 | T-HH-JOIN-001 |
| HH-004 | Client·Integration | LogoutHouseholdSession | endpoint 제거 성공·이미 없음·일시 실패, 가구·멤버·Bridge mirror 존재 | 성공·이미 없음 뒤에만 선택값 제거; 실패 시 세션 유지 | T-HH-005 |
| HH-005 | Application·Client | RestoreSignedInSession | 자기 Membership, Bridge/Notification endpoint Adapter 실패 | 자기 memberId만 session에 반영하고 endpoint 결과 분리; 다른 Member 선택 없음 | T-HH-005 |
| HH-006 | Domain·Emulator | SelfMemberCreationPolicy | 빈·중복 이름, 타인 UID/memberId 위조, 생성·가입 경합 | 호출자 자기 Member 하나만 생성, 위조·중복 거부 | T-HH-003 |
| HH-007 | Application·Outbox | CreateHouseholdWithSelf | 가구·자기 이름, 기존 Membership, 생성·가입 동시 경합, 후속 초기화 실패 | UID claim·Household·자기 Member·일반 Membership 원자 생성, 생성자 특권 없음, 기존 가입·경합 loser는 부분 생성 0건, 후속 상태 별도 | T-HH-003 |
| HH-008 | Client·E2E | Guard와 ResolveSignedInUser | Membership, legacy 후보, 첫 방문, admin, guest | 허용 상태만 표시하고 key/guest 우회 차단 | T-HH-001, T-HH-JOIN-001 |
| HH-009 | Domain·Application·E2E | RenameSelf | 자기·타인 Member, 이름 충돌, version 경합 | 자기 표시 이름만 변경되고 모든 참조 ID 유지 | T-HH-004, T-HH-SEC-001 |
| HH-010 | Contract·Application·Client | 공개 Command allowlist·LogoutHouseholdSession·RestoreSignedInSession | 탈퇴 요청, 로그아웃·재로그인, 가구 논리 삭제·복구 | LeaveHousehold 없음, Membership·Member 불변, 같은 memberId 복원 | T-HH-005 |
| HH-011 | Domain·Application·Client·보안 E2E | AssetOwnerProfilePolicy·일반 자산 UI·관리자 UI | Member 프로필, dependent, 일반/관리자 archive, archived 참조 | 일반 삭제 surface·권한 없음, 관리자만 dependent archive, profileId·과거 이름 유지 | T-HH-006 |
| HH-012 | Domain·Application·Outbox·보안 E2E | AdminMemberRemovalPolicy·Remove/RestoreHouseholdMember | 생성자/초대 가입자/전체 관리자, 마지막 Member, 기존 업무 기록, UID claim 경합, 중복 Event | 관리자만 모든 Member에 동일한 제거·복구 적용, 빈 가구·기록 보존, 즉시 actor 차단, claim 해제/재획득, 같은 ID 유지 | T-HH-007 |
| HH-JOIN-001 | Client·Domain·Contract·E2E | SettingsPage·InvitationSettings·CreateInvitationCode·JoinHouseholdAsSelf | 설정 카드 순서·보조 문구, 발급 직후·5분 경계·만료·재사용·동시 사용·UID의 기존 다른 Membership | 테마 다음에 초대 카드와 간결한 5분 안내를 표시하고, 유효 코드와 미가입 UID만 한 번 소비해 UID claim·자기 Member·Membership을 원자 생성하며 기존 가입자는 Invitation·데이터 무변경 | T-HH-JOIN-001 |
| ADM-001 | Contract·E2E | Admin ports | 허용/비허용 관리자, 최신순 cursor, 삭제 확인 | 조회·생성·복사 UI·삭제 상태 관찰 | T-ADM-001 |
| ADM-002 | Emulator·보안 E2E | Rules와 server Handler | 무인증·동일 가구·타 가구·관리자 | 최소 권한만 허용하고 거부 시 변경 없음 | T-HH-RULES-001, T-HH-SEC-001 |
| ADM-003 | Domain·Application·Contract·E2E·동시성 | RequestHouseholdDeletion·RestoreDeletedHousehold·HouseholdPurgeProcess·PurgeClaimFinalizationPolicy | 다중 Context 성공/실패, 다중 claim, snapshot·finalization page 중단, absent·stale claim, 재시도 | snapshot 완료 전 Context 호출 0건, Context 미완료 중 claim 0건 해제, 완료 뒤 일치 claim만 page 해제, 모든 checkpoint 완료 뒤 purged Event 한 번, 재가입 가능 | T-ADM-002 |
| ADM-004 | Client·Query·Rules·보안 E2E | AdminHouseholdViewSelection·administrator-readonly SessionScope·공개 Read Model | 관리자/일반 사용자, 타 가구 Membership 없음, 탭 전환, 가구 탐색·쓰기·endpoint 등록 시도 | systemAdmin만 선택 가구 조회, Member 가장·업무 쓰기·알림 binding 0건, 관리자 배너와 복귀 시 선택 해제 | T-ADM-003 |

`T-HH-RULES-001`/`T-HH-SEC-001`과 공통 `T-SEC-001`/`T-SEC-002`의 중복 실행은 통합 전에 한 Canonical suite가 공유 fixture를 제공하도록 정리합니다. 새 ID는 이 문서에서 만들지 않습니다.

## 12. 미결정 사항과 구현 순서

### 12.1 Human in the loop

partner 선택 정책은 [DEC-022](../../../../governance/decisions.md#dec-022), Membership cardinality는 [DEC-034](../../../../governance/decisions.md#dec-034), 일반 Member 강제 제거는 [DEC-038](../../../../governance/decisions.md#dec-038), household owner 미도입은 [DEC-039](../../../../governance/decisions.md#dec-039), 영구 purge 뒤 claim 해제는 [DEC-040](../../../../governance/decisions.md#dec-040)으로 해소되었습니다. Access는 role 없는 active Membership과 서버 capability 검증을 제공하고 Notifications가 이를 사용해 수신 대상을 계산합니다.

### 12.2 구현 순서

1. 현재 Session restore/logout과 관리자 화면에 Characterization test를 붙입니다.
2. `ActorContext`, capability와 typed Result seam을 만들고 모든 Handler 앞에 적용합니다.
3. Member stable ID와 Membership을 legacy schema 위에 도입하고 localStorage 후보 포착을 배포합니다.
4. Google 로그인·legacy claim 경합과 Rules tenant/admin 행렬을 먼저 통과시킵니다.
5. 기존 사용자의 householdId·memberId를 같은 UID Membership에 연결한 뒤 session을 서버 권위로 전환합니다.
6. CreateHouseholdWithSelf·5분 Invitation·JoinHouseholdAsSelf·RenameSelf를 서버 Command로 옮기고 AddMember·SelectMember·신규 key 입력을 제거합니다.
7. Member별 명의자 프로필과 dependent backfill manifest를 만든 뒤 `T-HH-006`을 활성화하고 Portfolio ownerRef 전환에 공개 Query를 제공합니다.
8. `RemoveHouseholdMember`·복구, UID claim 경합과 `HouseholdMemberRemoved.v1` endpoint cleanup contract를 `T-HH-007`로 활성화합니다.
9. 현재 `deleteDoc`을 논리 삭제 Command로 교체하고 deleted 접근 차단·복구·데이터 불변 테스트를 활성화합니다.
10. 수동 `RequestPermanentHouseholdPurge`와 checkpoint Process Manager를 일반 삭제 흐름과 분리합니다.
11. V2 Member/Membership read를 shadow compare하고 legacy claim 사용량을 확인한 뒤 feature flag와 key-only/direct Writer를 제거합니다.

결과가 확정된 목표 테스트는 공개 Subject와 assertion을 갖춘 `describe.skip`으로 등록하고, 보안 결함 테스트는 서버 인가와 Rules가 함께 준비되는 변경에서 활성화합니다. 제품 결정이 남은 시나리오만 `test.todo`로 둡니다.

### 12.3 현재 서버 런타임 연결

- `executeAdminAccess`는 일반 가구 Command manifest와 분리된 관리자 전용 callable입니다. Firebase가 검증한 ID token의 `systemAdmin: true` claim만 `HouseholdAdministratorActor`로 변환하며 이메일, 클라이언트 role·capability payload는 거부합니다.
- `FirebaseMemberLifecycleUnitOfWork`는 가구원 제거 시 Member·Membership·연결 member 명의자 프로필·UID 전역 claim·사용자 Membership projection·receipt·Outbox를 한 Firestore transaction에서 변경합니다. 복구도 같은 ID와 transaction을 사용하고 다른 가구 claim이 있으면 충돌합니다.
- `FirebaseHouseholdLifecycleUnitOfWork`는 관리자 전용 가구 복구를 지원합니다. 일반 사용자 UI에는 가구·가구원·명의자 복구를 노출하지 않습니다.
- 일반 자산 화면의 명의자 `+`는 dependent 프로필 생성만 수행하며, 이름 변경은 허용하되 보관은 관리자 화면에서만 실행합니다. 자산 입력은 표시 이름 대신 typed `ownerRef`를 함께 전송합니다.
- 관리자 claim 부여는 배포와 별개인 운영 절차입니다. [배포 전제조건](../../../../../operations/deployment-prerequisites.md)에 따라 대상 프로젝트와 Firebase UID를 명시하고 토큰을 갱신해야 합니다.
