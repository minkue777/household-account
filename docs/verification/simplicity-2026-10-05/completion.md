# 잔여 정비 진행표

기능별 원래 후보와 실제 처리 결과를 연결합니다. 미착수·검증 중은 완료로 간주하지 않습니다. 운영 자료 이관이 필요한 호환 경로는 코드 정비와 구분하여 근거 및 종료 조건을 기록합니다.

| 조사 항목 | 상태 | 변경·검증 근거 |
|---|---|---|
| [FT-01 / P2: 실제 동작과 연결되지 않는 상수 관측을 없애기](finance-tests.md) | 미착수 | |
| [FT-02 / P2: Capture 조율용 fixture가 별도 금융 엔진을 구현하는 범위 줄이기](finance-tests.md) | 미착수 | |
| [FIN-09 · P1 · 정기 계획 한 건의 명령을 가구 전체 plans·receipts 로딩과 diff 저장에서 분리합니다](finance.md) | 구현·실제 SDK 검사 완료 | [정기 계획과 Outbox 단순화](../../operations/recurring-simplicity-2026-10-05.md) |
| [FIN-01 · P1 · 자산·보유종목 Command가 계산한 최종 상태를 버려 Web이 서버 상태를 추정합니다](finance.md) | 서버 배포·Web 구현·브라우저 5개 완료 | [명령 확정 응답](../../operations/portfolio-command-confirmation-2026-10-05.md) |
| [FIN-02 · P1 · 실제 경로와 분리된 Reporting 상태기계·포트폴리오 정책을 계약 검사와 함께 정리합니다](finance.md) | 미착수 | |
| [FIN-03 · P2 · 정기지출의 optional pagination이 테스트 때문에 무제한 조회 경로를 남깁니다](finance.md) | 구현·실제 SDK 검사 완료 | [정기 계획과 Outbox 단순화](../../operations/recurring-simplicity-2026-10-05.md) |
| [FIN-04 · P2 · 정기지출은 Outbox 원자 저장 뒤 사용하지 않는 별도 publish 경로를 유지합니다](finance.md) | 구현·실제 SDK 검사 완료 | [정기 계획과 Outbox 단순화](../../operations/recurring-simplicity-2026-10-05.md) |
| [FIN-05 · P2 · 삭제 자산 목록의 ID 왕복을 없애 한 번 읽은 문서를 그대로 반환합니다](finance.md) | 구현·실제 SDK 검사 완료 | [자산 조회·목록 발행](../../operations/portfolio-storage-simplicity-2026-10-05.md) |
| [FIN-08 · P2 · 종목 catalog의 업로드 전 가상 metadata를 없애 실제 저장 결과에서 한 번만 구성합니다](finance.md) | 구현·실제 SDK 검사 완료 | [자산 조회·목록 발행](../../operations/portfolio-storage-simplicity-2026-10-05.md) |
| [FIN-06 · P3-조건부 · 지역화폐 Canonical/legacy 이중 저장의 종료 계획을 명시합니다](finance.md) | 미착수 | |
| [FIN-07 · P3-조건부 · 배당 조회에서 이관 계획을 매번 재해석하는 복구 경로를 1회 자료 정비로 옮깁니다](finance.md) | 미착수 | |
| [PT-01 — 구조 검사로 복잡한 배포/분해 모형을 고정합니다 (높음)](platform-tests.md) | 구현·관련 검사 완료 | [한 번의 후보 준비](../../operations/build-preparation-simplicity-2026-10-05.md) |
| [PT-02 — fixture가 제품 경계의 행동을 직접 대신합니다 (높음)](platform-tests.md) | 미착수 | |
| [PT-03 — 상수로 저장된 자료를 비교하는 보존 assertion은 삭제 가능합니다 (높음)](platform-tests.md) | 구현·실제 SDK 검사 완료 | [명시적 동작과 실제 보존 검사](../../operations/access-command-simplicity-2026-10-05.md) |
| [PT-04 — 413줄 Firestore 대역의 SDK 의미 차이가 버그를 숨깁니다 (높음)](platform-tests.md) | SDK 차이 교정·범위 제한 | [실제 SDK 비교 및 동시성 범위 분리](../../operations/access-simplicity-2026-10-05.md) |
| [PT-05 — RenameSelf 중복 이름 계약은 fixture에서만 충족됩니다 (높음)](platform-tests.md) | 구현·관련 검사 완료 | [실제 SDK 재현 및 수정](../../operations/access-simplicity-2026-10-05.md) |
| [PT-06 — 실제 completion 경로와 다른 monitor 복구 API를 테스트가 살려 둡니다 (높음)](platform-tests.md) | 구현·실제 SDK 검사 완료 | [생명주기 실행 경계](../../operations/lifecycle-simplicity-2026-10-05.md) |
| [PT-07 — 과거 날짜 예외와 구 성능 gate를 테스트가 보존합니다 (높음)](platform-tests.md) | 구현·관련 검사 완료 | [검사 경계 정비](../../operations/verification-simplicity-2026-10-05.md) |
| [PT-08 — category 조회 최적화 검사가 최초 수정·삭제 경로를 타지 않습니다 (높음)](platform-tests.md) | 실제 SDK 검사·추적성 정리 완료 | [저장 보존과 실제 조회 비용](../../operations/read-cost-contract-tests-2026-10-05.md) |
| [PT-09 — 일반 tenant CRUD 행렬이 실제 Rules 계약처럼 보입니다 (높음)](platform-tests.md) | 미착수 | |
| [후보 A01 — 사용처 없는 서버의 클라이언트 세션 모형 삭제](platform.md) | 구현·관련 검사 완료 | [서버 실행 경로 정비](../../operations/server-simplicity-2026-10-05.md) |
| [후보 A02 — 서로 다른 Safe HTTP 모형 두 개 삭제](platform.md) | 구현·관련 검사 완료 | [서버 실행 경로 정비](../../operations/server-simplicity-2026-10-05.md) |
| [후보 A03 — 미연결 ingress·결과분류·HTML 파서 모형 삭제](platform.md) | 구현·관련 검사 완료 | [서버 실행 경로 정비](../../operations/server-simplicity-2026-10-05.md) |
| [후보 A04 — RenameSelf의 가짜 전체 상태 계약을 실제 transaction 입력으로 축소](platform.md) | 구현·관련 검사 완료 | [실제 SDK 재현 및 수정](../../operations/access-simplicity-2026-10-05.md) |
| [후보 A05 — 온보딩 거대 Application의 dummy dependency 제거](platform.md) | 구현·실제 SDK 검사 완료 | [명시적 동작과 실제 보존 검사](../../operations/access-command-simplicity-2026-10-05.md) |
| [후보 A06 — 명령 등록·권한·멱등성 정책을 등록 위치 한 곳에서 읽게 축소](platform.md) | 구현·관련 검사 완료 | [등록 정책과 실제 composition 검사](../../operations/handler-policy-simplicity-2026-10-05.md) |
| [후보 A07 — 계약 테스트의 문법/폴더 강제를 행동 검증으로 대체](platform.md) | 구현·관련 검사 완료 | [서버 실행 경로 정비](../../operations/server-simplicity-2026-10-05.md) |
| [후보 A08 — 운영 runner에 박힌 테스트 전용 실패 주입 제거](platform.md) | 구현·실제 SDK 검사 완료 | [생명주기 실행 경계](../../operations/lifecycle-simplicity-2026-10-05.md) |
| [후보 A09 — 30일 접속 통계 정리가 실제 저장에서도 적용되도록 단순화](platform.md) | 구현·관련 검사 완료 | [실제 SDK 재현 및 수정](../../operations/access-simplicity-2026-10-05.md) |
| [후보 A10 — 관리자 조회를 실제 조회 범위에 맞추고 만료된 통계 예외 제거](platform.md) | 미착수 | |
| [TB-01 — 저장 결과가 같다는 검사와 읽기·쓰기 비용 검사를 구별한다](test-boundaries.md) | 실제 SDK 검사·추적성 정리 완료 | [저장 보존과 실제 조회 비용](../../operations/read-cost-contract-tests-2026-10-05.md) |
| [TB-02 — 공유 schema 검사를 생산자·소비자 실행 검사로 부르지 않는다](test-boundaries.md) | 실제 SDK 검사·추적성 정리 완료 | [저장 보존과 실제 조회 비용](../../operations/read-cost-contract-tests-2026-10-05.md) |
| [TOOL-01 — Android 영향 범위를 수동 파일명 목록으로 관리하면서 보조 도구 검사가 스스로 빠집니다](tooling.md) | 구현·관련 검사 완료 | [검사 경계 정비](../../operations/verification-simplicity-2026-10-05.md) |
| [TOOL-02 — 현재 실행자가 쓰지 않는 과거 성능 PASS/FAIL 평가 모드를 계속 유지합니다](tooling.md) | 구현·관련 검사 완료 | [검사 경계 정비](../../operations/verification-simplicity-2026-10-05.md) |
| [TOOL-03 — 동일 후보를 준비하는 build와 구조 검사를 한 흐름에서 반복합니다](tooling.md) | 구현·관련 검사 완료 | [한 번의 후보 준비](../../operations/build-preparation-simplicity-2026-10-05.md) |
| [TOOL-04 — 완료된 구형 이관용 reconciliation이 일반 runtime 명령처럼 남아 있습니다](tooling.md) | 미착수 | |
| [TOOL-05 — 요구사항 선언 파서가 세 군데에서 같은 규칙을 다시 구현합니다](tooling.md) | 구현·관련 검사 완료 | [검사 경계 정비](../../operations/verification-simplicity-2026-10-05.md) |
| [TOOL-06 — 런타임 보안 경계 검사에 과거 폴더 이전 완료 조건이 섞여 있습니다](tooling.md) | 구현·관련 검사 완료 | [검사 경계 정비](../../operations/verification-simplicity-2026-10-05.md) |
| [WT-01 · 원장 optimistic 수정: 읽기 전용 metadata, expectedVersion, 즉시 반영/rollback](web-tests.md) | 구현·관련 검사 완료 | [운영 연결과 계약 검사](../../operations/web-contract-tests-simplicity-2026-10-05.md) |
| [WT-02 · 원본 선택·월분할 command/lineage](web-tests.md) | 구현·관련 검사 완료 | [운영 연결과 계약 검사](../../operations/web-contract-tests-simplicity-2026-10-05.md) |
| [WT-03 · 홈 설정 편집 version 고정·중복 카드 저장 거부](web-tests.md) | 구현·관련 검사 완료 | [운영 연결과 계약 검사](../../operations/web-contract-tests-simplicity-2026-10-05.md) |
| [WT-04 · PUSH-008 endpoint 등록: 서버 성공 뒤 active, 진행단계 순서](web-tests.md) | 구현·관련 검사 완료 | [운영 연결과 계약 검사](../../operations/web-contract-tests-simplicity-2026-10-05.md) |
| [WT-05 · PUSH-004/PUSH-011 malformed payload 차단, actor 변경 뒤 늦은 callback 격리](web-tests.md) | 구현·관련 검사 완료 | [운영 연결과 계약 검사](../../operations/web-contract-tests-simplicity-2026-10-05.md) |
| [WT-06 · 자산 조회 실패·정상 빈 값 구분(UI-01)](web-tests.md) | 구현·관련 검사 완료 | [자산 조회 실패와 명의 조회](../../operations/portfolio-read-simplicity-2026-10-05.md) |
| [UI-01 · 실패·빈 목록·0원의 소유 계약을 읽기 경계에서 하나로 정합니다](web-ui.md) | 구현·관련 검사 완료 | [자산 조회 실패와 명의 조회](../../operations/portfolio-read-simplicity-2026-10-05.md) |
| [UI-02 · 수입 요약 편집도 편집 시작 버전을 그대로 전달해야 합니다](web-ui.md) | 구현·관련 검사 완료 | [편집 초안과 시세 수명](../../operations/editor-simplicity-2026-10-05.md) |
| [UI-03 · 설정 저장의 성공·중복·실패 결과 처리를 화면 한 곳으로 모읍니다](web-ui.md) | 구현·관련 검사 완료 | [설정 실패와 사용하지 않는 경계](../../operations/settings-simplicity-2026-10-05.md) |
| [UI-04 · 폼의 초기화 단위를 외부 목록 참조가 아닌 편집 인스턴스로 맞춥니다](web-ui.md) | 구현·관련 검사 완료 | [편집 초안과 시세 수명](../../operations/editor-simplicity-2026-10-05.md) |
| [UI-05 · 신규 자산의 선택 종목과 시세를 같은 초안 세대에 속하게 합니다](web-ui.md) | 구현·관련 검사 완료 | [편집 초안과 시세 수명](../../operations/editor-simplicity-2026-10-05.md) |
| [W1. 자산 저장 결과를 클라이언트가 다시 구성한다 — 우선 정비](web.md) | 서버 배포·Web 구현·브라우저 5개 완료 | [명령 확정 응답](../../operations/portfolio-command-confirmation-2026-10-05.md) |
| [W2. snapshot의 의미 대신 횟수로 확정을 추정한다 — 상세 설계 필요](web.md) | 구현·관련 검사 완료 | [서버 확정과 구독](../../operations/web-snapshot-simplicity-2026-10-05.md) |
| [W3. Firestore 경계가 SDK overload 전체를 흉내 낸다 — 축소 가능](web.md) | 구현·관련 검사 완료 | [서버 확정과 구독](../../operations/web-snapshot-simplicity-2026-10-05.md) |
| [W4. 폼의 생성·초기화·복구가 여러 곳에 있다 — 기능별로 정리](web.md) | 구현·관련 검사 완료 | [편집 초안과 시세 수명](../../operations/editor-simplicity-2026-10-05.md) |
| [W5. 주식/코인 검색 입력 흐름이 추가·상세 화면에 중복된다 — 국소 정비](web.md) | 구현·관련 검사 완료 | [편집 초안과 시세 수명](../../operations/editor-simplicity-2026-10-05.md) |
| [W6. 홈 설정 UI의 테스트와 운영 연결이 다르다 — 계약 정리 우선](web.md) | 구현·관련 검사 완료 | [운영 연결과 계약 검사](../../operations/web-contract-tests-simplicity-2026-10-05.md) |
| [W7. 통계 캐시에 화면 애니메이션과 부분 수정 정책이 섞여 있다 — 조건부 정비](web.md) | 미착수 | |
| [W8. 같은 카테고리 문서를 목록과 버전으로 나눠 다시 구독한다 — 원본 단위 정비](web.md) | 서버 배포·Web 구현·브라우저 5개 완료 | [카탈로그 원본과 확정 버전](../../operations/category-catalog-simplicity-2026-10-05.md) |
| [W9. 오래된 가맹점 API와 실패를 빈 성공으로 바꾸는 경계 — 삭제·교정 구분](web.md) | 구현·관련 검사 완료 | [설정 실패와 사용하지 않는 경계](../../operations/settings-simplicity-2026-10-05.md) |
| [W10. 더 이상 쓰지 않는 인자를 호출부까지 운반한다 — 작은 삭제 단위](web.md) | 구현·관련 검사 완료 | [설정 실패와 사용하지 않는 경계](../../operations/settings-simplicity-2026-10-05.md) |
| [W11. 명의 조회의 한 줄 위임 계층 — 기능 단위로 평탄화 가능](web.md) | 구현·관련 검사 완료 | [자산 조회 실패와 명의 조회](../../operations/portfolio-read-simplicity-2026-10-05.md) |
| [1. 운영에 연결되지 않은 configuration 메모리 application 3개 제거 검토](capture.md) | 구현·관련 검사 완료 | [카드·규칙 직접 변경 계산](../../operations/server-simplicity-2026-10-05.md) |
| [2. Android 미사용 단건 capture 전달 API 제거](capture.md) | 이전 배포 완료 | [Android 1차](implementation.md) |
| [3. capture ingress와 retry의 두 전달 알고리즘을 한 번의 attempt로 통일](capture.md) | 미착수 | |
| [4. 서버 FID 등록에서 가상의 client session controller 제거](capture.md) | 미착수 | |
| [5. configuration의 transaction 내부 가상 store를 순수 mutation으로 축소](capture.md) | 구현·관련 검사 완료 | [카드·규칙 직접 변경 계산](../../operations/server-simplicity-2026-10-05.md) |
| [6. 테스트만 소비하는 legacy Shortcut owner 추론은 운영 src와 분리](capture.md) | 미착수 | |
| [7. QuickEdit의 original/draft/Intent 필드 복제를 한 snapshot과 draft로 정리](capture.md) | 미착수 | |
| [8. 모든 알림 event에 붙은 legacy Shortcut guard의 종료 조건 명시](capture.md) | 미착수 | |
| [CT01 — 경합이라고 이름 붙인 검사가 순차 실행입니다. P1, 확신 높음](capture-tests.md) | 미착수 | |
| [CT02 — 로그·원문 비저장의 일부 검사가 상수 빈 배열을 읽습니다. P1, 확신 높음](capture-tests.md) | 미착수 | |
| [CT03 — receipt 조율 테스트가 취소·해시 별도 구현까지 유지합니다. P2, 확신 높음](capture-tests.md) | 미착수 | |
| [CT04 — golden 결과 상수를 다시 검사하는 테스트를 행동 검증과 분리합니다. P3, 확신 높음](capture-tests.md) | 미착수 | |
| [WE01 — 선택 상태를 CSS 구현으로 검증하는 작은 결합. P3, 확신 높음](web-e2e.md) | 구현·관련 검사 완료 | [운영 연결과 계약 검사](../../operations/web-contract-tests-simplicity-2026-10-05.md) |
| [WE02 — 첫 홈 성능 검사가 정확한 chunk 이름·개수를 고정합니다. P3, 확신 중간](web-e2e.md) | 미착수 | |


