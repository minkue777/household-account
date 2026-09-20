# QuickEdit 표시 수명 복구 (2026-09-20)

## 문제와 근거

Android 1.2.28에서 종료된 QuickEdit의 `activeTransactionId`가 남으면 같은 프로세스의 후속 결제는 계속 대기했다. 운영 단말에서 표시 권한·수신 서비스·서버 저장은 정상이었으며, 실제 창은 없고 이전 편집 상태만 남아 있었다. 프로세스 재시작 직후 전날의 같은 FIFO head가 표시되어 원인을 확인했다. 최초 Activity가 사라진 직접 계기는 당시 상세 로그가 없어 단정하지 않는다.

## 요구사항·상세 설계·계약

요구사항은 Android Host `QE-009 / T-QE-003`이다. `QuickEditPresentationRegistry`는 scope·거래별 실행 요청과 실제 Activity 소유자를 메모리에서 추적한다. Activity 참조는 약한 참조이고, 저장된 거래·순서·snapshot은 기존 암호화 FIFO가 계속 소유한다. 외부 callable, Intent의 기존 필드, FIFO JSON 형식은 바뀌지 않는다.

Coordinator는 표시 작업을 하나의 mutex로 직렬화한다. 다음 결제·앱 재진입 시 실제 소유자가 없거나 숨은 창인 active lease만 풀고 같은 head를 획득한다. 살아 있는 숨은 창은 `REORDER_TO_FRONT`로 재사용하고, 사라진 창은 기존 snapshot으로 재생성한다. Activity 종료 자체로 거래를 완료하거나 자동으로 새 팝업을 열지 않는다. 이미 표시된 창은 유지하고, 화면 회전에는 10초의 재생성 여유를 둔다.

`onCreate/onStart/onDestroy`를 통해 소유자와 표시 상태를 연결한다. 오래된 Activity의 종료 callback은 새 소유자를 지우지 않는다. 실행 예외 또는 10초 동안 시작되지 않은 요청은 lease를 해제한다. timeout 복구는 15분 후 예약하며 새로운 결제·앱 재진입은 즉시 다시 시도할 수 있다. 표시 요청 번호가 바뀌었거나 Activity가 시작된 경우 이전 timeout은 무효다. session 전환은 registry와 FIFO를 함께 정리한다. 완료 시에는 완료한 거래와 일치하는 active lease만 해제한다.

## 테스트 추적성

| 요구사항 | 검증 | 테스트 |
|---|---|---|
| QE-009 / T-QE-003 | 창 제거 후 같은 프로세스에서 오래된 head 재획득 및 후속 3건 FIFO 유지 | `QuickEditPresentationRegistryTest` |
| QE-009 / T-QE-003 | 표시 중 중복 방지, 숨은 창 복구, 재생성 grace 및 오래된 owner callback 무시 | `QuickEditPresentationRegistryTest`, `QuickEditActivityInstrumentationTest` |
| QE-009 / T-QE-003 | 시작되지 않은 요청 timeout, 이전 timeout의 새 요청/세션 영향 없음 | `QuickEditPresentationRegistryTest` |
| QE-009 / T-QE-003 | 이전 거래의 늦은 완료가 다음 active lease를 해제하지 않음 | `QuickEditPendingQueueTest` |
| QE-009 / QE-012 | 실제 Activity 제거·재생성·숨김 복구, 미저장 memo 보존, 실제 암호화 FIFO | `QuickEditActivityInstrumentationTest` |

## 로컬 검증 결과

- QuickEdit 관련 JVM 검사 47개: failures/errors 0.
- API 36.1 에뮬레이터에서 실제 `QuickEditActivityInstrumentationTest` 9개: 모두 통과. 새 두 시나리오는 실제 Activity 제거 뒤 동일 프로세스에서 기존 head와 후속 세 건의 순서를 검증하고, 숨은 Activity의 동일 인스턴스 재사용·미저장 memo 보존·회전 재생성을 확인했다.
- `lintDebug`, `assembleRelease`: 성공. Android 버전은 1.2.29 (versionCode 31).
- 테스트는 FirebaseAuth 없는 격리된 에뮬레이터에서 실행했다. 운영 원장에 진단용 결제를 추가하지 않았다. 제조사별 모든 OS 차단 조건을 재현한 것으로 해석하지 않는다.
- 전체 CI는 최종 push SHA에 연결한 별도 workflow에서 확인한다.
