# 결제 수집·설정 E2E의 실제 검증 범위

2026-09-11. `payment-capture`, `payment-configuration`, `shortcut-ingestion`, `recurring-execution`, `presentation-layout`의 공개 API·UI 경계를 대상으로 합니다. 최종 공식 `npm --prefix web run test:e2e`는 89개 모두 통과했으며 이 문서 범위 20개도 전부 포함합니다. Chromium 86개·iPhone WebKit 3개, 실패·skip·flaky 0개, 실행 시간 356.293초입니다. 정상 pretest의 Functions 빌드·3개 codebase 준비와 프로덕션 Next 빌드를 포함해 명령 exit 0으로 완료했습니다. Requirement ID가 테스트 제목에 등장한다는 사실만으로 그 요구사항의 모든 플랫폼·오류 조합이 검증됐다고 세지 않습니다.

최종 보고서는 `web/quality-e2e.json`, 이 실행의 보존본은 `%TEMP%/household-final-web-e2e-20260911.json`, 전체 로그는 `%TEMP%/household-final-web-e2e-20260911-run3.log`입니다. 최종 로그의 잘못된 Outbox 재생성·외부 Google API 요청은 모두 0회입니다. 테스트 전에 고아 Firestore Emulator의 포트 점유로 기동이 거절된 두 실행은 실제 테스트 실패 수와 구분해 별도 로그로 보존했습니다.

## 실행 경계

브라우저에서 실제 Firebase Auth Emulator로 로그인하고 UI 또는 운영 `executeHouseholdCommand`로 가구·카드·규칙·credential을 준비합니다. Android 원문 테스트는 실제 `submitAndroidRawNotification` callable → 서버 parser → card/merchant gate → Ledger·잔액 transaction → receipt/Outbox를 거칩니다. iPhone 입력은 실제 `addExpenseFromMessage` HTTP → credential 검증 → 문자열 정규화 → 공통 수집·저장을 거칩니다. 저장 결과는 Emulator의 실제 문서를 읽어 검증합니다.

공급자 golden 원문은 결제 알림이라는 외부 입력 fixture입니다. 테스트에서 parser나 Application을 복사하지 않습니다. 이것이 Android OS NotificationListener·배터리 제한이나 iPhone 단축어 앱 자동화 권한까지 검증하는 것은 아닙니다. Web에서 요청받은 `quickEditSnapshot`의 ID·분류 값과 Android 실제 Quick Edit 화면은 별도 경계입니다.

`submitRaw`는 `demo-` 프로젝트와 하드코딩된 loopback URL에서만 synthetic App Check JWT를 보냅니다. 설치된 Firebase CLI의 `functionsEmulator.js`가 켜는 `skipTokenVerification`과 Firebase Functions SDK `https.js`의 Emulator decode 경로를 사용하며 운영 `enforceAppCheck`는 유지합니다. 실제 Firebase Auth Emulator ID token·Membership·카드 인가는 그대로 검증합니다. 이 attestation fixture는 Google Play Integrity/App Attest 신뢰 검증을 대신하지 않으며, JWT나 credential 원문을 실행 로그에 출력하지 않습니다.

## 요구사항과 assertion

| 요구사항 | 실행되는 assertion | 남는 경계 |
|---|---|---|
| PARSE-KB/NH/NAVER/TOSS/KAKAO/ONNURI/PAYBOOC/SAMSUNG/LOTTE/GYEONGGI/DAEJEON/SEJONG/SMSBILL-001, PARSE-COMMON-001 | 공통 golden의 공급자 14개 실제 알림 입력을 callable로 전송하여 운영 parser의 금액·가맹점·서울 회계일·생성자와 실제 저장·Quick Edit snapshot을 대조합니다. | 각 공급자의 모든 원문 변형·거절 사례는 실제 parser golden 단위 테스트를 유지합니다. API에 입력한 원문이므로 OS별 extras 추출은 Android 계측 테스트입니다. |
| PARSE-CITYGAS-001, ING-SAVE-003 | KakaoTalk 도시가스는 등록 카드 없이 고정비·청구 월·납기일로 저장하며, 날짜가 없으면 실제 게시 날짜를 사용합니다. | 외부 KakaoTalk 전송·OS 수신은 실기기 경계입니다. |
| SYS-004 | 올바른 실제 `ledger.record-manual-transaction.v1`의 0·음수·소수·unsafe integer를 특정 금액 검증 코드로 거절하고, 정상 1,234원은 저장합니다. 잘못된 Command 이름의 거절을 금액 검증 성공으로 세지 않습니다. | 화폐가 아닌 자산 수량·시세 소수 정책은 Portfolio 테스트입니다. |
| ING-001/003/006/007, ING-SAVE-002/006 | 허용 공급자의 원문 수집, 생성자·원문 전체 비저장, parser 결과와 원장 저장 수렴, Android 자동 수집의 자동 FCM 전송 없음 | Native permission·subscription·실제 알림 목록 추출은 Android E2E입니다. |
| ING-002/005, ING-SAVE-001, CARD-004, SYS-003/007 | 비인증 요청, 허용되지 않은 package와 parserId 위조, 본인 등록 카드 없음, 다른 가구 카드만 존재하는 입력은 원장 저장 전에 거절합니다. | 동일 가구 내 복수 카드의 모든 조합과 legacy owner 정규화는 실제 card resolution policy/adapter 테스트를 병행합니다. |
| ING-008/009, BAL-001/002/003/005 | 카드가 없어 거래가 거절돼도 경기·대전·세종 잔액을 독립 저장합니다. balance-only 입력, 같은 observation 재생의 동일 branch 결과, typed 잔액 3개와 거래 0건을 검증합니다. | Android OS 수집·재전송 queue와 외부 결제 앱은 별도입니다. Web typed 상세 화면은 finance E2E입니다. |
| ING-SAVE-004/005/007, CAN-001/003/005/007 | 같은 원문 동시 제출은 같은 거래 1개, 사용자 가맹점·메모 수정 뒤 원승인 취소는 해당 lineage만 제거, 원승인 재전송은 취소 거래를 되살리지 않음, 대상 없는 취소 뒤 정상 승인은 새 저장 | 모든 취소 모호성·재처리 타이밍은 실제 lineage policy/UoW 통합 테스트입니다. |
| CAN-002/004/006, SPL-003 | 이전 달 승인 10,001원의 실제 3개월 분할→각 3,333원→원승인 취소가 미래 월 파생까지 제거하고 별도 승인 7,777원은 보존합니다. | 연도 경계·시간 누락·모든 capture lineage 분기 조합은 실제 cancellation policy와 transaction 테스트입니다. |
| CARD-001/002/005 | 설정 UI 등록·동일 카드 중복 안내·끝 번호 수정·삭제, 다른 카드사 identity 변경의 특정 거절 코드, 과거 지출 카드 증거 보존과 퇴역 카드 신규 수집 거절 | 실제 카드사 명칭·정규화 전 조합은 생산 policy 테스트를 유지합니다. |
| CARD-003 | 실제 pointer 길게 누르기 후 드래그·새로고침 순서 유지, 정확한 `cardIds` payload의 불완전 전체 집합을 `INCOMPLETE_CARD_SET`으로 거절 | 전체 집합 stale version·transaction 실패 원자성은 실제 Store 통합입니다. |
| MER-001/003/005, CAT-004 | 사용자 카테고리 안정 ID, UI 쉼표 OR·대소문자 무시, 가맹점·메모 mapping, `이 가맹점 기억하기`로 현재 거래를 수정해도 기존 exact는 재사용·보존, 규칙 없는 다른 가맹점에서는 새 exact 생성 후 후속 수집 분류 | 실제 Kotlin Quick Edit의 카테고리 표시는 Android 계측 테스트입니다. 이 Web 테스트는 서버 snapshot과 Web 편집 표시를 검증합니다. |
| MER-001/002/007 | exact/startsWith/endsWith/contains가 함께 맞으면 좁은 exact 선택, 중복 exact token 거절, archive 후 가맹점 mapping 유지·현재 기본 category로 변경 | 모든 비활성 규칙 page remap·재개는 실제 archive Application/Store 통합입니다. |
| MER-004 | 동일 contains 유형 두 규칙의 UI 우선순위 이동→실제 priority 순서와 수집 승자 변경, 규칙 수정·삭제→후속 수집 결과, 새로고침 보존 | priority claim 충돌·잘못된 전체 집합·다른 유형 ID는 실제 runtime Command/Store 통합으로 검증합니다. |
| MER-006 | 과거 `exactMatch`/`category` 및 `active=false` 문서를 fixture로 준비하고 기존 projection을 최초 수집 전에 무효화합니다. 실제 재구축 결과의 exact/contains/기본 category 및 비활성 보존을 검증하고 legacy 문서를 임의 재작성하지 않는지 확인합니다. | malformed legacy의 typed ContractFailure 세부 값은 실제 adapter/policy 테스트를 유지합니다. |
| IOS-002 | 실제 HTTP 객체 우선 text와 중첩 배열을 정규화하여 거래 생성, 알 수 없는 객체·불리언·숫자 입력 거절 | iPhone 단축어 앱의 실제 변수 선택·자동화 권한 설정은 실기기 경계입니다. |
| IOS-001/003/004/006/007/009/011/014 | 실제 발급 credential로 동시 HTTP 승인→거래 1개, 중복 재전송 결과, 생성자·카드 증거, 진단 원문은 진단 저장소에만 남고 credential 비노출, `no-store` 응답 | 진단의 실제 TTL 삭제 집행은 Firebase TTL 정책/운영 시간 경계입니다. |
| IOS-010/012, SYS-007 | 실제 method/CORS/content-type/잘못된 credential/허용되지 않은 identity 필드/지원하지 않는 원문을 ingress에서 거절하고 업무 거래 0건 | 인터넷 TLS·공개 URL·운영 Secret binding은 배포 검증입니다. |
| IOS-013 | 설정 UI 최초 발급·1회 표시, 새로고침 후 원문 숨김, 재발급 후 과거 키 거절·새 키로 실제 등록 | 외부 iCloud 설치 URL 내용과 iPhone Shortcut 가져오기는 검증하지 않습니다. |
| IOS-015, CAN-003/007 | Shortcut 승인취소의 실제 공통 lineage 제거, 같은 가맹점 후속 다른 금액 승인 보존 | 실단축어 알림 이벤트 도착 순서는 외부 경계입니다. |
| REC-002/003/004/006, SYS-005 | 실제 export Scheduler entry를 Cloud Scheduler 입력으로 실행하여 첫 월 시작에 생성 없음, 누락 월 catch-up·말일 보정, 재실행 후 월별 한 건, 최초 creator·정기지출 source/card 표시, 실제 검색 합계. 본인 iOS와 다른 가구원 Android endpoint를 등록한 상태에서 실제 Outbox consumer가 `NoTarget`으로 완료하고 FCM 전송 0건임을 확인합니다. | Scheduler 시간표 배포·클라우드 전달 자체는 운영 경계입니다. |
| LED-001/004 | 모바일 폭 긴 가맹점의 실제 geometry·가로 overflow와 편집 저장 버튼 hit-test, 메모 저장 | Android WebView 및 iPhone Safari의 모든 폰트·확대 조합은 별도 플랫폼 검증입니다. |

`IOS-008`의 생성자 iPhone endpoint 선택·비동기 Outbox 전달은 Notifications E2E의 실제 endpoint/FCM transport 기록으로 검증합니다. 여기서 HTTP 성공만 보고 알림 수신 성공이라고 주장하지 않습니다.

## Canonical 테스트 연결과 실행 중 발견

- `T-ING-PROV-001`: 공급자 원문 E2E가 실제 `captureRecords`의 observation ID, parser ID/version, 원 금액·가맹점·카드사·회계일·creator·원문 hash와 `ledgerDedupKeys`의 동일 lineage/fingerprint를 읽습니다. 현재 스키마에 존재하지 않는 별도 source-version 필드를 검증했다고 주장하지 않습니다.
- `T-CAN-004`: 승인 뒤 가맹점·메모 편집과 현재 merchant rule 변경에도 최초 capture record가 보존되고 원승인 취소가 같은 lineage를 찾습니다. 무가구·모호 후보의 모든 조합은 별도 실제 policy/adapter 테스트 범위입니다.
- `T-CAN-001`: 실제 월분할 뒤 원승인 취소가 모든 월 파생을 삭제합니다. transaction 중간 장애를 강제로 발생시켜 rollback하는 시나리오까지 포함하지 않습니다.
- `T-CARD-003`, `T-MER-006`, `T-REC-PUSH-001`: 각각 위 카드 재정렬, 기존 지출의 기억하기·기존 exact 재사용, 실제 Scheduler의 FCM 전송 없음 assertion에 연결합니다. canonical `T-MER-006`은 요구사항 `MER-006`과 번호가 같아도 의미가 다르며, legacy 규칙 테스트에는 요구사항 `MER-006`만 연결합니다.
- 첫 실행에서 실제 수동 거래 Command가 `Number.MAX_SAFE_INTEGER + 1`을 저장하는 결함이 드러났습니다. 실제 `basicLedgerPolicy.validatePositiveWon`을 `Number.isSafeInteger`로 수정한 뒤 공개 Command E2E가 통과했습니다.
- 처음 준비된 Emulator가 운영의 3개 codebase 중 default만 실행하여 capture HTTP가 404를 반환했습니다. 결제 성공으로 간주하거나 transport를 대체하지 않고 Emulator 설정을 운영 진입점과 동일하게 보완한 뒤 실제 공개 API가 통과했습니다.
- 60초 완료 결과 메모리 캐시가 실제 Firestore projection 무효화를 가려, 카드 끝번호·가맹점 규칙 수정과 카테고리 보관 직후 새 수집에 이전 설정이 사용되는 세 경로를 실제 E2E에서 재현했습니다. 동일 조회의 동시 요청 합치기는 유지하고 중복된 완료 캐시를 제거한 뒤 세 경로가 모두 통과했습니다.
- 활성 카테고리 projection이 실제 canonical Writer의 `state:'archived'`를 읽지 않는 스키마 불일치도 발견했습니다. 실제 `category.archive.v1` 뒤 재구축한 projection에서 해당 ID가 제외되는 assertion이 수정 후 통과했습니다.
- 중복 메모리 캐시를 제거하자, 같은 원문 재전송의 receipt hash에 현재 가맹점 규칙의 파생 표시값까지 포함하여 `IDEMPOTENCY_PAYLOAD_MISMATCH`가 발생하는 결함이 드러났습니다. 실제 영수증 지문을 수정한 뒤 같은 원문·observation을 유지하고 규칙 변경·취소 후 재전송하는 E2E가 통과했습니다.
- 첫 전체 실행의 기억하기 테스트는 기존 exact를 덮어쓴다고 잘못 기대했습니다. 명세와 운영 Application은 기존 exact 재사용을 규정하므로 기존 규칙 보존과 새 가맹점 exact 생성 두 흐름을 명시적으로 검증하도록 교정했습니다. 중복 exact의 공개 Command 오류도 내부 정책 코드가 아닌 실제 `RULE_ALREADY_EXISTS`로 검증합니다.
- 테스트 사이 DB 삭제가 이전 비동기 Outbox consumer보다 빨라, 완료 필드만 있는 문서가 재생성되는 격리 문제를 실제 로그에서 확인했습니다. 공용 reset은 처리 대상 v1 이벤트의 실제 terminal 상태를 기다린 뒤 Auth·Firestore를 초기화합니다. 운영 consumer의 malformed envelope 거절을 완화하거나 알림 전송을 생략하지 않습니다.
