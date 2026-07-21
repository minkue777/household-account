# 시스템 컨텍스트와 공통 계약

> 기능 유형: Shared Kernel / System Contract  
> 상태 규약: [요구사항 문서 규약](../governance/conventions.md)  
> 목표 아키텍처: [목표 Clean Architecture 설계](../../architecture/target-clean-architecture.md)  
> 전환 계획: [Clean Architecture 리팩토링 전략](../../architecture/clean-architecture-refactoring-strategy.md)

## 1. 책임

이 문서는 어느 한 Bounded Context가 독점할 수 없는 시스템 경계, 공통 형식과 불변식만 소유한다. 거래 계산, 알림 parsing, 자산 평가 같은 업무 용어와 규칙은 5개 Context 및 하위 기능 문서가 소유한다.

현재 제품은 다음 기능을 가진 다중 클라이언트 가계·자산 관리 시스템이다.

1. 가구와 멤버 단위의 지출·수입 공유
2. 거래, 예산, 정기지출, 카드, 자동 분류 관리
3. Android 금융 알림과 iOS Shortcut 기반 거래 입력
4. 예적금, 주식, 코인, 부동산, 금, 대출, 배당 관리
5. PWA·Android FCM 알림
6. 예약 작업과 외부 금융 데이터 연동

## 2. 행위자

| 행위자 | 현재 식별 방식 | 주요 행위 |
|---|---|---|
| 가구 멤버 | 가구 키와 멤버 이름 | 거래·자산 조회 및 변경, 카드 설정, 알림 수신 |
| Android 알림 수집기 | SharedPreferences의 가구 키·멤버 이름 | 승인·취소 파싱, 거래·잔액 저장, QuickEdit |
| iOS Shortcut | 사용자·가구에 묶인 전용 credential과 결제 메시지 | 카드 메시지 파싱과 거래 등록 |
| 예약 작업 | Firebase Scheduler | 자산 스냅샷, 보유종목 시세, ETF 배당 갱신 |
| 외부 데이터 공급자 | Naver, Nasdaq, Upbit, KIND 등 | 시세, 환율, 종목, 배당 데이터 제공 |

가구 키와 멤버 이름은 현재 구현의 식별 방식일 뿐 외부 공개 제품의 최종 인증·인가 모델이 아니다. 현재 코드의 “자신이 아닌 첫 번째 멤버” partner도 독립 행위자가 아니며 [DEC-022](../governance/decisions.md#dec-022)에 따라 목표 모델에서 제거한다.

## 3. 5개 업무 Bounded Context

| Context | 시스템 책임 | 상세 지도 |
|---|---|---|
| Access & Household | Principal, 가구, Member, Membership, 초대, 권한 | [Context 요구사항](../contexts/access-household/requirements.md) |
| Household Finance | Transaction, Category, Budget, RecurringPlan, LocalCurrencyBalance | [Context 요구사항](../contexts/household-finance/requirements.md) |
| Payment Capture | CardRegistry, MerchantRuleSet, Android·Shortcut `CaptureEnvelope.v1` | [Context 요구사항](../contexts/payment-capture/requirements.md) |
| Portfolio | AssetAccount, Position, Automation, Dividend | [Context 요구사항](../contexts/portfolio/requirements.md) |
| Notifications | NotificationEndpoint, NotificationDelivery | [Context 요구사항](../contexts/notifications/requirements.md) |

Android Host, PWA, Reporting, Home Preferences, External Operations, Delivery Assurance는 [지원·읽기·플랫폼 영역](../supporting-platform/requirements.md)이며 여섯 번째 업무 Context가 아니다.

## 4. 공통 용어

| 용어 | 현재 의미 | 소유 Context·영역 | 상세 소유 문서 |
|---|---|---|---|
| 가구 | householdId로 범위가 구분되는 공유 데이터 단위 | [Access & Household](../contexts/access-household/requirements.md) | [가구와 접근](../contexts/access-household/modules/household-access/requirements.md) |
| 멤버 | 현재는 이름 기반이며 목표는 안정 memberId와 자기 Google UID Membership을 가진 구성원. legacy Member만 전환 전 일시 미연결 | [Access & Household](../contexts/access-household/requirements.md) | [가구와 접근](../contexts/access-household/modules/household-access/requirements.md) |
| 거래 | expenses 컬렉션의 지출 또는 수입 Canonical 기록 | [Household Finance](../contexts/household-finance/requirements.md) | [거래 원장](../contexts/household-finance/modules/ledger/requirements.md) |
| 등록 카드 | 멤버 소유의 카드사·마지막 번호 조합 | [Payment Capture](../contexts/payment-capture/requirements.md) | [결제 설정](../contexts/payment-capture/modules/payment-configuration/requirements.md) |
| 가맹점 규칙 | 가맹점을 이름·카테고리·메모로 자동 mapping하는 규칙 | [Payment Capture](../contexts/payment-capture/requirements.md) | [결제 설정](../contexts/payment-capture/modules/payment-configuration/requirements.md) |
| 분할 | 한 거래를 여러 항목 또는 여러 월로 나누는 행위 | [Household Finance](../contexts/household-finance/requirements.md) | [거래 원장](../contexts/household-finance/modules/ledger/requirements.md) |
| 자산 Snapshot | 특정 날짜의 총자산·금융자산·유형·소유자별 합계 | [Portfolio](../contexts/portfolio/requirements.md) | [포트폴리오](../contexts/portfolio/modules/portfolio/requirements.md) |
| Notification Delivery | 업무 Event를 특정 endpoint에 전달하는 멱등 실행 | [Notifications](../contexts/notifications/requirements.md) | [푸시 알림](../contexts/notifications/modules/notifications/requirements.md) |
| QuickEdit | Android 자동 등록 직후 표시되는 overlay 편집 화면 | [지원·플랫폼](../supporting-platform/requirements.md) | [Android Host](../supporting-platform/modules/android-host/requirements.md) |

## 5. 포함 범위와 제외 범위

포함 범위:

- 가구 격리 키
- 인증된 client session 범위와 비동기 결과의 세대 격리
- 공통 거래 유형, 카테고리 호환, 금액·날짜·시간 형식
- 쓰기 성공·실패에 대한 시스템 불변식
- migration·backfill의 실행 권한과 tenant 범위

제외 범위:

- 사용자 인증·역할 정책의 구체 구현
- 기능별 계산과 저장 순서
- 외부 Provider 응답 형식
- 화면 표현과 플랫폼 권한

## 6. 공통 요구사항

| ID | 상태 | 요구사항 | 예외·비고 | 테스트 |
|---|---|---|---|---|
| SYS-001 | 현재 명세 | 가구 소유 데이터는 householdId로 범위를 구분한다. | 현 Firestore Rules가 이 격리를 강제하지 못하는 것은 결함이다. | C, I |
| SYS-002 | 호환 | transactionType이 없는 기존 거래는 expense로 읽는다. | 마이그레이션 완료 전까지 유지한다. | U, I |
| SYS-003 | 호환 | 카테고리가 없는 기존 거래는 etc로 읽는다. | 존재하지만 현재 목록에 없는 키는 그대로 보존하고 Web에서 알 수 없음으로 표시한다. 일부 Android 모델은 대문자 열거형을 사용하므로 저장 경계의 대소문자 호환 테스트가 필요하다. | U, C |
| SYS-004 | 현재 명세 | 금액은 원 단위 정수이며 정상 거래 금액은 0보다 커야 한다. | 일부 UI가 parseInt로 소수를 절삭하고 일부 서비스 검증이 약한 것은 결함 후보이다. | U, C |
| SYS-005 | 목표 명세 | 날짜는 YYYY-MM-DD, 시간은 HH:mm 형태로 교환하고 모든 업무 LocalDate·LocalTime·YearMonth·오늘·월 경계는 `Asia/Seoul`로 해석한다. 절대 시각은 UTC Instant로 저장한다. | 가구별 timezone 설정은 없으며 서버·브라우저·기기 기본 timezone에 의존하지 않는다. 연도 없는 결제 시각은 DEC-029에 따라 서울 수신 시각보다 미래가 아닌 가장 가까운 연도로 추론한다. | U, C |
| SYS-006 | 호환·목표 명세 | 신규 멤버 소유권과 알림 대상은 안정적인 memberId를 사용하고 표시 이름은 snapshot으로만 보존한다. 이름만 저장된 레거시 참조는 같은 가구에서 유일하게 일치할 때만 memberId로 연결하며 원문을 보존한다. | 이름이 없거나 동명이인으로 모호하면 임의 연결하지 않고 수동 reconciliation을 요구한다. 연결 후 이름 변경은 소유권·알림 대상을 바꾸지 않는다. | U, I, migration |
| SYS-007 | 결함 | 쓰기 작업은 성공과 실패를 구분할 수 있어야 하며 부분 성공으로 완료를 알리면 안 된다. | 여러 현 구현이 예외를 삼키거나 순차 저장한다. 잘못된 현재 결과가 아니라 이 무결성 불변식을 테스트한다. | I, E2E |
| SYS-008 | 결함 | 보호된 client 상태·cache·실시간 구독·비동기 요청은 인증 완료 후 UID의 유일한 Membership에서 생성한 `SessionScope(sessionGeneration, principalUid, householdId, memberId)`에 귀속되어야 한다. 로그아웃·legacy 전환·승인된 Membership 교정은 이전 상태와 구독을 동기 폐기하고, 세대가 다른 늦은 응답을 무시해야 한다. | DEC-034에 따라 일반 가계부·멤버 선택은 없다. 현재 여러 Web 서비스·Context가 localStorage를 독립적으로 읽고 `guest`를 fallback tenant로 사용하여 같은 탭의 세션 변경 중 이전 가구 데이터가 남거나 쓰기가 발생할 수 있다. localStorage·Native mirror는 권위가 아니다. | C, UI, E2E |
| SYS-009 | 결함 | tenant/schema migration·backfill·repair는 승인된 서버·운영 경계에서 대상 scope, dry-run, checkpoint, 멱등성, reconciliation 결과를 갖고 실행해야 하며 일반 client bundle은 전역 조회나 누락 tenant 필드 보정을 수행할 수 없다. | 현재 Web의 `migrateExpensesToHousehold`는 전체 거래를 읽어 householdId 누락 문서에 현재 가구를 기록할 수 있어 가구 오염 위험이 있다. 정상 사용자 요청과 운영 보정을 같은 API로 노출하지 않는다. | C, I, 운영 계약 |

## 7. Context 간 공통 원칙

- 가구 범위 Query와 Command는 명시적인 householdId와 Actor Context를 사용한다.
- Context는 다른 Context의 Repository·Firestore 경로·Domain Entity를 직접 사용하지 않고 공개 Application 계약을 호출한다.
- 같은 Context 내부 기능도 데이터 소유 기능의 공개 Port를 사용하며 명시적 Context Unit of Work만 강한 원자성 예외가 된다.
- 같은 업무 규칙을 Web, Android, Functions가 각각 최종 판정하지 않는다.
- 날짜·시간, ID, 외부 시세, 현재 사용자 정보는 주입 가능한 Port로 제공한다.
- client Adapter는 localStorage를 업무 Query의 tenant 출처로 사용하지 않고 검증된 SessionScope를 명시적으로 전달한다.
- migration·repair는 사용자 UI/브라우저 bundle과 분리된 승인된 운영 Application만 실행한다.
- 호환 읽기와 신규 쓰기 계약을 분리한다.
- Context를 넘는 비동기 효과는 Canonical 변경과 함께 Durable Outbox에 기록한다.

## 8. 공통 결함

- 현재 인증·인가가 householdId 격리를 강제하지 못한다.
- 멤버 이름이 소유권과 알림 식별자로 사용되어 이름 변경 영향이 여러 모듈로 전파된다.
- Android와 Functions의 일부 모델이 카테고리 대소문자를 다르게 표현한다.
- 여러 다중 문서 변경이 부분 성공 후 완료로 표시될 수 있다.
- Web의 Context·서비스가 localStorage를 각각 읽어 같은 탭 session 전환과 늦은 비동기 결과를 격리하지 못한다.
- 브라우저 서비스에 전역 거래를 현재 가구로 보정하는 migration 함수가 포함되어 있다.

자세한 보안 위험과 교정 요구사항은 [보안과 개인정보](../cross-cutting/security-privacy.md)를 따른다.

## 9. 공통 테스트

| 테스트 | 종류 | 기대 결과 |
|---|---|---|
| transactionType 누락 fixture | 호환 | expense로 읽는다. |
| category 누락·unknown·대문자 fixture | 호환 | 누락은 etc, unknown은 보존, 대소문자 경계는 계약대로 처리한다. |
| 금액·날짜·시간 DTO 계약 | 계약 | 모든 클라이언트가 같은 형식과 검증 오류를 사용한다. |
| 부분 쓰기 실패 | 목표 | 완료 event를 내보내지 않고 재시도 가능한 오류를 반환한다. |
| 가구 A→B session 전환 중 A의 늦은 응답 | 목표 | 모든 A 구독·cache를 폐기하고 B 화면·저장소에 반영하지 않는다. |
| 무인증 guest/admin route 진입 | 목표 | 보호 데이터 구독·기본 카테고리 생성·endpoint 등록을 수행하지 않는다. |
| client migration 호출·가구 범위 밖 fixture | 목표 | client bundle에 실행 API가 없고 승인된 운영 job만 dry-run·checkpoint·reconciliation을 남긴다. |
