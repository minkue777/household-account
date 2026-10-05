# 잔여 정비 진행표

기능별 원래 후보와 실제 처리 결과를 연결합니다. 미착수·검증 중은 완료로 간주하지 않습니다. 운영 자료 이관이 필요한 호환 경로는 코드 정비와 구분하여 근거 및 종료 조건을 기록합니다.

| 조사 항목 | 상태 | 변경·검증 근거 |
|---|---|---|
| [FT-01 / P2: 실제 동작과 연결되지 않는 상수 관측을 없애기](finance-tests.md) | 미착수 | |
| [FT-02 / P2: Capture 조율용 fixture가 별도 금융 엔진을 구현하는 범위 줄이기](finance-tests.md) | 미착수 | |
| [FIN-09 · P1 · 정기 계획 한 건의 명령을 가구 전체 plans·receipts 로딩과 diff 저장에서 분리합니다](finance.md) | 미착수 | |
| [FIN-01 · P1 · 자산·보유종목 Command가 계산한 최종 상태를 버려 Web이 서버 상태를 추정합니다](finance.md) | 미착수 | |
| [FIN-02 · P1 · 실제 경로와 분리된 Reporting 상태기계·포트폴리오 정책을 계약 검사와 함께 정리합니다](finance.md) | 미착수 | |
| [FIN-03 · P2 · 정기지출의 optional pagination이 테스트 때문에 무제한 조회 경로를 남깁니다](finance.md) | 미착수 | |
| [FIN-04 · P2 · 정기지출은 Outbox 원자 저장 뒤 사용하지 않는 별도 publish 경로를 유지합니다](finance.md) | 미착수 | |
| [FIN-05 · P2 · 삭제 자산 목록의 ID 왕복을 없애 한 번 읽은 문서를 그대로 반환합니다](finance.md) | 미착수 | |
| [FIN-08 · P2 · 종목 catalog의 업로드 전 가상 metadata를 없애 실제 저장 결과에서 한 번만 구성합니다](finance.md) | 미착수 | |
| [FIN-06 · P3-조건부 · 지역화폐 Canonical/legacy 이중 저장의 종료 계획을 명시합니다](finance.md) | 미착수 | |
| [FIN-07 · P3-조건부 · 배당 조회에서 이관 계획을 매번 재해석하는 복구 경로를 1회 자료 정비로 옮깁니다](finance.md) | 미착수 | |
| [PT-01 — 구조 검사로 복잡한 배포/분해 모형을 고정합니다 (높음)](platform-tests.md) | 미착수 | |
| [PT-02 — fixture가 제품 경계의 행동을 직접 대신합니다 (높음)](platform-tests.md) | 미착수 | |
| [PT-03 — 상수로 저장된 자료를 비교하는 보존 assertion은 삭제 가능합니다 (높음)](platform-tests.md) | 미착수 | |
| [PT-04 — 413줄 Firestore 대역의 SDK 의미 차이가 버그를 숨깁니다 (높음)](platform-tests.md) | 미착수 | |
| [PT-05 — RenameSelf 중복 이름 계약은 fixture에서만 충족됩니다 (높음)](platform-tests.md) | 구현·관련 검사 완료 | [실제 SDK 재현 및 수정](../../operations/access-simplicity-2026-10-05.md) |
| [PT-06 — 실제 completion 경로와 다른 monitor 복구 API를 테스트가 살려 둡니다 (높음)](platform-tests.md) | 미착수 | |
| [PT-07 — 과거 날짜 예외와 구 성능 gate를 테스트가 보존합니다 (높음)](platform-tests.md) | 미착수 | |
| [PT-08 — category 조회 최적화 검사가 최초 수정·삭제 경로를 타지 않습니다 (높음)](platform-tests.md) | 미착수 | |
| [PT-09 — 일반 tenant CRUD 행렬이 실제 Rules 계약처럼 보입니다 (높음)](platform-tests.md) | 미착수 | |
| [후보 A01 — 사용처 없는 서버의 클라이언트 세션 모형 삭제](platform.md) | 미착수 | |
| [후보 A02 — 서로 다른 Safe HTTP 모형 두 개 삭제](platform.md) | 미착수 | |
| [후보 A03 — 미연결 ingress·결과분류·HTML 파서 모형 삭제](platform.md) | 미착수 | |
| [후보 A04 — RenameSelf의 가짜 전체 상태 계약을 실제 transaction 입력으로 축소](platform.md) | 구현·관련 검사 완료 | [실제 SDK 재현 및 수정](../../operations/access-simplicity-2026-10-05.md) |
| [후보 A05 — 온보딩 거대 Application의 dummy dependency 제거](platform.md) | 미착수 | |
| [후보 A06 — 명령 등록·권한·멱등성 정책을 등록 위치 한 곳에서 읽게 축소](platform.md) | 미착수 | |
| [후보 A07 — 계약 테스트의 문법/폴더 강제를 행동 검증으로 대체](platform.md) | 미착수 | |
| [후보 A08 — 운영 runner에 박힌 테스트 전용 실패 주입 제거](platform.md) | 미착수 | |
| [후보 A09 — 30일 접속 통계 정리가 실제 저장에서도 적용되도록 단순화](platform.md) | 구현·관련 검사 완료 | [실제 SDK 재현 및 수정](../../operations/access-simplicity-2026-10-05.md) |
| [후보 A10 — 관리자 조회를 실제 조회 범위에 맞추고 만료된 통계 예외 제거](platform.md) | 미착수 | |
| [TB-01 — 저장 결과가 같다는 검사와 읽기·쓰기 비용 검사를 구별한다](test-boundaries.md) | 미착수 | |
| [TB-02 — 공유 schema 검사를 생산자·소비자 실행 검사로 부르지 않는다](test-boundaries.md) | 미착수 | |
| [TOOL-01 — Android 영향 범위를 수동 파일명 목록으로 관리하면서 보조 도구 검사가 스스로 빠집니다](tooling.md) | 미착수 | |
| [TOOL-02 — 현재 실행자가 쓰지 않는 과거 성능 PASS/FAIL 평가 모드를 계속 유지합니다](tooling.md) | 미착수 | |
| [TOOL-03 — 동일 후보를 준비하는 build와 구조 검사를 한 흐름에서 반복합니다](tooling.md) | 미착수 | |
| [TOOL-04 — 완료된 구형 이관용 reconciliation이 일반 runtime 명령처럼 남아 있습니다](tooling.md) | 미착수 | |
| [TOOL-05 — 요구사항 선언 파서가 세 군데에서 같은 규칙을 다시 구현합니다](tooling.md) | 미착수 | |
| [TOOL-06 — 런타임 보안 경계 검사에 과거 폴더 이전 완료 조건이 섞여 있습니다](tooling.md) | 미착수 | |
| [WT-01 · 원장 optimistic 수정: 읽기 전용 metadata, expectedVersion, 즉시 반영/rollback](web-tests.md) | 미착수 | |
| [WT-02 · 원본 선택·월분할 command/lineage](web-tests.md) | 미착수 | |
| [WT-03 · 홈 설정 편집 version 고정·중복 카드 저장 거부](web-tests.md) | 미착수 | |
| [WT-04 · PUSH-008 endpoint 등록: 서버 성공 뒤 active, 진행단계 순서](web-tests.md) | 미착수 | |
| [WT-05 · PUSH-004/PUSH-011 malformed payload 차단, actor 변경 뒤 늦은 callback 격리](web-tests.md) | 미착수 | |
| [WT-06 · 자산 조회 실패·정상 빈 값 구분(UI-01)](web-tests.md) | 미착수 | |
| [UI-01 · 실패·빈 목록·0원의 소유 계약을 읽기 경계에서 하나로 정합니다](web-ui.md) | 미착수 | |
| [UI-02 · 수입 요약 편집도 편집 시작 버전을 그대로 전달해야 합니다](web-ui.md) | 미착수 | |
| [UI-03 · 설정 저장의 성공·중복·실패 결과 처리를 화면 한 곳으로 모읍니다](web-ui.md) | 미착수 | |
| [UI-04 · 폼의 초기화 단위를 외부 목록 참조가 아닌 편집 인스턴스로 맞춥니다](web-ui.md) | 미착수 | |
| [UI-05 · 신규 자산의 선택 종목과 시세를 같은 초안 세대에 속하게 합니다](web-ui.md) | 미착수 | |
| [W1. 자산 저장 결과를 클라이언트가 다시 구성한다 — 우선 정비](web.md) | 미착수 | |
| [W2. snapshot의 의미 대신 횟수로 확정을 추정한다 — 상세 설계 필요](web.md) | 미착수 | |
| [W3. Firestore 경계가 SDK overload 전체를 흉내 낸다 — 축소 가능](web.md) | 미착수 | |
| [W4. 폼의 생성·초기화·복구가 여러 곳에 있다 — 기능별로 정리](web.md) | 미착수 | |
| [W5. 주식/코인 검색 입력 흐름이 추가·상세 화면에 중복된다 — 국소 정비](web.md) | 미착수 | |
| [W6. 홈 설정 UI의 테스트와 운영 연결이 다르다 — 계약 정리 우선](web.md) | 미착수 | |
| [W7. 통계 캐시에 화면 애니메이션과 부분 수정 정책이 섞여 있다 — 조건부 정비](web.md) | 미착수 | |
| [W8. 같은 카테고리 문서를 목록과 버전으로 나눠 다시 구독한다 — 원본 단위 정비](web.md) | 미착수 | |
| [W9. 오래된 가맹점 API와 실패를 빈 성공으로 바꾸는 경계 — 삭제·교정 구분](web.md) | 미착수 | |
| [W10. 더 이상 쓰지 않는 인자를 호출부까지 운반한다 — 작은 삭제 단위](web.md) | 미착수 | |
| [W11. 명의 조회의 한 줄 위임 계층 — 기능 단위로 평탄화 가능](web.md) | 미착수 | |

