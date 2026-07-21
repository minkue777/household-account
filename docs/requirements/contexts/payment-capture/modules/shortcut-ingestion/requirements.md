# iOS Shortcut 지출 입력 모듈 요구사항

> 상위 Bounded Context: [Payment Capture](../../requirements.md)  
> 아키텍처 역할: HTTP Inbound Adapter / Application  
> 상세 설계: [모듈 상세 설계](design.md)  
> 상태와 테스트 수준 표기는 [공통 문서 규칙](../../../../governance/conventions.md)을 따릅니다.

## 1. 독립 모듈 책임

이 모듈은 iOS Shortcut HTTP 요청을 검증·정규화하고 카드 승인 메시지를 지출 생성 명령으로 변환합니다. 입력 채널의 인증, 카드 메시지 파싱, 거래 소유자 결정, 중복 방지, 응답 계약을 소유하며 거래 원장 저장과 알림 전송 구현은 각각 독립 모듈의 포트에 위임합니다.

## 2. 포함·제외 범위

포함 범위:

- Shortcut HTTP 요청 method·인증·필수 필드 검증
- 다양한 JSON 값 형태의 문자열 정규화
- 카드 라벨·금액·일시·가맹점·카드 번호 파싱
- scoped credential에서 Actor·가구를 결정하고 현재 멤버의 등록 카드 증거를 검증
- 의도적으로 넓은 거래 중복 정책 적용
- 신규·중복 경로별 HTTP 응답 작성과 알림 요청 결과 관측

제외 범위:

- 일반 Web·Android 거래 입력
- 거래 aggregate와 카테고리 정책의 소유권
- 등록 카드 및 FCM FID endpoint의 수명주기
- 실제 FCM 대상 계산·전송·실패 토큰 정리
- HTTP 플랫폼 wrapper와 Firebase Admin 초기화

## 3. 소유 데이터

| 데이터 | 이 모듈의 권한 | 비고 |
|---|---|---|
| Shortcut 요청·응답 DTO | 소유 | 검증 오류, 중복, 저장, 알림 시도 결과를 구분합니다. |
| Shortcut 카드 parser 규칙 | 소유 | 지원 카드 라벨과 레거시 카드 정규화를 포함합니다. |
| Shortcut credential record | 소유 | 원문은 저장하지 않고 hash·credentialId·uid/member/household/capability scope·keyVersion·상태·issuedAt·lastUsedAt·revokedAt만 저장합니다. |
| `expenses` | 비소유 Writer | 거래 원장 모듈의 멱등 생성 포트를 사용합니다. |
| `households` | 읽기 의존 | 존재 여부와 기본 카테고리를 조회합니다. |
| `registered_cards` | 읽기 의존 | 현재 구현이 직접 읽습니다. 목표 구조에서는 Shortcut이 물리 컬렉션을 읽지 않고 Payment Configuration에 인증된 현재 멤버 범위의 카드 eligibility를 요청합니다. |
| `fcmTokens` | legacy 읽기 의존 | 현재 구현의 owner 후보 확인과 알림 모듈 호출에 사용하지만 목표 구조에서는 제거합니다. FID는 생성자 신원이나 카드 소유권의 근거가 아니며 Shortcut은 Notifications 공개 Port만 호출합니다. |

## 4. 공개 계약·의존 모듈

목표 공개 입력은 Authorization의 Shortcut 전용 credential과 `contractVersion`, `message`만 포함하는 POST 요청입니다. householdId와 creatorMemberId는 credential claim과 현재 Membership에서 결정하며 요청 body의 household·owner alias로 선택하지 않습니다. 명시적 호환 창의 HTTP Facade만 구형 body alias를 읽고 버릴 수 있으며 Domain·Application Command에는 전달하지 않습니다. Domain·Application 공개 출력은 typed V2 결과로 입력 오류, 인증·인가 오류, 파싱 실패, 중복, 신규 저장을 구분하고 거래 저장 결과와 알림 전달 결과를 별도 필드로 표현해야 합니다.

의존 모듈:

- [가구·접근](../../../access-household/modules/household-access/requirements.md): 가구 존재와 호출자 멤버십 검증
- [거래 원장](../../../household-finance/modules/ledger/requirements.md): 중복에 안전한 지출 생성
- [결제 설정](../payment-configuration/requirements.md): 인증된 현재 멤버 범위의 등록 카드 일치 여부 조회
- [푸시 알림](../../../notifications/modules/notifications/requirements.md): owner 대상 알림 명령과 전달 결과
- Clock·ID 생성기·Transaction boundary: 동시 요청 멱등성과 날짜 추론 테스트를 위해 주입

## 5. 요구사항

| ID | 상태 | 요구사항 | 경계·예외 | 근거 | 테스트 |
|---|---|---|---|---|---|
| IOS-001 | 호환·목표 | 목표 Shortcut API는 POST `application/json` body의 contractVersion·message만 받고 householdId·owner는 credential claim과 현재 Membership에서 결정한다. | 필수값·credential 불일치·파싱 실패는 구분된 typed 오류다. 구형 household·owner alias는 명시적 호환 창의 HTTP Facade에서만 소비·폐기하며 Actor·가구·Domain Command를 바꾸지 않는다. | [Shortcut HTTP Adapter](../../../../../../functions/src/bootstrap/firebaseShortcutHttp.ts) | U, C, I |
| IOS-002 | 현재 명세 | 문자열·숫자·불리언·배열·객체로 들어오는 Shortcut 값을 정규화한다. | 객체는 알려진 우선 키를 사용한다. | 같은 근거 | U |
| IOS-003 | 목표 명세 | 지원 카드사 헤더와 금액, MM/DD HH:mm, 가맹점을 추출하며 카드사 헤더를 필수로 검증한다. | 헤더가 없으면 `CARD_COMPANY_REQUIRED`, 지원하지 않는 카드사이면 `UNSUPPORTED_CARD_COMPANY`로 거부하고 거래·알림을 만들지 않는다. 삼성 fallback은 레거시 특성화에만 남긴다. | 같은 근거와 [DEC-030](../../../../governance/decisions.md#dec-030) | U |
| IOS-004 | 목표 명세 | 연도 없는 결제 시각은 서울 수신 시각보다 미래가 아닌 가장 가까운 연도로 추론한다. | 수신 연도의 월·일·시·분 후보가 미래면 전년으로 내리고, 윤년처럼 유효하지 않으면 유효한 가장 가까운 과거 연도를 사용한다. 미래 허용 오차는 두지 않으며 Android와 같은 versioned Policy·fixture를 사용한다. | 같은 근거와 [DEC-029](../../../../governance/decisions.md#dec-029) | U, C |
| IOS-005 | 특성화 | 현재 구현은 요청값이 같은 가구의 FCM owner이면 즉시 채택하고, 아니면 카드 라벨·wildcard 번호가 맞는 첫 등록 카드 owner, 해당 카드사의 유일 owner, 비어 있지 않은 요청 owner, null 순으로 결정한다. | Firestore 반환 순서와 타 멤버 카드에 결과가 의존하는 레거시 동작이며 목표 정책으로 유지하지 않는다. DEC-028 전환 전 회귀 비교에만 사용한다. | 같은 근거와 [DEC-028](../../../../governance/decisions.md#dec-028) | U, I |
| IOS-006 | 현재 명세 | 같은 가구·날짜·시간·금액·가맹점 거래가 이미 있으면 중복으로 판정해 새 문서를 만들지 않는다. | 카드·source는 의도적으로 기준에 포함하지 않는다. 같은 조건의 실제 재결제보다 parser 중복 오동작을 차단하는 것을 우선한다. | 같은 근거 | U, I |
| IOS-007 | 목표 명세 | 신규 지출은 인증된 현재 멤버의 등록 카드가 하나 이상 일치할 때만 expense, 가구 기본 카테고리, 빈 memo, `ios-shortcut` source, 현재 멤버의 필수 `creatorMemberId`와 파싱된 카드 증거를 저장한다. | 타 멤버 카드는 조회 후보에서 제외한다. 본인 카드가 여러 개 일치해도 생성은 허용하되 특정 카드를 임의 선택하지 않는다. 본인 카드가 일치하지 않으면 거래·알림을 만들지 않는다. 번호 1876의 별도 cardType 규칙은 레거시 특성화이다. | 같은 근거와 [DEC-013](../../../../governance/decisions.md#dec-013), [DEC-028](../../../../governance/decisions.md#dec-028) | U, I |
| IOS-008 | 목표 명세 | 신규 지출을 Ledger와 함께 확정한 `TransactionRecorded.v1` Outbox event는 생성자 멤버와 `ios-pwa-push` capability만 지정하고, Notifications가 생성자 본인의 모든 활성 iPhone PWA endpoint에 편집 링크 푸시를 비동기로 보낸다. | Payment Capture는 물리 endpoint를 선택하거나 FCM을 직접 호출하지 않는다. QuickEdit을 사용할 수 없는 iPhone의 편집 진입을 대체하며 다른 가구원·Android·desktop endpoint에는 자동 전송하지 않는다. HTTP 거래 성공은 푸시 성공을 보장하지 않는다. | [Shortcut HTTP Adapter](../../../../../../functions/src/bootstrap/firebaseShortcutHttp.ts), [Notification Outbox consumer](../../../../../../functions/src/bootstrap/firebaseNotificationOutbox.ts), [DEC-013](../../../../governance/decisions.md#dec-013) | I, E2E |
| IOS-009 | 호환·목표 | 중복이면 새 거래 없이 기존 거래를 가리키는 `CaptureDuplicateObserved.v1` Outbox event를 한 번 만들고, Domain·Application은 거래 결과와 알림 상태를 분리한 typed V2 결과만 사용한다. | 구형 `duplicate`·`notificationSent`·`targetOwner` 응답은 명시적 호환 창 동안 최외곽 outbound compatibility mapper에서만 만든다. mapper는 `delivered`만 `notificationSent=true`로 표현하며 Domain·Application 모델이나 저장 상태에 legacy 필드를 넣지 않는다. | [Shortcut HTTP Adapter](../../../../../../functions/src/bootstrap/firebaseShortcutHttp.ts) | U, I |
| IOS-010 | 결함 | Shortcut은 credential claim이 가리키는 존재하는 가구와 권한 있는 호출자, 양의 정수 금액, 실제 달력 날짜, 유효한 시간을 검증해야 한다. | 현재 레거시 body의 존재하지 않는 householdId, 일부 0·NaN 가능 입력, 비정상 날짜·시간, 임의 owner를 충분히 막지 못한다. 목표 body에는 householdId·owner가 없고 서버 claim과 Membership만 신뢰한다. | 같은 근거 | U, C, I |
| IOS-011 | 결함 | IOS-006의 중복 방지는 동시 요청에도 원자적·멱등이어야 한다. | 현재 query 후 add가 트랜잭션이 아니어서 같은 요청이 동시에 도착하면 둘 다 저장될 수 있다. 넓은 중복 기준 자체는 의도한 정책이다. | 같은 근거 | U, I |
| IOS-012 | 결함 | Shortcut HTTP ingress는 POST `application/json`과 지원 contract version만 허용하고 body·field·idempotency key에 유한 상한을 두며 credential·IP별 rate limit과 비용 quota를 Application 호출 전에 적용해야 한다. | OPTIONS는 preflight만 처리하고 거래 Application을 호출하지 않는다. CORS allowlist는 인증이 아니므로 허용 origin이어도 credential·Membership 검증을 생략하지 않는다. 한도 값은 양의 유한 배포 config이며 초과 요청은 저장·파싱·알림 없이 413·429 또는 안정 검증 오류로 끝낸다. | [Shortcut HTTP Adapter](../../../../../../functions/src/bootstrap/firebaseShortcutHttp.ts) | C, I, 보안 E2E |
| IOS-013 | 목표 명세 | Google 로그인과 활성 Membership으로 사용자·가구·`paymentCapture:submit` 범위의 Shortcut 전용 credential을 발급하고 완성된 공유 Shortcut에 반자동으로 설치한다. | 웹은 원문을 최초 발급 응답에서 한 번만 보여주고 복사한 뒤 설치 링크를 열며 사용자는 가져오기 질문에 한 번 붙여넣는다. 동일 idempotency key 재전송은 원문 없이 `AlreadyIssued(credentialId, credentialVersion)`만 반환하고 새 자격을 만들지 않는다. 최초 응답을 잃으면 사용자가 명시적으로 재발급하며 새 자격 저장과 기존 자격 폐기를 원자 처리한다. endpoint·POST·JSON·Authorization·응답 처리는 미리 구성한다. 정기 자동 만료는 두지 않되 폐기·재발급·Membership 상실·가구 삭제는 즉시 차단한다. 서버에는 원문 대신 강한 hash와 credentialId·scope·keyVersion·상태·issuedAt·lastUsedAt만 저장한다. PWA 로그아웃만으로는 폐기하지 않으며 개인용 문자 자동화는 기기에서 한 번 직접 연결한다. | [Shortcut credential Command](../../../../../../functions/src/bootstrap/commands/shortcutCredentialHouseholdCommandHandlers.ts), [DEC-033](../../../../governance/decisions.md#dec-033) | C, 보안 E2E |

## 6. 현재 흐름

1. POST 요청의 정적 공유 토큰과 필수 필드를 검증한다.
2. 입력 값을 정규화하고 카드 메시지를 파싱한다.
3. 가구·카드·owner를 판정한다.
4. 중복이면 HTTP 함수가 직접 알림을 시도하고 결과를 응답한다.
5. 신규이면 문서를 저장하고 HTTP 성공을 응답한 뒤 별도 Firestore trigger가 owner 알림을 시도한다.

교정할 불변식은 호출자·가구·입력을 검증하고, 동시 요청에도 한 문서만 만들며, 거래 성공과 알림 전달 결과를 분리해 관측하는 것이다.

연결 요구사항: IOS-001~013, PUSH-002, PUSH-004, PUSH-010.

## 7. 정상 요구사항으로 고정하지 않을 결함

- 공개 HTTP 함수가 코드에 고정된 정적 공유 토큰으로만 보호되고 응답에 민감한 원문을 포함합니다.
- 호출자 멤버십, 가구 존재, 양의 정수 금액, 실제 달력 날짜·시간, 요청 owner 권한 검증이 충분하지 않습니다.
- 중복 조회와 지출 추가가 한 원자적 경계에 없어 동시 요청이 같은 거래를 둘 이상 만들 수 있습니다.
- 카드사 헤더가 없으면 삼성으로 간주하는 현재 동작은 DEC-030에 따라 목표 parser에서 제거해야 합니다.
- 레거시 owner 판정은 Firestore 반환 순서와 타 멤버 카드에 결과가 의존하며, DEC-028 목표 정책으로 제거해야 합니다.
- 현재 Android와 Shortcut의 연도 추론 정책이 다르므로 DEC-029의 공통 Policy로 교체해야 합니다.
- 신규 거래는 trigger, 중복 거래는 HTTP 함수가 직접 푸시를 보내 전달 보장과 응답 의미가 서로 다릅니다.
- HTTP 저장 성공은 비동기 푸시 성공을 보장하지 않지만 현재 관측·재시도 계약이 명확하지 않습니다.
- 공개 함수가 wildcard CORS와 정적 token에 의존하며 method·content type·version·body·field·호출량의 공통 유한 경계가 없습니다. (`IOS-012`, `IOS-013`)

## 8. 관련 제품 결정

| 결정 | 상태 | 이 모듈에 미치는 영향 |
|---|---|---|
| [DEC-003](../../../../governance/decisions.md#dec-003) | 확정 | 같은 가구·날짜·시간·금액·가맹점 거래를 카드·source와 무관하게 중복으로 버립니다. 동시 요청에도 이 정책을 원자적으로 보장해야 합니다. |
| [DEC-020](../../../../governance/decisions.md#dec-020) | 확정 | 생성자 본인의 모든 활성 iPhone 홈 화면 PWA endpoint로 전달합니다. Android endpoint에는 보내지 않으며 endpoint 유무를 생성자 신원의 근거로 사용하지 않습니다. |
| [DEC-013](../../../../governance/decisions.md#dec-013) | 확정 | creatorMemberId는 필수이며 신규 지출 편집 푸시는 생성자 본인의 iPhone endpoint에만 보냅니다. |
| [DEC-023](../../../../governance/decisions.md#dec-023) | 확정 | 현재 날짜·연말·회계일의 timezone은 Asia/Seoul로 고정하며 기기·서버 기본 timezone을 사용하지 않습니다. |
| [DEC-028](../../../../governance/decisions.md#dec-028) | 확정 | 인증된 현재 멤버의 카드만 조회하고 하나 이상 일치하면 등록합니다. 다른 가구원의 같은 카드사·wildcard 일치는 무시하며, 본인 카드가 여러 개 일치해도 거래 생성은 허용합니다. |
| [DEC-029](../../../../governance/decisions.md#dec-029) | 확정 | 연도 없는 월·일·시·분은 서울 수신 시각보다 미래가 아닌 가장 가까운 연도로 선택하며 Android와 같은 Policy·fixture를 사용합니다. |
| [DEC-030](../../../../governance/decisions.md#dec-030) | 확정 | 카드사 헤더 누락·미지원 입력은 추정하지 않고 거부하며 거래·알림을 만들지 않습니다. |
| [DEC-033](../../../../governance/decisions.md#dec-033) | 확정 | 사용자·가구 범위의 무기한·폐기 가능 credential을 완성된 Shortcut에 한 번 붙여넣고, body의 householdId·owner 대신 credential claim으로 Actor와 가구를 결정합니다. 발급 원문은 최초 응답에서만 제공하고 동일 발급 요청 재전송에는 비밀 없는 `AlreadyIssued`만 반환합니다. |

연도 추론 정책은 DEC-029로 확정되었습니다.

## 9. 모듈 테스트 시나리오

| 테스트 ID | 종류 | Given / When / Then | 연결 요구사항 |
|---|---|---|---|
| T-IOS-001 | 목표 | 동일 Shortcut 요청 두 개를 동시에 실행 / 저장 / 지출 한 건 | IOS-011 |
| T-IOS-002 | 목표 | 존재하지 않는 가구·비정상 금액·날짜·시간·본인 카드 불일치·지원하지 않는 message / HTTP 요청 / parse·검증 오류이며 저장·알림 없음 | IOS-001, IOS-010, IOS-007, DEC-028 |
| T-IOS-003 | 목표 | GET·OPTIONS·잘못된 content type/version·body/field/key 경계·rate/quota 초과 / Shortcut HTTP / OPTIONS 외 허용 POST만 Application 한 번, 나머지는 저장·파싱·알림 없이 405·415·413·429 또는 검증 오류 | IOS-001, IOS-012 |
| T-IOS-004 | 특성화 | 문자열·숫자·불리언·중첩 배열·known/unknown 객체·순환 객체 / Shortcut value 정규화 / 우선 key의 안정 문자열 또는 명시적 빈 값 | IOS-002 |
| T-IOS-OWNER-LEGACY-001 | 특성화 | 같은 가구 FCM owner, 저장 순서상 첫 일치 등록 카드, 카드사의 유일 owner, 요청 owner, 타 가구·복수 owner / legacy owner 판정 / 명시 우선순위 결과를 재현하되 목표 Writer 권한 근거로 사용하지 않음 | IOS-005, DEC-028 |
| T-IOS-NOTIFY-001 | 현재·목표 | 신규 Created, 생성자의 iOS·Android·desktop endpoint와 타 멤버 iOS endpoint, 전달 성공·지연·실패 / 편집 알림 / 생성자 활성 iPhone PWA만 대상이며 거래와 delivery 상태를 분리하고 실패해도 거래를 롤백하지 않음 | IOS-008, DEC-013, DEC-020 |
| T-IOS-NOTIFY-002 | 현재·목표 | Duplicate, 생성자 endpoint 0·1, 전달 성공·failed·unknown·permanent와 같은 요청 재실행 / 중복 알림 / 새 거래 없이 기존 거래용 event·대상·결과를 구분하고 동일 요청은 event·delivery 하나 | IOS-009, DEC-020 |
| T-PARSE-003 | 목표 | 1월 수신 `12/31`, 같은 날의 몇 분 뒤 시각, 12월 수신 `01/01`, 윤년 `02/29`, 불가능한 날짜·시각 / Android·Shortcut parse / 미래 후보는 전년, 가장 가까운 유효 과거 연도, 불가능한 값은 오류 | SYS-005, IOS-004, DEC-029 |
| T-PARSE-004 | 목표 | 정상 카드사 헤더·헤더 누락·미지원 헤더 / Shortcut parse / 정상만 observation 생성, 누락·미지원은 typed 오류이며 거래·알림 없음 | IOS-003, IOS-010, DEC-030 |
| T-IOS-SEC-001 | 목표 | 무인증 RegisterEndpoint·rename·Shortcut·dividend save / 호출 / 모두 권한 오류와 변경 없음 | ADM-002, IOS-010, PUSH-009 |
| T-IOS-SEC-002 | 목표 | CORS 허용 origin이지만 credential 없음·폐기·교체된 이전 키·Membership 상실·타 capability·body의 위조 household/owner, 동일 발급 idempotency key 재전송 / Shortcut 호출·발급 / claim의 현재 Actor·가구만 사용하거나 Membership·Application·저장소 호출 전 권한 오류이며, 발급 재전송은 새 자격·원문 없이 `AlreadyIssued` 메타데이터만 반환 | IOS-001, IOS-012, IOS-013, DEC-033 |
| T-IOS-INSTALL-001 | 목표 | 최초 발급·설치 중단·동일 발급 재전송·명시적 재발급과 경합 / credential 저장·공유 Shortcut 설치 / 서버는 강한 hash·메타데이터만 저장하고 원문은 최초 한 번, endpoint·POST·JSON·Authorization·typed 응답이 구성된 Shortcut에서 secret 질문 한 번만 제공 | IOS-013, DEC-033 |
| T-IOS-COMPAT-001 | 호환 | Created·Duplicate의 queued·delivered·no-target·failed·unknown·permanent V2 결과 / legacy HTTP outbound 변환 / 호환 mapper만 구형 필드를 만들고 delivered만 notificationSent=true이며 Domain·Application·저장소에는 legacy payload가 없음 | IOS-008, IOS-009 |

추가 계약 테스트에서는 입력 값의 문자열·숫자·불리언·배열·객체 행렬, method/content type/version/body/field/idempotency key/rate/quota 경계, CORS와 인증의 독립성, 카드사 헤더 누락, 본인 카드 0·1·여러 건 일치, 타 멤버의 동일 카드사 등록, 신규·중복 알림 실패를 각각 분리해 검증합니다. Shortcut parser의 비식별 원문과 전체 evidence·typed 오류 단일 fixture는 [`shortcut-parser-golden.v1.json`](../../../../../../contracts/fixtures/payment-capture/shortcut-parser-golden.v1.json)입니다. 카드 매칭은 결제 설정의 `T-CARD-001` fixture를 Android와 함께 소비합니다.

## 10. 코드 근거

- [Shortcut 지출 HTTP 함수와 parser](../../../../../../functions/src/bootstrap/firebaseShortcutHttp.ts)
- [거래 생성 알림 Outbox consumer](../../../../../../functions/src/bootstrap/firebaseNotificationOutbox.ts)
- [Functions 진입점](../../../../../../functions/src/index.ts)
