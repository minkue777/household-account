# 전체 기능 유지보수성 검토와 수정 계획

기준 커밋: `c57d7768714f99a065dd2f1bdeba7fc7d587984a` · 검토일: 2026-09-16.

## 목적과 방법

기능 추가·수정 때 소유 모듈이 분명하고, 한 모듈의 변경이 관계없는 기능으로 번지지 않는지를 검토합니다. 단순한 구현, 중복 정책 제거, 3인 가구에 맞는 읽기·처리 범위를 우선합니다. 파일 길이나 추상화 수만으로 문제를 판정하지 않습니다.

19개 기능 모듈의 requirements/design 및 공통 계약을 읽고, 244개 소유 요구사항을 실제 Web·Android·Functions·운영 CLI의 진입점과 대조했습니다. 아래 상세 보고서의 coverage 표가 요구사항별 근거입니다. 이는 모든 시나리오의 실행 검증 또는 운영 무결함 보증은 아닙니다.

## 전체 검토 범위와 수정 위치

| 모듈 | 요구사항 수 | 실제 변경의 출발점 | 상세 검토 |
|---|---:|---|---|
| Access·가구·관리자 | 19 | Web HouseholdContext, Functions access Command와 각 Access Application | [인증·플랫폼](maintainability-2026-09-16-access-platform.md) |
| Ledger | 23 | ledgerHouseholdCommandHandlers → basicLedger / split / lineage | [가계부](maintainability-2026-09-16-finance.md) |
| Category·Budget | 6 | CategoryCatalogApplication, Web 홈 예산 계산 | [가계부](maintainability-2026-09-16-finance.md) |
| Recurring | 6 | Recurring Command / Scheduler → Finance UoW | [가계부](maintainability-2026-09-16-finance.md) |
| Local currency | 5 | BalanceObservationIntake → LocalCurrencyBalanceApplication | [가계부](maintainability-2026-09-16-finance.md) |
| Notifications | 14 | MobileFID controller, NotificationOutboxDispatch, DeliveryAssurance, 실제 worker/Kotlin | [인증·플랫폼](maintainability-2026-09-16-access-platform.md) |
| Payment configuration | 12 | Payment configuration Command, MerchantRuleSettings | [수집·Android](maintainability-2026-09-16-capture-android.md) |
| Android payment ingestion | 38 | Kotlin 수집 queue → FirebaseCaptureSubmission → 공용 capture intake | [수집·Android](maintainability-2026-09-16-capture-android.md) |
| Shortcut ingestion | 15 | FirebaseShortcutHttp → ShortcutHttpRequestProcessor → 공용 capture intake | [수집·Android](maintainability-2026-09-16-capture-android.md) |
| Portfolio core | 9 | PortfolioRuntimeApplication → Asset / Position / Refresh 실행 Application | [자산·외부 운영](maintainability-2026-09-16-portfolio.md) |
| Holdings·market data | 17 | FirebasePortfolioMarketData, accountValuation, Web holdingValuation | [자산·외부 운영](maintainability-2026-09-16-portfolio.md) |
| Asset automation | 5 | AssetAutomationScheduledApplication, RuntimeStore | [자산·외부 운영](maintainability-2026-09-16-portfolio.md) |
| Dividends | 8 | DividendScheduledRuntimeApplication, EventRuntimeRepository | [자산·외부 운영](maintainability-2026-09-16-portfolio.md) |
| Android host | 26 | 실제 Kotlin host/bridge/session/queue | [수집·Android](maintainability-2026-09-16-capture-android.md) |
| PWA | 8 | 단일 worker, BrowserServiceWorker, FidEndpointLifecycle | [인증·플랫폼](maintainability-2026-09-16-access-platform.md) |
| Reporting | 9 | Web expenseStatisticsReadModel, statisticsPeriod, 실제 통계 화면 | [가계부](maintainability-2026-09-16-finance.md) |
| Home preferences | 5 | HomePreferenceRuntimeApplication, Web ThemeContext / 설정 읽기 | [가계부](maintainability-2026-09-16-finance.md) |
| External operations | 6 | SafeExternalTextHttp, trackedScheduledJob, BillingCostSummary | [자산·외부 운영](maintainability-2026-09-16-portfolio.md) |
| Delivery | 4 | deploy-firebase wrapper, Git Vercel, APK release, 독립 CI | [인증·플랫폼](maintainability-2026-09-16-access-platform.md) |
| 공통 계약 | 9 | 실제 shared-kernel / UoW / session scope / 운영 migration | [인증·플랫폼](maintainability-2026-09-16-access-platform.md) |
| 합계 | **244** | | |

## 분석 후 실행 계획

1. **수정 위치를 하나로 정리합니다.** 실제 호출자·테스트·운영 CLI 참조를 확인한 뒤 미사용 대체 Application과 전용 Port/model을 함께 제거합니다. 실제 구현을 대신하는 테스트가 남은 곳은 유효한 경계 검증을 실제 코드로 옮깁니다. 공유 정책과 운영 전용 진입점은 보존합니다.
2. **실제 경로에서 이미 갈라진 정책을 통합합니다.** Category reference 판정, 홈 설정 정규화, 자산 평가의 숫자 부재/0 구분, 공급자 숫자·HTTP 실패 분류를 각 소유 모듈의 작은 함수로 모읍니다. 새로운 범용 framework를 도입하지 않습니다.
3. **불필요한 결합과 읽기를 줄입니다.** HouseholdContext의 metadata 변환을 순수 모듈로 분리하고, Snapshot 생성 때 쓰지 않는 Position/Automation 조회를 제거합니다. Recurring의 Ledger posting 중복은 기존 원자 transaction 안에서 Ledger 소유 정책·mapper 재사용으로 정리합니다.
4. **검토 중 드러난 실제 동작 불일치를 바로잡습니다.** 규칙 편집의 지우기 의미, 마지막 보유종목 삭제 후에도 기존 배당 이벤트의 정정·취소 반영 등을 실제 실행 경계에서 수정합니다.
5. **산출물과 검증을 맞춥니다.** 삭제한 TypeScript의 오래된 JavaScript가 배포 산출물에 남지 않도록 Functions build를 정리합니다. 변경한 실제 경계의 focused test·타입·아키텍처 검사를 수행하고 전체 E2E는 원격 CI 후속 확인으로 넘깁니다. Web/Functions 실행 변경만 해당 배포에 반영합니다.

작업은 Access/공통, Finance, Portfolio/외부 운영, Capture/Android의 독립 묶음으로 나눕니다. 각 보고서에 분석 시점의 발견과 구현 결과를 구분하여 남깁니다. 위험한 운영 데이터 변환·삭제는 포함하지 않습니다.

## 유지할 복잡도

Receipt, 원자 transaction, 낙관적 version 검사, Outbox와 endpoint별 send-once, session generation, 인가와 명시적 purge는 유지합니다. 이들은 사용자 수보다 재시도·복수 기기·중복 수집으로 필요한 장치입니다. 현재의 실제 공통 intake와 작은 순수 정책을 재사용하며, 모든 기능을 새 계층으로 옮기는 재설계는 하지 않습니다.

## 실행 결과

2026-09-17 구현을 마쳤습니다. 기능별 coverage 표에서 **244개 고유 ID, 누락 0, 중복 0**을 기계 대조했습니다.

- 실제 실행·운영 CLI 참조가 없는 대체 구현과 전용 타입 등 **서버 소스 194개 파일**을 제거했습니다. 실제 기능을 다른 가상 구현으로 교체하지 않았습니다. 과거 감사 기록에는 당시 판정을 보존하면서 이번 소스 정리 결과를 덧붙였습니다.
- Category 참조 판정, Recurring 원장 posting·저장 mapper, Web 예산·자산 평가, 홈 설정 정규화와 가구 metadata 변환의 소유 위치를 정리했습니다. 자산 Snapshot은 사용하지 않는 Position/Automation 조회를 생략합니다.
- 잘못된 시세의 0원 처리, 유효한 0원 시세의 매입가 대체, HTTP 408 분류, 가맹점 치환값 삭제·호환 필드 복원, 기존 배당 공시 재확인 경로를 수정했습니다.
- 독립 교차 검토로 구형 배당 ID 불일치, 실제 공급자 요청 없이 장애를 해제하는 관측, 삭제한 치환의 flat 호환 필드 재등장도 재현하여 수정했습니다.
- 대리 구현 검증 일부를 실제 Web 통계/평가·Shortcut HTTP·알림 dispatcher 검증으로 옮겼습니다. 가맹점 치환 삭제는 실제 Firestore 통합 검증과 기존 E2E 경로에 보강했습니다.

### 실행한 검증

각 상세 보고서에 명령 범위와 결과를 기록했습니다. 서로 겹치는 실행이 있으므로 합산하지 않습니다.

| 범위 | 결과 |
|---|---|
| 인증·알림 | 1차 193개, 추가 알림 정리 후 해당 범위 69개 통과 |
| 첫 화면·세션 복구·설정 읽기 | Web 34개 통과 |
| Finance | Functions 212개, Web 50개 통과 |
| Portfolio·외부 운영 | Functions 56개, Web 9개, 교차 검토 배당 수정 후 해당 범위 22개 통과 |
| Capture·설정 | Functions 514개, Web 2개, 추가 adapter 15개 통과 |
| 실제 Firestore | 가맹점 mapping 삭제·부분 수정·구형 flat 필드 6개 통과 |
| 공통 검사 | Functions/Web 전체 타입 검사, 아키텍처·추적성·문서 링크 39개 통과, 런타임 경계 위반 0 |
| 배포 절차 회귀 | 대상 선택·hash·marker·승인 wrapper 관련 25개 통과 |
| 로컬 production build | Functions·Web 모두 성공. 삭제한 194개 소스의 오래된 JS/map 0개, Web 정적 HTML 12개·CSP hash 25개·단일 root worker 검증 통과 |
| 전체 E2E/기기 | 로컬 전체 실행을 반복하지 않았습니다. 보강한 E2E와 나머지 전체 검증은 원격 CI에서 별도 확인합니다. |

### 남긴 범위와 판단

1. **Reporting의 나머지 테스트 전용 Query/fixture:** 현재 Web과 다른 checkpoint·정상 빈 결과·과거 소유자 계약이 있어 일괄 삭제하지 않았습니다. 실제 검증으로 대응을 확보한 기간·카테고리 선택 부분만 이관했습니다. 나머지 목록과 이관 조건은 Finance 보고서에 기록했습니다.
2. **Portfolio의 큰 데이터 소유 경계 재편:** Core/Automation/holdings 저장소를 새 framework로 재설계하지 않았습니다. 실제 실행 경로와 사용하지 않는 대체 구현을 구분하여 정리했습니다.
3. **KIND 공급자 취소·새 문서 번호로 정정되는 응답:** 저장된 공시 번호 재확인과 명시적 취소 결과 처리는 연결했습니다. 실제 취소 HTML과 정정 문서 연결 규칙은 근거가 없어 임의 parser를 넣지 않았습니다. DIV-006 전체 공급자 wire 검증 완료를 주장하지 않습니다.
4. **카테고리 조회 비용:** Category 검증이 필요한 Ledger 명령은 canonical+legacy 병렬 조회로 늘어납니다. 부분 이관 데이터의 권위를 지키기 위한 선택이며 메모 수정·삭제의 조회 생략은 유지했습니다. 전체 이관 완료 근거 없이 한 저장소를 생략하지 않았습니다.
5. **Android의 미사용 단일 제출 helper:** 검토 결과로 남겼습니다. 실제 Native 동작을 바꿀 필요가 없어 이번에는 Native 코드·APK 버전을 변경하지 않습니다.

운영 데이터 migration·삭제는 수행하지 않았습니다. commit/push, Web·Firebase 배포, 원격 CI 결과는 실제 완료 여부를 확인하여 작업의 최종 답변과 배포 provenance에 구분해 기록합니다.
