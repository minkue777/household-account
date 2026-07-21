# 코드 기반 요구사항·설계 감사 기록

> 상태: Completed — 문서 정제 근거  
> 기준일: 2026-07-15  
> 범위: Android, Web, Firebase Functions, Firestore Rules, PWA·배포 설정, 기존 요구사항·상세 설계·목표 아키텍처  
> 미결정 정책: [코드 감사 후 미결정 사항](pending-decisions.md)

## 1. 감사 방법

- 사용자 흐름만 읽지 않고 Adapter → Application 역할 코드 → Firestore write/read → 후속 알림·Scheduler까지 역추적했습니다.
- 구현된 동작은 `현재 명세/특성화/호환`, 유지하면 안 되는 동작은 `결함`, 리팩토링 목표는 `목표 명세`로 구분했습니다.
- 코드에 없는 목표를 편의상 확정하지 않고 제품 선택이 필요한 항목은 별도 결정 목록으로 격리했습니다.
- 문서 수정 후 요구사항 ID 단일 소유, Context 합계, 상대 링크, 상세 설계 추적 표를 다시 검사합니다.

감사한 정본 범위는 `rg --files` 기준 Android Kotlin 34개와 manifest/resource/build 설정, Web TypeScript·TSX 152개와 Next/PWA 설정·테스트, Functions TypeScript 8개와 Firebase·Rules·index·project 설정입니다. 생성된 `functions/lib`의 JavaScript·source map, 이미지 binary, Gradle wrapper binary는 정본 코드가 아니므로 동작 근거로 다시 세지 않았고, 생성물과 정본의 drift 여부만 필요한 곳에서 확인했습니다.

## 2. 실행 기준선

| 검증 | 결과 | 의미 |
|---|---|---|
| Web `npm test -- --runInBand` | 202개 중 193개 통과, 9개 실패 | 서비스 API·정책이 바뀌었는데 테스트가 따라오지 않은 suite가 있어 배포 기준선으로 사용할 수 없음 |
| Web `npm run build` | 통과 | TypeScript/Next production build는 가능 |
| Functions `npm run build` | 통과 | TypeScript compile만 검증하며 자동 테스트 suite는 없음 |
| Android `gradlew test` | 통과 | 테스트는 결제 parser 한 영역에 집중되어 전체 Host·Queue·보안 회귀를 보장하지 않음 |

Web 실패는 제거된 `updateCategory` API 기대, 변경된 household 필드 기대, 가맹점 regex/우선순위 기대, logging 기대 등 코드와 테스트의 drift입니다. 실패 테스트를 삭제하지 않고 각 요구사항의 Characterization 또는 목표 테스트로 재분류해야 합니다.

## 3. 높은 위험의 누락·불일치

| 영역 | 코드 근거 | 발견 | 문서 조치 |
|---|---|---|---|
| Tenant session | `web/src/contexts/CategoryContext.tsx` | localStorage와 `storage` event에 독립 의존하여 같은 탭의 로그인·로그아웃·가구 전환 직후 이전 가구 category 구독이 남을 수 있음 | 모든 client cache·subscription을 `SessionScope`에 묶고 전환 시 동기 폐기하는 SYS 요구사항 추가 |
| Client migration | `web/src/lib/householdService.ts`의 `migrateExpensesToHousehold` | 클라이언트가 전체 거래를 읽어 householdId 누락 문서에 현재 가구를 기록하므로 tenant 오염 가능 | migration/backfill을 서버 운영 경계로만 허용하는 SYS 요구사항 추가 |
| Android backup | `android/app/src/main/AndroidManifest.xml`의 `allowBackup=true` | legacy 가구 자격, WebView 데이터, 향후 암호화 Queue가 backup/restore·device transfer 대상이 될 수 있음 | 민감 로컬 상태 backup 기본 거부 요구사항 추가 |
| Android logs | `WebViewBridge.kt`, `FcmService.kt` | 가구 키·멤버 이름·FCM token 원문을 Logcat에 기록 | 민감 로그 금지·redaction 요구사항 추가 |
| Android session/permission | `HouseholdPreferences.kt`, `MainActivity.kt` | 가구·멤버 mirror가 여러 setter로 부분 교체되고 API 33 알림 표시 런타임 권한 요청이 없음 | versioned SessionMirror 원자 교체와 OS 알림 권한 요구사항 추가 |
| Payment dual branch | Android parser와 목표 Intake 설계 | 유효한 지역화폐 잔액이 거래 생성 성공·중복 뒤에만 전달되는 설계여서 balance-only 또는 카드 실패 시 잔액을 잃음 | payment와 balance를 독립 결과·독립 receipt stage로 처리하도록 Intake 상세 설계 수정 |
| Capture lineage | QuickEdit·Ledger split/merge/cancel 경로 | 가맹점·금액 수정 또는 분할 뒤 취소 매칭 근거가 사라지고 파생 관계 metadata가 일관되게 보존되지 않음 | immutable capture reference와 lineage 보존 요구사항 추가, 당시 미결정이던 자동 취소 범위는 이후 DEC-041로 확정 |
| Capture contract drift | Android·Shortcut·아키텍처 문서 | Android 전용명·결제 전용명·공통 Envelope라는 세 최상위 계약이 경쟁하여 채널별 Adapter가 다른 서버 API를 만들 위험 | 최상위 `CaptureEnvelope.v1`과 `SubmitCaptureEnvelopeV1`로 통일하고 선택적 payment/balance branch를 명시 |
| Source·parser determinism | Android source registry·공급자 parser | 등록하지 않은 package가 본문만으로 parser에 들어갈 수 있는 경로, 저장소 순서 기반 가맹점 동률, 시스템 현재 시각에 묶인 연도·timezone 판정이 혼재 | 등록 package gate, 동률 `Ambiguous`, `Asia/Seoul`+주입 Clock+공통 연도 fixture 요구사항 강화 |
| Ledger group write | Web split·merge·monthly split 서비스와 Android QuickEdit | 원본 선삭제·순차 write, 일부 metadata 유실, 부분 실패와 동시 수정 시 lost update 가능 | 서버 Unit of Work·전체 version map·immutable lineage의 원자 Command로 상세 설계 교정 |
| Stale client read | Web 검색·통계 비동기 조회 | 이전 가구·이전 검색 조건의 늦은 응답이 최신 화면을 덮을 수 있고 전체 컬렉션 client filtering이 무제한 | SessionScope generation·request revision·bounded cursor Query와 stale 응답 폐기 계약 추가 |
| Firestore/API security | `firestore.rules`, 공개 Next API route, callable/HTTP Functions | 인증·Membership·App Check·입력 크기·host 제한이 약하거나 없음 | 기존 보안 결함을 endpoint별 계약과 외부 프록시 방어 요구사항으로 구체화 |
| Operations logs | Functions 자산·알림·Bridge log | raw household/member/FID/token을 기록하는 경로와 console-only 실패가 혼재 | 비식별 target hash·안정 error code·redaction contract와 Health 상태로 통일 |
| SSRF | KIND 상세 URL fetch 경로 | 공급자 응답의 absolute URL을 host allowlist 없이 다시 요청 가능 | HTTPS host/path allowlist, redirect 재검증, timeout·응답 상한 요구사항 추가 |
| FCM cleanup | Functions 알림 전송 | 전송 실패 종류와 무관하게 endpoint를 삭제하고 비동기 delete를 기다리지 않는 경로가 있음 | 404/UNREGISTERED+동일 endpoint version에서만 inactive 처리하는 기존 목표를 결함 근거와 함께 강화 |
| Endpoint authorization | Web endpoint 등록·Functions callable | Membership 확정 전 설치 endpoint를 연결하거나 payload URL을 그대로 열 수 있는 경로가 있음 | 인증·Membership·App Check 선검증, safe same-origin click route, 설치 version 조건부 갱신 계약 추가 |
| Dividend target | 배당 Scheduler | `holdingType=stock`과 종목 코드 모양으로 KIND ETF 대상을 추론하여 개별주·해외종목을 섞을 수 있음 | 명시적으로 분류된 KRX ETF만 discovery 대상으로 제한 |
| Dividend lifecycle | 배당 Scheduler | 현재 holding/provider 결과를 순회해야만 기존 Event 상태가 진행되어 매도·삭제·NoData 때 fixed→paid도 멈춤 | discovery와 기존 nonterminal Event sweep을 분리 |
| Scheduled run | 자산·배당 Scheduler wrapper | 함수가 시작되지 않거나 timeout/전체 scan에 걸리면 provider attempt가 없어 장애 감지가 불가능 | started/completed heartbeat, missing/overdue 감지, page checkpoint·lease 요구사항 추가 |
| PWA cache | `next-pwa`와 별도 `firebase-messaging-sw.js` | root scope worker 수명주기가 분리되고 기본 runtime cache가 인증·가구 응답을 저장할 여지가 있음 | 단일 worker lifecycle과 민감 응답 cache 금지·session purge 요구사항 추가 |
| Portfolio sample | `web/src/app/assets/page.tsx`, `assetService.addSampleAssets` | 빈 화면의 샘플 버튼이 실제 가구 Canonical 자산을 작성 | 샘플/데모 데이터는 격리된 demo scope 외 Canonical write 금지 |
| Portfolio valuation UoW | Web holdings 저장·Functions 일일 평가 | Position과 부모 Asset valuation이 별도 write라 한쪽만 반영될 수 있고 사라진 scope의 0 snapshot이 누락됨 | 자산별 Position+Asset 단일 UoW와 사라진 owner/type scope의 명시적 0 projection 요구사항 추가 |
| Asset statistics | 자산 통계 화면의 `2020-01-01` | ALL 기간이 고정일로 잘리고 기간 시작 전 baseline 없이 변화율이 왜곡 | oldest valid snapshot과 시작 직전 baseline을 사용하는 통계 요구사항 추가 |
| Read result collapse | Home·Reporting·asset query | 원천 실패·NoData·stale를 빈 배열이나 0원으로 축약해 정상 0과 장애를 구분할 수 없음 | `Ready/NoData/Stale/Failure` typed read와 partial summary 계약 추가 |
| Shortcut ingress | HTTP Function | wildcard CORS, body/method/version/rate 상한과 credential 수명주기 요구사항이 상세 설계에만 있거나 미정 | HTTP boundary 요구사항 추가, 이후 DEC-033에서 사용자·가구 scoped credential과 반자동 설치로 확정 |
| Hardcoded credential | `functions/src/config.ts` | iOS Shortcut 공유 token이 소스와 compiled artifact에 포함됨 | 현재 보안 결함으로 유지하고 scope·만료·폐기 credential 및 Secret/release scan 요구사항으로 교정 |
| Web response security | `web/next.config.js` | CSP·frame 제한·MIME sniffing·referrer/permission 정책과 민감 응답 cache header가 없음 | PWA/Web Delivery 보안 header 요구사항 추가 |

## 4. 운영·배포 경계

- `.firebaserc`의 단일 default project와 compile-only predeploy는 운영 오배포·규칙 누락·client/server 계약 불일치를 차단하지 못합니다.
- Functions 자동 테스트, Firestore Rules Emulator suite, client/server schema contract suite, Architecture Fitness Function, CI workflow가 없습니다.
- FCM FID 직접 등록은 현재 Firebase 계약에서 가능한 목표이지만 Android/Web SDK·Admin SDK·manifest metadata·서버 저장 schema를 호환 창 없이 부분 배포하면 알림 전체가 끊길 수 있습니다.
- 이를 별도 [Delivery Assurance 모듈](../supporting-platform/modules/delivery-assurance/requirements.md)로 분리해 업무 기능과 릴리스 안전성을 섞지 않습니다.

## 5. 감사 한계와 다음 기준

- 이번 작업은 요구사항·설계 감사이며 운영 Firestore 데이터, Cloud Logging, 실제 기기 권한 상태를 조회하지 않았습니다.
- 코드가 현재 동작한다는 사실만으로 보안·원자성 결함을 `현재 명세`로 승인하지 않았습니다.
- 다음 구현 단계는 실패한 Web 테스트를 무조건 현재 코드에 맞추는 작업이 아니라, 요구사항 상태별로 Characterization과 목표 테스트를 먼저 분리하는 것입니다.
- 실제 리팩토링 PR은 새 Delivery Gate가 준비되기 전에도 작게 진행할 수 있지만, 외부 공유 배포는 보안 차단 조건과 Rules Emulator test를 통과해야 합니다.
