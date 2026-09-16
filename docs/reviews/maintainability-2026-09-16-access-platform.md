# 인증·알림·PWA·공통 경계 유지보수성 검토

소스 근거 링크와 행 번호는 분석 기준 커밋 `c57d776`에 고정합니다. 구현 후 결과는 문서 마지막 절에 구분합니다.

검토 기준: `c57d776`의 실제 실행 경로와 소유 요구사항입니다. 이 문서는 기능별 수정 위치·정책 소유·변경 파급을 검토한 결과이며, 모든 기기 동작을 새로 실행하여 입증했다는 뜻은 아닙니다. 운영 데이터는 조회·변경하지 않았습니다.

## 발견과 수정 계획

### A1. 실제 플랫폼 구현과 무관한 서버 Application이 수정 위치를 이중화합니다 — 우선순위 높음

- `functions/src/contexts/access/session-membership/application/sessionMembershipApplication.ts:155`, `household-guard/application/householdGuardApplication.ts:31`, `asset-owner-ui/application/assetOwnerUiSurfaceApplication.ts:49`의 factory는 실제 Web·Android·Functions·운영 CLI 호출자가 없습니다.
- 실제 세션은 `web/src/contexts/HouseholdContext.tsx`, 화면 접근은 `web/src/components/HouseholdGuard.tsx`, 명의자 UI는 Web 자산 컴포넌트가 담당합니다. 그런데 `functions/src/contexts/access/public.ts`는 가상 클라이언트 Application의 Input Port까지 공개합니다.
- 알림도 `functions/src/contexts/notifications/application/safeNotificationClickApplication.ts:65`, `notificationSettingsIndependenceApplication.ts:84`, `androidForegroundNotificationApplication.ts:59`와 실제 Web worker/Kotlin 구현이 병존합니다. 실제 worker는 `/expenses/{id}/edit`를 만들지만 미사용 서버 click Application은 `/?edit=`를 만듭니다. 정책 변경을 잘못된 파일에 적용해도 운영에는 반영되지 않는 구조입니다.
- 관련 대리 테스트는 이미 9월 11일 정리되었으므로 테스트 부족을 보완하기 위해 가상 구현을 유지할 이유가 없습니다. [이전 테스트 감사](../testing/access-system-test-cleanup.md)와 `removed-notification-payment-shadow-tests.json`을 교차 확인했습니다.
- **계획:** 실제 호출·테스트·운영 script 참조가 없는 Application·전용 Port·전용 Domain을 제거하고 public export를 실제 경계만 남깁니다. 공용 endpoint 정책과 운영 CLI에서 사용하는 household purge는 보존합니다. 실제 client/E2E 검증과 타입·아키텍처 검사로 삭제 경계를 확인합니다.

### A2. HouseholdContext가 세션 조정과 데이터 표현 정책을 함께 소유합니다 — 우선순위 중간

- `web/src/contexts/HouseholdContext.tsx:164`의 `householdFromResolution`, `householdToResolutionView`, `sameHousehold`가 인증 observer·권한 복구·로그아웃·PWA endpoint 수명주기와 한 파일에 있습니다.
- `web/src/lib/householdService.ts:36`도 홈 카드 설정을 별도로 정규화합니다. 한쪽은 두 카드 중 하나가 잘못되면 전체 기본값을 적용하고, 다른 쪽은 카드별 기본값을 적용합니다. metadata 필드나 fallback을 바꾸려면 서로 다른 계층을 수정해야 합니다.
- **계획:** 세션 상태 전이는 유지하고 metadata 변환·비교를 Access의 순수 read-model 모듈로 분리합니다. 홈 설정 정규화는 한 함수로 통합해 캐시 복원과 서버 read가 같은 표현을 사용하게 합니다. 신규 상태관리 프레임워크나 범용 mapper 계층은 만들지 않습니다.

### A3. 설계 문서의 과거 결함과 현재 실행 경로가 혼재합니다 — 우선순위 중간

- PWA 요구사항의 설명에는 복수 worker와 compat 9 SDK가 현재 결함처럼 남아 있지만 실제 `web/worker/index.js:1`은 애플리케이션 Firebase 설정과 SDK를 공유하고, `web/next.config.js`와 production artifact 검사에서 단일 worker를 강제합니다.
- SYS 문서의 과거 client migration·Rules 설명도 현재 코드와 구분해 읽어야 합니다. 이를 근거로 이미 제거된 우회 API를 새로 정리하거나 불필요한 계층을 추가하면 오히려 혼란이 커집니다.
- **계획:** 아래 기능별 실제 수정 위치 표와 전체 리뷰의 구현 지도를 현재 진입점으로 제공하고, 제거한 코드로 향하는 활성 문서 링크는 실제 구현으로 갱신합니다. 역사적 테스트 감사 기록은 삭제하지 않습니다.

## 기능별 검토 범위 — 54개 요구사항

각 행의 ID는 중복 없는 소유 요구사항입니다. `경계 적정`은 이번 검토에서 구조적 변경이 필요하다는 근거가 없다는 뜻이며 무결함 보증은 아닙니다.

| 기능 / 요구사항 | 실제 수정 위치 | 판단 |
|---|---|---|
| legacy 세션 연결: HH-001, HH-002 | `features/access-household/application/legacySessionCandidate.ts`, `legacy-membership`, `firebaseLegacyMembershipStore.ts` | client 후보와 서버 claim 분리 적정. 운영 repair는 서버에 유지 |
| 최초 방문·자기 Member 생성·초대: HH-003, HH-006, HH-007, HH-JOIN-001 | `HouseholdLogin.tsx`, `googleOnboardingApplication.ts`, `firebaseGoogleOnboardingStore.ts`, `accessHouseholdCommandHandlers.ts` | Access 원자 생성 후 Category 별도 멱등 초기화는 필요한 경계 |
| 로그아웃·재접속·화면 접근·탈퇴 제한: HH-004, HH-005, HH-008, HH-010 | `HouseholdContext.tsx`, `signedInMembershipCache.ts`, `membershipResolutionRecovery.ts`, `HouseholdGuard.tsx` | A1·A2. client generation과 원격 권한 재검증은 유지 |
| 이름·명의자: HH-009, HH-011 | `memberRenameApplication.ts`, `assetOwnerProfileApplication.ts`, `firebaseMemberRenameStore.ts`, Web 자산 명의자 UI | 서버 소유권 경계 적정. 가상 UI Application 제거 대상 |
| 관리자 멤버 제거·복구: HH-012 | `memberLifecycleApplication.ts`, `firebaseMemberLifecycleUnitOfWork.ts`, `adminMemberAccessHandlers.ts` | UID claim·연결 프로필·알림 차단의 원자 경계 필요 |
| 관리자 인증·목록·생성: ADM-001, ADM-002 | `verifiedSystemAdministrator.ts`, `adminAccess.ts`, `adminHouseholdAccessHandlers.ts` | 일반 Command와 분리된 capability 경계 적정 |
| 가구 삭제·복구·수동 purge: ADM-003 | `householdLifecycleApplication.ts`, `householdPurgeRuntime.ts`, `householdPurgeProcessApplication.ts` | purge는 운영 CLI 실제 사용. 미도달 함수라는 이유로 삭제 금지 |
| 관리자 조회 전용: ADM-004 | `adminHouseholdViewSelection.ts`, `HouseholdContext.tsx`, `clientSessionScope.ts`, `householdCommandClient.ts`, Firestore Rules | 조회 scope와 write 차단을 양측에서 유지 |
| 관리자 운영 현황·사용 횟수: ADM-005, ADM-006 | `adminOperationsDashboard.ts`, `firebaseAdminDashboardReader.ts`, `memberAccessTelemetry.ts`, `memberAccessStats.ts` | 요청 수신과 실제 표시를 구분하는 측정 계약 유지. 상세 외부 운영은 별도 보고서 |
| FID 등록·수명주기·권한: PUSH-001, PUSH-002, PUSH-003, PUSH-009 | `notificationHouseholdCommandHandlers.ts`, `mobileFidRegistrationController.ts`, `firebaseMobileEndpointRegistrationStore.ts`, `fidEndpointLifecycle.ts`, `FidEndpointManager.kt` | 실제 등록 경계는 명확. 미사용 endpoint Application과 구분 필요 |
| 자동·명시적 대상·수신 설정: PUSH-004, PUSH-005, PUSH-014 | `planNotificationTargets.ts`, `transactionCreatedNotificationPolicy.ts`, `householdNotificationRequestPolicy.ts`, `firebaseNotificationDeliveryAdapters.ts` | 대상 정책과 provider 전송 전 active Membership 검증은 필요한 보호 |
| 클릭·foreground 표시: PUSH-006, PUSH-007, PUSH-011 | `web/worker/index.js`, `notificationPayload.ts`, Android `FcmService.kt` | 실제 플랫폼이 소유. A1의 가상 서버 클라이언트 계층 제거 |
| fan-out·멱등·회원 제거·purge: PUSH-008, PUSH-010, PUSH-012, PUSH-013 | `deliveryAssuranceApplication.ts`, `notificationOutboxDispatchApplication.ts`, `firebaseNotificationMemberCleanupStore.ts`, `notificationHouseholdPurgeApplication.ts` | Outbox·endpoint별 send-once·30일 TTL은 사용자 수와 관계없이 유지 |
| PWA 설치·worker 통합·설정: PWA-001, PWA-003, PWA-005 | `next.config.js`, `browserServiceWorker.ts`, `web/worker/index.js`, `firebasePublicConfig.ts` | runtime 경계 적정, 문서 A3 |
| PWA 전환·갱신·캐시 격리: PWA-002, PWA-004, PWA-008 | `PwaRuntimeUpdate.tsx`, `sessionCache.ts`, `browserServiceWorker.ts`, `next.config.js` | waiting/사용자 선택·미저장 입력 보호는 필요한 복잡도 |
| PWA 클릭·보안 헤더: PWA-006, PWA-007 | `notificationPayload.ts`, `productionSecurityPolicy.cjs`, `finalize-production-artifact.cjs` | worker/웹 설정 원본 공유 적정, 서버 가상 click 정책은 정리 |
| 배포·CI 분리와 대상: REL-001, REL-002 | `deploy-firebase.mjs`, `firebase-deploy-scope.mjs`, `vercel-ignore.cjs`, `quality-gates.yml`, delivery 스킬 | 변경 대상 판정과 실제 배포 검증 분리. CI는 후속 확인으로 인계 |
| 호환 배포·추적: REL-003, REL-004 | `deploymentTargetCompatibilityApplication.ts`, `deploymentProvenanceApplication.ts`, release wrapper | 실제 운영 script에서 사용. 미도달 bootstrap 통계만으로 제거 금지 |
| tenant·거래/category 호환: SYS-001, SYS-002, SYS-003 | Firestore Rules, `householdCommand` router, `categoryCompatibility.ts`, 실제 Ledger mapper | 서버 인가와 안정 ID·호환 읽기는 유지 |
| 금액·서울 날짜: SYS-004, SYS-005 | `platform/shared-kernel/moneyInWon.ts`, `seoulDateTime.ts`, 각 실제 경계의 입력 검증 | 순수 공통 정책이 적절. 서버/웹 중복 계산은 Finance·Portfolio 보고서와 통합 검토 |
| 안정 member 참조: SYS-006 | `compatibility/member-reference/memberReferenceMigration.ts`, Access 프로필/Member writer | 모호한 이름의 자동 연결 금지는 데이터 정확성을 위한 필수 조건 |
| 원자 처리·세션 격리: SYS-007, SYS-008 | 실제 Firebase UoW, `clientSessionScope.ts`, Functions API transport, `HouseholdContext.tsx` | 실제 UoW를 유지하고 미사용 atomic/ingress 대리 구현은 정리 후보 |
| 운영 migration: SYS-009 | `scripts/migrate-runtime.mjs`, `operations/migration/production/runtimeMigrationApplication.ts`, `firebaseRuntimeMigrationPersistence.ts` | dry-run·plan hash·checkpoint·reconciliation 유지. 일반 client로 옮기지 않음 |

## 단순화하지 않을 부분

3인 가구라도 네트워크 재시도·중복 결제 수집·다른 기기의 동시 편집은 발생합니다. receipt, transaction, endpoint별 delivery claim, 권한 검증, 세션 세대, 명시적 purge는 보존합니다. 규모에 맞는 단순화의 우선 대상은 그 보호 장치를 흉내 낸 미사용 계층과 같은 정책의 복사본입니다.

AST 참조 분석은 Firebase 실행 4진입점과 모든 정적 import/export/require를 포함했습니다. 운영 CLI와 테스트 경로는 별도로 확인해야 하며, 미도달 수 자체를 삭제 가능 파일 수로 해석하지 않습니다.

## 구현 결과 — 2026-09-17

- 미사용 Access client 대리 구현 3가지와 Notifications 대체 Application 및 전용 Port, 미사용 ingress/atomic/migration runner를 총 53개 파일 정리했습니다. 뒤이어 실제 bootstrap에서 사용하지 않는 구 Shortcut 전달 adapter 3개와 그 전용 타입도 정리했습니다. 실제 CLI의 migration·purge, 구 Inbox 복구·호환 guard는 보존했습니다. 위 발견의 경로·행은 검토 기준 커밋의 근거입니다.
- `HouseholdContext`의 metadata 변환·비교를 `features/access-household/application/householdReadModel.ts`로 분리했습니다. 홈 카드 정규화는 `features/home-preferences/application/homeSummaryConfig.ts` 한 곳을 서버 read와 세션 복원에서 사용합니다. 유효한 카드 선택은 보존하고 잘못된 카드만 기본값으로 바꿉니다. 사용처 없는 전체 가구 목록 조회 함수도 제거했습니다.
- Functions build 전에 고정된 `functions/lib` 산출물 폴더를 비워 삭제한 소스의 JavaScript가 배포에 남지 않도록 했습니다.
- PWA 문서의 복수 worker·고정 compat SDK 설명을 과거 결함과 현재 단일 worker 구현으로 구분했습니다.
- 1차 정리에서 실제 Access·Notifications Application/adapter 관련 기존 테스트 **193개**, 첫 화면·세션 복구·설정 읽기 테스트 **34개**를 통과했습니다. 추가 구 adapter 정리 후 Notifications 범위 **69개**를 통과했습니다. 미사용 latency helper의 테스트 3개는 제거하고 실제 dispatcher/provider의 실패·대상 없음 판정 회귀로 옮겼습니다. 이 숫자들은 실행별 중복을 포함하므로 합산하지 않습니다. 전체 CI와 운영 배포 결과는 중앙 보고서에서 별도 기록합니다.
