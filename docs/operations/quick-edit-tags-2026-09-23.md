# QuickEdit 태그 입력 — 2026-09-23

## 요구사항과 범위

사용자는 자동 결제 후 열리는 Android QuickEdit에서도 태그를 넣을 수 있도록 요청하셨습니다. 기존 지출 태그의 값과 저장 규칙을 재사용하여 메모 아래에 태그 입력을 추가합니다. 기존 태그의 초기 표시, 추가·수정·개별 제거·전체 비우기, 태그만 변경한 저장, 저장 전 현재 초안으로 분할하는 흐름을 포함합니다.

업무 규칙은 Ledger `LED-011`·`LED-012`가 소유하고 Native UI·전달은 Android Host `QE-013`·`T-QE-008`로 추적합니다. 관련 기존 요구사항은 `QE-002`의 변경 필드 Update, `QE-009`의 표시 FIFO, `QE-010`·`T-QE-004`의 미저장 전체 초안 분할, `QE-012`의 암호화 command outbox입니다. 기존 QuickEdit 제외 문구는 [DEC-075](../requirements/governance/decisions.md#dec-075)에서 이번 확장 이력과 함께 정리합니다.

## 화면과 입력 규칙

- 레이블은 `태그`, 입력 안내는 `태그를 입력하세요`로 메모와 맞춥니다. 별도 설명 문구는 추가하지 않습니다.
- 개별 태그는 배경·테두리·안쪽 여백 없는 파란색 `#태그` 텍스트와 제거 조작으로 표시합니다. 단일 입력과 추가 조작을 제공하며 Enter 확정 시 한글 IME 조합을 방해하지 않습니다.
- 저장·분할을 누르면 아직 추가 조작으로 확정하지 않은 입력도 현재 태그 배열에 합칩니다. 내부 공백·쉼표·중간 `#`는 구분자가 아니라 태그 이름으로 유지합니다.
- 앞뒤 공백·선행 `#`를 제거하고 빈 태그·동일 문자열 중복을 제거하며 최초 순서·철자를 유지합니다. 신규/명시적으로 변경한 배열은 최대 10개, 태그당 30 Unicode code point입니다. 잘못된 입력은 초안과 화면을 유지하고 서버·outbox에 제출하지 않습니다.
- 기존 저장값은 새 입력 한도를 넘더라도 읽기·초기 표시에서 자르거나 비우지 않습니다. 다른 필드만 바꾸면 tags를 생략하여 기존 서버값을 보존합니다. 추천을 위해 원장을 추가 조회하지 않습니다.

## 계약과 상세 설계

| 경계 | 변경과 호환 |
|---|---|
| Ledger/수집 응답 → QuickEdit snapshot | 기존 서버의 선택적 `tags` 문자열 배열을 Android Query/수집 응답 mapper가 전달합니다. 태그가 없는 구버전 응답은 태그 없는 표시로 읽으며 추가 거래 Query를 만들지 않습니다. 필드가 존재하지만 null·문자열·비문자열 원소 배열인 손상은 정상 빈 배열로 바꾸지 않고 계약 실패로 처리합니다. |
| Snapshot → 암호화 표시 FIFO → Intent → Activity | 태그 배열을 같은 순서로 보존합니다. 구버전 snapshot·queue·Intent의 필드 누락을 허용하고 기존 FIFO 순서·session 격리·Activity 표시 수명은 유지합니다. |
| 일반 저장 | 원본과 비교해 바뀐 필드만 `ledger.update-transaction.v1`의 `patch`로 보냅니다. 태그만 변경해도 제출하며 생략은 보존, 명시한 `tags: []`는 전체 제거입니다. 원본과 같은 기존 초과값에는 신규 입력 검증을 다시 적용하지 않습니다. |
| 항목 분할 | 분할 버튼을 누르는 순간 가맹점·금액·카테고리·메모·태그의 현재 form을 고정합니다. 변경한 태그는 `operation.baseDraft.tags`로 보내고 파생 항목은 이를 상속합니다. 변경하지 않은 태그는 baseDraft에서 생략해 서버 원본을 상속하며, 명시한 빈 배열만 제거합니다. 분할 창을 연 뒤 form 변경이 고정 초안에 섞이면 안 됩니다. |
| 암호화 command outbox | 고정 v1 envelope의 tags 값과 존재 여부를 JSON 왕복·재시작·재시도에서 보존합니다. commandId·idempotencyKey·expectedVersion·72시간 재시도·needs-attention·실패 알림 수명은 유지합니다. |
| 서버 검증 | 기존 Ledger Domain 태그 정책과 expectedVersion·원자적 UoW를 사용합니다. UI 검증 통과를 신뢰하거나 별도 QuickEdit 쓰기 경로를 만들지 않습니다. 잘못된 태그·stale version이면 거래와 태그를 일부 저장하지 않습니다. |

공개 v1 명령과 선택 필드 확장으로 구현하며 별도 태그 마스터·메모 인코딩·데이터 마이그레이션을 만들지 않습니다. 이전 APK의 태그 없는 요청도 저장된 태그를 보존합니다. 태그 입력값은 메모처럼 민감한 표시 정보이므로 일반 로그·실패 알림 본문에 기록하지 않습니다.

## 테스트 추적성

아래 표는 추가된 실제 테스트와 assertion의 관찰 범위입니다. 파일 링크나 요구사항 ID만으로 통과를 주장하지 않으며, 실제 실행 결과는 다음 절에 별도로 기록합니다.

| 요구사항 / Canonical 테스트 | 실제 검증 경계 | 테스트 |
|---|---|---|
| QE-013, LED-011 / T-QE-008, T-LED-011 | 정규화·중복·내부 공백/쉼표/중간 해시 유지·10/11개·Unicode 30/31 code point·기존 초과값 보존 | [QuickEditTagsTest](../../android/app/src/test/java/com/household/account/quickedit/QuickEditTagsTest.kt) |
| QE-002, QE-013 / T-QE-008 | 태그만 변경한 patch·빈 배열 제거·변경 없는 tags 생략·다른 필드 수정 시 기존 태그 보존 | [QuickEditUpdatePatchTest](../../android/app/src/test/java/com/household/account/quickedit/QuickEditUpdatePatchTest.kt) |
| QE-009, QE-013 / T-QE-003, T-QE-008 | Query/수집 응답의 tags 매핑·구버전 누락·손상 거부·FIFO snapshot 태그 왕복 | [HouseholdQueryClientTest](../../android/app/src/test/java/com/household/account/ledger/HouseholdQueryClientTest.kt), [CaptureSubmissionClientTest](../../android/app/src/test/java/com/household/account/paymentcapture/CaptureSubmissionClientTest.kt), [QuickEditPendingQueueJsonCodecTest](../../android/app/src/test/java/com/household/account/quickedit/QuickEditPendingQueueJsonCodecTest.kt) |
| QE-012, QE-013 / T-QE-007, T-QE-008 | Update 태그 배열·명시 빈 배열·Split baseDraft 태그를 실제 Keystore 저장소에서 재로딩하면 같은 envelope이며 SharedPreferences에 평문 태그가 없음 | [QuickEditEncryptedOutboxInstrumentationTest](../../android/app/src/androidTest/java/com/household/account/QuickEditEncryptedOutboxInstrumentationTest.kt)의 `actualEncryptedReloadPreservesTagArraysAndExplicitClears` |
| QE-002, QE-010, QE-013 / T-QE-004, T-QE-008 | 실제 Activity 초기 표시·입력·제거·미확정 입력 저장·분할 초안 고정·IME 조합·로컬 입력 오류 무제출·기존 초과값 메모 수정·숨김/재생성 시 선택/입력 중 태그 보존 | [QuickEditActivityInstrumentationTest](../../android/app/src/androidTest/java/com/household/account/QuickEditActivityInstrumentationTest.kt) |
| QE-013, LED-011, LED-012 / T-QE-008, T-LED-011, T-LED-012 | 실제 Native 화면 → 암호화 outbox → Emulator의 일반 Ledger Command → 서버 재조회까지 태그만 저장·전체 제거·미저장 분할 태그 상속, query fallback의 태그 초기 표시와 앱 로그 평문 비노출 | [QuickEditFirebaseE2ETest](../../android/app/src/androidTest/java/com/household/account/e2e/QuickEditFirebaseE2ETest.kt)의 `serverCreatedCategoryFlowsThroughCaptureIntoQuickEditAndMemoSave`가 `tagOnlySaveClearAndUnsavedSplitReachServer`를 호출 |

단위·codec 검사는 실제 UI 동작이나 서버 저장의 대체 근거가 아닙니다. Native instrumentation은 실제 Activity 입력을 확인하고, Firebase E2E가 실제 저장까지 연결되는 경계를 확인합니다. `QuickEditCommandOutboxJsonCodecTest`는 기존 일반 payload codec 회귀이며 이번에 태그 전용 assertion을 추가하지 않았습니다. 태그·빈 배열·분할 초안의 codec/암호화 재로딩 근거는 위의 실제 Keystore 검사로 한정하고, 새 검사만으로 태그를 포함한 네트워크 실패·72시간 재시도의 모든 조합을 검증했다고 주장하지 않습니다.

실제 테스트 메서드에 맞춰 [Native 추적성 manifest](../testing/native-real-code-coverage.json), 요구사항 catalog와 [생성 E2E 연결 표](../testing/e2e-requirement-coverage.md)를 갱신했습니다. 추적성 생성 검사는 통과했으며 이는 테스트 실행 성공과 구분합니다.

## 검증·배포 기록

구현 전 요구사항·계약·상세 설계를 먼저 갱신했습니다. 현재까지 확인된 결과는 다음과 같습니다.

- Android 관련 단위 테스트 10개 suite·총 65개 통과: test-results XML의 failures/errors가 모두 0입니다.
- Functions architecture 45개 통과. Functions 런타임 변경에 대한 배포 검증으로 해석하지 않습니다.
- 요구사항 catalog·E2E 추적성 생성 검사 통과.
- `assembleDebugAndroidTest`와 서명 `assembleRelease` 성공(빌드 1분 23초). `apksigner` v2 서명 검증과 APK의 v1.2.30/versionCode 32 확인도 통과했습니다.
- 서명 APK SHA-256: `68E3CE5F7CBE243C8823C00239EB960448F9F1F7705BC885F811A582A71EB7C3`.
- Android API 36.1 에뮬레이터에서 QuickEdit Activity·실제 Keystore outbox instrumentation 18개 통과(건너뜀·실패 0, 29초).
- 실제 Native Firebase E2E는 검증 중입니다. 실행 결과가 확정되기 전 통과로 기록하지 않습니다.

런타임 변경은 Android에 한정하며 기존 서버의 optional tags 계약을 사용합니다. Functions·Web 실행 코드가 바뀌지 않아 Firebase·Web 재배포는 필요하지 않습니다. Android v1.2.30(versionCode 32)의 서명 APK를 빌드했으며 GitHub Release 배포는 준비 중입니다. 아직 배포 완료 기록은 아니며 최종 SHA의 CI 결과와 실제 서명 APK 배포 결과를 구분해 확인합니다.
