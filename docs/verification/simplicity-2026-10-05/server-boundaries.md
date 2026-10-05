# 서버 경계 코드 simplicity 보강 조사

수집·파서·wire·command bootstrap·KIND 등 102개 서버 경계 파일의 본문을 검토했다. 최종 파일 범위는 [files.csv](files.csv)를 따른다.

제품 수정·테스트·빌드·배포·외부 통신·운영 자료 조회는 하지 않았습니다. parser 형식 자체의 복잡성과 미사용/중복 실행 모델을 구분했습니다.

## 기능별 실제 경계

### Android 원문·기존 typed envelope

계약: ING-001, ING-002, ING-008, ING-009.

submitAndroidRawNotification → membership → strict raw decoder → raw submission → Registry parser → 공통 capture submit → 독립 거래/잔액 branch receipt → Ledger/Balance 저장. 구 typed submitCaptureEnvelope는 엄격한 source/channel/shape decoder와 server source validator를 거칩니다.

raw hash와 verified fingerprint는 공개 payload 주입과 분리되어야 합니다. 전환 전 queue 호환은 현행 ING-008 계약이므로 삭제하지 않습니다.

### provider parser와 SMS/Kakao

계약: ING-001, ING-002, ING-007, PARSE-*.

findAndroidProviderParser → supportedPackages 확인 → buildNotificationEnvelope → provider별 해석. SMS는 후보별 순차 parser, Kakao는 text 우선·각 메시지 block 역순으로 금융 후보를 선택합니다.

누적 표시 필드의 이전 메시지 재처리를 피하는 후보 선택, 삼성 취소의 음수 금액과 누적금액 구분, 경기 취소 헤더 후 승인 fallback 금지, 잔액 독립 보존은 필요 복잡성입니다.

### Shortcut HTTP·credential

계약: IOS-003, IOS-012, IOS-013, IOS-014, IOS-015.

기존 HTTP bootstrap → credential authorize/gate → Shortcut parser → 공통 payment intake → HTTP receipt/result. credential command handler는 실제 lifecycle와 Firebase access/store/HMAC adapter를 조립합니다.

원문은 최초 발급 응답에만 포함하고 receipt는 alreadyIssued metadata로 치환하는 경계가 필요합니다. Android/Shortcut parser를 통째로 합치면 source 제한·오류 코드·형식 계약이 달라져 단순화라고 볼 수 없습니다.

### 가계부/카테고리/정기/자산 command

계약: LED-*, CAT-*, REC-*, AST-*, HOLD-*.

공통 router의 actor/envelope 검증 → 각 handler의 typed 변환 → 해당 application 및 원자 store. category는 legacy alias를 canonical ID로 해석하며 recurring은 인증 Actor 기반 creator를 전달합니다.

앞선 FIN-01·09 및 configuration 가상 store 후보를 보강했습니다. 다른 command의 중복 helper는 오류 코드·fingerprint bytes가 같다는 보장 없이 공통 schema로 합치지 않습니다.

### 진단·notification DTO/outbox

계약: ING-005, PUSH-*.

diagnostic callable → membership/strict decoder/source gate → collect/write. notification DTO는 enqueue/deliver/reconcile/purge의 실제 상태·version·provider attempt 경계를 표현하며 transactional outbox는 여러 실제 store가 호출합니다.

provider 전송 결과 미확정과 1회 시도·stale target·endpoint binding version은 유지합니다. 진단 readAll만 fixture 전용으로 분리합니다.

### KIND 공시

계약: DIV-001, DIV-003, DIV-005.

dividend scheduled page가 KIND source 생성 → 기간 검색 count 검증 → viewer→contents→detail → 종목별 공시. nonterminal event는 sourceDisclosureId로 별도 recheck합니다.

쿠키가 있는 세션의 요청 직렬화·실행내 동일 요청 coalescing·검색 전체 count 일치·source hash는 외부 공급자 계약 대응입니다. HTML 형식 branch만으로 과잉 추상화 판단하지 않습니다. 실제 외부 응답이나 운영 공시는 조회하지 않았습니다.

### 배포 진입·demo

계약: 배포 codebase 분리.

index.ts는 default command/query 및 비대화형 job만 export하며 지연 민감 capture/WebView는 별도 codebase에 둡니다. demo portfolio application의 실제 caller는 검색 범위에서 발견되지 않았습니다.

default exports 구성은 유지합니다. 무소비 demo 경로는 SB-01 제거 후보입니다.

## 구체적 후보

### SB-01 · P2 · 소비되지 않는 server ingress/demo와 진단 readAll을 실제 계약 경로에서 분리합니다

확신도: 높음: 정적 소비자 확인, 삭제 전 동적 연결 재확인 필요. 계약: ING-004, ING-005, T-ING-002, T-DIAG-001, DEMO: 현재 연결 없음.

근거:

- [functions/src/contexts/payment-capture/android-payment-ingestion/public.ts:53](../../../functions/src/contexts/payment-capture/android-payment-ingestion/public.ts#L53)
- [functions/src/contexts/payment-capture/android-payment-ingestion/domain/policies/recentNotificationCache.ts:27](https://github.com/minkue777/household-account/blob/12a582bf63bae7ad5b7c66bcfbf67ac96fb338da/functions/src/contexts/payment-capture/android-payment-ingestion/domain/policies/recentNotificationCache.ts#L27)
- [functions/src/demo/portfolio/application/demoAssetFixtureApplication.ts:8](https://github.com/minkue777/household-account/blob/12a582bf63bae7ad5b7c66bcfbf67ac96fb338da/functions/src/demo/portfolio/application/demoAssetFixtureApplication.ts#L8)
- [functions/src/contexts/payment-capture/android-payment-ingestion/application/diagnosticRetentionApplication.ts:75](../../../functions/src/contexts/payment-capture/android-payment-ingestion/application/diagnosticRetentionApplication.ts#L75)
- [functions/src/adapters/firebase/payment-capture/firebaseDiagnosticDocumentStore.ts:49](../../../functions/src/adapters/firebase/payment-capture/firebaseDiagnosticDocumentStore.ts#L49)
- [firestore.rules:218](../../../firestore.rules#L218)

실제 연결: 실제 Android raw handler는 buildNotificationEnvelope와 Android의 내구성 queue를 사용합니다. createNotificationIngress/recentNotificationCache는 factory 내부 외 생산·테스트 소비자가 없으며, demo portfolio 4개도 자기 package 외 소비자를 찾지 못했습니다. 진단 collect는 실제 callable에 연결되지만 application.readAll은 test driver만 호출하고 실제 진단 조회 권한은 Firestore rules가 담당합니다.

문제: 미사용 경로와 fixture 전용 관리자 role 검사가 src에 남아 실제 실행·권한 모델로 오해되기 쉽습니다. 진단 저장소는 사용되지 않는 전체 collection readAll 구현까지 요구받습니다.

더 작은 설계: 미연결 demo package·NotificationIngress wrapper/cache를 삭제 후보로 분리하고 실제로 쓰는 buildNotificationEnvelope는 유지합니다. 진단 수집 포트는 collect/write로 좁히고 관리자 읽기 계약을 실제 Firestore 보안 규칙 검증에 연결한 뒤 fixture 전용 readAll을 정리합니다.

보존 계약:

- 실제 Android 중복 윈도우·durable queue와 서버 멱등 처리
- 실제 envelope의 textLines→bigText→text 및 제목 처리
- 진단 source gate·best effort·운영 관리자 읽기 권한
- collect 및 실제 Firebase diagnostic adapter 연결

검증 단위:

- 전체 import/public export/동적 연결의 소비자 재검색
- 실제 Android 후보 중복·server receipt 회귀
- Firestore rules의 일반 멤버 읽기 거부·system admin 읽기 허용 검사
- 운영 demo 진입점이 없는지 배포 exports 확인 후 제거

### SB-02 · P2 · SMS 순서를 실제 parser 한 경로에서 검증하고 성공 ID 배열용 별도 모델을 정리합니다

확신도: 높음. 계약: ING-007, T-SMS-ORDER-001.

근거:

- [functions/src/contexts/payment-capture/android-payment-ingestion/domain/policies/selectSmsParserByPriority.ts:7](https://github.com/minkue777/household-account/blob/12a582bf63bae7ad5b7c66bcfbf67ac96fb338da/functions/src/contexts/payment-capture/android-payment-ingestion/domain/policies/selectSmsParserByPriority.ts#L7)
- [functions/src/contexts/payment-capture/android-payment-ingestion/domain/parsers/smsBillProviderParser.ts:32](../../../functions/src/contexts/payment-capture/android-payment-ingestion/domain/parsers/smsBillProviderParser.ts#L32)
- [functions/test/support/sms-parser-order-driver.ts:29](https://github.com/minkue777/household-account/blob/12a582bf63bae7ad5b7c66bcfbf67ac96fb338da/functions/test/support/sms-parser-order-driver.ts#L29)
- [functions/src/contexts/payment-capture/android-payment-ingestion/public.ts:37](../../../functions/src/contexts/payment-capture/android-payment-ingestion/public.ts#L37)

실제 연결: 운영 SMS는 smsBillProviderParser의 실제 parser 배열을 차례로 실행합니다. 별도 selectSmsParserByPriority는 미리 성공했다는 ID 배열만 받아 선택하며 test driver만 소비합니다.

문제: 순서 계약이 두 배열로 복제돼 테스트가 실제 parser 배열의 순서 변경을 놓칠 수 있습니다. 현재 두 배열은 계약 순서를 따르므로 실제 오동작을 확인한 것은 아닙니다.

더 작은 설계: T-SMS-ORDER-001을 실제 Android provider parser에 여러 parser가 인식 가능한 메시지를 주는 회귀로 옮기고, 사전 성공 ID 모델·port·factory를 없앱니다. 실제 parser 목록은 한 곳만 유지합니다.

보존 계약:

- KB→NH→NaverPay→Toss→KakaoPay→Onnuri→Paybooc→Samsung→Lotte→Gyeonggi→Daejeon 순서
- 후보별 첫 성공·문자 청구 마지막
- Sejong 및 Kakao 복합 parser는 SMS 내부 제외
- package별 전용 parser 외 fallback 금지

검증 단위:

- 실제 메시지로 중복 인식·prefix 후보·청구·세종 제외 회귀
- parser 배열 순서를 바꾸면 계약 검사가 실패하는지 의미 있는 검사 확인
- 기존 계약 ID를 유지하며 fixture만 검사하던 부분을 실제 소비자로 이관

### SB-03 · P3 · 필수 expectedVersion을 다시 optional처럼 조립하는 불가능한 분기를 제거합니다

확신도: 높음. 계약: AST-003, AST-006, HOLD-001, HOLD-002, HOLD-004.

근거:

- [functions/src/bootstrap/commands/portfolioHouseholdCommandHandlers.ts:46](../../../functions/src/bootstrap/commands/portfolioHouseholdCommandHandlers.ts#L46)
- [functions/src/bootstrap/commands/portfolioHouseholdCommandHandlers.ts:138](../../../functions/src/bootstrap/commands/portfolioHouseholdCommandHandlers.ts#L138)
- [functions/src/bootstrap/commands/portfolioHouseholdCommandHandlers.ts:192](../../../functions/src/bootstrap/commands/portfolioHouseholdCommandHandlers.ts#L192)
- [functions/src/bootstrap/commands/portfolioHouseholdCommandHandlers.ts:240](../../../functions/src/bootstrap/commands/portfolioHouseholdCommandHandlers.ts#L240)
- [functions/src/bootstrap/commands/portfolioHouseholdCommandHandlers.ts:267](../../../functions/src/bootstrap/commands/portfolioHouseholdCommandHandlers.ts#L267)

실제 연결: expectedVersion(payload)는 유효한 양의 정수를 반환하거나 throw합니다. 이어지는 네 명령은 undefined인 경우 version을 생략하는 분기를 실행할 수 없습니다.

문제: 과거 optional 계약 잔재가 현재 필수 version 계약을 흐리고 update-asset에서는 같은 검사를 두 번 호출합니다.

더 작은 설계: 한 번 읽은 필수 version을 직접 전달합니다. 기존 타입이 이미 필수이므로 새 helper나 추상 계층이 필요하지 않습니다.

보존 계약:

- 누락·비정수·0·음수 version 거부
- Asset와 Position 각각의 expected version 충돌
- 기존 오류 코드 및 receipt 멱등성

검증 단위:

- 기존 command boundary·version 충돌 검사를 재사용
- 단순 dead branch 제거만을 위한 구현 복제 테스트는 추가하지 않음

### SB-04 · P2 · 수동 거래의 알 수 없는 transactionType을 지출로 해석하지 않도록 판별 경계를 명시합니다

확신도: 높음: 정적 경로 확인, 런타임 재현 미실행. 계약: LED-001, LED-002.

근거:

- [functions/src/bootstrap/commands/ledgerHouseholdCommandHandlers.ts:245](../../../functions/src/bootstrap/commands/ledgerHouseholdCommandHandlers.ts#L245)
- [functions/src/bootstrap/commands/ledgerHouseholdCommandHandlers.ts:256](../../../functions/src/bootstrap/commands/ledgerHouseholdCommandHandlers.ts#L256)
- [functions/src/bootstrap/commands/ledgerHouseholdCommandHandlers.ts:499](../../../functions/src/bootstrap/commands/ledgerHouseholdCommandHandlers.ts#L499)
- [functions/src/bootstrap/commands/householdCommandRouter.ts:106](../../../functions/src/bootstrap/commands/householdCommandRouter.ts#L106)

실제 연결: router는 payload가 object인지와 위조 identity 필드를 검사합니다. 일반 수동 등록 handler는 transactionType이 string인지만 확인한 뒤 income이면 수입, 그 외는 모두 지출 command로 바꿉니다. 월 분할 handler에는 expense/income 명시 검사가 이미 있습니다.

문제: 알 수 없는 문자열을 정상 expense 경로로 보내는 implicit fallback이 있습니다. 이후 expense command에는 원래 판별값이 전달되지 않아 domain에서 이를 거부할 수 없습니다. 다른 필수 값이 유효한 잘못된 유형 요청에 대한 정적 결함 후보이며 실제 운영 발생은 확인하지 않았습니다.

더 작은 설계: 진입점에서 expense/income 두 값을 명시 검증하고 이후 두 분기만 실행합니다. catch나 별도 fallback을 덧붙일 필요가 없습니다.

보존 계약:

- 정상 수동 expense/income의 금액·태그·메모·카테고리 규칙
- 인증된 creator·가구 scope
- 원자 receipt/outbox·재전달 계약
- 월 분할의 기존 엄격한 판별

검증 단위:

- 실제 router+handler에서 잘못된 transactionType과 유효한 expense 필드를 제출해 명시적 거부·업무 쓰기 0 확인
- 정상 expense/income 기존 회귀
- 같은 command ID의 정상 완료 receipt replay를 validation 변경으로 깨지 않도록 확인

## 유지 판단

- 서버 권한·가구·member·source registry 검증과 공개 wire의 알 수 없는 필드 거부
- 해시의 목적별 구분: 원문 전체 무결성·검증된 actor+원문 identity·command payload 멱등성은 서로 대체하지 않음
- 거래와 잔액 branch의 독립 완료·재시도 및 이미 성공한 branch 재호출 금지
- Kakao MessagingStyle의 현재 text와 누적 bigText/textLines 구별, 결제 취소 헤더와 원승인/누적금액 구별
- notification unknown-provider-outcome·provider 1회 시도·binding/registration version·purge receipt/checkpoint
- Shortcut credential 원문 일회 노출·hash 저장·회전/폐기·Membership 재검증
- KIND의 쿠키·serial queue·동일 조회 cache·count 검증·nonterminal source ID 재확인
- legacy Shortcut receipt ownership preflight는 현재 실제 purge에 연결됨. 무관 가구까지 조회하는 이관 보완 비용은 있지만 ownership 누락 자료가 남았는지 확인하지 않고 삭제하면 안 됨
- 카드 parser의 공통 월말/마스킹/금액 일부 중복은 보였으나 채널별 허용 형식·typed 오류 차이를 보존하는 근거 없이 통합 권고하지 않음
- handler stable serializer 중복은 확인했으나 기존 canonicalJson의 sort와 localeCompare가 서로 다르므로 receipt fingerprint 호환 확인 없이 일괄 교체하지 않음

## 범위와 한계

- 이 문서는 서버 경계 102개의 근거를 담는다. 다른 소스·테스트·도구·설정의 통합 범위는 [README](README.md)와 [files.csv](files.csv)를 따른다.
- 소비자 확인은 functions/src·functions/test·web/src·android·tools 및 관련 docs의 정적 심볼 검색입니다. 삭제 전 동적 import/public export와 외부 소비자를 재확인해야 합니다.
- 지원 테스트는 실제 소비자와 assertion 연결 중심으로 확인했습니다. 테스트·빌드·네트워크·운영 자료 조회·실행은 하지 않았습니다.
- SB-04는 코드 경로의 정적 결함 후보이며 실제 운영에서 잘못된 거래가 생성됐다고 주장하지 않습니다.
- 제품 파일은 수정하지 않았다.
