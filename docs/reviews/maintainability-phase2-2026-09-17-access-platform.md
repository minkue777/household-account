# 2차 유지보수성 검토: 세션·홈·알림·PWA·배포

기준 HEAD `f1ed5a8`, 2026-09-17. 요구사항 목록에 파일을 연결하는 것에 그치지 않고, 실제 변경 시나리오의 상태 소유자·비동기 수명·다른 기능에 미치는 영향·불필요한 조회를 확인했습니다. Access의 서버·관리자 검토는 [별도 보고서](maintainability-phase2-2026-09-17-access-admin.md), Android는 [수집·Android 보고서](maintainability-phase2-2026-09-17-capture-android.md)를 함께 봅니다.

아래의 경계 검토는 모든 실제 기기·운영 데이터에 대한 실행 검증을 뜻하지 않습니다. 읽은 구현, 새로 실행한 검사, 남은 한계를 구분합니다.

## 적용한 개선

### P2-AP1 · 멤버 이름 변경이 오래된 화면 상태를 다시 덮었습니다

[HouseholdContext](../../web/src/contexts/HouseholdContext.tsx)의 `renameMember`는 서버 명령 후 호출 시점의 `household`를 펼쳐 저장했습니다. 대기 중 최신 가구 metadata를 받아도 이름 응답이 그 값을 되돌릴 수 있었고, 로그아웃 이후 응답도 화면 상태를 변경할 수 있었습니다.

기존 `clientSessionScope`의 불변 scope 객체를 작업 시작 때 보관하고 import 후·명령 완료 후 동일 세션인지 확인합니다. 화면 반영은 `householdRef`/`currentMemberRef`의 최신 값에 적용하며 더 높은 멤버 version은 보존합니다. 별도의 전역 요청 관리자나 신규 세션 체계는 만들지 않았습니다. 실제 Provider 테스트에 metadata 선도착→이름 응답, 로그아웃→이름 응답 순서를 추가했습니다. 테스트의 scope mock도 실제 구현을 호출하도록 바꾸어 상태 격리가 실제로 검증되도록 했습니다.

### P2-AP2 · 홈 원장 페이지에 서로 다른 수명의 부작용이 모여 있었습니다

[LedgerPage](../../web/src/components/home/LedgerPage.tsx)의 화면 선택 상태는 남기고 다음 책임을 기능 내부로 옮겼습니다.

| 변경 시나리오 | 수정 소유자 | 격리·보존 내용 |
|---|---|---|
| 연간 홈 요약의 구독 시점·실패 표시 변경 | [useLedgerYearSummary](../../web/src/features/ledger/useLedgerYearSummary.ts) | 월 원장 준비 후 시작, 필요 없으면 구독하지 않음, 가구·연도·거래유형 변경 시 폐기. 목록과 합계를 별도 상태로 중복 저장하지 않고 합계는 파생합니다. 실패 시 마지막 정상 값과 오류를 구분합니다. |
| 첫 원장/전체 홈 준비·인접 월 prefetch 변경 | [useLedgerHomeReadiness](../../web/src/features/ledger/useLedgerHomeReadiness.ts) | 데이터·모달 상태를 소유하지 않습니다. 두 paint의 RAF/취소 절차를 하나의 내부 helper로 통합하고 기존 지연·fallback을 보존합니다. |
| 알림 링크에서 특정 거래 열기 | [useLedgerEditLink](../../web/src/features/ledger/useLedgerEditLink.ts) | URL 소비·메모리 조회·원격 조회·늦은 응답 폐기를 소유합니다. 전체 지출 배열 대신 실제 대상 거래에 의존하여 무관한 원장 갱신이 진행 중 조회를 다시 시작하지 않습니다. |

범용 화면 controller를 만들거나 월 이동의 간단한 state setter까지 hook으로 나누지 않았습니다. 실제 페이지의 첫 화면 완료 테스트와 새 hook 생명주기 테스트를 함께 실행했습니다. 다른 담당자가 새 hook과 실제 페이지 연결을 교차 검토했습니다.

### P2-AP3 · 알림을 보내지 않는 거래도 수신자 저장소에 의존했습니다

[DeliveryAssuranceApplication](../../functions/src/contexts/notifications/application/deliveryAssuranceApplication.ts)은 모든 기록 이벤트에 endpoint와 Membership 조회를 먼저 수행했습니다. Web 수동·정기·시스템·Android 기록은 현재 정책상 자동 push 대상이 없으므로 비용뿐 아니라 관계없는 수신자 저장소 실패에도 종속되었습니다.

기존 Notifications 소유 `decideTransactionCreatedRecipients` 순수 정책을 먼저 적용합니다. `NoTarget` 또는 원천 계약 오류가 이미 결정되면 endpoint/Membership 조회를 하지 않고 기존 terminal Intent/Inbox를 기록합니다. iOS 자동 등록과 명시적 알림 요청은 기존 planner, 선호, 활성 Membership, endpoint version 검사를 그대로 거칩니다. 이벤트 만료·receipt 재생이 먼저라는 순서도 유지합니다. 실제 원장/정기지출 Outbox→consumer 경로에서 불필요한 조회 0건을 검증하고, 해당 저장소가 실패하더라도 NoTarget 처리가 완료됨을 확인했습니다.

## 기능별 변경 경계 검토

| 기능·요구사항 | 검토한 실제 경로와 변경 소유 | 판단과 검증 한계 |
|---|---|---|
| 기존 사용자 연결 (HH-001, HH-002) | legacySessionCandidate → HouseholdContext 확인 흐름 → LegacyMembershipApplication·Firebase store | 후보는 신원 권한이 아니며 사용자 확인 뒤 인증 UID/기존 대상/이미 연결된 멤버를 검증합니다. 기존 ID와 명의자 profile을 유지하고 다른 UID 연결을 거절하는 정책을 읽었습니다. 일반 전환과 운영 repair capability를 합치지 않았습니다. 실제 운영 legacy 데이터 migration은 미실행입니다. |
| 첫 방문·생성·초대 (HH-003, HH-006, HH-007, HH-JOIN-001) | GoogleOnboardingApplication → 명령별 mode의 FirebaseGoogleOnboardingStore → 별도 Category initializer | 생성은 Household/자기 Member/Membership/claim/Outbox를 같은 transaction으로 저장하고 Category 초기화는 해당 모듈의 멱등 경계에서 수행합니다. 초대는 hash 저장·만료 시각·사용 상태를 같은 join transaction에서 확인합니다. TTL 청소와 업무상 5분 만료 판정은 별개이므로 하나로 합치지 않습니다. 실패한 초기화의 실제 Provider 복구 회귀는 실행했으나 초대 발급/경쟁 join의 새 Emulator 재현은 CI 범위입니다. |
| 로그아웃·복원·보호 화면 (HH-004, HH-005, HH-008) | HouseholdContext → UID 일치 cache/권위 Membership → Rules 보호 listener, authService·FID lifecycle | cache 표시는 인증·원장 성공으로 승격되지 않으며 metadata 한 문서 읽기는 업무 listener와 병렬입니다. 아래 PWA 세션 폐기 및 실제 Provider/remote recovery 20개 검증을 연결합니다. 모든 온보딩 상태 조합의 완전한 상태공간 검증은 아닙니다. |
| 로그인·세션 복원·멤버 이름 (HH 및 SYS-008) | HouseholdContext → Auth 서비스/Access command → metadata/cache → clientSessionScope·reset registry | 전체 Context를 읽고 cache 복원, 권위 Membership 해석, Native custom token handshake, 로그아웃 순서를 확인했습니다. 이름 응답 문제는 AP1로 수정했습니다. 인증 observer와 Native 복원을 파일 길이만으로 분리하면 상태 전이의 소유자가 갈라지므로 유지합니다. 모든 onboarding 도중 사용자 교체 조합을 새로 재현한 것은 아닙니다. |
| FID 등록·교체·해제 (PUSH-001, PUSH-002, PUSH-003, PUSH-008, PUSH-009) | PWA fidEndpointLifecycle / Native 담당 경계 → notification handler → 요청별 MobileFidRegistrationController → EndpointRegistrationStore·순수 등록/비활성 정책 | handler는 인증된 actor에서 controller를 만들며 payload의 자기신고 멤버를 쓰지 않습니다. 같은 FID 갱신과 SDK 해제의 expected registration version, 다른 binding 삭제 거부가 각각 필요합니다. 클라이언트 준비와 서버 등록 완료를 합치지 않습니다. 이번에는 실제 Apple/FCM 공급자 등록을 새로 수행하지 않았습니다. |
| 자동·명시 알림·다중 endpoint·선호 (PUSH-004, PUSH-005, PUSH-010, PUSH-014) | Ledger event → dispatcher → DeliveryAssurance accept → planner → claim/sendOnce | AP3 적용. 수신자 정책은 Notifications, 원장 사실은 Ledger가 소유합니다. 발송 직전 Membership/endpoint 재확인은 이벤트 접수 후 탈퇴·재등록을 보호하므로 중복 조회로 삭제하지 않았습니다. 재전달 Receipt와 provider 불확실 결과를 재발송하지 않는 send-once도 유지합니다. 56개 집중 테스트를 실행했습니다. |
| 클릭·foreground (PUSH-006, PUSH-007, PUSH-011, PWA-006) | 통합 worker의 구조화 payload parser → 허용 경로 생성 → useLedgerEditLink / Native 표시 경계 | Web hook에서 메모리 조회·원격 조회·취소를 검증했습니다. 클릭 URL을 임의 문자열로 일반화하지 않습니다. Android 표시 guard는 별도 담당 보고서에 있습니다. 새 iPhone 실기 클릭 검증을 했다고 주장하지 않습니다. |
| 멤버 제거·purge (PUSH-012, PUSH-013) | dispatcher의 member cleanup, Notifications purge participant, Access process | 업무 삭제 process와 endpoint 정리의 소유 경계를 확인했습니다. 실제 운영 purge는 실행하지 않았습니다. 페이지 checkpoint/권한과 삭제 범위 검토는 Access 보고서에 남겼습니다. |
| 설치·단일 worker·SDK 일치 (PWA-001, PWA-003, PWA-005) | browserServiceWorker → fidEndpointLifecycle → worker/index.js → finalize-production-artifact | root worker 등록 promise, 설치 활성화 대기, worker 버전 handshake, 기존 worker 정리 순서를 확인했습니다. 한 controller에서 cache/push/click을 처리하는 구조를 유지합니다. 실제 production build의 정적 파일·CSP hash·Firebase SDK·root worker 검증을 통과했습니다. |
| 로그아웃·캐시 (PWA-004, SYS-008) | HouseholdContext → 등록 작업 drain·endpoint 제거 → sessionCache/reset registry | endpoint 제거 실패 시 Auth 로그아웃을 성공 처리하지 않는 계약을 유지합니다. 등록 epoch, cleanup barrier, fingerprint는 이전 iOS 재연결 사례를 보호하므로 단순 삭제 대상이 아닙니다. 금융 응답 runtime cache 폐기와 immutable 정적 자산 보존은 목적이 다릅니다. 보유 cache 누락은 Portfolio 담당이 기존 reset 체계에 연결했습니다. |
| 업데이트·보안 헤더 (PWA-002, PWA-007, PWA-008) | PwaRuntimeUpdate의 dirty input·waiting worker·명시 활성화 → controllerchange 1회 reload / production artifact 검증 | 강제 reload와 timeout 활성화를 추가하지 않았습니다. 문서/DOM 수준 dirty 감지는 저장 후 같은 input이 남는 화면에서 보수적인 확인을 낼 여지가 있으며 전체 폼 저장 연동을 구현했다고 하지 않습니다. CSP를 기능 파일마다 조립하지 않는 중앙 artifact 경계를 유지합니다. |
| 홈 카드·지역화폐 선택·실패 (HOME-001, HOME-002, HOME-003, HOME-004) | homePreferences hook/Settings → HomePreference command/runtime/atomic store; 금액은 Ledger·Budget·Balance 원천에서 파생 | configuration draft의 시작 version과 canonical 구독이 구분되어 있습니다. 홈은 원장/잔액 원천을 수정하지 않고 own preference만 원자 저장합니다. AP2로 연간 값의 중복 상태와 수명 결합을 줄였습니다. store가 카드 구성 저장에도 currency 목록을 읽는 작은 불필요한 결합은 남아 있습니다. 드문 설정 명령에 새 범용 read-plan 체계를 만들지 않았으며 후속 범위로 기록합니다. |
| 테마 (THEME-001) | ThemeContext의 허용 키·CSS 적용·로컬 저장 | 유효하지 않은 저장값은 기본값, localStorage 실패는 현재 선택을 유지합니다. 다섯 테마와 단일 DOM 경계에는 별도 Theme Application/Repository 계층이 필요하지 않습니다. 실제 ThemeContext를 읽었으며 이번에 별도 테마 변경이나 실기 색상 검증은 하지 않았습니다. |
| CI와 배포 (REL-001, REL-002, REL-003, REL-004) | quality-gates.yml / instrumentation-scope / Vercel Git ignore / deploy-firebase + firebase-deploy-scope / TargetCompatibility·Provenance | CI는 별도 SHA 결과, 배포는 build·서명·대상·hash·실제 인증 smoke입니다. 누적 변경 기준 codebase 선택과 lease 획득 뒤 재판정을 확인했습니다. 내부 함수 이동은 외부 계약 변경과 다르므로 불필요한 migration을 추가하지 않습니다. codebase 3개에 공용 lib가 들어가는 현재 build 때문에 공용 서버 변경 시 3개 배포를 유지합니다. |

## 공통 계약과 복잡도 판단

- **SYS-001, SYS-006, SYS-008:** session scope와 서버 actor가 가구/멤버 소유의 기준입니다. 이름 문자열이나 UI에 현재 표시된 가구만으로 명령을 조립하지 않습니다. AP1, 관리자 상세 guard, Android QuickEdit scope, 보유 snapshot reset을 각 실제 소유 경계에서 고쳤습니다.
- **SYS-002, SYS-003:** Ledger 순수 mapper와 Category 공통 reader로 호환 규칙을 모읍니다. `expense` 기본값, missing category의 `etc`, 이미 존재하는 사용자 ID 보존을 새로 바꾸지 않았습니다. Finance/Capture 보고서와 해당 테스트를 참조합니다.
- **SYS-004, SYS-005:** 금액·서울 날짜의 원천 정책은 Ledger/Portfolio/Capture의 경계별 소유입니다. 이번 변경은 통화/시간 계약을 바꾸지 않습니다. 모든 공급자 parser를 새 원문으로 재검증한 것은 아닙니다.
- **SYS-007:** 정기 목록의 실패를 빈 성공으로 바꾸던 adapter를 수정했습니다. canonical 명령 성공, optimistic 화면 상태, 후속 Outbox는 다른 수명이며 하나의 범용 성공 flag로 합치지 않습니다.
- **SYS-009:** 운영 migration·purge는 승인된 운영 경계를 유지합니다. 이번에는 운영 데이터 정리나 새로운 migration을 수행하지 않습니다.

3인 가구에서도 복수 기기·중복 알림·재시도는 존재하므로 Receipt, Outbox, expectedVersion, tenant 경계는 유지합니다. 새 bus, generic controller, 범용 상태기계는 추가하지 않았습니다. 이번의 분리는 이름을 바꾼 파일 이동이 아니라 구독 수명/순수 계산/명령 실행 의존을 실제로 나누는 범위입니다.

## 이번 검증

- Web 실제 HouseholdProvider/remote-session 회귀: 2 suites, 20 tests 통과.
- Web 원장 hook 수명 + 실제 홈 첫 완료: 2 suites, 8 tests 통과.
- Functions notification production-flow + delivery assurance + recipient policy: 3 files, 56 tests 통과.
- 중앙 Web TypeScript 통과; production build 및 artifact 검증 통과.
- 중앙 Functions architecture 10 files, 39 tests 통과. 전체 CI·E2E는 새 commit 기준으로 별도 실행합니다.

분리 hook와 알림 preflight는 Finance 담당자가 실제 호출 연결을 교차 검토했습니다. 새 기기 성능 수치나 장애 발생률 개선은 측정하지 않았으므로 보고하지 않습니다.
