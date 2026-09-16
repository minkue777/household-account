# Access/Admin 2차 유지보수성 검토

작성일: 2026-09-17. 기준 구현: `f1ed5a8` 이후 같은 작업의 변경 포함. 담당 범위는 관리자 조회/운영, Member lifecycle, Household purge, AssetOwnerProfile이며 인증 복원·HouseholdContext·Notifications 본체는 root의 별도 검토 범위입니다. 운영 데이터 조회·배포·commit/push는 하지 않았습니다.

이번 검토에서는 화면→wire→handler→Application→Firebase 저장소→로그인 projection/Outbox를 추적했습니다. 확정 문제 3건을 수정했습니다. 테스트 통과와 실제 운영 검증을 구분하며, 모든 Access 요구사항을 이 보고서만으로 완전 검증했다고 주장하지 않습니다.

## 1. 기능별 검토 범위와 변경 시나리오

| 요구사항 | 적용한 변경 시나리오와 실제 경로 | 소유·부작용·비용 판단 | 판정 |
|---|---|---|---|
| ADM-001 | 관리자가 A→B→A 상세를 전환하고 응답이 역전됨. [AdminPage](../../web/src/app/admin/page.tsx) → [adminHouseholds](../../web/src/features/access-household/application/adminHouseholds.ts) → [adminAccess router](../../functions/src/bootstrap/admin/adminAccess.ts) → 개별 handler | 페이지가 선택 가구와 비동기 결과의 수명을 함께 소유해야 합니다. 조회 결과를 독립 배열로 들고 요청 세대를 확인하지 않아 다른 가구의 명령 ID를 조합하던 문제를 수정했습니다. 기존 생성/자동 키 복사, 정상 60초·장애 10초 갱신·중복 요청 억제 유지. | 검토 완료, AA-1 수정·실제 페이지 테스트 |
| ADM-002, ADM-004 | 관리자 capability 추가 또는 일반 가구 보기 진입 정책 변경. [verifiedSystemAdministrator](../../functions/src/bootstrap/verifiedSystemAdministrator.ts), [firebaseAdminAccess](../../functions/src/bootstrap/firebaseAdminAccess.ts), [householdQueryRouter](../../functions/src/bootstrap/queries/householdQueryRouter.ts), [householdCommandClient](../../web/src/platform/functions-api/householdCommandClient.ts), [Firestore Rules](../../firestore.rules) | Firebase 검증 claim `systemAdmin === true`만 고정 capability로 변환합니다. wire의 email/role/capabilities는 권한 근거가 되지 않습니다. 관리자 선택은 탭 sessionStorage, 업무 SessionScope는 administrator-readonly이며 일반 Member를 생성하지 않습니다. 서버 Query·Rules가 재검증하고 client write는 전부 거부합니다. 일반 업무 Command 전송 전 read-only 차단도 보존했습니다. | 서버·클라이언트 코드 검토 완료. Rules emulator/실기기 보안 E2E는 이번에 미실행 |
| ADM-003: 논리 삭제/복구 | soft delete 후 복구하거나 claim 접근 상태를 바꿈. [adminHouseholdAccessHandlers](../../functions/src/bootstrap/admin/handlers/adminHouseholdAccessHandlers.ts) → [FirebaseAdminHouseholdStore](../../functions/src/adapters/firebase/access/firebaseAdminHouseholdStore.ts) / [FirebaseHouseholdLifecycleUnitOfWork](../../functions/src/adapters/firebase/access/firebaseHouseholdLifecycleUnitOfWork.ts) → [writeHouseholdClaimLifecycle](../../functions/src/adapters/firebase/access/firebaseHouseholdClaimLifecycle.ts) | 실제 삭제는 AdminConsole, 복구는 HouseholdLifecycle로 진입합니다. Household 상태·관련 claim 접근 상태·receipt·Outbox를 같은 UoW에 반영하며 Member/업무 데이터는 지우지 않습니다. 각 명령의 실제 호출 위치는 확인했으나 아래 5절의 사용되지 않는 대체 lifecycle API가 남아 있습니다. | 실제 경로 검토 완료, 대체 API 정리는 부분 |
| ADM-003: 영구 purge | Context page 실패 뒤 재개, claim이 다른 가구를 가리키도록 변경됨. [access-operations CLI](../../functions/scripts/access-operations.mjs) → [householdPurgeRuntime](../../functions/src/bootstrap/operations/householdPurgeRuntime.ts) → [HouseholdPurgeProcessApplication](../../functions/src/contexts/access/household-purge-process/application/householdPurgeProcessApplication.ts) → [FirebaseHouseholdPurgeUnitOfWork](../../functions/src/adapters/firebase/access/firebaseHouseholdPurgeUnitOfWork.ts) | 일반 Admin callable에는 purge operation이 없습니다. 별도 capability·확인·deleted precondition 이후 claim snapshot 완료→Context별 page→claim 조건부 해제→purged 순서를 보존합니다. source claim fingerprint와 현재 claim을 비교하므로 다른 claim을 무조건 삭제하지 않습니다. checkpoint/lease/Outbox는 단순화 삭제 대상이 아닙니다. | 코드 검토 완료, 실제 삭제·실패 주입 실행은 미검증 |
| HH-009, HH-010, HH-012 | 자기 이름을 바꾼 다음 관리자 제거·복구. [MemberRenameApplication](../../functions/src/contexts/access/member-rename/application/memberRenameApplication.ts) → [FirebaseMemberRenameStore](../../functions/src/adapters/firebase/access/firebaseMemberRenameStore.ts) → [Admin member handler](../../functions/src/bootstrap/admin/handlers/adminMemberAccessHandlers.ts) → [MemberLifecycleApplication](../../functions/src/contexts/access/member-lifecycle/application/memberLifecycleApplication.ts) → [FirebaseMemberLifecycleUnitOfWork](../../functions/src/adapters/firebase/access/firebaseMemberLifecycleUnitOfWork.ts) | Admin 전용 목록의 aggregateVersion이 Member 이름 버전이었으나 명령은 Membership 버전으로 비교했습니다. 목록 토큰과 각 aggregate 증가를 독립시켰습니다. 마지막 Member 제거 시 Household·Ledger/Portfolio 기록을 보존하며 UID claim·자기 projection만 제거합니다. 일반 self-leave surface는 추가하지 않았습니다. | 검토 완료, AA-2 수정·실제 adapter 연결 회귀 |
| HH-011 | dependent 이름/보관 정책 변경 또는 자기 Member 이름 변경 위치 탐색. [assetOwnerProfiles](../../web/src/features/access-household/application/assetOwnerProfiles.ts) → [Access command handler](../../functions/src/bootstrap/commands/accessHouseholdCommandHandlers.ts) → [AssetOwnerProfileApplication](../../functions/src/contexts/access/asset-owner-profile/application/assetOwnerProfileApplication.ts) → [FirebaseAssetOwnerProfileStore](../../functions/src/adapters/firebase/access/firebaseAssetOwnerProfileStore.ts) | dependent는 권한·알림 대상이 아니며 관리자만 보관합니다. member profile은 일반 프로필 명령으로 rename/archive할 수 없습니다. self rename의 두 번째 미사용 구현을 없애고 실제 MemberRename 경로만 남겼습니다. profile 저장소는 자산·과거 snapshot을 순회 수정하지 않습니다. | 검토 완료, AA-3 수정 |
| HH-011: 조회 | 명의자 표시 순서/숨김/보관 표시 변경. [FirestoreAssetOwnerProfileReadModel](../../web/src/platform/read-model/firestoreAssetOwnerProfileReadModel.ts), [accessHouseholdQueryHandlers](../../functions/src/bootstrap/queries/accessHouseholdQueryHandlers.ts) | 일반 선택 UI는 Firestore 구독, 관리자 includeArchived는 서버 Query입니다. 둘은 사용처와 접근 조건이 달라 조회 하나로 강제 통합하지 않았습니다. createdAt 순서·archived 보존·selectionVisibility를 구분합니다. 실패를 성공 빈 배열로 바꾸지 않는 Web read adapter를 유지했습니다. | 코드 검토 완료. Portfolio의 전체 ownerRef 소비처는 별도 Portfolio 검토 |
| ADM-005 | 운영 로직/공급자를 추가하고 실패·기록 없음·부분 통계를 표시. [adminDashboardAccessHandlers](../../functions/src/bootstrap/admin/handlers/adminDashboardAccessHandlers.ts) → [FirebaseAdminDashboardReader](../../functions/src/adapters/firebase/admin/firebaseAdminDashboardReader.ts), [GoogleCloudInteractiveLatencyReader](../../functions/src/adapters/google-cloud/admin/googleCloudInteractiveLatencyReader.ts) → [AdminOperationsOverview](../../web/src/components/admin/AdminOperationsOverview.tsx) | 상태 조회는 업무 데이터를 수정하지 않습니다. 독립 Firestore/Logging 조회를 병렬 실행하며 Logging 실패는 unavailable, page 제한은 partial입니다. provider 기록 없음/작업 UNKNOWN은 healthy로 숨기지 않습니다. 성능 응답은 집계 field만 반환하고 correlation 원문은 내부 재시도 dedup에서만 사용합니다. 3인 규모에서 별도 운영 DB·캐시 서버·집계 프레임워크 추가는 불필요합니다. | 읽기·집계 코드 검토 완료. 운영 IAM/Cloud Logging 결과·청구 데이터의 실제 정확성은 미검증 |
| ADM-006 | 날짜/표시 기간 변경 및 로그인 사용자 접속 합계 조회. [FirebaseAdminDashboardReader](../../functions/src/adapters/firebase/admin/firebaseAdminDashboardReader.ts), [AdminHouseholdList](../../web/src/components/admin/AdminHouseholdList.tsx) | 기존 memberAccessStats를 14일 서울 날짜로 잘라 표시하고 제거 멤버의 과거 합계도 보존합니다. 관리자 상세의 멤버 ID와 latency 집계의 비식별 출력은 서로 다른 용도입니다. 이번 검토는 reader 중심이며 first-ready telemetry writer의 모든 플랫폼 동작까지 재검증하지 않았습니다. | 부분 검토: reader 완료, 수집 writer/실기기는 root 범위 |

HH-001~008 및 HH-JOIN-001의 onboarding·legacy migration·초대 전체는 이 추가 검토의 범위가 아닙니다. read-only 진입에 필요한 세션/권한 경계만 교차 확인했습니다.

## 2. 확정 문제와 적용 결과

### AA-1 · P2 · Admin 상세 선택과 비동기 결과의 소유 범위가 달랐습니다 — 수정 완료

수정 전 `web/src/app/admin/page.tsx`의 loadDetails는 householdId를 선택 state에 먼저 저장한 뒤, 완료된 모든 요청을 같은 members/profiles/deletedAssets state에 적용했습니다. A→B→A처럼 같은 ID로 돌아오는 경우에도 단순 householdId 비교만으로는 오래된 첫 A 응답을 막을 수 없습니다. 화면의 관리 버튼은 조회 중 다른 가구 선택을 허용하고, 명령 handler는 현재 선택 ID와 배열에 저장된 Member/Profile/Asset ID를 조합했습니다.

현재 [AdminPage](../../web/src/app/admin/page.tsx) 44~170행의 상세 요청 세대가 선택·닫기·인증 변경·unmount마다 이전 완료를 무효화합니다. 성공·실패·finally 모두 같은 조건을 사용합니다. Dashboard는 인증 세대와 요청 token을 함께 비교하여 이전 계정의 완료가 새 계정의 pending/오류/조회 결과를 바꾸지 않습니다. 259행 이후 관리 명령은 확인 대화상자/실행 후에도 요청 세대를 확인하여 이전 가구 상세를 다시 열지 않습니다. 생성·복사·가구 삭제/복구도 인증 세대가 바뀐 뒤 UI 후속작업을 적용하지 않습니다.

새 범용 manager나 공유 cache는 만들지 않았습니다. 읽기 취소는 서버 요청 자체를 중단하지 않고 완료의 UI 적용만 막습니다. 이미 서버에 전송된 관리 명령을 되돌리는 기능은 아닙니다.

### AA-2 · P2 · Member 버전과 Membership 버전을 혼용하여 이름 변경 후 관리자 제거가 실패했습니다 — 수정 완료

수정 전 관리자 목록은 Member.aggregateVersion을 반환하지만 제거·복구 Application은 expectedMembershipVersion과 비교했습니다. 실제 RenameStore는 Member를 증가시키고 Membership은 유지합니다. 따라서 새 이름을 저장한 사용자에게 Admin 제거를 누르면 조회를 새로 해도 VERSION_MISMATCH가 반복됩니다. 또한 토큰만 바로잡으면 Lifecycle이 Member.version에도 membership.nextVersion을 대입하여 이미 증가한 Member 버전이 내려갈 수 있었습니다.

변경 위치는 다음과 같습니다.

- [adminMemberAccessHandlers](../../functions/src/bootstrap/admin/handlers/adminMemberAccessHandlers.ts) 60~94행: 같은 가구 memberships를 병렬로 읽어 memberId별 버전을 목록에 투영합니다. wire의 `aggregateVersion` 필드명은 유지합니다.
- [MemberLifecycleApplication](../../functions/src/contexts/access/member-lifecycle/application/memberLifecycleApplication.ts) 134·269행: Member는 자기 버전+1, Membership은 자기 버전+1입니다. profile 또한 기존 UoW의 자체 버전+1을 유지합니다.
- [AdminMemberWireView](../../web/src/platform/functions-api/accessContractTypes.ts) 14행과 [memberLifecyclePolicy](../../functions/src/contexts/access/member-lifecycle/domain/policies/memberLifecyclePolicy.ts): admin 토큰과 Outbox membershipVersion의 의미를 명시했습니다.

repository 전체 참조에서 AdminMemberWireView의 버전 소비자는 관리자 페이지의 remove/restore뿐이었습니다. 일반 RenameSelf·Android·프로필 편집의 Member/Profile 버전 입력은 변경하지 않았습니다. [FirebaseSignedInUserResolver](../../functions/src/adapters/firebase/access/firebaseSignedInUserResolver.ts) 227행은 계속 canonical Member.aggregateVersion을 로그인 응답으로 반환합니다. 복구 UoW는 로그인 projection의 aggregateVersion=Membership, memberAggregateVersion=Member를 각각 기록합니다. root가 관리하는 HouseholdContext의 최신 Member 버전 비교와 충돌하지 않습니다. 실제 구독/기기 복원은 코드로 확인했으며 추가 실기기 E2E를 수행한 것은 아닙니다.

읽기 비용은 관리자 상세에 가구 memberships collection query 하나가 늘어납니다. 임의의 Member 버전을 Membership으로 대신 쓰거나 schema migration을 추가하는 것보다 정확한 소유 aggregate를 읽는 단순한 경계로 판단했습니다. 3인 가구의 비정기 운영 조회에 한정되며 일반 사용자 happy path 조회는 늘지 않습니다.

### AA-3 · P2 · 자기 이름 변경의 미사용 대체 API가 실제 수정 위치를 흐렸습니다 — 수정 완료

`AssetOwnerProfileApplication.renameSelf`는 production handler/운영 script에서 호출하지 않았으며 별도 fixture만 검증했습니다. 실제 요청은 `access.rename-self.v1` → MemberRenameApplication → FirebaseMemberRenameStore였습니다. 두 구현은 결과 shape·version 처리·저장소가 달랐고, AssetOwnerProfileStore는 Member mutation을 저장하지 않아 대체 API를 실제 명령에 연결할 경우 잘못된 경로가 되었습니다.

미사용 method, 전용 RenameSelfResult/port export, 전용 memberHasSingleProfile helper와 대리 테스트 1건을 제거했습니다. dependent profile 생성/변경/보관/조회 API는 유지했습니다. 자기 이름·연결 profile·로그인 projection·stable ID 보존은 실제 MemberRename adapter 테스트 및 새 AA-2 연결 테스트에서 검증합니다. [설계 5.4/5.6](../requirements/contexts/access-household/modules/household-access/design.md)에 실제 소유 경로와 독립 버전 계약을 보완했습니다.

## 3. 유지한 경계와 복잡성

- **다른 도메인 변경은 소유자에게 넘깁니다.** Admin 자산 복구는 Portfolio AssetLifecycle Application과 restoration participant를 호출합니다. Member 제거는 Access canonical 상태/claim/receipt/Outbox만 바꾸며 endpoint 삭제는 Notifications consumer의 FirebaseNotificationMemberCleanupStore가 담당합니다. 복구 시 과거 endpoint를 재생성하지 않습니다. 일반 Member 이름 변경은 Ledger·Asset·Snapshot 기록을 다시 쓰지 않습니다.
- **관리자 화면은 별도 인증 정책을 발명하지 않습니다.** tab selection은 조회 대상을 뜻하며 권한 토큰이 아닙니다. systemAdmin capability 생성은 서버 진입에서 고정하고, purge 권한을 일반 Admin callable에 추가하지 않았습니다.
- **purge의 다단계 처리는 보존합니다.** 삭제 실패 후 checkpoint 재개, 누락 ancestor 아래 leaf 삭제, Context 완료 전에 claim 유지, 모든 Context 완료 후 claim fingerprint 비교, lease·멱등 완료 Event는 계약상 필요한 보호입니다. 3명이라도 영구 삭제 복구 불가 특성은 같으므로 하나의 거대 transaction으로 축소하지 않았습니다.
- **purge registry는 composition에 모읍니다.** householdPurgeRuntime의 Context별 canonical/legacy collection 목록과 공통 leaf 삭제 engine은 물리 composition입니다. Notifications·Shortcut receipt는 별도 소유권 preflight를 유지합니다. 새 Context/legacy root 추가 시 이 runtime 등록과 소유 도메인 purge 테스트를 함께 수정해야 합니다. 각 Context에 동일 삭제 engine을 복제하는 개선은 하지 않았습니다.
- **규모에 맞는 조회를 유지합니다.** AdminDashboard는 전체 가구·멤버·작은 운영 read model을 읽습니다. 지금 규모에서 pagination framework/캐시 무효화 계층을 추가할 근거는 없습니다. deleted asset 목록의 canonical+legacy 이름 보강은 실제 Portfolio Application의 삭제 목록을 따른다는 경계가 있으며, 성능 측정 없이 N+1 자체를 확정 문제로 분류하지 않았습니다.
- **오류와 없는 기록은 구분합니다.** Logging unavailable/partial, provider unknown, scheduled job UNKNOWN, 조회 오류 UI를 정상 0건으로 치환하지 않았습니다. 예약 작업/공급자 상태 정책 자체는 Operations 담당 검토와 별개입니다.

## 4. 검증

| 실행 | 결과 | 검증한 보장 |
|---|---|---|
| Web `adminRequestScope.contract.test.tsx` + `adminCreationCopy.contract.test.tsx` | 2 suites, 10 tests 통과 | 실제 AdminPage·AdminHouseholdList·관리 작업 UI로 A→B→A 역전, 이전 실패, 닫기/재열기, 로그아웃·재로그인, 늦은 명령 완료/확인 대화상자, 기존 생성·자동복사·갱신 중복 억제 |
| Functions `admin-member-version-flow.test.ts`, `member-removal-restoration.contract.test.ts`, `member-rename-atomic-store.test.ts`, `asset-owner-profile.contract.test.ts`, `member-rename.contract.test.ts` | 중복 제외 5 files, 30 tests 통과 | 실제 Firebase adapter를 in-memory Firestore에 연결한 rename→admin 목록→제거→복구, 각 aggregate 단조 버전, stale token 거부, claim·로그인 projection·profile 수렴, 기존 원장 보존, 같은 키 replay/Outbox 각 1건, dependent/Member 정책 |
| `git diff --check` | 통과 | whitespace 오류 없음. 다른 에이전트 변경은 검사만 했으며 수정하지 않았습니다. |

Functions 최초 테스트 실행은 sandbox의 자식 프로세스 EPERM으로 시작하지 못했습니다. 같은 명령을 승인된 실행 환경에서 재실행하여 위 결과를 얻었습니다. 전체 타입·build·Rules/E2E는 root의 중앙 검증 결과를 따릅니다. 이 보고서의 PASS를 운영 배포 검증으로 해석하면 안 됩니다.

## 5. 남은 사항과 한계

1. `household-lifecycle`의 `requestHouseholdDeletion`·`requestPermanentHouseholdPurge`, `member-lifecycle.authorizeMember`는 소스/운영 호출 검색상 현재 production 진입이 없습니다. 실제 삭제는 AdminConsole, 실제 purge는 HouseholdPurgeProcess, 실제 권한 해석은 FirebaseHouseholdCommandMembershipAdapter/Rules입니다. 이 메서드들의 fixture는 과거 목표 정책을 시험하므로 곧바로 전부 제거하지 않았습니다. 다음 독립 변경은 해당 대리 테스트의 보장을 실제 Admin/Purge/권한 adapter 테스트로 옮긴 뒤 중복 public surface만 제거하는 것입니다. 이번에 실행 경로를 다시 바꾸는 재설계는 필요하지 않습니다.
2. Household purge와 여러 legacy collection의 실제 데이터 모양, 운영 IAM, Cloud Logging pagination·청구 snapshot 최신성은 운영 데이터 조회 없이 확인할 수 없습니다. 구현의 범위·실패/재시도 순서는 검토했으나 실제 운영 데이터 완전 삭제를 증명하지 않았습니다.
3. first-ready 접속 telemetry writer, 전체 Android read-only 진입, Rules emulator, 악의적 직접 callable 위조 E2E는 이번 추가 검토에서 실행하지 않았습니다. 관련 router/claim/Rules 경계 코드는 읽었으며 root의 인증·기기 검증과 합쳐 판단해야 합니다.
4. 이미 전송된 관리 명령은 화면을 닫아도 서버에서 정상 완료할 수 있습니다. 이번 scope guard는 늦은 응답이 현재 화면을 오염시키지 않는 보장입니다. 서버 명령 취소 또는 다중 운영자 workflow는 요구하지도 추가하지도 않았습니다.
