# Android 시작 화면의 중간 교체 제거

## 원인과 비교

사용자가 시작 화면의 `가계부 · 자산` 위치가 한 번 바뀐다고 보고했습니다. 기존 Android는 `onPageFinished`와 `postVisualStateCallback` 뒤 Native 시작 화면을 내렸습니다. 이때 인증·홈 데이터가 준비되지 않았으면 비슷하게 만든 Web 시작 화면이 나타났습니다. 같은 글자를 서로 다른 엔진으로 다시 그리는 전환이었습니다.

실제 API 36.1 MainActivity에 production HTML·CSS·글꼴·이미지를 공급하여 전환 전후를 측정했습니다. 운영 요청은 로컬 문서 어댑터로 차단했습니다. 기본 글자 크기에서 부제 잉크는 360dp 폭에서 왼쪽 1dp·아래 0.67dp, 390dp 폭에서 왼쪽 1.67dp·아래 0.33dp 이동했습니다. 130% 확대에서는 아래 3~4dp 이동하고 글자 크기도 달라졌습니다. Native의 SP 변환과 WebView의 `textZoom=130` 선형 확대, 행 높이·자간·반응형 계산 차이가 겹쳤습니다. 시작 영역의 `text-size-adjust:none/100%`는 WebView 확대를 해제하지 못했습니다.

WebKit·Chromium에서 이미지 지연·글꼴 지연·이름 변경·HTML 파싱 중단 14조건을 따로 검사한 결과 390×844 부제 box는 y=530.984375px, 높이 26px로 유지됐습니다. 이는 Web 내부 로드만으로 발생하는 이동과 Native 전환 문제를 구분한 결과입니다. 사용자 기기의 정확한 글자 확대 설정은 확인하지 않았습니다.

인접 `catchtable`의 `web/react/startup-screen.tsx`와 Android `MainActivity.kt`는 Native 시작 화면을 실제 콘텐츠 준비까지 유지하고 `content-ready` 신호 뒤 본화면을 보여 줍니다. Android에서 Web 로딩 화면을 중간에 다시 보여 주지 않습니다. 가계부도 이 표시 계약을 적용합니다. 캐치테이블 코드·운영 요청은 변경하거나 실행하지 않았습니다.

## 계약과 설계

- **입력:** 허용 origin의 최상위 문서에서 보내는 기존 versioned Bridge의 `startup.content-ready`, 빈 payload입니다. 로그인·가구 데이터 접근 권한을 부여하는 명령이 아닙니다.
- **결과:** 현재 WebView의 실제 콘텐츠가 그려질 수 있을 때 Native 시작 화면을 한 번 내립니다. 인증 대기에서 홈 데이터 대기로 바뀌는 중간에는 유지합니다. 홈 외에도 로그인·가구 가입·오류 화면은 표시 가능한 콘텐츠입니다.
- **실패:** 메인 문서 HTTP·네트워크 오류, renderer 종료와 기존 권한 안내는 시작 화면이 가리지 않습니다. 이전 WebView의 늦은 신호와 subframe·외부 origin 요청은 현재 화면을 해제하지 못합니다.
- **저장:** 저장소와 서버 데이터 변경은 없습니다. 가구명은 기존 암호화 SessionMirror를 사용하고 이름이 없으면 `모두의 가계부`를 표시합니다.

새 APK는 허용 origin의 문서 시작에 지원 flag `window.__HOUSEHOLD_NATIVE_STARTUP__`를 제공하고 새 Web은 `household-native-startup=content-ready-v1` metadata로 대응 계약을 선언합니다. 새 조합은 Web의 공통 시작 화면이 모두 사라진 다음 프레임에 준비 신호를 보내고 Native가 visual callback 이후 본화면을 드러냅니다. 구 APK/PWA는 기존 Web 시작 화면을 유지하고, 새 APK에서 구 Web을 읽으면 기존 문서 완료 전환을 사용합니다. 지원되지 않는 WebView 기능에는 새로운 대기를 적용하지 않습니다.

최소 2초와 전체 홈 준비 조건은 기존 Web 계약 하나가 소유합니다. Native 타이머, 추가 데이터 조회, 폰트별 좌표 보정, 앱 전체 글자 확대 제한을 추가하지 않습니다. 공통 로딩 컴포넌트 교체와 로그인 코드 로딩 중에는 준비 신호를 보내지 않습니다.

## 검증 추적성

| 계약 | 실제 경로 검증 |
|---|---|
| AND-003 / AND-006 | MainActivity의 문서 시작 flag, 준비 신호 전 Native 유지, 신호 후 visual callback 해제, 구 문서 호환·오류·origin 경계 |
| LED-001 / T-LED-001 | Web 공통 로딩 교체·StrictMode·로그인 청크 대기·일반 Web/PWA·문서당 한 번 신호 |
| AND-014 / T-ANDROID-STARTUP-001 | 실제 Firebase SDK·production Web의 초기 Lite 응답 보류 중 Native 유지, 전체 홈 준비 후 직접 전환, 기존 최소시간·조회·계측 보존 |

수정 전 진단 JSON·스크린샷·잉크 분석과 임시 소스는 `%TEMP%/household-startup-transition-*`에 보존했습니다. 진단용 테스트와 assets는 작업 트리에서 정리했고 에뮬레이터의 화면·글자 배율도 원래 값으로 복원했습니다. 아래 검증과 배포 결과는 실제 실행 후 기록합니다.

Web 관련 Jest 4파일 41개와 타입 검사가 통과했습니다. 실제 Promise를 사용하는 Suspense 대기, `/guest`의 홈 이동, 동적 로그인 청크 대기, 공통 로딩 교체, StrictMode, 구 APK·PWA, 취소된 늦은 frame과 1회 신호를 검사했습니다. 검토 중 `/guest`가 `null`을 반환하고 로그인 dynamic import에 fallback이 없다는 별도 빈 화면 경계를 확인해 공통 시작 화면을 유지하도록 바꿨습니다. 라우트 children의 Suspense도 같은 fallback을 사용합니다.

실제 API 36.1 Activity/WebView 검사 6개가 통과했습니다(23초, skip 0). 메타데이터가 있는 문서의 로드 완료 뒤에도 Native를 유지하고, 실제 준비 요청·visual callback 뒤 준비된 본문으로 전환했습니다. 잘못된 payload, 이전 WebView의 늦은 완료, 중복 신호, 구 문서 호환, 가구명, HTTP 503, origin 경계와 인증 SDK 미초기화를 확인했습니다. 로그는 `%TEMP%/household-startup-handoff-android-{build,instrumentation}-20261015.log`입니다.

Android v2.0.10/code48의 debug·test·release 빌드와 기존 인증서 v2 서명 검증이 통과했습니다. 서명 APK는 11,987,790바이트, SHA-256 `d6390dcbdb66b0f7cd5777993198dac2c329dc89ecd7fccf48c5a001e77913e5`입니다. Web·APK가 배포 대상이며 Firebase 변경은 없습니다. 요구사항 248개·시나리오 235개 선언 집계와 E2E 추적성 누락 0개도 확인했습니다.

실제 production build·Firebase Emulator·WebKit의 기존 첫 화면 검사 4개도 통과했습니다(1.4분). 가구명 없는 첫 표시, 두 가구의 초기 파서·인증·잔액 보류, 전체 준비 후 표시와 최소 2초, 20초 오류·재시도·정상 hydration/CSP 조건을 유지했습니다. 로그는 `%TEMP%/household-startup-handoff-web-e2e-20261015.log`입니다. 준비 단계의 Functions architecture 검사 43개도 통과했습니다. 실제 Native Firebase 시작 검사는 초기 서버 응답 보류 중 레이어 유지와 준비된 홈으로 바로 전환하는 assertion을 추가했고 별도 실행·원격 CI로 추적합니다.
