# 보안과 개인정보 경계

> 문서 유형: Cross-cutting Policy  
> 상태 규약: [요구사항 문서 규약](../governance/conventions.md)  
> 시스템 계약: [시스템 컨텍스트](../system/context.md)

## 1. 책임

이 문서는 5개 업무 Context와 지원·플랫폼 영역에 공통으로 적용되는 인증, 가구 격리, 민감 데이터, 기기 경계와 서버 함수 권한을 다룬다. 기능별 보안 요구사항의 원문은 해당 기능 모듈이 소유하며 여기서는 참조만 한다.

## 2. 보호 대상

| 보호 대상 | 현재 저장 위치 | 소유 Context·영역 | 최종 소유 기능 |
|---|---|---|---|
| 가구·멤버·자산 명의자 프로필 정보와 공유 키 | households, assetOwnerProfiles, Web storage, Android SharedPreferences | [Access & Household](../contexts/access-household/requirements.md) | [가구와 접근](../contexts/access-household/modules/household-access/requirements.md) |
| 지출·수입 | expenses | [Household Finance](../contexts/household-finance/requirements.md) | [거래 원장](../contexts/household-finance/modules/ledger/requirements.md) |
| 등록 카드·가맹점 규칙 | registered_cards, merchant_rules | [Payment Capture](../contexts/payment-capture/requirements.md) | [결제 설정](../contexts/payment-capture/modules/payment-configuration/requirements.md) |
| 금융 알림 원문 | notification_debug_logs | [Payment Capture](../contexts/payment-capture/requirements.md) | Android Diagnostic Adapter — 임시 |
| Android 결제 원문 write-ahead journal·실패 대기 후보 | Android 로컬 암호화 Observation Queue | [Payment Capture](../contexts/payment-capture/requirements.md) | [Android 결제 수집](../contexts/payment-capture/modules/android-payment-ingestion/requirements.md), DEC-032·068 |
| Client session cache·구독·Native mirror·현재 월 원장·가구별 카테고리 표시 snapshot | Web memory/localStorage/IndexedDB, Android preferences/WebView | 공통 시스템·Access·Ledger·Category Read Model | [SYS-008](../system/context.md#6-공통-요구사항), Android Host, DEC-068 |
| 자산·보유종목·배당 | assets, holdings, dividend collections | [Portfolio](../contexts/portfolio/requirements.md) | [Portfolio 내부 기능](../contexts/portfolio/requirements.md#4-aggregate와-소유-데이터) |
| FCM 전달 주소·subscription | 현재 `fcmTokens` registration token, 목표 `notificationEndpoints` FID | [Notifications](../contexts/notifications/requirements.md) | [푸시 알림](../contexts/notifications/modules/notifications/requirements.md) |
| WebView 세션 Bridge | AndroidBridge, localStorage | [지원·플랫폼](../supporting-platform/requirements.md) | [Android Host](../supporting-platform/modules/android-host/requirements.md) |

## 3. 초기 코드 감사에서 확인한 권한 상태

아래 항목은 리팩토링 전 위험을 기록한 기준선이며 현재 목표 Rules 상태를 뜻하지 않는다. 2026-07-21 기준 적용된 `firestore.rules`는 활성 Membership 기반 read, client write 거부, 시스템 관리자 전용 운영·진단 read로 닫혀 있고 Emulator 보안 행렬로 검증한다.

- Firestore Rules에 열거된 컬렉션은 인증 없이 전체 읽기·삭제가 가능하다.
- households는 인증 없이 전체 쓰기가 가능하다.
- 다른 컬렉션도 요청 문서의 householdId가 null이 아니면 생성·수정할 수 있다.
- 기존 householdId 유지, 필드 타입, 멤버십을 검증하지 않는다.
- fcmTokens와 notification_debug_logs도 공개 읽기 대상이다.
- Admin SDK를 사용하는 Functions는 Firestore Rules를 우회한다.
- saveFcmToken과 renameHouseholdMember callable은 인증·인가를 검증하지 않는다.
- Shortcut onRequest 함수는 코드에 있는 정적 공유 토큰으로만 보호된다.
- dividend save API는 인증 없이 임의 가구 스냅샷을 변경할 수 있다.

## 4. 보안 경계별 소유 요구사항

| 경계 | 소유 요구사항 | 소유 Context·영역 | 소유 문서 |
|---|---|---|---|
| 가구 간 데이터 격리 | SYS-001 | Cross-cutting / Access | [시스템 컨텍스트](../system/context.md) |
| Client session 세대 격리 | SYS-008 | 공통 시스템 | [시스템 컨텍스트](../system/context.md#6-공통-요구사항) |
| Migration·backfill 실행 권한 | SYS-009 | 공통 시스템 / 운영 | [시스템 컨텍스트](../system/context.md#6-공통-요구사항) |
| 관리자 권한 | ADM-002 | [Access & Household](../contexts/access-household/requirements.md) | [가구와 접근](../contexts/access-household/modules/household-access/requirements.md) |
| Google 로그인·자기 Member·legacy claim·5분 초대 | HH-001~009, HH-JOIN-001, DEC-021 | [Access & Household](../contexts/access-household/requirements.md) | [가구와 접근](../contexts/access-household/modules/household-access/requirements.md), [결정 기록](../governance/decisions.md#dec-021) |
| 비로그인 자산 명의자 프로필의 가구 격리·권한 분리 | HH-011, AST-009, DEC-037 | [Access & Household](../contexts/access-household/requirements.md)·[Portfolio](../contexts/portfolio/requirements.md) | [가구와 접근](../contexts/access-household/modules/household-access/requirements.md), [포트폴리오](../contexts/portfolio/modules/portfolio/requirements.md) |
| 삭제 자산의 운영 전용 조회·복구 | AST-006, AUTO-003, DEC-017, DEC-052 | [Portfolio](../contexts/portfolio/requirements.md) | [포트폴리오](../contexts/portfolio/modules/portfolio/requirements.md), [자산 자동화](../contexts/portfolio/modules/asset-automation/requirements.md) |
| Shortcut 호출자·가구 검증 | IOS-010 | [Payment Capture](../contexts/payment-capture/requirements.md) | [Shortcut 결제 수집](../contexts/payment-capture/modules/shortcut-ingestion/requirements.md) |
| FCM FID endpoint 등록 권한 | PUSH-009 | [Notifications](../contexts/notifications/requirements.md) | [푸시 알림](../contexts/notifications/modules/notifications/requirements.md) |
| WebView origin allowlist | AND-006 | [지원·플랫폼](../supporting-platform/requirements.md) | [Android Host](../supporting-platform/modules/android-host/requirements.md) |
| 임시 알림 원문 | ING-005 | [Payment Capture](../contexts/payment-capture/requirements.md) | [Android 결제 수집](../contexts/payment-capture/modules/android-payment-ingestion/requirements.md) |
| Android 결제 Queue 암호화·삭제 | ING-008, DEC-032 | [Payment Capture](../contexts/payment-capture/requirements.md) | [Android 결제 수집](../contexts/payment-capture/modules/android-payment-ingestion/requirements.md), [결정 기록](../governance/decisions.md#dec-032) |
| 잠금 화면 거래 노출·화면 캡처 허용 | QE-008, QE-011, DEC-024, DEC-045 | [지원·플랫폼](../supporting-platform/requirements.md) | [Android Host](../supporting-platform/modules/android-host/requirements.md) |
| 멤버별 다중 FID endpoint와 단일 binding 수명주기 | PUSH-003, PUSH-008, DEC-019, DEC-020 | [Notifications](../contexts/notifications/requirements.md) | [푸시 알림](../contexts/notifications/modules/notifications/requirements.md), [결정 기록](../governance/decisions.md#dec-020) |
| role 없는 일반 가구원 관리자 제거·복구와 알림 차단 | HH-012, PUSH-012, DEC-038, DEC-039 | [Access & Household](../contexts/access-household/requirements.md)·[Notifications](../contexts/notifications/requirements.md) | [가구와 접근](../contexts/access-household/modules/household-access/requirements.md), [푸시 알림](../contexts/notifications/modules/notifications/requirements.md), [결정 기록](../governance/decisions.md#dec-038) |
| 영구 purge 뒤 UID claim 조건부 해제 | ADM-003, HH-010, DEC-040 | [Access & Household](../contexts/access-household/requirements.md) | [가구와 접근](../contexts/access-household/modules/household-access/requirements.md), [결정 기록](../governance/decisions.md#dec-040) |

## 5. 임시 알림 원문 정책

[DEC-002](../governance/decisions.md#dec-002)에 따라 notification_debug_logs는 parser 개선용 임시 진단 데이터다.

제거 전 임시 안전장치:

1. 관리자 또는 진단 역할만 읽을 수 있다.
2. DEC-047에 따라 파서 진단에 사용하는 현재 원문 필드는 기능 제거 전까지 전부 보존하되 인증 token·FCM FID·가구 접근 자격 같은 별도 Secret을 추가하지 않는다.
3. 시간 TTL이나 자동 개별 삭제를 두지 않고 진단 기능 제거 시 Writer·Rules·index·컬렉션 전체를 함께 삭제한다.
4. parser fixture로 채택한 원문은 개인정보를 제거한 별도 테스트 fixture로 옮긴다.
5. 제거 조건을 만족하면 Android Writer, Rules, index, 컬렉션을 함께 제거한다.

이 데이터는 [DEC-047](../governance/decisions.md#dec-047)에 따라 기능 제거 전까지 보존하지만 목표 Domain Event나 영구 Audit Log로 마이그레이션하지 않는다.

## 6. 기기와 클라이언트 경계

- AndroidBridge는 허용된 제품 origin에서만 민감 API를 노출해야 한다.
- 인증·Membership 검증이 완료되기 전에는 보호 원격 Query·기본 데이터 write·FID endpoint 등록을 시작하지 않는다. DEC-068의 마지막 서버 검증 가구·현재 월 원장·가구별 카테고리 local snapshot은 비권위 표시 hint로 먼저 그릴 수 있으며, Auth UID 불일치·first visit·권한·authoritative household 부재가 확인되면 폐기한다. 로그아웃·가구/멤버 전환은 이전 session의 구독·cache·늦은 callback을 폐기한다.
- legacy householdKey·currentMemberId는 첫 Google 로그인의 일회성 claim에만 사용한다. 연결 성공 뒤 key 기반 로그인 상태를 제거하고 신규 입력 UI를 제공하지 않는다.
- 초대 코드는 5분·일회 사용이며 원문을 저장·로그하지 않는다. Invitation 소비와 호출자 자기 Member·Membership 생성을 한 서버 transaction에서 처리한다.
- 사용자가 보낸 principalUid·타인 memberId는 Member 생성·이름 변경 입력으로 받지 않고 Google token과 Membership에서 자기 identity를 도출한다.
- dependent 자산 명의자 프로필은 같은 가구의 활성 Membership만 생성·이름 변경할 수 있고 삭제·논리 보관은 서버가 검증한 관리자만 수행한다. 일반 자산 UI에는 삭제 surface를 두지 않으며 profileId나 표시 이름을 인증 주체·권한·알림 수신자로 해석하지 않는다.
- 가구 생성자를 포함한 일반 사용자는 다른 Member를 제거·복구할 수 없다. 서버가 검증한 전체 관리자만 모든 활성 Member를 같은 규칙으로 제거하며, 제거된 Membership은 ActorContext·세션 복원·알림 recipient와 provider 호출에서 즉시 차단한다. household owner role은 권한 근거로 사용하지 않는다.
- 일반 사용자는 삭제 자산 목록을 조회하거나 자산을 복구할 수 없다. `RestoreDeletedAsset`은 서버가 만든 관리자·승인된 운영 Actor, 전용 capability, 감사 사유를 모두 요구하며 일반 자산 write 권한으로 우회할 수 없다.
- 영구 purge 중 UID claim은 모든 Context 완료 전 해제하지 않는다. finalization은 server-only claimKey와 expected householdId·membershipId·version을 조건부 검증하며 UID·claimKey 원문을 공개 Event·로그에 남기지 않는다.
- 가구 키와 FCM FID 원문을 운영 로그에 기록하지 않는다.
- endpoint 등록 결과와 일반 로그에 FID·FID hash·이전 기기 metadata를 노출하지 않는다.
- FID는 앱 설치 전달 주소일 뿐 사용자 인증 정보가 아니다. Firebase Auth·Membership·App Check 검증을 FID 값으로 대체하지 않는다.
- Shortcut credential은 DEC-033에 따라 사용자·가구·`paymentCapture:submit` 범위의 별도 bearer 자격이다. 원문은 최초 발급 응답에서 한 번만 공개하고 서버에는 hash만 저장하며 요청 body의 householdId·owner를 신원 근거로 사용하지 않는다. 동일 발급 idempotency key 재전송에는 credentialId·version만 반환하며 원문 재생·새 자격 자동 생성은 금지한다. 폐기·명시적 재발급·Membership 상실·가구 삭제를 매 요청 확인하고 원문·일부 문자열을 로그에 남기지 않는다.
- Provider 구조화 로그·Health 상태에는 API key, 응답 원문, 가구 ID 원문, assetId 원문과 보유수량을 기록하지 않고 안정 target hash만 허용한다.
- `operations/runtime/providerHealth`, job run·receipt와 `GetProviderHealth`는 서버 및 승인된 관리자·운영 주체만 접근한다.
- SharedPreferences의 가구 자격 정보는 암호화 또는 서버 세션으로 대체한다.
- Android cloud backup·device transfer는 legacy key, 인증/session mirror, WebView 보호 저장소, Firebase Installation persistence, 암호화 Queue와 그 key material을 기본 제외한다. 복원된 설치가 이전 Actor나 FID binding을 자동 상속하지 않게 한다.
- QuickEdit은 DEC-024에 따라 잠금 화면 위에 현재 편집 정보를 표시할 수 있지만 keyguard를 해제하지 않고 non-exported Activity·유효 거래 ID·현재 session을 강제한다. DEC-045에 따라 화면 캡처와 시스템 최근 앱 미리보기는 별도 차단하지 않되 앱 로그에는 QuickEdit 민감값을 기록하지 않는다.
- Android 13 이상에서는 알림 표시 런타임 권한을 요청하고 거부 상태를 처리한다.
- Android 결제 journal은 원격 호출 중 process 종료 유실을 막기 위해 raw DTO를 Android Keystore의 non-exportable 설치 키로 AES-256-GCM 암호화해 저장한다. 정상 terminal은 QuickEdit follow-up 내구화 뒤 즉시 삭제하고 WorkManager를 만들지 않으며, 실패·partial entry만 최대 72시간 보존한다. 로그아웃·멤버/가구 변경·키 오류에서도 삭제한다.
- PWA/CDN cache는 navigation HTML, 인증 응답과 가구·금융 API를 저장하지 않는다. build-versioned 정적 asset과 공개 비민감 아이콘·폰트·이미지의 최대 7일 cache만 허용하고 임의 cross-origin 응답은 저장하지 않는다. DEC-068의 first-party localStorage 가구·현재 월 원장·가구별 카테고리 표시 snapshot은 이 공개 cache 금지와 별개이며 서버 권한 근거로 사용하지 않는다. ([DEC-051](../governance/decisions.md#dec-051), [DEC-068](../governance/decisions.md#dec-068))
- 운영 migration·repair는 browser bundle에서 실행할 수 없고 승인된 서버 job이 명시적 scope·dry-run·checkpoint·reconciliation을 남긴다.
- 외부 Provider를 대신 호출하는 Web/Functions API는 인증·Membership을 검증하고 App Check, schema/body/batch/concurrency/rate 상한을 적용한다. 외부 URL은 HTTPS allowlist, redirect 재검증, timeout과 응답 크기 상한을 통과해야 한다.
- 클라이언트 UI의 권한 분기는 서버 권한 검증을 대체하지 않는다.

## 7. 보안 테스트 행렬

Canonical 보안 테스트 ID:

| 테스트 ID | 종류 | Given / When / Then | 연결 요구사항 |
|---|---|---|---|
| T-SEC-001 | 목표 | 인증 없음·같은 가구·다른 가구·관리자별 컬렉션 CRUD / Rules / 권한 행렬과 householdId 불변식 적용 | SYS-001, ADM-002 |
| T-SEC-002 | 목표 | 무인증 RegisterEndpoint·rename·Shortcut·dividend save / 호출 / 모두 권한 오류와 변경 없음 | ADM-002, IOS-010, PUSH-009 |

상세 행렬:

| 대상 | 시나리오 | 기대 결과 |
|---|---|---|
| Firestore Rules | 인증 없음, 같은 가구, 다른 가구, 관리자별 CRUD·query | 역할과 가구 범위에 맞는 최소 권한만 허용 |
| householdId | 생성·수정 시 누락, 타 가구 값, 기존 값 변경 | 모두 거부 |
| 서버 전용 컬렉션 | notificationEndpoints, legacy fcmTokens, notification_debug_logs, asset_history, dividend 데이터, operations/runtime providerHealth·receipt 직접 접근 | 명시된 서버·진단·운영 역할 외 거부 |
| callable | RegisterEndpoint, legacy saveFcmToken, renameHouseholdMember 무인증·타 가구 호출 | 권한 오류이며 변경 없음 |
| 관리자 가구원 제거 | 일반 사용자 호출, 생성자·초대 가입자·마지막 활성 Member 제거, 제거/복구와 다른 가구 가입 경합 | 일반 호출 거부, 모든 Member 동일 규칙·빈 가구와 이력 보존, active UID claim 하나만 유지, 제거 뒤 provider 호출 0회 |
| 삭제 자산 운영 복구 | 일반 사용자의 삭제 목록 조회·복구, 감사 사유 누락, 다른 가구 assetId, purging 자산 | 존재 여부와 목록을 노출하지 않고 write 0건; 승인된 운영 복구만 Core+Automation UoW 한 번 |
| 영구 purge claim finalization | Context purge 실패·claim page 중단·stale claim·중복 완료 요청 | 미완료 중 해제 0건, 현재 대상 claim만 조건부 해제, stale 보존·재개 가능, 모든 page 뒤 purged Event 한 번 |
| HTTP API | Shortcut, dividend save의 무인증·비정상 입력 | 권한 또는 검증 오류이며 변경 없음 |
| WebView | 허용하지 않은 origin에서 Bridge 접근 | 민감 API 비노출 |
| 진단 로그 | 비관리자 조회, 미등록 source, 장기 경과, 별도 Secret 혼입 | 조회·수집 거부, 기능 제거 전 문서 유지, 인증 token·FID·가구 접근 자격 비수집 |
| Provider Health | 비관리자 Query·직접 write, 민감 field 포함 시도 | 조회·쓰기 거부, 서버 Adapter만 최소 redacted schema 저장 |
| 잠금 화면 | 잠금 상태 QuickEdit 표시·캡처 | DEC-024의 표시 허용·keyguard 유지·외부 진입 차단과 DEC-045의 캡처 허용·앱 로그 금지 준수 |
| Android 결제 journal·실패 Queue | 원격 호출 중 process 종료, 로컬 DB 탈취, entry 변조, follow-up enqueue 실패, 72시간 경계, 로그아웃·멤버/가구 변경, Keystore 키 무효화 | 원격 전 암호문 선기록, 평문 비노출·GCM 인증 실패 전송 차단, QuickEdit FIFO 선내구화 뒤 ack, 조건별 entry 삭제·다른 Actor 재연결 없음 |
| Android backup/restore | 같은 기기 재설치·새 기기 이전·backup restore | legacy key·session·Queue·FID가 복원되지 않고 새 설치가 이전 Actor에 자동 연결되지 않음 |
| Client session | 마지막 검증 A snapshot 뒤 Auth UID 불일치·first visit·권한 거부, A→B 전환, A의 늦은 callback, guest/admin route 진입 | 초기 hint 외 A의 보호 구독·write 0건, 불일치 확정 뒤 A render·cache 사용 중단, B에 A callback 반영 없음 |
| 외부 API ingress | 무인증·App Check 실패·빈 정규화 검색·초과 body/batch/quota | 외부 공급자 호출 0회, 안정적인 401/403/413/429 또는 typed error |
| 외부 URL fetch | 사설 IP·metadata host·악성 redirect·초과 응답 | allowlist 경계에서 차단하고 응답 원문·credential을 log하지 않음 |
| 운영 migration | 일반 client 호출, 범위 밖 문서, page 재실행 | API 비노출, 변경 0건 또는 멱등 재생, reconciliation 불일치 시 중단 |

## 8. 외부 공유 전 차단 조건

다음 조건을 만족하기 전에는 외부 사용자가 안전하게 사용할 수 있는 상태로 보지 않는다.

1. Firebase Auth와 Membership 기반 Rules가 적용된다.
2. Admin SDK 함수가 Actor Context와 역할을 검증한다.
3. 정적 공유 토큰을 Secret으로 회전하거나 사용자 인증으로 대체한다.
4. notificationEndpoints·legacy fcmTokens와 금융 원문을 공개 읽기에서 제거한다.
5. WebView Bridge origin과 배포 URL을 제한한다.
6. 가구 간 읽기·쓰기·삭제·query 보안 E2E가 통과한다.
7. 기존 localStorage 사용자의 legacy claim 경합·충돌·멱등 테스트와 신규 가구 키 입력 차단이 통과한다.
8. 인증·가구·금융 API 응답이 PWA/CDN 공개 cache와 Android backup에 남지 않는다. DEC-068의 first-party 비권위 표시 snapshot은 별도 허용 범위와 불일치 폐기 테스트를 가진다.
9. 공개 Provider proxy에 인증·입력 상한·rate limit·SSRF 방어가 적용된다.
10. 사용자 앱 bundle에서 migration·repair·운영 샘플 writer를 실행할 수 없다.
