# 기능 계약별 정비 실행 기록

정적 검토의 기준은 `12a582b`이며 이 문서는 이후 실제 변경과 검증을 기록합니다. 전체 후보 정비 완료를 뜻하지 않습니다.

## Android 알림 접수 — ING-008 / T-QUEUE-001

- 입력: 알림 후보 한 개 또는 여러 개. 실제 서비스가 사용하는 `enqueueBatchAndFlush → enqueueAll`로 접수합니다.
- 결과·저장: 모든 새 후보를 암호화 journal에 먼저 기록하고 전송합니다. 동일 observation ID의 같은 payload는 다시 저장·전송하지 않고, 다른 payload는 전체 접수를 거부합니다.
- 실패: 부분 재시도, 72시간 보존, 세션 전환 purge, QuickEdit FIFO 선저장을 유지합니다.
- 제거: 제품 호출자가 없는 `AndroidCaptureDelivery.enqueueAndFlush`, 그 경로만 사용한 Queue의 Boolean `enqueue` wrapper. 단건 접수 테스트도 실제 `enqueueAll`의 Accepted/Rejected 결과를 검사합니다.
- 확인: Android main/test/androidTest 소비자 검색 및 빌드. `:app:testDebugUnitTest --tests 'com.household.account.paymentcapture.*'` 10 suite, 49 tests 통과(실패·skip 0). 기존 Queue 16개 검사를 모두 유지했습니다.

관련 설계: [Android 수집](../../requirements/contexts/payment-capture/modules/android-payment-ingestion/design.md). 재시도 flush의 네트워크 잠금과 공통 처리 문제는 별도 후보이며 이번 미사용 API 제거로 해결했다고 보지 않습니다.

## QuickEdit 카테고리 조회·선택 — CAT-004 / T-CAT-005 / QE-002

- 입력: 현재 가구의 `categoryCatalog/current`. 제품이 사용하는 `getActiveCategories`만 공개 조회 경로로 남깁니다.
- 결과: 활성 항목을 정렬하고 ID의 대소문자 및 기본 카테고리 참조를 그대로 전달합니다. 실패·빈 결과의 기존 표시 전용 기본 목록은 유지합니다.
- 제거: 미사용 실시간 구독, label/key 검색, 기본 키 별도 조회 메서드. 호출자가 테스트뿐이던 `findCategoryByKey`의 검증은 실제 SDK의 Catalog 저장·조회·해석으로 옮겼습니다.
- 검증: API 36.1 에뮬레이터에서 `CategoryRepositoryInstrumentationTest` 3개, `QuickEditActivityInstrumentationTest` 14개 통과(실패·skip 0). 실제 Activity의 혼합 대소문자 선택, 메모-only 저장, 분할 초안, 암호화 outbox와 세션 전환 검사를 유지했습니다.
- 환경: 최초 시도는 그래픽 초기화 실패로 기기가 offline이어서 검사 시작 전 실패했습니다. 지원하는 `swiftshader_indirect`로 부팅을 확인한 뒤 실행했으며 검증 기준 변경은 없습니다.

관련 설계: [카테고리·예산](../../requirements/contexts/household-finance/modules/categories-budget/design.md).

## Android 거래 표시 모델 정리

- 실제 거래 조회·표시는 `LedgerTransactionSnapshot`과 QuickEdit snapshot이 담당합니다. 미사용 `Expense/Category/CardType`와 `CardLabelFormatter`를 제거했습니다.
- Android main/test/androidTest·리소스·Proguard·도구의 참조를 확인했습니다. 저장된 raw/legacy capture envelope, 암호화 journal codec, 구버전 snapshot 호환은 제거 대상이 아닙니다.
- 알림 요구사항과 아키텍처 문서의 거래 모델 참조를 실제 조회 DTO로 수정했습니다. Android 컴파일과 위 Activity 검사로 연결을 확인했습니다.

## 배포와 남은 범위

Android v1.2.33/code35로 배포합니다. Web·Functions 실행 코드 변경은 없으므로 해당 제품 재배포는 필요하지 않습니다. 서명 APK와 원격 CI의 결과는 배포 단계에서 확인합니다.

이번 실행은 Android 미사용 경로 정리입니다. 서버의 미사용 모형, 자산 명령 결과·편집 상태, capture 재시도 잠금/중복 알고리즘, 실제 계약을 관측하지 않는 테스트 등의 후보는 아직 미완료입니다. 전체 정비가 끝났다고 해석하지 않습니다.
