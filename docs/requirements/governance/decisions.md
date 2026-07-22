# 제품 결정 기록

> 상태 규약: [요구사항 문서 규약](conventions.md)  
> 목적: 코드만으로 결정할 수 없는 제품 정책을 요구사항과 테스트에 연결한다.

## 결정 상태

- Accepted: 제품 정책으로 확정됨
- Pending: Human in the loop 결정이 필요함
- Superseded: 더 새로운 결정으로 대체됨
- Rejected: 검토했으나 채택하지 않음

<a id="dec-001"></a>
## DEC-001 월 분할 나머지 금액

> 상태: Accepted  
> 확정일: 2026-07-13  
> 정책 소유 Context: [Household Finance](../contexts/household-finance/requirements.md)  
> 영향 기능: [거래 원장](../contexts/household-finance/modules/ledger/requirements.md)

대체 전 정책:

월 분할은 모든 달에 원금을 개월 수로 나눈 내림 금액을 저장한다. 나머지 1원 단위 오차는 별도 달에 배분하지 않고 현재 로직을 유지한다.

의도:

가계부에서 의미 없는 수준의 오차이므로 분배 복잡성을 추가하지 않는다.

영향 요구사항: SPL-005, CAN-006.

<a id="dec-002"></a>
## DEC-002 알림 원문 진단 로그

> 상태: Accepted  
> 확정일: 2026-07-13  
> 정책 소유 Context: [Payment Capture](../contexts/payment-capture/requirements.md)  
> 영향 기능: [Android 결제 수집](../contexts/payment-capture/modules/android-payment-ingestion/requirements.md)

확정 정책:

notification_debug_logs는 파서 개선을 위한 임시 진단 기능으로만 유지하고 파서가 안정되면 제거한다. 운영 Domain, 영구 감사 로그 또는 외부 공개 제품 기능으로 승격하지 않는다.

전환 조건:

- 목표 아키텍처에서는 Diagnostic Adapter로 격리한다.
- 제거 전까지 접근 권한, 마스킹, 짧은 보관 기간을 적용한다.
- 필요한 parser fixture와 회귀 테스트가 확보되면 수집 코드와 컬렉션을 함께 제거한다.

영향 요구사항: ING-005.

<a id="dec-003"></a>
## DEC-003 결제 중복 판정

> 상태: Accepted  
> 확정일: 2026-07-13  
> 정책 소유 Context: [Payment Capture](../contexts/payment-capture/requirements.md)  
> 영향 기능: [Android 결제 수집](../contexts/payment-capture/modules/android-payment-ingestion/requirements.md), [Shortcut 결제 수집](../contexts/payment-capture/modules/shortcut-ingestion/requirements.md), [거래 원장](../contexts/household-finance/modules/ledger/requirements.md)

확정 정책:

같은 가구·날짜·시간·금액·가맹점 거래는 중복으로 버린다. 카드 또는 source가 달라도 후속 거래를 보존하지 않는다.

의도:

해당 조건으로 실제 결제가 두 번 발생하지 않는다고 보고 parser 오동작으로 생기는 중복 방지를 우선한다. 넓은 판정 기준은 의도한 정책이지만 동시 요청에서 중복이 생성되지 않도록 원자성과 멱등성은 별도로 보장해야 한다.

영향 요구사항: ING-SAVE-005, IOS-006, IOS-011.

<a id="dec-004"></a>
## DEC-004 QuickEdit 오버레이 권한

> 상태: Accepted  
> 확정일: 2026-07-14  
> 정책 소유 영역: [지원·읽기·플랫폼](../supporting-platform/requirements.md)  
> 영향 기능: [Android Host](../supporting-platform/modules/android-host/requirements.md)

확정 정책:

Android 앱의 최초 권한 화면에서는 알림 접근 권한과 다른 앱 위 표시 권한을 모두 필수로 요구한다. 두 권한을 허용한 뒤 WebView에 진입하며, 이후 사용자는 앱 설정에서 QuickEdit 자동 표시 기능을 끌 수 있다.

의도:

최초 설정에서 QuickEdit 실행에 필요한 OS 권한을 미리 확보하되, 실제 QuickEdit 표시 여부는 별도의 사용자 설정으로 제어한다. 사용자가 QuickEdit을 끄면 결제 수집은 유지되고 QuickEdit 화면만 표시하지 않는다.

영향 요구사항: AND-001, QE-001.

<a id="dec-005"></a>
## DEC-005 알림 출처 허용 범위

> 상태: Accepted  
> 확정일: 2026-07-14  
> 정책 소유 Context: [Payment Capture](../contexts/payment-capture/requirements.md)  
> 영향 기능: [Android 결제 수집](../contexts/payment-capture/modules/android-payment-ingestion/requirements.md)

확정 정책:

결제 입력은 지원 대상으로 등록된 Android package의 알림만 수용한다. package를 먼저 등록된 source와 전용 parser에 매핑한 뒤 해당 parser만 실행한다. 미등록 package는 본문이 기존 결제 형식과 완전히 일치해도 지출 후보로 처리하지 않는다.

현재 코드와의 차이:

현재 `package in knownPackages || Parser.matches(text)` 조건 때문에 미등록 package도 본문만 일치하면 처리될 수 있다. 이 동작은 의도한 요구사항이 아니라 결함이다. parser를 지원하지만 package가 등록되지 않은 삼성·롯데 등의 출처는 공식 package를 Source Registry에 등록하기 전까지 지출 입력으로 활성화하지 않는다.

영향 요구사항: ING-002.

<a id="dec-006"></a>
## DEC-006 멤버별 최신 알림 endpoint

> 상태: Superseded — [DEC-020](#dec-020)으로 대체  
> 확정일: 2026-07-14  
> 정책 소유 Context: [Notifications](../contexts/notifications/requirements.md)  
> 영향 기능: [푸시 알림](../contexts/notifications/modules/notifications/requirements.md), [가구와 접근](../contexts/access-household/modules/household-access/requirements.md)

확정 정책:

- 한 가구 멤버는 알림 endpoint를 최대 하나만 유지한다.
- 같은 멤버로 Web/PWA 또는 Android에서 유효한 endpoint 등록이 성공하면 기존 전달 주소, platform, device metadata를 새 값으로 덮어쓴다. 별도의 주 기기·임시 기기·교체 확인 개념을 두지 않는다.
- 결과적으로 마지막으로 등록에 성공한 앱 설치만 해당 멤버의 푸시를 받는다. 이전 endpoint는 즉시 대체한다.
- Firebase가 같은 전달 주소를 다시 알려줘도 앱 시작·멤버 선택 등의 등록 시점에는 서버의 갱신 시각과 metadata를 다시 저장할 수 있다. 전달 주소가 변경된 경우에도 같은 upsert 경로를 사용한다.
- 당시 목표 구조에서는 멤버 이름 대신 안정적인 `(householdId, memberId)`를 endpoint key로 사용하고 인증·Membership을 서버에서 검증하면서 최신 등록이 덮어쓰는 제품 동작을 유지하기로 했다. 이 cardinality는 이후 [DEC-020](#dec-020)의 설치별 다중 endpoint 정책으로 대체됐다.

현재 코드와의 차이:

현재 코드는 가구 ID와 멤버 이름으로 만든 단일 문서에 registration token을 merge하여 마지막 등록 기기가 기존 값을 덮어쓴다. DEC-006은 이 동작을 유지하기로 했던 과거 결정이며, 목표 구조는 [DEC-020](#dec-020)에 따라 설치별 다중 endpoint로 변경한다.

영향 요구사항: PUSH-002, PUSH-003, PUSH-008.

<a id="dec-007"></a>
## DEC-007 도시가스 거래일

> 상태: Accepted  
> 확정일: 2026-07-14  
> 정책 소유 Context: [Payment Capture](../contexts/payment-capture/requirements.md)  
> 영향 기능: [Android 결제 수집](../contexts/payment-capture/modules/android-payment-ingestion/requirements.md), [거래 원장](../contexts/household-finance/modules/ledger/requirements.md)

확정 정책:

도시가스 청구 알림에 납부마감일이 있으면 해당 날짜를 지출의 회계 날짜로 사용한다. 알림 수신일은 회계 날짜로 대체하지 않고 입력 관측 시각으로만 보존한다.

예외:

납부마감일을 파싱할 수 없는 경우에만 현재 로직과 같이 알림 수신일을 지출 날짜로 사용한다. 사용자별 회계일 선택 정책은 두지 않는다.

영향 요구사항: PARSE-CITYGAS-001.

<a id="dec-008"></a>
## DEC-008 지역화폐 잔액 단위

> 상태: Accepted  
> 확정일: 2026-07-14  
> 정책 소유 Context: [Household Finance](../contexts/household-finance/requirements.md)  
> 영향 기능: [지역화폐](../contexts/household-finance/modules/local-currency/requirements.md), [홈 환경설정](../supporting-platform/modules/home-preferences/requirements.md)

확정 정책:

지역화폐 잔액은 가구와 지역화폐 유형의 조합별로 각각 하나를 유지한다. 경기지역화폐·대전사랑카드·세종 여민전 등 서로 다른 유형의 최신 잔액은 서로 덮어쓰지 않는다.

표시 정책:

홈의 지역화폐 잔액 카드는 Home Preferences가 보유한 선택 통화 유형을 명시하여 해당 잔액 하나를 조회한다. 사용자는 보유한 여러 지역화폐 중 홈에 표시할 유형을 변경할 수 있어야 한다. Local Currency 모듈은 잔액들을 소유하고, 선택 상태와 UI는 Home Preferences가 소유한다.

처음 관찰된 지역화폐가 하나뿐이고 아직 저장된 선택이 없으면 해당 유형을 자동 선택한다. 이후 다른 지역화폐가 추가되거나 더 최근에 갱신되어도 기존 선택을 유지하며, 사용자가 명시적으로 변경할 때만 홈 표시 유형을 바꾼다.

영향 요구사항: BAL-002, BAL-004, HOME-002.

<a id="dec-009"></a>
## DEC-009 정기지출 소급 생성

> 상태: Accepted  
> 확정일: 2026-07-14  
> 정책 소유 Context: [Household Finance](../contexts/household-finance/requirements.md)  
> 영향 기능: [정기 거래](../contexts/household-finance/modules/recurring-transactions/requirements.md), [거래 원장](../contexts/household-finance/modules/ledger/requirements.md)

확정 정책:

정기지출 처리는 사용자 화면 진입에 의존하지 않는다. 서버 Scheduler는 `Asia/Seoul` 기준 매일 00:00에 정기 거래 모듈의 공개 처리 Port를 호출하고, 실행일이 도래한 당월 거래를 자동 생성한다.

누락 복구:

정상 경로에서는 매일 00:00 실행으로 due month를 즉시 처리한다. 다만 배포·Scheduler·저장소의 일시 장애가 자정에 발생해도 영구 누락되지 않도록, 다음 성공 실행은 `firstApplicableMonth` 이후 execution이 없는 due month를 자동 복구한다. 예를 들어 7월과 8월 처리가 실패한 상태에서 9월 Scheduler가 실행되면 7월, 8월, 실행일이 도래한 9월을 오래된 월부터 처리한다. 각 `planId + 대상 월` execution을 유일 멱등 키로 사용하므로 Scheduler 재실행과 동시 실행에도 월별 거래는 한 건만 생성한다. 한 번에 처리할 수 있는 양을 넘으면 checkpoint를 남기고 후속 실행에서 자동으로 계속한다.

시작 범위:

새 계획은 생성 전 월까지 소급하지 않는다. 기존 생성 규칙에 따라 지정일 이전·당일 생성은 당월부터, 지정일 이후 생성은 다음 달부터 `firstApplicableMonth`로 삼고, 그 이후 누락된 월만 자동 복구한다.

영향 요구사항: REC-002, REC-003.

<a id="dec-010"></a>
## DEC-010 합치기 해제 복원 범위

> 상태: Accepted  
> 확정일: 2026-07-14  
> 정책 소유 Context: [Household Finance](../contexts/household-finance/requirements.md)  
> 영향 기능: [거래 원장](../contexts/household-finance/modules/ledger/requirements.md)

확정 정책:

합치기 해제 시 원본별로 가맹점·금액·카테고리·메모만 복원한다. 날짜·시간·거래 유형·카드 유형·카드 끝자리는 합쳐진 거래의 공통 값을 모든 복원 거래에 적용한다.

의도:

여러 거래를 합친 이후 사용자가 선택하거나 유지한 대표 거래의 날짜·시간·카드 정보를 합치기 해제 후에도 공통으로 유지한다. 원본의 개별 날짜·시간·카드 snapshot을 추가로 복원하지 않고 현재 동작을 보존한다.

영향 요구사항: MRG-002.

<a id="dec-011"></a>
## DEC-011 자산 자동화 최초 활성화 월의 자동 납입·상환

> 상태: Accepted  
> 확정일: 2026-07-14  
> 정책 소유 Context: [Portfolio](../contexts/portfolio/requirements.md)  
> 영향 기능: [자산 자동화](../contexts/portfolio/modules/asset-automation/requirements.md), [포트폴리오](../contexts/portfolio/modules/portfolio/requirements.md)

확정 정책:

적금 또는 대출 자산과 자동화 Plan을 함께 생성하거나 기존 자산에서 자동화를 처음 활성화한 시점이 당월 납입일·상환일 이후이면, 입력·현재 잔액에 당월 납입·상환 결과가 이미 포함된 것으로 본다. 활성화 월 execution은 추가 금액 변경 없이 처리 완료로 표시하고 다음 달부터 자동 납입·상환한다.

최초 활성화일이 당월 납입일·상환일 이전 또는 당일이면 당월을 최초 적용 월로 두고 실행일이 도래했을 때 한 번 반영한다. 자산 생성일이 과거라는 이유로 자동화 활성화 전 월을 소급 생성하지 않는다.

사용자에게 별도 체크박스나 최초 적용 월을 입력받지 않고 현재 동작을 유지한다.

이 정책의 기준일은 `firstActivatedOn`이다. 자산 생성과 Plan 최초 활성화가 같은 흐름이면 두 날짜가 같고, 기존 자산에 나중에 자동화를 켜면 실제 최초 활성화일을 사용한다. 이후 Plan 설정 변경·중지 후 재개는 최초 활성화로 다시 계산하지 않고 DEC-052의 revision·기존 execution을 이어서 사용한다.

영향 요구사항: AUTO-002, T-AUTO-002.

<a id="dec-012"></a>
## DEC-012 취소 fallback

> 상태: Accepted  
> 결정일: 2026-07-14  
> 정책 소유 Context: [Payment Capture](../contexts/payment-capture/requirements.md)  
> 영향 기능: [Android 결제 수집](../contexts/payment-capture/modules/android-payment-ingestion/requirements.md), [거래 원장](../contexts/household-finance/modules/ledger/requirements.md)

결정:

- 취소 대상은 금액·정규화된 가맹점·카드가 모두 일치하는 원거래로 제한한다.
- 월 분할 거래의 금액은 DEC-001의 내림 오차 허용 범위를 적용하되, 가맹점과 카드는 반드시 일치해야 한다.
- 가맹점이 다른 금액·카드 일치 거래는 취소 후보에 포함하지 않으며 자동 삭제하거나 사용자 확인 후보로 노출하지 않는다.
- 완전 일치하는 원거래가 없으면 `NotFound`로 종료하고 어떤 원장 데이터도 변경하지 않는다.
- 완전 일치 후보가 여러 건이면 저장 순서로 임의 선택하지 않고 `NeedsConfirmation`으로 종료한다.

근거:

다른 가맹점의 같은 금액·카드 거래는 별개의 거래이며, 취소 fallback으로 삭제해서는 안 된다. 원거래가 없을 때 아무 작업도 하지 않는 것이 데이터 손실보다 안전하다.

영향 요구사항: CAN-003.

<a id="dec-013"></a>
## DEC-013 거래 생성자와 채널별 알림

> 상태: Accepted  
> 결정일: 2026-07-14  
> 정책 소유 Context: [Notifications](../contexts/notifications/requirements.md)  
> 영향 기능: [푸시 알림](../contexts/notifications/modules/notifications/requirements.md), [거래 원장](../contexts/household-finance/modules/ledger/requirements.md), [Android 결제 수집](../contexts/payment-capture/modules/android-payment-ingestion/requirements.md), [Shortcut 결제 수집](../contexts/payment-capture/modules/shortcut-ingestion/requirements.md)

결정:

- Android·iPhone Shortcut·Web 등 모든 신규 거래는 검증된 `creatorMemberId`, 업무 출처 `source`, 입력 채널 `originChannel`을 기록한다. 생성자 존재 여부를 알림 전송 여부의 우회 조건으로 사용하지 않는다.
- Android 자동 등록 지출은 생성자 본인의 Android 기기에서 QuickEdit만 실행한다. 생성자 본인과 다른 가구원 모두에게 자동 푸시를 보내지 않는다.
- iPhone Shortcut이 Cloud Function을 통해 등록한 지출은 QuickEdit을 사용할 수 없으므로 생성자 본인의 iPhone 알림 endpoint에 편집 링크 푸시를 보낸다. 다른 가구원에게는 자동 전송하지 않는다.
- Web 수동 입력, 정기 거래, import·migration·scheduler 등 그 밖의 origin은 거래 생성만으로 자동 푸시를 만들지 않는다. 타 가구원 전달은 아래의 명시적 `알림 보내기`만 사용한다.
- 사용자가 지출의 `알림 보내기`를 명시적으로 실행하면 요청자를 제외한 활성 가구원 모두에게 알림을 보낸다. 거래 생성자와 요청자가 달라도 제외 기준은 현재 요청자다.
- 거래 저장 성공과 QuickEdit·푸시 전달 성공은 별도 결과다. 알림 실패가 거래를 롤백하지 않는다.

설계 원칙:

Ledger는 `creatorMemberId`, `source`, `originChannel`을 필수 원장 사실로 보존하고 알림 수신자를 선택하지 않는다. Notifications는 `originChannel`을 사용하는 자동 거래 생성 정책과 명시적 가구원 알림 정책을 별도로 소유한다. 실제 endpoint 개수와 binding은 DEC-020의 다중 FID 정책을 따른다.

영향 요구사항: ING-SAVE-006, IOS-007, IOS-008, LED-007, PUSH-004, PUSH-005, PUSH-010.

<a id="dec-014"></a>
## DEC-014 배당 기준일 누락 복구

> 상태: Accepted  
> 결정일: 2026-07-14  
> 정책 소유 Context: [Portfolio](../contexts/portfolio/requirements.md)  
> 영향 기능: [배당](../contexts/portfolio/modules/dividends/requirements.md), [보유종목과 시세](../contexts/portfolio/modules/holdings-market-data/requirements.md)

결정:

- 기준일의 정확한 보유 snapshot이 있으면 해당 수량을 사용한다.
- 정확한 snapshot이 없으면 남아 있는 해당 종목의 보유 snapshot 중 기준일과 달력 날짜 차이의 절댓값이 가장 작은 수량으로 추정한다.
- 날짜 차이가 같은 snapshot이 기준일 전후에 모두 있으면 기준일 이전 snapshot을 우선한다. 예를 들어 기준일이 10일이고 9일·11일 데이터가 있으면 9일 수량을 사용한다.
- 선택한 snapshot 날짜와 source version은 재실행의 결정성과 내부 감사 근거를 위해 저장하지만 화면에는 정확값·추정값을 별도로 구분해 표시하지 않는다.
- 사용할 수 있는 보유 snapshot이 전혀 없거나 조회가 실패하면 0으로 추정하지 않고 `NoData` 또는 재시도 가능한 실패로 남긴다.

의도:

배당 금액은 참고용이므로 사용자 확인을 요구하지 않고 가장 가까운 보유 데이터로 자동 복구한다. 다만 시스템 장애를 0주로 오인하지 않는다.

영향 요구사항: DIV-005.

<a id="dec-015"></a>
## DEC-015 사용 중인 카테고리 삭제

> 상태: Accepted  
> 결정일: 2026-07-14  
> 정책 소유 Context: [Household Finance](../contexts/household-finance/requirements.md)  
> 영향 기능: [카테고리·예산](../contexts/household-finance/modules/categories-budget/requirements.md), [거래 원장](../contexts/household-finance/modules/ledger/requirements.md), [정기 거래](../contexts/household-finance/modules/recurring-transactions/requirements.md), [결제 설정](../contexts/payment-capture/modules/payment-configuration/requirements.md)

결정:

- 과거 거래가 참조하는 카테고리의 삭제 요청은 hard delete나 기존 거래 remap이 아니라 `archived` 상태 전이로 처리한다.
- 과거 거래의 `categoryId`를 변경하지 않고 archived 카테고리의 기존 이름·색상 등 표시 정보를 계속 조회할 수 있게 보존한다.
- archived 카테고리는 신규 거래, 거래 수정, QuickEdit, 기본 카테고리, 정기지출, 가맹점 자동분류의 선택 후보에서 제외한다.
- 현재 기본 카테고리 자체는 archive하거나 삭제할 수 없으며 `Conflict(CATEGORY_IS_DEFAULT)`로 거부한다.
- 기본 카테고리가 아닌 카테고리를 archive할 때 정기지출·가맹점 자동분류처럼 미래 거래를 생성할 수 있는 설정 참조는 현재 기본 카테고리로 자동 변경한다. 과거 거래의 참조는 변경하지 않는다.
- 유효한 현재 기본 카테고리가 없으면 archive를 시작하지 않고 `Conflict(DEFAULT_CATEGORY_REQUIRED)`를 반환한다.
- archived 카테고리를 다시 활성화하는 기능과 hard delete 기능은 제공하지 않는다.

의도:

과거 가계부의 분류 의미와 통계를 보존하면서 더 이상 사용하지 않는 카테고리가 새 입력 화면에 노출되지 않게 한다.

영향 요구사항: CAT-002, CAT-003, CAT-004.

<a id="dec-016"></a>
## DEC-016 가구 삭제와 복구

> 상태: Accepted  
> 결정일: 2026-07-14  
> 정책 소유 Context: [Access & Household](../contexts/access-household/requirements.md)  
> 영향 기능: [가구와 접근](../contexts/access-household/modules/household-access/requirements.md), 모든 가구 범위 데이터 소유 모듈

결정:

- 관리자 화면의 가구 삭제는 Household를 `deleted` 상태로 전환하는 논리 삭제로 처리한다.
- 논리 삭제 즉시 일반 사용자 Command·Query와 세션 복원을 차단하고 관리자 목록에서는 삭제 상태로 구분한다.
- 거래·카테고리·정기지출·카드·가맹점 규칙·자산·알림 등 가구 범위 데이터는 논리 삭제 시 제거하거나 변경하지 않는다.
- `deleted` Household는 관리자 또는 승인된 운영 주체의 복구 명령으로 `active` 상태로 되돌릴 수 있다.
- 시간 경과에 따른 자동 hard purge와 보존 기간 기반 영구 삭제는 제공하지 않는다.
- 영구 삭제는 사용자가 별도로 요청했을 때만 관리자/에이전트가 명시적인 `RequestPermanentHouseholdPurge` 작업을 시작한다. 이 작업은 복구 불가능함을 확인한 뒤 각 데이터 소유 모듈의 paged purge Command를 조정한다.
- 영구 purge가 시작된 `purging` 상태에서는 부분 삭제 가능성이 있으므로 복구를 허용하지 않는다.

의도:

관리자 오조작으로 가계부 전체 데이터가 즉시 유실되는 것을 막고, 사용자가 명시적으로 데이터베이스 정리를 요청하기 전까지 완전한 복구 가능성을 보존한다.

영향 요구사항: ADM-001, ADM-003.

<a id="dec-017"></a>
## DEC-017 자산 삭제와 운영 복구

> 상태: Accepted  
> 결정일: 2026-07-14  
> 정책 소유 Context: [Portfolio](../contexts/portfolio/requirements.md)  
> 영향 기능: [자산 포트폴리오](../contexts/portfolio/modules/portfolio/requirements.md), [보유종목·시장 데이터](../contexts/portfolio/modules/holdings-market-data/requirements.md), [자산 자동화](../contexts/portfolio/modules/asset-automation/requirements.md), [배당](../contexts/portfolio/modules/dividends/requirements.md)

결정:

- 일반 자산 삭제는 Asset을 `deleted` 상태로 전환하는 논리 삭제로 처리한다.
- 목표 모델은 별도 자산 비활성화 기능을 제공하지 않는다. Canonical Asset은 `active`, `deleted`, `purging` 상태만 가지며, 영구 삭제 완료 뒤의 `purged`는 Asset 문서가 아니라 Purge Process의 복구 불가능한 종료 결과로만 남긴다.
- 기존 `isActive=false` 문서는 마이그레이션 Adapter에서 복구 가능한 `deleted` 상태로 해석한다. 다시 활성화해야 하면 일반 사용자가 아니라 관리자·승인된 운영 주체가 복구한다.
- 삭제된 Asset은 일반 목록·합계·시세 평가·자동 납입·상환·신규 배당 처리 대상에서 제외한다.
- Position과 position history, Asset history, Automation plan·execution, Dividend data 등 종속 데이터는 논리 삭제 시 제거하거나 변경하지 않는다.
- 일반 사용자에게 삭제 자산 목록·복구 버튼·복구 API capability를 제공하지 않는다. 삭제는 일상적인 상태 전환 기능이 아니며, 실수로 삭제한 경우 관리자·승인된 운영 주체가 감사 사유와 정확한 assetId를 지정한 `RestoreDeletedAsset` 운영 명령으로만 `active` 상태로 되살린다.
- 운영 복구는 기존 종속 데이터를 그대로 사용한다. 삭제 기간의 자동화 실행일은 소급하지 않고, 삭제 전에 이미 도래했지만 실패한 실행만 보존하며 복구일 이후 처음 도래하는 실행일부터 다시 시작한다. 복구일이 당월 실행일 이전·당일이면 당월, 이후이면 다음 달부터 재개한다.
- 기존 DividendEvent와 AnnualDividendProjection은 자산의 삭제 대상 종속 데이터가 아니라 가구의 배당 이력으로 본다. 자산 영구 purge도 이 데이터를 수정·재계산·삭제하지 않으며, 특히 이미 `paid`인 배당은 Asset 존재 여부와 무관하게 계속 조회할 수 있어야 한다.
- 시간 경과에 따른 자동 hard purge는 제공하지 않는다.
- 영구 삭제는 사용자가 별도로 요청했을 때만 관리자/에이전트가 `RequestPermanentAssetPurge`를 명시적으로 시작한다. 이 작업은 복구 불가능 확인 후 Holdings·Automation·Core의 paged purge Command를 조정하며 Dividends에는 purge Command를 보내지 않는다.
- `purging` 상태에서는 일부 종속 데이터가 이미 삭제됐을 수 있으므로 복구를 허용하지 않는다.

의도:

자산 삭제 오조작으로 장기간 축적한 보유종목·평가·자동화·배당 이력을 잃지 않게 하되, 삭제·복구를 일반 사용자가 반복하는 생명주기 기능으로 만들지 않는다. 별도의 DB 정리 요청 전까지 운영 복구 가능성을 보존한다.

영향 요구사항: AST-003, AST-006, AUTO-003, T-AST-002, T-AUTO-003.

<a id="dec-018"></a>
## DEC-018 시세 실패 시 평가와 공급자 장애 관측

> 상태: Accepted  
> 결정일: 2026-07-14  
> 정책 소유 Context: [Portfolio](../contexts/portfolio/requirements.md)  
> 영향 기능: [보유종목·시장 데이터](../contexts/portfolio/modules/holdings-market-data/requirements.md), [외부 연동·운영](../supporting-platform/modules/external-operations/requirements.md)

결정:

- 시세 갱신이 장기간 실패해도 마지막으로 성공한 Quote를 기간 제한 없이 평가에 사용한다. Quote의 원래 `observedAt`은 유지하고 새 시세처럼 갱신하지 않는다.
- 성공한 Quote가 한 번도 없는 Position만 기존 규칙대로 평균단가를 평가가로 사용한다.
- `NO_DATA`, `RETRYABLE_FAILURE`, `CONTRACT_FAILURE`, `INVALID_DATA`는 기존 Quote를 0원·고정 추정값·빈 성공으로 덮어쓰지 않는다.
- 모든 시세 조회 시도는 provider, operation, result kind, 안정 오류 code, attempt, latency, 관측 시각을 구조화 로그와 metric으로 남긴다. API key, 응답 원문, 가구 ID 원문과 보유수량은 기록하지 않는다.
- provider+operation별 `ProviderHealthState`에 `lastAttemptAt`, `lastSuccessAt`, `consecutiveFailedRuns`, `failureStartedAt`, `lastResultKind`, `lastErrorCode`, `alertState`를 저장해 일시적인 로그 검색 없이 현재 장애 지속 여부를 확인할 수 있게 한다. 같은 예약 실행 내부 HTTP 재시도는 실패 run 한 번으로 계산한다.
- `CONTRACT_FAILURE`, `INVALID_DATA`, 인증·설정 오류는 첫 실패에 즉시 경보한다. 추적 중인 Position의 예상 밖 `NO_DATA`와 `RETRYABLE_FAILURE`는 예약 갱신 3회 연속 실패 시 경보한다.
- 다음 성공은 연속 실패 수를 0으로 초기화하고 열린 경보를 해제하며, 실패 기간과 복구 시각을 구조화 로그로 남긴다.
- Cloud Monitoring의 장애 open 알림은 이메일 `minkue777@gmail.com`으로 보내고 복구 시 같은 channel로 resolved 알림을 보낸다. 주소는 코드에 하드코딩하지 않고 환경별 notification channel 배포 설정으로 관리한다.
- 운영 조회 `GetProviderHealth`는 관리자·운영 주체만 호출할 수 있으며 일반 사용자용 시세 화면 API와 분리한다.

의도:

오래된 마지막 정상 시세를 참고값으로 계속 제공하면서도, 실물 금·주식 등 외부 시세 API가 장기간 실패하는 상태를 운영자가 뒤늦게 발견하는 문제를 막는다.

영향 요구사항: MARKET-004, EXT-001, JOB-ERR-001.

<a id="dec-019"></a>
## DEC-019 FCM Firebase Installation ID 기반 전송

> 상태: Accepted  
> 결정일: 2026-07-14  
> 정책 소유 Context: [Notifications](../contexts/notifications/requirements.md)  
> 영향 기능: [푸시 알림](../contexts/notifications/modules/notifications/requirements.md), [PWA](../supporting-platform/modules/pwa/requirements.md), [Android Host](../supporting-platform/modules/android-host/requirements.md)

결정:

- 목표 알림 endpoint의 Firebase 전달 주소는 FCM registration token이 아니라 Firebase Installation ID(FID)다.
- Android는 FID 기반 등록을 활성화하고 `onRegistered(installationId)`로 받은 FID를 서버에 등록한다. Web/PWA는 `register()`와 `onRegistered()`를 사용한다.
- Cloud Functions는 단일 전송의 `fid`, 다중 전송의 `fids` 필드로 FCM에 요청한다. deprecated `token`·`tokens` 필드를 FID 전달 우회로 사용하지 않는다.
- FID는 로그인 사용자나 가구원을 증명하는 ID가 아니다. 인증된 `memberId`가 수신자 identity를 담당하고, FID는 해당 멤버의 현재 앱 설치로 전달하기 위한 주소로만 취급한다.
- 앱 재설치, 앱 데이터 삭제, 새 기기 복원 등으로 FID가 바뀌면 새 `onRegistered` 결과로 별도 endpoint를 등록한다. 이전 FID endpoint는 전송 결과가 `404 UNREGISTERED`이면 `inactive`로 전환한다. endpoint cardinality와 binding은 [DEC-020](#dec-020)을 따른다.
- Android cloud backup·device transfer에서 Firebase Installation persistence와 앱의 endpoint/session mirror를 제외하여 복원된 두 설치가 같은 FID를 공유하지 않게 한다. 복원된 앱은 새 설치로 등록한다.
- FID와 registration token API를 동시에 운영하지 않는다. 전환 배포 후 기존 `getToken`·`onNewToken`·`fcmTokens` writer와 token 기반 전송을 제거하며 registration token fallback을 제공하지 않는다.
- 기존 registration token에서 FID를 계산하거나 변환하지 않는다. 전환 후 각 Android/PWA 설치가 다시 등록될 때 해당 설치의 endpoint가 복구된다.
- FID 원문은 server-only 민감 전달 주소로 취급하여 공개 Read Model과 일반 로그에 노출하지 않는다.

의도:

Firebase의 최신 직접 전송 계약을 사용하고 폐기 예정인 registration token API를 목표 아키텍처에서 제거한다. 동시에 Firebase 식별자가 Access와 Ledger에 전파되지 않도록 `NotificationEndpoint`와 FCM Adapter 내부로 격리한다.

공식 계약 근거:

- [FCM registration 관리](https://firebase.google.com/docs/cloud-messaging/manage-tokens): `register/onRegistered`, FID 업로드·timestamp 갱신, invalid registration 처리
- [Firebase Admin Messaging](https://firebase.google.com/docs/reference/admin/node/firebase-admin.messaging): `FidMessage`, `fid/fids` 전송 계약
- [FCM backup restore 문제](https://firebase.google.com/docs/cloud-messaging/troubleshooting): Firebase Installation persistence 복원 충돌과 backup 제외 권고

기술 근거:

- [Firebase Android FID 등록](https://firebase.google.com/docs/cloud-messaging/android/get-started#access_the_firebase_installation_id)
- [Firebase Web FID 등록](https://firebase.google.com/docs/cloud-messaging/web/get-started#access_the_firebase_installation_id)
- [Firebase Admin SDK FID 직접 전송](https://firebase.google.com/docs/cloud-messaging/send/admin-sdk#send_messages_to_specific_devices)

영향 요구사항: PUSH-001, PUSH-002, PUSH-003, PUSH-008, PUSH-009.

<a id="dec-020"></a>
## DEC-020 멤버별 다중 FID endpoint와 binding 수명주기

> 상태: Accepted  
> 결정일: 2026-07-14  
> 정책 소유 Context: [Notifications](../contexts/notifications/requirements.md)  
> 영향 기능: [푸시 알림](../contexts/notifications/modules/notifications/requirements.md), [PWA](../supporting-platform/modules/pwa/requirements.md), [Android Host](../supporting-platform/modules/android-host/requirements.md)

결정:

- 한 가구 멤버는 Android와 iPhone 홈 화면 PWA의 활성 FID endpoint를 여러 개 가질 수 있으며, 수신 정책이 선택한 모든 활성 endpoint로 알림을 보낸다.
- 데스크톱 브라우저는 운영 조회 용도일 뿐 알림 대상이 아니다. 데스크톱에서는 FCM 등록·권한 요청·endpoint 생성·전송을 하지 않는다.
- 하나의 FID endpoint는 동시에 하나의 `(householdId, memberId)`에만 연결할 수 있다. FID는 멤버 소유 ID가 아니라 앱 설치 주소다.
- 별도의 멤버 전환용 endpoint 명령은 두지 않는다. 멤버를 바꾸려면 먼저 로그아웃하고 다른 멤버로 로그인하며, 로그아웃은 우리 서버의 endpoint 문서를 삭제하고 새 로그인은 현재 FID endpoint를 새로 등록한다. Firebase의 FID 자체는 삭제하지 않는다.
- Android 로그아웃은 네트워크 작업보다 먼저 `FcmService` component를 비활성화하고 이미 표시된 앱 알림을 취소한다. 이후 로컬 알림 억제 상태 저장, 서버 endpoint 삭제, Firebase Messaging 로컬 unregister를 유한 시간의 best-effort로 수행하되 어느 작업의 실패도 로그아웃을 막지 않는다. 서버 삭제와 unregister가 모두 실패해도 비활성 component가 notification payload의 Android 백그라운드 자동 표시 경로를 차단한다.
- Android가 로컬 세션 없이 시작되면 같은 component를 비활성 상태로 수렴시킨다. 다음 로그인은 이전 설치 unregister가 필요한 경우 이를 먼저 시도한 뒤 component를 활성화하고 FID를 등록하며, 서버 등록이 현재 household/member binding으로 확인된 뒤에만 foreground 표시를 허용한다. unregister는 네트워크 성공이 필요한 보조 정리 수단이지 로그아웃 알림 차단의 단독 근거가 아니다.
- 네트워크 중단 등으로 이전 로그아웃 삭제가 서버에 반영되지 않은 예외를 복구하기 위해, 로그인 등록은 동일 FID의 기존 binding이 남아 있으면 현재 인증·Membership을 검증한 뒤 그 binding을 현재 `(householdId, memberId)`로 원자적으로 교체한다. 이는 별도 사용자 기능이 아니라 등록 명령의 무결성 안전장치이며 두 멤버에 동시 연결된 상태를 허용하지 않는다.
- FCM 전송 결과가 `404 UNREGISTERED`인 경우에만 전송에 사용한 FID와 registration version이 아직 현재 값인지 확인한 뒤 endpoint를 `inactive`로 전환한다. 일시 장애, quota, timeout, payload·credential 오류는 endpoint를 비활성화하지 않는다.
- `inactive` endpoint는 즉시 hard delete하지 않는다. 같은 FID가 보존 기간 안에 다시 등록되면 새 registration version으로 `active` 복구할 수 있다. 보존 기간과 만료 정리는 후속 [DEC-027](#dec-027)을 따라 `inactiveAt`부터 30일 뒤 TTL 삭제 대상으로 표시한다.
- 재등록 때 FID가 같으면 주소는 유지하고 `lastConfirmedAt`, metadata와 registration version을 갱신한다. 새 FID이면 기존 활성 endpoint를 덮어쓰지 않고 별도 endpoint로 추가한다.
- 알림 delivery는 `(eventId, recipientMemberId, endpointId)`별로 한 번만 만들며, 로그아웃·새 로그인과 전송이 경합하면 전송 직전에 endpoint의 현재 binding과 version을 다시 검증한다.

채널별 결과:

- Android 알림 수집으로 생성한 지출은 생성자 멤버의 어떤 endpoint에도 푸시하지 않고 생성 기기에서 QuickEdit만 표시한다.
- iPhone Shortcut 지출은 생성자 멤버에게 연결된 활성 `ios-pwa` endpoint 모두에 편집 푸시를 보낸다.
- 명시적 `알림 보내기`는 요청자를 제외한 활성 가구원 각각의 모든 활성 Android·iPhone PWA endpoint에 보낸다.

의도:

앱 실행 순서에 따라 한 기기가 다른 기기의 알림 주소를 조용히 덮어쓰는 문제를 제거하고, Android와 iPhone을 함께 사용하는 멤버가 모든 활성 기기에서 예측 가능하게 알림을 받게 한다. endpoint와 멤버의 연결 수명주기는 Notifications 내부로 격리하여 Access와 Ledger schema에는 영향을 주지 않는다.

영향 요구사항: PUSH-001, PUSH-002, PUSH-003, PUSH-004, PUSH-005, PUSH-008, PUSH-009, PUSH-010.

<a id="dec-021"></a>
## DEC-021 Google 로그인·자기 가구원 생성·기존 가구 키 전환

> 상태: Accepted  
> 결정일: 2026-07-14  
> 정책 소유 Context: [Access & Household](../contexts/access-household/requirements.md)  
> 영향 기능: [가구와 접근](../contexts/access-household/modules/household-access/requirements.md)

신규 사용자 흐름:

- 일반 사용자는 Google 로그인으로만 앱에 접속한다. 가구 키를 입력해 로그인하는 신규 진입 경로는 제공하지 않는다.
- Google UID에 연결된 Membership이 하나도 없는 첫 방문자는 `초대 코드 입력` 또는 `새 가계부 생성` 중 하나를 선택한다.
- 새 가계부를 만드는 사용자는 가구 이름과 자기 표시 이름을 입력한다. 서버는 Household, 자기 Member, 일반 Membership을 한 transaction에서 생성한다. 생성자는 다른 활성 가구원보다 강한 household 권한을 갖지 않는다.
- 사용자는 다른 사람의 Member를 미리 생성할 수 없다. 각 Google Principal은 자기 Member만 생성하고 한 household 안에서 자기 Membership과 연결한다.
- 활성 가구원은 서버에서 초대 코드를 생성할 수 있다. 코드는 특정 Member를 미리 만들거나 지정하지 않고 household 가입 권한만 나타낸다.
- 초대 코드는 발급 후 5분 동안만 유효하고 한 Google Principal이 한 번 사용하면 즉시 만료된다. 서버는 충분히 추측하기 어려운 코드를 생성하고 원문 대신 hash, householdId, expiresAt, usedAt만 저장한다.
- 초대받은 사용자는 Google 로그인 후 유효한 코드를 입력하고 자기 표시 이름을 입력한다. 서버는 Invitation 소비, 자기 Member 생성, Membership 연결을 한 transaction에서 처리한다. 다른 Member를 선택하거나 생성할 수 없다.

기존 사용자 무중단 전환:

- 전환 배포는 기존 브라우저의 `localStorage.householdKey`, `currentMemberId`, `currentMemberName`을 삭제하기 전에 `LegacySessionCandidate`로 읽는다. householdKey와 currentMemberId가 모두 있는 완전한 Web localStorage 후보만 전환에 사용하며 Android Native `SharedPreferences`는 신원 복구 근거로 사용하지 않는다. 이 값은 장기 인증 자격이 아니라 최초 Google 계정 연결을 위한 일회성 migration 단서다.
- Web localStorage는 origin별로 격리되므로 migration client는 기존 운영 origin에서 먼저 배포한다. 기존 후보를 포착·연결하기 전에 도메인 변경, localStorage 초기화 또는 Android 앱 데이터 초기화를 선행하지 않는다.
- Google 로그인 뒤 이미 Membership이 있으면 서버 Membership을 우선하고 legacy 값은 인증에 사용하지 않는다.
- Membership이 없는 Google UID에 유효한 legacy householdKey와 currentMemberId가 있으면 사용자에게 기존 가계부·멤버 연결 확인을 보여준 뒤 `ClaimLegacyMembership`을 호출한다.
- 서버는 기존 Household와 Member가 존재하고 active이며 해당 Member가 아직 다른 UID에 연결되지 않았는지 검증한다. 성공하면 기존 memberId에 Google UID Membership을 원자적으로 연결한다. 거래·자산·카드 등 기존 데이터는 복사하거나 새 가구로 이동하지 않는다.
- localStorage가 없거나 householdKey/currentMemberId가 불완전·무효하면 기존 사용자를 추정하거나 Member 선택을 제공하지 않고 신규 사용자의 첫 방문 흐름으로 보낸다.
- 실제 기존 사용자가 localStorage를 잃은 예외는 일반 사용자 기능으로 복구하지 않는다. 소유자가 별도로 신원을 확인해 운영자·Agent에게 요청하면, 운영 작업이 Google UID와 정확한 기존 householdId·memberId를 지정하여 legacy claim과 같은 불변식으로 수동 연결할 수 있다. 이 작업은 사용자용 API·가구 키 입력 화면으로 노출하지 않고 감사 기록을 남긴다.
- 같은 Member가 이미 같은 UID에 연결돼 있으면 멱등 성공이고, 다른 UID에 연결돼 있으면 자동으로 덮어쓰지 않고 충돌·복구 흐름으로 보낸다. `currentMemberName`은 확인 표시용일 뿐 identity 증명으로 사용하지 않는다.
- 연결 성공 뒤 legacy householdKey 로그인 상태를 제거하고 이후 모든 접근은 Google ID token과 Membership으로 검증한다. householdId와 기존 memberId는 유지하므로 사용자는 이전에 보던 같은 가계부를 그대로 본다.
- legacy claim은 전환 기간에만 feature flag로 제공하고 새 사용자 화면에는 가구 키 입력을 노출하지 않는다. 전환 기간과 claim 사용 현황을 확인한 뒤 별도 배포로 claim endpoint를 종료할 수 있어야 한다.

의도:

새 구조에서는 한 사용자가 다른 사람의 가구원 identity를 대신 만들거나 선택하지 못하게 하면서, 현재 가구 키 기반 사용자는 데이터 이전이나 새 초대 없이 첫 Google 로그인만으로 기존 가계부와 자기 memberId를 이어받게 한다.

영향 요구사항: HH-001~009, HH-JOIN-001, ADM-002, SYS-001.

<a id="dec-022"></a>
## DEC-022 단일 partner 개념 제거

> 상태: Accepted  
> 결정일: 2026-07-15  
> 정책 소유 Context: [Notifications](../contexts/notifications/requirements.md)  
> 영향 기능: [가구와 접근](../contexts/access-household/modules/household-access/requirements.md), [푸시 알림](../contexts/notifications/modules/notifications/requirements.md), [거래 원장](../contexts/household-finance/modules/ledger/requirements.md), [Android Host](../supporting-platform/modules/android-host/requirements.md)

결정:

- 가구에는 단일 `partner` 역할이나 선택 상태를 두지 않는다. `partnerName`, `partnerMemberId`, partner 후보와 `PartnerSelectionPolicy`는 목표 모델에서 제거한다.
- Web localStorage와 Android SharedPreferences의 legacy `partnerName`은 새 Membership session의 신원·알림 대상 결정에 사용하지 않고 전환 완료 뒤 제거한다.
- 사용자가 지출에서 `알림 보내기`를 실행하면 Notifications가 서버의 활성 Membership을 기준으로 요청자를 제외한 모든 가구원의 모든 활성 모바일 endpoint를 계산한다.
- 가구원이 한 명뿐이면 `NoTarget(NO_OTHER_HOUSEHOLD_MEMBER)`이고, 두 명 이상이면 특정 한 명을 우선하거나 first-match로 선택하지 않는다.
- 기존 `notifyPartnerAt`, `notifyPartnerBy`, `partner-notification-requested` 명칭은 Legacy Mapper가 새 `HouseholdNotificationRequested.v1` 계약으로 한시적으로 변환하며 목표 schema·Command·Event 이름에는 사용하지 않는다.

의도:

2인 가구를 전제로 한 첫 번째 타인 선택을 제거하고, 가구원 수와 순서에 무관한 안정적인 멤버 ID·Membership 기반 수신자 정책을 유지한다.

영향 요구사항: HH-005, LED-007, PUSH-005, AND-005, QE-003.

<a id="dec-023"></a>
## DEC-023 업무 시간대 Asia/Seoul 고정

> 상태: Accepted  
> 결정일: 2026-07-15  
> 정책 소유: 공통 시스템 계약  
> 영향 기능: 거래 날짜, 정기 거래, 자동화, 통계, 배당·시세 Scheduler, 결제 parser

결정:

- 해외 사용자는 현재 제품 범위가 아니므로 가구별 timezone 설정·필드·변경 UI를 만들지 않는다.
- 거래의 회계일, `LocalDate`, `LocalTime`, `YearMonth`, 오늘·월 경계와 연도 추론의 기준 zone은 모두 IANA `Asia/Seoul`로 고정한다.
- 서버·외부 Provider의 절대 시각은 UTC `Instant`로 저장하고 업무 날짜가 필요할 때만 `Asia/Seoul`로 변환한다. UTC와 서울 현지 시각을 같은 필드로 대체하지 않는다.
- 모든 Scheduler는 명시적으로 `Asia/Seoul` timezone을 선언한다. 서버·브라우저·기기 기본 timezone에 의존하지 않는다.
- 테스트는 서울 자정 전후, 연말, 월말·윤년을 `FixedClock`으로 검증한다.

의도:

현재 국내 전용 가계부의 실제 사용 범위에 맞춰 불필요한 가구별 시간대 복잡성을 제거하고 Web·Android·Functions의 날짜 판정을 하나의 공통 계약으로 통일한다.

영향 요구사항: SYS-005, REC-002, IOS-004, ING-PARSE-001, STAT-001, JOB-DIV-001, JOB-AST-001.

<a id="dec-024"></a>
## DEC-024 Android 잠금 화면 QuickEdit 유지

> 상태: Accepted  
> 결정일: 2026-07-15  
> 정책 소유: 지원·플랫폼 / Android Host  
> 영향 기능: Android 자동 지출 등록 후 QuickEdit

결정:

- Android 자동 지출 등록 뒤 QuickEdit 조건이 충족되면 화면이 꺼져 있어도 켜고 잠금 화면 위에 QuickEdit Activity를 표시하는 현재 동작을 유지한다.
- 잠금 해제 전에도 가맹점, 금액, 카테고리, 메모 등 현재 QuickEdit 편집 정보를 별도 마스킹 없이 표시할 수 있다.
- 이 기능은 Android keyguard를 해제·우회하지 않는다. Activity 종료 뒤 기기는 계속 잠긴 상태여야 하며 `requestDismissKeyguard` 같은 잠금 해제 API를 호출하지 않는다.
- QuickEdit Activity는 외부 앱에 export하지 않고, 저장 완료된 거래 ID와 검증된 현재 session이 없으면 변경 Command를 실행하지 않는다.
- 사용자가 앱 진입 뒤 QuickEdit 자동 표시 설정을 끄면 잠금 화면 표시와 화면 켜기도 실행하지 않는다.

의도:

결제 직후 잠금을 풀지 않고도 빠르게 내용을 확인·수정하는 현재 사용성을 유지한다.

영향 요구사항: QE-001, QE-008, AND-001.

<a id="dec-025"></a>
## DEC-025 알림 endpoint별 단일 전송 시도

> 상태: Accepted  
> 결정일: 2026-07-15  
> 정책 소유 Context: [Notifications](../contexts/notifications/requirements.md)  
> 영향 기능: FCM 알림 전달·실패 처리

결정:

- 알림은 편의 기능이며 전달 누락을 완전히 방지하기 위한 복잡한 자동 재전송보다 단순한 구현을 우선한다.
- `(eventId, recipientMemberId, endpointId)` delivery마다 FCM 전송을 한 번만 시도한다. Outbox·Inbox Event가 재전달되어도 동일 delivery를 다시 전송하지 않는다.
- “한 번”은 Application이 해당 delivery에 대해 Firebase Admin `send`를 한 번 호출하고 결과 뒤 다시 호출하지 않는다는 의미다. SDK transport 내부의 불투명한 네트워크 동작까지 직접 HTTP client로 재구현해 제어하지 않는다.
- 성공은 `delivered`, `404 UNREGISTERED`는 기존 조건부 endpoint inactive와 `permanent-failure`, 응답을 받지 못한 timeout은 `unknown-provider-outcome`, quota·일시 network 오류는 `failed`, payload·credential 오류는 `contract-failure`로 최종 기록한다.
- timeout, quota, 일시 network 오류를 자동 재전송하지 않고 retry scheduler·backoff·클라이언트 `deliveryId` 중복 제거 기능을 만들지 않는다. `deliveryId`는 서버 멱등 key와 관측 식별자로만 사용한다.
- 전송 실패는 거래 저장을 롤백하지 않는다. 사용자가 `알림 보내기`를 다시 누르면 새 사용자 요청 Event와 새 delivery로 각각 한 번 전송할 수 있다.

의도:

알림 누락이 업무 데이터 손실로 이어지지 않는 현재 제품 성격에 맞춰 중복 표시 방지를 위한 복잡한 분산 재시도 기능을 피한다.

영향 요구사항: PUSH-005, PUSH-008, PUSH-010.

<a id="dec-026"></a>
## DEC-026 앱 내부 알림 종류별 설정 없음

> 상태: Accepted  
> 결정일: 2026-07-15  
> 정책 소유 Context: [Notifications](../contexts/notifications/requirements.md)  
> 영향 기능: Android·iPhone PWA 푸시 권한과 수신 정책

결정:

- 앱 내부에 알림 유형별 opt-in/opt-out, 멤버별 구독, 가구별 푸시 설정 UI를 만들지 않는다.
- 사용자는 Android·iPhone의 OS 알림 권한으로 해당 설치의 모든 푸시 표시를 켜거나 끈다. Notifications의 수신자 Policy는 별도 Subscription을 조회하지 않는다.
- iPhone 홈 화면 PWA는 OS 알림 권한이 허용된 경우에만 endpoint를 등록한다. Android의 FID endpoint와 OS 표시 권한은 기술적으로 분리될 수 있으며 권한이 꺼져 있으면 OS/Host가 표시하지 않는다.
- OS 알림 권한 변경만으로 서버 endpoint를 삭제하거나 inactive로 만들지 않는다. 권한을 다시 허용하면 같은 설치 endpoint를 사용할 수 있고, 로그아웃 때만 기존 endpoint 삭제 정책을 적용한다.
- Android QuickEdit 자동 표시 설정은 푸시 알림 설정이 아니므로 DEC-004·DEC-024에 따라 별도로 유지한다.

의도:

현재 필요한 알림 종류가 적고 알림 전달이 편의 기능인 점을 반영해 Subscription 모델과 설정 동기화 복잡성을 만들지 않는다.

영향 요구사항: PUSH-001, PUSH-004, PUSH-005, PUSH-007.

<a id="dec-027"></a>
## DEC-027 알림 기록 30일 보존

> 상태: Accepted  
> 결정일: 2026-07-15  
> 정책 소유 Context: [Notifications](../contexts/notifications/requirements.md)  
> 영향 기능: endpoint·Inbox·Intent·Delivery·command receipt 저장 수명주기

결정:

- 활성 NotificationEndpoint에는 시간 기반 TTL을 적용하지 않으며 로그아웃, 조건부 inactive, 새 로그인 binding 교체 또는 가구 영구 purge 정책을 따른다.
- `inactive` endpoint는 `inactiveAt`부터 30일, terminal 상태의 Notification Inbox·Intent·Delivery·command receipt는 `terminalAt`부터 30일 보존한 뒤 자동 삭제 대상으로 표시한다.
- queued·sending처럼 아직 terminal이 아닌 delivery는 삭제하지 않는다. DEC-025의 reconciliation이 결과 불명 상태를 포함한 terminal 결과로 마감한 뒤 30일 TTL을 시작한다.
- TTL 삭제는 정확한 시각의 업무 동작으로 기대하지 않고 `expiresAt` 이후 비동기 정리로 취급한다. 로그아웃 endpoint 삭제와 승인된 가구 영구 purge는 30일을 기다리지 않는다.
- 30일이 지난 업무 Event가 Inbox 삭제 후 다시 도착해도 새 알림을 만들지 않고 `ExpiredEvent`로 종료한다. 따라서 오래된 Event 재생으로 같은 알림을 다시 보내지 않는다.

의도:

편의 기능의 운영 확인에 충분한 짧은 기간만 기록을 남기고, 활성 기기 주소를 유지하면서 알림 이력과 비활성 endpoint의 무한 누적을 막는다.

영향 요구사항: PUSH-003, PUSH-008, PUSH-010.

<a id="dec-028"></a>
## DEC-028 자동 결제 입력은 호출자 본인 소유 등록 카드만 허용

> 상태: Accepted  
> 결정일: 2026-07-15  
> 정책 소유 Context: [Payment Capture](../contexts/payment-capture/requirements.md)  
> 영향 기능: Android·iPhone Shortcut 카드 승인 자동 등록

결정:

- Android와 iPhone Shortcut의 카드 승인 입력은 인증된 현재 멤버의 등록 카드 집합만 조회한다. 다른 가구원의 카드는 후보 조회와 일치 개수 계산에 참여시키지 않는다.
- 현재 멤버의 카드 중 카드사·번호 또는 허용된 wildcard 규칙으로 일치하는 카드가 하나 이상 있으면 지출을 등록할 수 있다. 같은 카드사에 대해 다른 가구원의 카드도 일치한다는 이유로 거부하지 않는다.
- 현재 멤버의 카드가 여러 개 일치해도 거래 생성 자체는 허용한다. 입력 증거로 특정 카드 하나를 확정할 수 없으면 저장 순서의 첫 카드를 임의 선택하지 않고 파싱된 카드 증거만 거래에 반영한다.
- 현재 멤버에게 일치 카드가 없으면 다른 멤버의 카드, 요청 body의 owner, FCM endpoint owner, 카드사 전체의 유일 owner로 대체하지 않고 거래·알림을 만들지 않는다.
- 성공한 자동 등록의 `creatorMemberId`는 인증된 현재 멤버이다. 레거시 owner 필드는 호환 입력으로만 읽으며 생성자나 카드 소유권을 바꿀 수 없다.
- 도시가스 청구는 카드 승인 입력이 아닌 별도 청구 parser이므로 기존 카드 매칭 예외를 유지한다.
- Android와 Shortcut은 같은 owner-scoped 카드 매칭 계약과 `T-CARD-001` fixture를 사용한다.

의도:

Shortcut도 Android와 같은 사용자 기대를 따르게 하면서, 한 가구에서 여러 사람이 같은 카드사의 번호 없는 카드를 등록한 정상 상황을 서로의 충돌로 오판하지 않는다.

영향 요구사항: CARD-004, ING-SAVE-003, ING-SAVE-004, IOS-005, IOS-007, IOS-010.

<a id="dec-029"></a>
## DEC-029 연도 없는 결제일은 현재보다 미래가 아닌 가장 가까운 연도로 추론

> 상태: Accepted  
> 결정일: 2026-07-15  
> 정책 소유 Context: [Payment Capture](../contexts/payment-capture/requirements.md)  
> 영향 기능: Android 알림 parser·iPhone Shortcut parser의 결제일 추론

결정:

- 연도 없이 월·일·시·분만 제공된 결제 시각은 [DEC-023](#dec-023)의 `Asia/Seoul` 기준 수신 시각보다 미래가 아닌 후보 중 가장 최근 시각으로 추론한다.
- 먼저 수신 시각의 연도로 월·일·시·분 후보를 만든다. 후보가 유효하고 수신 LocalDateTime과 같거나 이전이면 그 연도를 사용하고, 후보가 수신 시각보다 뒤면 전년으로 내린다.
- 2월 29일처럼 해당 연도에 존재하지 않는 날짜는 유효하면서 수신 시각보다 미래가 아닌 가장 가까운 과거 연도까지 내린다. 원문의 월·일·시·분 자체가 달력·시계상 불가능하면 추론하지 않고 입력 오류로 처리한다.
- 같은 날짜라도 원문 시각이 수신 시각보다 뒤면 미래 후보이므로 현재 연도를 선택하지 않는다. 별도의 미래 허용 오차는 두지 않는다.
- Android와 Shortcut은 `PaymentOccurrenceYearPolicyV1` 계약과 같은 `FixedClock` JSON fixture를 사용한다. 서버·기기 기본 timezone이나 채널별 별도 휴리스틱을 사용하지 않는다.

예시:

- 2027-01-01 수신 + `12/31` → 2026-12-31
- 2027-06-10 수신 + `06/09` → 2027-06-09
- 2027-06-10 수신 + `06/10` → 2027-06-10
- 2027-12-31 수신 + `01/01` → 2027-01-01이며 2028년 미래 날짜를 선택하지 않음

의도:

미래의 카드 결제가 미리 도착하지 않는다는 제품 가정을 명시하고, 연말·연초에 현재 연도를 무조건 붙여 미래 거래가 되는 오류를 Android와 Shortcut에서 같은 규칙으로 제거한다.

영향 요구사항: SYS-005, IOS-004, Android `PARSE-*`.

<a id="dec-030"></a>
## DEC-030 Shortcut 카드사 헤더가 없으면 입력 거부

> 상태: Accepted  
> 결정일: 2026-07-15  
> 정책 소유 Context: [Payment Capture](../contexts/payment-capture/requirements.md)  
> 영향 기능: iPhone Shortcut 카드 승인 parser

결정:

- Shortcut 결제 메시지에는 지원하는 카드사 헤더가 명시되어야 한다.
- 카드사 헤더가 없거나 지원 목록과 일치하지 않으면 `CARD_COMPANY_REQUIRED` 또는 `UNSUPPORTED_CARD_COMPANY`로 거부하고 거래·잔액·알림을 만들지 않는다.
- 헤더가 없을 때 삼성카드로 간주하는 현재 fallback은 `LegacyShortcutCardMessageParserV1` 특성화에만 남기고 목표 parser에서 제거한다.
- 카드사 헤더를 요청 body의 owner, 등록 카드 목록, FCM endpoint 또는 가구 내 유일 카드사로 추정하지 않는다.

의도:

근거 없는 삼성카드 분류로 다른 카드사의 지출이 잘못 등록되는 것보다 입력 누락을 명시적으로 거부하는 것을 우선한다.

영향 요구사항: IOS-003, IOS-010.

<a id="dec-031"></a>
## DEC-031 원거래 없는 취소는 무변경 종료하며 이후 승인을 차단하지 않음

> 상태: Accepted  
> 결정일: 2026-07-15  
> 정책 소유 Context: [Payment Capture](../contexts/payment-capture/requirements.md)  
> 영향 기능: Android 결제 취소 처리와 승인·취소 순서 역전

결정:

- 취소 알림 처리 시 완전히 일치하는 원거래가 없으면 `NotFound`로 종료하고 어떤 원장 데이터도 변경하지 않는다.
- 대기 중 취소, tombstone, 미래 승인 억제 key, 재조정 작업을 만들지 않는다.
- 이후 같은 결제의 승인 알림이 도착하면 일반 승인과 동일하게 검증하여 등록한다. 앞서 도착한 취소 알림을 근거로 저장을 막거나 자동 삭제하지 않는다.
- 결과적으로 실제로는 취소된 지출이 남을 수 있지만, 외부 알림이 승인보다 취소를 먼저 전달한 순서 역전은 가계부가 복구할 책임 범위로 보지 않는다.
- `NotFound`는 성공적인 취소로 표시하지 않으며 Android 완료 broadcast나 취소 성공 UI를 발생시키지 않는다.

의도:

드문 외부 알림 순서 역전을 복구하기 위한 보류·재조정 상태와 장기 억제 자료구조를 만들지 않고, 현재 원장에 존재하는 확실한 거래만 변경한다.

영향 요구사항: CAN-001, CAN-003, ING-SAVE-005.

<a id="dec-032"></a>
## DEC-032 Android 오프라인 결제 Queue는 암호화하여 최대 72시간 보존

> 상태: Accepted  
> 결정일: 2026-07-15  
> 정책 소유 Context: [Payment Capture](../contexts/payment-capture/requirements.md)  
> 영향 기능: Android 결제 observation의 로컬 대기·재전송·삭제

결정:

- Android는 parser가 만든 원문 없는 최소 `CaptureEnvelope.v1`을 서버 전송 전에 내구성 있는 로컬 Queue에 저장한다. 결제·잔액 관찰 중 하나 이상을 포함하되 알림 원문, 전체 카드 번호, FCM FID는 Queue에 넣지 않는다.
- 각 Queue entry는 `queuedAt`부터 최대 72시간 보존한다. 72시간 이상 지난 entry는 서버로 전송하지 않고 즉시 삭제하며 만료된 지출을 나중에 자동 등록하지 않는다.
- payload는 entry마다 고유한 IV를 사용하는 `AES-256-GCM`으로 암호화한다. 내보낼 수 없는 설치 전용 대칭키는 Android Keystore에 보관하고 백그라운드 WorkManager가 사용할 수 있도록 생체인증·화면 잠금 해제 조건을 요구하지 않는다.
- 서버 전송은 최초 observation의 동일한 idempotency key를 모든 재시도에서 사용한다. 네트워크·일시 서버 오류만 72시간 안에서 재시도한다.
- `confirmed`, `duplicate`, 영구 `rejected`, `needs-review`처럼 서버가 terminal 결과를 확정하면 entry를 즉시 삭제한다.
- 로그아웃, 멤버 변경, 가구 변경 시 해당 로컬 Queue를 즉시 전부 삭제한다. 다른 로그인 주체나 가구로 entry를 재연결하지 않는다.
- 키 손실·무효화·복호화 인증 실패가 발생하면 해당 entry를 전송하지 않고 삭제하며 원문 없는 오류 code만 기록한다. 앱 삭제·앱 데이터 삭제 시 Queue와 설치 전용 키는 운영체제 수명주기를 따른다.

의도:

일시적인 네트워크·서버 장애에는 결제 입력을 복구하되, 서버가 3일 이상 중단될 가능성 때문에 민감 후보를 장기간 보관하거나 오래된 지출이 뒤늦게 등록되는 복잡성을 만들지 않는다.

영향 요구사항: ING-008.

<a id="dec-033"></a>
## DEC-033 iPhone Shortcut은 사용자 전용 credential을 반자동으로 설치

> 상태: Accepted  
> 결정일: 2026-07-15  
> 보완일: 2026-07-20  
> 정책 소유 Context: [Payment Capture](../contexts/payment-capture/requirements.md)·[Access & Household](../contexts/access-household/requirements.md)  
> 영향 기능: iPhone Shortcut 인증·설치·재발급·폐기

결정:

- Google 로그인과 활성 Membership을 확인한 설정 화면에서 현재 uid·memberId·householdId와 `paymentCapture:submit` capability에만 묶인 Shortcut 전용 bearer credential을 발급한다.
- Shortcut 요청 body는 `householdId`, `createdBy`, `memberName`, `deviceOwner`, `owner`로 Actor나 가구를 선택하지 않는다. 서버는 credential claim과 현재 Membership으로 `creatorMemberId`와 householdId를 결정하며, 레거시 alias가 함께 오면 인증 근거로 사용하지 않는다.
- 공유 Shortcut은 안정된 endpoint, POST·JSON, Authorization header, version, 메시지 전달, 응답·오류 처리를 모두 포함한 완성품으로 제공한다. 웹의 `iPhone 단축어 연결`은 credential 원문을 클립보드에 복사하고 고정된 Shortcut 설치 링크를 연다. 사용자는 가져오기 질문에 한 번 붙여넣고 Shortcut을 추가한다.
- 결제 문자 수신을 감지해 Shortcut을 실행하는 iPhone 개인용 자동화는 기기 종속이므로 사용자가 한 번 직접 만든다. 제품은 `메시지를 받을 때 → 즉시 실행 → 설치된 가계부 Shortcut 실행` 절차를 안내한다.
- credential 원문은 발급 응답에서 한 번만 표시하고 서버에는 강한 단방향 hash, credentialId, scope, keyVersion, 상태, issuedAt, lastUsedAt만 저장한다. 로그·분석·HTTP 응답·오류에는 원문이나 일부 문자열을 남기지 않는다.
- 동일한 `IssueShortcutCredential` idempotency key가 재전송되면 새 credential을 만들거나 기존 원문을 다시 반환하지 않는다. 원문을 포함하지 않는 `AlreadyIssued(credentialId, credentialVersion)`만 재생한다. 최초 응답을 받지 못한 사용자는 새 idempotency key의 명시적 재발급을 실행하며, 새 credential 저장과 기존 활성 credential 폐기를 같은 원자적 경계에서 처리한다.
- credential에 정기 자동 만료를 두지 않는다. 사용자가 명시적으로 폐기하거나 재발급하면 즉시 무효화하고, 재발급은 기존 활성 credential을 같은 원자적 경계에서 폐기한다. Membership 상실·가구 논리 삭제도 매 요청 검증에서 즉시 사용을 막는다.
- PWA 로그아웃만으로 credential을 폐기하지 않는다. 자동화 자격은 웹 세션과 별도 수명주기를 가지며, 분실·기기 변경·설치 실패 시 로그인 후 명시적으로 폐기하거나 재발급한다.
- 기존 전역 공유 token은 목표 계약에서 제거한다. 호환 기간에는 별도 legacy route/adapter로만 격리하고 새 credential 설치 확인 뒤 운영 config로 종료하며, 새 route의 fallback으로 사용하지 않는다.

의도:

사용자가 복잡한 endpoint와 JSON을 직접 조립하지 않게 하면서도, 네이티브 iOS 앱 없이 가능한 범위에서 가구 키와 생성자 위조를 막고 키 유출 시 해당 사용자 자격만 독립적으로 폐기할 수 있게 한다.

영향 요구사항: IOS-001, IOS-010, IOS-012, IOS-013, T-IOS-SEC-002.

<a id="dec-034"></a>
## DEC-034 Google 계정당 하나의 가계부 Membership만 허용

> 상태: Accepted  
> 결정일: 2026-07-15  
> 정책 소유 Context: [Access & Household](../contexts/access-household/requirements.md)  
> 영향 기능: 첫 로그인·가계부 생성·초대 가입·legacy 연결·SessionScope

결정:

- 한 Google UID에는 전체 가계부를 통틀어 동시에 하나의 `PrincipalMembershipClaim`을 보유한 Membership만 허용한다. 같은 UID로 여러 가계부를 전환해서 사용하는 일반 사용자 기능은 제공하지 않는다. DEC-038의 `removed` Membership은 감사·복구용으로 남지만 claim을 보유하지 않는다.
- Membership이 이미 있으면 로그인 직후 해당 가계부를 바로 복원한다. 가계부 선택 화면, 활성 가계부 선택값, 일반 사용자용 가계부 목록·전환 UI를 만들지 않는다.
- 기존 Membership이 있는 UID의 `CreateHouseholdWithSelf`, `JoinHouseholdAsSelf`, `ClaimLegacyMembership`은 서버에서 충돌로 거부하며 기존 연결을 덮어쓰거나 합치지 않는다. 클라이언트 검사는 편의일 뿐이며 서버의 UID 전역 유일성 claim을 대체하지 않는다.
- 가계부 생성·초대 소비·legacy 연결은 UID 전역 Membership claim 생성과 같은 transaction에서 처리한다. 동시 생성·가입·claim 요청 중 하나만 성공하며 실패 요청은 Household·Member·Invitation 소비를 일부 남기지 않는다.
- 가구가 논리 삭제되어 접근할 수 없더라도 Membership claim을 자동 해제하거나 새 가계부 가입을 허용하지 않는다. 복구 가능한 가구가 다시 활성화됐을 때 두 Membership이 생기지 않게 한다. 일반 Member의 관리자 제거·복구와 claim 해제·재획득은 DEC-038이, 영구 purge 완료 뒤 남은 claim 해제는 DEC-040이 소유한다.
- 승인된 운영자·Agent의 신원 복구도 새 Membership을 하나 더 추가하지 않는다. 기존 claim이 잘못 연결된 경우 감사 기록과 함께 원자적으로 교정하며 업무 데이터는 이동·복사하지 않는다.

의도:

현재 제품 범위에서 가계부 전환 UI와 모든 Query의 활성 tenant 선택 복잡성을 만들지 않고, 로그인한 사용자의 가계부가 항상 하나로 결정되게 한다.

영향 요구사항: HH-001~008, HH-012, HH-JOIN-001, SYS-008.

<a id="dec-035"></a>
## DEC-035 종목 검색 카탈로그는 Cloud Storage 최근 성공 3일치와 인스턴스 메모리 캐시를 사용

> 상태: Accepted  
> 결정일: 2026-07-19  
> 정책 소유 Context: [Portfolio](../contexts/portfolio/requirements.md)·[지원 플랫폼](../supporting-platform/requirements.md)  
> 영향 기능: 국내·미국 주식·ETF·ETN 종목 카탈로그 갱신과 검색

결정:

- Firebase Scheduled Function이 매일 06:00 `Asia/Seoul`에 국내 주식·ETF·ETN과 미국 주식·ETF 공급자를 조회해 하나의 정규화된 일별 종목 카탈로그를 생성한다.
- 검증을 통과한 카탈로그는 Cloud Storage의 날짜별 immutable snapshot으로 먼저 업로드하고, schema version·object generation·checksum·종목 수·공급자 기준일을 가진 `latest` manifest를 마지막에 교체한다. 부분 생성물은 검색에 공개하지 않는다.
- Cloud Storage에는 **서로 다른 최근 성공일의 일별 snapshot 3개**만 유지한다. 같은 날짜의 멱등 재실행은 보존 개수를 늘리지 않는다. 새 성공일 snapshot과 `latest` 교체가 모두 성공한 뒤 네 번째 이전 성공일 snapshot을 정리하며, 갱신 실패일에는 기존 `latest`와 세 snapshot을 삭제하거나 이동하지 않는다.
- 마지막 성공 snapshot은 기간이 지났다는 이유만으로 검색에서 버리지 않는다. 갱신이 계속 실패해도 최신 성공본을 제공하고 `asOfDate`와 운영 Health 상태로 오래됨을 관측한다.
- 저장소에 번들된 `stocks.json`은 목표 검색 경로와 fallback에서 제거한다. Cloud Storage를 읽을 수 없는 cold start에서는 빈 성공이나 오래된 배포 파일로 대체하지 않고 명시적 `RetryableFailure`를 반환한다.
- 종목 검색 서버 함수는 함수 인스턴스별 모듈 메모리에 역직렬화한 snapshot을 최대 5분간 캐시한다. 5분 안에는 같은 객체를 재사용하고, 만료 후에는 작은 `latest` manifest만 다시 읽어 generation이 바뀐 경우에만 snapshot을 다시 내려받는다.
- 메모리 캐시는 공유 저장소·영속 저장소·정합성 근거가 아니다. 인스턴스 종료·cold start 때 사라져도 정상이며, 여러 인스턴스가 서로 다른 cache를 가져도 각자 manifest 확인을 통해 최대 5분 안에 최신 snapshot으로 수렴한다.
- cache 갱신 중 Storage 조회가 실패했지만 해당 인스턴스에 검증된 기존 cache가 있으면 그 cache를 stale 상태로 계속 제공한다. 기존 cache가 없는 인스턴스는 실패를 반환한다. 새 snapshot은 checksum·schema·종목 수 검증이 끝난 뒤 한 번에 cache reference를 교체한다.

의도:

배포 파일을 매일 수정하지 않고 국내·미국 전체 종목 목록을 자동 갱신하면서, Cloud Storage 요청·다운로드·JSON parsing을 검색 요청마다 반복하지 않는다. 캐시는 성능 최적화로만 두어 서버리스 인스턴스 수명과 무관하게 Cloud Storage snapshot이 단일 원본으로 남게 한다.

영향 요구사항: MARKET-003, MARKET-005, EXT-001, JOB-ERR-001.

<a id="dec-036"></a>
## DEC-036 일반 사용자에게 가구원 탈퇴 기능을 제공하지 않음

> 상태: Accepted  
> 결정일: 2026-07-19  
> 정책 소유 Context: [Access & Household](../contexts/access-household/requirements.md)  
> 영향 기능: Membership 수명주기·로그아웃·가구 삭제

결정:

- 일반 사용자용 `LeaveHousehold` 화면·Command·API를 제공하지 않는다.
- 로그아웃과 설치 endpoint 삭제는 세션·알림 주소만 정리하며 Membership과 Member를 종료·삭제하지 않는다. 다시 로그인하면 DEC-034의 같은 유일 Membership으로 복원한다.
- 가구 논리 삭제는 탈퇴의 우회 수단이 아니다. DEC-016에 따라 Household 접근만 차단하고 Membership·Member와 모든 업무 데이터를 보존하며, 복구 시 같은 연결을 사용한다.
- 사용자가 탈퇴할 수 없으므로 마지막 가구원 탈퇴에 따른 자동 가구 삭제나 관리자 이전 규칙을 만들지 않는다.
- 잘못 연결된 Google UID·Member의 운영 교정은 승인된 Agent의 감사 가능한 신원 복구 작업이며 일반 탈퇴 기능으로 노출하지 않는다.
- 다른 일반 가구원 강제 제거·복구는 DEC-038이, household owner 미도입은 DEC-039가, 영구 purge 완료 후 남은 UID claim 자동 해제는 DEC-040이 별도로 확정한다.

의도:

현재 제품에서 사용자가 가계부를 옮기거나 여러 가계부를 선택하는 기능을 만들지 않고, 실수로 접근권한과 기존 기록의 행위자 연결을 끊는 경로를 없앤다.

영향 요구사항: HH-004, HH-005, HH-010.

<a id="dec-037"></a>
## DEC-037 자산 명의자 프로필을 로그인 가구원과 분리

> 상태: Accepted  
> 결정일: 2026-07-19  
> 정책 소유 Context: [Access & Household](../contexts/access-household/requirements.md)·[Portfolio](../contexts/portfolio/requirements.md)  
> 영향 기능: 자산 명의자 관리·자산 생성/수정·명의자별 자산 필터와 Snapshot

결정:

- Google 로그인과 접근 권한을 가진 `Member/Membership`과 자산의 명의를 나타내는 `AssetOwnerProfile`을 분리한다. 아이처럼 Google 계정이 없는 사람은 `dependent` 명의자 프로필만 가지며 로그인·초대·권한·알림 대상이 되지 않는다.
- Google 로그인으로 생성·가입·legacy 연결되는 Member에는 안정적인 `memberId`와 연결된 `member` 명의자 프로필을 Access Context가 제공한다. 로그인 없는 명의자는 활성 가구원이 자산 화면에서 이름을 입력해 별도의 `dependent` 프로필로 추가한다.
- Asset은 이름이나 `memberId`를 소유자 외래 키로 저장하지 않고 `{ kind: 'household' }` 또는 `{ kind: 'profile', profileId }` 형태의 `ownerRef`를 저장한다. 공동 자산은 가짜 사람 프로필 대신 `household` 유형을 사용한다.
- 자산 도넛 그래프 위 필터는 `전체 / 명의자들 / +` 순서로 표시한다. 명의자들은 Member·dependent 유형이나 이름·내부 ID가 아니라 해당 가구의 명의자 목록에 들어온 시각 오름차순으로 제공한다. `+`는 이름 하나를 입력하는 명의자 추가 창을 열며 생성된 프로필은 자산 생성·수정의 명의자 선택지와 도넛 필터에 나타난다.
- 일반 자산 화면에는 명의자 삭제 기능을 제공하지 않는다. dependent 명의자 삭제는 서버가 검증한 관리자만 관리자 화면의 `ArchiveAssetOwnerProfile`로 수행하며, 일반 가구원의 API 직접 호출도 거부한다. 관리자 삭제도 물리 삭제가 아니라 논리 보관이므로 기존 Asset과 과거 Snapshot의 `profileId` 참조를 지우지 않는다. 보관 프로필은 신규 자산 선택지에서 제외하되 기존·과거 조회의 이름 해석에는 사용할 수 있다. Member 연결 프로필은 관리자도 별도로 삭제하지 않는다.
- 명의자 이름 변경은 profileId를 유지하는 별도 편집 동작이며 삭제 권한을 뜻하지 않는다. 일반 자산 UI는 `+` 추가·명의자 선택·이름 변경만 제공하고 삭제 버튼은 렌더링하지 않는다.
- 이름 변경은 프로필 ID를 유지하며 Asset·Snapshot을 순회 수정하지 않는다. 명의자별 합계와 Snapshot dimension key도 표시 이름이 아닌 `profileId`를 사용한다.
- 레거시 `assets.owner` 이름은 전환 mapping으로 옮긴다. 공동 소유 표식은 `household`로, 유일하게 일치하는 Member 이름은 해당 연결 프로필로, 그 밖의 아이·비로그인 이름은 dependent 프로필로 만든다. 같은 이름이 여러 후보와 일치하면 자동 추측하지 않고 운영 reconciliation 대상으로 남긴다.

의도:

Google 계정이 없는 아이도 자산 명의자가 될 수 있게 하면서 로그인 가구원 생성 규칙과 알림·권한 모델을 오염시키지 않는다. 안정적인 프로필 ID를 사용해 이름 변경과 보관이 자산 데이터의 연쇄 수정이나 과거 통계 손실로 번지는 것도 막는다.

영향 요구사항: HH-011, AST-009.

<a id="dec-038"></a>
## DEC-038 다른 가구원 강제 제거는 전체 관리자만 수행

> 상태: Accepted  
> 결정일: 2026-07-19  
> 정책 소유 Context: [Access & Household](../contexts/access-household/requirements.md)·[Notifications](../contexts/notifications/requirements.md)  
> 영향 기능: Membership 강제 제거·복구, UID claim, 자산 명의자 프로필, 알림 endpoint

결정:

- 가구 생성자를 포함한 모든 일반 가구원에게 다른 가구원을 강제로 제거하거나 복구하는 UI·Command·API를 제공하지 않는다. 서버가 검증한 전체 관리자만 관리자 화면에서 `RemoveHouseholdMember`와 `RestoreRemovedHouseholdMember`를 실행할 수 있다.
- 강제 제거는 물리 삭제가 아니다. 대상 Member와 Membership을 `removed` 상태로 전환하고 제거 시각·관리자·사유·version을 감사 가능한 서버 상태로 보존한다. 기존 거래·자산·카드·작성자·배당 기록을 수정하거나 삭제하지 않는다.
- 제거 transaction에서 대상 Google UID의 `PrincipalMembershipClaim`을 해제하여 해당 사용자가 새 가계부를 만들거나 다른 초대를 받을 수 있게 한다. 복구할 때는 UID에 다른 활성 Membership claim이 없어야 하며, 이미 다른 가계부에 가입했다면 자동으로 빼앗거나 합치지 않고 충돌로 거부한다.
- 제거된 Member에 연결된 `member` 자산 명의자 프로필은 `archived`로 전환해 신규 자산 선택에서 제외하지만 기존 Asset과 과거 Snapshot의 profileId·표시 이름은 유지한다. 관리자 복구가 성공하면 같은 memberId·profileId를 다시 active로 되돌린다.
- Access는 제거와 같은 Unit of Work에 `HouseholdMemberRemoved.v1`을 기록한다. 제거된 Membership은 즉시 모든 ActorContext·로그인 복원·초대·알림 수신 대상 판정에서 제외한다.
- Notifications는 제거 Event를 멱등 소비해 해당 householdId·memberId에 연결된 모든 endpoint를 정리한다. Event 처리가 끝나기 전에도 recipient 계산과 전송 직전 검증에서 active Membership을 재확인하므로 제거된 사용자에게 새 푸시를 보내지 않는다. 복구 시 과거 endpoint를 되살리지 않고 다음 로그인·설치 등록으로 새 endpoint를 만든다.
- 제거된 Membership은 관리자가 복구할 수 있다. 복구는 같은 Member·Membership·명의자 프로필을 재사용하고 별도 사람이나 과거 데이터를 복제하지 않는다.
- household owner 역할은 두지 않는다. 생성자도 다른 Member와 같은 조건으로 제거·복구할 수 있으며, 영구 household purge 완료 후 남은 UID claim은 DEC-040의 finalization에서 자동 해제한다.

의도:

잘못 초대된 사용자나 더 이상 접근하면 안 되는 사용자를 관리자만 차단할 수 있게 하되, 실수로 제거해도 기록과 신원 연결을 복구할 수 있도록 한다. 접근 차단과 과거 금융 기록 보존을 분리하고, 알림 endpoint의 비동기 정리 중에도 제거된 사용자가 수신자로 다시 선택되지 않게 한다.

영향 요구사항: HH-012, PUSH-012.

<a id="dec-039"></a>
## DEC-039 가계부 owner 역할을 두지 않음

> 상태: Accepted  
> 결정일: 2026-07-19  
> 정책 소유 Context: [Access & Household](../contexts/access-household/requirements.md)  
> 영향 기능: 가계부 생성, Membership 권한, 가구원 제거·복구, 관리자 capability

결정:

- 가계부를 만든 사람에게 별도의 `owner` role이나 추가 household capability를 부여하지 않는다. 생성자는 생성 사실만 남을 수 있으며 권한 판정에서는 다른 활성 가구원과 동일하다.
- 모든 활성 Household Membership은 같은 일반 가구원 권한을 가진다. 초대 코드 발급, 자기 이름 변경, 업무 데이터 접근처럼 일반 사용자에게 허용된 기능은 생성 여부와 무관하게 동일하다.
- 가구원 제거·복구, dependent 명의자 논리 보관, 가구 삭제·복구·영구 purge 같은 운영 작업은 household role이 아니라 서버가 검증한 전체 관리자 capability로만 수행한다.
- 전체 관리자는 생성자를 포함한 어떤 활성 Member도 DEC-038의 복구 가능한 방식으로 제거할 수 있다. 마지막 활성 Member를 제거해도 Household를 자동 삭제하거나 purge하지 않고, 빈 가구 상태와 모든 데이터를 보존해 관리자 복구를 허용한다.
- Membership에 household role을 저장하지 않는다. 전체 관리자·SystemActor의 권한은 Membership 필드가 아니라 인증된 principal에 서버가 부여한 별도 capability에서 계산한다.

의도:

현재 코드와 사용자 경험에는 가계부 생성자만 수행하는 기능이 없다. 의미 없는 owner를 추가해 이전·마지막 owner·권한 승계 규칙을 만들지 않고, 일반 가구원과 전체 관리자라는 실제 권한 경계만 모델링한다.

영향 요구사항: HH-007, HH-008, HH-012, ADM-002.

<a id="dec-040"></a>
## DEC-040 영구 가구 purge 완료 후 UID Membership claim 자동 해제

> 상태: Accepted  
> 결정일: 2026-07-19  
> 정책 소유 Context: [Access & Household](../contexts/access-household/requirements.md)  
> 영향 기능: HouseholdPurgeProcess, PrincipalMembershipClaim, 가구 영구 삭제 최종화

결정:

- 가구가 `deleted`이거나 영구 purge가 `purging`인 동안에는 해당 가구의 남은 `PrincipalMembershipClaim`을 해제하지 않는다. 복구 가능 상태나 부분 삭제 상태에서 사용자가 다른 가구에 가입하도록 만들지 않는다.
- `deleted → purging` 전환 뒤 Process Runner가 현재 해당 가구를 가리키는 claim을 결정적 page로 읽어 server-only `(claimKey, membershipId, claimVersion)` snapshot을 먼저 완성한다. `purging` 동안 Membership·claim을 바꾸는 일반 명령은 거부하며, snapshot이 완료되기 전에는 업무 Context purge를 시작하지 않는다.
- Household Finance, Payment Capture, Portfolio, Notifications와 Access의 household-scoped purge checkpoint가 모두 `PurgeCompleted`가 된 뒤에만 Access의 claim finalization 단계를 시작한다.
- finalization은 claim의 현재 householdId, membershipId와 version이 대상 purge snapshot과 일치할 때만 조건부 삭제한다. 이미 DEC-038의 Member 제거로 claim이 없으면 멱등 성공이며, 다른 값으로 바뀐 claim을 삭제하지 않는다.
- claim 수가 transaction 한도를 넘을 수 있으므로 결정적 page와 checkpoint로 해제한다. 이 단계가 중단되면 완료된 page를 되돌리지 않고 남은 claim부터 재개한다. 모든 업무 데이터 purge는 이미 완료됐으므로 먼저 해제된 사용자가 새 가계부에 가입해도 옛 가구 데이터와 이중 접근이 생기지 않는다.
- 모든 대상 claim page 해제와 Access 최종 정리가 끝난 뒤에만 Household를 `purged`로 확정하고 `HouseholdPurged.v1`과 완료 receipt를 같은 최종 Unit of Work에 기록한다.
- 최종 완료 뒤 사용자는 일반 첫 방문자로서 새 가계부를 만들거나 초대 코드로 다른 가계부에 가입할 수 있다. 과거 Membership·Member·endpoint를 자동 복구하거나 새 가구로 옮기지 않는다.

의도:

논리 삭제의 복구 가능성과 영구 삭제의 최종성을 분리한다. 부분 purge 중 claim을 먼저 풀어 두 가구 연결이나 잔존 데이터 접근을 만들지 않으면서, 실제 영구 삭제가 끝난 사용자를 운영 작업 없이 정상적인 신규 가입 상태로 되돌린다.

영향 요구사항: ADM-003, HH-010.

<a id="dec-041"></a>
## DEC-041 결제 취소 시 원본과 모든 파생 지출 자동 삭제

> 상태: Accepted  
> 결정일: 2026-07-19  
> 정책 소유 Context: [Payment Capture](../contexts/payment-capture/requirements.md)  
> 영향 기능: 취소 후보 판정, capture lineage, Ledger 분할·합치기·취소

결정:

- 자동 등록 승인 거래는 사용자 수정·항목 분할·월 분할·합치기 전후에도 immutable `captureLineageId`와 원본 거래를 보존한다. 구조 변경 중 원본 지출은 물리 삭제하지 않고 일반 조회·집계에서 제외되는 `superseded` 상태로 남겨 원복과 취소 추적에 사용한다.
- 취소 알림이 DEC-012의 금액·정규 가맹점·카드 완전 일치와 후보 유일성 검증을 통과하면 별도 사용자 확인 없이 해당 승인 lineage의 원본, 현재 활성 지출, 중간 변환 snapshot과 모든 분할·수정·합치기 파생 지출을 한 Ledger Unit of Work에서 삭제한다.
- 취소 대상 lineage가 다른 승인 lineage와 합쳐진 파생 거래에 포함되어 있으면 합쳐진 파생 거래를 제거하되, 취소 대상이 아닌 원본·lineage는 삭제하지 않고 같은 Unit of Work에서 유효한 거래 형태로 복원한다. 한 승인 취소가 다른 결제까지 삭제해서는 안 된다.
- 취소 삭제는 전부 성공하거나 전부 실패한다. 대상 중 하나라도 누락되거나 version이 바뀌었거나 원자 처리 한도를 넘으면 어떤 지출도 삭제·복원하지 않고 typed 실패를 반환한다.
- 취소 완료 뒤에는 해당 지출 계보를 사용자 원복 대상으로 제공하지 않는다. 다만 같은 취소 재전송과 같은 승인 재수집이 지출을 다시 만들지 않도록 금융 내역이 아닌 최소 cancellation receipt와 dedup tombstone은 보존한다. tombstone에는 lineageId·fingerprint hash/version·canceledAt·receipt reference만 두고 금액·가맹점·카드·메모·원본 또는 파생 snapshot은 남기지 않는다.
- 완전 일치하는 원거래가 없으면 DEC-031처럼 아무 작업도 하지 않는다. 완전 일치 후보가 여러 개여서 유일하지 않으면 임의 삭제하지 않고 `NeedsConfirmation`을 유지한다.

의도:

분할·수정 때문에 카드 취소가 가계부에 남는 문제를 막되, 관련 없는 다른 결제까지 연쇄 삭제하지 않는다. 취소 전에는 원본을 보존해 구조 변경을 원복할 수 있고, 실제 취소가 확인된 뒤에는 사용자에게 보이는 원본·파생 지출을 모두 제거해 원장 합계가 카드사의 최종 결과와 일치하게 한다.

영향 요구사항: LED-008, LED-009, SPL-001, SPL-003, MRG-001, MRG-002, ING-SAVE-007, CAN-007.

<a id="dec-042"></a>
## DEC-042 가맹점 규칙은 좁은 match type 우선, 포함 규칙은 고유 우선순위 적용

> 상태: Accepted  
> 결정일: 2026-07-19  
> 정책 소유 Context: [Payment Capture](../contexts/payment-capture/requirements.md)  
> 영향 기능: MerchantRuleSet, 가맹점 mapping, Web 규칙 설정

결정:

- 가맹점 규칙은 숫자 우선순위보다 match type의 범위가 좁은지를 먼저 비교한다. 평가 순서는 `exact → startsWith → endsWith → contains`이며, 더 좁은 유형에서 하나라도 일치하면 더 넓은 유형은 평가 결과에서 제외한다.
- `exact` 규칙은 우선순위를 사용하지 않는다. 같은 가구에서 정규화된 exact 키워드 하나는 규칙 하나에만 속할 수 있으며, 쉼표 OR 표현이 달라도 개별 exact 키워드가 겹치면 중복으로 거부한다.
- `contains`를 포함한 non-exact 규칙은 서로 겹치는 키워드를 허용한다. 같은 match type 안에서는 비활성 규칙까지 포함한 모든 미삭제 규칙의 우선순위가 서로 달라야 하며, 여러 활성 규칙이 일치하면 가장 높은 숫자 우선순위 하나만 적용한다. `startsWith`와 `endsWith`에도 같은 유형별 고유 우선순위 규칙을 적용한다.
- 규칙 생성·수정은 exact keyword claim 또는 `(householdId, matchType, priority)` claim과 규칙 본문을 한 transaction에서 생성·교체한다. 중복 exact 키워드나 우선순위는 `Duplicate`/`PriorityConflict`로 거부하고 기존 규칙을 변경하지 않는다.
- 사용자가 non-exact 규칙 순서를 변경하면 해당 match type의 전체 rule ID 집합과 version을 검증하고 한 transaction에서 고유 우선순위로 재번호한다. 일부 규칙만 갱신하거나 중간 동률 상태를 노출하지 않는다.
- canonical 데이터에서는 완전 동률이 만들어질 수 없다. 레거시·손상 데이터에 exact token 또는 우선순위 충돌이 있으면 저장소 반환 순서나 ruleId로 임의 승자를 고르지 않고 `ContractFailure(MERCHANT_RULE_CONFLICT)`로 mapping을 적용하지 않는다.

의도:

`스타벅스` 정확 일치처럼 구체적인 규칙이 `스타` 포함 규칙보다 항상 우선하게 하면서, 여러 포함 규칙이 겹치는 정상 상황은 사용자가 정한 명시적 우선순위로 결정한다. 저장소 조회 순서나 생성 시각이 결제 분류 결과를 바꾸지 않게 한다.

영향 요구사항: MER-002, MER-004.

<a id="dec-043"></a>
## DEC-043 미지급 배당은 최신 공시로 덮어쓰고 지급 완료 배당은 불변 유지

> 상태: Accepted  
> 결정일: 2026-07-19  
> 정책 소유 Context: [Portfolio](../contexts/portfolio/requirements.md)  
> 영향 기능: DividendEvent 식별·정정·취소, lifecycle sweep, AnnualDividendProjection

결정:

- 공급자가 같은 공시를 정정하면 `announced`와 `fixed` 상태의 미지급 `DividendEvent`는 날짜·주당금액 등 현재 공시 값을 최신 값으로 덮어쓴다. 이전 공시 값, revision 문서, superseding correction Event는 보관하지 않는다.
- Event 식별자는 금액·기준일·지급일처럼 정정될 수 있는 값이 아니라 `source + sourceDisclosureId`의 안정적인 공급자 공시 식별자를 사용한다. 공급자가 새 공시 ID로 정정하더라도 원 공시를 가리키는 명시적 correction reference가 있을 때만 같은 Event로 연결하며, 연결 근거가 없으면 임의로 추정하지 않는다.
- 기준일 또는 주당금액이 바뀐 `fixed` Event는 새 공시와 Position history를 기준으로 적격 수량·증거·총액을 다시 계산한 뒤 같은 Event를 원자적으로 교체한다. 재계산에 실패하면 기존 값을 부분 변경하지 않고 재시도한다.
- 공급자가 지급 전에 공시의 취소·삭제 상태를 명시하면 해당 미지급 Event를 삭제하고 Annual Projection에서도 제거한다. 단순 `NoData`, timeout, HTML 변경 또는 공급자 실패를 취소로 간주하지 않는다.
- `paid` Event는 지급 완료 시점의 금융 이력으로서 불변이다. 이후 정정·취소·삭제 공시가 관찰되어도 값이나 상태를 변경하거나 삭제하지 않는다.
- 기존 nonterminal Event는 원천 Asset·Holding의 삭제 여부와 독립적으로 lifecycle sweep을 계속한다. 신규 공시 discovery만 active Asset으로 제한하며, 기존 `announced` Event의 확정은 보존된 Event와 Position history로 진행한다.

의도:

아직 받지 않은 배당은 사용자가 보게 될 최신 공시와 일치시키되, 같은 공시의 과거 값을 별도 이력으로 쌓지 않아 모델과 운영 복잡도를 줄인다. 반면 이미 받은 배당은 이후 공시 변동 때문에 과거 자산·수익 기록이 바뀌지 않게 한다. 공급자 장애와 실제 공시 취소를 분리해 일시적인 수집 실패가 배당 기록 삭제로 이어지는 것도 막는다.

영향 요구사항: DIV-003, DIV-004, DIV-006, JOB-DIV-001.

<a id="dec-044"></a>
## DEC-044 지역화폐 잔액은 음수 전용 정책 없이 정수 관찰값으로 처리

> 상태: Accepted  
> 결정일: 2026-07-19  
> 정책 소유 Context: [Household Finance](../contexts/household-finance/requirements.md)  
> 영향 기능: LocalCurrencyBalance 금액 검증과 표시

결정:

- 지원하는 지역화폐에서 음수 잔액이 정상적으로 관찰되는 경우는 제품 고려 대상에서 제외한다.
- Local Currency Domain은 잔액이 원 단위 정수인지만 검증하며 음수 전용 거부, 0원 보정, 마지막 정상값 대체 또는 이상 상태를 추가하지 않는다.
- 예상 밖의 음수 정수 관찰이 들어오더라도 다른 정수와 같은 방식으로 최신 관찰값을 저장·조회한다. UI도 음수 전용 경고나 별도 표시 상태를 만들지 않는다.

의도:

발생하지 않는 것으로 보는 경계값을 위해 별도 정책·상태·UI를 추가하지 않는다. 동시에 저장 계층이 임의로 값을 0원이나 과거 값으로 바꾸지 않게 해 관찰 데이터의 의미를 유지한다.

영향 요구사항: BAL-003, BAL-004.

<a id="dec-045"></a>
## DEC-045 Android QuickEdit 화면 캡처를 차단하지 않음

> 상태: Accepted  
> 결정일: 2026-07-19  
> 정책 소유 영역: [지원·플랫폼](../supporting-platform/requirements.md)  
> 영향 기능: Android Host, 잠금 화면 QuickEdit

결정:

- QuickEdit Activity에 `FLAG_SECURE` 또는 이에 준하는 스크린샷·화면 녹화 차단을 적용하지 않는다.
- 사용자는 잠금 화면 위 QuickEdit을 포함해 QuickEdit 화면을 캡처하거나 화면 녹화할 수 있다. 최근 앱 미리보기도 별도 마스킹 대상으로 만들지 않는다.
- 이 결정은 [DEC-024](#dec-024)의 잠금 화면 표시 허용을 유지하는 선택이다. keyguard를 해제·우회하지 않고 Activity를 외부에 export하지 않으며, 유효 거래 ID와 현재 session을 검증하는 보안 경계는 그대로 유지한다.
- 앱이 가맹점·금액·메모 같은 QuickEdit 값을 logcat, crash breadcrumb, analytics 등에 기록하지 않는 규칙도 그대로 유지한다.

의도:

개인 사용 중심의 현재 위협 모델에서는 사용자의 정상적인 화면 캡처까지 막을 필요가 없고, `FLAG_SECURE`가 제공하는 보호보다 사용 제약과 구현 복잡도가 더 크다고 판단한다. 캡처 허용과 외부 앱의 임의 Activity 진입·앱 자체 로그 유출 금지는 별개의 보안 경계로 유지한다.

영향 요구사항: QE-008, QE-011.

<a id="dec-046"></a>
## DEC-046 처리·운영 기록은 성격별로 30일·해결 시점·업무 수명주기를 적용

> 상태: Accepted  
> 결정일: 2026-07-19  
> 정책 소유 영역: [지원·플랫폼](../supporting-platform/requirements.md)  
> 영향 기능: 공통 UoW, Outbox/Inbox, External Operations, Asset Automation, Delivery Assurance

결정:

- 정상 terminal command receipt, 모든 필수 consumer 전달을 마친 Outbox와 terminal Inbox/dispatch receipt, 완료된 JobRun·target receipt는 terminalAt부터 30일 보존한 뒤 TTL 정리 대상으로 표시한다.
- pending·retrying Outbox, 처리 중 Inbox, 부분 완료·실행 중 JobRun과 unresolved dead letter는 자동 삭제하지 않는다. 해결·폐기 승인으로 terminal이 된 시점부터 30일을 계산한다.
- `AutomationExecution`은 운영 로그가 아니라 자산 금액 변경을 설명하는 업무 이력이다. Plan 비활성·삭제나 Asset 논리 삭제로 지우지 않고, 해당 Asset 또는 가구의 별도 수동 영구 purge가 실행될 때만 소유 participant가 제거한다.
- release manifest와 artifact·contract·Rules·index hash, 배포 대상·결과·rollback 근거는 자동 TTL 없이 장기 보존한다. Secret 원문은 처음부터 기록하지 않는다.
- Notifications의 endpoint·delivery·Inbox 보존은 기존 [DEC-027](#dec-027)을 따른다. Capture fingerprint claim, cancellation tombstone, recurring/automation execution claim처럼 업무 중복 방지와 금융 이력에 필요한 기록은 일반 terminal receipt로 분류하지 않고 해당 Aggregate·수동 purge 수명주기를 따른다.
- 30일은 `expiresAt`을 계산하는 정책값이다. TTL 정리 지연은 허용하지만 만료 전 삭제는 금지한다. 종류별 문서 수·용량, unresolved age, TTL backlog를 운영 metric으로 남긴다.
- Domain·계약에서는 시각을 ISO 8601 문자열로 표현하되 Firestore의 물리 `expiresAt`은 TTL 서비스가 인식하는 `Timestamp`로 저장한다. Adapter가 양방향 변환을 소유하며 전환 전 문자열 문서는 [Firestore TTL 전환 Runbook](../../operations/firestore-ttl-backfill.md)의 dry-run·plan hash 승인 절차로 변환한다.

의도:

재시도에 필요한 짧은 운영 기록은 Android Queue의 최대 72시간보다 충분히 오래 유지하면서 무한 증가를 막는다. 해결되지 않은 작업과 금융 결과의 근거는 시간만으로 잃지 않고, 작은 배포 이력은 장기 추적과 rollback 판단에 활용한다.

영향 요구사항: JOB-ERR-001, JOB-ERR-002, AUTO-001, AUTO-002, REL-003, REL-004, ING-009.

<a id="dec-047"></a>
## DEC-047 notification_debug_logs는 기능 제거 전까지 전부 보존

> 상태: Accepted  
> 결정일: 2026-07-19  
> 정책 소유 Context: [Payment Capture](../contexts/payment-capture/requirements.md)  
> 영향 기능: Android Diagnostic Adapter, 임시 금융 알림 원문 보존

결정:

- `notification_debug_logs`에는 시간 기반 TTL과 자동 개별 삭제를 적용하지 않는다. 기존 문서와 앞으로 수집되는 진단 문서는 진단 기능 자체를 제거할 때까지 전부 보존한다.
- 파서 개선에 필요한 현재 진단 필드인 package·source·title·text·bigText·textLines·fullText·발생 시각과 actor scope를 유지한다. 중복이라는 이유만으로 기존 문서를 축약·표본화·삭제하지 않는다.
- 수집은 인증된 household·member와 등록된 진단 대상 source에만 허용하고 읽기는 관리자·진단 역할로 제한한다. 인증 token, FCM FID, 가구 접근 자격 같은 별도 Secret을 진단 문서에 추가하지 않는다.
- 진단 저장은 계속 best-effort이며 실패가 결제·잔액·QuickEdit 결과를 바꾸지 않는다. 원문은 Domain, Queue, receipt, Outbox, 영구 감사 모델로 전달하지 않는다.
- 파서가 안정되어 [DEC-002](#dec-002)의 제거 조건이 충족되면 Android Writer, Rules, index와 `notification_debug_logs` 컬렉션 전체를 한 제거 작업 범위로 정리한다. 일부 문서만 먼저 TTL 삭제하는 중간 단계는 두지 않는다.
- 이 기록은 DEC-046의 일반 terminal 운영 기록 30일 TTL에 포함되지 않는 임시 기능 단위 예외다. 장기 제품 데이터로 승격된다는 뜻은 아니다.

의도:

현재는 파서 개선을 위해 과거 원문 전체가 유용하므로 보존 기간을 임의로 잘라 분석 자료를 잃지 않는다. 대신 접근 경계를 강화하고, 진단 기능이 불필요해지는 시점에는 데이터와 수집 경로를 부분적으로 남기지 않고 함께 제거한다.

영향 요구사항: ING-005.

<a id="dec-048"></a>
## DEC-048 홈·예산·통계는 조회 시 계산하고 자산 차트 공백은 직전 스냅샷을 유지

> 상태: Accepted  
> 결정일: 2026-07-19  
> 정책 소유 영역: [지원·플랫폼](../supporting-platform/requirements.md), [Household Finance](../contexts/household-finance/requirements.md), [Portfolio](../contexts/portfolio/requirements.md)  
> 영향 기능: Position history, 월 예산·홈·지출 통계 조회, 자산 이력 차트

결정:

- Position history는 정상 화면 조회의 주 원천으로 사용하지 않지만 자동 TTL 없이 계속 보존한다. 배당 확정 시 적격 수량과 근거를 `DividendEvent`에 저장하고, 자산 차트는 23:55 일일 `AssetSnapshot`을 사용한다. Position history는 복구·감사·재구축용으로만 읽으며 해당 Asset 또는 가구의 별도 수동 영구 purge에서만 제거한다.
- 월 예산, 홈 요약, 지출 통계는 별도의 영속 Projection을 만들지 않는다. 요청 시 각 소유 모듈의 Canonical Query를 기간 조건으로 조회해 계산한다. 자산 일일 Snapshot과 연간 배당 Projection처럼 이미 명확한 생성 시점과 단일 Writer가 있는 조회 모델은 이 규칙의 제거 대상이 아니다.
- 거래 원천은 가구와 날짜 범위를 서버 Query에 강제하고 opaque cursor로 내부 page를 순회한다. 사용자가 page를 직접 넘기지 않아도 집계에 필요한 모든 page를 읽은 뒤에만 완전한 결과를 반환한다. 설정된 안전 상한이나 원천 변경 때문에 전체 범위를 완성하지 못하면 일부 합계를 완전한 값처럼 표시하지 않고 명시적 실패를 반환한다.
- 조회 시 계산하는 화면에는 `fresh`, `stale`, `rebuilding` 같은 Projection freshness를 두지 않는다. 유효한 0원, `NoData`, 조회 실패를 구분하고, 필터·가구·세션 변경 뒤 늦게 도착한 응답은 request revision으로 폐기한다.
- 자산 차트에서 조회 기간 안의 날짜별 Snapshot이 비어 있으면 그 날짜보다 앞선 가장 최근 Snapshot 값을 그대로 이어서 표시한다. 이 보간은 별도 경고·점선·참고 표시 없이 일반 값으로 보여준다. 조회 범위 시작 이전에도 Snapshot이 하나도 없으면 빈 구간으로 두며 현재값이나 0원으로 채우지 않는다. 명시적으로 저장된 0원 Snapshot은 유효한 값이므로 이후 carry-forward의 기준이 된다.

의도:

현재처럼 홈·예산·지출 통계를 원천에서 바로 계산해 갱신 지연과 Projection 운영 복잡도를 없애면서도, 무제한 전체 원장 다운로드와 부분 집계 오인을 막는다. 자산 차트는 매일 저장되는 사실을 기준으로 자연스럽게 이어 보이게 하고, 드물게 필요한 Position history는 데이터 손실 없이 복구 근거로 남긴다.

영향 요구사항: BUD-001, BUD-002, HOME-001, HOME-003, STAT-002, STAT-005, STAT-006, STAT-AST-001, STAT-AST-002, AST-004, AST-005, AST-008.

<a id="dec-049"></a>
## DEC-049 시세 연동 자산은 페이지 진입·23:55에 전체 갱신하고 외부 호출은 내부 분할

> 상태: Accepted  
> 결정일: 2026-07-19  
> 정책 소유 Context: [Portfolio](../contexts/portfolio/requirements.md)  
> 구현 소유 영역: [외부 연동·운영](../supporting-platform/modules/external-operations/requirements.md)  
> 영향 기능: 개별·가구 전체 시세 갱신, 일일 자산 평가·Snapshot, 외부 시세 API 보호

결정:

- 국내·미국 주식·ETF·ETN, 지원 펀드, KRW 코인, 실물 금 등 시세 연동 자산은 개별 자산 화면에서 수동 갱신할 수 있다.
- 사용자가 자산 메인 페이지에 진입하면 현재 가구의 모든 active 시세 연동 자산을 한 번에 갱신한다. 사용자에게 전체 종목 수 상한이나 page 조작을 노출하지 않는다.
- 가구 전체 갱신 요청은 클라이언트가 종목 ID 목록을 보내지 않고 가구 scope만 전달한다. 서버가 현재 active 시세 연동 자산과 Quote target을 직접 도출한다.
- 매일 23:55 `Asia/Seoul`에는 사용자 접속과 무관하게 같은 전체 갱신 Workflow를 실행한다. 모든 내부 page가 terminal 결과에 도달한 뒤 최신 성공 Quote와 실패 대상의 마지막 성공 Quote로 Portfolio를 평가하고, 그 값을 기준으로 당일 `AssetSnapshot` 생성을 요청한다.
- 한 전체 갱신에서 처리할 종목 수에는 제품 상한을 두지 않는다. 서버는 서로 다른 Quote target을 최대 50개씩 결정적 cursor page로 나누고 마지막 page까지 자동 처리한다.
- 외부 Provider 호출의 동시 실행은 한 refresh run당 최대 5개다. 한 요청의 연결·응답 전체 timeout은 10초다.
- timeout·network·HTTP 408·429·5xx처럼 retryable인 실패만 지수 backoff와 jitter로 최대 2회 추가 재시도하여 총 시도 횟수를 3회로 제한한다. `NoData`, 계약 실패, 잘못된 데이터는 같은 run에서 자동 재시도하지 않는다.
- 동일 가구·갱신 범위의 실행은 single-flight로 합친다. 이미 실행 중이면 새 Provider fan-out을 만들지 않고 같은 run 결과를 사용한다. 수동·페이지 진입 갱신은 같은 actor·가구·범위에서 30초에 한 번만 새 외부 호출을 시작하며 그 안의 요청은 현재 실행 또는 직전 결과를 재사용한다.
- 일부 target이 끝내 실패해도 성공 target은 반영하고 `PartialFailure`로 실패 범위·마지막 성공 시각·재시도 key를 기록한다. 실패 target은 마지막 성공 Quote를 유지하며 다음 수동 또는 예약 실행에서 다시 대상이 된다.
- 사용자 호출 진입점은 Firebase Auth·가구 권한·App Check를 검증하고 Scheduler는 지정 service account만 허용한다. page size 50, 병렬성 5, timeout 10초, 총 3회 시도, 30초 갱신 window는 환경 설정으로 주입하되 누락·0·무한 값이면 실행을 시작하지 않는다.

의도:

100종목 이상을 가진 사용자도 한 번의 동작으로 전부 갱신할 수 있게 하면서, 서버 내부에서만 작업을 나눠 공급자 과부하·함수 timeout·중복 실행을 막는다. 페이지 접속 여부와 무관한 일일 평가를 보장하고, 일부 공급자 실패가 성공한 자산이나 마지막 정상 평가값을 지우지 않게 한다.

영향 요구사항: HOLD-003, MARKET-001, MARKET-002, MARKET-004, JOB-AST-001, JOB-AST-003, JOB-ERR-001, EXT-002, EXT-003.

<a id="dec-050"></a>
## DEC-050 당장은 Firebase 단일 프로젝트를 유지

> 상태: Accepted  
> 결정일: 2026-07-19  
> 정책 소유 영역: [지원·플랫폼](../supporting-platform/requirements.md)  
> 영향 기능: 개발·테스트 환경, Firebase Functions·Rules·index 배포, 운영 데이터 스크립트

결정:

- 현재는 별도의 dev·staging Firebase 프로젝트를 만들지 않고 기존 `household-account-6f300` 하나를 유일한 Cloud Firebase 프로젝트로 유지한다.
- 로컬 개발의 자동 테스트, Rules·index 검증과 파괴적인 fixture는 Firebase Emulator와 in-memory Fake에서 실행한다. 실제 가구 데이터를 테스트 fixture나 sample seed 대상으로 사용하지 않는다.
- 단일 프로젝트여도 `.firebaserc`의 암묵적 default만 믿고 배포하지 않는다. Functions·Rules·index 배포와 Admin SDK 운영 스크립트는 `household-account-6f300` 또는 검증된 `production` binding을 명시적으로 전달하고, 대상 불일치·누락이면 실행 전에 중단한다.
- Web의 기존 자동 배포 방식은 유지할 수 있다. Firebase Functions·Rules·index와 운영 데이터 변경은 대상 project, 변경 범위, 검증 결과를 확인한 명시적 배포 작업으로 실행한다.
- 운영 데이터 수정·삭제 스크립트는 project ID를 코드에 하드코딩해 조용히 실행하지 않고 명시적 인자와 production 확인 절차를 요구한다. 읽기 전용 진단은 같은 project binding을 사용하되 데이터 변경 승인을 요구하지 않는다.
- 외부 사용자가 늘거나, 여러 개발자가 동시에 작업하거나, 운영 데이터와 분리된 Cloud 통합 테스트·대규모 migration 사전 검증이 필요해지면 dev/prod 분리를 새 결정으로 다시 검토한다. 그 전에는 staging을 만들지 않는다.

의도:

현재 개인·소규모 운영에서 별도 Firebase 프로젝트의 설정·Secret·Rules·데이터 유지 비용을 추가하지 않는다. 동시에 프로젝트가 하나라는 이유로 잘못된 대상에 배포하거나 운영 데이터를 테스트 자료로 사용하는 위험은 명시적 project binding과 Emulator로 줄인다.

영향 요구사항: REL-001, REL-002, REL-004.

<a id="dec-051"></a>
## DEC-051 PWA 새 버전은 안전한 재실행·사용자 갱신 때 활성화하고 금융 응답은 캐시하지 않음

> 상태: Accepted  
> 결정일: 2026-07-19  
> 정책 소유 영역: [PWA](../supporting-platform/modules/pwa/requirements.md)  
> 영향 기능: Web/PWA 업데이트, 서비스 워커, 정적 asset cache, iPhone PWA 푸시

결정:

- production origin의 root scope에는 cache와 Firebase Messaging을 함께 조정하는 서비스 워커 하나만 등록한다. `sw.js`와 `firebase-messaging-sw.js`를 서로 독립된 root worker로 등록하지 않는다.
- 새 worker는 설치와 필수 정적 asset 준비를 마쳐도 열린 구버전 화면을 즉시 장악하지 않고 waiting 상태로 둔다. 이 동안 기존 active worker가 현재 화면과 background push를 계속 담당한다.
- 새 버전이 준비되면 화면에 갱신 안내를 제공한다. 미저장 입력이 없고 사용자가 갱신을 선택하면 waiting worker를 활성화하고 `controllerchange` 뒤 한 번만 reload한다. 미저장 입력이 있으면 강제 활성화·reload하지 않고 먼저 저장하거나 명시적으로 버린 뒤 갱신하게 한다.
- 같은 origin의 열린 화면이 모두 닫히면 waiting worker가 활성화될 수 있으며, 다음 앱 실행은 새 버전을 사용한다. 오랫동안 열린 화면을 시간 제한으로 강제 reload하지 않는다.
- 구버전 client가 서버가 더 이상 허용하지 않는 write 계약을 보내면 서버는 `UPDATE_REQUIRED`로 거부한다. client는 입력을 버리지 않고 갱신 안내를 표시하며, 알 수 없는 schema를 추정해 write하지 않는다.
- 인증 응답, 가구·거래·자산·통계 등 금융 응답, `/api/**`, session 정보가 포함될 수 있는 navigation HTML은 Cache Storage에 저장하지 않고 network-only로 처리한다. Firestore 응답이나 offline command queue도 PWA runtime cache로 만들지 않는다.
- build hash가 붙은 정적 asset은 현재 worker version의 precache로만 보존하고 새 worker 활성화 뒤 이전 version cache를 정리한다. 공개 비민감 아이콘·폰트·이미지만 명시적 allowlist runtime cache에 최대 7일 보존한다. 임의 cross-origin 응답은 cache하지 않는다.
- worker 교체와 FCM FID 등록 수명주기는 분리한다. worker가 갱신되었다는 이유만으로 endpoint를 삭제하거나 새 FID라고 간주하지 않으며, 로그인·로그아웃과 실제 FID callback은 기존 Notifications 정책을 따른다.

의도:

사용자가 가계부를 입력하는 도중 배포 때문에 화면이 갑자기 reload되거나 구 UI와 새 worker가 섞이는 문제를 막는다. 동시에 푸시 기능은 유지하고, 로컬 cache에는 다시 내려받을 수 있는 공개 화면 자원만 제한적으로 남겨 가구·금융 데이터가 다른 세션이나 오래된 버전에 노출되지 않게 한다.

영향 요구사항: PWA-002, PWA-003, PWA-004, PWA-008.

<a id="dec-052"></a>
## DEC-052 자산 자동화는 매일 due 계획만 처리하고 누락 월은 성공할 때까지 복구

> 상태: Accepted  
> 결정일: 2026-07-19  
> 정책 소유 Context: [Portfolio](../contexts/portfolio/requirements.md)  
> 영향 기능: [자산 자동화](../contexts/portfolio/modules/asset-automation/requirements.md), [외부 연동·운영](../supporting-platform/modules/external-operations/requirements.md)

결정:

- 서버 Scheduler는 사용자 접속과 무관하게 `Asia/Seoul` 기준 매일 00:00에 자산 자동화 Application을 호출한다. 설정 납입일이 3월 18일이면 정상 경로에서는 3월 18일 00:00 occurrence가 해당 월 납입·상환을 반영한다.
- `AssetAutomationPlan`은 `nextDueDate`와 `firstApplicableMonth`를 보존한다. Scheduler Adapter는 날짜나 금액을 계산하지 않고 기준일만 전달하며, Application은 active이거나 중지 전 overdue를 복구 중이면서 `nextDueDate<=asOfDate`인 계획만 결정적 cursor page로 조회한다. 모든 자산·과거 execution을 매일 전체 scan하지 않는다.
- 한 계획이 여러 달 밀렸다면 `firstApplicableMonth` 이후 실행일이 도래했지만 execution이 없는 월을 고정 기간 제한 없이 오래된 월부터 처리한다. 한 run의 page·deadline을 넘으면 checkpoint를 남기고 후속 run에서 이어간다.
- 월 실행은 `(householdId, assetId, operation, targetMonth)`를 유일한 create-only execution key로 사용한다. 같은 날 재시도하거나 다음 날 다시 실행해도 성공한 월의 납입·상환은 한 번만 반영한다.
- 월 실행이 성공한 뒤에만 해당 계획의 `nextDueDate`를 다음 달 유효 납입일로 전진시킨다. retryable 실패나 Scheduler 미실행이면 due 날짜를 전진시키지 않으므로 같은 occurrence의 제한된 재시도 또는 다음 날 00:00 실행에서 다시 대상이 된다.
- 재시도로 해결되지 않는 잘못된 계획은 금액을 0으로 보정하거나 처리 완료로 표시하지 않는다. `needsAttention`으로 격리해 반복 write를 막고, 계획이 올바르게 수정되면 기존 due 월부터 다시 평가한다. 예약 실행의 Missing·Overdue·부분 실패는 External Operations가 기록하고 경보한다.
- 이미 commit된 `AutomationExecution`은 Plan 금액·날짜 변경, 비활성, 논리 삭제로 재계산·삭제하지 않는다. 과거 금액을 바꿔야 하면 원 실행을 덮어쓰는 자동 재계산이 아니라 근거가 남는 명시적 보정 Command를 사용한다.
- Plan 변경은 effective revision으로 보존한다. 누락 월은 그 월의 유효 납입일에 적용되던 revision으로 계산하고, 변경 시점 이후 실행일이 도래하는 월부터 새 설정을 사용한다.
- Plan 비활성·논리 삭제 이전에 실행일이 이미 도래한 누락 월은 복구 대상이고, 비활성·논리 삭제 effective 시점 이후 실행일은 새로 만들지 않는다. Plan과 execution history는 일반 삭제로 제거하지 않고 관련 Asset 또는 가구의 별도 수동 영구 purge에서만 제거한다.
- 관리자·승인된 운영 주체가 삭제 Asset을 복구하면 삭제 기간의 실행 월은 만들지 않는다. 복구일이 당월 유효 실행일 이전·당일이면 당월부터, 이후이면 다음 달부터 새 실행을 재개한다. 삭제 전에 이미 실행일이 도래한 미처리 월은 계속 복구 대상이며, 이 경계는 복구 Workflow가 보존하는 삭제 구간과 resume revision으로 결정한다.

의도:

매일 모든 자산 이력을 다시 읽지 않고 현재 처리 시점이 되었거나 과거에 실패한 적금·대출 계획만 조회한다. 일시적인 Scheduler·Firestore 장애가 월 납입·상환의 영구 누락으로 이어지지 않게 하면서, 재시도·동시 실행·설정 변경이 과거 잔액을 중복 반영하거나 조용히 다시 계산하지 못하게 한다.

영향 요구사항: AUTO-001, AUTO-002, AUTO-003, LOAN-002, JOB-ERR-001, JOB-ERR-002.

<a id="dec-053"></a>
## DEC-053 외화 자산은 최신 사용 가능 시세와 환율을 관측 시각 차이 제한 없이 조합

> 상태: Accepted  
> 결정일: 2026-07-19  
> 정책 소유 Context: [Portfolio](../contexts/portfolio/requirements.md)  
> 영향 기능: [보유종목·시장 데이터](../contexts/portfolio/modules/holdings-market-data/requirements.md), [포트폴리오](../contexts/portfolio/modules/portfolio/requirements.md)

결정:

- 외화 자산의 KRW 평가에는 해당 시세에 대해 가장 최근에 성공해 사용 가능한 원 통화 Quote와 통화쌍에 대해 가장 최근에 성공해 사용 가능한 환율 관측값을 각각 사용한다.
- Quote와 환율이 같은 요청·같은 평가 run·같은 날짜에 성공할 필요는 없으며 두 `observedAt` 사이에 별도의 최대 차이 제한을 두지 않는다. 어제 관측한 100 USD Quote와 오늘 관측한 1,400 KRW/USD 환율은 140,000원 평가에 사용할 수 있다.
- 원 통화 Quote와 환율은 서로 독립된 최신 성공 관측으로 보존한다. 한쪽 갱신 실패가 다른 쪽의 성공 관측을 버리거나 과거 시각으로 덮어쓰게 하지 않는다.
- KRW 환산 결과에는 사용한 Quote의 가격·통화·provider·`quoteObservedAt`과 환율의 pair·rate·provider·`exchangeRateObservedAt`을 함께 보존하여 같은 평가를 재현할 수 있게 한다. 화면에는 관측 시각 차이 또는 참고값 경고를 별도로 표시하지 않는다.
- 필요한 통화쌍의 환율 성공 이력이 한 번도 없고 이전 정상 KRW 환산 결과도 없다면 고정값·평균 환율·1:1 환율을 추정하지 않고 해당 환산을 `NoData(EXCHANGE_RATE_NOT_OBSERVED)`로 남긴다.
- 이전 정상 KRW 환산 결과가 있으면 새 Quote 또는 환율의 일부 실패 때문에 0원이나 미완성 조합으로 덮어쓰지 않고 마지막 정상 환산 결과를 유지한다. 다음 평가에서 두 입력이 다시 사용 가능해지면 최신 조합으로 갱신한다.
- Quote의 사용 가능 기간은 DEC-018처럼 마지막 성공값을 기간 제한 없이 사용하는 기존 정책을 따른다. 환율 관측 자체의 stale 허용 기간과 대체 Provider 사용 여부는 별도 정책에서 결정하며, 그 정책을 통과한 두 입력 사이에는 추가 skew gate를 적용하지 않는다.
- Web의 수동·페이지 진입 갱신과 매일 23:55 평가·Snapshot은 같은 `ForeignCurrencyValuationPolicy`를 사용한다.

의도:

주가와 환율 Provider가 서로 다른 시간에 갱신되거나 한쪽만 일시 실패했다는 이유로 외화 자산이 합계에서 사라지는 것을 막는다. 화면에서는 참고용 현재 평가액을 단순하게 유지하되, 내부에는 실제 사용한 두 관측 시각과 출처를 남겨 장애 분석과 재현이 가능하게 한다.

영향 요구사항: MARKET-001, MARKET-004, MARKET-006, HOLD-003, JOB-AST-001, AST-004.

<a id="dec-054"></a>
## DEC-054 Android QuickEdit은 내구성 있는 FIFO로 하나씩 표시

> 상태: Accepted  
> 결정일: 2026-07-19  
> 정책 소유 영역: [Android Host](../supporting-platform/modules/android-host/requirements.md)  
> 영향 기능: [Android Host·WebView·QuickEdit](../supporting-platform/modules/android-host/requirements.md), [Android 결제 수집](../contexts/payment-capture/modules/android-payment-ingestion/requirements.md)

결정:

- Android 자동 등록 거래가 연속 도착하면 QuickEdit은 한 번에 한 거래만 표시하고, 후속 거래는 저장 완료 순서대로 FIFO 대기열에 넣는다. A를 편집하는 동안 B와 C가 도착하면 A를 유지하고 A 종료 뒤 B, 그다음 C를 표시한다.
- 거래의 서버 저장과 QuickEdit 표시는 서로 독립된 결과다. QuickEdit Activity 실행·대기열 저장·복구 실패가 이미 등록된 거래를 롤백하거나 다시 등록하게 하지 않는다.
- 대기열은 Android Keystore 기반 암호화 저장소에 `(sessionGeneration, householdId, memberId, transactionId, sequence, enqueuedAt)`의 최소 정보만 보존한다. 가맹점·금액·카테고리·memo 전체 snapshot은 대기열에 중복 저장하지 않으며 cloud backup과 기기 이전에서 제외한다.
- 같은 session과 transaction ID는 한 번만 대기열에 존재한다. 정렬은 저장 시 발급한 단조 증가 sequence로 결정하여 같은 시각에도 순서가 모호하지 않게 한다.
- 현재 항목의 저장·삭제·분할 Command가 DEC-067의 암호화 command outbox에 commit되고 WorkManager 영속 예약까지 완료되거나 사용자가 명시적으로 닫으면 표시 항목을 완료 처리한 뒤 다음 항목을 연다. outbox 쓰기·예약 실패에서는 현재 항목을 유지한다. 접수 이후 서버 충돌·네트워크 실패의 보존·재시도는 표시 FIFO가 아니라 command outbox가 담당한다.
- 표시 직전 현재 인증 session과 대기열 scope가 일치하는지 검증하고 Ledger에서 최신 거래 snapshot을 다시 읽는다. 거래가 이미 삭제됐거나 현재 actor가 편집할 수 없으면 해당 항목만 안전하게 건너뛰고 다음 항목을 평가한다.
- process가 종료되거나 Activity가 재생성되어도 가장 오래된 미완료 표시 항목부터 복구한다. 로그아웃·가구 또는 멤버 전환 때는 이전 session의 QuickEdit 표시 FIFO와 DEC-067 command outbox 삭제가 성공한 뒤에만 새 SessionMirror로 전환하여 다른 actor의 거래나 Command를 사용하지 않는다.
- FIFO는 QuickEdit 편의 기능의 표시 정책일 뿐 Ledger 거래 생성 순서, 결제 중복 판정, 알림 수신자 계산에는 영향을 주지 않는다.

의도:

연속 결제가 현재 편집 화면을 덮어쓰거나 Activity stack에 쌓여 순서가 뒤집히는 문제를 막는다. 프로세스가 종료되어도 모든 저장 완료 거래를 도착 순서대로 확인할 수 있게 하되, 로컬 대기열에는 민감한 금융 snapshot을 복제하지 않고 인증된 최신 서버 상태만 편집하게 한다.

영향 요구사항: QE-001, QE-009, AND-009, AND-011.

<a id="dec-055"></a>
## DEC-055 QuickEdit 분할은 현재 편집 form 전체를 원자적 초안으로 사용

> 상태: Accepted  
> 결정일: 2026-07-19  
> 정책 소유 Context: [Household Finance](../contexts/household-finance/requirements.md)  
> 영향 기능: [거래 원장](../contexts/household-finance/modules/ledger/requirements.md), [Android Host·WebView·QuickEdit](../supporting-platform/modules/android-host/requirements.md)

결정:

- QuickEdit을 편집 중인 사용자가 저장하지 않은 상태에서 `분할`을 누르면 현재 화면의 가맹점·금액·카테고리·memo 등 편집 가능한 form 전체를 하나의 immutable `QuickEditSplitDraft`로 고정한다. 저장된 과거 snapshot으로 조용히 되돌리거나 별도 선행 저장을 요구하지 않는다.
- 분할 항목의 합계 기준은 현재 form의 금액이다. 각 항목은 현재 form의 표시값을 기본값으로 이어받고 사용자가 항목별로 허용된 필드를 변경할 수 있다.
- 카드 증거, source, originChannel, creatorMemberId, capture lineage와 서버 metadata는 form에 포함하지 않는다. Ledger가 현재 원본에서 읽어 파생 거래에 보존하며 client가 바꿀 수 없다.
- QuickEdit은 `현재 form + 분할 항목 + 열었을 때 읽은 expectedVersion`을 하나의 `SplitTransaction` Command로 보낸다. 먼저 Update를 저장한 다음 Split을 호출하는 두 단계 처리는 금지한다.
- 서버는 transaction 안에서 원본 최신 version을 다시 읽는다. 다른 사용자의 수정·분할·삭제가 먼저 성공하여 version이 바뀌었으면 stale Command 전체를 `Conflict(VERSION_MISMATCH)`로 거부하고 원본·파생 거래를 하나도 변경하지 않는다.
- 충돌한 QuickEdit은 사용자의 form과 분할 초안을 DEC-067의 암호화 command outbox에서 실패 알림 전달 전까지 `needs-attention`으로 보존하고 자동 병합·자동 재시도·마지막 저장 우선 덮어쓰기를 하지 않는다. 민감값 없는 실패 알림이 전달되면 해당 payload는 삭제하며, 사용자는 최신 거래를 다시 열어 active 상태를 확인한 뒤 자신의 변경을 새 expectedVersion으로 다시 작성한다. 대상이 이미 분할·병합·삭제되어 `superseded`·`deleted`라면 같은 원본으로 재제출하지 못하게 하고 최신 파생 거래나 목록으로 이동한다.
- 반대로 QuickEdit 분할이 먼저 성공하면 나중에 도착한 다른 사용자의 이전 수정 저장도 같은 version 검증으로 거부한다. 어떤 채널이 먼저였는지가 아니라 서버 transaction에서 먼저 version 검증과 commit에 성공한 Command 하나만 반영된다.

의도:

사용자가 보고 수정한 값과 실제 분할 결과를 일치시키면서도, 별도 저장과 분할 사이에 다른 변경이 끼어드는 시간차를 없앤다. 여러 사용자의 동시 작업에서는 조용한 덮어쓰기를 막고 충돌을 명시하여 거래가 일부만 수정되거나 분할되는 것을 방지한다.

영향 요구사항: QE-006, QE-010, LED-005, LED-008, SPL-001.

<a id="dec-056"></a>
## DEC-056 재병합은 merge 계보를 최종 원본까지 평탄화

> 상태: Accepted  
> 결정일: 2026-07-19  
> 정책 소유 Context: [Household Finance](../contexts/household-finance/requirements.md)  
> 영향 기능: [거래 원장](../contexts/household-finance/modules/ledger/requirements.md)

결정:

- 이미 합쳐진 거래를 다시 합치면 merge ancestry를 재귀적으로 펼쳐 최종 `MergedTransaction`에는 merge가 아닌 leaf 원본 snapshot을 평탄한 목록으로 저장한다. `A+B=M` 이후 `M+C=N`이면 N의 복원 원본은 `A,B,C`이며 `M,C`의 중첩 구조를 복원 단위로 사용하지 않는다.
- 평탄화는 merge 관계만 재귀적으로 펼친다. item split·monthly split에서 만들어진 거래가 merge 입력이면 그 현재 거래를 leaf로 취급하고 split의 원 승인 root까지 임의로 접지 않는다. split·capture 계보는 별도의 immutable reference로 그대로 유지한다.
- 최종 합친 거래의 표시 금액과 공통 표시 필드는 이번 merge의 현재 active 입력을 기준으로 계산한다. leaf마다 원본 ID, 가맹점, 금액, 카테고리, memo와 immutable source·origin·creator·카드 증거·capture lineage를 보존한다.
- 중간 합친 거래 M과 과거 merge operation은 `superseded` 감사 이력으로 보존하지만 일반 조회·집계와 최종 Unmerge의 복원 대상에서는 제외한다. N을 Unmerge하면 M과 C가 아니라 A, B, C의 같은 원본 ID를 재활성화하고 DEC-010의 표시 복원 정책을 적용한다.
- 서로 다른 입력의 평탄화 결과에 같은 leaf transaction ID 또는 같은 변환 leaf가 겹치면 조용히 중복 제거하거나 금액을 두 번 더하지 않고 전체를 `Conflict(MERGE_SOURCE_OVERLAP)`로 거부한다. 순환·누락·불완전 legacy snapshot도 쓰기 없이 typed failure로 끝낸다.
- 서버는 모든 active 입력, 중간 merge node, leaf 원본과 lineage version map을 같은 Unit of Work 안에서 다시 읽고 검증한다. 중간 node를 client payload의 중첩 snapshot만 믿어 평탄화하지 않는다.
- 결제 취소는 평탄한 leaf lineage를 사용한다. A lineage가 취소되면 DEC-041에 따라 공유 파생 N을 제거하고 취소되지 않은 B와 C 원본을 복원하며, 중간 M을 되살리지 않는다.

의도:

합치기를 반복할수록 `((A+B)+C)+D` 형태의 복원·취소 규칙이 깊어지는 것을 막고 항상 최종 원본 집합 하나로 다루기 위함이다. 중간 변환 이력은 감사용으로 남기되 현재 업무 결과의 원복과 lineage 취소는 평탄하고 결정적인 leaf 집합을 사용한다.

영향 요구사항: LED-008, LED-009, MRG-001, MRG-002.

<a id="dec-057"></a>
## DEC-057 지역화폐 상세는 홈에서 선택한 유형만 표시하고 내부 전환 UI는 두지 않음

> 상태: Accepted  
> 결정일: 2026-07-19  
> 정책 소유 Context: [Household Finance](../contexts/household-finance/requirements.md)  
> 영향 기능: [거래 원장](../contexts/household-finance/modules/ledger/requirements.md), [지역화폐](../contexts/household-finance/modules/local-currency/requirements.md), [홈 환경설정](../supporting-platform/modules/home-preferences/requirements.md)

결정:

- 사용자가 홈의 지역화폐 잔액 카드에서 상세 화면으로 들어가면 그 카드가 표시하던 `selectedLocalCurrencyType`의 지출만 조회한다. 경기지역화폐를 선택한 카드에서는 경기지역화폐 지출만 표시한다.
- 상세 화면에는 `전체` 또는 다른 지역화폐로 전환하는 필터·탭·선택 UI를 제공하지 않는다. 다른 유형의 상세 지출을 보려면 홈에서 표시 지역화폐를 먼저 변경한 뒤 해당 카드로 다시 진입한다.
- 상세 진입 시 선택 유형을 route/query input으로 고정하여 화면이 열린 도중 다른 설정 갱신 때문에 조회 범위가 조용히 바뀌지 않게 한다. 서버 Query는 같은 가구와 해당 `localCurrencyType`을 필수 범위로 사용한다.
- 지역화폐 결제 거래에는 검증된 Parser/Capture가 판별한 안정적인 `localCurrencyType` code를 immutable metadata로 저장한다. client 표시명이나 현재 홈 선택값으로 거래 유형을 추정·덮어쓰지 않는다.
- 기존 거래에 유형이 없거나 `legacy-unknown`이면 특정 지역화폐 상세에 포함하지 않는다. 해당 거래는 일반 지출 원장에서는 계속 조회되며, 과거 기록을 임의의 현재 선택 유형으로 backfill하지 않는다.
- 지역화폐 거래를 분할·월 분할하면 모든 파생 거래가 같은 `localCurrencyType`을 유지한다. 서로 다른 지역화폐 유형 또는 유형이 있는 거래와 유형이 없는 거래를 하나로 merge하면 상세 귀속이 모호해지므로 `Conflict(LOCAL_CURRENCY_TYPE_MISMATCH)`로 전체 거부한다.
- 유형별 상세 결과가 비어 있으면 다른 유형이나 legacy 거래를 대신 보여주지 않고 해당 유형의 정상적인 빈 내역을 표시한다. 일반 지출 원장의 전체·월별 조회는 이 상세 화면 정책으로 제한하지 않는다.

의도:

여러 지역화폐를 동시에 쓰는 드문 경우를 위해 상세 화면에 별도 필터 UI를 추가하지 않고, 홈에서 이미 선택한 하나의 유형을 일관되게 이어서 보여준다. 동시에 유형 없는 과거 거래를 잘못 귀속하거나 구조 변경으로 지역화폐 구분이 사라지는 것을 막는다.

영향 요구사항: LED-009, LED-010, HOME-002, BAL-004.

<a id="dec-058"></a>
## DEC-058 과거 자산 통계 필터는 선택 기간의 Snapshot 차원으로 구성

> 상태: Accepted  
> 결정일: 2026-07-19  
> 정책 소유 영역: [Reporting](../supporting-platform/modules/reporting/requirements.md)  
> 영향 기능: [Reporting](../supporting-platform/modules/reporting/requirements.md), [포트폴리오](../contexts/portfolio/modules/portfolio/requirements.md)

결정:

- 자산 통계의 자산 유형·명의자 필터는 현재 active Asset이나 현재 active 명의자 목록이 아니라 사용자가 선택한 조회 기간에 반환된 `AssetSnapshot`의 dimension key로 구성한다.
- 현재 해당 유형의 자산이 모두 삭제됐거나 명의자 프로필이 archived 상태여도 선택 기간의 Snapshot 또는 그 기간 계산에 사용한 시작 직전 baseline에 dimension이 존재하면 필터에 표시한다.
- Snapshot의 명의자 dimension은 표시 이름이 아닌 안정적인 `ownerRef`의 `profileId` 또는 `household` key를 사용한다. archived 프로필의 이름은 Access의 historical-display 조회로 해석하며 Asset·Snapshot을 이름 변경 때문에 다시 쓰지 않는다.
- 자산 유형은 Snapshot에 보존된 안정적인 type code로 해석한다. 현재 자산 생성 화면에서 더 이상 선택할 수 없다는 이유로 과거 type dimension을 제거하거나 다른 현재 type으로 바꾸지 않는다.
- 필터 dimension 조회는 선택 기간과 같은 baseline·window 범위, 가구, query revision을 사용한다. 기간을 바꿨을 때 현재 선택 dimension이 새 결과에 없으면 빈 결과를 조용히 유지하지 않고 필터를 `전체`로 초기화한다.
- 명시적인 0원 Snapshot도 유효한 과거 dimension 관측이다. `NoData`나 저장소 실패를 0원 dimension으로 만들지 않으며, 현재 합계가 0이라는 이유로 과거 Snapshot과 필터를 삭제하지 않는다.
- 현재 자산 화면의 도넛 필터와 신규 자산 명의자 선택지는 계속 active Asset·active Profile을 기준으로 한다. 과거 통계용 dimension catalog는 이 현재 화면 목록에 archived 항목을 다시 노출하는 근거가 아니다.
- 일반 Asset 논리 삭제·명의자 보관은 Snapshot을 수정하지 않는다. 과거 dimension은 해당 Asset 또는 가구의 승인된 수동 영구 purge가 실제 Snapshot을 제거한 경우에만 함께 사라질 수 있다.

의도:

현재 보유 자산이 바뀌었다는 이유로 과거 통계에서 당시의 자산 유형·명의자를 선택할 수 없게 되는 문제를 막는다. 현재 입력 UI는 단순하게 유지하면서 과거 조회만 Snapshot이 실제로 가진 차원을 충실하게 보여준다.

영향 요구사항: STAT-AST-001, STAT-AST-002, STAT-AST-003, AST-004, AST-006, AST-009.

<a id="dec-059"></a>
## DEC-059 등록 카드의 카드사·소유자는 immutable identity이고 끝 번호만 수정

> 상태: Accepted  
> 결정일: 2026-07-19  
> 보완일: 2026-07-20  
> 정책 소유 Context: [Payment Capture](../contexts/payment-capture/requirements.md)  
> 영향 기능: [결제 설정](../contexts/payment-capture/modules/payment-configuration/requirements.md)

결정:

- 등록 카드의 `cardCompany`와 `ownerMemberId`는 생성 후 바꿀 수 없는 identity이다. 잘못 등록했거나 소유자가 달라지면 기존 카드를 삭제 처리한 뒤 새 `cardId`로 다시 등록한다.
- 등록 카드에는 사용자 자유 입력 카드 이름·별칭을 두지 않는다. 화면에는 정규화된 카드사·결제수단 code의 표준 라벨과 선택적인 `lastFour`를 조합해 표시한다.
- 기존 카드에서는 정규화된 마지막 네 자리 `lastFour`와 사용자 정렬 순서만 변경할 수 있다. 정렬은 별도 전체 집합 재정렬 Command로 처리한다.
- 카드사·소유자 변경 입력은 `CARD_IDENTITY_CHANGE_REQUIRES_REREGISTRATION`으로 거부하고 카드·claim을 한 건도 바꾸지 않는다.
- 끝 번호 변경은 새 `(householdId, ownerMemberId, cardCompany, lastFour)` uniqueness claim 생성, 카드 version 갱신, 이전 claim 해제를 같은 Unit of Work에서 수행한다. 중복 claim이나 stale version이면 전체를 rollback한다.
- 일반 사용자의 카드 삭제는 물리 삭제가 아니라 `active → retired` 전환이다. 퇴역 카드의 활성 uniqueness claim은 해제하고 일반 목록·정렬·자동 결제 매칭에서 제외하되, 카드 문서와 과거 capture 증거·거래 lineage는 보존한다.
- 퇴역 카드를 다시 활성화하는 Command는 제공하지 않는다. 같은 카드를 다시 사용하려면 새 카드로 등록하며 새 `cardId`를 부여한다. 물리 삭제는 가구 전체의 별도 승인된 영구 purge 범위에서만 수행한다.
- 끝 번호 수정과 퇴역은 이미 생성된 Ledger 거래의 카드 증거를 소급 변경하지 않는다. Ledger 검색은 거래 생성 당시 보존한 표준 카드사 라벨·끝 번호 증거를 사용한다. 특정 카드사 전용 분기를 두지 않고 지원하는 모든 카드에 카드사명·끝 네 자리·`카드사(4자리)`·마스킹 형식을 같은 검색 규칙으로 적용한다.

의도:

카드의 소유권과 발급 주체를 안정적인 경계로 유지하여 설정 변경이 과거 결제의 의미를 바꾸지 않게 하고, 번호 수정과 동시 등록에서 중복 불변식을 원자적으로 지키며, 사용자가 삭제한 카드는 앞으로의 자동 등록에서 확실히 제외하면서도 감사와 장애 복구에 필요한 과거 근거를 남긴다.

영향 요구사항: CARD-001, CARD-002, CARD-003, CARD-004, CARD-005.

<a id="dec-060"></a>
## DEC-060 환율은 Frankfurter v2 단일 공급자와 마지막 성공값을 기간 제한 없이 사용

> 상태: Accepted  
> 결정일: 2026-07-19  
> 정책 소유 Context: [Portfolio](../contexts/portfolio/requirements.md)  
> 영향 기능: [보유종목과 시세](../contexts/portfolio/modules/holdings-market-data/requirements.md), [외부 연동과 예약 작업](../supporting-platform/modules/external-operations/requirements.md)

결정:

- USD/KRW 환율의 목표 공급자는 Frankfurter v2 하나만 사용한다. `GET /v2/rate/USD/KRW`의 구조화 JSON을 `ExchangeRatePort` Adapter에서 검증하며 한국수출입은행, 네이버 금융 HTML parser 또는 다른 무료 API를 보조 공급자로 호출하지 않는다.
- Frankfurter 응답의 `base=USD`, `quote=KRW`, 유한 양수 `rate`, 미래가 아닌 ISO `date`를 검증한다. Canonical `ExchangeRateObservation`에는 pair, rate, provider=`frankfurter-v2`, 공급자 기준일 `rateDate`, 검증 수신 시각 `observedAt`을 보존하고 Provider 원문은 저장하지 않는다.
- 성공한 환율 관측은 경과 기간과 무관하게 다음 성공값이 저장될 때까지 평가에 계속 사용한다. 사용자 화면에는 stale·degraded·참고값 표시를 추가하지 않는다.
- timeout·429·5xx·schema drift·잘못된 값·저장값보다 오래된 `rateDate`는 기존 성공 관측과 기존 정상 KRW 환산 결과를 덮어쓰지 않는다. 성공 이력이 한 번도 없고 이전 정상 환산도 없을 때만 `NoData(EXCHANGE_RATE_NOT_OBSERVED)`로 처리한다.
- 같은 `rateDate`에 공급자가 정정한 유효 rate를 반환하면 새 관측으로 갱신할 수 있다. 저장값보다 오래된 기준일은 임의 회귀를 막기 위해 거부한다.
- 호출 timeout·retry·동시성은 DEC-049의 공통 외부 호출 정책을 사용한다. 실패는 Frankfurter provider+operation Health에 누적하고 contract·invalid 실패는 즉시, retryable·예상 밖 NoData는 예약 run 3회 연속 실패 시 기존 Cloud Monitoring 이메일 경보를 연다. 성공하면 Health와 경보를 복구한다.
- 현재 `naverUsdKrwRate.ts`의 5분 메모리 캐시와 HTML parser는 목표 환율 경로 전환 뒤 제거한다. 실패를 네이버 값·고정값·평균·1:1 환율로 대체하지 않는다.
- DEC-053의 원 통화 Quote와 환율 독립 관측·skew 제한 없는 조합은 유지한다. 환율 `rateDate`와 수신 `observedAt`은 Quote의 `quoteObservedAt`과 함께 평가 provenance에 남긴다.

의도:

참고용 자산 평가에 불필요한 다중 공급자 선택·환율 기준 차이·Secret 관리를 추가하지 않으면서, HTML 구조 변경에 취약한 현재 구현을 구조화 API로 교체한다. 외부 장애가 자산을 0원 또는 미평가로 되돌리지 않게 마지막 성공값을 유지하고, 장애 사실은 화면 복잡도가 아니라 운영 Health와 이메일 경보로 발견한다.

영향 요구사항: MARKET-001, MARKET-004, MARKET-006, HOLD-003, JOB-AST-001, EXT-001, EXT-003.

<a id="dec-061"></a>
## DEC-061 홈의 두 요약 카드는 사용자가 서로 다른 유형으로 구성

> 상태: Accepted  
> 결정일: 2026-07-19  
> 정책 소유 영역: [Home Preferences](../supporting-platform/modules/home-preferences/requirements.md)  
> 영향 기능: [Home Preferences](../supporting-platform/modules/home-preferences/requirements.md)

결정:

- 설정 화면에 가구 공통 홈 카드 구성 UI를 제공한다. 왼쪽·오른쪽 slot은 `지역화폐 잔액`, `월 잔여 예산`, `월 지출`, `연 지출` 중 각각 하나를 선택한다.
- 신규 저장에서 두 slot은 서로 다른 유형이어야 한다. UI는 반대 slot에서 선택한 유형을 비활성화하고 서버 `HomeCardSelectionPolicy`도 같은 유형을 `DUPLICATE_HOME_CARD_TYPE`으로 거부하여 write 0건을 보장한다.
- 기본 구성은 기존과 같이 왼쪽 `지역화폐 잔액`, 오른쪽 `월 잔여 예산`이다. 설정을 저장하지 않은 가구와 유효하지 않은 레거시 값의 안전한 표시 fallback에 이 기본값을 사용한다.
- 기존 저장 데이터에 같은 유형이 두 slot에 있으면 자동으로 다른 유형으로 바꾸지 않고 읽기 호환으로 그대로 표시한다. 사용자가 다음 저장을 시도할 때부터 서로 다른 두 유형을 필수로 하며, 중복 상태 그대로의 재저장도 거부한다.
- 모든 활성 가구원은 별도 owner·admin 역할 없이 `home-preferences.write` capability로 이 공유 설정을 변경할 수 있다. 비활성·제거된 Membership과 다른 가구 Actor는 읽기·쓰기를 할 수 없다.
- 저장은 `expectedVersion`을 요구한다. 여러 가구원이 동시에 변경하면 서버 transaction에서 먼저 version 검증과 commit에 성공한 요청 하나만 반영하고 나머지는 `HOME_CONFIGURATION_VERSION_MISMATCH`로 거부한다. 마지막 저장 우선 덮어쓰기나 자동 병합은 하지 않는다.
- 카드 구성과 홈 표시 지역화폐 유형은 별도 설정이다. left·right 저장은 `selectedLocalCurrencyType`을 변경하지 않으며, 지역화폐 선택 변경도 left·right 구성을 바꾸지 않는다. 같은 Preferences Aggregate version을 사용하므로 동시 변경은 충돌 후 최신값을 확인해 다시 제출한다.
- 구성 저장은 idempotency receipt와 `HomeConfigurationChanged.v1` Outbox를 같은 Unit of Work에 기록한다. Home Summary는 선택된 유형을 순서대로 조회 조합할 뿐 별도 영속 Projection을 만들지 않는다.

의도:

사용자가 실제로 중요하게 보는 두 요약을 선택할 수 있게 하면서 같은 정보를 양쪽에 반복하는 신규 구성을 막는다. 기존 데이터를 조용히 보정해 화면이 바뀌는 일을 피하고, 가구 공통 설정의 동시 변경은 명시적 version 충돌로 다뤄 Clean Architecture의 단일 Writer와 결정적 결과를 유지한다.

영향 요구사항: HOME-001, HOME-002, HOME-003, HOME-004.

<a id="dec-062"></a>
## DEC-062 배당 공시 수집·상태 전이는 09시부터 20시까지 매시 실행

> 상태: Accepted  
> 결정일: 2026-07-19  
> 정책 소유 Context: [Portfolio](../contexts/portfolio/requirements.md)  
> 영향 기능: [배당](../contexts/portfolio/modules/dividends/requirements.md), [외부 연동과 예약 작업](../supporting-platform/modules/external-operations/requirements.md)

결정:

- 배당 예약 작업은 `Asia/Seoul` cron `0 9-20 * * *`로 매일 09:00부터 20:00까지 매시 정각 실행한다. 시작·종료 시각을 모두 포함하여 하루 12개 occurrence가 생성된다.
- 각 시간 occurrence는 `scheduledFor`가 포함된 별도 execution key와 runId를 사용한다. 같은 occurrence 안에서 공시 `DISCOVERY`와 기존 nonterminal Event `LIFECYCLE_SWEEP`을 각각 독립 checkpoint로 실행한다.
- 17:30처럼 정각 이후 게시된 공시는 다음 18:00 occurrence에서 정상 수집한다. 20:00 이후 게시분은 다음 날 09:00 occurrence에서 수집하며 야간 별도 schedule은 두지 않는다.
- 같은 날 공시와 상태를 반복 확인해도 `source + sourceDisclosureId`의 canonical Event ID, 상태 전이 receipt와 expected version으로 같은 Event·상태·Projection을 중복 반영하지 않는다.
- 한 instrument·phase 실패는 다른 성공을 rollback하지 않는다. KIND 호출은 결정적 page, 유한 timeout·retry와 Provider Health 관측을 적용하고 실패·NoData를 빈 성공이나 Event 삭제로 바꾸지 않는다.
- 현재 `dailyDividendSnapshot`의 17:00 하루 1회 schedule은 전환 대상이다. 함수 이름에 `daily`를 남겨 목표 주기를 오해하지 않도록 목표 Scheduler Adapter와 JobRun 이름은 `dividend-hourly` 의미로 구성한다.

의도:

장중·저녁에 늦게 게시되는 분배 공시를 다음 날까지 기다리지 않고 최대 약 한 시간 안에 반영한다. 현재 가계부 규모에서는 Firebase 실행 부하가 작고 Cloud Scheduler 비용은 실행 횟수가 아니라 job 수 기준이므로 같은 job의 주기 변경 비용은 미미하다. 외부 KIND 요청이 하루 1회 대비 늘어나는 점은 page·timeout·retry·Health로 제한하고 관측한다.

영향 요구사항: JOB-DIV-001, DIV-006, JOB-ERR-001, JOB-ERR-002.

<a id="dec-063"></a>
## DEC-063 정기 거래는 Plan 최초 등록자를 immutable creator로 사용

> 상태: Accepted  
> 결정일: 2026-07-19  
> 정책 소유 Context: [Household Finance](../contexts/household-finance/requirements.md)  
> 영향 기능: [정기 거래](../contexts/household-finance/modules/recurring-transactions/requirements.md), [거래 원장](../contexts/household-finance/modules/ledger/requirements.md)

결정:

- `RecurringPlan`을 생성한 인증된 가구원의 `memberId`를 `creatorMemberId`로 저장하고 Plan의 immutable provenance로 취급한다. 이후 다른 가구원이 Plan의 가맹점·금액·카테고리·일자·memo·active를 수정해도 creator를 바꾸지 않는다.
- Scheduler는 제한된 SystemActor로 실행 권한만 증명한다. 월별 Ledger 거래의 `creatorMemberId`는 실행 시점의 접속자·현재 가구원·SystemActor가 아니라 Plan에 저장된 최초 `creatorMemberId`를 사용한다.
- create·update wire payload에서 `creatorMemberId`를 받지 않는다. create에서는 서버 `ActorContext.actingMemberId`를 사용하고 update·월 처리에서는 저장된 Plan 값을 사용한다.
- creator가 없는 레거시 Plan은 배포 전 또는 전환 도중 명시적인 `planId → creatorMemberId` migration mapping을 적용한다. mapping은 같은 household에 보존된 실제 Member identity만 가리킬 수 있고, migration actor·시각·기존 Plan version을 receipt로 남긴다.
- 운영자가 한 가구의 creator 없는 과거 Ledger 거래와 정기 거래를 모두 같은 Member에게 귀속하기로 명시적으로 확인한 경우에는 manifest의 가구 단위 `missingCreatorMemberId`를 사용할 수 있다. 이는 빈 creator에만 적용하며 기존 creator 이름·Member ID를 덮어쓰지 않고 문서별 mapping이 있으면 그 값을 우선한다. 현재 전환 결정은 `또니망고네 → 민규`, `익태송희네 → 익태`이다.
- 레거시 Plan에 mapping이 없으면 유일한 활성 가구원, 최근 접속자, 현재 Scheduler 대상, 표시 이름 또는 SystemActor로 추정하지 않는다. 해당 Plan의 자동 posting은 `LEGACY_CREATOR_MAPPING_REQUIRED`로 중단하고 다른 정상 Plan 처리는 계속한다.
- 한번 설정된 creator는 일반 Plan 수정이나 migration 재실행으로 덮어쓸 수 없다. 잘못된 mapping 교정은 일반 update가 아니라 감사 근거를 가진 별도 운영 migration으로만 수행하며 기존 생성 거래를 소급 변경하지 않는다.
- creator는 거래 provenance이며 자동 푸시 여부를 결정하지 않는다. 정기 거래는 DEC-013에 따라 자동 푸시를 만들지 않고, 명시적 `알림 보내기`는 requester 기준으로 별도 처리한다.

의도:

Scheduler가 만든 거래도 실제로 그 일정을 등록한 가구원에게 안정적으로 귀속하면서, 실행 시점의 사용자 상태나 임의 fallback에 따라 같은 Plan의 creator가 바뀌는 일을 막는다. 레거시 데이터는 추정으로 조용히 오염시키지 않고 명시적인 mapping을 거쳐 전환한다.

영향 요구사항: REC-002, REC-006, LED-007, T-REC-007.

<a id="dec-064"></a>
## DEC-064 필수 release gate 실패는 waiver로 우회하지 않음

> 상태: Accepted  
> 결정일: 2026-07-20  
> 정책 소유 영역: [Delivery Assurance](../supporting-platform/modules/delivery-assurance/requirements.md)  
> 영향 기능: [배포 안전성](../supporting-platform/modules/delivery-assurance/requirements.md)

결정:

- 운영 배포 후보는 Web·Functions·Android build, 활성 unit/contract test, Firestore Rules Emulator, 요구사항 ID·상대 링크 검사, Architecture Fitness Function을 포함한 모든 필수 release gate를 실제로 통과해야 한다.
- 실패·누락·skip·known failure 중 하나라도 있으면 `EvaluateReleaseCandidate`는 `rejected`를 반환하고 deploy authorization을 발급하지 않는다.
- waiver는 사유·범위·승인자·만료를 남기는 감사 annotation일 뿐이다. waiver의 존재나 승인 상태는 실패 gate를 `passed`로 바꾸거나 deploy capability를 만들지 않는다.
- `OverrideReleaseGate`, `ApproveEmergencyDeployment`처럼 실패 후보를 승인으로 바꾸는 별도 Input Port와 운영 권한을 제공하지 않는다.
- 긴급한 상황에서도 실패 원인을 해결하고 같은 immutable manifest 또는 수정된 새 manifest의 필수 gate를 모두 다시 통과한 뒤 배포한다. gate 결과를 삭제·skip하거나 known failure로 분류해 통과시키지 않는다.
- 배포 Adapter는 현재 manifest hash에 대해 발급된 정상 deploy authorization만 소비하며 waiver 기록을 authorization 대용으로 받지 않는다.

의도:

현재 운영 규모에서 복잡한 예외 승인 권한과 우회 경로를 추가하지 않고, 배포 안전성의 의미를 “필수 검증 전체 통과” 하나로 유지한다. 긴급성을 이유로 검증 실패를 성공으로 재해석해 더 큰 운영 장애를 만드는 것을 막는다.

영향 요구사항: REL-001, T-REL-001.

<a id="dec-065"></a>
## DEC-065 일반 거래는 논리 삭제하고 영구 정리는 운영 작업으로 분리

> 상태: Accepted  
> 결정일: 2026-07-22  
> 정책 소유 영역: [Household Finance / Ledger](../contexts/household-finance/modules/ledger/requirements.md)  
> 영향 기능: 거래 삭제, 원장 조회·검색·집계, 운영 복구·영구 정리

결정:

- 이 결정은 사용자가 원장 화면에서 수행하는 일반 거래 삭제에 적용한다. 결제 취소로 capture lineage 전체를 제거하는 동작은 DEC-041의 별도 정책을 따른다.
- 일반 `DeleteTransaction`은 Transaction을 물리 삭제하지 않고 `lifecycleState=deleted`, `deletedAt`, 증가한 aggregateVersion으로 전환한다. 본문, 생성자, source·originChannel, 카드 증거, split·merge·capture lineage는 그대로 보존한다.
- deleted 거래는 전환 commit 직후 일반 월·일 목록, 검색, 월·연·카테고리 합계와 알림 요청 대상에서 제외한다. lifecycleState가 없는 legacy 거래는 active로 호환하되 `deletedAt`이 있으면 deleted로 취급한다.
- deleted 거래의 일반 Update·Delete·Split·Merge는 `NotFound`로 처리한다. 일반 사용자에게 삭제 목록, 복구 UI/API, 물리 삭제 API를 제공하지 않는다.
- deleted 거래에는 TTL이나 보존 기간을 두지 않으며 시간 경과로 자동 영구 삭제하지 않는다.
- 실수 삭제 복구는 사용자의 요청을 확인한 운영자/Agent가 transactionId, expectedVersion, 감사 사유를 명시한 전용 작업으로만 수행한다. 복구는 새 거래를 생성하지 않고 보존된 같은 ID와 provenance를 active로 되돌린다.
- 영구 삭제도 사용자가 대상을 명시해 별도로 요청했을 때만 운영자/Agent가 수행한다. capture claim·lineage, split·merge snapshot, receipt·projection 등 소유 종속 자료를 확인하지 않은 채 `expenses` 또는 Canonical Transaction 한 문서만 직접 지우지 않는다. 재등록 방지 자료가 필요한 capture는 DEC-041의 최소 tombstone을 유지한다.
- 가구 전체 영구 purge가 실행되면 DEC-016·DEC-040의 가구 단위 Process가 이 보존 정책보다 우선하여 해당 가구의 Ledger 데이터를 정리한다.

의도:

사용자의 실수로 금융 기록을 복구 불가능하게 잃지 않으면서도 삭제 직후 화면과 통계에서는 완전히 사라지게 한다. 복구와 최종 정리를 일상 UI에서 분리하여 사용자가 삭제·복구를 상태 토글처럼 사용하거나 부분 물리 삭제로 원장 계보와 중복 방지가 깨지는 일을 막는다.

영향 요구사항: LED-001, LED-005, LED-006, LED-008, LED-009, SEA-001~004, T-LED-001, T-LED-008.

<a id="dec-066"></a>
## DEC-066 Android 금융 알림은 Functions의 단일 서버 parser가 해석

> 상태: Accepted  
> 결정일: 2026-07-22  
> 정책 소유 Context: [Payment Capture](../contexts/payment-capture/requirements.md)  
> 영향 기능: [Android 결제 알림 수집](../contexts/payment-capture/modules/android-payment-ingestion/requirements.md)

결정:

- Android `NotificationListenerService`는 등록된 package의 제목, `text`, `bigText`, `textLines`, 게시 시각을 `AndroidRawNotification.v1`으로 만들고 Android Keystore AES-256-GCM Queue에 최대 72시간 저장해 인증·App Check가 적용된 Functions callable로 보낸다.
- Android는 공급자 정규표현식, parser ID/version, 금액·일시·가맹점·카드·잔액 추출을 소유하지 않는다. 기존 Kotlin 공급자 parser와 변환 Factory는 운영 코드에서 제거하고 Functions TypeScript parser와 비식별 golden fixture를 정본으로 사용한다.
- 클라이언트 요청에는 `householdId`, `createdBy`, `sourceType`, `parserId`, 카드·거래 후보를 받지 않는다. Functions가 Firebase 인증의 활성 Membership으로 가구와 생성자를, 서버 Source Registry의 정확한 package 일치로 source와 parser를 확정한다.
- 등록되지 않은 package는 본문이 지원 형식과 같아도 parser와 저장에 진입하지 않는다. 등록 package의 parser 실패도 다른 source parser로 fallback하지 않고 Canonical 변경 없는 terminal 결과로 끝난다.
- 문자 앱과 카카오톡은 결제 외 개인정보가 많은 다목적 앱이므로 Android에 넓은 금융/도시가스 marker admission을 둔다. 이는 서버 전송 최소화만 담당하며 거래 필드를 해석하거나 서버 parser 판정을 대체하지 않는다. 전용 금융 앱은 package gate 뒤 원문 후보를 그대로 보낸다.
- Functions는 원문을 요청 처리 중에만 사용하고 원문 자체를 Capture receipt, Ledger, Domain Event, Outbox, 일반 로그에 저장하지 않는다. 결정적인 원문 hash, 서버가 선택한 source/parser metadata와 파싱된 최소 provenance만 기존 `CaptureEnvelope.v1` 내부 경계로 넘긴다. DEC-047의 임시 진단 Adapter 보존은 별도이며 업무 성공과 결합하지 않는다.
- 새 APK는 `submitAndroidRawNotification`을 사용한다. 배포 전 기기의 암호화 Queue에 남은 `CaptureEnvelope.v1`은 `submitCaptureEnvelope`로 계속 전송해 유실하지 않으며, Functions는 전환 기간 동안 두 callable을 함께 제공한다.
- Functions를 새 APK보다 먼저 배포한다. rollback 시 새 raw callable은 유지한 채 이전 APK를 배포할 수 있으며, 서버 parser의 수정은 APK 재배포 없이 Functions와 golden fixture만 변경한다.

의도:

서로 다른 Android 설치본에 parser 버전이 남아 발생하는 동작 차이와 Kotlin·TypeScript 중복을 제거하고, 패키지 검증·파싱·카드 소유 확인·저장을 한 서버 경계에서 일관되게 변경하기 위함입니다. Android에는 OS 알림 접근과 오프라인 전달이라는 기기 고유 책임만 남겨 Clean Architecture의 단일 책임과 서버 권위를 강화합니다.

영향 요구사항: ING-001~009, PARSE-KB-001~PARSE-COMMON-001, ING-SAVE-001~007, T-ING-001, T-ING-003, T-PARSE-001~004, T-QUEUE-001.

<a id="dec-067"></a>
## DEC-067 QuickEdit Command는 로컬 영속 접수와 전달 예약 뒤 화면을 닫고 비동기 전달

> 상태: Accepted  
> 결정일: 2026-07-22  
> 정책 소유 영역: [지원·플랫폼 / Android Host](../supporting-platform/modules/android-host/requirements.md)  
> 영향 기능: Android QuickEdit 저장·삭제·분할·가구원 알림 요청

결정:

- QuickEdit의 client 검증을 통과한 Command는 현재 `SessionScope`, transaction ID, 생성 시 고정한 `commandId`·`idempotencyKey`, versioned payload 전체를 Android Keystore AES-256-GCM command outbox에 원자 commit한다.
- Activity는 서버 응답을 기다리지 않되 outbox commit과 WorkManager 영속 예약이 모두 성공한 뒤 닫는다. commit부터 예약·Accepted 판정까지는 session purge와 동일한 짧은 lifecycle 임계 구역에 두어 저장된 Command가 purge된 뒤 예약·접수 성공으로 오인되는 틈을 허용하지 않는다. 서버 왕복은 이 임계 구역 밖에서 수행해 느린 응답이 다음 QuickEdit 접수를 막지 않는다. 화면 닫힘은 업무 성공이 아니라 “기기에서 안전하게 접수되고 전달이 예약됨”을 뜻하며, 서버 성공 Toast·업무 완료 event로 표시하지 않는다. outbox 쓰기 또는 예약 실패에서는 화면을 유지하고 같은 envelope 재접수를 허용한다.
- WorkManager와 process 내 즉시 전송은 저장된 동일 envelope를 사용한다. 네트워크·일시 서버 실패는 접수 시각부터 정확히 72시간 전까지 같은 `commandId`·`idempotencyKey`로 재시도하며, 앞선 retryable 명령이 남아 있으면 뒤 명령이 이를 추월해 전송되지 않는다. process 시작 복구는 기존 unique work를 `KEEP`하여 Worker를 자기 증식시키거나 backoff를 우회하지 않는다.
- version 충돌, 권한·존재·입력 영구 거부, wire 계약 실패와 72시간 재시도 만료는 자동으로 새 version이나 다른 payload로 바꾸거나 다시 전송하지 않는다. 암호화 entry는 민감값 없는 로컬 실패 알림이 성공적으로 전달될 때까지만 `needs-attention`으로 보존하고, 알림 전달 뒤 payload를 삭제한다. 알림 권한·앱 알림·채널이 차단되면 전달 완료로 오인하지 않고 Worker 재시도를 유지한다.
- 서버 `Success`·`AlreadyProcessed` 또는 terminal·만료 실패 알림 전달 완료가 outbox entry의 삭제 조건이다. 암호문·Keystore key·versioned codec 손상으로 복구할 수 없는 payload는 fail-closed 삭제하되 비민감 손상 플래그를 별도 저장하여 다음 실행에서 실패 알림을 재시도한다. process 종료은 재시도 key를 바꾸지 않으며, 로그아웃·가구·멤버 전환은 진행 중 전달과 알림을 직렬화하고 기존 unique work 취소 완료와 두 QuickEdit 저장소 삭제를 확인한 뒤 새 SessionMirror를 commit한다. purge된 같은 SessionScope의 재접수는 session generation이 바뀔 때까지 거부한다.
- 표시 FIFO에는 기존처럼 scope·transaction ID·sequence만 둔다. command payload outbox는 별도 암호화 저장소와 lifecycle을 사용하며, command outbox commit과 WorkManager 영속 예약이 모두 완료된 뒤 표시 head를 완료하여 후속 QuickEdit을 열 수 있다.
- Update payload에는 원본과 실제로 다른 필드만 넣는다. 빈 memo는 기존 memo 삭제라는 명시적 변경으로 포함하며, 카테고리가 바뀌지 않은 저장은 category 조회를 유발하지 않는다. 변경 필드가 하나도 없으면 서버 Command 없이 표시 head만 완료한다.

의도:

Cloud Function 왕복 시간 때문에 빠른 편집 화면이 0.5~1초 동안 남는 체감을 없애면서도, Activity나 process가 사라진 뒤 Command가 유실되지 않게 한다. 화면 수명과 서버 성공을 분리하되 암호화 영속 접수, 고정 멱등 key, 오류 분류를 통해 즉시 반응성과 서버 권위를 함께 유지한다.

영향 요구사항: QE-002~006, QE-009, QE-010, QE-012, AND-009, AND-011, T-QE-002, T-QE-003, T-QE-007.
