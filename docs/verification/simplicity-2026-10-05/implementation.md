# 기능 계약별 정비 실행 기록

정적 검토의 기준은 `12a582b`이며 이 문서는 이후 실제 변경과 검증을 기록합니다. 전체 후보 정비 완료를 뜻하지 않습니다.

## Android 알림 접수 — ING-008 / T-QUEUE-001

- 입력: 알림 후보 한 개 또는 여러 개. 실제 서비스가 사용하는 `enqueueBatchAndFlush → enqueueAll`로 접수합니다.
- 결과·저장: 모든 새 후보를 암호화 journal에 먼저 기록하고 전송합니다. 동일 observation ID의 같은 payload는 다시 저장·전송하지 않고, 다른 payload는 전체 접수를 거부합니다.
- 실패: 부분 재시도, 72시간 보존, 세션 전환 purge, QuickEdit FIFO 선저장을 유지합니다.
- 제거: 제품 호출자가 없는 `AndroidCaptureDelivery.enqueueAndFlush`, 그 경로만 사용한 Queue의 Boolean `enqueue` wrapper. 단건 접수 테스트도 실제 `enqueueAll`의 Accepted/Rejected 결과를 검사합니다.
- 확인: Android main/test/androidTest 소비자 검색 및 빌드. `:app:testDebugUnitTest --tests 'com.household.account.paymentcapture.*'` 10 suite, 49 tests 통과(실패·skip 0). 기존 Queue 16개 검사를 모두 유지했습니다.

관련 설계: [Android 수집](../../requirements/contexts/payment-capture/modules/android-payment-ingestion/design.md). 재시도 flush의 네트워크 잠금과 공통 처리 문제는 별도 후보이며 이번 미사용 API 제거로 해결했다고 보지 않습니다.
