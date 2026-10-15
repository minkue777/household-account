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
