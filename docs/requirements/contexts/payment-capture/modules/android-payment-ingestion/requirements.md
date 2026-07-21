# Android 결제 알림 수집 모듈 요구사항

> 상위 Bounded Context: [Payment Capture](../../requirements.md)  
> 아키텍처 역할: Android Edge Parser / Inbound Adapter / Application  
> 상세 설계: [모듈 상세 설계](design.md)  
> 상태와 테스트 수준 표기는 [공통 문서 규칙](../../../../governance/conventions.md)을 따릅니다.

## 1. 독립 모듈 책임

이 모듈은 Android 시스템 알림을 결제 입력으로 변환하는 단일 유스케이스 경계를 소유합니다. 알림 envelope 생성, 출처 선택, 공급자별 파싱, 승인 저장 결정, 취소 대상 탐색까지 담당하며 UI, Firestore SDK, FCM 전송 방식과 분리되어야 합니다.

핵심 출력은 선택적인 승인·취소 후보와 선택적인 지역화폐 잔액 후보입니다. 한 알림에 두 후보가 함께 있거나 잔액만 있어도 각각 독립 branch로 제출하며, 실제 거래와 잔액 변경은 거래 원장·지역화폐 모듈의 공개 포트를 통해 요청합니다. 파서 개선용 원문 수집은 운영 Domain 규칙이 아니라 교체·제거 가능한 Diagnostic Adapter입니다.

## 2. 포함·제외 범위

포함 범위:

- Android 알림 필드에서 정규화된 입력 envelope 생성
- 등록된 패키지와 그 패키지에 연결된 전용 parser에 따른 출처 선택
- 카드·간편결제·지역화폐·청구 공급자별 승인/취소 파싱
- 30초 메모리 중복과 영속 거래 중복 판정
- 가맹점 규칙, 기본 카테고리, 등록 카드 일치 결과를 조합한 승인 저장 결정
- 취소 원거래 탐색과 일반 거래·월 분할 그룹 취소 명령 생성
- 저장 성공이 확인된 뒤 QuickEdit 및 완료 event에 결과 전달
- 원문 없는 수집 observation과 거래·잔액 branch key를 암호화 로컬 Queue에 보관하고 branch별 같은 idempotency key로 서버 전송 재시도
- 자동 등록 원본의 불변 capture provenance와 이후 분할·합치기까지 이어지는 lineage 계약 생성
- 파서 개선 기간에 한정된 진단 원문 Adapter 호출

제외 범위:

- 거래 원장의 일반 CRUD·분할 계산 자체
- 가맹점 규칙과 등록 카드의 생성·수정 정책
- 지역화폐 잔액 aggregate의 소유권과 Web 표시
- QuickEdit UI와 오버레이 권한
- FCM 대상 계산과 전송
- `notification_debug_logs`를 영구 업무 데이터나 Domain entity로 승격하는 작업

## 3. 소유 데이터

| 데이터 | 이 모듈의 권한 | 비고 |
|---|---|---|
| 지원 출처 순서와 공급자별 파서 | 소유 | 코드와 골든 fixture가 함께 변경되어야 합니다. |
| 30초 알림 중복 cache | 소유 | 프로세스 수명 안의 일시 상태입니다. |
| 파싱 결과 DTO | 소유 | 선택적인 승인·취소 후보와 잔액 후보, 금액, 일시, 가맹점, 카드, parser 메타데이터를 표현합니다. |
| Capture provenance·lineage 입력 계약 | 소유 | 원 알림에서 추출한 불변 결제 증거와 observation ID를 Ledger 공개 Port에 전달합니다. 파생 거래 자체는 Ledger가 소유합니다. |
| `expenses` | 비소유 Writer | 거래 원장 포트를 통해서만 생성·조회·삭제합니다. |
| `merchant_rules` | 읽기 의존 | 가맹점 규칙 모듈의 매칭 계약을 사용합니다. |
| `registered_cards` | 읽기 의존 | 등록 카드 모듈의 소유자·wildcard 매칭 계약을 사용합니다. |
| `households`, `categories` | 읽기 의존 | 가구 범위와 기본 카테고리만 조회합니다. |
| `notification_debug_logs` | 임시 Diagnostic Adapter | [DEC-002](../../../../governance/decisions.md#dec-002)에 따라 Domain 밖에 격리하고 파서 안정화 후 제거합니다. |

## 4. 공개 계약·의존 모듈

공개 입력 계약은 알림 패키지명, 게시 시각, 제목, `text`, `bigText`, `textLines`를 담은 `NotificationEnvelope`입니다. 공개 출력 계약은 거래 branch와 잔액 branch의 생성·중복·무시·거부·재시도 결과를 각각 구분하며, 한쪽 결과로 다른 쪽 결과를 성공 또는 실패로 축약하지 않습니다. 성공한 거래 결과에만 거래 문서 ID 또는 원자적 취소 결과를 포함합니다.

의존 모듈:

- 거래 원장: 지출 생성, 중복 조회, 취소 후보 조회, 일반 거래·월 분할 그룹의 원자적 삭제
- 가맹점 규칙: 활성 규칙 선택과 가맹점·카테고리·메모 mapping
- 등록 카드: 현재 멤버 소유 카드와 카드사·마스킹 번호 일치
- 가구·카테고리: 가구 키와 기본 카테고리 조회
- Android Host: 알림 접근 권한과 알림 전달
- QuickEdit: 저장 성공 결과만 소비
- 지역화폐 잔액: 거래 branch와 독립된 `RecordBalanceObservation` 결과 제공
- 진단 Adapter: 임시 원문 보관이며 Domain 출력이나 저장 성공 여부에 영향을 주지 않음

### 4.1 출처 패키지 계약

현재 구현은 KB → NH → 네이버페이 → 토스 → 카카오페이 → 온누리 → Paybooc → SMS → 삼성 → 롯데 → 경기 → 대전 → 세종 → 도시가스 순으로 package 또는 본문을 평가하고 첫 일치에서 멈춘다. 아래 표의 `본문만으로 선택`은 현재 구현을 특성화한 것이며 목표 정책이 아니다.

| 출처 | 알려진 패키지 | 본문만으로 선택 |
|---|---|---|
| KB | com.kbcard.cxh.appcard, com.kbcard.kbkookmincard | 가능 |
| NH | nh.smart.nhallonepay | 가능 |
| 네이버페이 | com.naverfin.payapp | 가능 |
| 토스 | viva.republica.toss | 가능 |
| 카카오페이 | com.kakaopay.app | 가능 |
| 디지털 온누리 | com.komsco.kpay | 가능 |
| Paybooc/ISP | kvp.jjy.MispAndroid320 | 가능 |
| 경기지역화폐 | com.mobiletoong.gpay, com.coocon.chakwallet, gov.gyeonggi.ggcard | 가능 |
| 대전사랑카드 | kr.co.nmcs.daejeonpay | 가능 |
| 세종 여민전 | gov.sejong.yeominpay | 가능 |
| 삼성·롯데 | parser용 고정 패키지 없음 | 가능 |
| 도시가스 | com.kakao.talk | 패키지와 본문이 모두 일치해야 함 |
| SMS | com.google.android.apps.messaging, com.samsung.android.messaging, com.android.mms | 지원 결제 본문도 일치해야 함 |

신한·삼성·현대·롯데·하나·우리·IBK·은행 앱 일부는 debug-only 패키지로 등록되어 있다. 이 목록은 지출 parser 지원 목록이 아니라 원문 로그 수집 목록이다. 토스 제목이 숫자와 걸음 형식이면 원문 로그에서 제외한다.

[DEC-005](../../../../governance/decisions.md#dec-005)에 따른 목표 계약에서는 Source Registry에 등록된 package만 입력을 통과한다. Registry는 package마다 source와 전용 parser를 명시하며, source 선택에 본문 패턴을 package 검증의 대체 조건으로 사용하지 않는다. 미등록 package는 진단 정책에 따른 임시 원문 수집 대상이 될 수는 있지만 지출 생성·취소·잔액 갱신에는 진입할 수 없다.

## 5. 요구사항

### 5.1 수집·출처 선택·중복 처리

| ID | 상태 | 요구사항 | 경계·예외 | 근거 | 테스트 |
|---|---|---|---|---|---|
| ING-001 | 현재 명세 | 알림에서 제목, 기본 본문, 확장 본문, text lines를 추출하고 text lines, bigText, text 순으로 본문을 선택한다. | 최종 문자열이 비면 처리하지 않는다. | [CardNotificationListenerService](../../../../../../android/app/src/main/java/com/household/account/service/CardNotificationListenerService.kt) | U, UI |
| ING-002 | 목표 명세 | Source Registry에 등록된 package의 알림만 수용하고 그 package에 매핑된 전용 parser만 실행한다. | 미등록 package는 본문이 지원 형식과 일치해도 무시한다. 등록 package의 parser가 실패해도 다른 source parser로 fallback하지 않는다. | [CardNotificationListenerService](../../../../../../android/app/src/main/java/com/household/account/service/CardNotificationListenerService.kt), [DEC-005](../../../../governance/decisions.md#dec-005) | U |
| ING-003 | 현재 명세 | parser가 승인 결과를 만들면 등록 흐름, 취소 결과를 만들면 취소 흐름을 실행한다. | parser 실패 또는 거래 없음이면 저장하지 않는다. | 같은 근거 | U, I |
| ING-004 | 특성화 | 동일 패키지·전체 본문 hash를 30초 동안 메모리 중복으로 보고 재처리를 막는다. | 30,000ms까지 중복이고 30,001ms부터 다시 처리한다. 프로세스 재시작 시 기록이 사라진다. | 같은 근거 | U |
| ING-005 | 결함 | `notification_debug_logs`는 파서 개선 기간에만 활성화하는 교체 가능한 Diagnostic Adapter이며, 인증된 household·member가 있는 등록 source 입력의 package·source·title·text·bigText·textLines·fullText·시각을 관리자 전용 ACL과 함께 best-effort로 저장한다. | 시간 TTL·자동 개별 삭제·중복 표본 삭제 없이 기능 제거 전까지 기존·신규 문서를 전부 보존한다. 진단 실패는 업무 결과를 바꾸지 않고 원문을 Domain·Queue·receipt·Event로 전달하지 않는다. 파서 안정화 뒤 Writer·Rules·index·collection을 함께 제거한다. | [알림 수집 Service](../../../../../../android/app/src/main/java/com/household/account/service/CardNotificationListenerService.kt), [NotificationDebugLogRepository](../../../../../../android/app/src/main/java/com/household/account/data/NotificationDebugLogRepository.kt), [DEC-002](../../../../governance/decisions.md#dec-002), [DEC-047](../../../../governance/decisions.md#dec-047) | I, 보안 E2E |
| ING-006 | 현재 명세 | Google 메시지, Samsung 메시지, Android MMS는 지원 결제 형식과 일치할 때 SMS 입력으로 처리한다. | 후보는 전체, 첫 행 제거, 첫 두 행 제거 순이다. | [SmsNotificationParser](../../../../../../android/app/src/main/java/com/household/account/parser/SmsNotificationParser.kt) | U |
| ING-007 | 현재 명세 | 각 SMS 후보는 KB → NH → 네이버페이 → 토스 → 카카오페이 → 온누리 → Paybooc → 삼성 → 롯데 → 경기 → 대전 순으로 시도하고, 모두 실패하면 문자 청구 parser를 마지막에 시도한다. | 후보별 첫 성공 결과만 사용한다. 세종·도시가스 parser는 현재 SMS 내부 순서에 포함되지 않는다. | 같은 근거 | U |
| ING-008 | 목표 명세 | Android는 원문 없는 최소 수집 observation과 존재하는 거래·잔액 branch key를 Android Keystore 키 기반 AES-256-GCM 로컬 Queue에 먼저 저장하고 같은 idempotency key로 서버 전송을 재시도한다. | 최대 보존은 `queuedAt`부터 72시간이다. 모든 존재 branch의 terminal 서버 결과, 로그아웃·멤버·가구 변경, 만료, 키 무효화·복호화 실패 시 즉시 삭제한다. 한 branch가 성공하고 다른 branch가 retryable이면 entry와 미완료 branch key를 유지하며 성공 branch를 다시 실행하지 않는다. | [DEC-032](../../../../governance/decisions.md#dec-032) | U, I, 보안 E2E |
| ING-009 | 목표 명세 | 한 알림에서 거래 후보와 잔액 후보를 독립 branch로 만들고 서버 receipt에 각 branch의 상태·결과·downstream key를 따로 보존한다. | balance-only는 Payment Configuration·Ledger를 호출하지 않는다. 카드 미등록·거래 parse 실패·Ledger 실패가 유효한 잔액 제출을 막지 않고, 잔액 실패도 이미 확정된 거래를 되돌리거나 실패로 바꾸지 않는다. 지역화폐 payment branch에는 parser가 검증한 localCurrencyType만 전달하고 홈 선택값으로 추정하지 않는다. | [알림 수집 Service](../../../../../../android/app/src/main/java/com/household/account/service/CardNotificationListenerService.kt), [지역화폐 잔액 요구사항](../../../household-finance/modules/local-currency/requirements.md#5-요구사항), [DEC-057](../../../../governance/decisions.md#dec-057) | U, I, C |

### 5.2 지원 입력 형식

| ID | 상태 | 출처 | 현재 지원 동작 | 근거 | 테스트 |
|---|---|---|---|---|---|
| PARSE-KB-001 | 현재 명세 | KB국민카드 | 승인·취소, MM/DD HH:mm 형식과 금액·일시 요약 형식, 국민(번호), 가맹점 추출. 요약형 시간은 게시 시각, 없으면 00:00 | [KBCardParser](../../../../../../android/app/src/main/java/com/household/account/parser/KBCardParser.kt) | U |
| PARSE-NH-001 | 현재 명세 | NH Pay | 승인·승인취소, 금액·M/D HH:mm·가맹점·농협 카드 토큰 추출 | [NHPayParser](../../../../../../android/app/src/main/java/com/household/account/parser/NHPayParser.kt) | U |
| PARSE-NAVER-001 | 현재 명세 | 네이버페이 | 가맹점에서 금액을 결제했다는 승인 문장을 처리하고 게시 시각, 없으면 현재 시각을 거래 시각으로 사용 | [NaverPayParser](../../../../../../android/app/src/main/java/com/household/account/parser/NaverPayParser.kt) | U |
| PARSE-TOSS-001 | 현재 명세 | 토스 | 승인·취소, 체크카드·페이스페이 형식, 가승인 제외, 승인 시 max(총액-캐시백, 0), 취소는 총액 사용 | [TossBankParser](../../../../../../android/app/src/main/java/com/household/account/parser/TossBankParser.kt) | U |
| PARSE-KAKAO-001 | 현재 명세 | 카카오페이 | 결제 완료 제목과 본문의 가맹점·금액을 승인으로 처리하고 게시 시각, 없으면 현재 시각 사용 | [KakaoPayParser](../../../../../../android/app/src/main/java/com/household/account/parser/KakaoPayParser.kt) | U |
| PARSE-ONNURI-001 | 현재 명세 | 디지털 온누리 | 상품권 결제 문장의 가맹점·금액을 승인으로 처리하고 게시 시각, 없으면 현재 시각 사용 | [DigitalOnnuriParser](../../../../../../android/app/src/main/java/com/household/account/parser/DigitalOnnuriParser.kt) | U |
| PARSE-PAYBOOC-001 | 현재 명세 | Paybooc/ISP | 인라인·분리형 승인과 매출취소, 양수 금액·비어 있지 않은 가맹점, 카드 라벨·마스킹 번호 정규화 | [PayboocISPParser](../../../../../../android/app/src/main/java/com/household/account/parser/PayboocISPParser.kt) | U |
| PARSE-SAMSUNG-001 | 현재 명세 | 삼성카드 | 승인·취소, 금액, MM/DD HH:mm, 가맹점, 삼성 카드 번호 추출 | [SamsungCardParser](../../../../../../android/app/src/main/java/com/household/account/parser/SamsungCardParser.kt) | U |
| PARSE-LOTTE-001 | 현재 명세 | 롯데카드 | 승인·취소, 금액, 카드 토큰, 일시불·할부 메타데이터와 가맹점 추출 | [LotteCardParser](../../../../../../android/app/src/main/java/com/household/account/parser/LotteCardParser.kt) | U |
| PARSE-GYEONGGI-001 | 현재 명세 | 경기지역화폐 | 결제 지출과 잔액을 별도로 추출하고 local_currency로 분류 | [GyeonggiLocalCurrencyParser](../../../../../../android/app/src/main/java/com/household/account/parser/GyeonggiLocalCurrencyParser.kt) | U, I |
| PARSE-DAEJEON-001 | 현재 명세 | 대전사랑카드 | 상세·fallback 승인 형식, 카드 번호, 가맹점, 잔액 추출 | [DaejeonLocalCurrencyParser](../../../../../../android/app/src/main/java/com/household/account/parser/DaejeonLocalCurrencyParser.kt) | U, I |
| PARSE-SEJONG-001 | 현재 명세 | 세종 여민전 | 결제 완료와 보유 잔액을 각각 추출하고 local_currency로 분류 | [SejongLocalCurrencyParser](../../../../../../android/app/src/main/java/com/household/account/parser/SejongLocalCurrencyParser.kt) | U, I |
| PARSE-CITYGAS-001 | 결함 | KakaoTalk 도시가스 청구 | 도시가스 청구 문구와 총액이 있으면 fixed·bill 지출을 만든다. 제목이 일치하면 청구 월과 memo를 사용하고, 제목이 없으면 알림 수신 월로 가맹점명을 만들며 memo는 빈 값이다. 유효한 납부마감일은 지출 날짜이고 문구가 없으면 알림 수신일을 사용한다. 현재 마감일 문구가 있으나 유효하지 않으면 전체 parse가 실패하는 결함은 목표에서 알림 수신일 fallback으로 교정한다. | [CityGasBillParser](../../../../../../android/app/src/main/java/com/household/account/parser/CityGasBillParser.kt), [DEC-007](../../../../governance/decisions.md#dec-007) | U |
| PARSE-SMSBILL-001 | 현재 명세 | NH 문자 청구 | 월별 관리비 등 카드 정상 납부 완료 메시지를 승인 지출로 만든다. | [SmsCardMessageParser](../../../../../../android/app/src/main/java/com/household/account/parser/SmsCardMessageParser.kt) | U |
| PARSE-COMMON-001 | 목표 명세 | 모든 Android parser 시간 기준 | `NotificationEnvelope.postedAt`을 `Asia/Seoul`로 변환해 수신 시각·날짜 추론 기준으로 사용하고, 유효한 게시 시각이 없을 때만 주입 `Clock`을 사용한다. 기기 기본 timezone과 처리 실행 시각을 직접 읽지 않는다. | [KB parser](../../../../../../android/app/src/main/java/com/household/account/parser/KBCardParser.kt), [LocalCurrencyParsingSupport](../../../../../../android/app/src/main/java/com/household/account/parser/LocalCurrencyParsingSupport.kt), [CityGas parser](../../../../../../android/app/src/main/java/com/household/account/parser/CityGasBillParser.kt), [DEC-023](../../../../governance/decisions.md#dec-023), [DEC-029](../../../../governance/decisions.md#dec-029) | U, C |

각 parser의 골든 샘플, 현재 ParseResult/Expense 출력, 승인·취소 여부, 날짜 추론, 카드 정규화는 별도 Fixture로 관리한다. 장차 공통 입력 DTO를 만들더라도 현재 구현 명세와 혼동하지 않도록 별도 이름을 사용한다. 현재 연도·기기 기본 timezone·처리 시점의 `now`를 직접 사용하는 동작은 레거시 결함으로 두고, 목표 parser는 PARSE-COMMON-001과 DEC-029의 `PaymentOccurrenceYearPolicyV1`으로 서울 수신 시각보다 미래가 아닌 가장 가까운 유효 연도를 선택한다. 토스 캐시백 승인·취소 금액 불일치는 별도 결함이다.

### 5.3 승인 저장

| ID | 상태 | 요구사항 | 경계·예외 | 근거 | 테스트 |
|---|---|---|---|---|---|
| ING-SAVE-001 | 현재 명세 | 승인 저장에는 가구 키가 필요하며, 없으면 저장하지 않는다. | 식별 실패를 성공으로 보고하면 안 된다. | [CardNotificationListenerService](../../../../../../android/app/src/main/java/com/household/account/service/CardNotificationListenerService.kt) | U |
| ING-SAVE-002 | 현재 명세 | 활성 가맹점 규칙을 가장 먼저 적용한다. 규칙이 없고 도시가스 청구이면 parser의 fixed를 유지하며, 그 밖의 결제는 가구 기본 카테고리를 사용한다. | 도시가스도 규칙과 일치하면 카테고리·가맹점·메모가 치환된다. | [알림 수집 Service](../../../../../../android/app/src/main/java/com/household/account/service/CardNotificationListenerService.kt), [가맹점 규칙 선택 정책](../../../../../../functions/src/contexts/payment-capture/configuration/domain/policies/merchantRuleSelection.ts), [CategoryRepository](../../../../../../android/app/src/main/java/com/household/account/data/CategoryRepository.kt) | U, I, C |
| ING-SAVE-003 | 목표 명세 | 도시가스 외 결제는 인증된 현재 멤버의 등록 카드가 하나 이상 일치할 때만 저장한다. | 타 멤버 카드는 후보에서 제외한다. 본인 카드 여러 건 일치는 허용하며 임의 카드 선택 없이 parser 증거를 유지한다. 마스킹 wildcard와 여민전·세종 라벨 호환을 지원한다. | [본인 카드 판정 정책](../../../../../../functions/src/contexts/payment-capture/configuration/domain/policies/ownCardResolution.ts), [DEC-028](../../../../governance/decisions.md#dec-028) | U, I |
| ING-SAVE-004 | 현재 명세 | wildcard 매칭 후 등록 카드의 정규 번호를 알림 카드값에 반영한다. | 양쪽에 비교 가능한 토큰이 있을 때 적용한다. | [CardNotificationListenerService](../../../../../../android/app/src/main/java/com/household/account/service/CardNotificationListenerService.kt) | U |
| ING-SAVE-005 | 현재 명세 | 영속 중복 기준은 가구·날짜 범위 안의 transactionType·시간·금액·정규화 가맹점이며, 모두 같으면 후속 거래를 저장하지 않는다. | 카드는 의도적으로 기준에 포함하지 않는다. 같은 가맹점·금액·분의 실제 중복 결제는 없다고 보고 parser 오동작으로 생긴 중복을 차단하는 정책이다. | [Capture provenance 정책](../../../../../../functions/src/contexts/payment-capture/android-payment-ingestion/domain/policies/captureProvenancePolicy.ts) | U, I |
| ING-SAVE-006 | 목표 명세 | Android 자동 등록 지출은 검증된 현재 멤버를 `creatorMemberId`로 Ledger 저장 Command에 포함하고, 저장 성공 후 해당 Android 기기에서 QuickEdit만 실행한다. | 생성자가 없으면 거래 자체를 저장하지 않는다. creator는 Ledger transaction에서 거래와 함께 확정하며 클라이언트 후속 효과로 나중에 연결하지 않는다. 생성자 본인 또는 다른 가구원에게 자동 푸시를 요청하지 않으며, 저장 실패·미확정 결과에서는 QuickEdit과 완료 broadcast를 실행하지 않는다. | [CardNotificationListenerService](../../../../../../android/app/src/main/java/com/household/account/service/CardNotificationListenerService.kt), [DEC-013](../../../../governance/decisions.md#dec-013) | U, I, UI |
| ING-SAVE-007 | 목표 명세 | 승인 observation은 observationId·source/parser version·원 금액·원 가맹점 증거·카드 증거·발생 시각을 불변 capture provenance로 만들고 Ledger 거래의 안정적인 captureLineageId와 연결한다. | QuickEdit 수정과 항목·월 분할·합치기가 표시 필드를 바꿔도 provenance를 덮어쓰거나 버리지 않는다. 원문 전체는 provenance에 포함하지 않고 내부 취소·감사 Port에서만 사용한다. 구조 변경 원본은 취소 전까지 `superseded`로 보존한다. | [QuickEdit](../../../../../../android/app/src/main/java/com/household/account/QuickEditActivity.kt), [Capture provenance 정책](../../../../../../functions/src/contexts/payment-capture/android-payment-ingestion/domain/policies/captureProvenancePolicy.ts), [DEC-041](../../../../governance/decisions.md#dec-041) | U, I, C |

### 5.4 취소

| ID | 상태 | 요구사항 | 경계·예외 | 근거 | 테스트 |
|---|---|---|---|---|---|
| CAN-001 | 현재 명세 | 취소 알림의 가맹점명 규칙을 적용하고 같은 가구의 원거래를 찾는다. | 가구 키가 없으면 취소하지 않는다. | Android 알림 Service와 [취소 일치 정책](../../../../../../functions/src/contexts/payment-capture/android-payment-ingestion/domain/policies/cancellationMatch.ts) | U, I |
| CAN-002 | 결함 | 목표 취소 후보 검색은 일반 거래와 월 분할 그룹 모두 취소일에서 최대 30일 전까지 같은 날짜 범위를 사용한다. | 현재 일반 거래는 30일을 검색하지만 직접 일치가 없는 분할 그룹 fallback은 취소 당일 문서만 seed로 조회한다. 날짜 파싱 실패 시 목표도 당일 범위만 사용한다. | [취소 검색 기간 정책](../../../../../../functions/src/contexts/payment-capture/android-payment-ingestion/domain/policies/cancellationSearchWindow.ts) | U, I |
| CAN-003 | 목표 명세 | 금액·정규화된 가맹점·카드가 모두 일치하는 원거래만 취소 후보로 허용한다. | 월 분할 내림 오차는 CAN-006 범위에서 허용한다. 완전 일치 원거래가 없으면 무변경 `NotFound`이며 대기 취소·tombstone·미래 승인 억제를 만들지 않는다. 이후 승인은 일반 입력으로 등록한다. 완전 일치 후보가 여러 건이면 임의 선택하지 않는다. | 같은 근거와 [DEC-012](../../../../governance/decisions.md#dec-012), [DEC-031](../../../../governance/decisions.md#dec-031) | U, I |
| CAN-004 | 현재 명세 | 원거래가 월 분할 그룹이면 그룹 전체를, 일반 거래이면 해당 문서만 삭제한다. | 그룹 삭제의 원자성은 CAN-005에서 다룬다. | 같은 근거 | U, I |
| CAN-005 | 결함 | 취소 대상 전체 삭제는 원자적으로 성공하거나 전부 실패해야 한다. | 현재 순차 삭제와 예외 은폐는 보존하지 않는다. | 같은 근거 | I |
| CAN-006 | 현재 명세 | 월 분할 그룹 합계가 취소액보다 최대 분할 개수-1원 작아도 의도한 월 분할 내림 오차로 보고 취소 후보로 허용한다. | DEC-001의 나머지 미반영 정책과 함께 유지한다. | [취소 일치 정책](../../../../../../functions/src/contexts/payment-capture/android-payment-ingestion/domain/policies/cancellationMatch.ts) | U, I |
| CAN-007 | 목표 명세 | 취소 후보는 현재 편집값이 아니라 ING-SAVE-007의 capture provenance와 captureLineageId로 원 승인을 식별하고, 완전 일치하는 유일한 lineage이면 사용자 확인 없이 원본·수정·분할·합치기 파생 지출 전체 삭제를 요청한다. | 다른 승인 lineage와 합쳐진 파생 거래는 제거하되 다른 원본은 같은 UoW에서 복원한다. 원본·파생·복원·receipt 변경은 전부 성공하거나 전부 실패하며, 완료 뒤 사용자 원복은 제공하지 않는다. 원거래 없음은 무변경이고 후보가 여러 개면 `NeedsConfirmation`이다. | [DEC-041](../../../../governance/decisions.md#dec-041) | U, I |

## 6. 현재 흐름

### 6.1 Android 승인 흐름

1. 지원 알림의 최적 본문을 만든다.
2. 원문 로그 저장 대상이면 파싱과 중복 검사보다 먼저 비동기 저장을 시도한다.
3. 패키지와 본문 우선순위로 출처를 하나 선택한다.
4. 동일 패키지·본문의 30초 메모리 중복을 검사한다.
5. parser가 거래 후보 ParseResult/Expense를 만들고 지역화폐 source면 잔액을 별도로 파싱한다.
6. 현재 잔액 저장은 거래 parse·카드 매칭·지출 저장 결과보다 먼저 별도 coroutine으로 실행될 수 있다.
7. 거래 후보에는 가맹점 규칙, 기본 카테고리, 등록 카드, 영속 중복을 차례로 평가한다.
8. 지출 추가가 문서 ID를 반환하면 QuickEdit을 시작한다.
9. 현재는 저장 실패 여부와 무관하게 broadcast를 보낼 수 있다.
10. Android 문서에는 현재 createdBy가 없어 생성 trigger 기반 푸시가 우연히 발생하지 않는다.

교정할 불변식은 creatorMemberId를 항상 기록하되 [DEC-013](../../../../governance/decisions.md#dec-013)의 Android source 정책으로 자동 푸시를 만들지 않고, 저장 성공이 확인된 경우에만 QuickEdit과 완료 event를 발생시키는 것이다. 거래와 잔액은 독립 branch·receipt로 현재의 독립성을 보존하되 재시도와 부분 성공을 명시적으로 관찰한다. 원문 로그는 [DEC-002](../../../../governance/decisions.md#dec-002) 정책을 따른다.

연결 요구사항: ING-001~009, PARSE-*, MER-001~006, CARD-004, ING-SAVE-001~007, QE-001, BAL-005.

### 6.2 Android 취소 흐름

1. 취소 후보를 파싱하고 가맹점명 규칙을 적용한다.
2. 일반 거래는 취소일로부터 30일 범위를 검색한다. 현재 직접 일치가 없는 월 분할 fallback은 취소 당일만 seed로 조회하는 결함이 있다.
3. 일반 거래 또는 분할 그룹 전체를 삭제 대상으로 만든다.
4. 현재는 문서를 순차 삭제하고 Repository가 개별 오류를 숨긴 뒤 완료 broadcast를 보낼 수 있다.

교정할 불변식은 모든 후보 유형에 같은 30일 범위를 적용하고, 완전 일치하는 유일한 capture lineage의 원본·모든 파생 지출 삭제와 다른 lineage 복원이 원자적으로 성공한 경우에만 완료 event를 발생시키는 것이다. 완료 뒤에는 최소 cancellation receipt와 dedup tombstone만 남겨 같은 승인·취소 재전송이 지출을 재생성하지 않게 한다.

연결 요구사항: CAN-001~007, ING-SAVE-007, LED-008~009, SPL-003, SPL-005, DEC-041.

## 7. 정상 요구사항으로 고정하지 않을 결함

- `notification_debug_logs`의 기존 Android 직접 write·공개 읽기 결함은 교정되었습니다. Android는 `submitNotificationDiagnostic` callable에 원문 필드와 게시 시각만 best-effort로 보내며, 서버가 Firebase Auth의 유일한 활성 membership과 서버 소유 진단 source registry를 확인해 actor·source를 확정합니다. Rules는 시스템 관리자 읽기만 허용하고 client write를 거부하며, TTL 없는 전체 보존과 Secret 비수집 정책은 유지합니다.
- `package in knownPackages || Parser.matches(text)` 조건 때문에 본문만 맞는 미등록 package도 승인 입력이 될 수 있습니다. Source Registry를 선행 gate로 사용하지 않는 현재 출처 선택은 DEC-005와 다른 결함입니다.
- 공급자 parser가 연도 없는 날짜에 현재 연도를 고정하는 연말·연초 오류와 Android·Shortcut 정책 불일치는 DEC-029 공통 Policy로 교정해야 합니다.
- 여러 parser가 기기 기본 timezone과 처리 시점의 `now`를 사용하여 같은 게시 시각도 기기·재처리 시점에 따라 다른 날짜가 될 수 있습니다.
- 토스 캐시백 승인과 취소가 서로 다른 금액 기준을 사용합니다.
- 저장·삭제 실패에도 완료 broadcast 또는 성공 UI가 발생할 수 있고 일부 Android Repository가 예외를 숨깁니다.
- 현재 취소 fallback은 가맹점이 다른 같은 금액·카드 거래를 삭제할 수 있어 DEC-012를 위반하는 결함입니다.
- 월 분할 그룹 취소가 순차 삭제라 부분 성공할 수 있습니다.
- 직접 일치가 없는 월 분할 그룹 fallback은 취소 당일만 조회하여 30일 검색 명세와 다릅니다.
- QuickEdit 수정·항목 분할이 취소 판정에 필요한 원 금액·가맹점·카드 lineage를 보존하지 않습니다.
- Android 자동 등록 문서에 안정적인 생성자 식별자가 없어 거래 생성 푸시 흐름이 시작되지 않습니다.

## 8. 관련 제품 결정

| 결정 | 상태 | 이 모듈에 미치는 영향 |
|---|---|---|
| [DEC-001](../../../../governance/decisions.md#dec-001) | 확정 | 월 분할 내림 오차를 취소 후보 허용 범위에도 유지합니다. |
| [DEC-002](../../../../governance/decisions.md#dec-002) | 확정 | `notification_debug_logs`는 임시 Diagnostic Adapter이며 파서 안정화 후 제거합니다. |
| [DEC-003](../../../../governance/decisions.md#dec-003) | 확정 | 같은 가구·날짜·시간·금액·가맹점이면 카드가 달라도 후속 거래를 버립니다. |
| [DEC-005](../../../../governance/decisions.md#dec-005) | 확정 | Source Registry에 등록된 package만 수용하고 매핑된 전용 parser만 실행합니다. |
| [DEC-007](../../../../governance/decisions.md#dec-007) | 확정 | 도시가스 지출의 회계일은 납부마감일이며, 파싱 실패 시에만 알림 수신일을 사용합니다. |
| [DEC-012](../../../../governance/decisions.md#dec-012) | 확정 | 금액·정규 가맹점·카드가 모두 일치하는 원거래만 취소하며, 없으면 아무 데이터도 변경하지 않습니다. |
| [DEC-013](../../../../governance/decisions.md#dec-013) | 확정 | 현재 멤버를 생성자로 기록하지만 자동 푸시는 보내지 않고 Android QuickEdit만 실행합니다. |
| [DEC-028](../../../../governance/decisions.md#dec-028) | 확정 | 현재 멤버의 등록 카드만 조회하고 하나 이상 일치하면 저장합니다. 타 멤버 카드의 일치 여부는 무시하고 본인 카드 여러 건 일치도 허용합니다. |
| [DEC-029](../../../../governance/decisions.md#dec-029) | 확정 | 연도 없는 결제 시각은 서울 수신 시각보다 미래가 아닌 가장 가까운 연도로 추론하며 Shortcut과 같은 Policy·fixture를 사용합니다. |
| [DEC-031](../../../../governance/decisions.md#dec-031) | 확정 | 원거래 없는 취소는 무변경 종료하고 보류·억제 기록을 만들지 않으며 이후 승인은 일반 입력으로 등록합니다. |
| [DEC-032](../../../../governance/decisions.md#dec-032) | 확정 | 원문 없는 observation을 Keystore 키 기반 AES-256-GCM으로 암호화해 최대 72시간 Queue에 보관하고 terminal·로그아웃·가구 변경·만료 시 삭제합니다. |
| [DEC-041](../../../../governance/decisions.md#dec-041) | 확정 | 완전 일치하는 유일한 capture lineage는 원본·모든 파생 지출을 자동 원자 삭제하고 다른 결제 lineage는 보존합니다. |
| [DEC-047](../../../../governance/decisions.md#dec-047) | 확정 | 임시 진단 문서는 TTL 없이 전부 보존하며 파서 진단 기능 제거 시 Writer·Rules·index·컬렉션을 함께 제거합니다. |

## 9. 모듈 테스트 시나리오

| 테스트 ID | 종류 | Given / When / Then | 연결 요구사항 |
|---|---|---|---|
| T-CAN-001 | 목표 | 월 분할 그룹 / 원금 취소 / 그룹 전체가 한 트랜잭션으로 삭제 | CAN-004, CAN-005 |
| T-CAN-002 | 목표 | 승인보다 취소 알림이 먼저 도착하고 원거래 없음 / 취소 처리 후 승인 처리 / 취소는 `NotFound`·무변경·후속 작업 없음, 이후 승인은 정상 등록 | CAN-003, ING-SAVE-005, DEC-031 |
| T-CAN-004 | 현재 명세 | actor 가구 없음, 가맹점 규칙 있음·없음 / 취소 후보 조회 준비 / actor 없으면 조회·변경 없음, 규칙이 있으면 mapped 가맹점, 없으면 정규 원 가맹점으로 같은 가구를 조회 | CAN-001 |
| T-CAN-006 | 현재 명세 | 월 분할 개수 1·2·12와 취소액 차이 `count-1`·`count` / 취소 일치 판정 / `count-1`까지 허용하고 `count`부터 불일치 | CAN-006, DEC-001 |
| T-DUP-001 | 특성화 | 같은 가구·날짜·분·금액·정규 가맹점의 다른 카드·Android/Shortcut source와 날짜·분·금액·가맹점 중 하나씩 다른 쌍 / 승인 두 건 / 완전 동일 tuple의 두 번째만 중복으로 버리고 한 요소라도 다르면 별도 거래 생성 | ING-SAVE-005, IOS-006, DEC-003 |
| T-ING-001 | 특성화 | text·bigText·textLines와 제목 / envelope 생성 / textLines 우선이며 제목이 첫 줄 | ING-001 |
| T-ING-002 | 특성화 | 같은 package·본문을 29,999ms·30,000ms·30,001ms 간격으로 입력 / 처리 / 앞 둘 중복, 마지막 재처리 | ING-004 |
| T-ING-003 | 목표 | 등록 KB package+KB 본문, 등록 KB package+토스 본문, 미등록 package+KB 본문 / 출처 판별·parse / 첫 입력만 KB 처리, 둘째는 KB 실패 후 fallback 없음, 셋째는 parser 실행 없이 무시 | ING-002, DEC-005 |
| T-QUEUE-001 | 목표 | offline·앱 재시작·72시간 경계·terminal 결과·로그아웃·멤버/가구 변경·키 무효화 / Queue·WorkManager 처리 / 암호문만 저장, 같은 key 재시도, 72시간 미만만 전송, 삭제 조건 뒤 entry·전송 없음 | ING-008, DEC-032 |
| T-DIAG-001 | 목표 | actor 없음·미등록 source·비관리자 읽기·동일 원문 반복·저장 실패·장기 경과 / 진단 수집·조회 / gate 밖 미수집·접근 거부, 등록 입력의 모든 진단 문서 유지, 별도 Secret 비수집, 업무 결과 불변 | ING-005, DEC-047 |
| T-ING-BAL-001 | 목표 | balance-only, 카드 미등록+유효 잔액, 거래 성공+잔액 일시 실패, 거래 실패+잔액 성공, retry / submit / branch별 stable key·result 재생, 성공 branch 재호출·거짓 rollback 없음 | ING-008, ING-009 |
| T-PARSE-001 | 특성화 | 각 공급자 승인 골든 메시지와 Google·Samsung·MMS 후보 / parse·승인 분기 / 현재 ParseResult와 Expense snapshot 일치, 승인 Port만 선택 | ING-003, ING-006, PARSE-KB-001, PARSE-NH-001, PARSE-NAVER-001, PARSE-TOSS-001, PARSE-KAKAO-001, PARSE-ONNURI-001, PARSE-PAYBOOC-001, PARSE-SAMSUNG-001, PARSE-LOTTE-001, PARSE-GYEONGGI-001, PARSE-DAEJEON-001, PARSE-SEJONG-001, PARSE-CITYGAS-001, PARSE-SMSBILL-001 |
| T-PARSE-002 | 특성화 | 각 지원 취소 메시지와 Google·Samsung·MMS 후보 / parse·취소 분기 / 취소와 원 금액·카드·가맹점 추출, 취소 Port만 선택 | ING-003, ING-006, PARSE-KB-001, PARSE-NH-001, PARSE-TOSS-001, PARSE-PAYBOOC-001, PARSE-SAMSUNG-001, PARSE-LOTTE-001 |
| T-PARSE-TIME-001 | 목표 | 기기 timezone이 서울과 다름, 게시 시각 있음·없음, 지연 재처리, 연말·연초 / 모든 parser 실행 / 서울 postedAt 또는 주입 Clock 기준의 동일 결과 | PARSE-COMMON-001, DEC-023, DEC-029 |
| T-SMS-ORDER-001 | 특성화 | 둘 이상의 parser가 동시에 성공 가능한 SMS 후보와 세종·청구 후보 / parse / 명시 순서의 첫 성공, 청구는 마지막, 세종은 내부 후보 아님 | ING-007 |
| T-CITYGAS-001 | 목표 | 제목·마감일 모두 있음, 제목 없음, 마감일 없음, 형식은 맞지만 유효하지 않은 마감일 / parse / 청구 월·memo 또는 수신 월·빈 memo, 유효 마감일 또는 수신일 fallback | PARSE-CITYGAS-001 |
| T-ING-AUTH-001 | 현재 명세 | actor·가구·멤버·제출 capability 없음, 타 가구 actor, 유효 actor / Android 승인 제출 / 식별·인가 실패는 typed 거부와 변경 없음, 유효 actor만 creator를 포함해 거래 생성 | ING-SAVE-001 |
| T-ING-FOLLOWUP-001 | 목표 | creator 있음·없음, Created·편집 가능한/불가능한 Duplicate·Rejected·retryable failure, receipt 확정·미확정 / Android 후속 처리 / creator 필수, 확정 편집 ID에서만 QuickEdit·완료 broadcast, 자동 push 없음 | ING-SAVE-006, QE-001, DEC-013 |
| T-ING-PROV-001 | 목표 | 승인 observation과 검증된 creator / 최초 거래 저장 / observation·source/parser version·원 금액·가맹점·카드·시각·hash를 불변 provenance와 lineage로 거래·dedup claim과 원자 저장하고 전체 원문은 저장하지 않음 | ING-SAVE-006, ING-SAVE-007, DEC-041 |
| T-CAPTURE-LINEAGE-001 | 목표 | 자동 승인 후 가맹점·금액 수정, 항목·월 분할, 다른 승인과 합치기 / 구조 변경 / 원 provenance를 덮어쓰지 않고 모든 파생이 원 lineage 집합을 보존하며 구조 변경 원본은 superseded로 유지 | ING-SAVE-007, DEC-041 |
| T-CAN-LINEAGE-001 | 목표 | 미변경·수정·분할·다른 승인과 합쳐진 lineage, 불완전 legacy, 후보 0·1·복수, commit 실패 / 취소 / 유일 대상의 원본·파생 삭제와 다른 lineage 복원·receipt·dedup tombstone을 원자 확정하고 0건은 NotFound, 복수는 NeedsConfirmation, legacy 불완전은 typed 실패 | CAN-003, CAN-005, CAN-007, DEC-041 |
| T-CAN-003 | 목표 | 취소 1~30일 전 월 분할 그룹이며 취소 당일 seed 없음 / 후보 검색 / 그룹을 범위 안에서 발견하고 31일 전은 제외 | CAN-002 |

추가로 Diagnostic Adapter는 Domain 테스트에서 fake로 대체하고, 원문 저장 실패가 승인·취소 결과를 바꾸지 않는지 검증합니다. 공급자별 비식별 원문과 전체 공개 ParseResult의 단일 fixture는 [`android-provider-parser-golden.v1.json`](../../../../../../contracts/fixtures/payment-capture/android-provider-parser-golden.v1.json)이며 정상 승인, 지원 취소, 빈 필드, 0원·음수, 연말·연초, 마스킹 카드 변형을 포함합니다. parser 선택 테스트는 성공 parser ID 목록 같은 합성 입력으로 이 fixture를 대체할 수 없습니다.

등록 카드 매칭의 공유 시나리오 T-CARD-001은 [결제 설정 모듈 테스트 시나리오](../payment-configuration/requirements.md#8-모듈-테스트-시나리오)가 소유합니다. 이 모듈은 해당 계약 fixture를 소비합니다.

연도 추론의 공유 시나리오 T-PARSE-003은 [Shortcut 모듈 테스트 시나리오](../shortcut-ingestion/requirements.md#9-모듈-테스트-시나리오)가 소유합니다. Android parser도 같은 `FixedClock` JSON fixture를 소비합니다.

## 10. 코드 근거

- [알림 수집 Service](../../../../../../android/app/src/main/java/com/household/account/service/CardNotificationListenerService.kt)
- [Capture 제출 Application](../../../../../../functions/src/contexts/payment-capture/android-payment-ingestion/application/captureSubmissionApplication.ts)
- [진단 로그 Repository](../../../../../../android/app/src/main/java/com/household/account/data/NotificationDebugLogRepository.kt)
- [진단 Callable](../../../../../../functions/src/bootstrap/firebaseNotificationDiagnostic.ts)
- [진단 Firestore Adapter](../../../../../../functions/src/adapters/firebase/payment-capture/firebaseDiagnosticDocumentStore.ts)
- [본인 카드 판정 정책](../../../../../../functions/src/contexts/payment-capture/configuration/domain/policies/ownCardResolution.ts)
- [가맹점 규칙 선택 정책](../../../../../../functions/src/contexts/payment-capture/configuration/domain/policies/merchantRuleSelection.ts)
- [카테고리 Repository](../../../../../../android/app/src/main/java/com/household/account/data/CategoryRepository.kt)
- [SMS parser](../../../../../../android/app/src/main/java/com/household/account/parser/SmsNotificationParser.kt)
- [KB parser](../../../../../../android/app/src/main/java/com/household/account/parser/KBCardParser.kt)
- [NH parser](../../../../../../android/app/src/main/java/com/household/account/parser/NHPayParser.kt)
- [네이버페이 parser](../../../../../../android/app/src/main/java/com/household/account/parser/NaverPayParser.kt)
- [토스 parser](../../../../../../android/app/src/main/java/com/household/account/parser/TossBankParser.kt)
- [카카오페이 parser](../../../../../../android/app/src/main/java/com/household/account/parser/KakaoPayParser.kt)
- [디지털 온누리 parser](../../../../../../android/app/src/main/java/com/household/account/parser/DigitalOnnuriParser.kt)
- [Paybooc parser](../../../../../../android/app/src/main/java/com/household/account/parser/PayboocISPParser.kt)
- [삼성카드 parser](../../../../../../android/app/src/main/java/com/household/account/parser/SamsungCardParser.kt)
- [롯데카드 parser](../../../../../../android/app/src/main/java/com/household/account/parser/LotteCardParser.kt)
- [경기지역화폐 parser](../../../../../../android/app/src/main/java/com/household/account/parser/GyeonggiLocalCurrencyParser.kt)
- [대전사랑카드 parser](../../../../../../android/app/src/main/java/com/household/account/parser/DaejeonLocalCurrencyParser.kt)
- [세종 여민전 parser](../../../../../../android/app/src/main/java/com/household/account/parser/SejongLocalCurrencyParser.kt)
- [도시가스 parser](../../../../../../android/app/src/main/java/com/household/account/parser/CityGasBillParser.kt)
- [문자 청구 parser](../../../../../../android/app/src/main/java/com/household/account/parser/SmsCardMessageParser.kt)
