# 수직 통합 테스트 운영 기준

## 목적

계약 테스트가 업무 규칙을 검증하는 것과 별도로, 사용자의 동작이 실제 인증·네트워크·저장소와
화면 반영까지 이어지는지를 검증합니다. 테스트는 운영 Firebase 프로젝트와 운영 데이터를
사용하지 않습니다.

## 자동 실행 경계

| 경계 | 자동 검증 | 실행 명령 |
|---|---|---|
| Functions callable | Auth Emulator ID 토큰 → callable HTTP wire → Functions Emulator → Firestore Emulator | `cd functions && npm run test:callable-integration` |
| Web 사용자 여정 | 실제 Chromium → Emulator 로그인 → 신규 가계부 → 첫 월 원장 → 지출 생성·수정·삭제 → 화면 및 Firestore 확인 | `cd web && npm run test:e2e` |
| Android 런타임 | 실제 Emulator의 권한 분기, WebView 시작, Quick Edit 표시·입력 검증·닫기 | `cd android && ./gradlew connectedDebugAndroidTest` |

각 명령은 테스트용 `demo-` 프로젝트와 실행 중에만 존재하는 Emulator 데이터를 사용합니다.
운영 프로젝트 ID로 Emulator 모드를 켤 수 없으며 Web 테스트 로그인은 loopback 주소에서만
활성화됩니다.

## 핵심 합격 기준

1. 인증되지 않은 callable 요청은 거부되고 Firestore를 변경하지 않습니다.
2. 인증된 신규 사용자는 가계부와 자기 멤버십 및 기본 카테고리를 생성합니다.
3. 수동 지출의 생성·조회·수정·삭제가 실제 callable과 Firestore를 왕복합니다.
4. Firestore에서 확정된 상태가 실제 브라우저의 월 원장에 반영됩니다.
5. Android 필수 권한이 없으면 WebView를 시작하지 않고 설정 화면을 표시합니다.
6. Android 필수 권한이 있으면 신뢰된 앱 URL만 WebView에서 시작합니다.
7. Quick Edit은 전달된 가맹점·금액·일시·카테고리를 첫 화면에 표시하고 잘못된 저장을 막습니다.

## CI

`.github/workflows/quality-gates.yml`은 기존 단위·계약 테스트와 별도로 다음 게이트를 실행합니다.

- Functions job의 callable 수직 통합
- 독립 `web-e2e` job의 Playwright 사용자 여정
- 독립 `android-instrumentation` job의 Android Emulator 테스트

실패 시 Playwright trace와 screenshot을 CI artifact로 보존합니다. 테스트 수가 아니라 이 핵심
사용자 여정의 통과 여부를 릴리스 판단 기준으로 사용합니다.

## 아직 자동화하지 못한 경계

다음 항목은 Firebase Emulator가 실제 플랫폼을 완전히 재현하지 못하므로 staging 또는 실기기
smoke test가 추가로 필요합니다.

- iPhone 홈 화면 PWA의 foreground/background Push와 알림 클릭
- 실제 Google OAuth 콘솔 설정
- Android Play Integrity와 운영 App Check
- Cloud Scheduler의 실제 시간 기반 호출
- 실제 외부 시세·배당 공급자

이 항목은 참고 구현 테스트 통과로 대체하지 않습니다.
