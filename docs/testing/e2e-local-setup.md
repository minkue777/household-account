# 실제 E2E 로컬 준비

저장소 루트에서 잠금파일에 맞춰 네 패키지를 한 번 설치합니다.

```text
npm ci --prefix functions
npm ci --prefix web
npm ci --prefix functions-payment-capture
npm ci --prefix functions-access-session
```

이후 `npm --prefix web run test:e2e`는 두 child codebase의 설치 버전이 잠금파일과 맞는지 먼저 확인합니다. 누락·불일치가 있으면 필요한 `npm ci --prefix ...` 명령을 안내하고 Functions 빌드 전에 중단합니다. 매번 의존성을 재설치하지 않습니다. Android 대상 변경의 `test:e2e:android`도 같은 준비 검사를 사용합니다. UI만 바뀐 경우 Android Emulator 실행 범위를 넓히지 않습니다.

실행 래퍼는 세 codebase의 `.secret.local`에 같은 `SHORTCUT_CREDENTIAL_PEPPER`가 적용되도록 준비합니다. 기존 파일은 보존하고, 기존 값이 하나 있으면 없는 파일에 그 값만 임시로 준비합니다. 서로 다른 값 또는 기존 파일의 키 누락·공백은 값 출력 없이 시작 전에 알려 줍니다. 기존 파일이 전혀 없으면 Emulator 전용 dummy를 사용합니다. 종료 시 이번 실행이 생성했고 내용이 바뀌지 않은 파일만 정리합니다.

이전 실행이 강제 종료되어 파일이 남아 있으면 기존 파일로 보존합니다. 기존 운영용 secret 파일을 테스트를 위해 수정하지 말고, 서로 다른 설정을 사용해야 한다면 별도 체크아웃에서 실행합니다.

CI는 익명 production PWA의 JSON 결과를 `quality-web-pwa`에, 실패한 브라우저 trace와 screenshot을 `web-pwa-failure`에 보존합니다. Native TLS 환경의 실행 방법과 검증 범위는 Native 테스트 문서를 따릅니다.

관리자 성능 통계의 Cloud Logging은 Emulator가 제공되지 않으므로 `tools/e2e/firebase-emulators.mjs`가 전용 preload를 다음 Functions 실행부터 적용합니다. `HOUSEHOLD_E2E_CLOUD_LOGGING_TRANSPORT=true`, 정확한 demo 프로젝트, `127.0.0.1:8080` Firestore 연결을 모두 요구하며 다른 프로젝트는 명시적으로 거절합니다. 외부 서비스 계정의 `getAccessToken`만 synthetic provider token을 반환하고, 정확한 `https://logging.googleapis.com/v2/entries:list` POST는 `e2eGoogleCloudTransport/interactiveLatency`의 원시 응답 fixture를 사용합니다. fixture가 없으면 빈 로그 목록을 반환합니다. 다른 HTTP 요청과 사용자 Auth JWT 검증, DB 조회, 로그 파싱·중복 제거·통계 집계는 실제 코드를 실행합니다. 마지막 Logging 조회 조건은 같은 collection의 `lastLoggingRequest`에 기록하며 자격 정보는 기록하지 않습니다. 로컬 PC의 ADC 로그인이나 CI의 운영 Google 자격 정보는 필요하지 않습니다.

같은 launcher는 `HOUSEHOLD_E2E_FCM_TRANSPORT=true`와 `firebase-fcm-transport.cjs`도 사용합니다. 이 preload는 정확한 demo 프로젝트와 loopback Firestore에서만 Admin SDK `Messaging.send()`를 대신하여 시도한 메시지를 `e2eFcmTransport`에 기록하고, 준비한 성공·오류 응답을 반환합니다. Command·Outbox 소비·수신자 계획·Delivery 저장·오류별 endpoint 변경은 실제 코드로 진행합니다. 외부 FCM/Google IAM/APNs의 가용성이나 물리 기기에 알림이 도착했는지는 여기서 주장하지 않습니다. 익명 PWA의 CDP push/click 주입도 OS 이벤트 전달만 대체하는 별도 경계이며, 실제 생성 worker와 bundled SDK의 payload 처리·알림 표시 결과를 관찰합니다.

2026-09-11의 관리자 3개·종목 검색 1개·로그인 PWA 2개 선택 검증은 새 Web production build에서 6개 모두 통과했습니다. 상세 결과와 Functions lib 범위 제한은 [Portfolio·운영·PWA 매핑](e2e-portfolio-admin-mapping.md)의 실행 기록을 따릅니다.

일반 운영 PWA는 Emulator/E2E 환경 변수와 전용 preload가 없는 shell에서 Node 22로 `npm --prefix web run build` 후 `npm --prefix web run test:e2e:pwa`를 실행합니다. 이 검증은 Firebase DB가 필요 없으며 port 3200과 Web 빌드 디렉터리를 사용합니다. 2026-09-11 21:53 KST의 일반 운영 빌드에서 익명 PWA 5개가 14.1초에 통과했고, 당시 결과와 worker/header artifact는 `%TEMP%/household-pwa-normal-production-evidence`에 별도 보존했습니다.
