# 재무·접근 요구사항과 실제 E2E 경계

2026-09-11 작성. 요구사항 ID가 테스트 이름에 있다는 사실만으로 전체 요구사항이 검증된 것으로 세지 않습니다. 아래 표는 실행되는 assertion 범위와 남는 경계를 구분합니다.

최종 공식 `npm --prefix web run test:e2e`에서 이 문서 범위인 재무 23개, 접근 6개, 알림 딥링크 Chromium 2개·iPhone WebKit 2개가 모두 통과했습니다. native touch 연속 변경·취소도 재무 23개에 포함합니다. 전체 suite는 Chromium 86개·iPhone WebKit 3개, 총 89개 통과, 실패·skip·flaky 0개이며 프로덕션 Next 빌드와 실제 Firebase Emulator를 사용했습니다. 최종 보고서는 `web/quality-e2e.json`, 보존본은 `%TEMP%/household-final-web-e2e-20260911.json`입니다.

입력·수정·삭제·분할·합치기·온보딩·초대는 실제 Next UI → Firebase Auth Emulator → 운영 callable entry → 운영 Application/Firestore transaction → 공개 Read Contract → 실제 Client SDK → 브라우저 표시를 통과합니다. `test/reference`나 응답 대체를 사용하지 않습니다. 과거 카드 증거·지역화폐·대량 검색 문서는 조회 E2E의 사전조건으로만 Emulator에 준비하며 해당 생성 경계를 검증했다고 주장하지 않습니다.

| 요구사항 | 자동 E2E와 실제 assertion | 별도 경계 / 남은 범위 |
|---|---|---|
| LED-001 | `ios-startup`: 첫 서버 표시. `finance-ledger`: 월·유형별 분리, 지출→수입→설정→복귀의 달력 준비 상태 유지, 삭제 제외. `notification-deeplink`: 과거 월 이동·수정 열기 | listener 개수·재연결 epoch·모든 경합 타이밍은 실제 Read Model 단위/통합 검증을 병행합니다. 준비 상태 검증을 운영 기기의 밀리초 성능 측정으로 해석하지 않습니다. |
| LED-002 | `finance-ledger`: 필수 가맹점/양수 검증, 실제 수동 등록 | 서버 숫자 경계는 Domain/실제 callable 통합 검증 |
| LED-003 | `finance-ledger`: 수입 항목명·금액 저장, 편집·삭제, 지출과 분리 | 없음(정상 흐름) |
| LED-004 | `finance-ledger`: HH:mm 저장과 `수동` 카드 표시 | 기기 시계와 서울 날짜 경계는 별도 시간 주입 단위 검증 |
| LED-005 | `finance-ledger`: 메모·카테고리·가맹점·금액·날짜, 논리 삭제, 검색/통계 제외, stale version 거부 | 운영자의 수동 복구·영구 삭제는 일반 사용자 E2E 범위 밖 |
| LED-006 | `finance-categories`, `finance-search-statistics`, `finance-ledger`: 월 지출·수입·예산·카테고리 합계 | 홈 연 지출 카드는 home preferences E2E와 연결 |
| LED-007 | `finance-ledger`: 수정 화면 알림 버튼→요청 Outbox·요청자·시각, 수입에 버튼 없음 | 실제 FCM·아이폰 알림 수신은 외부 공급자/실기기 필요 |
| LED-008 | `finance-structure`: 원자 구조변경 결과. `finance-ledger`: stale update/delete 무변경 | 모든 구조변경 동시성·transaction 중간 실패는 실제 Firebase UoW 통합 검증 |
| LED-009 | `finance-structure`: 원본 superseded, source·creator, 같은 원본 ID 복원 | 결제 capture lineage 전체 조합은 capture integration |
| LED-010 | `finance-currency-recurring`: 유형별 상세, typed/untyped 제외 | 유형이 다른 merge 거부·capture immutable metadata는 실제 서버 통합 |
| SPL-001 | `finance-structure`: 4,000+6,001 분할, 개별 카테고리, 원본 ID 복원 | 실패 주입·선택 조회 범위는 Firebase Store 통합 |
| SPL-002 | `finance-structure`: 1월31일→2월28일→3월31일 | 윤년 등 날짜 policy 단위 검증 유지 |
| SPL-003 | `finance-structure`: 그룹 연결·취소·원본 ID와 금액/날짜/메모 복원 | 중간 emission 타이밍은 Read Model 통합 |
| SPL-004 | `finance-structure`: 3개월→2개월 재구성 | version map 누락·경합은 UoW 통합 |
| SPL-005 | `finance-structure`: 10,001/3→각3,333, /2→각5,000 | 없음(내림 정책) |
| SPL-006 | `finance-structure`: 신규 월분할 memo·manual·creator 보존 | 원자 실패는 서버 통합 |
| MRG-001 | `finance-structure`: 브라우저 drag로 A+B, (A+B)+C, 새 합계와 superseded 원본 | Android 실제 long-press 임계·touchcancel은 기존 UI/계측 테스트; 데스크톱 drag와 구분 |
| MRG-002 | `finance-structure`: 합치기 해제 후 세 원본 ID·금액·메모 복원 | lineage 취소/불완전 legacy는 서버 통합 |
| SEA-001 | `finance-search-statistics`: 과거2020년 거래·메모·가맹점, 기간 UI 없음, 빈 검색, 결과 수정 | 실제 네트워크 실패 UI는 별도 네트워크 fault 시나리오 필요 |
| SEA-002 | `finance-search-statistics`: 실제 저장 카드 증거의 국민/KB/2972/정확형/마스킹, 불일치 제외 | 모든 카드사는 같은 matcher의 production 단위 테스트 |
| SEA-003 | `finance-search-statistics`: 검색 변경 시 이전 결과 제거, mutation 재조회, 50+1 페이지 | 지연 응답 뒤 logout/가구 전환은 session 통합 검증 |
| SEA-004 | `finance-search-statistics`: 전체·월별 합계, 첫50건에서51건 전체5,100원 | 10,000건 안전 상한과 운영 Listen 제한은 SDK 요청/실제 Query 통합 검증 |
| SEA-005 | `finance-search-statistics`: 별도 검색 제출 없이 입력만으로 결과 | 임의 debounce 시간 부재는 production hook 타이머 검증 |
| CAT-001 | `finance-categories`: 실제 온보딩5개 순서·기본etc, 서버 catalog 확인 | 일부 카탈로그 재초기화·동시성은 Category Store 통합 |
| CAT-002 | `finance-categories`: 모바일360px 실제 geometry/hit-test, 16색, 이름/색/예산 수정·새로고침·archive·과거 참조, 음수 예산 거절. 실제 CDP touch 연속 순서 변경·취소·canonical/projection 버전·새로고침 보존 독립 테스트 추가 | 실제 Android QuickEdit 표시는 Android instrumentation. 실제 색상 사용 여부 조회는 운영 관리 절차 |
| CAT-003 | `finance-categories`: 기본 카테고리 변경→새 지출 선택, 기본 archive 거절과 무변경, 다른 archive 신규 선택 제외; 정기 참조 remap | 가맹점 규칙 참조 remap은 payment-configuration E2E와 연결 |
| CAT-004 | Android `QuickEditActivityInstrumentationTest`, `CategoryRepositoryInstrumentationTest` | 브라우저 E2E로 Kotlin Adapter를 대신 검증하지 않습니다. |
| BUD-001 | `finance-categories`: 120%·2,000원 초과·예산 없는 항목(--), 음수 예산 저장 거절 | 0원 예산·숫자 변환 경계는 production 단위 검증 |
| BUD-002 | `finance-categories`: 예산10,000-해당지출12,000=-2,000, 비예산7,000 포함 월총19,000 | 없음(정상 흐름) |
| BAL-001 | 실제 capture→balance Functions/Android 통합 경계 | 브라우저는 SystemActor 관찰 입력을 만들 수 없음 |
| BAL-002 | 실제 capture→balance 통합 경계 | 브라우저는 유형별 결과 표시만 검증 |
| BAL-003 | `finance-currency-recurring`: 정수/음수 잔액 표시·새로고침 보존 | 관찰 시각·parser·receipt 저장은 capture 통합 |
| BAL-004 | `finance-currency-recurring`: 실제 snapshot 갱신, 단일유형 자동선택·다중유형 선택없음·명시선택 | 첫 cache suppression은 `ios-startup`, epoch 복구는 session 통합 |
| BAL-005 | 실제 capture 통합의 balance-only·branch receipt | Web에 충전/수동 잔액조정 화면은 없으므로 존재하지 않는 흐름을 테스트로 만들어 표시하지 않음 |
| REC-001 | `finance-currency-recurring`: 가맹점·금액·카테고리·31일·메모,편집·비활성/재활성·삭제 | 음수/0 계획 서버 거부는 recurring Application 통합 |
| REC-002 | 실제 Scheduler entry→Emulator 저장 통합 | 브라우저 접속으로 실행하는 기능이 아니므로 UI 테스트로 Scheduler를 대체하지 않음 |
| REC-003 | 실제 Scheduler catch-up/checkpoint 통합 | 같은 이유 |
| REC-004 | 실제 notification Outbox consumer 통합 | 실FCM은 외부 경계 |
| REC-005 | `finance-currency-recurring`: 비활성 계획 참조도 archive 후 현재 기본etc로 이동 | 다중 page·재시도는 remapper 통합 |
| REC-006 | `finance-currency-recurring`: UI 생성 계획 최초creator·수정/활성 전환 뒤 동일 | Scheduler 생성 거래의 creator·legacy migration은 서버 통합 |
| STAT-001 | `finance-search-statistics`:3개월3,300/6개월7,700/12개월16,500/지정월17,600, 날짜 역전 오류 | 없음(정상 기간) |
| STAT-002 | 같은 테스트: 실제 Chart.js canvas, 범례금액100%,기간총합 | canvas 픽셀 곡선 좌표는 의미 있는 DOM 금액과 별도로 판단 |
| STAT-003 | 같은 파일: 기본 생활/육아/식비,예산카테고리 초기선택, 사용자 토글 | 토글 비영속 정책은 route 재진입 추가 확인 가능 |
| STAT-004 | 같은 파일: 카테고리 상세에서 금액/카테고리 수정·삭제,총합 수렴 | 가맹점 규칙 기억하기는 merchant-rule E2E와 연결 |
| STAT-005 | 삭제 후 NoData와 날짜 오류 화면 구분 | 실제 공급자 장애·자산0원 구분은 reporting별 테스트 |
| STAT-006 | 기간별 다른 원천·페이지 결과 검증 | stale actor/request revision·읽기 상한은 production Query 단위/통합 |

## Access / Household

Canonical 연결은 `T-LED-001`의 동일 월 route 이동·server 준비 상태 보존, `T-LED-009`와 `T-BUD-001`의 예산 유무별 차감·전체 월/카테고리·서로 다른 기간 합계, `T-SEA-001`의 카드 복합 매칭·빈 검색, `T-SEA-002`의 수정 후 새 결과와 50+1 페이지, `T-SEA-003`의 첫 페이지에도 전체 51건 합계 보존 assertion을 가리킵니다. listener 장애·모든 legacy 정렬 입력, 모든 카드 마스킹과 다중 월·다중 page의 곱집합, logout 도중 지연 응답 등 각 canonical의 모든 세부 조합이 E2E에 포함됐다는 뜻은 아닙니다.

`access-household.spec.ts`는 계정마다 독립 BrowserContext를 사용합니다. 실제 Auth Emulator 계정 로그인만 허용하며 principal/member를 브라우저 전역에 주입하지 않습니다. 테스트 계정은 Emulator 이메일 로그인으로 인증 주체를 준비하며, Google 동의 화면이나 실제 OAuth 공급자 가용성을 검증하지 않습니다.

| 요구사항 | 실제 E2E 범위 | 추가 경계 |
|---|---|---|
| HH-001 | 유효 legacy 후보와 불완전 후보의 첫 로그인 분기 | Native-only 저장값은 Android instrumentation |
| HH-002 | 기존ID/거래 보존 claim·동일UID 멱등·다른UID 거부 | 운영자 신원 교정은 관리자 callable 통합 |
| HH-003 | 신규 사용자 선택·초대코드 화면, 직접 키 입력 없음 | 없음 |
| HH-004 | endpoint가 없는 브라우저 로그아웃→localStorage삭제→재로그인 | 실제 PWA endpoint 삭제 실패는 Notifications E2E |
| HH-005 | 재로그인 동일Member/가구 복원 | iPhone warm restart는 `ios-startup`; 모든 backoff/epoch는 session 통합 |
| HH-006 | 3계정 각자 이름/UID 연결, 타인 memberId·uid가 Actor가 되지 않음 | 없음(정상 생성/위조 경계) |
| HH-007 |32hex가구ID,네 접미사,자기Member,기본카탈로그완료 | 초기화 실패·중복claim 경합은 AccessUoW 통합 |
| HH-008 | 미로그인 보호화면 차단,타가구 callable·실제 Rules 읽기 거부 | 관리자별도 E2E |
| HH-009 | 실제 rename-self callable→canonical 이름 갱신→로그아웃/재로그인 UI 표시, ID와 기존 거래 참조 보존, 타가구 거부 | 현재 설정 화면에는 이름 편집 UI가 없습니다. 외부 HTTP 변경 직후 기존 세션 이름의 자동 갱신을 검증했다고 주장하지 않습니다. |
| HH-010 | 로그아웃에도 Membership보존,탈퇴/멤버추가 UI 없음 | administrator force remove는 별도명령 |
| HH-011 | portfolio 명의자 E2E와 연결 | Kotlin/공급자 경계와 분리 |
| HH-012 | admin 가구원 관리 E2E와 연결 | 일반사용자 범위아님 |
| HH-JOIN-001 | 테마 뒤 카드·5분 문구·원문 미저장·3계정 가입·재사용 거부·이미 가입자 거부 시 코드 미소비, 서버에 만료된 초대의 UI 가입 거절·Member/claim 무변경 | 벽시계를 실제로 5분 기다리는 대신 만료 시각 fixture로 운영 서버의 만료 판단을 거칩니다. |

## 알림 링크 도착

`notification-deeplink.spec.ts`는 `PUSH-006`, `PUSH-011`, `LED-001`, `HH-008`의 브라우저 도착 경계를 검증합니다. 저장된 과거 월 거래의 편집 URL로 직접 이동하면 실제 인증 복원·서버 단건 조회·해당 월 이동·수정 모달과 원문이 표시되어야 합니다. 없는 ID와 타가구 ID는 거래나 빈 검색창을 노출하지 않고 오류를 표시해야 합니다. 실제 OS 알림 클릭 dispatch와 FCM 전달을 이 테스트로 대체하지 않습니다. iPhone WebKit 반복은 공유 Playwright 프로젝트에서 별도로 실행합니다.

## 실행 중 발견한 문제

- 수입 등록 Adapter가 사용자 항목명 대신 `수입`을 서버 itemName으로 보내는 경로를 발견했습니다. 운영 Adapter 수정 후 `LED-003`에서 사용자 입력 memo 저장·편집·삭제가 통과했습니다.
- 기본 카테고리를 설정해도 수동 등록이 첫 카테고리를 선택하는 문제를 E2E에서 재현했습니다. 현재 기본 카테고리를 먼저 선택하도록 수정한 후 `CAT-003`이 통과했습니다.
- 과거 월 거래 딥링크가 빈 검색창으로 이동하던 문제는 서버 단건 조회와 대상 월 이동으로 수정되었습니다. 위 알림 링크 독립 E2E 2개가 Chromium과 iPhone WebKit 양쪽에서 통과했습니다.
- 검색 수정 중 창이 닫힌 한 번의 실패는 테스트 중 Web 파일 변경에 따른 Next 개발 서버 HMR과 겹쳤습니다. 파일 변경을 멈추고 동일 실제 브라우저 흐름을 재실행하니 검색창 유지·7,200원 재계산·검색어 변경이 통과했습니다. 검색 로직을 수정하거나 assertion을 낮추지 않았습니다.

## 앱에서 실행되지 않는 재무 계약 테스트 정리

2026-09-11 추가 감사에서 아래 factory 16개를 `functions/src`, `web/src`, `android/app/src`의 실제 소비 경로까지 조사했습니다. 각 모듈은 자기 파일 또는 `public.ts` export/type export 외에 bootstrap·Firebase adapter·Web/Android 런타임 소비가 없고, 테스트 fixture에서만 생성됩니다. 예를 들어 `createMergeIntegrityCommands`는 테스트 메모리 저장소의 전체 배열을 합치지만 실제 합치기 Command는 `createLedgerTransformationCommands`와 `FirebaseTransformationLineageStore`를 실행합니다. `createLedgerSearchQuery`·`createDetailedLedgerSearchQuery`도 실제 Web `expenseService`의 SDK 검색 경로에 연결되지 않습니다.

이 경로를 실제 앱 동작의 증거처럼 세던 **계약 테스트 파일 16개와 전용 support 파일 14개를 삭제**했습니다. production 소스와 실제 런타임 policy·Application·Firebase adapter 테스트는 유지합니다. `cancellation-atomicity-driver`와 `recurring-creator-fixture`는 다른 범위 소비자가 있어 담당 agent와 별도로 정리합니다.

| 삭제한 테스트 이름 (`*.contract.test.ts`) | 테스트만 소비한 factory / 단일 소스 파일 | 연결 ID와 실제 검증 대체 경로 |
|---|---|---|
| `monthly-budget` | `createMonthlyBudgetQuery` / `getMonthlyBudget.ts` | BUD-001/002: `finance-categories` 실제 예산 계산, Web 조회 경로 테스트 |
| `captured-monthly-cancellation` | `createCapturedLineageCancellationCommands` / `cancelCapturedLineage.ts` | LED-009, SPL-003: `payment-capture` 승인→월 분할→원승인 취소, 실제 transformation lineage 통합 |
| `local-currency-ledger` | `createLocalCurrencyLedgerCommands` / `localCurrencyLedgerService.ts` | LED-009/010: `finance-currency-recurring`, 실제 lineage/store 통합 |
| `local-currency-metadata-lifecycle` | `createLocalCurrencyMetadataCommands` / `localCurrencyMetadataService.ts` | LED-010: 실제 capture metadata/lineage 경계와 typed 상세 E2E |
| `merge-integrity` | `createMergeIntegrityCommands` / `mergeIntegrityService.ts` | LED-008/009, MRG-001: 실제 연속 drag 합치기·canonical 원본·복원 E2E와 운영 Graph policy 테스트 |
| `monthly-reconfiguration-state` | `createMonthlyReconfigurationCommands` / `monthlyReconfigurationService.ts` | LED-009/010, SPL-004: `finance-structure` 개월 변경·원본 복원 및 운영 monthlySplitLifecycle 통합 |
| `structural-mutation-boundaries` | `createStructuralMutationCommands` / `structuralMutationService.ts` | LED-008: 실제 stale version 거절 E2E와 실제 UoW 통합 |
| `unmerge-restoration-details` | `createUnmergeRestorationCommands` / `unmergeRestorationService.ts` | LED-009, MRG-002: 연속 합치기 후 실제 원본 ID·개별 금액·메모 복원 E2E |
| `ledger-update-delete-lifecycle` | `createLedgerUpdateDeleteCommands` / `updateDeleteLifecycleService.ts` | LED-005: 실제 UI 수정/삭제·검색/통계 제외·stale 거절, 운영 basicLedgerService 테스트 |
| `ledger-search-controller` | `createLedgerSearchController` / `ledgerSearchController.ts` | SEA-003: 실제 검색어 변경·mutation 재조회·페이지 E2E와 Web 요청 경합 테스트 |
| `ledger-search-query-details` | `createDetailedLedgerSearchQuery` / `detailedLedgerSearchQuery.ts` | SEA-001/002/003: 실제 SDK 과거 거래·카드 별칭·마스킹 검색 E2E |
| `ledger-period-query`, `ledger-read-compatibility` | `createLedgerPeriodQuery`, `createCompatibleLedgerReader` / `ledgerPeriodQuery.ts` | LED-001: `finance-ledger`, 실제 Web Read Model 및 SDK projection 테스트 |
| `ledger-search` | `createLedgerSearchQuery` / `ledgerSearchQuery.ts` | SEA-002/004: 실제 SDK 51건 페이지·전체 합계·마스킹 검색 E2E |
| `balance-subscription` | `createBalanceSubscriptionApplication` / `balanceSubscriptionApplication.ts` | BAL-004: `finance-currency-recurring` 실제 snapshot 갱신·선택·새로고침 |
| `recurring-creator` | `createRecurringCreatorApplication` / `recurringCreatorApplication.ts` | REC-006: 실제 정기 거래 UI CRUD와 `recurring-execution` Scheduler→Emulator creator 보존 |

위 E2E가 삭제한 모든 가상 장애 조합을 동일하게 증명한다고 주장하지 않습니다. 의미 있는 장애·동시성 검증은 실제 운영 Application/SDK/UoW 테스트에 두어야 하며, 앱에 연결되지 않은 대체 Application의 성공으로 대변하지 않습니다.

메서드 단위 추가 감사에서도 `createBasicLedgerCommands.summary()`는 실제 `functions/src`·`web/src` 호출이 없고, 실제 화면은 별도 Read Model을 사용함을 확인했습니다. `basic-ledger-commands.contract.test.ts`의 해당 합계 2개 사례와 테스트 전용 SummaryResult 인터페이스를 제거하고 `T-LED-009`를 위 실제 월·카테고리·기간 합계 E2E에 연결했습니다. 같은 factory의 실제 운영 등록·수정·삭제·알림 요청 사례는 유지했으며, unsafe integer 등록/수입/수정 회귀를 포함한 남은 20개가 통과했습니다.
