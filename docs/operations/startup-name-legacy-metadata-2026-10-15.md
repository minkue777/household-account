# 시작 가구명 지연 재조사와 앱 이름 변경

## 확인한 원인

v2.0.7 후에도 가구명이 늦게 나타난다는 보고로 실제 운영 조회와 호출 경로를 다시 확인했습니다. 또니망고네의 표시용 `household.members` 3개에는 ID·이름이 있지만 `aggregateVersion`이 없었습니다. 생성 시각과 가구 이름은 존재했습니다. 운영 문서는 읽기만 했습니다.

서버의 `householdView`는 표시 목록의 버전이 하나라도 없으면 가구 metadata 전체를 생략했습니다. Web은 별도 가구 조회에서 누락 버전을 1로 읽어 이름을 표시했지만, Native는 서버 응답에 이름이 없어 암호화 SessionMirror에 저장하지 못했습니다. 따라서 한 번 접속한 뒤에도 같은 문제가 반복될 수 있었습니다. 이전 Native 검사는 이름이 있는 응답 Map을 직접 준비하여 이 실제 서버 경계를 놓쳤습니다.

Web에도 별도 표시 공백이 있었습니다. 서버 HTML은 그림과 빈 제목을 내보내고, hydration 이후에만 localStorage 이름을 채웠습니다. 인증 응답을 보류한 이전 검사는 인증보다 이름이 먼저 나오는 것만 확인했으며, 그림과 이름의 첫 프레임 일치는 확인하지 못했습니다.

## 입력·결과·실패·저장 계약

- 로그인 세션 복원 계약: 구형 embedded 표시 목록의 버전 필드가 **누락된 경우만** 응답에서 1로 정규화합니다. 현재 정상 버전을 유지하고 명시적인 잘못된 값은 종전대로 거부합니다. canonical Member·Membership의 인증과 버전 검증은 유지합니다. 데이터 migration이나 운영 쓰기는 없습니다.
- LED-001/T-LED-001: 기존 cache의 표시 이름을 초기 문서에서 안전한 텍스트로 읽어 그림과 함께 표시합니다. 인증과 금융 조회는 기존 검증 경로를 유지합니다. 관리자 대상 선택·저장소 거부·cache 손상·이름 없음에서는 비워두며, 확정 로그아웃과 다른 사용자 전환에서 이전 이름을 지웁니다.
- AND-011/T-SESSION-MIRROR-001: 실제 서버의 구형 표시 metadata 응답으로 이름을 받아 기존 암호화 저장소에 보존하는지 검사합니다. 첫 접속에서 정상 이름을 저장한 다음 실행부터 Native에 선행 표시됩니다.
- 앱 표시는 Android launcher, PWA manifest의 name/short_name, Web 문서와 Apple 홈 화면 제목을 `모두의 가계부`로 통일합니다. 사용자 확인에 따라 로딩의 가구명과 `가계부 · 자산` 부제, 그림·배치·최소 2초는 유지합니다. Android v2.0.8/code46으로 배포합니다.

## 검증

서버의 새 회귀는 수정 전 이름 누락으로 실패했고, 수정 후 resolver·WebView 세션 발급 44개와 타입 검사가 통과했습니다. 실제 Firestore Emulator의 온보딩 → 구형 표시 목록 → resolver → WebView 세션 응답과 기존 통합 검사 7개가 통과했습니다. 누락 버전 정규화는 저장 문서를 바꾸지 않습니다.

실제 Native 검사는 API 36.1에서 Auth SDK → Functions SDK → `NativeMembershipResolver.refresh` → 암호화 SessionMirror와 재인스턴스 저장소 읽기를 거쳐 1개 통과했습니다(1.259초). canonical Member의 updateTime 불변과 embedded 구형 데이터의 미이관도 확인했습니다. 처음에는 새 fixture에 embedded 목록 자체가 없어서 제품 경로 전에 실패했고, 실제 canonical 멤버로 구형 목록을 구성하도록 fixture를 고친 뒤 통과했습니다. 최초 실패 로그를 보존합니다. 로그는 `%TEMP%/household-startup-name-real-native-fixture-20261015.log`입니다.

앱 이름 변경을 포함한 Android release build가 통과했습니다(13초). APK package label은 `모두의 가계부`, versionName은 `2.0.8`, code는 46입니다. 11,987,782바이트, SHA-256 `811a9971264dd3b520950b8cc2586bceaf647750ffa74261b87193a22a470b9b`이며 기존 인증서의 v2 서명을 확인했습니다.

Web 관련 단위 5개 파일 57개(CSP 포함)와 타입 검사가 통과했습니다. 실제 production build·Emulator·WebKit 두 가구 검사는 2 passed(57.8초)입니다. UI가 자연스럽게 저장한 이름을 사용하고 Next JS 청크를 보류한 상태에서 그림의 첫 frame에 이름이 함께 있으며 Auth·Firestore 요청이 0인지 확인했습니다. 청크 해제 후 hydration 오류 없이 기존 인증 보류·마지막 잔액 보류·전체 홈 표시·최소 표시시간 검사를 유지했습니다. 사용자별 이름이 서버 HTML에 포함되지 않고 기존 CSP의 정확한 inline hash에 포함되는 것도 확인했습니다.

첫 prototype은 Next server compiler가 함수 내부 `typeof window` 분기를 상수평가해 직렬화한 함수가 빈 문자열만 반환하도록 바뀌어 실제 build 검사가 실패했습니다. 함수의 외부 환경 분기를 제거하고 기존 저장소 접근 예외 경계에서 SSR 빈 값을 처리하도록 수정했습니다. 최초 실패와 generated HTML을 보존하며 기대값·시간 제한을 약화하지 않았습니다. 로그는 `%TEMP%/household-startup-name-first-frame-{e2e,e2e-fixed,unit-final}-20261015.log`입니다.

이전 CI 실패/진행 이력은 성공으로 덮지 않습니다. 배포 대상은 Firebase 세 codebase·Web Git 자동배포·서명 Android APK이며 운영 가계부 데이터는 변경하지 않습니다. 배포용 기존 로그인 복원과 재시도가 `auth/network-request-failed`로 실패해 실제 Firebase 로그인 smoke가 준비되기 전에는 서버 배포 완료로 보고하지 않습니다. Web·APK는 기존 서버와 호환되므로 독립 배포합니다.
