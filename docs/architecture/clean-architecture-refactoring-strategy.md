# Household Account Clean Architecture 리팩토링 전략

> 상태: Proposed  
> 기준일: 2026-07-13  
> 범위: web, functions, android, Firestore, 공통 계약  
> 핵심 목표: 기능 독립성, 변경 영향 최소화, 업무 규칙의 단일 소유권, 외부 사용자에게 안전하게 공유할 수 있는 다중 가구 구조
> 목표 구조의 권위 문서: [목표 Clean Architecture 설계](target-clean-architecture.md)  
> Context 요구사항 지도: [5개 업무 Bounded Context](../requirements/README.md#2-5개-업무-bounded-context)  
> 문서 역할: 이 문서는 점진적 전환·PR·롤백 전략을 소유하며, 모듈 경계·데이터 소유권·일관성 설계가 충돌하면 목표 설계를 따른다.

## 1. 결론

이 프로젝트에 필요한 것은 전면 재작성이나 마이크로서비스 전환이 아니다. 목표 아키텍처는 다음 네 가지 결정을 조합한 **모듈러 모놀리스 기반 Clean Architecture**이다.

1. 기능을 bounded context 단위의 독립 모듈로 나눈다.
2. 각 모듈 내부는 Presentation → Application → Domain 의존성 방향을 지킨다.
3. 데이터를 변경하는 업무 규칙은 백엔드 Application 계층을 유일한 실행 지점으로 삼는다.
4. 기존 기능은 Facade와 Adapter 뒤에 남겨 두고 한 기능씩 교체하는 Strangler 방식으로 전환한다.

핵심은 폴더 이름을 domain, application으로 바꾸는 것이 아니다. 다음 상태가 실제로 강제되어야 한다.

- 화면, Firebase Handler, Android Service에는 업무 규칙이 없다.
- Domain은 React, Next.js, Firebase, Android SDK, HTTP를 모른다.
- 한 기능의 Infrastructure를 다른 기능이 직접 import하지 않는다.
- 하나의 Canonical Firestore 컬렉션에는 하나의 소유 모듈만 존재한다. append-only Outbox는 Event type별 단일 producer를 강제하는 명시적 플랫폼 예외다.
- 웹, Android, Functions가 동일한 변경 규칙을 각각 구현하지 않는다.
- 다른 모듈과 통신할 때는 공개 Application API, 버전이 있는 계약, Integration Event만 사용한다.

## 2. 아키텍처 드라이버

### 2.1 기능 독립성

예를 들어 월 분할 정책을 수정할 때 다음만 변경되어야 한다.

- Ledger Domain의 분할 정책
- Ledger Application의 `Split` 유스케이스
- 관련 Domain/Application 테스트

웹 화면, Android Quick Edit, Firestore 구현, 알림 전송 코드는 변경되지 않아야 한다.

### 2.2 업무 규칙의 SSOT

현재는 지출 생성·분할·중복 판정·카드 매칭·카테고리 결정이 웹, Android, Functions에 흩어져 있다. 공통 유틸 파일을 만드는 것만으로는 언어와 런타임이 다른 중복을 제거할 수 없다.

목표 상태에서는 다음 원칙을 사용한다.

- 최종 데이터 변경 규칙은 Functions의 Domain/Application에서만 실행한다.
- 웹과 Android는 의도를 Command로 전달한다.
- 클라이언트에서 즉시 필요한 미리보기는 동일한 서버 유스케이스의 Preview Query를 호출한다.
- Android는 OS 알림 접근과 등록 package 원문 전달만 담당하고, Functions의 단일 TypeScript parser가 `AndroidRawNotification.v1`을 내부 `CaptureEnvelope.v1`으로 변환한다. Shortcut도 Functions의 별도 parser를 거쳐 같은 내부 Intake 계약을 사용하며 Android server parser만 선택적 balance branch를 만들 수 있다.
- 저장, 중복 판정, Actor 본인 범위의 등록 카드 확인, 카테고리 결정은 서버가 다시 검증한다. 타 멤버의 카드 등록 상태는 자동 결제 입력 eligibility에 참여시키지 않는다.

### 2.3 외부 공유와 다중 가구

신규 진입은 Google 로그인만 허용하고 기존 가구 키는 첫 계정 연결을 위한 한시적 migration 단서로만 사용한다. 외부 공유를 전제로 다음 개념을 1급 도메인으로 만든다.

- UserId: Firebase Auth 사용자 ID
- HouseholdId: 가구의 안정적인 식별자
- Membership: 사용자와 가구의 관계
- Role: owner, admin, member, viewer
- Invitation: 5분 만료·일회 사용이며 가입자가 자기 Member를 생성하는 초대
- LegacyMembershipClaim: localStorage의 기존 householdId·memberId를 최초 Google UID에 연결하는 전환
- ActorContext: 현재 사용자, 가구, 역할을 묶은 명시적 실행 문맥

모든 Command와 Query는 ActorContext를 통해 권한을 검증한다. 사용자는 자기 Member만 생성·변경하고 다른 Member를 미리 만들거나 선택하지 않는다. 멤버 이름은 표시값일 뿐 외래키나 문서 ID로 사용하지 않는다.

### 2.4 동작 보존과 점진적 전환

구조 변경과 기능 수정은 같은 PR에서 섞지 않는다.

- 먼저 Characterization Test로 현재 동작을 고정한다.
- 알려진 결함은 별도 Decision과 테스트로 목표 동작을 합의한다.
- 기존 API를 Facade로 유지하면서 내부 구현만 새 유스케이스로 교체한다.
- 데이터 스키마 변경은 애플리케이션 경계 정리 뒤 별도 단계로 진행한다.

## 3. 현재 구조의 핵심 문제

### 3.1 기능이 아니라 기술 종류로 나뉜 수평 구조

웹 소스는 app, components, contexts, hooks, lib, types로 나뉘어 있다. 특정 기능을 변경하려면 여러 폴더를 가로질러 찾아야 하고 소유권을 판단하기 어렵다.

대표 사례:

- [LedgerPage.tsx](../../web/src/components/home/LedgerPage.tsx)는 화면 상태, 구독, 정기지출 실행, 지출 Command, 카테고리 규칙 생성을 함께 담당한다.
- [assetService.ts](../../web/src/lib/assetService.ts)는 자산 CRUD, 이력, 순서, 자동 납입, 대출 상환, 주식·코인 보유, 시세, 금, 배당, 샘플 데이터를 함께 담당한다.
- [CardSettings.tsx](../../web/src/components/settings/CardSettings.tsx)는 화면, 폼, 검증, 정렬, Firestore Command를 함께 담당한다.

### 3.2 Framework가 Domain까지 침투

- [asset.ts](../../web/src/types/asset.ts)와 [registeredCard.ts](../../web/src/types/registeredCard.ts)가 Firebase Timestamp를 직접 사용한다.
- Android의 [Expense.kt](../../android/app/src/main/java/com/household/account/data/Expense.kt)는 아직 화면 경계 DTO로 남아 있지만, Firebase 타입을 포함하던 레거시 `MerchantRule.kt`는 제거했다. 가맹점 규칙의 정본 모델은 이제 [MerchantRuleSet](../../functions/src/contexts/payment-capture/configuration/domain/model/merchantRuleSet.ts)에 있다.
- Functions의 업무 계산은 Firebase DocumentData를 직접 받는다.

이 상태에서는 저장소 교체뿐 아니라 단위 테스트도 Firebase 표현에 종속된다.

### 3.3 동일 업무 규칙의 다중 구현

| 규칙 | 현재 구현 위치 |
|---|---|
| 월 분할 | LedgerPage, monthlySplitActions, expenseService, Android ExpenseRepository/QuickEdit |
| 지출 중복 판정 | Android ExpenseRepository, Functions expenses |
| 카드 토큰 정규화·매칭 | Web expenseService, Android CardLabelFormatter/Repositories, Functions expenses |
| 가맹점 카테고리 매핑 | Web merchantRuleService, Android MerchantRuleRepository |
| 주식 시세 조회 | Next API route, Functions assets |
| 자산 순서 변경 | assetService의 updateAssetOrders와 updateAssetOrder |
| 자산 삭제 | assetService의 deleteAsset과 deleteAssetWithHoldings |
| 배당 스냅샷 저장 | assetService와 Next dividend/save API가 같은 문서를 서로 다른 형태로 저장 |
| 금 수량 해석 | assetService, useGoldHolding, AssetEditModal |
| 날짜·월말 보정 | Web 유틸·화면과 Android 파서별 구현 |
| 월 이동·지출 구독 | hooks와 LedgerPage |
| 멤버 이름 기반 소유권 | Web, Android, Functions 전반 |

중복은 코드 모양이 같은 것보다 **결정 권한이 여러 곳에 있는 것**이 더 위험하다.

웹에는 테스트가 있는 useExpenses와 useMonthNavigation이 존재하지만 실제 LedgerPage는 같은 상태와 구독을 다시 구현한다. 배당금도 [assetService.ts](../../web/src/lib/assetService.ts)와 [dividend/save route](../../web/src/app/api/dividend/save/route.ts)가 같은 dividend_snapshots 문서의 Writer 역할을 공유한다.

전환 전 Android의 [CardNotificationListenerService.kt](../../android/app/src/main/java/com/household/account/service/CardNotificationListenerService.kt)는 알림 추출부터 Parser 선택·저장·QuickEdit까지 담당했습니다. DEC-066 전환 뒤에는 등록 package/admission, raw DTO 생성과 암호화 Queue만 수행하고 공급자 정규식은 [Functions Android parser Application](../../functions/src/contexts/payment-capture/android-payment-ingestion/application/androidProviderParserApplication.ts)으로 이동했습니다. Kotlin parser 복사본은 제거하고 [Android 공급자 Parser Golden 계약](../../functions/test/contexts/payment-capture/android-payment-ingestion/android-provider-parser-golden.contract.test.ts)이 서버 parser의 시간·연도·승인·취소 동작을 고정합니다.

### 3.4 두 개의 백엔드와 직접 DB 접근

현재 업무 처리는 다음 세 경로에서 실행된다.

- 웹 브라우저 → Firestore 직접 CRUD
- Next.js API Route → 외부 API 및 Firestore
- Cloud Functions → Firestore, FCM, 스케줄 작업
- Android → Firestore 직접 CRUD

업무 규칙, 인증, 입력 검증, 재시도, 멱등성의 적용 위치가 일관되지 않다. 목표 구조에서는 Functions를 Command의 단일 백엔드로 정하고 Next API Route는 전환 기간의 얇은 Proxy 또는 제거 대상으로 둔다.

### 3.5 암묵적인 실행 문맥

웹 서비스가 localStorage에서 householdId와 memberName을 직접 읽고, Android Repository가 SharedPreferences를 직접 읽는다. 따라서 함수 시그니처만 보고 어느 가구의 데이터를 변경하는지 알 수 없다.

목표 상태에서는 다음 값을 유스케이스 입력 또는 인증 문맥으로 명시한다.

- ActorId
- HouseholdId
- MemberId
- CommandId 또는 IdempotencyKey
- Clock과 IdGenerator

### 3.6 데이터 소유권 부재

household 멤버 이름 변경 함수가 assets와 fcmTokens를 함께 수정한다. 이는 Access 모듈이 Portfolio와 Notifications의 저장 구조를 알고 있다는 뜻이다. 이름이 외래키로 사용되기 때문에 변경 전파가 발생한다.

목표 상태에서는 안정적인 MemberId를 저장하고, 표시 이름 변경은 Access 데이터 하나만 수정한다. 다른 모듈은 필요할 때 공개 Query 또는 Read Model에서 이름을 가져온다.

### 3.7 개인 환경 하드코딩

다음 값이 소스에 직접 들어 있다.

- 가족 구성원 이름
- 관리자 이메일
- Firebase 프로젝트 설정
- 배포 URL
- iOS 단축어 API 토큰

외부 공유형 제품에서는 AppConfig, Environment, Tenant Configuration과 Secret을 분리하고 배포 시 주입해야 한다.

## 4. 목표 아키텍처 원칙

### 4.1 모듈 내부 의존성

    Presentation ───────▶ Application ───────▶ Domain
                              ▲                  ▲
                              │                  │
    Infrastructure ───────────┘──────────────────┘

    Bootstrap/Composition Root
      └─ Presentation, Application, Infrastructure를 생성하고 연결

의미:

- Domain은 외부 계층을 import하지 않는다.
- Application은 Domain과 자신이 선언한 Port만 안다.
- Infrastructure는 Port를 구현한다.
- Presentation은 Use Case 또는 Client Application Service만 호출한다.
- Bootstrap만 구체 구현을 조립한다.

### 4.2 허용 의존성 표

| 출발 계층 | 허용 | 금지 |
|---|---|---|
| Domain | 같은 모듈 Domain, 최소 Shared Kernel | Firebase, React, Android, HTTP, 다른 모듈 Infrastructure |
| Application | 같은 모듈 Domain, Application Port, 공개 계약 | UI, Firebase SDK, 구체 Repository |
| Infrastructure | 같은 모듈 Domain/Application, 외부 SDK | 다른 모듈 내부 구현 |
| Presentation | 같은 기능 Application API, 공용 UI | Firebase 직접 접근, 업무 계산 |
| Bootstrap | 모든 계층의 생성·연결 | 업무 규칙 |

### 4.3 모듈 간 의존성

모듈 간 통신은 세 종류만 허용한다.

1. 공개 Query API  
   즉시 결과가 반드시 필요한 조회에 사용한다.
2. 공개 Command API  
   다른 모듈이 소유한 상태를 변경할 때 사용한다.
3. Versioned Integration Event  
   알림, Projection, 후속 계산처럼 비동기 부수 효과에 사용한다.

금지:

- 다른 모듈 Repository 직접 호출
- 다른 모듈 Firestore 컬렉션 직접 접근
- 다른 모듈 Infrastructure 또는 Presentation deep import
- 다른 모듈 Entity를 그대로 저장

### 4.4 Shared의 기준

shared 또는 common은 쓰레기통이 되기 쉽다. 다음만 허용한다.

- EntityId, Money, LocalDate, Result처럼 도메인 중립적인 작은 타입
- Clock, IdGenerator, UnitOfWork 같은 범용 Port
- 디자인 시스템의 순수 UI
- 로깅, 설정, Firebase 초기화 같은 기술 Adapter

Category, Expense, Asset, Card 같은 업무 개념은 shared에 두지 않는다.

### 4.5 추상화 기준

모든 클래스에 Interface를 만들지 않는다. 다음 경계에서만 Port를 만든다.

- 데이터 저장소
- 외부 시세·메시징·인증 시스템
- 시간·ID·트랜잭션
- 다른 bounded context의 공개 기능
- 실제로 교체하거나 Fake로 테스트해야 하는 경계

순수 계산과 한 모듈 내부 구현은 구체 타입으로 유지한다.

## 5. Bounded Context와 소유권

### 5.1 Context Map

정확한 Context 의존 그래프와 런타임 Event 흐름은 [목표 설계의 Context Map](target-clean-architecture.md#51-context-map)이 단일 원본이다. 전략에서는 다음 전환 규칙만 사용한다.

- 동기 의존 화살표는 소비자에서 공개 Port 제공자로 향한다.
- 비동기 흐름은 producer에서 Outbox·consumer Inbox로 향한다.
- Access의 ActorContext·Membership은 모든 가구 범위 Command가 소비한다.
- Payment Capture는 Finance의 공개 거래·잔액 Command를 호출한다.
- Finance·Portfolio의 확정 Event는 Notifications와 Read Side가 소비한다.
- Scheduler는 업무 Input Port를 호출하는 Adapter이며 Market Data·업무 Repository를 직접 조정하지 않는다.

Integration Event는 모듈 간 결합을 줄이기 위한 용도이며 Event Sourcing을 도입한다는 의미가 아니다.

### 5.2 모듈 정의

기능 모듈 19개의 요구사항 문서는 추적성과 변경 소유 단위로 유지하되 19개 Bounded Context로 만들지 않는다. 최신 경계와 전체 매핑은 [목표 설계의 Bounded Context와 기능 모듈](target-clean-architecture.md#5-bounded-context와-기능-모듈)을 따른다.

| 경계 | 내부 기능 모듈 | 주요 소유 데이터 |
|---|---|---|
| Access & Household | 가구와 접근 | households, members, memberships, invitations |
| Household Finance | 거래 원장, 카테고리·예산, 정기 거래, 지역화폐 | transactions, categories, recurring plans, balances |
| Payment Capture | 결제 설정, 채널 중립 Intake, Functions Android·Shortcut parser | registered cards, merchant rules, parser 계약 |
| Portfolio | Portfolio Core, Holdings, Automation, Dividends | assets, positions, automation plans, snapshots, dividend data |
| Notifications | endpoint registry, 대상 정책, delivery | notification endpoints, delivery state |
| 지원·읽기·플랫폼 | Market Data Provider Adapter, Reporting, Preferences, Operations, Android Host, PWA | 조회 시 계산 View, 승인된 재구축 Projection과 플랫폼 상태 |

budgetTransfers와 asset_snapshots처럼 코드에서 소유자가 확인되지 않는 컬렉션은 즉시 새 모듈에 배정하지 않는다. 실제 데이터와 사용처를 감사한 뒤 제거 또는 명시적 소유권을 부여한다.

### 5.3 데이터 소유권 규칙

- Access만 Household, Member, Membership lifecycle과 서버 capability를 변경한다. household owner role은 두지 않는다.
- Ledger만 Transaction을 생성·수정·삭제한다.
- Category/Budget만 Category를 변경하고 월 예산 Query 계산 규칙을 소유한다. Budget 계산 결과는 영속 저장하지 않는다.
- Recurring만 RecurringPlan과 월 처리 checkpoint를 변경한다.
- Payment Configuration만 Registered Card와 Merchant Rule을 변경한다.
- Local Currency만 Balance를 변경한다.
- Portfolio Core만 Asset과 Asset Snapshot을 최종 반영한다.
- Holdings, Automation, Dividends는 각각 Position, 자동화 계획, Dividend Event를 소유하고 Asset 변경은 Portfolio 공개 Command로 요청한다.
- Notifications만 Endpoint와 Delivery를 변경한다.
- 다른 모듈은 공개 API 또는 영속 Outbox Event로 요청한다.

## 6. Command와 Query의 목표 흐름

### 6.1 Command 흐름

    Web / Android
        │  인증 토큰 + Versioned Command + IdempotencyKey
        ▼
    HTTP/Callable Adapter
        │  스키마 검증, ActorContext 생성
        ▼
    Application Use Case
        │  권한 확인, Domain 실행, UnitOfWork
        ▼
    Domain
        │  Entity / Value Object / Policy
        ▼
    Repository Port
        │
        ▼
    Firestore Adapter + Outbox

웹과 Android는 Firestore 문서를 직접 변경하지 않는다. Scheduled Function과 Firestore Trigger도 Handler 안에서 로직을 구현하지 않고 동일한 Application Use Case를 호출한다.

### 6.2 Query 흐름

실시간 UX를 유지하기 위해 CQRS-lite를 사용한다.

- Command는 인증된 서버 유스케이스만 실행한다.
- 일반 Canonical 목록은 가구 단위 Read Contract로 구독할 수 있고, 홈·예산·지출 통계 요약은 요청 시 소유 모듈 Query에서 계산한다.
- Read Model 규칙은 Firebase Auth Membership으로 격리한다.
- 민감하거나 비용이 큰 Query는 서버 Query API를 사용한다.
- Read Model은 Domain Entity가 아니라 화면에 필요한 Query DTO이며, 모든 DTO를 영속 Projection으로 저장하지 않는다.

### 6.3 이벤트 처리

모듈을 넘는 모든 비동기 효과는 Domain 변경과 함께 Transactional Outbox에 기록한다. 같은 Functions 프로세스의 메모리 Event Handler만으로 전달을 보장하지 않는다. 같은 요청의 성공을 결정하는 동기 조정만 공개 Application Port를 직접 호출한다.

공통 Outbox 물리 저장소는 [목표 설계의 append-only 예외](target-clean-architecture.md#73-모든-모듈-간-비동기-효과는-durable-outbox-사용)를 따른다. 기능 모듈은 `OutboxAppendPort`만 사용하고 Event type별 producer는 하나만 둔다.

예:

- TransactionRecorded.v1 → TransactionNotificationHandler
- MemberRenamed.v1 → 표시용 Read Model 갱신

Budget·Home·지출 Reporting은 DEC-048에 따라 Event Handler로 View를 갱신하지 않고, 요청 시 Ledger·Category·Local Currency의 공개 Query를 조합한다.

지역화폐 카드 상세는 DEC-057에 따라 Home이 선택 type 하나를 navigation input으로 전달하고 Ledger의 단일 type Query가 거래를 조회한다. 상세 내부 전체·유형 전환 UI, legacy 거래의 임의 type 보정, 서로 다른 type의 merge는 추가하지 않는다.

과거 자산 통계 필터는 DEC-058에 따라 Portfolio의 기간 Snapshot·baseline dimension catalog에서 만들고, 현재 Asset·active 명의자 Query와 분리한다. Reporting만 기간 변경 시 선택 dimension 유효성을 판정하며 Portfolio Snapshot과 Access 프로필을 수정하지 않는다.

등록 카드 변경은 DEC-059에 따라 Payment Configuration의 `RegisteredCardIdentityPolicy`와 lifecycle 경계 안에서만 수행한다. 카드사·소유자는 immutable이고, 끝 번호 변경은 active uniqueness claim과 카드 version을 한 UoW에서 교체하며, 삭제는 `retired` 전환으로 과거 capture 증거를 보존한다.

환율은 DEC-060에 따라 Holdings가 소유한 `ExchangeRatePort`의 Frankfurter v2 Adapter 하나만 사용한다. Operations는 retry·Health·이메일 경보만 제공하고 공급자 선택이나 fallback을 구현하지 않으며, Holdings는 rateDate가 후퇴하지 않는 마지막 성공 관측을 기간 제한 없이 평가에 사용한다.

홈 카드 구성은 DEC-061에 따라 Preferences의 versioned Aggregate와 `HomeCardSelectionPolicy`가 소유한다. Web 설정 UI는 공개 Command만 호출하고 모든 활성 가구원에게 같은 capability를 부여하며, 서로 다른 두 유형·기존 중복 read 호환·지역화폐 선택 필드 독립을 서버 정책과 테스트로 강제한다.

FCM 전송 실패가 Ledger Transaction을 롤백시키지 않도록 비동기 경계로 분리한다.

## 7. 목표 저장소 구조

최상위 web, functions, android 디렉터리는 배포 단위이므로 초기에는 유지한다. apps 디렉터리로 전부 이동하는 작업은 구조적 이득보다 Diff와 배포 위험이 크므로 우선순위가 아니다.

### 7.1 공통 계약

    contracts/
      schemas/
        commands/
        events/
        read-models/
      openapi/
        household-account-v1.yaml
      fixtures/
        payment-notifications/
      generated/
        typescript/
        kotlin/

원칙:

- JSON Schema 또는 OpenAPI가 Wire Contract의 원본이다.
- TypeScript와 Kotlin DTO는 생성한다.
- 생성된 DTO에 업무 메서드를 넣지 않는다.
- Domain Entity를 네트워크 DTO로 직접 노출하지 않는다.
- Contract는 v1, v2처럼 호환성을 관리한다.
- 실제 알림 fixture는 개인정보를 제거하고 파서 회귀 테스트에서 공동 사용한다.

### 7.2 Functions 전환 지도

최종 디렉터리 구조의 단일 원본은 [목표 설계의 소스 구조](target-clean-architecture.md#14-목표-소스-구조)다. 이 절은 현재 파일이 어느 Context·기능으로 이동하는지만 기록하며 별도의 목표 구조를 정의하지 않는다.

    functions/src/
      bootstrap/
        handlers/
          callable/
          http/
          scheduler/
          outbox/
        compositionRoot.ts
      contexts/
        access/
        household-finance/
          ledger/
          category-budget/
          recurring/
          local-currency/
          workflows/
        payment-capture/
          configuration/
          intake/
          shortcut-adapter/
        portfolio/
          core/
          holdings/
          automation/
          dividends/
          workflows/
        notifications/
      read-side/
        reporting/
        home-preferences/
      platform/
        firebase/
        outbox/
        inbox/
        market-data/
        operations/
        observability/
        config/
      shared/
        kernel/
        application/

Handler의 역할은 다음 네 가지로 제한한다.

1. Transport 입력을 Contract DTO로 검증
2. Firebase Auth를 ActorContext로 변환
3. Use Case 호출
4. Transport 응답으로 변환

현재 파일의 목표 이동:

| 현재 | 목표 |
|---|---|
| functions/src/expenses.ts | Payment Capture Shortcut Adapter/parser, Payment Intake, Ledger 공개 Command로 분리 |
| functions/src/assets.ts | Portfolio `RunDailyAssetValuation`/Context Workflow, Market Data Adapter, 얇은 Scheduler Handler로 분리 |
| functions/src/dividends.ts | Portfolio Dividends와 KIND disclosure Adapter, 얇은 Scheduler Handler로 분리 |
| functions/src/notifications.ts | Notifications Inbox Handler·Delivery와 FCM Adapter로 분리 |
| functions/src/households.ts | Access `RenameMember`, 논리 삭제·복구 Command, 수동 `HouseholdPurgeProcess`로 분리 |
| functions/src/config.ts | `platform/config`와 Secret Provider로 이동 |

### 7.3 Web 전환 지도

Web도 [목표 소스 구조](target-clean-architecture.md#14-목표-소스-구조)의 feature 목록을 따른다. 아래 표는 현재 책임을 찾아가기 위한 migration mapping이며 새로운 업무 소유권을 만들지 않는다.

    web/src/
      app/
        page.tsx
        income/page.tsx
        assets/page.tsx
        api/
      composition/
        createClientModules.ts
      features/
        access/
          application/
          infrastructure/
            firebase-auth/
            api/
          presentation/
          public.ts
        ledger/
          application/
            LedgerGateway.ts
          infrastructure/
            api/
            firestore-read-model/
          presentation/
            pages/
            components/
            hooks/
          public.ts
        category-budget/
        recurring/
        payment-configuration/
        local-currency/
        portfolio/
        notifications/
        home-preferences/
      shared/
        ui/
        platform/
        config/
        observability/

원칙:

- app/page.tsx는 Route Adapter이며 feature의 공개 Page만 렌더링한다.
- Presentation은 Firebase SDK를 import하지 않는다.
- Client Application은 화면 흐름과 비동기 상태만 조정한다.
- 최종 금액, 중복, 권한, 카테고리 결정 같은 업무 규칙은 클라이언트에서 확정하지 않는다.
- Firestore 직접 구독이 필요하면 infrastructure/firestore-read-model에만 둔다.
- 다른 feature는 public.ts를 통해서만 사용한다.
- 공용 UI는 AmountInput처럼 도메인 의미가 없는 컴포넌트만 포함한다.

현재 파일의 목표 이동:

| 현재 | 목표 |
|---|---|
| components/home/LedgerPage.tsx | features/ledger/presentation/pages + controller hooks |
| lib/expenseService.ts | ledger client gateway, read-model adapter, legacy facade로 분해 |
| lib/assetService.ts | portfolio의 asset/holding/valuation/history/dividend gateway로 분해 |
| contexts/HouseholdContext.tsx | access presentation session provider |
| contexts/CategoryContext.tsx | category-budget read-model provider 또는 feature hook |
| components/settings/* | 각 소유 feature의 presentation/settings |
| app/api/stock, crypto, gold, dividend | Functions provider adapter로 이동 후 Proxy 제거 |

### 7.4 Android 전환 지도

최종 Gradle 모듈:

    android/
      app/
      core/
        contracts/
        network/
        auth-session/
        storage/
        testing/
      feature/
        web-shell/
        payment-capture-delivery/
        quick-edit/
        push-notifications/

각 feature 내부:

    feature/payment-capture-delivery/
      application/
        contracts/AndroidRawNotificationV1.kt
        AdmitRawNotificationUseCase.kt
        QueueRawNotificationUseCase.kt
        SubmitRawNotificationUseCase.kt
      ports/
        PaymentCaptureGateway.kt
        PaymentQueue.kt
        DiagnosticSink.kt
      adapters/
        notification/
          CardNotificationListenerService.kt
        api/
        local-queue/
        workmanager/
        diagnostics/

원칙:

- NotificationListenerService는 Android 알림을 Application 입력으로 변환만 한다.
- 공급자 Parser는 Functions의 Framework 독립 순수 코드이며 Android에는 복사하지 않는다.
- Session은 HouseholdId, MemberId, 인증 상태만 소유하고 SharedPreferences/DataStore는 Adapter로 둔다.
- 네트워크 실패 시 Command를 DEC-032의 Keystore 키 기반 AES-256-GCM 로컬 Queue에 저장하고 동일 idempotency key로 최대 72시간 WorkManager 재시도한다.
- 모든 재시도는 같은 IdempotencyKey를 사용한다.
- QuickEditActivity는 ViewModel/Controller를 통해 Ledger Command API를 호출한다.
- WebViewBridge는 가구 키를 반환하지 않고 필요한 Capability만 좁게 노출한다.
- WebView URL과 허용 Origin은 환경 설정으로 주입한다.
- Android는 Firestore 컬렉션 구조를 알지 않는다.

초기부터 Gradle 모듈을 한 번에 모두 만들지 않는다.

1. 기존 app 안에서 package와 Port 경계를 만든다.
2. Parser 순수 테스트와 Command Gateway를 분리한다.
3. 경계가 안정된 기능부터 Gradle module로 추출한다.

의존성 주입은 처음부터 대형 DI Framework를 도입하지 않는다. 생성자 주입과 작은 AppContainer로 Composition Root를 만든 뒤 모듈 경계가 안정되면 Hilt 같은 도구의 필요성을 다시 판단한다.

## 8. 공개 API 설계

정확한 공개 계약의 단일 원본은 [목표 설계의 대표 계약](target-clean-architecture.md#53-대표-공개-제공소비-계약)과 각 Bounded Context 요구사항 지도다. 이 절은 migration에서 먼저 만들 계약 묶음을 요약하며 별도의 이름이나 DTO를 정의하지 않는다.

### 8.1 Household Finance / Ledger

Commands:

- `RecordManualTransaction`
- `RecordCapturedTransaction`
- `RecordRecurringTransaction`
- `Update`, `Delete`, `Split`, `Merge`, `Unmerge`, `CancelCapturedLineage`

Queries:

- `SubscribeLedger`
- `SearchLedger`
- `FindCancellationCandidates` — 원장 사실만 반환

Events:

- TransactionRecorded.v1
- TransactionChanged.v1
- TransactionDeleted.v1

`RecurringPlan`과 `ProcessRecurringMonthWorkflow`는 Ledger가 아니라 Household Finance의 Recurring 기능과 Context Workflow가 소유한다.

### 8.2 Payment Capture

Commands:

- `SubmitCaptureEnvelopeV1`
- `RegisterCard`, `ManageCards`
- `ManageMerchantRules`

Queries:

- `ResolveCard`
- `PaymentOccurrenceYearPolicyV1` — Android·Shortcut 공통 계약과 fixture, 서울 수신 시각보다 미래가 아닌 최근 연도
- `ResolveMerchantMapping`

`CaptureEnvelope.v1`의 필수 개념:

- contractVersion
- observationId
- householdId
- 검증된 ActorContext로 연결할 가구·자격 증거
- sourcePackage
- sourceType
- 선택적 paymentObservation: approval 또는 cancellation, amount, merchantEvidence, cardEvidence, occurredLocalDate, occurredLocalTime, zoneId
- 선택적 balanceObservation: currencyType, balanceInWon, observedAt
- paymentObservation과 balanceObservation 중 하나 이상
- rawPayloadHash

raw message 원문은 목표 계약에 포함하지 않는다. 현재 원문 수집은 파서 개선 기간에만 사용하는 임시 Diagnostic Adapter로 격리하고, DEC-047에 따라 등록 source·인증 actor gate와 관리자 전용 권한을 적용한 채 기능 제거 전까지 TTL 없이 전부 보존한다. 필요한 parser fixture와 회귀 테스트가 확보되면 Adapter·Rules·index와 notification_debug_logs 전체를 함께 제거하며 목표 Domain이나 Audit 기능으로 승격하지 않는다.

### 8.3 Portfolio

Commands:

- Portfolio Core: 사용자 `CreateAsset`, `UpdateAsset`, `DeleteAsset`, `QueryPortfolio`; 운영 전용 `ListDeletedAssets`, `RestoreDeletedAsset`, `RequestPermanentAssetPurge`; 내부 `ApplyAssetValuation`
- Holdings: `ManagePosition`, `RevaluePositions`, `RefreshAccountPrices`, `RefreshHouseholdPrices`, `QueryPositions`, `RunDailyAssetValuation`, `PublishInstrumentCatalog`
- Automation: `ProcessDueAssetAutomation`, `RunContribution`, `RunRepayment`, `EvaluateAutomationMonth`
- Dividends: `RefreshDividendEvents`, `AdvanceDividendStatus`, `GetAnnualDividend`

Ports:

- 각 기능 소유 Repository Port
- Context Workflow용 Unit of Work
- 수동 영구 삭제용 `AssetPurgeProcess`와 Holdings·Automation·Core의 context-private paged participant; Dividends 이력은 Asset purge 대상에서 제외
- `MarketPriceProvider`, `ExchangeRateProvider`, `DividendDisclosureProvider`
- retry·job result·시도별 observability·ProviderHealthRecorder Output Port

Naver, Nasdaq, Upbit, KIND는 Domain이 아니라 각각 Portfolio가 정의한 Port의 Infrastructure Adapter다. Scheduler는 Portfolio Input Port를 호출하는 Inbound Adapter이며, `AssetSnapshotProjector`만 Snapshot을 쓴다.

## 9. 데이터 아키텍처

### 9.1 목표 Firestore 구조

최종 경로와 Writer의 단일 원본은 [목표 설계의 Firestore 개념 구조](target-clean-architecture.md#111-목표-firestore-개념-구조)와 [요구사항 데이터 소유권](../requirements/cross-cutting/data-ownership.md)이다. 전략 문서에는 경로를 복제하지 않는다.

전환 시 특히 다음 경계를 먼저 만든다.

- Canonical `memberships`와 사용자별 Membership Read Projection 분리
- Context별 command receipt와 Payment Capture submission receipt
- consumer별 Inbox receipt와 append-only Outbox/dispatch receipt
- Card·Merchant uniqueness claim
- Access의 수동 `HouseholdPurgeProcess` checkpoint
- Portfolio의 수동 `AssetPurgeProcess`와 participant별 checkpoint
- 범용 `projections`가 아닌 Asset·Dividend별 단일 Writer Projection; Budget·Home·지출 Reporting은 조회 시 계산
- 사용자 전역 device와 가구별 notification subscription 분리

### 9.2 공통 데이터 규칙

- 금액은 부동소수점이 아닌 최소 화폐 단위 정수로 저장한다.
- 날짜 없는 시각과 Instant를 구분한다.
- Domain에서는 Firebase Timestamp 대신 Instant/LocalDate Value Object를 사용한다.
- 모든 문서에 schemaVersion을 둔다.
- 생성·변경 Command에는 commandId와 idempotencyKey를 둔다.
- 행위자 memberName은 memberId로, 자산 ownerName은 Access의 안정적인 assetOwnerProfileId로 참조한다.
- 표시 이름은 Read Model에만 비정규화할 수 있다.
- 서버가 관리하는 createdAt, updatedAt, notification status는 클라이언트 쓰기를 금지한다.
- 공통 Outbox는 여러 producer가 불변 Event를 추가하는 명시적 플랫폼 예외이며 각 Event type의 논리 Writer는 하나다.
- 영속 Projection마다 단일 Writer, source version, checkpoint, rebuild 계약을 둔다. 조회 시 계산하는 View는 기간 조건·cursor 전체 완료·부분 결과 금지를 계약으로 둔다.

### 9.3 기존 데이터 전환

논리 구조와 물리 스키마를 동시에 변경하지 않는다.

1. 새 Domain/Application이 기존 루트 컬렉션을 사용하는 Legacy Adapter를 통해 동작하게 한다.
2. 모든 새 Command를 서버 경유로 전환한다.
3. schemaVersion과 안정 ID를 기존 문서에 추가한다.
4. V2 하위 컬렉션을 만들고 서버에서 제한된 기간 동안 dual-write한다.
5. Backfill 작업으로 기존 문서를 이관한다.
6. 문서 수, 합계, 해시, 샘플 Query를 비교하는 Reconciliation Report를 생성한다.
7. Shadow Read로 V1/V2 결과를 비교한다.
8. Read 경로를 V2로 전환한다.
9. V1 쓰기를 차단하고 dual-write를 제거한다.
10. 보존 정책에 따라 기존 컬렉션을 폐기한다.

dual-write는 영구 구조가 아니다. 종료 조건과 제거 일자를 PR에 함께 기록한다.

## 10. 중복 제거 전략

### 10.1 중복의 최종 소유자

| 중복 규칙 | 최종 소유자 | 웹/Android의 역할 |
|---|---|---|
| 월 분할 금액·날짜·원자성 | Ledger Domain/Application | Split preview 조회, `Split` Command 호출 |
| 결제 fingerprint 정책 | Payment Capture | 채널 후보와 IdempotencyKey 제공 |
| fingerprint claim·거래 원자 생성 | Ledger | Canonical 컬렉션을 직접 쓰지 않음 |
| 취소 후보 판정 | Payment Capture | Parsed cancellation 후보 전송 |
| 등록 카드 매칭 | Payment Configuration | 카드 설정 UI와 증거 전달 |
| 가맹점 mapping | Payment Configuration | 규칙 설정 UI |
| 정기 거래 계획·월 처리 | Recurring | 일정 설정 UI |
| 주식·코인·금 시세 | Market Data Adapter | 표시용 Read Model 구독 |
| 자산 합계·스냅샷 | Portfolio Core | 차트 Projection 표시 |
| 지역화폐 잔액 | Local Currency | 잔액 observation 전달·표시 |
| FCM 대상·실패 정리 | Notifications | Endpoint 등록 |
| 멤버 권한·이름 | Access | Session 표시 |

### 10.2 코드 재사용 기준

- 같은 런타임의 순수 업무 규칙은 Domain 함수나 Value Object로 통합한다.
- 런타임이 다른 업무 규칙은 서버 Command로 권한을 이동한다.
- Wire DTO 중복은 Schema 기반 코드 생성으로 제거한다.
- UI 중복은 같은 의미와 동작을 가진 경우에만 공용 컴포넌트로 승격한다.
- 단순히 모양이 비슷한 서로 다른 도메인 폼은 억지로 합치지 않는다.
- Parser 구현은 플랫폼별로 유지할 수 있지만 동일한 익명 fixture와 Contract Test를 공유한다.

### 10.3 금지할 중복 제거 방식

- 모든 기능을 거대한 commonService로 합치기
- Firebase DocumentData Mapper를 Domain에서 공유하기
- 옵션 수십 개를 가진 만능 Form/Modal 만들기
- 다른 feature 내부 파일을 deep import하기
- 한 번만 쓰이는 코드를 이름이 모호한 util로 이동하기

## 11. 단계별 마이그레이션 계획

### Phase 0. 안전성과 기준선 확보

목적: 구조 작업 중 데이터 유출이나 회귀가 확대되지 않도록 한다.

작업:

- 임시 알림 원문 수집을 Diagnostic Adapter로 격리하고 관리자 권한·마스킹·TTL 및 제거 종료 조건 적용
- 현재 브라우저 localStorage의 householdKey·currentMemberId가 언제 생성·삭제·덮어써지는지와 기존 사용자의 정상 read/write 경로를 Characterization Test로 기록
- 첫 Google 로그인 전에 legacy candidate를 포착해 둘 Client seam과 비식별 migration telemetry를 준비하되 아직 claim이나 데이터 변경은 수행하지 않음
- 현재 공개 Rules와 무인증 HTTP 경로를 전수 분류하고, 기존 사용자 연결에 전혀 쓰이지 않는 관리·진단·임의 overwrite 경로만 즉시 차단함. legacy 정상 경로는 아래 5단계 cutover 전 blanket deny하지 않음
- 하드코딩 API Token 회전 및 Secret 저장소 적용
- 현재 빌드·테스트 결과를 CI에 기록
- 실패 중인 웹 테스트를 현재 계약에 맞게 복구
- Firestore Rules/Functions Emulator 테스트 시작
- 핵심 사용자 흐름 Characterization Test 작성

종료 조건:

- legacy candidate 포착과 기존 가구·멤버 정상 흐름의 Characterization Test가 재현 가능
- 공개 접근 inventory에 각 경로의 즉시 차단 여부, 임시 호환 사유, 대체 서버 경로와 제거 조건이 기록됨
- 기존 사용자 경로와 무관한 무인증 관리·진단·임의 overwrite는 차단되고 다른 가구 접근 결함은 목표 보안 테스트로 고정됨
- 웹/Functions/Android 기본 빌드와 합의된 테스트가 Green

### Phase 1. Access/Auth와 경계·계약 기반 만들기

목적: 첫 업무 Vertical Slice보다 먼저 인증된 ActorContext·Membership 경계를 세우고, 파일을 대량 이동하기 전에 의존성 방향을 강제할 틀을 만든다.

작업:

- Architecture Decision Record 작성
- Firebase Auth Principal을 `ActorContext`로 변환하는 최소 Access Handler, Canonical Membership과 멱등 `LegacyMembershipClaim` Handler 도입
- 기존 경로와 신규 Auth/Membership 경로를 동시에 설명하는 versioned 호환 Rules와 Emulator 테스트 도입. 호환 Rule은 대상 path·허용 operation·배포 기간·사용 telemetry를 명시하고 blanket public rule을 새로 만들지 않음
- Web이 Google Auth 전환으로 localStorage를 정리하기 전에 legacy candidate를 메모리/보호된 migration state에 포착하고 Auth 뒤 claim에만 전달하는 Client Adapter 도입
- contracts 디렉터리와 v1 Command/Integration Event/Read Model 스키마 생성
- Functions Composition Root와 Handler 규칙 도입
- Context UnitOfWork, command receipt, `OutboxAppendPort`, Inbox receipt의 최소 seam과 Emulator 테스트 도입
- Web feature public.ts 경계와 path alias 도입
- Android package 경계와 Gateway Port 도입
- Import 규칙을 ESLint dependency rule과 Gradle dependency로 검사
- AppConfig, SecretProvider, Clock, IdGenerator 분리

종료 조건:

- 새 코드는 금지된 방향으로 import할 수 없음
- Handler/Page/Activity에서 새 Firebase 직접 접근이 추가되지 않음
- 인증된 ActorContext와 Membership 검증 없이는 신규 업무 Command를 실행할 수 없음
- legacy candidate를 가진 테스트 사용자가 Auth·claim 뒤 같은 householdId·memberId 연결 후보를 얻고, 실패해도 기존 local state를 조기에 지우지 않음
- 계약 생성·호환성과 Outbox/Inbox 멱등성 검사가 CI에서 실행됨

### Phase 2. Access 수명주기와 다중 가구 데이터 전환

목적: 모든 기능이 사용할 안정적인 Tenant/Actor 경계를 만든다.

작업:

- Google User, role 없는 Canonical Membership, 자기 Member, 서버 capability, 5분 Invitation의 전체 수명주기와 Access 공개 계약
- 신규 household key 로그인을 제거하고 첫 방문을 `새 가계부+자기 Member 생성` 또는 `초대 코드+자기 Member 가입`으로 전환
- 기존 브라우저 localStorage의 householdKey·currentMemberId를 첫 Google 로그인에서 같은 기존 Member Membership으로 claim
- MemberId를 모든 Command에 사용
- memberName 기반 createdBy·deviceOwner는 memberId로, 자산 owner는 household/profile typed ownerRef로 마이그레이션
- Admin 이메일 하드코딩 제거
- DEC-016의 가구 논리 삭제·복구 Command 구현과 수동 영구 Purge Process 분리

무중단 보안 cutover 순서는 다음과 같으며 PR·배포 순서를 바꾸지 않는다.

1. legacy candidate 포착 Client를 먼저 배포하고 실제 후보 포착률·오류를 확인한다.
2. Google Auth, Canonical Membership, 멱등 claim Handler와 제한된 호환 Rules를 배포한다.
3. claim 결과가 기존 householdId·memberId와 연결되고 기존 핵심 데이터를 동일하게 읽는지 reconciliation·shadow read로 검증한다. 성공 전에는 legacy candidate와 기존 session을 제거하지 않는다.
4. 검증된 사용자부터 해당 Query·Command를 인증된 서버 경로로 전환하고 전환 대상 path의 direct Firestore 사용률이 0으로 수렴하는지 관측한다. Access 이후 업무 path는 Phase 3~7의 Vertical Slice마다 같은 순서를 반복한다.
5. 각 path의 대체 서버 경로와 rollback 조건이 검증된 뒤 그 path의 public/direct read·write Rules를 deny하고 호환 Rule을 제거한다. 아직 전환하지 않은 path를 함께 차단하지 않으며 전역 차단은 모든 Vertical Slice 전환 뒤 수행한다. 어떤 차단도 candidate 포착·claim·연결 검증보다 먼저 배포하지 않는다.

Legacy seam:

- 기존 가구 키는 제한된 기간 `LegacyMembershipClaim`에만 사용하고 성공 뒤 key 로그인 상태 제거
- 기존 householdId·memberId와 업무 데이터는 이동·복사하지 않고 그대로 유지
- Legacy 이름 참조는 Adapter에서 MemberId로 변환
- claim 성공 receipt와 연결 검증이 끝나기 전에는 localStorage 후보를 삭제하지 않으며 가구 키 원문을 log·metric·reconciliation report에 남기지 않음

종료 조건:

- 이름 변경이 다른 모듈 문서 수정을 유발하지 않음
- 모든 Query와 Command가 가구 Membership을 검증
- 기존 가구 키 사용자가 첫 Google 로그인 뒤 같은 가계부 데이터를 조회하며 다른 UID의 Member 선점을 덮어쓰지 않음
- 첫 업무 Vertical Slice가 시작되기 전에 인증 Handler가 ActorContext를 생성하고 Rules Test가 같은 경계를 검증
- Access·claim 관련 서버 경로 전환과 rollback 검증 뒤 해당 public/direct Rules가 닫히며 legacy candidate가 없는 신규 사용자는 호환 경로를 사용할 수 없음. 나머지 업무 path는 각 Vertical Slice에서 같은 gate를 통과함

### Phase 3. Ledger를 첫 번째 Vertical Slice로 전환

목적: 가장 많이 사용되고 중복이 큰 기능으로 목표 패턴을 검증한다.

작업:

- Transaction, Money, SplitPlan Domain 모델
- Record/Update/Delete/Split/Merge/Cancel Use Case
- LegacyExpenseRepository Adapter
- 인증 Command Handler
- 가구 단위 Ledger Read Model
- Ledger CRUD·분할·취소가 안정된 뒤 Recurring 기능과 `ProcessRecurringMonthWorkflow`를 별도 PR로 전환
- web expenseService를 Legacy Facade로 남기고 내부를 LedgerGateway로 교체
- 월 분할 세 구현을 Ledger Split Policy와 `Split` Command로 교체
- LedgerPage에서 Command와 Query orchestration을 Controller Hook으로 이동

종료 조건:

- 브라우저와 Android가 expenses 컬렉션을 직접 쓰지 않음
- 항목 분할의 합계 보존, 월 분할의 내림·나머지 미반영 정책, 두 분할의 원자성이 Domain/Application 테스트로 보장
- 재병합은 `NestedMergePolicy`에서 non-merge leaf까지 평탄화하고 중복 leaf·순환을 전체 거부하며, Unmerge·취소가 중간 merge가 아닌 최종 원본을 사용
- 같은 plan/month 재실행에서 Recurring checkpoint와 Ledger posting이 한 번만 commit
- 기존 월 원장, 검색, 편집, 분할, 합치기 E2E가 통과

### Phase 4. Payment Ingestion과 Android 분리

목적: 알림 파싱과 지출 저장을 분리하고 Android를 얇은 Adapter로 만든다.

작업:

- 서버 Source Registry, TypeScript parser, `AndroidRawNotification.v1 → CaptureEnvelope.v1` 변환을 Functions 순수/Application 영역으로 이동
- 비식별 알림 fixture 기반 Functions 전체 Parser 회귀 테스트
- Android SessionStore Port와 기존 SharedPreferences 호환 Adapter 도입
- Android `SubmitAndroidRawNotification` Gateway와 로컬 재시도 Queue, 전환 전 `CaptureEnvelope.v1` entry 호환 router
- 서버 Payment Capture Intake와 `CaptureSubmissionReceipt`
- 멱등 키, 등록 카드 검증, 중복·취소 판정을 서버로 이동
- QuickEdit를 ViewModel + LedgerGateway 구조로 변경
- 연속 QuickEdit을 `QuickEditQueueCoordinator`와 Keystore-backed `QuickEditPendingQueuePort`의 session 범위 FIFO로 전환하고 Activity stack 직접 실행을 제거
- QuickEdit 분할은 현재 form 전체와 expectedVersion을 단일 Ledger Split Command로 보내며 선행 Update·client 순차 write를 제거
- WebView shell과 브리지 Capability 최소화

종료 조건:

- NotificationListenerService가 Firestore를 모름
- Functions parser 실패·네트워크 실패·재시도·client parser spoof 거부 테스트가 존재
- 같은 이벤트 재전송이 Transaction을 중복 생성하지 않음
- 연속 결제가 현재 QuickEdit을 덮어쓰지 않고 process 재시작 뒤에도 FIFO 순서로 복구되며 session 전환 시 교차 노출이 없음

### Phase 5. Category/Budget와 분류 정책

작업:

- Category와 월 예산 Query 계산을 Category/Budget 모듈로 이동
- MerchantRule과 RegisteredCard를 Payment Configuration 모듈로 이동
- Category Reference와 Merchant Mapping 공개 Query를 각각 도입
- Ledger 공개 월 범위 Query 기반 월 예산 계산
- CategoryContext를 feature query provider로 축소
- Android MerchantRuleRepository 직접 접근 제거

종료 조건:

- 가맹점 mapping은 Payment Configuration 한 모듈에서만 결정
- Category 삭제·비활성화가 참조 무결성 정책을 가짐

### Phase 6. Portfolio 분해

작업:

- assetService Facade 뒤에 Asset, Holding, Valuation, History, Dividend Application Service를 분리
- 주식·코인·금·환율·KIND를 Provider Adapter로 분리
- Next API와 Functions의 중복 시세 구현 제거
- Scheduled Handler가 `RunDailyAssetValuation`/`RefreshDividendEvents` Input Port만 호출
- 외화 평가를 `ForeignCurrencyValuationPolicy` 하나로 통합하고 원 Quote·환율 관측을 독립 저장해 Web·23:55 job이 같은 provenance 조합 사용
- Firebase Scheduled Function에 provider별 구조화 Cloud Logging, Firestore 최신 Health 상태와 Cloud Monitoring 경보 연결
- 자동 납입·대출 상환을 Portfolio의 Automation 기능과 `ApplyAssetAutomationWorkflow`로 이동
- 매일 00:00 due Plan 조회를 `nextDueDate` index로 구현하고 execution과 같은 UoW에서만 다음 due date 전진
- 화면 진입에 묶인 자동 납입·상환 같은 업무 변경은 제거하되, DEC-049의 자산 메인 페이지 전체 시세 갱신은 명시적 Application Workflow로 유지

종료 조건:

- assetService가 제거되거나 호환 Facade만 남음
- 외부 Provider 장애가 자산 원금을 임의 값으로 덮어쓰지 않음
- 실물 금·주식 등 Provider의 현재 연속 실패와 마지막 성공·복구 시각을 서버리스 운영 경계에서 확인하고 경보받을 수 있음
- Scheduler 재시도, Timeout, 부분 실패가 관찰 가능

### Phase 7. Notifications와 Projection 정리

작업:

- 사용자 전역 Device Endpoint와 가구별 Notification Subscription 분리
- Transaction Event 기반 전송
- 일시적 실패와 영구 FID 실패 구분
- Delivery idempotency와 재시도
- PWA와 Firebase Messaging Service Worker 통합
- 새 PWA worker를 waiting 상태로 설치하고 미저장 입력이 없는 사용자 갱신 또는 모든 화면 종료 뒤에만 활성화
- 금융·인증·API·navigation 응답 runtime cache 제거, 공개 아이콘·폰트·이미지만 최대 7일 허용
- 화면별 Read Model과 Firestore Index 최적화

종료 조건:

- FCM 실패가 Ledger Command 결과에 영향을 주지 않음
- 중복 Event가 중복 알림을 만들지 않음
- 월 조회가 가구 전체 거래를 내려받지 않음

### Phase 8. Legacy 제거

작업:

- V1 root collection과 Phase 2 뒤 남은 residual compatibility Rule 제거
- web/src/lib의 호환 Facade 제거
- 사용되지 않는 hooks, type, collection 정리
- 개인 이름, URL, 이메일, Firebase 프로젝트 하드코딩 제거
- Legacy schema mapper와 dual-write 제거
- 최종 Architecture dependency report 저장

종료 조건:

- 금지된 import와 직접 Command write가 0건
- 모든 Canonical 컬렉션에 단일 소유 모듈과 Rule 테스트가 존재하고, append-only Outbox 예외에는 Event type별 단일 producer 검사가 존재
- Legacy Adapter가 0개

## 12. PR과 롤백 전략

### 12.1 PR 단위

한 PR은 다음 중 하나만 수행한다.

- Characterization Test 추가
- Port/Facade 추가
- 하나의 Use Case 이동
- 하나의 호출 경로 전환
- 하나의 데이터 Backfill
- Legacy 경로 제거

폴더 대량 이동, 업무 규칙 수정, 스키마 변경을 같은 PR에 넣지 않는다.

### 12.2 Strangler 패턴

각 기능은 다음 순서로 교체한다.

    기존 UI
      → 기존 Service Facade
          → Legacy 구현

    새 구현 추가 후

    기존 UI
      → 동일 Service Facade
          → 새 Application Gateway
              → Server Use Case

호출부 계약을 먼저 유지하면 UI 전체를 동시에 고칠 필요가 없다.

### 12.3 Feature Flag와 Shadow 실행

고위험 경로는 다음 Flag를 사용할 수 있다.

- serverLedgerCommands
- v2LedgerReadModel
- serverPaymentIngestion
- v2PortfolioValuation

Shadow 실행은 결과 비교만 하고 두 경로에서 사용자 부수 효과를 발생시키지 않는다. 특히 FCM, 지출 생성, 자산 변경은 Shadow에서 실제 쓰기를 금지한다.

### 12.4 롤백

- 새 Command가 기존 스키마 Adapter를 사용하도록 해 스키마 변경 전 롤백을 단순화한다.
- 데이터 Migration 전 Export와 Reconciliation Report를 보관한다.
- dual-write 중 한쪽 실패를 숨기지 않는다.
- Read 전환과 Write 전환을 별도 배포한다.
- Legacy 제거는 최소 한 번의 안정화 기간 뒤 진행한다.

## 13. 테스트 전략

### 13.1 Domain Test

외부 SDK 없이 밀리초 단위로 실행되어야 한다.

- Money, 항목 분할 합계 보존, 월 분할 내림·나머지 미반영 정책
- 중복·멱등 정책
- 취소 매칭
- 카테고리 결정
- 대출 상환·자동 납입
- 자산 평가와 배당 계산
- 역할별 권한 정책

### 13.2 Application Test

Fake Port를 사용한다.

- 권한 거부
- 원자적 Commit/Rollback
- Event 발행
- 재시도와 Idempotency
- Clock 경계와 연말·월말
- 외부 Provider 부분 실패

### 13.3 Adapter Contract Test

동일 Repository Port의 Fake와 Firestore 구현이 같은 계약을 만족하는지 검증한다.

- Mapper와 schemaVersion
- Query 범위와 정렬
- Transaction/Batch
- Timestamp 변환
- 외부 API Timeout/Parsing

### 13.4 Firebase Emulator

- 가구 간 read/write 차단
- Role별 권한
- 서버 전용 필드 보호
- Rules와 Query Index 호환
- Trigger/Outbox idempotency
- 데이터 Migration 검증

### 13.5 Client Test

- Web feature component/controller test
- 핵심 흐름 Playwright E2E
- Functions Android parser fixture test
- Android raw DTO·admission·Queue contract test
- Android ViewModel test
- WebView origin/bridge test
- WorkManager 재시도 test
- 계약 DTO 직렬화 호환성 test

### 13.6 Architecture Test

CI에서 다음을 자동 검사한다.

- Domain의 Firebase/React/Android import 금지
- Presentation의 Firebase import 금지
- feature deep import 금지
- shared의 feature import 금지
- Functions Handler의 Repository 직접 import 금지
- Android feature 간 구현 의존 금지
- 순환 의존성 금지

## 14. 품질 게이트

리팩터링 착수 당시의 과거 기준선:

- 웹 Production Build 성공
- Functions Build 성공
- Android 단위 테스트 3개 통과
- 웹 Jest 202개 중 193개 통과, 9개 실패
- 전체 웹 TypeScript 검사는 테스트 계약 문제로 실패
- Functions와 Firestore Rules 자동 테스트 없음
- CI 없음

구조 이동 전 최소 게이트:

1. 기존 실패 테스트를 수정하거나 명시적으로 격리
2. web build, web test, web typecheck
3. functions build, functions test
4. Android unit test
5. Firestore Rules emulator test
6. Contract compatibility test
7. Architecture dependency test

Coverage 숫자 하나를 목표로 삼기보다 모든 Domain Policy와 Application Use Case의 성공·실패 경로를 테스트한다.

## 15. 우선 실행 백로그

다음 순서의 작은 PR로 시작한다.

1. ADR-001: Modular Monolith + Clean Architecture 채택
2. ADR-002: Server-authoritative Command와 CQRS-lite 채택
3. CI에서 현재 build/test/typecheck 결과 수집
4. legacy localStorage candidate 포착 Client와 현재 Rules·기존 사용자 경로 Characterization
5. Access Membership/Invitation, MemberId, ActorContext, 멱등 LegacyMembershipClaim과 제한된 호환 Rules
6. claim 결과와 기존 householdId·memberId·핵심 조회의 reconciliation 및 rollback 검증 후 Access path의 직접 Rule 차단
7. Contract v1: ActorContext, `RecordManualTransaction`, Ledger Read Model
8. Functions Composition Root, 인증 Handler, UnitOfWork·Outbox·Inbox seam
9. Ledger Domain의 Money, Transaction, SplitPlan
10. LegacyExpenseRepository Adapter와 `RecordManualTransaction` Use Case
11. 웹 expenseService Facade 내부를 LedgerGateway로 전환하고 Ledger direct path 사용률 확인 뒤 해당 Rule 차단
12. `Split`/`Merge`/`CancelCapturedLineage`와 `ProcessRecurringMonthWorkflow`를 각각 작은 PR로 전환
13. Android `CaptureEnvelope.v1` DTO, 비식별 fixture, ParserRegistry와 Submit Gateway
14. Payment Capture Intake, `CaptureSubmissionReceipt`, Ledger fingerprint claim
15. Category/Budget 공개 Query와 Payment Configuration mapping 이동
16. Portfolio Core와 Market Data Provider Port 추출
17. Notifications·Reporting까지 Vertical Slice별 서버 경로 전환과 path별 direct Rule 차단
18. 모든 direct 사용률 0·rollback 검증 뒤 잔여 public/direct Rules와 호환 Rule 전역 제거

첫 번째 목표는 모든 파일을 새 폴더로 옮기는 것이 아니라 **웹에서 지출 한 건을 생성하는 경로 하나가 목표 의존성 규칙을 끝까지 통과하도록 만드는 것**이다. 이 Vertical Slice가 검증된 뒤 같은 패턴을 다른 기능에 복제한다.

## 16. Definition of Done

한 모듈의 리팩토링은 다음 조건을 모두 만족할 때 완료로 본다.

- 모듈의 책임과 소유 데이터가 문서화됨
- public API 외 deep import가 없음
- Domain에 Framework 타입이 없음
- Presentation/Handler에 업무 규칙이 없음
- Command가 인증·권한·입력 검증·멱등성을 가짐
- Domain과 Application 테스트가 존재
- Adapter Contract Test가 존재
- 다른 가구 접근 차단 Rules Test가 존재
- Migration과 Rollback 절차가 검증됨
- Legacy Facade/Flag 제거 조건이 기록됨
- 관련 문서와 ADR이 갱신됨

## 17. 피해야 할 선택

- 전면 재작성
- 기능별 마이크로서비스 분리
- 최상위 폴더만 apps/packages로 옮기는 미관 중심 작업
- 모든 로직을 shared에 모으기
- 모든 클래스에 Interface 만들기
- React Context를 전역 Service Locator로 사용하기
- Firestore Document를 Domain Entity로 사용하기
- 사용자 이름을 식별자로 사용하기
- UI에서 자동 납입·스냅샷 같은 Command 실행하기
- 데이터 Migration과 업무 규칙 수정을 동시에 배포하기
- 종료 계획 없는 dual-write

## 18. 최종 목표 상태

다음 질문에 모두 예라고 답할 수 있어야 한다.

- 월 분할 규칙을 바꿀 때 Ledger 모듈만 수정하는가?
- 새로운 카드 알림 Parser를 추가할 때 Ledger와 UI를 수정하지 않는가?
- Naver 시세 공급자를 바꿀 때 Portfolio Domain을 수정하지 않는가?
- 시세 Provider가 장기간 실패하면 마지막 정상 가격을 유지하면서 운영 경보로 즉시 알 수 있는가?
- 멤버 이름을 바꿀 때 자산과 FCM 문서를 일괄 변경하지 않는가?
- 웹과 Android가 같은 업무 규칙을 각각 구현하지 않는가?
- 모든 데이터 접근이 사용자와 가구 Membership으로 격리되는가?
- 각 Canonical Firestore 컬렉션의 소유 모듈과 각 Outbox Event type의 producer를 즉시 말할 수 있는가?
- Framework 교체 없이 Domain/Application 테스트를 실행할 수 있는가?

이 상태가 달성되면 기능 추가 속도보다 더 중요한 **변경의 국소성**이 확보된다. Clean Architecture의 성공 여부는 디렉터리 모양이 아니라, 한 기능의 변경이 해당 모듈 경계 밖으로 전파되지 않는 것으로 판단한다.
