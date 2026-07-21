# 가구·접근 모듈 요구사항

> 상위 Bounded Context: [Access & Household](../../requirements.md)  
> 아키텍처 역할: Core Domain / Application  
> 상세 설계: [모듈 상세 설계](design.md)  
> 상태와 테스트 수준의 의미는 [공통 규약](../../../../governance/conventions.md)을 따릅니다.  
> 이 문서는 `HH-*`, `HH-JOIN-*`, `ADM-*` 요구사항의 단일 소유 문서입니다.

## 1. 독립 모듈 책임

가구·접근 모듈은 Google 사용자가 어느 가구에서 자기 멤버 자격으로 동작하는지 결정하고 그 생명주기를 관리합니다. 첫 로그인, 자기 Member 생성, 5분 초대 코드 참여, 기존 가구 키 세션의 무중단 계정 연결, 로그아웃과 관리자 가구 관리를 하나의 경계로 묶습니다.

자산 명의자처럼 로그인 권한과 무관한 가구 내 프로필도 안정적인 ID로 관리합니다. 이 프로필은 Member/Membership을 대체하지 않으며 Portfolio는 공개 조회 계약으로만 참조합니다.

이 모듈이 보장할 핵심 불변식은 다음과 같습니다.

- 모든 가구 범위 명령과 조회에는 유효한 `householdId`가 있어야 합니다.
- 현재 멤버는 Google UID의 Membership에 연결된 자기 Member여야 합니다.
- 한 Google UID에는 전체 가계부를 통틀어 UID 전역 claim을 보유한 Membership이 최대 하나이며 일반 사용자는 가계부를 선택·전환하지 않습니다. 관리자에 의해 removed가 된 Membership은 감사·복구용으로 남지만 claim을 보유하지 않습니다.
- 사용자는 자기 Member만 생성·이름 변경할 수 있고 다른 사람의 Member를 미리 생성하거나 선택할 수 없습니다.
- 멤버 이름은 표시 값이며, 장기적으로 다른 모듈의 외래 키로 사용하지 않습니다.
- 자산 명의자 프로필은 로그인 Membership과 분리하며 이름 대신 안정적인 profileId로 참조합니다.
- 관리자 작업은 클라이언트 화면 분기가 아니라 서버의 인증·인가 계약으로 보호합니다.
- 가구 삭제와 멤버 이름 변경처럼 여러 모듈에 영향을 주는 작업은 각 모듈의 공개 계약을 조율합니다.

## 2. 포함·제외 범위

### 포함

- Google 로그인 후 Membership 복원과 로그아웃
- 첫 방문의 새 가계부 생성 또는 5분 초대 코드 참여
- 자기 Member 생성·이름 변경
- Member 연결형·비로그인 dependent 자산 명의자 프로필 생성·조회·이름 변경과 관리자 전용 논리 보관
- 기존 localStorage 가구 키·멤버 ID의 일회성 Membership 전환
- 가구 생성과 관리자용 조회·복사·삭제
- 전체 관리자 전용 일반 가구원 강제 제거·복구와 UID claim 해제
- 가구·멤버 단위 접근 권한 판정
- 멤버 변경 이후 다른 모듈에 전달할 식별자 변경 이벤트

### 제외

- 거래·자산·카드·푸시 FID endpoint 자체의 저장과 수정
- Google OAuth와 Firestore Rules의 기술 구현
- FCM 전달 대상 계산과 실제 푸시 전송
- 홈 요약 카드, 기본 카테고리 등 다른 기능 설정의 업무 규칙
- 가구 삭제 시 종속 데이터를 직접 열거해 삭제하는 구현

제외 항목은 이 모듈이 정의한 가구·멤버 식별자와 접근 판정 계약을 사용하지만, 각 데이터의 수명주기는 소유 모듈이 관리합니다.

## 3. 소유 데이터

| 데이터 | 소유 범위 | 비고 |
|---|---|---|
| `households` | 가구 이름, 멤버 식별자·표시 이름, 가구 생명주기 | 기본 카테고리·홈 설정 필드는 현재 함께 저장되지만 해당 정책은 기능 소유 모듈의 계약을 통해 변경합니다. |
| Membership·PrincipalMembershipClaim | Google UID, householdId, 자기 memberId, lifecycle status | 현재는 명시 모델이 없습니다. 목표에서는 owner role 없이 UID 전역 단일 Membership을 강제하는 서버 Canonical입니다. |
| 현재 세션 mirror | Membership에서 파생한 householdId·memberId·표시 이름 | Web 로컬 저장소와 Android native 저장소의 비권위 cache입니다. |
| LegacySessionCandidate | 기존 Web `householdKey`, `currentMemberId`, `currentMemberName` | householdKey와 currentMemberId가 모두 있을 때만 첫 Google 로그인 전환에 사용하고 성공 후 legacy 로그인 상태를 제거합니다. Android Native 값은 신원 복구 근거로 사용하지 않습니다. |
| Invitation | householdId, 5분 만료, 일회 소비 상태, code hash | 원문 코드는 생성 응답에서 한 번만 노출합니다. |
| AssetOwnerProfile | householdId, profileId, 표시 이름, member/dependent 유형, linkedMemberId?, active/archived 상태 | 로그인 Member와 분리한 자산 명의자 디렉터리입니다. Member 프로필은 1:1로 연결되고 dependent에는 로그인·권한·알림 의미가 없습니다. |
| 관리자 주체 | 인증된 사용자와 관리자 권한 판정 결과 | OAuth 계정 정보는 외부 인증 Adapter가 소유합니다. |

이 모듈은 `assets.owner`, `registered_cards.owner`, Notifications의 `NotificationEndpoint`, `expenses.createdBy`를 소유하지 않습니다. 현재 legacy `fcmTokens`도 Access의 소유 데이터가 아닙니다. 멤버 변경 시 해당 모듈에 안정적인 멤버 ID 기반 명령이나 이벤트를 전달해야 합니다.

## 4. 공개 계약·의존 모듈

### 외부에 제공하는 계약

| 계약 | 입력 | 결과 |
|---|---|---|
| `ResolveSignedInUser` | 검증된 Google Principal | 유일한 기존 Membership 또는 `FirstVisitRequired` |
| `ClaimLegacyMembership` | Google Principal, legacy householdKey·memberId, 사용자 확인 | 기존 Member에 연결된 Membership 또는 충돌 |
| `CreateHouseholdWithSelf` | Google Principal, 가구 이름, 자기 표시 이름 | 새 Household·자기 Member·일반 Membership |
| `CreateInvitationCode` | 현재 Membership | 5분 동안 한 번 유효한 초대 코드 |
| `JoinHouseholdAsSelf` | Google Principal, 초대 코드, 자기 표시 이름 | Invitation 소비와 자기 Member·Membership 생성 |
| `LogoutHouseholdSession` | 현재 세션·설치 endpoint | endpoint 제거 뒤 로컬 컨텍스트 제거 완료 |
| `RenameSelf` | 현재 Membership, 새 표시 이름 | 자기 Member 표시 이름 변경과 `MemberRenamed` 이벤트 |
| `CreateAssetOwnerProfile` | 현재 Membership, dependent 표시 이름 | 로그인 권한 없는 활성 명의자 프로필 |
| `RenameAssetOwnerProfile` | 현재 Membership, dependent profileId·새 이름·expectedVersion | 안정 profileId를 유지한 표시 이름 변경 |
| `ArchiveAssetOwnerProfile` | 서버가 검증한 관리자, dependent profileId·expectedVersion | 기존 참조를 보존한 관리자 전용 논리 보관 |
| `ListAssetOwnerProfiles` | 현재 Membership, active 또는 includeArchived 범위 | 자산 선택·필터·과거 이름 해석용 프로필 목록 |
| `RemoveHouseholdMember` | 서버가 검증한 전체 관리자, householdId·memberId·expectedVersion·사유 | 생성자를 포함한 활성 Member의 복구 가능한 제거와 UID claim 해제 |
| `RestoreRemovedHouseholdMember` | 서버가 검증한 전체 관리자, householdId·memberId·expectedVersion | 다른 Membership이 없을 때 같은 Member·명의자 프로필 복구 |
| `DeleteHousehold` | 관리자 주체, 가구 ID | 데이터는 보존하고 접근을 차단한 논리 삭제 결과 |
| `RestoreDeletedHousehold` | 관리자 주체, 삭제된 가구 ID | 다시 활성화된 가구 |
| `RequestPermanentHouseholdPurge` | 승인된 관리자·운영 주체, 삭제된 가구 ID, 확인 정보 | 수동 영구 삭제 Process 시작 결과 |
| `RepairLegacyMembershipClaim` | 신원 확인을 마친 운영자·Agent, 정확한 UID·householdId·memberId | 기존 단일 UID claim의 원자 교정과 감사 결과 |
| `AuthorizeHouseholdAction` | 주체, 가구 ID, 작업 | 허용 또는 권한 오류 |

### 내부 System Process 계약

| 계약 | 입력 | 결과 |
|---|---|---|
| `RunHouseholdPurgeProcess` | `householdLifecycle:purge` SystemActor, processId | claim snapshot·Context purge·claim finalization을 checkpoint부터 재개한 내부 처리 결과 |

### 의존 모듈·포트

- 인증 Adapter: Google 로그인 주체를 검증합니다.
- 로컬 세션 저장소: Web·Android의 서버에서 확정된 현재 가구·멤버 mirror를 보존합니다.
- [결제 설정 모듈](../../../payment-capture/modules/payment-configuration/requirements.md): 멤버 ID에 연결된 카드 소유권을 관리합니다.
- 자산 모듈: `household` 또는 이 모듈의 안정적인 profileId를 참조해 자산 명의를 관리합니다.
- [알림 모듈](../../../notifications/modules/notifications/requirements.md): 멤버 ID에 연결된 설치 endpoint와 요청자를 제외한 전체 수신 대상을 관리합니다.
- 모든 가구 범위 모듈: 가구 삭제 준비·완료 계약과 접근 판정을 사용합니다.

의존 모듈은 `households` 문서를 직접 변경하지 않으며, 이 모듈도 다른 모듈 컬렉션을 직접 갱신하지 않습니다.

## 5. 요구사항

| ID | 상태 | 사전조건 / 행동 / 결과 | 경계·예외 | 근거 | 테스트 |
|---|---|---|---|---|---|
| HH-001 | 목표 명세 | 앱은 Google 로그인 전에 기존 localStorage의 `householdKey`, `currentMemberId`, `currentMemberName`을 `LegacySessionCandidate`로 읽는다. householdKey와 currentMemberId가 모두 있고 첫 로그인한 UID에 Membership이 없을 때만 기존 가계부 연결 확인을 제공한다. | migration client는 기존 Web origin에서 먼저 배포한다. legacy 값은 장기 인증 자격이 아니다. 이미 유일한 Membership이 있으면 서버 값을 바로 복원하고 다른 legacy 후보를 덮어쓰거나 추가 연결하지 않는다. localStorage가 없거나 후보가 불완전·무효하면 신규 사용자의 새 가계부·초대 코드 첫 방문 화면으로 보낸다. Android Native 값으로 사용자를 추정하지 않는다. | [HouseholdContext](../../../../../../web/src/contexts/HouseholdContext.tsx), [memberStorage](../../../../../../web/src/lib/storage/memberStorage.ts), [DEC-021](../../../../governance/decisions.md#dec-021), [DEC-034](../../../../governance/decisions.md#dec-034) | U, I, E2E |
| HH-002 | 목표 명세 | 사용자가 확인하면 서버는 legacy householdKey의 기존 Household와 currentMemberId의 Member를 같은 Google UID Membership에 원자적으로 연결하고 기존 householdId·memberId를 그대로 반환한다. | 같은 UID·같은 Membership이면 멱등 성공한다. UID에 다른 Membership이 있거나 Member를 다른 UID가 이미 연결했으면 덮어쓰거나 두 번째 연결을 만들지 않고 충돌이다. memberId가 없거나 무효하면 사용자용 Member 선택·복구를 제공하지 않고 신규 사용자 흐름으로 보낸다. 별도 신원 확인을 거친 운영자·Agent만 정확한 UID·householdId·memberId로 기존 단일 claim을 원자 교정할 수 있으며 감사 기록을 남긴다. 기존 거래·자산·카드는 복사하지 않는다. | 같은 근거와 [DEC-021](../../../../governance/decisions.md#dec-021), [DEC-034](../../../../governance/decisions.md#dec-034) | U, I, 동시성 E2E |
| HH-003 | 목표 명세 | Google 로그인한 UID에 Membership이 없고 유효한 legacy 전환 후보도 없으면 `초대 코드 입력` 또는 `새 가계부 생성`을 선택하는 첫 방문 화면을 표시한다. | 신규 사용자가 가구 키를 직접 입력하는 경로는 제공하지 않는다. 기존 키 전환은 localStorage 후보와 전환 feature flag가 있을 때만 별도 흐름으로 실행한다. | [DEC-021](../../../../governance/decisions.md#dec-021) | UI, E2E |
| HH-004 | 목표 명세 | 로그아웃은 Notifications의 현재 설치 endpoint가 `Removed` 또는 `AlreadyAbsent`임을 확인한 뒤 가구·멤버 상태와 로컬 저장 정보를 제거한다. | endpoint 삭제가 실패하면 로컬 로그아웃을 완료하지 않고 재시도할 수 있게 한다. 현재 코드는 로컬 상태만 제거하므로 목표와 차이가 있다. | [HouseholdContext](../../../../../../web/src/contexts/HouseholdContext.tsx), [DEC-020](../../../../governance/decisions.md#dec-020) | U, I, E2E |
| HH-005 | 목표 명세 | Google UID의 유일한 Membership이 확정되면 `sessionGeneration`, principalUid, householdId, 자기 memberId·이름을 하나의 versioned SessionScope로 세션 mirror와 Android 브리지에 원자 교체하고 Notifications endpoint 등록을 별도로 동기화한다. | 가계부·Member 선택 또는 partner 상태를 두지 않는다. 교체 전 이전 listener·cache·요청을 폐기하고 늦은 callback을 무시한다. endpoint 등록 실패는 로그인 성공과 분리해 재시도하며 다른 설치 endpoint를 덮어쓰지 않는다. legacy partnerName은 읽지 않고 전환 완료 뒤 제거한다. | [HouseholdContext](../../../../../../web/src/contexts/HouseholdContext.tsx), [SYS-008](../../../../system/context.md#6-공통-요구사항), [DEC-020](../../../../governance/decisions.md#dec-020), [DEC-021](../../../../governance/decisions.md#dec-021), [DEC-022](../../../../governance/decisions.md#dec-022), [DEC-034](../../../../governance/decisions.md#dec-034) | I, E2E |
| HH-006 | 목표 명세 | 사용자는 가계부 생성 또는 초대 코드 참여 과정에서 공백이 아닌 자기 표시 이름으로 자기 Member만 생성할 수 있다. | 클라이언트가 다른 principalUid·memberId를 지정할 수 없고 Google UID당 전체 가계부에서 종료되지 않은 Member·Membership은 하나다. 기존의 다른 가구원 추가 UI와 `AddMember` 공개 명령은 제거한다. | [HouseholdLogin](../../../../../../web/src/components/HouseholdLogin.tsx), [householdService](../../../../../../web/src/lib/householdService.ts), [DEC-021](../../../../governance/decisions.md#dec-021), [DEC-034](../../../../governance/decisions.md#dec-034) | U, I, 보안 E2E |
| HH-007 | 목표 명세 | 전체 가계부에서 UID 전역 Membership claim이 없는 Google 사용자가 가구 이름과 자기 표시 이름을 입력해 새 가계부를 만들면 Household, 자기 Member, 일반 Membership, UID 전역 claim과 초기화 Outbox를 원자적으로 생성한다. | 생성자는 owner role이나 추가 household capability를 갖지 않는다. 기존 claim이 있으면 가계부를 추가 생성하거나 전환하지 않고 충돌로 거부한다. 사용자가 다른 가구원을 함께 만들거나 사용자 지정 가구 키를 정하지 않는다. 후속 기본 카테고리·홈 설정 초기화 실패는 가구 생성 결과와 분리해 재시도한다. | [householdService](../../../../../../web/src/lib/householdService.ts), [DEC-021](../../../../governance/decisions.md#dec-021), [DEC-034](../../../../governance/decisions.md#dec-034), [DEC-039](../../../../governance/decisions.md#dec-039) | U, I |
| HH-008 | 목표 명세 | 보호 화면은 검증된 Google Principal과 활성 Membership이 있을 때만 가구 데이터를 표시한다. | Membership이 없으면 첫 방문 화면을, legacy 후보가 있으면 전환 확인을 표시한다. admin은 별도 capability로 접근하며 신규 guest·가구 키 우회는 허용하지 않는다. | [HouseholdGuard](../../../../../../web/src/components/HouseholdGuard.tsx), [DEC-021](../../../../governance/decisions.md#dec-021) | UI, E2E |
| HH-009 | 목표 명세 | 인증된 사용자는 자기 Membership에 연결된 Member의 표시 이름만 공백이 아닌 값으로 변경할 수 있다. | 다른 가구원의 Member는 변경할 수 없다. memberId는 유지하고 다른 Context의 Canonical 데이터를 순회 수정하지 않는다. | [Access command handler](../../../../../../functions/src/bootstrap/commands/accessHouseholdCommandHandlers.ts), [DEC-021](../../../../governance/decisions.md#dec-021) | I, E2E |
| HH-010 | 목표 명세 | 일반 사용자는 자기 가구 Membership을 탈퇴·종료할 수 없으며 로그아웃·endpoint 삭제·가구 논리 삭제 뒤에도 같은 Membership과 Member 연결을 보존한다. | `LeaveHousehold` 화면·Command·API를 두지 않는다. 전체 관리자의 다른 가구원 강제 제거는 HH-012의 별도 명령이며 자기 탈퇴로 우회할 수 없다. UID claim은 DEC-038의 관리자 제거 또는 DEC-040의 영구 purge 완료에서만 해제한다. | [DEC-036](../../../../governance/decisions.md#dec-036), [DEC-038](../../../../governance/decisions.md#dec-038), [DEC-040](../../../../governance/decisions.md#dec-040) | U, I, UI, E2E |
| HH-011 | 목표 명세 | Access는 자산 명의를 위한 안정적인 `AssetOwnerProfile`을 가구 범위로 관리한다. Member마다 연결된 `member` 프로필 하나를 제공하고, 활성 가구원은 Google 계정·Membership이 없는 아이 등의 이름을 `dependent` 프로필로 추가·변경할 수 있다. dependent 프로필 삭제는 서버가 검증한 관리자만 수행한다. | dependent 프로필은 로그인·초대·권한·알림 대상이 아니다. 일반 자산 UI에는 삭제 버튼을 두지 않고 일반 가구원의 archive API 호출도 거부한다. 관리자 삭제도 논리 보관이므로 기존·과거 참조를 지우지 않으며 신규 선택에서만 제외한다. Member 연결 프로필은 관리자도 삭제할 수 없고 Member 이름 변경과 함께 표시 이름을 갱신한다. | [DEC-037](../../../../governance/decisions.md#dec-037) | U, I, UI, 보안 E2E |
| HH-012 | 목표 명세 | 서버가 검증한 전체 관리자만 생성자를 포함한 활성 가구원을 강제로 제거·복구할 수 있다. 제거는 Member·Membership과 연결 member 명의자 프로필을 복구 가능한 상태로 전환하고 UID 전역 claim을 해제하며, 복구는 같은 ID들을 재활성화한다. | 일반 가구원에게 UI/API를 제공하지 않는다. 마지막 활성 Member를 제거해도 Household와 기존 업무 데이터는 보존한다. 제거 즉시 ActorContext·세션 복원·알림 수신 대상에서 제외하고, 복구 시 UID가 다른 활성 Membership을 가졌으면 충돌이며 과거 endpoint는 복구하지 않는다. | [DEC-038](../../../../governance/decisions.md#dec-038), [DEC-039](../../../../governance/decisions.md#dec-039) | U, I, 동시성, UI, 보안 E2E |
| HH-JOIN-001 | 목표 명세 | 활성 가구원은 5분 동안 한 번 유효한 초대 코드를 생성할 수 있고, 전체 가계부에서 UID 전역 Membership claim이 없는 Google 사용자만 코드를 입력한 뒤 자기 표시 이름으로 자기 Member·Membership·UID 전역 claim을 원자 생성한다. | 코드는 특정 Member를 미리 만들지 않으며 원문을 저장하지 않는다. 만료·재사용·다른 가구·이미 claim을 가진 UID는 거부하고 Invitation을 소비하거나 어떤 Member도 추가하지 않는다. | [join page](../../../../../../web/src/app/join/page.tsx), [HouseholdGuard](../../../../../../web/src/components/HouseholdGuard.tsx), [DEC-021](../../../../governance/decisions.md#dec-021), [DEC-034](../../../../governance/decisions.md#dec-034) | U, I, UI, E2E |
| ADM-001 | 현재 명세 | 관리자는 Google로 로그인하고 허용된 계정이면 전체 가구를 최신순으로 조회하며 가구 생성·키 복사·삭제를 수행한다. | 생성 키는 클립보드에 복사하고 삭제 전 확인을 받는다. | [admin page](../../../../../../web/src/app/admin/page.tsx), [authService](../../../../../../web/src/lib/authService.ts) | UI, I, E2E |
| ADM-002 | 목표 명세 | 관리자 권한과 가구 관리 쓰기는 서버와 Firestore Rules에서 검증해야 한다. | 클라이언트 이메일 목록·payload role·payload capability는 권한 근거로 사용하지 않는다. Firebase가 검증한 ID token의 `systemAdmin: true` custom claim만 서버에서 고정 capability로 변환하고, 관리자 작업은 일반 household command manifest와 분리한 전용 callable에서만 제공한다. | [admin callable](../../../../../../functions/src/bootstrap/firebaseAdminAccess.ts), [Firestore Rules](../../../../../../firestore.rules) | I, 보안 E2E |
| ADM-003 | 목표 명세 | 관리자 가구 삭제는 모든 가구 범위 데이터를 보존한 채 가구를 `deleted`로 전환하고 일반 접근을 차단하며, 관리자·운영 복구 명령은 이를 `active`로 되돌린다. | 자동 hard purge는 없다. 영구 삭제는 별도 요청과 복구 불가능 확인을 받은 `RequestPermanentHouseholdPurge`만 시작한다. `purging` 뒤 Membership·claim 변경을 차단하고 UID claim snapshot부터 page 단위로 완성한 뒤 Context purge를 시작한다. 모든 Context purge 완료 전 UID claim을 유지하고, 완료 후 조건부 page 해제를 모두 마친 뒤에만 `purged`와 `HouseholdPurged.v1`을 확정한다. `purging` 이후에는 복구할 수 없다. | [householdService](../../../../../../web/src/lib/householdService.ts), [DEC-016](../../../../governance/decisions.md#dec-016), [DEC-040](../../../../governance/decisions.md#dec-040) | U, I, 동시성, 보안 E2E |

## 6. 모듈 결함

- Firestore Rules가 가구 데이터의 인증·멤버십·`householdId` 불변식을 강제하지 않습니다.
- 가구 키만 알면 인증된 사용자처럼 동작하며, 관리자 권한도 클라이언트 이메일 allowlist에 의존합니다.
- `join` 경로가 보호 화면의 예외가 아니어서 미로그인 초대 사용자가 접근하지 못합니다.
- `guest` 경로는 로컬 저장소만 바꾸고 실행 중인 Context를 갱신하지 않습니다.
- 멤버 추가는 중복 이름을 허용하고 비트랜잭션 read-modify-write라 동시 변경을 잃을 수 있습니다.
- 사용자 지정 가구 키의 유일성을 원자적으로 보장하지 않습니다.
- 멤버 이름 변경이 여러 컬렉션의 표시 이름 외래 키를 직접 수정하면서 `registered_cards.owner`는 누락합니다.
- 관리자 가구 삭제가 `households` 문서를 즉시 물리 삭제해 복구 기준과 접근 차단 상태를 남기지 못하면서 거래·자산·카드 등 종속 데이터를 orphan으로 만듭니다.
- `renameHouseholdMember` callable은 인증·인가 없이 Admin SDK로 여러 컬렉션을 변경할 수 있습니다.

결함은 현재 결과를 특성화 테스트로 영구 고정하지 않고, 위 불변식을 만족하는 목표 테스트로 교정합니다.

## 7. 관련 DEC 링크

- [DEC-020: 멤버별 다중 FID endpoint 정책](../../../../governance/decisions.md#dec-020) — `HH-005`의 알림 동기화는 stable memberId를 전달하며 설치 endpoint 등록·로그아웃 삭제는 Notifications가 담당합니다.
- [DEC-013: 거래 생성자와 채널별 알림 정책](../../../../governance/decisions.md#dec-013) — creatorMemberId와 requesterMemberId에 안정적인 멤버 식별자를 제공합니다.
- [DEC-016: 가구 삭제와 복구](../../../../governance/decisions.md#dec-016) — 삭제는 데이터 보존형 논리 삭제이며 자동 영구 삭제 없이 명시적 복구와 수동 purge를 분리합니다.
- [DEC-021: Google 로그인·자기 가구원 생성·기존 키 전환](../../../../governance/decisions.md#dec-021) — 신규 가구 키 로그인을 제거하고, 자기 Member만 생성하며, 기존 localStorage 사용자는 같은 householdId·memberId에 UID를 연결합니다.
- [DEC-022: 단일 partner 개념 제거](../../../../governance/decisions.md#dec-022) — partner 저장·선택 없이 자기 Membership만 session에 저장하고 수신자 계산은 Notifications에 위임합니다.
- [DEC-034: Google 계정당 하나의 가계부 Membership](../../../../governance/decisions.md#dec-034) — UID 전역 유일 claim을 생성·가입·legacy 연결과 같은 transaction에서 확보하며 일반 가계부 선택·전환을 제거합니다.
- [DEC-036: 일반 사용자 가구원 탈퇴 미제공](../../../../governance/decisions.md#dec-036) — 로그아웃·가구 논리 삭제에도 Membership을 종료하지 않고 `LeaveHousehold` 진입점을 두지 않습니다.
- [DEC-037: 자산 명의자 프로필 분리](../../../../governance/decisions.md#dec-037) — 로그인 Member와 자산 명의자를 분리하고 비로그인 dependent 프로필의 안정 ID·논리 보관을 Access가 소유합니다.
- [DEC-038: 전체 관리자 전용 가구원 강제 제거](../../../../governance/decisions.md#dec-038) — 일반 사용자 제거 UI 없이 관리자만 복구 가능한 제거·복구와 claim 해제를 수행합니다.
- [DEC-039: 가계부 owner 역할 미도입](../../../../governance/decisions.md#dec-039) — 생성자와 초대 가입자에게 같은 일반 capability를 적용하고 운영 권한은 전체 관리자 capability로 분리합니다.
- [DEC-040: 영구 가구 purge 뒤 UID claim 자동 해제](../../../../governance/decisions.md#dec-040) — 모든 Context purge 완료 전 claim을 유지하고 Access finalization이 조건부 page 해제를 마친 뒤 purged를 확정합니다.

## 8. 모듈 테스트 시나리오

| 테스트 ID | 종류 | Given / When / Then | 연결 요구사항 |
|---|---|---|---|
| T-HH-001 | 목표 | 기존 localStorage에 유효한 householdKey·currentMemberId가 있는 사용자 / 첫 Google 로그인·연결 확인 / 기존 householdId·memberId Membership 생성 후 기존 데이터 그대로 조회 | HH-001, HH-002, DEC-021 |
| T-HH-002 | 목표 | localStorage 없음·불완전 후보·무효 memberId·Native에만 key/name 존재·같은 UID 재시도·다른 UID 선점·승인된 운영 복구 / 첫 로그인 또는 수동 연결 / 앞의 네 경우는 신규 사용자 첫 방문, 같은 UID는 멱등 성공, 다른 UID 선점은 충돌과 데이터 무변경, 운영 복구는 정확한 기존 Member 연결과 감사 기록 | HH-001~003, DEC-021 |
| T-HH-003 | 목표 | 가구 생성자와 초대 참여자가 각각 자기 이름 입력, 타인 memberId·principalUid 위조 / 처리 / 각자 자기 Member 하나만 생성되고 위조는 거부 | HH-006, HH-007, HH-JOIN-001, DEC-021 |
| T-HH-004 | 목표 | 자기·다른 가구원 이름 변경 / 처리 / 자기 표시 이름만 변경되고 memberId와 모든 참조 ID 유지 | HH-009, DEC-021 |
| T-HH-005 | 목표 | 로그인 사용자의 탈퇴 시도, 로그아웃 후 재로그인, 가구 논리 삭제 후 복구 / 공개 API·세션 복원 / 탈퇴 진입점은 없고 Membership·Member가 불변이며 같은 memberId로 복원 | HH-004, HH-005, HH-010, DEC-036 |
| T-HH-006 | 목표·보안 | 로그인 Member와 Google 계정 없는 아이 명의자, 일반 가구원·관리자, 이름 변경·보관된 dependent 프로필 / 생성·조회·변경·삭제 시도 / 일반 UI에는 삭제가 없고 일반 가구원의 archive 호출은 거부되며 관리자만 dependent를 논리 보관한다. Member에는 연결 프로필 하나만 있고 profileId와 과거 이름 해석은 유지된다. | HH-011, DEC-037 |
| T-HH-007 | 목표·보안·동시성 | 생성자·초대 가입자·전체 관리자, 마지막 활성 Member, 기존 거래·자산·다중 endpoint / 일반 사용자 제거 시도, 관리자 제거·복구, 제거 후 다른 가구 가입과 복구 경합 / 일반 호출은 거부되고 모든 Member에 같은 제거 규칙이 적용되며 즉시 접근·수신 차단과 claim 해제, 빈 Household·기록·ID 보존을 보장하고 다른 Membership이 생긴 뒤 복구는 충돌함 | HH-012, PUSH-012, DEC-038, DEC-039 |
| T-HH-JOIN-001 | 목표 | Google 로그인한 미가입 사용자와 이미 다른 Membership이 있는 사용자가 유효·만료·사용된 5분 초대 코드와 자기 이름 입력 / 참여 / 미가입자의 유효 코드만 한 번 소비되어 자기 Member·Membership·UID claim 생성, 기존 가입자는 코드·데이터 무변경 충돌 | HH-003, HH-006, HH-008, HH-JOIN-001, DEC-021, DEC-034 |
| T-ADM-001 | 현재 명세 | 허용된 관리자 계정 / 로그인 / 가구 조회·생성·키 복사·확인 후 삭제 가능 | ADM-001 |
| T-ADM-002 | 목표·동시성 | 거래·자산·카드와 다중 UID claim이 있는 가구 / 논리 삭제·복구, 영구 purge의 snapshot·Context·finalization page 실패와 재시도 / snapshot 완료 전 Context 호출 0건, 논리 삭제·Context 미완료 동안 claim과 데이터 보존, 모든 Context 완료 뒤 대상 claim만 조건부 해제, 다른 값 claim 보존, 전 page 완료 뒤 purged Event 한 번, 승인 전 물리 삭제 0건 | ADM-003, DEC-016, DEC-040 |
| T-HH-RULES-001 | 목표 | 인증 없음·같은 가구·다른 가구·관리자별 컬렉션 CRUD / Rules / 권한 행렬과 householdId 불변식 적용 | ADM-002 |
| T-HH-SEC-001 | 목표 | 무인증 rename 호출 / 실행 / 권한 오류이며 어떤 모듈 데이터도 변경되지 않음 | ADM-002, HH-009 |

`renameHouseholdMember`를 포함한 무인증 서버 쓰기 행렬은 [알림 모듈의 T-SEC-002](../../../notifications/modules/notifications/requirements.md#9-모듈-테스트-시나리오)에서 한 번만 정의하고 함께 검증합니다.

## 9. 코드 근거

### Web

- [가구 Context](../../../../../../web/src/contexts/HouseholdContext.tsx)
- [가구 서비스](../../../../../../web/src/lib/householdService.ts)
- [Google 로그인·최초 진입 화면](../../../../../../web/src/components/HouseholdLogin.tsx)
- [보호 화면](../../../../../../web/src/components/HouseholdGuard.tsx)
- [초대 화면](../../../../../../web/src/app/join/page.tsx)
- [관리자 화면](../../../../../../web/src/app/admin/page.tsx)
- [인증 서비스](../../../../../../web/src/lib/authService.ts)

### Android·Functions·보안 경계

- [Native 저장소](../../../../../../android/app/src/main/java/com/household/account/util/HouseholdPreferences.kt)
- [가구·멤버 Command handler](../../../../../../functions/src/bootstrap/commands/accessHouseholdCommandHandlers.ts)
- [Firestore Rules](../../../../../../firestore.rules)
