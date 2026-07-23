# Household Account 현재 시스템 요구사항 인덱스

> 상태: Draft — 코드 역추적 명세  
> 기준일: 2026-07-20  
> 범위: Web, Android, Firebase Functions, Firestore, PWA, 외부 시세·배당 연동  
> 목적: 5개 업무 Bounded Context에서 기능 모듈·요구사항·테스트·결정·데이터 소유권을 탐색하는 시작점  
> 목표 아키텍처: [목표 Clean Architecture 설계](../architecture/target-clean-architecture.md)  
> 예약 작업 설계: [Cloud 예약 작업 목표 설계와 운영 검증 기준](../architecture/cloud-scheduled-operations.md)  
> 전환 계획: [Clean Architecture 리팩토링 전략](../architecture/clean-architecture-refactoring-strategy.md)

## 1. 문서 계층과 단일 소유

요구사항은 다음 계층으로 탐색한다.

```text
System Contract
  → Business Bounded Context
    → Capability Module
      ├─ requirements.md: Requirement ID / Test ID / Code Evidence
      └─ design.md: API / Domain / Port / Test Design
```

- Context 문서는 책임·공통 언어·Aggregate·공개 계약·내부 기능의 **지도**다.
- `modules/`의 기능 문서는 각 요구사항 문장과 테스트의 **단일 원본**이다.
- 각 모듈의 `design.md`는 요구사항을 구현·테스트 계약으로 내리는 **상세 설계의 단일 원본**이다.
- Context 문서는 상세 요구사항 행을 복사하지 않고 ID 범위와 기능 문서 링크만 가진다.
- Android Host·PWA·Reporting처럼 업무 Context가 아닌 기능은 별도 지원·플랫폼 지도로 관리한다.
- 공통 형식·보안·제품 결정은 Cross-cutting 문서가 소유한다.

먼저 읽을 공통 문서:

| 문서 | 책임 |
|---|---|
| [요구사항 문서 규약](governance/conventions.md) | Context·기능 모듈 계층, 상태, 테스트 수준, 단일 소유 규칙 |
| [모듈 상세 설계 규약](governance/module-design-standard.md) | 공개 API, Domain·Port·저장 경계, 요구사항별 테스트 설계 형식 |
| [시스템 컨텍스트](system/context.md) | 행위자, 공통 용어, SYS-* 공통 계약 |
| [공통 시스템 계약 상세 설계](system/design.md) | tenant·Money·날짜·호환 mapper·Unit of Work의 SYS-* 테스트 기준 |
| [제품 결정 기록](governance/decisions.md) | DEC-001~067의 단일 정책 소유 Context와 영향 모듈 |
| [데이터 소유권](cross-cutting/data-ownership.md) | 논리 데이터·컬렉션·필드별 Context와 최종 Writer |
| [Context 간 종단 흐름](system/flows.md) | 둘 이상 Context 또는 Context+지원 계층의 현재 흐름과 교정 불변식 |
| [보안과 개인정보](cross-cutting/security-privacy.md) | 가구 격리, 서버 권한, 민감 데이터, 기기 경계 |
| [테스트 전략](governance/test-strategy.md) | Context별 카탈로그, 우선순위, CI 기준 |
| [미결정 사항](governance/pending-decisions.md) | 코드 감사에서 발견한 제품·운영 질문의 해소 상태와 결정 이력 연결 |

## 2. 5개 업무 Bounded Context

5개 Context는 업무 언어와 일관성 경계다. 배포 서비스 개수를 뜻하지 않으며, 내부 기능 모듈은 공개 계약과 단일 데이터 소유권을 계속 유지한다.

| Bounded Context | 책임 | 내부 기능 모듈 | 요구사항 | 개수 | 주요 Aggregate·데이터 |
|---|---|---|---|---:|---|
| [Access & Household](contexts/access-household/requirements.md) | Principal·가구·멤버·Membership·명의자 프로필·초대·권한 | [가구와 접근](contexts/access-household/modules/household-access/requirements.md) | HH-*, HH-JOIN-*, ADM-* | 17 | Household, Member, Membership, AssetOwnerProfile, Invitation |
| [Household Finance](contexts/household-finance/requirements.md) | 거래·분류·예산·정기 계획·지역화폐 | [원장](contexts/household-finance/modules/ledger/requirements.md), [카테고리·예산](contexts/household-finance/modules/categories-budget/requirements.md), [정기 거래](contexts/household-finance/modules/recurring-transactions/requirements.md), [지역화폐](contexts/household-finance/modules/local-currency/requirements.md) | LED-*, SPL-*, MRG-*, SEA-*, CAT-*, BUD-*, REC-*, BAL-* | 39 | Transaction, CategoryCatalog, RecurringPlan, LocalCurrencyBalance |
| [Payment Capture](contexts/payment-capture/requirements.md) | 카드·가맹점 설정과 Android·Shortcut 결제·잔액 관찰 수렴 | [결제 설정](contexts/payment-capture/modules/payment-configuration/requirements.md), [Android 수집](contexts/payment-capture/modules/android-payment-ingestion/requirements.md), [Shortcut 수집](contexts/payment-capture/modules/shortcut-ingestion/requirements.md) | CARD-*, MER-*, ING-*, PARSE-*, ING-SAVE-*, CAN-*, IOS-* | 63 | CardRegistry, MerchantRuleSet, CaptureEnvelope |
| [Portfolio](contexts/portfolio/requirements.md) | 자산·명의 참조·Position·평가·자동화·배당 | [포트폴리오](contexts/portfolio/modules/portfolio/requirements.md), [보유종목·시세](contexts/portfolio/modules/holdings-market-data/requirements.md), [자동화](contexts/portfolio/modules/asset-automation/requirements.md), [배당](contexts/portfolio/modules/dividends/requirements.md) | AST-*, HOLD-*, GOLD-*, MARKET-*, JOB-AST-*, AUTO-*, LOAN-*, DIV-*, JOB-DIV-* | 38 | AssetAccount, Position, InstrumentCatalog, AutomationPlan, DividendEvent |
| [Notifications](contexts/notifications/requirements.md) | endpoint·대상·payload·delivery·가구 purge | [푸시 알림](contexts/notifications/modules/notifications/requirements.md) | PUSH-* | 13 | NotificationEndpoint, NotificationDelivery |
| 합계 |  | 13개 기능 모듈 |  | 170 |  |

### 2.1 Context 의존 방향

동기 공개 계약의 화살표는 **소비자에서 제공자**로 향한다.

```text
Household Finance ─┐
Payment Capture ───┼──ActorContext·Membership──▶ Access & Household
Portfolio ─────────┤
Notifications ─────┘

Payment Capture ──거래·잔액 Command──▶ Household Finance
Reporting·Home ──공개 Query·Projection──▶ Household Finance / Portfolio
Access 수동 영구 Purge Process ──paged purge Command──▶ Household Finance / Payment Capture / Portfolio / Notifications
```

런타임 비동기 흐름의 화살표는 **Event producer에서 consumer**로 향한다.

```text
Access & Household ──lifecycle Outbox Event──▶ 각 업무 Context / Read Side
Household Finance ──transaction Outbox Event──▶ Notifications / Read Side
Portfolio ──valuation·dividend Outbox Event──▶ Read Side
```

두 흐름 모두 다른 Context의 Repository·Firestore 경로·Domain Entity 직접 접근을 허용하지 않는다.

## 3. 지원·읽기·플랫폼 영역

[지원·읽기·플랫폼 요구사항 지도](supporting-platform/requirements.md)는 5개 업무 Context의 계약을 전달·조회·운영하는 기능을 묶는다. 이 영역은 여섯 번째 업무 Context가 아니다.

| 역할 | 기능 모듈 | 요구사항 | 개수 | 책임 |
|---|---|---|---:|---|
| Android Delivery | [Android Host](supporting-platform/modules/android-host/requirements.md) | AND-*, QE-* | 24 | 권한, WebView, Bridge, QuickEdit |
| Web Delivery | [PWA](supporting-platform/modules/pwa/requirements.md) | PWA-* | 8 | 설치, cache/messaging worker |
| Read Side | [통계](supporting-platform/modules/reporting/requirements.md) | STAT-*, STAT-AST-* | 9 | 거래·자산 Projection |
| Preferences | [홈 환경설정](supporting-platform/modules/home-preferences/requirements.md) | HOME-*, THEME-* | 5 | 홈 카드·표시 지역화폐 구성과 Web theme |
| Operations | [외부 운영](supporting-platform/modules/external-operations/requirements.md) | JOB-ERR-*, EXT-* | 5 | Scheduler·retry·오류 분류·관측 |
| Delivery Assurance | [배포 안전성](supporting-platform/modules/delivery-assurance/requirements.md) | REL-* | 4 | release gate, 환경·project, 호환 배포·smoke |
| 합계 | 6개 기능 모듈 |  | 55 |  |

지원 모듈은 업무 Aggregate를 직접 수정하지 않고 해당 Context의 공개 Command·Query·Event를 사용한다.

## 4. 공통 시스템 계약

[시스템 컨텍스트](system/context.md)가 SYS-001~009의 9개 공통 요구사항을 소유한다.

공통 계약은 기능 구현을 모으는 `common` 모듈이 아니다. 다음처럼 모든 Context가 지켜야 하는 최소 불변식만 둔다.

- householdId 기반 tenant 범위
- 레거시 거래·카테고리 읽기 호환
- 금액·날짜·시간 형식
- 안정적인 memberId 전환
- 부분 실패와 오류 계약
- client SessionScope·늦은 callback 격리
- migration·backfill의 서버 운영 경계

전체 요구사항 수:

```text
업무 Context 169 + 지원·플랫폼 53 + 공통 SYS 9 = 231
```

## 5. Context와 기능 모듈 의존성 원칙

1. 각 요구사항 ID는 정확히 하나의 기능 모듈 문서가 소유한다.
2. 각 기능 모듈은 정확히 하나의 업무 Context 또는 지원·플랫폼 영역에 배치한다.
3. Context 문서는 상세 요구사항과 테스트 행을 복사하지 않는다.
4. 각 논리 데이터·필드·변경 규칙에는 하나의 최종 Writer를 둔다.
5. Context 내부 기능도 다른 기능의 Repository를 직접 사용하지 않고 공개 Application Port를 사용한다.
6. Context를 넘는 즉시 결과는 공개 Command/Query, 비동기 후속 효과는 Durable Outbox Event로 전달한다.
7. 입력 Adapter는 거래·자산·알림 정책을 최종 판정하지 않는다.
8. Reporting과 Home은 원본 Aggregate를 수정하지 않는 Read Side다.
9. 외부 Provider와 플랫폼 SDK는 Domain 밖 Adapter로 격리한다.

구체적인 소유권과 통신 방식은 [데이터 소유권](cross-cutting/data-ownership.md)을 따른다.

## 6. 확정된 핵심 정책

| 결정 | 정책 소유 Context | 정책 |
|---|---|---|
| [DEC-001](governance/decisions.md#dec-001) | Household Finance | 월 분할은 내림 금액을 저장하고 나머지 원 단위 오차를 반영하지 않는다. |
| [DEC-002](governance/decisions.md#dec-002) | Payment Capture | 알림 원문은 parser 개선용 임시 Diagnostic Adapter이며 나중에 제거한다. |
| [DEC-003](governance/decisions.md#dec-003) | Payment Capture | 같은 가구·날짜·시간·금액·가맹점 거래는 중복으로 버리고 Ledger가 claim을 원자적으로 강제한다. |
| [DEC-004](governance/decisions.md#dec-004) | 지원·플랫폼 | Android 최초 진입에서 overlay 권한을 받고 이후 QuickEdit 자동 표시를 끌 수 있다. |
| [DEC-005](governance/decisions.md#dec-005) | Payment Capture | 등록된 Android package만 전용 parser로 처리한다. |
| [DEC-006](governance/decisions.md#dec-006) | Notifications | Superseded — 멤버별 endpoint 한 개 정책은 DEC-020으로 대체됐다. |
| [DEC-007](governance/decisions.md#dec-007) | Payment Capture | 도시가스 납부마감일을 지출 회계일로 사용한다. |
| [DEC-008](governance/decisions.md#dec-008) | Household Finance | 지역화폐 잔액은 가구·유형별로 분리하고 홈은 선택 유형을 표시한다. |
| [DEC-009](governance/decisions.md#dec-009) | Household Finance | 서버 Scheduler가 매일 정기 거래를 처리하고 기존 계획의 누락 월을 자동 복구한다. |
| [DEC-010](governance/decisions.md#dec-010) | Household Finance | 합치기 해제 시 날짜·시각·카드는 합친 거래의 공통 값을 적용한다. |
| [DEC-011](governance/decisions.md#dec-011) | Portfolio | 신규·기존 자산에서 자동화를 처음 활성화한 날이 실행일 이후이면 당월분이 현재 잔액에 포함된 것으로 본다. |
| [DEC-012](governance/decisions.md#dec-012) | Household Finance | 취소는 금액·정규화 가맹점·카드가 정확히 일치하는 원거래만 대상으로 한다. |
| [DEC-013](governance/decisions.md#dec-013) | Notifications | 모든 거래는 생성자를 보존하고 입력 채널과 명시적 요청을 분리해 알림 대상을 결정한다. |
| [DEC-014](governance/decisions.md#dec-014) | Portfolio | 배당 기준일 보유량이 없으면 가장 가까운 관측일을 사용하고 동률이면 이전 날짜를 선택한다. |
| [DEC-015](governance/decisions.md#dec-015) | Household Finance | 기본 카테고리는 보관할 수 없고, 다른 카테고리는 설정 참조를 기본값으로 변경한 뒤 보관한다. |
| [DEC-016](governance/decisions.md#dec-016) | Access & Household | 가구 삭제는 복구 가능한 논리 삭제이며 영구 purge는 별도 수동 요청으로만 실행한다. |
| [DEC-017](governance/decisions.md#dec-017) | Portfolio | 자산 삭제는 운영 복구 가능한 논리 삭제이지만 일반 사용자는 복구할 수 없고, 영구 purge는 별도 수동 요청으로만 실행하되 기존 배당 이력은 삭제하지 않는다. |
| [DEC-018](governance/decisions.md#dec-018) | Portfolio·지원 플랫폼 | 마지막 성공 시세를 기간 제한 없이 평가에 사용하고 Firebase 구조화 로그·Health 상태·경보로 공급자 장애를 관측한다. |
| [DEC-019](governance/decisions.md#dec-019) | Notifications·지원 플랫폼 | Android·PWA의 FCM 직접 전송 주소를 FID로 통일하고 registration token API와 fallback을 제거한다. |
| [DEC-020](governance/decisions.md#dec-020) | Notifications·지원 플랫폼 | 멤버별 Android·iPhone PWA 다중 FID를 허용하고 로그아웃 삭제·로그인 등록·404 inactive 수명주기를 적용하며 데스크톱은 제외한다. |
| [DEC-021](governance/decisions.md#dec-021) | Access & Household | Google 로그인 후 자기 Member만 생성하고 5분 일회용 초대로 가입하며, 기존 localStorage 가구 키·멤버를 첫 로그인에서 같은 Membership으로 전환한다. |
| [DEC-022](governance/decisions.md#dec-022) | Notifications | 단일 partner 상태를 제거하고 명시적 알림 요청은 요청자를 제외한 모든 활성 가구원에게 전달한다. |
| [DEC-023](governance/decisions.md#dec-023) | 공통 시스템 | 가구별 timezone 없이 모든 업무 날짜·월 경계를 Asia/Seoul로 고정하고 절대 시각은 UTC Instant로 저장한다. |
| [DEC-024](governance/decisions.md#dec-024) | 지원·플랫폼 | Android QuickEdit은 화면을 켜고 잠금 화면 위에 거래 편집 정보를 표시하되 잠금 자체를 해제하지 않는다. |
| [DEC-025](governance/decisions.md#dec-025) | Notifications | endpoint별 FCM 전송은 한 번만 시도하고 timeout·일시 오류를 자동 재전송하지 않는다. |
| [DEC-026](governance/decisions.md#dec-026) | Notifications | 앱 내부 알림 종류별 설정 없이 OS 알림 권한으로 설치의 전체 푸시 표시를 켜거나 끈다. |
| [DEC-027](governance/decisions.md#dec-027) | Notifications | 활성 endpoint는 유지하고 inactive endpoint와 완료된 알림 처리 기록은 30일 뒤 자동 삭제 대상으로 표시한다. |
| [DEC-028](governance/decisions.md#dec-028) | Payment Capture | Android·Shortcut은 호출자 본인 소유 등록 카드만 조회하고, 하나 이상 일치하면 다른 가구원의 동일 카드사 등록 여부와 무관하게 지출을 생성한다. |
| [DEC-029](governance/decisions.md#dec-029) | Payment Capture | 연도 없는 결제 시각은 서울 수신 시각보다 미래가 아닌 후보 중 가장 최근 연도로 추론하며 Android·Shortcut이 같은 정책을 사용한다. |
| [DEC-030](governance/decisions.md#dec-030) | Payment Capture | Shortcut 메시지에 카드사 헤더가 없거나 지원하지 않는 카드사이면 추정하지 않고 입력을 거부한다. |
| [DEC-031](governance/decisions.md#dec-031) | Payment Capture | 원거래 없는 취소는 무변경 종료하고 보류·억제 기록을 만들지 않으며 이후 도착한 승인은 일반 입력으로 등록한다. |
| [DEC-032](governance/decisions.md#dec-032) | Payment Capture | Android raw 알림은 원격 호출 전 Keystore 암호화 write-ahead journal에 기록하고, 정상 terminal은 QuickEdit 후속 효과 내구화 뒤 즉시 지우며 실패·partial만 최대 72시간 재시도한다. |
| [DEC-033](governance/decisions.md#dec-033) | Payment Capture·Access | iPhone Shortcut은 로그인 사용자의 가구·멤버에 묶인 전용 credential을 반자동으로 설치하고, 원문은 최초 발급 응답에서만 제공하며 동일 요청 재전송에는 비밀 없는 `AlreadyIssued`만 반환한다. |
| [DEC-034](governance/decisions.md#dec-034) | Access & Household | Google UID 하나에는 동시에 하나의 종료되지 않은 가계부 Membership만 허용하며 일반 가계부 전환 UI를 두지 않는다. |
| [DEC-035](governance/decisions.md#dec-035) | Portfolio·지원 플랫폼 | 종목 카탈로그는 매일 생성해 Cloud Storage에 최근 성공 3일치를 유지하고, 검색 함수는 버전 확인이 있는 5분 인스턴스 메모리 캐시를 사용하며 `stocks.json` fallback을 두지 않는다. |
| [DEC-036](governance/decisions.md#dec-036) | Access & Household | 일반 사용자에게 가구원 탈퇴 기능을 제공하지 않고 로그아웃·가구 논리 삭제에도 Membership과 Member 연결을 보존한다. |
| [DEC-037](governance/decisions.md#dec-037) | Access & Household·Portfolio | 로그인 가구원과 자산 명의자를 분리하고 도넛 필터의 `+`로 dependent 명의자를 추가하되 삭제는 서버가 검증한 관리자에게만 허용한다. |
| [DEC-038](governance/decisions.md#dec-038) | Access & Household·Notifications | 전체 관리자만 일반 가구원을 복구 가능하게 제거하며 업무 이력은 보존하고, UID claim 해제와 알림 수신 차단을 함께 적용한다. |
| [DEC-039](governance/decisions.md#dec-039) | Access & Household | 가계부 생성자에게 owner role을 부여하지 않고 모든 활성 Membership의 일반 권한을 동일하게 유지하며 운영 권한은 전체 관리자 capability로 분리한다. |
| [DEC-040](governance/decisions.md#dec-040) | Access & Household | 모든 Context의 영구 purge 완료 뒤에만 UID Membership claim을 조건부 page 해제하고 전부 끝난 뒤 `purged`를 확정한다. |
| [DEC-041](governance/decisions.md#dec-041) | Payment Capture·Household Finance | 완전 일치하는 결제 취소는 같은 capture lineage의 원본·모든 파생 지출을 자동으로 원자 삭제하고 다른 결제 lineage는 보존한다. |
| [DEC-042](governance/decisions.md#dec-042) | Payment Capture | 가맹점 규칙은 exact 등 좁은 match type을 먼저 적용하고, 겹칠 수 있는 non-exact 규칙은 유형별 고유 우선순위로 하나를 선택한다. |
| [DEC-043](governance/decisions.md#dec-043) | Portfolio | 미지급 배당은 같은 공시의 최신 값으로 덮어쓰되 이전 값은 보관하지 않고, 지급 완료 배당은 이후 정정·취소에도 변경하지 않는다. |
| [DEC-044](governance/decisions.md#dec-044) | Household Finance | 지역화폐 잔액은 음수 전용 거부·보정·경고 없이 원 단위 정수 관찰값으로 처리한다. |
| [DEC-045](governance/decisions.md#dec-045) | 지원·플랫폼 | Android QuickEdit에는 `FLAG_SECURE`를 적용하지 않아 화면 캡처를 허용하고 기존 keyguard·외부 진입·로그 보호만 유지한다. |
| [DEC-046](governance/decisions.md#dec-046) | 지원·플랫폼 | 정상 처리·JobRun은 30일, 미해결 작업은 해결까지, AutomationExecution은 수동 영구 purge까지, release manifest는 장기 보존한다. |
| [DEC-047](governance/decisions.md#dec-047) | Payment Capture | `notification_debug_logs`는 TTL 없이 전부 보존하고 파서 진단 기능 제거 시 Writer·Rules·index·컬렉션을 함께 제거한다. |
| [DEC-048](governance/decisions.md#dec-048) | Finance·Portfolio·지원 읽기 영역 | 홈·예산·지출 통계는 조회 시 계산하고, Position history는 계속 보존하며, 자산 차트 공백은 직전 Snapshot으로 이어 표시한다. |
| [DEC-049](governance/decisions.md#dec-049) | Portfolio·지원 플랫폼 | 개별·자산 페이지·23:55 전체 시세 갱신을 제공하고 전체 종목 수는 제한하지 않되 내부 50개 page·병렬 5·10초 timeout·총 3회 시도로 외부 호출을 제한한다. |
| [DEC-050](governance/decisions.md#dec-050) | 지원 플랫폼 | 당장은 Firebase 단일 프로젝트를 유지하고 로컬 검증은 Emulator로 수행하며 배포·운영 스크립트에는 운영 project binding을 명시한다. |
| [DEC-051](governance/decisions.md#dec-051) | 지원 플랫폼 | PWA 새 버전은 안전한 재실행·사용자 갱신 때 활성화하고 금융·인증 응답은 캐시하지 않으며 공개 정적 자원만 제한적으로 보존한다. |
| [DEC-052](governance/decisions.md#dec-052) | Portfolio·지원 플랫폼 | 자산 자동화는 매일 00:00 due 계획만 조회하고 누락 월을 성공할 때까지 멱등 복구하며 과거 실행을 재계산하지 않는다. |
| [DEC-053](governance/decisions.md#dec-053) | Portfolio | 외화 자산은 최신 사용 가능 원 통화 시세와 환율을 관측 시각 차이 제한 없이 조합하고 두 관측 근거를 보존한다. |
| [DEC-054](governance/decisions.md#dec-054) | 지원·플랫폼 | Android QuickEdit은 현재 편집을 보호하고 후속 거래를 내구성 있는 FIFO로 보존하여 저장 완료 순서대로 하나씩 표시한다. |
| [DEC-055](governance/decisions.md#dec-055) | Household Finance·지원 플랫폼 | QuickEdit 분할은 현재 미저장 form 전체를 한 원자 Command로 사용하고 동시 변경의 stale 요청은 덮어쓰지 않고 전체 거부한다. |
| [DEC-056](governance/decisions.md#dec-056) | Household Finance | 이미 합친 거래를 다시 합치면 merge 계보를 non-merge 원본까지 평탄화하고 중간 merge는 감사 이력으로만 보존한다. |
| [DEC-057](governance/decisions.md#dec-057) | Household Finance·지원 플랫폼 | 지역화폐 상세는 홈에서 선택한 한 유형만 표시하고 상세 내부의 전체·다른 유형 전환 UI와 legacy 임의 귀속을 두지 않는다. |
| [DEC-058](governance/decisions.md#dec-058) | Portfolio·지원 플랫폼 | 과거 자산 통계 필터는 현재 자산이 아니라 선택 기간 Snapshot의 유형·명의자 차원으로 구성한다. |
| [DEC-059](governance/decisions.md#dec-059) | Payment Capture | 등록 카드의 카드사·소유자는 immutable identity로 두고 사용자 별칭 없이 표준 카드사 라벨·끝 번호로 표시하며, 끝 번호만 수정하고 삭제는 과거 증거를 보존하는 퇴역 처리로 수행한다. |
| [DEC-060](governance/decisions.md#dec-060) | Portfolio·지원 플랫폼 | 환율은 Frankfurter v2 단일 공급자를 사용하고 마지막 성공값을 기간 제한 없이 평가에 계속 사용하며 네이버·보조 공급자 fallback을 두지 않는다. |
| [DEC-061](governance/decisions.md#dec-061) | 지원 플랫폼 | 모든 활성 가구원이 홈의 서로 다른 두 요약 카드 유형을 가구 공통 설정으로 변경하며 기존 중복 구성은 읽기만 호환한다. |
| [DEC-062](governance/decisions.md#dec-062) | Portfolio·지원 플랫폼 | 배당 공시 discovery와 lifecycle sweep을 매일 09:00~20:00 매시 정각 실행해 늦은 공시를 다음 시간에 반영한다. |
| [DEC-063](governance/decisions.md#dec-063) | Household Finance | 정기 거래 Plan의 최초 등록자를 immutable creator로 보존하고 Scheduler 거래에 사용하며 creator 없는 legacy Plan은 명시 mapping 전 처리하지 않는다. |
| [DEC-064](governance/decisions.md#dec-064) | 지원·플랫폼 | 필수 release gate 실패는 waiver나 긴급 권한으로 우회하지 않고, 전체 gate를 통과한 후보에만 deploy authorization을 발급한다. |
| [DEC-065](governance/decisions.md#dec-065) | Household Finance | 일반 거래 삭제는 복구 가능한 논리 삭제로 처리하고 사용자 복구 UI 없이 운영자/Agent의 명시 작업으로만 복구·영구 정리한다. |
| [DEC-066](governance/decisions.md#dec-066) | Payment Capture | Android는 raw 알림을 암호화 journal에 선기록한 뒤 전달하고 Functions parser를 단일 정본으로 사용하며, created snapshot을 QuickEdit FIFO에 내구화한 뒤 journal을 ack한다. |
| [DEC-067](governance/decisions.md#dec-067) | 지원·플랫폼 | QuickEdit은 일반 Ledger Command의 Android Adapter이며, Keystore 암호화 outbox commit과 WorkManager 영속 예약 뒤 화면에서 분리하고 고정 멱등 key로 비동기 전달한다. |
| [DEC-068](governance/decisions.md#dec-068) | 공통 시스템·Payment Capture·지원 플랫폼 | 현재 두 가구와 향후 소수 가구의 대화형 경로는 첫 paint·결제·QuickEdit 저지연을 우선하고 대규모 분산 장치를 배제하되 Auth·App Check·가구 격리·중복 방지·72시간 실패 복구를 유지한다. |

코드 감사에서 발견한 Human in the loop 정책은 DEC-064까지 모두 처리했습니다. 중복 질문이던 Q-002는 DEC-011에 통합했고, Q-003은 일반 사용자 복구 금지와 운영 복구일 기준 자동화 재개로 DEC-017·DEC-052에 반영했으며, Q-004는 Shortcut credential 원문 최초 응답 1회와 `AlreadyIssued` 재전송으로 DEC-033에 반영했습니다. Q-005는 별도 카드 통계가 아닌 Ledger 검색 계약으로 정리했고, Q-006은 release gate 우회 금지로 DEC-064에 확정했습니다. [미결정 사항 단일 목록](governance/pending-decisions.md)의 현재 항목은 0개입니다.

## 7. 추적성 검증 기준

현재 매핑 기준:

- 기능 모듈: 19개
- 업무 Context 소속 기능 모듈: 13개
- 지원·플랫폼 기능 모듈: 6개
- 전체 요구사항 ID: 232개
- 업무 Context 요구사항: 170개
- 지원·플랫폼 요구사항: 53개
- 공통 SYS 요구사항: 9개
- Canonical 테스트 ID: 211개
- 중앙 Human in the loop 미결정 질문: 0개 (`결정 대기` 요구사항 0개)
- 요구사항·테스트 ID 누락과 중복 소유: 0개

요구사항 상태 합계:

- 현재 명세 86개
- 현재 명세·결함 1개
- 현재 명세·목표 보완 1개
- 현재·목표 3개
- 목표 명세 78개
- 특성화 4개
- 특성화·목표 교정 1개
- 호환 3개
- 호환·목표 2개
- 호환·목표 명세 1개
- 결함 51개

모든 231개 요구사항은 210개 Canonical 테스트 ID와 실제 계약 assertion 본문에 연결되어 있습니다. 현재 검증 기준과 실행 방법은 [테스트 전략](governance/test-strategy.md)과 [Functions 테스트 안내](../../functions/test/README.md)를 사용합니다.

요구사항을 추가·이동할 때 [요구사항 문서 규약](governance/conventions.md)의 Context 배치와 단일 소유 검사를 다시 수행한다.

## 8. 리팩토링 사용 순서

1. 변경 대상의 [업무 Context](#2-5개-업무-bounded-context) 또는 [지원 영역](#3-지원읽기플랫폼-영역)을 연다.
2. Context의 공통 언어, Aggregate, 공개 계약, 일관성 경계를 확인한다.
3. 연결된 기능 모듈 문서에서 상세 요구사항과 Pending DEC를 확인한다.
4. 기능 모듈의 테스트 시나리오로 현재 동작을 고정한다.
5. [데이터 소유권](cross-cutting/data-ownership.md)에서 Writer와 Context 간 통신 방식을 확인한다.
6. [보안과 개인정보](cross-cutting/security-privacy.md)의 tenant·기기·민감 데이터 경계를 확인한다.
7. [테스트 전략](governance/test-strategy.md)의 시작 조건을 만족한 뒤 Application·Domain 경계를 이동한다.
