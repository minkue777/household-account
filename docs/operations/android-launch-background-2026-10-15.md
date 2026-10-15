# Android 기본 시작 화면의 배경·아이콘 교체 제거

## 원인과 범위

v2.0.11 서명 APK를 API 36.1 에뮬레이터에서 실행하고 화면 녹화를 프레임별로 확인했습니다. Android의 흰 배경·작은 런처 아이콘이 먼저 나타나고, 이후 `#F5F2FD` 배경의 Native 로고·앱 이름·부제가 함께 나타났습니다. Native는 제목을 동기 설정한 뒤 시작 레이어 전체를 표시합니다. 이번 현상은 제목 조회 지연이나 Native→Web 브랜드 교체가 아니라 OS 시작 창과 Native 화면의 차이입니다. 사용자 기기에서 걸리는 시간을 에뮬레이터 시간으로 추정하지 않습니다.

## 계약·설계

- 입력: Android MainActivity 시작과 OS 버전별 테마 선택입니다.
- 결과: OS 시작 창과 Native 로딩은 같은 `startup_background` 색을 사용합니다. Android 12 이상은 투명한 시스템 시작 아이콘을 사용하여 작은 런처 로고가 먼저 나타나지 않게 합니다. Native 첫 표시에서 그림·가구명 또는 앱 이름·부제를 함께 표시합니다.
- 실패: 권한 안내, 네트워크·HTTP 오류, renderer 복구와 준비된 콘텐츠로의 인계 조건은 기존대로 유지합니다.
- 저장: 변경 없음. 가구명 cache·인증·서버 요청·최소 2초 표시에는 변경이 없습니다.

기존 공통 테마 속성은 `Base.Theme.HouseholdAccount`에 두고 API 31 전용 테마에서 시스템 시작 화면 속성만 지정합니다. Android 11 이하는 기존 window background에 같은 색을 사용합니다. 런처 아이콘 자체는 바꾸지 않습니다. 별도 Splash Activity, 타이머나 시작 지연을 추가하지 않습니다. 앱 프로세스가 첫 화면을 그리기 전 OS 배경이 존재하는 것 자체를 없애는 변경은 아닙니다.

## 검증 추적성

AND-003 / T-WEBVIEW-002의 실제 MainActivity 이미지 보류 검사에 OS 테마와 Native 배경색 일치, Android 12 이상 시스템 아이콘의 완전 투명 렌더링 검사를 추가했습니다. 기존 제목·부제·그림 배치·가로 화면·이미지 준비 후 인계·복귀 검증을 유지합니다. 릴리즈 APK 시작 녹화로 수정 전후 기본 창과 Native 첫 표시를 비교합니다.

배포 대상은 Android v2.0.12/code50입니다. Web·Firebase 실행 코드 변경은 없습니다. 이전 CI의 미완료 결과도 후속 자동화에서 유지합니다.

로컬 release·debug·androidTest APK 빌드와 API 36.1 실제 MainActivity 검사 5개(시작 배경·그림, 저장 이름, 콘텐츠 준비 인계, HTTP 오류, 필수 권한 안내)가 통과했습니다. 서명 APK의 시작 녹화에서도 OS 배경과 Native 배경이 이어지고 별도 작은 아이콘 없이 그림·제목·부제가 함께 나타남을 확인했습니다. OS가 앱 프로세스 준비 중 보여 주는 단색 배경은 남습니다. 로그는 `%TEMP%/household-startup-background-v2012-build-20261015.log`, `%TEMP%/household-startup-background-instrumentation-20261015.log`, 녹화는 `%TEMP%/household-startup-background-v2012.mp4`입니다.

APK는 11,988,538바이트이며 SHA-256은 `6e1df8998373b20eb5c916df1babdd3aa7ea8e529238e4fd3a2cdc14ead3baa8`입니다. v2 서명과 기존 인증서, 실제 앱 이름·버전 code50/v2.0.12를 확인했습니다.

## CI 후속: WebKit 성능 측정 중 전송 오류

제품 `be599ba38cb7834c3720c6cf8764ac8de99b44d9`의 [CI 38730330103](https://github.com/minkue777/household-account/actions/runs/38730330103)은 functions·web·android·실제 android-instrumentation이 성공했습니다. web-e2e 안의 기능 E2E도 2026-10-15 12:14:25 UTC에 통과했지만, 이후 성능 측정의 WebKit 5번째 표본이 실패하여 job과 요약은 실패입니다. 성능 참고 시간 초과가 아니라 `ledger.select-day`의 실제 지출 표시가 30초 안에 완료되지 않은 실패입니다.

- 실패 화면에는 선택한 날짜와 `날짜별 내역 화면을 불러오는 중입니다.`가 있습니다. 클릭 누락이나 전체 JS 정지는 아니며 rAF 1,813회·timer 1,492회가 계속 진행됐습니다.
- `home-expense-detail`을 포함한 스크립트 8개와 Firestore Listen GET/POST가 같은 시점에 `WebKit encountered an internal error`로 실패했습니다. HTTP 오류 응답이 관측된 경우와 구분합니다.
- 약 140ms 후 현재 재실행 문서에서 Firebase Auth `_poll`의 `IDBDatabase: The database connection is closing` 오류가 발생했습니다. 이미 닫힌 이전 문서의 오류가 아닙니다. 이후 일부 다른 스크립트는 다시 HTTP 200을 받았지만 날짜 상세는 준비되지 않았습니다.
- 화면·DOM·전송·문서별 오류 자료는 `%TEMP%/household-startup-background-ci-38730330103-performance/failures/webkit-mobile-failure-5.{json,html,png}`, 실패 로그는 `%TEMP%/household-startup-background-ci-38730330103-failed.log`입니다. 원 실행의 실패를 성공으로 바꾸거나 무변경 재실행하지 않습니다.

현재 잠금파일은 Playwright 1.62.0 / WebKit build 2336을 사용했습니다. [Playwright #42803](https://github.com/microsoft/playwright/issues/42803)은 이 Linux 번들의 libsoup 3.6.5에서 요청 종료 처리 중 해제된 메모리를 다시 사용하는 결함과 네트워크 프로세스 종료를 보고합니다. [WebKit #74619](https://github.com/WebKit/WebKit/pull/74619)의 libsoup 3.6.6 갱신이 반영됐고 Playwright 담당자는 1.64에 포함됨을 확인했습니다. 이번 요청 동시 실패와 저장 연결 종료는 이 결함에 부합하지만, 이 CI의 프로세스 crash dump는 없어 동일 원인으로 확정하지 않습니다. iPhone 운영 장애가 해결됐다는 근거도 아닙니다.

알려진 결함이 수정된 안정 버전 Playwright 1.64.1 / WebKit build 2370(27.2)으로 테스트 의존성과 잠금파일을 갱신합니다. 앱 코드의 임의 재시도·예외처리, 측정 준비 조건·30초 제한·7개 표본·재시도 0회는 바꾸지 않습니다. 새 브라우저 버전의 측정치는 기존 버전과 환경이 다르므로 앱 성능 개선 수치로 해석하지 않습니다. Firebase·APK 변경은 없으며 공개된 v2.0.12는 유지합니다. Web manifest 변경에 따른 기존 Vercel Git 자동배포는 별도로 확인합니다.

로컬 Windows에서는 새 production build와 실제 Auth/Functions/Firestore Emulator로 Chromium·WebKit 두 시나리오가 모두 통과했습니다(`2 passed`, 2.5분). 로컬 진단 모드로 환경별 준비 1회·측정 1회를 수행하여 첫 홈·재실행·날짜 선택·편집·검색·통계·자산 경로의 호환성을 확인했습니다. Linux 원 장애의 재현이나 CI 7회 측정 완료를 뜻하지 않습니다. `tsc --noEmit`과 준비 단계 Functions architecture 43개도 통과했으며 서버는 정상 종료했습니다. 설치·준비·측정 로그는 `%TEMP%/household-webkit-upgrade-{install,prepare,performance}-20261015.log`입니다. 최종 판정은 새 SHA의 Linux 전체 CI로 진행합니다.
