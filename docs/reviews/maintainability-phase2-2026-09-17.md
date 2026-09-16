# 2차 실사용 코드 유지보수성 검토

기준 커밋 `f1ed5a8`, 검토일 2026-09-17.

## 판정 기준

1차의 미사용 구현 정리와 분리하여 실제 실행 코드를 검토했습니다. 기능을 하나 고칠 때 **수정 소유자를 바로 찾을 수 있는지**, 그 변경이 **다른 기능의 상태·조회·실패에 불필요하게 영향을 주는지**, 정상 경로에 **중복 정책·파생 상태·과한 처리**가 있는지를 기준으로 삼았습니다.

요구사항 ID가 빠짐없이 표에 있다는 사실을 심층 검증의 증거로 삼지 않습니다. 상세 보고서에는 실제 변경 시나리오, 읽은 호출 경계, 새로 실행한 테스트, 정적 검토에 머문 범위와 남은 위험을 구분했습니다. 4개 영역으로 분담하여 검토하고 주요 변경은 다른 담당자가 교차 검토했습니다.

## 수정한 실제 경계

| 영역 | 문제 | 개선 |
|---|---|---|
| 자산 편집 → 자동화 | 이름·메모만 바꿔도 계획 조회/재계산에 진입하여 중지·주의 상태에 영향 | 자동화 관련 변경만 계획을 읽고, 정규화 후 실제 설정이 바뀔 때만 Automation 소유 정책 실행. metadata 경로의 계획 조회·쓰기 0건 |
| 보유목록 → 세션 | 가구만 key로 둔 cache와 늦은 callback이 세션보다 오래 유지됨 | 활성 actor snapshot 하나로 축소, 기존 세션 reset에 연결, 이전 callback과 구독 폐기 |
| 예약 평가 → Snapshot | 앞 단계 실패 여부를 메모리 Set으로만 전달 | runner가 이미 읽은 저장 실행 결과를 재사용. 재시작·checkpoint 재개에서도 평가 실패 후 Snapshot 생성 방지, 추가 DB 조회 0건 |
| 원장 수정 | 일반 수정/카테고리 수정의 optimistic begin/commit/rollback 복제 | 공개 명령은 유지하고 실제 공통 절차만 내부 helper로 통합 |
| 원장 → 지출 통계 | 통계가 문서 decoder 때문에 전체 명령 서비스를 import | Ledger 소유 순수 mapper 분리. 통계 읽기와 명령 singleton 초기화 의존 분리 |
| 수동 거래 재시도 | bootstrap의 카테고리 선조회가 receipt 재생을 차단 | 기존 lazy reader를 사용해 저장 receipt 재생 시 category 조회 0건 |
| 정기지출 조회 | 읽기 실패를 정상 빈 목록으로 바꿔 UI가 기존 목록을 지움 | 오류를 UI까지 전달하고 마지막 정상 목록과 재시도 제공. 미사용 일회성 decoder 복제 제거 |
| Category → Capture | canonical 보관 상태와 legacy 활성 판정이 다른 reader에서 갈라짐 | Category 소유 공통 합성 정책 사용, 내부 Capture projection v3으로 재생성 |
| 취소 → 가맹점 규칙 | 현재 표시용 치환규칙 충돌이 원 결제 취소까지 차단 | 취소는 불변 원문 증거로 직접 Ledger 경계 호출, 신규 승인만 enrichment 적용 |
| Android QuickEdit → outbox | 화면을 열 때와 저장할 때 사용자 scope가 달라질 수 있음 | 표시 당시 scope를 Intent·Activity 재생성·outbox admission·FIFO 완료까지 유지 |
| 원장 홈 화면 | 연간 조회/첫 표시/딥링크 effect와 화면 상태가 한곳에 혼재 | 수명이 다른 3개 책임을 분리. 연간 합계는 목록에서 파생, 무관한 목록 변화로 딥링크 조회를 다시 시작하지 않음 |
| 이름 변경 → 세션/metadata | 늦은 응답이 최신 가구 정보를 과거 render 값으로 덮음 | 시작 세션 확인 후 최신 ref에 반영, 로그아웃 후 응답 폐기 |
| 원장 이벤트 → 알림 | 알림 대상이 없는 거래도 endpoint/Membership에 의존 | 기존 채널 정책으로 먼저 판정하고 불필요한 조회 제거. 실제 발송 대상의 권한·version 재확인은 유지 |
| 관리자 상세 → 선택 가구 | 이전 가구 응답이 새 가구 제목 아래에 붙는 요청 경합 | 선택·요청 수명에 맞는 응답만 반영하고 실제 페이지에서 역순 응답 검증 |
| 관리자 멤버 목록 → lifecycle | 멤버 정보 version과 Membership version을 혼용 | 목록의 관리용 version은 Membership 기준, Member와 Membership은 각각 자신의 version을 증가 |

큰 파일을 무조건 자르거나 모든 서비스를 공통 executor로 감싸지 않았습니다. 기존 transaction/receipt를 유지한 채 정책·구독·캐시·명령의 소유를 명확히 했습니다. 신규 컬렉션·메시지 버스·상태관리 프레임워크·운영 데이터 migration은 추가하지 않았습니다.

## 모든 기능 모듈의 검토 위치

| 기능 모듈 | 구체적인 변경 시나리오 | 상세 근거 |
|---|---|---|
| Access·가구·관리자 | 로그인/이름/멤버 제거·복원/명의자/관리자 가구 전환/purge | [서버·관리자](maintainability-phase2-2026-09-17-access-admin.md), [세션](maintainability-phase2-2026-09-17-access-platform.md) |
| Ledger | 일반 편집/카테고리/분할·병합/취소/검색/receipt | [Finance](maintainability-phase2-2026-09-17-finance.md), [홈 원장](maintainability-phase2-2026-09-17-access-platform.md) |
| Category·Budget | 신규 기본값/이름·색·순서/보관/remap/0원 예산 | [Finance](maintainability-phase2-2026-09-17-finance.md), [Capture 참조](maintainability-phase2-2026-09-17-capture-android.md) |
| Recurring | 일정 수정/31일/미실행 월/중간 실패/목록 오류 | [Finance](maintainability-phase2-2026-09-17-finance.md) |
| Local currency | 유형 추가/관측 순서/잔액·지출 독립/선택 유형 | [Finance](maintainability-phase2-2026-09-17-finance.md) |
| Notifications | FID 등록/해제/자동·명시 알림/선호/클릭/탈퇴·purge | [알림·PWA](maintainability-phase2-2026-09-17-access-platform.md) |
| Payment configuration | 카드 소유·마스킹/규칙 추가·변경·해제/카테고리 보관 | [Capture](maintainability-phase2-2026-09-17-capture-android.md) |
| Android payment ingestion | 공급자 추가/중복 수집/승인·취소/잔액 branch/실패 재전송 | [Capture](maintainability-phase2-2026-09-17-capture-android.md) |
| Shortcut ingestion | 요청 인증/본문/공급자 parsing/공용 intake/진단 | [Capture](maintainability-phase2-2026-09-17-capture-android.md) |
| Portfolio core | 계좌 편집·삭제·정렬/평가·Snapshot/명의자 | [Portfolio](maintainability-phase2-2026-09-17-portfolio.md) |
| Holdings·market data | 보유 수정/매입가·시세/0·부재/종목 검색 목록/세션 교체 | [Portfolio](maintainability-phase2-2026-09-17-portfolio.md) |
| Asset automation | 설정 변경/중지·연체·복구/최초 적용월/같은 값 patch | [Portfolio](maintainability-phase2-2026-09-17-portfolio.md) |
| Dividends | 공시 갱신·정정·취소/권리일/보유 변경/원장 반영 | [Portfolio](maintainability-phase2-2026-09-17-portfolio.md) |
| Android host | bridge/인증/FIFO/QuickEdit/화면 재생성/알림 scope | [Android](maintainability-phase2-2026-09-17-capture-android.md) |
| PWA | worker 교체/재연결/로그아웃 cache/입력 보존/클릭 경로 | [PWA](maintainability-phase2-2026-09-17-access-platform.md) |
| Reporting | 기간 변경/cache 재사용/원장 수정 반영/자산·배당 통계 | [지출](maintainability-phase2-2026-09-17-finance.md), [자산](maintainability-phase2-2026-09-17-portfolio.md) |
| Home preferences | 카드 선택·version/지역화폐/조회 실패/테마 | [홈·환경설정](maintainability-phase2-2026-09-17-access-platform.md) |
| External operations | 공급자 장애/예약 재시작·lease/비용·진단 | [Portfolio·운영](maintainability-phase2-2026-09-17-portfolio.md) |
| Delivery | 대상별 배포/구버전 호환/산출물·서명/CI 독립 | [배포](maintainability-phase2-2026-09-17-access-platform.md) |
| 공통 계약 | tenant·멤버 ID/날짜·금액/호환 읽기/세션/원자성/운영 migration | 각 상세 보고서와 [공통 판단](maintainability-phase2-2026-09-17-access-platform.md#공통-계약과-복잡도-판단) |

## 유지할 구조와 남은 범위

3인 가구라도 여러 기기의 동시 편집과 반복 결제 수집은 실제 정상 사용입니다. 따라서 원자 transaction, Receipt, Outbox, version, 세션 격리는 유지합니다. 반면 module 전체를 읽는 데만 필요한 거대한 import, 중복 mapper, unrelated 계획 재계산, 가구별 영구 메모리 Map은 줄였습니다.

검토로 다음 범위가 완전히 증명된 것은 아닙니다.

- 공급자별 모든 원문 변형과 실제 iPhone/Android OS 이벤트 순서. Native 초기 batch 제출과 Auth 전환 경합은 Capture 보고서의 후속 검증 항목입니다.
- 검색의 모든 문자열 조합, 거래 분할·병합의 모든 lineage 조합, 운영 데이터 전수 정합성.
- Firestore 다중 페이지 통계를 하나의 서버 시점으로 고정하는 목표 계약. 현재 읽기 cache가 그 보장을 새로 제공한다고 주장하지 않습니다.
- 드문 홈 설정 저장의 불필요한 currency 목록 읽기, PWA dirty input의 저장 완료 연동, 일부 호환 reader의 잔여 책임 혼재. 실제 빈도와 위험에 비해 큰 재설계는 보류했습니다.

이 항목들은 수정 완료나 테스트 성공에 포함하지 않습니다. 세부 보고서에 변경한 경계의 회귀 테스트와 정적 검토 범위를 따로 남겼습니다. 전체 E2E는 정확한 push SHA의 원격 CI에서 실행하고 배포 완료와 구분하여 후속 확인합니다.

## 검증 기록

상세 보고서의 집중 검증 집합에는 중복이 있어 테스트 수를 단순 합산하지 않습니다. 실제 handler/adapter/페이지/Provider/hook/Native lifecycle을 호출하며 조회·쓰기 횟수, 상태 보존, 늦은 응답 폐기를 함께 확인했습니다. mock 함수의 반환값만 검증하는 대리 구현으로 바꾸지 않았습니다.

- Finance: Web 9 suites 85 tests, Functions 4 files 62 tests.
- Capture/Android: Functions 5 files 20 tests 및 최종 4 files 43 tests(서로 중복 포함), JVM 4 suites 32 tests. 구형 SHA 취소 receipt 호환을 실제 adapter로 재현·보완했습니다. 새 instrumentation 테스트 컴파일 성공, 로컬 에뮬레이터 미실행.
- Portfolio: Functions 46 tests, scheduler/lease/incident 26 tests, Web 9 tests.
- root 세션/홈/알림: Web 20 + 8 tests, Functions 56 tests.
- Access/Admin 추가 검토: 실제 페이지 10 tests, 서버 adapter/lifecycle/명의자 30 tests. 정기지출 교차 보완 후 해당 UI 파일 5 tests 통과.
- 중앙 Web/Functions TypeScript, Functions architecture 39 tests, Web production build, 서명 release APK build를 확인했습니다. 관리자 추가 검증 결과는 해당 상세 보고서에 기록합니다.

이 문서는 배포 전 구현 검토 기록입니다. 배포 SHA·Release·운영 smoke·CI의 최종 결과는 배포 기록 및 작업 완료 보고에서 구분합니다.
