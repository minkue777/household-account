# Android 결제 전송 실패 관측

## 확인된 현상

- 2026-11-11 09:22:56 KST 경기지역화폐 컴포즈커피 1,800원 원문은 진단 저장소에 남았으나 처음 확인한 시점에는 결제 접수·지출이 없었다. 운영 원문을 현재 서버 파서에 넣으면 정상 승인과 잔액으로 해석됐다.
- 사용자가 새 결제 후 이전 지출도 나타났다고 알려 재조회했다. 컴포즈는 09:29:30.303에, 다음 CU 12,000원은 09:29:31.059에 자동 등록됐고 각각 접수가 완료됐다. 컴포즈는 한 건이며 수동 등록·재처리·운영 데이터 수정은 하지 않았다.
- 새 알림이 들어오면 기존 암호화 대기열부터 순서대로 제출하는 코드 및 서버 접수 순서와 일치한다. 파서 누락으로 판단하지 않는다. 최초 전송이 실패한 SDK/인증/연결 원인은 기존 기록만으로 확정할 수 없다.

## 변경 계약

- 기존 `submitNotificationDiagnostic`에 선택적 `captureFailure`를 추가한다. `observationId`, 실패 단계(`SCOPE`, `ENQUEUE`, `QUEUE_READ`, `SUBMIT`, `LOCAL_COMMIT`), 제한된 오류 코드만 보존한다.
- Android 직접 제출에서 실패를 삼키던 경계를 관측한다. 재시도 가능한 서버 응답은 `SERVER_RETRY_REQUIRED`로 구분한다. 같은 알림의 실패를 기존 원문 진단에 첨부하며 로컬 `HHCaptureDelivery` 로그에도 기록한다. Worker의 개별 제출·응답 저장 실패도 로컬에 남는다.
- 예외 메시지·stack·인증 토큰·임의 SDK details는 전송하지 않는다. 서버는 미등록 단계/코드·추가 필드를 거부하고 인증된 Membership으로만 actor를 정한다. 기존 APK payload는 계속 허용한다.
- 전송 실패 시 원문 보존, 다음 알림/Worker 재시도, 동일 observation의 멱등성, 72시간 보존 및 세션 전환 권한 경계는 유지한다. 코루틴 취소는 일반 오류로 감싸거나 삼키지 않고 전파한다.
- 진단 업로드는 기존과 같이 5초 뒤 best effort다. 인증·연결이 계속 실패하거나 프로세스가 종료되면 서버에 실패 진단도 도착하지 않을 수 있다. 이번 변경은 최초 장애 해결이나 모든 실패의 원격 보존을 보장하는 변경이 아니다.

## 검증

- Functions wire·진단 계약 23건, 실제 Firestore Emulator 저장/인증 경계 2건 및 TypeScript 검사 통과.
- Android 관련 JVM 25건 통과: 실패 후 다음 알림에서 이전 원문을 그대로 한 번씩 처리, 서버 재시도 응답, 로컬 후속 저장 실패, 취소 전파, 안전한 코드 및 payload 연결을 검사한다.
- 실제 SDK → 인증 Callable → Firestore 실패 진단 보존 검사와 SDK 오류 코드 검사를 Android Emulator E2E에 추가했다. 로컬에서 컴파일했고 실제 실행은 전체 CI에서 확인한다.
- 초기 검사에서는 Firebase SDK 예외 생성자의 Kotlin internal 접근과 Android SparseArray가 없는 JVM 실행 환경 때문에 실패했다. 해당 SDK 검사는 실제 Android instrumentation으로 옮겨 같은 코드/비밀 정보 제외 단언을 유지했다. 검증을 생략하거나 약화하지 않았다.
- v2.0.13(versionCode 51) release 빌드 및 APK 서명 확인 완료. 최종 공개 다운로드와 CI는 배포 후 확인한다.

## 배포 순서와 후속

- 선택적 필드를 수용하는 Firebase 세 codebase를 먼저 배포하고 기본 smoke를 확인한 뒤 v2.0.13 APK를 공개한다. Web 제품 변경은 없다.
- 새 APK 설치 후 발생하는 실패부터 추가 코드가 기록된다. 이전 실패 원인은 소급 복원할 수 없다.
- 최종 SHA의 다섯 CI 검사·요약과 실제 Android 진단 E2E 실행 여부를 확인한다. 최초 지역화폐 지연은 아직 원인 미확정으로 유지한다.

## CI 42932905664 후속

- 제품 `2805e523`의 Firebase `release-20261111-capture-diagnostics-2805e523` 세 codebase·기본 smoke와 v2.0.13 APK 공개·다운로드 동일 hash·서명 검증을 완료했다. 실제 사용자 로그인 smoke를 수행한 것으로 보고하지 않는다.
- Functions, Web, Android build는 성공했다. 일반 Android instrumentation 50건 중 23번째 `deniedPushPermissionDoesNotBlockWebAndIsNotRequestedAgainAfterRecreation` 진행 중 프로세스가 종료됐다. 새 진단 Firebase E2E에는 도달하지 못했다. 남은 Web E2E는 별도 확인한다.
- 00:45:49.341Z 앱 주 스레드에서 SIGSEGV가 발생했다. native backtrace 상위 12개 frame은 WebView 113.0.5672.136의 `libmonochrome_64.so`다. 권한 revoke에 따른 프로세스 강제 종료 로그나 Java assertion/exception으로 단정하지 않는다.
- 실패 artifact `13817627392`의 logcat과 XML, job `130235790192`를 확인했다. [9월의 유사 관측](storage-consolidation-2026-09-18.md#android-계측-후속-확인)이 있으나 이번 충돌의 직접 원인까지 확정된 것은 아니다.
- 해당 권한 검사는 운영 URL로 실제 네트워크 로딩을 시작하고 문서 준비 확인 없이 화면을 재생성했다. 기존 `LocalWebViewDocument`를 재사용해 재생성 전후 응답을 격리하고 실제 DOM·Native bridge 완료, 이전 WebView 분리·단일 종료를 추가 검증한다. 권한 거부/재요청 방지와 실제 재생성 단언, 시간제한은 유지한다.
- 테스트 입력 격리를 바로잡은 후속이며 제품 코드는 변경하지 않는다. 같은 Android 14 CI에서 재검증하고 네이티브 충돌이 반복되면 해결로 보고하거나 자동 수정·재실행을 반복하지 않는다. Firebase·APK 재배포는 불필요하다.
