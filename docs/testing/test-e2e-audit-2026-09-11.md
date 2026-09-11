# 테스트 및 E2E 점검 — 2026-09-11

> 이 문서는 보강 전 감사 기록입니다. 후속 변경과 실제 실행 결과는 [실제 앱 E2E 보강](e2e-expansion-2026-09-11.md)을 확인하세요.

현재 테스트에는 **실제 앱의 결함을 놓칠 수 있는 구조적인 공백이 있습니다.** 서버 업무 규칙과 저장소 검증은 상당히 갖춰져 있지만, 실제 앱 코드 대신 별도 참고 구현을 검증하는 계약 테스트가 있고, 서버에서 생성한 데이터를 Android 화면까지 전달하는 정상 흐름이 연결되어 있지 않습니다. 테스트 통과 수를 사용자 기능의 검증 범위로 해석하면 안 됩니다.

기준은 HEAD `1224453eee68fb976d3d6676016808a2496d0354`와 현재 작업 트리입니다. 직전 Quick Edit 수정의 Android 단위 테스트 2개 및 instrumentation 2개 증가분을 포함했습니다. 이 수정은 아직 커밋·배포되지 않았습니다. 이번 점검에서는 실행 설정과 테스트 파일 목록을 전체 조사하고, 주요 사용자 흐름의 테스트 본문·대역·실제 구현 연결·최근 실행 결과를 상세 대조했습니다. 모든 assertion을 개별 검토하거나 실기기 E2E를 새로 실행한 감사는 아닙니다.

추가 기록: 이 점검 이후 [iPhone 시작 최적화](../operations/ios-first-home-loading-2026-09-11.md) 작업에서 실제 SDK를 사용하는 WebKit 정상 재실행 E2E 1개와 전송 설정 회귀 1개를 추가했습니다. 이후 Web Jest는 628개, 업무 E2E는 Chromium·WebKit 각 1개가 됐습니다. 아래 표와 발견은 해당 추가 전 점검 시점 기준이며, 본문에서 지적한 전체 테스트 구조 개선은 아직 진행하지 않았습니다.

**실행 현황**

| 층 | 등록 현황 | 확인한 실행 근거 | 실제 범위 |
|---|---|---|---|
| Functions 단위·계약·구조 | 기본 실행 활성 322개 파일, 2,857개 테스트 | 9월 11일 직전 수정의 `test:quality-gate` 통과; 타입·경계 검사·빌드 포함 | 실제 서버 구현, 메모리 저장소 대역, 참고 구현 테스트가 섞여 있음 |
| Functions Emulator 통합 | 16개 파일, 기본 실행에서 81개 테스트 생략 | 최근 HEAD CI Functions job 성공; 별도 callable·Firestore Rules·Storage Rules·Firebase integration 명령 존재 | 아래 별도 설명 |
| Web Jest | 100개 파일, 627개 테스트 | **이번 점검에서 재실행: 627개 모두 통과**, 생략 0 | JSDOM 컴포넌트, 훅, 서비스·캐시·worker 테스트; Firebase·차트 등 대역 사용 |
| Android JVM | 25개 파일, 116개 테스트 | 9월 11일 직전 수정에서 실패·오류·생략 0 | 실제 Kotlin의 전달 큐·codec·명령 patch 등 |
| Android instrumentation | 5개 파일, 20개 테스트 | 같은 수정에서 API 36.1 로컬 Emulator 20개 통과; 릴리스 빌드·lint 통과 | 권한·WebView 시작 5, 플랫폼 adapter 4, Quick Edit Activity 5, 암호화 outbox 3, 카테고리 repository 3 |
| Web 업무 E2E | **1개 파일, 1개 테스트** | 이번에 Playwright `--list`로 등록 확인; 최근 HEAD `web-e2e` CI 성공 | 한 테스트에 로그인·가계부 생성·거래·검색·통계·카테고리 순서 변경을 묶음 |
| Web production/PWA E2E | **1개 파일, 2개 테스트** | 이번에 별도 Playwright `--list`로 확인; 최근 HEAD Web CI 성공 | 빌드한 앱의 익명 진입, redirect·CSP·서비스워커 |

Functions 기본 실행에서 생략되는 16개 파일은 CI에서도 전부 방치되는 테스트가 아닙니다. [CI](../../.github/workflows/quality-gates.yml)는 callable 1개 파일, Firestore Rules 1개, Storage Rules 1개, Firebase adapter 통합 13개를 별도 Emulator 명령으로 실행합니다. 다만 `test:quality-gate` 하나만 통과한 것을 이 통합 검증까지 완료한 것으로 표현해서는 안 됩니다.

최근 HEAD의 [CI 실행 34365089610](https://github.com/minkue777/household-account/actions/runs/34365089610)은 9월 9일 완료됐습니다. Functions 3분 32초, Web E2E 2분 43초, Web 2분 16초, Android 2분 39초, instrumentation 범위 확인 7초로 다섯 job이 성공했습니다. 시간은 설치·빌드·Emulator 준비 등을 포함한 job 전체 시간입니다. **이 실행의 instrumentation 성공은 적용 대상 아님을 확인한 성공이며, 기기 테스트 실행 성공이 아닙니다.** 현재 작업 트리의 20개 통과 근거는 위 로컬 실행입니다.

이번 조회에서는 GitHub의 전체·개별 CI 로그 다운로드가 HTTP 403으로 거절됐습니다. job 상태·시작/완료 시각은 API로 확인했고, 상세 테스트 개수는 현재 등록 목록과 로컬 실행 결과에 근거했습니다. 전체 E2E와 Firebase Emulator suite를 이번 점검에서 다시 실행하지는 않았습니다.

**중요한 발견**

1. **P1 — 일부 계약 테스트가 실제 구현과 분리되어 있습니다.**

   Functions 테스트의 정적 import 연결을 조사하면 `test/reference`에 도달하는 계약 테스트 파일이 23개 있습니다(Android 15, PWA 8). 참고 구현 트리는 75개 파일이며, 이를 참조하는 support 파일은 24개입니다. 이 수치는 정적 연결 수이고, 앱 코드의 실행 커버리지 수치가 아닙니다.

   가장 명확한 예는 `Quick Edit Intent 테스트 (삭제됨)` → `fixture (삭제됨)` → `참고 구현 (삭제됨)`입니다. 참고 구현은 처음부터 `categoryId`를 그대로 반환했습니다. 실제 Kotlin 화면의 `lowercase()`는 이 테스트에서 실행되지 않았습니다. 따라서 “손실 없이 표시값을 만든다”는 테스트가 통과해도 이번 결함을 검출할 수 없었습니다.

   더 심한 예는 `Android wire 테스트 (삭제됨)`입니다. 이름은 `decodeInGeneratedKotlinAndReencode`이지만, `실제 호출 대상 (삭제됨)`은 TypeScript의 `JSON.parse`와 `JSON.stringify`입니다. `kotlinType`도 문자열 상수로 반환하며 Kotlin codec을 실행하지 않습니다. 참고 입력의 `bridge.v1`과 [현재 Native bridge](../../android/app/src/main/java/com/household/account/webhost/AndroidHostBridge.kt#L161)의 `android-bridge.v1`도 다릅니다. 이 테스트를 현재 앱의 언어 간 호환성 증거로 사용할 수 없습니다.

   참고 구현 외에 `Quick Edit outbox fixture (삭제됨)`도 메모리 배열로 동작하면서 `atRest.encryption = AES-256-GCM`, `keyLocation = AndroidKeystore`를 상수로 반환합니다. 이것은 암호화 실행 증거가 아닙니다. 실제 암호화 검증은 별도의 [Android instrumentation](../../android/app/src/androidTest/java/com/household/account/QuickEditEncryptedOutboxInstrumentationTest.kt)에 있습니다. 이런 중복 모델의 테스트 목적과 합격 의미를 분리해야 합니다.

2. **P1 — 생성한 데이터가 실제 소비 화면까지 연결되지 않습니다.**

   [서버 카테고리 통합 테스트](../../functions/test/integration/firebase/firebase-finance-command-adapters.integration.test.ts#L453)는 실제 command handler가 생성한 ID로 수정·기본 지정·순서 변경·보관 등을 검증합니다. 생성기 자체를 전혀 시험하지 않는 것은 아닙니다. 하지만 그 결과를 Android `CategoryRepository`와 Quick Edit에 넘기는 테스트가 없습니다.

   수정 전 Native 화면 테스트는 `EXTRA_CATEGORY = FOOD`, 기본 카테고리 5개, 식비 선택만 검사했습니다. 반면 [서버 생성기](../../functions/src/bootstrap/commands/categoryHouseholdCommandHandlers.ts#L59)는 대소문자가 섞일 수 있는 base64url ID를 만듭니다. 각 테스트가 서로 다른 입력 집합을 사용해 생산자와 소비자의 불일치를 놓쳤습니다.

   직전 추가한 [회귀 테스트](../../android/app/src/androidTest/java/com/household/account/QuickEditActivityInstrumentationTest.kt#L123)는 혼합 대소문자 ID의 선택과 메모 저장을 검증하지만, 카테고리 목록을 reflection으로 주입합니다. **현재 버그의 재발 방지는 보완됐으나, 서버 카테고리 생성 → 규칙 → 결제 → Android 표시의 E2E 공백은 남아 있습니다.**

3. **P1 — 대역의 기대값이 구현의 잘못된 가정을 정답으로 고정한 전례가 있습니다.**

   검색 수정 전 `ffee1a8d0880d6ab2b930b3210793428ff11a78c`의 `ledgerSearchVisibility.contract.test.ts`는 `limit`와 `getDocsFromServer`를 mock으로 바꾸고 `expect(limit).toHaveBeenCalledWith(10_001)`을 요구했습니다. 사용자에게 오류를 일으킨 요청값을 테스트도 정답으로 기대한 것입니다. 현재는 [10,000 요청과 결과 경계](../../web/src/__tests__/features/ledgerSearchVisibility.contract.test.ts#L56)로 수정됐습니다.

   검색의 실제 Client SDK E2E도 있습니다. 하지만 Emulator 통과만으로 운영 서비스의 제약을 모두 보증할 수 있다고 해석해서는 안 됩니다. 이번 조사에서 해당 한도를 실제 운영과 같은 조건으로 검증하는 별도 자동 적합성 시험은 확인하지 못했습니다. 테스트 기대값은 구현 상수를 그대로 복제하기보다 외부 계약과 사용자 결과에서 도출해야 합니다.

4. **P1 — 자주 쓰는 정상 흐름의 E2E 범위가 좁습니다.**

   감사 당시 `ledger-journey.spec.ts`는 한 사용자가 빈 가계부를 만들고 오늘의 지출 한 건을 생성했습니다. 수정에서는 가맹점명만 바꿨고 모바일 context도 동일 계정으로 로그인했습니다. 사용자 카테고리 추가, 규칙 생성, 메모·카테고리 수정 후 재조회, 다른 가구원의 반영, 자산 화면, 지역화폐 잔액 화면은 없었습니다. 이후 독립된 영역별 E2E로 교체했습니다.

   당시 알림 관련 DB 검사는 `NoTarget`과 빈 `notificationDeliveries`가 기대값이었습니다. 수동 입력에서 불필요한 알림이 발생하지 않는 것을 검증하지만 가구원이 알림을 받는 정상 흐름의 증거는 아니었습니다. 현재 실제 Outbox·recipient·provider transport 경계는 [알림 E2E](../../web/e2e/notifications.spec.ts)가 검증합니다.

   모든 과정을 한 테스트로 묶어서 앞부분이 실패하면 뒤의 통계·모바일 순서 변경까지 실행되지 않습니다. 현재 데이터 공유 편의가 독립적인 검증 결과와 실패 진단을 약화시키고 있습니다.

5. **P2 — 통계 기간 변경과 속도를 판별하는 assertion이 약합니다.**

   당시 기간 변경 E2E는 오늘의 12,300원 한 건만 있는 상태에서 3개월·6개월·1년을 누르고 매번 같은 12,300원을 찾았습니다. 기간 버튼이 아무 동작도 하지 않아도 통과할 수 있었습니다. [독립 통계 E2E](../../web/e2e/finance-search-statistics.spec.ts)는 기간마다 다른 원천 거래와 합계를 확인합니다.

   `MutationObserver`는 “로딩중...” 텍스트가 나타나는지만 셉니다. 실제 응답시간, 첫 화면 표시시간, 차트 렌더링 비용의 상한을 측정하지 않습니다. [시작 성능 단위 테스트](../../web/src/__tests__/platform/webStartupPerformance.contract.test.ts)는 fake timer와 performance 대역으로 계측 순서를 검사합니다. 이는 계측 로직 검증이며 앱이 빠르다는 증거가 아닙니다. 관리자 대시보드의 운영 측정과 CI의 성능 회귀 판정을 연결한 기준도 확인되지 않았습니다.

6. **P2 — 레이아웃·차트 문제를 실제 렌더링 없이 검사하는 부분이 있습니다.**

   [카테고리 설정 테스트](../../web/src/__tests__/features/categorySettingsMutationFeedback.contract.test.tsx#L24)는 팔레트를 2색으로 바꾸고 ColorPicker를 빈 div로 대체합니다. 이 테스트로 실제 색상 선택 팝업의 잘림을 확인할 수 없습니다. 삭제 전 가로 폭 테스트는 소스 문자열과 CSS class 존재를 검사하며 실제 viewport 폭을 계산하지 않습니다.

   [자산 통계 테스트](../../web/src/__tests__/features/portfolio/assetStatsSessionRead.contract.test.tsx#L22)는 실제 차트를 JSON 출력으로 바꿉니다. 데이터 조립과 선택 상태를 검증하는 데 유효하지만, 실제 차트가 이상하게 보이거나 느린 문제는 별도 브라우저 검증이 필요합니다.

   모바일 카테고리 순서 변경 E2E의 실제 touch·변경된 DB 순서 검증은 좋습니다. 다만 마지막 screenshot은 저장만 하며, viewport 잘림이나 이미지 차이를 자동 assertion으로 판단하지 않습니다.

7. **P2 — 요구사항 연결과 커버리지 설정의 의미를 과대 해석하기 쉽습니다.**

   [추적성 검사](../../functions/test/architecture/requirement-test-traceability.test.ts#L281)는 “assertion 시나리오에 직접 연결”이라고 이름 붙었지만, 실제로는 테스트 소스 전체에 요구사항 ID 문자열이 존재하는지 확인합니다. 해당 ID가 실행되는 test 안에 있는지, 무엇을 assert하는지, 운영 구현을 실행하는지를 판별하지 않습니다. 검색 대상에도 Native Kotlin과 Playwright E2E가 포함되지 않습니다.

   [카탈로그](../requirements/catalog-summary.md)는 스스로 문서 선언 집계임을 명시합니다. 244개 요구사항·229개 시나리오 ID를 E2E 완료 수나 기능 커버리지로 사용해서는 안 됩니다.

   [Jest 설정](../../web/jest.config.js#L21)에는 70% coverage threshold가 있지만 CI의 명령에는 `--coverage`가 없고 기본 수집도 활성화되지 않았습니다. 이번 JSON 결과에도 coverageMap이 없습니다. 또한 수집 대상에서 페이지와 컴포넌트를 제외합니다. 현재 627개 통과가 화면 코드 70% 이상 검증을 뜻하지 않습니다. 커버리지를 추가하더라도 E2E 공백을 대신 해결해 주지는 않습니다.

**사용자 흐름별 E2E 판단**

| 사용자 흐름 | 현재 실제 연결 | 빠진 부분 |
|---|---|---|
| 로그인 → 신규 가계부 → 원장 CRUD | Chromium + Auth/Functions/Firestore Emulator | 실제 Google OAuth, 기존 계정의 Native→Web 인증 복원; 수정은 가맹점명만 |
| 돋보기 검색 | 실제 Web Client SDK → Emulator → 결과 표시 | 여러 검색 필드·여러 기간 데이터의 사용자 흐름, 운영 제약 적합성 |
| 지출 메모·카테고리 수정 | 컴포넌트·서비스·서버를 각자 검증 | 실제 저장 → 재진입 → 다른 가구원 화면까지 |
| 카테고리 순서 변경 | Pixel 7 설정의 Chromium touch → 서버 → canonical/projection → 새로고침 | Android WebView·iPhone 자체 실행은 아님 |
| 카테고리 추가·색 선택 | UI 대역 및 실제 서버 저장을 각자 검증 | 모바일에서 추가·색 선택·저장·다시 열기·실제 폭 확인 |
| 사용자 규칙 → 수집 → Quick Edit | 서버 parser/adapter 통합, 별도 Native 큐·Activity 테스트 | 서버 생성 ID가 규칙과 snapshot을 거쳐 실제 Native 화면·저장까지 가는 연결 |
| 지출 통계 기간 변경 | 브라우저에서 같은 한 건과 로딩 텍스트 검사 | 기간별 서로 다른 합계, 반복 진입과 실제 소요시간 |
| 자산 통계·지역화폐 잔액 | Web 대역 테스트와 실제 서버 저장소 통합이 별도로 존재 | 실제 브라우저에서 저장된 값을 조회·표시하는 E2E |
| 3인 가구 공동 사용 | 서버 권한·충돌·알림 수신자 선정 테스트 존재 | 서로 다른 사용자 context의 생성·수정·실시간 반영 |
| Android 알림 보내기 → iPhone 수신·클릭 | Native outbox, 서버 전송 adapter, 실제 worker handler, URL redirect를 각각 검증 | 실제 FCM·iPhone 홈 화면 PWA·인증 복원·편집 화면을 한 번에 연결 |
| 앱 첫 화면과 재진입 속도 | 계측 순서·캐시 재사용·조회 호출 수에 대한 검증 | 동일 데이터·기기 조건의 냉간/재진입 성능 기준과 회귀 판정 |

Web 업무 E2E는 [Next 개발 서버와 Chromium](../../web/playwright.config.ts#L35)에서 실행합니다. 별도 [PWA E2E](../../web/playwright.pwa.config.ts)는 production build를 사용하지만 익명 로그인 화면과 worker가 주 대상입니다. 현재 Playwright project와 CI browser 설치는 Chromium뿐입니다. WebKit·Safari 또는 실제 iPhone에서 실행되는 자동 E2E는 확인되지 않았습니다. 기존 [운영 기준](vertical-integration-tests.md)에도 실기기 Push·Google OAuth·Play Integrity 등의 공백이 명시돼 있습니다.

**유지할 검증과 우선 개선 순서**

실제 Firebase Emulator를 사용한 command·Rules·원자성 검증, 실제 production worker entry의 [알림 클릭 handler 테스트](../../web/src/__tests__/platform/pwaWorkerNotification.test.ts), Native Keystore·WorkManager 확인, 모바일 순서 변경의 trusted touch와 두 번의 저장 검증은 유효합니다. 전체 테스트를 불신하거나 일괄 삭제할 이유는 없습니다.

| 순서 | 개선 대상 | 완료 판단 |
|---|---|---|
| 1 | 이름만 Kotlin 왕복인 테스트와 실제 코드로부터 분리된 참고 구현 테스트 정리 | 실제 Kotlin/worker를 실행하거나 동일 공용 fixture로 양쪽 실제 구현을 비교함. 참고 모델은 제품 구현 합격 근거에서 분리하고 중복은 대체 검증 확보 후 제거 |
| 2 | 카테고리 생성 → 규칙 → 결제 → Quick Edit 정상 흐름 | 테스트 서버가 실제 생성한 ID를 그대로 사용해 정확한 카테고리 선택, 메모만 수정, 분할, 저장 후 Web 표시까지 확인 |
| 3 | 자주 쓰는 Web 흐름을 작은 독립 E2E로 분리 | 메모·카테고리 편집, 검색, 카테고리 추가·색·순서 변경을 각자 실패·성공으로 보고. 실제 저장 결과로 다음 화면을 검증 |
| 4 | 3인 가구 fixture와 통계·잔액 화면 보완 | 다른 멤버의 변경 반영, 기간마다 다른 합계, 자산·지역화폐 표시를 실제 SDK로 검증. 오늘·4개월 전·10개월 전 등 결과가 달라지는 데이터 사용 |
| 5 | 자주 쓰는 동작의 성능·레이아웃 회귀 기준 | 동일 데이터 기준 최초 진입·재진입·기간 변경 소요시간과 조회 수 확인. 브라우저에서 문서·팝업 폭과 선택 영역의 노출을 실제 측정 |
| 6 | 기기 고유 경계의 검증 증거 확보 | WebKit 브라우저 검증과 별도로 실제 Android/iPhone의 알림 등록→수신→클릭→대상 화면 확인. 확인한 버전·시각·결과 기록 |

모든 Web 변경에 Android Emulator 전체 실행을 다시 의무화하는 방식은 권하지 않습니다. 현재 범위 정책을 유지하면서 카테고리·수집·snapshot 생산자와 Native 소비자의 연결이 바뀌는 작업에 맞는 좁은 검증을 연결하는 편이 효과적입니다. 현재 Emulator suite는 서버와 연결되지 않으므로 이를 무조건 더 자주 실행해도 이번 종류의 공백이 해결되지 않습니다.

최근 실패 CI의 로컬 보존 logcat에는 Pixel Launcher ANR도 남아 있습니다. Emulator 준비 문제와 실제 앱 assertion 실패를 구분할 준비 상태·진단 증거는 필요합니다. 환경 실패를 이유로 테스트를 무조건 재시도하거나 통과로 간주하는 것은 개선안에 포함하지 않습니다.

이번 결과물은 점검 보고서이며 테스트·CI 체계 변경은 수행하지 않았습니다. 위 우선순위는 드문 예외 케이스를 늘리기보다 일상적인 생성·편집·조회·공유 흐름을 실제 구현으로 연결하는 데 맞췄습니다.

